import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const require = createRequire(import.meta.url)

const binding: unknown = require(
  fileURLToPath(new URL("../native/gpuix-native.node", import.meta.url)),
)

const addon = z.object({ GpuixRenderer: z.instanceof(Function) }).parse(binding)

const renderer: unknown = Reflect.construct(addon.GpuixRenderer, [])

const bridge = z
  .object({ editorCommand: z.instanceof(Function) })
  .parse(renderer)

// Do not call init. These checks must not create a window.
test("built addon rejects invalid host IDs before UI dispatch", function invalidId() {
  expect(function command() {
    bridge.editorCommand.call(renderer, -1, '{"type":"getState"}')
  }).toThrow("Invalid element id")
})

test("built addon parses the strict native command enum", function invalidWire() {
  expect(function command() {
    bridge.editorCommand.call(renderer, 1, '{"type":"setMode","mode":"wrong"}')
  }).toThrow("unknown variant")
})

test("built addon rejects unknown command fields", function unknownField() {
  expect(function command() {
    bridge.editorCommand.call(
      renderer,
      1,
      '{"type":"setMode","mode":"normal","extra":1}',
    )
  }).toThrow("unknown field")
})

test("built addon reaches the UI boundary without opening a window", function noWindow() {
  expect(function command() {
    bridge.editorCommand.call(renderer, 1, '{"type":"getState"}')
  }).toThrow("not initialized")
})
