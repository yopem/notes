import { Effect, Option, Schema, Struct } from "effect"
import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  fstatSync,
  type FSWatcher,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  resolve,
  sep,
} from "node:path"

import { atomicWrite, syncDirectory } from "@/platform/files"

const noteLimit = 2 * 1024 * 1024

const assetLimit = 32 * 1024 * 1024

const transactionLimit = 96 * 1024 * 1024

const metadataLimit = 8 * 1024 * 1024

const internal = ".still-notes"

const statePath = `${internal}/state.json`

const journalPath = `${internal}/transaction.json`

const lockPath = `${internal}/vault.lock`

const errorSchema = Schema.Struct({ code: Schema.String })

const areaSchema = Schema.Literals(["inbox", "quick", "archive", "trash"])

const primarySchema = Schema.Literals(["inbox", "root"])

const optionsSchema = Schema.Struct({
  primaryNotesLocation: Schema.optional(primarySchema),
}).mapFields(Struct.map(Schema.mutableKey))

const guardSchema = Schema.Union([
  Schema.Struct({
    expectedHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  }).mapFields(Struct.map(Schema.mutableKey)),
  Schema.Struct({ expectedContent: Schema.String }).mapFields(
    Struct.map(Schema.mutableKey),
  ),
])

const confirmationSchema = Schema.Struct({ confirm: Schema.Literal(true) })

const pathSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2048),
  Schema.makeFilter(
    function validPath(value) {
      return (
        !isAbsolute(value) &&
        !/[\p{Cc}\\:%<>"|?*]/u.test(value) &&
        Buffer.from(value).toString("utf8") === value &&
        value.split("/").every(function validPart(part) {
          return (
            part.length > 0 &&
            part !== "." &&
            part !== ".." &&
            part.trim() === part &&
            !part.endsWith(".") &&
            Buffer.byteLength(part) <= 210 &&
            !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
          )
        })
      )
    },
    { message: "Unsafe vault-relative POSIX path" },
  ),
)

const nameSchema = pathSchema.check(
  Schema.makeFilter(
    function singlePart(value) {
      return !value.includes("/") && !value.startsWith(".")
    },
    { message: "A visible filename is required" },
  ),
)

const timestampSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(8640000000000000),
)

// Keep the stored contract's lowercase-only max UUID.
const uuidSchema = Schema.String.check(
  Schema.isPattern(
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
    { expected: "a UUID" },
  ),
)

// Keep calendar validation and UTC-only timestamps from the stored contract.

const datePattern =
  "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|1\\d|2[0-8])))"

const deletedAtSchema = Schema.String.check(
  Schema.isPattern(
    new RegExp(
      `^${datePattern}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?Z$`,
    ),
  ),
)

const metadataSchema = Schema.Struct({
  createdAt: timestampSchema,
  pinned: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  archiveFrom: Schema.optional(pathSchema),
  trashFrom: Schema.optional(pathSchema),
}).mapFields(Struct.map(Schema.mutableKey))

const deletedAssetSchema = Schema.Struct({
  path: pathSchema,
  name: nameSchema,
  undoToken: uuidSchema,
  deletedAt: deletedAtSchema,
}).mapFields(Struct.map(Schema.mutableKey))

const stateSchema = Schema.Struct({
  version: Schema.Literal(1),
  primaryNotesLocation: primarySchema,
  notes: Schema.Record(pathSchema, Schema.mutableKey(metadataSchema)),
  deletedAssets: Schema.Record(
    uuidSchema,
    Schema.mutableKey(deletedAssetSchema),
  ),
}).mapFields(Struct.map(Schema.mutableKey))

const base64Schema = Schema.String.check(
  Schema.isPattern(
    /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
  ),
)

const fileChangeSchema = Schema.Struct({
  path: pathSchema,
  before: Schema.NullOr(base64Schema),
  after: Schema.NullOr(base64Schema),
}).mapFields(Struct.map(Schema.mutableKey))

const directoryChangeSchema = Schema.Struct({
  path: pathSchema,
  before: Schema.Boolean,
  after: Schema.Boolean,
}).mapFields(Struct.map(Schema.mutableKey))

const journalSchema = Schema.Struct({
  version: Schema.Literal(1),
  files: Schema.mutable(Schema.Array(fileChangeSchema)).check(
    Schema.isMaxLength(10000),
  ),
  directories: Schema.mutable(Schema.Array(directoryChangeSchema)).check(
    Schema.isMaxLength(10000),
  ),
}).mapFields(Struct.map(Schema.mutableKey))

const lockSchema = Schema.Struct({
  pid: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(2147483647),
  ),
  token: uuidSchema,
})

const frontmatterSchema = Schema.Record(
  Schema.String,
  Schema.mutableKey(
    Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))]),
  ),
)

const decodeError = Schema.decodeUnknownOption(errorSchema)

const decodeArea = Schema.decodeUnknownSync(areaSchema)

const decodeOptions = Schema.decodeUnknownSync(optionsSchema, {
  onExcessProperty: "error",
})

const decodeGuard = Schema.decodeUnknownSync(guardSchema, {
  onExcessProperty: "error",
})

const decodeConfirmation = Schema.decodeUnknownSync(confirmationSchema, {
  onExcessProperty: "error",
})

const decodePath = Schema.decodeUnknownSync(pathSchema)

const decodeName = Schema.decodeUnknownSync(nameSchema)

const decodeState = Schema.decodeUnknownSync(stateSchema, {
  onExcessProperty: "error",
})

const decodeJournal = Schema.decodeUnknownSync(journalSchema, {
  onExcessProperty: "error",
})

const decodeLock = Schema.decodeUnknownSync(lockSchema, {
  onExcessProperty: "error",
})

const decodeDeletedAsset = Schema.decodeUnknownSync(deletedAssetSchema, {
  onExcessProperty: "error",
})

const decodeFrontmatter = Schema.decodeUnknownSync(frontmatterSchema)

const decodeUuid = Schema.decodeUnknownSync(uuidSchema)

const decodeNonEmptyString = Schema.decodeUnknownSync(Schema.NonEmptyString)

const decodeString = Schema.decodeUnknownSync(Schema.String)

const decodeBoolean = Schema.decodeUnknownSync(Schema.Boolean)

const decodeBytes = Schema.decodeUnknownSync(Schema.instanceOf(Uint8Array))

const decodePosition = Schema.decodeUnknownSync(
  Schema.Literals(["start", "end"]),
)

const decodeNoteLimit = Schema.decodeUnknownSync(
  Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(noteLimit),
  ),
)

export type NoteFolder = typeof areaSchema.Type

export type VaultOptions = typeof optionsSchema.Type

export type ExpectedContent = typeof guardSchema.Type

export interface DeleteConfirmation {
  confirm: boolean
}

export type DeletedAsset = typeof deletedAssetSchema.Type

export interface NoteRecord {
  id: string
  path: string
  title: string
  folder: NoteFolder
  body: string
  hash: string
  createdAt: number
  updatedAt: number
  size: number
  pinned: boolean
  tags: string[]
  frontmatter: Record<string, string | string[]>
}

export interface AssetRecord {
  path: string
  name: string
  size: number
  updatedAt: number
  hash: string
  kind: "image" | "pdf" | "audio" | "video" | "file"
}

export interface FolderRecord {
  path: string
  folder: NoteFolder
  subpath: string
}

export interface VaultChange {
  kind: "change" | "rename" | "resync"
  path: string | null
  error?: Error
}

type State = typeof stateSchema.Type

type Journal = typeof journalSchema.Type

type FileChange = typeof fileChangeSchema.Type

type DirectoryChange = typeof directoryChangeSchema.Type

interface VaultTree {
  files: string[]
  directories: string[]
}

function missing(error: typeof errorSchema.Type | undefined) {
  return error?.code === "ENOENT"
}

function fileStat(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (missing(Option.getOrUndefined(decodeError(error)))) return null
    throw error
  }
}

function digest(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function readBytes(path: string, limit: number) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )

  try {
    const stat = fstatSync(fd)

    if (!stat.isFile())
      throw new Error("Read requires a regular file, not a symlink")

    if (stat.size > limit) throw new Error(`File exceeds ${limit}-byte limit`)
    const chunks: Buffer[] = []
    let total = 0

    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - total))
      const count = readSync(fd, chunk, 0, chunk.length, null)

      if (!count) break
      total += count

      if (total > limit) throw new Error(`File exceeds ${limit}-byte limit`)
      chunks.push(chunk.subarray(0, count))
    }

    return Buffer.concat(chunks)
  } finally {
    closeSync(fd)
  }
}

function text(bytes: Uint8Array) {
  try {
    const value = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes)

    if (value.includes("\u0000")) throw new Error("Binary text")

    return value
  } catch (error) {
    throw new Error("File must contain UTF-8 text, not binary data", {
      cause: error,
    })
  }
}

function noteText(value: string) {
  decodeString(value)

  if (Buffer.byteLength(value) > noteLimit)
    throw new Error("Note exceeds size limit")

  if (value.includes("\u0000") || text(Buffer.from(value)) !== value)
    throw new Error("Note requires valid UTF-8 text")

  return value
}

function unquote(value: string) {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1)

  return trimmed
}

function parseProperties(body: string) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)
  const fields = new Map<string, string | string[]>()
  let list: string | undefined

  for (const line of (block?.[1] ?? "").split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    const items = list ? fields.get(list) : undefined

    if (item && Array.isArray(items)) {
      items.push(unquote(item[1] ?? ""))
      continue
    }

    const pair = /^([\w-]+):\s*(.*)$/.exec(line)
    list = undefined

    if (!pair?.[1]) continue
    const key = pair[1].toLowerCase()
    const value = pair[2] ?? ""

    if (!value) {
      fields.set(key, [])
      list = key
    } else if (value.startsWith("[") && value.endsWith("]"))
      fields.set(
        key,
        value.slice(1, -1).split(",").map(unquote).filter(Boolean),
      )
    else fields.set(key, unquote(value))
  }

  const tags = new Set<string>()
  const field = fields.get("tags")

  for (const value of Array.isArray(field) ? field : [field ?? ""]) {
    for (const tag of value.split(/[,\s]+/))
      if (tag) tags.add(tag.replace(/^#/, ""))
  }

  let fence = ""
  let length = 0

  for (const line of body.slice(block?.[0].length ?? 0).split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)

    if (marker?.[1]) {
      const run = marker[1]

      if (!fence && (run.startsWith("~") || !marker[2]?.includes("`"))) {
        fence = run[0] ?? ""
        length = run.length
        continue
      }

      if (run.startsWith(fence) && run.length >= length && !marker[2]?.trim()) {
        fence = ""
        continue
      }
    }

    if (fence) continue

    for (const match of line
      .replace(/(`+)[\s\S]*?\1/g, " ")
      .matchAll(/(?:^|\s)#(\p{L}[\p{L}\d_/-]*)/gu))
      if (match[1]) tags.add(match[1])
  }

  return {
    frontmatter: decodeFrontmatter(Object.fromEntries(fields)),
    tags: [...tags],
  }
}

function assetKind(path: string): AssetRecord["kind"] {
  const ext = extname(path).toLowerCase()

  if (
    [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".svg",
      ".avif",
      ".bmp",
    ].includes(ext)
  )
    return "image"

  if (ext === ".pdf") return "pdf"

  if ([".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"].includes(ext))
    return "audio"

  if ([".mp4", ".webm", ".mov", ".m4v", ".ogv"].includes(ext)) return "video"

  return "file"
}

/** Owns one synchronous filesystem vault. Close it to release its lock and subscriptions. */
// shortcut: Link text stays unchanged; add parser-based rewrites when cross-note conflict handling is available.
export class Vault {
  readonly root: string
  private readonly identity: { dev: number; ino: number }
  private readonly owner = { pid: process.pid, token: randomUUID() }
  private readonly watchers = new Set<FSWatcher>()
  private closed = false
  private locked = false
  private state: State
  private stateBytes = ""

  constructor(root: string, options: VaultOptions = {}) {
    decodeNonEmptyString(root)
    const parsed = decodeOptions(options)
    this.root = resolve(root)
    this.assertAbsoluteParents(this.root)
    mkdirSync(this.root, { recursive: true })
    this.root = realpathSync(this.root)
    this.identity = lstatSync(this.root)
    this.state = {
      version: 1,
      primaryNotesLocation: parsed.primaryNotesLocation ?? "inbox",
      notes: {},
      deletedAssets: {},
    }

    try {
      this.makeDirectory(internal)
      this.acquireLock()
      this.recover()

      if (fileStat(this.safe(statePath))) {
        this.stateBytes = text(readBytes(this.safe(statePath), metadataLimit))

        try {
          this.state = decodeState(JSON.parse(this.stateBytes))
          this.validateState(this.state)
        } catch (error) {
          throw new Error(
            "Invalid vault metadata. Preserve state.json and repair it before reopening.",
            { cause: error },
          )
        }
      } else {
        this.stateBytes = JSON.stringify(this.state)
        atomicWrite(this.safe(statePath), this.stateBytes, this.safe(internal))
      }

      for (const folder of ["inbox", "quick", "archive", "trash"] as const) {
        const path = this.areaRoot(folder)

        if (path) this.makeDirectory(path)
      }

      this.makeDirectory("assets")
    } catch (error) {
      this.close()
      throw error
    }
  }

  private assertAbsoluteParents(path: string) {
    let current = resolve(path)

    while (true) {
      if (fileStat(current)?.isSymbolicLink())
        throw new Error("Symlinked vault roots or parents are not supported")
      const parent = dirname(current)

      if (parent === current) break
      current = parent
    }
  }

  private assertOpen() {
    if (this.closed) throw new Error("Vault is closed")
    this.assertAbsoluteParents(this.root)
    const current = lstatSync(this.root)

    if (current.dev !== this.identity.dev || current.ino !== this.identity.ino)
      throw new Error("Vault root changed; reopen it")
  }

  private safe(id: string, visible = false) {
    decodePath(id)

    if (
      visible &&
      id.split("/").some(function hidden(part) {
        return part.startsWith(".")
      })
    )
      throw new Error("Hidden paths are not supported")
    let current = this.root
    const parts = id.split("/")

    for (const [index, part] of parts.entries()) {
      current = join(current, part)
      const stat = fileStat(current)

      if (stat?.isSymbolicLink())
        throw new Error(`Symlink path is not supported: ${id}`)

      if (stat && index < parts.length - 1 && !stat.isDirectory())
        throw new Error(`Parent is not a directory: ${id}`)
    }

    return current
  }

  private makeDirectory(id: string) {
    const path = this.safe(id)
    mkdirSync(path, { recursive: true })

    if (!lstatSync(path).isDirectory()) throw new Error("Expected a directory")
    let current = path

    while (current !== this.root) {
      syncDirectory(current)
      current = dirname(current)
    }

    syncDirectory(this.root)
  }

  private readLock() {
    return decodeLock(JSON.parse(text(readBytes(this.safe(lockPath), 4096))))
  }

  private acquireLock() {
    const attempt = () => {
      let fd: number

      try {
        fd = openSync(this.safe(lockPath), "wx", 0o600)
      } catch (error) {
        if (Option.getOrUndefined(decodeError(error))?.code === "EEXIST")
          return false
        throw error
      }

      this.locked = true

      try {
        writeFileSync(fd, JSON.stringify(this.owner))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }

      syncDirectory(this.safe(internal))

      return true
    }

    if (attempt()) return
    let prior: typeof lockSchema.Type

    try {
      prior = this.readLock()
    } catch (error) {
      throw new Error("Invalid vault lock; inspect it before removal", {
        cause: error,
      })
    }

    try {
      process.kill(prior.pid, 0)
      throw new Error("Vault lock is held by another process")
    } catch (error) {
      if (Option.getOrUndefined(decodeError(error))?.code !== "ESRCH")
        throw error
    }

    const recoveryPath = this.safe(`${lockPath}.recovery`)
    const recovery = openSync(recoveryPath, "wx", 0o600)

    try {
      const current = this.readLock()

      if (current.token !== prior.token || current.pid !== prior.pid)
        throw new Error("Vault lock changed during recovery")
      unlinkSync(this.safe(lockPath))

      if (!attempt()) throw new Error("Vault lock acquired by another process")
    } finally {
      closeSync(recovery)
      unlinkSync(recoveryPath)
    }
  }

  private assertWritable() {
    this.assertOpen()
    const owner = this.readLock()

    if (owner.token !== this.owner.token || owner.pid !== this.owner.pid)
      throw new Error("Vault lock changed")

    if (
      text(readBytes(this.safe(statePath), metadataLimit)) !== this.stateBytes
    )
      throw new Error(
        "Vault metadata changed externally; reopen before writing",
      )

    if (fileStat(this.safe(journalPath)))
      throw new Error("Pending recovery journal; close and reopen the vault")
  }

  private validateState(state: State) {
    for (const [id, meta] of Object.entries(state.notes)) {
      this.notePath(id)

      if (meta.archiveFrom) this.notePath(meta.archiveFrom)

      if (meta.trashFrom) this.notePath(meta.trashFrom)
    }

    for (const [token, asset] of Object.entries(state.deletedAssets)) {
      if (asset.undoToken !== token || basename(asset.path) !== asset.name)
        throw new Error("Invalid attachment restore metadata")
      this.assetPath(asset.path)
    }
  }

  private currentBytes(id: string) {
    const path = this.safe(id)
    const stat = fileStat(path)

    if (!stat) return null

    if (!stat.isFile()) throw new Error("Transaction requires a regular file")

    return readBytes(path, transactionLimit).toString("base64")
  }

  private validateJournal(journal: Journal) {
    const paths = new Set<string>()

    for (const file of journal.files) {
      if (
        file.path.startsWith(`${internal}/`) &&
        file.path !== statePath &&
        !/^\.still-notes\/deleted-assets\/[a-f0-9-]{36}\/content$/.test(
          file.path,
        )
      )
        throw new Error("Invalid internal journal path")
      this.safe(file.path)

      if (paths.has(file.path)) throw new Error("Duplicate journal path")
      paths.add(file.path)
      const current = this.currentBytes(file.path)

      if (current !== file.before && current !== file.after)
        throw new Error(
          `Recovery conflict: ${file.path}. Preserve journal and files.`,
        )
    }

    for (const directory of journal.directories) {
      if (
        directory.path === internal ||
        (directory.path.startsWith(`${internal}/`) &&
          !directory.path.startsWith(`${internal}/deleted-assets`))
      )
        throw new Error("Invalid journal directory")
      const stat = fileStat(this.safe(directory.path))

      if (stat && !stat.isDirectory())
        throw new Error("Recovery directory conflict")
    }
  }

  private apply(journal: Journal, forward: boolean) {
    const directories = [...journal.directories].sort(function shallow(a, b) {
      return a.path.split("/").length - b.path.split("/").length
    })

    for (const entry of directories)
      if (forward ? entry.after : entry.before) this.makeDirectory(entry.path)

    for (const entry of forward
      ? journal.files
      : [...journal.files].reverse()) {
      const current = this.currentBytes(entry.path)

      if (
        forward
          ? current !== entry.before
          : current !== entry.before && current !== entry.after
      )
        throw new Error(`External content conflict: ${entry.path}`)
      const value = forward ? entry.after : entry.before

      if (current === value) continue
      const path = this.safe(entry.path)

      if (value === null) {
        if (fileStat(path)) {
          unlinkSync(path)
          syncDirectory(dirname(path))
        }
      } else atomicWrite(path, Buffer.from(value, "base64"), dirname(path))
    }

    for (const entry of directories.reverse()) {
      if (
        !(forward ? entry.after : entry.before) &&
        fileStat(this.safe(entry.path))
      ) {
        rmdirSync(this.safe(entry.path))
        syncDirectory(dirname(this.safe(entry.path)))
      }
    }
  }

  private recover() {
    if (!fileStat(this.safe(journalPath))) return
    let journal: Journal

    try {
      journal = decodeJournal(
        JSON.parse(text(readBytes(this.safe(journalPath), transactionLimit))),
      )
    } catch (error) {
      throw new Error("Invalid recovery journal; preserve it for repair", {
        cause: error,
      })
    }

    this.validateJournal(journal)
    this.apply(journal, false)
    unlinkSync(this.safe(journalPath))
    syncDirectory(this.safe(internal))
  }

  private transaction(
    next: State,
    changes: {
      path: string
      bytes: Uint8Array | string | null
      expectedHash?: string | null
    }[],
    directories: DirectoryChange[] = [],
  ) {
    this.assertWritable()
    this.validateState(next)
    const nextBytes = JSON.stringify(decodeState(next))

    if (Buffer.byteLength(nextBytes) > metadataLimit)
      throw new Error("Vault metadata exceeds limit")

    let estimatedBytes =
      1024 +
      Math.ceil(
        ((Buffer.byteLength(this.stateBytes) + Buffer.byteLength(nextBytes)) *
          4) /
          3,
      )

    for (const entry of changes) {
      const beforeSize = fileStat(this.safe(entry.path))?.size ?? 0

      const afterSize =
        entry.bytes === null ? 0 : Buffer.byteLength(entry.bytes)

      estimatedBytes +=
        256 +
        entry.path.length * 6 +
        Math.ceil(((beforeSize + afterSize) * 4) / 3)

      if (estimatedBytes > transactionLimit)
        throw new Error("Transaction exceeds size limit; use smaller folders")
    }

    const files: FileChange[] = changes.map((entry) => {
      const before = this.currentBytes(entry.path)

      if (
        entry.expectedHash !== undefined &&
        (before === null ? null : digest(Buffer.from(before, "base64"))) !==
          entry.expectedHash
      )
        throw new Error(`External content conflict: ${entry.path}`)

      return {
        path: entry.path,
        before,
        after:
          entry.bytes === null
            ? null
            : Buffer.from(entry.bytes).toString("base64"),
      }
    })

    files.push({
      path: statePath,
      before: Buffer.from(this.stateBytes).toString("base64"),
      after: Buffer.from(nextBytes).toString("base64"),
    })

    const directoryMap = new Map(
      directories.map((entry) => [entry.path, entry]),
    )

    for (const entry of [...files, ...directories]) {
      let parent = posix.dirname(entry.path)

      while (parent !== ".") {
        const path = this.safe(parent)

        if (!fileStat(path) && !directoryMap.has(parent))
          directoryMap.set(parent, { path: parent, before: false, after: true })
        parent = posix.dirname(parent)
      }
    }

    const journal: Journal = {
      version: 1,
      files,
      directories: [...directoryMap.values()],
    }

    this.validateJournal(journal)
    const bytes = JSON.stringify(decodeJournal(journal))

    if (Buffer.byteLength(bytes) > transactionLimit)
      throw new Error("Transaction exceeds size limit; use smaller folders")
    atomicWrite(this.safe(journalPath), bytes, this.safe(internal))

    try {
      this.apply(journal, true)
      unlinkSync(this.safe(journalPath))
      syncDirectory(this.safe(internal))
      this.state = next
      this.stateBytes = nextBytes
    } catch (error) {
      try {
        this.validateJournal(journal)
        this.apply(journal, false)
        unlinkSync(this.safe(journalPath))
        syncDirectory(this.safe(internal))
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          "Vault transaction failed; preserve recovery journal",
        )
      }

      throw error
    }
  }

  private nextState() {
    return decodeState(this.state)
  }
  private areaRoot(folder: NoteFolder) {
    return folder === "inbox" && this.state.primaryNotesLocation === "root"
      ? ""
      : folder
  }
  private folderPath(folder: NoteFolder, subpath = "") {
    decodeArea(folder)

    if (subpath) {
      decodePath(subpath)

      if (
        subpath.split("/").some(function hidden(part) {
          return part.startsWith(".")
        })
      )
        throw new Error("Hidden folder path")
    }

    const id = [this.areaRoot(folder), subpath].filter(Boolean).join("/")

    if (
      folder === "inbox" &&
      this.state.primaryNotesLocation === "root" &&
      ["quick", "archive", "trash", "assets", internal].includes(
        id.split("/")[0] ?? "",
      )
    )
      throw new Error("Reserved system area")

    if (id) this.safe(id, true)

    return id
  }
  private folderOf(id: string): NoteFolder {
    const first = id.split("/")[0]

    if (first === "quick" || first === "archive" || first === "trash")
      return first

    return "inbox"
  }
  private notePath(id: string) {
    this.safe(id, true)

    if (!/\.md$/i.test(id) || id.startsWith("assets/"))
      throw new Error("Expected a Markdown note path")

    return id
  }
  private assetPath(id: string) {
    this.safe(id, true)

    if (!id.startsWith("assets/") || /\.md$/i.test(id))
      throw new Error("Expected a non-Markdown path under assets")

    return id
  }
  private unique(id: string) {
    decodePath(id)
    const extension = posix.extname(id)
    const stem = id.slice(0, id.length - extension.length)
    let candidate = id

    for (let count = 2; fileStat(join(this.root, candidate)); count++)
      candidate = `${stem} ${count}${extension}`
    this.safe(candidate)

    return candidate
  }
  private guard(bytes: Uint8Array, expected: ExpectedContent) {
    const parsed = decodeGuard(expected)

    const expectedHash =
      "expectedHash" in parsed
        ? parsed.expectedHash
        : digest(parsed.expectedContent)

    if (digest(bytes) !== expectedHash)
      throw new Error(
        "External content conflict; keep pending edits and reload or resolve explicitly",
      )
  }
  private walk(id = "", hidden = false): VaultTree {
    const path = id ? this.safe(id) : this.root
    const files: string[] = []
    const directories: string[] = []

    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!hidden && entry.name.startsWith(".")) continue
      const child = id ? `${id}/${entry.name}` : entry.name

      if (entry.isSymbolicLink()) {
        if (hidden) throw new Error("Folder contains a symlink")
        continue
      }

      this.safe(child)

      if (entry.isDirectory()) {
        directories.push(child)
        const nested = this.walk(child, hidden)
        files.push(...nested.files)
        directories.push(...nested.directories)
      } else if (entry.isFile()) files.push(child)
      else if (hidden)
        throw new Error("Folder contains an unsupported filesystem entry")
    }

    return { files, directories }
  }

  listNotes() {
    this.assertOpen()

    return this.walk()
      .files.filter(function markdown(path) {
        return /\.md$/i.test(path) && !path.startsWith("assets/")
      })
      .map((id) => this.readNote(id))
  }
  listFolders(): FolderRecord[] {
    this.assertOpen()

    return this.walk()
      .directories.filter(function noteDirectory(id) {
        return id !== "assets" && !id.startsWith("assets/")
      })
      .map((path) => {
        const folder = this.folderOf(path)
        const root = this.areaRoot(folder)

        return {
          path,
          folder,
          subpath: root
            ? path === root
              ? ""
              : path.slice(root.length + 1)
            : path,
        }
      })
  }
  readNote(id: string): NoteRecord {
    this.assertOpen()
    const path = this.safe(this.notePath(id), true)
    const bytes = readBytes(path, noteLimit)
    const body = text(bytes)
    const stat = lstatSync(path)
    const meta = this.state.notes[id]

    return {
      id,
      path: id,
      title: basename(id, extname(id)),
      folder: this.folderOf(id),
      body,
      hash: digest(bytes),
      createdAt:
        meta?.createdAt ?? Math.trunc(stat.birthtimeMs || stat.ctimeMs),
      updatedAt: stat.mtimeMs,
      size: bytes.length,
      pinned: meta?.pinned ?? false,
      ...parseProperties(body),
    }
  }
  createNote(
    folder: NoteFolder,
    title = "Untitled",
    subpath = "",
    body?: string,
  ) {
    this.assertWritable()
    decodeName(title)
    const parent = this.folderPath(folder, subpath)
    const id = this.unique([parent, `${title}.md`].filter(Boolean).join("/"))
    this.notePath(id)
    const next = this.nextState()
    next.notes[id] = { createdAt: Date.now(), pinned: false }
    this.transaction(next, [
      {
        path: id,
        bytes: noteText(body ?? `# ${basename(id, ".md")}\n\n`),
        expectedHash: null,
      },
    ])

    return this.readNote(id)
  }
  importNote(source: string, folder: NoteFolder = "inbox", subpath = "") {
    this.assertOpen()
    decodeNonEmptyString(source)
    this.assertAbsoluteParents(resolve(source))

    return this.createNote(
      folder,
      basename(source, extname(source)),
      subpath,
      text(readBytes(resolve(source), noteLimit)),
    )
  }
  writeNote(id: string, body: string, expected: ExpectedContent) {
    const previous = this.readNote(id)
    this.guard(Buffer.from(previous.body), expected)
    const next = this.nextState()
    next.notes[id] ??= { createdAt: previous.createdAt, pinned: false }
    this.transaction(next, [
      { path: id, bytes: noteText(body), expectedHash: previous.hash },
    ])

    return this.readNote(id)
  }
  appendToNote(
    id: string,
    addition: string,
    position: "start" | "end",
    expected: ExpectedContent,
  ) {
    const previous = this.readNote(id)
    this.guard(Buffer.from(previous.body), expected)
    decodePosition(position)
    const content = noteText(addition).trimEnd()

    if (!content) return previous

    return this.writeNote(
      id,
      position === "start"
        ? `${content}\n\n${previous.body}`
        : `${previous.body}${previous.body.endsWith("\n") ? "" : "\n"}\n${content}\n`,
      expected,
    )
  }
  setPinned(id: string, pinned: boolean) {
    const note = this.readNote(id)
    const next = this.nextState()
    next.notes[id] = {
      ...next.notes[id],
      createdAt: note.createdAt,
      pinned: decodeBoolean(pinned),
    }
    this.transaction(next, [])

    return this.readNote(id)
  }
  checkExternalChange(
    id: string,
    expected: ExpectedContent,
    pendingContent?: string,
  ) {
    this.assertOpen()
    this.notePath(id)
    let disk: NoteRecord | null = null

    try {
      disk = this.readNote(id)
    } catch (error) {
      if (!missing(Option.getOrUndefined(decodeError(error)))) throw error
    }

    const parsed = decodeGuard(expected)

    const expectedHash =
      "expectedHash" in parsed
        ? parsed.expectedHash
        : digest(parsed.expectedContent)

    return {
      changed: disk?.hash !== expectedHash,
      deleted: disk === null,
      disk,
      pendingContent,
    }
  }

  private relocateNote(
    id: string,
    target: string,
    mode: "move" | "archive" | "unarchive" | "trash" | "restore" = "move",
  ) {
    const note = this.readNote(id)
    this.notePath(target)

    if (id === target) return note

    if (fileStat(this.safe(target)))
      throw new Error("Note already exists at destination")
    const next = this.nextState()

    const meta = {
      ...next.notes[id],
      createdAt: note.createdAt,
      pinned: note.pinned,
    }

    if (mode === "archive") meta.archiveFrom = id

    if (mode === "trash") meta.trashFrom = id

    if (mode === "restore") delete meta.trashFrom

    if (mode === "unarchive") delete meta.archiveFrom
    delete next.notes[id]
    next.notes[target] = meta
    this.transaction(next, [
      { path: target, bytes: note.body, expectedHash: null },
      { path: id, bytes: null, expectedHash: note.hash },
    ])

    return this.readNote(target)
  }
  renameNote(id: string, title: string) {
    decodeName(title)

    return this.relocateNote(id, posix.join(posix.dirname(id), `${title}.md`))
  }
  moveNote(id: string, folder: NoteFolder, subpath = "") {
    this.readNote(id)
    const target = posix.join(this.folderPath(folder, subpath), basename(id))

    return this.relocateNote(id, target === id ? id : this.unique(target))
  }
  duplicateNote(id: string) {
    const note = this.readNote(id)

    const target = this.unique(
      posix.join(posix.dirname(id), `${note.title} copy.md`),
    )

    const next = this.nextState()
    next.notes[target] = { createdAt: Date.now(), pinned: false }
    this.transaction(next, [
      { path: target, bytes: note.body, expectedHash: null },
    ])

    return this.readNote(target)
  }
  private mirror(id: string, folder: NoteFolder) {
    const current = this.folderOf(id)
    const root = this.areaRoot(current)

    const relative =
      root && id.startsWith(`${root}/`) ? id.slice(root.length + 1) : id

    return this.unique(posix.join(this.areaRoot(folder), relative))
  }
  archiveNote(id: string) {
    if (["archive", "trash"].includes(this.readNote(id).folder))
      throw new Error("Only active notes can be archived")

    return this.relocateNote(id, this.mirror(id, "archive"), "archive")
  }
  unarchiveNote(id: string) {
    if (this.readNote(id).folder !== "archive")
      throw new Error("Note is not archived")

    return this.relocateNote(
      id,
      this.unique(
        this.state.notes[id]?.archiveFrom ??
          posix.join(this.areaRoot("inbox"), id.slice("archive/".length)),
      ),
      "unarchive",
    )
  }
  moveToTrash(id: string) {
    if (this.readNote(id).folder === "trash")
      throw new Error("Note is already in trash")

    return this.relocateNote(id, this.mirror(id, "trash"), "trash")
  }
  restoreFromTrash(id: string) {
    if (this.readNote(id).folder !== "trash")
      throw new Error("Note is not in trash")

    return this.relocateNote(
      id,
      this.unique(
        this.state.notes[id]?.trashFrom ??
          posix.join(this.areaRoot("inbox"), id.slice("trash/".length)),
      ),
      "restore",
    )
  }
  deleteNote(id: string, confirmation: DeleteConfirmation) {
    decodeConfirmation(confirmation)

    if (this.readNote(id).folder !== "trash")
      throw new Error("Permanent deletion requires a note in trash")
    const next = this.nextState()
    delete next.notes[id]
    this.transaction(next, [{ path: id, bytes: null }])
  }
  emptyTrash(confirmation: DeleteConfirmation) {
    decodeConfirmation(confirmation)

    const deleted = this.listNotes()
      .filter(function inTrash(note) {
        return note.folder === "trash"
      })
      .map(function id(note) {
        return note.path
      })

    const next = this.nextState()

    for (const id of deleted) delete next.notes[id]
    this.transaction(
      next,
      deleted.map(function removal(path) {
        return { path, bytes: null }
      }),
    )

    return { deleted }
  }

  createFolder(folder: NoteFolder, subpath: string): FolderRecord {
    this.assertWritable()

    if (!subpath) throw new Error("Folder name is required")
    const path = this.folderPath(folder, subpath)

    if (fileStat(this.safe(path))) throw new Error("Folder already exists")
    this.transaction(
      this.nextState(),
      [],
      [{ path, before: false, after: true }],
    )

    return { path, folder, subpath }
  }
  private folderTree(folder: NoteFolder, subpath: string) {
    this.assertOpen()

    if (!subpath) throw new Error("Cannot change a top-level folder")
    const id = this.folderPath(folder, subpath)

    if (!lstatSync(this.safe(id)).isDirectory())
      throw new Error("Expected a folder")

    return { id, ...this.walk(id, true) }
  }
  private relocateFolder(
    folder: NoteFolder,
    subpath: string,
    destination: string,
    copy: boolean,
  ) {
    const tree = this.folderTree(folder, subpath)
    const target = this.folderPath(folder, destination)

    if (target === tree.id)
      return { path: target, folder, subpath: destination }

    if (target.startsWith(`${tree.id}/`))
      throw new Error("Cannot move a folder into itself")

    if (fileStat(this.safe(target)))
      throw new Error("Destination folder already exists")
    const next = this.nextState()

    const changes: {
      path: string
      bytes: Uint8Array | null
      expectedHash: string | null
    }[] = []

    let totalBytes = 0

    for (const id of tree.files) {
      totalBytes += lstatSync(this.safe(id)).size

      if (totalBytes > transactionLimit / 4)
        throw new Error(
          "Folder transaction exceeds size limit; use smaller folders",
        )
    }

    const rewrite = (id: string) => target + id.slice(tree.id.length)

    for (const id of tree.files) {
      const bytes = readBytes(this.safe(id), assetLimit)
      changes.push({ path: rewrite(id), bytes, expectedHash: null })

      if (!copy)
        changes.push({ path: id, bytes: null, expectedHash: digest(bytes) })

      if (
        /\.md$/i.test(id) &&
        !id.split("/").some(function hidden(part) {
          return part.startsWith(".")
        })
      ) {
        const note = this.readNote(id)
        next.notes[rewrite(id)] = copy
          ? { createdAt: Date.now(), pinned: false }
          : {
              ...next.notes[id],
              createdAt: note.createdAt,
              pinned: note.pinned,
            }

        if (!copy) delete next.notes[id]
      }
    }

    const directories: DirectoryChange[] = []

    for (const id of [tree.id, ...tree.directories]) {
      directories.push({ path: rewrite(id), before: false, after: true })

      if (!copy) directories.push({ path: id, before: true, after: false })
    }

    this.transaction(next, changes, directories)

    return { path: target, folder, subpath: destination }
  }
  renameFolder(folder: NoteFolder, subpath: string, destination: string) {
    return this.relocateFolder(folder, subpath, destination, false)
  }
  duplicateFolder(folder: NoteFolder, subpath: string) {
    const tree = this.folderTree(folder, subpath)
    let target = `${tree.id} copy`

    for (let count = 2; fileStat(join(this.root, target)); count++)
      target = `${tree.id} copy ${count}`
    const root = this.areaRoot(folder)

    return this.relocateFolder(
      folder,
      subpath,
      root ? target.slice(root.length + 1) : target,
      true,
    )
  }
  deleteFolder(
    folder: NoteFolder,
    subpath: string,
    confirmation: DeleteConfirmation,
  ) {
    decodeConfirmation(confirmation)
    const tree = this.folderTree(folder, subpath)

    if (
      [...tree.files, ...tree.directories].some(function unknown(id) {
        return id.split("/").some(function hidden(part) {
          return part.startsWith(".")
        })
      }) ||
      tree.files.some(function unknown(id) {
        return !/\.md$/i.test(id)
      })
    )
      throw new Error(
        "Folder contains hidden or unknown data; preserve it and remove explicitly outside the app",
      )
    const next = this.nextState()

    for (const id of tree.files) delete next.notes[id]
    this.transaction(
      next,
      tree.files.map(function removal(path) {
        return { path, bytes: null }
      }),
      [tree.id, ...tree.directories].map(function removal(path) {
        return { path, before: true, after: false }
      }),
    )

    return { deleted: tree.files }
  }

  listAssets() {
    this.assertOpen()

    return this.walk("assets")
      .files.filter(function notMarkdown(path) {
        return !/\.md$/i.test(path)
      })
      .map((id) => this.assetRecord(id))
  }
  private assetRecord(id: string): AssetRecord {
    const bytes = this.readAsset(id)
    const stat = lstatSync(this.safe(id))

    return {
      path: id,
      name: basename(id),
      size: bytes.length,
      updatedAt: stat.mtimeMs,
      hash: digest(bytes),
      kind: assetKind(id),
    }
  }
  readAsset(id: string): Uint8Array {
    this.assertOpen()

    return new Uint8Array(
      readBytes(this.safe(this.assetPath(id), true), assetLimit),
    )
  }
  readAssetText(id: string, limit = noteLimit) {
    this.assertOpen()
    decodeNoteLimit(limit)

    return text(readBytes(this.safe(this.assetPath(id), true), limit))
  }
  createAsset(name: string, bytes: Uint8Array, targetDir = "assets") {
    this.assertWritable()
    decodeName(name)
    decodeBytes(bytes)

    if (bytes.length > assetLimit)
      throw new Error("Attachment exceeds size limit")
    const target = this.unique(`${targetDir}/${name}`)
    this.assetPath(target)
    this.transaction(this.nextState(), [
      { path: target, bytes, expectedHash: null },
    ])

    return this.assetRecord(target)
  }
  importAsset(source: string, targetDir = "assets") {
    decodeNonEmptyString(source)
    this.assertAbsoluteParents(resolve(source))

    return this.createAsset(
      basename(source),
      readBytes(resolve(source), assetLimit),
      targetDir,
    )
  }
  writeAsset(id: string, bytes: Uint8Array, expected: ExpectedContent) {
    const previous = this.readAsset(id)
    this.guard(previous, expected)
    decodeBytes(bytes)

    if (bytes.length > assetLimit)
      throw new Error("Attachment exceeds size limit")
    this.transaction(this.nextState(), [
      { path: id, bytes, expectedHash: digest(previous) },
    ])

    return this.assetRecord(id)
  }
  private relocateAsset(id: string, target: string) {
    const bytes = this.readAsset(id)
    this.assetPath(target)

    if (id === target) return this.assetRecord(id)

    if (fileStat(this.safe(target)))
      throw new Error("Attachment already exists")
    this.transaction(this.nextState(), [
      { path: target, bytes, expectedHash: null },
      { path: id, bytes: null, expectedHash: digest(bytes) },
    ])

    return this.assetRecord(target)
  }
  renameAsset(id: string, name: string) {
    decodeName(name)

    return this.relocateAsset(id, posix.join(posix.dirname(id), name))
  }
  moveAsset(id: string, targetDir: string) {
    this.assetPath(id)
    const target = `${targetDir}/${basename(id)}`

    return this.relocateAsset(id, target === id ? id : this.unique(target))
  }
  duplicateAsset(id: string) {
    const bytes = this.readAsset(id)

    return this.createAsset(
      `${basename(id, extname(id))} copy${extname(id)}`,
      bytes,
      posix.dirname(id),
    )
  }
  deleteAsset(id: string) {
    const bytes = this.readAsset(id)

    const record = decodeDeletedAsset({
      path: id,
      name: basename(id),
      undoToken: randomUUID(),
      deletedAt: new Date().toISOString(),
    })

    const next = this.nextState()
    next.deletedAssets[record.undoToken] = record
    this.transaction(next, [
      {
        path: `${internal}/deleted-assets/${record.undoToken}/content`,
        bytes,
        expectedHash: null,
      },
      { path: id, bytes: null, expectedHash: digest(bytes) },
    ])

    return record
  }
  listDeletedAssets() {
    this.assertOpen()

    return Object.values(this.state.deletedAssets)
      .filter((entry) =>
        fileStat(
          this.safe(`${internal}/deleted-assets/${entry.undoToken}/content`),
        )?.isFile(),
      )
      .map(function clone(entry) {
        return { ...entry }
      })
      .sort(function latest(a, b) {
        return b.deletedAt.localeCompare(a.deletedAt)
      })
  }
  restoreDeletedAsset(token: string) {
    this.assertOpen()
    decodeUuid(token)
    const stored = this.state.deletedAssets[token]

    if (!stored) throw new Error("Attachment restore metadata is missing")
    const source = `${internal}/deleted-assets/${token}/content`
    const bytes = readBytes(this.safe(source), assetLimit)
    const target = this.unique(this.assetPath(stored.path))
    const next = this.nextState()
    delete next.deletedAssets[token]
    this.transaction(next, [
      { path: target, bytes, expectedHash: null },
      { path: source, bytes: null, expectedHash: digest(bytes) },
    ])

    return this.assetRecord(target)
  }
  purgeDeletedAsset(token: string, confirmation: DeleteConfirmation) {
    decodeConfirmation(confirmation)
    decodeUuid(token)

    if (!this.state.deletedAssets[token])
      throw new Error("Attachment restore metadata is missing")
    const next = this.nextState()
    delete next.deletedAssets[token]
    this.transaction(next, [
      { path: `${internal}/deleted-assets/${token}/content`, bytes: null },
    ])
  }
  emptyDeletedAssets(confirmation: DeleteConfirmation) {
    decodeConfirmation(confirmation)

    const deleted = this.listDeletedAssets().map(function token(entry) {
      return entry.undoToken
    })

    const next = this.nextState()

    for (const token of deleted) delete next.deletedAssets[token]
    this.transaction(
      next,
      deleted.map(function removal(token) {
        return {
          path: `${internal}/deleted-assets/${token}/content`,
          bytes: null,
        }
      }),
    )

    return { deleted }
  }

  /** Events invalidate views; callers must compare expected content before saving. */
  subscribe(listener: (event: VaultChange) => void) {
    this.assertOpen()

    const subscriptions = new Map<string, FSWatcher>()
    let active = true

    const refresh = () => {
      this.assertOpen()
      const directories = new Set(["", ...this.walk().directories])

      for (const [id, watcher] of subscriptions) {
        if (!directories.has(id)) {
          watcher.close()
          this.watchers.delete(watcher)
          subscriptions.delete(id)
        }
      }

      for (const id of directories) {
        if (subscriptions.has(id)) continue

        const watcher = watch(
          id ? this.safe(id) : this.root,
          (event, filename) => {
            if (!active || this.closed) return
            const name = filename?.toString().split(sep).join("/") ?? null

            if (
              name?.split("/").some(function hidden(part) {
                return part.startsWith(".")
              })
            )
              return
            const path = name ? [id, name].filter(Boolean).join("/") : null

            try {
              refresh()
            } catch (error) {
              listener({
                kind: "resync",
                path: null,
                error:
                  error instanceof Error
                    ? error
                    : new Error("Cannot refresh vault watchers"),
              })

              return
            }

            listener({ kind: path ? event : "resync", path })
          },
        )

        watcher.on("error", function report(error) {
          if (active) listener({ kind: "resync", path: null, error })
        })
        subscriptions.set(id, watcher)
        this.watchers.add(watcher)
      }
    }

    const stop = () => {
      active = false

      for (const watcher of subscriptions.values()) {
        watcher.close()
        this.watchers.delete(watcher)
      }

      subscriptions.clear()
    }

    try {
      refresh()
    } catch (error) {
      stop()
      throw error
    }

    return stop
  }
  close() {
    if (this.closed) return

    for (const watcher of this.watchers) watcher.close()
    this.watchers.clear()

    if (this.locked) {
      try {
        const current = this.readLock()

        if (
          current.token === this.owner.token &&
          current.pid === this.owner.pid
        ) {
          unlinkSync(this.safe(lockPath))
          syncDirectory(this.safe(internal))
        }
      } catch (error) {
        if (!missing(Option.getOrUndefined(decodeError(error))))
          console.warn("Vault lock retained; inspect it before removal", error)
      }
    }

    this.closed = true
  }
}
