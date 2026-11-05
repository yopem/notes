import { type PublicInstance, useGpuixRequired } from "@gpuix/react"
import * as Dialog from "@gpuix/react/dialog"
import { useRef, useState } from "react"

import { Button, Label } from "@/components/ui/controls"
import { inputStyle, type Palette } from "@/components/ui/theme"
import { DialogHelp } from "@/features/workspace/components/dialog/dialog-help"

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

const dialogFields = {
  import: {
    label: "Markdown file path",
    description:
      "Copies a UTF-8 .md or .markdown file. Original file stays unchanged. Maximum size: 2 MB.",
    action: "Import note",
  },
  export: {
    label: "Destination folder",
    description: "Writes a Markdown copy. Existing files are never replaced.",
    action: "Export note",
  },
  notebook: {
    label: "Notebook name",
    description: "Keep related thoughts together. Names can contain spaces.",
    action: "Save notebook",
  },
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
  const [value, setValue] = useState(() => {
    if (state.kind === "rename") return state.name

    if (state.kind === "export") return dataDirectory

    return ""
  })

  const [error, setError] = useState("")
  const inputRef = useRef<PublicInstance>(null)
  const renderer = useGpuixRequired()

  const title = dialogTitles[state.kind]

  const fields =
    dialogFields[
      state.kind === "import" || state.kind === "export"
        ? state.kind
        : "notebook"
    ]

  function confirm(nextValue = value) {
    try {
      onConfirm(nextValue)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function browse() {
    try {
      const paths = await renderer.promptForPaths?.({
        files: state.kind === "import",
        directories: state.kind === "export",
        multiple: false,
        prompt: state.kind === "import" ? "Import" : "Export here",
      })

      if (paths?.[0]) setValue(paths[0])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop style={{ backgroundColor: "#00000066" }} />
        <Dialog.Popup
          initialFocus={
            state.kind === "help" ||
            state.kind === "delete" ||
            state.kind === "move"
              ? true
              : inputRef
          }
          aria-label={title}
          style={{
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
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {notebooks.map((notebook) => (
                <Button
                  key={notebook.id}
                  color={color}
                  icon="book"
                  variant="outline"
                  testId="move-notebook"
                  onClick={() => confirm(notebook.id)}
                >
                  {notebook.name}
                </Button>
              ))}
            </div>
          )}
          {state.kind === "delete" && (
            <Dialog.Description>
              <Label
                color={color}
              >{`“${state.title || "Untitled"}” will be removed from this workspace. This cannot be undone. Export a copy first if you need it.`}</Label>
            </Dialog.Description>
          )}
          {state.kind !== "help" &&
            state.kind !== "move" &&
            state.kind !== "delete" && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <Label color={color} size={13} weight={500}>
                  {fields.label}
                </Label>
                <input
                  ref={inputRef}
                  testId="dialog-input"
                  aria-label={fields.label}
                  value={value}
                  onChange={(event) => setValue(event.value ?? "")}
                  onSubmit={() => confirm()}
                  style={inputStyle(color)}
                />
                {(state.kind === "import" || state.kind === "export") && (
                  <Button
                    color={color}
                    icon="folder"
                    variant="outline"
                    onClick={browse}
                  >
                    Browse…
                  </Button>
                )}
                <Dialog.Description>
                  <Label color={color} size={12} muted>
                    {fields.description}
                  </Label>
                </Dialog.Description>
              </div>
            )}
          {error && (
            <text
              testId="dialog-error"
              role="alert"
              style={{
                color: color.destructive,
                fontSize: 13,
                fontFamily: "Inter",
              }}
            >
              {error}
            </text>
          )}
          {state.kind !== "help" && state.kind !== "move" && (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "end",
                gap: 8,
              }}
            >
              <Button color={color} onClick={onClose}>
                Cancel
              </Button>
              <Button
                color={color}
                testId="dialog-confirm"
                variant={state.kind === "delete" ? "danger" : "primary"}
                onClick={() => confirm()}
              >
                {state.kind === "delete" ? "Delete permanently" : fields.action}
              </Button>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
