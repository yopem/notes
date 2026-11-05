import type { Palette } from "@/components/ui/theme"
import type { Note } from "@/features/notes/store"

import { Label } from "@/components/ui/controls"
import { getEditorChangeHandlers } from "@/features/editor/components/editor-events"
import {
  getEditorChromeStyles,
  getEditorTheme,
} from "@/features/editor/components/editor-styles"

export function EditorHeading({
  color,
  note,
  narrow,
  onChange,
}: {
  color: Palette
  note: Note
  narrow: boolean
  onChange: (patch: { title?: string; body?: string }) => void
}) {
  const styles = getEditorChromeStyles(color)
  const changes = getEditorChangeHandlers(onChange)
  const words = note.body.trim() ? note.body.trim().split(/\s+/u).length : 0

  return (
    <div style={narrow ? styles.headingNarrow : styles.heading}>
      <input
        key={`${note.id}-title`}
        testId="note-title"
        aria-label="Note title"
        value={note.title}
        placeholder="Untitled"
        readOnly={Boolean(note.trashedAt)}
        theme={getEditorTheme(color)}
        onChange={changes.title}
        style={styles.title}
      />
      <div style={styles.metadata}>
        <Label color={color} size={12} muted>
          {new Date(note.updatedAt).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </Label>
        <Label color={color} size={12} muted>
          ·
        </Label>
        <Label
          color={color}
          size={12}
          muted
        >{`${words} ${words === 1 ? "word" : "words"}`}</Label>
        {note.pinned && (
          <Label color={color} size={12} muted>
            · Pinned
          </Label>
        )}
      </div>
    </div>
  )
}
