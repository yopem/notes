import { Button as NativeButton } from "@gpuix/react/button"
import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"
import type { DiscoveredTask } from "@/features/tasks/hooks/use-task-discovery"

import { Label } from "@/components/ui/controls"
import { getNoteListStyles } from "@/features/notes/components/note-list-styles"

export function TaskRow({
  color,
  task,
  onOpenNote,
}: {
  color: Palette
  task: DiscoveredTask
  onOpenNote: (id: string) => void
}) {
  const current = useRef({ noteId: task.noteId, onOpenNote })
  useLayoutEffect(
    function updateSourceNote() {
      current.current = { noteId: task.noteId, onOpenNote }
    },
    [task.noteId, onOpenNote],
  )
  const [openSource] = useState(function createSourceHandler() {
    return function openSource() {
      current.current.onOpenNote(current.current.noteId)
    }
  })
  const state = task.checked ? "Done" : "Open"
  const title = task.noteTitle || "Untitled"
  const label = task.label || "Untitled task"
  return (
    <NativeButton
      testId="task-row"
      aria-label={`${state} task: ${label}. ${title}, line ${task.line}. Open source note; task is read-only.`}
      onClick={openSource}
      style={getNoteListStyles(color).row}
    >
      <Label color={color} size={12} weight={600}>
        {state}
      </Label>
      <Label color={color}>{label}</Label>
      <Label color={color} size={12} muted>
        {`${title} · Line ${task.line}`}
      </Label>
    </NativeButton>
  )
}
