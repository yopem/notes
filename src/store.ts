import { randomUUID } from "node:crypto";
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
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";

export type Notebook = { id: string; name: string };
export type Note = {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  pinned: boolean;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type Workspace = {
  version: 1;
  notebooks: Notebook[];
  notes: Note[];
  theme: "light" | "dark";
  selectedNoteId: string | null;
};

type NotePatch = { title?: string; body?: string; notebookId?: string };
type ProcessLock = { pid: number; token: string };
const bodyLimit = 2 * 1024 * 1024;
const fileLimit = 32 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("Invalid workspace fields");
  }
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} must not be empty`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error("Invalid workspace timestamp");
  }
  return value;
}

function noteBody(value: unknown) {
  const body = text(value, "Note body");
  if (Buffer.byteLength(body, "utf8") > bodyLimit)
    throw new Error("Note body exceeds the 2 MB limit");
  return body;
}

function parseNotebook(value: unknown): Notebook {
  if (!isRecord(value)) throw new Error("Invalid notebook");
  exactKeys(value, ["id", "name"]);
  return { id: nonempty(value.id, "Notebook ID"), name: nonempty(value.name, "Notebook name") };
}

function parseNote(value: unknown): Note {
  if (!isRecord(value)) throw new Error("Invalid note");
  exactKeys(value, [
    "id",
    "notebookId",
    "title",
    "body",
    "pinned",
    "trashedAt",
    "createdAt",
    "updatedAt",
  ]);
  if (typeof value.pinned !== "boolean") throw new Error("Invalid note pin flag");
  return {
    id: nonempty(value.id, "Note ID"),
    notebookId: nonempty(value.notebookId, "Notebook ID"),
    title: text(value.title, "Note title"),
    body: noteBody(value.body),
    pinned: value.pinned,
    trashedAt: value.trashedAt === null ? null : timestamp(value.trashedAt),
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
  };
}

function validateWorkspace(value: unknown): Workspace {
  if (!isRecord(value)) throw new Error("Workspace must be an object");
  exactKeys(value, ["version", "notebooks", "notes", "theme", "selectedNoteId"]);
  if (value.version !== 1)
    throw new Error("Unsupported workspace schema version; use a compatible app version");
  if (
    !Array.isArray(value.notebooks) ||
    value.notebooks.length === 0 ||
    !Array.isArray(value.notes)
  ) {
    throw new Error("Workspace needs notebooks and notes arrays, with at least one notebook");
  }
  if (value.theme !== "light" && value.theme !== "dark") throw new Error("Invalid workspace theme");
  const notebooks = value.notebooks.map(parseNotebook);
  const notes = value.notes.map(parseNote);
  const ids = new Set<string>();
  for (const entry of [...notebooks, ...notes]) {
    if (ids.has(entry.id)) throw new Error(`Duplicate workspace ID: ${entry.id}`);
    ids.add(entry.id);
  }
  const notebookIds = new Set(notebooks.map((notebook) => notebook.id));
  for (const note of notes) {
    if (!notebookIds.has(note.notebookId))
      throw new Error(`Invalid notebook reference for note ${note.id}`);
  }
  const selectedNoteId = value.selectedNoteId;
  if (
    selectedNoteId !== null &&
    (typeof selectedNoteId !== "string" || !notes.some((note) => note.id === selectedNoteId))
  ) {
    throw new Error("Invalid selected note reference");
  }
  return { version: 1, notebooks, notes, theme: value.theme, selectedNoteId };
}

function freezeWorkspace(workspace: Workspace) {
  for (const notebook of workspace.notebooks) Object.freeze(notebook);
  for (const note of workspace.notes) Object.freeze(note);
  Object.freeze(workspace.notebooks);
  Object.freeze(workspace.notes);
  Object.freeze(workspace);
  return workspace;
}

function readBytes(path: string, limit: number): Buffer | null {
  let fd: number;
  try {
    if (!lstatSync(path).isFile()) throw new Error(`${path} must be a regular file, not a symlink`);
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw new Error(`Cannot read ${path}: ${errorText(error)}`, { cause: error });
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${path} must be a regular file`);
    const label =
      limit === fileLimit
        ? "32 MB file"
        : limit === bodyLimit
          ? "2 MB import"
          : `${limit}-byte lock`;
    if (stat.size > limit) throw new Error(`${path} exceeds the ${label} limit`);
    const bytes = readFileSync(fd);
    if (bytes.length > limit) throw new Error(`${path} exceeds the file size limit`);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function readText(path: string, limit: number) {
  const bytes = readBytes(path, limit);
  if (bytes === null) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${path} must use UTF-8 encoding`, { cause: error });
  }
}

function syncDirectory(directory: string) {
  // Windows does not support opening a directory for fsync through node:fs.
  if (process.platform === "win32") return;
  const fd = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function atomicWrite(path: string, bytes: string, directory: string) {
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, bytes, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    syncDirectory(directory);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function decodeWorkspace(bytes: string, path: string, backup: string) {
  try {
    const value: unknown = JSON.parse(bytes);
    return validateWorkspace(value);
  } catch (error) {
    throw new Error(
      `Cannot load ${path}: ${errorText(error)}. Keep this file. Inspect backup ${backup}; copy a valid backup to workspace.json only after you preserve the damaged file.`,
      { cause: error },
    );
  }
}

function readLock(path: string): ProcessLock | null {
  try {
    const bytes = readText(path, 4096);
    if (bytes === null) return null;
    const value: unknown = JSON.parse(bytes);
    if (
      !isRecord(value) ||
      !Number.isSafeInteger(value.pid) ||
      typeof value.pid !== "number" ||
      value.pid <= 0 ||
      typeof value.token !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.token)
    ) {
      throw new Error("Invalid lock owner");
    }
    return { pid: value.pid, token: value.token };
  } catch (error) {
    throw new Error(
      `Invalid lock ${path}. Inspect it and remove it only when no Still Notes process uses this directory.`,
      { cause: error },
    );
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) return false;
    if (hasCode(error, "EPERM")) return true;
    throw error;
  }
}

function createLock(path: string, directory: string, owner: ProcessLock) {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false;
    throw error;
  }
  try {
    try {
      writeFileSync(fd, JSON.stringify(owner), "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    syncDirectory(directory);
  } catch (error) {
    unlinkSync(path);
    throw error;
  }
  return true;
}

function acquireLock(path: string, directory: string, owner: ProcessLock) {
  if (createLock(path, directory, owner)) return;
  const existing = readLock(path);
  if (!existing || processIsAlive(existing.pid)) {
    throw new Error(
      `Workspace lock ${path} is held by another process${existing ? ` (PID ${existing.pid})` : ""}. Close that instance and retry.`,
    );
  }
  const recoveryPath = `${path}.recovery`;
  let recovery: number;
  try {
    recovery = openSync(recoveryPath, "wx", 0o600);
  } catch (error) {
    throw new Error(
      `Cannot recover stale lock. Inspect ${recoveryPath}; remove it only when no recovery is running, then retry.`,
      { cause: error },
    );
  }
  try {
    // One recovery owner must check and remove the stale lock without another remover racing it.
    const current = readLock(path);
    if (
      current &&
      current.token === existing.token &&
      current.pid === existing.pid &&
      !processIsAlive(current.pid)
    ) {
      unlinkSync(path);
    }
    if (!createLock(path, directory, owner))
      throw new Error(
        `Workspace lock ${path} was acquired by another process. Retry after it closes.`,
      );
  } finally {
    closeSync(recovery);
    unlinkSync(recoveryPath);
  }
}

function makeNote(notebookId: string, title = "Untitled note", body = ""): Note {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    notebookId,
    title,
    body,
    pinned: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function freshWorkspace(): Workspace {
  const notebook = { id: randomUUID(), name: "Personal" };
  const welcome = makeNote(
    notebook.id,
    "Welcome to Still Notes",
    "# Welcome to Still Notes\n\nThis note is an example, not your personal data. You can edit or delete it.\n\nCreate a note, choose a notebook, and write in Markdown. Pin notes to keep them close. Use Trash to restore a note before you delete it permanently.\n\nYour notes stay in this local workspace. Export Markdown files to keep an extra copy.\n",
  );
  return {
    version: 1,
    notebooks: [notebook],
    notes: [welcome],
    theme: "light",
    selectedNoteId: welcome.id,
  };
}

function exportName(title: string) {
  let bytes = 0;
  let name = "";
  for (const character of title.normalize("NFC").trim()) {
    const code = character.charCodeAt(0);
    const safe = code < 32 || code === 127 || '<>:"/\\|?*'.includes(character) ? "_" : character;
    bytes += Buffer.byteLength(safe, "utf8");
    if (bytes > 160) break;
    name += safe;
  }
  name = name.replace(/^[. ]+|[. ]+$/g, "").trim();
  if (!name) name = "Untitled note";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

export function defaultDataDirectory(): string {
  if (process.env.STILL_NOTES_DATA_DIR) return resolve(process.env.STILL_NOTES_DATA_DIR);
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "Still Notes");
  if (process.platform === "win32")
    return join(
      process.env.LOCALAPPDATA || process.env.APPDATA || join(homedir(), "AppData", "Local"),
      "Still Notes",
    );
  const xdg = process.env.XDG_DATA_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share"), "still-notes");
}

export class NotesStore {
  private readonly directory: string;
  private readonly path: string;
  private readonly backupPath: string;
  private readonly lockPath: string;
  private readonly owner: ProcessLock;
  private snapshot: Workspace;
  private diskBytes: string | null = null;
  private closed = false;
  private readonly listeners = new Set<() => void>();

  constructor(directory: string) {
    this.directory = resolve(nonempty(directory, "Data directory"));
    this.path = join(this.directory, "workspace.json");
    this.backupPath = `${this.path}.bak`;
    this.lockPath = join(this.directory, ".store.lock");
    this.owner = { pid: process.pid, token: randomUUID() };
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(this.directory).isDirectory())
      throw new Error("Data directory must be a real directory, not a symlink");
    chmodSync(this.directory, 0o700);
    try {
      acquireLock(this.lockPath, this.directory, this.owner);
      const bytes = readText(this.path, fileLimit);
      const previous = readText(this.backupPath, fileLimit);
      if (previous !== null) decodeWorkspace(previous, this.backupPath, this.backupPath);
      if (bytes === null && previous !== null) {
        throw new Error(
          `Missing ${this.path}. Recovery is required: preserve backup ${this.backupPath}, then copy it to ${this.path}.`,
        );
      }
      this.snapshot = freezeWorkspace(
        bytes === null ? freshWorkspace() : decodeWorkspace(bytes, this.path, this.backupPath),
      );
      this.diskBytes = bytes;
      if (bytes === null) this.persist(this.snapshot);
      else chmodSync(this.path, 0o600);
      if (previous !== null) chmodSync(this.backupPath, 0o600);
    } catch (error) {
      try {
        this.releaseLock();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `${errorText(error)}. Lock cleanup failed: ${errorText(cleanupError)}`,
        );
      }
      throw error;
    }
    this.getSnapshot = this.getSnapshot.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  getSnapshot(): Workspace {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.ensureOpen();
    if (typeof listener !== "function") throw new Error("Subscriber must be a function");
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  createNotebook(name: string): Notebook {
    this.ensureOpen();
    const notebook = { id: randomUUID(), name: nonempty(name, "Notebook name").trim() };
    this.commit({ ...this.snapshot, notebooks: [...this.snapshot.notebooks, notebook] });
    return Object.freeze(notebook);
  }

  renameNotebook(id: string, name: string): void {
    this.ensureOpen();
    const notebook = this.notebook(id);
    const nextName = nonempty(name, "Notebook name").trim();
    if (notebook.name === nextName) return;
    this.commit({
      ...this.snapshot,
      notebooks: this.snapshot.notebooks.map((entry) =>
        entry.id === id ? { ...entry, name: nextName } : entry,
      ),
    });
  }

  createNote(notebookId?: string): Note {
    this.ensureOpen();
    const note = makeNote(this.notebook(notebookId ?? this.snapshot.notebooks[0]?.id).id);
    this.commit({
      ...this.snapshot,
      notes: [...this.snapshot.notes, note],
      selectedNoteId: note.id,
    });
    return Object.freeze(note);
  }

  updateNote(id: string, patch: NotePatch): void {
    this.ensureOpen();
    const note = this.note(id);
    if (
      !isRecord(patch) ||
      Object.keys(patch).some((key) => !["title", "body", "notebookId"].includes(key))
    ) {
      throw new Error("Note patch accepts title, body, and notebookId only");
    }
    const title = patch.title === undefined ? note.title : text(patch.title, "Note title");
    const body = patch.body === undefined ? note.body : noteBody(patch.body);
    const notebookId =
      patch.notebookId === undefined ? note.notebookId : this.notebook(patch.notebookId).id;
    if (title === note.title && body === note.body && notebookId === note.notebookId) return;
    this.replaceNote({ ...note, title, body, notebookId, updatedAt: new Date().toISOString() });
  }

  togglePin(id: string): void {
    this.ensureOpen();
    const note = this.note(id);
    this.replaceNote({ ...note, pinned: !note.pinned, updatedAt: new Date().toISOString() });
  }

  trashNote(id: string): void {
    this.ensureOpen();
    const note = this.note(id);
    if (note.trashedAt !== null) return;
    const now = new Date().toISOString();
    this.replaceNote(
      { ...note, trashedAt: now, updatedAt: now },
      this.snapshot.selectedNoteId === id ? null : this.snapshot.selectedNoteId,
    );
  }

  restoreNote(id: string): void {
    this.ensureOpen();
    const note = this.note(id);
    if (note.trashedAt === null) return;
    this.replaceNote({ ...note, trashedAt: null, updatedAt: new Date().toISOString() });
  }

  deleteNote(id: string): void {
    this.ensureOpen();
    if (this.note(id).trashedAt === null)
      throw new Error("Move the note to Trash before you delete it permanently");
    this.commit({
      ...this.snapshot,
      notes: this.snapshot.notes.filter((note) => note.id !== id),
      selectedNoteId: this.snapshot.selectedNoteId === id ? null : this.snapshot.selectedNoteId,
    });
  }

  selectNote(id: string | null): void {
    this.ensureOpen();
    if (id !== null) this.note(id);
    if (this.snapshot.selectedNoteId === id) return;
    this.commit({ ...this.snapshot, selectedNoteId: id });
  }

  setTheme(theme: "light" | "dark"): void {
    this.ensureOpen();
    if (theme !== "light" && theme !== "dark") throw new Error("Theme must be light or dark");
    if (this.snapshot.theme === theme) return;
    this.commit({ ...this.snapshot, theme });
  }

  importMarkdown(paths: string[], notebookId?: string): Note[] {
    this.ensureOpen();
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string" || path === ""))
      throw new Error("Import paths must be file paths");
    const notebook = this.notebook(notebookId ?? this.snapshot.notebooks[0]?.id);
    const notes = paths.map((path) => {
      const extension = extname(path).toLowerCase();
      if (extension !== ".md" && extension !== ".markdown")
        throw new Error(`${path} is not a .md or .markdown file`);
      const body = readText(path, bodyLimit);
      if (body === null) throw new Error(`Markdown file does not exist: ${path}`);
      for (let index = 0; index < body.length; index += 1) {
        const code = body.charCodeAt(index);
        if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
          throw new Error(`${path} contains binary data or an unsafe encoding; use UTF-8 Markdown`);
      }
      return makeNote(notebook.id, basename(path, extname(path)), noteBody(body));
    });
    if (notes.length === 0) return [];
    this.commit({
      ...this.snapshot,
      notes: [...this.snapshot.notes, ...notes],
      selectedNoteId: notes[0]?.id ?? this.snapshot.selectedNoteId,
    });
    return notes.map((note) => Object.freeze(note));
  }

  exportMarkdown(id: string, directory: string): string {
    this.ensureOpen();
    const note = this.note(id);
    const output = resolve(nonempty(directory, "Export directory"));
    mkdirSync(output, { recursive: true, mode: 0o700 });
    const name = exportName(note.title);
    for (let index = 1; ; index += 1) {
      const path = join(output, `${name}${index === 1 ? "" : ` (${index})`}.md`);
      let fd: number;
      try {
        fd = openSync(path, "wx", 0o600);
      } catch (error) {
        if (hasCode(error, "EEXIST")) continue;
        throw new Error(`Cannot export Markdown to ${path}: ${errorText(error)}`, { cause: error });
      }
      try {
        try {
          writeFileSync(fd, note.body, "utf8");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        syncDirectory(output);
        return path;
      } catch (error) {
        rmSync(path, { force: true });
        throw new Error(`Cannot export Markdown to ${path}: ${errorText(error)}`, { cause: error });
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.releaseLock();
    this.listeners.clear();
    this.closed = true;
  }

  private ensureOpen() {
    if (this.closed)
      throw new Error("NotesStore is closed; open the workspace again before you make changes");
  }

  private notebook(id: string | undefined) {
    const notebook = this.snapshot.notebooks.find((entry) => entry.id === id);
    if (!notebook) throw new Error(`Notebook does not exist: ${String(id)}`);
    return notebook;
  }

  private note(id: string) {
    const note = this.snapshot.notes.find((entry) => entry.id === id);
    if (!note) throw new Error(`Note does not exist: ${String(id)}`);
    return note;
  }

  private replaceNote(note: Note, selectedNoteId = this.snapshot.selectedNoteId) {
    this.commit({
      ...this.snapshot,
      notes: this.snapshot.notes.map((entry) => (entry.id === note.id ? note : entry)),
      selectedNoteId,
    });
  }

  private commit(workspace: Workspace) {
    const validated = freezeWorkspace(validateWorkspace(workspace));
    this.persist(validated);
    this.snapshot = validated;
    const listenersAtCommit = [...this.listeners];
    for (const listener of listenersAtCommit) {
      try {
        listener();
      } catch (error) {
        // A subscriber failure must not report a completed disk commit as a failed save.
        console.error("NotesStore subscriber failed after a successful save:", error);
      }
    }
  }

  private persist(workspace: Workspace) {
    const bytes = JSON.stringify(workspace, null, 2) + "\n";
    if (Buffer.byteLength(bytes, "utf8") > fileLimit)
      throw new Error(
        "Workspace exceeds the 32 MB file limit; export or remove notes before saving",
      );
    try {
      const lock = readLock(this.lockPath);
      if (lock?.token !== this.owner.token || lock.pid !== this.owner.pid)
        throw new Error("Workspace lock changed; close and reopen the store");
      const current = readText(this.path, fileLimit);
      if (current !== this.diskBytes)
        throw new Error(
          `Workspace changed outside this instance. Preserve ${this.path} and reopen it; do not overwrite external edits.`,
        );
      const previous = readText(this.backupPath, fileLimit);
      if (previous !== null) decodeWorkspace(previous, this.backupPath, this.backupPath);
      if (this.diskBytes !== null) atomicWrite(this.backupPath, this.diskBytes, this.directory);
      atomicWrite(this.path, bytes, this.directory);
      this.diskBytes = bytes;
    } catch (error) {
      throw new Error(
        `Cannot save ${this.path}: ${errorText(error)}. Your in-memory notes are unchanged. Inspect ${this.path} and backup ${this.backupPath} before recovery.`,
        { cause: error },
      );
    }
  }

  private releaseLock() {
    const bytes = readText(this.lockPath, 4096);
    if (bytes === JSON.stringify(this.owner)) {
      unlinkSync(this.lockPath);
      syncDirectory(this.directory);
    }
  }
}
