import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { Ui } from "../lib/ui.ts"
import {
  rollCompanion,
  describeCompanion,
  migrateSpecies,
  pickReaction,
  createReactionGate,
  cycleSpecies,
  switchSpecies,
  speciesDescription,
  SPECIES,
  type Companion,
  type Rarity,
  type ReactionKind,
  type Species,
} from "./companion.ts"
import { spriteFrame, withBubble, spriteHeight, SPRITE_WIDTH, type SpriteState } from "./sprites.ts"

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
  height?: number | string
  fg?: unknown
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
 * `enableJsx` throws when the host does not map @opentui/solid to its own instance;
 * the caller degrades to "no buddy" and the rest of the TUI plugin is unaffected.
 */
export async function registerBuddy(ui: Ui): Promise<void> {
  await ui.enableJsx()

  let companion = ui.api.kv?.get<Companion | undefined>(KV_KEY, undefined)
  if (!companion) {
    companion = rollCompanion()
    ui.api.kv?.set(KV_KEY, companion)
    ui.toast(`a buddy hatched: ${describeCompanion(companion)}`)
  } else {
    // A companion persisted under a species we have since retired has no art:
    // every lookup into ART would throw from inside the slot render, where the
    // caller's try/catch can't reach, and the buddy would silently not paint.
    // Write the migration back so it settles once instead of re-rolling per launch.
    const migrated = migrateSpecies(companion)
    if (migrated) {
      companion = migrated
      ui.api.kv?.set(KV_KEY, migrated)
      ui.toast(`${migrated.name} is a ${migrated.species} now`)
    }
  }
  let active: Companion = companion

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
    const frame = spriteFrame(active.species, currentState(now), tick)
    const text = withBubble(frame, now < bubbleUntil ? bubble : undefined)
    const wide = (ui.api.renderer?.width ?? 120) >= MIN_COLS
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

  function setCompanion(next: Companion, toastMessage?: string): void {
    active = next
    ui.api.kv?.set(KV_KEY, next)
    const currentTheme = ui.api.theme?.current
    for (const node of [...nodes]) {
      try {
        if (node.destroyed) {
          nodes.delete(node)
          continue
        }
        if (currentTheme) {
          node.fg = rarityColor(active.rarity, currentTheme)
        }
        node.height = spriteHeight(active.species)
      } catch {
        nodes.delete(node)
      }
    }
    react("pet")
    ui.toast(toastMessage ?? describeCompanion(active))
  }

  function openSwitchDialog(dialog?: unknown): void {
    const stack = (dialog ?? ui.api.ui?.dialog) as
      { replace(render: () => unknown, onClose?: () => void): void; clear(): void } | undefined
    const DialogSelect = ui.api.ui?.DialogSelect

    if (!stack || typeof stack.replace !== "function" || !DialogSelect) {
      const next = cycleSpecies(active.species)
      setCompanion(
        switchSpecies(active, next),
        `switched to ${next}: ${describeCompanion(switchSpecies(active, next))}`,
      )
      return
    }

    let closed = false
    const selectBuddy = (speciesOrRandom: string) => {
      if (closed) return
      closed = true
      try {
        stack.clear()
      } catch {
        // ignore
      }
      if (speciesOrRandom === "random") {
        const fresh = rollCompanion()
        setCompanion(fresh, `a new buddy hatched: ${describeCompanion(fresh)}`)
      } else if ((SPECIES as readonly string[]).includes(speciesOrRandom)) {
        const nextSpecies = speciesOrRandom as Species
        setCompanion(
          switchSpecies(active, nextSpecies),
          `switched to ${nextSpecies}: ${describeCompanion(switchSpecies(active, nextSpecies))}`,
        )
      }
    }

    const options = [
      ...SPECIES.map((species) => ({
        title: species,
        value: species,
        description: speciesDescription(species, species === active.species),
        onSelect: () => selectBuddy(species),
      })),
      {
        title: "random roll",
        value: "random",
        description: "hatch a brand new companion with new stats & rarity",
        onSelect: () => selectBuddy("random"),
      },
    ]

    try {
      stack.replace(() =>
        ui.node(DialogSelect as any, {
          title: "Switch Buddy",
          placeholder: "Select a species...",
          current: active.species,
          options,
          onSelect: (opt: { value: string }) => selectBuddy(opt.value),
        }),
      )
    } catch {
      const next = cycleSpecies(active.species)
      setCompanion(
        switchSpecies(active, next),
        `switched to ${next}: ${describeCompanion(switchSpecies(active, next))}`,
      )
    }
  }

  ui.every(TICK_MS, () => {
    tick++
    paint()
  })

  const gate = createReactionGate()
  ui.on("session.status", (event) => {
    lastActivity = Date.now()
    if (event.properties?.status?.type === "idle" && gate.tryFire()) react("done")
  })
  ui.on("session.error", () => {
    if (gate.tryFire()) react("error")
  })
  ui.on("permission.asked", () => {
    if (gate.tryFire()) react("permission")
  })
  ui.on("question.asked", () => {
    if (gate.tryFire()) react("question")
  })

  // The host renders the slot inside a one-line flex row next to the agent/model
  // text (prompt/index.tsx: justifyContent="space-between"). An in-flow sprite
  // would stretch that row -- and the whole prompt box -- by its full height, so
  // it goes out of flow instead: yoga places absolute children against their
  // parent's edges, and bottom/right pin the creature's last row onto the
  // agent/model line while it grows upward over the (usually empty) input area.
  const renderSprite = (theme: TuiThemeCurrent) =>
    ui.node("text", {
      position: "absolute",
      bottom: 0,
      right: 0,
      width: SPRITE_WIDTH,
      height: spriteHeight(active.species),
      content: spriteFrame(active.species, "idle", tick),
      fg: rarityColor(active.rarity, theme),
      selectable: false,
      visible: (ui.api.renderer?.width ?? 120) >= MIN_COLS,
      ref: (node: SpriteNode | undefined) => {
        if (node) nodes.add(node)
      },
    })

  ui.slots({
    home_prompt_right: (ctx) => renderSprite(ctx.theme.current),
    session_prompt_right: (ctx) => renderSprite(ctx.theme.current),
  })

  ui.command({
    title: "Overclock: Pet buddy",
    slash: "oc-buddy",
    aliases: ["buddy"],
    run: () => {
      react("pet")
      ui.toast(describeCompanion(active))
    },
  })

  ui.command({
    title: "Overclock: Switch buddy",
    slash: "oc-buddy-switch",
    aliases: ["buddy-switch"],
    run: (dialog) => {
      openSwitchDialog(dialog)
    },
  })

  ui.command({
    title: "Overclock: Cycle buddy",
    slash: "oc-buddy-cycle",
    aliases: ["buddy-cycle"],
    run: () => {
      const next = cycleSpecies(active.species)
      setCompanion(
        switchSpecies(active, next),
        `switched to ${next}: ${describeCompanion(switchSpecies(active, next))}`,
      )
    },
  })
}
