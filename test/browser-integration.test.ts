import { describe, expect, test, afterAll } from "bun:test"
import { resolve } from "node:path"
import { tmpDir, cleanupTmp } from "./tmp.ts"
import { Overclock } from "../src/index.ts"
import { validateAllSkills, validateSkillFile } from "../src/workflow/catalog.ts"
import { summarise } from "../src/core/summary.ts"
import { features } from "../src/features/index.ts"

afterAll(cleanupTmp)

const dir = () => tmpDir("browser-integration")

const capableClient = {
  session: { promptAsync: async () => {}, messages: async () => {}, create: async () => {} },
  tui: { showToast: async () => {} },
}

const ctx = (client: unknown = capableClient, directory = dir()) =>
  ({ client, directory, worktree: "", project: {}, $: null }) as any

describe("Browser End-to-End Integration", () => {
  test("plugin initializes with browser module and registers tools", async () => {
    const hooks = await Overclock(ctx())
    const tools = hooks.tool ?? {}
    expect(tools.webfetch).toBeDefined()
    expect(tools.browser).toBeDefined()
    expect(tools.crawl).toBeDefined()
    expect(typeof tools.webfetch.execute).toBe("function")
    expect(typeof tools.browser.execute).toBe("function")
    expect(typeof tools.crawl.execute).toBe("function")
    await hooks.dispose?.()
  })

  test("webfetch and browser tools are offered in capability summary", async () => {
    const directory = dir()
    const toasts: string[] = []
    const client = {
      ...capableClient,
      tui: { showToast: async (o: any) => void toasts.push(JSON.stringify(o)) },
    }

    await Overclock(ctx(client, directory))
    const summaryToasts = toasts.filter((t) => t.includes("overclock active"))
    expect(summaryToasts).toHaveLength(1)
    expect(summaryToasts[0]).toContain("browser (webfetch, browser, crawl)")

    // Direct summary verification against the feature list
    const summary = summarise(features, [])
    expect(summary).toMatch(/browser \(webfetch, browser, crawl\)/)
    expect(summary).toContain("webfetch")
    expect(summary).toContain("browser")
    expect(summary).toContain("crawl")
  })

  test("truncator intercepts long browser output", async () => {
    const hooks = await Overclock(ctx())
    const after = hooks["tool.execute.after"]
    expect(after).toBeDefined()

    const rawOutput = Array.from({ length: 1500 }, (_, i) => `Line ${i + 1}: Browser page content`).join(
      "\n",
    )
    const longOutput = {
      title: "Browser",
      output: rawOutput,
      metadata: {} as Record<string, unknown>,
    }

    await after!({ tool: "browser", sessionID: "s1", callID: "c1", args: {} }, longOutput)

    expect(longOutput.output).toContain("[... truncated")
    expect(longOutput.output).toContain("to stay within context limits")
    expect(longOutput.output.length).toBeLessThan(rawOutput.length)

    await hooks.dispose?.()
  })

  test("skills catalog validates all skills cleanly including ui-verify", () => {
    const skillsDir = resolve(import.meta.dir, "../skills")
    const catalogResult = validateAllSkills(skillsDir)
    expect(catalogResult.valid).toBe(true)
    expect(catalogResult.errors).toHaveLength(0)

    const uiVerify = catalogResult.skills.find((s) => s.metadata.name === "ui-verify")
    expect(uiVerify).toBeDefined()
    expect(uiVerify!.metadata.pack).toBe("core")
    expect(uiVerify!.metadata.license).toBe("MIT")
    expect(uiVerify!.metadata.attribution).toBe("opencode-overclock")
    expect(uiVerify!.metadata.description).toContain("Verifies UI behavior")

    const skillFilePath = resolve(skillsDir, "ui-verify", "SKILL.md")
    const fileResult = validateSkillFile(skillFilePath)
    expect(fileResult.valid).toBe(true)
    expect(fileResult.errors).toHaveLength(0)
  })
})
