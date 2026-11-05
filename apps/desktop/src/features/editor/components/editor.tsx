import type { Palette } from "@/components/ui/theme"
import type { Note } from "@/features/notes/store"
import type { Preferences } from "@/features/settings/store"

import { EditorContent } from "@/features/editor/components/editor-content"
import { EditorFooter } from "@/features/editor/components/editor-footer"
import { EditorHeading } from "@/features/editor/components/editor-heading"
import { editorRootStyle } from "@/features/editor/components/editor-styles"
import { EditorToolbar } from "@/features/editor/components/editor-toolbar"
import { EditorTrashBanner } from "@/features/editor/components/editor-trash-banner"

export type EditorMode = "edit" | "preview" | "split"

export function Editor({
  color,
  preferences,
  note,
  notebookName,
  mode,
  onMode,
  onChange,
  onPin,
  onTrash,
  onRestore,
  onDelete,
  onExport,
  onMove,
  onLink,
  focusMode,
  onFocusMode,
  dirty,
  narrow,
  onBack,
}: {
  color: Palette
  preferences: Preferences
  note: Note
  notebookName: string
  mode: EditorMode
  onMode: (mode: EditorMode) => void
  onChange: (patch: { title?: string; body?: string }) => void
  onPin: () => void
  onTrash: () => void
  onRestore: () => void
  onDelete: () => void
  onExport: () => void
  onMove: () => void
  onLink: (url: string) => void
  focusMode: boolean
  onFocusMode: () => void
  dirty: boolean
  narrow: boolean
  onBack: () => void
}) {
  return (
    <div
      // GPUix has no main host; the native div role supplies AccessKit semantics.
      // eslint-disable-next-line react-doctor/prefer-tag-over-role
      role="main"
      aria-label="Note editor"
      style={editorRootStyle}
    >
      <EditorToolbar
        color={color}
        notebookName={notebookName}
        mode={mode}
        onMode={onMode}
        narrow={narrow}
        focusMode={focusMode}
        onFocusMode={onFocusMode}
        onBack={onBack}
      />
      {note.trashedAt && (
        <EditorTrashBanner
          color={color}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      )}
      <EditorHeading
        color={color}
        note={note}
        narrow={narrow}
        onChange={onChange}
      />
      <EditorContent
        color={color}
        preferences={preferences}
        note={note}
        mode={mode}
        narrow={narrow}
        onChange={onChange}
        onLink={onLink}
      />
      <EditorFooter
        color={color}
        note={note}
        dirty={dirty}
        narrow={narrow}
        onPin={onPin}
        onMove={onMove}
        onExport={onExport}
        onTrash={onTrash}
      />
    </div>
  )
}
