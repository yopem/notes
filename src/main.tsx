import { render } from "@gpuix/react"

import { App } from "@/components/app"
import { RecoveryScreen } from "@/components/recovery-screen"
import { readEnvironment } from "@/utils/env"
import { NotesStore, defaultDataDirectory } from "@/store"

declare global {
  var stillNotesStore: NotesStore | undefined
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

  render(
    <App store={globalThis.stillNotesStore} dataDirectory={directory} />,
    options,
  )
} catch (cause) {
  const error = cause instanceof Error ? cause.message : String(cause)
  console.error(error)
  render(<RecoveryScreen error={error} directory={directory} />, options)
}
