import type { EventPayload } from "@gpuix/react"

type NoteChange = (patch: { title?: string; body?: string }) => void

const changeHandlers = new WeakMap<
  NoteChange,
  ReturnType<typeof createChangeHandlers>
>()

const linkHandlers = new WeakMap<
  (url: string) => void,
  (event: EventPayload) => void
>()

function createChangeHandlers(onChange: NoteChange) {
  function title(event: EventPayload) {
    onChange({ title: event.value ?? "" })
  }

  function body(event: EventPayload) {
    onChange({ body: event.value ?? "" })
  }

  return { title, body }
}

export function getEditorChangeHandlers(onChange: NoteChange) {
  const cached = changeHandlers.get(onChange)

  if (cached) return cached

  const handlers = createChangeHandlers(onChange)
  changeHandlers.set(onChange, handlers)

  return handlers
}

export function getEditorLinkHandler(onLink: (url: string) => void) {
  const cached = linkHandlers.get(onLink)

  if (cached) return cached

  function openLink(event: EventPayload) {
    if (event.value) onLink(event.value)
  }

  linkHandlers.set(onLink, openLink)

  return openLink
}
