import type { SpriteState } from "./sprites.ts"

export const SPECIES = [
  "cat",
  "dog",
  "bunny",
  "owl",
  "bat",
  "penguin",
  "duck",
  "ghost",
  "slime",
] as const
export type Species = (typeof SPECIES)[number]

export type Rarity = "common" | "uncommon" | "rare" | "legendary"

export interface CompanionStats {
  patience: number
  chaos: number
  wisdom: number
  snark: number
}

export interface Companion {
  species: Species
  rarity: Rarity
  name: string
  stats: CompanionStats
  hatchedAt: number
}

export type ReactionKind = "done" | "error" | "permission" | "question" | "pet"

/** Speech-bubble line + which face the sprite pulls while it shows. */
export interface Reaction {
  text: string
  state: SpriteState
}

// Lines render into the sprite's 12-col effect row -- keep every line <= 12 chars.
const POOLS: Record<ReactionKind, { lines: string[]; state: SpriteState }> = {
  done: { lines: ["cooked", "ate that", "big W", "say less", "we ball"], state: "idle" },
  error: { lines: ["bruh", "ur cooked", "skill issue", "aint no way", "big L"], state: "alarmed" },
  permission: { lines: ["let me cook", "valid?", "we good?", "bet?", "vibe check"], state: "curious" },
  question: { lines: ["wym?", "the move?", "u tell me", "spill", "hbu?"], state: "curious" },
  pet: { lines: ["pookie!", "w rizz", "ur valid", "slay", "ily"], state: "pet" },
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

/**
 * Move companion onto an active species if its hatched species was retired.
 */
export function migrateSpecies(c: Companion, rng: () => number = Math.random): Companion | undefined {
  if ((SPECIES as readonly string[]).includes(c.species)) return undefined
  return { ...c, species: pick(rng, SPECIES) }
}

/** Short character descriptions for each species based on their idle fidget. */
export const SPECIES_DESCRIPTIONS: Record<Species, string> = {
  cat: "tail flick",
  dog: "ear perk",
  bunny: "ear wiggle",
  owl: "feather ruffle",
  bat: "wing beat",
  penguin: "waddle",
  duck: "ripples",
  ghost: "float",
  slime: "squash",
}

/** Pure: formatted description for dialog options. */
export function speciesDescription(species: Species, isCurrent = false): string {
  const desc = SPECIES_DESCRIPTIONS[species] ?? species
  return isCurrent ? `${desc} (current)` : desc
}

/** Move companion to a new species, preserving name, stats, and hatchedAt. */
export function switchSpecies(c: Companion, species: Species): Companion {
  if (!(SPECIES as readonly string[]).includes(species)) return c
  return { ...c, species }
}

/** Pure: get the next species in the SPECIES rotation. */
export function cycleSpecies(current: Species): Species {
  const idx = SPECIES.indexOf(current)
  if (idx === -1) return SPECIES[0]
  return SPECIES[(idx + 1) % SPECIES.length]!
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
