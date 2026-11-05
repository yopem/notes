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

import { palettes } from "@/components/ui/theme"
import { Editor, type EditorMode } from "@/features/editor/components/editor"
import { NoteList } from "@/features/notes/components/note-list"
import { SettingsPanel } from "@/features/settings/components/settings-panel"
import { attempt } from "@/features/workspace/attempt"
import {
  AppDialog,
  type DialogState,
} from "@/features/workspace/components/app-dialog"
import { Sidebar } from "@/features/workspace/components/sidebar"
import { WorkspaceEmpty } from "@/features/workspace/components/workspace-empty"
import { WorkspaceHeader } from "@/features/workspace/components/workspace-header"
import { WorkspaceMessages } from "@/features/workspace/components/workspace-messages"
import {
  getWorkspaceStyles,
  workspaceStyles,
} from "@/features/workspace/components/workspace-styles"
import { useNoteDrafts } from "@/features/workspace/hooks/use-note-drafts"
import { useWorkspaceNavigation } from "@/features/workspace/hooks/use-workspace-navigation"
import { useWorkspaceNoteIntake } from "@/features/workspace/hooks/use-workspace-note-intake"
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
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const navigation = useWorkspaceNavigation({
    store,
    workspace,
    defaultMode: preferences.defaultPaneMode,
    onError: setError,
  })
  const {
    view,
    query,
    mode,
    focusMode,
    navigationOpen,
    mobileEditor,
    oldestFirst,
    notes,
    selected,
    title,
    setView,
    setQuery,
    setMode,
    setActiveNoteId,
    setMobileEditor,
    selectNextNote,
  } = navigation
  const { newNote, importFiles, importPath } = useWorkspaceNoteIntake({
    store,
    navigation,
    onError: setError,
    onNotice: setNotice,
  })
  const searchRef = useRef<PublicInstance>(null)
  const renderer = useGpuixRequired()
  const { width } = useWindowSize()
  const narrow = width < 780
  const showSidebar = !focusMode && (width >= 1120 || navigationOpen)

  const theme =
    preferences.themeMode === "system" ? workspace.theme : preferences.themeMode

  const color = palettes[theme]
  const styles = getWorkspaceStyles(color)
  const { drafts, hasDrafts, changeNote, retry, discardDraft } = useNoteDrafts({
    store,
    note: selected,
    onActiveNote: setActiveNoteId,
    onError: setError,
  })
  const note = selected ? { ...selected, ...drafts[selected.id] } : undefined

  const notebook = workspace.notebooks.find(
    (item) => item.id === note?.notebookId,
  )

  function openSearch() {
    navigation.showSearch()

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
      navigation.togglePreview()
    } else if (key === "f" && event.modifiers?.shift) {
      event.preventDefault()
      navigation.toggleKeyboardFocus()
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
      importPath(value)
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
      discardDraft(dialog.id)
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
      style={styles.root}
    >
      <div style={workspaceStyles.row}>
        {showSidebar && (
          <Sidebar
            color={color}
            notebooks={workspace.notebooks}
            notes={workspace.notes}
            view={view}
            onView={navigation.changeView}
            onNewNotebook={() => setDialog({ kind: "notebook" })}
            onRename={(item) =>
              setDialog({ kind: "rename", id: item.id, name: item.name })
            }
            onImport={() => setDialog({ kind: "import" })}
          />
        )}
        <div
          style={
            showSidebar
              ? workspaceStyles.content
              : workspaceStyles.contentWithoutSidebar
          }
        >
          <WorkspaceHeader
            color={color}
            theme={theme}
            settings={settings}
            narrow={narrow}
            showSidebar={showSidebar}
            searchRef={searchRef}
            query={query}
            onSearch={navigation.searchNotes}
            onShowNotebooks={navigation.showNotebooks}
            onImport={() => setDialog({ kind: "import" })}
            onSettings={() => setSettingsOpen(true)}
            onHelp={() => setDialog({ kind: "help" })}
            onError={setError}
          />
          <WorkspaceMessages
            color={color}
            error={error}
            notice={notice}
            hasDrafts={hasDrafts}
            onRetry={retry}
            onDismissError={() => setError("")}
            onDismissNotice={() => setNotice("")}
          />
          <div style={styles.panes}>
            {(!focusMode || !note) && (!narrow || !mobileEditor || !note) && (
              <NoteList
                color={color}
                notes={notes}
                selectedId={note?.id}
                title={title}
                query={query}
                onSelect={navigation.selectNote}
                onNew={newNote}
                trash={view.kind === "trash"}
                oldestFirst={oldestFirst}
                onSort={navigation.toggleSort}
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
                onFocusMode={navigation.toggleFocus}
                dirty={hasDrafts}
                narrow={narrow}
                onBack={navigation.showList}
              />
            ) : (
              !narrow && (
                <WorkspaceEmpty
                  color={color}
                  query={query}
                  view={view}
                  onNew={newNote}
                />
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
