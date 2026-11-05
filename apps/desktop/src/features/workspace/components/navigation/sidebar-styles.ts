import type { StyleDesc } from "@gpuix/react"

import type { Palette } from "@/components/ui/theme"

export const sidebarStyles = {
  frame: {
    display: "flex",
    flexDirection: "column",
    width: 220,
    flexShrink: 0,
    padding: 12,
    gap: 8,
  },
  brand: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 12,
    height: 44,
    marginBottom: 12,
  },
  spacer: { height: 4 },
  notebooksHeading: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 12,
    marginTop: 24,
  },
  notebookRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
  },
  notebookLink: { flexGrow: 1, minWidth: 0 },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 12,
    marginTop: 12,
  },
  device: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
} satisfies Record<string, StyleDesc>

const notebookListStyles = new WeakMap<Palette, StyleDesc>()

export function getNotebookListStyle(color: Palette) {
  const cached = notebookListStyles.get(color)

  if (cached) {
    return cached
  }

  const style: StyleDesc = {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    overflow: "scroll",
    scrollbarColor: color.border,
    gap: 4,
  }

  notebookListStyles.set(color, style)

  return style
}
