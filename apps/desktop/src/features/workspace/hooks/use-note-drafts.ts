import { useLayoutEffect, useRef, useState } from "react"

import type { Note, NotesStore } from "@/features/notes/store"

import { attempt } from "@/features/workspace/attempt"

interface Draft {
  title?: string
  body?: string
}

export function useNoteDrafts({
  store,
  note,
  onActiveNote,
  onError,
}: {
  store: NotesStore
  note: Note | undefined
  onActiveNote: (id: string) => void
  onError: (message: string) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const pending = useRef(drafts)
  const current = useRef({ store, note, onActiveNote, onError })

  useLayoutEffect(
    function updateDraftTarget() {
      current.current = { store, note, onActiveNote, onError }
    },
    [store, note, onActiveNote, onError],
  )

  const [handlers] = useState(function createDraftHandlers() {
    function discardDraft(id: string) {
      const next = { ...pending.current }
      delete next[id]
      pending.current = next
      setDrafts(next)
    }

    function changeNote(patch: Draft) {
      const { store, note, onActiveNote, onError } = current.current
      if (!note || note.trashedAt) return
      const id = note.id
      const draft = { ...pending.current[id], ...patch }
      onActiveNote(id)
      pending.current = { ...pending.current, [id]: draft }
      setDrafts(pending.current)
      onError(
        attempt(() => {
          store.updateNote(id, draft)
          discardDraft(id)
        }),
      )
    }

    function retry() {
      const { store, onError } = current.current
      onError(
        attempt(() => {
          for (const [id, draft] of Object.entries(pending.current))
            store.updateNote(id, draft)
          pending.current = {}
          setDrafts(pending.current)
        }),
      )
    }

    return { changeNote, retry, discardDraft }
  })

  return {
    drafts,
    hasDrafts: Object.keys(drafts).length > 0,
    changeNote: handlers.changeNote,
    retry: handlers.retry,
    discardDraft: handlers.discardDraft,
  }
}
