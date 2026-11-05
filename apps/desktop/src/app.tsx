import { render } from "@gpuix/react"
import { defaultDataDirectory, readEnvironment } from "@still-notes/env/server"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"

import type { NotesError } from "@/features/notes/errors"
import type { SettingsError } from "@/features/settings/store"

import { EffectBoundary } from "@/components/effect-boundary"
import { RecoveryScreen } from "@/components/recovery-screen"
import { Notes } from "@/features/notes/store"
import { Settings } from "@/features/settings/store"
import { App } from "@/features/workspace/components/workspace-shell"

const directory = defaultDataDirectory()

const environment = readEnvironment()

const desktopLayer = Layer.mergeAll(
  Notes.layer(directory),
  Settings.layer(directory),
)

declare global {
  var stillNotesRuntime:
    | ManagedRuntime.ManagedRuntime<
        Notes | Settings,
        NotesError | SettingsError
      >
    | undefined
}

const runtime = (globalThis.stillNotesRuntime ??=
  ManagedRuntime.make(desktopLayer))

const options = {
  title: "Still Notes",
  appName: "Still Notes",
  width: environment.width,
  height: environment.height,
  focus: !environment.background,
  windowBackground: "opaque" as const,
}

function runDesktopEffect<Success, Failure>(
  program: Effect.Effect<Success, Failure>,
) {
  const exit = runtime.runSyncExit(program)

  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)

  return exit.value
}

function releaseResources() {
  Effect.runSync(runtime.disposeEffect)
}

function shutdown() {
  process.exit(0)
}

try {
  const startup = runtime.runSyncExit(
    Effect.gen(function* () {
      const store = yield* Notes
      const settings = yield* Settings

      return { store, settings }
    }),
  )

  if (Exit.isFailure(startup)) throw Cause.squash(startup.cause)

  process.removeListener("exit", releaseResources)
  process.once("exit", releaseResources)
  process.removeListener("SIGTERM", shutdown)
  process.once("SIGTERM", shutdown)
  process.removeListener("SIGINT", shutdown)
  process.once("SIGINT", shutdown)

  render(
    <EffectBoundary run={runDesktopEffect}>
      <App
        store={startup.value.store}
        dataDirectory={directory}
        settings={startup.value.settings}
      />
    </EffectBoundary>,
    options,
  )
} catch (cause) {
  const error = cause instanceof Error ? cause.message : String(cause)
  console.error(error)
  render(<RecoveryScreen error={error} directory={directory} />, options)
}
