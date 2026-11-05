# Agent Instructions

| Profile         | Choice                                                         |
| --------------- | -------------------------------------------------------------- |
| Runtime         | Pinned Bun; ESM                                                |
| Package model   | Bun workspaces; Turborepo tasks                                |
| Backend         | Effect RPC/HTTP and OpenAPI with Effect Bun adapter            |
| Validation      | Effect Schema/Config; QA execution requires approval           |
| Tooling         | Native `bun lint`, `bun fmt`, `bun check`; `bunfig.toml`       |
| Deployment      | Bun containers; web SSR and API may use separate processes     |
| Additional apps | React desktop with GPUIX, mobile with Expo, extension with WXT |

## Scope and priority

### Instruction scope

- Read the closest project-specific `AGENTS.md` before changing code.
- If a user asks to update `AGENTS.md` only, edit only `AGENTS.md`. Do not
  change source files, dependencies, lockfiles, or generated files.

### Code discovery

- Before code search, use Code Index MCP (`code-index-mcp`). Select the project
  with `set_project_path` and check `get_settings_info`.
- Keep its file watcher off. Set `enabled: false` with `configure_file_watcher`,
  select the same project again, and verify `active: false` with
  `get_file_watcher_status` before building a deep index.
- Use `search_code_advanced` and `find_files` for code context. Follow pagination
  with `start_index` when `has_more` is true. Use `refresh_index` for a stale
  file index.
- Build a deep index only when symbol data is needed, with `max_workers: 1`.
  Use `get_file_summary` and `get_symbol_body` for focused symbol context.
- If required files are absent from the index or the server is unavailable,
  use native search and state the reason.

### Change and document limits

- Inspect existing callers, types, and configuration before editing.
- Make the smallest complete change. Reuse existing code before adding helpers,
  abstractions, dependencies, or configuration.
- Preserve unrelated user changes. Never reset, delete, or overwrite them.
- Only `AGENTS.md`, `README.md`, `LICENSE.md`, and `QA.md` may be committed as
  Markdown files in application repositories. Keep `QA.md` at the repository
  root. Put other detailed plans and working documents in gitignored `docs/`.
  Keep `README.md` focused on project overview, setup, usage, and license.
- Preserve the project's license. Do not add or change a license without an
  explicit request.

## Readability contract

### Names and workflow structure

- Optimize code for the maintainer who reads it, not for the fewest lines.
  Keep correctness, security, and runtime boundaries intact.
- Use business names for modules, functions, inputs, and results. Avoid broad
  names such as core, manager, processor, or operations when a specific name
  exists.
- Write business workflows in execution order. Prefer `Effect.gen` for
  multi-step Effect workflows. Use `pipe` for short transformations. Do not
  nest callbacks when sequential code is easier to follow.
- Use ordinary TypeScript for simple synchronous calculations and choices.
  Use Effect APIs when they improve typed errors, dependency management,
  concurrency, resource safety, or exhaustive matching. Do not use `Match`
  for a simple choice unless its exhaustive checks improve the result.
  Use Effect date and duration APIs for application time logic. Keep native
  APIs required by the runtime and validation at required boundaries.
- Use a named input object when several arguments have the same type, or
  when callers cannot tell what each argument means.
- Keep reusable query and mutation definitions in feature query modules.
  Keep rendering components free of transport and persistence details.
  Hooks own focused interactive workflows, not all page responsibilities.

### Contracts and review

- Use one canonical schema for each boundary contract. Reuse it when
  boundaries have the same meaning. Define a separate schema only when
  accepted data or guarantees differ. Keep validation at required boundaries.
- Explain non-obvious state transitions, retry rules, and idempotency
  decisions with short comments. Do not comment obvious syntax.
- Before completion, trace one changed workflow from its entrypoint to its
  result. Remove unclear names, needless forwarding, and hidden dependencies
  on that path.
- When the project has a user-approved reference workflow, read its files
  before changing a similar workflow. Follow its naming, dependency, and
  control-flow patterns. Do not call an example approved without user review.
  If none exists, propose one small existing workflow for review; do not
  refactor unrelated code to create an example.

## General scope

- These instructions define a reusable stack, not a product specification.
- Get product requirements, roles, integrations, and release scope from the
  current project and user request. Do not assume a product domain, login
  method, subject fields, or client identifier.
- Add optional services and dependencies only when the requested feature needs
  them. Do not add AI, email, storage, queues, payments, or background jobs in
  advance.

## Standard stack

### Runtime and application layers

- **Runtime and package manager:** Bun, Bun workspaces, and ESM. Use Bun for
  dependency installation, scripts, builds where supported, and production.
- **Language and typecheck:** TypeScript 7 semantics through `bun check`.
  Use `@yopem/typescript-config` when compatible with the selected Bun version.
  Do not use `tsrs`, `tsc`, or another tool to run typechecks.
- **Application foundation:** Effect v4 or the latest release with a major
  version of 4 or higher. Use Effect for business logic, typed errors, services,
  dependency injection, concurrency, retries, timeouts, resource management,
  logging, tracing, and application configuration.
- **Frontend:** React 19, TanStack Start, TanStack Router, TanStack Query, and
  TanStack Form (`@tanstack/react-form`). Add TanStack Table and TanStack Virtual
  only when needed. Effect does not replace framework routing or UI state.
- **PWA:** required for the web app. Use `vite-plugin-pwa` with a web
  manifest, service worker, install icons, and offline fallback.
- **Styling and UI:** StyleX and source-owned Yopem UI components built on
  Base UI. Use `@yopem-ui/cli` to install them. Keep semantic tokens and SSR-safe
  theme handling.
- **Backend and client contract, required:** Effect RPC and Effect Schema.
  Use Effect RPC for application calls between the frontend and backend.
  Use Effect HTTP APIs for RPC transport, health checks, auth callbacks,
  webhooks, and required non-RPC handlers. Generate OpenAPI from Effect HTTP
  API contracts and serve the specification from the backend.
  Do not use Hono, Hono RPC, Elysia, Express, or a second application server.
- **HTTP runtime adapter:** the Bun HTTP server adapter compatible with the
  pinned Effect release. Effect owns handlers, Layers, startup, and shutdown.
  Do not call `Bun.serve` directly or export a default Bun fetch-server object.

### Data and integrations

- **Database:** PostgreSQL through Drizzle ORM's native Bun SQL adapter.
  Bun SQL owns database connections; Effect services own their use and lifetime.
  Use Effect Schema at data-access boundaries. Use Drizzle Kit for migrations
  and Drizzle Studio for inspection. Do not add `pg`, Postgres.js, or a second
  Effect SQL connection pool.
- **Cache:** Bun's native Redis client behind Effect services.
- **Queue, when requested:** BullMQ in `packages/queue`, connected to the
  project's Redis instance. Add it only when a feature needs durable background
  work.
- **Storage:** Bun's native S3 client behind Effect services. Use it for
  Cloudflare R2 or another configured S3-compatible service.
- **Media, when needed:** `Bun.Image` behind an Effect service. Verify support
  in the pinned Bun build before use.
- **Authentication, when needed:** the OpenAuth client behind Effect services,
  using the existing issuer at `https://auth.yopem.com`. Obtain client and
  subject contracts from the project. Do not embed another issuer.
- **AI, when requested:** Effect AI with a compatible provider. Use Effect
  Schema for structured output and tools. Do not add TanStack AI or another
  AI application library.
- **Analytics:** Google Analytics 4 and Umami, loaded by one client module
  and configured through public `.env` values.
- **Payments, when requested:** Polar hosted checkout, customer portal, and
  signed webhooks. Never collect card data.

### Validation and build tools

- **Validation and configuration:** Effect Schema and Effect Config through
  `packages/env`. Do not add Zod or Valibot as parallel validators.
- **Tooling:** `bun lint`, `bun check`, and `bun fmt`. Use Turborepo for
  workspace task ordering and caching. Do not use Vite+.

Use Vite only for frontend development and builds required by TanStack Start
and StyleX. Run its CLI with Bun. Do not replace required framework plugins
with an unsupported Bun bundler setup. Backend builds use `bun build`.
Vite does not own lint, format, typecheck, or monorepo task configuration.

### Runtime and tool compatibility

- `bun lint` currently requires Bun canary. Pin an exact tested Bun version
  and revision for developers, CI, and container images. Do not depend on a
  moving canary tag as a reproducible version.
- Confirm `bun lint`, `bun check`, and `bun fmt` exist in that build before
  setup. Read its command help and current documentation. Report missing
  features instead of silently replacing the requested toolchain.
- A setup may require `bun upgrade --canary`. Do not change a user's global
  Bun installation without approval. Configure project and CI versions explicitly.
- Pin compatible Effect packages, Drizzle ORM, Drizzle Kit, and Turborepo.
  Read documentation for those versions before selecting APIs.
- The Effect Bun HTTP adapter internally calls `Bun.serve`. The rule above bans
  direct application use, not the adapter's internal implementation. Effect is
  not a separate socket runtime. If a project bans even indirect use of
  `Bun.serve`, report this conflict before setup. Get approval for a compatible
  Effect Node HTTP adapter running under Bun; do not silently switch adapters.
- Keep Bun clients and platform adapters server-only. Browser-safe Effect
  schemas and RPC contracts must not import them.

### Additional app targets

Add these apps only when the project has that target. Use React for each one.
Share business rules, RPC contracts, and validation through `packages/`. Keep
platform UI in the owning app; do not import web components or browser routing
into desktop, mobile, or extension apps. Do not create a shared UI package.

- **Desktop:** use GPUIX from https://gpuix.dev. GPUIX renders a React tree with
  GPUI, Zed's GPU UI framework, without Electron or a web view. Add
  `@gpuix/react`, `@gpuix/native`, and `react` to `apps/desktop`. Keep source in
  `apps/desktop/src/`. Pin the adapter and `@gpuix/native` to the same exact
  version; GPUIX is pre-1.0 and can break between releases. Set
  `jsxImportSource` to `@gpuix/react`, call `render()` in `src/app.tsx`, and run
  `bun --hot src/app.tsx` for development. Build a binary
  with `bun build --compile`. Add cargo-packager only when the project ships
  installers. Layout and text use GPUI, not the DOM.
- **Mobile:** use Expo from https://docs.expo.dev with React Native. Add
  `apps/mobile` with Expo Router and file-based routes in `src/app/`. Use the local
  `npx expo` CLI; the global `expo-cli` is deprecated. Keep `app.json` or
  `app.config.ts` as the source of native configuration. Do not commit generated
  `ios/` and `android/` directories; apply native changes through config plugins
  and `npx expo prebuild`. Keep the Hermes and New Architecture defaults. Use
  Expo Build, Expo Submit, and Expo Update for releases.
- **Browser extension:** use WXT from https://wxt.dev. Add `apps/extension` with
  `@wxt-dev/module-react` and `srcDir: 'src'`. Keep `src/entrypoints/` for the
  background service worker, content scripts, popup, options, and side panel.
  Use Manifest V3 unless a required store target does not support it. Run
  `wxt dev`, `wxt build`, `wxt zip`, and `wxt submit` from `apps/extension`.
  Use hash mode for extension pages; their URLs are static files. Keep extension
  APIs in entrypoints or app-only modules.

## Effect version policy

- Before setup or an upgrade, check the official Effect release information
  and package registry. Select the latest release with a major version of 4
  or higher. If v4 is available only as a prerelease, use the latest v4
  prerelease. Do not assume the registry's `latest` tag points to v4 or higher.
- Pin the selected version. Keep all Effect packages and integrations compatible
  with that release. Do not mix Effect major versions or imports from different
  releases.
- Never install, recommend, or write code for Effect v3 or earlier. This rule
  applies to dependencies, imports, APIs, examples, and generated code.
- Read official documentation and migration guidance for the selected release
  before writing code. Do not copy v3 APIs or package paths from old tutorials,
  search results, or model memory. Verify each API and import against that
  release.
- If an existing project uses Effect v3 or earlier, report the conflict and
  obtain approval for migration before writing Effect code. Do not extend the
  old implementation or silently downgrade to satisfy an integration.
- If a required integration does not support v4 or higher, report the blocker.
  Do not use v3 or earlier as a fallback.

## Tooling and configuration

### Configuration ownership

- Root `package.json` owns Bun workspaces, the pinned package manager, root
  scripts, and tooling dependencies. Commit one `bun.lock`. Do not add pnpm,
  npm, or Yarn lockfiles.
- `bunfig.toml` owns native lint, format, and supported native check options.
  Use only options documented for the pinned Bun build. Prefer `[lint]`,
  `[lint.rules]`, and `[fmt]` where supported. Do not invent a `[check]` table.
  `tsconfig.json` owns TypeScript compiler options and file selection.
  `vite.config.ts` owns only required frontend plugins and builds. Do not
  install Vite+.
- Verify how the pinned `bun lint` reads existing ESLint or Oxlint configs
  before migration. Move effective rules into the native Bun policy. Do not
  require standalone Oxlint/Oxfmt runners or keep competing config files.
  If a required rule or setting cannot migrate, report a blocker; do not
  silently drop it or add a fallback runner.

### Shared presets and rule support

- Pin compatible shared preset and plugin versions when used.
- Reuse `@yopem/oxlint-config` presets for React, TanStack Start, and Effect
  only when the pinned Bun linter supports their config and plugin APIs.
  Verify shared type-aware settings, plugin registration, and overrides.
  Do not assume all Oxlint plugins run unchanged in Bun. Missing required
  preset or plugin support blocks setup; do not silently omit it.
- Verify `@yopem-ui/oxlint-plugin`, React Doctor rules, and React Compiler
  diagnostics against Bun's plugin support. Check allowed and rejected examples
  before claiming enforcement. Report unsupported integrations as blockers;
  do not silently run standalone Oxlint or ESLint as a replacement.
- Prohibit `useEffect`, `useCallback`, and `useMemo`. Use the compatible shared
  React policy when available, or a supported import and call restriction.
  Do not assume memoization warnings enforce the hook ban.

### Format and TypeScript policy

- Put no semicolons, double quotes, 80-column lines, trailing commas, and import
  ordering in `[fmt]`. Keep one format policy. Migrate generated formatter
  settings only after confirming equivalent Bun support.
- Extend compatible `@yopem/typescript-config/base` or `/react` presets. Keep
  strict types and browser/server import boundaries. Add `@types/bun` and the
  `bun` type entry only to workspaces that need Bun APIs. Do not give browser
  code server globals merely to suppress errors.
- Use `bun check` for package typecheck scripts and CI. It checks types; it
  does not emit JavaScript or declarations. Do not use `tsc` or `tsrs` as a
  fallback. Report a separate declaration-build need before selecting tooling.
- Read scripts before commands. A script named `check`, `lint`, or `fmt` can
  shadow the native Bun command. Use `--no-script` when native execution is
  required, especially inside Turborepo tasks. Do not create recursive scripts.

### Lint suppression: last resort only

- Read the exact `bun lint` diagnostic and rule requirements. Fix the cause
  first. Try a code change or refactor that preserves behavior and satisfies
  the rule. Do not add a disable comment as the first solution.
- Allow a suppression only when no correct code change or refactor can satisfy
  the rule. State which alternatives failed and why the exception is needed.
- For `bun lint`, use `eslint-disable-next-line <rule-name>` or
  `eslint-disable-line <rule-name>` only. Never use `oxlint-disable` comments.
- Limit each suppression to the exact rule and one affected line. Add a nearby
  comment that explains why the exception is necessary. Do not use file-wide,
  block-wide, or rule-free disable comments.
- During an approved lint run, rerun the affected lint command after the change
  and confirm that the exception is still required and other checks pass.
  Follow the Validation workflow for execution approval.

### Workspace tasks and cache safety

- Install Turborepo as a pinned root development dependency. Root scripts run
  the installed `turbo` CLI through Bun. Workspaces define the leaf scripts.
  Do not make a leaf task call the same root Turbo task recursively.
- Use `turbo.json` for dependency ordering and caching. Build tasks depend on
  required upstream builds, normally `^build`. Declare actual outputs, not
  guessed framework paths. Track source, lockfile, shared config, Bun revision,
  and environment inputs that affect results.
- Keep development tasks `persistent: true` and `cache: false`. Disable caching
  for format writes, lint fixes, migrations, seeds, deployment, and every task
  with external mutations. Never replay a cached result as proof of a write.
- Cache lint, format checks, typechecks, and builds only with complete inputs.
  Each package typecheck must select its own `tsconfig.json`; a root check in
  the wrong directory must not substitute for workspace coverage.
- Include shared `bunfig.toml`, TypeScript presets, and lint config in relevant
  task inputs. Account for runtime environment pass-through and hashed values.
  Do not put credentials in task logs or publicly shared cache artifacts.
- Preserve required framework and StyleX build plugins. Bun manages the CLI
  process; it does not make every Vite plugin a Bun bundler plugin.
- Use Bun's staged lint and format support only when hooks are requested.
  Preserve existing hooks and partially staged changes. Staged checks do not
  replace CI workspace checks. Do not add Husky or lint-staged by default.
- CI runs lint, format checks, `bun check`, and required builds. Follow the
  Validation workflow for local execution approval, including type-aware lint
  and commands that enable typechecking indirectly.

### Command patterns

These patterns define the intended scripts for a new project. Read existing
scripts and exact workspace names before use. Do not assume these scripts exist.

```sh
bun install
bun install --frozen-lockfile             # CI

bun run dev                              # root: turbo run dev
bun run build                            # root: turbo run build
bun run lint                             # root: turbo run lint
bun run lint:fix                          # root: turbo run lint:fix; uncached
bun run format:check                      # root: turbo run format:check
bun run format:write                      # root: turbo run format:write; uncached
bun run typecheck                         # root: turbo run typecheck

# Native leaf commands, from the owning workspace:
bun lint --no-script
bun lint --no-script --fix
bun fmt --no-script --check
bun fmt --no-script
bun check --no-script -p tsconfig.json

# Installed CLIs; target and script must be confirmed first:
bun run --filter db db:generate
bun run --filter db db:migrate
bun run --filter db db:studio
```

Do not define an aggregate root `check` script that hides native `bun check`.
Keep `typecheck` as the script name. CI owns aggregate check and typecheck
execution unless the user explicitly requests a local run. Do not invoke
restricted checks indirectly through Turbo, hooks, or `--check` build flags.

After pulling dependency changes, run `bun install` to apply the lockfile and
workspace patches. Confirm the target before migrations, seeds, or deployment.

## Repository layout

Use a feature-first modular monolith. Keep the existing layout unless the task
requires a change. For a new monorepo, use these paths only when needed:

### Starting paths

Entries define ownership, not required empty scaffolding. Create optional
files and modules only for requested behavior. Existing projects keep their
paths unless the task explicitly includes a migration.

Place all shared, reusable UI components in `apps/web/src/components/`.
Keep copied UI primitives in its `ui/` subdirectory. Keep feature-only
components in `apps/web/src/features/<domain>/components/`. Keep UI for
desktop, mobile, and extension apps in its own app. Share only platform-neutral
code through `packages/`.

```text
.
├── AGENTS.md                                        project-specific instructions
├── README.md                                        overview, setup, usage, license
├── LICENSE.md                                       existing or user-approved license
├── QA.md                                            shared QA plan and recorded results
├── .gitignore                                       secrets, generated output, local state
├── package.json                                     workspace scripts and tooling
├── bun.lock                                         single dependency lockfile
├── bunfig.toml                                      native lint, format, supported check options
├── turbo.json                                       task inputs, outputs, and dependencies
├── tsconfig.json                                    shared workspace config
├── alchemy.run.ts                                   only when existing docs app requires Pages deployment
├── apps/
│   ├── web/                                         frontend and SSR
│   │   ├── package.json                             frontend dependencies and scripts
│   │   ├── tsconfig.json                            React preset and web aliases
│   │   ├── vite.config.ts                           frontend framework, StyleX, runtime plugins
│   │   ├── ui.json                                  web-local UI CLI records and aliases
│   │   ├── public/                                  frontend static assets
│   │   └── src/
│   │       ├── router.tsx                           router and query context
│   │       ├── routeTree.gen.ts                     generated; ignored; do not edit
│   │       ├── routes/                              URL handling and page composition
│   │       │   ├── __root.tsx                       document shell and providers
│   │       │   └── index.tsx                        main route
│   │       ├── features/                            client features by business domain
│   │       │   └── <domain>/
│   │       │       ├── components/                  domain UI and forms
│   │       │       ├── hooks/                       focused interactive workflows
│   │       │       ├── queries.ts                   typed query and mutation options
│   │       │       └── schema.ts                    optional UI-only validation
│   │       ├── components/                          all shared reusable UI across features
│   │       │   └── ui/                              copied Yopem UI primitives
│   │       ├── lib/                                 browser-safe setup and shared UI helpers
│   │       └── styles/                              application styles
│   │           └── tokens.stylex.ts                 semantic tokens when needed
│   ├── server/                                      Bun backend deployment
│   │   ├── package.json                             server dependencies and concrete exports
│   │   ├── tsconfig.json                            server preset and runtime types
│   │   └── src/
│   │       ├── index.ts                             Bun HTTP server and runtime assembly
│   │       ├── features/                            server features by business domain
│   │       │   └── <domain>/
│   │       │       ├── rpc.ts                       Effect RPC handler implementations
│   │       │       ├── service.ts                   business workflows when needed; no forwarding layer
│   │       │       ├── errors.ts                    server-only errors when needed
│   │       │       ├── http.ts                      separate HTTP handlers when needed
│   │       │       └── jobs.ts                      background work when requested
│   │       ├── platform/                            runtime and request adapters when needed
│   │       │   ├── auth.ts                          request identity and auth HTTP handlers
│   │       │   ├── storage.ts                       Bun S3/media adapter
│   │       │   └── ai.ts                            provider setup only for requested AI features
│   │       └── scripts/                             maintenance entrypoints when needed
│   ├── docs/                                        existing docs site only; preserve documentation/ if used
│   │   ├── package.json                             existing site build and deployment scripts
│   │   └── <site-source>/                           existing documentation framework layout
│   ├── desktop/                                     optional GPUIX React desktop app
│   │   ├── package.json                             react with pinned @gpuix/react and @gpuix/native
│   │   ├── tsconfig.json                            jsxImportSource set to @gpuix/react
│   │   ├── packager.json                            cargo-packager settings when shipping installers
│   │   └── src/
│   │       ├── app.tsx                              React tree and render() entry
│   │       └── features/                            desktop features by business domain
│   ├── mobile/                                      optional Expo React Native app
│   │   ├── package.json                             expo, react-native, and expo-router
│   │   ├── app.json                                 app config and native settings
│   │   └── src/
│   │       ├── app/                                 Expo Router file-based routes
│   │       │   ├── _layout.tsx                      root navigator and providers
│   │       │   └── index.tsx                        main screen
│   │       └── features/                            mobile features by business domain
│   └── extension/                                   optional WXT browser extension
│       ├── package.json                             wxt, @wxt-dev/module-react, and scripts
│       ├── wxt.config.ts                            srcDir src, manifest, React module, Vite settings
│       └── src/
│           ├── entrypoints/                         background, content, popup, and options
│           │   ├── background.ts                    service worker
│           │   └── popup/                           popup HTML, React root, and styles
│           └── components/                          extension-only React components
├── packages/                                        create only for required ownership/isolation/reuse
│   ├── db/                                          database boundary
│   │   ├── package.json                             dependencies, scripts, and concrete exports
│   │   ├── tsconfig.json                            shared preset and package-specific types
│   │   ├── drizzle.config.ts                        schema discovery and migration output
│   │   └── src/
│   │       ├── schema/                              tables and persistence validation
│   │       │   └── <domain>.ts                      tables, indexes, constraints, derived schemas
│   │       ├── services/                            runtime database access
│   │       │   ├── client.ts                        scoped Bun SQL and Drizzle Layer
│   │       │   └── <domain>.ts                      domain queries, writes, transactions or batches
│   │       └── migrations/                          reviewed Drizzle Kit output
│   │           ├── <migration>.sql                  versioned schema or data migration
│   │           └── meta/                            metadata when emitted by pinned Drizzle Kit
│   ├── rpc/                                         browser-safe contracts/client boundary
│   │   ├── package.json                             dependencies, scripts, and concrete exports
│   │   ├── tsconfig.json                            shared preset and package-specific types
│   │   └── src/
│   │       ├── contracts/                           browser-safe RPC schemas and exposed errors
│   │       │   └── <domain>.ts                      domain Rpc and RpcGroup definitions
│   │       ├── middleware.ts                        browser-safe RPC middleware contracts
│   │       └── client.ts                            typed client, transport, and shared adapters
│   ├── auth/                                        optional requested authentication
│   │   ├── package.json                             dependencies, scripts, and concrete exports
│   │   ├── tsconfig.json                            shared preset and package-specific types
│   │   └── src/
│   │       ├── client.ts                            server-only configured OpenAuth client
│   │       ├── subjects.ts                          validated issuer subject contract
│   │       └── services/                            verification and session workflows when needed
│   ├── env/                                         separate server and public configuration
│   │   ├── package.json                             dependencies, scripts, and concrete exports
│   │   ├── tsconfig.json                            shared preset and package-specific types
│   │   └── src/
│   │       ├── server.ts                            validated server-only configuration
│   │       └── client.ts                            approved public values only
│   ├── cache/                                       optional requested backend cache
│   │   ├── package.json                             dependencies, scripts, and concrete exports
│   │   ├── tsconfig.json                            shared preset and package-specific types
│   │   └── src/
│   │       ├── client.ts                            native Bun Redis client when needed
│   │       └── services.ts                          cache operations and policies when needed
│   └── queue/                                       optional requested BullMQ jobs
│       ├── package.json                             bullmq, ioredis, and concrete exports
│       ├── tsconfig.json                            shared preset and package-specific types
│       └── src/
│           ├── client.ts                            BullMQ Redis connection
│           ├── queues.ts                            queue names, job payloads, and producers
│           └── workers/                             job processors by business domain
│               └── <domain>.ts                      domain jobs that call owning services
└── docs/                                            ignored working notes; not deployed documentation
```

Optional paths are not a scaffold checklist. Create only files needed by the
requested feature. Keep existing layouts, packages, and concrete helpers until
an explicit migration is requested. Do not move or delete them to match this tree.

### Ownership and configuration

- Each workspace owns its `package.json` and `tsconfig.json`. Use root defaults
  and narrow package overrides. Do not create empty packages or domain layers.

### Domain modules

- Name folders after business domains, not tables or technical operations.
  Keep related tables together. Use the same domain name across web, server,
  RPC contracts, and database modules when ownership matches.
- Routes own page composition. Feature folders own domain UI, hooks, and query
  options. `apps/web/src/components/ui/` owns shared primitives, not pages.
  Keep optional UI-only schemas in feature `schema.ts`; reuse RPC contracts
  for public inputs instead of copying them.
- Public RPC schemas belong in `packages/rpc/src/contracts/<domain>.ts`.
  Persistence schemas belong beside tables in `packages/db/src/schema/`.
  Reuse compatible schemas without exposing database modules to browsers.

### Processes and origins

- `apps/server` is a Bun server deployment, not a source-only Worker package.
  `apps/web` owns frontend builds and SSR. Do not deploy each feature separately.
- Prefer one public origin. A reverse proxy may send `/rpc`, `/auth/*`, and
  backend HTTP routes to the Effect server and other routes to frontend SSR.
  Two internal processes do not require cross-origin browser requests.
- Default local web and API ports are `3000` and `4000` when the project has
  none. Preserve configured ports. Proxy API and auth paths through the web
  origin in development; do not add CORS as a substitute.

## Growth rules

Start with files. Split responsibilities that change independently or need
unrelated dependencies. Keep related operations together when they share the
same domain rules and dependencies. Keep each workflow's steps together.
For example, separate connection management, publication preparation, and
analytics when their rules or dependencies change independently. Share their
existing SDK setup; do not copy it. Do not split only to reduce line count or
create a file for each CRUD operation or helper. Keep domain ownership and
import boundaries unchanged.

```text
Small:
apps/server/src/features/documents/service.ts
packages/db/src/schema/documents.ts
packages/db/src/services/documents.ts

Larger, only when needed:
apps/server/src/features/documents/services/create-document.ts
apps/server/src/features/documents/services/share-document.ts
packages/db/src/schema/documents/documents.ts
packages/db/src/schema/documents/versions.ts
packages/db/src/schema/documents/shares.ts
packages/db/src/services/documents/versions.ts
packages/db/src/services/documents/sharing.ts
```

- Keep reads and writes for the same business responsibility together. Do not
  split modules only by database action.
- Split frontend components, hooks, and query modules by responsibility in the
  same way. Separate page rendering from reusable query definitions and
  distinct interactive workflows. Do not move a large component into an
  equally broad hook. Do not create a folder for each operation in advance.
- Follow feature domains for service and repository boundaries. Each workflow
  depends only on the domain services or repositories it uses. Use focused
  Effect services for these dependencies. Do not collect domain APIs under
  `CoreDb`, `AppService`, or another application-wide service, even as named
  groups. Share database connections and runtime setup, not business APIs.
  Do not add forwarding-only services.
- When splitting a file, update callers, package exports, and schema
  discovery in Drizzle configuration. Use concrete module paths. Do not keep
  a re-export-only barrel at the old path.
- Extract a shared package only for clear ownership, runtime isolation, or
  actual reuse. Do not create packages to match every domain folder.
- Add auth, cache, queue, storage, AI, and job modules only when required.
  Existing packages stay in place; do not remove them as part of an unrelated
  task.

## Architecture boundaries

Request flow through the Effect backend:

```text
Simple CRUD:       browser → RPC handler → database service → PostgreSQL
Business workflow: browser → RPC handler → feature service → database/adapters
```

Import direction is separate from request flow:

```text
Browser          → browser-safe RPC contracts/client
Server assembly  → backend handlers and Layers
Server feature   → database services and infrastructure adapters
Database service → schema modules and database client
```

Shared contracts never import server implementations.

### Browser and data boundaries

- Browser code calls the typed Effect RPC client. Browser code never imports
  Bun clients, database services, or server implementation modules.
- Only server-only entrypoints import backend handlers and runtime Layers.
  Keep these imports out of browser and public RPC contract modules.
- All database access lives in `packages/db/src/services/`.
- Group related Drizzle tables, including join tables, in
  `packages/db/src/schema/<domain>.ts`. Keep their indexes, constraints, and
  stored-row schemas and table-derived validation in the same module.
  For example, `documents.ts` owns documents, document versions, and shares.
  Start with one file per domain, not per table. Split within the domain as
  described in Growth rules. Do not separate tables from their validation.
- Keep data access domain-based in `packages/db/src/services/<domain>.ts`.
  Services may use several domain schema modules for joins and transactions.
  Keep operation-specific input and result schemas with the owning database
  service, for both single-domain and cross-domain operations. Keep public
  request and response schemas in the owning RPC contract. Reuse compatible
  schemas without exposing database runtime code to the browser. Keep generated
  SQL migrations and metadata in `packages/db/src/migrations/`.
- Define domain schemas with Effect Schema and infer domain types from them.
  Use Drizzle's inferred types for database operations. Validate operation
  inputs before execution and decode selected or returned rows with Effect
  Schema before they leave the data-access service. Validate mutation values
  even when the operation returns no rows. Model database failures as typed
  Effect errors. Do not use `drizzle-zod` or a second validation library.
- Reuse the project's ID helper when present. Otherwise, use a platform API
  that meets the required ID format; do not add a helper package in advance.

### Handlers and domain workflows

- Keep handlers thin. A handler may call a database service directly only
  when it needs request validation, identity and permission checks, and one
  persistence operation. Enforce permissions before protected operations.
  One persistence operation means one database service call; that call may
  use a transaction, not just one SQL statement.
- If an operation adds business decisions, multiple steps, or logic shared
  by another entrypoint, move that logic into a feature service. Do not add
  a service that only forwards arguments. Use Effect for business logic.
- Keep reusable domain permissions in the owning feature. Call the same checks
  from RPC, HTTP, jobs, and scripts when they perform protected operations.
- Keep SQL and atomic database writes in database services. Keep business
  workflows in feature services, not database services.
- Cross-domain calls use the owning domain's service module, not its RPC,
  HTTP, or job handlers. Keep domain dependencies directional and acyclic.
- Put multi-domain workflows in the domain that owns the operation. If none
  does, use a named workflow module that calls owning feature services. Keep
  it separate from entrypoint assembly and do not create a catch-all layer.

### Integration ownership

- Packages own reusable integrations when needed. App platform modules adapt
  them to requests and Bun runtime services; do not implement them twice.
  For example, optional `packages/auth` owns verification and session operations;
  `apps/server/src/platform/auth.ts` owns request identity and auth HTTP handlers.
- Put the Bun S3 service and Layer in `apps/server/src/platform/storage.ts`,
  not a new storage package. Put shared Effect AI provider setup in
  `apps/server/src/platform/ai.ts`. Keep domain storage and AI workflows in
  their owning server feature, not in platform adapters.
- Features may import platform adapters; adapters must not import feature
  implementations. Keep domain-specific storage, AI, and job logic in its
  owning feature. Entry points register handlers and assemble scoped resource
  Layers only.
- Keep code local until another domain needs it. Do not add root-level
  `helpers/`, `utils/`, `common/`, or root `services/` catch-all folders.
  Reuse an existing owning package before adding a shared package. Keep new
  helpers with their owner. Put browser setup and UI helpers in
  `apps/web/src/lib/`; never move server-only helpers there. Do not add a
  default utils package. Preserve existing concrete helpers and their boundaries.
- Define services with Effect's context APIs and provide implementations with
  Layers. Bind native Bun clients at the server boundary.
- Put shared RPC contracts in `packages/rpc`. Contracts must not import server
  handlers, secret configuration, or native Bun client instances.

### Import enforcement

- Configure project-specific import restrictions in `bunfig.toml`
  through the native Bun lint policy.
  Reject browser imports of server or database runtime modules, Drizzle runtime
  imports outside `packages/db`, platform adapter imports of features, and
  cross-feature imports of RPC, HTTP, or job handlers.
  Cover package subpaths, aliases, and relative imports. Allow runtime assembly
  imports only in server-only entrypoints. Use shared lint presets only when
  supported by the pinned Bun linter.
- Keep Bun SQL and Drizzle runtime imports in the database package. Keep
  Drizzle Kit and Studio in local tooling, not server or browser bundles.
- Verify import restrictions when adding or changing boundaries. Check both
  allowed and rejected imports through the configured linter. If a boundary
  cannot be enforced by existing tooling, report that gap; do not claim it
  is enforced.
- Do not create barrel files that only re-export modules. Import concrete
  modules through package subpaths.
- An `index.ts` is allowed when it contains real assembly or initialization
  logic, such as handler composition, service Layers, or environment parsing.

## Effect application patterns

### Types and execution boundaries

- Keep Effect success, error, and dependency types precise. Let inference work
  unless a public contract needs annotations. Use `Effect.gen` or normal Effect
  composition.
- Model expected failures with Schema-backed tagged errors. Do not replace
  typed failures with defects, empty results, or unchecked exceptions.
- Wrap external Promise APIs at service boundaries with `Effect.tryPromise`.
  Map errors to domain errors and pass cancellation signals when supported.
- Keep Promise execution at HTTP, RPC-client, job, and script boundaries.
  Do not call `Effect.runPromise` inside domain services.

### Resources and concurrency

- Use Effect Scope and Layers for resource lifetime. Release resources when
  their owning execution ends; do not keep request resources in global state.
- Use Effect Schedule for bounded retries and backoff. Retry only failures that
  can succeed later. Make retried writes and jobs idempotent.
- Use Effect concurrency controls for parallel work. Set limits that respect
  SQL pool, Redis, storage, and upstream service limits.
- Use Effect Stream for streamed application data. Check transport limits,
  backpressure, and disconnect handling before exposing long-lived streams.

### Observability and library scope

- Use Effect's logging and tracing APIs with the project's configured sinks.
  Redact credentials, tokens, and private user data.
- Create or accept a request ID at every public boundary. Return it in a
  response header. Propagate it through RPC calls, queue jobs, scheduled work,
  and outbound requests. Use W3C `traceparent` when tracing is enabled.
- Trace HTTP or RPC handlers, domain services, database calls, cache calls, and
  job processors with Effect spans. Set the sample rate through validated
  configuration. Keep error and slow-request sampling at least as high as
  normal traffic.
- Record request rate, error rate, and duration for every endpoint. Record
  queue depth and age, job failures and retries, database pool saturation,
  cache hit rate, and runtime CPU and memory. Keep labels bounded. Do not use
  user IDs, emails, or raw URLs as metric labels.
- Include timestamp, level, service, environment, release, request or job ID,
  route or RPC name, duration, and outcome in structured logs. Use Effect
  annotations for request context.
- Log errors once at the boundary that handles them. Attach the correlation
  ID, operation, and safe context. Do not log request bodies, cookies,
  authorization headers, tokens, passwords, payment data, or personal data.
- Add `/health` for liveness and `/ready` for dependency readiness when the
  platform uses them. Alert on sustained 5xx rate, p95 latency, queue backlog,
  repeated job failures, database saturation, and authentication failures.
  Give each alert an owner and a runbook. Set retention from cost and privacy
  requirements.
- Capture browser errors and Web Vitals only through the approved analytics
  path. Do not add a second error or analytics vendor without a request.
- Use Effect data and schema APIs when they improve the contract or workflow,
  not merely because they are available. Follow the Readability contract for
  simple synchronous code and application time logic.
  Keep native Bun and Web APIs inside runtime adapters and framework boundaries.
- Do not add duplicate validation, retry, dependency-injection, logging, or
  asynchronous utility libraries when Effect provides the required behavior.
- Effect fibers, caches, and queues are process-local tools. They do not
  replace durable jobs, Redis coordination, PostgreSQL, or object storage.

## Effect RPC, HTTP, and OpenAPI

### Contracts and authorization

- Effect RPC is mandatory, not an optional integration. Use it for application
  queries, mutations, and streaming calls between frontend and backend. Do not
  replace it with REST, framework server functions, tRPC, Hono RPC, or raw fetch.
  Keep non-RPC HTTP endpoints only for protocols or integrations that need them.
- Define requests with `Rpc` and compose domain contracts with `RpcGroup`.
  Use Effect Schema for payloads, success values, and expected errors.
- Implement contracts with `RpcServer` and call them through `RpcClient`.
  Verify API names and imports against the pinned Effect v4-or-higher release.
- Mount HTTP RPC transport under `/rpc` in the Effect HTTP application.
  RPC names identify operations; do not create a REST route for each RPC.
- Use compatible protocol versions and the same serialization layer on client
  and server. Do not hand-write envelopes or duplicate route types.
- Apply authentication through RPC middleware and Effect services. Enforce
  domain permissions for each protected operation, including jobs and scripts.

### Server assembly and request lifetime

- Use Effect HTTP APIs for health checks, auth callbacks, webhooks, and other
  non-RPC handlers. Do not use bare Bun fetch handlers for application routing.
- Assemble the HTTP server and service Layers at `apps/server/src/index.ts`.
  Launch them through the pinned Effect runtime integration for Bun. Keep one
  application runtime and shared resource Layers per process, not per request.
- Let Effect own request scopes, cancellation, logging, stream responses,
  listener lifetime, and graceful shutdown. Do not call runtime runners inside
  domain services or create a detached runtime for each request.

### Routing and public boundaries

- Keep API failures and unknown API routes from reaching frontend HTML fallback.
  Route API and auth requests before SSR or static fallback in the proxy or
  combined application adapter.
- Keep API calls and cookies same-origin. Add cross-origin access only for a
  stated external-client requirement, with explicit origins and credentials.
- Keep public RPC errors in browser-safe contract modules. Keep server-only
  errors in their owning feature.
- Scripts and job entrypoints call owning Effect services. Do not copy SQL,
  permission rules, or business workflows into entrypoint code.

### OpenAPI support

- OpenAPI support is required. Define documented HTTP endpoints with Effect
  HTTP API contracts and generate the specification from those contracts through
  the pinned Effect release's supported OpenAPI integration. Verify APIs and
  imports before use; do not maintain a separate hand-written specification.
- Serve the generated specification at `/openapi.json` from the existing
  backend deployment. Route this endpoint and documented HTTP APIs before
  frontend SSR or static fallback. Preserve an existing specification URL when
  integrating this policy into a project.
- Effect RPC is not an OpenAPI REST contract. Keep RPC for application calls;
  do not describe RPC envelopes as REST or add a REST route for every RPC.
  HTTP and RPC handlers call the same owning services and permission rules.
- Document HTTP inputs, success responses, expected errors, and authentication.
  Keep secrets and internal-only schemas out of the specification and examples.
  Apply the project's access policy to specification and interactive docs routes.

## Environment and validation

### Configuration and secrets

- Read application configuration only through `packages/env`.
- Use Effect Config with a provider backed by Bun's runtime environment.
  Read `Bun.env` or runtime environment APIs only in the server config adapter.
  Do not scatter `process.env`, `Bun.env`, or `import.meta.env` reads through
  services. Bun's automatic environment loading does not replace validation.
- Keep connection URLs and credentials in validated server config. Pass them
  explicitly into SQL, Redis, and S3 Layers. Do not rely on unrelated clients'
  implicit global credential lookup.
- Expose only approved public build values through the client configuration
  export. Framework `import.meta.env` values are not server secrets.
- Validate required config before its first use. Do not skip runtime validation
  in CI; give jobs that execute the application valid isolated configuration.
  Static tooling must not start the application or connect to services.
- Keep `.env` and secret files untracked. Never expose credentials through
  client exports, logs, errors, RPC responses, or build artifacts.

### Local services and session security

- Use local PostgreSQL and Redis containers through Docker Compose. Podman may
  run equivalent containers when Docker is unavailable. Use isolated storage
  resources for development. Do not connect local QA to production data.
- Preserve existing session names and expiry contracts. Set `httpOnly` and
  secure production cookie settings. Prefer host-only cookies with
  `sameSite: lax`; use `none` only when required, with `secure` enabled.
  Protect state-changing requests from CSRF.
- For OAuth/OIDC, verify state, PKCE, callback targets, issuer, signatures,
  audience, expiry, and identity schemas. Validation is not authentication.

## Security hardening

- Set security headers at the public origin. Use HTTPS only in production and
  HSTS with `includeSubDomains` after verification. Set
  `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a
  `Permissions-Policy` that denies unused capabilities. Set
  `frame-ancestors 'none'` unless embedding is required.
- Use a Content Security Policy with nonces or hashes. Do not allow
  `unsafe-eval`. Allow `unsafe-inline` only for a verified framework
  requirement. Allow only required origins for scripts, connections, images,
  frames, and workers. Include the analytics hosts, Polar API, and the PWA
  service worker (`worker-src 'self'`).
- Rate limit public endpoints at the edge and in the application. Apply
  stricter limits to sign-in, token, password, upload, checkout, and webhook
  paths. Limit by IP and by authenticated user or tenant. Return `429` with
  `Retry-After`. Do not rely on client-side limits.
- Verify webhook signatures, timestamps, and replay windows before processing.
  Make handlers idempotent. Queue slow work and acknowledge within the provider
  timeout. Keep webhook routes public but rate limited and outside session
  authentication.
- Validate every outbound URL against an allowlist. Block loopback, link-local,
  private, and metadata addresses for user-supplied URLs. Use HTTPS and limit
  redirects. Do not fetch arbitrary URLs from server code.
- Scope every tenant-owned query and mutation by tenant ID at the service
  boundary. Deny by default. Do not trust tenant IDs from the client. Add
  authorization tests for cross-tenant reads and writes.
- Keep CORS closed by default. Allow only known origins, methods, and headers.
  Do not combine wildcard origins with credentials.
- Keep dependencies pinned and the lockfile committed. Run the package manager
  audit in CI. Review new dependencies, install scripts, and licenses. Do not
  add a package to solve a problem that platform APIs cover.
- Rotate secrets on a schedule and after exposure. Use separate values for
  development, preview, and production. Store them in the platform secret
  store. Never send secrets to the client, logs, analytics, or error reports.
- Return safe error messages to clients. Log details with a correlation ID
  server-side. Do not expose stack traces, SQL, provider responses, or
  configuration values.

## OpenAuth authentication

### Client and subject contract

- Use `createClient` from `@openauthjs/openauth/client`. Set the issuer to
  `https://auth.yopem.com` through `packages/env`. Get the application's client
  ID, callback URL, and subject contract from its configuration; do not invent
  these values or change the external issuer without approval.
- Keep the client and authentication services in `packages/auth`. Import only
  client and subject APIs; do not add OpenAuth issuer, provider, or login UI code
  to the application. The existing issuer stays outside the application
  deployment.
- Define subjects with Effect Schema through the pinned release's Standard
  Schema adapter and OpenAuth's `createSubjects`. Match subject names and fields
  issued by the existing server. Do not add Valibot or Zod for this integration.

### Authorization and token lifecycle

- Start authorization, handle callbacks, exchange codes, refresh tokens, and
  log out through same-origin `/auth/*` handlers in the Effect HTTP server.
  Browser redirects may visit the external issuer; API calls remain same-origin.
- Use the authorization code flow with PKCE. Bind state and the verifier to the
  initiating browser session, expire them, and consume them once. Validate state
  before code exchange. Use the same approved callback URL for authorization
  and exchange; accept only safe application-local return paths.
- Wrap OpenAuth Promise APIs in Effect services. Handle both rejected Promises
  and returned `err` results as typed failures. Verify access tokens with
  `client.verify` and the subject schemas before RPC authorization; decoding a
  token is not verification. Keep domain permissions separate from identity.
- Keep tokens in server-managed sessions or secure, HTTP-only app cookies, not
  browser storage. Persist refreshed access and refresh tokens when OpenAuth
  returns them. Clear app sessions on logout or invalid refresh credentials.
  Do not assume that clearing a cookie revokes the issuer's tokens or session.
- Keep app cookies host-only. Do not share cookies across `.yopem.com` or depend
  on issuer cookies as application sessions. Preserve the cookie and CSRF rules
  above. Never log tokens, authorization codes, or PKCE verifiers.

## TanStack and application patterns

### Routes and navigation

- **Route organization:** use directory-based file routing in TanStack Start
  and TanStack Router. Use folders for path segments, not dot-separated route
  files such as `_desk.edit.$slug.tsx`. Put page UI in `home/index.tsx`, not
  `home.tsx`. Put dynamic pages in `$slug/index.tsx`, not `$slug.tsx`.
  Keep the root index in `routes/index.tsx`.
- Use parenthesized route groups such as `(_desk)/` to organize related routes
  without adding a URL segment. For example, use
  `routes/(_desk)/edit/$slug/index.tsx` for `/edit/$slug`.
  A route group does not create a layout or a route-level guard.
- Use `route.tsx` only when a directory needs a parent route for shared layout
  or route behavior. Use `_desk/route.tsx` for a pathless layout and put its
  child routes in that directory. Keep `__root.tsx` as the root route.
  Do not replace an existing `_desk` layout with `(_desk)` grouping and lose
  its shared UI or guards. Preserve URLs, nesting, and access checks when
  changing route files. Do not reorganize unrelated routes.
- **Typed navigation:** use TanStack `Link`, `navigate`, and redirects with
  typed `to`, `params`, and `search`. Do not build internal URLs by joining
  strings. Use normal anchors for external links.
- **URL state:** put shareable filters, sort order, pagination, and selected
  tabs in search params. Validate them with `validateSearch` and the stack's
  schema library. Keep temporary UI state, such as open dialogs, in components.
- **Route data:** use loaders for data needed before a page renders. Reuse
  feature query options and the shared QueryClient cache; do not add duplicate
  query keys or API calls. Declare search params used by loaders in
  `loaderDeps`. Do not add loaders to pages that do not need them.
- **Shared layouts:** render `Outlet` in parent layout components. Keep index
  page UI in the child `index.tsx`. Do not add parent routes only to match the
  folder structure.
- **Route access:** use `beforeLoad` for route access checks and redirects
  before protected loaders run. Validate login return paths as application-local
  paths. Server code must authorize each protected operation; client route
  guards are not security boundaries.
- **Route feedback:** set shared pending, error, and not-found UI defaults.
  Override them only when a route needs different feedback or recovery. Report
  missing records with `notFound`, not an empty success screen. Do not require
  separate feedback files for each route.
- **Route-local files:** prefer existing feature modules for components, hooks,
  and queries. When files must stay beside a route, use the route generator's
  ignored `-` prefix, such as `-components/`. Do not let helper files become
  routes. Preserve the project's configured ignore rules.
- **Route changes:** check URLs, route IDs, typed links, params, search
  validation, layouts, and guards after moving route files. Let the route
  generator update `routeTree.gen.ts`; never edit it by hand. Verify affected
  direct links and navigation, including denied access and missing records.

### Page composition

- **React components and TanStack Start routes:** write page UI directly in
  `index.tsx` or the matching route file. Define the route component there and
  register it with the route. Never create separate page components such as
  `inbox-page.tsx` or `InboxPage` outside the route file. Do not make a route
  render only an imported page component.
- Keep components small, focused, and reusable. Extract UI parts such as
  filters, lists, and forms when they have a distinct responsibility or actual
  reuse. Compose these parts in the route file; do not extract the whole page.
  Do not split components only to reduce line count. Keep reusable query options
  and focused hooks in their owning feature modules.

### Queries and forms

- Never spread TanStack Query query or mutation result objects. This includes
  `...query`, `{ ...query }`, `...mutation`, and `{ ...mutation }`. Read or return
  only the required properties explicitly. This rule does not apply to query
  or mutation option objects.

- **TanStack Query:** `packages/rpc` owns the transport client and shared client
  adapters. Feature `queries.ts` modules own application query keys and reusable
  query and mutation options. Call the typed Effect RPC client in those options;
  execute client Effects at this boundary and pass cancellation signals where
  supported. Hooks and components consume the options. Do not use raw `fetch`
  in components or duplicate definitions. Preserve existing placement until a
  migration is part of the task.
- **TanStack React Form:** use `useForm` with Effect Schema through its Standard
  Schema adapter. Validate required fields on blur and submit, not on change or
  mount, so untouched fields show no error. Repeat validation on the server.
- **TanStack Table, when needed:** use `@tanstack/react-table` for tables that
  need sorting, filtering, selection, or pagination. Use existing UI components
  for rendering. Do not install it for a plain static table.
- **TanStack Virtual, when needed:** use `@tanstack/react-virtual` for large
  lists or tables when rendering all rows causes measured performance
  problems. Keep keyboard navigation and accessibility intact.

### Server integration and optional features

- **Server-only web logic:** use `createServerFn` only for framework-specific
  server integration that cannot use the application RPC client. Do not use it
  as an alternative API layer. Application queries and mutations use Effect RPC.
  Keep integration code server-only and reuse existing Effect services.
- **AI, when needed:** keep Effect AI provider setup and execution server-side.
  Validate structured output and tool inputs with Effect Schema.
- Use `lucide-react` icons only, with the `Icon` suffix in import names.

## Yopem UI and StyleX

### Source installation and styling

- Read https://ui.yopem.com/docs/installation and each component's documentation
  before setup or use. Run a compatible `@yopem-ui/cli` with Bun to initialize
  `apps/web` and add components under `apps/web/src/components/ui/`.
  Keep the CLI record at `apps/web/ui.json`. Define web `@/*` as `./src/*`
  in `apps/web/tsconfig.json`; use `@/components/ui/...` and `@/lib/...`.
  Keep browser setup and UI helpers in `apps/web/src/lib/` and optional semantic
  tokens in `apps/web/src/styles/tokens.stylex.ts`. Verify the pinned CLI's
  commands.
- Do not create a `packages/ui` package. Each target owns its UI because web,
  desktop, mobile, and extension use different primitives and layout systems.
  Keep web primitives in `apps/web/src/components/ui/`. If a shared UI package
  already exists, preserve it until the user requests migration to the owning
  apps; do not add new components there.
- Components are copied source, not a runtime component package dependency.
  Import the installed local modules. Keep `ui.json` as the CLI's file record.
- Use Yopem UI components before adding custom controls or Base UI primitives.
  Keep semantic elements, accessibility, event handlers, and refs intact.
- Use `stylex.create` and semantic tokens. Pass styles through `xstyle` on
  Yopem UI components and `stylex.props(...)` on native or framework elements.
  Use component props such as `variant` and `size` before local overrides.
- Change shared tokens for application-wide styles. Preserve readable contrast
  and focus, hover, and disabled states. Do not add Tailwind.

### Theme and tooling integration

- A fixed theme needs no provider. Add Yopem UI's theme runtime only for theme
  switching. In SSR, place its script before hydration and use matching defaults
  for the script and provider. Pass the CSP nonce when required.
- Keep the CLI's StyleX build integration, aliases, root styles, and lint rules.
  Merge compatible lint and format settings into `bunfig.toml`. Preserve
  CLI behavior and existing project settings during this merge. If required
  settings cannot be preserved, report a blocker; do not add a second runner.
- Register `@yopem-ui/oxlint-plugin` only after verifying Bun compatibility.
  Preserve the recommended rules and `no-raw-stylex-colors`. Keep the documented
  overrides for copied primitives and document shells. Match component source
  paths to the repository layout. For the default layout, target copied
  primitives with `apps/web/src/components/ui/**` from root lint config, or
  `src/components/ui/**` from web-local config. Resolve CLI aliases and StyleX
  source paths from `apps/web`; include its components and token module.
  For an existing shared UI package, keep its actual paths and lint overrides.
- Run a production build after UI setup or token changes. Check StyleX CSS
  extraction and SSR behavior.

## Accessibility

- Meet WCAG 2.2 AA for every web screen. Treat accessibility as a release
  requirement, not a QA afterthought.
- Prefer semantic HTML and the accessible Yopem UI and Base UI primitives.
  Keep native roles and keyboard behavior. Do not replace a button, link, or
  input with a clickable `div`.
- Give every control a programmatic label. Connect help text and errors with
  `aria-describedby`, set `aria-invalid`, and move focus to the first invalid
  field on submit. Use a live region for asynchronous status and errors.
- Support full keyboard operation. Provide a visible focus indicator, a skip
  link, logical focus order, and focus return after dialogs and menus. Never
  trap focus outside a modal.
- Manage focus on route changes and announce the new page title. Keep one `h1`
  per page and do not skip heading levels.
- Meet contrast requirements: 4.5:1 for normal text and 3:1 for large text and
  interactive boundaries. Do not use color alone to convey state.
- Respect `prefers-reduced-motion`. Avoid autoplay, flashing, and motion that
  cannot be paused. Keep content usable at 200% zoom and 400% reflow, and at
  increased text spacing.
- Use touch targets of at least 24 by 24 CSS pixels, with 44 by 44 preferred.
  Keep controls usable with one pointer and with touch.
- Give images useful `alt` text and mark decorative images empty. Hide
  decorative icons from assistive technology and give icon-only buttons an
  accessible name.
- Use table captions and header scopes. Announce sort changes with `aria-sort`.
  Do not use tables for layout.
- Test with a keyboard only, at high zoom, and with a screen reader before
  release. Add automated checks only as a supplement, not as the only test.
- Desktop GPUIX: set `role` and `aria-label` on custom controls. A clickable
  `div` is not a button until it has `role="button"`. Use `aria-id` for stable
  automation IDs and the supported state attributes. GPUIX exposes this tree
  through AccessKit on macOS, Windows, and Linux. Test with the platform
  accessibility inspector.
- Mobile Expo: use `accessibilityRole`, `accessibilityLabel`,
  `accessibilityState`, and `accessibilityHint`. Support dynamic type, screen
  readers, and 44-point targets. Test with VoiceOver and TalkBack.
- Browser extension: keep popup and options keyboard accessible. Do not let
  content-script UI trap focus or hide the host page from assistive
  technology. Expose extension controls with normal web semantics.

## PWA, SEO, and analytics

### PWA and offline

- Every web app is a PWA. Ship a web manifest, a service worker, install
  icons, and an offline fallback. Use `vite-plugin-pwa` with the pinned Vite
  and TanStack Start setup.
- Keep `manifest.webmanifest` and icons in `public/`. Provide 192 and 512 pixel
  icons, a maskable icon, `start_url`, `scope`, `display: standalone`, theme
  color, and background color. Do not put secrets in the manifest.
- Precache only build assets and public static files. Use a network-first
  policy for navigation and a clear offline fallback. Never cache `/rpc`,
  `/api`, `/auth`, webhook, checkout, or authenticated HTML responses.
- Register the service worker in the browser only, after the app loads. Do not
  register it during SSR, build, or test. Prompt before activating a new
  version, and remove old caches on activation.
- Serve `sw.js` from the origin root with `Cache-Control: no-cache` and
  `Service-Worker-Allowed: /`. Set `worker-src 'self'` in the CSP. Do not load
  a service worker from another origin.
- Verify installability, offline fallback, update, and cache cleanup in QA.
  Test with the network offline and with a slow connection.

### SEO and discoverability

- Render public content on the server. Do not depend on client JavaScript for
  titles, descriptions, or primary content.
- Set a unique title, meta description, canonical URL, and Open Graph and
  Twitter metadata for every public route. Use the route `head` API.
- Generate `sitemap.xml` from public routes and serve `robots.txt`. Exclude
  authenticated, preview, checkout, and duplicate URLs. Use `noindex` on
  private and staging pages.
- Add structured data only for real entities, such as Organization, WebSite,
  Product, and BreadcrumbList. Keep it consistent with visible content.
- Use one canonical host and one trailing-slash policy. Redirect permanent
  moves with `301`. Return `404` for missing pages and `410` for removed
  content.
- Keep URLs stable and human-readable. Do not put session IDs or personal data
  in URLs.
- Do not index extension pages, desktop views, or mobile-only screens. Do not
  add SEO metadata to the PWA offline page.

### Analytics

- Use Google Analytics 4 and Umami through one analytics module in the web
  app. Do not call `gtag` or `umami` from components.
- Configure both providers through `.env` and the public client config:
  `VITE_ANALYTICS_ENABLED`, `VITE_GA_MEASUREMENT_ID`,
  `VITE_UMAMI_SCRIPT_URL`, and `VITE_UMAMI_WEBSITE_ID`. Use the project's
  public prefix if it differs. These IDs are public, not secrets.
- Load a provider only when its ID is present and analytics is enabled. Do not
  fail the app when a value is absent. Disable analytics in tests and local
  development unless explicitly enabled.
- Set Google Analytics Consent Mode defaults to denied before loading the tag.
  Load Google Analytics only after consent where law or policy requires it,
  then update consent from the choice. Umami is cookieless by default, but
  disclose it in the privacy policy.
- Track a small, documented event taxonomy. Use stable names and a typed
  `trackEvent` helper. Track page views from one router subscription, not from
  every component.
- Never send names, emails, user IDs, tokens, payment data, free-text input, or
  URLs with query strings. Use opaque IDs only when necessary.
- Allow the analytics and Polar origins in the CSP. Do not cache analytics
  scripts in the service worker. Keep analytics for web only unless the
  project explicitly requests another target.

## Payments with Polar

Add Polar only when a requested feature needs payments or subscriptions.

- Keep Polar server-only. Use `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`,
  product IDs, and `POLAR_ENVIRONMENT` through validated server config. Never
  expose the access token or webhook secret to the client.
- Create checkout sessions on the server from a configured product ID and the
  authenticated customer. Redirect to Polar hosted checkout. Do not collect
  card data or embed payment fields.
- Verify webhook signatures and timestamps before parsing. Reject invalid
  requests with `403`. Deduplicate by webhook event ID and make handlers
  idempotent. Acknowledge quickly and queue slow fulfillment.
- Store provider customer, subscription, order, and event IDs. Derive
  entitlements from subscription status in the database. Check entitlements at
  the service boundary; do not trust client flags.
- Handle activation, renewal, cancellation, past-due, refund, and revocation
  events. Keep a reconciliation job or endpoint for missed webhooks.
- Use the Polar customer portal for payment method and subscription changes.
  Do not build card management.
- Use sandbox mode for development and tests. Never use production keys in
  local or preview environments.
- Wrap the pinned Polar SDK in an Effect service. Verify the SDK and webhook
  verification under the pinned Bun version before setup.

## Bun data, storage, and background work

### PostgreSQL through native Bun SQL

- Use Drizzle's Bun SQL adapter for every runtime query, mutation, transaction,
  seed, and maintenance operation. Native Bun SQL is the underlying driver,
  not a second raw-query path outside database services.
- Acquire one configured Bun SQL client per owning application scope. Provide
  Drizzle through an Effect Layer. Close the pool through a finalizer using
  APIs supported by the pinned Bun version. Do not create pools per request.
- Keep SQL execution in `packages/db/src/services/`. Use parameterized Drizzle
  queries and `sql` expressions. Never concatenate untrusted values into SQL.
- Validate operation inputs and mutation values with Effect Schema. Decode
  selected and returned rows before they leave database services. Use Drizzle
  inferred types for query construction. Do not use `drizzle-zod`.
- Wrap deferred database execution with `Effect.tryPromise` and typed errors.
  Do not create eager Promises before Effect execution begins.
- Keep atomic writes inside real PostgreSQL transactions through the pinned
  Drizzle adapter. Verify callback and rollback semantics. A transaction must
  not commit when an inner Effect fails or is interrupted. At a Promise-based
  transaction callback, bridge the Effect once and reject on failure; do not
  swallow failures or execute inner Effects as detached fibers.
- Pass cancellation where supported. Effect interruption alone does not prove
  the database query stopped. Document driver limits and use bounded database
  timeouts where needed. Do not retry uncertain writes without idempotency.
- Drizzle tables define database structure; Effect Schema validates application
  contracts. Generate reviewed, versioned migrations with Drizzle Kit and keep
  SQL plus generated metadata in `packages/db/src/migrations/`.
- Apply migrations through one configured migration history as an explicit
  release step. Do not use schema push against shared or production databases.
  Back up data and confirm the target before destructive migrations.
- Configure Drizzle Studio in `packages/db/drizzle.config.ts`. Keep it local
  and private. Studio edits bypass application validation; do not use them in
  place of reviewed migrations or validated operations.

### Redis through Bun's native client

- Use Bun's native Redis client, not ioredis, node-redis, or a duplicate client.
  Create and release it through an Effect Layer using verified lifecycle APIs.
- Keep key names, serialization, TTLs, invalidation, and error mapping in
  owning cache services. Validate decoded cache values with Effect Schema.
- Separate users, workspaces, environments, and schema versions in cache keys.
  Never share private values through public keys or public HTTP caches.
- Specify cache-miss and outage behavior per workflow. Do not turn a failed
  authoritative authorization lookup into an allow decision.
- Use atomic Redis operations when coordination is required. Verify native
  client support before using transactions, scripts, locks, or pub/sub.
  Do not assume an in-memory Effect cache coordinates multiple processes.

### Objects through Bun's native S3 client

- Use Bun's native S3 client for R2 or configured S3-compatible storage.
  Keep credentials and endpoint configuration server-only in an Effect Layer.
  Wrap I/O with typed failures and scoped resources where needed.
- Keep reusable S3 access in `apps/server/src/platform/storage.ts`. Keep domain
  object keys, bucket policy, and storage workflows in the owning server feature.
  Validate upload size, type, magic bytes, ownership, and download permissions.
- Use bounded streams for large objects. Preserve backpressure and cancellation
  across native streams and Effect Stream using version-compatible adapters.
- Presigned URLs are bearer access. Authorize before signing, use short expiry,
  restrict operations and keys, and never log signed URLs.
- Do not assume PostgreSQL, Redis, and S3 share a transaction. Model partial
  failure, cleanup, and idempotency for workflows that change multiple systems.

### Background work and media

- Use Effect fibers, Schedule, and Stream for bounded in-process work. Tie
  fibers to the application scope and stop them during graceful shutdown.
- In-memory queues and schedules do not survive process failure. When work
  must survive restarts, use BullMQ in `packages/queue` with the project Redis
  instance. Do not add job infrastructure in advance.
- Keep BullMQ queue names, payload schemas, producers, workers, and the Redis
  connection in `packages/queue`. Workers call owning Effect services; do not
  copy SQL, permission rules, or business workflows into processors.
- Wrap BullMQ Promise APIs in Effect services with typed errors. Close Queue
  and Worker instances through Effect finalizers so Redis connections close on
  shutdown. Verify BullMQ and its Redis client under the pinned Bun version
  before setup.
- Make jobs idempotent. Bound attempts and backoff. Set completion and failure
  retention. Validate payloads with Effect Schema at dequeue. Pass record IDs
  and small values, not secrets or large objects. Mark work complete only after
  required writes succeed, and preserve failure evidence.
- Run workers in a dedicated process entrypoint or the server process, not in
  the web SSR process. Do not start workers during build, lint, or test
  commands.
- Use `Bun.Image` only in server-side Effect adapters when supported. Bound
  input bytes, image dimensions, processing concurrency, and output size.

## Code conventions

### Types, declarations, and imports

- Keep type safety. Do not use `any`, `as any`, or `as unknown as`. Use accurate
  types, generics, narrowing, and schema decoding instead of unsafe assertions.
- Use `const` when reassignment is unnecessary. Use Effect logging in server
  workflows. Do not use `console.log`; use appropriate console levels only at
  non-Effect boundaries when needed.
- React components and hooks use named `export function` declarations. Do not
  use default exports for React code.
- Prefer function declarations for named functions. Let shared lint rules govern
  anonymous callbacks.
- Prefer inferred return types unless a public contract needs an explicit type.
- Use static imports. Do not use `await import()`.
- Omit file extensions where the bundler supports this. Use valid Node.js ESM
  imports for scripts that run without a bundler.

### Clarity and check failures

- Add comments only for behavior that clear names and structure cannot explain,
  or for a required lint safety justification.
- Apply the Readability contract to components and functions. Keep each
  responsible for one coherent task.
- Fix check failures at their source. Refactor the code and try a solution
  that satisfies the rule before considering a suppression. Do not weaken
  types, remove assertions, or change rule settings to hide failures.

## Build and deployment

### Build artifacts and server integration

- Build backend code with `bun build --target bun` into the configured output,
  normally `apps/server/dist/index.js`. Run it with `bun run dist/index.js`
  from `apps/server`. Keep the Effect server bootstrap as the entrypoint.
- Build TanStack Start with its supported frontend pipeline. Inspect the pinned
  framework's SSR entrypoint and assets. Run SSR under Bun through an approved
  compatible adapter. Do not copy an old output path or add a second native
  Bun fetch server without checking the contract.
- If frontend SSR starts a separate listener, keep it behind the same public
  origin as the Effect backend. If a combined Effect HTTP adapter is supported,
  compose SSR there. Do not claim a generic Web handler is directly mountable
  without verifying streaming, errors, cookies, and static asset handling.

### Runtime and release safety

- Use pinned `oven/bun` images or an equivalent verified Bun installation in
  container builds and runtime. Match the tested Bun canary revision. Do not
  use a floating `latest` image for reproducible releases.
- Install dependencies with `bun install --frozen-lockfile`. Keep build tools
  in build stages where possible. Keep required runtime dependencies and assets.
- On termination, stop accepting requests, allow bounded draining, interrupt
  owned fibers, and release SQL and Redis connections through Effect finalizers.
  Check container signal delivery and shutdown behavior in requested QA.
- Run migrations as an explicit approved release step. Application rollback
  does not undo database or object changes. Keep backups and recovery steps.
- Keep PostgreSQL, Redis, buckets, and secrets separate for local, preview,
  and production environments. Do not add Workers, Alchemy, Wrangler, or other
  infrastructure tooling unless the project explicitly requires it. The
  documentation-app rule below permits Alchemy for that deployment only.

### Documentation apps

- If `apps/docs` or `apps/documentation` exists, use Alchemy
  (https://alchemy.run) to deploy its documentation site to Cloudflare Pages.
  Do not create a documentation app when none exists. This site is separate
  from root `docs/`, which holds ignored local work notes.
- Keep its Pages resource in root `alchemy.run.ts`. Reuse the existing Alchemy
  program when present. Use the docs app's build command and verified static
  output directory. Check the pinned Alchemy release's Pages support before
  selecting APIs; report unsupported builds or APIs as blockers.
- This separate documentation deployment does not change the application's
  runtime or deployment model. Keep application services out of the Pages site.
- Keep deployment credentials and Alchemy state out of git. Follow the existing
  environment isolation and deployment approval rules before a live deploy.

## Validation workflow

### Implementation first; QA execution later

- Complete all requested implementation before running QA. During implementation,
  do not run automated tests, browser checks, endpoint probes, or other runtime
  validation unless the user explicitly requests them.
- Do not create test files, fixtures, test libraries, runners, or test
  configuration by default. Preserve existing tests and CI. Do not disable,
  delete, untrack, or weaken them to avoid checks.
- Before implementation, identify expected behavior and relevant failure cases.
  Record these as pending cases in the repository-root `QA.md`. This is a QA
  plan, not test execution or test implementation.
- Create `QA.md` if it does not exist. Read and update it if it exists. Maintain
  one shared file for the repository, including all affected workspaces.
  Do not create a separate QA file for each task or package.
- Update `QA.md` as implementation changes. Before handoff, add every remaining
  check needed for the completed work. Include affected existing behavior,
  integration boundaries, and regressions, not only new features.
- Do not start QA automatically when implementation ends. Leave the checklist
  ready for a separate QA pass. Run it only when the user requests QA or
  explicitly includes verification in the task.
- Existing CI checks stay enabled. Check and typecheck execution stays in CI
  unless the user explicitly requests local execution. Do not invoke prohibited
  checks indirectly through scripts, hooks, builds, or other tools.
- Review the changed source and instructions for consistency without running
  the application. Written plans and source review do not prove runtime success.
- These rules control when validation runs. Verification requirements elsewhere
  in this document define cases to record in `QA.md`, not permission to run them
  during implementation. This includes browser, API, build, lint, format,
  typecheck, import-boundary, and deployment checks.

### Required detail in `QA.md`

- Group cases by feature or changed workflow. State the task, affected files,
  routes, endpoints, roles, dependencies, and related acceptance requirements.
- Give each case a stable ID, such as `QA-001`, and an unchecked checkbox.
  State priority: P0 for security or data loss, P1 for core behavior, and P2 for
  secondary behavior. Run higher-priority cases first during the QA pass.
- Write one independently verifiable scenario per checkbox. Do not use vague
  tasks such as "test auth", "check edge cases", or "verify the UI".
- For every case, include all of the following:
  - **Purpose:** the requirement, change, or regression the case covers.
  - **Prerequisites:** environment, services, configuration names, user roles,
    permissions, and required starting state. Never include secret values.
  - **Inputs:** exact safe example values, records, IDs, and boundary values.
    Explain how to create isolated data and identify dependencies between cases.
  - **Steps:** numbered, repeatable actions with exact routes, controls, or
    commands. State the working directory for commands. Use existing project
    scripts and tools; do not invent commands or unsupported API payloads.
  - **Expected results:** observable UI state, exact response status, relevant
    headers and body values, stored changes, and effects that must not occur.
    A successful HTTP response alone is not enough.
  - **Evidence:** the sanitized screenshot, trace, response, log, or report to
    save, its local path, and what the reviewer must inspect.
  - **Cleanup:** how to remove isolated data, restore settings, and stop only
    processes started for the case. State when no cleanup is needed.
  - **Status:** pending, passed, failed, or blocked. New cases start pending.
    For blocked cases, state the missing prerequisite and how to resolve it.
- Use realistic values from the implementation and documented contracts. If a
  value or command is unknown, mark it as a blocker with a discovery step.
  Do not present guesses as executable instructions.
- Include setup, execution order, environment URLs, existing server ports,
  required tool versions, and artifact locations in a shared setup section.
  Reference that section from cases instead of copying long setup instructions.
- Include a coverage map from each acceptance requirement and changed workflow
  to case IDs. Explain any gap. Mark irrelevant categories as not applicable
  with a reason; do not add generic filler cases.
- Preserve unrelated cases and their evidence. Merge duplicate pending cases.
  Add a new case or reopen an affected case when behavior changes. Keep prior
  results identified with their tested revision; do not carry a pass forward
  as proof for changed code.
- Keep cases unchecked until they pass in a requested QA run and their evidence
  has been inspected. Record the tested revision, environment, date, actual
  result, and evidence path. Failed and blocked cases remain unchecked.
- Keep `QA.md` free of credentials, personal data, production record dumps,
  and sensitive logs. Keep QA artifacts local and uncommitted. Add their exact
  paths or a dedicated local directory to `.gitignore` before creating them.
- For documentation-only work, record relevant text and link checks. Do not
  require browser sessions or source tests when the change does not need them.

### Coverage checklist for affected behavior

Apply every relevant category below to the actual implementation. Expand each
applicable category into concrete cases with the details required above.

- **Acceptance and regression:** main user workflows, each requirement, original
  bug reproduction, expected fix, and adjacent workflows that share changed code.
- **Input validation:** missing, empty, whitespace-only, malformed, duplicate,
  minimum, maximum, and over-limit values. Cover Unicode, invalid IDs, unknown
  fields, unsafe URLs, and date or time-zone boundaries when applicable.
- **Authentication and authorization:** anonymous, expired, invalid, and revoked
  sessions; each allowed and denied role; cross-user and cross-workspace access;
  direct API requests that bypass UI guards; and no mutation on denied requests.
  Include login, callbacks, refresh, logout, and safe return paths when changed.
- **Security and privacy:** injection, rendered untrusted content, CSRF, browser
  CORS and cookie rules, redirect safety, secret exposure, sensitive error and
  log content, private cache isolation, and upload or download permissions.
- **PWA, SEO, and analytics:** manifest and icons, installability, service
  worker registration and update, offline fallback, cache exclusions, update
  cleanup, unique metadata and canonical URLs, sitemap and robots, noindex on
  private pages, consent state, event names, route page views, and no personal
  data in events.
- **Payments, when Polar is in scope:** checkout redirect, success and cancel
  returns, webhook signature and replay, idempotency, entitlement changes,
  failed payment, refund, and sandbox isolation.
- **API contracts:** method and path, request and response validation, statuses,
  headers, error shapes, content type, pagination, sorting, filtering, and
  compatibility with existing clients. Include unsupported methods and missing
  resources where affected.
- **Data integrity:** create, read, update, and delete results; persistence after
  refresh or reconnect; constraints, relationships, atomicity, rollback on
  failure, migration compatibility, and safe handling of existing records.
  Plan migrations and recovery only on isolated data with an approved target.
- **Concurrency and recovery:** repeated clicks, duplicate requests, parallel
  writes, race conditions, idempotency, bounded retries, timeouts, cancellation,
  partial failures, offline behavior, and recovery after dependency failures.
- **UI and navigation:** initial, loading, empty, success, error, disabled, and
  retry states; direct links, reload, back and forward navigation, params,
  search state, layout guards, not-found handling, and unsaved changes.
- **Forms and accessibility:** labels, field validation timing, error messages,
  keyboard-only use, tab order, focus entry and return, screen-reader names,
  announcements, contrast, zoom, reduced motion, and disabled controls.
- **Visual and device behavior:** relevant viewport sizes, overflow, long text,
  touch targets, theme states, supported browsers, hydration, and SSR output.
- **Integrations and background work:** request mapping, upstream failures,
  rate limits, queue redelivery, acknowledgements, dead-letter handling,
  scheduled work, and external side effects. Include only services in scope.
- **Performance and resource use:** realistic data sizes, pagination limits,
  unnecessary requests, cache invalidation, memory or runtime limits, and
  responsiveness. State measurable limits from requirements, not invented goals.
- **Build and release:** applicable existing build, lint, format, typecheck,
  import-boundary, and focused regression commands; dependency and runtime
  compatibility; generated assets; environment bindings; deployment smoke
  checks; and rollback prerequisites. Identify commands that require approval.

### Separate QA execution pass

- Read `QA.md` and the current source before execution. Confirm prerequisites,
  user-approved scope, and isolated local or preview resources. Do not use
  production accounts or modify production data without explicit approval.
- Use Playwriter for browser workflows and browser-enforced CORS, cookie, and
  CSRF behavior. Use `curl` for supported HTTP endpoints. Inspect observable
  results, response status, headers, body, side effects, and browser errors.
- Use the existing typed Effect RPC client when `curl` cannot use the
  configured serialization and protocol. Do not invent RPC envelopes. Use
  Effect Schema for applicable contract checks.
- Use existing tools first. Run only relevant test files or filtered cases,
  never an unrelated whole-project suite. Create focused tests only on explicit
  request. Keep new tests, fixtures, and artifacts local and ignored unless
  the user explicitly asks to commit them. Do not install test libraries.
- A general QA request does not authorize separately restricted local check or
  typecheck commands, production changes, deployment, or destructive operations.
  Obtain explicit approval for these actions before execution.
- Record actual results and inspect evidence before marking cases passed.
  Report failed, blocked, and unrun cases by ID. Never describe implementation
  completion as QA completion when cases remain pending.

## Generated, runtime, and protected files

- Do not manually edit generated route trees, framework caches, or generated
  migration metadata. Use their owning generators.
- Ignore `routeTree.gen.ts`, `.tanstack/`, `.turbo/`, build output, and local
  runtime state. Commit reviewed SQL migrations and their required metadata.
- Keep Bun SQL, Redis, S3, media, HTTP adapters, and server services out of
  browser bundles. Shared Effect contracts must remain browser-safe.
- Do not commit secrets, local environment files, credentials, sensitive logs,
  build output, dependency caches, or temporary files.

## Git and completion

- Keep one commit per feature, fix, or context switch.
- Check `git status` before and after work.
- Do not include unrelated files in a commit.
- Before completion, check that each new file belongs to its owning domain
  or shared module. Check that cross-feature dependencies remain acyclic,
  business logic is not copied across entrypoints, and direct database calls
  meet the simple-operation rule in Architecture boundaries.
- Follow the Validation workflow above. Complete the detailed `QA.md`
  checklist before handoff. Report unresolved boundary violations and tooling
  gaps. Do not treat written rules as proof of enforcement.
- Final response must state changed files, the `QA.md` path, pending case IDs
  and priorities, checks actually run, and checks deferred. State clearly when
  implementation is complete but QA has not run.

## Sources

- Bun lint and canary requirement: https://bun.com/docs/lint.
- Bun typechecker and script precedence: https://bun.com/docs/runtime/check.
- Bun formatter and configuration: https://bun.com/docs/format.
- Bun SQL: https://bun.com/docs/runtime/sql.
- Bun Redis: https://bun.com/docs/runtime/redis.
- Bun S3: https://bun.com/docs/runtime/s3.
- Effect releases and version-specific source: https://github.com/Effect-TS/effect-smol.
- Effect Bun adapter source, development branch; verify the pinned release:
  https://github.com/Effect-TS/effect-smol/blob/main/packages/platform-bun/src/BunHttpServer.ts.
- Turborepo task configuration: https://turborepo.com/docs/crafting-your-repository/configuring-tasks.
- PWA: https://vite-pwa-org.netlify.app.
- WCAG 2.2: https://www.w3.org/TR/WCAG22/.
- Google Analytics 4: https://developers.google.com/analytics/devguides/collection/ga4.
- Umami: https://umami.is/docs.
- Polar: https://polar.sh/docs.

## Current application workspaces

- The current target is the native desktop app in `apps/desktop`.
  Its render entry is `apps/desktop/src/app.tsx`.
- Keep desktop workflows in their owning `src/features/` folders. Keep shared
  native controls in `src/components/ui/` and runtime adapters in `src/platform/`.
- `packages/notes` owns platform-neutral Markdown analysis and source-edit
  contracts. It must not import GPUix, React, or filesystem adapters.
- `packages/env` owns runtime configuration and OS data paths. Use its concrete
  `@still-notes/env/server` export from native code.
- Root desktop launch scripts pass `STILL_NOTES_LAUNCH_DIRECTORY`. Keep it
  connected to the caller directory so relative data overrides do not move.
- Root `bun-toolchain.json` and the exact local Bun dependency define the
  runtime revision. Do not replace the user's global Bun installation.
- Preserve existing `workspace.json`, backup, lock and settings contracts during
  source moves. Keep generated native binaries and QA artifacts ignored.
- Before writing Effect code, read `node_modules/effect/AGENTS.md` completely.
  Follow its linked guidance and inspect the pinned v4-or-higher source APIs.
