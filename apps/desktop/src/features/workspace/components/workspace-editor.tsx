import type { Palette } from "@/components/ui/theme"
import type { EditorMode } from "@/features/editor/components/editor"
import type { EditorSaveState } from "@/features/editor/components/editor-footer"
import type { Note } from "@/features/notes/store"
import type { Preferences } from "@/features/settings/store"
import type { View } from "@/features/workspace/components/sidebar"
import type { useNoteDrafts } from "@/features/workspace/hooks/use-note-drafts"
import type { useWorkspaceEditorActions } from "@/features/workspace/hooks/use-workspace-editor-actions"

import { Editor } from "@/features/editor/components/editor"
import { WorkspaceEmpty } from "@/features/workspace/components/workspace-empty"

export function WorkspaceEditor({
  color,
  preferences,
  note,
  notebookName,
  mode,
  onMode,
  onChange,
  actions,
  focusMode,
  onFocusMode,
  saveState,
  narrow,
  mobileEditor,
  onBack,
  query,
  view,
  onNew,
}: {
  color: Palette
  preferences: Preferences
  note: Note | undefined
  notebookName: string
  mode: EditorMode
  onMode: (mode: EditorMode) => void
  onChange: ReturnType<typeof useNoteDrafts>["changeNote"]
  actions: ReturnType<typeof useWorkspaceEditorActions>
  focusMode: boolean
  onFocusMode: () => void
  saveState: EditorSaveState
  narrow: boolean
  mobileEditor: boolean
  onBack: () => void
  query: string
  view: View
  onNew: () => void
}) {
  if (!note || (narrow && !mobileEditor && !focusMode)) {
    return narrow ? null : (
      <WorkspaceEmpty color={color} query={query} view={view} onNew={onNew} />
    )
  }

  return (
    <Editor
      color={color}
      preferences={preferences}
      note={note}
      notebookName={notebookName}
      mode={mode}
      onMode={onMode}
      onChange={onChange}
      onPin={actions.pinNote}
      onTrash={actions.trashNote}
      onRestore={actions.restoreNote}
      onDelete={actions.deleteNote}
      onExport={actions.exportNote}
      onMove={actions.moveNote}
      onLink={actions.openLink}
      focusMode={focusMode}
      onFocusMode={onFocusMode}
      saveState={saveState}
      narrow={narrow}
      onBack={onBack}
    />
  )
}
