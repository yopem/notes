import type { NativeRenderer } from "@gpuix/react"

import { readFileSync } from "node:fs"

import monoPath from "./assets/IBMPlexMono-Regular.ttf" with { type: "file" }
import interPath from "./assets/Inter.ttf" with { type: "file" }

const registered = new WeakSet<NativeRenderer>()

export function registerFonts(renderer: NativeRenderer) {
  if (registered.has(renderer)) return
  renderer.registerFont?.(readFileSync(interPath))
  renderer.registerFont?.(readFileSync(monoPath))
  registered.add(renderer)
}
