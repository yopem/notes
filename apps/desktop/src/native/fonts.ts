import type { NativeRenderer } from "@gpuix/native/host"

import { Predicate, Schema } from "effect"
import { readFileSync } from "node:fs"
import { isPromise } from "node:util/types"

import monoPath from "@/assets/IBMPlexMono-Regular.ttf" with { type: "file" }
import interPath from "@/assets/Inter.ttf" with { type: "file" }

interface NativeFontHost extends NativeRenderer {
  registerFontsAsyncV1?: (fonts: Uint8Array[]) => Promise<number>
}

type FontRenderer = NativeFontHost | { native: NativeFontHost }

interface FontRegistration {
  status: "pending" | "ready" | "failed"
  completion: Promise<void>
}

declare global {
  var stillNotesFontRegistrationV2:
    WeakMap<NativeFontHost, FontRegistration> | undefined
}

const registrations = (globalThis.stillNotesFontRegistrationV2 ??= new WeakMap<
  NativeFontHost,
  FontRegistration
>())

async function requestNativeFontBatch(renderer: NativeFontHost) {
  const register = renderer.registerFontsAsyncV1

  if (!Predicate.isFunction(register))
    throw new Error(
      "Rebuild the native host with registerFontsAsyncV1 and restart Still Notes.",
    )

  const completion: unknown = register.call(renderer, [
    readFileSync(interPath),
    readFileSync(monoPath),
  ])

  if (!isPromise(completion))
    throw new Error("Native font registration must return a Promise.")

  const count: unknown = await completion

  if (!Schema.is(Schema.Literal(2))(count))
    throw new Error("The native host did not confirm both application fonts.")
}

export function registerFonts(renderer: FontRenderer) {
  const native = "native" in renderer ? renderer.native : renderer
  const previous = registrations.get(native)

  if (previous) return previous.completion

  const reply = Promise.withResolvers<void>()
  const registration: FontRegistration = {
    status: "pending",
    completion: reply.promise,
  }

  registrations.set(native, registration)

  void requestNativeFontBatch(native).then(
    function ready() {
      registration.status = "ready"
      reply.resolve()
    },
    function failed(cause: unknown) {
      registration.status = "failed"
      reply.reject(cause)
    },
  )

  return registration.completion
}
