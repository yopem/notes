import { createRendererState } from "@gpuix/native/host"
import { describe, expect, test } from "bun:test"

import {
  createNativeEditor,
  readNativeEditorEvent,
  readNativeEditorKeyEvent,
  type NativeEditorState,
} from "@/native/editor"

const state = {
  text: "a😀é中",
  revision: 2,
  selection: { start: 1, end: 3, direction: "backward" },
  composition: null,
  mode: "insert",
  readOnly: false,
  canUndo: true,
  canRedo: false,
  viewport: {
    top: 0,
    left: 0,
    width: 400,
    height: 200,
    contentHeight: 200,
    contentWidth: 400,
  },
} satisfies NativeEditorState

describe("native editor wire boundary", function nativeEditorBoundary() {
  test("uses actual nested native receiver and UTF-16 command offsets", function forwardCommand() {
    const calls: unknown[] = []

    const native = {
      applyBatch() {
        return []
      },
      editorCommand(id: number, command: string) {
        expect(this).toBe(native)
        calls.push([id, JSON.parse(command)])

        return JSON.stringify(state)
      },
    }

    const editor = createNativeEditor({ native }, 7)
    expect(editor.getState().selection).toEqual(state.selection)
    editor.replaceRange({ revision: 2, start: 1, end: 3, text: "中" })
    expect(calls[1]).toEqual([
      7,
      { type: "replaceRange", revision: 2, start: 1, end: 3, text: "中" },
    ])
    editor.setMode("normal")
    expect(calls[2]).toEqual([7, { type: "setMode", mode: "normal" }])
  })

  test("rejects missing addon method without inventing an API", function missingBridge() {
    expect(function missing() {
      createNativeEditor(
        {
          applyBatch() {
            return []
          },
        },
        1,
      )
    }).toThrow("editorCommand")
  })

  test("rejects malformed native state", function invalidState() {
    const editor = createNativeEditor(
      {
        applyBatch() {
          return []
        },
        editorCommand() {
          return "{}"
        },
      },
      1,
    )

    expect(function read() {
      editor.getState()
    }).toThrow()
  })

  test("rejects invalid input before calling native", function invalidCommand() {
    let calls = 0

    const editor = createNativeEditor(
      {
        applyBatch() {
          return []
        },
        editorCommand() {
          calls += 1

          return JSON.stringify(state)
        },
      },
      1,
    )

    expect(function select() {
      editor.setSelection({
        revision: -1,
        start: 0,
        end: 0,
        direction: "forward",
      })
    }).toThrow()
    expect(function viewport() {
      editor.setViewport({ top: Number.NaN, left: 0 })
    }).toThrow()
    expect(calls).toBe(0)
  })

  test("filters state events by type and editor id", function stateEvent() {
    expect(
      readNativeEditorEvent(
        { eventType: "change", elementId: 7, value: "text" },
        7,
      ),
    ).toBeNull()
    expect(
      readNativeEditorEvent(
        {
          eventType: "editorState",
          elementId: 8,
          value: JSON.stringify(state),
        },
        7,
      ),
    ).toBeNull()
    expect(
      readNativeEditorEvent(
        {
          eventType: "editorState",
          elementId: 7,
          value: JSON.stringify(state),
        },
        7,
      )?.revision,
    ).toBe(2)
  })
})

test("distinguishes routed normal keys from native insert keys", function routedKey() {
  expect(
    readNativeEditorKeyEvent(
      { elementId: 7, eventType: "keyDown", key: "i" },
      7,
    ),
  ).toBeNull()
  expect(
    readNativeEditorKeyEvent(
      {
        elementId: 7,
        eventType: "keyDown",
        key: "i",
        value: JSON.stringify({
          nativeEditorRoute: true,
          revision: 2,
          mode: "normal",
        }),
      },
      7,
    ),
  ).toEqual({ key: "i", revision: 2, mode: "normal" })
})

test("registers editor state events in the real GPUix host dispatcher", function subscription() {
  const native = {
    applyBatch() {
      return []
    },
    editorCommand() {
      return JSON.stringify(state)
    },
  }

  const dispatcher = createRendererState(native)
  const binding = dispatcher.attach()
  const seen: number[] = []
  const editor = createNativeEditor(native, 7)

  const unsubscribe = editor.subscribe(function receive(next) {
    seen.push(next.revision)
  })

  const event = {
    elementId: 7,
    eventType: "editorState",
    value: JSON.stringify(state),
  }

  expect(dispatcher.dispatch(event)).toBe(true)
  expect(seen).toEqual([2])
  unsubscribe()
  expect(dispatcher.dispatch(event)).toBe(false)
  expect(seen).toEqual([2])
  binding.detach()
})
