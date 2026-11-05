import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"
import type { Note, Notebook } from "@/features/notes/store"

import { Button, Label, NavItem } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import { NotebookItem } from "@/features/workspace/components/navigation/notebook-item"
import {
  getNotebookListStyle,
  sidebarStyles,
} from "@/features/workspace/components/navigation/sidebar-styles"

export type View =
  | { kind: "all" | "pinned" | "trash" }
  | { kind: "notebook"; notebookId: string }

export type WorkspaceView = View | { kind: "tasks" }

export function Sidebar({
  color,
  notebooks,
  notes,
  view,
  onView,
  onNewNotebook,
  onRename,
  onImport,
  onOpenFolder,
}: {
  color: Palette
  notebooks: Notebook[]
  notes: Note[]
  view: WorkspaceView
  onView: (view: WorkspaceView) => void
  onNewNotebook: () => void
  onRename: (notebook: Notebook) => void
  onImport: () => void
  onOpenFolder: () => void
}) {
  const changeView = useRef(onView)

  const [navigation] = useState(function createNavigationHandlers() {
    function showAllNotes() {
      changeView.current({ kind: "all" })
    }

    function showPinnedNotes() {
      changeView.current({ kind: "pinned" })
    }

    function showTrash() {
      changeView.current({ kind: "trash" })
    }

    function showTasks() {
      changeView.current({ kind: "tasks" })
    }

    return { showAllNotes, showPinnedNotes, showTrash, showTasks }
  })

  useLayoutEffect(
    function updateNavigationTarget() {
      changeView.current = onView
    },
    [onView],
  )

  return (
    <div
      // GPUix has no nav host. Keep its AccessKit navigation role.
      // eslint-disable-next-line react-doctor/prefer-tag-over-role
      role="navigation"
      aria-label="Notebooks"
      style={sidebarStyles.frame}
    >
      <div style={sidebarStyles.brand}>
        <Icon name="book" color={color.foreground} size={24} />
        <Label color={color} size={18} weight={600}>
          Still Notes
        </Label>
      </div>
      <Label color={color} size={12} muted>
        Personal workspace
      </Label>
      <div style={sidebarStyles.spacer} />
      <NavItem
        color={color}
        icon="notes"
        selected={view.kind === "all"}
        testId="nav-all"
        onClick={navigation.showAllNotes}
      >
        All notes
      </NavItem>
      <NavItem
        color={color}
        icon="pin"
        selected={view.kind === "pinned"}
        testId="nav-pinned"
        onClick={navigation.showPinnedNotes}
      >
        Pinned
      </NavItem>
      <NavItem
        color={color}
        icon="check"
        selected={view.kind === "tasks"}
        testId="nav-tasks"
        onClick={navigation.showTasks}
      >
        Tasks
      </NavItem>
      <NavItem
        color={color}
        icon="trash"
        selected={view.kind === "trash"}
        testId="nav-trash"
        onClick={navigation.showTrash}
      >
        Trash
      </NavItem>
      <div style={sidebarStyles.notebooksHeading}>
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
      <div style={getNotebookListStyle(color)}>
        {notebooks.map((notebook) => (
          <NotebookItem
            key={notebook.id}
            color={color}
            notebook={notebook}
            selected={
              view.kind === "notebook" && view.notebookId === notebook.id
            }
            onView={onView}
            onRename={onRename}
          />
        ))}
      </div>
      <Button
        color={color}
        icon="book"
        testId="open-folder"
        onClick={onOpenFolder}
      >
        Open folder
      </Button>
      <Button color={color} icon="upload" testId="import" onClick={onImport}>
        Import Markdown
      </Button>
      <div style={sidebarStyles.footer}>
        <div style={sidebarStyles.device}>
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
