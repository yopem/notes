import type { EventPayload } from "@gpuix/native"

import {
  createRendererState,
  type NativeRenderer,
  registerEventHandler,
  unregisterEventHandler,
} from "@gpuix/native/host"
import { Predicate, Result, Schema } from "effect"

const OffsetSchema = Schema.Natural

const PixelSchema = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

const EditorModeSchema = Schema.Literals(["insert", "normal", "readOnly"])

const SelectionSchema = Schema.Struct({
  start: OffsetSchema,
  end: OffsetSchema,
  direction: Schema.Literals(["forward", "backward"]),
}).check(Schema.makeFilter((selection) => selection.start <= selection.end))

const RevisionSchema = Schema.Struct({ revision: OffsetSchema })

const SetSelectionSchema = Schema.Struct({
  ...RevisionSchema.fields,
  ...SelectionSchema.fields,
})

const ViewportSchema = Schema.Struct({ top: PixelSchema, left: PixelSchema })

const ReplaceRangeSchema = Schema.Struct({
  ...RevisionSchema.fields,
  start: OffsetSchema,
  end: OffsetSchema,
  text: Schema.String,
  selection: Schema.optionalKey(SelectionSchema),
}).check(Schema.makeFilter((range) => range.start <= range.end))

const TextSnapshotSchema = Schema.Struct({
  text: Schema.String,
  ...SelectionSchema.fields,
})

const EditorSnapshotSchema = Schema.Struct({
  version: Schema.Literal(1),
  current: TextSnapshotSchema,
  undo: Schema.Array(TextSnapshotSchema).check(Schema.isMaxLength(200)),
  redo: Schema.Array(TextSnapshotSchema).check(Schema.isMaxLength(200)),
  scrollTop: PixelSchema,
  scrollLeft: PixelSchema,
})

export const EditorStateSchema = Schema.Struct({
  text: Schema.String,
  revision: OffsetSchema,
  selection: SelectionSchema,
  composition: Schema.NullOr(
    Schema.Struct({ start: OffsetSchema, end: OffsetSchema }),
  ),
  mode: EditorModeSchema,
  readOnly: Schema.Boolean,
  canUndo: Schema.Boolean,
  canRedo: Schema.Boolean,
  viewport: Schema.Struct({
    ...ViewportSchema.fields,
    width: PixelSchema,
    height: PixelSchema,
    contentHeight: PixelSchema,
    contentWidth: PixelSchema,
  }),
})

const EditorEventSchema = Schema.Struct({
  elementId: OffsetSchema,
  eventType: Schema.String,
  value: Schema.optionalKey(Schema.String),
})

const decodeOffset = Schema.decodeUnknownSync(OffsetSchema)

const decodeText = Schema.decodeUnknownSync(Schema.String)

const decodeSelection = Schema.decodeUnknownSync(SetSelectionSchema, {
  onExcessProperty: "error",
})

const decodeRange = Schema.decodeUnknownSync(ReplaceRangeSchema, {
  onExcessProperty: "error",
})

const decodeSnapshot = Schema.decodeUnknownSync(EditorSnapshotSchema, {
  onExcessProperty: "error",
})

const decodeState = Schema.decodeUnknownSync(EditorStateSchema, {
  onExcessProperty: "error",
})

const decodeViewport = Schema.decodeUnknownSync(ViewportSchema, {
  onExcessProperty: "error",
})

const decodeMode = Schema.decodeUnknownSync(EditorModeSchema)

export interface NativeEditorProps {
  editorMode?: NativeEditorMode
  editorLanguage?: string
  editorPath?: string
}

export type NativeEditorMode = typeof EditorModeSchema.Type

export type NativeEditorSelection = typeof SelectionSchema.Type

export type NativeEditorState = typeof EditorStateSchema.Type

export type NativeEditorSnapshot = typeof EditorSnapshotSchema.Type

export type NativeEditorReplaceRange = typeof ReplaceRangeSchema.Type

type EditorRenderer = NativeRenderer & {
  editorCommand?: (elementId: number, commandJson: string) => string
}

type CloseGuardRenderer = NativeRenderer & {
  armCloseGuard?: (eventId: number) => void
  closeWindow?: () => void
}

type CloseOwnerRenderer = NativeRenderer & {
  bindCloseOwnerV2?: (commandJson: string) => string
  cancelCloseOwnerV2?: (commandJson: string) => string
  releaseCloseOwnerV2?: (commandJson: string) => string
  approveCloseOwnerV2?: (commandJson: string) => Promise<string>
}

const SafeNaturalSchema = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
)

const PositiveSafeIntegerSchema = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0),
)

const CloseRequestSchema = Schema.Struct({
  protocol: Schema.Literal(2),
  owner: PositiveSafeIntegerSchema,
  requestId: PositiveSafeIntegerSchema,
})

const CloseBindingSchema = Schema.Struct({
  protocol: Schema.Literal(2),
  owner: PositiveSafeIntegerSchema,
  eventId: SafeNaturalSchema,
  pendingRequest: Schema.NullOr(PositiveSafeIntegerSchema),
  attached: Schema.Literal(true),
  phase: Schema.Literal("armed"),
})

const CloseCancelSchema = Schema.Struct({
  ...CloseRequestSchema.fields,
  outcome: Schema.Literals(["cancelled", "stale"]),
})

const CloseApprovalSchema = Schema.Struct({
  ...CloseRequestSchema.fields,
  outcome: Schema.Literals(["closing", "stale"]),
})

const CloseReleaseSchema = Schema.Struct({
  protocol: Schema.Literal(2),
  owner: PositiveSafeIntegerSchema,
  outcome: Schema.Literals(["released", "stale"]),
})

const decodeCloseId = Schema.decodeUnknownSync(PositiveSafeIntegerSchema)

declare global {
  var stillNotesCloseOwnersV2: WeakMap<NativeRenderer, object> | undefined
}

const closeOwners = (globalThis.stillNotesCloseOwnersV2 ??= new WeakMap())

function decodeCloseResponse<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  response: string | undefined,
) {
  return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(
    JSON.parse(decodeText(response)),
  )
}

export function createNativeCloseOwner(
  renderer: CloseOwnerRenderer | { native: CloseOwnerRenderer },
  options: {
    expectedOwner: number | null
    onRequest: (requestId: number) => void
  },
) {
  const native = "native" in renderer ? renderer.native : renderer

  if (
    !Predicate.isFunction(native.bindCloseOwnerV2) ||
    !Predicate.isFunction(native.cancelCloseOwnerV2) ||
    !Predicate.isFunction(native.releaseCloseOwnerV2) ||
    !Predicate.isFunction(native.approveCloseOwnerV2)
  )
    throw new Error("Custom GPUix addon with close owner v2 is required")

  const expectedOwner =
    options.expectedOwner === null ? null : decodeCloseId(options.expectedOwner)

  const state = createRendererState(native)
  const binding = state.current()

  if (!binding) throw new Error("Mount the GPUix root before guarding close")
  const handlers = binding.eventHandlers

  const eventId = Schema.decodeUnknownSync(SafeNaturalSchema)(
    binding.windowKeyEventId,
  )

  const eventType = "windowCloseRequested"
  const previous = handlers.get(eventId)?.get(eventType)
  const token = {}
  let deliveredThrough = 0
  let owner = 0
  let disposed = false

  function isCurrent() {
    return (
      !disposed &&
      closeOwners.get(native) === token &&
      state.current() === binding &&
      handlers.get(eventId)?.get(eventType) === receive
    )
  }

  function deliver(requestId: number) {
    if (!isCurrent() || requestId <= deliveredThrough) return
    deliveredThrough = requestId
    options.onRequest(requestId)
  }

  function receive(event: EventPayload) {
    if (
      !isCurrent() ||
      event.elementId !== eventId ||
      event.eventType !== eventType ||
      !Predicate.isString(event.value)
    )
      return
    let request: typeof CloseRequestSchema.Type

    try {
      request = decodeCloseResponse(CloseRequestSchema, event.value)
    } catch {
      return
    }

    if (request.owner === owner) deliver(request.requestId)
  }

  registerEventHandler(handlers, eventId, eventType, receive)
  let bound: typeof CloseBindingSchema.Type

  try {
    bound = decodeCloseResponse(
      CloseBindingSchema,
      native.bindCloseOwnerV2(
        JSON.stringify({ protocol: 2, eventId, expectedOwner }),
      ),
    )

    if (
      bound.eventId !== eventId ||
      (expectedOwner !== null && bound.owner <= expectedOwner)
    )
      throw new Error("Invalid close binding identity")
  } catch (error) {
    if (handlers.get(eventId)?.get(eventType) === receive) {
      if (previous) registerEventHandler(handlers, eventId, eventType, previous)
      else unregisterEventHandler(handlers, eventId, eventType)
    }

    throw error
  }

  owner = bound.owner
  closeOwners.set(native, token)

  if (bound.pendingRequest !== null) {
    const pending = bound.pendingRequest
    queueMicrotask(function replayPending() {
      deliver(pending)
    })
  }

  function cancel(requestId: number): typeof CloseCancelSchema.Type {
    const id = decodeCloseId(requestId)

    if (!isCurrent())
      return { protocol: 2, owner, requestId: id, outcome: "stale" }

    const response = decodeCloseResponse(
      CloseCancelSchema,
      native.cancelCloseOwnerV2?.(
        JSON.stringify({ protocol: 2, owner, requestId: id }),
      ),
    )

    if (response.owner !== owner || response.requestId !== id)
      throw new Error("Invalid close cancellation identity")

    if (response.outcome === "cancelled")
      deliveredThrough = Math.max(deliveredThrough, id)

    return response
  }

  async function approve(
    requestId: number,
  ): Promise<typeof CloseApprovalSchema.Type> {
    const id = decodeCloseId(requestId)

    if (!isCurrent())
      return { protocol: 2, owner, requestId: id, outcome: "stale" }

    const pending = native.approveCloseOwnerV2?.(
      JSON.stringify({ protocol: 2, owner, requestId: id }),
    )

    if (!(pending instanceof Promise))
      throw new Error("Close approval must return a Promise")

    if (id === bound.pendingRequest)
      deliveredThrough = Math.max(deliveredThrough, id)

    const response = decodeCloseResponse(CloseApprovalSchema, await pending)

    if (response.owner !== owner || response.requestId !== id)
      throw new Error("Invalid close approval identity")

    if (isCurrent() && response.outcome === "closing")
      deliveredThrough = Math.max(deliveredThrough, id)

    return response
  }

  function dispose(): typeof CloseReleaseSchema.Type {
    const canRelease = !disposed && closeOwners.get(native) === token
    disposed = true

    if (handlers.get(eventId)?.get(eventType) === receive)
      unregisterEventHandler(handlers, eventId, eventType)

    if (!canRelease) return { protocol: 2, owner, outcome: "stale" }

    const response = decodeCloseResponse(
      CloseReleaseSchema,
      native.releaseCloseOwnerV2?.(JSON.stringify({ protocol: 2, owner })),
    )

    if (response.owner !== owner)
      throw new Error("Invalid close release identity")

    return response
  }

  return { owner, cancel, approve, dispose }
}

type NativeEditorCommand =
  | { type: "getState" | "getSnapshot" }
  | { type: "setMode"; mode: NativeEditorMode }
  | ({ type: "setSelection"; revision: number } & NativeEditorSelection)
  | ({ type: "replaceRange" } & NativeEditorReplaceRange)
  | { type: "undo" | "redo"; revision: number }
  | { type: "setViewport"; top: number; left: number }
  | {
      type: "restoreSnapshot"
      revision: number
      snapshot: NativeEditorSnapshot
    }

export function createNativeCloseGuard(
  renderer: CloseGuardRenderer | { native: CloseGuardRenderer },
  onRequest: () => void,
) {
  const native = "native" in renderer ? renderer.native : renderer
  const arm = native.armCloseGuard
  const close = native.closeWindow

  if (!Predicate.isFunction(arm) || !Predicate.isFunction(close)) {
    throw new Error("Custom GPUix addon with close guard is required")
  }

  const binding = createRendererState(native).current()

  if (!binding) throw new Error("Mount the GPUix root before guarding close")
  const handlers = binding.eventHandlers
  const id = binding.windowKeyEventId
  const eventType = "windowCloseRequested"

  if (handlers.get(id)?.has(eventType)) {
    throw new Error("Window already has a close guard")
  }

  function receive() {
    onRequest()
  }

  registerEventHandler(handlers, id, eventType, receive)

  try {
    arm.call(native, id)
  } catch (error) {
    unregisterEventHandler(handlers, id, eventType)
    throw error
  }

  return {
    close() {
      close.call(native)
    },
  }
}

/** Connect only after the native input has rendered. Stock GPUix has no editorCommand. */
export function createNativeEditor(
  renderer: EditorRenderer | { native: EditorRenderer },
  elementId: number,
) {
  const id = decodeOffset(elementId)
  const native = "native" in renderer ? renderer.native : renderer
  const nativeCommand = native.editorCommand

  if (!Predicate.isFunction(nativeCommand)) {
    throw new Error("Custom GPUix addon with editorCommand is required")
  }

  const command = nativeCommand

  function execute<S extends Schema.ConstraintDecoder<unknown>>(
    value: NativeEditorCommand,
    schema: S,
  ) {
    const response: unknown = command.call(native, id, JSON.stringify(value))

    return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(
      JSON.parse(decodeText(response)),
    )
  }

  function subscribe(onState: (state: NativeEditorState) => void) {
    const host = "native" in renderer ? renderer.native : renderer
    const binding = createRendererState(host).current()

    if (!binding)
      throw new Error("Mount the GPUix root before subscribing to editor state")
    const handlers = binding.eventHandlers

    if (handlers.get(id)?.has("editorState")) {
      throw new Error("Editor already has a state subscriber")
    }

    function receive(event: EventPayload) {
      const next = readNativeEditorEvent(event, id)

      if (next) onState(next)
    }

    registerEventHandler(handlers, id, "editorState", receive)

    return function unsubscribe() {
      if (handlers.get(id)?.get("editorState") === receive) {
        unregisterEventHandler(handlers, id, "editorState")
      }
    }
  }

  function getState() {
    return execute({ type: "getState" }, EditorStateSchema)
  }

  function getSnapshot() {
    return execute({ type: "getSnapshot" }, EditorSnapshotSchema)
  }

  function restoreSnapshot(revision: number, snapshot: NativeEditorSnapshot) {
    return execute(
      {
        type: "restoreSnapshot",
        revision: decodeOffset(revision),
        snapshot: decodeSnapshot(snapshot),
      },
      EditorStateSchema,
    )
  }

  function setSelection(
    selection: NativeEditorSelection & { revision: number },
  ) {
    return execute(
      { type: "setSelection", ...decodeSelection(selection) },
      EditorStateSchema,
    )
  }

  function replaceRange(range: NativeEditorReplaceRange) {
    return execute(
      { type: "replaceRange", ...decodeRange(range) },
      EditorStateSchema,
    )
  }

  function undo(revision: number) {
    return execute(
      { type: "undo", revision: decodeOffset(revision) },
      EditorStateSchema,
    )
  }

  function redo(revision: number) {
    return execute(
      { type: "redo", revision: decodeOffset(revision) },
      EditorStateSchema,
    )
  }

  function setViewport(viewport: typeof ViewportSchema.Type) {
    return execute(
      { type: "setViewport", ...decodeViewport(viewport) },
      EditorStateSchema,
    )
  }

  function setMode(mode: NativeEditorMode) {
    return execute(
      { type: "setMode", mode: decodeMode(mode) },
      EditorStateSchema,
    )
  }

  return {
    subscribe,
    getState,
    getSnapshot,
    restoreSnapshot,
    setSelection,
    replaceRange,
    undo,
    redo,
    setViewport,
    setMode,
  }
}

/** Subscribe first. GPUix drops events that have no host handler. */
export function readNativeEditorEvent(event: EventPayload, elementId: number) {
  const parsed = Schema.decodeUnknownResult(EditorEventSchema)(event)

  if (
    Result.isFailure(parsed) ||
    parsed.success.eventType !== "editorState" ||
    parsed.success.elementId !== elementId
  ) {
    return null
  }

  return decodeState(JSON.parse(decodeText(parsed.success.value)))
}

const RoutedKeySchema = Schema.Struct({
  nativeEditorRoute: Schema.Literal(true),
  revision: OffsetSchema,
  mode: EditorModeSchema,
})

export interface NativeEditorRoutedKey {
  key: string
  keyChar?: string
  modifiers?: EventPayload["modifiers"]
  revision: number
  mode: NativeEditorMode
}

/** Routed keys did not edit native text. Process them in arrival order, including typeahead. */
export function readNativeEditorKeyEvent(
  event: EventPayload,
  elementId: number,
) {
  if (
    event.elementId !== elementId ||
    event.eventType !== "keyDown" ||
    !event.value
  )
    return null

  const routed = Schema.decodeUnknownResult(RoutedKeySchema, {
    onExcessProperty: "error",
  })(JSON.parse(event.value))

  if (Result.isFailure(routed)) return null

  const result: NativeEditorRoutedKey = {
    key: decodeText(event.key),
    revision: routed.success.revision,
    mode: routed.success.mode,
  }

  if (event.keyChar) result.keyChar = event.keyChar

  if (event.modifiers) result.modifiers = event.modifiers

  return result
}
