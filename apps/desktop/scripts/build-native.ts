import { Predicate, Schema } from "effect"
import assert from "node:assert/strict"
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, resolve } from "node:path"

const release = "2e31b47ff6432ceebe70e7fc7b0f51a76d7d30cf"

const backend = "f77e5cfe9dad04288566f00c66ecf3c58d6f84b3"

const root = resolve(import.meta.dir, "..")

const source = process.argv[2] ?? "/tmp/still-notes-gpuix-build"

const binaryOutput =
  process.argv[3] ?? resolve(root, "native/gpuix-native.node")

const scratch = resolve(root, "../../docs/tmp")

assert(
  isAbsolute(source) &&
    (source.startsWith("/tmp/") ||
      source.startsWith("/var/tmp/") ||
      source.startsWith(`${scratch}/`)),
  "Keep native source and build in temporary storage",
)

assert(isAbsolute(binaryOutput), "Use an absolute native output path")

const patch = resolve(root, "native/gpuix.patch")

const backendPatch = resolve(root, "native/gpui-close.patch")

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
    dirname(source),
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

const backendFile = "crates/gpui/src/window.rs"

const backendChanges = output([
  "git",
  "-C",
  "zed",
  "diff",
  "--name-only",
  "HEAD",
])

const backendHash = readFileSync(backendPatch, "utf8").match(
  /^index [\da-f]{40}\.\.([\da-f]{40}) /m,
)?.[1]

assert(backendHash, "GPUI patch has no complete source hash")

assert(
  backendChanges === "" || backendChanges === backendFile,
  "GPUI checkout contains unexpected source changes",
)

assert.equal(
  output(["git", "-C", "zed", "ls-files", "--others", "--exclude-standard"]),
  "",
  "GPUI checkout contains untracked source files",
)

if (backendChanges === "") {
  run(["git", "-C", "zed", "apply", "--check", backendPatch])
  run(["git", "-C", "zed", "apply", backendPatch])
}

assert.equal(
  output(["git", "-C", "zed", "diff", "--name-only", "HEAD"]),
  backendFile,
  "GPUI patch changes unexpected files",
)

assert.equal(
  output(["git", "-C", "zed", "ls-files", "--others", "--exclude-standard"]),
  "",
  "GPUI patch adds unexpected files",
)

assert.equal(
  output([
    "git",
    "-C",
    "zed",
    "hash-object",
    "--no-filters",
    "--",
    backendFile,
  ]),
  backendHash,
  "GPUI source differs from patch",
)

assert.equal(
  output(["git", "diff", "HEAD", "--", "packages/native/Cargo.lock"]),
  "",
  "Keep pinned Cargo.lock",
)

const sourcePaths = [
  ".",
  ":(exclude)zed",
  ":(exclude)packages/native/index.js",
  ":(exclude)packages/native/index.d.ts",
]

function sourceChanges() {
  return output(["git", "diff", "--name-only", "HEAD", "--", ...sourcePaths])
}

function untrackedSources() {
  return output([
    "git",
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...sourcePaths,
  ])
}

const patchFiles = readFileSync(patch, "utf8")
  .split(/^diff --git /m)
  .slice(1)
  .map(function readPatchFile(section) {
    const header = section.match(
      /^a\/(\S+) b\/\1\n(new file mode \d+\n)?index [\da-f]{40}\.\.([\da-f]{40})/,
    )

    assert(
      header?.[1] && header[3],
      "GPUix patch has an unsupported file header",
    )

    return { path: header[1], added: Boolean(header[2]), hash: header[3] }
  })

assert(patchFiles.length > 0, "GPUix patch is empty")

const check = Bun.spawnSync(["git", "apply", "--check", patch], {
  cwd: source,
  stdout: "pipe",
  stderr: "pipe",
})

if (check.exitCode === 0) {
  assert.equal(sourceChanges(), "", "GPUix checkout contains source changes")
  assert.equal(
    untrackedSources(),
    "",
    "GPUix checkout contains untracked files",
  )
  run(["git", "apply", patch])
} else {
  run(["git", "apply", "--reverse", "--check", patch])
}

assert.equal(
  sourceChanges(),
  patchFiles
    .filter((file) => !file.added)
    .map((file) => file.path)
    .sort()
    .join("\n"),
  "GPUix checkout has unexpected source changes",
)

assert.equal(
  untrackedSources(),
  patchFiles
    .filter((file) => file.added)
    .map((file) => file.path)
    .sort()
    .join("\n"),
  "GPUix checkout has unexpected untracked files",
)

for (const file of patchFiles) {
  assert.equal(
    output(["git", "hash-object", "--no-filters", "--", file.path]),
    file.hash,
    `GPUix source differs from patch: ${file.path}`,
  )
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

assert(
  declarations.includes("armCloseGuard(eventId: number): void") &&
    declarations.includes("closeWindow(): void"),
  "NAPI declarations lack the close guard",
)

assert.match(
  declarations,
  /registerFontsAsyncV1\([^\n]+\): Promise<number>/,
  "NAPI declarations lack asynchronous font batches",
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
  Schema.Struct({
    editorCommand: Schema.declare(Predicate.isFunction),
    armCloseGuard: Schema.declare(Predicate.isFunction),
    closeWindow: Schema.declare(Predicate.isFunction),
    registerFontsAsyncV1: Schema.declare(Predicate.isFunction),
  }),
)(prototype)

mkdirSync(dirname(binaryOutput), { recursive: true })

copyFileSync(binary, binaryOutput)

console.info(`Built ${binaryOutput} from GPUix ${release}`)

console.info(`Generated declarations: ${resolve(native, "index.d.ts")}`)
