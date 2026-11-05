import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { App } from "@gpuix/react/automation"
import { z } from "zod"

const workspaceSchema = z.object({
  notes: z.array(z.object({ title: z.string(), body: z.string() })),
})

const title = "Native rich document"
const body = [
  "---",
  "tags: [native, preview]",
  "---",
  "",
  "# Rich native preview",
  "",
  "Text with **bold**, *emphasis*, ~~strike~~ and `inline code`.",
  "",
  "- [ ] Preview task",
  "- [x] Completed task",
  "",
  "| Column | Value |",
  "| :--- | ---: |",
  "| Native | 42 |",
  "",
  "> [!NOTE]- Foldable card",
  "> Folded message unique-1523",
  "",
  "```ts",
  "const answer = 42",
  "```",
  "",
  "A footnote[^native].",
  "",
  "[^native]: Native footnote text.",
  "",
  "[[Related note|Native wiki link]]",
  "",
].join("\n")

async function savedBody(dataDirectory: string, expected: string) {
  const deadline = Date.now() + 5000
  let actual = ""
  while (Date.now() < deadline) {
    actual =
      workspaceSchema
        .parse(
          JSON.parse(
            readFileSync(join(dataDirectory, "workspace.json"), "utf8"),
          ),
        )
        .notes.find((note) => note.title === title)?.body ?? ""
    if (actual === expected) break
    await Bun.sleep(16)
  }
  assert.equal(actual, expected)
}

export async function verifyRichMarkdown(app: App, dataDirectory: string) {
  await app.getByTestId("new-note").click()
  await app.getByTestId("note-title").waitFor()
  await app.getByTestId("note-title").fill(title)
  await app.getByTestId("note-body").fill(body)
  await savedBody(dataDirectory, body)
  await app.getByTestId("preview-toggle").click()
  await app.getByTestId("markdown-table").waitFor()
  await app.getByTestId("markdown-code").waitFor()
  await app.getByTestId("markdown-task-0").waitFor()
  assert.equal(await app.getByText("Folded message unique-1523").count(), 0)
  await app.getByTestId(`markdown-callout-${body.indexOf("> [!NOTE]")}`).click()
  const deadline = Date.now() + 5000
  while (
    !(await app.getByText("Folded message unique-1523").count()) &&
    Date.now() < deadline
  )
    await Bun.sleep(16)
  assert((await app.getByText("Folded message unique-1523").count()) > 0)
  await app.getByTestId("markdown-task-0").click()
  await savedBody(
    dataDirectory,
    body.replace("[ ] Preview task", "[x] Preview task"),
  )
  assert((await app.getByText("Native footnote text").count()) > 0)
  return [
    "Native rich preview: GFM table, source-safe task toggle, folded callout, code, footnotes and wiki text",
  ]
}
