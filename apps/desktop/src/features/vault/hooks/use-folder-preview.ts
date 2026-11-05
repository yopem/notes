import { useGpuixRequired } from "@gpuix/react"
import { Effect } from "effect"
import { useLayoutEffect, useRef, useState } from "react"

import type { NotesStore } from "@/features/notes/store"
import type { SettingsStore } from "@/features/settings/store"
import type { NoteRecord } from "@/features/vault/service"

import { useDesktopEffect } from "@/components/effect-boundary"
import { VaultResource } from "@/features/vault/service"
import { attempt } from "@/features/workspace/attempt"

interface FolderSnapshot {
  root: string
  notes: NoteRecord[]
  selected: NoteRecord | undefined
}

export function useFolderPreview({
  hasDrafts,
  store,
  settings,
  onError,
}: {
  hasDrafts: boolean
  store: NotesStore
  settings: SettingsStore
  onError: (message: string) => void
}) {
  const renderer = useGpuixRequired()
  const run = useDesktopEffect()
  const [disclosure, setDisclosure] = useState(false)
  const [snapshot, setSnapshot] = useState<FolderSnapshot>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const picking = useRef(false)

  const current = useRef({
    hasDrafts,
    store,
    settings,
    onError,
    renderer,
    run,
    snapshot,
  })

  useLayoutEffect(
    function updatePreviewTarget() {
      current.current = {
        hasDrafts,
        store,
        settings,
        onError,
        renderer,
        run,
        snapshot,
      }
    },
    [hasDrafts, store, settings, onError, renderer, run, snapshot],
  )

  const [handlers] = useState(function createPreviewHandlers() {
    function canEnter() {
      const { hasDrafts, store, settings, onError } = current.current

      if (
        !hasDrafts &&
        store.getWriteRecoveryState() === "ready" &&
        settings.getWriteRecoveryState() === "ready"
      )
        return true

      onError(
        "Folder preview is blocked. Save or export all JSON drafts and finish workspace and settings write recovery first. Your drafts and recovery controls remain here.",
      )

      return false
    }

    function showDisclosure() {
      if (!canEnter()) return

      setError("")
      setDisclosure(true)
    }

    function cancel() {
      if (picking.current) return

      setDisclosure(false)
      setError("")
    }

    function readSnapshot(root: string, selectedId?: string) {
      return current.current.run(
        Effect.gen(function* () {
          const vault = yield* VaultResource
          const notes = yield* vault.listNotes()
          const id = notes.find((note) => note.id === selectedId)?.id
          const selected = id ? yield* vault.readNote(id) : undefined

          return { root: vault.root, notes, selected }
        }).pipe(
          Effect.provide(VaultResource.layer(root, { readOnlyPreview: true })),
          Effect.scoped,
        ),
      )
    }

    async function pickFolder() {
      if (picking.current || !canEnter()) return

      picking.current = true
      setBusy(true)

      try {
        const { renderer } = current.current

        if (!renderer.promptForPaths)
          throw new Error("The native folder picker is not available.")

        const paths = await renderer.promptForPaths({
          files: false,
          directories: true,
          multiple: false,
          prompt: "Preview folder",
        })

        if (!paths?.[0] || !canEnter()) {
          setDisclosure(false)
          setError("")

          return
        }

        const next = readSnapshot(paths[0])
        setSnapshot(next)
        setDisclosure(false)
        setError("")
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        picking.current = false
        setBusy(false)
      }
    }

    function chooseFolder() {
      void pickFolder()
    }

    function openChange(open: boolean) {
      if (!open) cancel()
    }

    function refresh() {
      const { snapshot } = current.current

      if (!snapshot) return

      setError(
        attempt(() => {
          setSnapshot(readSnapshot(snapshot.root, snapshot.selected?.id))
        }),
      )
    }

    function selectNote(id: string) {
      const { snapshot } = current.current

      if (!snapshot) return

      setError(
        attempt(() => {
          setSnapshot(readSnapshot(snapshot.root, id))
        }),
      )
    }

    function back() {
      setSnapshot(undefined)
      setError("")
    }

    return {
      showDisclosure,
      cancel,
      chooseFolder,
      openChange,
      refresh,
      selectNote,
      back,
    }
  })

  return { disclosure, snapshot, error, busy, ...handlers }
}
