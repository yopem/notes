import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"

export function syncDirectory(directory: string) {
  // Windows cannot open a directory for fsync through node:fs.
  if (process.platform === "win32") return
  const fd = openSync(directory, constants.O_RDONLY)

  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export class AtomicWriteError extends Error {
  readonly path: string
  readonly replacementCompleted: boolean

  constructor({
    path,
    replacementCompleted,
    cause,
  }: {
    path: string
    replacementCompleted: boolean
    cause: unknown
  }) {
    super(
      replacementCompleted
        ? `File replacement completed for ${path}, but directory synchronization failed. Durability is not confirmed.`
        : `File write failed before replacement of ${path}.`,
      { cause },
    )
    this.name = "AtomicWriteError"
    this.path = path
    this.replacementCompleted = replacementCompleted
  }
}

export function atomicWrite(
  path: string,
  bytes: string | Uint8Array,
  directory: string,
) {
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  let replacementCompleted = false
  let temporaryCreated = false

  try {
    const fd = openSync(temporary, "wx", 0o600)
    temporaryCreated = true

    try {
      writeFileSync(fd, bytes, "utf8")
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }

    renameSync(temporary, path)
    replacementCompleted = true
    syncDirectory(directory)
  } catch (cause) {
    let failure = cause

    if (temporaryCreated && !replacementCompleted) {
      try {
        rmSync(temporary, { force: true })
      } catch (cleanupError) {
        failure = new AggregateError(
          [cause, cleanupError],
          "File write and temporary-file cleanup failed",
        )
      }
    }

    throw new AtomicWriteError({
      path,
      replacementCompleted,
      cause: failure,
    })
  }
}
