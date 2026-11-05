import { Schema } from "effect"

export class AssistantReviewError extends Schema.TaggedError<AssistantReviewError>()(
  "AssistantReviewError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  static fromCause(operation: string, cause: unknown) {
    return new AssistantReviewError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    })
  }
}
