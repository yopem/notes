import type { InputProps } from "@gpuix/react"

import { useLayoutEffect, useRef, useState } from "react"

import type { EditorMode } from "@/features/editor/components/editor"
import type { NotesStore, Workspace } from "@/features/notes/store"
import type { View } from "@/features/workspace/components/sidebar"

import { attempt } from "@/features/workspace/attempt"
import { getWorkspaceSelection } from "@/features/workspace/selection"

export function useWorkspaceNavigation({
  store,
  workspace,
  defaultMode,
  onError,
}: {
  store: NotesStore
  workspace: Workspace
  defaultMode: EditorMode
  onError: (message: string) => void
}) {
  const [view, setView] = useState<View>({ kind: "all" })
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState(defaultMode)
  const [focusMode, setFocusMode] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(false)
  const [oldestFirst, setOldestFirst] = useState(false)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const { notes, selected, title } = getWorkspaceSelection({
    workspace,
    view,
    query,
    oldestFirst,
    activeNoteId,
  })
  const current = useRef({ store, notes, view, onError })

  useLayoutEffect(
    function updateNavigationTarget() {
      current.current = { store, notes, view, onError }
    },
    [store, notes, view, onError],
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
      const { store, onError } = current.current
      setActiveNoteId(id)
      setMobileEditor(true)
      onError(attempt(() => store.selectNote(id)))
    }

    function selectNextNote(id: string) {
      const { notes } = current.current
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
      setOldestFirst((previous) => !previous)
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
    oldestFirst,
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
