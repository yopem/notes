import type { Palette } from "@/components/ui/theme"

import { Button } from "@/components/ui/controls"
import { getWorkspaceStyles } from "@/features/workspace/components/workspace-styles"

export function WorkspaceMessages({
  color,
  error,
  notice,
  hasDrafts,
  retryDisabled,
  onRetry,
  onDismissError,
  onDismissNotice,
}: {
  color: Palette
  error: string
  notice: string
  hasDrafts: boolean
  retryDisabled: boolean
  onRetry: () => void
  onDismissError: () => void
  onDismissNotice: () => void
}) {
  const styles = getWorkspaceStyles(color)

  const draftWarning = retryDisabled
    ? "Unsaved edits remain in this window. Recover the pending write before retrying."
    : "Unsaved edits remain in this window. Retry before closing."

  return (
    <>
      {(error || hasDrafts) && (
        <div
          testId={hasDrafts ? "pending-drafts" : "command-error"}
          role="alert"
          style={styles.error}
        >
          <text
            style={styles.errorText}
          >{`${error}${error && hasDrafts ? " " : ""}${hasDrafts ? draftWarning : ""}`}</text>
          {hasDrafts ? (
            <Button
              color={color}
              testId="retry-save"
              disabled={retryDisabled}
              onClick={onRetry}
            >
              Retry save
            </Button>
          ) : (
            <Button
              color={color}
              icon="close"
              label="Dismiss error"
              onClick={onDismissError}
            />
          )}
        </div>
      )}
      {notice && (
        <div style={styles.notice}>
          <text testId="notice" role="status" style={styles.noticeText}>
            {notice}
          </text>
          <Button
            color={color}
            icon="close"
            label="Dismiss notice"
            onClick={onDismissNotice}
          />
        </div>
      )}
    </>
  )
}
