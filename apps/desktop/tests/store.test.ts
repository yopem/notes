import { defaultDataDirectory } from "@still-notes/env/server"
import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { NotesError } from "@/features/notes/errors"
import { Notes, NotesStore } from "@/features/notes/store"

import { readDataDirectory, writeDataDirectory } from "./env"

/*
 * Storage isolation is required: fault tests must not touch user notes.
 * Prerequisites: Bun and a writable OS temporary directory. No mocks are used.
 * Cases defined before implementation:
 * - Fresh data has an explicit example, private files, and a selected welcome note.
 * - CRUD, selection, theme, and notebook changes survive restart.
 * - Snapshots have stable identity and cannot be changed outside the store.
 * - Subscriptions notify after durable writes; unsubscribe and close are safe.
 * - Unknown IDs, blank names, invalid references, and invalid runtime input fail.
 * - Pin, trash, restore, and guarded permanent deletion preserve valid selection.
 * - Search stays in the UI; no search API belongs in this store.
 * - Markdown preserves Unicode and bytes; safe names never overwrite files.
 * - Batch imports commit once or not at all, including failed disk writes.
 * - Imports reject directories, non-Markdown, binary, invalid UTF-8, and UTF-16.
 * - Note bodies and the complete JSON file have byte limits.
 * - Invalid JSON, schemas, versions, dates, IDs, references, and symlinks remain intact.
 * - Backup files preserve previous data; recovery requires an explicit user action.
 * - Failed commits preserve snapshot identity, selection, and notifications.
 * - Same-process and child-process locks block writers; dead owners can recover.
 * - Invalid locks are not removed; failed opens release only their own lock.
 * - Default paths honor the explicit data directory override.
 */

const roots: string[] = []

const stores: NotesStore[] = []

const bodyLimit = 2 * 1024 * 1024

const fileLimit = 32 * 1024 * 1024

function directory() {
  const root = mkdtempSync(join(tmpdir(), "still-notes-store-"))
  roots.push(root)

  return root
}

function open(root = directory()) {
  const store = new NotesStore(root)
  stores.push(store)

  return store
}

function primary(root: string) {
  return join(root, "workspace.json")
}

function backup(root: string) {
  return join(root, "workspace.json.bak")
}

function fixture() {
  return {
    version: 1,
    notebooks: [{ id: "personal", name: "Personal" }],
    notes: [
      {
        id: "welcome",
        notebookId: "personal",
        title: "Welcome example",
        body: "Example only",
        pinned: false,
        trashedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    theme: "light",
    selectedNoteId: "welcome",
  }
}

function runChild(code: string) {
  return Bun.spawnSync({
    cmd: [
      process.execPath,
      "--eval",
      `import { Effect } from "effect"; import { NotesStore } from "@/features/notes/store"; ${code}`,
    ],
    cwd: resolve(import.meta.dir, ".."),
  })
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()

  for (const root of roots.splice(0)) {
    chmodSync(root, 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})

describe("NotesStore real disk integration", () => {
  test("operations defer validation, memory changes, and file access until execution", () => {
    const root = directory()
    const store = open(root)
    const note = Effect.runSync(store.createNote())
    const before = store.getSnapshot()
    const bytes = readFileSync(primary(root))
    const output = join(root, "not-created")
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })

    const operations = [
      store.createNotebook("Deferred"),
      store.renameNotebook(note.notebookId, "Renamed"),
      store.createNote(),
      store.duplicateNote(note.id),
      store.updateNote(note.id, { body: "Deferred" }),
      store.togglePin(note.id),
      store.trashNote(note.id),
      store.restoreNote(note.id),
      store.deleteNote(note.id),
      store.selectNote(null),
      store.setTheme("dark"),
      store.importMarkdown([join(root, "missing.md")]),
      store.exportMarkdown(note.id, output),
    ]

    expect(operations.every(Effect.isEffect)).toBe(true)
    expect(store.getSnapshot()).toBe(before)
    expect(readFileSync(primary(root))).toEqual(bytes)
    expect(existsSync(output)).toBe(false)
    expect(notifications).toBe(0)

    store.close()

    for (const operation of operations) {
      const error = Effect.runSync(Effect.flip(operation))
      expect(error).toBeInstanceOf(NotesError)
      expect(error._tag).toBe("NotesError")
      expect(error.message).toMatch(/closed/i)
      expect(error.cause).toBeInstanceOf(Error)
    }
  })

  test("the Notes layer defers acquisition and releases its lock on success", () => {
    const root = directory()
    const layer = Notes.layer(root)
    expect(existsSync(primary(root))).toBe(false)

    const snapshot = Effect.runSync(
      Effect.gen(function* () {
        const store = yield* Notes
        expect(existsSync(join(root, ".store.lock"))).toBe(true)
        yield* store.createNotebook("Scoped")

        return store.getSnapshot()
      }).pipe(Effect.provide(layer)),
    )

    expect(existsSync(join(root, ".store.lock"))).toBe(false)
    expect(open(root).getSnapshot()).toEqual(snapshot)
  })

  test("the Notes layer releases its lock on failure and types acquisition errors", () => {
    const root = directory()

    const error = Effect.runSync(
      Effect.gen(function* () {
        const store = yield* Notes
        yield* store.createNote("missing")
      }).pipe(Effect.provide(Notes.layer(root)), Effect.flip),
    )

    expect(error).toBeInstanceOf(NotesError)
    expect(error.operation).toBe("createNote")
    expect(existsSync(join(root, ".store.lock"))).toBe(false)
    const store = open(root)

    const acquisitionError = Effect.runSync(
      Effect.flip(Effect.provide(Notes, Notes.layer(root))),
    )

    expect(acquisitionError).toBeInstanceOf(NotesError)
    expect(acquisitionError.operation).toBe("open")
    expect(acquisitionError.message).toMatch(/lock/i)
    expect(() => Effect.runSync(store.createNote())).not.toThrow()
  })

  test("the Notes layer reports lock cleanup failures instead of hiding them", () => {
    const root = directory()
    const lock = join(root, ".store.lock")

    const exit = Effect.runSyncExit(
      Effect.gen(function* () {
        yield* Notes
        rmSync(lock)
        mkdirSync(lock)
      }).pipe(Effect.provide(Notes.layer(root))),
    )

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const defects = exit.cause.reasons.filter(Cause.isDieReason)
      expect(defects).toHaveLength(1)
      expect(defects[0]?.defect).toBeInstanceOf(NotesError)
    }

    expect(lstatSync(lock).isDirectory()).toBe(true)
  })

  test("fresh workspace contains a selected example and restrictive permissions", () => {
    const root = directory()
    const store = open(root)
    const snapshot = store.getSnapshot()
    expect(snapshot.version).toBe(1)
    expect(snapshot.notebooks).toHaveLength(1)
    expect(snapshot.notebooks[0]?.name).toBe("Personal")
    expect(snapshot.notes).toHaveLength(1)
    expect(snapshot.notes[0]?.body.toLowerCase()).toContain("example")
    expect(snapshot.selectedNoteId).toBe(snapshot.notes[0]?.id ?? "missing")
    expect(snapshot.notes[0]?.notebookId).toBe(
      snapshot.notebooks[0]?.id ?? "missing",
    )
    expect(store.getSnapshot()).toBe(snapshot)
    expect("search" in store).toBe(false)

    if (process.platform !== "win32") {
      expect(lstatSync(root).mode & 0o777).toBe(0o700)
      expect(lstatSync(primary(root)).mode & 0o777).toBe(0o600)
      expect(lstatSync(join(root, ".store.lock")).mode & 0o777).toBe(0o600)
    }
  })

  test("CRUD, notebook moves, selection, and theme survive restart", () => {
    const root = directory()
    const store = open(root)
    const notebook = Effect.runSync(store.createNotebook(" Work "))
    expect(notebook.name).toBe("Work")
    Effect.runSync(store.renameNotebook(notebook.id, "Projects"))
    const note = Effect.runSync(store.createNote())
    const createdAt = note.createdAt
    Effect.runSync(
      store.updateNote(note.id, {
        title: "Plan",
        body: "Keep my edits",
        notebookId: notebook.id,
      }),
    )
    Effect.runSync(store.selectNote(note.id))
    Effect.runSync(store.setTheme("dark"))
    const saved = store.getSnapshot()
    expect(saved.notes.find((item) => item.id === note.id)).toMatchObject({
      title: "Plan",
      body: "Keep my edits",
      notebookId: notebook.id,
      createdAt,
    })
    store.close()
    const restarted = open(root)
    expect(restarted.getSnapshot()).toEqual(saved)
    expect(
      restarted.getSnapshot().notebooks.find((item) => item.id === notebook.id)
        ?.name,
    ).toBe("Projects")
  })

  test("duplicates a non-selected note with fresh fields and persists it", () => {
    const root = directory()
    writeFileSync(primary(root), JSON.stringify(fixture()))
    const store = open(root)
    const source = store.getSnapshot().notes[0]
    expect(source).toBeDefined()
    if (!source) throw new Error("Missing source")
    Effect.runSync(store.togglePin(source.id))
    Effect.runSync(store.selectNote(null))
    const before = store.getSnapshot()
    const original = before.notes[0]
    const copy = Effect.runSync(store.duplicateNote(source.id))
    expect(copy.id).not.toBe(source.id)
    expect(copy).toMatchObject({
      notebookId: source.notebookId,
      title: "Welcome example copy",
      body: source.body,
      pinned: false,
      trashedAt: null,
    })
    expect(copy.createdAt).toBe(copy.updatedAt)
    expect(Date.parse(copy.createdAt)).toBeGreaterThan(Date.parse(source.createdAt))
    expect(Object.isFrozen(copy)).toBe(true)
    expect(store.getSnapshot().selectedNoteId).toBe(copy.id)
    expect(store.getSnapshot().notes[0]).toEqual(original)
    Effect.runSync(store.updateNote(copy.id, { body: "Copy only" }))
    expect(store.getSnapshot().notes[0]).toEqual(original)
    const saved = store.getSnapshot()
    store.close()
    expect(open(root).getSnapshot()).toEqual(saved)
  })

  test("duplicate names are exact, case-sensitive, notebook-scoped, and include trash", () => {
    const store = open()
    const source = Effect.runSync(store.createNote())
    Effect.runSync(store.updateNote(source.id, { title: "Café e\u0301 🌱" }))
    const first = Effect.runSync(store.duplicateNote(source.id))
    expect(first.title).toBe("Café e\u0301 🌱 copy")
    Effect.runSync(store.trashNote(first.id))
    const second = Effect.runSync(store.duplicateNote(source.id))
    expect(second.title).toBe("Café e\u0301 🌱 copy 2")
    const other = Effect.runSync(store.createNotebook("Other"))
    const otherSource = Effect.runSync(store.createNote(other.id))
    Effect.runSync(store.updateNote(otherSource.id, { title: "Café e\u0301 🌱" }))
    expect(Effect.runSync(store.duplicateNote(otherSource.id)).title).toBe(
      "Café e\u0301 🌱 copy",
    )
    Effect.runSync(store.updateNote(source.id, { title: "café e\u0301 🌱" }))
    expect(Effect.runSync(store.duplicateNote(source.id)).title).toBe(
      "café e\u0301 🌱 copy",
    )
    Effect.runSync(store.updateNote(source.id, { title: "  \t" }))
    expect(Effect.runSync(store.duplicateNote(source.id)).title).toBe(
      "Untitled note copy",
    )
    expect(Effect.runSync(store.duplicateNote(source.id)).title).toBe(
      "Untitled note copy 2",
    )
  })

  test("duplicate applies a validated draft without changing the source", () => {
    const root = directory()
    const store = open(root)
    const source = Effect.runSync(store.createNote())
    Effect.runSync(store.updateNote(source.id, { title: "Saved", body: "Saved body" }))
    const original = store.getSnapshot().notes.find((note) => note.id === source.id)
    const draft = { title: "Draft Ω", body: "Unsaved café 日本語\n" }
    const copy = Effect.runSync(store.duplicateNote(source.id, draft))
    expect(copy.title).toBe("Draft Ω copy")
    expect(copy.body).toBe(draft.body)
    expect(draft).toEqual({ title: "Draft Ω", body: "Unsaved café 日本語\n" })
    expect(store.getSnapshot().notes.find((note) => note.id === source.id)).toEqual(original)
    expect(Effect.runSync(store.duplicateNote(source.id, { body: "partial" })).title).toBe(
      "Saved copy",
    )
    const exact = "é".repeat(bodyLimit / 2)
    expect(Effect.runSync(store.duplicateNote(source.id, { body: exact })).body).toBe(exact)
    const snapshot = store.getSnapshot()
    const bytes = readFileSync(primary(root))
    const error = Effect.runSync(
      Effect.flip(store.duplicateNote(source.id, { body: "é".repeat(bodyLimit / 2 + 1) })),
    )
    expect(error).toBeInstanceOf(NotesError)
    expect(error.operation).toBe("duplicateNote")
    expect(store.getSnapshot()).toBe(snapshot)
    expect(readFileSync(primary(root))).toEqual(bytes)
  })

  test("duplicate rejects missing and trashed notes without changing state", () => {
    const root = directory()
    const store = open(root)
    const source = Effect.runSync(store.createNote())
    Effect.runSync(store.trashNote(source.id))
    const snapshot = store.getSnapshot()
    const bytes = readFileSync(primary(root))
    for (const id of [source.id, "missing", ""]) {
      const error = Effect.runSync(Effect.flip(store.duplicateNote(id)))
      expect(error).toBeInstanceOf(NotesError)
      expect(error.operation).toBe("duplicateNote")
      expect(store.getSnapshot()).toBe(snapshot)
      expect(readFileSync(primary(root))).toEqual(bytes)
    }
  })

  test("duplicate failures preserve memory, disk, selection, and notifications", () => {
    const root = directory()
    const store = open(root)
    const source = Effect.runSync(store.createNote())
    const before = store.getSnapshot()
    const bytes = readFileSync(primary(root))
    let notifications = 0
    store.subscribe(() => { notifications += 1 })
    mkdirSync(backup(root))
    writeFileSync(join(backup(root), "block"), "do not replace")
    const draft = { title: "Unsaved", body: "Draft Ω" }
    expect(Effect.runSync(Effect.flip(store.duplicateNote(source.id, draft))).operation).toBe("duplicateNote")
    expect(store.getSnapshot()).toBe(before)
    expect(readFileSync(primary(root))).toEqual(bytes)
    expect(notifications).toBe(0)
    rmSync(backup(root), { recursive: true })
    const external = bytes.toString() + " "
    writeFileSync(primary(root), external)
    expect(Effect.runSync(Effect.flip(store.duplicateNote(source.id, draft))).message).toMatch(/changed/i)
    expect(store.getSnapshot()).toBe(before)
    expect(readFileSync(primary(root), "utf8")).toBe(external)
    expect(notifications).toBe(0)
    expect(draft).toEqual({ title: "Unsaved", body: "Draft Ω" })
  })

  test("snapshots and returned records cannot mutate persisted state", () => {
    const store = open()
    const snapshot = store.getSnapshot()
    const note = Effect.runSync(store.createNote())
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.notes)).toBe(true)
    expect(Object.isFrozen(snapshot.notebooks[0])).toBe(true)
    expect(Object.isFrozen(note)).toBe(true)
    expect(() => {
      Object.assign(note, { body: "lost edit" })
    }).toThrow()
    expect(() => {
      snapshot.notes.pop()
    }).toThrow()
    expect(
      store.getSnapshot().notes.find((item) => item.id === note.id)?.body,
    ).toBe("")
  })

  test("subscriptions observe committed disk state and unsubscribe", () => {
    const root = directory()
    const store = open(root)
    let notifications = 0
    const observed: string[] = []

    const unsubscribe = store.subscribe(() => {
      notifications += 1
      observed.push(readFileSync(primary(root), "utf8"))
    })

    Effect.runSync(store.createNote())
    expect(notifications).toBe(1)
    expect(observed[0]).toBe(
      `${JSON.stringify(store.getSnapshot(), null, 2)}\n`,
    )
    unsubscribe()
    unsubscribe()
    Effect.runSync(store.createNotebook("More"))
    expect(notifications).toBe(1)
    const current = store.getSnapshot()
    Effect.runSync(store.setTheme(current.theme))
    Effect.runSync(store.selectNote(current.selectedNoteId))
    expect(store.getSnapshot()).toBe(current)
  })

  test("notebook references and unknown IDs are rejected without a commit", () => {
    const store = open()
    const note = Effect.runSync(store.createNote())
    const snapshot = store.getSnapshot()

    const actions = [
      () => Effect.runSync(store.createNotebook("  ")),
      () => Effect.runSync(store.renameNotebook("missing", "Name")),
      () => Effect.runSync(store.createNote("missing")),
      () =>
        Effect.runSync(store.updateNote(note.id, { notebookId: "missing" })),
      () => Effect.runSync(store.updateNote("missing", { body: "text" })),
      () => Effect.runSync(store.togglePin("missing")),
      () => Effect.runSync(store.trashNote("missing")),
      () => Effect.runSync(store.restoreNote("missing")),
      () => Effect.runSync(store.deleteNote("missing")),
      () => Effect.runSync(store.selectNote("missing")),
    ]

    for (const action of actions) {
      expect(action).toThrow(Error)
      expect(store.getSnapshot()).toBe(snapshot)
    }
  })

  test("pin, trash, restore, and permanent deletion guard persist", () => {
    const root = directory()
    const store = open(root)
    const note = Effect.runSync(store.createNote())
    expect(() => Effect.runSync(store.deleteNote(note.id))).toThrow(/trash/i)
    Effect.runSync(store.togglePin(note.id))
    expect(
      store.getSnapshot().notes.find((item) => item.id === note.id)?.pinned,
    ).toBe(true)
    Effect.runSync(store.trashNote(note.id))
    expect(
      store.getSnapshot().notes.find((item) => item.id === note.id)?.trashedAt,
    ).toBeString()
    expect(store.getSnapshot().selectedNoteId).toBeNull()
    const trashed = store.getSnapshot()
    Effect.runSync(store.trashNote(note.id))
    expect(store.getSnapshot()).toBe(trashed)
    Effect.runSync(store.restoreNote(note.id))
    expect(
      store.getSnapshot().notes.find((item) => item.id === note.id)?.trashedAt,
    ).toBeNull()
    Effect.runSync(store.selectNote(note.id))
    Effect.runSync(store.trashNote(note.id))
    Effect.runSync(store.selectNote(note.id))
    Effect.runSync(store.deleteNote(note.id))
    expect(store.getSnapshot().selectedNoteId).toBeNull()
    store.close()
    expect(
      open(root)
        .getSnapshot()
        .notes.some((item) => item.id === note.id),
    ).toBe(false)
  })

  test("empty edits and explicit null selection are valid", () => {
    const store = open()
    const note = Effect.runSync(store.createNote())
    Effect.runSync(store.updateNote(note.id, { title: "", body: "" }))
    Effect.runSync(store.selectNote(null))
    expect(store.getSnapshot().selectedNoteId).toBeNull()
    expect(
      store.getSnapshot().notes.find((item) => item.id === note.id)?.title,
    ).toBe("")
  })

  test("Markdown Unicode roundtrip preserves body and commits batch once", () => {
    const root = directory()
    const store = open(root)
    const input = directory()
    const body = "# 日記 🌱\r\n\r\nCafé e\u0301 — مرحبا\n"
    const path = join(input, "日記.markdown")
    writeFileSync(path, body)
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    const notebook = store.getSnapshot().notebooks[0]

    if (!notebook) throw new Error("Missing notebook")

    const imported = Effect.runSync(
      store.importMarkdown([path, path], notebook.id),
    )

    expect(imported).toHaveLength(2)
    expect(notifications).toBe(1)
    expect(imported[0]?.title).toBe("日記")
    const note = imported[0]

    if (!note) throw new Error("Missing imported note")
    expect(note.body).toBe(body)
    const output = Effect.runSync(store.exportMarkdown(note.id, directory()))
    expect(readFileSync(output, "utf8")).toBe(body)
    store.close()
    expect(
      open(root)
        .getSnapshot()
        .notes.find((item) => item.id === note.id)?.body,
    ).toBe(body)
  })

  test("export uses safe, unique filenames and never overwrites", () => {
    const store = open()
    const note = Effect.runSync(store.createNote())
    const output = directory()
    Effect.runSync(
      store.updateNote(note.id, {
        title: "../../CON:<bad>?/\\",
        body: "first",
      }),
    )
    const first = Effect.runSync(store.exportMarkdown(note.id, output))
    Effect.runSync(store.updateNote(note.id, { body: "second" }))
    const second = Effect.runSync(store.exportMarkdown(note.id, output))
    expect(first).not.toBe(second)
    expect(first.startsWith(output + "/")).toBe(true)
    expect(readdirSync(output)).toHaveLength(2)
    expect(readFileSync(first, "utf8")).toBe("first")
    expect(readFileSync(second, "utf8")).toBe("second")

    if (process.platform !== "win32")
      expect(lstatSync(first).mode & 0o777).toBe(0o600)
    Effect.runSync(store.updateNote(note.id, { title: "🌱".repeat(200) }))
    expect(
      existsSync(Effect.runSync(store.exportMarkdown(note.id, output))),
    ).toBe(true)
    Effect.runSync(store.updateNote(note.id, { title: "CON" }))
    expect(Effect.runSync(store.exportMarkdown(note.id, output))).not.toEndWith(
      "/CON.md",
    )
  })

  test("exports an unsaved draft without committing a blocked workspace", () => {
    const root = directory()
    const store = open(root)
    const note = Effect.runSync(store.createNote())
    const snapshot = store.getSnapshot()
    const changedBytes = readFileSync(primary(root), "utf8") + " "
    writeFileSync(primary(root), changedBytes)
    const draft = { title: "Recovery copy", body: "Unsaved café 日本語\n" }

    expect(() => Effect.runSync(store.updateNote(note.id, draft))).toThrow(
      Error,
    )

    const output = directory()
    const first = Effect.runSync(store.exportMarkdown(note.id, output, draft))
    const second = Effect.runSync(store.exportMarkdown(note.id, output, draft))

    expect(readFileSync(first, "utf8")).toBe(draft.body)
    expect(second).not.toBe(first)
    expect(readFileSync(second, "utf8")).toBe(draft.body)
    expect(store.getSnapshot()).toBe(snapshot)
    expect(readFileSync(primary(root), "utf8")).toBe(changedBytes)
  })

  test("rejects an oversized recovery draft before creating export files", () => {
    const store = open()
    const note = Effect.runSync(store.createNote())
    const output = directory()

    expect(() =>
      Effect.runSync(
        store.exportMarkdown(note.id, output, {
          body: "x".repeat(bodyLimit + 1),
        }),
      ),
    ).toThrow(Error)
    expect(readdirSync(output)).toEqual([])
  })

  test("batch import failure leaves disk, snapshot, selection, and notifications unchanged", () => {
    const root = directory()
    const store = open(root)
    const input = directory()
    const valid = join(input, "valid.md")
    writeFileSync(valid, "valid")
    const before = store.getSnapshot()
    const bytes = readFileSync(primary(root))
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    expect(() =>
      Effect.runSync(store.importMarkdown([valid, join(input, "missing.md")])),
    ).toThrow(Error)
    expect(() =>
      Effect.runSync(store.importMarkdown([valid], "missing")),
    ).toThrow(Error)
    expect(store.getSnapshot()).toBe(before)
    expect(readFileSync(primary(root))).toEqual(bytes)
    expect(notifications).toBe(0)
    expect(Effect.runSync(store.importMarkdown([]))).toEqual([])
    expect(store.getSnapshot()).toBe(before)
  })

  for (const [name, bytes] of [
    ["binary.md", Buffer.from([0, 1, 2, 3])],
    ["invalid.md", Buffer.from([0xc3, 0x28])],
    ["utf16.md", Buffer.from([0xff, 0xfe, 0x61, 0])],
    ["utf16-no-bom.md", Buffer.from([0x61, 0, 0x62, 0])],
    ["control.md", Buffer.from([0x1b, 0x5b, 0x41])],
    ["wrong.txt", Buffer.from("Markdown")],
    ["huge.md", Buffer.alloc(bodyLimit + 1, 0x61)],
  ] satisfies [string, Buffer][]) {
    test(`rejects unsafe import ${name}`, () => {
      const store = open()
      const input = join(directory(), name)
      writeFileSync(input, bytes)
      const before = store.getSnapshot()
      expect(() => Effect.runSync(store.importMarkdown([input]))).toThrow(Error)
      expect(store.getSnapshot()).toBe(before)
    })
  }

  test("rejects directories and accepts UTF-8 BOM Markdown", () => {
    const store = open()
    const input = join(directory(), "folder.md")
    mkdirSync(input)
    expect(() => Effect.runSync(store.importMarkdown([input]))).toThrow(Error)
    const bom = join(directory(), "bom.MD")
    writeFileSync(bom, Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41]))
    expect(Effect.runSync(store.importMarkdown([bom]))[0]?.body).toBe("# A")
  })

  test("body byte limit includes multibyte UTF-8 and allows exact boundary", () => {
    const store = open()
    const note = Effect.runSync(store.createNote())
    Effect.runSync(store.updateNote(note.id, { body: "a".repeat(bodyLimit) }))
    const before = store.getSnapshot()
    expect(() =>
      Effect.runSync(
        store.updateNote(note.id, { body: "é".repeat(bodyLimit / 2 + 1) }),
      ),
    ).toThrow(/2.*MB|body.*limit/i)
    expect(store.getSnapshot()).toBe(before)
  })

  test("total JSON byte limit rejects a commit without changing state", () => {
    const root = directory()
    const store = open(root)
    const note = Effect.runSync(store.createNote())
    const before = store.getSnapshot()
    const bytes = readFileSync(primary(root))
    expect(() =>
      Effect.runSync(
        store.updateNote(note.id, { title: "a".repeat(fileLimit) }),
      ),
    ).toThrow(/32.*MB|file.*limit/i)
    expect(store.getSnapshot()).toBe(before)
    expect(readFileSync(primary(root))).toEqual(bytes)
  })

  const malformed = [
    { name: "unsupported version", make: () => ({ ...fixture(), version: 2 }) },
    { name: "missing fields", make: () => ({ version: 1 }) },
    { name: "unknown fields", make: () => ({ ...fixture(), secret: true }) },
    { name: "non-object root", make: () => null },
    {
      name: "duplicate notebook IDs",
      make: () => ({
        ...fixture(),
        notebooks: [fixture().notebooks[0], fixture().notebooks[0]],
      }),
    },
    {
      name: "duplicate note IDs",
      make: () => ({
        ...fixture(),
        notes: [fixture().notes[0], fixture().notes[0]],
      }),
    },
    {
      name: "cross-kind duplicate IDs",
      make: () => ({
        ...fixture(),
        notebooks: [{ id: "welcome", name: "Personal" }],
      }),
    },
    {
      name: "invalid notebook reference",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], notebookId: "missing" }],
      }),
    },
    {
      name: "invalid selection",
      make: () => ({ ...fixture(), selectedNoteId: "missing" }),
    },
    { name: "invalid theme", make: () => ({ ...fixture(), theme: "system" }) },
    {
      name: "invalid timestamp",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], updatedAt: "yesterday" }],
      }),
    },
    {
      name: "invalid trash timestamp",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], trashedAt: false }],
      }),
    },
    {
      name: "invalid body type",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], body: 42 }],
      }),
    },
    {
      name: "invalid pin type",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], pinned: 1 }],
      }),
    },
    { name: "empty notebooks", make: () => ({ ...fixture(), notebooks: [] }) },
    {
      name: "non-array notebooks",
      make: () => ({ ...fixture(), notebooks: {} }),
    },
    { name: "non-array notes", make: () => ({ ...fixture(), notes: {} }) },
    { name: "string version", make: () => ({ ...fixture(), version: "1" }) },
    {
      name: "non-string selection",
      make: () => ({ ...fixture(), selectedNoteId: 42 }),
    },
    {
      name: "blank note ID",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], id: " " }],
      }),
    },
    {
      name: "unknown note fields",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], extra: true }],
      }),
    },
    {
      name: "unknown notebook fields",
      make: () => ({
        ...fixture(),
        notebooks: [{ id: "personal", name: "Personal", extra: true }],
      }),
    },
    {
      name: "non-canonical timestamp",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], updatedAt: "2026-01-01T00:00:00Z" }],
      }),
    },
    {
      name: "impossible timestamp",
      make: () => ({
        ...fixture(),
        notes: [
          { ...fixture().notes[0], updatedAt: "2026-02-30T00:00:00.000Z" },
        ],
      }),
    },
    {
      name: "empty name",
      make: () => ({
        ...fixture(),
        notebooks: [{ id: "personal", name: " " }],
      }),
    },
    {
      name: "oversize body",
      make: () => ({
        ...fixture(),
        notes: [{ ...fixture().notes[0], body: "a".repeat(bodyLimit + 1) }],
      }),
    },
  ]

  for (const { name, make } of malformed) {
    test(`preserves malformed workspace: ${name}`, () => {
      const root = directory()
      const bytes = JSON.stringify(make())
      writeFileSync(primary(root), bytes)
      expect(() => new NotesStore(root)).toThrow(/workspace\.json|recover/i)
      expect(readFileSync(primary(root), "utf8")).toBe(bytes)
      expect(existsSync(join(root, ".store.lock"))).toBe(false)
    })
  }

  test("invalid JSON is preserved and the valid backup is named in the error", () => {
    const root = directory()
    writeFileSync(primary(root), "{broken")
    const previous = JSON.stringify(fixture())
    writeFileSync(backup(root), previous)
    expect(() => new NotesStore(root)).toThrow(/backup|\.bak/i)
    expect(readFileSync(primary(root), "utf8")).toBe("{broken")
    expect(readFileSync(backup(root), "utf8")).toBe(previous)
  })

  test("missing primary with backup requires explicit recovery instead of fresh data", () => {
    const root = directory()
    const bytes = JSON.stringify(fixture())
    writeFileSync(backup(root), bytes)
    expect(() => new NotesStore(root)).toThrow(/recover|backup/i)
    expect(existsSync(primary(root))).toBe(false)
    expect(readFileSync(backup(root), "utf8")).toBe(bytes)
  })

  test("corrupt backup is preserved, not silently overwritten", () => {
    const root = directory()
    writeFileSync(primary(root), JSON.stringify(fixture()))
    writeFileSync(backup(root), "broken backup")
    expect(() => new NotesStore(root)).toThrow(/backup|\.bak/i)
    expect(readFileSync(backup(root), "utf8")).toBe("broken backup")
  })

  test("backup contains the previous complete workspace", () => {
    const root = directory()
    const store = open(root)
    const previous = readFileSync(primary(root))
    Effect.runSync(store.createNotebook("Work"))
    expect(readFileSync(backup(root))).toEqual(previous)

    if (process.platform !== "win32")
      expect(lstatSync(backup(root)).mode & 0o777).toBe(0o600)
    expect(readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false)
  })

  test("failed disk commit and failed batch import roll back memory", () => {
    const root = directory()
    const store = open(root)
    const before = store.getSnapshot()
    const bytes = readFileSync(primary(root))
    mkdirSync(backup(root))
    writeFileSync(join(backup(root), "block"), "do not replace")
    const input = join(directory(), "new.md")
    writeFileSync(input, "new edit")
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    expect(() => Effect.runSync(store.createNote())).toThrow(Error)
    expect(store.getSnapshot()).toBe(before)
    expect(() => Effect.runSync(store.importMarkdown([input]))).toThrow(Error)
    expect(store.getSnapshot()).toBe(before)
    expect(readFileSync(primary(root))).toEqual(bytes)
    expect(notifications).toBe(0)
    rmSync(backup(root), { recursive: true })
    Effect.runSync(store.createNote())
    expect(notifications).toBe(1)
  })

  test("external file changes cannot silently overwrite saved edits", () => {
    const root = directory()
    const store = open(root)
    const before = store.getSnapshot()
    writeFileSync(primary(root), "external data")
    expect(() => Effect.runSync(store.createNote())).toThrow(
      /changed|corrupt|recover/i,
    )
    expect(store.getSnapshot()).toBe(before)
    expect(readFileSync(primary(root), "utf8")).toBe("external data")
  })

  test("rejects oversized JSON files before parsing", () => {
    const root = directory()
    writeFileSync(primary(root), Buffer.alloc(fileLimit + 1, 0x20))
    expect(() => new NotesStore(root)).toThrow(/32.*MB|file.*limit/i)
    expect(lstatSync(primary(root)).size).toBe(fileLimit + 1)
  })

  test("duplicate instances in this process and a child cannot acquire the lock", () => {
    const root = directory()
    const store = open(root)
    expect(() => new NotesStore(root)).toThrow(/lock|running|open/i)

    const child = runChild(
      `try { new NotesStore(${JSON.stringify(root)}); process.exit(2); } catch (error) { process.stderr.write(String(error)); process.exit(1); }`,
    )

    expect(child.exitCode).toBe(1)
    expect(child.stderr.toString()).toMatch(/lock|running|open/i)
    Effect.runSync(store.createNote())
    store.close()
    expect(() => open(root)).not.toThrow()
  })

  test("a crashed child leaves a stale PID lock that a new instance recovers", () => {
    const root = directory()

    const child = runChild(
      `const store = new NotesStore(${JSON.stringify(root)}); Effect.runSync(store.createNotebook("Recovered")); process.exit(0);`,
    )

    expect(child.exitCode).toBe(0)
    expect(existsSync(join(root, ".store.lock"))).toBe(true)
    expect(
      open(root)
        .getSnapshot()
        .notebooks.some((item) => item.name === "Recovered"),
    ).toBe(true)
  })

  test("invalid lock stays intact and gives an actionable error", () => {
    const root = directory()
    const lock = join(root, ".store.lock")
    writeFileSync(lock, "not a pid")
    expect(() => new NotesStore(root)).toThrow(
      /lock.*inspect|inspect.*lock|lock.*remove/i,
    )
    expect(readFileSync(lock, "utf8")).toBe("not a pid")
  })

  test("valid sparse patches and canonical timestamps preserve behavior", () => {
    const root = directory()
    writeFileSync(primary(root), JSON.stringify(fixture()))
    const store = open(root)
    const before = store.getSnapshot()
    Effect.runSync(store.updateNote("welcome", {}))
    Effect.runSync(
      store.updateNote("welcome", {
        title: undefined,
        body: undefined,
        notebookId: undefined,
      }),
    )
    expect(store.getSnapshot()).toBe(before)
    Effect.runSync(store.updateNote("welcome", { title: "" }))
    expect(store.getSnapshot().notes[0]?.title).toBe("")
  })

  for (const owner of [
    { pid: 0, token: "a".repeat(36) },
    { pid: 1.5, token: "a".repeat(36) },
    { pid: "1", token: "a".repeat(36) },
    { pid: process.pid, token: "invalid" },
    { pid: process.pid, token: 42 },
    { pid: process.pid },
  ]) {
    test(`invalid lock owner stays intact: ${JSON.stringify(owner)}`, () => {
      const root = directory()
      const lock = join(root, ".store.lock")
      const bytes = JSON.stringify(owner)
      writeFileSync(lock, bytes)
      expect(() => new NotesStore(root)).toThrow(/lock.*inspect|inspect.*lock/i)
      expect(readFileSync(lock, "utf8")).toBe(bytes)
      expect(existsSync(primary(root))).toBe(false)
    })
  }

  test("runtime input validation rejects unknown fields and wrong types", () => {
    const root = directory()

    const child = runChild(`
      import { strict as assert } from "node:assert";
      import { readFileSync } from "node:fs";
      const store = new NotesStore(${JSON.stringify(root)});
      const note = Effect.runSync(store.createNote());
      const before = store.getSnapshot();
      const bytes = readFileSync(${JSON.stringify(primary(root))});
      const actions = [
        () => Effect.runSync(store.setTheme("system")),
        () => Effect.runSync(store.createNotebook(42)),
        () => Effect.runSync(store.updateNote(note.id, { body: null })),
        () => Effect.runSync(store.duplicateNote(note.id, null)),
        () => Effect.runSync(store.duplicateNote(note.id, [])),
        () => Effect.runSync(store.duplicateNote(note.id, { title: 42 })),
        () => Effect.runSync(store.duplicateNote(note.id, { body: null })),
        () => Effect.runSync(store.duplicateNote(note.id, { pinned: true })),
        () => Effect.runSync(store.duplicateNote(null)),
        () => Effect.runSync(store.updateNote(note.id, { pinned: true })),
        () => Effect.runSync(store.importMarkdown([42])),
        () => Effect.runSync(store.selectNote(undefined)),
        () => Effect.runSync(store.updateNote(note.id, null)),
        () => Effect.runSync(store.updateNote(note.id, [])),
        () => Effect.runSync(store.updateNote(note.id, { title: 42 })),
        () => Effect.runSync(store.updateNote(note.id, { notebookId: null })),
        () => Effect.runSync(store.importMarkdown(null)),
        () => store.subscribe(null),
      ];
      for (const action of actions) {
        assert.throws(action, Error);
        assert.strictEqual(store.getSnapshot(), before);
        assert.deepStrictEqual(readFileSync(${JSON.stringify(primary(root))}), bytes);
      }
      store.close();
    `)

    expect(child.stderr.toString()).toBe("")
    expect(child.exitCode).toBe(0)
  })

  test("workspace symlinks cannot expose or overwrite another file", () => {
    if (process.platform === "win32") return
    const root = directory()
    const outside = join(directory(), "other.json")
    const bytes = JSON.stringify(fixture())
    writeFileSync(outside, bytes)
    symlinkSync(outside, primary(root))
    expect(() => new NotesStore(root)).toThrow(Error)
    expect(lstatSync(primary(root)).isSymbolicLink()).toBe(true)
    expect(readFileSync(outside, "utf8")).toBe(bytes)
  })

  test("close does not delete another owner's replacement lock", () => {
    const root = directory()
    const store = open(root)
    const lock = join(root, ".store.lock")
    rmSync(lock)
    writeFileSync(lock, "replacement owner")
    store.close()
    expect(readFileSync(lock, "utf8")).toBe("replacement owner")
  })

  test("close is idempotent and rejects further writes", () => {
    const root = directory()
    const store = open(root)
    const before = store.getSnapshot()
    store.close()
    store.close()
    expect(() => Effect.runSync(store.createNote())).toThrow(/closed/i)
    expect(store.getSnapshot()).toBe(before)
    expect(existsSync(join(root, ".store.lock"))).toBe(false)
    expect(() => open(root)).not.toThrow()
  })

  test("data directory override is honored without disk writes", () => {
    const previous = readDataDirectory()
    const root = join(directory(), "custom")

    try {
      writeDataDirectory(root)
      expect(defaultDataDirectory()).toBe(root)
      expect(existsSync(root)).toBe(false)
    } finally {
      writeDataDirectory(previous)
    }
  })
})
