import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"
import type { Notebook } from "@/features/notes/store"
import type { View } from "@/features/workspace/components/sidebar"

import { Button, NavItem } from "@/components/ui/controls"
import { sidebarStyles } from "@/features/workspace/components/navigation/sidebar-styles"

export function NotebookItem({
  color,
  notebook,
  selected,
  onView,
  onRename,
}: {
  color: Palette
  notebook: Notebook
  selected: boolean
  onView: (view: View) => void
  onRename: (notebook: Notebook) => void
}) {
  const currentNotebook = useRef(notebook)
  const changeView = useRef(onView)
  const rename = useRef(onRename)

  const [handlers] = useState(function createNotebookHandlers() {
    function selectNotebook() {
      changeView.current({
        kind: "notebook",
        notebookId: currentNotebook.current.id,
      })
    }

    function renameNotebook() {
      rename.current(currentNotebook.current)
    }

    return { selectNotebook, renameNotebook }
  })

  useLayoutEffect(
    function updateNotebookTargets() {
      currentNotebook.current = notebook
      changeView.current = onView
      rename.current = onRename
    },
    [notebook, onView, onRename],
  )

  return (
    <div style={sidebarStyles.notebookRow}>
      <div style={sidebarStyles.notebookLink}>
        <NavItem
          color={color}
          icon="book"
          selected={selected}
          onClick={handlers.selectNotebook}
        >
          {notebook.name}
        </NavItem>
      </div>
      {selected && (
        <Button
          color={color}
          icon="edit"
          label={`Rename ${notebook.name}`}
          onClick={handlers.renameNotebook}
        />
      )}
    </div>
  )
}
