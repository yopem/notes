import { analyzeMarkdown } from "@still-notes/notes/markdown"
import { useState } from "react"

import type { Note } from "@/features/notes/store"
import type { useNoteDrafts } from "@/features/workspace/hooks/use-note-drafts"

type TaskSources = {
  notes: Note[]
  drafts: ReturnType<typeof useNoteDrafts>["drafts"]
}

export interface DiscoveredTask {
  noteId: string
  noteTitle: string
  label: string
  checked: boolean
  line: number
  start: number
}

function discoverTasks({ notes, drafts }: TaskSources) {
  const tasks: DiscoveredTask[] = []
  const errors: { noteId: string; noteTitle: string }[] = []
  for (const note of notes) {
    if (note.trashedAt) continue
    const draft = drafts[note.id]
    const noteTitle = draft?.title ?? note.title
    try {
      const document = analyzeMarkdown(draft?.body ?? note.body)
      for (const task of document.tasks) {
        tasks.push({
          noteId: note.id,
          noteTitle,
          label: task.label,
          checked: task.checked,
          line: task.line,
          start: task.start,
        })
      }
    } catch {
      errors.push({ noteId: note.id, noteTitle })
    }
  }
  return { tasks, errors }
}

export function useTaskDiscovery({ notes, drafts }: TaskSources) {
  const [snapshot, setSnapshot] = useState(() => ({
    notes,
    drafts,
    result: discoverTasks({ notes, drafts }),
  }))
  if (snapshot.notes !== notes || snapshot.drafts !== drafts) {
    const result = discoverTasks({ notes, drafts })
    setSnapshot({ notes, drafts, result })
    return result
  }
  return snapshot.result
}
