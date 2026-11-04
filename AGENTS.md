# Still Notes agent guide

## Product and stack

- Build a native local notes app with GPUix and Bun.
- Use `@gpuix/react` and `@gpuix/native` at the same exact version.
- Do not add Electron, a web view, React DOM, CSS, or StyleX.
- Use Yopem UI design values. Keep light and dark colors in `src/utils/theme.ts`.
- Bundle Inter and IBM Plex Mono. Keep their license files.
- Use native disabled controls with 0.64 opacity. Keep visible keyboard focus.
- Keep native window controls. Set `focus: false` for agent runs.

## Structure

- Put React components in `src/components/`.
- Put reusable native controls in `src/components/ui/`.
- Keep storage and runtime code outside the components folder.
- Put shared utility files in `src/utils/`. Keep domain storage in `src/store.ts`.
- Read raw environment values only in `src/utils/env.ts`. Validate them with Zod.
- Validate external and stored data with named Zod schemas.
- Use named `export function` declarations for components and hooks.
- Do not use `useEffect`, `useMemo`, or `useCallback`.
- Do not use `any` or unsafe type assertions.

## Tools and checks

- Use Bun for install, scripts, tests, and builds.
- Use `@yopem/oxlint-config`, `@yopem/typescript-config`, and
  `@yopem/oxfmt-config`. Use the Oxlint React preset, not React Native.
  Preserve GPUix `jsxImportSource`. Use `@/` for source imports.
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
- Export validated drafts without requiring a workspace save. Do not mark
  exported drafts as saved.
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

## Product scope

- Implement the complete verified reference feature set, not only core notes.
- Keep a source-backed feature ledger in ignored docs/ notes. Mark incomplete,
  blocked, implemented, and verified features separately.
- Include vault workflows, editor tools, search and navigation, imports/exports,
  integrations, settings, and native platform features.
- Implement integrations with real services and explicit user configuration.
  Do not fabricate responses or claim credential-dependent checks passed.
- Preserve existing private workspace data during storage changes. Define
  migration and recovery tests before implementation.
- Keep per-feature native checks and source evidence. Do not claim full parity
  until each verified feature works or a concrete blocker is disclosed.
- Keep app copy and documentation focused on Still Notes. Do not add unrelated
  product links or comparison text.
