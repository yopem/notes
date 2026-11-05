import { spawn } from "node:child_process"

import { attempt } from "@/features/workspace/attempt"

const linkCommands = new Map([
  ["darwin", "open"],
  ["win32", "rundll32"],
])

export function openNoteLink(
  value: string,
  onError: (message: string) => void,
) {
  onError(
    attempt(() => {
      const url = new URL(value)

      if (
        url.protocol !== "https:" &&
        url.protocol !== "http:" &&
        url.protocol !== "mailto:"
      )
        throw new Error(
          "Only http, https and mailto links can open outside Still Notes.",
        )

      const command = linkCommands.get(process.platform) ?? "xdg-open"

      const args =
        process.platform === "win32"
          ? ["url.dll,FileProtocolHandler", url.href]
          : [url.href]

      const child = spawn(command, args, {
        stdio: "ignore",
        detached: true,
        shell: false,
      })

      child.on("error", (cause) =>
        onError(`Could not open link: ${cause.message}`),
      )
      child.on("exit", (code) => {
        if (code) onError(`Link opener exited with code ${code}.`)
      })
      child.unref()
    }),
  )
}
