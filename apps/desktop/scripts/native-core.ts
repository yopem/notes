import type { App } from "@gpuix/react/automation"

import assert from "node:assert/strict"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export async function verifyCoreWorkflow({
  app,
  dataDirectory,
  capture,
  steps,
}: {
  app: App
  dataDirectory: string
  capture: (name: string) => Promise<void>
  steps: string[]
}) {
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

  await capture("01-first-run.png")
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
  await capture("02-markdown-preview.png")
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
  await capture("03-dark.png")
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
}
