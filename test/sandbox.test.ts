import { describe, expect, test } from "bun:test"
import { wrapCommand } from "../src/features/sandbox.ts"

describe("wrapCommand", () => {
  const policy = { project: "/home/x/proj", net: true }

  test("readonly root, rw project+tmp", () => {
    const w = wrapCommand("echo hi", policy)
    expect(w).toStartWith("bwrap --ro-bind / /")
    expect(w).toContain("--bind '/home/x/proj' '/home/x/proj'")
    expect(w).toContain("--bind /tmp /tmp")
    expect(w).toContain("--die-with-parent")
    expect(w).toEndWith("bash -c 'echo hi'")
  })

  test("net on by default, off adds unshare-net", () => {
    expect(wrapCommand("x", policy)).not.toContain("--unshare-net")
    expect(wrapCommand("x", { ...policy, net: false })).toContain("--unshare-net")
  })

  test("quotes single quotes in cmd", () => {
    expect(wrapCommand("echo 'a b'", policy)).toContain(`'echo '\\''a b'\\'''`)
  })
})
