# Still Notes agent guide

## Product and stack

- Build a native local notes app with GPUix and Bun.
- Use `@gpuix/react` and `@gpuix/native` at the same exact version.
- Do not add Electron, a web view, React DOM, CSS, or StyleX.
- Use Yopem UI design values. Keep light and dark colors in `src/theme.ts`.
- Bundle Inter and IBM Plex Mono. Keep their license files.
- Keep native window controls. Set `focus: false` for agent runs.

## Structure

- Put React components in `src/components/`.
- Put reusable native controls in `src/components/ui/`.
- Keep storage and runtime code outside the components folder.
- Use named `export function` declarations for components and hooks.
- Do not use `useEffect`, `useMemo`, or `useCallback`.
- Do not use `any` or unsafe type assertions.

## Tools and checks

- Use Bun for install, scripts, tests, and builds.
- Use `@yopem/oxlint-config`, `@yopem/typescript-config`, and
  `@yopem/oxfmt-config`. Preserve GPUix `jsxImportSource`.
- Fix diagnostics. Do not weaken rules or test assertions.
- Run `bun run check`, `bun run lint`, and `bun run format:check`.
- Run only the affected test files. Never run the whole test suite.
- Storage checks: `bun run test:store`.
- Native workflow checks: `bun run test:native`.
- Release compile: `bun run build`.
- Native checks save reports and screenshots in `docs/artifacts/`.
- Linux has no GPUix headless test renderer. Use live native automation.
- Browser checks do not prove native app behavior.

## Data safety

- Keep imports non-destructive and exports collision-safe.
- Validate stored data. Keep atomic saves, backups, and process locks.
- Do not replace damaged data with an empty workspace.
- Preserve failed edits in memory. Show save errors and a retry action.
- Never use the user's real data directory for automated tests.

## Change tracking

- Commit each focused change as soon as it is ready. Do not collect changes
  for a large final commit.
- Use Conventional Commits. Keep titles below 50 characters.
- Update this guide when code changes alter structure, commands, contracts,
  or project rules. Keep this guide current throughout the task.
- Keep detailed progress and validation results in ignored `docs/` notes.
- Commit Markdown files only when named `AGENTS.md`, `README.md`, or
  `LICENSE.md`. Do not commit progress notes.

## Current scope

- Notebooks, Markdown text, preview, split view, search, pins, trash,
  restore, import/export, keyboard commands, and light/dark themes.
- Private JSON workspace with Markdown import/export. Not a ZenNotes vault
  reader or a full ZenNotes port.
- No cloud sync, AI backend, Vim mode, diagrams, PDF/Word export, or account.
- Source evidence: ZenNotes commit `c05a8650`; Yopem UI commit `9b8a61b6`.
