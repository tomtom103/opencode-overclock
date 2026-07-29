import { SPECIES, type Companion, type CompanionStats, type Rarity } from "./types.ts"

const RARITY_WEIGHTS: { rarity: Rarity; weight: number }[] = [
  { rarity: "common", weight: 60 },
  { rarity: "uncommon", weight: 25 },
  { rarity: "rare", weight: 10 },
  { rarity: "legendary", weight: 5 },
]

const NAME_POOL = [
  "Biscuit",
  "Ember",
  "Noodle",
  "Pixel",
  "Rune",
  "Static",
  "Widget",
  "Zephyr",
  "Marble",
  "Gizmo",
  "Puddle",
  "Cinder",
  "Quokka",
  "Kernel",
  "Sprocket",
]

/** Deterministic PRNG for tests -- production uses Math.random via the default param. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, pool: readonly T[]): T {
  return pool[Math.floor(rng() * pool.length)]!
}

function rollRarity(rng: () => number): Rarity {
  const total = RARITY_WEIGHTS.reduce((sum, e) => sum + e.weight, 0)
  let r = rng() * total
  for (const entry of RARITY_WEIGHTS) {
    if (r < entry.weight) return entry.rarity
    r -= entry.weight
  }
  return RARITY_WEIGHTS[RARITY_WEIGHTS.length - 1]!.rarity
}

function rollStat(rng: () => number): number {
  return 1 + Math.floor(rng() * 10)
}

/** One-line card for the /oc-buddy toast. */
export function describeCompanion(c: Companion): string {
  const s = c.stats
  return `${c.name} the ${c.rarity} ${c.species} · patience ${s.patience} chaos ${s.chaos} wisdom ${s.wisdom} snark ${s.snark}`
}

/** Pure: roll a fresh companion. Called once at hatch, then persisted -- never re-rolled. */
export function rollCompanion(rng: () => number = Math.random, now: number = Date.now()): Companion {
  const stats: CompanionStats = {
    patience: rollStat(rng),
    chaos: rollStat(rng),
    wisdom: rollStat(rng),
    snark: rollStat(rng),
  }
  return {
    species: pick(rng, SPECIES),
    rarity: rollRarity(rng),
    name: pick(rng, NAME_POOL),
    stats,
    hatchedAt: now,
  }
}
