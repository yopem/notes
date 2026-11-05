import type { Palette } from "@/components/ui/theme"
import type { Note, Notebook } from "@/features/notes/store"

import { Button, Label, NavItem } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"

export type View =
  | { kind: "all" | "pinned" | "trash" }
  | { kind: "notebook"; notebookId: string }

export function Sidebar({
  color,
  notebooks,
  notes,
  view,
  onView,
  onNewNotebook,
  onRename,
  onImport,
}: {
  color: Palette
  notebooks: Notebook[]
  notes: Note[]
  view: View
  onView: (view: View) => void
  onNewNotebook: () => void
  onRename: (notebook: Notebook) => void
  onImport: () => void
}) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- GPUix has no semantic HTML host elements.
      role="navigation"
      aria-label="Notebooks"
      style={{
        display: "flex",
        flexDirection: "column",
        width: 220,
        flexShrink: 0,
        padding: 12,
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 12,
          height: 44,
          marginBottom: 12,
        }}
      >
        <Icon name="book" color={color.foreground} size={24} />
        <Label color={color} size={18} weight={600}>
          Still Notes
        </Label>
      </div>
      <Label color={color} size={12} muted>
        Personal workspace
      </Label>
      <div style={{ height: 4 }} />
      <NavItem
        color={color}
        icon="notes"
        selected={view.kind === "all"}
        testId="nav-all"
        onClick={() => onView({ kind: "all" })}
      >
        All notes
      </NavItem>
      <NavItem
        color={color}
        icon="pin"
        selected={view.kind === "pinned"}
        testId="nav-pinned"
        onClick={() => onView({ kind: "pinned" })}
      >
        Pinned
      </NavItem>
      <NavItem
        color={color}
        icon="trash"
        selected={view.kind === "trash"}
        testId="nav-trash"
        onClick={() => onView({ kind: "trash" })}
      >
        Trash
      </NavItem>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 12,
          marginTop: 24,
        }}
      >
        <Label color={color} size={12} weight={500} muted>
          Notebooks
        </Label>
        <Button
          color={color}
          icon="plus"
          label="New notebook"
          testId="new-notebook"
          onClick={onNewNotebook}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
          overflow: "scroll",
          scrollbarColor: color.border,
          gap: 4,
        }}
      >
        {notebooks.map((notebook) => (
          <div
            key={notebook.id}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <NavItem
                color={color}
                icon="book"
                selected={
                  view.kind === "notebook" && view.notebookId === notebook.id
                }
                onClick={() =>
                  onView({ kind: "notebook", notebookId: notebook.id })
                }
              >
                {notebook.name}
              </NavItem>
            </div>
            {view.kind === "notebook" && view.notebookId === notebook.id && (
              <Button
                color={color}
                icon="edit"
                label={`Rename ${notebook.name}`}
                onClick={() => onRename(notebook)}
              />
            )}
          </div>
        ))}
      </div>
      <Button color={color} icon="upload" testId="import" onClick={onImport}>
        Import Markdown
      </Button>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: 12,
          marginTop: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="check" color={color.mutedForeground} size={14} />
          <Label color={color} size={12}>
            On this device
          </Label>
        </div>
        <Label
          color={color}
          size={11}
          muted
        >{`${notes.filter((note) => !note.trashedAt).length} notes · No account needed`}</Label>
      </div>
    </div>
  )
}
