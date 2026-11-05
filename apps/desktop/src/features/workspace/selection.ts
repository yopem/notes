import type { Workspace } from "@/features/notes/store"
import type { View } from "@/features/workspace/components/sidebar"

export function getWorkspaceSelection({
  workspace,
  view,
  query,
  oldestFirst,
  activeNoteId,
}: {
  workspace: Workspace
  view: View
  query: string
  oldestFirst: boolean
  activeNoteId: string | null
}) {
  const search = query.trim().toLocaleLowerCase()

  const notes = workspace.notes
    .filter((note) => {
      if (view.kind === "trash" ? !note.trashedAt : note.trashedAt) return false

      if (view.kind === "pinned" && !note.pinned) return false

      if (view.kind === "notebook" && note.notebookId !== view.notebookId)
        return false

      return (
        !search ||
        `${note.title}\n${note.body}`.toLocaleLowerCase().includes(search)
      )
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (oldestFirst
          ? a.updatedAt.localeCompare(b.updatedAt)
          : b.updatedAt.localeCompare(a.updatedAt)) ||
        a.id.localeCompare(b.id),
    )

  // Keep the active editor even when saving changes its search or sort position.
  const selected =
    workspace.notes.find(
      (item) =>
        item.id === activeNoteId &&
        Boolean(item.trashedAt) === (view.kind === "trash"),
    ) ??
    notes.find((item) => item.id === workspace.selectedNoteId) ??
    notes[0]

  const title =
    view.kind === "notebook"
      ? (workspace.notebooks.find((item) => item.id === view.notebookId)
          ?.name ?? "Notebook")
      : { all: "All notes", pinned: "Pinned notes", trash: "Trash" }[view.kind]

  return { notes, selected, title }
}
