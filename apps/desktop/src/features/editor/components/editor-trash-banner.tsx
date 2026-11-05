import type { Palette } from "@/components/ui/theme"

import { Button, Label } from "@/components/ui/controls"
import { getEditorChromeStyles } from "@/features/editor/components/editor-styles"

export function EditorTrashBanner({
  color,
  onRestore,
  onDelete,
}: {
  color: Palette
  onRestore: () => void
  onDelete: () => void
}) {
  const styles = getEditorChromeStyles(color)

  return (
    <div style={styles.trashBanner}>
      <Label color={color} size={12}>
        This note is in Trash.
      </Label>
      <Button
        color={color}
        icon="restore"
        testId="restore-note"
        onClick={onRestore}
      >
        Restore
      </Button>
      <Button color={color} variant="danger" onClick={onDelete}>
        Delete forever
      </Button>
    </div>
  )
}
