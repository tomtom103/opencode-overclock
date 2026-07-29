import { tool, type PluginInput } from "@opencode-ai/plugin"
import type { FeatureModule } from "../types.ts"

const z = tool.schema

type Client = PluginInput["client"]

interface MessagePart {
  type: string
  text?: string
}

interface MessageEntry {
  info: {
    id: string
    role: string
    time?: { created?: number }
  }
  parts: MessagePart[]
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim()

/** Exported for tests: revert/unrevert/list core, decoupled from plugin ctx. */
export interface Checkpoints {
  list(sessionID: string): Promise<string>
  revert(sessionID: string, messageID: string): Promise<string>
  restore(sessionID: string): Promise<string>
}

export function createCheckpoints(client: Client): Checkpoints {
  async function list(sessionID: string): Promise<string> {
    try {
      const res = await client.session.messages({ path: { id: sessionID } })
      const msgs = ((res.data ?? []) as MessageEntry[]).filter((m) => m.info.role === "user")
      if (!msgs.length) return "no checkpoints"
      return msgs
        .map((m) => {
          const time = m.info.time?.created
            ? new Date(m.info.time.created).toISOString()
            : "unknown time"
          const text = m.parts.find((p) => p.type === "text" && typeof p.text === "string")?.text ?? ""
          const preview = collapse(text).slice(0, 60)
          return `${m.info.id} ${time} ${preview}`
        })
        .join("\n")
    } catch (e) {
      console.warn(`[overclock] checkpoints: list failed (session ${sessionID}): ${e}`)
      return `error listing checkpoints: ${e}`
    }
  }

  async function revert(sessionID: string, messageID: string): Promise<string> {
    try {
      await client.session.revert({ path: { id: sessionID }, body: { messageID } })
      return `reverted session ${sessionID} to before message ${messageID}`
    } catch (e) {
      console.warn(
        `[overclock] checkpoints: revert failed (session ${sessionID}, message ${messageID}): ${e}`,
      )
      return `error reverting checkpoint: ${e}`
    }
  }

  async function restore(sessionID: string): Promise<string> {
    try {
      await client.session.unrevert({ path: { id: sessionID } })
      return `restored session ${sessionID} to latest (undo revert)`
    } catch (e) {
      console.warn(`[overclock] checkpoints: restore failed (session ${sessionID}): ${e}`)
      return `error restoring checkpoint: ${e}`
    }
  }

  return { list, revert, restore }
}

/**
 * Shadow-git revert tools (map doc: "Checkpoints — none gap"). Wraps native
 * session.revert/unrevert around each user message as a revert point.
 */
export const checkpoints: FeatureModule = {
  name: "checkpoints",
  tools: ["checkpoint_list", "checkpoint_revert", "checkpoint_restore"],
  defaultEnabled: true,
  requires: ["session.revert", "session.unrevert", "session.messages"],
  async init(ctx) {
    const core = createCheckpoints(ctx.client)

    return {
      tool: {
        checkpoint_list: tool({
          description:
            "List user messages of a session as revert points: messageID, time, first 60 chars. Most recent last.",
          args: { sessionID: z.string().optional().describe("default: current session") },
          async execute(args, tctx) {
            return core.list(args.sessionID ?? tctx.sessionID)
          },
        }),
        checkpoint_revert: tool({
          description:
            "Revert session files + conversation back to before the given message (shadow-git, reversible via checkpoint_restore). Requires user permission.",
          args: {
            messageID: z.string(),
            sessionID: z.string().optional().describe("default: current session"),
          },
          async execute(args, tctx) {
            const sessionID = args.sessionID ?? tctx.sessionID
            await tctx.ask({
              permission: "checkpoint_revert",
              patterns: [args.messageID],
              always: [],
              metadata: { sessionID, messageID: args.messageID },
            })
            return core.revert(sessionID, args.messageID)
          },
        }),
        checkpoint_restore: tool({
          description: "Undo the most recent checkpoint_revert for a session.",
          args: { sessionID: z.string().optional().describe("default: current session") },
          async execute(args, tctx) {
            return core.restore(args.sessionID ?? tctx.sessionID)
          },
        }),
      },
    }
  },
}
