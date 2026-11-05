# QA plan

## Current task and execution policy

Refactor the native desktop app into a Bun workspace monorepo. Preserve existing
notes, settings, native assets, scripts, and tests. Then implement the remaining
source-backed product features. This plan does not report QA execution.

All cases below are pending. Run them only in a user-approved QA pass. Local
`bun check` and type-aware lint need explicit execution approval. Do not run an
unrelated whole-project test suite. Do not use production or personal data.

## Shared setup

- Repository: the directory containing this file.
- Desktop workspace: `apps/desktop`, package `@still-notes/desktop`.
- Notes workspace: `packages/notes`, package `@still-notes/notes`.
- Configuration workspace: `packages/env`, package `@still-notes/env`.
- Runtime under review: Bun 1.4.4, revision
  `1.4.4-canary.1+a8fcd319b`. Confirm the committed pin and supported native
  commands before execution. Do not update the global runtime.
- Runtime commands: native `bun lint`, `bun fmt`, and `bun check`. Leaf scripts
  must use `--no-script` to avoid recursion. Do not substitute other runners.
- Install dependencies from the one root `bun.lock` with
  `bun install --frozen-lockfile`. This does not authorize tests or builds.
- No HTTP service or browser is required for the current native desktop app.
  Web routes, PWA, CORS, SEO, payments, and server database migrations are not
  applicable to this layout refactor. Add cases when those boundaries change.
- Native QA requires a graphical session and supported GPU driver. Linux capture
  currently requires Hyprland and grim. Check existing processes before launch.
- Use only temporary data created by the existing tests. Never point
  `STILL_NOTES_DATA_DIR` at the user's normal data folder.
- Save sanitized evidence under ignored `docs/artifacts/monorepo/`. Record the
  tested commit, runtime revision, OS, date, actual results and evidence paths.
- Run P0 cases before P1 cases. Keep each checkbox unchecked until evidence has
  been inspected. Prior results from the flat repository do not prove this move.

## Coverage map

| Requirement or workflow | Cases |
| --- | --- |
| Preserve local notes and failed-draft recovery | QA-001, QA-007 |
| Workspace ownership, dependency install and exports | QA-002, QA-003 |
| Native tooling, exact runtime, strict policy | QA-004, QA-005 |
| Environment contracts and isolation | QA-006 |
| Native app, fonts, editor bridge and packaging paths | QA-007, QA-008 |
| Existing service behavior and desktop integration boundaries | QA-009 |
| Documentation and reproducible handoff | QA-010 |

## Storage and configuration

- [ ] **QA-001 — P0 — Legacy workspace safety**
  - **Purpose:** Confirm that the refactor preserves the existing JSON format,
    backup, lock, corruption handling, and failed-draft export guarantees.
  - **Prerequisites:** Shared setup; implementation committed; temporary file
    access. No app may hold the test workspace lock.
  - **Inputs:** Existing `packages/notes/tests/store.test.ts` fixtures, including
    Unicode titles, corrupt JSON, stale locks and a blocked workspace write.
  - **Steps:**
    1. From `packages/notes`, inspect the `test:store` script.
    2. Run `bun run test:store` in the approved QA pass.
    3. Inspect the named test output and any retained recovery evidence.
  - **Expected results:** The affected tests pass. Corrupt originals remain
    intact. Rejected writes do not replace saved state. Draft rescue exports
    exact text without requiring a workspace write or clearing the draft.
  - **Evidence:** `docs/artifacts/monorepo/QA-001-store.txt`; inspect every failure
    and the final count. Record the tested revision.
  - **Cleanup:** Existing tests remove owned temporary data. Preserve failed
    evidence before deleting only those test directories.
  - **Status:** Pending; execution approval required.

- [ ] **QA-006 — P0 — Environment boundary parity**
  - **Purpose:** Confirm that moving configuration to `packages/env` preserves
    OS data paths, dimensions, background mode and explicit binary overrides.
  - **Prerequisites:** Shared setup; Effect Schema/Config migration complete;
    no private environment values in command output.
  - **Inputs:** Existing environment cases in the storage tests; width 1360,
    height 900, invalid negative dimensions, and a temporary data directory.
  - **Steps:**
    1. Inspect the environment adapter and affected existing tests after moves.
    2. Run only those named files through their owning workspace commands.
    3. Compare documented defaults and rejected values to the old contract.
  - **Expected results:** Valid values retain their meaning. Invalid values fail
    before app startup. Tests do not use the normal user directory. Raw runtime
    environment reads remain in the configuration adapter.
  - **Evidence:** `docs/artifacts/monorepo/QA-006-env.txt`; inspect sanitized
    defaults, expected errors, and test results.
  - **Cleanup:** Restore only environment values set for this case. Remove only
    temporary test data after evidence inspection.
  - **Status:** Pending; discover the final affected filenames before execution.

## Workspace layout and native tooling

- [ ] **QA-002 — P1 — Single-lockfile workspace install**
  - **Purpose:** Confirm that each workspace has its own manifest and TypeScript
    configuration, with root-owned tooling and one dependency lockfile.
  - **Prerequisites:** Shared setup; committed refactor and network/cache access
    for the approved install. No running install process.
  - **Inputs:** Root manifest, workspace manifests, root `bun.lock`, exact Bun
    revision and committed Turbo configuration.
  - **Steps:**
    1. From the repository root, inspect workspace names and dependency ownership.
    2. Run `bun install --frozen-lockfile` when installation is approved.
    3. Inspect `git status --short` and workspace dependency resolution.
  - **Expected results:** Install succeeds without lockfile changes. No second
    lockfile or empty app/package appears. Desktop alone owns GPUIX and React.
    No shared UI, web, mobile, extension, database or queue package is invented.
  - **Evidence:** `docs/artifacts/monorepo/QA-002-install.txt`; inspect exit status,
    manifest ownership and unchanged lockfile.
  - **Cleanup:** No source cleanup. Do not delete unrelated dependency caches.
  - **Status:** Pending; install must use the committed runtime.

- [ ] **QA-003 — P1 — Concrete exports and import ownership**
  - **Purpose:** Confirm that moved modules resolve through concrete package
    subpaths and app-local aliases, without old-path forwarding barrels.
  - **Prerequisites:** QA-002; explicit local typecheck approval.
  - **Inputs:** Imports for notes, vault, tasks, templates, Markdown, filesystem
    writes and environment configuration; desktop components and native bridge.
  - **Steps:**
    1. Inspect every changed import and the corresponding package export.
    2. Run the committed root `typecheck` task only with explicit approval.
    3. Inspect each leaf command and confirm that it selects its own tsconfig.
  - **Expected results:** All affected workspaces are covered. No old `src/`
    fallback or duplicate module remains. No browser contract imports native
    runtime code. Desktop UI remains in its app and dependencies are acyclic.
  - **Evidence:** `docs/artifacts/monorepo/QA-003-typecheck.txt`; inspect leaf
    commands, selected projects and exact diagnostics.
  - **Cleanup:** No data cleanup. Preserve reports; remove only owned caches if
    an approved rerun requires it.
  - **Status:** Pending; explicit local typecheck approval required.

- [ ] **QA-004 — P1 — Native tool and task contracts**
  - **Purpose:** Confirm that scripts use native Bun lint/format/typecheck with
    no recursive shadowing, unsupported config keys or fallback runners.
  - **Prerequisites:** Shared setup and QA-002; explicit check/type-aware lint
    approval before execution.
  - **Inputs:** Root scripts, leaf scripts, `bunfig.toml`, Turbo tasks, shared
    presets, plugin versions and committed runtime pin.
  - **Steps:**
    1. Inspect native help and committed configuration for the pinned runtime.
    2. Run approved `lint`, `format:check`, and `typecheck` root scripts separately.
    3. Inspect leaf execution, native diagnostics and Turbo cache inputs.
  - **Expected results:** Native `bun lint`, `bun fmt`, and `bun check` run with
    `--no-script` where needed. No tsc, tsrs or standalone Oxlint/Oxfmt fallback
    runs. Shared config is tracked. Write tasks and development are not cached.
  - **Evidence:** `docs/artifacts/monorepo/QA-004-tooling.txt`; inspect actual
    commands, runtime identity, config loading and all diagnostics.
  - **Cleanup:** Do not run fix/write commands without their own approval.
  - **Status:** Pending; compatibility research is not enforcement proof.

- [ ] **QA-005 — P0 — Rule and boundary enforcement**
  - **Purpose:** Confirm that moved paths retain the effective quality policy,
    banned hooks, strict types and environment/import restrictions.
  - **Prerequisites:** QA-004 and explicit local lint approval. Use only
    temporary ignored probe files in the owning workspace.
  - **Inputs:** Allowed concrete imports; rejected useEffect/useMemo/useCallback,
    unsafe type assertions, direct environment reads and forbidden cross-layer
    imports. Select exact examples from the final configured rules.
  - **Steps:**
    1. Record the allowed and rejected examples before the approved QA run.
    2. Lint the allowed example and each rejected example separately.
    3. Compare diagnostics to the expected rule IDs; then remove probe files.
  - **Expected results:** Allowed code passes and each prohibited example fails
    for its intended rule. Missing plugin support is reported as a blocker,
    not hidden by a weaker config or alternate runner.
  - **Evidence:** `docs/artifacts/monorepo/QA-005-boundaries.txt`; inspect rule IDs
    and ensure that failures are not unrelated syntax errors.
  - **Cleanup:** Remove only the ignored probes created for this case.
  - **Status:** Pending; probe creation and execution require QA approval.

## Desktop and existing domain behavior

- [ ] **QA-007 — P1 — Native source workflow after relocation**
  - **Purpose:** Confirm the moved entrypoint, components, fonts, controls,
    settings, shortcuts, failed-save recovery and restart behavior.
  - **Prerequisites:** Shared setup, QA-001 and graphical prerequisites; explicit
    native QA approval. No duplicate development or test process.
  - **Inputs:** Existing `apps/desktop/scripts/native-e2e.ts` safe temporary
    records and windows at 1360x900, 1000x760 and 700x760.
  - **Steps:**
    1. From `apps/desktop`, inspect the existing `test:native` leaf script.
    2. Run `bun run test:native` in the approved pass.
    3. Inspect the report, screenshots, persisted results and process cleanup.
  - **Expected results:** Existing core workflows pass from the new workspace.
    Inter/IBM Plex Mono load. Data persists after restart. The compact deletion
    case returns to the list. Capture includes only the owned window. No test
    app or user's data is left modified.
  - **Evidence:** Copy the run's sanitized report and screenshots into
    `docs/artifacts/monorepo/QA-007/`; inspect each workflow and image.
  - **Cleanup:** Close only owned test windows and remove owned temporary data
    after evidence inspection. Never terminate another project's process.
  - **Status:** Pending; prior flat-layout passes do not apply.

- [ ] **QA-008 — P1 — Native build and standalone resources**
  - **Purpose:** Confirm that moving native patch/build scripts and font assets
    preserves reproducible addon and standalone resource paths.
  - **Prerequisites:** Shared setup, matching pinned GPUix source checkout,
    supported Rust/toolchain/platform libraries, and explicit build/native QA
    approval. No user-global tool upgrade.
  - **Inputs:** Committed native patch, generated local addon, native build
    script, desktop standalone build and existing binary E2E override.
  - **Steps:**
    1. Inspect the final build commands, source pin, output paths and asset imports.
    2. Run only the approved desktop build and existing native-addon named tests.
    3. Run the existing native workflow against the resulting binary override.
    4. Inspect standalone screenshots and ensure all owned processes end.
  - **Expected results:** Compilation and actual binary workflows succeed.
    Native binding/fonts resolve without the old flat layout. Generated .node
    files and executables stay ignored. A compile pass alone is not a pass.
  - **Evidence:** `docs/artifacts/monorepo/QA-008/`; retain build output, addon
    test report, binary workflow report and inspected screenshots.
  - **Cleanup:** Preserve source checkouts and user files. Remove only generated
    outputs explicitly created for this case when no longer needed.
  - **Status:** Pending; final relocation paths must be confirmed first.

- [ ] **QA-009 — P1 — Moved domain service regressions**
  - **Purpose:** Preserve vault safety, tasks, recurrence, templates, assistant
    review, settings and Markdown behavior while imports and schemas change.
  - **Prerequisites:** Shared setup, completed implementation and explicit QA
    approval. All filesystem/client config records must be isolated fixtures.
  - **Inputs:** Existing affected named test files moved with each owner. Include
    Unicode, corrupt data, symlinks, stale writes, collisions, interrupted
    journals, UTC and documented time-zone boundaries where already covered.
  - **Steps:**
    1. List the affected existing test filenames and owning working directories.
    2. Run only those explicit files. Do not run the whole repository suite.
    3. Inspect every changed failure and retained recovery result.
  - **Expected results:** Existing assertions remain intact and pass. Validation
    remains at all trust boundaries. No network or real external-client config
    is changed. New APIs are not counted as native UI integration.
  - **Evidence:** `docs/artifacts/monorepo/QA-009-services.txt`; record exact file
    selection, runtime/time zones, actual counts and diagnostics.
  - **Cleanup:** Use existing fixture cleanup. Preserve sanitized failure evidence
    before removing owned temporary records.
  - **Status:** Pending; final test filenames and selection need source review.

- [ ] **QA-010 — P2 — Documentation and status accuracy**
  - **Purpose:** Keep setup, ownership, commands, recovery and feature status
    consistent with the monorepo without claiming unrun checks passed.
  - **Prerequisites:** Final source review; no app or browser is required.
  - **Inputs:** README, workspace manifests, QA plan, ignored progress/feature
    ledger and license/font notice paths.
  - **Steps:**
    1. Compare README paths and commands to committed manifests and source.
    2. Confirm that no obsolete root source path remains in active instructions.
    3. Compare feature/status claims to saved evidence and pending QA cases.
  - **Expected results:** Documentation describes actual targets and commands.
    Existing license terms remain unchanged. Missing integration and unrun QA
    remain explicit. Old reports stay identified with their old revision.
  - **Evidence:** `docs/artifacts/monorepo/QA-010-review.txt`; record file paths,
    mismatches and final conclusions.
  - **Cleanup:** None; keep working reports ignored.
  - **Status:** Pending.
