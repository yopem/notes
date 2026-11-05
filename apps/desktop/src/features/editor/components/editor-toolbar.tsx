import type { Palette } from "@/components/ui/theme"
import type { EditorMode } from "@/features/editor/components/editor"

import { Button } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import { getEditorChromeStyles } from "@/features/editor/components/editor-styles"

const modeActions = new WeakMap<
  (mode: EditorMode) => void,
  ReturnType<typeof createModeActions>
>()

function createModeActions(onMode: (mode: EditorMode) => void) {
  function edit() {
    onMode("edit")
  }

  function preview() {
    onMode("preview")
  }

  function split() {
    onMode("split")
  }

  return { edit, preview, split }
}

function getModeActions(onMode: (mode: EditorMode) => void) {
  const cached = modeActions.get(onMode)

  if (cached) return cached

  const actions = createModeActions(onMode)
  modeActions.set(onMode, actions)

  return actions
}

export function EditorToolbar({
  color,
  notebookName,
  mode,
  onMode,
  narrow,
  focusMode,
  onFocusMode,
  onBack,
}: {
  color: Palette
  notebookName: string
  mode: EditorMode
  onMode: (mode: EditorMode) => void
  narrow: boolean
  focusMode: boolean
  onFocusMode: () => void
  onBack: () => void
}) {
  const styles = getEditorChromeStyles(color)
  const split = mode === "split" && !narrow

  const actions = getModeActions(onMode)

  return (
    <div style={styles.toolbar}>
      <div style={styles.notebook}>
        {narrow && (
          <Button
            color={color}
            icon="chevron"
            label="Back to notes"
            testId="editor-back"
            onClick={onBack}
          />
        )}
        <Icon name="book" color={color.mutedForeground} size={15} />
        <text style={styles.notebookName}>{notebookName}</text>
      </div>
      <div style={styles.modeActions}>
        <Button
          color={color}
          icon={mode === "preview" ? "edit" : "eye"}
          testId="preview-toggle"
          label={mode === "preview" ? "Edit note" : "Preview Markdown"}
          onClick={mode === "preview" ? actions.edit : actions.preview}
        >
          {narrow ? undefined : mode === "preview" ? "Edit" : "Preview"}
        </Button>
        {!narrow && (
          <Button
            color={color}
            label="Split editor and preview"
            onClick={split ? actions.edit : actions.split}
          >
            {split ? "Single" : "Split"}
          </Button>
        )}
        <Button
          color={color}
          icon="menu"
          label={focusMode ? "Leave focus mode" : "Focus mode"}
          onClick={onFocusMode}
        />
      </div>
    </div>
  )
}
