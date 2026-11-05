import type { EventPayload } from "@gpuix/native"
import {
  createRendererState,
  type NativeRenderer,
  registerEventHandler,
  unregisterEventHandler,
} from "@gpuix/native/host"
import { z } from "zod"

const OffsetSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const PixelSchema = z.number().finite().nonnegative()

const EditorModeSchema = z.enum(["insert", "normal", "readOnly"])

const SelectionSchema = z
  .strictObject({
    start: OffsetSchema,
    end: OffsetSchema,
    direction: z.enum(["forward", "backward"]),
  })
  .refine(function ordered(selection) {
    return selection.start <= selection.end
  })

const RevisionSchema = z.strictObject({ revision: OffsetSchema })

const SetSelectionSchema = RevisionSchema.extend(SelectionSchema.shape)

const ViewportSchema = z.strictObject({ top: PixelSchema, left: PixelSchema })

const ReplaceRangeSchema = RevisionSchema.extend({
  start: OffsetSchema,
  end: OffsetSchema,
  text: z.string(),
  selection: SelectionSchema.optional(),
}).refine(function ordered(range) {
  return range.start <= range.end
})

const TextSnapshotSchema = z.strictObject({
  text: z.string(),
  ...SelectionSchema.shape,
})

const EditorSnapshotSchema = z.strictObject({
  version: z.literal(1),
  current: TextSnapshotSchema,
  undo: z.array(TextSnapshotSchema).max(200),
  redo: z.array(TextSnapshotSchema).max(200),
  scrollTop: PixelSchema,
  scrollLeft: PixelSchema,
})

const EditorStateSchema = z.strictObject({
  text: z.string(),
  revision: OffsetSchema,
  selection: SelectionSchema,
  composition: z
    .strictObject({ start: OffsetSchema, end: OffsetSchema })
    .nullable(),
  mode: EditorModeSchema,
  readOnly: z.boolean(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  viewport: ViewportSchema.extend({
    width: PixelSchema,
    height: PixelSchema,
    contentHeight: PixelSchema,
    contentWidth: PixelSchema,
  }),
})

const EditorEventSchema = z.object({
  elementId: OffsetSchema,
  eventType: z.string(),
  value: z.string().optional(),
})

export interface NativeEditorProps {
  editorMode?: NativeEditorMode
  editorLanguage?: string
  editorPath?: string
}

export type NativeEditorMode = z.infer<typeof EditorModeSchema>

export type NativeEditorSelection = z.infer<typeof SelectionSchema>

export type NativeEditorState = z.infer<typeof EditorStateSchema>

export type NativeEditorSnapshot = z.infer<typeof EditorSnapshotSchema>

export type NativeEditorReplaceRange = z.infer<typeof ReplaceRangeSchema>

type EditorRenderer = NativeRenderer & {
  editorCommand?: (elementId: number, commandJson: string) => string
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

/** Connect only after the native input has rendered. Stock GPUix has no editorCommand. */
export function createNativeEditor(
  renderer: EditorRenderer | { native: EditorRenderer },
  elementId: number,
) {
  const id = OffsetSchema.parse(elementId)
  const wrapped = z.object({ native: z.unknown() }).safeParse(renderer)

  const native = wrapped.success ? (wrapped.data.native ?? renderer) : renderer

  const bridge = z
    .object({ editorCommand: z.instanceof(Function) })
    .safeParse(native)

  if (!bridge.success) {
    throw new Error("Custom GPUix addon with editorCommand is required")
  }

  const command = bridge.data.editorCommand

  function execute<Output>(
    value: NativeEditorCommand,
    schema: z.ZodType<Output>,
  ) {
    const response: unknown = command.call(native, id, JSON.stringify(value))

    return schema.parse(JSON.parse(z.string().parse(response)))
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
        revision: OffsetSchema.parse(revision),
        snapshot: EditorSnapshotSchema.parse(snapshot),
      },
      EditorStateSchema,
    )
  }

  function setSelection(
    selection: NativeEditorSelection & { revision: number },
  ) {
    return execute(
      { type: "setSelection", ...SetSelectionSchema.parse(selection) },
      EditorStateSchema,
    )
  }

  function replaceRange(range: NativeEditorReplaceRange) {
    return execute(
      { type: "replaceRange", ...ReplaceRangeSchema.parse(range) },
      EditorStateSchema,
    )
  }

  function undo(revision: number) {
    return execute(
      { type: "undo", revision: OffsetSchema.parse(revision) },
      EditorStateSchema,
    )
  }

  function redo(revision: number) {
    return execute(
      { type: "redo", revision: OffsetSchema.parse(revision) },
      EditorStateSchema,
    )
  }

  function setViewport(viewport: z.infer<typeof ViewportSchema>) {
    return execute(
      { type: "setViewport", ...ViewportSchema.parse(viewport) },
      EditorStateSchema,
    )
  }

  function setMode(mode: NativeEditorMode) {
    return execute(
      { type: "setMode", mode: EditorModeSchema.parse(mode) },
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
  const parsed = EditorEventSchema.safeParse(event)

  if (
    !parsed.success ||
    parsed.data.eventType !== "editorState" ||
    parsed.data.elementId !== elementId
  ) {
    return null
  }

  return EditorStateSchema.parse(
    JSON.parse(z.string().parse(parsed.data.value)),
  )
}

const RoutedKeySchema = z.strictObject({
  nativeEditorRoute: z.literal(true),
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
  const routed = RoutedKeySchema.safeParse(JSON.parse(event.value))

  if (!routed.success) return null

  const result: NativeEditorRoutedKey = {
    key: z.string().parse(event.key),
    revision: routed.data.revision,
    mode: routed.data.mode,
  }

  if (event.keyChar) result.keyChar = event.keyChar

  if (event.modifiers) result.modifiers = event.modifiers

  return result
}
