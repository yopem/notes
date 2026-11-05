import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  Vault,
  VaultAssetError,
  VaultFolderError,
  VaultNoteError,
  VaultOpenError,
  VaultResource,
} from "@/features/vault/service"

/*
 * Contract defined before implementation. Reference evidence:
 * main/vault.ts:1693-1735 layout; 2950-3035 filename titles and raw bodies;
 * 3347-3367 append separators; 3751-3828 mirrored lifecycle paths;
 * 3995-4101 persistent attachment restore; 4107-4295 folder lifecycle.
 * bridge-contract/src/bridge.ts:412-506 defines filesystem operations.
 * bridge-contract/src/ipc.ts:739-785 defines note metadata and raw bodies.
 * main/note-creation-metadata.ts:94-130 preserves creation time across saves.
 * shared-domain/src/frontmatter.ts defines flat fields and tag lists.
 * app-core/src/browse.ts:250-270 consumes separate pin state.
 * Titles use filenames; note bodies retain frontmatter. Archive/trash retain
 * subpaths; attachments retain restore metadata. Pins are not inferred YAML.
 * Safety extensions: exact origin restore, non-destructive imports, explicit
 * delete guards, expected-content writes, and rollback journals.
 * Limits: no link rewriting, system-folder remapping, full YAML, legacy
 * migration, UI integration, or cross-platform runtime verification.
 * Safety cases: traversal, symlinks, dotfiles, collisions, malformed metadata,
 * interrupted writes, external conflicts, Unicode, restart, and process locks.
 * Run: bun test tests/vault.test.ts. All files use temporary directories.
 */
const roots: string[] = []

const vaults: Vault[] = []

function root() {
  const directory = mkdtempSync(join(tmpdir(), "still-vault-test-"))
  roots.push(directory)

  return directory
}

function open(
  directory = root(),
  primaryNotesLocation: "inbox" | "root" = "inbox",
) {
  const vault = new Vault(directory, { primaryNotesLocation })
  vaults.push(vault)

  return vault
}

function hash(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

afterEach(() => {
  for (const vault of vaults.splice(0)) vault.close()

  for (const directory of roots.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe("native Markdown vault", () => {
  test("acquires the vault only when the layer runs and releases its lock and watchers", () => {
    const directory = join(root(), "deferred")
    const layer = VaultResource.layer(directory)
    const events: string[] = []
    expect(existsSync(directory)).toBe(false)

    const vault = Effect.runSync(
      Effect.gen(function* () {
        const current = yield* VaultResource
        expect(existsSync(join(directory, ".still-notes", "vault.lock"))).toBe(
          true,
        )
        expect(() => new Vault(directory)).toThrow("lock")
        current.subscribe((event) => {
          events.push(event.kind)
        })
        const create = current.createNote("inbox", "Scoped", "", "preserved")
        expect(existsSync(join(directory, "inbox", "Scoped.md"))).toBe(false)
        yield* create

        return current
      }).pipe(Effect.provide(layer)),
    )

    const failure = Effect.runSync(
      vault.listNotes().pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined,
        }),
      ),
    )

    expect(failure).toBeInstanceOf(VaultNoteError)
    expect(failure?._tag).toBe("VaultNoteError")
    expect(failure?.message).toContain("closed")
    expect(() => Effect.runSync(vault.listNotes())).toThrow("closed")
    expect(existsSync(join(directory, ".still-notes", "vault.lock"))).toBe(
      false,
    )

    const reopened = open(directory)

    expect(Effect.runSync(reopened.readNote("inbox/Scoped.md")).body).toBe(
      "preserved",
    )
  })
  test("releases the lock when the scoped workflow fails", () => {
    const directory = root()

    const result = Effect.runSync(
      Effect.gen(function* () {
        yield* VaultResource

        return yield* Effect.fail("interrupted workflow")
      }).pipe(
        Effect.provide(VaultResource.layer(directory)),
        Effect.match({ onFailure: (error) => error, onSuccess: () => "ok" }),
      ),
    )

    expect(result).toBe("interrupted workflow")
    expect(existsSync(join(directory, ".still-notes", "vault.lock"))).toBe(
      false,
    )

    expect(Effect.runSync(open(directory).listNotes())).toEqual([])
  })
  test("reports acquisition failures as typed errors without releasing another vault's lock", () => {
    const directory = root()
    const original = open(directory)

    const failure = Effect.runSync(
      Effect.provide(VaultResource, VaultResource.layer(directory)).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined,
        }),
      ),
    )

    expect(failure).toBeInstanceOf(VaultOpenError)
    expect(failure?._tag).toBe("VaultOpenError")
    expect(failure?.message).toContain("lock")
    expect(() => new Vault(directory)).toThrow("lock")
    expect(Effect.runSync(original.listNotes())).toEqual([])
  })
  test("creates layout without seeding or moving unknown existing files", () => {
    const directory = root()
    writeFileSync(join(directory, "loose.bin"), "keep")
    mkdirSync(join(directory, ".private"))
    writeFileSync(join(directory, ".private", "hidden.md"), "secret")
    const vault = open(directory)
    expect(Effect.runSync(vault.listNotes())).toEqual([])
    expect(readFileSync(join(directory, "loose.bin"), "utf8")).toBe("keep")
    expect(existsSync(join(directory, ".private", "hidden.md"))).toBe(true)

    for (const name of [
      "inbox",
      "quick",
      "archive",
      "trash",
      "assets",
      ".still-notes",
    ])
      expect(existsSync(join(directory, name))).toBe(true)
  })
  test("root primary and nested folder IDs remain vault-relative POSIX", () => {
    const vault = open(root(), "root")
    const creation = vault.createFolder("inbox", "Work/研究")
    expect(existsSync(join(vault.root, "Work"))).toBe(false)
    expect(Effect.runSync(creation).path).toBe("Work/研究")

    const note = Effect.runSync(
      vault.createNote("inbox", "Café 😀", "Work/研究"),
    )

    expect(note.path).toBe("Work/研究/Café 😀.md")
    expect(note.id).toBe(note.path)
    expect(note.body).toBe("# Café 😀\n\n")
    expect(Effect.runSync(vault.createNote("quick", "Quick")).path).toBe(
      "quick/Quick.md",
    )
    expect(
      Effect.runSync(vault.listFolders()).some(
        (folder) => folder.path === "Work/研究",
      ),
    ).toBe(true)
    expect(Effect.runSync(vault.listNotes())).toHaveLength(2)
  })
  test("metadata uses filename, raw frontmatter, tags excluding code, stable creation and persisted pins", () => {
    const directory = root()
    let vault = open(directory)

    const body =
      "---\ntitle: Not filename\ntags:\n  - Alpha\n  - '#beta'\npinned: true\n---\n# Heading\n#日本語 #Alpha\n`#skip`\n  ```md\n#hidden\n  ```\n"

    const note = Effect.runSync(vault.createNote("inbox", "Filename", "", body))
    expect(note.title).toBe("Filename")
    expect(note.frontmatter.title).toBe("Not filename")
    expect(note.tags).toEqual(["Alpha", "beta", "日本語"])
    expect(note.pinned).toBe(false)
    Effect.runSync(vault.setPinned(note.path, true))

    const written = Effect.runSync(
      vault.writeNote(note.path, body + "tail", {
        expectedHash: note.hash,
      }),
    )

    expect(written.createdAt).toBe(note.createdAt)
    expect(written.updatedAt).toBeGreaterThanOrEqual(note.updatedAt)
    vault.close()
    vault = open(directory)
    expect(Effect.runSync(vault.readNote(note.path)).pinned).toBe(true)
    expect(Effect.runSync(vault.readNote(note.path)).createdAt).toBe(
      note.createdAt,
    )
  })
  test("write conflicts retain caller draft and disk bytes; explicit checks detect deletion", () => {
    const vault = open()
    const note = Effect.runSync(vault.createNote("inbox", "Conflict"))
    writeFileSync(join(vault.root, note.path), "external")
    const draft = "pending draft"
    expect(() =>
      Effect.runSync(
        vault.writeNote(note.path, draft, { expectedContent: note.body }),
      ),
    ).toThrow(/conflict/i)

    const change = Effect.runSync(
      vault.checkExternalChange(note.path, { expectedHash: note.hash }, draft),
    )

    expect(change.changed).toBe(true)
    expect(change.pendingContent).toBe(draft)
    expect(change.disk?.body).toBe("external")
    rmSync(join(vault.root, note.path))
    expect(
      Effect.runSync(
        vault.checkExternalChange(note.path, { expectedHash: note.hash }),
      ).deleted,
    ).toBe(true)
    expect(() =>
      Effect.runSync(
        vault.writeNote(note.path, draft, { expectedHash: note.hash }),
      ),
    ).toThrow()
  })
  test("append start/end respects separators and empty additions", () => {
    const vault = open()
    let note = Effect.runSync(vault.createNote("inbox", "Append", "", "body"))
    note = Effect.runSync(
      vault.appendToNote(note.path, " end  ", "end", {
        expectedHash: note.hash,
      }),
    )
    expect(note.body).toBe("body\n\n end\n")
    note = Effect.runSync(
      vault.appendToNote(note.path, "start", "start", {
        expectedHash: note.hash,
      }),
    )
    expect(note.body).toBe("start\n\nbody\n\n end\n")
    expect(
      Effect.runSync(
        vault.appendToNote(note.path, "  ", "end", { expectedHash: note.hash }),
      ).body,
    ).toBe(note.body)
  })
  test("note lifecycle effects defer changes and report tagged failures", () => {
    const vault = open()

    const note = Effect.runSync(
      vault.createNote("inbox", "Deferred", "", "body"),
    )

    const pin = vault.setPinned(note.path, true)
    const rename = vault.renameNote(note.path, "Later")
    const trash = vault.moveToTrash(note.path)
    const empty = vault.emptyTrash({ confirm: true })
    expect(Effect.runSync(vault.readNote(note.path)).pinned).toBe(false)
    expect(existsSync(join(vault.root, "inbox/Later.md"))).toBe(false)
    expect(existsSync(join(vault.root, note.path))).toBe(true)
    expect(Effect.runSync(empty).deleted).toEqual([])
    expect(Effect.runSync(pin).pinned).toBe(true)
    expect(Effect.runSync(rename).path).toBe("inbox/Later.md")

    const failures: readonly Effect.Effect<unknown, VaultNoteError>[] = [
      trash,
      vault.setPinned("missing.md", true),
      vault.checkExternalChange("missing.md", { expectedHash: "invalid" }),
      vault.renameNote("missing.md", "Name"),
      vault.moveNote("missing.md", "quick"),
      vault.duplicateNote("missing.md"),
      vault.archiveNote("missing.md"),
      vault.unarchiveNote("missing.md"),
      vault.moveToTrash("missing.md"),
      vault.restoreFromTrash("missing.md"),
      vault.deleteNote("missing.md", { confirm: true }),
      vault.emptyTrash({ confirm: false }),
    ]

    for (const failure of failures)
      expect(Effect.runSync(Effect.flip(failure))).toBeInstanceOf(
        VaultNoteError,
      )
  })
  test("note lifecycle preserves exact origin through archive, trash, restart and collision", () => {
    const directory = root()
    let vault = open(directory)

    let note = Effect.runSync(
      vault.createNote("quick", "Life", "nested", "payload"),
    )

    const created = note.createdAt
    note = Effect.runSync(vault.renameNote(note.path, "Renamed"))
    note = Effect.runSync(vault.archiveNote(note.path))
    expect(note.path).toBe("archive/nested/Renamed.md")
    note = Effect.runSync(vault.moveToTrash(note.path))
    expect(note.path).toBe("trash/nested/Renamed.md")
    vault.close()
    vault = open(directory)
    note = Effect.runSync(vault.restoreFromTrash(note.path))
    expect(note.path).toBe("archive/nested/Renamed.md")
    note = Effect.runSync(vault.unarchiveNote(note.path))
    expect(note.path).toBe("quick/nested/Renamed.md")
    expect(note.createdAt).toBe(created)
    expect(note.body).toBe("payload")
    const copy = Effect.runSync(vault.duplicateNote(note.path))
    expect(copy.path).toBe("quick/nested/Renamed copy.md")
    expect(copy.pinned).toBe(false)
    Effect.runSync(vault.createNote("inbox", "Renamed", "target"))
    note = Effect.runSync(vault.moveNote(note.path, "inbox", "target"))
    expect(note.path).toBe("inbox/target/Renamed 2.md")
    expect(() =>
      Effect.runSync(vault.deleteNote(note.path, { confirm: true })),
    ).toThrow(/trash/i)
    note = Effect.runSync(vault.moveToTrash(note.path))
    expect(() =>
      Effect.runSync(vault.deleteNote(note.path, { confirm: false })),
    ).toThrow()
    Effect.runSync(vault.deleteNote(note.path, { confirm: true }))
    expect(existsSync(join(directory, note.path))).toBe(false)
  })
  test("folder rename and duplicate preserve nested Markdown and hidden data; delete refuses unknown data", () => {
    const vault = open()
    Effect.runSync(vault.createNote("inbox", "Nested", "A/B", "exact"))
    mkdirSync(join(vault.root, "inbox/A/.hidden"))
    writeFileSync(join(vault.root, "inbox/A/.hidden/keep"), "private")
    const rename = vault.renameFolder("inbox", "A", "Moved")
    expect(existsSync(join(vault.root, "inbox/A/B/Nested.md"))).toBe(true)
    expect(Effect.runSync(rename).path).toBe("inbox/Moved")
    expect(Effect.runSync(vault.readNote("inbox/Moved/B/Nested.md")).body).toBe(
      "exact",
    )
    const duplicate = vault.duplicateFolder("inbox", "Moved")
    expect(existsSync(join(vault.root, "inbox/Moved copy"))).toBe(false)
    expect(Effect.runSync(duplicate).path).toBe("inbox/Moved copy")
    expect(
      readFileSync(join(vault.root, "inbox/Moved copy/.hidden/keep"), "utf8"),
    ).toBe("private")

    const failure = Effect.runSync(
      vault.deleteFolder("inbox", "Moved", { confirm: true }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => undefined,
        }),
      ),
    )

    expect(failure).toBeInstanceOf(VaultFolderError)
    expect(failure?._tag).toBe("VaultFolderError")
    expect(failure?.message).toMatch(/unknown|hidden/i)
    expect(failure?.cause).toBeInstanceOf(Error)
    expect(() =>
      Effect.runSync(vault.renameFolder("inbox", "Moved", "Moved/inside")),
    ).toThrow()
    expect(() =>
      Effect.runSync(vault.renameFolder("inbox", "Moved", "Moved copy")),
    ).toThrow()
    Effect.runSync(vault.createNote("inbox", "Delete", "Clean/Sub"))
    const deletion = vault.deleteFolder("inbox", "Clean", { confirm: true })
    expect(existsSync(join(vault.root, "inbox/Clean/Sub/Delete.md"))).toBe(true)
    Effect.runSync(deletion)
    expect(existsSync(join(vault.root, "inbox/Clean"))).toBe(false)
    expect(() =>
      Effect.runSync(vault.deleteFolder("inbox", "", { confirm: true })),
    ).toThrow()
  })
  test("empty trash deletes Markdown only, preserves unknown files and hidden folders", () => {
    const vault = open()
    Effect.runSync(
      vault.moveToTrash(
        Effect.runSync(vault.createNote("inbox", "Gone", "sub")).path,
      ),
    )
    writeFileSync(join(vault.root, "trash/unknown.bin"), "keep")
    mkdirSync(join(vault.root, "trash/.ignored"))
    writeFileSync(join(vault.root, "trash/.ignored/private.md"), "keep")
    expect(() => Effect.runSync(vault.emptyTrash({ confirm: false }))).toThrow()
    expect(
      Effect.runSync(vault.emptyTrash({ confirm: true })).deleted,
    ).toHaveLength(1)
    expect(readFileSync(join(vault.root, "trash/unknown.bin"), "utf8")).toBe(
      "keep",
    )
    expect(existsSync(join(vault.root, "trash/.ignored/private.md"))).toBe(true)
  })
  test("asset effects defer file access and report typed failures", () => {
    const vault = open()
    const path = join(vault.root, "assets/deferred.bin")
    const create = vault.createAsset("deferred.bin", Uint8Array.of(0, 255))
    expect(existsSync(path)).toBe(false)
    const asset = Effect.runSync(create)
    expect(readFileSync(path)).toEqual(Buffer.from([0, 255]))

    const read = vault.readAsset(asset.path)
    writeFileSync(path, Uint8Array.of(1, 254))
    expect(Effect.runSync(read)).toEqual(Uint8Array.of(1, 254))

    const failure = Effect.runSync(
      vault
        .writeAsset(asset.path, Uint8Array.of(2), { expectedHash: asset.hash })
        .pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => undefined,
          }),
        ),
    )

    expect(failure).toBeInstanceOf(VaultAssetError)
    expect(failure?._tag).toBe("VaultAssetError")
    expect(failure?.message).toMatch(/conflict/i)
    expect(readFileSync(path)).toEqual(Buffer.from([1, 254]))
  })
  test("every asset effect observes a closed vault at execution", () => {
    const directory = root()
    const vault = open(directory)
    const source = join(root(), "source.bin")
    writeFileSync(source, Uint8Array.of(8))

    const asset = Effect.runSync(
      vault.createAsset("live.bin", Uint8Array.of(1)),
    )

    const discarded = Effect.runSync(
      vault.createAsset("deleted.bin", Uint8Array.of(2)),
    )

    const deleted = Effect.runSync(vault.deleteAsset(discarded.path))

    const operations: readonly Effect.Effect<unknown, VaultAssetError>[] = [
      vault.listAssets(),
      vault.readAsset(asset.path),
      vault.readAssetText(asset.path),
      vault.createAsset("new.bin", Uint8Array.of(3)),
      vault.importAsset(source),
      vault.writeAsset(asset.path, Uint8Array.of(4), {
        expectedHash: asset.hash,
      }),
      vault.renameAsset(asset.path, "renamed.bin"),
      vault.moveAsset(asset.path, "assets/nested"),
      vault.duplicateAsset(asset.path),
      vault.deleteAsset(asset.path),
      vault.listDeletedAssets(),
      vault.restoreDeletedAsset(deleted.undoToken),
      vault.purgeDeletedAsset(deleted.undoToken, { confirm: true }),
      vault.emptyDeletedAssets({ confirm: true }),
    ]

    vault.close()

    for (const operation of operations) {
      const failure = Effect.runSync(
        operation.pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => undefined,
          }),
        ),
      )

      expect(failure).toBeInstanceOf(VaultAssetError)
      expect(failure?.message).toMatch(/closed/i)
    }

    const reopened = open(directory)
    expect(Effect.runSync(reopened.readAsset(asset.path))).toEqual(
      Uint8Array.of(1),
    )
    expect(Effect.runSync(reopened.listDeletedAssets())).toEqual([deleted])
    expect(Effect.runSync(reopened.listAssets())).toHaveLength(1)
  })
  test("attachments support binary import, text limits, moves, restore metadata and guarded purge", () => {
    const directory = root()
    const source = join(root(), "résumé.txt")
    writeFileSync(source, "日本語\n")
    let vault = open(directory)
    let asset = Effect.runSync(vault.importAsset(source))
    expect(asset.path).toBe("assets/résumé.txt")
    expect(existsSync(source)).toBe(true)
    expect(Effect.runSync(vault.readAssetText(asset.path, 64))).toBe("日本語\n")
    expect(() => Effect.runSync(vault.readAssetText(asset.path, 2))).toThrow(
      /limit/i,
    )
    asset = Effect.runSync(
      vault.writeAsset(asset.path, new TextEncoder().encode("updated"), {
        expectedHash: asset.hash,
      }),
    )
    asset = Effect.runSync(vault.renameAsset(asset.path, "new.txt"))
    asset = Effect.runSync(vault.moveAsset(asset.path, "assets/deep"))
    expect(Effect.runSync(vault.duplicateAsset(asset.path)).path).toBe(
      "assets/deep/new copy.txt",
    )
    const deleted = Effect.runSync(vault.deleteAsset(asset.path))
    vault.close()
    vault = open(directory)
    expect(Effect.runSync(vault.listDeletedAssets())).toEqual([deleted])
    expect(
      Effect.runSync(vault.restoreDeletedAsset(deleted.undoToken)).path,
    ).toBe("assets/deep/new.txt")

    const binary = Effect.runSync(
      vault.createAsset("image.png", Uint8Array.from([255, 0, 1])),
    )

    expect(Effect.runSync(vault.readAsset(binary.path))).toEqual(
      Uint8Array.from([255, 0, 1]),
    )
    expect(() => Effect.runSync(vault.readAssetText(binary.path))).toThrow(
      /UTF-8|text/i,
    )
    const removed = Effect.runSync(vault.deleteAsset(binary.path))
    expect(() =>
      Effect.runSync(
        vault.purgeDeletedAsset(removed.undoToken, { confirm: false }),
      ),
    ).toThrow()
    Effect.runSync(
      vault.purgeDeletedAsset(removed.undoToken, { confirm: true }),
    )
    expect(Effect.runSync(vault.listAssets())).toHaveLength(2)
    expect(
      Effect.runSync(vault.emptyDeletedAssets({ confirm: true })).deleted,
    ).toEqual([])
  })
  test("collisions never overwrite or follow dangling links", () => {
    const vault = open()
    const a = Effect.runSync(vault.createNote("inbox", "Same", "", "one"))
    const b = Effect.runSync(vault.createNote("inbox", "Same", "", "two"))
    expect(b.path).toBe("inbox/Same 2.md")
    expect(() => Effect.runSync(vault.renameNote(b.path, "Same"))).toThrow(
      /exist|collision/i,
    )
    symlinkSync(join(root(), "missing"), join(vault.root, "inbox/Dangling.md"))
    expect(Effect.runSync(vault.createNote("inbox", "Dangling")).path).toBe(
      "inbox/Dangling 2.md",
    )
    expect(Effect.runSync(vault.readNote(a.path)).body).toBe("one")
    expect(
      Effect.runSync(vault.createAsset("data.bin", Uint8Array.of(1))).path,
    ).toBe("assets/data.bin")
    expect(
      Effect.runSync(vault.createAsset("data.bin", Uint8Array.of(2))).path,
    ).toBe("assets/data 2.bin")
  })

  for (const value of [
    "../escape",
    "/absolute",
    "a/../b",
    "a//b",
    "a\\b",
    ".hidden",
    "a/.hidden",
    "a\u0000b",
    "C:escape",
    "a/.",
    "a ",
    "a/%2f",
  ]) {
    test(`rejects unsafe path ${JSON.stringify(value)}`, () => {
      const vault = open()
      expect(() => Effect.runSync(vault.createFolder("inbox", value))).toThrow()
      expect(() => Effect.runSync(vault.readNote(value))).toThrow()
      expect(() =>
        Effect.runSync(vault.createAsset(value, Uint8Array.of(1))),
      ).toThrow()
    })
  }

  test("symlink files, parents, sidecars and root replacements cannot redirect access", () => {
    const directory = root()
    const outside = root()
    writeFileSync(join(outside, "outside.md"), "safe")
    const vault = open(directory)
    symlinkSync(outside, join(directory, "inbox/link"))
    symlinkSync(join(outside, "outside.md"), join(directory, "inbox/link.md"))
    expect(() => Effect.runSync(vault.readNote("inbox/link.md"))).toThrow(
      /symlink/i,
    )
    expect(() =>
      Effect.runSync(vault.createNote("inbox", "outside", "link")),
    ).toThrow(/symlink/i)
    expect(Effect.runSync(vault.listNotes())).toEqual([])
    expect(() =>
      Effect.runSync(vault.duplicateFolder("inbox", "link")),
    ).toThrow()
    vault.close()
    rmSync(join(directory, ".still-notes"), { recursive: true })
    symlinkSync(outside, join(directory, ".still-notes"))
    expect(() => open(directory)).toThrow(/symlink/i)
    expect(readFileSync(join(outside, "outside.md"), "utf8")).toBe("safe")
  })
  test("bounded reads reject malformed UTF8 and binary text without changing files", () => {
    const vault = open()
    writeFileSync(join(vault.root, "inbox/bad.md"), Uint8Array.of(255))
    expect(() => Effect.runSync(vault.readNote("inbox/bad.md"))).toThrow(
      /UTF-8/i,
    )
    writeFileSync(
      join(vault.root, "inbox/large.md"),
      "x".repeat(2 * 1024 * 1024 + 1),
    )
    expect(() => Effect.runSync(vault.readNote("inbox/large.md"))).toThrow(
      /limit/i,
    )
    expect(() =>
      Effect.runSync(vault.createNote("inbox", "Bad", "", "\u0000")),
    ).toThrow(/text/i)
  })
  test("malformed metadata fails closed, remains untouched, and releases failed-open lock", () => {
    const directory = root()
    const vault = open(directory)
    Effect.runSync(vault.createNote("inbox", "Keep", "", "payload"))
    vault.close()
    writeFileSync(join(directory, ".still-notes/state.json"), "broken")
    expect(() => open(directory)).toThrow(/metadata/i)
    expect(
      readFileSync(join(directory, ".still-notes/state.json"), "utf8"),
    ).toBe("broken")
    expect(readFileSync(join(directory, "inbox/Keep.md"), "utf8")).toBe(
      "payload",
    )
    expect(existsSync(join(directory, ".still-notes/vault.lock"))).toBe(false)
  })
  test("schema-invalid metadata and attachment restore paths never authorize filesystem access", () => {
    const directory = root()
    const vault = open(directory)
    const note = Effect.runSync(vault.createNote("inbox", "Keep", "", "saved"))

    const asset = Effect.runSync(
      vault.createAsset("keep.bin", Uint8Array.of(1, 2)),
    )

    vault.close()

    const valid = {
      version: 1,
      primaryNotesLocation: "inbox",
      notes: {},
      deletedAssets: {},
    }

    const token = "12345678-1234-4234-8234-123456789012"

    const states = [
      { ...valid, version: 2 },
      { ...valid, notes: { [note.path]: { createdAt: -1, pinned: false } } },
      {
        ...valid,
        notes: {
          [note.path]: {
            createdAt: 1,
            pinned: false,
            trashFrom: "../escape.md",
          },
        },
      },
      {
        ...valid,
        deletedAssets: {
          [token]: {
            path: "../escape.bin",
            name: "escape.bin",
            undoToken: token,
            deletedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    ]

    for (const state of states) {
      const bytes = JSON.stringify(state)
      writeFileSync(join(directory, ".still-notes/state.json"), bytes)
      expect(() => open(directory)).toThrow(/metadata/i)
      expect(
        readFileSync(join(directory, ".still-notes/state.json"), "utf8"),
      ).toBe(bytes)
      expect(readFileSync(join(directory, note.path), "utf8")).toBe("saved")
      expect(readFileSync(join(directory, asset.path))).toEqual(
        Buffer.from([1, 2]),
      )
    }
  })
  test("metadata failures before writes preserve original and pending content", () => {
    const vault = open()
    const note = Effect.runSync(vault.createNote("inbox", "Keep", "", "old"))
    writeFileSync(
      join(vault.root, ".still-notes/state.json"),
      "external corruption",
    )
    expect(() =>
      Effect.runSync(
        vault.writeNote(note.path, "draft", { expectedHash: note.hash }),
      ),
    ).toThrow(/metadata|external/i)
    expect(readFileSync(join(vault.root, note.path), "utf8")).toBe("old")
  })
  test("preview refuses pending and malformed journals without recovery or a retained lock", () => {
    const directory = root()
    open(directory).close()
    const notePath = join(directory, "inbox/A.md")
    const journalPath = join(directory, ".still-notes/transaction.json")
    const lockPath = join(directory, ".still-notes/vault.lock")
    const journal = JSON.stringify({
      version: 1,
      files: [{ path: "inbox/A.md", before: "b2xk", after: "bmV3" }],
      directories: [],
    })
    writeFileSync(notePath, "new")

    for (const contents of [journal, "{malformed journal\n"]) {
      writeFileSync(journalPath, contents)
      const failure = Effect.runSync(
        Effect.provide(
          VaultResource,
          VaultResource.layer(directory, { preview: true }),
        ).pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => undefined,
          }),
        ),
      )
      expect(failure).toBeInstanceOf(VaultOpenError)
      expect(failure?.message).toMatch(/journal|recovery/i)
      expect(readFileSync(notePath, "utf8")).toBe("new")
      expect(readFileSync(journalPath, "utf8")).toBe(contents)
      expect(existsSync(lockPath)).toBe(false)
    }

    writeFileSync(journalPath, journal)
    const recovered = open(directory)
    expect(Effect.runSync(recovered.readNote("inbox/A.md")).body).toBe("old")
    expect(existsSync(journalPath)).toBe(false)
  })
  test("preview permits reads but denies every mutation and retains later journals", () => {
    const directory = root()
    const writable = open(directory)
    const note = Effect.runSync(writable.createNote("inbox", "Café", "", "new"))
    Effect.runSync(writable.createFolder("inbox", "Folder"))
    const asset = Effect.runSync(
      writable.createAsset("asset.txt", Buffer.from("asset")),
    )
    const deleted = Effect.runSync(
      writable.deleteAsset(
        Effect.runSync(
          writable.createAsset("deleted.txt", Buffer.from("deleted")),
        ).path,
      ),
    )
    writable.close()
    const metadataPath = join(directory, ".still-notes/state.json")
    const metadata = readFileSync(metadataPath)
    const preview = new Vault(directory, { preview: true })
    vaults.push(preview)
    expect(
      Effect.runSync(preview.listNotes()).map((item) => item.path),
    ).toContain(note.path)
    expect(Effect.runSync(preview.readNote(note.path)).body).toBe("new")
    expect(
      Effect.runSync(preview.listFolders()).map((item) => item.path),
    ).toContain("inbox/Folder")
    expect(
      Effect.runSync(preview.listAssets()).map((item) => item.path),
    ).toContain(asset.path)
    expect(Effect.runSync(preview.readAssetText(asset.path))).toBe("asset")
    expect(Effect.runSync(preview.readAsset(asset.path))).toEqual(
      Buffer.from("asset"),
    )
    expect(
      Effect.runSync(preview.listDeletedAssets()).map((item) => item.undoToken),
    ).toContain(deleted.undoToken)
    const guard = { expectedHash: note.hash }
    const assetGuard = { expectedHash: hash("asset") }
    const noteMutations: readonly Effect.Effect<unknown, VaultNoteError>[] = [
      preview.createNote("inbox", "Added"),
      preview.importNote(join(directory, note.path)),
      preview.writeNote(note.path, "changed", guard),
      preview.appendToNote(note.path, "", "end", guard),
      preview.setPinned(note.path, true),
      preview.renameNote(note.path, "Renamed"),
      preview.moveNote(note.path, "quick"),
      preview.duplicateNote(note.path),
      preview.archiveNote(note.path),
      preview.unarchiveNote(note.path),
      preview.moveToTrash(note.path),
      preview.restoreFromTrash(note.path),
      preview.deleteNote(note.path, { confirm: true }),
      preview.emptyTrash({ confirm: true }),
    ]
    const folderMutations: readonly Effect.Effect<unknown, VaultFolderError>[] =
      [
        preview.createFolder("inbox", "Added"),
        preview.renameFolder("inbox", "Folder", "Folder"),
        preview.duplicateFolder("inbox", "Folder"),
        preview.deleteFolder("inbox", "Folder", { confirm: true }),
      ]
    const assetMutations: readonly Effect.Effect<unknown, VaultAssetError>[] = [
      preview.createAsset("added.txt", Buffer.from("added")),
      preview.importAsset(join(directory, asset.path)),
      preview.writeAsset(asset.path, Buffer.from("changed"), assetGuard),
      preview.renameAsset(asset.path, "asset.txt"),
      preview.moveAsset(asset.path, "assets"),
      preview.duplicateAsset(asset.path),
      preview.deleteAsset(asset.path),
      preview.restoreDeletedAsset(deleted.undoToken),
      preview.purgeDeletedAsset(deleted.undoToken, { confirm: true }),
      preview.emptyDeletedAssets({ confirm: true }),
    ]
    for (const mutation of noteMutations) {
      const failure = Effect.runSync(Effect.flip(mutation))
      expect(failure).toBeInstanceOf(VaultNoteError)
      expect(failure.message).toMatch(/preview|read.only/i)
    }
    for (const mutation of folderMutations) {
      const failure = Effect.runSync(Effect.flip(mutation))
      expect(failure).toBeInstanceOf(VaultFolderError)
      expect(failure.message).toMatch(/preview|read.only/i)
    }
    for (const mutation of assetMutations) {
      const failure = Effect.runSync(Effect.flip(mutation))
      expect(failure).toBeInstanceOf(VaultAssetError)
      expect(failure.message).toMatch(/preview|read.only/i)
    }
    expect(readFileSync(join(directory, note.path), "utf8")).toBe("new")
    expect(readFileSync(join(directory, asset.path), "utf8")).toBe("asset")
    expect(readFileSync(metadataPath)).toEqual(metadata)
    expect(existsSync(join(directory, "inbox/Added.md"))).toBe(false)
    expect(existsSync(join(directory, "inbox/Folder"))).toBe(true)
    expect(existsSync(join(directory, "assets/added.txt"))).toBe(false)
    const journalPath = join(directory, ".still-notes/transaction.json")
    const journal = JSON.stringify({
      version: 1,
      files: [{ path: note.path, before: "b2xk", after: "bmV3" }],
      directories: [],
    })
    writeFileSync(journalPath, journal)
    const failure = Effect.runSync(
      Effect.flip(preview.writeNote(note.path, "changed", guard)),
    )
    expect(failure).toBeInstanceOf(VaultNoteError)
    expect(failure.message).toMatch(/preview|read.only/i)
    expect(readFileSync(join(directory, note.path), "utf8")).toBe("new")
    expect(readFileSync(journalPath, "utf8")).toBe(journal)
    preview.close()
    expect(existsSync(join(directory, ".still-notes/vault.lock"))).toBe(false)
    expect(readFileSync(journalPath, "utf8")).toBe(journal)
  })
  test("interrupted journal rolls back on restart, leaving unrelated temporary files untouched", () => {
    const directory = root()
    const vault = open(directory)

    const note = Effect.runSync(
      vault.createNote("inbox", "Interrupted", "", "before"),
    )

    vault.close()

    const entry = {
      path: note.path,
      before: Buffer.from("before").toString("base64"),
      after: Buffer.from("after").toString("base64"),
    }

    writeFileSync(
      join(directory, ".still-notes/transaction.json"),
      JSON.stringify({ version: 1, files: [entry], directories: [] }),
    )
    writeFileSync(join(directory, note.path), "after")
    writeFileSync(join(directory, "inbox/.unknown.tmp"), "leave")
    const reopened = open(directory)
    expect(Effect.runSync(reopened.readNote(note.path)).body).toBe("before")
    expect(readFileSync(join(directory, "inbox/.unknown.tmp"), "utf8")).toBe(
      "leave",
    )
    expect(existsSync(join(directory, ".still-notes/transaction.json"))).toBe(
      false,
    )
  })
  test("recovery conflict and malformed journal preserve all evidence", () => {
    const directory = root()
    open(directory).close()
    writeFileSync(join(directory, "inbox/A.md"), "third party")

    const journal = JSON.stringify({
      version: 1,
      files: [
        {
          path: "inbox/A.md",
          before: Buffer.from("old").toString("base64"),
          after: Buffer.from("new").toString("base64"),
        },
      ],
      directories: [],
    })

    writeFileSync(join(directory, ".still-notes/transaction.json"), journal)
    expect(() => open(directory)).toThrow(/recovery|conflict/i)
    expect(readFileSync(join(directory, "inbox/A.md"), "utf8")).toBe(
      "third party",
    )
    expect(
      readFileSync(join(directory, ".still-notes/transaction.json"), "utf8"),
    ).toBe(journal)
    writeFileSync(join(directory, ".still-notes/transaction.json"), "bad")
    expect(() => open(directory)).toThrow(/journal|recovery/i)
  })
  test("attachment restore collisions and unknown token files retain independent bytes", () => {
    const vault = open()

    const asset = Effect.runSync(
      vault.createAsset("restore.txt", Buffer.from("old")),
    )

    expect(() =>
      Effect.runSync(
        vault.writeAsset(asset.path, Buffer.from("draft"), {
          expectedHash: hash("wrong"),
        }),
      ),
    ).toThrow(/conflict/i)
    const deleted = Effect.runSync(vault.deleteAsset(asset.path))
    Effect.runSync(vault.createAsset("restore.txt", Buffer.from("new")))

    const unknown = join(
      vault.root,
      ".still-notes/deleted-assets",
      deleted.undoToken,
      "unknown.bin",
    )

    writeFileSync(unknown, "preserve")

    const restored = Effect.runSync(
      vault.restoreDeletedAsset(deleted.undoToken),
    )

    expect(restored.path).toBe("assets/restore 2.txt")
    expect(Effect.runSync(vault.readAssetText(restored.path))).toBe("old")
    expect(Effect.runSync(vault.readAssetText(asset.path))).toBe("new")
    expect(readFileSync(unknown, "utf8")).toBe("preserve")
    expect(() =>
      Effect.runSync(vault.restoreDeletedAsset("../escape")),
    ).toThrow()
    const next = Effect.runSync(vault.deleteAsset(restored.path))
    expect(
      Effect.runSync(vault.emptyDeletedAssets({ confirm: true })).deleted,
    ).toEqual([next.undoToken])
    expect(readFileSync(unknown, "utf8")).toBe("preserve")
  })
  test("same-process and child-process locks exclude writers; close blocks writes", () => {
    const directory = root()
    const vault = open(directory)
    expect(() => open(directory)).toThrow(/lock/i)

    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `import { Vault } from ${JSON.stringify(resolve("src/features/vault/service.ts"))}; new Vault(${JSON.stringify(directory)});`,
      ],
      { cwd: resolve(".") },
    )

    expect(child.status).not.toBe(0)
    expect(child.stderr.toString()).toMatch(/lock/i)
    vault.close()
    expect(() => Effect.runSync(vault.createNote("inbox", "Closed"))).toThrow(
      /closed/i,
    )
    expect(
      Effect.runSync(open(directory).createNote("inbox", "Open")).hash,
    ).toBe(hash("# Open\n\n"))
  })
  test("failed move rolls back published target without touching unchanged read-only source", () => {
    const vault = open()

    const note = Effect.runSync(
      vault.createNote("inbox", "Protected", "locked", "original"),
    )

    const directory = join(vault.root, "inbox/locked")
    chmodSync(directory, 0o500)

    try {
      expect(() => Effect.runSync(vault.moveNote(note.path, "quick"))).toThrow()
      expect(readFileSync(join(vault.root, note.path), "utf8")).toBe("original")
      expect(existsSync(join(vault.root, "quick/Protected.md"))).toBe(false)
      expect(
        existsSync(join(vault.root, ".still-notes/transaction.json")),
      ).toBe(false)
    } finally {
      chmodSync(directory, 0o700)
    }

    expect(Effect.runSync(vault.moveNote(note.path, "quick")).body).toBe(
      "original",
    )
  })
  test("crashed child lock recovers on restart without losing committed Markdown", () => {
    const directory = root()

    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `import { Effect } from "effect"; import { Vault } from ${JSON.stringify(resolve("src/features/vault/service.ts"))}; const vault = new Vault(${JSON.stringify(directory)}); Effect.runSync(vault.createNote("quick", "Crash", "", "committed")); process.kill(process.pid, "SIGKILL");`,
      ],
      { cwd: resolve(".") },
    )

    expect(child.signal).toBe("SIGKILL")
    expect(existsSync(join(directory, ".still-notes/vault.lock"))).toBe(true)
    const vault = open(directory)
    expect(Effect.runSync(vault.readNote("quick/Crash.md")).body).toBe(
      "committed",
    )
    expect(Effect.runSync(vault.createNote("inbox", "After crash")).path).toBe(
      "inbox/After crash.md",
    )
  })
  test("process interruption during atomic writes recovers complete bytes and metadata", async () => {
    const directory = root()

    const child = spawn(
      process.execPath,
      [
        "-e",
        `import { Effect } from "effect"; import { Vault } from ${JSON.stringify(resolve("src/features/vault/service.ts"))}; const vault = new Vault(${JSON.stringify(directory)}); let note = Effect.runSync(vault.createNote("inbox", "Interrupted", "", "stable")); process.stdout.write("ready"); for (let revision = 0; revision < 200; revision++) note = Effect.runSync(vault.writeNote(note.path, "revision:" + revision + "\\n" + "x".repeat(1024 * 1024), { expectedHash: note.hash })); vault.close();`,
      ],
      { cwd: resolve("."), stdio: ["ignore", "pipe", "pipe"] },
    )

    const exited = once(child, "exit")

    try {
      if (!child.stdout) throw new Error("Child stdout is required")
      await once(child.stdout, "data")
      const deadline = Date.now() + 5000

      while (
        !existsSync(join(directory, ".still-notes/transaction.json")) &&
        Date.now() < deadline
      )
        await new Promise((done) => setTimeout(done, 1))
      expect(existsSync(join(directory, ".still-notes/transaction.json"))).toBe(
        true,
      )
      child.kill("SIGKILL")
      await exited
      const vault = open(directory)
      const note = Effect.runSync(vault.readNote("inbox/Interrupted.md"))
      expect(
        note.body === "stable" || /^revision:\d+\nx+$/.test(note.body),
      ).toBe(true)
      expect(
        note.body === "stable"
          ? note.size === 6
          : note.body.split("\n")[1]?.length === 1024 * 1024,
      ).toBe(true)
      expect(note.hash).toBe(hash(note.body))
      expect(existsSync(join(directory, ".still-notes/transaction.json"))).toBe(
        false,
      )
      expect(
        Effect.runSync(
          vault.writeNote(note.path, "recovered", { expectedHash: note.hash }),
        ).body,
      ).toBe("recovered")
    } finally {
      child.kill("SIGKILL")
      await exited
    }
  }, 15000)
  test("root replacement and unknown lock fail closed", () => {
    const directory = root()
    const vault = open(directory)
    const held = join(root(), "held")
    renameSync(directory, held)
    symlinkSync(root(), directory)
    expect(() => Effect.runSync(vault.createNote("inbox", "Escape"))).toThrow(
      /symlink|root/i,
    )
    rmSync(directory)
    renameSync(held, directory)
    vault.close()
    writeFileSync(join(directory, ".still-notes/vault.lock"), "unknown owner")
    expect(() => open(directory)).toThrow(/lock/i)
    expect(
      readFileSync(join(directory, ".still-notes/vault.lock"), "utf8"),
    ).toBe("unknown owner")
  })
  test("imports remain non-destructive and guarded writes preserve BOM and CRLF", () => {
    const source = join(root(), "Imported.md")
    const body = "\ufeff# Import\r\n\r\n日本語\r\n"
    writeFileSync(source, body)
    const vault = open()
    const note = Effect.runSync(vault.importNote(source))
    expect(note.body).toBe(body)
    expect(readFileSync(source, "utf8")).toBe(body)
    expect(
      Effect.runSync(
        vault.writeNote(note.path, body + "tail", { expectedHash: note.hash }),
      ).body,
    ).toBe(body + "tail")
    expect(Effect.runSync(vault.importNote(source)).path).toBe(
      "inbox/Imported 2.md",
    )
  })
  test("real watcher receives external writes, nested creates, and unsubscribe stops events", async () => {
    const vault = open()
    const note = Effect.runSync(vault.createNote("inbox", "Watch"))
    const events: string[] = []

    const unsubscribe = vault.subscribe((event) =>
      events.push(event.path ?? "resync"),
    )

    writeFileSync(join(vault.root, note.path), "outside")
    await new Promise((done) => setTimeout(done, 150))
    expect(events.some((path) => path === note.path || path === "resync")).toBe(
      true,
    )
    mkdirSync(join(vault.root, "inbox/new"))
    await new Promise((done) => setTimeout(done, 100))
    writeFileSync(join(vault.root, "inbox/new/Child.md"), "nested")
    await new Promise((done) => setTimeout(done, 150))
    expect(
      events.some((path) => path.includes("new") || path === "resync"),
    ).toBe(true)
    unsubscribe()
    const count = events.length
    writeFileSync(join(vault.root, note.path), "stopped")
    await new Promise((done) => setTimeout(done, 100))
    expect(events).toHaveLength(count)
    expect(readdirSync(join(vault.root, ".still-notes"))).not.toContain(
      "transaction.json",
    )
  })
})
