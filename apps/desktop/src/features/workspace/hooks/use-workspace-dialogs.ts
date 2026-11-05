import { homedir } from "node:os"
import { useLayoutEffect, useRef, useState } from "react"

import type { Notebook, NotesStore } from "@/features/notes/store"
import type { DialogState } from "@/features/workspace/components/app-dialog"
import type { useNoteDrafts } from "@/features/workspace/hooks/use-note-drafts"
import type { useWorkspaceNavigation } from "@/features/workspace/hooks/use-workspace-navigation"

import { useDesktopEffect } from "@/components/effect-boundary"

export function useWorkspaceDialogs({
  store,
  navigation,
  getCurrentNote,
  discardDraft,
  importPath,
  onNotice,
}: {
  store: NotesStore
  navigation: ReturnType<typeof useWorkspaceNavigation>
  getCurrentNote: ReturnType<typeof useNoteDrafts>["getCurrentNote"]
  discardDraft: (id: string) => void
  importPath: (path: string) => void
  onNotice: (message: string) => void
}) {
  const run = useDesktopEffect()
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const current = useRef({
    store,
    navigation,
    getCurrentNote,
    discardDraft,
    importPath,
    onNotice,
    dialog,
    run,
  })

  useLayoutEffect(
    function updateDialogTarget() {
      current.current = {
        store,
        navigation,
        getCurrentNote,
        discardDraft,
        importPath,
        onNotice,
        dialog,
        run,
      }
    },
    [
      store,
      navigation,
      getCurrentNote,
      discardDraft,
      importPath,
      onNotice,
      dialog,
      run,
    ],
  )

  const [handlers] = useState(function createDialogHandlers() {
    function newNotebook() {
      setDialog({ kind: "notebook" })
    }

    function renameNotebook(item: Notebook) {
      setDialog({ kind: "rename", id: item.id, name: item.name })
    }

    function showImport() {
      setDialog({ kind: "import" })
    }

    function showHelp() {
      setDialog({ kind: "help" })
    }

    function closeDialog() {
      setDialog(null)
    }

    function confirmDialog(value: string) {
      const {
        dialog,
        store,
        navigation,
        getCurrentNote,
        discardDraft,
        importPath,
        onNotice,
        run,
      } = current.current

      if (!dialog) return

      if (dialog.kind === "notebook") {
        const created = run(store.createNotebook(value))
        navigation.setView({ kind: "notebook", notebookId: created.id })
        navigation.setActiveNoteId(null)
        navigation.setMobileEditor(false)
        navigation.setQuery("")
      } else if (dialog.kind === "rename")
        run(store.renameNotebook(dialog.id, value))
      else if (dialog.kind === "move") {
        run(store.updateNote(dialog.id, { notebookId: value }))

        if (
          navigation.view.kind === "notebook" &&
          navigation.view.notebookId !== value
        )
          navigation.selectNextNote(dialog.id, navigation.notes)
      } else if (dialog.kind === "import") importPath(value)
      else if (dialog.kind === "export") {
        const note = getCurrentNote(dialog.id)

        const destination = run(
          store.exportMarkdown(
            dialog.id,
            value || homedir(),
            note ? { title: note.title, body: note.body } : undefined,
          ),
        )

        onNotice(`Exported to ${destination}`)
      } else if (dialog.kind === "delete") {
        run(store.deleteNote(dialog.id))
        navigation.selectNextNote(dialog.id, navigation.notes)
        discardDraft(dialog.id)
      }

      setDialog(null)
    }

    return {
      newNotebook,
      renameNotebook,
      showImport,
      showHelp,
      closeDialog,
      confirmDialog,
    }
  })

  return {
    dialog,
    setDialog,
    newNotebook: handlers.newNotebook,
    renameNotebook: handlers.renameNotebook,
    showImport: handlers.showImport,
    showHelp: handlers.showHelp,
    closeDialog: handlers.closeDialog,
    confirmDialog: handlers.confirmDialog,
  }
}
