import type { Palette } from "@/components/ui/theme"
import type { View } from "@/features/workspace/components/sidebar"

import { Button, Label } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import { workspaceStyles } from "@/features/workspace/components/workspace-styles"

export function WorkspaceEmpty({
  color,
  query,
  view,
  onNew,
}: {
  color: Palette
  query: string
  view: View
  onNew: () => void
}) {
  return (
    <div style={workspaceStyles.empty}>
      <Icon name="book" color={color.mutedForeground} size={36} />
      <Label color={color} size={20} weight={500}>
        {query
          ? "Nothing found. Something next?"
          : view.kind === "trash"
            ? "Nothing to let go of."
            : "A quiet place to begin."}
      </Label>
      <Label color={color} muted>
        {query
          ? "Search another thought, or start a new one."
          : "Select a note, or put your first thought on a page."}
      </Label>
      {view.kind !== "trash" && (
        <Button color={color} icon="plus" variant="primary" onClick={onNew}>
          Write a note
        </Button>
      )}
    </div>
  )
}
