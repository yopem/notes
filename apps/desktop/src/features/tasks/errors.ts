import { Schema } from "effect"

export class TaskError extends Schema.TaggedError<TaskError>()("TaskError", {
  message: Schema.String,
}) {}

export class ReminderError extends Schema.TaggedError<ReminderError>()(
  "ReminderError",
  {
    operation: Schema.Literals(["claim", "pending"]),
    cause: Schema.Defect(),
  },
) {}

export class PeriodicError extends Schema.TaggedError<PeriodicError>()(
  "PeriodicError",
  {
    operation: Schema.Literals(["location", "classify", "rollover"]),
    cause: Schema.Defect(),
  },
) {}
