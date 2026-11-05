import { afterEach, describe, expect, test } from "bun:test"
import {
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

import { AssistantReview } from "@/services/assistant-review"

const roots: string[] = []

function workspace(body = "one\ntwo\nthree\nfour\nfive\n") {
  const root = mkdtempSync(join(tmpdir(), "still-review-"))
  roots.push(root)
  writeFileSync(join(root, "note.md"), body)

  return {
    root,
    review: new AssistantReview(root),
    path: join(root, "note.md"),
    body,
  }
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

async function failure<T>(promise: Promise<T>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }

  throw new Error("Expected operation to fail")
}

const evidence = {
  source: "Claude Code",
  sourcefile: "note.md",
  tool: "write_note",
}

// Define expected filesystem behavior before implementation. No native windows.
describe("durable assistant edit review", () => {
  test("baseline precedes edit, records persist, hunks accept/reject independently", async () => {
    const { root, review, path, body } = workspace()
    await review.record("note.md", evidence, () => {
      expect(new AssistantReview(root).read("note.md")?.baseline).toBe(body)
      writeFileSync(path, "ONE\ntwo\nthree\nfour\nFIVE\n")
    })
    const reopened = new AssistantReview(root)
    expect(reopened.list()).toHaveLength(1)
    const incoming = reopened.read("note.md")
    expect(incoming?.source).toBe("Claude Code")
    expect(incoming?.sourcefile).toBe("note.md")
    expect(incoming?.hunks).toHaveLength(2)
    const [first, second] = incoming?.hunks ?? []

    if (!first || !second || !incoming) throw new Error("Missing hunks")

    const accepted = reopened.decide(
      "note.md",
      first.id,
      "accept",
      incoming.revision,
    )

    expect(readFileSync(path, "utf8")).toBe("ONE\ntwo\nthree\nfour\nFIVE\n")

    const rejected = reopened.decide(
      "note.md",
      second.id,
      "reject",
      accepted.revision,
    )

    expect(readFileSync(path, "utf8")).toBe("ONE\ntwo\nthree\nfour\nfive\n")
    expect(reopened.list()).toHaveLength(0)
    expect(
      reopened.decide("note.md", second.id, "reject", rejected.revision),
    ).toEqual(rejected)
    expect(() =>
      reopened.decide("note.md", second.id, "accept", rejected.revision),
    ).toThrow(/decided|conflict/i)
    expect(
      reopened.read("note.md")?.versions.map((version) => version.body),
    ).toContain(body)
  })
  test("outside edits block decisions and new recordings without losing bytes", async () => {
    const { review, path } = workspace()
    await review.record("note.md", evidence, () => {
      writeFileSync(path, "assistant\n")
    })
    const incoming = review.read("note.md")

    if (!incoming?.hunks[0]) throw new Error("Missing hunk")
    writeFileSync(path, "outside\n")
    expect(review.read("note.md")?.outsideChange).toBe(true)
    expect(() =>
      review.decide(
        "note.md",
        incoming.hunks[0]!.id,
        "reject",
        incoming.revision,
      ),
    ).toThrow(/outside|conflict/i)
    expect(
      (
        await failure(
          review.record("note.md", evidence, () => {
            writeFileSync(path, "bad")
          }),
        )
      ).message,
    ).toMatch(/outside|conflict/i)
    expect(readFileSync(path, "utf8")).toBe("outside\n")
  })
  test("failed edits and unchanged edits do not create false incoming changes", async () => {
    const { review, body, path } = workspace()
    expect(
      await failure(
        review.record("note.md", evidence, () => {
          throw new Error("save failed")
        }),
      ),
    ).toMatchObject({ message: "save failed" })
    expect(review.list()).toEqual([])
    expect(readFileSync(path, "utf8")).toBe(body)
    await review.record("note.md", evidence, () => Promise.resolve())
    expect(review.list()).toEqual([])
  })
  test("partial failed edits remain reviewable, rollback preserves old and new versions", async () => {
    const { root, review, path, body } = workspace()
    expect(
      await failure(
        review.record("note.md", evidence, () => {
          writeFileSync(path, "partial")
          throw new Error("later failure")
        }),
      ),
    ).toMatchObject({ message: "later failure" })
    const incoming = review.read("note.md")

    if (!incoming) throw new Error("Missing record")
    const version = incoming.versions.find((item) => item.body === body)

    if (!version) throw new Error("Missing baseline version")
    review.rollback("note.md", version.id, incoming.revision)
    expect(readFileSync(path, "utf8")).toBe(body)
    expect(
      new AssistantReview(root)
        .read("note.md")
        ?.versions.map((item) => item.body),
    ).toContain("partial")
  })
  test("repeated edits preserve earliest baseline and stale revisions cannot approve", async () => {
    const { review, path, body } = workspace()
    await review.record("note.md", evidence, () => {
      writeFileSync(path, "first")
    })
    const old = review.read("note.md")
    await review.record("note.md", evidence, () => {
      writeFileSync(path, "second")
    })
    const current = review.read("note.md")
    expect(current?.baseline).toBe(body)

    if (!old?.hunks[0]) throw new Error("Missing hunk")
    expect(() =>
      review.decide("note.md", old.hunks[0]!.id, "accept", old.revision),
    ).toThrow(/revision|stale/i)
  })
  test("rejects traversal, symlinks, corrupt records, invalid evidence", async () => {
    const { root, review, path } = workspace()

    for (const note of ["../x", "/tmp/x", "a\\b", ".still-notes/state.json"])
      expect(() => review.read(note)).toThrow()
    symlinkSync(path, join(root, "link.md"))
    expect(() => review.read("link.md")).toThrow(/symbolic|symlink/i)
    expect(
      await failure(
        review.record("note.md", { ...evidence, source: "" }, () =>
          Promise.resolve(),
        ),
      ),
    ).toBeInstanceOf(Error)
    await review.record("note.md", evidence, () => {
      writeFileSync(path, "new")
    })
    const records = join(root, ".still-notes", "assistant-review")
    const file = readdirSync(records).find((name) => name.endsWith(".json"))

    if (!file) throw new Error("Missing record file")
    writeFileSync(join(records, file), "{broken")
    expect(() => review.read("note.md")).toThrow()
    expect(readFileSync(path, "utf8")).toBe("new")
  })
  test("failed guarded write keeps a journal that recovers before another edit", async () => {
    const { root, review, path, body } = workspace()
    await review.record("note.md", evidence, () =>
      writeFileSync(path, "assistant"),
    )
    const incoming = review.read("note.md")

    if (!incoming?.hunks[0]) throw new Error("Missing edit")

    const failing = new AssistantReview(root, {
      writeNote(_path, next) {
        writeFileSync(join(root, "missing", "note.md"), next)
      },
    })

    expect(() =>
      failing.decide(
        "note.md",
        incoming.hunks[0]!.id,
        "reject",
        incoming.revision,
      ),
    ).toThrow()
    expect(readFileSync(path, "utf8")).toBe("assistant")
    const reopened = new AssistantReview(root)
    await reopened.record("note.md", evidence, () => {
      expect(readFileSync(path, "utf8")).toBe(body)
      writeFileSync(path, "next edit")
    })
    expect(reopened.read("note.md")?.baseline).toBe(body)
    expect(readFileSync(path, "utf8")).toBe("next edit")
  })
  test("tool wrapper records source-supported text tools but not reads", async () => {
    const { review, path } = workspace()
    await review.recordTool("read_note", { path: "note.md" }, "Codex", () =>
      readFileSync(path, "utf8"),
    )
    expect(review.read("note.md")).toBeNull()
    await review.recordTool("toggle_task", { id: "note.md#0" }, "Codex", () =>
      writeFileSync(path, "- [x] task"),
    )
    expect(review.read("note.md")).toMatchObject({
      source: "Codex",
      sourcefile: "note.md",
      tool: "toggle_task",
    })
  })
  test("process interruption keeps baseline and allows durable rejection after restart", async () => {
    const { root, path, body } = workspace()
    const entry = join(root, "interrupted.ts")
    writeFileSync(
      entry,
      `import { AssistantReview } from ${JSON.stringify(resolve("src/services/assistant-review.ts"))};\nimport { writeFileSync } from 'node:fs';\nawait new AssistantReview(${JSON.stringify(root)}).record('note.md', ${JSON.stringify(evidence)}, () => { writeFileSync(${JSON.stringify(path)}, 'interrupted edit'); process.exit(7); });`,
    )

    const child = Bun.spawn([process.execPath, entry], {
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(await child.exited).toBe(7)
    expect(await new Response(child.stderr).text()).toBe("")
    const reopened = new AssistantReview(root)
    const incoming = reopened.read("note.md")

    if (!incoming?.hunks[0]) throw new Error("Missing recovered edit")
    expect(incoming.baseline).toBe(body)
    reopened.decide(
      "note.md",
      incoming.hunks[0].id,
      "reject",
      incoming.revision,
    )
    expect(readFileSync(path, "utf8")).toBe(body)
    expect(
      reopened.read("note.md")?.versions.map((version) => version.body),
    ).toContain("interrupted edit")
  })
  test("rejects vault roots reached through symbolic-link parents", () => {
    const { root } = workspace()
    const parent = join(root, "parent")
    const actual = join(root, "actual")
    mkdirSync(actual)
    symlinkSync(actual, parent)
    mkdirSync(join(actual, "vault"))
    expect(() => new AssistantReview(join(parent, "vault"))).toThrow(
      /symbolic|symlink/i,
    )
  })
  test("failed record storage prevents untracked mutation", async () => {
    const { root, review, path, body } = workspace()
    mkdirSync(join(root, ".still-notes"), { recursive: true })
    writeFileSync(join(root, ".still-notes", "assistant-review"), "blocked")
    expect(
      await failure(
        review.record("note.md", evidence, () => {
          writeFileSync(path, "lost")
        }),
      ),
    ).toBeInstanceOf(Error)
    expect(readFileSync(path, "utf8")).toBe(body)
  })
})
