import assert from "node:assert/strict"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")

let abi = ""

if (process.platform === "linux") abi = "-gnu"

if (process.platform === "win32") abi = "-msvc"

const nativePackage = `@gpuix/native-${process.platform}-${process.arch}${abi}`

const nativeModule = Bun.resolveSync("@gpuix/native", root)

const nativeBinding = Bun.resolveSync(nativePackage, nativeModule)

// GPUix uses createRequire, so Bun needs the native file as an explicit asset.
const result = Bun.spawnSync({
  cmd: [
    process.execPath,
    "build",
    "--compile",
    "src/app.tsx",
    `--asset=${nativeBinding}`,
    "--asset-naming=[name].[ext]",
    "--outfile",
    process.platform === "win32" ? "dist/still-notes.exe" : "dist/still-notes",
  ],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})

assert.equal(result.exitCode, 0, "Standalone build failed")
