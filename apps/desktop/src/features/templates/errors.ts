import { Effect, Schema } from "effect"

export class TemplateError extends Schema.TaggedError<TemplateError>()(
  "TemplateError",
  {
    operation: Schema.Literals(["render", "read", "write", "lock"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export function templateIO<A>(
  operation: TemplateError["operation"],
  evaluate: () => A,
) {
  return Effect.try({
    try: evaluate,
    catch: (cause) =>
      cause instanceof TemplateError
        ? cause
        : new TemplateError({
            operation,
            message:
              cause instanceof Error
                ? cause.message
                : "Template operation failed",
            cause,
          }),
  })
}
