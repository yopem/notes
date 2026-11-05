import type { StyleDesc } from "@gpuix/react"

import type { Palette } from "@/components/ui/theme"

import { inputStyle } from "@/components/ui/theme"

export const taskStyles = {
  frame: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    gap: 12,
    padding: 16,
  },
  toolbar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  search: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  results: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    overflow: "scroll",
    gap: 8,
  },
  errors: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
  },
} satisfies Record<string, StyleDesc>

const paletteStyles = new WeakMap<
  Palette,
  Record<"heading" | "input" | "summary", StyleDesc>
>()

export function getTaskStyles(color: Palette) {
  const cached = paletteStyles.get(color)

  if (cached) return cached

  const styles: Record<"heading" | "input" | "summary", StyleDesc> = {
    heading: { color: color.foreground, fontSize: 20, fontWeight: 600 },
    input: { ...inputStyle(color), flexGrow: 1, minWidth: 0 },
    summary: {
      padding: 8,
      focusVisible: {
        outlineColor: color.ring,
        outlineWidth: 2,
        outlineOffset: -2,
      },
    },
  }

  paletteStyles.set(color, styles)

  return styles
}
