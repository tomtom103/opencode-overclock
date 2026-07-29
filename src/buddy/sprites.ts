import type { Species } from "./types.ts"

/**
 * Every frame is padded to exactly SPRITE_WIDTH columns so animation never
 * causes layout reflow. Height is per-species (see spriteHeight) and is *not*
 * padded: the buddy is mounted as a bottom-anchored absolute overlay, so a
 * trailing blank row would lift the creature off the agent/model line.
 */
export const SPRITE_WIDTH = 12
/**
 * Tallest a frame can get: 1 effect row + a 3-row body. The prompt box is 4 rows
 * tall with an empty input, so staying within this keeps the buddy -- bubble row
 * included -- from drawing above the box and onto the transcript.
 */
export const SPRITE_MAX_HEIGHT = 4

export type SpriteState = "idle" | "pet" | "alarmed" | "curious" | "sleep"

/**
 * Frames are body templates, not full art per state: `{E}` is replaced by a
 * 3-char eye string, and a top "effect" line floats <3 / ! / ? / z above the
 * head. One drawing per species (plus a fidget frame) covers every state.
 */
const EYES = {
  open: "o.o",
  blink: "-.-",
  pet: "^.^",
  alarmed: "O.O",
  sleep: "-.-",
} as const

interface SpeciesArt {
  /** Two body frames, alternated while idle: tail flick, ear twitch, wing flap... */
  idle: [string[], string[]]
}

const ART: Record<Species, SpeciesArt> = {
  cat: {
    idle: [
      [" /\\_/\\", "( {E} )", " > ^ <"],
      [" /\\_/\\", "( {E} )", " > ^ <~"],
    ],
  },
  dog: {
    idle: [
      [" /^-^\\", "( {E} )", "/  ~  \\"],
      [" /^-^/", "( {E} )", "/  ~  \\"],
    ],
  },
  dragon: {
    idle: [
      ["  /\\~/\\", " ( {E} )", "<(  v  )>"],
      ["  /\\~/\\", " ( {E} )", "^(  v  )^"],
    ],
  },
  ghost: {
    idle: [
      ["  .-.", " ({E})", " '\"'\"'"],
      ["  .-.", " ({E})", ' ~"~"~'],
    ],
  },
  slime: {
    idle: [
      ["   ___", "  ({E})", " (_____)"],
      ["  ___", " (({E}))", "(_______)"],
    ],
  },
}

const BLINK_EVERY = 7

/** Effect row on top, body below it, every row padded to SPRITE_WIDTH. */
function compose(effect: string, body: readonly string[], eyes: string): string {
  const lines = [effect, ...body.map((l) => l.replace("{E}", eyes))]
  return lines.map((l) => l.slice(0, SPRITE_WIDTH).padEnd(SPRITE_WIDTH)).join("\n")
}

/**
 * Rows a species' frames occupy: constant across states and ticks, so the host
 * node can be sized once at mount and never resized mid-animation.
 */
export function spriteHeight(species: Species): number {
  return 1 + ART[species].idle[0].length
}

/** Pure: overlay a speech line onto the frame's effect row (line 0), truncated to width. */
export function withBubble(frame: string, bubble: string | undefined): string {
  if (!bubble) return frame
  const lines = frame.split("\n")
  lines[0] = bubble.slice(0, SPRITE_WIDTH).padEnd(SPRITE_WIDTH)
  return lines.join("\n")
}

/** Pure: render one frame. `tick` drives idle fidget + blink; other states are static. */
export function spriteFrame(species: Species, state: SpriteState, tick: number): string {
  const art = ART[species]
  const t = ((tick % 1000) + 1000) % 1000
  const body = art.idle[t % 2]!
  const rest = art.idle[0]!

  switch (state) {
    case "idle": {
      const eyes = t % BLINK_EVERY === BLINK_EVERY - 1 ? EYES.blink : EYES.open
      return compose("", body, eyes)
    }
    case "pet":
      return compose("     <3", rest, EYES.pet)
    case "alarmed":
      return compose("     !", rest, EYES.alarmed)
    case "curious":
      return compose("     ?", rest, EYES.open)
    case "sleep":
      return compose("     z Z", rest, EYES.sleep)
  }
}
