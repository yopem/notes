import type { StyleDesc } from "@gpuix/react"

import type { Palette } from "@/components/ui/theme"

import { inputStyle } from "@/components/ui/theme"

export const workspaceStyles = {
  row: {
    display: "flex",
    flexDirection: "row",
    flexGrow: 1,
    minHeight: 0,
  },
  content: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    paddingRight: 8,
    paddingBottom: 8,
    paddingLeft: 0,
  },
  contentWithoutSidebar: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    paddingRight: 8,
    paddingBottom: 8,
    paddingLeft: 8,
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 62,
    flexShrink: 0,
    gap: 12,
    paddingLeft: 8,
    paddingRight: 4,
  },
  brand: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actions: { display: "flex", flexDirection: "row", gap: 4 },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    flexGrow: 1,
    padding: 40,
  },
} satisfies Record<string, StyleDesc>

const paletteStyles = new WeakMap<
  Palette,
  ReturnType<typeof createWorkspaceStyles>
>()

function createWorkspaceStyles(color: Palette) {
  const search: StyleDesc = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: 340,
    paddingLeft: 12,
    paddingRight: 12,
    backgroundColor: color.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border,
    height: 36,
  }

  const notice: StyleDesc = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
    backgroundColor: color.background,
    borderRadius: 12,
    marginBottom: 8,
  }

  const noticeText: StyleDesc = {
    color: color.foreground,
    fontFamily: "Inter",
    fontSize: 12,
    flexGrow: 1,
  }

  return {
    root: {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: color.sidebar,
      color: color.foreground,
      fontFamily: "Inter",
    },
    search,
    narrowSearch: { ...search, width: "60%" },
    searchInput: {
      ...inputStyle(color),
      height: 32,
      padding: 0,
      borderWidth: 0,
      flexGrow: 1,
      minWidth: 0,
    },
    notice,
    noticeText,
    error: {
      ...notice,
      borderWidth: 1,
      borderColor: color.destructive,
    },
    errorText: { ...noticeText, color: color.destructive },
    panes: {
      display: "flex",
      flexDirection: "row",
      flexGrow: 1,
      minHeight: 0,
      backgroundColor: color.background,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: color.border,
      overflow: "hidden",
    },
  } satisfies Record<string, StyleDesc>
}

export function getWorkspaceStyles(color: Palette) {
  const cached = paletteStyles.get(color)

  if (cached) return cached
  const styles = createWorkspaceStyles(color)
  paletteStyles.set(color, styles)

  return styles
}
