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

| Requirement or workflow                                      | Cases                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Preserve local notes and failed-draft recovery               | QA-001, QA-007                                                                         |
| Workspace ownership, dependency install and exports          | QA-002, QA-003                                                                         |
| Native tooling, exact runtime, strict policy                 | QA-004, QA-005                                                                         |
| Environment contracts and isolation                          | QA-006, QA-012                                                                         |
| Native app, fonts, editor bridge and packaging paths         | QA-007, QA-008                                                                         |
| Existing service behavior and desktop integration boundaries | QA-009                                                                                 |
| Documentation and reproducible handoff                       | QA-010                                                                                 |
| Platform-neutral Markdown and exact UTF-8 byte limits        | QA-005, QA-011                                                                         |
| Zero-warning lint and Effect migration                       | QA-013, QA-014, QA-015                                                                 |
| Folder preview, editing, recovery and close safety           | QA-016, QA-018, QA-019, QA-020, QA-021, QA-024, QA-025, QA-032, QA-033, QA-034, QA-042 |
| Assistant protocol, cancellation, privacy and frame limits   | QA-017, QA-023, QA-026, QA-027                                                         |
| Persisted note ordering and draft safety                     | QA-028, QA-029, QA-030                                                                 |
| Note duplication and unsaved-draft safety                    | QA-038, QA-039                                                                         |
| Read-only task discovery and draft safety                    | QA-043, QA-044, QA-045                                                                 |
| Reactive system appearance                                   | QA-022                                                                                 |

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

- [x] **QA-002 — P1 — Single-lockfile workspace install**
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
  - **Status:** Passed on revision `8794918` on 2026-11-05, Linux x86_64, Bun
    `1.4.4-canary.1+b9f2ec363`. The frozen install made no changes. The
    inspected evidence is `docs/artifacts/monorepo/QA-002-install.txt`.

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
resolved. Keep native regression checks pending even when lint is clean.
Baseline at `48e0257`: 177 desktop warnings and zero errors. The other
workspaces had no findings.

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
    shows the test workspace, and its store lock was absent after shutdown.
    `grim -T` exited with SIGSEGV. Later isolated controls showed GPUix native
    initialization can stall before the automation handler starts; one
    test-owned process was waiting during system font loading. A separate
    successful connection then failed a bounds query. Evidence is in
    `docs/artifacts/sorting/diagnosis/`. Draft recovery and restart remain
    unrun. The existing user app was not stopped or captured. Resolve startup
    and client-only capture before rerunning the native cases.

- [ ] **QA-017 — P0 — MCP stdio cancellation and ordering**
  - **Purpose:** Preserve the JSON-RPC protocol and release in-flight work when
    stdio execution moves to Effect.
  - **Prerequisites:** Shared setup and pinned Bun. Use only the in-memory
    streams and disposable child-process data in the existing MCP test file.
  - **Inputs:** `initialize`, `tools/call` for `read_note`, cancellation for the
    same request ID, and existing invalid UTF-8 and oversized frame cases.
  - **Steps:**
    1. From `apps/desktop`, run
       `../../node_modules/.bin/bun test tests/mcp.test.ts` after the stdio
       migration is complete.
    2. Inspect the cases for a request already running at cancellation, outer
       interruption, output ordering and the existing invalid-frame assertions.
    3. Confirm the child process and stream readers end after the test.
  - **Expected results:** The named file passes without skipped assertions.
    Cancellation reaches the in-flight adapter, scoped resources close, and each
    response remains a complete JSON-RPC line in the expected order. Invalid
    input cannot call the adapter. No real client config is modified.
  - **Evidence:** `docs/artifacts/effect-migration/QA-017-mcp.txt`; save the
    command, revision, runtime, test output and any sanitized failure details.
  - **Cleanup:** Existing cases close their streams and child processes. Remove
    only data created by those cases. No other cleanup is required.
  - **Status:** Pending. The named file passed at `c72cf9d`, but a review
    identified cancellation and resource-bound gaps. Rerun after QA-023. Earlier
    evidence: `docs/artifacts/effect-migration/QA-017-mcp.txt`.

## Planned local folder workspace

Acceptance: open one explicitly selected folder, show its Markdown notes, edit
and save a selected note, and return to the existing workspace. Do not migrate,
remove or dual-write existing JSON data. Opening must disclose that the folder
will receive `.still-notes`, standard note folders and an `assets` directory.

Shared setup for QA-016 and QA-018 through QA-021: use an isolated Linux test
session and a unique directory under `/tmp`. Before each case, from the
repository root, create an empty directory with
`VAULT=$(mktemp -d /tmp/still-notes-vault-qa-XXXXXX)`, record its path, then run
`mkdir -p "$VAULT/inbox"` and
`printf 'First line\n' > "$VAULT/inbox/Example.md"`. Use the test-only app data
directory from the shared setup. Keep the user-owned application and its data
untouched. Client-only screenshots are blocked as recorded in QA-015; do not
mark those cases passed until capture works and the evidence is inspected.

- [ ] **QA-016 — P1 — Open a selected folder and return**
  - **Purpose:** Open and close a folder without changing the JSON workspace.
  - **Prerequisites:** Planned folder workflow is implemented; use shared folder
    setup. No other process may hold the isolated folder lock.
  - **Inputs:** The isolated `VAULT` path and `inbox/Example.md` from setup.
  - **Steps:**
    1. In the test app choose **Open folder**, select `VAULT`, and confirm the
       displayed folder path and the listed metadata changes.
    2. Select **Example**, then choose **Back to workspace** without editing.
    3. Reopen the same folder, select **Example**, then return again.
  - **Expected results:** The note shows `First line`. Both opens succeed, the
    return shows the original JSON notes, and closing the folder releases its
    lock. The original Markdown file content remains unchanged.
  - **Evidence:** Save the isolated app tree, folder file listing, and
    screenshots in `docs/artifacts/vault-workspace/QA-016/`; inspect paths and
    note text.
  - **Cleanup:** Close only the test app. After evidence review, remove only the
    recorded `VAULT` and isolated app data directories.
  - **Status:** Blocked. The native host has no documented close veto for
    unsaved drafts, and screenshot capture is blocked by QA-015.

- [ ] **QA-018 — P0 — Save a selected Markdown file**
  - **Purpose:** Save an edit to the selected folder note without changing JSON.
  - **Prerequisites:** Shared folder setup; isolated app and folder open.
  - **Inputs:** Select `Example`; replace its body with `First line` followed by
    a newline and `Saved Ω` followed by a newline.
  - **Steps:**
    1. Record the test app's JSON workspace bytes and `Example.md` bytes.
    2. Edit the selected note, choose **Save**, then choose **Back to
       workspace**.
    3. Reopen the folder and read the note and its file on disk.
  - **Expected results:** The app reports **Saved**; the file and reopened note
    contain exactly the input. JSON workspace bytes do not change.
  - **Evidence:** Save sanitized before/after file hashes, file text, app tree,
    and screenshots under `docs/artifacts/vault-workspace/QA-018/`.
  - **Cleanup:** Close the test app and remove only the recorded isolated data
    after evidence review.
  - **Status:** Blocked. The current hash check and file replacement are not
    atomic against an external writer. Resolve concurrent-write protection
    before enabling editing. Screenshot capture is blocked by QA-015.

- [ ] **QA-019 — P0 — Preserve a draft on an external edit**
  - **Purpose:** Reject a stale write without overwriting disk or losing a
    draft.
  - **Prerequisites:** Shared folder setup; open and select `Example` in the
    test app. The folder must be writable by the test user.
  - **Inputs:** App draft `Local draft Ω`; external file text `Outside change`.
  - **Steps:**
    1. Change the app editor to the draft without saving.
    2. From the repository root write `Outside change` and a newline to the
       recorded `"$VAULT/inbox/Example.md"`, then choose **Save** in the app.
    3. Choose **Back to workspace**, then **Cancel** in the unsaved prompt.
  - **Expected results:** Save reports a conflict; the disk retains
    `Outside change` and the app retains `Local draft Ω`. The app stays in the
    folder after cancel. JSON data is unchanged.
  - **Evidence:** Save the sanitized file contents, app tree, conflict status
    and screenshots in `docs/artifacts/vault-workspace/QA-019/`.
  - **Cleanup:** Close only the test app and remove the recorded isolated data
    after evidence review.
  - **Status:** Blocked. The current hash check and file replacement are not
    atomic against an external writer. Resolve concurrent-write protection
    before enabling editing. Screenshot capture is blocked by QA-015.

- [ ] **QA-020 — P0 — Cancel folder selection and failed open**
  - **Purpose:** Prevent a canceled or unsafe folder open from altering data.
  - **Prerequisites:** Shared folder setup. The picker is available. From the
    repository root run `BAD_VAULT=$(mktemp -d /tmp/still-notes-bad-XXXXXX)`,
    `mkdir -p "$BAD_VAULT/.still-notes"`, and
    `printf '{broken' > "$BAD_VAULT/.still-notes/state.json"`. Record
    `BAD_VAULT`.
  - **Inputs:** Cancel the picker; then select the malformed isolated folder.
  - **Steps:**
    1. Record JSON workspace and malformed metadata bytes.
    2. Choose **Open folder** and cancel the picker.
    3. Choose the malformed folder and confirm the folder-open dialog.
  - **Expected results:** Cancel leaves the JSON workspace active. The invalid
    folder reports an actionable error; its metadata and JSON bytes are
    unchanged. No lock remains after the failed open.
  - **Evidence:** Save sanitized hashes, errors, app tree and screenshots under
    `docs/artifacts/vault-workspace/QA-020/`.
  - **Cleanup:** Close only the test app and remove the two isolated folders and
    app data after evidence review.
  - **Status:** Pending implementation; screenshot capture is blocked by QA-015.

- [ ] **QA-021 — P1 — Folder keyboard and narrow layout**
  - **Purpose:** Keep folder navigation and editing accessible at a narrow size.
  - **Prerequisites:** Shared folder setup, isolated app at 700 by 760 pixels,
    and a working client-only screenshot and accessibility tree capture.
  - **Inputs:** The isolated `Example` note, text `Keyboard save Ω`, and a
    keyboard only.
  - **Steps:**
    1. Open the folder, select the note, edit it and save using only the
       keyboard.
    2. Navigate back to the JSON workspace and inspect focus and status labels.
  - **Expected results:** Each control has a usable name and visible focus; text
    does not overflow the window, and the saved file contains the edit.
  - **Evidence:** Save the client-only screenshot, accessibility tree and saved
    file under `docs/artifacts/vault-workspace/QA-021/` and inspect each one.
  - **Cleanup:** Close only the test app and remove the recorded isolated data
    after evidence review.
  - **Status:** Pending implementation; screenshot capture is blocked by QA-015.

- [ ] **QA-022 — P1 — Follow system appearance**
  - **Purpose:** Make the **System** appearance match the operating system
    rather than the stored workspace theme.
  - **Prerequisites:** A verified native appearance bridge; isolated supported
    desktop sessions with controllable appearance; a working client-only
    screenshot path. Do not change the user's desktop settings.
  - **Inputs:** Appearance values **System**, **Light**, and **Dark** in the
    existing settings dialog, with an isolated light and dark system session.
  - **Steps:**
    1. In an isolated light session, open settings and choose **System**.
    2. Change only the isolated session to dark, then back to light.
    3. Select **Dark** explicitly and change the isolated system appearance.
    4. Restart the app with the same isolated settings and observe its palette.
  - **Expected results:** System mode follows the initial and changed system
    appearance. Explicit dark remains dark. Restart preserves the selected
    setting, text remains readable, and editor controls match the app palette.
  - **Evidence:** Save the appearance values, accessibility tree, and inspected
    client-only screenshots under `docs/artifacts/effect-migration/QA-022/`.
  - **Cleanup:** Close only the isolated app and session. Remove only its
    disposable data after evidence review; do not alter the user's desktop.
  - **Status:** Blocked. GPUix 0.11.0 exposes no documented system appearance
    query or change event. A native bridge and isolated screenshot setup need
    verification before this case can run.

- [ ] **QA-023 — P0 — MCP cancellation and resource bounds**
  - **Purpose:** Prevent a canceled write from overlapping a retry and bound
    outstanding work and output during a stalled client.
  - **Prerequisites:** Shared setup, pinned Bun, and only isolated in-memory
    streams and disposable child-process data from the existing MCP tests.
  - **Inputs:** A `write_note` request with ID 7 whose adapter ignores abort
    until released; a cancellation notification for ID 7; a second request with
    ID 7; and more requests than the implemented active-request limit while
    output is blocked. Use no real vault or client configuration.
  - **Steps:**
    1. From `apps/desktop`, run
       `../../node_modules/.bin/bun test tests/mcp.test.ts` after the
       cancellation fix and cases are complete.
    2. Inspect the new cases and their assertions for delayed adapter
       completion, request-ID reuse, blocked output, bounded work, and shutdown
       cleanup.
    3. Inspect the existing protocol, invalid-frame and cancellation results.
  - **Expected results:** A canceled started mutation cannot be mistaken for a
    completed operation while it still runs, and its ID cannot be reused until
    it settles. Excess work is handled with the documented bounded response;
    cancellation and shutdown still work under backpressure. Existing framing,
    protocol and security cases pass without dropped assertions.
  - **Evidence:** Save the revision, local Bun version, command, full test
    output and sanitized failure details to
    `docs/artifacts/effect-migration/QA-023-mcp-bounds.txt`.
  - **Cleanup:** Close only test-owned streams and child processes; remove only
    isolated test data after inspecting evidence.
  - **Status:** Pending. At `e243eab`, the focused vault and MCP tests passed 69
    tests and 504 assertions, including canceled writes and work bounds.
    Evidence: `docs/artifacts/effect-migration/QA-023-vault-mcp.txt`. An adapter
    or output Promise that ignores cancellation can still run after shutdown.
    Resolve transport ownership before claiming the full case passed.

- [ ] **QA-024 — P0 — Refuse recovery during read-only folder open**
  - **Purpose:** Ensure a read-only folder preview never replays or rolls back a
    pending journal and never alters Markdown content.
  - **Prerequisites:** Shared isolated folder setup; the planned service-owned
    read-only open mode and folder preview are implemented. The path must not be
    a user folder or have another active owner.
  - **Inputs:** From the repository root, use the recorded `VAULT` and run
    `mkdir -p "$VAULT/.still-notes" "$VAULT/inbox"`, then
    `printf 'new' > "$VAULT/inbox/A.md"`. Write the following exact JSON to
    `"$VAULT/.still-notes/transaction.json"`:
    `{"version":1,"files":[{"path":"inbox/A.md","before":"b2xk","after":"bmV3"}],"directories":[]}`.
  - **Steps:**
    1. Record hashes of `A.md` and the pending journal.
    2. In the test app choose **Open folder**, select `VAULT`, and confirm.
    3. Inspect the error, both file hashes, and any test-owned lock file.
  - **Expected results:** Read-only open is refused with recovery guidance.
    `A.md` remains exactly `new`; the journal bytes remain identical. No lock
    remains. The existing JSON workspace stays open and unchanged.
  - **Evidence:** Save sanitized hashes, the error and client-only screenshot in
    `docs/artifacts/vault-workspace/QA-024/`; inspect the files and screenshot.
  - **Cleanup:** Close only the test app. Remove only the recorded isolated
    folder and app data after evidence review.
  - **Status:** Blocked. At `e243eab`, existing vault tests passed with the
    preview mode refusing valid and malformed journals, preserving content and
    releasing its lock. Evidence is in
    `docs/artifacts/effect-migration/QA-023-vault-mcp.txt`. The folder preview
    UI is not yet integrated, and screenshot capture is blocked by QA-015.

- [ ] **QA-025 — P0 — Protect drafts on native close**
  - **Purpose:** Prevent an ordinary window-close request from discarding an
    unsaved folder draft before the user chooses how to proceed.
  - **Prerequisites:** A verified close-veto bridge, isolated native session,
    working client-only screenshot capture, and the folder editor implemented.
    OS shutdown, forced termination and crashes need separate recovery coverage.
  - **Inputs:** Isolated `Example.md` from the folder setup; unsaved text
    `Close draft Ω`.
  - **Steps:**
    1. Open the isolated folder, select `Example`, and enter the unsaved text.
    2. Send an ordinary window-manager close request to the test-owned window.
    3. Choose **Cancel** and confirm the draft is still visible.
    4. Request close again, choose **Save**, and reopen the isolated folder.
  - **Expected results:** The close request is deferred until a choice. Cancel
    leaves the app and draft open. Save completes before close; reopening shows
    the exact text. No user-owned window or data is touched.
  - **Evidence:** Save the client-only screenshots, app tree and isolated file
    content in `docs/artifacts/vault-workspace/QA-025/`; inspect each artifact.
  - **Cleanup:** Close only test-owned processes and remove their isolated data
    after evidence review.
  - **Status:** Blocked. GPUix does not expose a documented close-veto callback,
    and screenshot capture is blocked by QA-015. A native bridge requires
    source, build and platform verification before this scenario can run.

- [x] **QA-026 — P0 — Keep assistant errors free of private details**
  - **Purpose:** Prevent an adapter failure from exposing filesystem paths,
    credentials, or free-text content through a tool response.
  - **Prerequisites:** Shared setup and disposable streams in the existing MCP
    test file; no real user files, credentials or external client.
  - **Inputs:** An adapter failure with the synthetic message
    `/home/example/private.md token=secret-test` and an invalid tool request.
  - **Steps:**
    1. From `apps/desktop`, run
       `../../node_modules/.bin/bun test tests/mcp.test.ts` after the
       error-safety cases are implemented.
    2. Inspect the response assertions for the synthetic adapter failure and
       invalid request, and inspect the test output for regressions.
  - **Expected results:** The client gets a useful safe error. Neither the path
    nor `secret-test` appears in the response. Invalid requests still fail and
    do not invoke the adapter. Existing protocol tests continue to pass.
  - **Evidence:** Save the tested revision, command and output to
    `docs/artifacts/effect-migration/QA-026-027-mcp.txt` and inspect it.
  - **Cleanup:** Close test-owned streams and child processes. Remove only
    disposable test data; no other cleanup is needed.
  - **Status:** Passed at `81e7bbd` on 2026-11-05, Linux x86_64, Bun
    `1.4.4-canary.1+b9f2ec363`. The focused file passed 26 tests and 170
    assertions. Evidence: `docs/artifacts/effect-migration/QA-026-027-mcp.txt`.

- [x] **QA-027 — P1 — Enforce per-frame MCP limits**
  - **Purpose:** Treat valid requests the same regardless of stream chunking
    while rejecting an individually oversized frame.
  - **Prerequisites:** Shared setup and isolated streams in the existing MCP
    test file. No live client or vault is needed.
  - **Inputs:** Two valid newline-delimited ASCII messages, each below the
    existing 4,194,304 UTF-16-code-unit limit but above 2,097,152 code units,
    delivered in one byte chunk; then one message above the frame limit.
  - **Steps:**
    1. From `apps/desktop`, run
       `../../node_modules/.bin/bun test tests/mcp.test.ts` after the
       frame-boundary cases are implemented.
    2. Inspect response and adapter-call assertions for both chunk layouts and
       the individually oversized message.
  - **Expected results:** Both valid messages are handled whether delivered in
    one or separate chunks. The oversized message is rejected without invoking a
    tool, and incomplete input is bounded. Existing protocol cases pass.
  - **Evidence:** Save the tested revision, command and output to
    `docs/artifacts/effect-migration/QA-026-027-mcp.txt` and inspect it.
  - **Cleanup:** Close test-owned streams and child processes. Remove only
    disposable test data; no other cleanup is needed.
  - **Status:** Passed at `81e7bbd` on 2026-11-05, Linux x86_64, Bun
    `1.4.4-canary.1+b9f2ec363`. The focused file passed 26 tests and 170
    assertions, including a split UTF-8 sequence. The limit counts decoded
    UTF-16 code units, not wire bytes. Evidence:
    `docs/artifacts/effect-migration/QA-026-027-mcp.txt`.

- [ ] **QA-028 — P1 — Persist note sorting across views**
  - **Purpose:** Apply the saved note sort choice to the JSON workspace and
    preserve selection and list stability while editing.
  - **Prerequisites:** Shared isolated desktop setup, implemented sorting and
    working client-only screenshots. Start with a new disposable workspace.
  - **Inputs:** Create `Note 2`, `Note 10` and `Pinned note` in that order; pin
    `Pinned note`. Change the first note after creating all three.
  - **Steps:**
    1. Open **Settings**, choose the navigation note sort order `name-asc`, and
       inspect All notes. Choose `name-desc` and inspect the order again.
    2. Select the first unpinned note, edit its title, and inspect the editor
       identity and list order before changing the view.
    3. Choose `created-asc`, `created-desc`, `updated-asc`, `updated-desc`, and
       `none` in turn. Inspect the matching order in All notes, the owning
       notebook, Pinned notes, Trash and an applicable search result.
    4. Use the note-list sort control to reverse a sort direction; close and
       restart only the test app and inspect the choice and order.
  - **Expected results:** Pinned notes remain first. `Note 2` precedes `Note 10`
    in ascending natural order. Each date direction follows the recorded created
    or modified times. `none` uses workspace order. Editing does not switch the
    selected note or unexpectedly reorder the current list. The changed choice
    survives restart, and both controls report the same choice.
  - **Evidence:** Save the test revision, settings file, sanitized app tree and
    client-only screenshots under `docs/artifacts/sorting/QA-028/`; inspect the
    displayed order and selected note.
  - **Cleanup:** Stop only the test app and delete only its isolated data after
    evidence inspection.
  - **Status:** Pending implementation; screenshot capture is blocked by QA-015.
    The current default setting is `none` but is not applied today.

- [ ] **QA-029 — P0 — Keep failed drafts while changing sort**
  - **Purpose:** Ensure ordering changes do not lose or silently save an unsaved
    draft or replace the selected editor.
  - **Prerequisites:** Shared isolated desktop setup, implemented sorting, and
    the draft-rescue scenario in `apps/desktop/scripts/native-regressions.ts`.
    Never use the normal workspace or another process's data.
  - **Inputs:** Use the existing regression's `Regression rescue` note and exact
    Unicode draft; induce its external workspace-byte conflict.
  - **Steps:**
    1. In the isolated test workspace, follow the existing regression to add a
       newline to `workspace.json` and enter the unsaved draft.
    2. Change sort, navigate away and back, and export the pending draft.
    3. Restore the saved workspace bytes, select **Retry**, and inspect the
       resulting note and exported file.
  - **Expected results:** The draft warning stays visible until a successful
    retry. Sorting never switches the editor to another note. Export contains
    exact draft bytes and does not save or clear the draft; retry persists the
    same text after the conflict is removed.
  - **Evidence:** Save a sanitized app tree, screenshots, and hashes of the
    isolated workspace and export in `docs/artifacts/sorting/QA-029/`.
  - **Cleanup:** Restore the original bytes in the isolated workspace, stop only
    the test app, and remove test data only after evidence review.
  - **Status:** Pending implementation and blocked by QA-015 screenshot capture.

- [ ] **QA-030 — P1 — Report a failed sort preference save**
  - **Purpose:** Preserve the last committed ordering and report a settings
    write conflict instead of displaying a choice that was not saved.
  - **Prerequisites:** Shared isolated desktop setup, implemented sorting and no
    second process using the test data. Keep the original settings bytes.
  - **Inputs:** Append one newline to the isolated `settings.json` after the app
    loads, then choose `name-asc` in Settings.
  - **Steps:**
    1. Record the current sort selection and settings bytes in the test folder.
    2. Append the newline and change the sort preference in the running app.
    3. Inspect the error, displayed order and settings file. Restore the saved
       settings bytes, retry the choice and restart the test app.
  - **Expected results:** The conflict is visible; no external setting is
    overwritten and the previous committed order remains active. After the bytes
    are restored, the retry succeeds and the choice survives restart.
  - **Evidence:** Save sanitized app tree, screenshots and hashes under
    `docs/artifacts/sorting/QA-030/` and inspect them.
  - **Cleanup:** Restore only the isolated settings file, stop the test app, and
    remove test data after evidence review.
  - **Status:** Pending implementation and blocked by QA-015 screenshot capture.

- [ ] **QA-032 — P0 — Recover lock failures and list safe folder entries**
  - **Purpose:** Prevent a failed lock write from permanently blocking a vault,
    and preserve correct folder discovery next to unrelated file names.
  - **Prerequisites:** Shared isolated folder setup, Linux for the filename
    case, and the focused cases in the existing vault test file. Tests must not
    alter a real user folder or another process's lock.
  - **Inputs:** A test-owned vault with `Books/A.md`, `Books/Nested/B.md`, and
    an unrelated Linux file `unrelated:backup.txt`; a failed or partial lock
    initialization using the test's isolated failure setup.
  - **Steps:**
    1. From `apps/desktop`, run
       `../../node_modules/.bin/bun test tests/vault.test.ts` after the focused
       cases and fixes are complete.
    2. Inspect assertions for lock-write failure, an externally replaced lock,
       retry, valid note listing and root/nested folder coordinates.
    3. Inspect existing corruption, symlink and writable-recovery results.
  - **Expected results:** A failed initialization removes only the lock it
    created, preserves a replacement lock, and permits a safe retry. A valid
    note beside the unrelated file remains visible, with accurate root and
    nested folder coordinates. Existing path and recovery protections hold.
  - **Evidence:** Save the tested revision, runtime, command and output to
    `docs/artifacts/effect-migration/QA-032-vault-safety.txt`; inspect it.
  - **Cleanup:** The test closes its vaults and removes only its temporary data.
    Keep failed evidence before cleanup; never remove a user-owned lock.
  - **Status:** Pending. At `48c8a7f`, the vault and assistant tests passed 80
    tests and 686 assertions, including root coordinates, lock failure and
    competing owners. Evidence:
    `docs/artifacts/effect-migration/QA-032-root-coordinates.txt`. An earlier
    project-backed temporary run timed out. Unsupported hard links and an
    external lock-path replacement race remain unverified.

- [ ] **QA-033 — P1 — Browse a folder without editing its files**
  - **Purpose:** Open and leave an explicitly selected read-only folder without
    changing its Markdown, attachments, or the existing JSON workspace.
  - **Prerequisites:** Shared isolated desktop and folder setup; implemented
    preview UI; valid test-owned folder with no pending journal. Screenshot
    capture must work without viewing another process's window.
  - **Inputs:** In the isolated `VAULT`, create `Books/A.md` with exact text
    `Preview Ω` and `assets/sample.txt` with exact text `asset`. Record hashes
    of both and of the isolated JSON workspace before opening.
  - **Steps:**
    1. Choose **Open folder**, select `VAULT`, and read the metadata-creation
       disclosure. Cancel once and confirm the JSON workspace stays active.
    2. Open the same folder, accept the disclosure, and select `Books/A.md`.
    3. Inspect the read-only label, content, keyboard focus and available
       controls. Use **Refresh notes**, then return to the JSON workspace.
    4. Compare the recorded hashes and confirm the test vault lock is absent.
  - **Expected results:** The exact text is visible with a clear read-only
    label. No content-editing or mutation action is offered. Cancel and Back
    preserve the JSON workspace. Both input files retain their exact bytes; only
    disclosed app metadata and standard directories may be created.
  - **Evidence:** Save sanitized screenshots, app tree, file hashes and the
    tested revision under `docs/artifacts/vault-workspace/QA-033/`.
  - **Cleanup:** Close only the test app; remove only the isolated test folder
    and data after reviewing evidence.
  - **Status:** Pending implementation; client-only screenshots are blocked by
    QA-015. Vault safety findings are tracked in QA-032.

- [ ] **QA-034 — P0 — Keep pending JSON drafts when opening a folder**
  - **Purpose:** A folder switch must not discard or silently save an unsaved
    draft in the existing JSON workspace.
  - **Prerequisites:** Shared isolated desktop and folder setup, implemented
    preview UI, and the existing native draft-conflict regression scenario.
    Never use a user workspace.
  - **Inputs:** The `Regression rescue` note and Unicode draft from
    `apps/desktop/scripts/native-regressions.ts`, plus isolated `VAULT`.
  - **Steps:**
    1. Follow the existing regression to induce an external byte conflict and
       enter the unsaved note draft in the test-owned JSON workspace.
    2. Choose **Open folder** and inspect the response and current editor.
    3. Export the draft, restore the isolated workspace bytes, then retry save.
  - **Expected results:** Folder preview does not open while the draft is
    pending. Clear recovery guidance remains visible. Export has the exact draft
    bytes without saving it; retry saves only after the conflict is removed.
  - **Evidence:** Save the sanitized app tree, screenshots and isolated file
    hashes under `docs/artifacts/vault-workspace/QA-034/`.
  - **Cleanup:** Restore only test-owned workspace bytes, stop the test app and
    remove its isolated data after evidence review.
  - **Status:** Pending implementation and blocked by QA-015 screenshot capture.

- [ ] **QA-035 — P0 — Keep a search fallback note selected during sorting**
  - **Purpose:** Sorting must not replace the active editor or hide a draft when
    the current note comes from the first search result.
  - **Prerequisites:** Shared isolated desktop setup; note sorting implemented;
    no user workspace. Create notes `Apple`, `Apricot`, and `Banana` with
    distinct content and select `Banana`.
  - **Inputs:** Search for `Ap`, select no result manually, then reverse name
    sorting while the first result is displayed.
  - **Steps:**
    1. In **Settings**, select `name-asc`, then search for `Ap`.
    2. Record the title and content of the editor that appears.
    3. Reverse the sort using the note-list control and inspect the editor.
  - **Expected results:** The list changes order, but the original fallback
    editor remains on the same note with the same content. No save, edit, or
    draft export is applied to another note.
  - **Evidence:** Save the sanitized native app tree and client-only screenshots
    under `docs/artifacts/sorting/QA-035/` with the tested revision.
  - **Cleanup:** Stop only the test app; remove its isolated data after review.
  - **Status:** Blocked. The source fix is committed, but the isolated native
    diagnostic could not reach this scenario: two handshakes timed out, and a
    third connection failed its bounds query. Evidence:
    `docs/artifacts/sorting/native-tree-regression.log`. Screenshot capture is
    also blocked by QA-015.

- [ ] **QA-036 — P1 — Re-sort when leaving an edited note**
  - **Purpose:** Keep the list stable during an edit, then apply the chosen
    ordering once the user selects another note.
  - **Prerequisites:** Shared isolated desktop setup and note sorting enabled.
  - **Inputs:** Create `Note 2` and `Note 10`; choose `name-asc`.
  - **Steps:**
    1. Select `Note 2` and rename it `Note 20`.
    2. Confirm the editor stays on `Note 20` while editing.
    3. Select `Note 10` without changing view, filter, sort or pin state.
  - **Expected results:** The edited note remains stable during editing. After
    selecting `Note 10`, the list orders `Note 10` before `Note 20`, and the
    editor shows `Note 10`. No note content is lost.
  - **Evidence:** Save the sanitized app tree and client-only screenshots in
    `docs/artifacts/sorting/QA-036/`, with the tested revision.
  - **Cleanup:** Stop only the test app; remove its isolated data after review.
  - **Status:** Blocked. The source fix is committed, but the isolated native
    diagnostic failed before this scenario. Evidence:
    `docs/artifacts/sorting/native-tree-regression.log`. Screenshot capture is
    also blocked by QA-015.

- [ ] **QA-037 — P1 — Expose selected sort choices accessibly**
  - **Purpose:** Let keyboard and assistive-technology users identify and change
    the current note sort option without relying on color.
  - **Prerequisites:** Shared isolated desktop setup; a platform accessibility
    inspector and working screenshot capture.
  - **Inputs:** Open **Settings** and select `name-asc`, then `created-desc`.
  - **Steps:**
    1. Reach both choices with the keyboard and inspect each control's role,
       accessible name and selected or pressed state.
    2. Activate `created-desc` with the keyboard and inspect both states again.
  - **Expected results:** Exactly the current choice exposes a valid selected or
    pressed state for its native role, and both choices remain keyboard
    operable. The new state is announced without relying on visual color.
  - **Evidence:** Save the sanitized accessibility tree and client-only
    screenshots under `docs/artifacts/sorting/QA-037/`.
  - **Cleanup:** Stop only the test app; remove its isolated data after review.
  - **Status:** Pending. The invalid button state was removed, and selected
    choices now include visible and accessible text. GPUix does not expose a
    pressed state for these buttons; inspector and keyboard verification remain
    open. Screenshot capture is blocked by QA-015.

- [ ] **QA-038 — P1 — Duplicate a note in its notebook**
  - **Purpose:** Create an independent copy with the same displayed content
    while retaining the original note and notebook.
  - **Prerequisites:** Shared isolated desktop setup and implemented duplicate
    action. Use only the test-owned JSON workspace.
  - **Inputs:** A pinned note `Plan` with body `First line Ω` and an existing
    note `Plan copy` in the same notebook.
  - **Steps:**
    1. Select `Plan` and activate **Duplicate note** with the keyboard.
    2. Inspect the selected copy, its notebook, title, body and pinned state.
    3. Change the copy's body to `Copy only`, then reopen the original note.
    4. Restart only the test app and inspect both notes again.
  - **Expected results:** The new unpinned note is `Plan copy 2`, belongs to the
    same notebook and initially has the exact body. Editing the copy does not
    change the original. Both persist after restart. The action is not offered
    for a trashed note.
  - **Evidence:** Save sanitized app trees, client-only screenshots and the
    isolated workspace snapshot in `docs/artifacts/duplication/QA-038/`.
  - **Cleanup:** Stop the test app and remove only isolated data after review.
  - **Status:** Pending implementation; screenshot capture is blocked by QA-015.

- [ ] **QA-039 — P0 — Preserve a draft on duplicate failure**
  - **Purpose:** A failed duplicate must not lose, clear, or falsely save the
    original note's unsaved title or body.
  - **Prerequisites:** Shared isolated desktop setup, implemented duplicate
    action and the existing draft-conflict regression scenario.
  - **Inputs:** The `Regression rescue` note and exact Unicode draft from
    `apps/desktop/scripts/native-regressions.ts`; induce its workspace-byte
    conflict before attempting to duplicate.
  - **Steps:**
    1. Follow the existing regression to create the pending draft and conflict.
    2. Attempt **Duplicate note**, then inspect the error, list and draft.
    3. Export the draft, restore the isolated workspace bytes, retry save and
       duplicate it again.
  - **Expected results:** The first duplicate fails visibly with no new note or
    workspace write; the draft warning and exact title/body remain. Export has
    the exact draft bytes without clearing it. After recovery, the copy has the
    saved content and the original remains independently editable.
  - **Evidence:** Save sanitized app tree, screenshots and isolated file hashes
    under `docs/artifacts/duplication/QA-039/` with the tested revision.
  - **Cleanup:** Restore only test-owned bytes, stop the test app and remove
    isolated data after evidence review.
  - **Status:** Pending implementation; screenshot capture is blocked by QA-015.

- [ ] **QA-040 — P0 — Recover an uncertain atomic write**
  - **Purpose:** Prevent duplicate writes or lost drafts if a file replacement
    succeeds but directory synchronization reports failure.
  - **Prerequisites:** A disposable fault-injection filesystem and a verified
    method to fail directory synchronization after a successful rename. Do not
    use a user workspace. The setup method and command are not yet known.
  - **Inputs:** An isolated JSON workspace with note `Uncertain` and draft
    `Unsaved Ω`. Inject the failure only for the test-owned workspace write.
  - **Steps:**
    1. Identify and document a reproducible isolated filesystem fault method.
    2. Save the draft while the fault is active; inspect the visible error,
       workspace bytes, backup and draft state.
    3. Remove the fault, retry or use the provided recovery path, and restart.
  - **Expected results:** The app does not falsely mark an uncertain write as
    durable, lose the draft, overwrite an external change, or create a second
    duplicate on retry. Recovery is explicit and preserves both disk evidence
    and draft content until reconciliation succeeds.
  - **Evidence:** Save the tested revision, exact setup, sanitized diagnostics,
    app state and file hashes under `docs/artifacts/storage/QA-040/`.
  - **Cleanup:** Stop only test-owned processes and remove only isolated fault
    resources and data after evidence review.
  - **Status:** Blocked. The existing writer can throw after rename, and the
    required isolated fault mechanism and reconciliation behavior are
    unverified.

- [ ] **QA-041 — P0 — Duplicate a pending draft without clearing it**
  - **Purpose:** Copy the displayed draft while preserving the original draft as
    unsaved until the user explicitly saves it.
  - **Prerequisites:** Shared isolated desktop setup, duplicate action and the
    existing draft-conflict regression scenario; no user data.
  - **Inputs:** `Regression rescue` and its exact Unicode draft from
    `apps/desktop/scripts/native-regressions.ts`.
  - **Steps:**
    1. Induce the existing workspace-byte conflict and enter the pending draft.
    2. Restore the original isolated workspace bytes but do not retry the draft.
    3. Duplicate the note, inspect the copy, and return to the original note.
  - **Expected results:** The copy contains the exact displayed draft and has a
    new identity. The original draft warning remains until its own save
    succeeds; duplicating it does not silently change the original saved body.
  - **Evidence:** Save sanitized app trees, screenshots and isolated workspace
    contents under `docs/artifacts/duplication/QA-041/` with the revision.
  - **Cleanup:** Restore only test-owned bytes; stop the test app and remove its
    isolated data after evidence review.
  - **Status:** Pending UI integration and blocked by QA-015 screenshot capture.

- [ ] **QA-042 — P0 — Recover an interrupted stale-lock recovery**
  - **Purpose:** Ensure a process crash during stale-lock recovery cannot leave
    a vault permanently blocked or let two live processes acquire it.
  - **Prerequisites:** Shared isolated folder setup, focused existing vault
    tests and a reproducible test-owned child-process interruption. Never use a
    user folder or remove a lock held by a live process.
  - **Inputs:** An isolated vault, a dead test child owner and an interrupted
    stale-lock recovery marker created by the focused test setup.
  - **Steps:**
    1. From `apps/desktop`, run the relevant existing vault test file after the
       crash-recovery case and fix are complete.
    2. Inspect assertions for a dead recovery owner, a live owner, simultaneous
       recovery attempts and preserved Markdown bytes.
  - **Expected results:** A dead recovery owner can be recovered without manual
    deletion. A live owner remains protected. Concurrent attempts cannot both
    acquire the vault, and notes and metadata retain their original bytes.
  - **Evidence:** Save the tested revision, runtime, command and output in
    `docs/artifacts/effect-migration/QA-042-lock-recovery.txt` and inspect it.
  - **Cleanup:** Stop only test-owned children; remove only isolated test data
    after evidence review.
  - **Status:** Pending. The fixed recovery marker can remain after process
    termination and has no recorded owner for safe stale recovery.

- [ ] **QA-043 — P1 — Browse workspace tasks without changing notes**
  - **Purpose:** Find open and completed Markdown tasks in the JSON workspace
    and open their source notes without mutating task state.
  - **Prerequisites:** Shared isolated desktop setup, implemented read-only task
    view, and a test-owned workspace. Screenshot capture must not expose any
    other window.
  - **Inputs:** Note `Plans` with body `- [ ] Call Ω
- [x] Ship `and note  `Code`with a fenced code block containing`- [ ] Not a
      task`. Move another task-bearing note to Trash.
  - **Steps:**
    1. Open **Tasks** and inspect the visible task labels and completion states.
    2. Search for `Call`, then clear the search. Activate `Call Ω` by keyboard.
    3. Inspect the opened note and compare all saved note bodies with inputs.
  - **Expected results:** The view is clearly read-only, shows `Call Ω` as open
    and `Ship` as complete, and excludes fenced-code and trashed tasks. Search
    narrows the list. Activation opens `Plans` without toggling or rewriting it.
  - **Evidence:** Save sanitized app trees, client-only screenshots and isolated
    workspace hashes under `docs/artifacts/tasks/QA-043/`.
  - **Cleanup:** Stop only the test app and remove its isolated data after
    evidence review.
  - **Status:** Blocked. The task view is not implemented. GPUix needs a
    verified live-region announcement API for changing results. Screenshot
    capture is also blocked by QA-015.

- [ ] **QA-044 — P0 — Show pending draft tasks without saving them**
  - **Purpose:** Task discovery must use unsaved draft content without clearing
    the draft, writing the workspace, or opening a different note.
  - **Prerequisites:** Shared isolated desktop setup, implemented read-only task
    view and the existing draft-conflict regression scenario.
  - **Inputs:** The `Regression rescue` draft with appended text `
- [ ] Draft task 🌿`; induce the workspace-byte conflict.
  - **Steps:**
    1. Create the pending draft using the existing conflict scenario.
    2. Open **Tasks**, find `Draft task 🌿`, and activate its note.
    3. Inspect the draft warning and workspace bytes, then export the draft.
  - **Expected results:** The draft task is visible and identifies the original
    note. Navigation preserves the exact unsaved text and warning. The disk
    workspace stays unchanged and export contains the exact draft bytes.
  - **Evidence:** Save sanitized app trees, screenshots and isolated file hashes
    under `docs/artifacts/tasks/QA-044/`.
  - **Cleanup:** Restore only test-owned workspace bytes, close the test app and
    remove isolated data after evidence review.
  - **Status:** Blocked. The task view is not implemented. GPUix needs a
    verified live-region announcement API for changing results. Screenshot
    capture is also blocked by QA-015.

- [ ] **QA-045 — P1 — Report task parsing errors and empty results**
  - **Purpose:** Distinguish a task parse failure from a genuinely empty view.
  - **Prerequisites:** Shared isolated desktop setup and implemented task view.
  - **Inputs:** A valid note without tasks; a note containing the malformed
    frontmatter `--- x: [broken

---

- [ ] Example`.
  - **Steps:**
    1. Open **Tasks** with only the valid note and inspect the empty message.
    2. Add the malformed note, reopen **Tasks**, and inspect the error state.
    3. Correct the malformed frontmatter and refresh the task view.
  - **Expected results:** The valid workspace shows an empty result, not an
    error. The malformed input produces a visible safe error, not a false empty
    result; correcting it allows `Example` to appear without data loss.
  - **Evidence:** Save sanitized app trees, screenshots and the tested revision
    under `docs/artifacts/tasks/QA-045/`.
  - **Cleanup:** Stop only the test app and remove isolated data after review.
  - **Status:** Blocked. The task view is not implemented. GPUix needs a
    verified live-region announcement API for changing results. Screenshot
    capture is also blocked by QA-015.

- [ ] **QA-046 — P0 — Duplicate immediately after typing**
  - **Purpose:** Ensure a fast duplicate action does not copy an older render
    while a native editor change is still pending.
  - **Prerequisites:** Shared isolated desktop setup, implemented duplicate
    action, working native automation and client-only screenshot capture.
  - **Inputs:** A test-owned note `Quick copy` with body `Before`. Append the
    exact text ` Ω` and activate **Duplicate note** immediately afterward.
  - **Steps:**
    1. Focus the note body and enter the suffix with native keyboard input.
    2. Activate **Duplicate note** immediately, without switching notes.
    3. Inspect the original, copy and persisted workspace after both settle.
  - **Expected results:** Both the visible original and independent copy contain
    `Before Ω`; the copy does not contain an earlier body. No draft is silently
    cleared or written to a different note.
  - **Evidence:** Save the native interaction trace, sanitized app tree and
    isolated workspace snapshot under `docs/artifacts/duplication/QA-046/`.
  - **Cleanup:** Stop only the test app and remove isolated data after evidence
    review.
  - **Status:** Pending. Source review found the action reads a rendered-note
    ref while edits first update a separate pending-draft ref; whether native
    event timing can expose an older value is unverified. QA-015 blocks capture.

- [ ] **QA-047 — P0 — Protect reserved vault paths across case variants**
  - **Purpose:** Prevent root aliases or note IDs with different letter case
    from reaching protected folders on case-insensitive filesystems.
  - **Prerequisites:** Isolated disposable vaults in both primary layouts. Run
    focused vault tests on Linux and repeat on case-insensitive macOS and
    Windows filesystems. Do not use a user vault.
  - **Inputs:** Protected `trash`, `archive`, `quick`, `assets`, and applicable
    `inbox` directories with test-owned notes or assets. Try `Trash`, `TRASH`,
    `Archive`, `Quick`, `Assets` and `Inbox`, including nested paths.
  - **Steps:**
    1. Record hashes for protected test files and metadata in both layouts.
    2. Run `bun test --timeout 30000 tests/vault.test.ts` from `apps/desktop`
       using isolated temporary storage and inspect mixed-case mutation cases.
    3. On each case-insensitive platform, repeat root-alias create, rename,
       move, duplicate and confirmed-delete attempts with the inputs above.
    4. Use the canonical system-area operations and inspect normal folder use.
  - **Expected results:** Mixed-case aliases fail closed without changing any
    protected file or metadata. Canonical system operations and valid normal
    folders continue to work. Both layouts remain usable after reopening.
  - **Evidence:** Save sanitized focused test output, platform and filesystem
    details, hashes and tested revision under `docs/artifacts/vault/QA-047/`.
  - **Cleanup:** Close test vaults and remove only isolated test data after
    evidence review.
  - **Status:** Pending. Source review identified a case-sensitive comparison;
    no case-insensitive platform run has verified the defect or repair.

- [ ] **QA-048 — P1 — Development startup and shutdown**
  - **Purpose:** Distinguish a normal Turbo shutdown message from a desktop
    startup error and confirm the development process exits cleanly.
  - **Prerequisites:** No other development process; an isolated data directory;
    project-local pinned Bun; a working GPUix display. Do not use personal data.
  - **Inputs:** `GPUIX_BACKGROUND=1` and `STILL_NOTES_DATA_DIR` set to the
    absolute path of an empty test-owned directory.
  - **Steps:**
    1. From the repository root, run `bun run dev` with the stated environment
       values and save its output to a local artifact.
    2. Confirm the test-owned window opens and leave it idle.
    3. Send Ctrl+C once to that command and wait for Turbo to stop its tasks.
    4. Check that its child process exits and its test workspace lock is gone.
  - **Expected results:** The desktop starts without an earlier error. Turbo may
    report cache finalization and task shutdown after Ctrl+C; this message alone
    is not an error. The test process exits without a stale lock.
  - **Evidence:** Save sanitized command output, exit status, tested revision
    and process cleanup result under `docs/artifacts/dev/QA-048/`.
  - **Cleanup:** Stop only processes started by this case and remove the
    isolated directory after evidence review.
  - **Status:** Pending. At `d55cf29`, an isolated run with a test-only font
    configuration logged window creation and mount completion. After a timed
    SIGINT, Turbo logged task shutdown and the workspace lock was absent.
    Evidence: `docs/artifacts/dev/QA-048/dev-output.txt`. The timeout wrapper
    returned 124 as expected after its deadline. Default system-font startup,
    visual output and exact child-process cleanup remain unverified.
