import type { Effect } from "effect"

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

import type { Palette } from "@/components/ui/theme"

import { useDesktopEffect } from "@/components/effect-boundary"
import { Button, Label } from "@/components/ui/controls"

interface RecoverableWrite<Failure> {
  subscribe(listener: () => void): () => void
  getWriteRecoveryState(): "ready" | "uncertain"
  recoverWrite(): Effect.Effect<void, Failure>
}

const recoveryStyle = {
  display: "flex" as const,
  flexDirection: "column" as const,
  gap: 8,
  padding: 12,
}

const subjects = { workspace: "Workspace", settings: "Settings" }

export function WriteRecovery<Failure>({
  store,
  color,
  kind,
  onError,
}: {
  store: RecoverableWrite<Failure>
  color: Palette
  kind: "workspace" | "settings"
  onError: (message: string) => void
}) {
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getWriteRecoveryState(),
  )

  const run = useDesktopEffect()
  const current = useRef({ store, run, onError, kind })

  useLayoutEffect(
    function updateRecoveryTarget() {
      current.current = { store, run, onError, kind }
    },
    [store, run, onError, kind],
  )

  const [recover] = useState(function createRecoveryAction() {
    return function recoverPendingWrite() {
      const { store, run, onError, kind } = current.current

      try {
        run(store.recoverWrite())
        onError("")
      } catch (cause) {
        onError(
          cause instanceof Error ? cause.message : `Cannot recover ${kind}`,
        )
      }
    }
  })

  if (state === "ready") return null

  return (
    <div
      testId={`${kind}-write-recovery`}
      role="region"
      aria-label={`Pending ${kind} write`}
      style={recoveryStyle}
    >
      <Label color={color}>
        {subjects[kind]} data was replaced, but durability is not confirmed.
        Keep this app open and recover the pending write before making more
        changes. Recovery does not repeat the original save.
      </Label>
      <Button color={color} testId={`${kind}-recover-write`} onClick={recover}>
        {`Recover ${kind} write`}
      </Button>
    </div>
  )
}
