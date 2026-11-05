import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

import type { Note, NotesStore } from "@/features/notes/store"

import { useDesktopEffect } from "@/components/effect-boundary"
import { getDraftNote, getDraftState } from "@/features/notes/draft-state"
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
  const run = useDesktopEffect()
  const state = getDraftState(store)
  const drafts = useSyncExternalStore(state.subscribe, state.getSnapshot)
  const current = useRef({ store, note, onActiveNote, onError, run })

  useLayoutEffect(
    function updateDraftTarget() {
      current.current = { store, note, onActiveNote, onError, run }
    },
    [store, note, onActiveNote, onError, run],
  )

  const [handlers] = useState(function createDraftHandlers() {
    function changeNote(patch: Draft) {
      const { store, note, onActiveNote, onError, run } = current.current

      if (!note) return
      const state = getDraftState(store)
      const live = state.getCurrentNote(note.id)

      if (!live || live.trashedAt) return
      const draft = { ...state.getSnapshot()[note.id], ...patch }
      onActiveNote(note.id)
      state.setDraft(note.id, draft)
      onError(
        attempt(() => {
          run(store.updateNote(note.id, draft))
          state.discardDraft(note.id)
        }),
      )
    }

    function retry() {
      const { store, onError, run } = current.current
      const state = getDraftState(store)
      onError(
        attempt(() => {
          for (const [id, draft] of Object.entries(state.getSnapshot())) {
            run(store.updateNote(id, draft))
            state.discardDraft(id)
          }
        }),
      )
    }

    return { changeNote, retry }
  })

  return {
    drafts,
    note: getDraftNote(note, note ? drafts[note.id] : undefined),
    hasDrafts: Object.keys(drafts).length > 0,
    getCurrentNote: state.getCurrentNote,
    hasPendingDrafts: state.hasPendingDrafts,
    discardDraft: state.discardDraft,
    reconcile: state.reconcile,
    changeNote: handlers.changeNote,
    retry: handlers.retry,
  }
}
