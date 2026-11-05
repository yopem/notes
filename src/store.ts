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
import { homedir } from "node:os"
import { basename, extname, isAbsolute, join, resolve } from "node:path"

import { z } from "zod"

import { readEnvironment } from "@/utils/env"
import { atomicWrite, syncDirectory } from "@/utils/files"

export interface Notebook {
  id: string
  name: string
}

export interface Note {
  id: string
  notebookId: string
  title: string
  body: string
  pinned: boolean
  trashedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  version: 1
  notebooks: Notebook[]
  notes: Note[]
  theme: "light" | "dark"
  selectedNoteId: string | null
}

interface NotePatch {
  title?: string
  body?: string
  notebookId?: string
}

interface ProcessLock {
  pid: number
  token: string
}

const bodyLimit = 2 * 1024 * 1024

const fileLimit = 32 * 1024 * 1024

const nonemptySchema = z.string().refine((value) => value.trim() !== "")

const bodySchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, "utf8") <= bodyLimit, {
    error: "Note body exceeds the 2 MB limit",
  })

const timestampSchema = z
  .string()
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    { error: "Invalid workspace timestamp" },
  )

const notebookSchema = z.strictObject({
  id: nonemptySchema,
  name: nonemptySchema,
})

const noteSchema = z.strictObject({
  id: nonemptySchema,
  notebookId: nonemptySchema,
  title: z.string(),
  body: bodySchema,
  pinned: z.boolean(),
  trashedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

const themeSchema = z.enum(["light", "dark"])

const workspaceSchema = z
  .strictObject({
    version: z.literal(1),
    notebooks: z.array(notebookSchema).min(1),
    notes: z.array(noteSchema),
    theme: themeSchema,
    selectedNoteId: z.string().nullable(),
  })
  .superRefine((workspace, context) => {
    const ids = new Set<string>()

    for (const entry of [...workspace.notebooks, ...workspace.notes]) {
      if (ids.has(entry.id))
        context.addIssue({
          code: "custom",
          message: `Duplicate workspace ID: ${entry.id}`,
        })
      ids.add(entry.id)
    }

    const notebookIds = new Set(
      workspace.notebooks.map((notebook) => notebook.id),
    )

    for (const note of workspace.notes) {
      if (!notebookIds.has(note.notebookId))
        context.addIssue({
          code: "custom",
          message: `Invalid notebook reference for note ${note.id}`,
        })
    }

    if (
      workspace.selectedNoteId !== null &&
      !workspace.notes.some((note) => note.id === workspace.selectedNoteId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid selected note reference",
      })
    }
  })

const notePatchSchema = z.strictObject({
  title: z.string().optional(),
  body: bodySchema.optional(),
  notebookId: z.string().optional(),
})

const exportDraftSchema = notePatchSchema.pick({ title: true, body: true })

const importPathsSchema = z.array(z.string().min(1))

const subscriberSchema = z.function()

const lockSchema = z.object({
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  token: z.string().regex(/^[a-f0-9-]{36}$/),
})

const errorCodeFieldsSchema = z.object({ code: z.string() })

const errorCodeSchema = z
  .instanceof(Error)
  .transform((error) => errorCodeFieldsSchema.safeParse(error).data)

const errorTextSchema = z
  .instanceof(Error)
  .transform((error) => error.message)
  .catch((context) => String(context.input))

function nonempty(value: string, label: string) {
  const parsed = nonemptySchema.safeParse(value)

  if (!parsed.success) throw new Error(`${label} must not be empty`)

  return parsed.data
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
    if (errorCodeSchema.safeParse(error).data?.code === "ENOENT") return null
    throw new Error(`Cannot read ${path}: ${errorTextSchema.parse(error)}`, {
      cause: error,
    })
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
    return workspaceSchema.parse(JSON.parse(bytes))
  } catch (error) {
    throw new Error(
      `Cannot load ${path}: ${errorTextSchema.parse(error)}. Keep this file. Inspect backup ${backup}; copy a valid backup to workspace.json only after you preserve the damaged file.`,
      { cause: error },
    )
  }
}

function readLock(path: string): ProcessLock | null {
  try {
    const bytes = readText(path, 4096)

    if (bytes === null) return null

    return lockSchema.parse(JSON.parse(bytes))
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
    if (errorCodeSchema.safeParse(error).data?.code === "ESRCH") return false

    if (errorCodeSchema.safeParse(error).data?.code === "EPERM") return true
    throw error
  }
}

function createLock(path: string, directory: string, owner: ProcessLock) {
  let fd: number

  try {
    fd = openSync(path, "wx", 0o600)
  } catch (error) {
    if (errorCodeSchema.safeParse(error).data?.code === "EEXIST") return false
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
  title = "Untitled note",
  body = "",
): Note {
  const now = new Date().toISOString()

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

export function defaultDataDirectory(): string {
  const environment = readEnvironment()

  if (environment.dataDirectory) return resolve(environment.dataDirectory)

  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "Still Notes")

  if (process.platform === "win32")
    return join(
      environment.localAppData ??
        environment.appData ??
        join(homedir(), "AppData", "Local"),
      "Still Notes",
    )
  const xdg = environment.xdgDataHome

  return join(
    xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share"),
    "still-notes",
  )
}

export class NotesStore {
  private readonly directory: string
  private readonly path: string
  private readonly backupPath: string
  private readonly lockPath: string
  private readonly owner: ProcessLock
  private snapshot: Workspace
  private diskBytes: string | null = null
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
          `${errorTextSchema.parse(error)}. Lock cleanup failed: ${errorTextSchema.parse(cleanupError)}`,
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

  subscribe(listener: () => void): () => void {
    this.ensureOpen()
    subscriberSchema.parse(listener)
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  createNotebook(name: string): Notebook {
    this.ensureOpen()

    const notebook = {
      id: randomUUID(),
      name: nonempty(name, "Notebook name").trim(),
    }

    this.commit({
      ...this.snapshot,
      notebooks: [...this.snapshot.notebooks, notebook],
    })

    return Object.freeze(notebook)
  }

  renameNotebook(id: string, name: string): void {
    this.ensureOpen()
    const notebook = this.notebook(id)
    const nextName = nonempty(name, "Notebook name").trim()

    if (notebook.name === nextName) return
    this.commit({
      ...this.snapshot,
      notebooks: this.snapshot.notebooks.map((entry) =>
        entry.id === id ? { ...entry, name: nextName } : entry,
      ),
    })
  }

  createNote(notebookId?: string): Note {
    this.ensureOpen()

    const note = makeNote(
      this.notebook(notebookId ?? this.snapshot.notebooks[0]?.id).id,
    )

    this.commit({
      ...this.snapshot,
      notes: [...this.snapshot.notes, note],
      selectedNoteId: note.id,
    })

    return Object.freeze(note)
  }

  updateNote(id: string, patch: NotePatch): void {
    this.ensureOpen()
    const note = this.note(id)
    const parsed = notePatchSchema.parse(patch)
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
      updatedAt: new Date().toISOString(),
    })
  }

  togglePin(id: string): void {
    this.ensureOpen()
    const note = this.note(id)
    this.replaceNote({
      ...note,
      pinned: !note.pinned,
      updatedAt: new Date().toISOString(),
    })
  }

  trashNote(id: string): void {
    this.ensureOpen()
    const note = this.note(id)

    if (note.trashedAt !== null) return
    const now = new Date().toISOString()
    this.replaceNote(
      { ...note, trashedAt: now, updatedAt: now },
      this.snapshot.selectedNoteId === id ? null : this.snapshot.selectedNoteId,
    )
  }

  restoreNote(id: string): void {
    this.ensureOpen()
    const note = this.note(id)

    if (note.trashedAt === null) return
    this.replaceNote({
      ...note,
      trashedAt: null,
      updatedAt: new Date().toISOString(),
    })
  }

  deleteNote(id: string): void {
    this.ensureOpen()

    if (this.note(id).trashedAt === null)
      throw new Error("Move the note to Trash before you delete it permanently")
    this.commit({
      ...this.snapshot,
      notes: this.snapshot.notes.filter((note) => note.id !== id),
      selectedNoteId:
        this.snapshot.selectedNoteId === id
          ? null
          : this.snapshot.selectedNoteId,
    })
  }

  selectNote(id: string | null): void {
    this.ensureOpen()

    if (id !== null) this.note(id)

    if (this.snapshot.selectedNoteId === id) return
    this.commit({ ...this.snapshot, selectedNoteId: id })
  }

  setTheme(theme: "light" | "dark"): void {
    this.ensureOpen()
    themeSchema.parse(theme)

    if (this.snapshot.theme === theme) return
    this.commit({ ...this.snapshot, theme })
  }

  importMarkdown(paths: string[], notebookId?: string): Note[] {
    this.ensureOpen()
    const parsedPaths = importPathsSchema.parse(paths)
    const notebook = this.notebook(notebookId ?? this.snapshot.notebooks[0]?.id)

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
        basename(path, extname(path)),
        bodySchema.parse(body),
      )
    })

    if (notes.length === 0) return []
    this.commit({
      ...this.snapshot,
      notes: [...this.snapshot.notes, ...notes],
      selectedNoteId: notes[0]?.id ?? this.snapshot.selectedNoteId,
    })

    return notes.map((note) => Object.freeze(note))
  }

  exportMarkdown(
    id: string,
    directory: string,
    draft: Pick<NotePatch, "title" | "body"> = {},
  ): string {
    this.ensureOpen()
    const note = { ...this.note(id), ...exportDraftSchema.parse(draft) }
    const output = resolve(nonempty(directory, "Export directory"))
    mkdirSync(output, { recursive: true, mode: 0o700 })
    const name = exportName(note.title)

    for (let index = 1; ; index += 1) {
      const path = join(output, `${name}${index === 1 ? "" : ` (${index})`}.md`)
      let fd: number

      try {
        fd = openSync(path, "wx", 0o600)
      } catch (error) {
        if (errorCodeSchema.safeParse(error).data?.code === "EEXIST") continue
        throw new Error(
          `Cannot export Markdown to ${path}: ${errorTextSchema.parse(error)}`,
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
          `Cannot export Markdown to ${path}: ${errorTextSchema.parse(error)}`,
          { cause: error },
        )
      }
    }
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
    const validated = freezeWorkspace(workspaceSchema.parse(workspace))
    this.persist(validated)
    this.snapshot = validated
    const listenersAtCommit = [...this.listeners]

    for (const listener of listenersAtCommit) {
      try {
        listener()
      } catch (error) {
        // A subscriber failure must not report a completed disk commit as a failed save.
        console.error(
          "NotesStore subscriber failed after a successful save:",
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
      const lock = readLock(this.lockPath)

      if (lock?.token !== this.owner.token || lock.pid !== this.owner.pid)
        throw new Error("Workspace lock changed; close and reopen the store")
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
      throw new Error(
        `Cannot save ${this.path}: ${errorTextSchema.parse(error)}. Your in-memory notes are unchanged. Inspect ${this.path} and backup ${this.backupPath} before recovery.`,
        { cause: error },
      )
    }
  }

  private releaseLock() {
    const bytes = readText(this.lockPath, 4096)

    if (bytes === JSON.stringify(this.owner)) {
      unlinkSync(this.lockPath)
      syncDirectory(this.directory)
    }
  }
}
