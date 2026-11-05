import type { StyleDesc } from "@gpuix/react"

import { inputStyle, type Palette } from "@/components/ui/theme"

export const settingsStyles = {
  backdrop: { backgroundColor: "#00000066" },
  panel: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    gap: 16,
  },
  heading: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tabs: {
    display: "flex",
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    overflow: "scroll",
    height: 420,
    minHeight: 180,
    gap: 4,
  },
  preferenceHeading: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  options: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  editor: { display: "flex", flexDirection: "row", gap: 8 },
} satisfies Record<string, StyleDesc>

const paletteStyles = new WeakMap<
  Palette,
  ReturnType<typeof createPaletteStyles>
>()

function createPaletteStyles(color: Palette) {
  return {
    popup: {
      display: "flex",
      flexDirection: "column",
      width: 820,
      maxWidth: "94%",
      maxHeight: "90%",
      padding: 24,
      gap: 16,
      borderRadius: 16,
      backgroundColor: color.background,
      borderWidth: 1,
      borderColor: color.border,
    },
    preference: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      paddingTop: 12,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderColor: color.border,
    },
    currentValue: { color: color.mutedForeground, fontSize: 12 },
    error: { color: color.destructive, fontSize: 12 },
    search: inputStyle(color),
    input: { ...inputStyle(color), flexGrow: 1, minWidth: 0 },
  } satisfies Record<string, StyleDesc>
}

export function getSettingsStyles(color: Palette) {
  const cached = paletteStyles.get(color)

  if (cached) return cached
  const styles = createPaletteStyles(color)
  paletteStyles.set(color, styles)

  return styles
}
