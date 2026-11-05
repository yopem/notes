import type { StyleDesc } from "@gpuix/react"

import type { Palette } from "@/components/ui/theme"

export const noteListStyles = {
  header: {
    padding: 20,
    paddingBottom: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  headingRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  countRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  titleRow: {
    display: "flex",
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  empty: {
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
} satisfies Record<string, StyleDesc>

type PaletteStyles = Record<
  | "frame"
  | "compactFrame"
  | "heading"
  | "count"
  | "list"
  | "row"
  | "selectedRow"
  | "title"
  | "preview",
  StyleDesc
>

const paletteStyles = new WeakMap<Palette, PaletteStyles>()

export function getNoteListStyles(color: Palette) {
  const cached = paletteStyles.get(color)

  if (cached) {
    return cached
  }

  const row: StyleDesc = {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    padding: 14,
    marginBottom: 4,
    minHeight: 112,
    borderRadius: 12,
    backgroundColor: "transparent",
    cursor: "pointer",
    hover: { backgroundColor: color.muted },
    focusVisible: {
      outlineWidth: 2,
      outlineColor: color.ring,
      outlineOffset: -2,
    },
  }

  const frame: StyleDesc = {
    display: "flex",
    flexDirection: "column",
    width: 286,
    minWidth: 220,
    flexShrink: 0,
    borderRightWidth: 1,
    borderColor: color.border,
  }

  const styles: PaletteStyles = {
    frame,
    compactFrame: {
      ...frame,
      width: "100%",
      minWidth: 0,
      flexGrow: 1,
      flexShrink: 1,
      borderRightWidth: 0,
    },
    heading: {
      color: color.foreground,
      fontFamily: "Inter",
      fontSize: 20,
      fontWeight: 600,
      lineClamp: 1,
    },
    count: {
      color: color.mutedForeground,
      fontFamily: "Inter",
      fontSize: 12,
    },
    list: {
      flexGrow: 1,
      minHeight: 0,
      padding: 8,
      scrollbarColor: color.border,
    },
    row,
    selectedRow: { ...row, backgroundColor: color.accent },
    title: {
      color: color.foreground,
      fontFamily: "Inter",
      fontSize: 14,
      fontWeight: 500,
      lineClamp: 1,
      flexGrow: 1,
      minWidth: 0,
    },
    preview: {
      color: color.mutedForeground,
      fontFamily: "Inter",
      fontSize: 12,
      lineHeight: 18,
      lineClamp: 2,
    },
  }

  paletteStyles.set(color, styles)

  return styles
}
