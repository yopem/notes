import type { Palette } from "@/components/ui/theme"
import type { Note } from "@/features/notes/store"
import type { Preferences } from "@/features/settings/store"

import { Button, Label } from "@/components/ui/controls"
import { NoteListItem } from "@/features/notes/components/note-list-item"
import {
  getNoteListStyles,
  noteListStyles,
} from "@/features/notes/components/note-list-styles"

const sortLabels: Record<Preferences["noteSortOrder"], string> = {
  none: "Workspace order",
  "updated-desc": "Updated: newest first",
  "updated-asc": "Updated: oldest first",
  "created-desc": "Created: newest first",
  "created-asc": "Created: oldest first",
  "name-asc": "Name: ascending",
  "name-desc": "Name: descending",
}

export function NoteList({
  color,
  notes,
  selectedId,
  title,
  query,
  onSelect,
  onNew,
  trash,
  sortOrder,
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
  sortOrder: Preferences["noteSortOrder"]
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
            testId="note-count"
            style={styles.count}
          >{`${notes.length} ${notes.length === 1 ? "note" : "notes"}`}</text>
          <Button
            color={color}
            testId="note-sort"
            label={
              sortOrder === "none"
                ? "Sort: Workspace order. Switch to updated, newest first"
                : `Sort: ${sortLabels[sortOrder]}. Reverse sort order`
            }
            onClick={onSort}
          >
            {sortLabels[sortOrder]}
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
