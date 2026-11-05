import {
  type KeyEvent,
  type PublicInstance,
  useGpuixRequired,
  useWindowSize,
} from "@gpuix/react"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { useRef, useState, useSyncExternalStore } from "react"

import type { NotesStore } from "@/features/notes/store"
import type { SettingsStore } from "@/features/settings/store"

import { Button, Label } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import { inputStyle, palettes } from "@/components/ui/theme"
import { Editor, type EditorMode } from "@/features/editor/components/editor"
import { NoteList } from "@/features/notes/components/note-list"
import { SettingsPanel } from "@/features/settings/components/settings-panel"
import {
  AppDialog,
  type DialogState,
} from "@/features/workspace/components/app-dialog"
import { Sidebar, type View } from "@/features/workspace/components/sidebar"
import { registerFonts } from "@/native/fonts"

const editorModeShortcuts: Record<"4" | "5" | "6", EditorMode> = {
  "4": "edit",
  "5": "split",
  "6": "preview",
}

const linkCommands = new Map([
  ["darwin", "open"],
  ["win32", "rundll32"],
])

interface Draft {
  title?: string
  body?: string
}

function attempt(action: () => void) {
  try {
    action()

    return ""
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

export function App({
  store,
  dataDirectory,
  settings,
}: {
  store: NotesStore
  settings: SettingsStore
  dataDirectory: string
}) {
  const workspace = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
  )

  const preferences = useSyncExternalStore(
    (listener) => settings.subscribe(listener),
    () => settings.getSnapshot(),
  )

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [view, setView] = useState<View>({ kind: "all" })
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<EditorMode>(preferences.defaultPaneMode)
  const [focusMode, setFocusMode] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(false)
  const [oldestFirst, setOldestFirst] = useState(false)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const hasDrafts = Object.keys(drafts).length > 0
  const searchRef = useRef<PublicInstance>(null)
  const renderer = useGpuixRequired()
  const { width } = useWindowSize()
  const narrow = width < 780
  const showSidebar = !focusMode && (width >= 1120 || navigationOpen)

  const theme =
    preferences.themeMode === "system" ? workspace.theme : preferences.themeMode

  const color = palettes[theme]
  const search = query.trim().toLocaleLowerCase()

  const notes = workspace.notes
    .filter((note) => {
      if (view.kind === "trash" ? !note.trashedAt : note.trashedAt) return false

      if (view.kind === "pinned" && !note.pinned) return false

      if (view.kind === "notebook" && note.notebookId !== view.notebookId)
        return false

      return (
        !search ||
        `${note.title}\n${note.body}`.toLocaleLowerCase().includes(search)
      )
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (oldestFirst
          ? a.updatedAt.localeCompare(b.updatedAt)
          : b.updatedAt.localeCompare(a.updatedAt)) ||
        a.id.localeCompare(b.id),
    )

  const selected =
    workspace.notes.find(
      (item) =>
        item.id === activeNoteId &&
        Boolean(item.trashedAt) === (view.kind === "trash"),
    ) ??
    notes.find((item) => item.id === workspace.selectedNoteId) ??
    notes[0]

  const note = selected ? { ...selected, ...drafts[selected.id] } : undefined

  const notebook = workspace.notebooks.find(
    (item) => item.id === note?.notebookId,
  )

  const title =
    view.kind === "notebook"
      ? (workspace.notebooks.find((item) => item.id === view.notebookId)
          ?.name ?? "Notebook")
      : {
          all: "All notes",
          pinned: "Pinned notes",
          trash: "Trash",
        }[view.kind]

  function newNote() {
    setError(
      attempt(() => {
        const created = store.createNote(
          view.kind === "notebook" ? view.notebookId : undefined,
        )

        store.selectNote(created.id)
        setActiveNoteId(created.id)

        if (view.kind === "trash" || view.kind === "pinned")
          setView({ kind: "all" })
        setQuery("")
        setMode("edit")
        setMobileEditor(true)
        setNavigationOpen(false)
      }),
    )
  }

  function changeNote(patch: Draft) {
    if (!note || note.trashedAt) return
    const id = note.id
    const pending = { ...drafts[id], ...patch }
    setActiveNoteId(id)
    setDrafts((current) => ({ ...current, [id]: pending }))
    setError(
      attempt(() => {
        store.updateNote(id, pending)
        setDrafts((current) => {
          const next = { ...current }
          delete next[id]

          return next
        })
      }),
    )
  }

  function selectNextNote(id: string) {
    const index = notes.findIndex((item) => item.id === id)
    setActiveNoteId(notes[index + 1]?.id ?? notes[index - 1]?.id ?? null)
    setMobileEditor(false)
  }

  function retry() {
    setError(
      attempt(() => {
        for (const [id, draft] of Object.entries(drafts))
          store.updateNote(id, draft)
        setDrafts({})
      }),
    )
  }

  function openSearch() {
    setFocusMode(false)
    setMobileEditor(false)

    if (searchRef.current) renderer.focusElement?.(searchRef.current.id)
  }

  function onKeyDown(event: KeyEvent) {
    if (
      dialog ||
      settingsOpen ||
      !(event.modifiers?.cmd || event.modifiers?.ctrl)
    )
      return
    const key = event.key?.toLowerCase()

    if (key === ",") {
      event.preventDefault()
      setSettingsOpen(true)
    } else if (key === "n") {
      event.preventDefault()
      newNote()
    } else if ((key === "p" && !event.modifiers?.shift) || key === "k") {
      event.preventDefault()
      openSearch()
    } else if (key === "p" && event.modifiers?.shift) {
      event.preventDefault()
      setMode(mode === "preview" ? "edit" : "preview")
    } else if (key === "f" && event.modifiers?.shift) {
      event.preventDefault()
      setFocusMode(!focusMode)
    } else if (key === "o") {
      event.preventDefault()
      setDialog({ kind: "import" })
    } else if (key === "4" || key === "5" || key === "6") {
      event.preventDefault()
      setMode(editorModeShortcuts[key])
    } else if (key === "s") {
      event.preventDefault()
      retry()
    }
  }

  function importFiles(paths: string[]) {
    setError(
      attempt(() => {
        const imported = store.importMarkdown(
          paths,
          view.kind === "notebook" ? view.notebookId : undefined,
        )

        if (imported[0]) store.selectNote(imported[0].id)
        setActiveNoteId(imported[0]?.id ?? null)
        setView({ kind: "all" })
        setQuery("")
        setMode("edit")
        setNotice(
          `Imported ${imported.length} ${imported.length === 1 ? "note" : "notes"}. Original files unchanged.`,
        )
      }),
    )
  }

  function confirmDialog(value: string) {
    if (!dialog) return

    if (dialog.kind === "notebook") {
      const created = store.createNotebook(value)
      setView({ kind: "notebook", notebookId: created.id })
      setActiveNoteId(null)
      setMobileEditor(false)
      setQuery("")
    } else if (dialog.kind === "rename") store.renameNotebook(dialog.id, value)
    else if (dialog.kind === "move") {
      store.updateNote(dialog.id, { notebookId: value })

      if (view.kind === "notebook" && view.notebookId !== value)
        selectNextNote(dialog.id)
    } else if (dialog.kind === "import") {
      const imported = store.importMarkdown(
        [value],
        view.kind === "notebook" ? view.notebookId : undefined,
      )

      if (imported[0]) store.selectNote(imported[0].id)
      setActiveNoteId(imported[0]?.id ?? null)
      setView({ kind: "all" })
      setQuery("")
      setMode("edit")
      setNotice("Markdown imported. Original file unchanged.")
    } else if (dialog.kind === "export") {
      const destination = store.exportMarkdown(
        dialog.id,
        value || homedir(),
        drafts[dialog.id],
      )

      setNotice(`Exported to ${destination}`)
    } else if (dialog.kind === "delete") {
      store.deleteNote(dialog.id)
      selectNextNote(dialog.id)
      setDrafts((current) => {
        const next = { ...current }
        delete next[dialog.id]

        return next
      })
    }

    setDialog(null)
  }

  function openLink(value: string) {
    setError(
      attempt(() => {
        const url = new URL(value)

        if (
          url.protocol !== "https:" &&
          url.protocol !== "http:" &&
          url.protocol !== "mailto:"
        )
          throw new Error(
            "Only http, https and mailto links can open outside Still Notes.",
          )

        const command = linkCommands.get(process.platform) ?? "xdg-open"

        const args =
          process.platform === "win32"
            ? ["url.dll,FileProtocolHandler", url.href]
            : [url.href]

        const child = spawn(command, args, {
          stdio: "ignore",
          detached: true,
          shell: false,
        })

        child.on("error", (cause) =>
          setError(`Could not open link: ${cause.message}`),
        )
        child.on("exit", (code) => {
          if (code) setError(`Link opener exited with code ${code}.`)
        })
        child.unref()
      }),
    )
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Native root receives bubbled keyboard commands and file drops.
    <div
      ref={(instance) => {
        if (instance) registerFonts(renderer)
      }}
      testId="app"
      role="application"
      aria-label="Still Notes workspace"
      onKeyDown={onKeyDown}
      onFileDrop={(event) => importFiles(event.paths ?? [])}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: color.sidebar,
        color: color.foreground,
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexGrow: 1,
          minHeight: 0,
        }}
      >
        {showSidebar && (
          <Sidebar
            color={color}
            notebooks={workspace.notebooks}
            notes={workspace.notes}
            view={view}
            onView={(next) => {
              setView(next)
              setActiveNoteId(null)
              setQuery("")
              setNavigationOpen(false)
              setMobileEditor(false)
            }}
            onNewNotebook={() => setDialog({ kind: "notebook" })}
            onRename={(item) =>
              setDialog({ kind: "rename", id: item.id, name: item.name })
            }
            onImport={() => setDialog({ kind: "import" })}
          />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minWidth: 0,
            paddingRight: 8,
            paddingBottom: 8,
            paddingLeft: showSidebar ? 0 : 8,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              height: 62,
              flexShrink: 0,
              gap: 12,
              paddingLeft: 8,
              paddingRight: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              {!showSidebar && (
                <Button
                  color={color}
                  icon="menu"
                  label="Show notebooks"
                  testId="show-notebooks"
                  onClick={() => {
                    setFocusMode(false)
                    setNavigationOpen(true)
                  }}
                />
              )}
              {!showSidebar && !narrow && (
                <Label color={color} weight={600}>
                  Still Notes
                </Label>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                width: narrow ? "60%" : 340,
                paddingLeft: 12,
                paddingRight: 12,
                backgroundColor: color.background,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: color.border,
                height: 36,
              }}
            >
              <Icon name="search" color={color.mutedForeground} size={15} />
              <input
                ref={searchRef}
                testId="search"
                aria-label="Search notes in current view"
                value={query}
                placeholder="Search your notes…"
                onChange={(event) => {
                  setQuery(event.value ?? "")
                  setActiveNoteId(null)
                  setMobileEditor(false)
                  setFocusMode(false)
                }}
                style={{
                  ...inputStyle(color),
                  height: 32,
                  padding: 0,
                  borderWidth: 0,
                  flexGrow: 1,
                  minWidth: 0,
                }}
              />
              {!narrow && (
                <Label color={color} size={11} muted>
                  {process.platform === "darwin" ? "⌘ P" : "Ctrl P"}
                </Label>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
              {!showSidebar && (
                <Button
                  color={color}
                  icon="upload"
                  label="Import Markdown"
                  testId="import"
                  onClick={() => setDialog({ kind: "import" })}
                />
              )}
              <Button
                color={color}
                icon={theme === "light" ? "moon" : "sun"}
                label={theme === "light" ? "Use dark theme" : "Use light theme"}
                testId="theme-toggle"
                onClick={() =>
                  setError(
                    attempt(() =>
                      settings.update({
                        themeMode: theme === "light" ? "dark" : "light",
                      }),
                    ),
                  )
                }
              />
              <Button
                color={color}
                icon="settings"
                label="Settings"
                testId="settings-open"
                onClick={() => setSettingsOpen(true)}
              />
              <Button
                color={color}
                icon="help"
                label="Help and keyboard shortcuts"
                testId="help"
                onClick={() => setDialog({ kind: "help" })}
              />
            </div>
          </div>
          {(error || hasDrafts) && (
            <div
              testId={hasDrafts ? "pending-drafts" : "command-error"}
              role="alert"
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                gap: 12,
                backgroundColor: color.background,
                borderWidth: 1,
                borderColor: color.destructive,
                borderRadius: 12,
                marginBottom: 8,
              }}
            >
              <text
                style={{
                  color: color.destructive,
                  fontFamily: "Inter",
                  fontSize: 12,
                  flexGrow: 1,
                }}
              >{`${error}${error && hasDrafts ? " " : ""}${hasDrafts ? "Unsaved edits remain in this window. Retry before closing." : ""}`}</text>
              {hasDrafts && (
                <Button color={color} testId="retry-save" onClick={retry}>
                  Retry save
                </Button>
              )}
              {!hasDrafts && (
                <Button
                  color={color}
                  icon="close"
                  label="Dismiss error"
                  onClick={() => setError("")}
                />
              )}
            </div>
          )}
          {notice && (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                gap: 12,
                backgroundColor: color.background,
                borderRadius: 12,
                marginBottom: 8,
              }}
            >
              <text
                testId="notice"
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- GPUix has no semantic HTML host elements.
                role="status"
                style={{
                  color: color.foreground,
                  fontFamily: "Inter",
                  fontSize: 12,
                  flexGrow: 1,
                }}
              >
                {notice}
              </text>
              <Button
                color={color}
                icon="close"
                label="Dismiss notice"
                onClick={() => setNotice("")}
              />
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              flexGrow: 1,
              minHeight: 0,
              backgroundColor: color.background,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: color.border,
              overflow: "hidden",
            }}
          >
            {(!focusMode || !note) && (!narrow || !mobileEditor || !note) && (
              <NoteList
                color={color}
                notes={notes}
                selectedId={note?.id}
                title={title}
                query={query}
                onSelect={(id) => {
                  setActiveNoteId(id)
                  setMobileEditor(true)
                  setError(attempt(() => store.selectNote(id)))
                }}
                onNew={newNote}
                trash={view.kind === "trash"}
                oldestFirst={oldestFirst}
                onSort={() => setOldestFirst(!oldestFirst)}
              />
            )}
            {note && (!narrow || mobileEditor || focusMode) ? (
              <Editor
                color={color}
                preferences={preferences}
                note={note}
                notebookName={notebook?.name ?? "Notebook"}
                mode={mode}
                onMode={setMode}
                onChange={changeNote}
                onPin={() => setError(attempt(() => store.togglePin(note.id)))}
                onTrash={() =>
                  setError(
                    attempt(() => {
                      store.trashNote(note.id)
                      selectNextNote(note.id)
                    }),
                  )
                }
                onRestore={() =>
                  setError(
                    attempt(() => {
                      store.restoreNote(note.id)
                      setActiveNoteId(note.id)
                      setView({ kind: "all" })
                    }),
                  )
                }
                onDelete={() =>
                  setDialog({ kind: "delete", id: note.id, title: note.title })
                }
                onExport={() => setDialog({ kind: "export", id: note.id })}
                onMove={() => setDialog({ kind: "move", id: note.id })}
                onLink={openLink}
                focusMode={focusMode}
                onFocusMode={() => {
                  setFocusMode(!focusMode)
                  setNavigationOpen(false)
                }}
                dirty={hasDrafts}
                narrow={narrow}
                onBack={() => setMobileEditor(false)}
              />
            ) : (
              !narrow && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 16,
                    flexGrow: 1,
                    padding: 40,
                  }}
                >
                  <Icon name="book" color={color.mutedForeground} size={36} />
                  <Label color={color} size={20} weight={500}>
                    {query
                      ? "Nothing found. Something next?"
                      : view.kind === "trash"
                        ? "Nothing to let go of."
                        : "A quiet place to begin."}
                  </Label>
                  <Label color={color} muted>
                    {query
                      ? "Search another thought, or start a new one."
                      : "Select a note, or put your first thought on a page."}
                  </Label>
                  {view.kind !== "trash" && (
                    <Button
                      color={color}
                      icon="plus"
                      variant="primary"
                      onClick={newNote}
                    >
                      Write a note
                    </Button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>
      {settingsOpen && (
        <SettingsPanel
          store={settings}
          color={color}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {dialog && (
        <AppDialog
          key={JSON.stringify(dialog)}
          state={dialog}
          color={color}
          onClose={() => setDialog(null)}
          onConfirm={confirmDialog}
          notebooks={workspace.notebooks}
          dataDirectory={dataDirectory}
        />
      )}
    </div>
  )
}
