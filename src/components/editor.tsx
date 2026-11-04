import type { Note } from "@/store"
import type { Palette } from "@/theme"

import { Button, Label } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import { nativeTheme } from "@/theme"

export type EditorMode = "edit" | "preview" | "split"

export function Editor({
  color,
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
  const theme = nativeTheme(color)
  const words = note.body.trim() ? note.body.trim().split(/\s+/u).length : 0
  const split = mode === "split" && !narrow

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- GPUix has no semantic HTML host elements.
      role="main"
      aria-label="Note editor"
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 14,
          borderBottomWidth: 1,
          borderColor: color.border,
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          {narrow && (
            <Button
              color={color}
              icon="chevron"
              label="Back to notes"
              onClick={onBack}
            />
          )}
          <Icon name="book" color={color.mutedForeground} size={15} />
          <text
            style={{
              color: color.mutedForeground,
              fontFamily: "Inter",
              fontSize: 12,
              lineClamp: 1,
            }}
          >
            {notebookName}
          </text>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Button
            color={color}
            icon={mode === "preview" ? "edit" : "eye"}
            testId="preview-toggle"
            label={mode === "preview" ? "Edit note" : "Preview Markdown"}
            onClick={() => onMode(mode === "preview" ? "edit" : "preview")}
          >
            {narrow ? undefined : mode === "preview" ? "Edit" : "Preview"}
          </Button>
          {!narrow && (
            <Button
              color={color}
              label="Split editor and preview"
              onClick={() => onMode(split ? "edit" : "split")}
            >
              {split ? "Single" : "Split"}
            </Button>
          )}
          <Button
            color={color}
            icon="menu"
            label={focusMode ? "Leave focus mode" : "Focus mode"}
            onClick={onFocusMode}
          />
        </div>
      </div>
      {note.trashedAt && (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: color.muted,
            padding: 12,
            gap: 8,
          }}
        >
          <Label color={color} size={12}>
            This note is in Trash.
          </Label>
          <Button
            color={color}
            icon="restore"
            testId="restore-note"
            onClick={onRestore}
          >
            Restore
          </Button>
          <Button color={color} variant="danger" onClick={onDelete}>
            Delete forever
          </Button>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingLeft: narrow ? 24 : 40,
          paddingRight: narrow ? 24 : 40,
          paddingTop: 32,
          paddingBottom: 22,
        }}
      >
        <input
          key={`${note.id}-title`}
          testId="note-title"
          aria-label="Note title"
          value={note.title}
          placeholder="Untitled"
          readOnly={Boolean(note.trashedAt)}
          theme={theme}
          onChange={(event) => onChange({ title: event.value ?? "" })}
          style={{
            color: color.foreground,
            fontFamily: "Inter",
            fontSize: 28,
            fontWeight: 600,
            lineHeight: 40,
            height: 48,
            width: "100%",
            backgroundColor: "transparent",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
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
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexGrow: 1,
          minHeight: 0,
          paddingLeft: narrow ? 24 : 40,
          paddingRight: narrow ? 24 : 40,
          paddingBottom: 24,
          gap: 28,
        }}
      >
        {mode !== "preview" && (
          <textarea
            key={`${note.id}-body`}
            testId="note-body"
            aria-label="Note Markdown"
            value={note.body}
            placeholder="Start writing. Markdown is welcome."
            readOnly={Boolean(note.trashedAt)}
            theme={theme}
            onChange={(event) => onChange({ body: event.value ?? "" })}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              height: "100%",
              color: color.foreground,
              fontFamily: "IBM Plex Mono",
              fontSize: 14,
              lineHeight: 26,
              backgroundColor: "transparent",
              selectionColor: color.selection,
            }}
          />
        )}
        {(mode === "preview" || split) && (
          <div
            testId="markdown-preview"
            style={{
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              height: "100%",
              overflow: "scroll",
              scrollbarColor: color.border,
              borderLeftWidth: split ? 1 : 0,
              borderColor: color.border,
              paddingLeft: split ? 28 : 0,
            }}
          >
            <markdown
              source={note.body || "*Nothing here yet.*"}
              theme={theme}
              onLinkClick={(event) => {
                if (event.value) onLink(event.value)
              }}
              style={{
                color: color.foreground,
                fontFamily: "Inter",
                fontSize: 16,
                lineHeight: 27,
              }}
            />
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderTopWidth: 1,
          borderColor: color.border,
          paddingLeft: 16,
          paddingRight: 12,
          minHeight: 54,
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon
            name={dirty ? "edit" : "check"}
            color={dirty ? color.destructive : color.mutedForeground}
            size={13}
          />
          <text
            testId="save-status"
            style={{
              color: dirty ? color.destructive : color.mutedForeground,
              fontFamily: "Inter",
              fontSize: 11,
            }}
          >
            {dirty ? "Not saved · Retry before closing" : "Saved locally"}
          </text>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
          }}
        >
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
    </div>
  )
}
