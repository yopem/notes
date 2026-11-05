import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { type App, connectStdio, launch } from "@gpuix/react/automation"

import { readEnvironment } from "@/utils/env"

import { captureScreenshot, sizeTestWindow } from "./capture"
import {
  verifyCompactRegression,
  verifyRegressions,
} from "./native-regressions"
import { verifySettings } from "./native-settings"

const artifacts = resolve("docs/artifacts")

mkdirSync(artifacts, { recursive: true })

const dataDirectory = mkdtempSync(join(tmpdir(), "still-notes-e2e-"))

const steps: string[] = []

let app: App | undefined

let appPid = 0

async function open(width = 1360, height = 900) {
  const environment = readEnvironment()
  const command = environment.binary ?? "bun"
  const args = environment.binary ? [] : ["src/main.tsx"]

  const env = {
    GPUIX_BACKGROUND: "1",
    STILL_NOTES_DATA_DIR: dataDirectory,
    STILL_NOTES_WIDTH: String(width),
    STILL_NOTES_HEIGHT: String(height),
  }

  if (process.platform !== "linux") {
    return await launch({ command, args, cwd: process.cwd(), env })
  }

  // env inherits the compositor session and then replaces itself with the app.
  const child = spawn(
    "env",
    [
      ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
      command,
      ...args,
    ],
    {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    },
  )

  const exited = new Promise<void>((resolveExit) =>
    child.once("close", () => resolveExit()),
  )

  let stderr = ""
  let stdout = ""

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-8192)
  })

  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) {
      await exited

      return
    }

    const forceKill = setTimeout(() => child.kill("SIGKILL"), 5000)

    try {
      child.kill()
      await exited
    } finally {
      clearTimeout(forceKill)
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined

  const failed = new Promise<never>((_resolve, reject) => {
    child.once("error", reject)
    child.stdin.on("error", reject)
    child.once("exit", (code, signal) =>
      reject(
        new Error(
          `Native app exited before automation connected (${code ?? signal}). ${stderr}`,
        ),
      ),
    )
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Native automation handshake timed out after 30000ms. Check GPUix startup and compositor access. stdout: ${stdout} stderr: ${stderr}`,
          ),
        ),
      30000,
    )
  })

  try {
    const connected = await Promise.race([
      connectStdio({
        write(chunk) {
          child.stdin.write(chunk)
        },
        feed(listener) {
          child.stdout.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8")
            stdout = (stdout + text).slice(-8192)
            listener(text)
          })
        },
        close: stop,
      }),
      failed,
    ])

    assert(child.pid, "Native app did not start.")
    appPid = child.pid

    return connected
  } catch (cause) {
    await stop()

    throw cause
  } finally {
    clearTimeout(timer)
  }
}

async function textIs(testId: string, expected: string) {
  assert(app)

  await app.getByTestId(testId).waitFor()

  const deadline = Date.now() + 5000
  let actual = await app.getByTestId(testId).textContent()

  while (actual !== expected && Date.now() < deadline) {
    await Bun.sleep(16)
    actual = await app.getByTestId(testId).textContent()
  }

  assert.equal(
    actual,
    expected,
    `${testId}: expected ${expected}, got ${actual}`,
  )
}

try {
  app = await open()
  await app.getByTestId("new-note").waitFor({ timeoutMs: 30000 })
  await sizeTestWindow(app, appPid, 1360, 900)
  await captureScreenshot(app, appPid, join(artifacts, "01-first-run.png"))
  steps.push("First-run native window and welcome note")

  await app.getByTestId("new-notebook").click()
  await app.getByTestId("dialog-input").waitFor()
  await app.getByTestId("dialog-input").fill("Field notes")
  await app.getByTestId("dialog-confirm").click()
  await textIs("note-count", "0 notes")
  assert((await app.getByText("Field notes").count()) > 0)
  await app.getByTestId("new-note").click()
  await app.getByTestId("note-title").waitFor()
  await app.getByTestId("note-title").fill("Native notebook check")
  await app
    .getByTestId("note-body")
    .fill(
      "# Native notebook check\n\nWritten in GPUix.\n\n- [ ] Keep thoughts local\n- [x] No Electron\n\n**Unicode:** café 日本語 🌿",
    )
  await textIs("save-status", "Saved locally")
  await app.getByTestId("preview-toggle").click()
  await app.getByTestId("markdown-preview").waitFor()
  await captureScreenshot(
    app,
    appPid,
    join(artifacts, "02-markdown-preview.png"),
  )
  steps.push(
    "Create notebook, create note, edit Unicode Markdown, save, preview",
  )

  await app.getByTestId("pin-note").click()
  await app.getByTestId("nav-pinned").click()
  await textIs("note-count", "1 note")
  await app.getByTestId("search").fill("NO ELECTRON")
  await textIs("note-count", "1 note")
  await app.getByTestId("search").fill("missing phrase")
  await textIs("note-count", "0 notes")
  await app.getByTestId("search").fill("")
  await textIs("note-count", "1 note")
  await app.getByTestId("trash-note").waitFor()
  await app.getByTestId("trash-note").click()
  await app.getByTestId("nav-trash").click()
  await textIs("note-count", "1 note")
  await app.getByTestId("note-row").click()
  await app.getByTestId("restore-note").click()
  await app.getByTestId("nav-all").click()
  await textIs("note-count", "2 notes")
  assert(
    (await app
      .getByTestId("note-row")
      .getByText("Native notebook check")
      .count()) > 0,
  )
  steps.push(
    "Pin, scoped case-insensitive full-text search, no-results, trash, restore",
  )

  await app.getByTestId("theme-toggle").click()
  await captureScreenshot(app, appPid, join(artifacts, "03-dark.png"))
  await app.getByTestId("help").click()
  await app.getByTestId("dialog-close").waitFor()
  await app.getByTestId("dialog-close").press("escape")

  const dialogDeadline = Date.now() + 5000

  while (
    (await app.getByTestId("dialog-close").count()) &&
    Date.now() < dialogDeadline
  ) {
    await Bun.sleep(16)
  }

  assert.equal(await app.getByTestId("dialog-close").count(), 0)
  await app
    .getByTestId("search")
    .press(process.platform === "darwin" ? "cmd-n" : "ctrl-n")
  await app.getByTestId("note-title").fill("Shortcut note")
  await app.getByTestId("note-body").fill("Created with keyboard shortcut.")
  steps.push(
    "Theme switch, accessible dialog Escape, new-note keyboard shortcut",
  )

  const importedPath = join(dataDirectory, "from-disk.md")
  writeFileSync(importedPath, "# Imported from disk\n\nPortable plain text.\n")
  await app.getByTestId("import").click()
  await app.getByTestId("dialog-input").waitFor()
  await app.getByTestId("dialog-input").fill(importedPath)
  await app.getByTestId("dialog-confirm").click()
  await textIs("notice", "Markdown imported. Original file unchanged.")
  await app.getByTestId("export").waitFor()
  await app.getByTestId("export").click()
  await app.getByTestId("dialog-input").waitFor()
  await app.getByTestId("dialog-input").fill(dataDirectory)
  await app.getByTestId("dialog-confirm").click()

  const exportDeadline = Date.now() + 5000

  let exported = readdirSync(dataDirectory).filter(
    (name) => name.endsWith(".md") && name !== "from-disk.md",
  )

  while (exported.length === 0 && Date.now() < exportDeadline) {
    await Bun.sleep(16)
    exported = readdirSync(dataDirectory).filter(
      (name) => name.endsWith(".md") && name !== "from-disk.md",
    )
  }

  assert.equal(
    exported.length,
    1,
    "Export must create a new Markdown file without replacing the import.",
  )

  const exportedName = exported[0]

  assert(exportedName)
  assert.equal(
    readFileSync(join(dataDirectory, exportedName), "utf8"),
    readFileSync(importedPath, "utf8"),
  )
  await textIs("notice", `Exported to ${join(dataDirectory, exportedName)}`)
  steps.push("Import Markdown from real disk, export without overwrite")
  steps.push(...(await verifySettings(app, dataDirectory)))
  steps.push(...(await verifyRegressions(app, dataDirectory)))

  await app.close()
  app = await open(1000, 760)
  await app.getByTestId("new-note").waitFor({ timeoutMs: 30000 })
  await sizeTestWindow(app, appPid, 1000, 760)
  await app.getByTestId("search").fill("Native notebook check")
  await textIs("note-count", "1 note")
  await app.getByTestId("note-row").click()
  await app.getByTestId("preview-toggle").click()
  await app.getByTestId("markdown-preview").waitFor()
  await captureScreenshot(
    app,
    appPid,
    join(artifacts, "04-restart-compact.png"),
  )
  assert(
    readFileSync(join(dataDirectory, "workspace.json"), "utf8").includes(
      "Native notebook check",
    ),
  )
  steps.push(
    "Restart real process, restore persisted content, compact window layout",
  )
  await app.getByTestId("search").fill("")
  await sizeTestWindow(app, appPid, 700, 760)
  steps.push(...(await verifyCompactRegression(app, dataDirectory)))
  await captureScreenshot(app, appPid, join(artifacts, "05-compact-empty.png"))
  await app.close()
  app = undefined

  writeFileSync(
    join(artifacts, "native-e2e.json"),
    JSON.stringify(
      {
        result: "passed",
        runtime: "GPUix native live-window automation",
        dataDirectory,
        steps,
      },
      null,
      2,
    ),
  )
  console.info(
    `Native E2E passed: ${steps.length} workflows. Artifacts: ${artifacts}`,
  )
} catch (error) {
  if (app) {
    try {
      writeFileSync(
        join(artifacts, "native-failure-tree.json"),
        JSON.stringify(await app.call("getTree", {}), null, 2),
      )
      await captureScreenshot(
        app,
        appPid,
        join(artifacts, "native-failure.png"),
      )
    } catch (captureError) {
      console.warn("Could not save failure evidence", captureError)
    }
  }

  writeFileSync(
    join(artifacts, "native-e2e.json"),
    JSON.stringify(
      {
        result: "failed",
        dataDirectory,
        steps,
        error: String(error),
        cause: error instanceof Error ? String(error.cause) : undefined,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await app?.close()
}
