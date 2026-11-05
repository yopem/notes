import type { Palette } from "@/components/ui/theme"
import type { Note } from "@/features/notes/store"

import { Button, Label } from "@/components/ui/controls"
import { NoteListItem } from "@/features/notes/components/note-list-item"
import {
  getNoteListStyles,
  noteListStyles,
} from "@/features/notes/components/note-list-styles"

export function NoteList({
  color,
  notes,
  selectedId,
  title,
  query,
  onSelect,
  onNew,
  trash,
  oldestFirst,
  onSort,
}: {
  color: Palette
  notes: Note[]
  selectedId?: string
  title: string
  query: string
  onSelect: (id: string) => void
  onNew: () => void
  trash: boolean
  oldestFirst: boolean
  onSort: () => void
}) {
  const styles = getNoteListStyles(color)

  return (
    <div role="region" aria-label={title} style={styles.frame}>
      <div style={noteListStyles.header}>
        <div style={noteListStyles.headingRow}>
          <text role="heading" aria-level={1} style={styles.heading}>
            {title}
          </text>
          {!trash && (
            <Button
              color={color}
              icon="plus"
              testId="new-note"
              label="New note"
              variant="primary"
              onClick={onNew}
            />
          )}
        </div>
        <div style={noteListStyles.countRow}>
          <text
            // GPUix HostProps uses testId for native automation, not data-*.
            // eslint-disable-next-line react-doctor/no-unknown-property
            testId="note-count"
            style={styles.count}
          >{`${notes.length} ${notes.length === 1 ? "note" : "notes"}`}</text>
          <Button color={color} label="Change sort order" onClick={onSort}>
            {oldestFirst ? "Oldest first" : "Last edited"}
          </Button>
        </div>
      </div>
      <virtual-list estimatedItemHeight={116} style={styles.list}>
        {notes.map((note) => (
          <NoteListItem
            key={note.id}
            color={color}
            note={note}
            selected={selectedId === note.id}
            onSelect={onSelect}
          />
        ))}
      </virtual-list>
      {notes.length === 0 && (
        <div style={noteListStyles.empty}>
          <Label color={color} weight={500}>
            {query
              ? "No matching notes"
              : trash
                ? "Trash is empty"
                : "A fresh page awaits"}
          </Label>
          <Label color={color} size={12} muted>
            {query
              ? "Try another word or clear your search."
              : trash
                ? "Notes you remove stay here until you delete them permanently."
                : "Create a note or import a Markdown file."}
          </Label>
          {!trash && (
            <Button color={color} icon="plus" onClick={onNew}>
              Create a note
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
