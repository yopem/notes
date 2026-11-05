import type { InputProps, PublicInstance } from "@gpuix/react"
import type { RefObject } from "react"

import { useLayoutEffect, useRef, useState } from "react"

import type { Palette } from "@/components/ui/theme"
import type { SettingsStore } from "@/features/settings/store"

import { Button, Label } from "@/components/ui/controls"
import { Icon } from "@/components/ui/icons"
import { attempt } from "@/features/workspace/attempt"
import {
  getWorkspaceStyles,
  workspaceStyles,
} from "@/features/workspace/components/workspace-styles"

export function WorkspaceHeader({
  color,
  theme,
  settings,
  narrow,
  showSidebar,
  searchRef,
  query,
  onSearch,
  onShowNotebooks,
  onImport,
  onSettings,
  onHelp,
  onError,
}: {
  color: Palette
  theme: "light" | "dark"
  settings: SettingsStore
  narrow: boolean
  showSidebar: boolean
  searchRef: RefObject<PublicInstance | null>
  query: string
  onSearch: NonNullable<InputProps["onChange"]>
  onShowNotebooks: () => void
  onImport: () => void
  onSettings: () => void
  onHelp: () => void
  onError: (message: string) => void
}) {
  const styles = getWorkspaceStyles(color)
  const current = useRef({ theme, settings, onError })
  const [toggleTheme] = useState(function createThemeHandler() {
    return function toggleTheme() {
      const { theme, settings, onError } = current.current
      onError(
        attempt(() =>
          settings.update({ themeMode: theme === "light" ? "dark" : "light" }),
        ),
      )
    }
  })

  useLayoutEffect(
    function updateThemeTarget() {
      current.current = { theme, settings, onError }
    },
    [theme, settings, onError],
  )

  return (
    <div style={workspaceStyles.header}>
      <div style={workspaceStyles.brand}>
        {!showSidebar && (
          <Button
            color={color}
            icon="menu"
            label="Show notebooks"
            testId="show-notebooks"
            onClick={onShowNotebooks}
          />
        )}
        {!showSidebar && !narrow && (
          <Label color={color} weight={600}>
            Still Notes
          </Label>
        )}
      </div>
      <div style={narrow ? styles.narrowSearch : styles.search}>
        <Icon name="search" color={color.mutedForeground} size={15} />
        <input
          ref={searchRef}
          testId="search"
          aria-label="Search notes in current view"
          value={query}
          placeholder="Search your notes…"
          onChange={onSearch}
          style={styles.searchInput}
        />
        {!narrow && (
          <Label color={color} size={11} muted>
            {process.platform === "darwin" ? "⌘ P" : "Ctrl P"}
          </Label>
        )}
      </div>
      <div style={workspaceStyles.actions}>
        {!showSidebar && (
          <Button
            color={color}
            icon="upload"
            label="Import Markdown"
            testId="import"
            onClick={onImport}
          />
        )}
        <Button
          color={color}
          icon={theme === "light" ? "moon" : "sun"}
          label={theme === "light" ? "Use dark theme" : "Use light theme"}
          testId="theme-toggle"
          onClick={toggleTheme}
        />
        <Button
          color={color}
          icon="settings"
          label="Settings"
          testId="settings-open"
          onClick={onSettings}
        />
        <Button
          color={color}
          icon="help"
          label="Help and keyboard shortcuts"
          testId="help"
          onClick={onHelp}
        />
      </div>
    </div>
  )
}
