import { expect, test } from "bun:test"
import { Schema } from "effect"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)

const nativeAddonArgument = process.argv.find((argument) =>
  argument.startsWith("--native-addon="),
)

const binding: unknown = require(
  nativeAddonArgument?.slice("--native-addon=".length) ??
    fileURLToPath(new URL("../native/gpuix-native.node", import.meta.url)),
)

const addon = Schema.decodeUnknownSync(
  Schema.Struct({ GpuixRenderer: Schema.instanceOf(Function) }),
)(binding)

const renderer: unknown = Reflect.construct(addon.GpuixRenderer, [])

const bridge = Schema.decodeUnknownSync(
  Schema.Struct({
    getAutomationTree: Schema.instanceOf(Function),
    editorCommand: Schema.instanceOf(Function),
    armCloseGuard: Schema.instanceOf(Function),
    closeWindow: Schema.instanceOf(Function),
  }),
)(renderer)

test("built addon refuses tree readback before initialization", function uninitializedTree() {
  expect(function read() {
    bridge.getAutomationTree.call(renderer)
  }).toThrow("not initialized")
})

test("built addon refuses to arm or close before initialization", function uninitializedClose() {
  expect(function arm() {
    bridge.armCloseGuard.call(renderer, 1)
  }).toThrow("not initialized")
  expect(function close() {
    bridge.closeWindow.call(renderer)
  }).toThrow("not initialized")
})

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
