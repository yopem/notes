import type { PublicInstance, StyleDesc } from "@gpuix/react"
import type { ReactNode } from "react"

import { useGpuixRequired } from "@gpuix/react"
import { useState } from "react"

import { palettes } from "@/components/ui/theme"
import { registerFonts } from "@/native/fonts"

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
    height: "100%",
    padding: 24,
    backgroundColor: palettes.light.background,
  },
  error: {
    color: palettes.light.foreground,
    fontFamily: "Inter",
    fontSize: 16,
  },
} satisfies Record<string, StyleDesc>

export function FontStartup({ children }: { children: ReactNode }) {
  const renderer = useGpuixRequired()
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading")

  const [registerRoot] = useState(function createFontStartup() {
    function initialize(instance: PublicInstance | null) {
      if (!instance) return

      let mounted = true
      void registerFonts(renderer).then(
        function ready() {
          if (mounted) setState("ready")
        },
        function failed(cause: unknown) {
          if (!mounted) return
          console.error("Still Notes font setup failed.", cause)
          setState("failed")
        },
      )

      return function detach() {
        mounted = false
      }
    }

    return initialize
  })

  if (state === "ready") return children

  return (
    <div
      ref={registerRoot}
      testId="font-startup"
      role="application"
      aria-label="Still Notes font setup"
      style={styles.root}
    >
      {state === "failed" && (
        <text testId="font-startup-error" role="alert" style={styles.error}>
          Font setup did not finish. Restart Still Notes to try again.
        </text>
      )}
    </div>
  )
}
