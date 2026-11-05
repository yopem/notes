import { Effect, Option, Schema, SchemaTransformation, Struct } from "effect"
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs"
import { join, resolve } from "node:path"

import { atomicWrite } from "@/platform/files"

function frozen<S extends Schema.Constraint & { readonly Type: object }>(
  schema: S,
) {
  // A declaration keeps the frozen value; a struct target would copy it.
  const target = Schema.declare<S["Type"]>(Schema.is(Schema.toType(schema)))

  return Schema.decodeTo<typeof target, S>(
    target,
    SchemaTransformation.transform<S["Type"], S["Type"]>({
      decode: (value) => Object.freeze(value),
      encode: (value) => value,
    }),
  )(schema)
}

const stringList = Schema.Array(Schema.String)
  .pipe(Schema.withDecodingDefault(Effect.succeed([])))
  .pipe(frozen)

const stringMap = Schema.Record(Schema.String, Schema.String)
  .pipe(Schema.withDecodingDefault(Effect.succeed({})))
  .pipe(frozen)

const keymap = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Array(Schema.String).pipe(frozen)]),
)
  .pipe(Schema.withDecodingDefault(Effect.succeed({})))
  .pipe(frozen)

const jsonMap = Schema.Record(Schema.String, Schema.Json)
  .pipe(Schema.withDecodingDefault(Effect.succeed({})))
  .pipe(frozen)

const fontName = Schema.String.check(Schema.isMaxLength(256))
  .pipe(Schema.NullOr)
  .pipe(Schema.withDecodingDefault(Effect.succeed(null)))

const width = Schema.Finite.check(Schema.isInt())
  .check(Schema.isGreaterThanOrEqualTo(320))
  .check(Schema.isLessThanOrEqualTo(2400))

const preferenceFields = {
  vimMode: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  vimInsertEscape: Schema.String.check(Schema.isMaxLength(16)).pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  vimYankToClipboard: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  vimBlockImeInNormalMode: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  vimWrappedLineMotions: Schema.Literals(["display", "logical"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("display")),
  ),
  whichKeyHints: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  whichKeyHintMode: Schema.Literals(["timed", "always", "off"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("timed")),
  ),
  whichKeyHintTimeoutMs: Schema.Finite.check(Schema.isInt())
    .check(Schema.isGreaterThanOrEqualTo(0))
    .check(Schema.isLessThanOrEqualTo(10000))
    .pipe(Schema.withDecodingDefault(Effect.succeed(900))),
  keymapOverrides: keymap,
  commandKeymaps: keymap,
  ignoredKeys: stringList,
  externalApplicationSchemes: stringList,
  vaultTextSearchBackend: Schema.Literals(["auto", "builtin", "ripgrep"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("auto")),
  ),
  ripgrepBinaryPath: fontName,
  fzfBinaryPath: fontName,
  searchTaggedBlocks: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  livePreview: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  showHeadingLevelLabels: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  listIndentGuides: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  linkPopoverOnHover: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  renderTablesInLivePreview: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  detectCodeLanguages: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  completedTaskStyle: Schema.Literals([
    "none",
    "strikethrough",
    "gray",
    "gray-strikethrough",
  ]).pipe(Schema.withDecodingDefault(Effect.succeed("none"))),
  mathRenderer: Schema.Literals(["katex", "typst"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("katex")),
  ),
  typstTagPreambles: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  harperEnabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  harperDialect: Schema.Literals([
    "american",
    "british",
    "canadian",
    "australian",
  ]).pipe(Schema.withDecodingDefault(Effect.succeed("american"))),
  looseMathDelimiters: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  keepViewModeAcrossNotes: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  keepPanelsAcrossNotes: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  persistUndoHistory: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  defaultPaneMode: Schema.Literals(["edit", "split", "preview"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("edit")),
  ),
  syncTitleHeadingOnRename: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  reviewAgentEdits: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  usageCount: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  markdownSnippets: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  textReplacementsEnabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  textReplacements: Schema.Record(Schema.String, Schema.String)
    .pipe(Schema.withDecodingDefault(Effect.succeed({ "->": "→" })))
    .pipe(frozen),
  autoPairs: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  autoPairQuotesInProse: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  hideBuiltinTemplates: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  tabsEnabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  wrapTabs: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  editorFontSize: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(10))
    .check(Schema.isLessThanOrEqualTo(40))
    .pipe(Schema.withDecodingDefault(Effect.succeed(16))),
  mathFontScale: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(50))
    .check(Schema.isLessThanOrEqualTo(300))
    .pipe(Schema.withDecodingDefault(Effect.succeed(100))),
  editorLineHeight: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1))
    .check(Schema.isLessThanOrEqualTo(3))
    .pipe(Schema.withDecodingDefault(Effect.succeed(1.7))),
  editorTabSize: Schema.Finite.check(Schema.isInt())
    .check(Schema.isGreaterThanOrEqualTo(1))
    .check(Schema.isLessThanOrEqualTo(16))
    .pipe(Schema.withDecodingDefault(Effect.succeed(4))),
  editorScrollOff: Schema.Finite.check(Schema.isInt())
    .check(Schema.isGreaterThanOrEqualTo(0))
    .check(Schema.isLessThanOrEqualTo(100))
    .pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  timeFormat: Schema.Literals(["12h", "24h"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("24h")),
  ),
  previewMaxWidth: width.pipe(Schema.withDecodingDefault(Effect.succeed(920))),
  editorMaxWidth: width.pipe(Schema.withDecodingDefault(Effect.succeed(920))),
  lineNumberMode: Schema.Literals(["off", "absolute", "relative"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("off")),
  ),
  lineNumberPosition: Schema.Literals(["text", "edge"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("text")),
  ),
  viewSettingsScope: Schema.Literals(["global", "vault"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("global")),
  ),
  wordWrap: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  previewSmoothScroll: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  pdfEmbedInEditMode: Schema.Literals(["compact", "full", "hidden"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("compact")),
  ),
  pdfExportUseTheme: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  themeId: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("yopem-light")),
  ),
  themeFamily: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("yopem")),
  ),
  themeMode: Schema.Literals(["light", "dark", "system"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("system")),
  ),
  enabledOverrides: Schema.Record(Schema.String, Schema.Boolean)
    .pipe(Schema.withDecodingDefault(Effect.succeed({})))
    .pipe(frozen),
  themeTweaks: jsonMap,
  darkSidebar: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  showWindowTitleBar: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  showStatusBar: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  showSidebarChevrons: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  contentAlign: Schema.Literals(["left", "center"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("center")),
  ),
  noteCoverPlacement: Schema.Literals(["scroll", "fixed"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("scroll")),
  ),
  unifiedSidebar: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  interfaceFont: fontName,
  textFont: fontName,
  monoFont: fontName,
  workflowsEnabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  workflowEventTriggers: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  hiddenWorkflowPresets: stringList,
  atlasEnabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  systemFolderLabels: stringMap,
  noteSortOrder: Schema.Literals([
    "none",
    "updated-desc",
    "updated-asc",
    "created-desc",
    "created-asc",
    "name-asc",
    "name-desc",
  ]).pipe(Schema.withDecodingDefault(Effect.succeed("none"))),
  assetSortOrder: Schema.Literals([
    "name-asc",
    "name-desc",
    "updated-desc",
    "updated-asc",
    "size-asc",
    "size-desc",
  ]).pipe(Schema.withDecodingDefault(Effect.succeed("name-asc"))),
  groupByKind: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  nestedTags: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  autoReveal: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  quickNoteDateTitle: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  quickNoteTitlePrefix: Schema.String.check(Schema.isMaxLength(200)).pipe(
    Schema.withDecodingDefault(Effect.succeed("Quick Note")),
  ),
  autoCalendarPanel: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  calendarWeekStart: Schema.Literals(["monday", "sunday", "saturday"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("monday")),
  ),
  calendarShowWeekNumbers: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  tasksViewMode: Schema.Literals([
    "list",
    "kanban",
    "calendar",
    "timeline",
    "gallery",
  ]).pipe(Schema.withDecodingDefault(Effect.succeed("list"))),
  showArchivedTasks: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  kanbanGroupBy: Schema.Literals([
    "status",
    "folder",
    "tag",
    "priority",
    "due",
  ]).pipe(Schema.withDecodingDefault(Effect.succeed("status"))),
  kanbanCardSort: Schema.Literals([
    "manual",
    "updated",
    "created",
    "title",
    "due",
    "priority",
  ]).pipe(Schema.withDecodingDefault(Effect.succeed("manual"))),
  hideEmptyTasks: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  taskReminders: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  taskReminderTime: Schema.String.check(
    Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  ).pipe(Schema.withDecodingDefault(Effect.succeed("09:00"))),
  kanbanWipLimits: Schema.Record(
    Schema.String,
    Schema.Finite.check(Schema.isInt())
      .check(Schema.isGreaterThanOrEqualTo(0))
      .check(Schema.isLessThanOrEqualTo(10000)),
  )
    .pipe(Schema.withDecodingDefault(Effect.succeed({})))
    .pipe(frozen),
  kanbanColumnColors: stringMap,
  kanbanLanes: Schema.Literals(["none", "folder", "tag", "priority"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("none")),
  ),
  tasksListOrder: Schema.Literals(["note", "due", "priority", "created"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("note")),
  ),
  timelineRange: Schema.Literals([
    "week",
    "two-weeks",
    "month",
    "quarter",
    "year",
  ]).pipe(Schema.withDecodingDefault(Effect.succeed("two-weeks"))),
  gallerySort: Schema.Literals(["updated", "created", "title"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("updated")),
  ),
  galleryIncludeSubfolders: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  kanbanFolderRoot: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  kanbanColumnTitles: stringMap,
  kanbanStatuses: stringList,
  savedTaskFilters: jsonMap,
  recentVaults: stringList,
  activeVault: Schema.String.pipe(Schema.NullOr).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
}

const preferencesSchema = Schema.Struct(preferenceFields).pipe(frozen)

export const settingsFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  preferences: preferencesSchema,
})

const fileErrorSchema = Schema.Struct({ code: Schema.String })

export type Preferences = typeof preferencesSchema.Type

export const preferenceInputSchema = Schema.Json

export type PreferenceInput = typeof preferenceInputSchema.Type

export const preferenceNames = Struct.keys(preferenceFields)

function readSettings(path: string) {
  let fd: number

  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  } catch (cause) {
    if (
      Option.getOrUndefined(Schema.decodeUnknownOption(fileErrorSchema)(cause))
        ?.code === "ENOENT"
    )
      return null
    throw cause
  }

  try {
    const stat = fstatSync(fd)

    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new Error(`Invalid settings file: ${path}`)
    const bytes = readFileSync(fd)

    if (bytes.length > 1024 * 1024)
      throw new Error(`Settings file is too large: ${path}`)

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } finally {
    closeSync(fd)
  }
}

export class SettingsStore {
  private readonly path: string
  private readonly directory: string
  private bytes: string
  private snapshot: Preferences
  private readonly listeners = new Set<() => void>()

  constructor(directory: string) {
    mkdirSync(resolve(directory), { recursive: true, mode: 0o700 })
    this.directory = realpathSync(resolve(directory))
    this.path = join(this.directory, "settings.json")
    const existing = readSettings(this.path)

    try {
      this.snapshot =
        existing === null
          ? Schema.decodeUnknownSync(preferencesSchema, {
              onExcessProperty: "error",
              errors: "all",
            })({})
          : Schema.decodeUnknownSync(settingsFileSchema, {
              onExcessProperty: "error",
              errors: "all",
            })(JSON.parse(existing)).preferences
    } catch (cause) {
      throw new Error(
        `Cannot load settings: ${this.path}. Preserve this file before recovery.`,
        { cause },
      )
    }

    this.bytes =
      existing ??
      JSON.stringify({ version: 1, preferences: this.snapshot }, null, 2) + "\n"

    if (existing === null) atomicWrite(this.path, this.bytes, this.directory)
  }

  getSnapshot() {
    return this.snapshot
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  setField(name: keyof Preferences, input: PreferenceInput) {
    this.update(
      Schema.decodeUnknownSync(preferencesSchema, {
        onExcessProperty: "error",
        errors: "all",
      })({ ...this.snapshot, [name]: input }),
    )
  }

  update(patch: Partial<Preferences>) {
    const next = Schema.decodeUnknownSync(preferencesSchema, {
      onExcessProperty: "error",
      errors: "all",
    })({ ...this.snapshot, ...patch })

    const bytes =
      JSON.stringify({ version: 1, preferences: next }, null, 2) + "\n"

    if (Buffer.byteLength(bytes, "utf8") > 1024 * 1024)
      throw new Error("Settings exceed the 1 MB limit")

    if (readSettings(this.path) !== this.bytes)
      throw new Error(
        "Settings changed outside this instance. Reopen before saving.",
      )
    atomicWrite(this.path, bytes, this.directory)
    this.snapshot = next
    this.bytes = bytes

    for (const listener of this.listeners) {
      try {
        listener()
      } catch (cause) {
        console.warn("Settings subscriber failed", cause)
      }
    }
  }
}
