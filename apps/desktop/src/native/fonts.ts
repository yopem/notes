import type { NativeRenderer } from "@gpuix/react"

import { Predicate } from "effect"
import { readFileSync } from "node:fs"

import monoPath from "@/assets/IBMPlexMono-Regular.ttf" with { type: "file" }
import interPath from "@/assets/Inter.ttf" with { type: "file" }

type FontRegistration =
  { status: "ready" } | { status: "failed"; cause: unknown }

declare global {
  var stillNotesFontRegistration:
    WeakMap<NativeRenderer, FontRegistration> | undefined
}

const registrations = (globalThis.stillNotesFontRegistration ??= new WeakMap<
  NativeRenderer,
  FontRegistration
>())

export function registerFonts(renderer: NativeRenderer) {
  const previous = registrations.get(renderer)

  if (previous?.status === "ready") return

  if (previous?.status === "failed")
    throw new Error("Restart Still Notes before repeating font setup.", {
      cause: previous.cause,
    })

  try {
    if (!Predicate.isFunction(renderer.registerFont))
      throw new Error("The native host cannot register application fonts.")
    renderer.registerFont(readFileSync(interPath))
    renderer.registerFont(readFileSync(monoPath))
    registrations.set(renderer, { status: "ready" })
  } catch (cause) {
    registrations.set(renderer, { status: "failed", cause })
    throw cause
  }
}
