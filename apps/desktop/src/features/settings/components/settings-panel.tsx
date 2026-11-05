import type { InputProps } from "@gpuix/react"

import * as Dialog from "@gpuix/react/dialog"
import { Result, Schema } from "effect"
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

import type { Palette } from "@/components/ui/theme"

import { useDesktopEffect } from "@/components/effect-boundary"
import { Button, Label } from "@/components/ui/controls"
import {
  getSettingsStyles,
  settingsStyles,
} from "@/features/settings/components/settings-styles"
import {
  type PreferenceInput,
  preferenceInputSchema,
  preferenceNames,
  type Preferences,
  type SettingsStore,
} from "@/features/settings/store"

const booleanPreferenceSchema = Schema.Boolean

const numberPreferenceSchema = Schema.Finite

const textPreferenceSchema = Schema.String

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

const grouped = new Set(Object.values(groups).flat())

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

function initialPreferenceInput(value: Preferences[keyof Preferences]) {
  const text = Schema.decodeUnknownResult(textPreferenceSchema)(value)

  if (Result.isSuccess(text)) return text.success

  if (value === null) return ""

  return JSON.stringify(value, null, 2)
}

function parsePreferenceInput(
  value: Preferences[keyof Preferences],
  input: string,
) {
  if (Schema.is(numberPreferenceSchema)(value)) return Number(input)

  if (Schema.is(textPreferenceSchema)(value)) return input

  if (value === null) return input.trim() || null

  return Schema.decodeUnknownSync(preferenceInputSchema)(JSON.parse(input))
}

function currentPreferenceValue(value: Preferences[keyof Preferences]) {
  const text = Schema.decodeUnknownResult(textPreferenceSchema)(value)

  if (Result.isSuccess(text)) return text.success
  const numeric = Schema.decodeUnknownResult(numberPreferenceSchema)(value)

  if (Result.isSuccess(numeric)) return String(numeric.success)

  if (value === null) return "System default"

  return "Custom values"
}

export function PreferenceChoice({
  name,
  option,
  value,
  color,
  onCommit,
}: {
  name: keyof Preferences
  option: string
  value: Preferences[keyof Preferences]
  color: Palette
  onCommit: (next: PreferenceInput) => void
}) {
  const latest = useRef({ onCommit, option })

  useLayoutEffect(
    function updateCommit() {
      latest.current = { onCommit, option }
    },
    [onCommit, option],
  )

  const [selectOption] = useState(
    () =>
      function selectPreferenceOption() {
        latest.current.onCommit(latest.current.option)
      },
  )

  return (
    <Button
      color={color}
      testId={`setting-${name}-${option}`}
      variant={value === option ? "primary" : "outline"}
      onClick={selectOption}
    >
      {option}
    </Button>
  )
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
  const run = useDesktopEffect()
  const [input, setInput] = useState(() => initialPreferenceInput(value))
  const boolean = Schema.decodeUnknownResult(booleanPreferenceSchema)(value)
  const options = choices[name]
  const styles = getSettingsStyles(color)
  const latest = useRef({ name, value, store, onError, input, run })

  // Commit current bindings before native events use the stable handlers.
  useLayoutEffect(
    function updatePreferenceBindings() {
      latest.current = { name, value, store, onError, input, run }
    },
    [name, value, store, onError, input, run],
  )

  const [actions] = useState(() => {
    function commit(next: PreferenceInput) {
      const current = latest.current

      try {
        current.run(current.store.setField(current.name, next))
        current.onError("")
      } catch (cause) {
        current.onError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    function save() {
      const current = latest.current

      try {
        commit(parsePreferenceInput(current.value, current.input))
      } catch (cause) {
        current.onError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    function toggle() {
      const current = Schema.decodeUnknownResult(booleanPreferenceSchema)(
        latest.current.value,
      )

      if (Result.isSuccess(current)) commit(!current.success)
    }

    function changeInput(
      event: Parameters<NonNullable<InputProps["onChange"]>>[0],
    ) {
      setInput(event.value ?? "")
    }

    return { commit, save, toggle, changeInput }
  })

  return (
    <div style={styles.preference}>
      <div style={settingsStyles.preferenceHeading}>
        <Label color={color} size={13} weight={500}>
          {name.replace(/([a-z])([A-Z])/g, "$1 $2")}
        </Label>
        {Result.isSuccess(boolean) ? (
          <Button
            color={color}
            testId={`setting-${name}`}
            label={`${name}: ${boolean.success ? "On" : "Off"}`}
            variant={boolean.success ? "primary" : "outline"}
            onClick={actions.toggle}
          >
            {boolean.success ? "On" : "Off"}
          </Button>
        ) : (
          <text testId={`setting-current-${name}`} style={styles.currentValue}>
            {currentPreferenceValue(value)}
          </text>
        )}
      </div>
      {!Result.isSuccess(boolean) &&
        (options ? (
          <div style={settingsStyles.options}>
            {options.map((option) => (
              <PreferenceChoice
                key={option}
                name={name}
                option={option}
                value={value}
                color={color}
                onCommit={actions.commit}
              />
            ))}
          </div>
        ) : (
          <div style={settingsStyles.editor}>
            <input
              testId={`setting-${name}`}
              aria-label={name}
              value={input}
              onChange={actions.changeInput}
              onSubmit={actions.save}
              style={styles.input}
            />
            <Button
              color={color}
              testId={`setting-save-${name}`}
              variant="outline"
              onClick={actions.save}
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
  const styles = getSettingsStyles(color)
  const latestClose = useRef(onClose)

  useLayoutEffect(
    function updateClose() {
      latestClose.current = onClose
    },
    [onClose],
  )

  const [actions] = useState(() => {
    function openChange(open: boolean) {
      if (!open) latestClose.current()
    }

    function changeQuery(
      event: Parameters<NonNullable<InputProps["onChange"]>>[0],
    ) {
      setQuery(event.value ?? "")
    }

    const tabs = sections.map((item) => {
      function selectSection() {
        setSection(item)
        setQuery("")
      }

      return { item, selectSection }
    })

    return { openChange, changeQuery, tabs }
  })

  const names = (
    section === "advanced"
      ? preferenceNames.filter((name) => !grouped.has(name))
      : groups[section]
  ).filter((name) =>
    name.toLowerCase().includes(query.toLowerCase().replaceAll(" ", "")),
  )

  return (
    <Dialog.Root open onOpenChange={actions.openChange}>
      <Dialog.Portal>
        <Dialog.Backdrop style={settingsStyles.backdrop} />
        <Dialog.Popup initialFocus aria-label="Settings" style={styles.popup}>
          <div testId="settings-panel" style={settingsStyles.panel}>
            <div style={settingsStyles.heading}>
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
            <div style={settingsStyles.tabs}>
              {actions.tabs.map(({ item, selectSection }) => (
                <Button
                  key={item}
                  color={color}
                  testId={`settings-tab-${item}`}
                  variant={section === item ? "primary" : "ghost"}
                  onClick={selectSection}
                >
                  {item}
                </Button>
              ))}
            </div>
            <input
              aria-label="Search settings"
              value={query}
              placeholder="Filter settings in this section…"
              onChange={actions.changeQuery}
              style={styles.search}
            />
            {error && (
              <text testId="settings-error" role="alert" style={styles.error}>
                {error}
              </text>
            )}
            <div style={settingsStyles.list}>
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
