import type { InputProps, PublicInstance, StyleDesc } from "@gpuix/react"

import { useGpuixRequired } from "@gpuix/react"
import * as Dialog from "@gpuix/react/dialog"
import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"

import { Button, Label } from "@/components/ui/controls"
import { inputStyle } from "@/components/ui/theme"
import {
  DialogForm,
  getDialogFields,
} from "@/features/workspace/components/dialog/dialog-form"
import { DialogHelp } from "@/features/workspace/components/dialog/dialog-help"
import { NotebookDestinations } from "@/features/workspace/components/dialog/notebook-destinations"

export type DialogState =
  | { kind: "notebook" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "move"; id: string }
  | { kind: "import" }
  | { kind: "export"; id: string }
  | { kind: "delete"; id: string; title: string }
  | { kind: "help" }

const dialogTitles = {
  notebook: "New notebook",
  rename: "Rename notebook",
  move: "Move to notebook",
  import: "Import Markdown",
  export: "Export Markdown",
  delete: "Delete note permanently?",
  help: "Make room for your thoughts",
} satisfies Record<DialogState["kind"], string>

const dialogStyles = {
  backdrop: { backgroundColor: "#00000066" },
  heading: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  footer: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "end",
    gap: 8,
  },
} satisfies Record<string, StyleDesc>

const paletteStyles = new WeakMap<
  Palette,
  ReturnType<typeof createDialogStyles>
>()

function createDialogStyles(color: Palette) {
  return {
    popup: {
      display: "flex",
      flexDirection: "column",
      width: 480,
      maxWidth: "94%",
      maxHeight: "90%",
      overflow: "scroll",
      gap: 20,
      padding: 28,
      borderRadius: 16,
      backgroundColor: color.background,
      borderWidth: 1,
      borderColor: color.border,
    },
    error: {
      color: color.destructive,
      fontSize: 13,
      fontFamily: "Inter",
    },
    input: inputStyle(color),
  } satisfies Record<string, StyleDesc>
}

function getDialogStyles(color: Palette) {
  const cached = paletteStyles.get(color)

  if (cached) return cached
  const styles = createDialogStyles(color)

  paletteStyles.set(color, styles)

  return styles
}

function initialDialogValue(state: DialogState, dataDirectory: string) {
  if (state.kind === "rename") return state.name

  if (state.kind === "export") return dataDirectory

  return ""
}

function hasDialogInput(
  state: DialogState,
): state is Exclude<DialogState, { kind: "help" | "delete" | "move" }> {
  return (
    state.kind !== "help" && state.kind !== "delete" && state.kind !== "move"
  )
}

export function AppDialog({
  state,
  color,
  onClose,
  onConfirm,
  notebooks,
  dataDirectory,
}: {
  state: DialogState
  color: Palette
  onClose: () => void
  onConfirm: (value: string) => void
  notebooks: { id: string; name: string }[]
  dataDirectory: string
}) {
  const [value, setValue] = useState(() =>
    initialDialogValue(state, dataDirectory),
  )

  const [error, setError] = useState("")
  const inputRef = useRef<PublicInstance>(null)
  const renderer = useGpuixRequired()
  const title = dialogTitles[state.kind]
  const styles = getDialogStyles(color)
  const latest = useRef({ state, value, renderer, onClose, onConfirm })

  // Commit current bindings before native events use the stable handlers.
  useLayoutEffect(
    function updateDialogBindings() {
      latest.current = { state, value, renderer, onClose, onConfirm }
    },
    [state, value, renderer, onClose, onConfirm],
  )

  const [actions] = useState(() => {
    function confirm(nextValue = latest.current.value) {
      try {
        latest.current.onConfirm(nextValue)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    function submit() {
      confirm()
    }

    async function browse() {
      const current = latest.current

      try {
        const paths = await current.renderer.promptForPaths?.({
          files: current.state.kind === "import",
          directories: current.state.kind === "export",
          multiple: false,
          prompt: current.state.kind === "import" ? "Import" : "Export here",
        })

        if (paths?.[0]) setValue(paths[0])
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    function changeInput(
      event: Parameters<NonNullable<InputProps["onChange"]>>[0],
    ) {
      setValue(event.value ?? "")
    }

    function openChange(open: boolean) {
      if (!open) latest.current.onClose()
    }

    return { confirm, submit, browse, changeInput, openChange }
  })

  return (
    <Dialog.Root open onOpenChange={actions.openChange}>
      <Dialog.Portal>
        <Dialog.Backdrop style={dialogStyles.backdrop} />
        <Dialog.Popup
          initialFocus={hasDialogInput(state) ? inputRef : true}
          aria-label={title}
          style={styles.popup}
        >
          <div style={dialogStyles.heading}>
            <Dialog.Title>
              <Label color={color} size={20} weight={600}>
                {title}
              </Label>
            </Dialog.Title>
            <Button
              color={color}
              icon="close"
              label="Close dialog"
              testId="dialog-close"
              onClick={onClose}
            />
          </div>
          {state.kind === "help" && (
            <DialogHelp color={color} dataDirectory={dataDirectory} />
          )}
          {state.kind === "move" && (
            <NotebookDestinations
              notebooks={notebooks}
              color={color}
              onSelect={actions.confirm}
            />
          )}
          {state.kind === "delete" && (
            <Dialog.Description>
              <Label
                color={color}
              >{`“${state.title || "Untitled"}” will be removed from this workspace. This cannot be undone. Export a copy first if you need it.`}</Label>
            </Dialog.Description>
          )}
          {hasDialogInput(state) && (
            <DialogForm
              kind={state.kind}
              color={color}
              value={value}
              inputRef={inputRef}
              fieldStyle={styles.input}
              onChange={actions.changeInput}
              onSubmit={actions.submit}
              onBrowse={actions.browse}
            />
          )}
          {error && (
            <text
              // GPUix needs testId for native automation; this is not a DOM host.
              // eslint-disable-next-line react-doctor/no-unknown-property
              testId="dialog-error"
              role="alert"
              style={styles.error}
            >
              {error}
            </text>
          )}
          {state.kind !== "help" && state.kind !== "move" && (
            <div style={dialogStyles.footer}>
              <Button color={color} onClick={onClose}>
                Cancel
              </Button>
              <Button
                color={color}
                testId="dialog-confirm"
                variant={state.kind === "delete" ? "danger" : "primary"}
                onClick={actions.submit}
              >
                {state.kind === "delete"
                  ? "Delete permanently"
                  : getDialogFields(state.kind).action}
              </Button>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
