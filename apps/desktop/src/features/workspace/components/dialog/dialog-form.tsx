import type { InputProps, PublicInstance, StyleDesc } from "@gpuix/react"
import type { RefObject } from "react"

import * as Dialog from "@gpuix/react/dialog"

import type { Palette } from "@/components/ui/theme"

import { Button, Label } from "@/components/ui/controls"

export type DialogFormKind = "notebook" | "rename" | "import" | "export"

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

const formStyle: StyleDesc = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
}

export function getDialogFields(kind: DialogFormKind) {
  return dialogFields[kind === "rename" ? "notebook" : kind]
}

export function DialogForm({
  kind,
  color,
  value,
  inputRef,
  fieldStyle,
  onChange,
  onSubmit,
  onBrowse,
}: {
  kind: DialogFormKind
  color: Palette
  value: string
  inputRef: RefObject<PublicInstance | null>
  fieldStyle: StyleDesc
  onChange: NonNullable<InputProps["onChange"]>
  onSubmit: () => void
  onBrowse: () => Promise<void>
}) {
  const fields = getDialogFields(kind)

  return (
    <div style={formStyle}>
      <Label color={color} size={13} weight={500}>
        {fields.label}
      </Label>
      <input
        ref={inputRef}
        // GPUix needs testId for native automation; this is not a DOM host.
        // eslint-disable-next-line react-doctor/no-unknown-property
        testId="dialog-input"
        aria-label={fields.label}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        style={fieldStyle}
      />
      {(kind === "import" || kind === "export") && (
        <Button
          color={color}
          icon="folder"
          variant="outline"
          onClick={onBrowse}
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
  )
}
