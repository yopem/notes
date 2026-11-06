import { Effect, Predicate, Schema } from "effect"
import { isPromise } from "node:util/types"

import { EditorStateSchema } from "@/features/editor/native/editor"

const Id = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0),
)

const Context = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      value.length > 0 &&
      value.isWellFormed() &&
      !/^(\p{White_Space})|(\p{White_Space})$/u.test(value) &&
      !/\p{Cc}/u.test(value) &&
      new TextEncoder().encode(value).length <= 1024,
  ),
)

const Protocol = Schema.Literal(1)

const CaptureCommand = Schema.Struct({
  protocol: Protocol,
  op: Schema.Literal("capture"),
  owner: Id,
  titleId: Id,
  bodyId: Id,
  context: Context,
}).check(Schema.makeFilter((value) => value.titleId !== value.bodyId))

const InspectCommand = Schema.Struct({
  protocol: Protocol,
  op: Schema.Literal("inspect"),
  owner: Id,
})

const FinishCommand = Schema.Struct({
  protocol: Protocol,
  op: Schema.Literal("finish"),
  owner: Id,
  generation: Id,
  disposition: Schema.Literals(["cancel", "seal"]),
})

const AdoptCommand = Schema.Struct({
  protocol: Protocol,
  op: Schema.Literal("adopt"),
  owner: Id,
  expectedOwner: Id,
  generation: Id,
}).check(Schema.makeFilter((value) => value.owner > value.expectedOwner))

export const InputPairCommandSchema = Schema.Union([
  CaptureCommand,
  InspectCommand,
  FinishCommand,
  AdoptCommand,
])

export type InputPairCommand = typeof InputPairCommandSchema.Type

const Capture = Schema.Struct({
  owner: Id,
  generation: Id,
  phase: Schema.Literals(["held", "sealed", "uncertain"]),
  context: Context,
  titleId: Id,
  bodyId: Id,
  title: EditorStateSchema,
  body: EditorStateSchema,
}).check(
  Schema.makeFilter(
    (value) =>
      value.titleId !== value.bodyId &&
      (value.phase === "uncertain" ||
        (value.title.composition === null && value.body.composition === null)),
  ),
)

export const InputPairResponseSchema = Schema.Struct({
  protocol: Protocol,
  currentOwner: Id,
  capture: Schema.NullOr(Capture),
}).check(
  Schema.makeFilter(
    (value) =>
      value.capture === null || value.capture.owner <= value.currentOwner,
  ),
)

export type InputPairResponse = typeof InputPairResponseSchema.Type

export class InputPairUnsupported extends Schema.TaggedError<InputPairUnsupported>()(
  "InputPairUnsupported",
  { message: Schema.String },
) {}

export class InputPairInvalidRequest extends Schema.TaggedError<InputPairInvalidRequest>()(
  "InputPairInvalidRequest",
  { message: Schema.String },
) {}

export class InputPairNativeFailure extends Schema.TaggedError<InputPairNativeFailure>()(
  "InputPairNativeFailure",
  { message: Schema.String },
) {}

export class InputPairInvalidResponse extends Schema.TaggedError<InputPairInvalidResponse>()(
  "InputPairInvalidResponse",
  { message: Schema.String },
) {}

export interface InputPairHost {
  inputPairCommandV1?: (command: string) => Promise<string>
}

function hasDuplicateKeys(json: string) {
  const containers: (Set<string> | null)[] = []
  const tokens = /"(?:\\.|[^"\\])*"|[{}[\]]/gu

  for (const token of json.matchAll(tokens)) {
    const text = token[0]

    if (text === "{") containers.push(new Set())
    else if (text === "[") containers.push(null)
    else if (text === "}" || text === "]") containers.pop()
    else if (/^\s*:/u.test(json.slice(token.index + text.length))) {
      const keys = containers.at(-1)
      const key: unknown = JSON.parse(text)

      if (keys && Predicate.isString(key)) {
        if (keys.has(key)) return true
        keys.add(key)
      }
    }
  }

  return false
}

function matchesCommand(
  command: InputPairCommand,
  response: InputPairResponse,
) {
  if (response.currentOwner !== command.owner) return false
  const capture = response.capture

  if (command.op === "inspect") return true

  if (command.op === "finish" && command.disposition === "cancel")
    return capture === null

  if (capture === null || capture.owner !== command.owner) return false

  if (command.op === "capture") {
    return (
      capture.phase === "held" &&
      capture.context === command.context &&
      capture.titleId === command.titleId &&
      capture.bodyId === command.bodyId
    )
  }

  if (capture.generation <= command.generation) return false

  if (command.op === "finish") return capture.phase === "sealed"

  return capture.phase === "held" || capture.phase === "sealed"
}

export function inputPairCommand(
  host: InputPairHost,
  command: InputPairCommand,
) {
  return Effect.gen(function* () {
    const encoded = yield* Effect.try({
      try: () => {
        const request = Schema.decodeUnknownSync(InputPairCommandSchema, {
          onExcessProperty: "error",
        })(command)

        const json = JSON.stringify(request)

        if (new TextEncoder().encode(json).length > 4096) throw new Error()

        return { request, json }
      },
      catch: () =>
        new InputPairInvalidRequest({ message: "Invalid input pair request" }),
    })

    const method = yield* Effect.try({
      try: () => host.inputPairCommandV1,
      catch: () =>
        new InputPairNativeFailure({
          message: "Input pair capability lookup failed",
        }),
    })

    if (!Predicate.isFunction(method)) {
      return yield* new InputPairUnsupported({
        message: "Input pair capability is unavailable",
      })
    }

    const raw = yield* Effect.tryPromise({
      try: () => {
        const result = method.call(host, encoded.json)

        if (!isPromise(result)) throw new Error()

        return result
      },
      catch: () =>
        new InputPairNativeFailure({
          message: "Input pair native operation failed; completion is unknown",
        }),
    })

    return yield* Effect.try({
      try: () => {
        if (!Predicate.isString(raw)) throw new Error()

        const parsed: unknown = JSON.parse(raw)

        if (hasDuplicateKeys(raw)) throw new Error()

        const response = Schema.decodeUnknownSync(InputPairResponseSchema, {
          onExcessProperty: "error",
        })(parsed)

        if (!matchesCommand(encoded.request, response)) throw new Error()

        return response
      },
      catch: () =>
        new InputPairInvalidResponse({
          message: "Invalid input pair response; completion is unknown",
        }),
    })
  })
}
