import {
  Deferred,
  Effect,
  Fiber,
  Option,
  Predicate,
  Result,
  Schema,
  SchemaRepresentation,
  SchemaTransformation,
  Semaphore,
  Stream,
  Struct,
} from "effect"
import { createHash } from "node:crypto"
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { dirname, isAbsolute, join, parse, resolve } from "node:path"

import { atomicWrite } from "@/platform/files"

// Source: apps/desktop/src/main/mcp-integrations.ts and src/mcp/server.ts.

const clientSchema = Schema.Literals([
  "claude-code",
  "claude-desktop",
  "codex",
  "opencode",
])

export type McpClientId = typeof clientSchema.Type

const rootsSchema = Schema.Struct({
  home: Schema.NonEmptyString,
  config: Schema.NonEmptyString,
  platform: Schema.Literals(["linux", "darwin", "win32"]),
  appData: Schema.optional(Schema.NonEmptyString),
}).mapFields(Struct.map(Schema.mutableKey))

const runtimeSchema = Schema.Struct({
  command: Schema.NonEmptyString.check(
    Schema.makeFilter(isAbsolute, {
      message: "Use an absolute executable path",
    }),
  ),
  args: Schema.mutable(Schema.Array(Schema.String)).check(
    Schema.isMaxLength(100),
  ),
}).mapFields(Struct.map(Schema.mutableKey))

const jsonValueSchema = Schema.MutableJson

// Check the input before record decoding can discard native TOML date fields.
const plainRecordSchema = Schema.declare(Predicate.isObject).check(
  Schema.makeFilter(
    (value) => {
      const constructor = value.constructor

      if (!Predicate.isFunction(constructor)) return true
      const prototype: unknown = constructor.prototype

      return (
        Predicate.isObject(prototype) &&
        Object.hasOwn(prototype, "isPrototypeOf")
      )
    },
    { message: "Expected a plain record" },
  ),
)

const objectSchema = plainRecordSchema.pipe(
  Schema.decodeTo(
    Schema.Record(Schema.String, Schema.mutableKey(jsonValueSchema)),
  ),
)

const tomlDocumentSchema = Schema.StructWithRest(
  Schema.Struct({
    mcp_servers: Schema.optional(
      plainRecordSchema.pipe(
        Schema.decodeTo(Schema.Record(Schema.String, Schema.Unknown)),
      ),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const receiptSchema = Schema.Struct({
  version: Schema.Literal(1),
  entry: Schema.String,
  separator: Schema.String,
  createdContainer: Schema.Boolean,
  block: Schema.NullOr(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))

const errorSchema = Schema.Struct({ code: Schema.String })

const decodeError = Schema.decodeUnknownOption(errorSchema)

export class McpConfigError extends Schema.TaggedError<McpConfigError>()(
  "McpConfigError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

function configError(cause: unknown) {
  return new McpConfigError({
    message: cause instanceof Error ? cause.message : "Config operation failed",
    cause,
  })
}

const decodeClient = Schema.decodeUnknownSync(clientSchema)

const decodeRoots = Schema.decodeUnknownSync(rootsSchema, {
  onExcessProperty: "error",
})

const decodeRuntime = Schema.decodeUnknownSync(runtimeSchema, {
  onExcessProperty: "error",
})

const decodeReceipt = Schema.decodeUnknownSync(receiptSchema, {
  onExcessProperty: "error",
})

const decodeJson = Schema.decodeUnknownSync(jsonValueSchema)

const decodeObject = Schema.decodeUnknownSync(objectSchema)

const decodeToml = Schema.decodeUnknownSync(tomlDocumentSchema)

const decodeString = Schema.decodeUnknownSync(Schema.String)

const serverKey = "still-notes"

const startMarker = "# >>> still-notes mcp begin (managed) >>>"

const endMarker = "# <<< still-notes mcp end (managed) <<<"

function safeFile(path: string) {
  let current = parse(resolve(path)).root

  for (const part of resolve(path).slice(current.length).split(/[\\/]/)) {
    current = join(current, part)

    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("Refusing symbolic link")
    } catch (error) {
      if (Option.getOrUndefined(decodeError(error))?.code !== "ENOENT")
        throw error
    }
  }
}

function readOptional(path: string) {
  safeFile(path)

  try {
    const stat = lstatSync(path)

    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw new Error("Invalid or oversized config file")

    return readFileSync(path, "utf8")
  } catch (error) {
    if (Option.getOrUndefined(decodeError(error))?.code === "ENOENT")
      return null
    throw error
  }
}

function save(path: string, bytes: string) {
  safeFile(path)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  atomicWrite(path, bytes, dirname(path))
}

function fingerprint(value: typeof jsonValueSchema.Type | undefined) {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "undefined")
    .digest("hex")
}

// Locate JSON members without reprinting unknown fields or changing whitespace.
function members(raw: string, start: number) {
  const found: {
    key: string
    start: number
    end: number
    valueStart: number
    valueEnd: number
  }[] = []

  let index = start + 1

  function whitespace() {
    while (/\s/.test(raw[index] ?? "") && index < raw.length) index += 1
  }

  function stringEnd() {
    index += 1

    while (index < raw.length) {
      if (raw[index] === "\\") index += 2
      else if (raw[index++] === '"') return
    }
  }

  whitespace()

  while (raw[index] !== "}" && index < raw.length) {
    const keyStart = index
    stringEnd()
    const key = decodeString(JSON.parse(raw.slice(keyStart, index)))
    whitespace()
    index += 1
    whitespace()
    const valueStart = index
    let depth = 0

    while (index < raw.length) {
      const char = raw[index]

      if (char === '"') stringEnd()
      else if (char === "{" || char === "[") {
        depth += 1
        index += 1
      } else if (char === "}" || char === "]") {
        if (depth === 0) break
        depth -= 1
        index += 1
      } else if (char === "," && depth === 0) break
      else index += 1
    }

    let valueEnd = index

    while (valueEnd > valueStart && /\s/.test(raw[valueEnd - 1] ?? ""))
      valueEnd -= 1
    found.push({ key, start: keyStart, end: index, valueStart, valueEnd })

    if (raw[index] === ",") {
      index += 1
      whitespace()
    } else break
  }

  return found
}

function removeMember(raw: string, objectStart: number, key: string) {
  const fields = members(raw, objectStart)
  const index = fields.findIndex((field) => field.key === key)
  const field = fields[index]

  if (!field) return raw
  const next = fields[index + 1]
  const previous = fields[index - 1]

  if (next) return raw.slice(0, field.start) + raw.slice(field.end + 1)

  if (previous) return raw.slice(0, previous.end) + raw.slice(field.end)

  return raw.slice(0, field.start) + raw.slice(field.valueEnd)
}

function insertMember(
  raw: string,
  objectStart: number,
  key: string,
  value: typeof jsonValueSchema.Type,
) {
  return (
    raw.slice(0, objectStart + 1) +
    `${JSON.stringify(key)}:${JSON.stringify(value)}${members(raw, objectStart).length ? "," : ""}` +
    raw.slice(objectStart + 1)
  )
}

function jsonConfig(raw: string, container: string) {
  const object = decodeObject(JSON.parse(raw))
  // Duplicate member names are ambiguous. Do not edit such a document.
  const top = members(raw, raw.indexOf("{"))

  if (new Set(top.map((field) => field.key)).size !== top.length)
    throw new Error("Duplicate config keys")
  const field = top.find((item) => item.key === container)

  const servers =
    object[container] === undefined ? {} : decodeObject(object[container])

  if (field) {
    const fields = members(raw, field.valueStart)

    if (new Set(fields.map((item) => item.key)).size !== fields.length)
      throw new Error("Duplicate server keys")
  }

  return { object, servers, field }
}

function tomlConfig(raw: string) {
  const object = decodeToml(Bun.TOML.parse(raw))
  const configured = object.mcp_servers ?? {}
  const entry = configured[serverKey]

  const servers = {
    [serverKey]: entry === undefined ? undefined : decodeJson(entry),
  }

  const serverCount = Object.keys(configured).length

  const starts = raw.split(startMarker).length - 1
  const ends = raw.split(endMarker).length - 1

  if (starts !== ends || starts > 1)
    throw new Error("Malformed managed markers")
  const start = raw.indexOf(startMarker)
  const end = raw.indexOf(endMarker)

  if (
    start >= 0 &&
    (end < start ||
      (start > 0 && raw[start - 1] !== "\n") ||
      ![undefined, "\n", "\r"].includes(raw[end + endMarker.length]))
  )
    throw new Error("Malformed managed markers")

  return { servers, serverCount, start, end: end + endMarker.length }
}

export interface McpClientStatus {
  id: McpClientId
  configPath: string
  installed: boolean
  upToDate: boolean
  owned: boolean
  note: string | null
}

export class McpClients {
  private readonly roots: typeof rootsSchema.Type
  private readonly runtime: typeof runtimeSchema.Type
  constructor(
    roots: typeof rootsSchema.Encoded,
    runtime: typeof runtimeSchema.Encoded,
  ) {
    this.roots = decodeRoots(roots)
    this.runtime = decodeRuntime(runtime)

    if (!isAbsolute(this.roots.home) || !isAbsolute(this.roots.config))
      throw new Error("Use absolute config roots")
  }
  private path(id: McpClientId) {
    decodeClient(id)
    const { home, config, platform, appData } = this.roots

    if (id === "claude-code") return join(home, ".claude.json")

    if (id === "codex") return join(home, ".codex", "config.toml")

    if (id === "opencode") return join(config, "opencode", "opencode.json")

    const base = {
      darwin: join(home, "Library", "Application Support"),
      win32: appData ?? join(home, "AppData", "Roaming"),
      linux: config,
    }[platform]

    return join(base, "Claude", "claude_desktop_config.json")
  }
  private entry(id: McpClientId): typeof jsonValueSchema.Type {
    return id === "opencode"
      ? {
          type: "local",
          command: [this.runtime.command, ...this.runtime.args],
          enabled: true,
        }
      : { command: this.runtime.command, args: this.runtime.args }
  }
  status(id: McpClientId) {
    return Effect.try({ try: () => this.statusValue(id), catch: configError })
  }
  private statusValue(id: McpClientId): McpClientStatus {
    const configPath = this.path(id)

    try {
      const raw = readOptional(configPath)

      const servers =
        id === "codex"
          ? tomlConfig(raw ?? "").servers
          : jsonConfig(raw ?? "{}", id === "opencode" ? "mcp" : "mcpServers")
              .servers

      const entry = servers[serverKey]
      const receipt = readOptional(`${configPath}.still-notes-mcp.json`)

      const owned =
        receipt === null
          ? false
          : decodeReceipt(JSON.parse(receipt)).entry === fingerprint(entry)

      return {
        id,
        configPath,
        installed: entry !== undefined,
        upToDate:
          entry !== undefined &&
          fingerprint(entry) === fingerprint(this.entry(id)),
        owned,
        note: null,
      }
    } catch (error) {
      return {
        id,
        configPath,
        installed: false,
        upToDate: false,
        owned: false,
        note: error instanceof Error ? error.message : "Config read failed",
      }
    }
  }
  statuses() {
    return Effect.all(clientSchema.literals.map((id) => this.status(id)))
  }
  install(id: McpClientId) {
    return this.change(id, true)
  }
  uninstall(id: McpClientId) {
    return this.change(id, false)
  }
  private change(id: McpClientId, install: boolean) {
    return Effect.acquireUseRelease(
      Effect.try({
        try: () => {
          const path = this.path(id)
          safeFile(path)
          mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
          const lock = `${path}.still-notes-mcp.lock`
          safeFile(lock)

          return { path, lock, fd: openSync(lock, "wx", 0o600) }
        },
        catch: configError,
      }),
      ({ path }) =>
        Effect.try({
          try: () => {
            const original = readOptional(path)
            const receiptPath = `${path}.still-notes-mcp.json`
            const receiptRaw = readOptional(receiptPath)

            const receipt =
              receiptRaw === null ? null : decodeReceipt(JSON.parse(receiptRaw))

            const container = id === "opencode" ? "mcp" : "mcpServers"
            const raw = original ?? (id === "codex" ? "" : "{}")

            const config =
              id === "codex" ? tomlConfig(raw) : jsonConfig(raw, container)

            const current = config.servers[serverKey]

            if (
              current !== undefined &&
              receipt?.entry !== fingerprint(current)
            )
              throw new Error(
                "Existing entry is not owned or changed outside this app",
              )

            if (!install && current === undefined) return this.statusValue(id)
            const expected = this.entry(id)

            if (
              install &&
              current !== undefined &&
              fingerprint(current) === fingerprint(expected)
            )
              return this.statusValue(id)
            let next: string
            let blockHash: string | null = null

            const createdContainer =
              receipt?.createdContainer ??
              (id !== "codex" && !jsonConfig(raw, container).field)

            let separator = receipt?.separator ?? ""

            if (id === "codex") {
              const toml = tomlConfig(raw)
              let base = raw

              if (current !== undefined) {
                if (toml.start < 0 || !receipt)
                  throw new Error("Managed block missing")
                const block = raw.slice(toml.start, toml.end)
                const parsed = tomlConfig(block)

                if (
                  parsed.serverCount !== 1 ||
                  fingerprint(parsed.servers[serverKey]) !== receipt.entry ||
                  fingerprint(block) !== receipt.block
                )
                  throw new Error("Managed block changed")
                const before = raw.slice(0, toml.start)

                if (separator && !before.endsWith(separator))
                  throw new Error("Managed block boundary changed")
                base =
                  before.slice(0, before.length - separator.length) +
                  raw.slice(toml.end + (raw[toml.end] === "\n" ? 1 : 0))
              } else if (toml.start >= 0)
                throw new Error("Unowned managed block exists")
              separator = base && !base.endsWith("\n") ? "\n" : ""
              const block = `${startMarker}\n[mcp_servers.${serverKey}]\ncommand = ${JSON.stringify(this.runtime.command)}\nargs = ${JSON.stringify(this.runtime.args)}\n${endMarker}\n`
              next = install ? base + separator + block : base
              blockHash = fingerprint(block.slice(0, -1))
              tomlConfig(next)
            } else {
              let base = raw
              const parsed = jsonConfig(base, container)

              if (current !== undefined && parsed.field)
                base = removeMember(base, parsed.field.valueStart, serverKey)
              const remaining = jsonConfig(base, container)

              if (install)
                next = remaining.field
                  ? insertMember(
                      base,
                      remaining.field.valueStart,
                      serverKey,
                      expected,
                    )
                  : insertMember(base, base.indexOf("{"), container, {
                      [serverKey]: expected,
                    })
              else
                next =
                  createdContainer &&
                  remaining.field &&
                  Object.keys(remaining.servers).length === 0
                    ? removeMember(base, base.indexOf("{"), container)
                    : base
              jsonConfig(next, container)
            }

            if (readOptional(path) !== original)
              throw new Error("Config conflict")

            // Save ownership first. A failed config write cannot claim a different entry.
            if (install)
              save(
                receiptPath,
                JSON.stringify({
                  version: 1,
                  entry: fingerprint(expected),
                  separator,
                  createdContainer,
                  block: blockHash,
                }),
              )
            save(path, next)

            if (!install) rmSync(receiptPath, { force: true })

            return this.statusValue(id)
          },
          catch: configError,
        }),
      ({ fd, lock }) =>
        Effect.try({
          try: () => {
            closeSync(fd)
            rmSync(lock, { force: true })
          },
          catch: configError,
        }),
    )
  }
}

// Source: src/mcp/instructions.ts. Instructions do not depend on application identity.
export const MCP_DEFAULT_INSTRUCTIONS = `You work with a user's Markdown vault. Treat it as a shared filesystem.
Call vault_info first. Use returned paths verbatim. Never add an inbox prefix.
Read notes before edits. Preserve frontmatter, unknown content, and the user's voice.
Match the note shape to its subject: course, reference, procedure, plan, meeting, journal, essay, list, or glossary.
Use wikilinks for related notes. Keep tags scarce. Group multi-note sets under one folder with an index.
Prefer append_to_note, prepend_to_note, and replace_in_note for small edits. Use create_note for new notes.
Use native math and diagram renderers when available. Never claim an unsupported renderer exists.
Use returned links verbatim when you present note titles. Check backlinks before renames.
Use task ids from list_tasks. Use comment threads for discussion; edit bodies only when asked.
Prefer reversible trash. Ask for explicit confirmation before permanent deletion.
`

const instructionSchema = Schema.NullOr(
  Schema.String.check(Schema.isMaxLength(256 * 1024)),
)

const decodeInstruction = Schema.decodeUnknownSync(instructionSchema)

export class McpInstructions {
  readonly path: string
  constructor(directory: string) {
    this.path = join(resolve(directory), "mcp-instructions.md")
  }
  read() {
    return Effect.try({
      try: () => {
        const raw = readOptional(this.path)
        decodeInstruction(raw)
        const custom = raw?.trim() ? raw : null

        return {
          custom,
          effective: custom ?? MCP_DEFAULT_INSTRUCTIONS,
          defaults: MCP_DEFAULT_INSTRUCTIONS,
        }
      },
      catch: configError,
    })
  }
  write(value: string | null) {
    return Effect.try({
      try: () => {
        const next = decodeInstruction(value)
        save(
          this.path,
          next?.trim() ? (next.endsWith("\n") ? next : `${next}\n`) : "",
        )
      },
      catch: configError,
    }).pipe(Effect.flatMap(() => this.read()))
  }
}

const textSchema = Schema.String.pipe(
  Schema.decodeTo(Schema.String, SchemaTransformation.trim()),
).check(Schema.isMinLength(1), Schema.isMaxLength(2048))

export const mcpPathSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2048),
  Schema.makeFilter(
    (value) =>
      !isAbsolute(value) &&
      !/[\\:\p{Cc}]/u.test(value) &&
      value
        .split("/")
        .every(
          (part) =>
            part.length > 0 &&
            part !== "." &&
            part !== ".." &&
            !part.startsWith("."),
        ),
    { message: "Unsafe vault-relative POSIX path" },
  ),
)

const folderSchema = Schema.Literals(["inbox", "quick", "archive", "trash"])

const liveFolderSchema = Schema.Literals(["inbox", "quick", "archive"])

const bodySchema = Schema.String.check(Schema.isMaxLength(2 * 1024 * 1024))

const limitSchema = Schema.optional(
  Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(10000)),
)

const pathArgs = Schema.Struct({ path: mcpPathSchema }).mapFields(
  Struct.map(Schema.mutableKey),
)

const queryArgs = Schema.Struct({
  query: textSchema,
  limit: limitSchema,
}).mapFields(Struct.map(Schema.mutableKey))

const commentId = textSchema

const taskIdSchema = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      const split = value.lastIndexOf("#")

      return (
        split > 0 &&
        Schema.is(mcpPathSchema)(value.slice(0, split)) &&
        /^\d+$/.test(value.slice(split + 1))
      )
    },
    { message: "Invalid task id" },
  ),
)

const dateSchema = Schema.String.check(
  Schema.isPattern(
    /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))$/,
    { expected: "an ISO calendar date" },
  ),
)

// Exact tool names and argument names from apps/desktop/src/mcp/server.ts.
export const MCP_TOOL_SCHEMAS = {
  vault_info: Schema.Record(Schema.String, Schema.Never),
  list_notes: Schema.Struct({
    folder: Schema.optional(folderSchema),
    subpath: Schema.optional(mcpPathSchema),
    tag: Schema.optional(textSchema),
    wikilinkTo: Schema.optional(textSchema),
    updatedSinceMs: Schema.optional(
      Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
    limit: limitSchema,
  })
    .mapFields(Struct.map(Schema.mutableKey))
    .check(
      Schema.makeFilter(
        (value) => !value.subpath || value.folder !== undefined,
        { message: "subpath requires folder" },
      ),
    ),
  list_folders: Schema.Record(Schema.String, Schema.Never),
  list_assets: Schema.Record(Schema.String, Schema.Never),
  read_note: pathArgs,
  write_note: Schema.Struct({
    path: mcpPathSchema,
    body: bodySchema,
  }).mapFields(Struct.map(Schema.mutableKey)),
  create_note: Schema.Struct({
    folder: Schema.optional(liveFolderSchema),
    title: Schema.optional(textSchema),
    subpath: Schema.optional(mcpPathSchema),
    body: Schema.optional(bodySchema),
  }).mapFields(Struct.map(Schema.mutableKey)),
  rename_note: Schema.Struct({
    path: mcpPathSchema,
    newTitle: textSchema,
  }).mapFields(Struct.map(Schema.mutableKey)),
  move_note: Schema.Struct({
    path: mcpPathSchema,
    targetFolder: folderSchema,
    targetSubpath: Schema.optional(mcpPathSchema),
  }).mapFields(Struct.map(Schema.mutableKey)),
  duplicate_note: pathArgs,
  move_to_trash: pathArgs,
  restore_from_trash: pathArgs,
  empty_trash: Schema.Struct({ confirm: Schema.Literal(true) }).mapFields(
    Struct.map(Schema.mutableKey),
  ),
  delete_note: Schema.Struct({
    path: mcpPathSchema,
    confirm: Schema.Literal(true),
  }).mapFields(Struct.map(Schema.mutableKey)),
  archive_note: pathArgs,
  unarchive_note: pathArgs,
  create_folder: Schema.Struct({
    folder: liveFolderSchema,
    subpath: mcpPathSchema,
  }).mapFields(Struct.map(Schema.mutableKey)),
  rename_folder: Schema.Struct({
    folder: liveFolderSchema,
    oldSubpath: mcpPathSchema,
    newSubpath: mcpPathSchema,
  }).mapFields(Struct.map(Schema.mutableKey)),
  delete_folder: Schema.Struct({
    folder: liveFolderSchema,
    subpath: mcpPathSchema,
    confirm: Schema.Literal(true),
  }).mapFields(Struct.map(Schema.mutableKey)),
  search_text: queryArgs,
  search_by_title: queryArgs,
  search_by_tag: Schema.Struct({
    tag: textSchema,
    limit: limitSchema,
  }).mapFields(Struct.map(Schema.mutableKey)),
  list_tags: Schema.Record(Schema.String, Schema.Never),
  backlinks: pathArgs,
  list_tasks: Schema.Struct({
    status: Schema.optional(
      Schema.Literals(["open", "done", "waiting", "all"]),
    ),
    priority: Schema.optional(Schema.Literals(["high", "med", "low"])),
    dueBefore: Schema.optional(dateSchema),
    dueAfter: Schema.optional(dateSchema),
    tag: Schema.optional(textSchema),
    folder: Schema.optional(liveFolderSchema),
    tags: Schema.optional(
      Schema.mutable(Schema.Array(textSchema)).check(Schema.isMaxLength(100)),
    ),
    includeExcluded: Schema.optional(Schema.Boolean),
  }).mapFields(Struct.map(Schema.mutableKey)),
  toggle_task: Schema.Struct({ id: taskIdSchema }).mapFields(
    Struct.map(Schema.mutableKey),
  ),
  append_to_note: Schema.Struct({
    path: mcpPathSchema,
    text: bodySchema.check(Schema.isMinLength(1)),
  }).mapFields(Struct.map(Schema.mutableKey)),
  prepend_to_note: Schema.Struct({
    path: mcpPathSchema,
    text: bodySchema.check(Schema.isMinLength(1)),
  }).mapFields(Struct.map(Schema.mutableKey)),
  insert_at_line: Schema.Struct({
    path: mcpPathSchema,
    lineNumber: Schema.Natural,
    text: bodySchema.check(Schema.isMinLength(1)),
  }).mapFields(Struct.map(Schema.mutableKey)),
  replace_in_note: Schema.Struct({
    path: mcpPathSchema,
    find: bodySchema.check(Schema.isMinLength(1)),
    replace: bodySchema,
    occurrence: Schema.optional(Schema.Literals(["first", "all"])),
  }).mapFields(Struct.map(Schema.mutableKey)),
  list_comments: Schema.Struct({
    path: mcpPathSchema,
    include_resolved: Schema.optional(Schema.Boolean),
  }).mapFields(Struct.map(Schema.mutableKey)),
  add_comment: Schema.Struct({
    path: mcpPathSchema,
    body: bodySchema.check(Schema.isMinLength(1)),
    anchor_text: Schema.optional(bodySchema),
    author: Schema.optional(textSchema),
  }).mapFields(Struct.map(Schema.mutableKey)),
  reply_to_comment: Schema.Struct({
    path: mcpPathSchema,
    id: commentId,
    body: bodySchema.check(Schema.isMinLength(1)),
    author: Schema.optional(textSchema),
  }).mapFields(Struct.map(Schema.mutableKey)),
  resolve_comment: Schema.Struct({
    path: mcpPathSchema,
    id: commentId,
    resolved: Schema.optional(Schema.Boolean),
  }).mapFields(Struct.map(Schema.mutableKey)),
}

export type McpToolName = keyof typeof MCP_TOOL_SCHEMAS

const toolDescriptions: Record<McpToolName, string> = {
  vault_info:
    "Describe the current vault, its folder layout, and primaryNotesLocation. Call first. Never add inbox/ to returned paths.",
  list_notes:
    "List metadata, tags, wikilinks, excerpts, timestamps, canonical paths and links. Filter by folder, subpath, tag, wikilinkTo, or updatedSinceMs. Exclude trash unless requested. Default limit 200; tags exclude templates.",
  list_folders: "List subfolders grouped by top-level folder.",
  list_assets:
    "List attachment files, including images, PDFs, audio, video, and other binaries.",
  read_note:
    "Read full Markdown body and metadata. Read before editing. Use the canonical path unchanged.",
  write_note:
    "Overwrite an existing note's full body. Preserve frontmatter. Prefer incremental tools unless the user requested a rewrite.",
  create_note:
    "Create a note with a collision-safe filename. Default folder inbox, title Untitled, body a title heading. Return its canonical path; never reconstruct it from folder and title.",
  rename_note:
    "Rename a note in its current folder. Check backlinks first; renames can leave unresolved wikilinks.",
  move_note:
    "Move to targetFolder and optional targetSubpath. Prefer archive_note, unarchive_note, and move_to_trash for special destinations.",
  duplicate_note:
    "Duplicate beside the source with a copy suffix and a non-conflicting filename.",
  move_to_trash: "Move to trash. Reversible through restore_from_trash.",
  restore_from_trash: "Restore a trashed note to inbox.",
  empty_trash:
    "Permanently delete all trash. Ask the user first; confirm must be true.",
  delete_note:
    "Permanently delete one note. Prefer move_to_trash. Ask the user first; confirm must be true.",
  archive_note: "Move a note to archive.",
  unarchive_note: "Move an archived note back to inbox.",
  create_folder:
    "Create a subfolder in inbox, quick, or archive. Refuse trash.",
  rename_folder: "Rename or move a subfolder within its top-level folder.",
  delete_folder:
    "Delete a subfolder and its contents. Ask the user first; confirm must be true.",
  search_text:
    "Search live note text, excluding templates. Return path, line number, and preview. Default limit 80.",
  search_by_title:
    "Find live notes by case-insensitive title substring, newest first. Default limit 20.",
  search_by_tag:
    "Find live notes with a case-insensitive tag, with or without #. Exclude templates. Default limit 200.",
  list_tags:
    "Count notes per case-insensitive tag. Exclude trash and templates. Sort by count, then tag.",
  backlinks:
    "Find notes with wikilinks to the target note. Check before rename.",
  list_tasks:
    "List Markdown tasks and stable path#index ids. Default state open; exclude checked, waiting, forwarded, and cancelled tasks. Filter by priority, date, tags, or folder. dueBefore is exclusive; dueAfter inclusive. Include excluded task sources only when requested.",
  toggle_task:
    "Toggle a task by its stable path#index id from list_tasks. Return the updated task, or null after content drift.",
  append_to_note:
    "Append Markdown with a blank line separator when needed. Prefer for logs and incremental entries.",
  prepend_to_note: "Insert Markdown at the start, after any frontmatter.",
  insert_at_line:
    "Insert text before a zero-based lineNumber from read_note or list_tasks.",
  replace_in_note:
    "Literal find and replace. Default occurrence first; all replaces every match. Return replacement count.",
  list_comments:
    "Read comment threads, anchors, authors, and replies. Exclude resolved threads unless include_resolved is true.",
  add_comment:
    "Create a comment thread. Optional anchor_text must match the note verbatim. Default author is the connected client.",
  reply_to_comment:
    "Reply to a thread or reply id from list_comments. Keep its anchor. Default author is the connected client.",
  resolve_comment:
    "Resolve a thread; resolved false reopens it. Default true. Resolve only when the user asks or discussion is settled.",
}

export type McpToolCall = {
  [K in McpToolName]: {
    name: K
    arguments: (typeof MCP_TOOL_SCHEMAS)[K]["Type"]
  }
}[McpToolName]

export interface McpToolContext {
  signal: AbortSignal
  clientName: string
  access: "read" | "comment" | "write"
}

export interface McpVaultAdapter {
  /** Enforce symlink containment, atomic saves, and vault identity in the adapter. */
  execute<K extends McpToolName>(
    name: K,
    args: (typeof MCP_TOOL_SCHEMAS)[K]["Type"],
    context: McpToolContext,
  ): Promise<typeof jsonValueSchema.Type>
}

const readTools = new Set<McpToolName>([
  "vault_info",
  "list_notes",
  "list_folders",
  "list_assets",
  "read_note",
  "search_text",
  "search_by_title",
  "search_by_tag",
  "list_tags",
  "backlinks",
  "list_tasks",
  "list_comments",
])

const commentTools = new Set<McpToolName>([
  "add_comment",
  "reply_to_comment",
  "resolve_comment",
])

const toolNameSchema = Schema.Literals([
  "vault_info",
  "list_notes",
  "list_folders",
  "list_assets",
  "read_note",
  "write_note",
  "create_note",
  "rename_note",
  "move_note",
  "duplicate_note",
  "move_to_trash",
  "restore_from_trash",
  "empty_trash",
  "delete_note",
  "archive_note",
  "unarchive_note",
  "create_folder",
  "rename_folder",
  "delete_folder",
  "search_text",
  "search_by_title",
  "search_by_tag",
  "list_tags",
  "backlinks",
  "list_tasks",
  "toggle_task",
  "append_to_note",
  "prepend_to_note",
  "insert_at_line",
  "replace_in_note",
  "list_comments",
  "add_comment",
  "reply_to_comment",
  "resolve_comment",
])

const rpcIdSchema = Schema.Union([
  Schema.String.check(Schema.isMaxLength(256)),
  Schema.Int,
])

const requestSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(rpcIdSchema),
  method: Schema.NonEmptyString,
  params: Schema.optional(Schema.Unknown),
})

const initializeSchema = Schema.Struct({
  protocolVersion: Schema.String,
  capabilities: objectSchema,
  clientInfo: Schema.Struct({ name: textSchema, version: textSchema }),
})

const callSchema = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optional(objectSchema),
  _meta: Schema.optional(objectSchema),
})

const cancelSchema = Schema.Struct({
  requestId: rpcIdSchema,
  reason: Schema.optional(Schema.String),
})

const decodeRequest = Schema.decodeUnknownResult(requestSchema, {
  onExcessProperty: "error",
})

const decodeInitialize = Schema.decodeUnknownResult(initializeSchema)

const decodeCall = Schema.decodeUnknownResult(callSchema, {
  onExcessProperty: "error",
})

const decodeCancel = Schema.decodeUnknownResult(cancelSchema)

const decodeToolName = Schema.decodeUnknownSync(toolNameSchema)

const decodeEmptyParams = Schema.decodeUnknownResult(
  Schema.Record(Schema.String, Schema.Never),
  { onExcessProperty: "error" },
)

function toolInputSchema(name: McpToolName) {
  // Use the type AST to keep optional JSON fields absent, not nullable.
  const document = SchemaRepresentation.toJsonSchemaDocument(
    SchemaRepresentation.toRepresentation(
      Schema.toType(MCP_TOOL_SCHEMAS[name]).ast,
    ),
    { onExcessProperty: "error" },
  )

  return { ...document.schema, $defs: document.definitions }
}

const supportedProtocols = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]

export interface McpStdioOptions {
  input: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>
  output(line: string): Promise<void>
  adapter: McpVaultAdapter
  instructions?: string
  access?: "read" | "comment" | "write"
  supportedTools?: readonly McpToolName[]
}

export class McpStdioError extends Schema.TaggedError<McpStdioError>()(
  "McpStdioError",
  { operation: Schema.Literals(["input", "output"]), cause: Schema.Defect() },
) {}

export function runMcpStdio(options: McpStdioOptions) {
  return Effect.scoped(
    Effect.gen(function* () {
      const access = options.access ?? "write"

      const supported = new Set(
        options.supportedTools ?? toolNameSchema.literals,
      )

      const offered = toolNameSchema.literals.filter(
        (name) =>
          supported.has(name) &&
          (access === "write" ||
            readTools.has(name) ||
            (access === "comment" && commentTools.has(name))),
      )

      const outputPermit = yield* Semaphore.make(1)
      const failed = yield* Deferred.make<never, McpStdioError>()
      let firstFailure: McpStdioError | undefined
      const pending = new Map<string | number, AbortController>()
      const tasks = new Map<symbol, Fiber.Fiber<void, McpStdioError>>()
      let initialized = false
      let ready = false
      let clientName = "Assistant"
      let buffer = ""
      const decoder = new TextDecoder("utf-8", { fatal: true })

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const controller of pending.values()) controller.abort()
        }),
      )

      function send<T extends object>(value: T) {
        return Semaphore.withPermit(outputPermit)(
          Effect.tryPromise({
            try: () => options.output(`${JSON.stringify(value)}\n`),
            catch: (cause) => new McpStdioError({ operation: "output", cause }),
          }),
        )
      }

      function rpcError(
        id: string | number | null,
        code: number,
        message: string,
      ) {
        return send({ jsonrpc: "2.0", id, error: { code, message } })
      }

      function handle(line: string) {
        return Effect.gen(function* () {
          let raw: unknown

          try {
            raw = JSON.parse(line)
          } catch {
            yield* rpcError(null, -32700, "Parse error")

            return
          }

          const parsed = decodeRequest(raw)

          if (Result.isFailure(parsed)) {
            yield* rpcError(null, -32600, "Invalid request")

            return
          }

          const { id, method, params } = parsed.success

          if (id === undefined) {
            if (method === "notifications/initialized" && initialized)
              ready = true

            if (method === "notifications/cancelled") {
              const cancelled = decodeCancel(params)

              if (Result.isSuccess(cancelled))
                pending.get(cancelled.success.requestId)?.abort()
            }

            return
          }

          if (pending.has(id)) {
            yield* rpcError(id, -32600, "Request id already active")

            return
          }

          if (method === "initialize") {
            const init = decodeInitialize(params)

            if (initialized || Result.isFailure(init)) {
              yield* rpcError(id, -32602, "Invalid initialization")

              return
            }

            initialized = true
            clientName = init.success.clientInfo.name
            yield* send({
              jsonrpc: "2.0",
              id,
              result: {
                protocolVersion: supportedProtocols.includes(
                  init.success.protocolVersion,
                )
                  ? init.success.protocolVersion
                  : supportedProtocols[0],
                capabilities: { tools: {} },
                serverInfo: { name: "still-notes", version: "0.1.0" },
                instructions: options.instructions ?? MCP_DEFAULT_INSTRUCTIONS,
              },
            })

            return
          }

          if (method === "ping") {
            yield* send({ jsonrpc: "2.0", id, result: {} })

            return
          }

          if (!ready) {
            yield* rpcError(id, -32002, "Server not initialized")

            return
          }

          if (method === "tools/list") {
            if (
              params !== undefined &&
              Result.isFailure(decodeEmptyParams(params))
            ) {
              yield* rpcError(id, -32602, "Invalid params")

              return
            }

            yield* send({
              jsonrpc: "2.0",
              id,
              result: {
                tools: offered.map((name) => ({
                  name,
                  description: toolDescriptions[name],
                  inputSchema: toolInputSchema(name),
                  annotations: {
                    readOnlyHint: readTools.has(name),
                    destructiveHint:
                      !readTools.has(name) && !commentTools.has(name),
                  },
                })),
              },
            })

            return
          }

          if (method !== "tools/call") {
            yield* rpcError(id, -32601, "Method not found")

            return
          }

          const call = decodeCall(params)

          if (Result.isFailure(call)) {
            yield* rpcError(id, -32602, "Invalid tool call params")

            return
          }

          const controller = new AbortController()
          pending.set(id, controller)

          const cancelled = Effect.callback<never, Error>((resume) => {
            function abort() {
              resume(Effect.fail(new Error("Request cancelled")))
            }

            if (controller.signal.aborted) abort()
            else
              controller.signal.addEventListener("abort", abort, { once: true })

            return Effect.sync(() =>
              controller.signal.removeEventListener("abort", abort),
            )
          })

          const execute = Effect.gen(function* () {
            const { name, args } = yield* Effect.try({
              try: () => {
                const name = decodeToolName(call.success.name)

                if (!offered.includes(name))
                  throw new Error("Unknown or unavailable tool")

                const args = Schema.decodeUnknownSync(MCP_TOOL_SCHEMAS[name], {
                  onExcessProperty: "error",
                })(call.success.arguments ?? {})

                return { name, args }
              },
              catch: (error) => error,
            })

            yield* Effect.yieldNow

            const value = yield* Effect.tryPromise({
              try: () => {
                controller.signal.throwIfAborted()

                return options.adapter.execute(name, args, {
                  signal: controller.signal,
                  clientName,
                  access,
                })
              },
              catch: (error) => error,
            })

            return yield* Effect.try({
              try: () => {
                controller.signal.throwIfAborted()

                return decodeJson(value)
              },
              catch: (error) => error,
            })
          })

          yield* Effect.raceFirst(execute, cancelled).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                controller.signal.aborted
                  ? rpcError(
                      id,
                      -32800,
                      "Request cancelled; inspect vault before retrying",
                    )
                  : send({
                      jsonrpc: "2.0",
                      id,
                      result: {
                        content: [
                          {
                            type: "text",
                            text:
                              error instanceof Error
                                ? error.message
                                : "Tool failed",
                          },
                        ],
                        isError: true,
                      },
                    }),
              onSuccess: (result) =>
                send({
                  jsonrpc: "2.0",
                  id,
                  result: {
                    content: [
                      {
                        type: "text",
                        text: Schema.is(Schema.String)(result)
                          ? result
                          : JSON.stringify(result ?? null),
                      },
                    ],
                    isError: false,
                  },
                }),
            }),
            Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
            Effect.ensuring(
              Effect.sync(() => {
                pending.delete(id)
              }),
            ),
          )
        })
      }

      function startLine(line: string) {
        return Effect.gen(function* () {
          const key = Symbol()
          let complete = false

          const task = handle(line).pipe(
            Effect.tapError((error) =>
              Effect.gen(function* () {
                firstFailure ??= error
                yield* Deferred.fail(failed, error)
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                complete = true
                tasks.delete(key)
              }),
            ),
            Effect.forkChild({ startImmediately: true }),
          )

          const fiber = yield* task

          if (!complete) tasks.set(key, fiber)
        })
      }

      const source = options.input

      const input =
        source instanceof ReadableStream
          ? Stream.fromReadableStream({
              evaluate: () => source,
              onError: (cause) =>
                new McpStdioError({ operation: "input", cause }),
            })
          : Stream.fromAsyncIterable(
              source,
              (cause) => new McpStdioError({ operation: "input", cause }),
            )

      const consume = Effect.gen(function* () {
        yield* input.pipe(
          Stream.mapEffect((chunk) =>
            Effect.gen(function* () {
              try {
                buffer += decoder.decode(chunk, { stream: true })
              } catch {
                buffer = ""
                yield* rpcError(null, -32700, "Invalid UTF-8")

                return false
              }

              if (buffer.length > 4 * 1024 * 1024) {
                yield* rpcError(null, -32600, "Input frame too large")
                buffer = ""

                return true
              }

              let newline = buffer.indexOf("\n")

              while (newline >= 0) {
                const line = buffer.slice(0, newline).replace(/\r$/, "")
                buffer = buffer.slice(newline + 1)

                if (line.trim()) yield* startLine(line)
                newline = buffer.indexOf("\n")
              }

              return false
            }),
          ),
          Stream.takeUntil((oversized) => oversized),
          Stream.runDrain,
        )

        try {
          buffer += decoder.decode()
        } catch {
          buffer = ""
          yield* rpcError(null, -32700, "Invalid UTF-8")
        }

        if (buffer.trim()) yield* startLine(buffer)
        yield* Effect.forEach(tasks.values(), Fiber.join, { discard: true })

        if (firstFailure) return yield* Effect.fail(firstFailure)
      })

      yield* Effect.raceFirst(consume, Deferred.await(failed))
    }),
  )
}
