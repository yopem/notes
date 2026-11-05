import type { InputProps } from "@gpuix/react"

import { useLayoutEffect, useRef, useState } from "react"

import type { EditorMode } from "@/features/editor/components/editor"
import type { Note, NotesStore, Workspace } from "@/features/notes/store"
import type { Preferences, SettingsStore } from "@/features/settings/store"
import type { View } from "@/features/workspace/components/sidebar"

import { useDesktopEffect } from "@/components/effect-boundary"
import { attempt } from "@/features/workspace/attempt"
import { getWorkspaceSelection } from "@/features/workspace/selection"

const naturalNames = new Intl.Collator(undefined, { numeric: true })

function sortNotes(notes: Note[], order: Preferences["noteSortOrder"]) {
  return notes.toSorted((left, right) => {
    const pinned = Number(right.pinned) - Number(left.pinned)

    if (pinned || order === "none") return pinned

    const comparison = order.startsWith("name-")
      ? naturalNames.compare(left.title, right.title)
      : order.startsWith("created-")
        ? left.createdAt.localeCompare(right.createdAt)
        : left.updatedAt.localeCompare(right.updatedAt)

    const direction = order.endsWith("-desc") ? -1 : 1

    return (
      direction * comparison ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    )
  })
}

export function useWorkspaceNavigation({
  store,
  workspace,
  settings,
  sortOrder,
  defaultMode,
  onError,
}: {
  store: NotesStore
  workspace: Workspace
  settings: SettingsStore
  sortOrder: Preferences["noteSortOrder"]
  defaultMode: EditorMode
  onError: (message: string) => void
}) {
  const run = useDesktopEffect()
  const [view, setView] = useState<View>({ kind: "all" })
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState(defaultMode)
  const [focusMode, setFocusMode] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(false)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)

  const selection = getWorkspaceSelection({
    workspace,
    view,
    query,
    oldestFirst: false,
    activeNoteId,
  })

  const visibleIds = new Set(selection.notes.map((note) => note.id))
  const visibleNotes = workspace.notes.filter((note) => visibleIds.has(note.id))

  const contextKey = JSON.stringify([view, query])

  const listKey = JSON.stringify([
    contextKey,
    sortOrder,
    visibleNotes.map((note) => [note.id, note.pinned]),
  ])

  const [list, setList] = useState<{
    key: string
    contextKey: string
    selectedId: string | null
    ids: string[]
  }>(() => ({
    key: listKey,
    contextKey,
    selectedId: null,
    ids: sortNotes(visibleNotes, sortOrder).map((note) => note.id),
  }))

  const notesById = new Map(visibleNotes.map((note) => [note.id, note]))

  const previousNotes = list.ids.flatMap((id) => {
    const note = notesById.get(id)

    return note ? [note] : []
  })

  const selectedBeforeSort =
    workspace.notes.find(
      (note) =>
        note.id === activeNoteId &&
        Boolean(note.trashedAt) === (view.kind === "trash"),
    ) ??
    notesById.get(workspace.selectedNoteId ?? "") ??
    previousNotes[0]

  let ids = list.ids

  if (
    list.key !== listKey ||
    list.selectedId !== (selectedBeforeSort?.id ?? null)
  ) {
    ids = sortNotes(visibleNotes, sortOrder).map((note) => note.id)

    if (
      list.key !== listKey &&
      list.contextKey === contextKey &&
      activeNoteId === null &&
      selectedBeforeSort
    )
      setActiveNoteId(selectedBeforeSort.id)

    setList({
      key: listKey,
      contextKey,
      selectedId: selectedBeforeSort?.id ?? null,
      ids,
    })
  }

  const notes = ids.flatMap((id) => {
    const note = notesById.get(id)

    return note ? [note] : []
  })

  const selected =
    workspace.notes.find(
      (note) =>
        note.id === activeNoteId &&
        Boolean(note.trashedAt) === (view.kind === "trash"),
    ) ??
    notes.find((note) => note.id === workspace.selectedNoteId) ??
    notes[0]

  const title = selection.title
  const current = useRef({ store, settings, onError, run })

  useLayoutEffect(
    function updateNavigationTarget() {
      current.current = { store, settings, onError, run }
    },
    [store, settings, onError, run],
  )

  const [handlers] = useState(function createNavigationHandlers() {
    function changeView(next: View) {
      setView(next)
      setActiveNoteId(null)
      setQuery("")
      setNavigationOpen(false)
      setMobileEditor(false)
    }

    function searchNotes(
      event: Parameters<NonNullable<InputProps["onChange"]>>[0],
    ) {
      setQuery(event.value ?? "")
      setActiveNoteId(null)
      setMobileEditor(false)
      setFocusMode(false)
    }

    function selectNote(id: string) {
      const { store, onError, run } = current.current
      setActiveNoteId(id)
      setMobileEditor(true)
      onError(attempt(() => run(store.selectNote(id))))
    }

    // Use the list from before the write, even if a store update commits at once.
    function selectNextNote(id: string, notes: Note[]) {
      const index = notes.findIndex((item) => item.id === id)
      setActiveNoteId(notes[index + 1]?.id ?? notes[index - 1]?.id ?? null)
      setMobileEditor(false)
    }

    function showNotebooks() {
      setFocusMode(false)
      setNavigationOpen(true)
    }

    function showSearch() {
      setFocusMode(false)
      setMobileEditor(false)
    }

    function toggleSort() {
      const { settings, onError, run } = current.current
      const sortOrder = settings.getSnapshot().noteSortOrder

      const next =
        sortOrder === "none"
          ? "updated-desc"
          : sortOrder.endsWith("-asc")
            ? sortOrder.replace(/-asc$/, "-desc")
            : sortOrder.replace(/-desc$/, "-asc")

      onError(attempt(() => run(settings.setField("noteSortOrder", next))))
    }

    function toggleFocus() {
      setFocusMode((previous) => !previous)
      setNavigationOpen(false)
    }

    function toggleKeyboardFocus() {
      setFocusMode((previous) => !previous)
    }

    function togglePreview() {
      setMode((previous) => (previous === "preview" ? "edit" : "preview"))
    }

    function showList() {
      setMobileEditor(false)
    }

    return {
      changeView,
      searchNotes,
      selectNote,
      selectNextNote,
      showNotebooks,
      showSearch,
      toggleSort,
      toggleFocus,
      toggleKeyboardFocus,
      togglePreview,
      showList,
    }
  })

  return {
    view,
    query,
    mode,
    focusMode,
    navigationOpen,
    mobileEditor,
    notes,
    selected,
    title,
    setView,
    setQuery,
    setMode,
    setActiveNoteId,
    setNavigationOpen,
    setMobileEditor,
    changeView: handlers.changeView,
    searchNotes: handlers.searchNotes,
    selectNote: handlers.selectNote,
    selectNextNote: handlers.selectNextNote,
    showNotebooks: handlers.showNotebooks,
    showSearch: handlers.showSearch,
    toggleSort: handlers.toggleSort,
    toggleFocus: handlers.toggleFocus,
    toggleKeyboardFocus: handlers.toggleKeyboardFocus,
    togglePreview: handlers.togglePreview,
    showList: handlers.showList,
  }
}
