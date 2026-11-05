import type { StyleDesc } from "@gpuix/react"

import * as Dialog from "@gpuix/react/dialog"

import type { Palette } from "@/components/ui/theme"

import { Label } from "@/components/ui/controls"

const shortcuts = [
  ["New note", "N"],
  ["Search notes", "P / K"],
  ["Edit / preview", "Shift + P"],
  ["Focus mode", "Shift + F"],
  ["Import Markdown", "O"],
] as const

const styles = {
  content: { display: "flex", flexDirection: "column", gap: 20 },
  shortcuts: { display: "flex", flexDirection: "column", gap: 12 },
  shortcut: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
  },
} satisfies Record<string, StyleDesc>

export function DialogHelp({
  color,
  dataDirectory,
}: {
  color: Palette
  dataDirectory: string
}) {
  return (
    <div style={styles.content}>
      <Dialog.Description>
        <Label color={color} muted>
          Native Markdown notebooks. Your words stay on this device.
        </Label>
      </Dialog.Description>
      <div style={styles.shortcuts}>
        {shortcuts.map(([label, keys]) => (
          <div key={label} style={styles.shortcut}>
            <Label color={color}>{label}</Label>
            <Label color={color} muted>
              {process.platform === "darwin" ? "⌘" : "Ctrl"} + {keys}
            </Label>
          </div>
        ))}
      </div>
      <Label color={color} size={12} muted>
        Markdown supports headings, lists, tasks, tables, links and code. Drag
        .md files into the window to import them.
      </Label>
      <Label color={color} size={12} muted>
        {`Data location: ${dataDirectory}`}
      </Label>
      <Label color={color} size={12} muted>
        Still Notes · GPUix + Bun · Yopem UI design values.
      </Label>
    </div>
  )
}
