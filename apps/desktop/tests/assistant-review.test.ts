import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
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

import type { MCP_TOOL_SCHEMAS, McpToolName } from "@/features/assistant/mcp"

import {
  AssistantReview,
  type AssistantReviewOptions,
} from "@/features/assistant/review"

function reviewAt(root: string, options?: AssistantReviewOptions) {
  const review = new AssistantReview(root, options)

  return {
    read: (path: string) => Effect.runSync(review.read(path)),
    list: () => Effect.runSync(review.list()),
    decide: (
      path: string,
      hunk: string,
      choice: "accept" | "reject",
      revision: string,
    ) => Effect.runSync(review.decide(path, hunk, choice, revision)),
    rollback: (path: string, version: string, revision: string) =>
      Effect.runSync(review.rollback(path, version, revision)),
    record: <T>(
      path: string,
      evidence: { source: string; sourcefile: string; tool: string },
      mutate: () => T | Promise<T>,
    ) =>
      Effect.runPromise(
        review.record(
          path,
          evidence,
          Effect.tryPromise({
            try: () => Promise.resolve().then(mutate),
            catch: (cause) => cause,
          }),
        ),
      ),
    recordTool: <K extends McpToolName, T>(
      name: K,
      args: (typeof MCP_TOOL_SCHEMAS)[K]["Type"],
      source: string,
      mutate: () => T | Promise<T>,
    ) =>
      Effect.runPromise(
        review.recordTool(
          name,
          args,
          source,
          Effect.tryPromise({
            try: () => Promise.resolve().then(mutate),
            catch: (cause) => cause,
          }),
        ),
      ),
  }
}

const roots: string[] = []

function workspace(body = "one\ntwo\nthree\nfour\nfive\n") {
  const root = mkdtempSync(join(tmpdir(), "still-review-"))
  roots.push(root)
  writeFileSync(join(root, "note.md"), body)

  return {
    root,
    review: reviewAt(root),
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
  test("review effects defer edits and report typed failures", async () => {
    const { root, path, body } = workspace()
    const review = new AssistantReview(root)

    const edit = review.record(
      "note.md",
      evidence,
      Effect.sync(() => {
        writeFileSync(path, "deferred")
      }),
    )

    expect(readFileSync(path, "utf8")).toBe(body)
    expect(Effect.runSync(review.read("note.md"))).toBeNull()
    await Effect.runPromise(edit)
    expect(readFileSync(path, "utf8")).toBe("deferred")

    const error = Effect.runSync(Effect.flip(review.read("../outside")))
    expect(error._tag).toBe("AssistantReviewError")
  })
  test("baseline precedes edit, records persist, hunks accept/reject independently", async () => {
    const { root, review, path, body } = workspace()
    await review.record("note.md", evidence, () => {
      expect(reviewAt(root).read("note.md")?.baseline).toBe(body)
      writeFileSync(path, "ONE\ntwo\nthree\nfour\nFIVE\n")
    })
    const reopened = reviewAt(root)
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
      reviewAt(root)
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

    const failing = reviewAt(root, {
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
    const reopened = reviewAt(root)
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
      `import { AssistantReview } from ${JSON.stringify(resolve("src/features/assistant/review.ts"))};\nimport { Effect } from ${JSON.stringify(import.meta.resolve("effect"))};\nimport { writeFileSync } from 'node:fs';\nawait Effect.runPromise(new AssistantReview(${JSON.stringify(root)}).record('note.md', ${JSON.stringify(evidence)}, Effect.sync(() => { writeFileSync(${JSON.stringify(path)}, 'interrupted edit'); process.exit(7); })));`,
    )

    const child = Bun.spawn([process.execPath, entry], {
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(await child.exited).toBe(7)
    expect(await new Response(child.stderr).text()).toBe("")
    const reopened = reviewAt(root)
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
    expect(() => reviewAt(join(parent, "vault"))).toThrow(/symbolic|symlink/i)
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
