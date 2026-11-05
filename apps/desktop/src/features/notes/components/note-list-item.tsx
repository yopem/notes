import { Button as NativeButton } from "@gpuix/react/button"
import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"
import type { Note } from "@/features/notes/store"

import { Label } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import {
  getNoteListStyles,
  noteListStyles,
} from "@/features/notes/components/note-list-styles"

const dateLocale = new Intl.DateTimeFormat().resolvedOptions()

export function NoteListItem({
  color,
  note,
  selected,
  onSelect,
}: {
  color: Palette
  note: Note
  selected: boolean
  onSelect: (id: string) => void
}) {
  const styles = getNoteListStyles(color)

  const noteId = useRef(note.id)
  const select = useRef(onSelect)

  const [selectNote] = useState(function createSelectionHandler() {
    return function selectNote() {
      select.current(noteId.current)
    }
  })

  useLayoutEffect(
    function updateSelectionTarget() {
      noteId.current = note.id
      select.current = onSelect
    },
    [note.id, onSelect],
  )

  return (
    <NativeButton
      testId="note-row"
      aria-label={note.title || "Untitled"}
      aria-selected={selected}
      onClick={selectNote}
      style={selected ? styles.selectedRow : styles.row}
    >
      <div style={noteListStyles.titleRow}>
        <text style={styles.title}>{note.title || "Untitled"}</text>
        {note.pinned && (
          <Icon name="pin" size={13} color={color.mutedForeground} />
        )}
      </div>
      <text style={styles.preview}>
        {note.body
          .replace(/[#*_>`~[\]]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180) || "A little space for your next thought."}
      </text>
      <Label color={color} size={11} muted>
        {new Date(note.updatedAt).toLocaleDateString(dateLocale.locale, {
          month: "short",
          day: "numeric",
          timeZone: dateLocale.timeZone,
        })}
      </Label>
    </NativeButton>
  )
}
