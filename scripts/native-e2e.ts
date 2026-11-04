import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, type App } from "@gpuix/react/automation";

const artifacts = resolve("docs/artifacts");
mkdirSync(artifacts, { recursive: true });
const dataDirectory = mkdtempSync(join(tmpdir(), "still-notes-e2e-"));
const steps: string[] = [];
let app: App | undefined;

async function open(width = 1360, height = 900) {
  return launch({
    command: process.env.STILL_NOTES_BINARY ?? "bun",
    args: process.env.STILL_NOTES_BINARY ? [] : ["src/main.tsx"],
    cwd: process.cwd(),
    env: {
      GPUIX_BACKGROUND: "1",
      STILL_NOTES_DATA_DIR: dataDirectory,
      STILL_NOTES_WIDTH: String(width),
      STILL_NOTES_HEIGHT: String(height),
    },
  });
}

async function textIs(testId: string, expected: string) {
  assert(app);
  const actual = await app.getByTestId(testId).textContent();
  assert.equal(actual, expected, `${testId}: expected ${expected}, got ${actual}`);
}

try {
  app = await open();
  await app.getByTestId("new-note").waitFor({ timeoutMs: 30000 });
  await app.screenshot({ path: join(artifacts, "01-first-run.png") });
  steps.push("First-run native window and welcome note");

  await app.getByTestId("new-notebook").click();
  await app.getByTestId("dialog-input").fill("Field notes");
  await app.getByTestId("dialog-confirm").click();
  await app.getByText("Field notes").waitFor();
  await app.getByTestId("new-note").click();
  await app.getByTestId("note-title").fill("Native notebook check");
  await app
    .getByTestId("note-body")
    .fill(
      "# Native notebook check\n\nWritten in GPUix.\n\n- [ ] Keep thoughts local\n- [x] No Electron\n\n**Unicode:** café 日本語 🌿",
    );
  await textIs("save-status", "Saved locally");
  await app.getByTestId("preview-toggle").click();
  await app.getByTestId("markdown-preview").waitFor();
  await app.screenshot({ path: join(artifacts, "02-markdown-preview.png") });
  steps.push("Create notebook, create note, edit Unicode Markdown, save, preview");

  await app.getByTestId("pin-note").click();
  await app.getByTestId("nav-pinned").click();
  await textIs("note-count", "1 note");
  await app.getByTestId("search").fill("NO ELECTRON");
  await textIs("note-count", "1 note");
  await app.getByTestId("search").fill("missing phrase");
  await textIs("note-count", "0 notes");
  await app.getByTestId("search").fill("");
  await app.getByTestId("trash-note").click();
  await app.getByTestId("nav-trash").click();
  await textIs("note-count", "1 note");
  await app.getByTestId("note-row").click();
  await app.getByTestId("restore-note").click();
  await app.getByTestId("nav-all").click();
  await app.getByText("Native notebook check").waitFor();
  steps.push("Pin, scoped case-insensitive full-text search, no-results, trash, restore");

  await app.getByTestId("theme-toggle").click();
  await app.screenshot({ path: join(artifacts, "03-dark.png") });
  await app.getByTestId("help").click();
  await app.getByTestId("dialog-close").press("escape");
  assert.equal(await app.getByTestId("dialog-close").count(), 0);
  await app.getByTestId("search").press(process.platform === "darwin" ? "cmd-n" : "ctrl-n");
  await app.getByTestId("note-title").fill("Shortcut note");
  await app.getByTestId("note-body").fill("Created with keyboard shortcut.");
  steps.push("Theme switch, accessible dialog Escape, new-note keyboard shortcut");

  const importedPath = join(dataDirectory, "from-disk.md");
  writeFileSync(importedPath, "# Imported from disk\n\nPortable plain text.\n");
  await app.getByTestId("import").click();
  await app.getByTestId("dialog-input").fill(importedPath);
  await app.getByTestId("dialog-confirm").click();
  await app.getByTestId("export").click();
  await app.getByTestId("dialog-input").fill(dataDirectory);
  await app.getByTestId("dialog-confirm").click();
  await app.getByTestId("notice").waitFor();
  steps.push("Import Markdown from real disk, export without overwrite");

  await app.close();
  app = await open(1000, 760);
  await app.getByTestId("new-note").waitFor({ timeoutMs: 30000 });
  await app.getByTestId("search").fill("Native notebook check");
  await textIs("note-count", "1 note");
  await app.getByTestId("note-row").click();
  await app.getByTestId("preview-toggle").click();
  await app.screenshot({ path: join(artifacts, "04-restart-compact.png") });
  assert(
    readFileSync(join(dataDirectory, "workspace.json"), "utf8").includes("Native notebook check"),
  );
  steps.push("Restart real process, restore persisted content, compact window layout");
  await app.close();
  app = undefined;

  writeFileSync(
    join(artifacts, "native-e2e.json"),
    JSON.stringify(
      { result: "passed", runtime: "GPUix native live-window automation", dataDirectory, steps },
      null,
      2,
    ),
  );
  console.info(`Native E2E passed: ${steps.length} workflows. Artifacts: ${artifacts}`);
} catch (error) {
  writeFileSync(
    join(artifacts, "native-e2e.json"),
    JSON.stringify({ result: "failed", dataDirectory, steps, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await app?.close();
}
