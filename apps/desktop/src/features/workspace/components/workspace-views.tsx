import type { ReactNode } from "react"

import type { Palette } from "@/components/ui/theme"
import type { EditorSaveState } from "@/features/editor/components/editor-footer"
import type { Note } from "@/features/notes/store"
import type { Preferences } from "@/features/settings/store"
import type { useNoteDrafts } from "@/features/workspace/hooks/use-note-drafts"
import type { useWorkspaceEditorActions } from "@/features/workspace/hooks/use-workspace-editor-actions"
import type { useWorkspaceNavigation } from "@/features/workspace/hooks/use-workspace-navigation"

import { DuplicateNoteContext } from "@/features/editor/components/duplicate-note-context"
import { NoteList } from "@/features/notes/components/note-list"
import { WorkspaceEditor } from "@/features/workspace/components/workspace-editor"

export function WorkspaceViews({
  color,
  preferences,
  note,
  notebookName,
  navigation,
  editor,
  onChange,
  saveState,
  narrow,
  onNew,
  taskView,
}: {
  color: Palette
  preferences: Preferences
  note: Note | undefined
  notebookName: string
  navigation: ReturnType<typeof useWorkspaceNavigation>
  editor: ReturnType<typeof useWorkspaceEditorActions>
  onChange: ReturnType<typeof useNoteDrafts>["changeNote"]
  saveState: EditorSaveState
  narrow: boolean
  onNew: () => void
  taskView: ReactNode
}) {
  if (navigation.view.kind === "tasks") return taskView

  return (
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
            onNew={onNew}
            trash={navigation.view.kind === "trash"}
            sortOrder={preferences.noteSortOrder}
            onSort={navigation.toggleSort}
            narrow={narrow}
          />
        )}
      <DuplicateNoteContext value={editor.duplicateNote}>
        <WorkspaceEditor
          color={color}
          preferences={preferences}
          note={note}
          notebookName={notebookName}
          mode={navigation.mode}
          onMode={navigation.setMode}
          onChange={onChange}
          actions={editor}
          focusMode={navigation.focusMode}
          onFocusMode={navigation.toggleFocus}
          saveState={saveState}
          narrow={narrow}
          mobileEditor={navigation.mobileEditor}
          onBack={navigation.showList}
          query={navigation.query}
          view={navigation.view}
          onNew={onNew}
        />
      </DuplicateNoteContext>
    </>
  )
}
