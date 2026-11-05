import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Schema,
  SchemaTransformation,
  Struct,
} from "effect"
import { randomUUID } from "node:crypto"
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, extname, join, resolve } from "node:path"

import { NotesError } from "@/features/notes/errors"
import { atomicWrite, AtomicWriteError, syncDirectory } from "@/platform/files"

export type Notebook = typeof notebookSchema.Type

export type Note = typeof noteSchema.Type

export type Workspace = typeof workspaceSchema.Type

type NotePatch = typeof notePatchSchema.Type

type ProcessLock = typeof lockSchema.Type

const bodyLimit = 2 * 1024 * 1024

const fileLimit = 32 * 1024 * 1024

const nonemptySchema = Schema.String.check(
  Schema.makeFilter((value) => value.trim() !== ""),
)

const bodySchema = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      Buffer.byteLength(value, "utf8") <= bodyLimit ||
      "Note body exceeds the 2 MB limit",
  ),
)

const timestampSchema = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      (Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value) ||
      "Invalid workspace timestamp",
  ),
)

const notebookSchema = Schema.Struct({
  id: nonemptySchema,
  name: nonemptySchema,
})

const noteSchema = Schema.Struct({
  id: nonemptySchema,
  notebookId: nonemptySchema,
  title: Schema.String,
  body: bodySchema,
  pinned: Schema.Boolean,
  trashedAt: Schema.NullOr(timestampSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

const themeSchema = Schema.Literals(["light", "dark"])

const workspaceSchema = Schema.Struct({
  version: Schema.Literal(1),
  notebooks: Schema.mutable(Schema.Array(notebookSchema)).check(
    Schema.isMinLength(1),
  ),
  notes: Schema.mutable(Schema.Array(noteSchema)),
  theme: themeSchema,
  selectedNoteId: Schema.NullOr(Schema.String),
}).check(
  Schema.makeFilter((workspace) => {
    const issues: Schema.FilterIssue[] = []
    const ids = new Set<string>()

    for (const entry of [...workspace.notebooks, ...workspace.notes]) {
      if (ids.has(entry.id)) issues.push(`Duplicate workspace ID: ${entry.id}`)
      ids.add(entry.id)
    }

    const notebookIds = new Set(
      workspace.notebooks.map((notebook) => notebook.id),
    )

    for (const note of workspace.notes) {
      if (!notebookIds.has(note.notebookId))
        issues.push(`Invalid notebook reference for note ${note.id}`)
    }

    if (
      workspace.selectedNoteId !== null &&
      !workspace.notes.some((note) => note.id === workspace.selectedNoteId)
    ) {
      issues.push("Invalid selected note reference")
    }

    return issues
  }),
)

const notePatchSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  body: Schema.optional(bodySchema),
  notebookId: Schema.optional(Schema.String),
})

const exportDraftSchema = Schema.Struct(
  Struct.pick(notePatchSchema.fields, ["title", "body"]),
)

const importPathsSchema = Schema.Array(Schema.NonEmptyString)

const subscriberSchema = Schema.declare((input): input is () => void =>
  Predicate.isFunction(input),
)

const lockSchema = Schema.Struct({
  pid: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  token: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/)),
})

const errorCodeFieldsSchema = Schema.Struct({ code: Schema.String })

const errorCodeSchema = Schema.instanceOf(Error).pipe(
  Schema.decodeTo(errorCodeFieldsSchema),
)

const errorTextSchema = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform<string, unknown>({
      decode: (error) =>
        error instanceof Error ? error.message : String(error),
      encode: (message) => message,
    }),
  ),
)

function nonempty(value: string, label: string) {
  if (!Schema.is(nonemptySchema)(value))
    throw new Error(`${label} must not be empty`)

  return value
}

function freezeWorkspace(workspace: Workspace) {
  for (const notebook of workspace.notebooks) Object.freeze(notebook)

  for (const note of workspace.notes) Object.freeze(note)
  Object.freeze(workspace.notebooks)
  Object.freeze(workspace.notes)
  Object.freeze(workspace)

  return workspace
}

function readBytes(path: string, limit: number): Buffer | null {
  let fd: number

  try {
    if (!lstatSync(path).isFile())
      throw new Error(`${path} must be a regular file, not a symlink`)
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  } catch (error) {
    if (
      Option.getOrUndefined(Schema.decodeUnknownOption(errorCodeSchema)(error))
        ?.code === "ENOENT"
    )
      return null
    throw new Error(
      `Cannot read ${path}: ${Schema.decodeUnknownSync(errorTextSchema)(error)}`,
      {
        cause: error,
      },
    )
  }

  try {
    const stat = fstatSync(fd)

    if (!stat.isFile()) throw new Error(`${path} must be a regular file`)

    const label =
      limit === fileLimit
        ? "32 MB file"
        : limit === bodyLimit
          ? "2 MB import"
          : `${limit}-byte lock`

    if (stat.size > limit) throw new Error(`${path} exceeds the ${label} limit`)
    const bytes = readFileSync(fd)

    if (bytes.length > limit)
      throw new Error(`${path} exceeds the file size limit`)

    return bytes
  } finally {
    closeSync(fd)
  }
}

function readText(path: string, limit: number) {
  const bytes = readBytes(path, limit)

  if (bytes === null) return null

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error(`${path} must use UTF-8 encoding`, { cause: error })
  }
}

function decodeWorkspace(bytes: string, path: string, backup: string) {
  try {
    return Schema.decodeUnknownSync(workspaceSchema, {
      onExcessProperty: "error",
      errors: "all",
    })(JSON.parse(bytes))
  } catch (error) {
    throw new Error(
      `Cannot load ${path}: ${Schema.decodeUnknownSync(errorTextSchema)(error)}. Keep this file. Inspect backup ${backup}; copy a valid backup to workspace.json only after you preserve the damaged file.`,
      { cause: error },
    )
  }
}

function readLock(path: string): ProcessLock | null {
  try {
    const bytes = readText(path, 4096)

    if (bytes === null) return null

    return Schema.decodeUnknownSync(lockSchema)(JSON.parse(bytes))
  } catch (error) {
    throw new Error(
      `Invalid lock ${path}. Inspect it and remove it only when no Still Notes process uses this directory.`,
      { cause: error },
    )
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    if (
      Option.getOrUndefined(Schema.decodeUnknownOption(errorCodeSchema)(error))
        ?.code === "ESRCH"
    )
      return false

    if (
      Option.getOrUndefined(Schema.decodeUnknownOption(errorCodeSchema)(error))
        ?.code === "EPERM"
    )
      return true
    throw error
  }
}

function createLock(path: string, directory: string, owner: ProcessLock) {
  let fd: number

  try {
    fd = openSync(path, "wx", 0o600)
  } catch (error) {
    if (
      Option.getOrUndefined(Schema.decodeUnknownOption(errorCodeSchema)(error))
        ?.code === "EEXIST"
    )
      return false
    throw error
  }

  try {
    try {
      writeFileSync(fd, JSON.stringify(owner), "utf8")
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }

    syncDirectory(directory)
  } catch (error) {
    unlinkSync(path)
    throw error
  }

  return true
}

function acquireLock(path: string, directory: string, owner: ProcessLock) {
  if (createLock(path, directory, owner)) return
  const existing = readLock(path)

  if (!existing || processIsAlive(existing.pid)) {
    throw new Error(
      `Workspace lock ${path} is held by another process${existing ? ` (PID ${existing.pid})` : ""}. Close that instance and retry.`,
    )
  }

  const recoveryPath = `${path}.recovery`
  let recovery: number

  try {
    recovery = openSync(recoveryPath, "wx", 0o600)
  } catch (error) {
    throw new Error(
      `Cannot recover stale lock. Inspect ${recoveryPath}; remove it only when no recovery is running, then retry.`,
      { cause: error },
    )
  }

  try {
    // One recovery owner must check and remove the stale lock without another remover racing it.
    const current = readLock(path)

    if (
      current &&
      current.token === existing.token &&
      current.pid === existing.pid &&
      !processIsAlive(current.pid)
    ) {
      unlinkSync(path)
    }

    if (!createLock(path, directory, owner))
      throw new Error(
        `Workspace lock ${path} was acquired by another process. Retry after it closes.`,
      )
  } finally {
    closeSync(recovery)
    unlinkSync(recoveryPath)
  }
}

function makeNote(
  notebookId: string,
  now: string,
  title = "Untitled note",
  body = "",
): Note {
  return {
    id: randomUUID(),
    notebookId,
    title,
    body,
    pinned: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function freshWorkspace(): Workspace {
  const notebook = { id: randomUUID(), name: "Personal" }

  const welcome = makeNote(
    notebook.id,
    DateTime.formatIso(DateTime.nowUnsafe()),
    "Welcome to Still Notes",
    "# Welcome to Still Notes\n\nThis note is an example, not your personal data. You can edit or delete it.\n\nCreate a note, choose a notebook, and write in Markdown. Pin notes to keep them close. Use Trash to restore a note before you delete it permanently.\n\nYour notes stay in this local workspace. Export Markdown files to keep an extra copy.\n",
  )

  return {
    version: 1,
    notebooks: [notebook],
    notes: [welcome],
    theme: "light",
    selectedNoteId: welcome.id,
  }
}

function exportName(title: string) {
  let bytes = 0
  let name = ""

  for (const character of title.normalize("NFC").trim()) {
    const code = character.charCodeAt(0)

    const safe =
      code < 32 || code === 127 || '<>:"/\\|?*'.includes(character)
        ? "_"
        : character

    bytes += Buffer.byteLength(safe, "utf8")

    if (bytes > 160) break
    name += safe
  }

  name = name.replace(/^[. ]+|[. ]+$/g, "").trim()

  if (!name) name = "Untitled note"

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = `_${name}`

  return name
}

export class NotesStore {
  private readonly directory: string
  private readonly path: string
  private readonly backupPath: string
  private readonly lockPath: string
  private readonly owner: ProcessLock
  private snapshot: Workspace
  private diskBytes: string | null = null
  private pendingWrite: {
    workspace: Workspace
    bytes: string
    error: AtomicWriteError
  } | null = null
  private closed = false
  private readonly listeners = new Set<() => void>()

  constructor(directory: string) {
    this.directory = resolve(nonempty(directory, "Data directory"))
    this.path = join(this.directory, "workspace.json")
    this.backupPath = `${this.path}.bak`
    this.lockPath = join(this.directory, ".store.lock")
    this.owner = { pid: process.pid, token: randomUUID() }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })

    if (!lstatSync(this.directory).isDirectory())
      throw new Error("Data directory must be a real directory, not a symlink")
    chmodSync(this.directory, 0o700)

    try {
      acquireLock(this.lockPath, this.directory, this.owner)
      const bytes = readText(this.path, fileLimit)
      const previous = readText(this.backupPath, fileLimit)

      if (previous !== null)
        decodeWorkspace(previous, this.backupPath, this.backupPath)

      if (bytes === null && previous !== null) {
        throw new Error(
          `Missing ${this.path}. Recovery is required: preserve backup ${this.backupPath}, then copy it to ${this.path}.`,
        )
      }

      this.snapshot = freezeWorkspace(
        bytes === null
          ? freshWorkspace()
          : decodeWorkspace(bytes, this.path, this.backupPath),
      )
      this.diskBytes = bytes

      if (bytes === null) this.persist(this.snapshot)
      else chmodSync(this.path, 0o600)

      if (previous !== null) chmodSync(this.backupPath, 0o600)
    } catch (error) {
      try {
        this.releaseLock()
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `${Schema.decodeUnknownSync(errorTextSchema)(error)}. Lock cleanup failed: ${Schema.decodeUnknownSync(errorTextSchema)(cleanupError)}`,
        )
      }

      throw error
    }

    this.getSnapshot = this.getSnapshot.bind(this)
    this.subscribe = this.subscribe.bind(this)
  }

  getSnapshot(): Workspace {
    return this.snapshot
  }

  readonly getWriteRecoveryState = (): "ready" | "uncertain" =>
    this.pendingWrite === null ? "ready" : "uncertain"

  recoverWrite(): Effect.Effect<void, NotesError> {
    return Effect.try({
      try: () => {
        this.ensureOpen()
        const pending = this.pendingWrite

        if (pending === null) return
        this.ensureOwner()
        const current = readBytes(this.path, fileLimit)

        if (
          current === null ||
          !current.equals(Buffer.from(pending.bytes, "utf8"))
        )
          throw new Error(
            `Workspace changed after an uncertain save. Preserve ${this.path}, backup ${this.backupPath}, and export your drafts before you close or reopen the store. Recovery did not overwrite any files.`,
            { cause: pending.error },
          )
        syncDirectory(this.directory)
        this.diskBytes = pending.bytes
        this.snapshot = pending.workspace
        this.pendingWrite = null
        this.notifyListeners()
      },
      catch: (cause) => NotesError.fromCause("recoverWrite", cause),
    })
  }

  subscribe(listener: () => void): () => void {
    this.ensureOpen()
    Schema.decodeUnknownSync(subscriberSchema)(listener)
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  createNotebook(name: string): Effect.Effect<Notebook, NotesError> {
    return Effect.try({
      try: () => {
        this.ensureWritable()

        const notebook = {
          id: randomUUID(),
          name: nonempty(name, "Notebook name").trim(),
        }

        this.commit({
          ...this.snapshot,
          notebooks: [...this.snapshot.notebooks, notebook],
        })

        return Object.freeze(notebook)
      },
      catch: (cause) => NotesError.fromCause("createNotebook", cause),
    })
  }

  renameNotebook(id: string, name: string): Effect.Effect<void, NotesError> {
    return Effect.try({
      try: () => {
        this.ensureWritable()
        const notebook = this.notebook(id)
        const nextName = nonempty(name, "Notebook name").trim()

        if (notebook.name === nextName) return
        this.commit({
          ...this.snapshot,
          notebooks: this.snapshot.notebooks.map((entry) =>
            entry.id === id ? { ...entry, name: nextName } : entry,
          ),
        })
      },
      catch: (cause) => NotesError.fromCause("renameNotebook", cause),
    })
  }

  createNote(notebookId?: string): Effect.Effect<Note, NotesError> {
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.try({
        try: () => {
          this.ensureWritable()

          const note = makeNote(
            this.notebook(notebookId ?? this.snapshot.notebooks[0]?.id).id,
            DateTime.formatIso(now),
          )

          this.commit({
            ...this.snapshot,
            notes: [...this.snapshot.notes, note],
            selectedNoteId: note.id,
          })

          return Object.freeze(note)
        },
        catch: (cause) => NotesError.fromCause("createNote", cause),
      }),
    )
  }

  duplicateNote(
    id: string,
    draft: Pick<NotePatch, "title" | "body"> = {},
  ): Effect.Effect<Note, NotesError> {
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.try({
        try: () => {
          this.ensureWritable()
          const source = this.note(nonempty(id, "Note ID"))

          if (source.trashedAt !== null)
            throw new Error("Cannot duplicate a trashed note")

          const parsed = Schema.decodeUnknownSync(exportDraftSchema, {
            onExcessProperty: "error",
            errors: "all",
          })(draft)

          const title = parsed.title ?? source.title
          const base = `${title.trim() === "" ? "Untitled note" : title} copy`

          const titles = new Set(
            this.snapshot.notes
              .filter((note) => note.notebookId === source.notebookId)
              .map((note) => note.title),
          )

          let copyTitle = base

          for (let suffix = 2; titles.has(copyTitle); suffix += 1) {
            if (suffix > titles.size + 1)
              throw new Error("Cannot find an available duplicate title")
            copyTitle = `${base} ${suffix}`
          }

          const copy = makeNote(
            source.notebookId,
            DateTime.formatIso(now),
            copyTitle,
            parsed.body ?? source.body,
          )

          this.commit({
            ...this.snapshot,
            notes: [...this.snapshot.notes, copy],
            selectedNoteId: copy.id,
          })

          return Object.freeze(copy)
        },
        catch: (cause) => NotesError.fromCause("duplicateNote", cause),
      }),
    )
  }

  updateNote(id: string, patch: NotePatch): Effect.Effect<void, NotesError> {
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.try({
        try: () => {
          this.ensureWritable()
          const note = this.note(id)

          const parsed = Schema.decodeUnknownSync(notePatchSchema, {
            onExcessProperty: "error",
            errors: "all",
          })(patch)

          const title = parsed.title ?? note.title
          const body = parsed.body ?? note.body

          const notebookId =
            parsed.notebookId === undefined
              ? note.notebookId
              : this.notebook(parsed.notebookId).id

          if (
            title === note.title &&
            body === note.body &&
            notebookId === note.notebookId
          )
            return
          this.replaceNote({
            ...note,
            title,
            body,
            notebookId,
            updatedAt: DateTime.formatIso(now),
          })
        },
        catch: (cause) => NotesError.fromCause("updateNote", cause),
      }),
    )
  }

  togglePin(id: string): Effect.Effect<void, NotesError> {
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.try({
        try: () => {
          this.ensureWritable()
          const note = this.note(id)
          this.replaceNote({
            ...note,
            pinned: !note.pinned,
            updatedAt: DateTime.formatIso(now),
          })
        },
        catch: (cause) => NotesError.fromCause("togglePin", cause),
      }),
    )
  }

  trashNote(id: string): Effect.Effect<void, NotesError> {
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.try({
        try: () => {
          this.ensureWritable()
          const note = this.note(id)

          if (note.trashedAt !== null) return
          const timestamp = DateTime.formatIso(now)
          this.replaceNote(
            { ...note, trashedAt: timestamp, updatedAt: timestamp },
            this.snapshot.selectedNoteId === id
              ? null
              : this.snapshot.selectedNoteId,
          )
        },
        catch: (cause) => NotesError.fromCause("trashNote", cause),
      }),
    )
  }

  restoreNote(id: string): Effect.Effect<void, NotesError> {
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.try({
        try: () => {
          this.ensureWritable()
          const note = this.note(id)

          if (note.trashedAt === null) return
          this.replaceNote({
            ...note,
            trashedAt: null,
            updatedAt: DateTime.formatIso(now),
          })
        },
        catch: (cause) => NotesError.fromCause("restoreNote", cause),
      }),
    )
  }

  deleteNote(id: string): Effect.Effect<void, NotesError> {
    return Effect.try({
      try: () => {
        this.ensureWritable()

        if (this.note(id).trashedAt === null)
          throw new Error(
            "Move the note to Trash before you delete it permanently",
          )
        this.commit({
          ...this.snapshot,
          notes: this.snapshot.notes.filter((note) => note.id !== id),
          selectedNoteId:
            this.snapshot.selectedNoteId === id
              ? null
              : this.snapshot.selectedNoteId,
        })
      },
      catch: (cause) => NotesError.fromCause("deleteNote", cause),
    })
  }

  selectNote(id: string | null): Effect.Effect<void, NotesError> {
    return Effect.try({
      try: () => {
        this.ensureWritable()

        if (id !== null) this.note(id)

        if (this.snapshot.selectedNoteId === id) return
        this.commit({ ...this.snapshot, selectedNoteId: id })
      },
      catch: (cause) => NotesError.fromCause("selectNote", cause),
    })
  }

  setTheme(theme: "light" | "dark"): Effect.Effect<void, NotesError> {
    return Effect.try({
      try: () => {
        this.ensureWritable()
        Schema.decodeUnknownSync(themeSchema)(theme)

        if (this.snapshot.theme === theme) return
        this.commit({ ...this.snapshot, theme })
      },
      catch: (cause) => NotesError.fromCause("setTheme", cause),
    })
  }

  importMarkdown(
    paths: string[],
    notebookId?: string,
  ): Effect.Effect<Note[], NotesError> {
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.try({
        try: () => {
          this.ensureWritable()
          const parsedPaths = Schema.decodeUnknownSync(importPathsSchema)(paths)

          const notebook = this.notebook(
            notebookId ?? this.snapshot.notebooks[0]?.id,
          )

          const notes = parsedPaths.map((path) => {
            const extension = extname(path).toLowerCase()

            if (extension !== ".md" && extension !== ".markdown")
              throw new Error(`${path} is not a .md or .markdown file`)
            const body = readText(path, bodyLimit)

            if (body === null)
              throw new Error(`Markdown file does not exist: ${path}`)

            for (let index = 0; index < body.length; index += 1) {
              const code = body.charCodeAt(index)

              if (
                (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
                code === 127
              )
                throw new Error(
                  `${path} contains binary data or an unsafe encoding; use UTF-8 Markdown`,
                )
            }

            return makeNote(
              notebook.id,
              DateTime.formatIso(now),
              basename(path, extname(path)),
              Schema.decodeUnknownSync(bodySchema)(body),
            )
          })

          if (notes.length === 0) return []
          this.commit({
            ...this.snapshot,
            notes: [...this.snapshot.notes, ...notes],
            selectedNoteId: notes[0]?.id ?? this.snapshot.selectedNoteId,
          })

          return notes.map((note) => Object.freeze(note))
        },
        catch: (cause) => NotesError.fromCause("importMarkdown", cause),
      }),
    )
  }

  exportMarkdown(
    id: string,
    directory: string,
    draft: Pick<NotePatch, "title" | "body"> = {},
  ): Effect.Effect<string, NotesError> {
    return Effect.try({
      try: () => {
        this.ensureOpen()

        const note = {
          ...this.note(id),
          ...Schema.decodeUnknownSync(exportDraftSchema, {
            onExcessProperty: "error",
            errors: "all",
          })(draft),
        }

        const output = resolve(nonempty(directory, "Export directory"))
        mkdirSync(output, { recursive: true, mode: 0o700 })
        const name = exportName(note.title)

        for (let index = 1; ; index += 1) {
          const path = join(
            output,
            `${name}${index === 1 ? "" : ` (${index})`}.md`,
          )

          let fd: number

          try {
            fd = openSync(path, "wx", 0o600)
          } catch (error) {
            if (
              Option.getOrUndefined(
                Schema.decodeUnknownOption(errorCodeSchema)(error),
              )?.code === "EEXIST"
            )
              continue
            throw new Error(
              `Cannot export Markdown to ${path}: ${Schema.decodeUnknownSync(errorTextSchema)(error)}`,
              { cause: error },
            )
          }

          try {
            try {
              writeFileSync(fd, note.body, "utf8")
              fsyncSync(fd)
            } finally {
              closeSync(fd)
            }

            syncDirectory(output)

            return path
          } catch (error) {
            rmSync(path, { force: true })
            throw new Error(
              `Cannot export Markdown to ${path}: ${Schema.decodeUnknownSync(errorTextSchema)(error)}`,
              { cause: error },
            )
          }
        }
      },
      catch: (cause) => NotesError.fromCause("exportMarkdown", cause),
    })
  }

  close(): void {
    if (this.closed) return
    this.releaseLock()
    this.listeners.clear()
    this.closed = true
  }

  private ensureOpen() {
    if (this.closed)
      throw new Error(
        "NotesStore is closed; open the workspace again before you make changes",
      )
  }

  private ensureWritable() {
    this.ensureOpen()

    if (this.pendingWrite !== null)
      throw new Error(
        "A workspace replacement awaits directory synchronization. Export your drafts if needed, then call recoverWrite() explicitly. Do not repeat the failed mutation; recovery will publish its intended result.",
        { cause: this.pendingWrite.error },
      )
  }

  private notebook(id: string | undefined) {
    const notebook = this.snapshot.notebooks.find((entry) => entry.id === id)

    if (!notebook) throw new Error(`Notebook does not exist: ${String(id)}`)

    return notebook
  }

  private note(id: string) {
    const note = this.snapshot.notes.find((entry) => entry.id === id)

    if (!note) throw new Error(`Note does not exist: ${String(id)}`)

    return note
  }

  private replaceNote(
    note: Note,
    selectedNoteId = this.snapshot.selectedNoteId,
  ) {
    this.commit({
      ...this.snapshot,
      notes: this.snapshot.notes.map((entry) =>
        entry.id === note.id ? note : entry,
      ),
      selectedNoteId,
    })
  }

  private commit(workspace: Workspace) {
    this.ensureWritable()

    const validated = freezeWorkspace(
      Schema.decodeUnknownSync(workspaceSchema, {
        onExcessProperty: "error",
        errors: "all",
      })(workspace),
    )

    this.persist(validated)
    this.snapshot = validated
    this.notifyListeners()
  }

  private notifyListeners() {
    const listenersAtTransition = [...this.listeners]

    for (const listener of listenersAtTransition) {
      try {
        listener()
      } catch (error) {
        console.error(
          "NotesStore subscriber failed after a state change:",
          error,
        )
      }
    }
  }

  private persist(workspace: Workspace) {
    const bytes = JSON.stringify(workspace, null, 2) + "\n"

    if (Buffer.byteLength(bytes, "utf8") > fileLimit)
      throw new Error(
        "Workspace exceeds the 32 MB file limit; export or remove notes before saving",
      )

    try {
      this.ensureOwner()
      const current = readText(this.path, fileLimit)

      if (current !== this.diskBytes)
        throw new Error(
          `Workspace changed outside this instance. Preserve ${this.path} and reopen it; do not overwrite external edits.`,
        )
      const previous = readText(this.backupPath, fileLimit)

      if (previous !== null)
        decodeWorkspace(previous, this.backupPath, this.backupPath)

      if (this.diskBytes !== null)
        atomicWrite(this.backupPath, this.diskBytes, this.directory)
      atomicWrite(this.path, bytes, this.directory)
      this.diskBytes = bytes
    } catch (error) {
      if (
        error instanceof AtomicWriteError &&
        error.path === this.path &&
        error.replacementCompleted
      ) {
        this.pendingWrite = { workspace, bytes, error }
        this.notifyListeners()
      }

      const recovery =
        this.pendingWrite === null
          ? `The saved snapshot is unchanged. Inspect ${this.path} and backup ${this.backupPath} before you retry; either file may have changed.`
          : "The workspace was replaced, but durability is not confirmed. The saved snapshot is unchanged. Keep or export your drafts, then call recoverWrite() explicitly. Do not repeat the failed mutation."

      throw new Error(
        `Cannot save ${this.path}: ${Schema.decodeUnknownSync(errorTextSchema)(error)}. ${recovery}`,
        { cause: error },
      )
    }
  }

  private ensureOwner() {
    const lock = readLock(this.lockPath)

    if (lock?.token !== this.owner.token || lock.pid !== this.owner.pid)
      throw new Error(
        "Workspace lock changed. Export your drafts before you close and reopen the store.",
      )
  }

  private releaseLock() {
    const bytes = readText(this.lockPath, 4096)

    if (bytes === JSON.stringify(this.owner)) {
      unlinkSync(this.lockPath)
      syncDirectory(this.directory)
    }
  }
}

export class Notes extends Context.Service<Notes, NotesStore>()(
  "still-notes/notes/Notes",
) {
  static layer(directory: string) {
    return Layer.effect(
      Notes,
      Effect.acquireRelease(
        Effect.try({
          try: () => new NotesStore(directory),
          catch: (cause) => NotesError.fromCause("open", cause),
        }),
        (store) =>
          Effect.try({
            try: () => store.close(),
            catch: (cause) => NotesError.fromCause("close", cause),
          }).pipe(Effect.orDie),
      ),
    )
  }
}
