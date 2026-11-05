# Still Notes

A local-first native desktop notebook built with GPUix and Bun. Uses
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

The first workspace contains one clearly labeled example note. Remove or edit
it. No account, network service, or API key is required.

## Repository layout

| Path             | Owner                                                               |
| ---------------- | ------------------------------------------------------------------- |
| `apps/desktop`   | GPUix entrypoint, native UI, desktop features and platform adapters |
| `packages/notes` | Platform-neutral Markdown analysis and source-edit contracts        |
| `packages/env`   | Validated runtime configuration and OS data paths                   |
| `QA.md`          | Shared QA plan and recorded results                                 |

Each workspace owns its manifest and TypeScript configuration. Root owns the Bun
lockfile, toolchain pin, native Bun policy and Turborepo task graph. Shared
controls stay in `apps/desktop/src/components/ui/`. Feature components and
services stay in their owning desktop feature. There is no shared UI package.

## Setup

Use a desktop system with a GPU driver supported by GPUix: Metal on macOS,
DirectX on Windows, or Vulkan on Linux. Linux needs a working graphical session
and its platform libraries.

Use an existing Bun installation to install dependencies. The repository then
uses its exact dated Bun package, not a moving canary or a global upgrade:

```sh
bun install --frozen-lockfile
export PATH="$PWD/node_modules/.bin:$PATH"
bun --revision
bun run dev
```

On PowerShell, use `$env:PATH = "$PWD/node_modules/.bin;$env:PATH"` for that
shell. The pinned package is `bun@1.4.4-canary.20261104.1`. Expected source
revision is `b9f2ec36352060f6b976508fa93d54bf8d5d978f`. `bun-toolchain.json`
records the pin and matching immutable Linux x64 container image. Installation
does not replace your global Bun. The reviewed Bun package postinstall links its
platform binary inside `node_modules`; it is the only explicitly trusted install
script.

Use `bun run start` without hot reload. GPUix React and native are pinned to the
same version. Upgrade them together. Inter and IBM Plex Mono fonts ship with the
app.

## Keyboard commands

Use Cmd on macOS or Ctrl on Linux and Windows.

| Command                | Keys               |
| ---------------------- | ------------------ |
| New note               | Mod + N            |
| Search current view    | Mod + P or Mod + K |
| Toggle preview         | Mod + Shift + P    |
| Edit / split / preview | Mod + 4 / 5 / 6    |
| Toggle focus mode      | Mod + Shift + F    |
| Import Markdown        | Mod + O            |
| Retry pending saves    | Mod + S            |
| Close dialog           | Escape             |
| Move between controls  | Tab / Shift + Tab  |

## Local data and recovery

Default data folder:

- Linux: `$XDG_DATA_HOME/still-notes`, or `~/.local/share/still-notes`.
- macOS: `~/Library/Application Support/Still Notes`.
- Windows: `%LOCALAPPDATA%/Still Notes`, with an AppData fallback.

Set `STILL_NOTES_DATA_DIR` to use a separate workspace. Only one app process can
write a workspace at a time. Do not put it in a shared sync folder while the app
is open. Moving source code into workspaces does not move user data. Root launch
scripts preserve the caller directory for relative overrides. Use an absolute
path when moving a workspace between launch contexts.

`workspace.json` contains notes, notebooks, selection, and theme. Writes use a
synced temporary file and atomic rename. `workspace.json.bak` keeps the previous
valid workspace. A backup is not a version history or an off-device backup.
Export important notes and back up the data folder.

The app refuses to overwrite malformed or externally changed data. Close the
app, copy the whole folder, inspect the backup, and restore a valid copy to
`workspace.json`. Never remove your only copy. If a save fails, keep the window
open and use **Retry save** before closing. Unsaved in-memory edits do not
survive a process exit.

Limits: 2 MB of UTF-8 content per note; 32 MB for the workspace. Import accepts
`.md` and `.markdown` regular files, not symlinks or binary data.

## Checks

```sh
bun run lint
bun run format:check
bun run typecheck
bun run test:store
bun run test:native
```

Root tasks run installed Turborepo. Each leaf uses native `bun lint`, `bun fmt`,
and `bun check` with `--no-script`. There is no aggregate `check` script or
standalone lint/format/typecheck fallback. Native policy in `bunfig.toml`
retains the shared Yopem React rules and formatter policy. Bun's native `oxlint`
compatibility flavor preserves the preset's import semantics; it does not run
the Oxlint CLI. TypeScript configurations extend the shared Yopem presets and
retain GPUix JSX.

Run only the relevant named tests. For example, from `packages/notes`,
`bun run test:markdown` checks the shared Markdown analyzer. Storage checks run
only `apps/desktop/tests/store.test.ts` with real temporary directories.

Native E2E checks launch real windows with temporary data, then exercise
editing, search, lifecycle actions, import/export, keyboard input, themes, and
restart. Reports and screenshots stay in ignored root `docs/artifacts/`.

GPUix's current Linux release has neither headless tests nor native screenshot
capture. Linux screenshots require Hyprland and `grim`; the test captures only
the verified Still Notes window. Linux also ignores the background-focus option.
Other desktops can run the app, but this screenshot test needs another capture
adapter. macOS/Windows native capture depends on GPUix test-support
availability. Browser checks cannot validate this native renderer.

## Build and run

```sh
bun run build
./apps/desktop/dist/still-notes
```

Bun compiles the app and renderer into a host-platform executable. Build on each
target OS. The custom editor bridge source and native build script belong to
`apps/desktop`; generated native binaries stay ignored. This repository does not
claim signed installers or automatic updates.

## Implementation status

The native workflows listed above are the current app surface. Further editor,
vault, task, template, assistant and desktop integration work is in progress.
Service code or a stored setting alone does not establish a working UI feature.
See `QA.md` for pending checks and results tied to their tested revision.

Yopem UI colors, 4px spacing, 12px control radii, fonts, and state behavior
guide the native interface. Web components are not included.

## License

See `LICENSE.md` for project terms and source credits. Font notices ship in
`apps/desktop/src/assets/Inter-OFL` and
`apps/desktop/src/assets/IBMPlexMono-OFL`.
