import type { Effect } from "effect"
import type { ReactNode } from "react"

import { createContext, use } from "react"

export type RunDesktopEffect = <Success, Failure>(
  program: Effect.Effect<Success, Failure>,
) => Success

const DesktopEffectContext = createContext<RunDesktopEffect | undefined>(
  undefined,
)

export function EffectBoundary({
  run,
  children,
}: {
  run: RunDesktopEffect
  children: ReactNode
}) {
  return <DesktopEffectContext value={run}>{children}</DesktopEffectContext>
}

export function useDesktopEffect() {
  const run = use(DesktopEffectContext)

  if (!run) throw new Error("Desktop Effect runtime is not available")

  return run
}
