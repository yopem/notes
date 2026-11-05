import type { InputProps, PublicInstance, StyleDesc } from "@gpuix/react"
import type { ReactNode } from "react"

import { useGpuixRequired } from "@gpuix/react"
import * as Dialog from "@gpuix/react/dialog"
import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"
import type { useFolderPreview } from "@/features/vault/hooks/use-folder-preview"

import { Button, Label } from "@/components/ui/controls"
import { inputStyle } from "@/components/ui/theme"

const warning =
  "Note contents are read-only, but opening is not filesystem-read-only. It can create the selected folder, .still-notes/, .still-notes/state.json (using a temporary state file), inbox (for the inbox layout), quick, archive, trash and assets directories. Each open, read and refresh acquires .still-notes/vault.lock using a temporary lock file, then releases its lock. Metadata and directories remain. Pending recovery journals are refused, not repaired. No notes are imported or migrated. Links are shown as text and do not open."

const styles = {
  frame: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    gap: 12,
    padding: 16,
  },
  actions: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  scroll: {
    display: "flex",
    flexDirection: "column",
    overflow: "scroll",
    flexGrow: 1,
    minHeight: 0,
    gap: 8,
  },
  backdrop: { backgroundColor: "#00000080" },
} satisfies Record<string, StyleDesc>

type FolderPreviewState = ReturnType<typeof useFolderPreview>

export function FolderDisclosure({
  color,
  preview,
}: {
  color: Palette
  preview: FolderPreviewState
}) {
  const palette = getFolderStyles(color)
  const renderer = useGpuixRequired()
  const inputRef = useRef<PublicInstance>(null)
  const [path, setPath] = useState("")
  const current = useRef({ path, preview, renderer })

  useLayoutEffect(
    function updateDisclosureTarget() {
      current.current = { path, preview, renderer }
    },
    [path, preview, renderer],
  )

  const [actions] = useState(function createDisclosureHandlers() {
    function changePath(
      event: Parameters<NonNullable<InputProps["onChange"]>>[0],
    ) {
      current.current.path = event.value ?? ""
      setPath(current.current.path)
    }

    function openPath() {
      current.current.preview.openPath(current.current.path)

      if (inputRef.current)
        current.current.renderer.focusElement?.(inputRef.current.id)
    }

    return { changePath, openPath }
  })

  return (
    <Dialog.Root open={preview.disclosure} onOpenChange={preview.openChange}>
      <Dialog.Portal>
        <Dialog.Backdrop style={styles.backdrop} />
        <Dialog.Popup
          initialFocus={inputRef}
          aria-label="Open folder preview"
          style={palette.popup}
        >
          <Dialog.Title>
            <Label color={color} size={20} weight={600}>
              Open folder preview
            </Label>
          </Dialog.Title>
          <Dialog.Description>
            <text testId="folder-warning" style={palette.text}>
              {warning}
            </text>
          </Dialog.Description>
          <Label color={color} size={13} weight={500}>
            Absolute folder path
          </Label>
          <input
            ref={inputRef}
            testId="folder-path"
            aria-label="Absolute folder path"
            value={path}
            onChange={actions.changePath}
            onSubmit={actions.openPath}
            style={palette.input}
          />
          {preview.error && (
            <text testId="folder-open-error" role="alert" style={palette.error}>
              {preview.error}
            </text>
          )}
          <div style={styles.actions}>
            <Button
              color={color}
              testId="folder-cancel"
              disabled={preview.busy}
              onClick={preview.cancel}
            >
              Cancel
            </Button>
            <Button
              color={color}
              testId="folder-open"
              disabled={preview.busy}
              variant="primary"
              onClick={actions.openPath}
            >
              Open folder
            </Button>
            <Button
              color={color}
              testId="folder-choose"
              disabled={preview.busy}
              variant="outline"
              onClick={preview.chooseFolder}
            >
              {preview.busy ? "Choosing folder…" : "Accept and choose folder"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function FolderPreview({
  color,
  preview,
}: {
  color: Palette
  preview: FolderPreviewState
}) {
  const renderer = useGpuixRequired()
  const palette = getFolderStyles(color)
  const heading = useRef<PublicInstance>(null)
  const selected = preview.snapshot?.selected
  useLayoutEffect(
    function focusFolderResult() {
      if (heading.current) renderer.focusElement?.(heading.current.id)
    },
    [renderer, preview.snapshot, preview.error],
  )

  if (!preview.snapshot) return null

  return (
    <div
      testId="folder-preview"
      role="region"
      aria-label="Read-only folder preview"
      style={styles.frame}
    >
      <div style={styles.actions}>
        <Button color={color} testId="folder-back" onClick={preview.back}>
          Back to JSON workspace
        </Button>
        <Button color={color} testId="folder-refresh" onClick={preview.refresh}>
          Refresh notes
        </Button>
      </div>
      <div
        ref={heading}
        role="region"
        aria-label="Folder preview result"
        tabIndex={0}
      >
        <text role="heading" aria-level={1} style={palette.text}>
          Read-only folder preview
        </text>
        <Label color={color} weight={600}>
          Read-only note contents
        </Label>
        <Label color={color}>{preview.snapshot.root}</Label>
        <Label color={color} size={12}>
          Snapshot only. Refresh to read changes. Links stay as text. App
          metadata and directories can remain after closing.
        </Label>
      </div>
      {preview.error ? (
        <text testId="folder-error" role="alert" style={palette.error}>
          {`${preview.error} Refresh to retry or go back. No note contents were changed.`}
        </text>
      ) : (
        <div style={styles.scroll}>
          {preview.snapshot.notes.length === 0 && (
            <text testId="folder-empty" style={palette.text}>
              No Markdown notes found.
            </text>
          )}
          {preview.snapshot.notes.map((note) => (
            <FolderNote
              key={note.id}
              color={color}
              id={note.id}
              selected={selected?.id === note.id}
              onSelect={preview.selectNote}
            />
          ))}
          {selected ? (
            <div
              role="region"
              aria-label={`Read-only Markdown source: ${selected.path}`}
              tabIndex={0}
            >
              <Label color={color} weight={600}>
                {selected.path}
              </Label>
              <text testId="folder-note-content" style={palette.text}>
                {selected.body}
              </text>
            </div>
          ) : preview.snapshot.notes.length > 0 ? (
            <Label color={color}>
              Select a Markdown note to read its source.
            </Label>
          ) : null}
        </div>
      )}
    </div>
  )
}

const paletteStyles = new WeakMap<
  Palette,
  ReturnType<typeof createFolderStyles>
>()

function createFolderStyles(color: Palette) {
  return {
    popup: {
      ...styles.frame,
      flexGrow: 0,
      width: 560,
      maxWidth: "95%",
      maxHeight: "90%",
      overflow: "scroll",
      backgroundColor: color.background,
      borderRadius: 12,
    },
    text: { color: color.foreground },
    input: inputStyle(color),
    error: { color: color.destructive },
  } satisfies Record<string, StyleDesc>
}

function getFolderStyles(color: Palette) {
  const cached = paletteStyles.get(color)

  if (cached) return cached

  const next = createFolderStyles(color)
  paletteStyles.set(color, next)

  return next
}

export function FolderNote({
  color,
  id,
  selected,
  onSelect,
}: {
  color: Palette
  id: string
  selected: boolean
  onSelect: (id: string) => void
}) {
  const current = useRef({ id, onSelect })
  useLayoutEffect(
    function updateNoteTarget() {
      current.current = { id, onSelect }
    },
    [id, onSelect],
  )

  const [select] = useState(function createNoteHandler() {
    return function select() {
      current.current.onSelect(current.current.id)
    }
  })

  return (
    <Button
      color={color}
      testId={`folder-note-${id}`}
      label={`Read ${id}`}
      variant={selected ? "outline" : "ghost"}
      onClick={select}
    >
      {id}
    </Button>
  )
}

export function FolderWorkspace({
  color,
  preview,
  rootStyle,
  children,
}: {
  color: Palette
  preview: FolderPreviewState
  rootStyle: StyleDesc
  children: ReactNode
}) {
  if (!preview.snapshot) return children

  return (
    <div
      testId="app"
      role="application"
      aria-label="Still Notes folder preview"
      style={rootStyle}
    >
      <FolderPreview color={color} preview={preview} />
    </div>
  )
}
