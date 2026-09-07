import { describe, expect, test } from "bun:test"
import { isInsideTmux, spawnTaskPane } from "../src/lib/tmux.ts"

describe("tmux utilities", () => {
  test("isInsideTmux reflects TMUX environment variable", () => {
    const orig = process.env.TMUX
    try {
      delete process.env.TMUX
      expect(isInsideTmux()).toBe(false)

      process.env.TMUX = "/tmp/tmux-1000/default,1234,0"
      expect(isInsideTmux()).toBe(true)
    } finally {
      if (orig !== undefined) process.env.TMUX = orig
      else delete process.env.TMUX
    }
  })

  test("spawnTaskPane returns null when outside tmux", async () => {
    const orig = process.env.TMUX
    try {
      delete process.env.TMUX
      const pane = await spawnTaskPane("/tmp/nonexistent.log", "test")
      expect(pane).toBeNull()
    } finally {
      if (orig !== undefined) process.env.TMUX = orig
      else delete process.env.TMUX
    }
  })
})
