import type { StyleDesc } from "@gpuix/react"

import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"

import { Button } from "@/components/ui/controls"

const listStyle: StyleDesc = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
}

export function NotebookDestination({
  notebook,
  color,
  onSelect,
}: {
  notebook: { id: string; name: string }
  color: Palette
  onSelect: (id: string) => void
}) {
  const latest = useRef({ id: notebook.id, onSelect })

  useLayoutEffect(
    function updateDestination() {
      latest.current = { id: notebook.id, onSelect }
    },
    [notebook.id, onSelect],
  )

  const [selectNotebook] = useState(
    () =>
      function selectDestination() {
        latest.current.onSelect(latest.current.id)
      },
  )

  return (
    <Button
      color={color}
      icon="book"
      variant="outline"
      testId="move-notebook"
      onClick={selectNotebook}
    >
      {notebook.name}
    </Button>
  )
}

export function NotebookDestinations({
  notebooks,
  color,
  onSelect,
}: {
  notebooks: { id: string; name: string }[]
  color: Palette
  onSelect: (id: string) => void
}) {
  return (
    <div style={listStyle}>
      {notebooks.map((notebook) => (
        <NotebookDestination
          key={notebook.id}
          notebook={notebook}
          color={color}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
