import * as Dialog from "@gpuix/react/dialog"
import { useState, useSyncExternalStore } from "react"
import { z } from "zod"

import { Button, Label } from "@/components/ui/controls"
import {
  type PreferenceInput,
  preferenceInputSchema,
  preferenceNames,
  type Preferences,
  type SettingsStore,
} from "@/settings"
import { inputStyle, type Palette } from "@/utils/theme"

const booleanPreferenceSchema = z.boolean()

const numberPreferenceSchema = z.number()

const textPreferenceSchema = z.string()

const sections = [
  "editor",
  "appearance",
  "navigation",
  "tasks",
  "shortcuts",
  "advanced",
] as const

type Section = (typeof sections)[number]

const groups: Record<
  Exclude<Section, "advanced">,
  readonly (keyof Preferences)[]
> = {
  editor: [
    "editorFontSize",
    "editorLineHeight",
    "editorTabSize",
    "editorMaxWidth",
    "wordWrap",
    "textFont",
    "monoFont",
    "livePreview",
    "defaultPaneMode",
    "lineNumberMode",
    "lineNumberPosition",
    "markdownSnippets",
    "autoPairs",
    "autoPairQuotesInProse",
    "textReplacementsEnabled",
    "textReplacements",
    "detectCodeLanguages",
    "renderTablesInLivePreview",
    "mathRenderer",
    "mathFontScale",
    "looseMathDelimiters",
    "typstTagPreambles",
    "harperEnabled",
    "harperDialect",
    "persistUndoHistory",
    "syncTitleHeadingOnRename",
  ],
  appearance: [
    "themeMode",
    "themeId",
    "themeFamily",
    "interfaceFont",
    "previewMaxWidth",
    "contentAlign",
    "darkSidebar",
    "showWindowTitleBar",
    "showStatusBar",
    "showSidebarChevrons",
    "noteCoverPlacement",
    "previewSmoothScroll",
    "enabledOverrides",
    "themeTweaks",
  ],
  navigation: [
    "tabsEnabled",
    "wrapTabs",
    "unifiedSidebar",
    "noteSortOrder",
    "assetSortOrder",
    "groupByKind",
    "nestedTags",
    "autoReveal",
    "keepViewModeAcrossNotes",
    "keepPanelsAcrossNotes",
    "autoCalendarPanel",
    "calendarWeekStart",
    "calendarShowWeekNumbers",
    "quickNoteDateTitle",
    "quickNoteTitlePrefix",
    "systemFolderLabels",
    "atlasEnabled",
    "viewSettingsScope",
  ],
  tasks: [
    "tasksViewMode",
    "showArchivedTasks",
    "hideEmptyTasks",
    "completedTaskStyle",
    "tasksListOrder",
    "taskReminders",
    "taskReminderTime",
    "kanbanGroupBy",
    "kanbanCardSort",
    "kanbanLanes",
    "kanbanWipLimits",
    "kanbanColumnColors",
    "kanbanFolderRoot",
    "kanbanColumnTitles",
    "kanbanStatuses",
    "timelineRange",
    "gallerySort",
    "galleryIncludeSubfolders",
    "savedTaskFilters",
  ],
  shortcuts: [
    "vimMode",
    "vimInsertEscape",
    "vimYankToClipboard",
    "vimBlockImeInNormalMode",
    "vimWrappedLineMotions",
    "whichKeyHints",
    "whichKeyHintMode",
    "whichKeyHintTimeoutMs",
    "commandKeymaps",
    "keymapOverrides",
    "ignoredKeys",
  ],
}

const choices: Partial<Record<keyof Preferences, readonly string[]>> = {
  themeMode: ["system", "light", "dark"],
  defaultPaneMode: ["edit", "split", "preview"],
  contentAlign: ["left", "center"],
  lineNumberMode: ["off", "absolute", "relative"],
  lineNumberPosition: ["text", "edge"],
  mathRenderer: ["katex", "typst"],
  harperDialect: ["american", "british", "canadian", "australian"],
  calendarWeekStart: ["monday", "sunday", "saturday"],
  completedTaskStyle: ["none", "strikethrough", "gray", "gray-strikethrough"],
  tasksViewMode: ["list", "kanban", "calendar", "timeline", "gallery"],
  kanbanGroupBy: ["status", "folder", "tag", "priority", "due"],
  kanbanCardSort: ["manual", "updated", "created", "title", "due", "priority"],
  kanbanLanes: ["none", "folder", "tag", "priority"],
  tasksListOrder: ["note", "due", "priority", "created"],
  timelineRange: ["week", "two-weeks", "month", "quarter", "year"],
  gallerySort: ["updated", "created", "title"],
  vimWrappedLineMotions: ["display", "logical"],
  whichKeyHintMode: ["timed", "always", "off"],
  viewSettingsScope: ["global", "vault"],
  noteCoverPlacement: ["scroll", "fixed"],
  timeFormat: ["12h", "24h"],
  vaultTextSearchBackend: ["auto", "builtin", "ripgrep"],
  pdfEmbedInEditMode: ["compact", "full", "hidden"],
  noteSortOrder: [
    "none",
    "updated-desc",
    "updated-asc",
    "created-desc",
    "created-asc",
    "name-asc",
    "name-desc",
  ],
  assetSortOrder: [
    "name-asc",
    "name-desc",
    "updated-desc",
    "updated-asc",
    "size-asc",
    "size-desc",
  ],
}

export function PreferenceControl({
  name,
  value,
  store,
  color,
  onError,
}: {
  name: keyof Preferences
  value: Preferences[keyof Preferences]
  store: SettingsStore
  color: Palette
  onError: (message: string) => void
}) {
  const text = textPreferenceSchema.safeParse(value)

  const [input, setInput] = useState(
    text.success
      ? text.data
      : value === null
        ? ""
        : JSON.stringify(value, null, 2),
  )

  const boolean = booleanPreferenceSchema.safeParse(value)
  const numeric = numberPreferenceSchema.safeParse(value)
  const options = choices[name]

  function commit(next: PreferenceInput) {
    try {
      store.setField(name, next)
      onError("")
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function save() {
    try {
      commit(
        numeric.success
          ? Number(input)
          : text.success
            ? input
            : value === null
              ? input.trim() || null
              : preferenceInputSchema.parse(JSON.parse(input)),
      )
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        paddingTop: 12,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderColor: color.border,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Label color={color} size={13} weight={500}>
          {name.replace(/([a-z])([A-Z])/g, "$1 $2")}
        </Label>
        {boolean.success ? (
          <Button
            color={color}
            testId={`setting-${name}`}
            label={`${name}: ${boolean.data ? "On" : "Off"}`}
            variant={boolean.data ? "primary" : "outline"}
            onClick={() => commit(!boolean.data)}
          >
            {boolean.data ? "On" : "Off"}
          </Button>
        ) : (
          <text
            testId={`setting-current-${name}`}
            style={{ color: color.mutedForeground, fontSize: 12 }}
          >
            {text.success
              ? text.data
              : numeric.success
                ? String(numeric.data)
                : value === null
                  ? "System default"
                  : "Custom values"}
          </text>
        )}
      </div>
      {!boolean.success &&
        (options ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {options.map((option) => (
              <Button
                key={option}
                color={color}
                testId={`setting-${name}-${option}`}
                variant={value === option ? "primary" : "outline"}
                onClick={() => commit(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
            <input
              testId={`setting-${name}`}
              aria-label={name}
              value={input}
              onChange={(event) => setInput(event.value ?? "")}
              onSubmit={save}
              style={{ ...inputStyle(color), flexGrow: 1, minWidth: 0 }}
            />
            <Button
              color={color}
              testId={`setting-save-${name}`}
              variant="outline"
              onClick={save}
            >
              Save
            </Button>
          </div>
        ))}
    </div>
  )
}

export function SettingsPanel({
  store,
  color,
  onClose,
}: {
  store: SettingsStore
  color: Palette
  onClose: () => void
}) {
  const preferences = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
  )

  const [section, setSection] = useState<Section>("editor")
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const grouped = new Set(Object.values(groups).flat())

  const names = (
    section === "advanced"
      ? preferenceNames.filter((name) => !grouped.has(name))
      : groups[section]
  ).filter((name) =>
    name.toLowerCase().includes(query.toLowerCase().replaceAll(" ", "")),
  )

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop style={{ backgroundColor: "#00000066" }} />
        <Dialog.Popup
          initialFocus
          aria-label="Settings"
          style={{
            display: "flex",
            flexDirection: "column",
            width: 820,
            maxWidth: "94%",
            maxHeight: "90%",
            padding: 24,
            gap: 16,
            borderRadius: 16,
            backgroundColor: color.background,
            borderWidth: 1,
            borderColor: color.border,
          }}
        >
          <div
            testId="settings-panel"
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Dialog.Title>
                <Label color={color} size={22} weight={600}>
                  Settings
                </Label>
              </Dialog.Title>
              <Button
                color={color}
                icon="close"
                testId="settings-close"
                label="Close settings"
                onClick={onClose}
              />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              {sections.map((item) => (
                <Button
                  key={item}
                  color={color}
                  testId={`settings-tab-${item}`}
                  variant={section === item ? "primary" : "ghost"}
                  onClick={() => {
                    setSection(item)
                    setQuery("")
                  }}
                >
                  {item}
                </Button>
              ))}
            </div>
            <input
              aria-label="Search settings"
              value={query}
              placeholder="Filter settings in this section…"
              onChange={(event) => setQuery(event.value ?? "")}
              style={inputStyle(color)}
            />
            {error && (
              <text
                testId="settings-error"
                role="alert"
                style={{ color: color.destructive, fontSize: 12 }}
              >
                {error}
              </text>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                overflow: "scroll",
                height: 420,
                minHeight: 180,
                gap: 4,
              }}
            >
              {names.map((name) => (
                <PreferenceControl
                  key={`${name}-${JSON.stringify(preferences[name])}`}
                  name={name}
                  value={preferences[name]}
                  store={store}
                  color={color}
                  onError={setError}
                />
              ))}
              {names.length === 0 && (
                <Label color={color} muted>
                  No matching settings.
                </Label>
              )}
            </div>
            <Label color={color} size={11} muted>
              Changes save to settings.json. Do not put secret keys in this
              file.
            </Label>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
