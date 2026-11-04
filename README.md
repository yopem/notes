# Still Notes

A local-first native desktop notebook built with GPUix and Bun. Inspired by
[ZenNotes](https://github.com/ZenNotes/zennotes). Uses
[Yopem UI](https://ui.yopem.com) design values translated to native renderer
styles. No Electron, web view, CSS, or StyleX.

## What it does

- Create and rename notebooks. Create, edit, and move notes.
- Write Markdown with native text selection, clipboard, IME, and undo/redo.
- Read GitHub-flavored Markdown in preview or split view.
- Search titles and note text within the current view. Pin important notes.
- Move notes to Trash, restore them, or confirm permanent deletion.
- Import UTF-8 Markdown without changing the source file. Export Markdown
  without replacing existing files. Drag Markdown files into the window.
- Switch between light and dark themes. Hide navigation in focus mode.
- Save each edit locally. Display write errors and keep failed edits in memory.

The first workspace contains one clearly labeled example note. Remove or edit it.
No account, network service, or API key is required.

## Setup

Install Bun 1.3 or later. Use a desktop system with a GPU driver supported by
GPUix: Metal on macOS, DirectX on Windows, or Vulkan on Linux. Linux needs a
working graphical session and its platform libraries.

```sh
bun install --frozen-lockfile
bun run dev
```

Use `bun start` without hot reload. GPUix React and native are pinned to the same
version. Upgrade them together. Inter and IBM Plex Mono fonts ship with the app.

## Keyboard commands

Use Cmd on macOS or Ctrl on Linux and Windows.

| Command | Keys |
| --- | --- |
| New note | Mod + N |
| Search current view | Mod + P or Mod + K |
| Toggle preview | Mod + Shift + P |
| Edit / split / preview | Mod + 4 / 5 / 6 |
| Toggle focus mode | Mod + Shift + F |
| Import Markdown | Mod + O |
| Retry pending saves | Mod + S |
| Close dialog | Escape |
| Move between controls | Tab / Shift + Tab |

## Local data and recovery

Default data folder:

- Linux: `$XDG_DATA_HOME/still-notes`, or `~/.local/share/still-notes`.
- macOS: `~/Library/Application Support/Still Notes`.
- Windows: `%LOCALAPPDATA%/Still Notes`, with an AppData fallback.

Set `STILL_NOTES_DATA_DIR` to use a separate workspace. Only one app process can
write a workspace at a time. Do not put it in a shared sync folder while the app
is open.

`workspace.json` contains notes, notebooks, selection, and theme. Writes use a
synced temporary file and atomic rename. `workspace.json.bak` keeps the previous
valid workspace. A backup is not a version history or an off-device backup.
Export important notes and back up the data folder.

The app refuses to overwrite malformed or externally changed data. Close the
app, copy the whole folder, inspect the backup, and restore a valid copy to
`workspace.json`. Never remove your only copy. If a save fails, keep the window
open and use **Retry save** before closing. Unsaved in-memory edits do not survive
a process exit.

Limits: 2 MB of UTF-8 content per note; 32 MB for the workspace. Import accepts
`.md` and `.markdown` regular files, not symlinks or binary data.

## Checks

```sh
bun run check
bun run lint
bun run format:check
bun run test:store
bun run test:native
bun run build
```

Uses shared Yopem TypeScript, Oxlint **React**, and Oxfmt configurations. Source
imports use `@/`. Native components live in `src/components/`; common controls in
`src/components/ui/`; shared functions in `src/utils/`.

Storage checks use only `tests/store.test.ts` with real temporary directories.
Native E2E checks launch real windows with temporary data, then exercise editing,
search, lifecycle actions, import/export, keyboard input, themes, and restart.
Reports and screenshots are saved in ignored `docs/artifacts/`.

GPUix's current Linux release has neither headless tests nor native screenshot
capture. Linux screenshots require Hyprland and `grim`; the test captures only
the verified Still Notes window. Linux also ignores the background-focus option.
Other desktops can run the app, but this screenshot test needs another capture
adapter. macOS/Windows native capture depends on GPUix test-support availability.
Browser checks cannot validate this native renderer.

## Build and run

```sh
bun run build
./dist/still-notes
```

Bun compiles the app and renderer into a host-platform executable. Build on each
target OS. This repository does not claim signed installers or automatic updates.

## Scope and sources

This is an independent native implementation, not an official ZenNotes release
or complete port. Research used ZenNotes commit `c05a8650` and Yopem UI registry
source at `9b8a61b6`. Yopem colors, 4px spacing, 12px control radii, fonts, and
state behavior guide the native interface; web components are not included.

Unlike ZenNotes, this version uses a private JSON workspace, not a Markdown vault
as its source of truth. Import/export moves Markdown content, not complete
ZenNotes metadata. There is no automatic ZenNotes vault migration, cloud sync,
AI backend, Vim mode, rich live preview, math/diagram engine, attachments,
databases, PDF/Word export, or account service.

## License

See `LICENSE.md` for project terms and source credits. Font notices ship in
`src/assets/Inter-OFL` and `src/assets/IBMPlexMono-OFL`.
