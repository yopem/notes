import { render } from "@gpuix/react"

import { App } from "@/components/app"
import { RecoveryScreen } from "@/components/recovery-screen"
import { SettingsStore } from "@/settings"
import { defaultDataDirectory, NotesStore } from "@/store"
import { readEnvironment } from "@/utils/env"

declare global {
  var stillNotesStore: NotesStore | undefined
  var stillNotesSettings: SettingsStore | undefined
}

const directory = defaultDataDirectory()

const environment = readEnvironment()

const options = {
  title: "Still Notes",
  appName: "Still Notes",
  width: environment.width,
  height: environment.height,
  focus: !environment.background,
  windowBackground: "opaque" as const,
}

try {
  if (!globalThis.stillNotesStore) {
    globalThis.stillNotesStore = new NotesStore(directory)
    process.once("exit", () => globalThis.stillNotesStore?.close())
    process.once("SIGTERM", () => process.exit(0))
    process.once("SIGINT", () => process.exit(0))
  }

  globalThis.stillNotesSettings ??= new SettingsStore(directory)
  render(
    <App
      store={globalThis.stillNotesStore}
      dataDirectory={directory}
      settings={globalThis.stillNotesSettings}
    />,
    options,
  )
} catch (cause) {
  const error = cause instanceof Error ? cause.message : String(cause)
  console.error(error)
  render(<RecoveryScreen error={error} directory={directory} />, options)
}
