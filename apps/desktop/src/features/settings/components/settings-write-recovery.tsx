import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

import type { Palette } from "@/components/ui/theme"
import type { SettingsStore } from "@/features/settings/store"

import { useDesktopEffect } from "@/components/effect-boundary"
import { Button, Label } from "@/components/ui/controls"

const recoveryStyle = {
  display: "flex" as const,
  flexDirection: "column" as const,
  gap: 8,
}

export function SettingsWriteRecovery({
  store,
  color,
  onError,
}: {
  store: SettingsStore
  color: Palette
  onError: (message: string) => void
}) {
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getWriteRecoveryState(),
  )

  const run = useDesktopEffect()
  const current = useRef({ store, run, onError })

  useLayoutEffect(
    function updateRecoveryTarget() {
      current.current = { store, run, onError }
    },
    [store, run, onError],
  )

  const [recover] = useState(function createRecoveryAction() {
    return function recoverSettingsWrite() {
      const { store, run, onError } = current.current

      try {
        run(store.recoverWrite())
        onError("")
      } catch (cause) {
        onError(
          cause instanceof Error ? cause.message : "Cannot recover settings",
        )
      }
    }
  })

  if (state === "ready") return null

  return (
    <div
      testId="settings-write-recovery"
      role="region"
      aria-label="Pending settings write"
      style={recoveryStyle}
    >
      <Label color={color}>
        Settings were replaced, but durability is not confirmed. Keep this app
        open and recover the pending write before making more changes.
      </Label>
      <Button color={color} testId="settings-recover-write" onClick={recover}>
        Recover settings write
      </Button>
    </div>
  )
}
