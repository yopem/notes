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
import { z } from "zod"

import { atomicWrite } from "@/utils/files"

// Source: apps/desktop/src/main/mcp-integrations.ts and src/mcp/server.ts.
const clientSchema = z.enum([
  "claude-code",
  "claude-desktop",
  "codex",
  "opencode",
])

export type McpClientId = z.infer<typeof clientSchema>

const rootsSchema = z.strictObject({
  home: z.string().min(1),
  config: z.string().min(1),
  platform: z.enum(["linux", "darwin", "win32"]),
  appData: z.string().min(1).optional(),
})

const runtimeSchema = z.strictObject({
  command: z
    .string()
    .min(1)
    .refine(isAbsolute, "Use an absolute executable path"),
  args: z.array(z.string()).max(100),
})

const jsonValueSchema = z.json()

const objectSchema = z.record(z.string(), jsonValueSchema)

const receiptSchema = z.strictObject({
  version: z.literal(1),
  entry: z.string(),
  separator: z.string(),
  createdContainer: z.boolean(),
  block: z.string().nullable(),
})

const errorSchema = z.object({ code: z.string() })

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
      if (errorSchema.safeParse(error).data?.code !== "ENOENT") throw error
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
    if (errorSchema.safeParse(error).data?.code === "ENOENT") return null
    throw error
  }
}

function save(path: string, bytes: string) {
  safeFile(path)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  atomicWrite(path, bytes, dirname(path))
}

function fingerprint(value: z.infer<typeof jsonValueSchema> | undefined) {
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
    const key = z.string().parse(JSON.parse(raw.slice(keyStart, index)))
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
  value: z.infer<typeof jsonValueSchema>,
) {
  return (
    raw.slice(0, objectStart + 1) +
    `${JSON.stringify(key)}:${JSON.stringify(value)}${members(raw, objectStart).length ? "," : ""}` +
    raw.slice(objectStart + 1)
  )
}

function jsonConfig(raw: string, container: string) {
  const object = objectSchema.parse(JSON.parse(raw))
  // Duplicate member names are ambiguous. Do not edit such a document.
  const top = members(raw, raw.indexOf("{"))

  if (new Set(top.map((field) => field.key)).size !== top.length)
    throw new Error("Duplicate config keys")
  const field = top.find((item) => item.key === container)

  const servers =
    object[container] === undefined ? {} : objectSchema.parse(object[container])

  if (field) {
    const fields = members(raw, field.valueStart)

    if (new Set(fields.map((item) => item.key)).size !== fields.length)
      throw new Error("Duplicate server keys")
  }

  return { object, servers, field }
}

function tomlConfig(raw: string) {
  const object = objectSchema.parse(Bun.TOML.parse(raw))

  const servers =
    object.mcp_servers === undefined
      ? {}
      : objectSchema.parse(object.mcp_servers)

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

  return { servers, start, end: end + endMarker.length }
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
  private readonly roots: z.infer<typeof rootsSchema>
  private readonly runtime: z.infer<typeof runtimeSchema>
  constructor(
    roots: z.input<typeof rootsSchema>,
    runtime: z.input<typeof runtimeSchema>,
  ) {
    this.roots = rootsSchema.parse(roots)
    this.runtime = runtimeSchema.parse(runtime)

    if (!isAbsolute(this.roots.home) || !isAbsolute(this.roots.config))
      throw new Error("Use absolute config roots")
  }
  private path(id: McpClientId) {
    clientSchema.parse(id)
    const { home, config, platform, appData } = this.roots

    if (id === "claude-code") return join(home, ".claude.json")

    if (id === "codex") return join(home, ".codex", "config.toml")

    if (id === "opencode") return join(config, "opencode", "opencode.json")

    const base =
      platform === "darwin"
        ? join(home, "Library", "Application Support")
        : platform === "win32"
          ? (appData ?? join(home, "AppData", "Roaming"))
          : config

    return join(base, "Claude", "claude_desktop_config.json")
  }
  private entry(id: McpClientId): z.infer<typeof jsonValueSchema> {
    return id === "opencode"
      ? {
          type: "local",
          command: [this.runtime.command, ...this.runtime.args],
          enabled: true,
        }
      : { command: this.runtime.command, args: this.runtime.args }
  }
  status(id: McpClientId): McpClientStatus {
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
          : receiptSchema.parse(JSON.parse(receipt)).entry ===
            fingerprint(entry)

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
    return clientSchema.options.map((id) => this.status(id))
  }
  install(id: McpClientId) {
    return this.change(id, true)
  }
  uninstall(id: McpClientId) {
    return this.change(id, false)
  }
  private change(id: McpClientId, install: boolean) {
    const path = this.path(id)
    safeFile(path)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const lock = `${path}.still-notes-mcp.lock`
    safeFile(lock)
    const fd = openSync(lock, "wx", 0o600)

    try {
      const original = readOptional(path)
      const receiptPath = `${path}.still-notes-mcp.json`
      const receiptRaw = readOptional(receiptPath)

      const receipt =
        receiptRaw === null ? null : receiptSchema.parse(JSON.parse(receiptRaw))

      const container = id === "opencode" ? "mcp" : "mcpServers"
      const raw = original ?? (id === "codex" ? "" : "{}")

      const config =
        id === "codex" ? tomlConfig(raw) : jsonConfig(raw, container)

      const current = config.servers[serverKey]

      if (
        current !== undefined &&
        (!receipt || receipt.entry !== fingerprint(current))
      )
        throw new Error(
          "Existing entry is not owned or changed outside this app",
        )

      if (!install && current === undefined) return this.status(id)
      const expected = this.entry(id)

      if (
        install &&
        current !== undefined &&
        fingerprint(current) === fingerprint(expected)
      )
        return this.status(id)
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
            Object.keys(parsed.servers).length !== 1 ||
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

      if (readOptional(path) !== original) throw new Error("Config conflict")

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

      return this.status(id)
    } finally {
      closeSync(fd)
      rmSync(lock, { force: true })
    }
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

const instructionSchema = z
  .string()
  .max(256 * 1024)
  .nullable()

export class McpInstructions {
  readonly path: string
  constructor(directory: string) {
    this.path = join(resolve(directory), "mcp-instructions.md")
  }
  read() {
    const raw = readOptional(this.path)
    instructionSchema.parse(raw)
    const custom = raw?.trim() ? raw : null

    return {
      custom,
      effective: custom ?? MCP_DEFAULT_INSTRUCTIONS,
      defaults: MCP_DEFAULT_INSTRUCTIONS,
    }
  }
  write(value: string | null) {
    const next = instructionSchema.parse(value)
    save(
      this.path,
      next?.trim() ? (next.endsWith("\n") ? next : `${next}\n`) : "",
    )

    return this.read()
  }
}

const textSchema = z.string().trim().min(1).max(2048)

export const mcpPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
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
    "Unsafe vault-relative POSIX path",
  )

const folderSchema = z.enum(["inbox", "quick", "archive", "trash"])

const liveFolderSchema = z.enum(["inbox", "quick", "archive"])

const bodySchema = z.string().max(2 * 1024 * 1024)

const limitSchema = z.number().int().positive().max(10000).optional()

const pathArgs = z.strictObject({ path: mcpPathSchema })

const queryArgs = z.strictObject({ query: textSchema, limit: limitSchema })

const commentId = textSchema

const taskIdSchema = z.string().refine((value) => {
  const split = value.lastIndexOf("#")

  return (
    split > 0 &&
    mcpPathSchema.safeParse(value.slice(0, split)).success &&
    /^\d+$/.test(value.slice(split + 1))
  )
}, "Invalid task id")

// Exact tool names and argument names from apps/desktop/src/mcp/server.ts.
export const MCP_TOOL_SCHEMAS = {
  vault_info: z.strictObject({}),
  list_notes: z
    .strictObject({
      folder: folderSchema.optional(),
      subpath: mcpPathSchema.optional(),
      tag: textSchema.optional(),
      wikilinkTo: textSchema.optional(),
      updatedSinceMs: z.number().finite().nonnegative().optional(),
      limit: limitSchema,
    })
    .refine(
      (value) => !value.subpath || value.folder !== undefined,
      "subpath requires folder",
    ),
  list_folders: z.strictObject({}),
  list_assets: z.strictObject({}),
  read_note: pathArgs,
  write_note: z.strictObject({ path: mcpPathSchema, body: bodySchema }),
  create_note: z.strictObject({
    folder: liveFolderSchema.optional(),
    title: textSchema.optional(),
    subpath: mcpPathSchema.optional(),
    body: bodySchema.optional(),
  }),
  rename_note: z.strictObject({ path: mcpPathSchema, newTitle: textSchema }),
  move_note: z.strictObject({
    path: mcpPathSchema,
    targetFolder: folderSchema,
    targetSubpath: mcpPathSchema.optional(),
  }),
  duplicate_note: pathArgs,
  move_to_trash: pathArgs,
  restore_from_trash: pathArgs,
  empty_trash: z.strictObject({ confirm: z.literal(true) }),
  delete_note: z.strictObject({
    path: mcpPathSchema,
    confirm: z.literal(true),
  }),
  archive_note: pathArgs,
  unarchive_note: pathArgs,
  create_folder: z.strictObject({
    folder: liveFolderSchema,
    subpath: mcpPathSchema,
  }),
  rename_folder: z.strictObject({
    folder: liveFolderSchema,
    oldSubpath: mcpPathSchema,
    newSubpath: mcpPathSchema,
  }),
  delete_folder: z.strictObject({
    folder: liveFolderSchema,
    subpath: mcpPathSchema,
    confirm: z.literal(true),
  }),
  search_text: queryArgs,
  search_by_title: queryArgs,
  search_by_tag: z.strictObject({ tag: textSchema, limit: limitSchema }),
  list_tags: z.strictObject({}),
  backlinks: pathArgs,
  list_tasks: z.strictObject({
    status: z.enum(["open", "done", "waiting", "all"]).optional(),
    priority: z.enum(["high", "med", "low"]).optional(),
    dueBefore: z.iso.date().optional(),
    dueAfter: z.iso.date().optional(),
    tag: textSchema.optional(),
    folder: liveFolderSchema.optional(),
    tags: z.array(textSchema).max(100).optional(),
    includeExcluded: z.boolean().optional(),
  }),
  toggle_task: z.strictObject({ id: taskIdSchema }),
  append_to_note: z.strictObject({
    path: mcpPathSchema,
    text: bodySchema.min(1),
  }),
  prepend_to_note: z.strictObject({
    path: mcpPathSchema,
    text: bodySchema.min(1),
  }),
  insert_at_line: z.strictObject({
    path: mcpPathSchema,
    lineNumber: z.number().int().nonnegative(),
    text: bodySchema.min(1),
  }),
  replace_in_note: z.strictObject({
    path: mcpPathSchema,
    find: bodySchema.min(1),
    replace: bodySchema,
    occurrence: z.enum(["first", "all"]).optional(),
  }),
  list_comments: z.strictObject({
    path: mcpPathSchema,
    include_resolved: z.boolean().optional(),
  }),
  add_comment: z.strictObject({
    path: mcpPathSchema,
    body: bodySchema.min(1),
    anchor_text: bodySchema.optional(),
    author: textSchema.optional(),
  }),
  reply_to_comment: z.strictObject({
    path: mcpPathSchema,
    id: commentId,
    body: bodySchema.min(1),
    author: textSchema.optional(),
  }),
  resolve_comment: z.strictObject({
    path: mcpPathSchema,
    id: commentId,
    resolved: z.boolean().optional(),
  }),
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
    arguments: z.infer<(typeof MCP_TOOL_SCHEMAS)[K]>
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
    args: z.infer<(typeof MCP_TOOL_SCHEMAS)[K]>,
    context: McpToolContext,
  ): Promise<z.infer<typeof jsonValueSchema>>
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

const toolNameSchema = z.enum([
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

const rpcIdSchema = z.union([z.string().max(256), z.number().int()])

const requestSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: rpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
})

const initializeSchema = z.object({
  protocolVersion: z.string(),
  capabilities: objectSchema,
  clientInfo: z.object({ name: textSchema, version: textSchema }),
})

const callSchema = z.strictObject({
  name: z.string(),
  arguments: objectSchema.optional(),
  _meta: objectSchema.optional(),
})

const cancelSchema = z.object({
  requestId: rpcIdSchema,
  reason: z.string().optional(),
})

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

async function* inputChunks(input: McpStdioOptions["input"]) {
  if (input instanceof ReadableStream) {
    const reader = input.getReader()

    try {
      while (true) {
        const chunk = await reader.read()

        if (chunk.done) return
        yield chunk.value
      }
    } finally {
      reader.releaseLock()
    }
  } else yield* input
}

export async function runMcpStdio(options: McpStdioOptions) {
  const access = options.access ?? "write"

  const supported = new Set(options.supportedTools ?? toolNameSchema.options)

  const offered = toolNameSchema.options.filter(
    (name) =>
      supported.has(name) &&
      (access === "write" ||
        readTools.has(name) ||
        (access === "comment" && commentTools.has(name))),
  )

  let initialized = false
  let ready = false
  let clientName = "Assistant"
  let outputQueue = Promise.resolve()
  const pending = new Map<string | number, AbortController>()
  const tasks = new Set<Promise<void>>()

  function send<T extends object>(value: T) {
    outputQueue = outputQueue.then(() =>
      options.output(`${JSON.stringify(value)}\n`),
    )

    return outputQueue
  }

  function rpcError(id: string | number | null, code: number, message: string) {
    return send({ jsonrpc: "2.0", id, error: { code, message } })
  }

  async function handle(line: string) {
    let raw: unknown

    try {
      raw = JSON.parse(line)
    } catch {
      await rpcError(null, -32700, "Parse error")

      return
    }

    const parsed = requestSchema.safeParse(raw)

    if (!parsed.success) {
      await rpcError(null, -32600, "Invalid request")

      return
    }

    const request = parsed.data
    const { id, method, params } = request

    if (id === undefined) {
      if (method === "notifications/initialized" && initialized) ready = true

      if (method === "notifications/cancelled") {
        const cancelled = cancelSchema.safeParse(params)

        if (cancelled.success) pending.get(cancelled.data.requestId)?.abort()
      }

      return
    }

    if (pending.has(id)) {
      await rpcError(id, -32600, "Request id already active")

      return
    }

    if (method === "initialize") {
      const init = initializeSchema.safeParse(params)

      if (initialized || !init.success) {
        await rpcError(id, -32602, "Invalid initialization")

        return
      }

      initialized = true
      clientName = init.data.clientInfo.name
      await send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: supportedProtocols.includes(
            init.data.protocolVersion,
          )
            ? init.data.protocolVersion
            : supportedProtocols[0],
          capabilities: { tools: {} },
          serverInfo: { name: "still-notes", version: "0.1.0" },
          instructions: options.instructions ?? MCP_DEFAULT_INSTRUCTIONS,
        },
      })

      return
    }

    if (method === "ping") {
      await send({ jsonrpc: "2.0", id, result: {} })

      return
    }

    if (!ready) {
      await rpcError(id, -32002, "Server not initialized")

      return
    }

    if (method === "tools/list") {
      if (
        params !== undefined &&
        !z.strictObject({}).safeParse(params).success
      ) {
        await rpcError(id, -32602, "Invalid params")

        return
      }

      await send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: offered.map((name) => ({
            name,
            description: toolDescriptions[name],
            inputSchema: z.toJSONSchema(MCP_TOOL_SCHEMAS[name]),
            annotations: {
              readOnlyHint: readTools.has(name),
              destructiveHint: !readTools.has(name) && !commentTools.has(name),
            },
          })),
        },
      })

      return
    }

    if (method !== "tools/call") {
      await rpcError(id, -32601, "Method not found")

      return
    }

    const call = callSchema.safeParse(params)

    if (!call.success) {
      await rpcError(id, -32602, "Invalid tool call params")

      return
    }

    const controller = new AbortController()
    pending.set(id, controller)

    try {
      const name = toolNameSchema.parse(call.data.name)

      if (!offered.includes(name))
        throw new Error("Unknown or unavailable tool")
      const args = MCP_TOOL_SCHEMAS[name].parse(call.data.arguments ?? {})
      // Yield once so a cancellation already in the same input frame can stop writes.
      await Promise.resolve()
      controller.signal.throwIfAborted()

      const result = jsonValueSchema.parse(
        await options.adapter.execute(name, args, {
          signal: controller.signal,
          clientName,
          access,
        }),
      )

      controller.signal.throwIfAborted()
      await send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text:
                z.string().safeParse(result).data ??
                JSON.stringify(result ?? null),
            },
          ],
          isError: false,
        },
      })
    } catch (error) {
      if (controller.signal.aborted)
        await rpcError(
          id,
          -32800,
          "Request cancelled; inspect vault before retrying",
        )
      else
        await send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : "Tool failed",
              },
            ],
            isError: true,
          },
        })
    } finally {
      pending.delete(id)
    }
  }

  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffer = ""

  try {
    for await (const chunk of inputChunks(options.input)) {
      try {
        buffer += decoder.decode(chunk, { stream: true })
      } catch {
        buffer = ""
        await rpcError(null, -32700, "Invalid UTF-8")
        continue
      }

      if (buffer.length > 4 * 1024 * 1024) {
        await rpcError(null, -32600, "Input frame too large")
        buffer = ""
        break
      }

      let newline = buffer.indexOf("\n")

      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "")
        buffer = buffer.slice(newline + 1)

        if (line.trim()) {
          const task = handle(line)
          tasks.add(task)
          void task.then(
            () => tasks.delete(task),
            () => tasks.delete(task),
          )
        }

        newline = buffer.indexOf("\n")
      }
    }

    try {
      buffer += decoder.decode()
    } catch {
      buffer = ""
      await rpcError(null, -32700, "Invalid UTF-8")
    }

    if (buffer.trim()) await handle(buffer)
    await Promise.all(tasks)
    await outputQueue
  } finally {
    for (const controller of pending.values()) controller.abort()
  }
}
