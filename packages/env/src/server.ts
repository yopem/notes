import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { z } from "zod"

const environmentSchema = z.object({
  dataDirectory: z.string().min(1).optional(),
  launchDirectory: z
    .string()
    .min(1)
    .refine(isAbsolute, "Use an absolute launch directory")
    .optional(),
  localAppData: z.string().min(1).optional(),
  appData: z.string().min(1).optional(),
  xdgDataHome: z.string().min(1).optional(),
  background: z.boolean(),
  width: z.coerce.number().int().min(640).max(3840).default(1360),
  height: z.coerce.number().int().min(480).max(2160).default(900),
  binary: z.string().min(1).optional(),
  desktop: z.string().optional(),
})

export function readEnvironment() {
  return environmentSchema.parse({
    dataDirectory: process.env.STILL_NOTES_DATA_DIR,
    launchDirectory: process.env.STILL_NOTES_LAUNCH_DIRECTORY,
    localAppData: process.env.LOCALAPPDATA,
    appData: process.env.APPDATA,
    xdgDataHome: process.env.XDG_DATA_HOME,
    background: process.env.GPUIX_BACKGROUND === "1",
    width: process.env.STILL_NOTES_WIDTH,
    height: process.env.STILL_NOTES_HEIGHT,
    binary: process.env.STILL_NOTES_BINARY,
    desktop: process.env.XDG_CURRENT_DESKTOP,
  })
}

export function defaultDataDirectory() {
  const environment = readEnvironment()

  if (environment.dataDirectory)
    return resolve(
      environment.launchDirectory ?? process.cwd(),
      environment.dataDirectory,
    )

  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "Still Notes")

  if (process.platform === "win32")
    return join(
      environment.localAppData ??
        environment.appData ??
        join(homedir(), "AppData", "Local"),
      "Still Notes",
    )
  const xdg = environment.xdgDataHome

  return join(
    xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share"),
    "still-notes",
  )
}
