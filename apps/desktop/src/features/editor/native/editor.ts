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

const EditorStateSchema = Schema.Struct({
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
