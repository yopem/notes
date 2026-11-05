import { useLayoutEffect, useRef, useState } from "react"

import type { Note, NotesStore } from "@/features/notes/store"

import { useDesktopEffect } from "@/components/effect-boundary"
import { attempt } from "@/features/workspace/attempt"

interface Draft {
  title?: string
  body?: string
}

const draftNotes = new WeakMap<Draft, WeakMap<Note, Note>>()

function getDraftNote(note: Note | undefined, draft: Draft | undefined) {
  if (!note || !draft) return note
  let notes = draftNotes.get(draft)

  if (!notes) {
    notes = new WeakMap<Note, Note>()
    draftNotes.set(draft, notes)
  }

  const cached = notes.get(note)

  if (cached) return cached
  const edited = { ...note, ...draft }
  notes.set(note, edited)

  return edited
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const pending = useRef(drafts)
  const current = useRef({ store, note, onActiveNote, onError, run })

  useLayoutEffect(
    function updateDraftTarget() {
      current.current = { store, note, onActiveNote, onError, run }
    },
    [store, note, onActiveNote, onError, run],
  )

  const [handlers] = useState(function createDraftHandlers() {
    function discardDraft(id: string) {
      const next = { ...pending.current }
      delete next[id]
      pending.current = next
      setDrafts(next)
    }

    function changeNote(patch: Draft) {
      const { store, note, onActiveNote, onError, run } = current.current

      if (!note || note.trashedAt) return
      const id = note.id
      const draft = { ...pending.current[id], ...patch }
      onActiveNote(id)
      pending.current = { ...pending.current, [id]: draft }
      setDrafts(pending.current)
      onError(
        attempt(() => {
          run(store.updateNote(id, draft))
          discardDraft(id)
        }),
      )
    }

    function retry() {
      const { store, onError, run } = current.current
      onError(
        attempt(() => {
          for (const [id, draft] of Object.entries(pending.current))
            run(store.updateNote(id, draft))
          pending.current = {}
          setDrafts(pending.current)
        }),
      )
    }

    return { changeNote, retry, discardDraft }
  })

  return {
    drafts,
    note: getDraftNote(note, note ? drafts[note.id] : undefined),
    hasDrafts: Object.keys(drafts).length > 0,
    changeNote: handlers.changeNote,
    retry: handlers.retry,
    discardDraft: handlers.discardDraft,
  }
}
