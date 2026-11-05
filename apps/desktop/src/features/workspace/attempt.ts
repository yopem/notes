export function attempt(action: () => void) {
  try {
    action()

    return ""
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
