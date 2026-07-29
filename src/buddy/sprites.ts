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
  /** Rest pose + fidget pose: tail flick, ear twitch, wing beat... */
  idle: [string[], string[]]
  /**
   * Which of the two poses a tick shows. Per-species on purpose: alternating
   * every tick reads as a strobe, and it makes every species move alike. A cat
   * flicks its tail rarely, a dog wags nonstop, a dragon's wingbeat is slow and
   * held at the top, a ghost never quite lands.
   */
  beat: (t: number) => 0 | 1
}

/** Fidget pose for `hold` ticks out of every `period`; rest pose otherwise. */
function pulse(period: number, hold = 1): (t: number) => 0 | 1 {
  return (t) => (t % period < hold ? 1 : 0)
}

const ART: Record<Species, SpeciesArt> = {
  // tail flick: rare, one tick, then dead still again
  cat: {
    idle: [
      ["  /\\_/\\", " ( {E} )", "  > ^ <"],
      ["  /\\_/\\", " ( {E} )", "  > ^ <~"],
    ],
    beat: pulse(9),
  },
  // ear perk: a quick double twitch, then a long settle
  dog: {
    idle: [
      ["  ,---,", " /({E})\\", " (__U__)"],
      ["  ,---,", " /({E})/", " (__U__)"],
    ],
    beat: (t) => (t % 7 === 0 || t % 7 === 2 ? 1 : 0),
  },
  // ear wiggle: twitchier than the dog, never for long
  bunny: {
    idle: [
      ["  (\\_/)", "  ({E})", ' (")_(")'],
      ["  (/_\\)", "  ({E})", ' (")_(")'],
    ],
    beat: (t) => (t % 11 === 0 || t % 11 === 2 ? 1 : 0),
  },
  // feather ruffle: an owl mostly just sits there
  owl: {
    idle: [
      ["   ,_,", "  ({E})", "  {`\"'}"],
      ["   ,_,", "  ({E})", "  {'\"`}"],
    ],
    beat: pulse(13),
  },
  // wing beat: fast, never stops fluttering
  bat: {
    idle: [
      [" /^\\_/^\\", " <({E})>", "   \\v/"],
      [" /^\\_/^\\", " ^({E})^", "   \\v/"],
    ],
    beat: pulse(2),
  },
  // waddle: a slow rock, feet turning in and out
  penguin: {
    idle: [
      ["  ({E})", " <|_v_|>", "  _/ \\_"],
      ["  ({E})", " <|_v_|>", "  _\\ /_"],
    ],
    beat: pulse(6, 3),
  },
  // ripples: spreading out, then settling
  duck: {
    idle: [
      ["   ,-,", "  ({E})>", "  ~\\__/~"],
      ["   ,-,", "  ({E})>", " ~ \\__/ ~"],
    ],
    beat: pulse(6, 2),
  },
  // float: never lands, drifting the whole time
  ghost: {
    idle: [
      ["  .-.", " ({E})", " '\"'\"'"],
      ["  .-.", " ({E})", ' ~"~"~'],
    ],
    beat: pulse(4, 2),
  },
  // squash: a brief squish, then a long settle
  slime: {
    idle: [
      ["   ___", "  ({E})", " (_____)"],
      ["  ___", " (({E}))", "(_______)"],
    ],
    beat: pulse(10, 2),
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
  const body = art.idle[art.beat(t)]!
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
