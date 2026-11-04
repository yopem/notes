import { Button as NativeButton } from "@gpuix/react/button";
import type { Note } from "@/store";
import type { Palette } from "@/theme";
import { Button, Label } from "@/components/ui/controls";
import { Icon } from "@/components/ui/icons";

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
  color: Palette;
  notes: Note[];
  selectedId?: string;
  title: string;
  query: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  trash: boolean;
  oldestFirst: boolean;
  onSort: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={title}
      style={{
        display: "flex",
        flexDirection: "column",
        width: 286,
        minWidth: 220,
        flexShrink: 0,
        borderRightWidth: 1,
        borderColor: color.border,
      }}
    >
      <div
        style={{ padding: 20, paddingBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <text
            role="heading"
            aria-level={1}
            style={{
              color: color.foreground,
              fontFamily: "Inter",
              fontSize: 20,
              fontWeight: 600,
              lineClamp: 1,
            }}
          >
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
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <text
            testId="note-count"
            style={{ color: color.mutedForeground, fontFamily: "Inter", fontSize: 12 }}
          >{`${notes.length} ${notes.length === 1 ? "note" : "notes"}`}</text>
          <Button color={color} label="Change sort order" onClick={onSort}>
            {oldestFirst ? "Oldest first" : "Last edited"}
          </Button>
        </div>
      </div>
      <virtual-list
        estimatedItemHeight={116}
        style={{ flexGrow: 1, minHeight: 0, padding: 8, scrollbarColor: color.border }}
      >
        {notes.map((note) => (
          <NativeButton
            key={note.id}
            testId="note-row"
            aria-label={note.title || "Untitled"}
            aria-selected={selectedId === note.id}
            onClick={() => onSelect(note.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 7,
              padding: 14,
              marginBottom: 4,
              minHeight: 112,
              borderRadius: 12,
              backgroundColor: selectedId === note.id ? color.accent : "transparent",
              cursor: "pointer",
              hover: { backgroundColor: color.muted },
              focusVisible: { outlineWidth: 2, outlineColor: color.ring, outlineOffset: -2 },
            }}
          >
            <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center" }}>
              <text
                style={{
                  color: color.foreground,
                  fontFamily: "Inter",
                  fontSize: 14,
                  fontWeight: 500,
                  lineClamp: 1,
                  flexGrow: 1,
                  minWidth: 0,
                }}
              >
                {note.title || "Untitled"}
              </text>
              {note.pinned && <Icon name="pin" size={13} color={color.mutedForeground} />}
            </div>
            <text
              style={{
                color: color.mutedForeground,
                fontFamily: "Inter",
                fontSize: 12,
                lineHeight: 18,
                lineClamp: 2,
              }}
            >
              {note.body
                .replace(/[#*_>`~[\]]/g, "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 180) || "A little space for your next thought."}
            </text>
            <Label color={color} size={11} muted>
              {new Date(note.updatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </Label>
          </NativeButton>
        ))}
      </virtual-list>
      {notes.length === 0 && (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <Label color={color} weight={500}>
            {query ? "No matching notes" : trash ? "Trash is empty" : "A fresh page awaits"}
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
  );
}
