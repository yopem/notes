import { useLayoutEffect, useRef, useState } from "react"

import type { Note, NotesStore } from "@/features/notes/store"
import type { DialogState } from "@/features/workspace/components/app-dialog"
import type { useWorkspaceNavigation } from "@/features/workspace/hooks/use-workspace-navigation"

import { attempt } from "@/features/workspace/attempt"
import { openNoteLink } from "@/features/workspace/open-note-link"

export function useWorkspaceEditorActions({
  store,
  note,
  navigation,
  onDialog,
  onError,
}: {
  store: NotesStore
  note: Note | undefined
  navigation: ReturnType<typeof useWorkspaceNavigation>
  onDialog: (dialog: DialogState) => void
  onError: (message: string) => void
}) {
  const current = useRef({ store, note, navigation, onDialog, onError })

  useLayoutEffect(
    function updateEditorTarget() {
      current.current = { store, note, navigation, onDialog, onError }
    },
    [store, note, navigation, onDialog, onError],
  )

  const [handlers] = useState(function createEditorHandlers() {
    function pinNote() {
      const { store, note, onError } = current.current

      if (!note) return
      onError(attempt(() => store.togglePin(note.id)))
    }

    function trashNote() {
      const { store, note, navigation, onError } = current.current

      if (!note) return
      onError(
        attempt(() => {
          store.trashNote(note.id)
          navigation.selectNextNote(note.id, navigation.notes)
        }),
      )
    }

    function restoreNote() {
      const { store, note, navigation, onError } = current.current

      if (!note) return
      onError(
        attempt(() => {
          store.restoreNote(note.id)
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
