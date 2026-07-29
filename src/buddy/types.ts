export const SPECIES = ["cat", "dog", "dragon", "ghost", "slime"] as const
export type Species = (typeof SPECIES)[number]

export type Rarity = "common" | "uncommon" | "rare" | "legendary"

export interface CompanionStats {
  patience: number
  chaos: number
  wisdom: number
  snark: number
}

/** Persisted in TUI kv. Rolled once at hatch, then stable for the life of the install. */
export interface Companion {
  species: Species
  rarity: Rarity
  name: string
  stats: CompanionStats
  hatchedAt: number
}
