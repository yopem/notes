import assert from "node:assert/strict"
import { copyFileSync, mkdirSync } from "node:fs"
import { basename, resolve } from "node:path"

import { requireDesktopNativeBinding } from "./native-binding"

const root = resolve(import.meta.dir, "..")

let abi = ""

if (process.platform === "linux") abi = "-gnu"

if (process.platform === "win32") abi = "-msvc"

const nativePackage = `@gpuix/native-${process.platform}-${process.arch}${abi}`

const nativeModule = Bun.resolveSync("@gpuix/native", root)

const platformBinding = Bun.resolveSync(nativePackage, nativeModule)

const bindingDirectory = resolve(root, "dist/native")

const nativeBinding = resolve(bindingDirectory, basename(platformBinding))

mkdirSync(bindingDirectory, { recursive: true })

copyFileSync(requireDesktopNativeBinding(), nativeBinding)

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
