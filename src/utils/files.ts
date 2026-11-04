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

export function atomicWrite(
  path: string,
  bytes: string | Uint8Array,
  directory: string,
) {
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  const fd = openSync(temporary, "wx", 0o600)

  try {
    try {
      writeFileSync(fd, bytes, "utf8")
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }

    renameSync(temporary, path)
    syncDirectory(directory)
  } finally {
    rmSync(temporary, { force: true })
  }
}
