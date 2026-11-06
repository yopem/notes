import { methods, PROTOCOL_VERSION } from "@gpuix/native/automation"
import { createRendererState } from "@gpuix/native/host"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"

import {
  createNativeCloseGuard,
  createNativeCloseOwner,
  createNativeEditor,
  type NativeEditorState,
  readNativeEditorEvent,
  readNativeEditorKeyEvent,
} from "@/features/editor/native/editor"
import {
  type InputPairCommand,
  inputPairCommand,
  InputPairResponseSchema,
} from "@/features/editor/native/input-fence"
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

  test("bounds all native viewport and snapshot pixels", function pixelLimits() {
    const maximum = 3.4028234663852886e38
    const snapshot = {
      version: 1 as const,
      current: { text: "", start: 0, end: 0, direction: "forward" as const },
      undo: [],
      redo: [],
      scrollTop: 0,
      scrollLeft: 0,
    }
    let response: unknown = state
    let calls = 0
    const editor = createNativeEditor(
      {
        applyBatch() {
          return []
        },
        editorCommand() {
          calls += 1
          return JSON.stringify(response)
        },
      },
      1,
    )

    for (const key of [
      "top",
      "left",
      "width",
      "height",
      "contentHeight",
      "contentWidth",
    ] as const) {
      for (const value of [1e39, Number.MAX_VALUE, -1]) {
        response = { ...state, viewport: { ...state.viewport, [key]: value } }
        expect(function invalidState() {
          editor.getState()
        }).toThrow()
      }
      response = { ...state, viewport: { ...state.viewport, [key]: maximum } }
      expect(editor.getState().viewport[key]).toBe(maximum)
    }

    for (const key of ["scrollTop", "scrollLeft"] as const) {
      for (const value of [1e39, Number.MAX_VALUE, -1]) {
        response = { ...snapshot, [key]: value }
        expect(function invalidSnapshot() {
          editor.getSnapshot()
        }).toThrow()
      }
      response = { ...snapshot, [key]: maximum }
      expect(editor.getSnapshot()[key]).toBe(maximum)
    }

    response = state
    const before = calls
    for (const value of [
      1e39,
      Number.MAX_VALUE,
      -1,
      Number.NaN,
      Infinity,
      -Infinity,
    ]) {
      for (const key of ["top", "left"] as const) {
        expect(function invalidViewport() {
          editor.setViewport({ top: 0, left: 0, [key]: value })
        }).toThrow()
      }
      for (const key of ["scrollTop", "scrollLeft"] as const) {
        expect(function invalidRestore() {
          editor.restoreSnapshot(0, { ...snapshot, [key]: value })
        }).toThrow()
      }
    }
    expect(calls).toBe(before)
    editor.setViewport({ top: maximum, left: maximum })
    editor.restoreSnapshot(0, {
      ...snapshot,
      scrollTop: maximum,
      scrollLeft: maximum,
    })
    expect(calls).toBe(before + 2)
  })

  test("retains safe natural number boundaries", function naturalLimits() {
    let response = state
    const editor = createNativeEditor(
      {
        applyBatch() {
          return []
        },
        editorCommand() {
          return JSON.stringify(response)
        },
      },
      1,
    )
    for (const value of [0, Number.MAX_SAFE_INTEGER]) {
      response = { ...state, revision: value }
      expect(editor.getState().revision).toBe(value)
    }
    for (const value of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5]) {
      response = { ...state, revision: value }
      expect(function invalidRevision() {
        editor.getState()
      }).toThrow()
    }
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
      applyBatch() {
        return []
      },
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

  test("uses one native receiver across host wrappers", async function nativeReceiver() {
    let calls = 0

    const native = {
      applyBatch() {
        return []
      },
      registerFontsAsyncV1() {
        expect(this).toBe(native)
        calls++

        return Promise.resolve(2)
      },
    }

    const first = registerFonts({ native })
    expect(registerFonts({ native })).toBe(first)
    expect(registerFonts(native)).toBe(first)
    await first
    expect(calls).toBe(1)
  })

  test("retains failed work without replay", async function failedBatch() {
    let calls = 0

    const native = {
      applyBatch() {
        return []
      },
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
    const native = {
      applyBatch(this: void) {
        return []
      },
      registerFontsAsyncV1() {
        return Promise.resolve(2)
      },
    }

    await expect(
      registerFonts({ applyBatch: native.applyBatch }),
    ).rejects.toThrow("registerFontsAsyncV1")
    Object.defineProperty(native, "registerFontsAsyncV1", {
      value: function synchronousReply() {
        return 2
      },
    })
    await expect(registerFonts(native)).rejects.toThrow("Promise")
  })

  test("requires confirmation for both fonts", async function incompleteReply() {
    const native = {
      applyBatch() {
        return []
      },
      registerFontsAsyncV1() {
        return Promise.resolve(1)
      },
    }

    await expect(registerFonts(native)).rejects.toThrow(
      "both application fonts",
    )
  })
})

describe("native close owner v2", function closeOwnerV2() {
  const decodeCommand = Schema.decodeUnknownSync(
    Schema.Struct({
      protocol: Schema.Number,
      eventId: Schema.optionalKey(Schema.Number),
      expectedOwner: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      owner: Schema.optionalKey(Schema.Number),
      requestId: Schema.optionalKey(Schema.Number),
    }),
  )

  function host() {
    const calls: unknown[] = []
    let owner = 0
    let pending: number | null = null

    const native = {
      applyBatch() {
        return []
      },
      bindCloseOwnerV2(command: string) {
        expect(this).toBe(native)
        const input = decodeCommand(JSON.parse(command))
        calls.push(["bind", input])

        if (input.expectedOwner !== (owner || null))
          throw new Error("stale owner")
        owner++

        return JSON.stringify({
          protocol: 2,
          owner,
          eventId: input.eventId,
          pendingRequest: pending,
          attached: true,
          phase: "armed",
        })
      },
      cancelCloseOwnerV2(command: string) {
        expect(this).toBe(native)
        const input = decodeCommand(JSON.parse(command))
        calls.push(["cancel", input])

        const outcome =
          input.owner === owner && input.requestId === pending
            ? "cancelled"
            : "stale"

        if (outcome === "cancelled") pending = null

        return JSON.stringify({ ...input, outcome })
      },
      releaseCloseOwnerV2(command: string) {
        expect(this).toBe(native)
        const input = decodeCommand(JSON.parse(command))
        calls.push(["release", input])

        return JSON.stringify({
          ...input,
          outcome: input.owner === owner ? "released" : "stale",
        })
      },
      approveCloseOwnerV2(command: string) {
        expect(this).toBe(native)
        const input = decodeCommand(JSON.parse(command))
        calls.push(["approve", input])

        return Promise.resolve(
          JSON.stringify({
            ...input,
            outcome:
              input.owner === owner && input.requestId === pending
                ? "closing"
                : "stale",
          }),
        )
      },
    }

    return {
      native,
      calls,
      request(id: number) {
        pending = id
      },
    }
  }

  function event(eventId: number, owner: number, requestId: number) {
    return {
      elementId: eventId,
      eventType: "windowCloseRequested",
      value: JSON.stringify({ protocol: 2, owner, requestId }),
    }
  }

  test("binds with the real receiver and routes structured requests", async function firstBind() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const binding = dispatcher.attach()
    const requests: number[] = []

    const controller = createNativeCloseOwner(
      { native: fake.native },
      { expectedOwner: null, onRequest: (id) => requests.push(id) },
    )

    expect(fake.calls).toEqual([
      [
        "bind",
        { protocol: 2, eventId: binding.windowKeyEventId, expectedOwner: null },
      ],
    ])
    fake.request(7)
    expect(
      dispatcher.dispatch(event(binding.windowKeyEventId, controller.owner, 7)),
    ).toBe(true)
    dispatcher.dispatch(event(binding.windowKeyEventId, controller.owner, 7))
    dispatcher.dispatch(
      event(binding.windowKeyEventId + 1, controller.owner, 8),
    )
    dispatcher.dispatch(
      event(binding.windowKeyEventId, controller.owner + 1, 8),
    )
    dispatcher.dispatch({
      elementId: binding.windowKeyEventId,
      eventType: "windowCloseRequested",
      value: "{",
    })
    expect(requests).toEqual([7])
    expect(await controller.approve(7)).toEqual({
      protocol: 2,
      owner: controller.owner,
      requestId: 7,
      outcome: "closing",
    })
    expect(controller.dispose()).toEqual({
      protocol: 2,
      owner: controller.owner,
      outcome: "released",
    })
    binding.detach()
  })
  test("delivers monotonic requests after stale future controls", function boundedDelivery() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const binding = dispatcher.attach()
    const requests: number[] = []

    const controller = createNativeCloseOwner(fake.native, {
      expectedOwner: null,
      onRequest: (id) => requests.push(id),
    })

    expect(controller.cancel(1000).outcome).toBe("stale")

    for (let id = 1; id <= 1000; id++) {
      fake.request(id)
      dispatcher.dispatch(event(binding.windowKeyEventId, controller.owner, id))
      dispatcher.dispatch(event(binding.windowKeyEventId, controller.owner, id))

      if (id > 1)
        dispatcher.dispatch(
          event(binding.windowKeyEventId, controller.owner, id - 1),
        )

      expect(controller.cancel(id).outcome).toBe("cancelled")
    }

    expect(requests).toEqual(Array.from({ length: 1000 }, (_, id) => id + 1))
    controller.dispose()
    binding.detach()
  })
  test("delivers a future request after stale approval", async function staleApproval() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const binding = dispatcher.attach()
    const requests: number[] = []

    const controller = createNativeCloseOwner(fake.native, {
      expectedOwner: null,
      onRequest: (id) => requests.push(id),
    })

    expect((await controller.approve(1000)).outcome).toBe("stale")
    fake.request(1000)
    dispatcher.dispatch(event(binding.windowKeyEventId, controller.owner, 1000))
    expect(requests).toEqual([1000])
    controller.dispose()
    binding.detach()
  })
  test("suppresses pending replay after immediate valid controls", async function immediatePendingControls() {
    for (const action of ["cancel", "approve"] as const) {
      const fake = host()
      const dispatcher = createRendererState(fake.native)
      const binding = dispatcher.attach()
      const requests: number[] = []
      fake.request(9)

      const controller = createNativeCloseOwner(fake.native, {
        expectedOwner: null,
        onRequest: (id) => requests.push(id),
      })

      const result = controller[action](9)
      await Promise.resolve()
      expect(requests).toEqual([])
      expect((await result).outcome).toBe(
        action === "cancel" ? "cancelled" : "closing",
      )
      controller.dispose()
      binding.detach()
    }
  })
  test("does not suppress pending replay for an unrelated approval", async function unrelatedPendingApproval() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const binding = dispatcher.attach()
    const requests: number[] = []
    fake.request(9)

    const controller = createNativeCloseOwner(fake.native, {
      expectedOwner: null,
      onRequest: (id) => requests.push(id),
    })

    const stale = controller.approve(1000)
    await Promise.resolve()
    expect(requests).toEqual([9])
    expect((await stale).outcome).toBe("stale")
    controller.dispose()
    binding.detach()
  })
  test("replays pending once and isolates same-root replacement and cancellation", async function retarget() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const binding = dispatcher.attach()

    const first = createNativeCloseOwner(fake.native, {
      expectedOwner: null,
      onRequest: unexpectedClose,
    })

    fake.request(9)
    const requests: number[] = []

    const second = createNativeCloseOwner(fake.native, {
      expectedOwner: first.owner,
      onRequest: (id) => requests.push(id),
    })

    dispatcher.dispatch(event(binding.windowKeyEventId, second.owner, 9))
    await Promise.resolve()
    expect(requests).toEqual([9])
    expect(first.dispose().outcome).toBe("stale")
    dispatcher.dispatch(event(binding.windowKeyEventId, first.owner, 10))
    expect(second.cancel(9).outcome).toBe("cancelled")
    dispatcher.dispatch(event(binding.windowKeyEventId, second.owner, 9))
    expect(requests).toEqual([9])
    expect(second.cancel(9).outcome).toBe("stale")
    expect((await second.approve(9)).outcome).toBe("stale")
    expect(second.dispose().outcome).toBe("released")

    const third = createNativeCloseOwner(fake.native, {
      expectedOwner: second.owner,
      onRequest: unexpectedClose,
    })

    expect(third.owner).toBe(3)
    third.dispose()
    binding.detach()
  })
  test("does not deliver replay or clear a replacement root", async function replacedRoot() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const oldBinding = dispatcher.attach()
    fake.request(11)

    const old = createNativeCloseOwner(fake.native, {
      expectedOwner: null,
      onRequest: unexpectedClose,
    })

    oldBinding.detach()
    const binding = dispatcher.attach()
    const requests: number[] = []

    const next = createNativeCloseOwner(fake.native, {
      expectedOwner: old.owner,
      onRequest: (id) => requests.push(id),
    })

    old.dispose()
    await Promise.resolve()
    expect(requests).toEqual([11])
    dispatcher.dispatch(event(binding.windowKeyEventId, next.owner, 12))
    expect(requests).toEqual([11, 12])
    next.dispose()
    binding.detach()
  })
  test("rejects stale root controls before retarget and releases its owner once", async function staleRoot() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const oldBinding = dispatcher.attach()

    const old = createNativeCloseOwner(fake.native, {
      expectedOwner: null,
      onRequest: unexpectedClose,
    })

    fake.request(20)
    oldBinding.detach()
    const binding = dispatcher.attach()
    const before = fake.calls.length

    expect(old.cancel(20)).toEqual({
      protocol: 2,
      owner: old.owner,
      requestId: 20,
      outcome: "stale",
    })
    expect(await old.approve(20)).toEqual({
      protocol: 2,
      owner: old.owner,
      requestId: 20,
      outcome: "stale",
    })
    expect(fake.calls).toHaveLength(before)
    expect(old.dispose().outcome).toBe("released")
    expect(old.dispose().outcome).toBe("stale")
    expect(fake.calls).toHaveLength(before + 1)

    const next = createNativeCloseOwner(fake.native, {
      expectedOwner: old.owner,
      onRequest: unexpectedClose,
    })

    expect(next.owner).toBeGreaterThan(old.owner)
    next.dispose()
    binding.detach()
  })
  test("does not call native for retargeted, disposed, or replaced handlers", async function staleControls() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const binding = dispatcher.attach()

    const old = createNativeCloseOwner(fake.native, {
      expectedOwner: null,
      onRequest: unexpectedClose,
    })

    const next = createNativeCloseOwner(fake.native, {
      expectedOwner: old.owner,
      onRequest: unexpectedClose,
    })

    const before = fake.calls.length
    expect(old.cancel(1).outcome).toBe("stale")
    expect((await old.approve(1)).outcome).toBe("stale")
    expect(old.dispose().outcome).toBe("stale")
    expect(fake.calls).toHaveLength(before)
    binding.eventHandlers
      .get(binding.windowKeyEventId)
      ?.set("windowCloseRequested", unexpectedClose)
    expect(next.cancel(1).outcome).toBe("stale")
    expect((await next.approve(1)).outcome).toBe("stale")
    expect(fake.calls).toHaveLength(before)
    expect(next.dispose().outcome).toBe("released")
    expect(next.cancel(1).outcome).toBe("stale")
    expect((await next.approve(1)).outcome).toBe("stale")
    expect(next.dispose().outcome).toBe("stale")
    expect(fake.calls).toHaveLength(before + 1)
    expect(
      binding.eventHandlers
        .get(binding.windowKeyEventId)
        ?.get("windowCloseRequested"),
    ).toBe(unexpectedClose)
    binding.detach()
  })
  test("rejects nonincreasing owner identities", function nonincreasingOwner() {
    for (const returnedOwner of [1, 2]) {
      const fake = host()
      const binding = createRendererState(fake.native).attach()
      Object.defineProperty(fake.native, "bindCloseOwnerV2", {
        value: () =>
          JSON.stringify({
            protocol: 2,
            owner: returnedOwner,
            eventId: binding.windowKeyEventId,
            pendingRequest: null,
            attached: true,
            phase: "armed",
          }),
      })
      expect(() =>
        createNativeCloseOwner(fake.native, {
          expectedOwner: 2,
          onRequest: unexpectedClose,
        }),
      ).toThrow("Invalid close binding identity")
      binding.detach()
    }
  })
  test("restores the exact previous callback on bind failure", function restoreHandler() {
    const fake = host()
    const dispatcher = createRendererState(fake.native)
    const binding = dispatcher.attach()

    function previous() {
      return undefined
    }

    binding.eventHandlers.set(
      binding.windowKeyEventId,
      new Map([["windowCloseRequested", previous]]),
    )
    expect(() =>
      createNativeCloseOwner(fake.native, {
        expectedOwner: 99,
        onRequest: unexpectedClose,
      }),
    ).toThrow()
    expect(
      binding.eventHandlers
        .get(binding.windowKeyEventId)
        ?.get("windowCloseRequested"),
    ).toBe(previous)
    binding.detach()
  })
  test("rejects legacy hosts before replacing a handler", function legacy() {
    const native = {
      applyBatch() {
        return []
      },
    }

    const binding = createRendererState(native).attach()

    function previous() {
      return undefined
    }

    binding.eventHandlers.set(
      binding.windowKeyEventId,
      new Map([["windowCloseRequested", previous]]),
    )
    expect(() =>
      createNativeCloseOwner(native, {
        expectedOwner: null,
        onRequest: unexpectedClose,
      }),
    ).toThrow()
    expect(
      binding.eventHandlers
        .get(binding.windowKeyEventId)
        ?.get("windowCloseRequested"),
    ).toBe(previous)
    binding.detach()
  })
  test("rejects malformed and mismatched bind replies", function invalidBind() {
    for (const reply of [
      "{",
      JSON.stringify({
        protocol: 2,
        owner: 1,
        eventId: 0,
        pendingRequest: null,
        attached: true,
        phase: "armed",
        extra: true,
      }),
      JSON.stringify({
        protocol: 2,
        owner: 0,
        eventId: 0,
        pendingRequest: null,
        attached: true,
        phase: "armed",
      }),
    ]) {
      const fake = host()
      const binding = createRendererState(fake.native).attach()
      Object.defineProperty(fake.native, "bindCloseOwnerV2", {
        value: () => reply,
      })
      expect(() =>
        createNativeCloseOwner(fake.native, {
          expectedOwner: null,
          onRequest: unexpectedClose,
        }),
      ).toThrow()
      binding.detach()
    }
  })
  test("rejects malformed, mismatched and non-Promise replies", async function invalidReplies() {
    const fake = host()
    const binding = createRendererState(fake.native).attach()

    const controller = createNativeCloseOwner(fake.native, {
      expectedOwner: null,
      onRequest: unexpectedClose,
    })

    Object.defineProperty(fake.native, "cancelCloseOwnerV2", {
      value: () =>
        JSON.stringify({
          protocol: 2,
          owner: controller.owner,
          requestId: 8,
          outcome: "cancelled",
          extra: 1,
        }),
    })
    expect(() => controller.cancel(7)).toThrow()
    Object.defineProperty(fake.native, "approveCloseOwnerV2", {
      configurable: true,
      value: () => "{}",
    })
    await expect(controller.approve(7)).rejects.toThrow("Promise")
    Object.defineProperty(fake.native, "approveCloseOwnerV2", {
      value: () =>
        Promise.resolve(
          JSON.stringify({
            protocol: 2,
            owner: controller.owner + 1,
            requestId: 7,
            outcome: "closing",
          }),
        ),
    })
    await expect(controller.approve(7)).rejects.toThrow()
    Object.defineProperty(fake.native, "releaseCloseOwnerV2", {
      value: () =>
        JSON.stringify({
          protocol: 2,
          owner: controller.owner + 1,
          outcome: "released",
        }),
    })
    expect(() => controller.dispose()).toThrow()
    binding.detach()
  })
})

describe("optional native input pair protocol", function inputPairProtocol() {
  const capture = {
    protocol: 1,
    op: "capture",
    owner: 2,
    titleId: 3,
    bodyId: 4,
    context: "notes:Ω",
  } satisfies InputPairCommand

  const held = {
    owner: 2,
    generation: 5,
    phase: "held",
    context: capture.context,
    titleId: 3,
    bodyId: 4,
    title: state,
    body: state,
  } as const

  const reply = { protocol: 1, currentOwner: 2, capture: held } as const

  const inspect = {
    protocol: 1,
    op: "inspect",
    owner: 2,
  } satisfies InputPairCommand

  const cancel = {
    protocol: 1,
    op: "finish",
    owner: 2,
    generation: 5,
    disposition: "cancel",
  } satisfies InputPairCommand

  const seal = { ...cancel, disposition: "seal" } satisfies InputPairCommand

  const adopt = {
    protocol: 1,
    op: "adopt",
    owner: 2,
    expectedOwner: 1,
    generation: 5,
  } satisfies InputPairCommand

  function host(value: string) {
    return {
      inputPairCommandV1: function respond(_command: string) {
        return Promise.resolve(value)
      },
    }
  }

  function failure(raw: ReturnType<typeof host>, command: InputPairCommand) {
    return Effect.runPromise(Effect.flip(inputPairCommand(raw, command)))
  }

  test("defers host calls and retains the receiver", async function deferred() {
    let calls = 0

    const native = {
      inputPairCommandV1(command: string) {
        expect(this).toBe(native)
        expect(JSON.parse(command)).toEqual(capture)
        calls += 1

        return Promise.resolve(JSON.stringify(reply))
      },
    }

    const effect = inputPairCommand(native, capture)
    expect(calls).toBe(0)
    expect(await Effect.runPromise(effect)).toEqual(reply)
    expect(calls).toBe(1)
    expect(
      (await Effect.runPromise(Effect.flip(inputPairCommand({}, inspect))))
        ._tag,
    ).toBe("InputPairUnsupported")
  })

  test("accepts each success shape and older inspect captures", async function success() {
    for (const [command, response] of [
      [capture, reply],
      [inspect, reply],
      [inspect, { ...reply, capture: null }],
      [inspect, { ...reply, capture: { ...held, owner: 1 } }],
      [cancel, { ...reply, capture: null }],
      [
        seal,
        { ...reply, capture: { ...held, generation: 6, phase: "sealed" } },
      ],
      [adopt, { ...reply, capture: { ...held, generation: 6 } }],
      [
        adopt,
        { ...reply, capture: { ...held, generation: 6, phase: "sealed" } },
      ],
    ] as const) {
      expect(
        await Effect.runPromise(
          inputPairCommand(host(JSON.stringify(response)), command),
        ),
      ).toEqual(response)
    }
  })

  const composed = { ...state, composition: { start: 0, end: 1 } }

  for (const [name, title, body] of [
    ["title", composed, state],
    ["body", state, composed],
    ["both", composed, composed],
  ] as const) {
    for (const [operation, command, phase, generation] of [
      ["capture", capture, "held", 5],
      ["seal", seal, "sealed", 6],
      ["adopt held", adopt, "held", 6],
      ["adopt sealed", adopt, "sealed", 6],
      ["inspect held", inspect, "held", 5],
      ["inspect sealed", inspect, "sealed", 5],
    ] as const) {
      test(`rejects ${name} composition in ${operation}`, async function composedReply() {
        const response = {
          ...reply,
          capture: { ...held, phase, generation, title, body },
        }

        const calls: string[] = []

        const native = {
          inputPairCommandV1(request: string) {
            calls.push(request)

            return Promise.resolve(JSON.stringify(response))
          },
        }

        const error = await failure(native, command)
        expect(error._tag).toBe("InputPairInvalidResponse")
        expect(error.message).toContain("completion is unknown")
        expect(calls).toEqual([JSON.stringify(command)])
        expect(function decodeResponse() {
          Schema.decodeUnknownSync(InputPairResponseSchema, {
            onExcessProperty: "error",
          })(response)
        }).toThrow()
      })
    }
  }

  test("rejects excessive held and sealed pixels with unknown completion", async function excessivePixels() {
    for (const [command, phase, generation] of [
      [capture, "held", 5],
      [seal, "sealed", 6],
    ] as const) {
      for (const field of ["title", "body"] as const) {
        const calls: string[] = []
        const response = {
          ...reply,
          capture: {
            ...held,
            phase,
            generation,
            [field]: { ...state, viewport: { ...state.viewport, width: 1e39 } },
          },
        }
        const native = {
          inputPairCommandV1(request: string) {
            calls.push(request)
            return Promise.resolve(JSON.stringify(response))
          },
        }
        const error = await failure(native, command)
        expect(error._tag).toBe("InputPairInvalidResponse")
        expect(error.message).toContain("completion is unknown")
        expect(calls).toEqual([JSON.stringify(command)])
      }
    }
  })

  test("retains composition in ordinary editor state and uncertain inspection", async function uncertainComposition() {
    const native = {
      applyBatch() {
        return []
      },
      editorCommand() {
        return JSON.stringify(composed)
      },
    }

    expect(createNativeEditor({ native }, 7).getState()).toEqual(composed)

    for (const [title, body] of [
      [composed, state],
      [state, composed],
      [composed, composed],
    ] as const) {
      const response = {
        ...reply,
        capture: { ...held, phase: "uncertain" as const, title, body },
      }

      expect(
        Schema.decodeUnknownSync(InputPairResponseSchema, {
          onExcessProperty: "error",
        })(response),
      ).toEqual(response)
      expect(
        await Effect.runPromise(
          inputPairCommand(host(JSON.stringify(response)), inspect),
        ),
      ).toEqual(response)
    }
  })

  test("rejects invalid requests before invoking the host", async function requests() {
    let calls = 0

    const native = {
      inputPairCommandV1(_command: string) {
        calls += 1

        return Promise.resolve("")
      },
    }

    const invalid = [
      { ...capture, owner: 0 },
      { ...capture, owner: Number.MAX_SAFE_INTEGER + 1 },
      { ...capture, bodyId: 3 },
      { ...capture, context: "" },
      { ...capture, context: " a" },
      { ...capture, context: "a\n" },
      { ...capture, context: "a\u0085b" },
      { ...capture, context: "Ω".repeat(513) },
      { ...capture, extra: "x".repeat(4096) },
      { ...adopt, owner: 1 },
      { ...seal, generation: 0 },
    ]

    for (const command of invalid) {
      expect((await failure(native, command))._tag).toBe(
        "InputPairInvalidRequest",
      )
    }

    expect(calls).toBe(0)

    const boundary = {
      ...capture,
      owner: Number.MAX_SAFE_INTEGER,
      context: "Ω".repeat(512),
    }

    const validReply = {
      ...reply,
      currentOwner: boundary.owner,
      capture: { ...held, owner: boundary.owner, context: boundary.context },
    }

    expect(
      await Effect.runPromise(
        inputPairCommand(host(JSON.stringify(validReply)), boundary),
      ),
    ).toEqual(validReply)

    const escaped = { ...capture, context: "\\".repeat(1024) }

    const escapedReply = {
      ...reply,
      capture: { ...held, context: escaped.context },
    }

    expect(
      new TextEncoder().encode(JSON.stringify(escaped)).length,
    ).toBeLessThanOrEqual(4096)
    expect(
      await Effect.runPromise(
        inputPairCommand(host(JSON.stringify(escapedReply)), escaped),
      ),
    ).toEqual(escapedReply)
  })

  test("rejects malformed, extra, duplicate and inconsistent replies", async function responses() {
    const invalid = [
      "not json",
      JSON.stringify({ ...reply, extra: 1 }),
      JSON.stringify({ ...reply, capture: { ...held, extra: 1 } }),
      JSON.stringify({
        ...reply,
        capture: { ...held, title: { ...state, extra: 1 } },
      }),
      JSON.stringify({ ...reply, currentOwner: 1 }),
      JSON.stringify({ ...reply, capture: { ...held, owner: 1 } }),
      JSON.stringify({ ...reply, capture: { ...held, context: "other" } }),
      JSON.stringify({ ...reply, capture: { ...held, titleId: 4 } }),
      JSON.stringify({ ...reply, capture: { ...held, phase: "sealed" } }),
      JSON.stringify({ ...reply, capture: { ...held, generation: 0 } }),
      JSON.stringify({ ...reply, capture: { ...held, context: " bad" } }),
      JSON.stringify(reply).replace(
        '"protocol":1',
        '"protocol":1,"protocol":1',
      ),
    ]

    for (const value of invalid)
      expect((await failure(host(value), capture))._tag).toBe(
        "InputPairInvalidResponse",
      )

    for (const [command, response] of [
      [cancel, reply],
      [seal, reply],
      [seal, { ...reply, capture: { ...held, phase: "sealed" } }],
      [
        adopt,
        { ...reply, capture: { ...held, generation: 6, phase: "uncertain" } },
      ],
      [adopt, reply],
    ] as const)
      expect(
        (await failure(host(JSON.stringify(response)), command))._tag,
      ).toBe("InputPairInvalidResponse")
  })

  test("reports redacted failures and rejects a non-Promise host", async function redaction() {
    const native = host("")
    Reflect.set(native, "inputPairCommandV1", function invalid() {
      return "secret body"
    })
    const nonPromise = await failure(native, inspect)
    expect(nonPromise._tag).toBe("InputPairNativeFailure")

    const rejected = await failure(
      {
        inputPairCommandV1: function reject() {
          return Promise.reject(new Error("secret body and context"))
        },
      },
      inspect,
    )

    expect(rejected._tag).toBe("InputPairNativeFailure")
    const invalid = await failure(host("secret body and context"), inspect)
    expect(invalid._tag).toBe("InputPairInvalidResponse")

    for (const error of [nonPromise, rejected, invalid])
      expect(JSON.stringify(error)).not.toContain("secret")
  })
})
