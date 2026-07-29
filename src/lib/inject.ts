import type { PluginInput } from "@opencode-ai/plugin"

type Client = PluginInput["client"]

/**
 * Re-entry: push text into session as user prompt. promptAsync = fire-and-forget,
 * server queues if session busy. Failure -> warn, never throw.
 */
export async function inject(client: Client, sessionID: string, text: string): Promise<boolean> {
  try {
    await client.session.promptAsync({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text }] },
    })
    return true
  } catch (e) {
    console.warn(`[overclock] inject failed (session ${sessionID}): ${e}`)
    return false
  }
}

/** TUI toast, best-effort (headless server -> no TUI, swallow). */
export async function toast(
  client: Client,
  message: string,
  variant: "info" | "success" | "warning" | "error" = "info",
): Promise<void> {
  try {
    await client.tui.showToast({ body: { message, variant } })
  } catch {
    // no TUI attached
  }
}
