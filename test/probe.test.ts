import { describe, expect, test } from "bun:test"
import { missingSurfaces } from "../src/lib/probe.ts"

const client = {
  session: { promptAsync: async () => {}, messages: async () => {} },
  tui: { showToast: async () => {} },
}

describe("missingSurfaces", () => {
  test("all present -> empty", () => {
    expect(missingSurfaces(client, ["session.promptAsync", "tui.showToast"])).toEqual([])
  })

  test("missing leaf detected", () => {
    expect(missingSurfaces(client, ["session.create", "session.messages"])).toEqual(["session.create"])
  })

  test("missing branch detected", () => {
    expect(missingSurfaces({}, ["session.promptAsync"])).toEqual(["session.promptAsync"])
  })

  test("non-function leaf = missing", () => {
    expect(missingSurfaces({ session: { promptAsync: "nope" } }, ["session.promptAsync"])).toEqual([
      "session.promptAsync",
    ])
  })

  test("no requirements -> empty", () => {
    expect(missingSurfaces(client, [])).toEqual([])
  })
})
