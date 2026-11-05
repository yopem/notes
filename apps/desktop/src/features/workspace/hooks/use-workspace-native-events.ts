import type { KeyEvent, Props, PublicInstance } from "@gpuix/react"
import type { RefObject } from "react"

import { useGpuixRequired } from "@gpuix/react"
import { useLayoutEffect, useRef, useState } from "react"

import type { EditorMode } from "@/features/editor/components/editor"
import type { useWorkspaceNavigation } from "@/features/workspace/hooks/use-workspace-navigation"

const editorModeShortcuts: Record<"4" | "5" | "6", EditorMode> = {
  "4": "edit",
  "5": "split",
  "6": "preview",
}

interface WorkspaceNativeEvents {
  searchRef: RefObject<PublicInstance | null>
  importDrop: NonNullable<Props["onFileDrop"]>
  onKeyDown: (event: KeyEvent) => void
}

export function useWorkspaceNativeEvents({
  navigation,
  dialogOpen,
  settingsOpen,
  onSettings,
  onNew,
  onImport,
  onImportFiles,
  onRetry,
}: {
  navigation: ReturnType<typeof useWorkspaceNavigation>
  dialogOpen: boolean
  settingsOpen: boolean
  onSettings: () => void
  onNew: () => void
  onImport: () => void
  onImportFiles: (paths: string[]) => void
  onRetry: () => void
}): WorkspaceNativeEvents {
  const renderer = useGpuixRequired()
  const searchRef = useRef<PublicInstance>(null)

  const current = useRef({
    renderer,
    navigation,
    dialogOpen,
    settingsOpen,
    onSettings,
    onNew,
    onImport,
    onImportFiles,
    onRetry,
  })

  useLayoutEffect(
    function updateNativeTargets() {
      current.current = {
        renderer,
        navigation,
        dialogOpen,
        settingsOpen,
        onSettings,
        onNew,
        onImport,
        onImportFiles,
        onRetry,
      }
    },
    [
      renderer,
      navigation,
      dialogOpen,
      settingsOpen,
      onSettings,
      onNew,
      onImport,
      onImportFiles,
      onRetry,
    ],
  )

  const [handlers] = useState(function createNativeHandlers() {
    function importDrop(
      event: Parameters<NonNullable<Props["onFileDrop"]>>[0],
    ) {
      current.current.onImportFiles(event.paths ?? [])
    }

    function onKeyDown(event: KeyEvent) {
      const {
        renderer,
        navigation,
        dialogOpen,
        settingsOpen,
        onSettings,
        onNew,
        onImport,
        onRetry,
      } = current.current

      if (
        dialogOpen ||
        settingsOpen ||
        !(event.modifiers?.cmd || event.modifiers?.ctrl)
      )
        return
      const key = event.key?.toLowerCase()

      if (key === ",") {
        event.preventDefault()
        onSettings()
      } else if (key === "n") {
        event.preventDefault()
        onNew()
      } else if ((key === "p" && !event.modifiers?.shift) || key === "k") {
        event.preventDefault()
        navigation.showSearch()

        if (searchRef.current) renderer.focusElement?.(searchRef.current.id)
      } else if (key === "p" && event.modifiers?.shift) {
        event.preventDefault()
        navigation.togglePreview()
      } else if (key === "f" && event.modifiers?.shift) {
        event.preventDefault()
        navigation.toggleKeyboardFocus()
      } else if (key === "o") {
        event.preventDefault()
        onImport()
      } else if (key === "4" || key === "5" || key === "6") {
        event.preventDefault()
        navigation.setMode(editorModeShortcuts[key])
      } else if (key === "s") {
        event.preventDefault()
        onRetry()
      }
    }

    return { importDrop, onKeyDown }
  })

  return {
    searchRef,
    importDrop: handlers.importDrop,
    onKeyDown: handlers.onKeyDown,
  }
}
