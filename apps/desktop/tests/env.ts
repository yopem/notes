import { Schema } from "effect"

const dataDirectorySchema = Schema.UndefinedOr(Schema.String)

export function readDataDirectory() {
  return Schema.decodeUnknownSync(dataDirectorySchema)(
    process.env.STILL_NOTES_DATA_DIR,
  )
}

export function writeDataDirectory(value: string | undefined) {
  if (value === undefined) {
    delete process.env.STILL_NOTES_DATA_DIR
  } else {
    process.env.STILL_NOTES_DATA_DIR = value
  }
}
