import { Predicate, Schema } from "effect"
import assert from "node:assert/strict"
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { isAbsolute, resolve } from "node:path"

const release = "2e31b47ff6432ceebe70e7fc7b0f51a76d7d30cf"

const backend = "f77e5cfe9dad04288566f00c66ecf3c58d6f84b3"

const root = resolve(import.meta.dir, "..")

const source = process.argv[2] ?? "/tmp/still-notes-gpuix-build"

assert(
  isAbsolute(source) && source.startsWith("/tmp/"),
  "Keep native source and build in /tmp",
)

const patch = resolve(root, "native/gpuix.patch")

function run(command: string[], cwd = source) {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  })

  assert.equal(result.exitCode, 0, `Command failed: ${command.join(" ")}`)
}

function output(command: string[], cwd = source) {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
  })

  assert.equal(result.exitCode, 0, `Command failed: ${command.join(" ")}`)

  return result.stdout.toString().trim()
}

if (!existsSync(source)) {
  run(
    [
      "git",
      "clone",
      "--no-checkout",
      "https://github.com/remorses/gpuix.git",
      source,
    ],
    "/tmp",
  )
  run(["git", "checkout", "--detach", release])
}

assert.equal(
  output(["git", "rev-parse", "HEAD"]),
  release,
  "GPUix source revision differs",
)

run(["git", "submodule", "update", "--init", "zed"])

assert.equal(
  output(["git", "-C", "zed", "rev-parse", "HEAD"]),
  backend,
  "GPUI backend revision differs",
)

assert.equal(
  output(["git", "diff", "HEAD", "--", "packages/native/Cargo.lock"]),
  "",
  "Keep pinned Cargo.lock",
)

const check = Bun.spawnSync(["git", "apply", "--check", patch], {
  cwd: source,
  stdout: "pipe",
  stderr: "pipe",
})

if (check.exitCode === 0) {
  run(["git", "apply", patch])
} else {
  run(["git", "apply", "--reverse", "--check", patch])
}

const native = resolve(source, "packages/native")

run(
  [
    process.execPath,
    "x",
    "@napi-rs/cli@3.10.4",
    "build",
    "--platform",
    "--esm",
    "--js",
    "index.js",
    "--release",
    "--no-default-features",
    "--",
    "--locked",
    "-j",
    "2",
  ],
  native,
)

const declarations = readFileSync(resolve(native, "index.d.ts"), "utf8")

assert(
  declarations.includes(
    "editorCommand(elementId: number, commandJson: string): string",
  ),
  "NAPI declarations lack editorCommand",
)

let target: string

if (process.platform === "linux") target = `linux-${process.arch}-gnu`
else if (process.platform === "darwin") target = `darwin-${process.arch}`
else if (process.platform === "win32") target = `win32-${process.arch}-msvc`
else throw new Error(`Unsupported native target: ${process.platform}`)

const binary = resolve(native, `gpuix-native.${target}.node`)

const require = createRequire(import.meta.url)

const binding: unknown = require(binary)

const addon = Schema.decodeUnknownSync(
  Schema.Struct({ GpuixRenderer: Schema.declare(Predicate.isFunction) }),
)(binding)

const prototype: unknown = addon.GpuixRenderer.prototype

Schema.decodeUnknownSync(
  Schema.Struct({ editorCommand: Schema.declare(Predicate.isFunction) }),
)(prototype)

mkdirSync(resolve(root, "native"), { recursive: true })

copyFileSync(binary, resolve(root, "native/gpuix-native.node"))

console.info(`Built native/gpuix-native.node from GPUix ${release}`)

console.info(`Generated declarations: ${resolve(native, "index.d.ts")}`)
