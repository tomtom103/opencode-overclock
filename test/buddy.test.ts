import { describe, expect, test } from "bun:test"
import {
  mulberry32,
  rollCompanion,
  describeCompanion,
  migrateSpecies,
  pickReaction,
  createReactionGate,
  cycleSpecies,
  switchSpecies,
  speciesDescription,
  SPECIES_DESCRIPTIONS,
  SPECIES,
  type Companion,
  type Species,
  type ReactionKind,
} from "../src/buddy/companion.ts"
import {
  spriteFrame,
  withBubble,
  spriteHeight,
  SPRITE_WIDTH,
  SPRITE_MAX_HEIGHT,
  type SpriteState,
} from "../src/buddy/sprites.ts"
import { registerBuddy } from "../src/buddy/tui.ts"
import type { Ui } from "../src/lib/ui.ts"

const STATES: SpriteState[] = ["idle", "pet", "alarmed", "curious", "sleep"]
const KINDS: ReactionKind[] = ["done", "error", "permission", "question", "pet"]

describe("rollCompanion", () => {
  test("deterministic under a seeded rng", () => {
    const a = rollCompanion(mulberry32(42), 1000)
    const b = rollCompanion(mulberry32(42), 1000)
    expect(a).toEqual(b)
  })

  test("different seeds can roll different companions", () => {
    const rolls = new Set<string>()
    for (let seed = 0; seed < 50; seed++) {
      const c = rollCompanion(mulberry32(seed), 0)
      rolls.add(`${c.species}/${c.rarity}/${c.name}`)
    }
    expect(rolls.size).toBeGreaterThan(1)
  })

  test("fields are always within range", () => {
    for (let seed = 0; seed < 200; seed++) {
      const c = rollCompanion(mulberry32(seed), 5)
      expect(SPECIES).toContain(c.species)
      expect(["common", "uncommon", "rare", "legendary"]).toContain(c.rarity)
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.hatchedAt).toBe(5)
      for (const stat of Object.values(c.stats)) {
        expect(stat).toBeGreaterThanOrEqual(1)
        expect(stat).toBeLessThanOrEqual(10)
      }
    }
  })

  test("describeCompanion mentions name, rarity, species, stats", () => {
    const c = rollCompanion(mulberry32(7), 0)
    const line = describeCompanion(c)
    expect(line).toContain(c.name)
    expect(line).toContain(c.rarity)
    expect(line).toContain(c.species)
    expect(line).toContain(`snark ${c.stats.snark}`)
  })
})

describe("migrateSpecies", () => {
  /** A companion persisted before its species was retired from the sprite sheet. */
  const retired = {
    species: "dragon",
    rarity: "legendary",
    name: "Ember",
    stats: { patience: 3, chaos: 9, wisdom: 4, snark: 7 },
    hatchedAt: 1234,
  } as unknown as Companion

  test("a retired species moves onto one we still draw", () => {
    const moved = migrateSpecies(retired, mulberry32(3))!
    expect(moved).toBeDefined()
    expect(SPECIES).toContain(moved.species)
    expect(() => spriteFrame(moved.species, "idle", 0)).not.toThrow()
  })

  test("everything that isn't the drawing survives the move", () => {
    const moved = migrateSpecies(retired, mulberry32(3))!
    expect(moved.name).toBe("Ember")
    expect(moved.rarity).toBe("legendary")
    expect(moved.stats).toEqual({ patience: 3, chaos: 9, wisdom: 4, snark: 7 })
    expect(moved.hatchedAt).toBe(1234)
  })

  test("a species we still draw is left alone", () => {
    for (const species of SPECIES) {
      expect(migrateSpecies({ ...retired, species })).toBeUndefined()
    }
  })
})

describe("spriteFrame", () => {
  test("frame size is constant per species and within budget, no template leftovers", () => {
    for (const species of SPECIES) {
      expect(spriteHeight(species)).toBeLessThanOrEqual(SPRITE_MAX_HEIGHT)
      for (const state of STATES) {
        for (let tick = 0; tick < 16; tick++) {
          const frame = spriteFrame(species, state, tick)
          const lines = frame.split("\n")
          expect(lines.length).toBe(spriteHeight(species))
          for (const line of lines) expect(line.length).toBe(SPRITE_WIDTH)
          expect(frame).not.toContain("{E}")
        }
      }
    }
  })

  test("the last row is never blank: it sits on the agent/model line", () => {
    for (const species of SPECIES) {
      for (const state of STATES) {
        const lines = spriteFrame(species, state, 0).split("\n")
        expect(lines[lines.length - 1]!.trim()).not.toBe("")
      }
    }
  })

  test("idle animates: some tick pair differs (fidget or blink)", () => {
    for (const species of SPECIES) {
      const frames = new Set<string>()
      for (let tick = 0; tick < 14; tick++) frames.add(spriteFrame(species, "idle", tick))
      expect(frames.size).toBeGreaterThan(1)
    }
  })

  test("negative ticks do not crash", () => {
    expect(() => spriteFrame("cat", "idle", -3)).not.toThrow()
  })

  /**
   * Share of idle ticks showing the fidget pose instead of the rest pose. Blink
   * ticks are skipped so a change of eyes isn't counted as movement.
   */
  function fidgetRate(species: Species): number {
    const counts = new Map<string, number>()
    for (let tick = 0; tick < 700; tick++) {
      if (tick % 7 === 6) continue
      const frame = spriteFrame(species, "idle", tick)
      counts.set(frame, (counts.get(frame) ?? 0) + 1)
    }
    const seen = [...counts.values()]
    const total = seen.reduce((a, b) => a + b, 0)
    return (total - Math.max(...seen)) / total
  }

  test("every species uses both of its poses", () => {
    for (const species of SPECIES) {
      const rate = fidgetRate(species)
      expect(rate).toBeGreaterThan(0)
      expect(rate).toBeLessThan(1)
    }
  })

  test("cadence is per-species, not one shared strobe", () => {
    // A rate near 0.5 everywhere means the pose is alternating every tick and
    // each species' `beat` is being ignored.
    expect(fidgetRate("cat")).toBeLessThan(0.2)
    expect(fidgetRate("owl")).toBeLessThan(0.2)
    expect(fidgetRate("bat")).toBeGreaterThan(0.4)
    const rates = new Set(SPECIES.map((s) => fidgetRate(s).toFixed(2)))
    expect(rates.size).toBeGreaterThan(2)
  })
})

describe("withBubble", () => {
  test("no bubble = frame unchanged", () => {
    const frame = spriteFrame("cat", "idle", 0)
    expect(withBubble(frame, undefined)).toBe(frame)
  })

  test("bubble replaces the effect row, padded and truncated to width", () => {
    const frame = spriteFrame("ghost", "idle", 0)
    const out = withBubble(frame, "x".repeat(40)).split("\n")
    expect(out[0]).toBe("x".repeat(SPRITE_WIDTH))
    expect(out.length).toBe(spriteHeight("ghost"))
    expect(withBubble(frame, "hi").split("\n")[0]).toBe("hi".padEnd(SPRITE_WIDTH))
  })
})

describe("pickReaction", () => {
  test("every kind yields a line that fits the bubble row", () => {
    for (const kind of KINDS) {
      for (let i = 0; i < 30; i++) {
        const r = pickReaction(kind)
        expect(r.text.length).toBeGreaterThan(0)
        expect(r.text.length).toBeLessThanOrEqual(SPRITE_WIDTH)
        expect(STATES).toContain(r.state)
      }
    }
  })

  test("deterministic under a fixed rng", () => {
    expect(pickReaction("pet", () => 0)).toEqual(pickReaction("pet", () => 0))
  })
})

describe("createReactionGate", () => {
  test("fires, then blocks until the cooldown elapses", () => {
    const gate = createReactionGate(1000)
    expect(gate.tryFire(10_000)).toBe(true)
    expect(gate.tryFire(10_500)).toBe(false)
    expect(gate.tryFire(10_999)).toBe(false)
    expect(gate.tryFire(11_000)).toBe(true)
  })
})

describe("switchSpecies", () => {
  const companion: Companion = {
    species: "cat",
    rarity: "rare",
    name: "Pixel",
    stats: { patience: 5, chaos: 2, wisdom: 8, snark: 3 },
    hatchedAt: 500,
  }

  test("changes species and preserves all other companion fields", () => {
    const switched = switchSpecies(companion, "penguin")
    expect(switched.species).toBe("penguin")
    expect(switched.name).toBe("Pixel")
    expect(switched.rarity).toBe("rare")
    expect(switched.stats).toEqual(companion.stats)
    expect(switched.hatchedAt).toBe(500)
  })

  test("returns original companion if invalid species is passed", () => {
    const invalid = switchSpecies(companion, "dragon" as any)
    expect(invalid).toBe(companion)
  })
})

describe("cycleSpecies", () => {
  test("advances through all species in order and wraps around", () => {
    let current: Species = SPECIES[0]
    for (let i = 1; i < SPECIES.length; i++) {
      current = cycleSpecies(current)
      expect(current).toBe(SPECIES[i])
    }
    // wrapping from last to first
    current = cycleSpecies(current)
    expect(current).toBe(SPECIES[0])
  })

  test("unknown species defaults to first species", () => {
    expect(cycleSpecies("unicorn" as any)).toBe(SPECIES[0])
  })
})

describe("speciesDescription", () => {
  test("provides descriptions for all species", () => {
    for (const species of SPECIES) {
      expect(SPECIES_DESCRIPTIONS[species]).toBeDefined()
      expect(speciesDescription(species)).toBe(SPECIES_DESCRIPTIONS[species])
    }
  })

  test("appends (current) when isCurrent is true", () => {
    expect(speciesDescription("cat", true)).toBe(`${SPECIES_DESCRIPTIONS.cat} (current)`)
    expect(speciesDescription("cat", false)).toBe(SPECIES_DESCRIPTIONS.cat)
  })
})

describe("registerBuddy lifecycle and commands", () => {
  function makeMockUi(initialCompanion?: Companion, rendererWidth = 120) {
    const store = new Map<string, unknown>()
    if (initialCompanion) store.set("buddy.companion", initialCompanion)
    const toasts: string[] = []
    const commands: Array<{
      title: string
      slash?: { name: string; aliases?: string[] }
      run: (dialog?: unknown) => void | Promise<void>
    }> = []
    const intervals: Array<() => void> = []
    const slotRenders: Record<string, (ctx: any) => any> = {}
    let dialogRender: (() => any) | undefined
    let dialogCleared = false

    const fakeDialog = {
      replace: (render: () => any) => {
        dialogRender = render
      },
      clear: () => {
        dialogCleared = true
      },
    }

    const ui = {
      enableJsx: async () => {},
      node: (type: any, props: any) => ({ type, props }),
      api: {
        kv: {
          get: (key: string, fallback: any) => store.get(key) ?? fallback,
          set: (key: string, val: any) => store.set(key, val),
        },
        renderer: { width: rendererWidth },
        theme: {
          current: {
            accent: "accent",
            info: "info",
            success: "success",
            textMuted: "muted",
          },
        },
        ui: {
          DialogSelect: (props: any) => ({ type: "DialogSelect", props }),
          dialog: fakeDialog,
        },
        command: {
          register: () => () => {},
        },
      },
      toast: (msg: string) => toasts.push(msg),
      every: (_ms: number, fn: () => void) => intervals.push(fn),
      on: () => () => {},
      slots: (map: any) => {
        Object.assign(slotRenders, map)
      },
      command: (cmd: any) => {
        commands.push({
          title: cmd.title,
          slash: cmd.slash ? { name: cmd.slash, aliases: cmd.aliases } : undefined,
          run: cmd.run,
        })
      },
    } as unknown as Ui

    return {
      ui,
      store,
      toasts,
      commands,
      intervals,
      slotRenders,
      fakeDialog,
      getDialogRender: () => dialogRender,
      isDialogCleared: () => dialogCleared,
    }
  }

  test("hatches buddy on first run and registers commands", async () => {
    const mock = makeMockUi()
    await registerBuddy(mock.ui)

    const hatched = mock.store.get("buddy.companion") as Companion
    expect(hatched).toBeDefined()
    expect(SPECIES).toContain(hatched.species)
    expect(mock.toasts).toHaveLength(1)
    expect(mock.toasts[0]).toContain("a buddy hatched")

    const slashNames = mock.commands.map((c) => c.slash?.name)
    expect(slashNames).toContain("oc-buddy")
    expect(slashNames).toContain("oc-buddy-switch")
    expect(slashNames).toContain("oc-buddy-cycle")
  })

  test("oc-buddy command pets buddy and shows toast", async () => {
    const comp: Companion = {
      species: "dog",
      rarity: "uncommon",
      name: "Biscuit",
      stats: { patience: 4, chaos: 4, wisdom: 4, snark: 4 },
      hatchedAt: 100,
    }
    const mock = makeMockUi(comp)
    await registerBuddy(mock.ui)

    const petCmd = mock.commands.find((c) => c.slash?.name === "oc-buddy")!
    await petCmd.run()

    expect(mock.toasts).toContain(describeCompanion(comp))
  })

  test("oc-buddy-cycle advances through species and updates mounted nodes", async () => {
    const comp: Companion = {
      species: "cat",
      rarity: "common",
      name: "Mochi",
      stats: { patience: 6, chaos: 3, wisdom: 5, snark: 2 },
      hatchedAt: 100,
    }
    const mock = makeMockUi(comp)
    await registerBuddy(mock.ui)

    // Mount a sprite node
    const slotVNode = mock.slotRenders.home_prompt_right({
      theme: { current: (mock.ui.api as any).theme.current },
    }) as any
    const mockNode = { content: "", visible: true, height: 0, fg: "" }
    slotVNode.props.ref(mockNode)

    const cycleCmd = mock.commands.find((c) => c.slash?.name === "oc-buddy-cycle")!
    await cycleCmd.run()

    const updated = mock.store.get("buddy.companion") as Companion
    expect(updated.species).toBe("dog")
    expect(mockNode.height).toBe(spriteHeight("dog"))
    expect(mockNode.content.length).toBeGreaterThan(0)
    expect(mock.toasts.some((t) => t.includes("switched to dog"))).toBe(true)
  })

  test("oc-buddy-switch opens dialog when dialog stack is available", async () => {
    const comp: Companion = {
      species: "owl",
      rarity: "rare",
      name: "Hoot",
      stats: { patience: 9, chaos: 1, wisdom: 10, snark: 5 },
      hatchedAt: 200,
    }
    const mock = makeMockUi(comp)
    await registerBuddy(mock.ui)

    const switchCmd = mock.commands.find((c) => c.slash?.name === "oc-buddy-switch")!
    await switchCmd.run(mock.fakeDialog)

    const dialogRender = mock.getDialogRender()
    expect(dialogRender).toBeDefined()
    const dialogElement = dialogRender!() as any
    expect(dialogElement.props.title).toBe("Switch Buddy")
    expect(dialogElement.props.options.length).toBe(SPECIES.length + 1) // all species + random

    // Select ghost
    const ghostOption = dialogElement.props.options.find((o: any) => o.value === "ghost")
    ghostOption.onSelect()

    expect(mock.isDialogCleared()).toBe(true)
    const current = mock.store.get("buddy.companion") as Companion
    expect(current.species).toBe("ghost")
    expect(current.name).toBe("Hoot") // Preserves name
    expect(mock.toasts.some((t) => t.includes("switched to ghost"))).toBe(true)
  })

  test("oc-buddy-switch random roll rolls a new buddy", async () => {
    const comp: Companion = {
      species: "bat",
      rarity: "common",
      name: "Fang",
      stats: { patience: 1, chaos: 10, wisdom: 2, snark: 8 },
      hatchedAt: 300,
    }
    const mock = makeMockUi(comp)
    await registerBuddy(mock.ui)

    const switchCmd = mock.commands.find((c) => c.slash?.name === "oc-buddy-switch")!
    await switchCmd.run(mock.fakeDialog)

    const dialogElement = mock.getDialogRender()!() as any
    const randomOption = dialogElement.props.options.find((o: any) => o.value === "random")
    randomOption.onSelect()

    expect(mock.isDialogCleared()).toBe(true)
    const current = mock.store.get("buddy.companion") as Companion
    expect(current).toBeDefined()
    expect(mock.toasts.some((t) => t.includes("a new buddy hatched"))).toBe(true)
  })

  test("oc-buddy-switch falls back to cycling when dialog is unavailable", async () => {
    const comp: Companion = {
      species: "bunny",
      rarity: "legendary",
      name: "Thumper",
      stats: { patience: 7, chaos: 7, wisdom: 7, snark: 7 },
      hatchedAt: 400,
    }
    const mock = makeMockUi(comp)
    // Remove dialog
    delete (mock.ui.api.ui as any).dialog
    await registerBuddy(mock.ui)

    const switchCmd = mock.commands.find((c) => c.slash?.name === "oc-buddy-switch")!
    await switchCmd.run(undefined)

    const updated = mock.store.get("buddy.companion") as Companion
    expect(updated.species).toBe("owl") // bunny -> owl
    expect(mock.toasts.some((t) => t.includes("switched to owl"))).toBe(true)
  })
})
