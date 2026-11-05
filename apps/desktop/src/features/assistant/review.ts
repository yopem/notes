import { Effect, Option, Schema, Struct } from "effect"
import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, parse, resolve } from "node:path"

import { AssistantReviewError } from "@/features/assistant/errors"
import {
  MCP_TOOL_SCHEMAS,
  mcpPathSchema,
  type McpToolName,
} from "@/features/assistant/mcp"
import { atomicWrite } from "@/platform/files"

// Source: apps/desktop/src/mcp/agent-edit-recorder.ts, main/agent-edit-files.ts,
// packages/app-core/src/components/AgentEditReview.tsx and shared agent-edits.

const bodySchema = Schema.String.check(Schema.isMaxLength(2 * 1024 * 1024))

const evidenceSchema = Schema.Struct({
  source: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  sourcefile: mcpPathSchema,
  tool: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
}).mapFields(Struct.map(Schema.mutableKey))

// Keep the stored contract's lowercase-only max UUID.
const uuidSchema = Schema.String.check(
  Schema.isPattern(
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
    { expected: "a UUID" },
  ),
)

const versionSchema = Schema.Struct({
  id: uuidSchema,
  body: bodySchema,
  at: Schema.Natural,
}).mapFields(Struct.map(Schema.mutableKey))

const choiceSchema = Schema.Literals(["accept", "reject"])

const transactionSchema = Schema.Struct({
  before: bodySchema,
  after: bodySchema,
}).mapFields(Struct.map(Schema.mutableKey))

const recordSchema = Schema.Struct({
  version: Schema.Literal(1),
  path: mcpPathSchema,
  baseline: bodySchema,
  proposed: bodySchema,
  expected: bodySchema,
  revision: uuidSchema,
  source: Schema.NonEmptyString,
  sourcefile: mcpPathSchema,
  tool: Schema.NonEmptyString,
  at: Schema.Natural,
  decisions: Schema.Record(Schema.String, Schema.mutableKey(choiceSchema)),
  versions: Schema.mutable(Schema.Array(versionSchema)),
  capturing: Schema.Boolean,
  transaction: Schema.NullOr(transactionSchema),
}).mapFields(Struct.map(Schema.mutableKey))

const lockSchema = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
})

const errorSchema = Schema.Struct({ code: Schema.String })

const decodeBody = Schema.decodeUnknownSync(bodySchema)

const decodeEvidence = Schema.decodeUnknownSync(evidenceSchema, {
  onExcessProperty: "error",
})

const decodeRecord = Schema.decodeUnknownSync(recordSchema, {
  onExcessProperty: "error",
})

const decodeLock = Schema.decodeUnknownSync(lockSchema, {
  onExcessProperty: "error",
})

const decodeError = Schema.decodeUnknownOption(errorSchema)

const decodePath = Schema.decodeUnknownSync(mcpPathSchema)

const decodeUuid = Schema.decodeUnknownSync(uuidSchema)

const decodeChoice = Schema.decodeUnknownSync(choiceSchema)

const decodeNotePath = Schema.decodeUnknownSync(
  Schema.Struct({ path: mcpPathSchema }),
)

type ReviewRecord = typeof recordSchema.Type

export interface AssistantHunk {
  id: string
  from: number
  to: number
  before: string
  after: string
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function lines(value: string) {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function hunks(before: string, after: string): AssistantHunk[] {
  if (before === after) return []
  const identity = `${hash(before)}:${hash(after)}`
  const left = lines(before)
  const right = lines(after)

  // Bound the comparison matrix. Large rewrites remain one explicitly visible hunk.
  if ((left.length + 1) * (right.length + 1) > 2_000_000)
    return before === after
      ? []
      : [
          {
            id: hash(`${before}\0${after}`),
            from: 0,
            to: before.length,
            before,
            after,
          },
        ]
  const width = right.length + 1
  const matrix = new Uint32Array((left.length + 1) * width)

  for (let a = left.length - 1; a >= 0; a -= 1)
    for (let b = right.length - 1; b >= 0; b -= 1)
      matrix[a * width + b] =
        left[a] === right[b]
          ? 1 + (matrix[(a + 1) * width + b + 1] ?? 0)
          : Math.max(
              matrix[(a + 1) * width + b] ?? 0,
              matrix[a * width + b + 1] ?? 0,
            )
  const result: AssistantHunk[] = []
  let a = 0
  let b = 0
  let offset = 0

  while (a < left.length || b < right.length) {
    if (a < left.length && b < right.length && left[a] === right[b]) {
      offset += left[a]?.length ?? 0
      a += 1
      b += 1
      continue
    }

    const from = offset
    let removed = ""
    let added = ""

    while (a < left.length || b < right.length) {
      if (a < left.length && b < right.length && left[a] === right[b]) break

      if (
        b < right.length &&
        (a >= left.length ||
          (matrix[a * width + b + 1] ?? 0) > (matrix[(a + 1) * width + b] ?? 0))
      ) {
        added += right[b] ?? ""
        b += 1
      } else {
        const text = left[a] ?? ""
        removed += text
        offset += text.length
        a += 1
      }
    }

    result.push({
      id: hash(`${identity}:${from}:${offset}`),
      from,
      to: offset,
      before: removed,
      after: added,
    })
  }

  return result
}

function content(record: ReviewRecord, comparison = false) {
  const changes = hunks(record.baseline, record.proposed)
  let result = ""
  let offset = 0

  for (const hunk of changes) {
    result += record.baseline.slice(offset, hunk.from)
    const choice = record.decisions[hunk.id]
    result += comparison
      ? choice === "accept"
        ? hunk.after
        : hunk.before
      : choice === "reject"
        ? hunk.before
        : hunk.after
    offset = hunk.to
  }

  return result + record.baseline.slice(offset)
}

function keepVersion(record: ReviewRecord, body: string) {
  if (record.versions.at(-1)?.body !== body)
    record.versions.push({ id: randomUUID(), body, at: Date.now() })
}

function reviewAttempt<T>(operation: string, action: () => T) {
  return Effect.try({
    try: action,
    catch: (cause) => AssistantReviewError.fromCause(operation, cause),
  })
}

export interface AssistantReviewOptions {
  /** Use the vault's guarded writer when the application owns the vault lock. */
  writeNote?(path: string, body: string, expectedContent: string): void
}

export class AssistantReview {
  readonly root: string
  private readonly directory: string
  constructor(
    root: string,
    private readonly options: AssistantReviewOptions = {},
  ) {
    this.root = resolve(root)
    this.directory = join(this.root, ".still-notes", "assistant-review")
    this.safe(this.root)
  }
  private safe(path: string) {
    const relative = path.slice(this.root.length)

    if (path !== this.root && !relative.startsWith("/"))
      throw new Error("Path escapes vault")
    let current = parse(path).root

    for (const part of path.slice(current.length).split("/")) {
      if (part) current = join(current, part)

      try {
        if (lstatSync(current).isSymbolicLink())
          throw new Error("Refusing symbolic link in review path")
      } catch (error) {
        if (Option.getOrUndefined(decodeError(error))?.code !== "ENOENT")
          throw error
      }
    }

    return path
  }
  private notePath(path: string) {
    return this.safe(join(this.root, decodePath(path)))
  }
  private recordPath(path: string) {
    decodePath(path)

    return this.safe(join(this.directory, `${hash(path)}.json`))
  }
  private text(path: string) {
    const file = this.notePath(path)
    const stat = lstatSync(file)

    if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
      throw new Error("Invalid or oversized review note")

    return decodeBody(readFileSync(file, "utf8"))
  }
  private save(record: ReviewRecord) {
    decodeRecord(record)
    const path = this.recordPath(record.path)
    this.safe(this.directory)
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const bytes = JSON.stringify(record)

    if (Buffer.byteLength(bytes) > 64 * 1024 * 1024)
      throw new Error(
        "Review history exceeds storage limit; preserve records before retrying",
      )
    atomicWrite(path, bytes, this.directory)
  }
  private load(path: string): ReviewRecord | null {
    const file = this.recordPath(path)
    let raw: string

    try {
      const stat = lstatSync(file)

      if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
        throw new Error("Invalid or oversized review record")
      raw = readFileSync(file, "utf8")
    } catch (error) {
      if (Option.getOrUndefined(decodeError(error))?.code === "ENOENT")
        return null
      throw error
    }

    const record = decodeRecord(JSON.parse(raw))

    if (record.path !== path) throw new Error("Review path mismatch")

    return record
  }
  private recover(record: ReviewRecord) {
    const actual = this.text(record.path)

    if (record.transaction) {
      if (
        actual !== record.transaction.before &&
        actual !== record.transaction.after
      )
        throw new Error("Outside change conflicts with interrupted review")

      if (actual === record.transaction.before)
        this.writeNote(
          record.path,
          record.transaction.after,
          record.transaction.before,
        )
      record.expected = record.transaction.after
      record.transaction = null
      this.save(record)
    } else if (record.capturing) {
      keepVersion(record, actual)
      record.proposed = actual
      record.expected = actual
      record.capturing = false
      this.save(record)
    }

    return record
  }
  private lock(path: string) {
    this.notePath(path)
    this.safe(this.directory)
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const lock = this.safe(join(this.directory, `${hash(path)}.lock`))

    try {
      const stored = decodeLock(JSON.parse(readFileSync(lock, "utf8")))

      try {
        process.kill(stored.pid, 0)
        throw new Error("Review operation already active")
      } catch (error) {
        if (Option.getOrUndefined(decodeError(error))?.code !== "ESRCH")
          throw error
        rmSync(lock)
      }
    } catch (error) {
      if (Option.getOrUndefined(decodeError(error))?.code !== "ENOENT")
        throw error
    }

    const fd = openSync(lock, "wx", 0o600)
    writeFileSync(fd, JSON.stringify({ pid: process.pid }))

    return function release() {
      closeSync(fd)
      rmSync(lock, { force: true })
    }
  }
  private snapshot(record: ReviewRecord) {
    const actual = this.text(record.path)

    return {
      ...record,
      versions: record.versions.map((version) => ({ ...version })),
      decisions: { ...record.decisions },
      outsideChange: actual !== record.expected,
      current: actual,
      hunks: hunks(record.baseline, record.proposed).filter(
        (hunk) => record.decisions[hunk.id] === undefined,
      ),
    }
  }
  private readRecord(path: string) {
    this.notePath(path)
    const record = this.load(path)

    if (!record) return null

    if (record.capturing || record.transaction) {
      let release: () => void

      try {
        release = this.lock(path)
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Review operation already active"
        )
          return this.snapshot(record)
        throw error
      }

      try {
        const current = this.load(path)

        return current ? this.snapshot(this.recover(current)) : null
      } finally {
        release()
      }
    }

    return this.snapshot(record)
  }
  read(path: string) {
    return reviewAttempt("read", () => this.readRecord(path))
  }
  list() {
    return reviewAttempt("list", () => {
      this.safe(this.directory)
      let files: string[]

      try {
        files = readdirSync(this.directory)
      } catch (error) {
        if (Option.getOrUndefined(decodeError(error))?.code === "ENOENT")
          return []
        throw error
      }

      const found = []

      for (const file of files) {
        if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
        const path = this.safe(join(this.directory, file))
        const stat = lstatSync(path)

        if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
          throw new Error("Invalid or oversized review record")
        const record = decodeRecord(JSON.parse(readFileSync(path, "utf8")))

        if (`${hash(record.path)}.json` !== file)
          throw new Error("Review filename mismatch")
        const incoming = this.readRecord(record.path)

        if (incoming?.hunks.length) found.push(incoming)
      }

      return found.sort((a, b) => b.at - a.at)
    })
  }
  recordTool<K extends McpToolName, T, E, R>(
    name: K,
    args: (typeof MCP_TOOL_SCHEMAS)[K]["Type"],
    source: string,
    mutate: Effect.Effect<T, E, R>,
  ) {
    return Effect.gen({ self: this }, function* () {
      const validated = yield* reviewAttempt("recordTool", () =>
        Schema.decodeUnknownSync(MCP_TOOL_SCHEMAS[name], {
          onExcessProperty: "error",
        })(args),
      )

      if (name === "toggle_task") {
        const id = yield* reviewAttempt(
          "recordTool",
          () =>
            Schema.decodeUnknownSync(MCP_TOOL_SCHEMAS.toggle_task, {
              onExcessProperty: "error",
            })(validated).id,
        )

        const path = id.slice(0, id.lastIndexOf("#"))

        return yield* this.record(
          path,
          { source, sourcefile: path, tool: name },
          mutate,
        )
      }

      if (
        [
          "write_note",
          "append_to_note",
          "prepend_to_note",
          "insert_at_line",
          "replace_in_note",
        ].includes(name)
      ) {
        const path = yield* reviewAttempt(
          "recordTool",
          () => decodeNotePath(validated).path,
        )

        return yield* this.record(
          path,
          { source, sourcefile: path, tool: name },
          mutate,
        )
      }

      return yield* mutate
    })
  }

  record<T, E, R>(
    path: string,
    evidence: typeof evidenceSchema.Encoded,
    mutate: Effect.Effect<T, E, R>,
  ) {
    return Effect.gen({ self: this }, function* () {
      const validated = yield* reviewAttempt("record", () =>
        decodeEvidence(evidence),
      )

      return yield* Effect.acquireUseRelease(
        reviewAttempt("record", () => this.lock(path)),
        () =>
          Effect.gen({ self: this }, function* () {
            const record = yield* reviewAttempt("record", () => {
              let record = this.load(path)

              if (record) record = this.recover(record)
              const before = this.text(path)

              if (record) {
                if (before !== record.expected)
                  throw new Error(
                    "Outside change conflicts with assistant edit",
                  )
                record.baseline = content(record, true)
                record.proposed = before
                record.decisions = {}
                Object.assign(record, validated)
                record.at = Date.now()
                record.revision = randomUUID()
              } else
                record = {
                  version: 1,
                  path,
                  baseline: before,
                  proposed: before,
                  expected: before,
                  revision: randomUUID(),
                  ...validated,
                  at: Date.now(),
                  decisions: {},
                  versions: [],
                  capturing: false,
                  transaction: null,
                }
              keepVersion(record, before)
              record.capturing = true
              this.save(record)

              return record
            })

            return yield* Effect.acquireUseRelease(
              Effect.succeed(record),
              () => mutate,
              (current) =>
                reviewAttempt("record", () => {
                  const after = this.text(path)
                  keepVersion(current, after)
                  current.proposed = after
                  current.expected = after
                  current.capturing = false
                  this.save(current)
                }),
            )
          }),
        (release) => reviewAttempt("record", release),
      )
    })
  }
  decide(
    path: string,
    hunkId: string,
    choice: "accept" | "reject",
    revision: string,
  ) {
    return reviewAttempt("decide", () => {
      decodeChoice(choice)
      decodeUuid(revision)
      const release = this.lock(path)

      try {
        const loaded = this.load(path)

        if (!loaded) throw new Error("No assistant review record")
        const record = this.recover(loaded)

        if (this.text(path) !== record.expected)
          throw new Error("Outside change conflicts with review")
        const decided = record.decisions[hunkId]

        if (decided) {
          if (decided !== choice) throw new Error("Hunk already decided")

          return this.snapshot(record)
        }

        if (record.revision !== revision)
          throw new Error("Stale review revision")

        if (
          !hunks(record.baseline, record.proposed).some(
            (hunk) => hunk.id === hunkId,
          )
        )
          throw new Error("Unknown hunk")
        record.decisions[hunkId] = choice
        this.commitContent(record, content(record))

        return this.snapshot(record)
      } finally {
        release()
      }
    })
  }
  rollback(path: string, versionId: string, revision: string) {
    return reviewAttempt("rollback", () => {
      decodeUuid(versionId)
      decodeUuid(revision)
      const release = this.lock(path)

      try {
        const loaded = this.load(path)

        if (!loaded) throw new Error("No assistant review record")
        const record = this.recover(loaded)

        if (record.revision !== revision)
          throw new Error("Stale review revision")

        if (this.text(path) !== record.expected)
          throw new Error("Outside change conflicts with rollback")
        const version = record.versions.find((item) => item.id === versionId)

        if (!version) throw new Error("Unknown version")
        keepVersion(record, record.expected)
        record.baseline = version.body
        record.proposed = version.body
        record.decisions = {}
        this.commitContent(record, version.body)

        return this.snapshot(record)
      } finally {
        release()
      }
    })
  }
  private writeNote(path: string, body: string, expectedContent: string) {
    if (this.text(path) !== expectedContent)
      throw new Error("Outside change conflicts with note write")

    if (this.options.writeNote)
      this.options.writeNote(path, body, expectedContent)
    else {
      const file = this.notePath(path)
      atomicWrite(file, body, dirname(file))
    }
  }

  private commitContent(record: ReviewRecord, after: string) {
    keepVersion(record, record.expected)
    keepVersion(record, after)
    record.revision = randomUUID()

    if (after === record.expected) {
      this.save(record)

      return
    }

    record.transaction = { before: record.expected, after }
    this.save(record)

    if (this.text(record.path) !== record.expected)
      throw new Error("Outside change conflicts with review save")
    this.writeNote(record.path, after, record.expected)
    record.expected = after
    record.transaction = null
    this.save(record)
  }
}
