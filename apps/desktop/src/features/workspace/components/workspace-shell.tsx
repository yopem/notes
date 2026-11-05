import { useWindowSize } from "@gpuix/react"
import { useState, useSyncExternalStore } from "react"

import type { NotesStore } from "@/features/notes/store"
import type { SettingsStore } from "@/features/settings/store"

import { palettes } from "@/components/ui/theme"
import { DuplicateNoteContext } from "@/features/editor/components/duplicate-note-context"
import { NoteList } from "@/features/notes/components/note-list"
import { SettingsPanel } from "@/features/settings/components/settings-panel"
import { TaskView } from "@/features/tasks/components/task-view"
import { AppDialog } from "@/features/workspace/components/app-dialog"
import { Sidebar } from "@/features/workspace/components/sidebar"
import { WorkspaceEditor } from "@/features/workspace/components/workspace-editor"
import { WorkspaceHeader } from "@/features/workspace/components/workspace-header"
import { WorkspaceMessages } from "@/features/workspace/components/workspace-messages"
import {
  getWorkspaceStyles,
  workspaceStyles,
} from "@/features/workspace/components/workspace-styles"
import { useNoteDrafts } from "@/features/workspace/hooks/use-note-drafts"
import { useWorkspaceDialogs } from "@/features/workspace/hooks/use-workspace-dialogs"
import { useWorkspaceEditorActions } from "@/features/workspace/hooks/use-workspace-editor-actions"
import { useWorkspaceNativeEvents } from "@/features/workspace/hooks/use-workspace-native-events"
import { useWorkspaceNavigation } from "@/features/workspace/hooks/use-workspace-navigation"
import { useWorkspaceNoteIntake } from "@/features/workspace/hooks/use-workspace-note-intake"

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
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const [handlers] = useState(function createShellHandlers() {
    function openSettings() {
      setSettingsOpen(true)
    }

    function closeSettings() {
      setSettingsOpen(false)
    }

    function dismissError() {
      setError("")
    }

    function dismissNotice() {
      setNotice("")
    }

    return { openSettings, closeSettings, dismissError, dismissNotice }
  })

  const navigation = useWorkspaceNavigation({
    store,
    workspace,
    settings,
    sortOrder: preferences.noteSortOrder,
    defaultMode: preferences.defaultPaneMode,
    onError: setError,
  })

  const intake = useWorkspaceNoteIntake({
    store,
    navigation,
    onError: setError,
    onNotice: setNotice,
  })

  const { drafts, note, hasDrafts, changeNote, retry, discardDraft } =
    useNoteDrafts({
      store,
      note: navigation.selected,
      onActiveNote: navigation.setActiveNoteId,
      onError: setError,
    })

  const dialogs = useWorkspaceDialogs({
    store,
    navigation,
    drafts,
    discardDraft,
    importPath: intake.importPath,
    onNotice: setNotice,
  })

  const editor = useWorkspaceEditorActions({
    store,
    note,
    navigation,
    onDialog: dialogs.setDialog,
    onError: setError,
  })

  const native = useWorkspaceNativeEvents({
    navigation,
    dialogOpen: Boolean(dialogs.dialog),
    settingsOpen,
    onSettings: handlers.openSettings,
    onNew: intake.newNote,
    onImport: dialogs.showImport,
    onImportFiles: intake.importFiles,
    onRetry: retry,
  })

  const { width } = useWindowSize()
  const narrow = width < 780

  const showSidebar =
    !navigation.focusMode && (width >= 1120 || navigation.navigationOpen)

  const theme =
    preferences.themeMode === "system" ? workspace.theme : preferences.themeMode

  const color = palettes[theme]
  const styles = getWorkspaceStyles(color)

  const notebook = workspace.notebooks.find(
    (item) => item.id === note?.notebookId,
  )

  return (
    <div
      ref={native.registerRoot}
      testId="app"
      role="application"
      aria-label="Still Notes workspace"
      onKeyDown={native.onKeyDown}
      onFileDrop={native.importDrop}
      style={styles.root}
    >
      <div style={workspaceStyles.row}>
        {showSidebar && (
          <Sidebar
            color={color}
            notebooks={workspace.notebooks}
            notes={workspace.notes}
            view={navigation.view}
            onView={navigation.changeView}
            onNewNotebook={dialogs.newNotebook}
            onRename={dialogs.renameNotebook}
            onImport={dialogs.showImport}
          />
        )}
        <div
          style={
            showSidebar
              ? workspaceStyles.content
              : workspaceStyles.contentWithoutSidebar
          }
        >
          {navigation.view.kind !== "tasks" && (
            <WorkspaceHeader
              color={color}
              theme={theme}
              settings={settings}
              narrow={narrow}
              showSidebar={showSidebar}
              searchRef={native.searchRef}
              query={navigation.query}
              onSearch={navigation.searchNotes}
              onShowNotebooks={navigation.showNotebooks}
              onImport={dialogs.showImport}
              onSettings={handlers.openSettings}
              onHelp={dialogs.showHelp}
              onError={setError}
            />
          )}
          <WorkspaceMessages
            color={color}
            error={error}
            notice={notice}
            hasDrafts={hasDrafts}
            onRetry={retry}
            onDismissError={handlers.dismissError}
            onDismissNotice={handlers.dismissNotice}
          />
          <div style={styles.panes}>
            {navigation.view.kind === "tasks" ? (
              <TaskView
                color={color}
                notes={workspace.notes}
                drafts={drafts}
                searchRef={native.searchRef}
                showSidebar={showSidebar}
                onShowNotebooks={navigation.showNotebooks}
                onSettings={handlers.openSettings}
                onOpenNote={navigation.openTaskNote}
              />
            ) : (
              <>
                {(!navigation.focusMode || !note) &&
                  (!narrow || !navigation.mobileEditor || !note) && (
                    <NoteList
                      color={color}
                      notes={navigation.notes}
                      selectedId={note?.id}
                      title={navigation.title}
                      query={navigation.query}
                      onSelect={navigation.selectNote}
                      onNew={intake.newNote}
                      trash={navigation.view.kind === "trash"}
                      sortOrder={preferences.noteSortOrder}
                      onSort={navigation.toggleSort}
                    />
                  )}
                <DuplicateNoteContext value={editor.duplicateNote}>
                  <WorkspaceEditor
                    color={color}
                    preferences={preferences}
                    note={note}
                    notebookName={notebook?.name ?? "Notebook"}
                    mode={navigation.mode}
                    onMode={navigation.setMode}
                    onChange={changeNote}
                    actions={editor}
                    focusMode={navigation.focusMode}
                    onFocusMode={navigation.toggleFocus}
                    dirty={hasDrafts}
                    narrow={narrow}
                    mobileEditor={navigation.mobileEditor}
                    onBack={navigation.showList}
                    query={navigation.query}
                    view={navigation.view}
                    onNew={intake.newNote}
                  />
                </DuplicateNoteContext>
              </>
            )}
          </div>
        </div>
      </div>
      {settingsOpen && (
        <SettingsPanel
          store={settings}
          color={color}
          onClose={handlers.closeSettings}
        />
      )}
      {dialogs.dialog && (
        <AppDialog
          key={JSON.stringify(dialogs.dialog)}
          state={dialogs.dialog}
          color={color}
          onClose={dialogs.closeDialog}
          onConfirm={dialogs.confirmDialog}
          notebooks={workspace.notebooks}
          dataDirectory={dataDirectory}
        />
      )}
    </div>
  )
}
