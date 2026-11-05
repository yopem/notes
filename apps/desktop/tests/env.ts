import { z } from "zod"

const dataDirectorySchema = z.string().optional()

export function readDataDirectory() {
  return dataDirectorySchema.parse(process.env.STILL_NOTES_DATA_DIR)
}

export function writeDataDirectory(value: string | undefined) {
  if (value === undefined) {
    delete process.env.STILL_NOTES_DATA_DIR
  } else {
    process.env.STILL_NOTES_DATA_DIR = value
  }
}
