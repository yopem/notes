import type { StyleDesc } from "@gpuix/react"

import type { Palette } from "@/components/ui/theme"
import type { Preferences } from "@/features/settings/store"

import { nativeTheme } from "@/components/ui/theme"

export const editorRootStyle: StyleDesc = {
  display: "flex",
  flexDirection: "column",
  flexGrow: 1,
  minWidth: 0,
  minHeight: 0,
}

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
    footer: {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderTopWidth: 1,
      borderColor: color.border,
      paddingLeft: 16,
      paddingRight: 12,
      minHeight: 54,
      gap: 8,
    },
    saveState: {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    savedStatus: {
      color: color.mutedForeground,
      fontFamily: "Inter",
      fontSize: 11,
    },
    unsavedStatus: {
      color: color.destructive,
      fontFamily: "Inter",
      fontSize: 11,
    },
    noteActions: {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    trashBanner: {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: color.muted,
      padding: 12,
      gap: 8,
    },
    heading: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      paddingLeft: 40,
      paddingRight: 40,
      paddingTop: 32,
      paddingBottom: 22,
    },
    headingNarrow: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 32,
      paddingBottom: 22,
    },
    title: {
      color: color.foreground,
      fontFamily: "Inter",
      fontSize: 28,
      fontWeight: 600,
      lineHeight: 40,
      height: 48,
      width: "100%",
      backgroundColor: "transparent",
    },
    metadata: {
      display: "flex",
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap",
    },
    bodyLayout: {
      display: "flex",
      flexDirection: "row",
      flexGrow: 1,
      minHeight: 0,
      paddingLeft: 40,
      paddingRight: 40,
      paddingBottom: 24,
      gap: 28,
    },
    bodyLayoutNarrow: {
      display: "flex",
      flexDirection: "row",
      flexGrow: 1,
      minHeight: 0,
      paddingLeft: 24,
      paddingRight: 24,
      paddingBottom: 24,
      gap: 28,
    },
    preview: {
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      height: "100%",
      overflow: "scroll",
      scrollbarColor: color.border,
      borderLeftWidth: 0,
      borderColor: color.border,
      paddingLeft: 0,
    },
    splitPreview: {
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      height: "100%",
      overflow: "scroll",
      scrollbarColor: color.border,
      borderLeftWidth: 1,
      borderColor: color.border,
      paddingLeft: 28,
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

const themes = new WeakMap<Palette, ReturnType<typeof nativeTheme>>()

const textStyles = new WeakMap<
  Palette,
  WeakMap<Preferences, ReturnType<typeof createEditorTextStyles>>
>()

export function getEditorTheme(color: Palette) {
  const cached = themes.get(color)

  if (cached) return cached

  const theme = nativeTheme(color)
  themes.set(color, theme)

  return theme
}

function createEditorTextStyles(color: Palette, preferences: Preferences) {
  return {
    bodyText: {
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      height: "100%",
      color: color.foreground,
      fontFamily: preferences.monoFont ?? "IBM Plex Mono",
      fontSize: preferences.editorFontSize,
      lineHeight: preferences.editorFontSize * preferences.editorLineHeight,
      whiteSpace: preferences.wordWrap ? "normal" : "nowrap",
      backgroundColor: "transparent",
      selectionColor: color.selection,
    },
    previewText: {
      color: color.foreground,
      fontFamily: preferences.textFont ?? "Inter",
      fontSize: preferences.editorFontSize,
      lineHeight: preferences.editorFontSize * preferences.editorLineHeight,
    },
  } satisfies Record<string, StyleDesc>
}

export function getEditorTextStyles(color: Palette, preferences: Preferences) {
  let paletteStyles = textStyles.get(color)

  if (!paletteStyles) {
    paletteStyles = new WeakMap()
    textStyles.set(color, paletteStyles)
  }

  const cached = paletteStyles.get(preferences)

  if (cached) return cached

  const styles = createEditorTextStyles(color, preferences)
  paletteStyles.set(preferences, styles)

  return styles
}
