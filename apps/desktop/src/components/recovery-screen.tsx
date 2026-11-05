import { palettes } from "@/components/ui/theme"

export function RecoveryScreen({
  error,
  directory,
}: {
  error: string
  directory: string
}) {
  const color = palettes.light

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        width: "100%",
        height: "100%",
        padding: 48,
        backgroundColor: color.background,
      }}
    >
      <text
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- GPUix has no semantic HTML host elements.
        role="heading"
        aria-level={1}
        style={{ color: color.foreground, fontSize: 28, fontWeight: 600 }}
      >
        Your notes were not changed.
      </text>
      <text role="alert" style={{ color: color.destructive, fontSize: 16 }}>
        {error}
      </text>
      <text
        style={{ color: color.foreground, fontSize: 14 }}
      >{`Data folder: ${directory}`}</text>
      <text style={{ color: color.mutedForeground, fontSize: 14 }}>
        If another Still Notes window is open, close it first. For a damaged
        workspace, copy the whole data folder before you restore workspace.json
        from its backup. Do not remove your only copy.
      </text>
    </div>
  )
}
