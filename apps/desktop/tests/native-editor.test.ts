import { methods, PROTOCOL_VERSION } from "@gpuix/native/automation"
import { createRendererState } from "@gpuix/native/host"
import { describe, expect, test } from "bun:test"

import {
  createNativeCloseGuard,
  createNativeEditor,
  type NativeEditorState,
  readNativeEditorEvent,
  readNativeEditorKeyEvent,
} from "@/features/editor/native/editor"
import { registerFonts } from "@/native/fonts"

test("installed automation schema preserves exact optional editor text", function treeTextContract() {
  expect(PROTOCOL_VERSION).toBe(1)

  const tree = {
    id: 1,
    type: "div",
    children: [
      { id: 2, type: "input", testId: "note-title", text: "Task plans Ω copy" },
      { id: 3, type: "textarea", text: "- [x] Call 🌿\né" },
      { id: 4, type: "input", text: "" },
      { id: 5, type: "input" },
      { id: 6, type: "textarea", text: "中😀é" },
    ],
  }

  expect(methods.getTree.result.parse({ tree })).toEqual({ tree })
  expect(methods.getTree.result.parse({ tree: null })).toEqual({ tree: null })
  expect(function invalidText() {
    methods.getTree.result.parse({ tree: { id: 1, type: "input", text: 1 } })
  }).toThrow()
})

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

test("routes close requests until an explicit close", function closeRequests() {
  const calls: unknown[] = []

  const native = {
    applyBatch() {
      return []
    },
    armCloseGuard(id: number) {
      expect(this).toBe(native)
      calls.push(["arm", id])
    },
    closeWindow() {
      expect(this).toBe(native)
      calls.push(["close"])
    },
  }

  const dispatcher = createRendererState(native)
  const binding = dispatcher.attach()
  let requests = 0

  const guard = createNativeCloseGuard({ native }, function requestClose() {
    requests += 1
  })

  expect(calls).toEqual([["arm", binding.windowKeyEventId]])
  expect(
    dispatcher.dispatch({
      elementId: binding.windowKeyEventId + 1,
      eventType: "windowCloseRequested",
    }),
  ).toBe(false)
  expect(
    dispatcher.dispatch({
      elementId: binding.windowKeyEventId,
      eventType: "windowCloseRequested",
    }),
  ).toBe(true)
  expect(requests).toBe(1)
  expect(calls).toEqual([["arm", binding.windowKeyEventId]])
  guard.close()
  expect(calls).toEqual([["arm", binding.windowKeyEventId], ["close"]])
  binding.detach()
})

function unexpectedClose() {
  throw new Error("Unexpected close bridge call")
}

test("refuses to arm without a mounted root or a native bridge", function closePrerequisites() {
  const native = {
    applyBatch() {
      return []
    },
    armCloseGuard: unexpectedClose,
    closeWindow: unexpectedClose,
  }

  expect(function withoutRoot() {
    createNativeCloseGuard(native, unexpectedClose)
  }).toThrow("Mount the GPUix root")

  const missing = {
    applyBatch() {
      return []
    },
  }

  const binding = createRendererState(missing).attach()
  expect(function withoutNative() {
    createNativeCloseGuard(missing, unexpectedClose)
  }).toThrow("close guard")
  binding.detach()
})

test("removes the close handler when native arming fails", function failedCloseArm() {
  const native = {
    applyBatch() {
      return []
    },
    armCloseGuard() {
      throw new Error("not initialized")
    },
    closeWindow: unexpectedClose,
  }

  const dispatcher = createRendererState(native)
  const binding = dispatcher.attach()
  expect(function arm() {
    createNativeCloseGuard(native, unexpectedClose)
  }).toThrow("not initialized")
  expect(
    dispatcher.dispatch({
      elementId: binding.windowKeyEventId,
      eventType: "windowCloseRequested",
    }),
  ).toBe(false)
  binding.detach()
})

test("rejects arming after an unguarded close starts", function closeAlreadyStarted() {
  const native = {
    applyBatch() {
      return []
    },
    armCloseGuard() {
      throw new Error("Window is closing")
    },
    closeWindow: unexpectedClose,
  }

  const dispatcher = createRendererState(native)
  const binding = dispatcher.attach()

  expect(function arm() {
    createNativeCloseGuard(native, unexpectedClose)
  }).toThrow("Window is closing")
  expect(
    dispatcher.dispatch({
      elementId: binding.windowKeyEventId,
      eventType: "windowCloseRequested",
    }),
  ).toBe(false)
  binding.detach()
})

test("refuses to replace an active close handler", function duplicateCloseGuard() {
  let arms = 0
  let requests = 0

  const native = {
    applyBatch() {
      return []
    },
    armCloseGuard() {
      arms += 1
    },
    closeWindow: unexpectedClose,
  }

  const dispatcher = createRendererState(native)
  const binding = dispatcher.attach()
  createNativeCloseGuard(native, function firstRequest() {
    requests += 1
  })
  expect(function duplicate() {
    createNativeCloseGuard(native, unexpectedClose)
  }).toThrow("Window already has a close guard")
  expect(arms).toBe(1)
  expect(
    dispatcher.dispatch({
      elementId: binding.windowKeyEventId,
      eventType: "windowCloseRequested",
    }),
  ).toBe(true)
  expect(requests).toBe(1)
  binding.detach()
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

describe("native font completion boundary", function fontCompletion() {
  test("shares pending work and waits for native success", async function pendingBatch() {
    const reply = Promise.withResolvers<number>()
    const batches: Uint8Array[][] = []
    const native = {
      registerFontsAsyncV1(fonts: Uint8Array[]) {
        batches.push(fonts)
        return reply.promise
      },
    }
    const first = registerFonts(native)
    const second = registerFonts(native)
    let completed = false
    void first.then(function markComplete() {
      completed = true
    })
    await Bun.sleep(0)
    expect(second).toBe(first)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    for (const font of batches[0] ?? [])
      expect(font.byteLength).toBeGreaterThan(0)
    expect(completed).toBe(false)
    reply.resolve(2)
    await first
    expect(completed).toBe(true)
    expect(registerFonts(native)).toBe(first)
    expect(batches).toHaveLength(1)
  })

  test("retains failed work without replay", async function failedBatch() {
    let calls = 0
    const native = {
      registerFontsAsyncV1() {
        calls++
        return Promise.reject(new Error("Owned font reply failed"))
      },
    }
    const first = registerFonts(native)
    await expect(first).rejects.toThrow("Owned font reply failed")
    expect(registerFonts(native)).toBe(first)
    await expect(registerFonts(native)).rejects.toThrow(
      "Owned font reply failed",
    )
    expect(calls).toBe(1)
  })

  test("refuses legacy and synchronous font hosts", async function invalidHost() {
    await expect(registerFonts({})).rejects.toThrow("registerFontsAsyncV1")
    await expect(
      registerFonts({ registerFontsAsyncV1: () => 2 }),
    ).rejects.toThrow("Promise")
  })

  test("requires confirmation for both fonts", async function incompleteReply() {
    const native = {
      registerFontsAsyncV1() {
        return Promise.resolve(1)
      },
    }
    await expect(registerFonts(native)).rejects.toThrow(
      "both application fonts",
    )
  })
})
