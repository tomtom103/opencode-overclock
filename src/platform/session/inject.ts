import type { PluginInput } from "@opencode-ai/plugin"
import { toast } from "./notify.ts"

export { toast, type ToastVariant } from "./notify.ts"

type Client = PluginInput["client"]
export type ModelRef = { providerID: string; modelID: string }
export type SessionContext = {
  model?: ModelRef
  agent?: string
}

export interface InjectOptions {
  noReply?: boolean
}

/**
 * Session's active context = model of last assistant message and most recent agent name.
 * Without model, promptAsync falls back to config default model -> injected turns
 * run on the wrong model (and pile up QUEUED behind a hung default).
 * Preserving agent ensures turns continue under the active persona.
 */
export async function sessionContext(client: Client, sessionID: string): Promise<SessionContext> {
  try {
    const res = await client.session.messages({ path: { id: sessionID } })
    const msgs = res.data ?? []
    let model: ModelRef | undefined
    let agent: string | undefined

    for (let i = msgs.length - 1; i >= 0; i--) {
      const info = msgs[i]?.info as
        { role?: string; modelID?: string; providerID?: string; agent?: string } | undefined
      if (!model && info?.role === "assistant" && info.modelID && info.providerID) {
        model = { providerID: info.providerID, modelID: info.modelID }
      }
      if (!agent && info?.agent) {
        agent = info.agent
      }
      if (model && agent) break
    }
    return { model, agent }
  } catch (e) {
    console.warn(`[overclock] sessionContext lookup failed (${sessionID}): ${e}`)
    return {}
  }
}

/**
 * Session's active model = model of last assistant message.
 */
export async function sessionModel(client: Client, sessionID: string): Promise<ModelRef | undefined> {
  const ctx = await sessionContext(client, sessionID)
  return ctx.model
}

/**
 * Re-entry: push text into session as user prompt, on the session's own model and agent.
 * promptAsync = fire-and-forget, server queues if busy. Failure -> warn, never throw.
 */
export async function inject(
  client: Client,
  sessionID: string,
  text: string,
  options?: InjectOptions,
): Promise<boolean> {
  try {
    const ctx = await sessionContext(client, sessionID)
    const res = await (client.session.promptAsync as any)({
      path: { id: sessionID },
      throwOnError: true,
      body: {
        parts: [{ type: "text", text }],
        ...(ctx.model ? { model: ctx.model } : {}),
        ...(ctx.agent ? { agent: ctx.agent } : {}),
        ...(options?.noReply ? { noReply: true } : {}),
      },
    })
    if (res && typeof res === "object" && "error" in res && (res as any).error) {
      console.warn(
        `[overclock] inject failed (session ${sessionID}): ${JSON.stringify((res as any).error)}`,
      )
      return false
    }
    return true
  } catch (e) {
    console.warn(`[overclock] inject failed (session ${sessionID}): ${e}`)
    return false
  }
}
