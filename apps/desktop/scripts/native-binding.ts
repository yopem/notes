import { Predicate, Schema } from "effect"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"

const addonSchema = Schema.Struct({ GpuixRenderer: Schema.Unknown })

const bridgeSchema = Schema.Struct({
  editorCommand: Schema.declare(Predicate.isFunction),
  armCloseGuard: Schema.declare(Predicate.isFunction),
  closeWindow: Schema.declare(Predicate.isFunction),
  registerFontsAsyncV1: Schema.declare(Predicate.isFunction),
})

const loadNative = createRequire(import.meta.url)

export function requireDesktopNativeBinding() {
  const path = resolve(import.meta.dir, "../native/gpuix-native.node")

  assert(existsSync(path), "Build the native host with bun run build:native")

  try {
    const exports: unknown = loadNative(path)
    const addon = Schema.decodeUnknownSync(addonSchema)(exports)
    const renderer = addon.GpuixRenderer

    assert(Predicate.hasProperty(renderer, "prototype"))
    Schema.decodeUnknownSync(bridgeSchema)(renderer.prototype)
  } catch (cause) {
    throw new Error(
      "The native host is incompatible. Run bun run build:native before launch or build.",
      { cause },
    )
  }

  return path
}

if (import.meta.main) requireDesktopNativeBinding()
