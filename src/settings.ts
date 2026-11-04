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
import { z } from "zod"

import { atomicWrite } from "@/utils/files"

const stringList = z.array(z.string()).default([]).readonly()

const stringMap = z.record(z.string(), z.string()).default({}).readonly()

const keymap = z
  .record(z.string(), z.union([z.string(), z.array(z.string()).readonly()]))
  .default({})
  .readonly()

const jsonMap = z.record(z.string(), z.json()).default({}).readonly()

const fontName = z.string().max(256).nullable().default(null)

const width = z.number().int().min(320).max(2400)

const preferencesSchema = z
  .strictObject({
    vimMode: z.boolean().default(false),
    vimInsertEscape: z.string().max(16).default(""),
    vimYankToClipboard: z.boolean().default(false),
    vimBlockImeInNormalMode: z.boolean().default(true),
    vimWrappedLineMotions: z.enum(["display", "logical"]).default("display"),
    whichKeyHints: z.boolean().default(true),
    whichKeyHintMode: z.enum(["timed", "always", "off"]).default("timed"),
    whichKeyHintTimeoutMs: z.number().int().min(0).max(10000).default(900),
    keymapOverrides: keymap,
    commandKeymaps: keymap,
    ignoredKeys: stringList,
    externalApplicationSchemes: stringList,
    vaultTextSearchBackend: z
      .enum(["auto", "builtin", "ripgrep"])
      .default("auto"),
    ripgrepBinaryPath: fontName,
    fzfBinaryPath: fontName,
    searchTaggedBlocks: z.boolean().default(true),
    livePreview: z.boolean().default(true),
    showHeadingLevelLabels: z.boolean().default(false),
    listIndentGuides: z.boolean().default(true),
    linkPopoverOnHover: z.boolean().default(true),
    renderTablesInLivePreview: z.boolean().default(true),
    detectCodeLanguages: z.boolean().default(true),
    completedTaskStyle: z
      .enum(["none", "strikethrough", "gray", "gray-strikethrough"])
      .default("none"),
    mathRenderer: z.enum(["katex", "typst"]).default("katex"),
    typstTagPreambles: z.boolean().default(false),
    harperEnabled: z.boolean().default(false),
    harperDialect: z
      .enum(["american", "british", "canadian", "australian"])
      .default("american"),
    looseMathDelimiters: z.boolean().default(false),
    keepViewModeAcrossNotes: z.boolean().default(false),
    keepPanelsAcrossNotes: z.boolean().default(true),
    persistUndoHistory: z.boolean().default(false),
    defaultPaneMode: z.enum(["edit", "split", "preview"]).default("edit"),
    syncTitleHeadingOnRename: z.boolean().default(true),
    reviewAgentEdits: z.boolean().default(true),
    usageCount: z.boolean().default(false),
    markdownSnippets: z.boolean().default(true),
    textReplacementsEnabled: z.boolean().default(true),
    textReplacements: z
      .record(z.string(), z.string())
      .default({ "->": "→" })
      .readonly(),
    autoPairs: z.boolean().default(true),
    autoPairQuotesInProse: z.boolean().default(false),
    hideBuiltinTemplates: z.boolean().default(false),
    tabsEnabled: z.boolean().default(true),
    wrapTabs: z.boolean().default(false),
    editorFontSize: z.number().min(10).max(40).default(16),
    mathFontScale: z.number().min(50).max(300).default(100),
    editorLineHeight: z.number().min(1).max(3).default(1.7),
    editorTabSize: z.number().int().min(1).max(16).default(4),
    editorScrollOff: z.number().int().min(0).max(100).default(0),
    timeFormat: z.enum(["12h", "24h"]).default("24h"),
    previewMaxWidth: width.default(920),
    editorMaxWidth: width.default(920),
    lineNumberMode: z.enum(["off", "absolute", "relative"]).default("off"),
    lineNumberPosition: z.enum(["text", "edge"]).default("text"),
    viewSettingsScope: z.enum(["global", "vault"]).default("global"),
    wordWrap: z.boolean().default(true),
    previewSmoothScroll: z.boolean().default(true),
    pdfEmbedInEditMode: z
      .enum(["compact", "full", "hidden"])
      .default("compact"),
    pdfExportUseTheme: z.boolean().default(false),
    themeId: z.string().default("yopem-light"),
    themeFamily: z.string().default("yopem"),
    themeMode: z.enum(["light", "dark", "system"]).default("system"),
    enabledOverrides: z.record(z.string(), z.boolean()).default({}).readonly(),
    themeTweaks: jsonMap,
    darkSidebar: z.boolean().default(false),
    showWindowTitleBar: z.boolean().default(true),
    showStatusBar: z.boolean().default(true),
    showSidebarChevrons: z.boolean().default(true),
    contentAlign: z.enum(["left", "center"]).default("center"),
    noteCoverPlacement: z.enum(["scroll", "fixed"]).default("scroll"),
    unifiedSidebar: z.boolean().default(true),
    interfaceFont: fontName,
    textFont: fontName,
    monoFont: fontName,
    workflowsEnabled: z.boolean().default(false),
    workflowEventTriggers: z.boolean().default(true),
    hiddenWorkflowPresets: stringList,
    atlasEnabled: z.boolean().default(true),
    systemFolderLabels: stringMap,
    noteSortOrder: z
      .enum([
        "none",
        "updated-desc",
        "updated-asc",
        "created-desc",
        "created-asc",
        "name-asc",
        "name-desc",
      ])
      .default("none"),
    assetSortOrder: z
      .enum([
        "name-asc",
        "name-desc",
        "updated-desc",
        "updated-asc",
        "size-asc",
        "size-desc",
      ])
      .default("name-asc"),
    groupByKind: z.boolean().default(true),
    nestedTags: z.boolean().default(true),
    autoReveal: z.boolean().default(false),
    quickNoteDateTitle: z.boolean().default(false),
    quickNoteTitlePrefix: z.string().max(200).default("Quick Note"),
    autoCalendarPanel: z.boolean().default(true),
    calendarWeekStart: z
      .enum(["monday", "sunday", "saturday"])
      .default("monday"),
    calendarShowWeekNumbers: z.boolean().default(true),
    tasksViewMode: z
      .enum(["list", "kanban", "calendar", "timeline", "gallery"])
      .default("list"),
    showArchivedTasks: z.boolean().default(false),
    kanbanGroupBy: z
      .enum(["status", "folder", "tag", "priority", "due"])
      .default("status"),
    kanbanCardSort: z
      .enum(["manual", "updated", "created", "title", "due", "priority"])
      .default("manual"),
    hideEmptyTasks: z.boolean().default(true),
    taskReminders: z.boolean().default(true),
    taskReminderTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .default("09:00"),
    kanbanWipLimits: z
      .record(z.string(), z.number().int().min(0).max(10000))
      .default({})
      .readonly(),
    kanbanColumnColors: stringMap,
    kanbanLanes: z.enum(["none", "folder", "tag", "priority"]).default("none"),
    tasksListOrder: z
      .enum(["note", "due", "priority", "created"])
      .default("note"),
    timelineRange: z
      .enum(["week", "two-weeks", "month", "quarter", "year"])
      .default("two-weeks"),
    gallerySort: z.enum(["updated", "created", "title"]).default("updated"),
    galleryIncludeSubfolders: z.boolean().default(false),
    kanbanFolderRoot: z.string().default(""),
    kanbanColumnTitles: stringMap,
    kanbanStatuses: stringList,
    savedTaskFilters: jsonMap,
    recentVaults: stringList,
    activeVault: z.string().nullable().default(null),
  })
  .readonly()

const settingsFileSchema = z.strictObject({
  version: z.literal(1),
  preferences: preferencesSchema,
})

const fileErrorSchema = z.object({ code: z.string() })

export type Preferences = z.infer<typeof preferencesSchema>

function readSettings(path: string) {
  let fd: number

  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  } catch (cause) {
    if (fileErrorSchema.safeParse(cause).data?.code === "ENOENT") return null
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
          ? preferencesSchema.parse({})
          : settingsFileSchema.parse(JSON.parse(existing)).preferences
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

  update(patch: Partial<Preferences>) {
    const next = preferencesSchema.parse({ ...this.snapshot, ...patch })
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
