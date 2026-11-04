import type { App } from "@gpuix/react/automation"

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

const savedPreferencesSchema = z.object({
  preferences: z.object({
    editorFontSize: z.number(),
    wordWrap: z.boolean(),
    themeMode: z.string(),
  }),
})

async function savedEditorPreferences(
  dataDirectory: string,
  fontSize: number,
  wordWrap: boolean,
) {
  const deadline = Date.now() + 5000
  let saved = savedPreferencesSchema.parse(
    JSON.parse(readFileSync(join(dataDirectory, "settings.json"), "utf8")),
  )
  while (
    (saved.preferences.editorFontSize !== fontSize ||
      saved.preferences.wordWrap !== wordWrap) &&
    Date.now() < deadline
  ) {
    await Bun.sleep(16)
    saved = savedPreferencesSchema.parse(
      JSON.parse(readFileSync(join(dataDirectory, "settings.json"), "utf8")),
    )
  }
  assert.equal(saved.preferences.editorFontSize, fontSize)
  assert.equal(saved.preferences.wordWrap, wordWrap)
  return saved
}

export async function verifySettings(app: App, dataDirectory: string) {
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-panel").waitFor()
  await app.getByTestId("settings-tab-editor").click()
  await app.getByTestId("setting-editorFontSize").fill("22")
  await app.getByTestId("setting-save-editorFontSize").click()
  await app.getByTestId("setting-wordWrap").click()

  let saved = await savedEditorPreferences(dataDirectory, 22, false)

  assert.equal(saved.preferences.editorFontSize, 22)
  assert.equal(saved.preferences.wordWrap, false)
  await app.getByTestId("setting-wordWrap").click()
  await app.getByTestId("setting-editorFontSize").fill("-1")
  await app.getByTestId("setting-save-editorFontSize").click()
  await app.getByTestId("settings-error").waitFor()
  saved = await savedEditorPreferences(dataDirectory, 22, true)
  assert.equal(saved.preferences.editorFontSize, 22)
  assert.equal(saved.preferences.wordWrap, true)
  await app.getByTestId("setting-editorFontSize").fill("18")
  await app.getByTestId("setting-save-editorFontSize").click()
  await app.getByTestId("settings-tab-appearance").click()
  await app.getByTestId("setting-themeMode-dark").click()
  await app.getByTestId("settings-close").press("escape")
  const closedDeadline = Date.now() + 5000
  while (
    (await app.getByTestId("settings-panel").count()) &&
    Date.now() < closedDeadline
  )
    await Bun.sleep(16)
  assert.equal(await app.getByTestId("settings-panel").count(), 0)
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-tab-editor").click()
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
  await app.getByTestId("settings-close").click()

  return [
    "Native settings edit, validation, immediate disk persistence, theme and reopen",
  ]
}
