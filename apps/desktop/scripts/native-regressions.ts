import type { App } from "@gpuix/react/automation"

import { Schema } from "effect"
import assert from "node:assert/strict"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { settingsFileSchema } from "@/features/settings/store"

const regressionWorkspaceSchema = Schema.Struct({
  notes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      body: Schema.String,
    }),
  ),
})

async function textIs(app: App, testId: string, expected: string) {
  const locator = app.getByTestId(testId)
  await locator.waitFor()
  const deadline = Date.now() + 5000
  let actual = await locator.textContent()

  while (actual !== expected && Date.now() < deadline) {
    await Bun.sleep(16)
    actual = await locator.textContent()
  }

  assert.equal(actual, expected, testId)
}

async function absent(app: App, testId: string) {
  const deadline = Date.now() + 5000

  while ((await app.getByTestId(testId).count()) && Date.now() < deadline)
    await Bun.sleep(16)
  assert.equal(await app.getByTestId(testId).count(), 0, testId)
}

async function savedNoteIs(dataDirectory: string, title: string, body: string) {
  const path = join(dataDirectory, "workspace.json")
  const deadline = Date.now() + 5000

  let workspace = Schema.decodeUnknownSync(regressionWorkspaceSchema)(
    JSON.parse(readFileSync(path, "utf8")),
  )

  while (
    workspace.notes.find((note) => note.title === title)?.body !== body &&
    Date.now() < deadline
  ) {
    await Bun.sleep(16)
    workspace = Schema.decodeUnknownSync(regressionWorkspaceSchema)(
      JSON.parse(readFileSync(path, "utf8")),
    )
  }

  assert.equal(workspace.notes.find((note) => note.title === title)?.body, body)

  return workspace
}

async function createNote(
  app: App,
  dataDirectory: string,
  title: string,
  body: string,
) {
  await app.getByTestId("new-note").click()
  await app.getByTestId("note-title").waitFor()
  await app.getByTestId("note-title").fill(title)
  await app.getByTestId("note-body").fill(body)
  await savedNoteIs(dataDirectory, title, body)
  await textIs(app, "save-status", "Saved locally")
}

function saveReport(name: string, dataDirectory: string, steps: string[]) {
  const artifacts = resolve(import.meta.dir, "../../../docs/artifacts")
  mkdirSync(artifacts, { recursive: true })
  const path = join(artifacts, name)
  const report = { result: "passed", dataDirectory, steps }
  writeFileSync(path, JSON.stringify(report, null, 2))
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), report)
}

export async function verifyRegressions(app: App, dataDirectory: string) {
  assert(
    resolve(dataDirectory).startsWith(join(tmpdir(), "still-notes-e2e-")),
    "Regression checks require a disposable native E2E data directory.",
  )
  assert((await app.getByTestId("app").bounds()).width >= 1120)
  const steps: string[] = []
  const workspacePath = join(dataDirectory, "workspace.json")

  await app.getByTestId("nav-all").click()
  await app.getByTestId("new-notebook").click()
  await app.getByTestId("dialog-input").waitFor()
  await app.getByTestId("dialog-input").fill("Regression selection")
  await app.getByTestId("dialog-confirm").click()
  await textIs(app, "note-count", "0 notes")
  await createNote(
    app,
    dataDirectory,
    "Regression oldest",
    "selection-token oldest",
  )
  await Bun.sleep(20)
  await createNote(
    app,
    dataDirectory,
    "Regression second",
    "selection-token second",
  )
  await Bun.sleep(20)
  await createNote(app, dataDirectory, "Regression outside", "Outside filter")
  await app.getByTestId("search").fill("selection-token")
  await textIs(app, "note-count", "2 notes")
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-tab-navigation").click()
  await app.getByTestId("setting-noteSortOrder-updated-desc").click()
  await app.getByTestId("settings-close").click()
  await app.getByTestId("note-sort").click()
  await app.getByText("Updated: oldest first").waitFor()
  const oldestEditor = await app.getByTestId("note-body").element()
  await app.getByTestId("note-body").fill("selection-token edited oldest")
  assert.equal(
    (await app.getByTestId("note-body").element()).id,
    oldestEditor.id,
  )

  const saved = await savedNoteIs(
    dataDirectory,
    "Regression oldest",
    "selection-token edited oldest",
  )

  assert.equal(
    saved.notes.find((note) => note.title === "Regression oldest")?.body,
    "selection-token edited oldest",
  )
  steps.push(
    "Oldest-order fallback stays active after its sort position changes",
  )

  await app.getByTestId("note-body").fill("No filter phrase remains")
  await textIs(app, "note-count", "1 note")
  assert.equal(
    (await app.getByTestId("note-body").element()).id,
    oldestEditor.id,
  )
  await app.getByTestId("note-body").fill("Continue editing outside search")
  assert.equal(
    (await app.getByTestId("note-body").element()).id,
    oldestEditor.id,
  )

  const edited = await savedNoteIs(
    dataDirectory,
    "Regression oldest",
    "Continue editing outside search",
  )

  assert.equal(
    edited.notes.find((note) => note.title === "Regression oldest")?.body,
    "Continue editing outside search",
  )
  assert.equal(
    edited.notes.find((note) => note.title === "Regression second")?.body,
    "selection-token second",
  )
  await app.getByTestId("search").fill("Regression second")
  await textIs(app, "note-count", "1 note")
  assert.notEqual(
    (await app.getByTestId("note-body").element()).id,
    oldestEditor.id,
  )
  await app.getByTestId("search").fill("no-regression-note-matches")
  await textIs(app, "note-count", "0 notes")
  await absent(app, "note-title")
  await app.getByTestId("search").fill("")
  await app.getByTestId("note-sort").click()
  steps.push(
    "Search edits keep editor identity; explicit search navigation and empty results update it",
  )

  await app.getByTestId("note-row").getByText("Regression outside").click()
  await app.getByTestId("trash-note").click()
  await textIs(app, "note-count", "2 notes")
  await app.getByTestId("note-body").fill("Next visible note after trash")

  const afterTrash = await savedNoteIs(
    dataDirectory,
    "Regression second",
    "Next visible note after trash",
  )

  assert.equal(
    afterTrash.notes.find((note) => note.title === "Regression second")?.body,
    "Next visible note after trash",
  )
  await app.getByTestId("nav-trash").click()
  await app.getByTestId("note-row").click()
  await app.getByTestId("restore-note").click()
  steps.push("Trash selects the next visible note, not the first sorted note")

  await createNote(app, dataDirectory, "Regression rescue", "Saved rescue body")
  const original = readFileSync(workspacePath, "utf8")
  const conflict = original + "\n"
  const draftTitle = "Regression unsaved rescue"

  const draftBody =
    "# Exact unsaved draft\n\nUnicode: café 日本語 🌿\nNo final newline"

  const exportDirectory = join(dataDirectory, "draft-rescue")

  try {
    writeFileSync(workspacePath, conflict)
    await app.getByTestId("note-title").fill(draftTitle)
    await app.getByTestId("note-body").fill(draftBody)
    await app.getByTestId("pending-drafts").waitFor()
    const draftEditor = await app.getByTestId("note-body").element()
    await app.getByTestId("note-sort").click()
    assert.equal(
      (await app.getByTestId("note-body").element()).id,
      draftEditor.id,
    )
    await app.getByTestId("pending-drafts").waitFor()
    await app.getByTestId("search").fill("Regression second")
    await app.getByTestId("note-row").click()
    await textIs(app, "save-status", "Not saved · Retry before closing")
    await app.getByTestId("search").fill("Regression rescue")
    await app.getByTestId("note-row").click()
    await app.getByTestId("pending-drafts").waitFor()
    await app.getByTestId("retry-save").waitFor()
    await textIs(app, "save-status", "Not saved · Retry before closing")
    assert.equal(
      await app.getByText("Cannot save").count(),
      0,
      "Successful selection clears command error, not draft warning",
    )
    assert.equal(readFileSync(workspacePath, "utf8"), conflict)
    await app.getByTestId("export").click()
    await app.getByTestId("dialog-input").waitFor()
    await app.getByTestId("dialog-input").fill(exportDirectory)
    await app.getByTestId("dialog-confirm").click()
    await absent(app, "dialog-confirm")
    assert.deepEqual(readdirSync(exportDirectory), [`${draftTitle}.md`])
    assert.equal(
      readFileSync(join(exportDirectory, `${draftTitle}.md`), "utf8"),
      draftBody,
    )
    assert.equal(
      readFileSync(workspacePath, "utf8"),
      conflict,
      "Export must not save the workspace",
    )
    await app.getByTestId("pending-drafts").waitFor()
    await textIs(app, "save-status", "Not saved · Retry before closing")
    steps.push(
      "Draft warning and retry survive navigation; export rescues exact title/body without a workspace write or draft clear",
    )

    await app.getByTestId("move-note").click()
    await app
      .getByTestId("move-notebook")
      .getByText("Regression selection")
      .click()
    await app.getByTestId("dialog-error").waitFor()
    assert.match(
      await app.getByTestId("dialog-error").textContent(),
      /Workspace changed outside this instance/,
    )
    await app.getByTestId("dialog-close").press("escape")
    await absent(app, "dialog-close")
    assert.equal(readFileSync(workspacePath, "utf8"), conflict)
    steps.push(
      "Move save failure stays in dialog; Escape closes it without a write",
    )
  } finally {
    writeFileSync(workspacePath, original)
  }

  await app.getByTestId("retry-save").click()
  await absent(app, "pending-drafts")
  await textIs(app, "save-status", "Saved locally")

  const retried = Schema.decodeUnknownSync(regressionWorkspaceSchema)(
    JSON.parse(readFileSync(workspacePath, "utf8")),
  )

  assert.equal(
    retried.notes.find((note) => note.title === draftTitle)?.body,
    draftBody,
  )
  await app.getByTestId("search").fill("")
  await app.getByTestId("nav-all").click()
  await createNote(app, dataDirectory, "Sort note 10", "Sort order regression")
  await createNote(app, dataDirectory, "Sort note 2", "Sort order regression")
  await createNote(
    app,
    dataDirectory,
    "Sort note pinned",
    "Sort order regression",
  )
  await app.getByTestId("pin-note").click()
  await app.getByTestId("search").fill("Sort order regression")
  await textIs(app, "note-count", "3 notes")
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-tab-navigation").click()
  await app.getByTestId("setting-noteSortOrder-none").click()
  await app.getByTestId("settings-close").click()

  const [workspacePinned, workspaceTen, workspaceTwo] = await Promise.all([
    app.getByText("Sort note pinned").bounds(),
    app.getByText("Sort note 10").bounds(),
    app.getByText("Sort note 2").bounds(),
  ])

  assert(
    workspacePinned.y < workspaceTen.y && workspaceTen.y < workspaceTwo.y,
    "Workspace order follows creation order within the pin group",
  )
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-tab-navigation").click()
  await app.getByTestId("setting-noteSortOrder-name-asc").click()
  await textIs(app, "setting-current-noteSortOrder", "name-asc")
  await app.getByTestId("settings-close").click()

  const [pinned, two, ten] = await Promise.all([
    app.getByText("Sort note pinned").bounds(),
    app.getByText("Sort note 2").bounds(),
    app.getByText("Sort note 10").bounds(),
  ])

  assert(pinned.y < two.y && two.y < ten.y, "Pinned and natural name order")
  await app.getByTestId("note-row").getByText("Sort note 2").click()
  const sortedEditor = await app.getByTestId("note-body").element()
  await app.getByTestId("note-title").fill("Sort note 20")
  await savedNoteIs(dataDirectory, "Sort note 20", "Sort order regression")
  assert.equal(
    (await app.getByTestId("note-body").element()).id,
    sortedEditor.id,
  )
  assert(
    (await app.getByText("Sort note 20").bounds()).y <
      (await app.getByText("Sort note 10").bounds()).y,
    "Editing keeps the current list order",
  )
  await app.getByTestId("note-row").getByText("Sort note 10").click()
  assert(
    (await app.getByText("Sort note 10").bounds()).y <
      (await app.getByText("Sort note 20").bounds()).y,
    "Leaving the edited note applies the current name order",
  )
  await app.getByTestId("note-row").getByText("Sort note 20").click()
  await app.getByTestId("note-sort").click()
  assert(
    (await app.getByText("Sort note 20").bounds()).y <
      (await app.getByText("Sort note 10").bounds()).y,
    "Reversing name sort uses the committed preference",
  )
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-tab-navigation").click()
  await textIs(app, "setting-current-noteSortOrder", "name-desc")
  const settingsPath = join(dataDirectory, "settings.json")
  const settingsBytes = readFileSync(settingsPath, "utf8")

  try {
    writeFileSync(settingsPath, settingsBytes + "\n")
    await app.getByTestId("setting-noteSortOrder-name-asc").click()
    await app.getByTestId("settings-error").waitFor()
    await textIs(app, "setting-current-noteSortOrder", "name-desc")
    assert.equal(readFileSync(settingsPath, "utf8"), settingsBytes + "\n")
  } finally {
    writeFileSync(settingsPath, settingsBytes)
  }

  await app.getByTestId("settings-close").click()
  assert(
    (await app.getByText("Sort note 20").bounds()).y <
      (await app.getByText("Sort note 10").bounds()).y,
    "Failed preference save preserves the displayed order",
  )
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-tab-navigation").click()
  await app.getByTestId("setting-noteSortOrder-name-asc").click()
  await textIs(app, "setting-current-noteSortOrder", "name-asc")

  const savedSettings = Schema.decodeUnknownSync(settingsFileSchema)(
    JSON.parse(readFileSync(settingsPath, "utf8")),
  )

  assert.equal(savedSettings.preferences.noteSortOrder, "name-asc")
  await app.getByTestId("settings-close").click()
  await app.getByTestId("search").fill("")
  await app.getByTestId("new-notebook").click()
  await app.getByTestId("dialog-input").waitFor()
  await app.getByTestId("dialog-input").fill("Fallback sort regression")
  await app.getByTestId("dialog-confirm").click()
  await textIs(app, "note-count", "0 notes")

  await createNote(app, dataDirectory, "Apple fallback", "Apple fallback body")
  await createNote(
    app,
    dataDirectory,
    "Apricot fallback",
    "Apricot fallback body",
  )
  await createNote(
    app,
    dataDirectory,
    "Banana fallback",
    "Banana fallback body",
  )
  await app.getByTestId("search").fill("Ap")
  await textIs(app, "note-count", "2 notes")
  const fallbackEditor = await app.getByTestId("note-body").element()
  await app.getByTestId("note-sort").click()
  assert.equal(
    (await app.getByTestId("note-body").element()).id,
    fallbackEditor.id,
  )
  await app.getByTestId("note-body").fill("Apple fallback after sort")
  const fallbackSaved = await savedNoteIs(
    dataDirectory,
    "Apple fallback",
    "Apple fallback after sort",
  )
  assert.equal(
    fallbackSaved.notes.find((note) => note.title === "Apricot fallback")?.body,
    "Apricot fallback body",
  )
  steps.push(
    "Search fallback stays selected when sort reverses and edits reach the same note",
    "Natural sort, pinned order, edit-leave order, settings conflict and persistence",
  )
  saveReport("native-regressions.json", dataDirectory, steps)

  return steps
}

export async function verifyCompactRegression(app: App, dataDirectory: string) {
  assert(
    resolve(dataDirectory).startsWith(join(tmpdir(), "still-notes-e2e-")),
    "Regression checks require a disposable native E2E data directory.",
  )
  assert((await app.getByTestId("app").bounds()).width < 780)
  await app.getByTestId("settings-open").click()
  await app.getByTestId("settings-tab-navigation").click()
  await textIs(app, "setting-current-noteSortOrder", "name-asc")
  await app.getByTestId("settings-close").click()
  await app.getByTestId("new-note").waitFor()
  await createNote(
    app,
    dataDirectory,
    "Regression compact delete",
    "Final trash note",
  )
  await app.getByTestId("trash-note").click()
  await app.getByTestId("new-note").waitFor()

  if (!(await app.getByTestId("nav-trash").count())) {
    await app.getByTestId("show-notebooks").click()
    await app.getByTestId("nav-trash").waitFor()
  }

  await app.getByTestId("nav-trash").click()
  await textIs(app, "note-count", "1 note")
  await app.getByTestId("note-row").click()
  await app.getByText("Delete forever").click()
  await app.getByTestId("dialog-confirm").waitFor()
  await app.getByTestId("dialog-confirm").click()
  await textIs(app, "note-count", "0 notes")
  await app.getByText("Trash is empty").waitFor()
  await absent(app, "note-title")
  const steps = ["Compact final trash deletion returns to the empty note list"]
  saveReport("native-regressions-compact.json", dataDirectory, steps)

  return steps
}
