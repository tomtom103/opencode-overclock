import { describe, expect, test } from "bun:test"
import { mulberry32, rollCompanion, describeCompanion, migrateSpecies } from "../src/buddy/companion.ts"
import { SPECIES, type Companion, type Species } from "../src/buddy/types.ts"
import {
  spriteFrame,
  withBubble,
  spriteHeight,
  SPRITE_WIDTH,
  SPRITE_MAX_HEIGHT,
  type SpriteState,
} from "../src/buddy/sprites.ts"
import { pickReaction, createReactionGate, type ReactionKind } from "../src/buddy/reactions.ts"

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
