import type { PluginInput } from "@opencode-ai/plugin"

type Client = PluginInput["client"]
type ModelRef = { providerID: string; modelID: string }

/**
 * Session's active model = model of last assistant message.
 * Without this, promptAsync falls back to config default model -> injected turns
 * run on the wrong model (and pile up QUEUED behind a hung default).
 */
export async function sessionModel(client: Client, sessionID: string): Promise<ModelRef | undefined> {
  try {
    const res = await client.session.messages({ path: { id: sessionID } })
    const msgs = res.data ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const info = msgs[i]?.info
      if (info?.role === "assistant" && info.modelID) {
        return { providerID: info.providerID, modelID: info.modelID }
      }
    }
  } catch (e) {
    console.warn(`[overclock] sessionModel lookup failed (${sessionID}): ${e}`)
  }
  return undefined
}

/**
 * Re-entry: push text into session as user prompt, on the session's own model.
 * promptAsync = fire-and-forget, server queues if busy. Failure -> warn, never throw.
 */
export async function inject(client: Client, sessionID: string, text: string): Promise<boolean> {
  try {
    const model = await sessionModel(client, sessionID)
    await client.session.promptAsync({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text }], ...(model ? { model } : {}) },
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
