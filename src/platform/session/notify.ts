import type { PluginInput } from "@opencode-ai/plugin"

type Client = PluginInput["client"]

export type ToastVariant = "info" | "success" | "warning" | "error"

/**
 * TUI toast notification, best-effort (swallows errors in headless/no-TUI environments).
 */
export async function toast(
  client: Client,
  message: string,
  variant: ToastVariant = "info",
): Promise<void> {
  try {
    await client.tui.showToast({ body: { message, variant } })
  } catch {
    // no TUI attached or client lacks tui surface
  }
}
