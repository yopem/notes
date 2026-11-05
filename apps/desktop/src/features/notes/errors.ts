import { Schema } from "effect"

const operationSchema = Schema.Literals([
  "open",
  "close",
  "createNotebook",
  "renameNotebook",
  "createNote",
  "updateNote",
  "togglePin",
  "trashNote",
  "restoreNote",
  "deleteNote",
  "selectNote",
  "setTheme",
  "importMarkdown",
  "exportMarkdown",
])

export class NotesError extends Schema.TaggedError<NotesError>()("NotesError", {
  operation: operationSchema,
  message: Schema.String,
  cause: Schema.Defect(),
}) {
  static fromCause(operation: typeof operationSchema.Type, cause: unknown) {
    return new NotesError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    })
  }
}
