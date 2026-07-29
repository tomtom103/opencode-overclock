import type { SpriteState } from "./sprites.ts"

export type ReactionKind = "done" | "error" | "permission" | "question" | "pet"

/** Speech-bubble line + which face the sprite pulls while it shows. */
export interface Reaction {
  text: string
  state: SpriteState
}

// Lines render into the sprite's 12-col effect row -- keep every line <= 12 chars.
const POOLS: Record<ReactionKind, { lines: string[]; state: SpriteState }> = {
  done: { lines: ["done!", "all set.", "ship it.", "*stretch*"], state: "idle" },
  error: { lines: ["uh oh.", "*winces*", "yikes."], state: "alarmed" },
  permission: { lines: ["can we?", "*peeks*", "please?"], state: "curious" },
  question: { lines: ["your call.", "hmm?", "*head tilt*"], state: "curious" },
  pet: { lines: ["<3", "*purrs*", "hi!!", "missed you."], state: "pet" },
}

/** Pure: pick a random line for a reaction kind. */
export function pickReaction(kind: ReactionKind, rng: () => number = Math.random): Reaction {
  const pool = POOLS[kind]
  return { text: pool.lines[Math.floor(rng() * pool.lines.length)]!, state: pool.state }
}

export interface ReactionGate {
  /** True + arms the cooldown if enough time has passed since the last fire. */
  tryFire(now?: number): boolean
}

/** Debounce for event-driven reactions -- keeps a busy session from spamming the bubble. */
export function createReactionGate(cooldownMs = 8000): ReactionGate {
  let last = -Infinity
  return {
    tryFire(now: number = Date.now()): boolean {
      if (now - last < cooldownMs) return false
      last = now
      return true
    },
  }
}
