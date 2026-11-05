import { Config, ConfigProvider, Effect, Option, Schema } from "effect"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

const launchDirectorySchema = Schema.NonEmptyString.check(
  Schema.makeFilter(isAbsolute, { expected: "an absolute launch directory" }),
)

const widthSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 640, maximum: 3840 }),
)

const heightSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 480, maximum: 2160 }),
)

function optionalConfig<A>(config: Config.Config<A>) {
  return config.pipe(Config.option, Config.map(Option.getOrUndefined))
}

const desktopConfig = Config.all({
  dataDirectory: optionalConfig(
    Config.schema(Schema.NonEmptyString, "STILL_NOTES_DATA_DIR"),
  ),
  launchDirectory: optionalConfig(
    Config.schema(launchDirectorySchema, "STILL_NOTES_LAUNCH_DIRECTORY"),
  ),
  localAppData: optionalConfig(
    Config.schema(Schema.NonEmptyString, "LOCALAPPDATA"),
  ),
  appData: optionalConfig(Config.schema(Schema.NonEmptyString, "APPDATA")),
  xdgDataHome: optionalConfig(
    Config.schema(Schema.NonEmptyString, "XDG_DATA_HOME"),
  ),
  background: optionalConfig(Config.String("GPUIX_BACKGROUND")).pipe(
    Config.map((value) => value === "1"),
  ),
  width: Config.schema(widthSchema, "STILL_NOTES_WIDTH").pipe(
    Config.withDefault(1360),
  ),
  height: Config.schema(heightSchema, "STILL_NOTES_HEIGHT").pipe(
    Config.withDefault(900),
  ),
  binary: optionalConfig(
    Config.schema(Schema.NonEmptyString, "STILL_NOTES_BINARY"),
  ),
  desktop: optionalConfig(Config.String("XDG_CURRENT_DESKTOP")),
})

export function loadDesktopEnvironment() {
  return Effect.suspend(() =>
    desktopConfig.parse(
      ConfigProvider.fromUnknown(Bun.env, { preserveEmptyStrings: true }),
    ),
  )
}

export function readEnvironment() {
  return Effect.runSync(loadDesktopEnvironment())
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
