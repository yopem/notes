import { useLayoutEffect, useRef, useState } from "react"

import type { Note, NotesStore } from "@/features/notes/store"
import type { DialogState } from "@/features/workspace/components/app-dialog"
import type { useWorkspaceNavigation } from "@/features/workspace/hooks/use-workspace-navigation"

import { useDesktopEffect } from "@/components/effect-boundary"
import { attempt } from "@/features/workspace/attempt"
import { openNoteLink } from "@/features/workspace/open-note-link"

export function useWorkspaceEditorActions({
  store,
  note,
  navigation,
  getCurrentNote,
  onDialog,
  onError,
}: {
  store: NotesStore
  note: Note | undefined
  navigation: ReturnType<typeof useWorkspaceNavigation>
  getCurrentNote: (id: string) => Note | undefined
  onDialog: (dialog: DialogState) => void
  onError: (message: string) => void
}) {
  const run = useDesktopEffect()
  const current = useRef({
    store,
    note,
    navigation,
    getCurrentNote,
    onDialog,
    onError,
    run,
  })

  useLayoutEffect(
    function updateEditorTarget() {
      current.current = {
        store,
        note,
        navigation,
        getCurrentNote,
        onDialog,
        onError,
        run,
      }
    },
    [store, note, navigation, getCurrentNote, onDialog, onError, run],
  )

  const [handlers] = useState(function createEditorHandlers() {
    function pinNote() {
      const { store, note, onError, run } = current.current

      if (!note) return
      onError(attempt(() => run(store.togglePin(note.id))))
    }

    function duplicateNote() {
      const {
        store,
        note: selected,
        navigation,
        getCurrentNote,
        onError,
        run,
      } = current.current
      if (!selected) return
      const note = getCurrentNote(selected.id)
      if (!note || note.trashedAt) return

      try {
        const copy = run(
          store.duplicateNote(note.id, { title: note.title, body: note.body }),
        )

        const search = navigation.query.trim().toLocaleLowerCase()

        if (
          navigation.view.kind === "pinned" ||
          (navigation.view.kind === "notebook" &&
            navigation.view.notebookId !== copy.notebookId)
        )
          navigation.setView({ kind: "notebook", notebookId: copy.notebookId })

        if (
          search &&
          !`${copy.title}\n${copy.body}`.toLocaleLowerCase().includes(search)
        )
          navigation.setQuery("")

        navigation.setActiveNoteId(copy.id)
        navigation.setMobileEditor(true)
        navigation.setNavigationOpen(false)
        onError("")
      } catch {
        onError(
          "Could not duplicate note. Check the workspace before retrying.",
        )
      }
    }

    function trashNote() {
      const { store, note, navigation, onError, run } = current.current

      if (!note) return
      onError(
        attempt(() => {
          run(store.trashNote(note.id))
          navigation.selectNextNote(note.id, navigation.notes)
        }),
      )
    }

    function restoreNote() {
      const { store, note, navigation, onError, run } = current.current

      if (!note) return
      onError(
        attempt(() => {
          run(store.restoreNote(note.id))
          navigation.setActiveNoteId(note.id)
          navigation.setView({ kind: "all" })
        }),
      )
    }

    function deleteNote() {
      const { note, onDialog } = current.current

      if (note) onDialog({ kind: "delete", id: note.id, title: note.title })
    }

    function exportNote() {
      const { note, onDialog } = current.current

      if (note) onDialog({ kind: "export", id: note.id })
    }

    function moveNote() {
      const { note, onDialog } = current.current

      if (note) onDialog({ kind: "move", id: note.id })
    }

    function openLink(value: string) {
      openNoteLink(value, current.current.onError)
    }

    return {
      pinNote,
      duplicateNote,
      trashNote,
      restoreNote,
      deleteNote,
      exportNote,
      moveNote,
      openLink,
    }
  })

  return handlers
}
