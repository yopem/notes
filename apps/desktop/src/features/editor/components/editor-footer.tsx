import type { Palette } from "@/components/ui/theme"
import type { Note } from "@/features/notes/store"

import { Button } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import { getEditorChromeStyles } from "@/features/editor/components/editor-styles"

export function EditorFooter({
  color,
  note,
  dirty,
  narrow,
  onPin,
  onMove,
  onExport,
  onTrash,
}: {
  color: Palette
  note: Note
  dirty: boolean
  narrow: boolean
  onPin: () => void
  onMove: () => void
  onExport: () => void
  onTrash: () => void
}) {
  const styles = getEditorChromeStyles(color)

  return (
    <div style={styles.footer}>
      <div style={styles.saveState}>
        <Icon
          name={dirty ? "edit" : "check"}
          color={dirty ? color.destructive : color.mutedForeground}
          size={13}
        />
        <text
          testId="save-status"
          style={dirty ? styles.unsavedStatus : styles.savedStatus}
        >
          {dirty ? "Not saved · Retry before closing" : "Saved locally"}
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
