export interface AsyncCloseable {
  close(): Promise<void>
}

/**
 * Release optional TUI-side resources without leaving the CLI's launch
 * promise pending. Cleanup failures must not replace the native process's
 * exit code.
 */
export async function finishTuiChild(
  resource: AsyncCloseable | null,
  settle: () => void,
): Promise<void> {
  try {
    await resource?.close()
  } catch {
    // The child has already exited; resource cleanup is best-effort.
  } finally {
    settle()
  }
}
