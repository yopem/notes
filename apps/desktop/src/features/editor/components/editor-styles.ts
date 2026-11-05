import type { StyleDesc } from "@gpuix/react"

import type { Palette } from "@/components/ui/theme"

const chromeStyles = new WeakMap<
  Palette,
  ReturnType<typeof createEditorChromeStyles>
>()

function createEditorChromeStyles(color: Palette) {
  return {
    toolbar: {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 14,
      borderBottomWidth: 1,
      borderColor: color.border,
      gap: 8,
    },
    notebook: {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minWidth: 0,
    },
    notebookName: {
      color: color.mutedForeground,
      fontFamily: "Inter",
      fontSize: 12,
      lineClamp: 1,
    },
    modeActions: {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
  } satisfies Record<string, StyleDesc>
}

export function getEditorChromeStyles(color: Palette) {
  const cached = chromeStyles.get(color)

  if (cached) return cached

  const styles = createEditorChromeStyles(color)
  chromeStyles.set(color, styles)

  return styles
}
