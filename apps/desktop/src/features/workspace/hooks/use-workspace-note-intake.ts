import { useLayoutEffect, useRef, useState } from "react"

import type { NotesStore } from "@/features/notes/store"
import type { useWorkspaceNavigation } from "@/features/workspace/hooks/use-workspace-navigation"

import { attempt } from "@/features/workspace/attempt"

export function useWorkspaceNoteIntake({
  store,
  navigation,
  onError,
  onNotice,
}: {
  store: NotesStore
  navigation: ReturnType<typeof useWorkspaceNavigation>
  onError: (message: string) => void
  onNotice: (message: string) => void
}) {
  const current = useRef({ store, navigation, onError, onNotice })

  useLayoutEffect(
    function updateIntakeTarget() {
      current.current = { store, navigation, onError, onNotice }
    },
    [store, navigation, onError, onNotice],
  )

  const [handlers] = useState(function createIntakeHandlers() {
    function newNote() {
      const { store, navigation, onError } = current.current
      onError(
        attempt(() => {
          const created = store.createNote(
            navigation.view.kind === "notebook"
              ? navigation.view.notebookId
              : undefined,
          )

          store.selectNote(created.id)
          navigation.setActiveNoteId(created.id)

          if (
            navigation.view.kind === "trash" ||
            navigation.view.kind === "pinned"
          )
            navigation.setView({ kind: "all" })
          navigation.setQuery("")
          navigation.setMode("edit")
          navigation.setMobileEditor(true)
          navigation.setNavigationOpen(false)
        }),
      )
    }

    function importNotes(paths: string[]) {
      const { store, navigation } = current.current

      const imported = store.importMarkdown(
        paths,
        navigation.view.kind === "notebook"
          ? navigation.view.notebookId
          : undefined,
      )

      if (imported[0]) store.selectNote(imported[0].id)
      navigation.setActiveNoteId(imported[0]?.id ?? null)
      navigation.setView({ kind: "all" })
      navigation.setQuery("")
      navigation.setMode("edit")

      return imported
    }

    function importFiles(paths: string[]) {
      const { onError, onNotice } = current.current
      onError(
        attempt(() => {
          const imported = importNotes(paths)
          onNotice(
            `Imported ${imported.length} ${imported.length === 1 ? "note" : "notes"}. Original files unchanged.`,
          )
        }),
      )
    }

    function importPath(value: string) {
      importNotes([value])
      current.current.onNotice("Markdown imported. Original file unchanged.")
    }

    return { newNote, importFiles, importPath }
  })

  return handlers
}
