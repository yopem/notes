# QA plan

## Current task and execution policy

Refactor the native desktop app into a Bun workspace monorepo. Preserve existing
notes, settings, native assets, scripts, and tests. Then implement the remaining
source-backed product features. This plan does not report QA execution.

The user explicitly approved local QA, lint, typecheck, formatting, builds and
related checks for this work. Complete each implementation milestone before its
QA pass. All cases below are still pending until execution and evidence review.
Do not run an unrelated whole-project test suite or use production/personal
data.

## Shared setup

- Repository: the directory containing this file.
- Desktop workspace: `apps/desktop`, package `@still-notes/desktop`.
- Notes workspace: `packages/notes`, package `@still-notes/notes`; shared
  Markdown analysis only. Native persistence stays in its desktop feature.
- Configuration workspace: `packages/env`, package `@still-notes/env`.
- Runtime under review: local package `bun@1.4.4-canary.20261104.1`, source
  revision `b9f2ec36352060f6b976508fa93d54bf8d5d978f`. The previously installed
  canary has no known immutable published artifact. Confirm local command help
  and the committed `bun-toolchain.json` pin. Do not update global Bun.
- After installation, prepend root `node_modules/.bin` to the shell PATH. Bun
  scripts also resolve the pinned local binary through their command PATH.
- Runtime commands: native `bun lint`, `bun fmt`, and `bun check`. Leaf scripts
  must use `--no-script` to avoid recursion. Do not substitute other runners.
- Install dependencies from the one root `bun.lock` with
  `bun install --frozen-lockfile`. This does not authorize tests or builds.
- No HTTP service or browser is required for the current native desktop app. Web
  routes, PWA, CORS, SEO, payments, and server database migrations are not
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

| Requirement or workflow                                      | Cases          |
| ------------------------------------------------------------ | -------------- |
| Preserve local notes and failed-draft recovery               | QA-001, QA-007 |
| Workspace ownership, dependency install and exports          | QA-002, QA-003 |
| Native tooling, exact runtime, strict policy                 | QA-004, QA-005 |
| Environment contracts and isolation                          | QA-006, QA-012 |
| Native app, fonts, editor bridge and packaging paths         | QA-007, QA-008 |
| Existing service behavior and desktop integration boundaries | QA-009         |
| Documentation and reproducible handoff                       | QA-010         |
| Platform-neutral Markdown and exact UTF-8 byte limits        | QA-005, QA-011 |

## Storage and configuration

- [ ] **QA-001 — P0 — Legacy workspace safety**
  - **Purpose:** Confirm that the refactor preserves the existing JSON format,
    backup, lock, corruption handling, and failed-draft export guarantees.
  - **Prerequisites:** Shared setup; implementation committed; temporary file
    access. No app may hold the test workspace lock.
  - **Inputs:** Existing `apps/desktop/tests/store.test.ts` fixtures, including
    Unicode titles, corrupt JSON, stale locks and a blocked workspace write.
  - **Steps:**
    1. From `apps/desktop`, inspect the `test:store` script.
    2. Run `bun run test:store` in the approved QA pass.
    3. Inspect the named test output and any retained recovery evidence.
  - **Expected results:** The affected tests pass. Corrupt originals remain
    intact. Rejected writes do not replace saved state. Draft rescue exports
    exact text without requiring a workspace write or clearing the draft.
  - **Evidence:** `docs/artifacts/monorepo/QA-001-store.txt`; inspect every
    failure and the final count. Record the tested revision.
  - **Cleanup:** Existing tests remove owned temporary data. Preserve failed
    evidence before deleting only those test directories.
  - **Status:** Pending; local execution approved after implementation.

- [ ] **QA-006 — P0 — Environment boundary parity**
  - **Purpose:** Confirm that moving configuration to `packages/env` preserves
    OS data paths, dimensions, background mode and explicit binary overrides.
  - **Prerequisites:** Shared setup; Effect Schema/Config migration complete; no
    private environment values in command output.
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
  - **Status:** Pending. Isolated Linux probes passed for defaults, valid size
    boundaries, a relative data path and invalid size and launch values. The
    named storage tests also passed. macOS and Windows path checks remain unrun.

## Workspace layout and native tooling

- [ ] **QA-002 — P1 — Single-lockfile workspace install**
  - **Purpose:** Confirm that each workspace has its own manifest and TypeScript
    configuration, with root-owned tooling and one dependency lockfile.
  - **Prerequisites:** Shared setup; committed refactor and network/cache access
    for the approved install. No running install process.
  - **Inputs:** Root manifest, workspace manifests, root `bun.lock`, exact Bun
    revision and committed Turbo configuration.
  - **Steps:**
    1. From the repository root, inspect workspace names and dependency
       ownership.
    2. Run `bun install --frozen-lockfile` when installation is approved.
    3. Inspect `git status --short` and workspace dependency resolution.
  - **Expected results:** Install succeeds without lockfile changes. No second
    lockfile or empty app/package appears. Desktop alone owns GPUIX and React.
    No shared UI, web, mobile, extension, database or queue package is invented.
  - **Evidence:** `docs/artifacts/monorepo/QA-002-install.txt`; inspect exit
    status, manifest ownership and unchanged lockfile.
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
  - **Status:** Pending; local typecheck execution approved.

- [ ] **QA-004 — P1 — Native tool and task contracts**
  - **Purpose:** Confirm that scripts use native Bun lint/format/typecheck with
    no recursive shadowing, unsupported config keys or fallback runners.
  - **Prerequisites:** Shared setup and QA-002; explicit check/type-aware lint
    approval before execution.
  - **Inputs:** Root scripts, leaf scripts, `bunfig.toml`, Turbo tasks, shared
    presets, plugin versions and committed runtime pin.
  - **Steps:**
    1. Inspect native help and committed configuration for the pinned runtime.
    2. Run approved `lint`, `format:check`, and `typecheck` root scripts
       separately.
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
  - **Inputs:** Allowed concrete imports; rejected
    useEffect/useMemo/useCallback, unsafe type assertions, direct environment
    reads and forbidden cross-layer imports. Select exact examples from the
    final configured rules.
  - **Steps:**
    1. Record the allowed and rejected examples before the approved QA run.
    2. Lint the allowed example and each rejected example separately.
    3. Compare diagnostics to the expected rule IDs; then remove probe files.
  - **Expected results:** Allowed code passes and each prohibited example fails
    for its intended rule. Missing plugin support is reported as a blocker, not
    hidden by a weaker config or alternate runner.
  - **Evidence:** `docs/artifacts/monorepo/QA-005-boundaries.txt`; inspect rule
    IDs and ensure that failures are not unrelated syntax errors.
  - **Cleanup:** Remove only the ignored probes created for this case.
  - **Status:** Pending; isolated local probes and QA execution approved.

## Desktop and existing domain behavior

- [ ] **QA-007 — P1 — Native source workflow after relocation**
  - **Purpose:** Confirm the moved entrypoint, components, fonts, controls,
    settings, shortcuts, failed-save recovery and restart behavior.
  - **Prerequisites:** Shared setup, QA-001 and graphical prerequisites;
    explicit native QA approval. No duplicate development or test process.
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
    1. Inspect the final build commands, source pin, output paths and asset
       imports.
    2. Run only the approved desktop build and existing native-addon named
       tests.
    3. Run the existing native workflow against the resulting binary override.
    4. Inspect standalone screenshots and ensure all owned processes end.
  - **Expected results:** Compilation and actual binary workflows succeed.
    Native binding/fonts resolve without the old flat layout. Generated .node
    files and executables stay ignored. A compile pass alone is not a pass.
  - **Evidence:** `docs/artifacts/monorepo/QA-008/`; retain build output, addon
    test report, binary workflow report and inspected screenshots.
  - **Cleanup:** Preserve source checkouts and user files. Remove only generated
    outputs explicitly created for this case when no longer needed.
  - **Status:** Pending. The desktop build passed after the native binding
    resolution fix. The addon test, binary workflow and screenshots are unrun.

- [ ] **QA-009 — P1 — Moved domain service regressions**
  - **Purpose:** Preserve vault safety, tasks, recurrence, templates, assistant
    review, settings and Markdown behavior while imports and schemas change.
  - **Prerequisites:** Shared setup, completed implementation and explicit QA
    approval. All filesystem/client config records must be isolated fixtures.
  - **Inputs:** Existing affected named test files moved with each owner.
    Include Unicode, corrupt data, symlinks, stale writes, collisions,
    interrupted journals, UTC and documented time-zone boundaries where already
    covered.
  - **Steps:**
    1. List the affected existing test filenames and owning working directories.
    2. Run only those explicit files. Do not run the whole repository suite.
    3. Inspect every changed failure and retained recovery result.
  - **Expected results:** Existing assertions remain intact and pass. Validation
    remains at all trust boundaries. No network or real external-client config
    is changed. New APIs are not counted as native UI integration.
  - **Evidence:** `docs/artifacts/monorepo/QA-009-services.txt`; record exact
    file selection, runtime/time zones, actual counts and diagnostics.
  - **Cleanup:** Use existing fixture cleanup. Preserve sanitized failure
    evidence before removing owned temporary records.
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
  - **Evidence:** `docs/artifacts/monorepo/QA-010-review.txt`; record file
    paths, mismatches and final conclusions.
  - **Cleanup:** None; keep working reports ignored.
  - **Status:** Pending.

## Shared Markdown boundary

- [ ] **QA-011 — P0 — Exact UTF-8 preview limits**
  - **Purpose:** Remove native-only globals from the shared Markdown contract
    without changing its 2,097,152-byte limit or allocating unbounded encoding
    buffers for rejected input.
  - **Prerequisites:** Shared setup; committed implementation and installed
    workspace dependencies. No desktop window or external service is needed.
  - **Inputs:** ASCII `x` repeated 2,097,152 and 2,097,153 times; `🌿` repeated
    524,288 and 524,289 times. The accepted Unicode input has exactly 2,097,152
    UTF-8 bytes and 1,048,576 UTF-16 code units.
  - **Steps:**
    1. From `packages/notes`, call the existing `@still-notes/notes/markdown`
       export's `analyzeMarkdown` for each input with an in-memory Bun command.
       Do not create source fixtures.
    2. Record whether each input returns or throws. Fail the command if an
       accepted/rejected result differs from the expected result.
    3. Run the existing named `src/markdown.test.ts` file. Inspect its source
       offset, stale-edit and Unicode results.
  - **Expected results:** The exact-limit ASCII and Unicode inputs return. Both
    over-limit inputs throw the preview-limit error before parsing. The existing
    Markdown cases pass. The module has no native-only imports or globals, as
    verified by QA-005.
  - **Evidence:** `docs/artifacts/monorepo/QA-011-utf8.txt`; record the exact
    command, runtime revision, input lengths, observed results and test output.
    Keep large source text out of logs.
  - **Cleanup:** No user data is created. Keep only the sanitized QA report.
  - **Status:** Pending.

- [ ] **QA-012 — P0 — Preserve relative data overrides**
  - **Purpose:** Keep a root launch's relative `STILL_NOTES_DATA_DIR` anchored
    to the caller directory after Turbo or Bun enters the desktop workspace.
  - **Prerequisites:** Shared setup and committed implementation. Confirm that
    `docs/artifacts/monorepo/qa012-data` does not exist before this case. No
    user data or existing desktop process may be used for this check.
  - **Inputs:** Relative override `docs/artifacts/monorepo/qa012-data`;
    `GPUIX_BACKGROUND=1`. The launch-directory marker must be an absolute path.
  - **Steps:**
    1. From repository root, run
       `STILL_NOTES_DATA_DIR=docs/artifacts/monorepo/qa012-data GPUIX_BACKGROUND=1 bun run start`.
       Record all owned process IDs and wait for the native workspace to mount.
    2. Inspect the created workspace file. Confirm that its absolute path is
       under the root `docs/artifacts/monorepo/qa012-data`, not
       `apps/desktop/docs/artifacts/monorepo/qa012-data`.
    3. Confirm that the root start script passes the caller directory through
       `STILL_NOTES_LAUNCH_DIRECTORY`. Verify that a relative marker is rejected
       by the existing environment adapter in an isolated child process.
    4. Close only the app and launcher processes started for this case.
  - **Expected results:** Relative data overrides preserve the caller base. The
    normal OS data location stays unchanged and untouched. An invalid marker
    fails before any workspace is written.
  - **Evidence:** `docs/artifacts/monorepo/QA-012-launch-path.txt`; record the
    exact launch, PID, resolved data location and invalid-marker result.
  - **Cleanup:** Stop only owned processes. Remove only the newly created
    `docs/artifacts/monorepo/qa012-data` after evidence is inspected.
  - **Status:** Pending.

## Existing lint findings

Acceptance: all existing and new workspace lint warnings and errors must be
resolved. Feature work is paused until QA-013 passes. Baseline at `48e0257`: 177
desktop warnings and zero errors. The other workspaces have no findings.

- [ ] **QA-013 — P1 — Zero workspace lint diagnostics**
  - **Purpose:** Remove all existing warnings and errors without weakening the
    current policy or changing native notes behavior.
  - **Prerequisites:** Shared setup, pinned project-local Bun, approved local
    lint/typecheck/format and isolated native QA. Read all affected components
    and the exact rule requirements before each refactor.
  - **Inputs:** Complete workspace source; baseline
    `docs/desktop-lint-zero.json`. Findings include unstable props, native-only
    JSX properties, component size and complexity, and one schema API.
  - **Steps:**
    1. Record every finding by rule, file and source line.
    2. Fix all findings. Keep native roles, event handlers, automation IDs,
       unsaved-draft recovery, settings validation and guarded writes intact.
    3. From repository root, run `bun run lint`, `bun run typecheck`, and
       `bun run format:check`. Run each workspace's native lint command with
       `--no-script --max-warnings=0` from that workspace.
    4. Run the existing affected test files and native E2E workflow through
       `bun run test:native`. Inspect the report, screenshots and saved data.
    5. Confirm that all other rules keep their severity. The user approved
       disabling only the DOM-specific `react-doctor/no-unknown-property` rule
       because GPUix has native host props. Typecheck those props with GPUix
       types. Inspect any required one-line native role exception.
  - **Expected results:** Every workspace reports zero warnings and zero errors.
    Typecheck, format and relevant regressions pass. Native layout, keyboard
    actions, dialogs, persistence and draft rescue remain functional. No
    memoization hooks, unsafe types, fallback runners or blanket disables are
    added.
  - **Evidence:** `docs/artifacts/lint-zero/`; save baseline and final JSON,
    commands, revision, runtime, native report and client-only screenshots.
    Inspect counts and observable outcomes, not only command exit codes.
  - **Cleanup:** Close only owned native sessions. Remove isolated QA data after
    its evidence is inspected. Keep reports ignored and local.
  - **Status:** Pending. Native workspace lint passed with zero warnings and
    errors; typecheck and format passed. Native regression evidence remains
    blocked by the client-only screenshot failure recorded in QA-015.

## Effect migration

Acceptance: replace all application Zod contracts with Effect Schema. Apply
Effect to desktop business workflows, typed failures, configuration and scoped
resources where AGENTS.md requires it. Keep React UI state, rendering and simple
synchronous calculations in ordinary TypeScript.

- [ ] **QA-014 — P0 — Preserve contracts through Effect migration**
  - **Purpose:** Replace existing validation and suitable desktop workflows
    without losing data, changing accepted inputs or hiding expected failures.
  - **Prerequisites:** Shared setup; exact verified Effect v4 release; complete
    installed Effect guidance read before implementation; isolated test data.
  - **Inputs:** Existing store/settings/vault/task/template/assistant contracts,
    environment variables, Markdown limits, native editor/capture protocols, and
    their existing valid/invalid examples and regression files.
  - **Steps:**
    1. Inventory all Zod schemas, inferred types and parse callers. Record the
       matching canonical Effect schema and execution boundary for each.
    2. Migrate callers with their contracts. Preserve strict unknown-key checks,
       defaults, transformations, UTF-8 and numeric limits, references, errors,
       immutable snapshots and write rollback.
    3. Use Effect Config only in the environment owner. Keep native clients
       server-only and release scoped resources. Preserve the launcher base.
    4. Inspect all desktop workflows for appropriate Effect services, typed
       errors, cancellation and lifetime. Do not add Effect to simple rendering
       or introduce runtime execution inside domain services.
    5. Run the existing affected files with native Bun, all workspace checks,
       and the isolated native E2E workflow. Inspect failures and saved state.
    6. Confirm no application Zod imports or direct dependencies remain. List
       any unavoidable tooling-only transitive dependency separately.
  - **Expected results:** Existing valid inputs and observable workflows still
    work. Invalid inputs fail before writes. Corrupt files remain intact.
    Expected failures have precise contracts. Zero lint warnings/errors,
    typecheck and format checks pass. No old Effect APIs or parallel validators
    remain in application code.
  - **Evidence:** `docs/artifacts/effect-migration/`; save contract inventory,
    runtime/release metadata, revision, exact commands, reports and native
    screenshots. Do not include secrets or personal data.
  - **Cleanup:** Close only owned processes and scopes. Remove isolated test
    data after evidence review. Leave user data and configuration untouched.
  - **Status:** Pending. Native editor boundary tests passed (11 tests, 24
    assertions), and Markdown tests passed (10 tests, 42 assertions). Other
    workflows and the native regression remain pending. GPUix retains Zod as a
    third-party transitive dependency.

- [ ] **QA-015 — P0 — Effect runtime resource and write boundaries**
  - **Purpose:** Check that the desktop runtime acquires one notes lock, runs
    deferred mutations, preserves failed drafts, and releases the lock.
  - **Prerequisites:** Shared setup and an isolated local display. No other
    Still Notes process may use the disposable data directory. Use the pinned
    Bun from `node_modules/.bin` and the existing native automation tools.
  - **Inputs:** The existing Unicode note, failed-save and restart scenarios in
    `apps/desktop/scripts/native-e2e.ts` and `native-regressions.ts`.
  - **Steps:**
    1. From `apps/desktop`, run
       `../../node_modules/.bin/bun test tests/store.test.ts tests/settings.test.ts`.
    2. From the repository root, run `bun run test:native`. Record the
       disposable data path and inspect the generated
       `docs/artifacts/native-e2e.json`.
    3. Confirm the failed-save scenario exports the draft without marking it
       saved, then retries it after the cause is removed.
    4. Confirm the restart scenario opens the same data after shutdown and
       retains the note and settings values.
  - **Expected results:** The named tests pass. The native report shows each
    requested step passed. The draft export contains the exact unsaved text.
    Restart opens the stored data without a false lock or missing edits.
  - **Evidence:** Copy the sanitized test output and native report to
    `docs/artifacts/effect-migration/QA-015/`. Inspect the draft export,
    persisted files and screenshots before recording a pass.
  - **Cleanup:** Close only the test processes. Remove only the disposable
    directory after its evidence is reviewed. Do not touch personal data.
  - **Status:** Blocked. Client-only screenshot capture requires a working
    isolated compositor or a verified fix for `grim -T`. The installed headless
    compositor cannot provide its required DRM allocator. The named core tests
    passed with 81 tests and 343 assertions. Scoped core lint passed with zero
    warnings. Native QA reached the welcome screen. Its saved automation tree
    shows the test workspace, but `grim -T` exited with SIGSEGV. Draft recovery
    and restart remain unrun. The existing user app was not stopped or captured.
    Resolve client-only capture before rerunning the native cases.
