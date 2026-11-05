import type { App } from "@gpuix/react/automation"

import { Schema } from "effect"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { settingsFileSchema } from "@/features/settings/store"

async function savedEditorPreferences(
  dataDirectory: string,
  fontSize: number,
  wordWrap: boolean,
) {
  const deadline = Date.now() + 5000

  let saved = Schema.decodeUnknownSync(settingsFileSchema, {
    onExcessProperty: "error",
  })(JSON.parse(readFileSync(join(dataDirectory, "settings.json"), "utf8")))

  while (
    (saved.preferences.editorFontSize !== fontSize ||
      saved.preferences.wordWrap !== wordWrap) &&
    Date.now() < deadline
  ) {
    await Bun.sleep(16)
    saved = Schema.decodeUnknownSync(settingsFileSchema, {
      onExcessProperty: "error",
    })(JSON.parse(readFileSync(join(dataDirectory, "settings.json"), "utf8")))
  }

  assert.equal(saved.preferences.editorFontSize, fontSize)
  assert.equal(saved.preferences.wordWrap, wordWrap)

  return saved
}

// Native trees can update before the next frame paints control bounds.
async function settledControl(app: App, testId: string) {
  const control = app.getByTestId(testId)
  await control.waitFor()
  let bounds = await control.bounds()
  let stableFrames = 0
  const deadline = Date.now() + 5000

  while (stableFrames < 2 && Date.now() < deadline) {
    await Bun.sleep(16)
    const next = await control.bounds()
    stableFrames =
      JSON.stringify(bounds) === JSON.stringify(next) ? stableFrames + 1 : 0
    bounds = next
  }

  assert.equal(stableFrames, 2, `Control did not settle: ${testId}`)

  return control
}

export async function verifySettings(app: App, dataDirectory: string) {
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-panel").waitFor()
  console.info("Settings: font and wrap")
  await app.getByTestId("settings-tab-editor").click()
  await app.getByTestId("setting-editorFontSize").fill("22")
  await app.getByTestId("setting-save-editorFontSize").click()
  await app.getByTestId("setting-wordWrap").click()

  let saved = await savedEditorPreferences(dataDirectory, 22, false)

  assert.equal(saved.preferences.editorFontSize, 22)
  assert.equal(saved.preferences.wordWrap, false)
  await app.getByTestId("setting-wordWrap").click()
  console.info("Settings: invalid font")
  await app.getByTestId("setting-editorFontSize").fill("-1")
  await app.getByTestId("setting-save-editorFontSize").click()
  await app.getByTestId("settings-error").waitFor()
  saved = await savedEditorPreferences(dataDirectory, 22, true)
  assert.equal(saved.preferences.editorFontSize, 22)
  assert.equal(saved.preferences.wordWrap, true)
  await app.getByTestId("setting-editorFontSize").fill("18")
  await app.getByTestId("setting-save-editorFontSize").click()
  await savedEditorPreferences(dataDirectory, 18, true)
  const errorDeadline = Date.now() + 5000

  while (
    (await app.getByTestId("settings-error").count()) &&
    Date.now() < errorDeadline
  )
    await Bun.sleep(16)
  assert.equal(await app.getByTestId("settings-error").count(), 0)
  console.info("Settings: appearance")
  await (await settledControl(app, "settings-tab-appearance")).click()
  await app.getByTestId("setting-themeMode-dark").waitFor()
  await app.getByTestId("setting-themeMode-dark").click()
  console.info("Settings: Escape and reopen")
  await app.getByTestId("settings-close").press("escape")
  const closedDeadline = Date.now() + 5000

  while (
    (await app.getByTestId("settings-panel").count()) &&
    Date.now() < closedDeadline
  )
    await Bun.sleep(16)
  assert.equal(await app.getByTestId("settings-panel").count(), 0)
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-panel").waitFor()
  await app.getByTestId("settings-tab-editor").click()
  await app.getByTestId("setting-current-editorFontSize").waitFor()
  const deadline = Date.now() + 5000

  while (
    (await app.getByTestId("setting-current-editorFontSize").textContent()) !==
      "18" &&
    Date.now() < deadline
  )
    await Bun.sleep(16)
  assert.equal(
    await app.getByTestId("setting-current-editorFontSize").textContent(),
    "18",
  )
  console.info("Settings: final close")
  await app.getByTestId("settings-close").click()
  const finalDeadline = Date.now() + 5000

  while (
    (await app.getByTestId("settings-panel").count()) &&
    Date.now() < finalDeadline
  )
    await Bun.sleep(16)
  assert.equal(await app.getByTestId("settings-panel").count(), 0)

  return [
    "Native settings edit, validation, immediate disk persistence, theme and reopen",
  ]
}
