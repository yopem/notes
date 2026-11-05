import type { Palette } from "@/components/ui/theme"
import type { EditorMode } from "@/features/editor/components/editor"
import type { Note } from "@/features/notes/store"
import type { Preferences } from "@/features/settings/store"

import {
  getEditorChangeHandlers,
  getEditorLinkHandler,
} from "@/features/editor/components/editor-events"
import {
  getEditorChromeStyles,
  getEditorTextStyles,
  getEditorTheme,
} from "@/features/editor/components/editor-styles"

export function EditorContent({
  color,
  preferences,
  note,
  mode,
  narrow,
  onChange,
  onLink,
}: {
  color: Palette
  preferences: Preferences
  note: Note
  mode: EditorMode
  narrow: boolean
  onChange: (patch: { title?: string; body?: string }) => void
  onLink: (url: string) => void
}) {
  const styles = getEditorChromeStyles(color)
  const textStyles = getEditorTextStyles(color, preferences)
  const changes = getEditorChangeHandlers(onChange)
  const split = mode === "split" && !narrow

  return (
    <div style={narrow ? styles.bodyLayoutNarrow : styles.bodyLayout}>
      {mode !== "preview" && (
        <textarea
          key={`${note.id}-body`}
          testId="note-body"
          aria-label="Note Markdown"
          value={note.body}
          placeholder="Start writing. Markdown is welcome."
          readOnly={Boolean(note.trashedAt)}
          theme={getEditorTheme(color)}
          onChange={changes.body}
          style={textStyles.bodyText}
        />
      )}
      {(mode === "preview" || split) && (
        <div
          testId="markdown-preview"
          style={split ? styles.splitPreview : styles.preview}
        >
          <markdown
            source={note.body || "*Nothing here yet.*"}
            theme={getEditorTheme(color)}
            onLinkClick={getEditorLinkHandler(onLink)}
            style={textStyles.previewText}
          />
        </div>
      )}
    </div>
  )
}
