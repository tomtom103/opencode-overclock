import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { rollCompanion, describeCompanion, migrateSpecies } from "./companion.ts"
import type { Companion, Rarity } from "./types.ts"
import { spriteFrame, withBubble, spriteHeight, SPRITE_WIDTH, type SpriteState } from "./sprites.ts"
import { pickReaction, createReactionGate, type ReactionKind } from "./reactions.ts"

const KV_KEY = "buddy.companion"
/** Below this terminal width the buddy hides rather than crowd the prompt. */
const MIN_COLS = 100
const TICK_MS = 500
const BUBBLE_MS = 6000
const SLEEP_AFTER_MS = 120_000

/**
 * Structural view of the opentui TextRenderable we mutate. The buddy is updated
 * imperatively through refs instead of solid signals on purpose: reactivity would
 * silently break if the plugin's solid-js instance ever differs from the host's,
 * while direct property sets on host-created nodes always work.
 */
interface SpriteNode {
  content: string
  visible: boolean
  destroyed?: boolean
}

function rarityColor(rarity: Rarity, theme: TuiThemeCurrent): unknown {
  switch (rarity) {
    case "legendary":
      return theme.accent
    case "rare":
      return theme.info
    case "uncommon":
      return theme.success
    default:
      return theme.textMuted
  }
}

/**
 * Hatch (or load) the companion and mount it in the prompt-right slots.
 * Dynamic import of @opentui/solid: if the host doesn't map the specifier to its
 * own instance, this throws and the caller degrades to "no buddy" -- it must
 * never take the rest of the TUI plugin down.
 */
export async function registerBuddy(api: TuiPluginApi): Promise<void> {
  const { jsx } = (await import("@opentui/solid/jsx-runtime")) as unknown as {
    jsx: (type: string, props?: Record<string, unknown> | null) => unknown
  }

  let companion = api.kv.get<Companion | undefined>(KV_KEY, undefined)
  if (!companion) {
    companion = rollCompanion()
    api.kv.set(KV_KEY, companion)
    api.ui.toast({ message: `a buddy hatched: ${describeCompanion(companion)}` })
  } else {
    // A companion persisted under a species we have since retired has no art:
    // every lookup into ART would throw from inside the slot render, where the
    // caller's try/catch can't reach, and the buddy would silently not paint.
    // Write the migration back so it settles once instead of re-rolling per launch.
    const migrated = migrateSpecies(companion)
    if (migrated) {
      companion = migrated
      api.kv.set(KV_KEY, migrated)
      api.ui.toast({ message: `${migrated.name} is a ${migrated.species} now` })
    }
  }
  const hatched: Companion = companion

  // One ticker drives every mounted node (home + session slots).
  const nodes = new Set<SpriteNode>()
  let tick = 0
  let bubble: string | undefined
  let bubbleUntil = 0
  let faceOverride: SpriteState | undefined
  let lastActivity = Date.now()

  function currentState(now: number): SpriteState {
    if (faceOverride && now < bubbleUntil) return faceOverride
    if (now - lastActivity > SLEEP_AFTER_MS) return "sleep"
    return "idle"
  }

  function paint(): void {
    const now = Date.now()
    const frame = spriteFrame(hatched.species, currentState(now), tick)
    const text = withBubble(frame, now < bubbleUntil ? bubble : undefined)
    const wide = api.renderer.width >= MIN_COLS
    for (const node of [...nodes]) {
      try {
        if (node.destroyed) {
          nodes.delete(node)
          continue
        }
        node.visible = wide
        if (wide) node.content = text
      } catch {
        nodes.delete(node)
      }
    }
  }

  function react(kind: ReactionKind): void {
    const reaction = pickReaction(kind)
    bubble = reaction.text
    bubbleUntil = Date.now() + BUBBLE_MS
    faceOverride = reaction.state
    lastActivity = Date.now()
    paint()
  }

  const timer = setInterval(() => {
    tick++
    paint()
  }, TICK_MS)
  api.lifecycle.onDispose(async () => clearInterval(timer))

  const gate = createReactionGate()
  const unsubs = [
    api.event.on("session.status", (event) => {
      lastActivity = Date.now()
      if (event.properties.status.type === "idle" && gate.tryFire()) react("done")
    }),
    api.event.on("session.error", () => {
      if (gate.tryFire()) react("error")
    }),
    api.event.on("permission.asked", () => {
      if (gate.tryFire()) react("permission")
    }),
    api.event.on("question.asked", () => {
      if (gate.tryFire()) react("question")
    }),
  ]
  for (const unsub of unsubs) api.lifecycle.onDispose(async () => unsub())

  // The host renders the slot inside a one-line flex row next to the agent/model
  // text (prompt/index.tsx: justifyContent="space-between"). An in-flow sprite
  // would stretch that row -- and the whole prompt box -- by its full height, so
  // it goes out of flow instead: yoga places absolute children against their
  // parent's edges, and bottom/right pin the creature's last row onto the
  // agent/model line while it grows upward over the (usually empty) input area.
  const renderSprite = (theme: TuiThemeCurrent) =>
    jsx("text", {
      position: "absolute",
      bottom: 0,
      right: 0,
      width: SPRITE_WIDTH,
      height: spriteHeight(hatched.species),
      content: spriteFrame(hatched.species, "idle", tick),
      fg: rarityColor(hatched.rarity, theme),
      selectable: false,
      visible: api.renderer.width >= MIN_COLS,
      ref: (node: SpriteNode | undefined) => {
        if (node) nodes.add(node)
      },
    })

  // register returns the assigned plugin id, not a disposer -- the host owns
  // slot cleanup when the TUI plugin deactivates.
  api.slots.register({
    slots: {
      home_prompt_right: (ctx) => renderSprite(ctx.theme.current),
      session_prompt_right: (ctx) => renderSprite(ctx.theme.current),
    },
  })

  try {
    const uncommand = api.command?.register(() => [
      {
        title: "Overclock: Pet buddy",
        value: "overclock.buddy",
        slash: { name: "oc-buddy" },
        onSelect: async () => {
          react("pet")
          api.ui.toast({ message: describeCompanion(hatched) })
        },
      },
    ])
    if (uncommand) api.lifecycle.onDispose(async () => uncommand())
  } catch (e) {
    console.warn(`[overclock-tui] /oc-buddy command registration failed: ${e}`)
  }
}
