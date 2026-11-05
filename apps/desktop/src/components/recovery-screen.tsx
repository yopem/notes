import type { StyleDesc } from "@gpuix/react"

import { palettes } from "@/components/ui/theme"

const color = palettes.light

const styles = {
  screen: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    width: "100%",
    height: "100%",
    padding: 48,
    backgroundColor: color.background,
  },
  heading: { color: color.foreground, fontSize: 28, fontWeight: 600 },
  error: { color: color.destructive, fontSize: 16 },
  directory: { color: color.foreground, fontSize: 14 },
  help: { color: color.mutedForeground, fontSize: 14 },
} satisfies Record<string, StyleDesc>

export function RecoveryScreen({
  error,
  directory,
}: {
  error: string
  directory: string
}) {
  return (
    <div style={styles.screen}>
      <text
        // GPUix exposes headings through AccessKit roles, not HTML tags.
        // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="heading"
        aria-level={1}
        style={styles.heading}
      >
        Your notes were not changed.
      </text>
      <text role="alert" style={styles.error}>
        {error}
      </text>
      <text style={styles.directory}>{`Data folder: ${directory}`}</text>
      <text style={styles.help}>
        If another Still Notes window is open, close it first. For a damaged
        workspace, copy the whole data folder before you restore workspace.json
        from its backup. Do not remove your only copy.
      </text>
    </div>
  )
}
