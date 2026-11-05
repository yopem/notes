import type { InputProps, KeyEvent, PublicInstance } from "@gpuix/react"
import type { RefObject } from "react"

import { useGpuixRequired } from "@gpuix/react"
import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"
import type { Note } from "@/features/notes/store"
import type { useNoteDrafts } from "@/features/workspace/hooks/use-note-drafts"

import { Button, Label } from "@/components/ui/controls"
import { TaskRow } from "@/features/tasks/components/task-row"
import {
  getTaskStyles,
  taskStyles,
} from "@/features/tasks/components/task-styles"
import { useTaskDiscovery } from "@/features/tasks/hooks/use-task-discovery"

export function TaskView({
  color,
  notes,
  drafts,
  searchRef,
  showSidebar,
  onShowNotebooks,
  onSettings,
  onOpenNote,
}: {
  color: Palette
  notes: Note[]
  drafts: ReturnType<typeof useNoteDrafts>["drafts"]
  searchRef: RefObject<PublicInstance | null>
  showSidebar: boolean
  onShowNotebooks: () => void
  onSettings: () => void
  onOpenNote: (id: string) => void
}) {
  const renderer = useGpuixRequired()
  const styles = getTaskStyles(color)
  const { tasks, errors } = useTaskDiscovery({ notes, drafts })
  const [search, setSearch] = useState("")
  const [submitted, setSubmitted] = useState({ query: "", version: 0 })
  const summaryRef = useRef<PublicInstance>(null)
  const currentSearch = useRef(search)
  useLayoutEffect(
    function updateSearchTarget() {
      currentSearch.current = search
    },
    [search],
  )

  const [handlers] = useState(function createSearchHandlers() {
    function changeSearch(
      event: Parameters<NonNullable<InputProps["onChange"]>>[0],
    ) {
      setSearch(event.value ?? "")
    }

    function submitSearch() {
      setSubmitted((previous) => ({
        query: currentSearch.current.trim(),
        version: previous.version + 1,
      }))
    }

    function searchKeyDown(event: KeyEvent) {
      if (event.key === "enter" && !event.isHeld) {
        event.preventDefault()
        submitSearch()
      }
    }

    return { changeSearch, submitSearch, searchKeyDown }
  })

  useLayoutEffect(
    function focusSubmittedResults() {
      if (submitted.version > 0 && summaryRef.current)
        renderer.focusElement?.(summaryRef.current.id)
    },
    [renderer, submitted],
  )
  const query = submitted.query.toLocaleLowerCase()

  const visible = tasks.filter(
    (task) =>
      !query ||
      task.label.toLocaleLowerCase().includes(query) ||
      task.noteTitle.toLocaleLowerCase().includes(query),
  )

  const summary = `${visible.length} ${visible.length === 1 ? "task" : "tasks"}${submitted.query ? ` matching ${submitted.query}` : ""}. ${errors.length} ${errors.length === 1 ? "note could" : "notes could"} not be read.`

  return (
    <div role="region" aria-label="Tasks" style={taskStyles.frame}>
      <div style={taskStyles.toolbar}>
        {!showSidebar && (
          <Button
            color={color}
            icon="menu"
            label="Show notebooks"
            testId="show-notebooks"
            onClick={onShowNotebooks}
          />
        )}
        <text role="heading" aria-level={1} style={styles.heading}>
          Tasks
        </text>
        <Button
          color={color}
          icon="settings"
          label="Settings"
          testId="settings-open"
          onClick={onSettings}
        />
      </div>
      <Label color={color} weight={600}>
        Read-only task discovery
      </Label>
      <Label color={color} size={12}>
        Open a task to view its source note. Tasks are not changed here.
      </Label>
      <div style={taskStyles.search}>
        <input
          ref={searchRef}
          testId="task-search"
          aria-label="Search task text or note title; press Enter to search"
          placeholder="Task text or note title"
          value={search}
          onChange={handlers.changeSearch}
          onKeyDown={handlers.searchKeyDown}
          style={styles.input}
        />
        <Button
          color={color}
          testId="task-search-submit"
          variant="outline"
          onClick={handlers.submitSearch}
        >
          Search
        </Button>
      </div>
      <div
        ref={summaryRef}
        testId="task-result-summary"
        role="region"
        aria-label={summary}
        tabIndex={0}
        style={styles.summary}
      >
        <Label color={color} size={12}>
          {summary}
        </Label>
      </div>
      <div style={taskStyles.results}>
        {errors.length > 0 && (
          <div
            testId="task-errors"
            role="region"
            aria-label="Task parsing errors"
            style={taskStyles.errors}
          >
            <Label color={color} weight={600}>
              Some notes could not be read
            </Label>
            {errors.map((error) => (
              <Label key={error.noteId} color={color} size={12}>
                {`${error.noteTitle || "Untitled"}: Could not read tasks. Open the note and check its Markdown and frontmatter.`}
              </Label>
            ))}
          </div>
        )}
        {visible.length === 0 && (
          <Label color={color}>
            {query
              ? "No matching tasks"
              : errors.length > 0
                ? "No readable tasks"
                : "No tasks found"}
          </Label>
        )}
        {visible.map((task) => (
          <TaskRow
            key={`${task.noteId}:${task.start}`}
            color={color}
            task={task}
            onOpenNote={onOpenNote}
          />
        ))}
      </div>
    </div>
  )
}
