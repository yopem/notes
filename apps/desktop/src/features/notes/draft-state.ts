import type { Note, NotesStore } from "@/features/notes/store"

export interface Draft {
  readonly title?: string
  readonly body?: string
}

type Drafts = Readonly<Record<string, Draft>>

interface DraftState {
  getSnapshot(this: void): Drafts
  subscribe(this: void, listener: () => void): () => void
  getCurrentNote(this: void, id: string): Note | undefined
  hasPendingDrafts(this: void): boolean
  setDraft(this: void, id: string, draft: Draft): void
  discardDraft(this: void, id: string): void
  reconcile(this: void): void
}

declare global {
  var stillNotesDraftStates: WeakMap<NotesStore, DraftState> | undefined
}

const draftNotes = new WeakMap<Draft, WeakMap<Note, Note>>()

export function getDraftNote(note: Note | undefined, draft: Draft | undefined) {
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

export function getDraftState(store: NotesStore) {
  const states = (globalThis.stillNotesDraftStates ??= new WeakMap())
  const existing = states.get(store)

  if (existing) return existing
  let drafts: Drafts = Object.freeze({})
  const listeners = new Set<() => void>()

  function publish(next: Drafts) {
    drafts = Object.freeze(next)

    for (const listener of listeners) listener()
  }

  function getSnapshot() {
    return drafts
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)

    return function unsubscribe() {
      listeners.delete(listener)
    }
  }

  function getCurrentNote(id: string) {
    return getDraftNote(
      store.getSnapshot().notes.find((note) => note.id === id),
      drafts[id],
    )
  }

  function hasPendingDrafts() {
    return Object.keys(drafts).length > 0
  }

  function setDraft(id: string, draft: Draft) {
    publish({ ...drafts, [id]: Object.freeze({ ...draft }) })
  }

  function discardDraft(id: string) {
    if (!drafts[id]) return
    const next = { ...drafts }
    delete next[id]
    publish(next)
  }

  function reconcile() {
    const next = { ...drafts }
    let changed = false

    for (const [id, draft] of Object.entries(drafts)) {
      const note = store.getSnapshot().notes.find((item) => item.id === id)

      if (!note) continue
      const remaining = { ...draft }

      if (remaining.title !== undefined && remaining.title === note.title) {
        delete remaining.title
        changed = true
      }

      if (remaining.body !== undefined && remaining.body === note.body) {
        delete remaining.body
        changed = true
      }

      if (remaining.title === undefined && remaining.body === undefined)
        delete next[id]
      else next[id] = Object.freeze(remaining)
    }

    if (changed) publish(next)
  }

  const state = {
    getSnapshot,
    subscribe,
    getCurrentNote,
    hasPendingDrafts,
    setDraft,
    discardDraft,
    reconcile,
  }

  states.set(store, state)

  return state
}
