import { use } from "react"

import type { Palette } from "@/components/ui/theme"
import type { Note } from "@/features/notes/store"

import { Button } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import { DuplicateNoteContext } from "@/features/editor/components/duplicate-note-context"
import { getEditorChromeStyles } from "@/features/editor/components/editor-styles"

export type EditorSaveState = "saved" | "draft" | "uncertain"

const saveStateLabels: Record<EditorSaveState, string> = {
  saved: "Saved locally",
  draft: "Not saved · Retry before closing",
  uncertain: "Write uncertain · Recover before closing",
}

export function EditorFooter({
  color,
  note,
  saveState,
  narrow,
  onPin,
  onMove,
  onExport,
  onTrash,
}: {
  color: Palette
  note: Note
  saveState: EditorSaveState
  narrow: boolean
  onPin: () => void
  onMove: () => void
  onExport: () => void
  onTrash: () => void
}) {
  const styles = getEditorChromeStyles(color)
  const duplicateNote = use(DuplicateNoteContext)
  const saved = saveState === "saved"

  return (
    <div style={styles.footer}>
      <div style={styles.saveState}>
        <Icon
          name={saved ? "check" : "edit"}
          color={saved ? color.mutedForeground : color.destructive}
          size={13}
        />
        <text
          testId="save-status"
          style={saved ? styles.savedStatus : styles.unsavedStatus}
        >
          {saveStateLabels[saveState]}
        </text>
      </div>
      <div style={styles.noteActions}>
        {!note.trashedAt && (
          <Button
            color={color}
            icon="pin"
            testId="pin-note"
            label={note.pinned ? "Unpin note" : "Pin note"}
            onClick={onPin}
          />
        )}
        {!note.trashedAt && duplicateNote && (
          <Button
            color={color}
            icon="notes"
            testId="duplicate-note"
            label="Duplicate note"
            onClick={duplicateNote}
          />
        )}
        {!note.trashedAt && !narrow && (
          <Button
            color={color}
            icon="book"
            label="Move note to notebook"
            testId="move-note"
            onClick={onMove}
          />
        )}
        <Button
          color={color}
          icon="download"
          testId="export"
          label="Export Markdown"
          onClick={onExport}
        />
        {!note.trashedAt && (
          <Button
            color={color}
            icon="trash"
            testId="trash-note"
            label="Move note to Trash"
            onClick={onTrash}
          />
        )}
      </div>
    </div>
  )
}
