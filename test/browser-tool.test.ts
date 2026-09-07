import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { browser } from "../src/features/browser.ts"
import { tmpDir, cleanupTmp } from "./tmp.ts"

afterAll(cleanupTmp)

const dir = () => tmpDir("browser-tool")

const capableClient = {
  session: { promptAsync: async () => {}, messages: async () => {}, create: async () => {} },
  tui: { showToast: async () => {} },
}

const ctx = (client: unknown = capableClient, customDir?: string) =>
  ({ client, directory: customDir ?? dir(), worktree: "", project: {}, $: null }) as any

const dummyToolContext = { sessionID: "test-session" } as any

async function callBrowser(toolDef: any, args: Record<string, unknown>): Promise<string> {
  const result = await toolDef.execute(args, dummyToolContext)
  return typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
}

describe("browser interactive tool", () => {
  let server: ReturnType<typeof Bun.serve>
  let serverUrl: string

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === "/") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head>
    <title>Interactive Test Page</title>
  </head>
  <body>
    <h1>Browser Tool Interactive Test</h1>
    <form id="test-form" onsubmit="event.preventDefault(); document.getElementById('output').textContent = 'Submitted: ' + document.getElementById('name').value + ' with ' + document.getElementById('choice').value;">
      <input id="name" type="text" placeholder="Enter name" />
      <select id="choice">
        <option value="opt1">Option 1</option>
        <option value="opt2">Option 2</option>
      </select>
      <button id="submit" type="submit">Submit</button>
    </form>
    <div id="output">Initial State</div>
    <button id="trigger-error" onclick="console.error('Hydration mismatch: server rendered text does not match client')">Trigger Error</button>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/scroll") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head>
    <title>Scroll Test Page</title>
  </head>
  <body style="margin: 0; padding: 20px;">
    <h1>Scroll Test Header</h1>
    <div style="height: 3000px;">Spacer</div>
    <button id="scroll-target">Bottom Target</button>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/second") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head>
    <title>Second Tab Page</title>
  </head>
  <body>
    <h1>Second Tab Content</h1>
    <button id="second-tab-btn">Second Tab Button</button>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/pagination") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head>
    <title>Pagination Test Page</title>
  </head>
  <body>
    <h1>Pagination Test</h1>
    <button id="p1">Page Item 1</button>
    <button id="p2">Page Item 2</button>
    <button id="p3">Page Item 3</button>
    <button id="p4">Page Item 4</button>
    <button id="p5">Page Item 5</button>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/scoped") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head>
    <title>Scoped Test Page</title>
  </head>
  <body>
    <h1>Scoped Test</h1>
    <nav id="nav-container">
      <a href="/link1" id="nav-link">Nav Link</a>
      <button id="nav-btn">Nav Button</button>
    </nav>
    <main id="main-container">
      <button id="main-btn">Main Button</button>
      <input id="main-input" placeholder="Main Input" />
    </main>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/multi") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head><title>Multi Match Page</title></head>
  <body>
    <h1>Multi Match Header</h1>
    <a href="/target-1" class="multi-link">First Choice</a>
    <a href="/target-2" class="multi-link">Second Choice</a>
    <a href="/target-3" class="multi-link">Third Choice</a>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/target-1") {
          return new Response(
            `<!DOCTYPE html><html><head><title>Target 1 Page</title></head><body><h1>Target 1 Arrived</h1></body></html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        if (url.pathname === "/hidden") {
          return new Response(
            `<!DOCTYPE html>
<html>
  <head>
    <title>Hidden Test Page</title>
    <style>
      .mw-collapsed { display: none; }
    </style>
  </head>
  <body>
    <h1>Hidden Test Page</h1>
    <details id="details-elem">
      <summary>Toggle Details</summary>
      <button id="details-hidden-btn" onclick="document.getElementById('status').textContent = 'details clicked'">Details Hidden Button</button>
    </details>

    <div id="collapsed-parent" class="mw-collapsed">
      <button id="collapsed-hidden-btn" onclick="document.getElementById('status').textContent = 'collapsed clicked'">Collapsed Button</button>
    </div>

    <button id="display-none-btn" style="display: none;" onclick="document.getElementById('status').textContent = 'display none clicked'">Display None Button</button>

    <div id="status">initial</div>
  </body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          )
        }

        return new Response("Not found", { status: 404 })
      },
    })
    serverUrl = `http://127.0.0.1:${server.port}`
  })

  afterAll(() => {
    if (server) {
      server.stop(true)
    }
  })

  test("declares browser tool in module metadata", () => {
    expect(browser.tools).toContain("browser")
  })

  test("registers browser tool on init", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    try {
      expect(res.tool).toBeDefined()
      expect(res.tool?.browser).toBeDefined()
    } finally {
      await res.dispose?.()
    }
  })

  test("executes full sequential browser workflow and diagnostics", async () => {
    const testDir = dir()
    const res = await browser.init(
      ctx(capableClient, testDir),
      {},
      { busy: {} as any, toolName: (n) => n },
    )
    expect(res.tool?.browser).toBeDefined()
    const browserTool = res.tool!.browser

    try {
      // 1. Navigate
      const navRes = await callBrowser(browserTool, {
        action: "navigate",
        url: serverUrl,
      })
      expect(navRes).toContain(serverUrl)
      expect(navRes).toContain("Interactive Test Page")

      // 2. Fill
      const fillRes = await callBrowser(browserTool, {
        action: "fill",
        selector: "#name",
        value: "OpenCode",
      })
      expect(fillRes.toLowerCase()).toContain("filled")
      expect(fillRes).toContain("#name")

      // 3. Select
      const selectRes = await callBrowser(browserTool, {
        action: "select",
        selector: "#choice",
        value: "opt2",
      })
      expect(selectRes.toLowerCase()).toContain("select")
      expect(selectRes).toContain("opt2")

      // 4. Click submit
      const clickRes = await callBrowser(browserTool, {
        action: "click",
        selector: "#submit",
      })
      expect(clickRes.toLowerCase()).toContain("click")
      expect(clickRes).toContain("#submit")

      // Verify DOM update via evaluate
      const domOutput = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.getElementById('output').textContent",
      })
      expect(domOutput).toBe("Submitted: OpenCode with opt2")

      // 5. Screenshot
      const shotRes = await callBrowser(browserTool, {
        action: "screenshot",
        name: "test-snapshot",
      })
      expect(shotRes).toContain("Screenshot saved to")
      expect(shotRes).toContain(".png")
      expect(shotRes).toContain("read")

      // Extract path and verify file exists on disk
      const match = shotRes.match(/Screenshot saved to (.*?\.png)/)
      expect(match).not.toBeNull()
      const filePath = match![1]
      expect(existsSync(filePath)).toBe(true)
      expect(statSync(filePath).size).toBeGreaterThan(0)
      expect(filePath).toContain("test-snapshot")

      // 6. Evaluate document.title
      const titleRes = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.title",
      })
      expect(titleRes).toBe("Interactive Test Page")

      // 7. Test console error capture and ActionTrace diagnostics
      const errClickRes = await callBrowser(browserTool, {
        action: "click",
        selector: "#trigger-error",
      })
      expect(errClickRes).toContain("[ActionTrace Diagnostics: Browser Console Errors]")
      expect(errClickRes).toContain("Hydration mismatch")

      // Test action: "console"
      const consoleRes = await callBrowser(browserTool, {
        action: "console",
      })
      expect(consoleRes).toContain("Hydration mismatch")

      // Subsequent action without errors should NOT include ActionTrace diagnostics
      const cleanEval = await callBrowser(browserTool, {
        action: "evaluate",
        script: "1 + 1",
      })
      expect(cleanEval).toBe("2")
      expect(cleanEval).not.toContain("[ActionTrace Diagnostics: Browser Console Errors]")

      // 8. Close browser context
      const closeRes = await callBrowser(browserTool, {
        action: "close",
      })
      expect(closeRes.toLowerCase()).toContain("closed")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("safe error handling returns helpful message without unhandled exceptions", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      // Missing required params
      const navNoUrl = await callBrowser(browserTool, { action: "navigate" })
      expect(navNoUrl.toLowerCase()).toMatch(/requires.*url/)

      const clickNoSel = await callBrowser(browserTool, { action: "click" })
      expect(clickNoSel.toLowerCase()).toMatch(/requires.*selector/)

      const fillNoSel = await callBrowser(browserTool, { action: "fill" })
      expect(fillNoSel.toLowerCase()).toMatch(/requires.*selector/)

      const selectNoSel = await callBrowser(browserTool, { action: "select" })
      expect(selectNoSel.toLowerCase()).toMatch(/requires.*selector/)

      const evalNoScript = await callBrowser(browserTool, { action: "evaluate" })
      expect(evalNoScript.toLowerCase()).toMatch(/requires.*script/)

      const pressNoVal = await callBrowser(browserTool, { action: "press" })
      expect(pressNoVal.toLowerCase()).toMatch(/requires.*value/)

      const waitNoVal = await callBrowser(browserTool, { action: "wait" })
      expect(waitNoVal.toLowerCase()).toMatch(/requires.*value/)

      const switchNoRef = await callBrowser(browserTool, { action: "switchTab" })
      expect(switchNoRef.toLowerCase()).toMatch(/requires.*ref/)

      // Element not found timeout
      await callBrowser(browserTool, { action: "navigate", url: serverUrl })
      const notFoundRes = await callBrowser(browserTool, {
        action: "click",
        selector: "#non-existent-button-xyz",
      })
      expect(notFoundRes.toLowerCase()).toMatch(/error|timeout/)
    } finally {
      await res.dispose?.()
    }
  }, 60000)

  test("blocks non-HTTP protocols and cloud metadata SSRF", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      // file:// protocol
      const fileRes = await callBrowser(browserTool, {
        action: "navigate",
        url: "file:///etc/passwd",
      })
      expect(fileRes.toLowerCase()).toContain("only http and https protocols are supported")

      // javascript: protocol
      const jsRes = await callBrowser(browserTool, {
        action: "navigate",
        url: "javascript:alert(1)",
      })
      expect(jsRes.toLowerCase()).toContain("only http and https protocols are supported")

      // Cloud metadata IP
      const imdsRes = await callBrowser(browserTool, {
        action: "navigate",
        url: "http://169.254.169.254/latest/meta-data/",
      })
      expect(imdsRes.toLowerCase()).toContain("cloud metadata")

      // Cloud metadata ECS
      const ecsRes = await callBrowser(browserTool, {
        action: "navigate",
        url: "http://169.254.170.2/v2/credentials",
      })
      expect(ecsRes.toLowerCase()).toContain("cloud metadata")

      // Cloud metadata GCP hostname
      const gcpRes = await callBrowser(browserTool, {
        action: "navigate",
        url: "http://metadata.google.internal/computeMetadata/v1/",
      })
      expect(gcpRes.toLowerCase()).toContain("cloud metadata")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("redacts sensitive tokens from console logs and ActionTrace diagnostics", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: serverUrl })

      // Evaluate script that triggers console.error with sensitive token
      const fakeApiKey = "sk-ant-api03-abcdef123456789012345678"
      const fakeBearer =
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis"
      await callBrowser(browserTool, {
        action: "evaluate",
        script: `console.error("Auth failed with key ${fakeApiKey} and token ${fakeBearer}")`,
      })

      const consoleRes = await callBrowser(browserTool, { action: "console" })
      expect(consoleRes).not.toContain(fakeApiKey)
      expect(consoleRes).toContain("[REDACTED_API_KEY]")
      expect(consoleRes).not.toContain("doNotLeakThis")

      // Trigger another error during click to verify ActionTrace redaction
      await callBrowser(browserTool, {
        action: "evaluate",
        script: `
          const btn = document.createElement("button");
          btn.id = "leak-button";
          btn.onclick = () => { console.error("Database error at postgres://admin:secret123@db.internal:5432/main"); };
          document.body.appendChild(btn);
        `,
      })

      const clickRes = await callBrowser(browserTool, {
        action: "click",
        selector: "#leak-button",
      })
      expect(clickRes).toContain("[ActionTrace Diagnostics: Browser Console Errors]")
      expect(clickRes).not.toContain("secret123")
      expect(clickRes).toContain("[REDACTED_PASSWORD]")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("supports ref-based interaction, snapshots, back, and reload", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      // 1. Navigate and get initial snapshot
      const navRes = await callBrowser(browserTool, { action: "navigate", url: serverUrl })
      expect(navRes).toContain("## Interactive Snapshot: Interactive Test Page")
      expect(navRes).toContain("### Interactive Elements")

      // 2. Snapshot action returns formatted snapshot
      const snapRes = await callBrowser(browserTool, { action: "snapshot" })
      expect(snapRes).toContain("## Interactive Snapshot: Interactive Test Page")
      expect(snapRes).toContain('[1] input: "Enter name" [placeholder="Enter name"]')
      expect(snapRes).toContain("[2] select:")
      expect(snapRes).toContain('[3] button: "Submit"')

      // 3. Fill input via ref 1
      const fillRefRes = await callBrowser(browserTool, {
        action: "fill",
        ref: 1,
        value: "RefUser",
      })
      expect(fillRefRes).toContain('Filled "#1" with value "RefUser"')

      // 4. Select choice via ref 2
      const selectRefRes = await callBrowser(browserTool, {
        action: "select",
        ref: 2,
        value: "opt2",
      })
      expect(selectRefRes).toContain('Selected option "opt2" in selector "#2"')

      // 5. Click submit button via ref 3
      const clickRefRes = await callBrowser(browserTool, {
        action: "click",
        ref: 3,
      })
      expect(clickRefRes).toContain("Clicked [#3]")
      expect(clickRefRes).toContain("Current URL:")

      // Verify form output updated in DOM
      const domOutput = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.getElementById('output').textContent",
      })
      expect(domOutput).toBe("Submitted: RefUser with opt2")

      // 6. Snapshot with filter
      const filteredSnap = await callBrowser(browserTool, { action: "snapshot", value: "Submit" })
      expect(filteredSnap).toContain("Interactive Elements")
      expect(filteredSnap).toContain("Submit")

      // 7. Reload page
      const reloadRes = await callBrowser(browserTool, { action: "reload" })
      expect(reloadRes).toContain("Reloaded")
      expect(reloadRes).toContain("Interactive Test Page")

      // 8. Back navigation
      const backRes = await callBrowser(browserTool, { action: "back" })
      expect(backRes).toContain("Navigated back to")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("supports scroll action: window scroll and scroll into view", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: `${serverUrl}/scroll` })

      // Scroll window down
      const scrollDownRes = await callBrowser(browserTool, { action: "scroll", value: "down" })
      expect(scrollDownRes.toLowerCase()).toContain("scrolled")
      expect(scrollDownRes).toContain("window down")
      expect(scrollDownRes).toContain("Scroll Test Page")

      const yAfterDown = Number(
        await callBrowser(browserTool, { action: "evaluate", script: "window.scrollY" }),
      )
      expect(yAfterDown).toBeGreaterThan(0)

      // Scroll window up
      const scrollUpRes = await callBrowser(browserTool, { action: "scroll", value: "up" })
      expect(scrollUpRes.toLowerCase()).toContain("scrolled")
      expect(scrollUpRes).toContain("window up")

      const yAfterUp = Number(
        await callBrowser(browserTool, { action: "evaluate", script: "window.scrollY" }),
      )
      expect(yAfterUp).toBeLessThan(yAfterDown)

      // Scroll element into view with selector
      const scrollElemRes = await callBrowser(browserTool, {
        action: "scroll",
        selector: "#scroll-target",
      })
      expect(scrollElemRes).toContain("Scrolled [#scroll-target]")
      expect(scrollElemRes).toContain("Scroll Test Page")

      const yAfterTarget = Number(
        await callBrowser(browserTool, { action: "evaluate", script: "window.scrollY" }),
      )
      expect(yAfterTarget).toBeGreaterThan(1000)

      // Scroll element into view with ref (ref 1 corresponds to #scroll-target)
      const scrollRefRes = await callBrowser(browserTool, {
        action: "scroll",
        ref: 1,
      })
      expect(scrollRefRes).toContain("Scrolled [#1]")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("supports press action: key press and focus", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: serverUrl })

      // Fill input
      await callBrowser(browserTool, {
        action: "fill",
        selector: "#name",
        value: "KeyMaster",
      })

      // Press Enter on the input to trigger form submit
      const pressRes = await callBrowser(browserTool, {
        action: "press",
        selector: "#name",
        value: "Enter",
      })
      expect(pressRes).toContain('Pressed key "Enter" on [#name]')

      // Verify DOM updated from Enter keypress submitting the form
      const domOutput = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.getElementById('output').textContent",
      })
      expect(domOutput).toBe("Submitted: KeyMaster with opt1")

      // Press key with ref
      const pressRefRes = await callBrowser(browserTool, {
        action: "press",
        ref: 1,
        value: "Tab",
      })
      expect(pressRefRes).toContain('Pressed key "Tab" on [#1]')
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("supports wait action: timeout and selector", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: serverUrl })

      // Wait with numeric string
      const waitStrRes = await callBrowser(browserTool, { action: "wait", value: "50" })
      expect(waitStrRes).toBe("Waited for 50ms.")

      // Wait with number
      const waitNumRes = await callBrowser(browserTool, { action: "wait", value: 50 })
      expect(waitNumRes).toBe("Waited for 50ms.")

      // Wait for existing selector via value
      const waitSelRes = await callBrowser(browserTool, { action: "wait", value: "#submit" })
      expect(waitSelRes).toBe('Waited for selector "#submit".')

      // Wait for selector via selector parameter
      const waitSelParamRes = await callBrowser(browserTool, {
        action: "wait",
        selector: "#choice",
      })
      expect(waitSelParamRes).toBe('Waited for selector "#choice".')
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("supports tabs and switchTab actions across multiple pages", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      // Navigate initial tab
      await callBrowser(browserTool, { action: "navigate", url: serverUrl })

      // List initial tabs (single tab)
      const tabsInitial = await callBrowser(browserTool, { action: "tabs" })
      expect(tabsInitial).toContain("Open tabs:")
      expect(tabsInitial).toContain("[1] Interactive Test Page")
      expect(tabsInitial).toContain("(active)")

      // Open a second tab
      await callBrowser(browserTool, {
        action: "evaluate",
        script: `window.open('${serverUrl}/second', '_blank')`,
      })
      await callBrowser(browserTool, { action: "wait", value: "200" })

      // List tabs with 2 open tabs
      const tabsTwo = await callBrowser(browserTool, { action: "tabs" })
      expect(tabsTwo).toContain("[1] Interactive Test Page")
      expect(tabsTwo).toContain("[2] Second Tab Page")
      expect(tabsTwo).toContain(`[1] Interactive Test Page (${serverUrl}/) (active)`)

      // Switch to tab 2
      const switchRes = await callBrowser(browserTool, { action: "switchTab", ref: 2 })
      expect(switchRes).toContain("Switched to tab [2]: Second Tab Page")
      expect(switchRes).toContain(`${serverUrl}/second`)
      expect(switchRes).toContain("Second Tab Button")

      // Verify active tab in tabs list
      const tabsAfterSwitch = await callBrowser(browserTool, { action: "tabs" })
      expect(tabsAfterSwitch).toContain(`[2] Second Tab Page (${serverUrl}/second) (active)`)

      // Verify that subsequent browser action operates on the newly active tab
      const currentTitle = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.title",
      })
      expect(currentTitle).toBe("Second Tab Page")

      // Out of range tab switch
      const outOfRange = await callBrowser(browserTool, { action: "switchTab", ref: 99 })
      expect(outOfRange.toLowerCase()).toContain("out of range")

      // Switch back to tab 1
      const switchBackRes = await callBrowser(browserTool, { action: "switchTab", ref: 1 })
      expect(switchBackRes).toContain("Switched to tab [1]: Interactive Test Page")
      const backTitle = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.title",
      })
      expect(backTitle).toBe("Interactive Test Page")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("supports offset and limit options in snapshot action", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: `${serverUrl}/pagination` })

      // Limit 2, Offset 0 -> returns items 1 and 2 of 5
      const page1 = await callBrowser(browserTool, {
        action: "snapshot",
        limit: 2,
        offset: 0,
      })
      expect(page1).toContain("Showing elements 1-2 of 5 matching")
      expect(page1).toContain("Page Item 1")
      expect(page1).toContain("Page Item 2")
      expect(page1).not.toContain("Page Item 3")
      expect(page1).not.toContain("Page Item 4")
      expect(page1).not.toContain("Page Item 5")

      // Limit 2, Offset 2 -> returns items 3 and 4 of 5
      const page2 = await callBrowser(browserTool, {
        action: "snapshot",
        limit: 2,
        offset: 2,
      })
      expect(page2).toContain("Showing elements 3-4 of 5 matching")
      expect(page2).not.toContain("Page Item 1")
      expect(page2).not.toContain("Page Item 2")
      expect(page2).toContain("Page Item 3")
      expect(page2).toContain("Page Item 4")
      expect(page2).not.toContain("Page Item 5")

      // Limit 2, Offset 4 -> returns item 5 of 5
      const page3 = await callBrowser(browserTool, {
        action: "snapshot",
        limit: 2,
        offset: 4,
      })
      expect(page3).toContain("Showing elements 5-5 of 5 matching")
      expect(page3).not.toContain("Page Item 1")
      expect(page3).not.toContain("Page Item 2")
      expect(page3).not.toContain("Page Item 3")
      expect(page3).not.toContain("Page Item 4")
      expect(page3).toContain("Page Item 5")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("supports selector as scope in snapshot action", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: `${serverUrl}/scoped` })

      // Snapshot scoped to nav container
      const navSnap = await callBrowser(browserTool, {
        action: "snapshot",
        selector: "#nav-container",
      })
      expect(navSnap).toContain("Nav Link")
      expect(navSnap).toContain("Nav Button")
      expect(navSnap).not.toContain("Main Button")
      expect(navSnap).not.toContain("Main Input")

      // Snapshot scoped to main container
      const mainSnap = await callBrowser(browserTool, {
        action: "snapshot",
        selector: "#main-container",
      })
      expect(mainSnap).toContain("Main Button")
      expect(mainSnap).toContain("Main Input")
      expect(mainSnap).not.toContain("Nav Link")
      expect(mainSnap).not.toContain("Nav Button")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("clicks hidden element via resilient force fallback", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: `${serverUrl}/hidden` })

      // Verify initial state
      const initialStatus = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.getElementById('status').textContent",
      })
      expect(initialStatus).toBe("initial")

      // 1. Click button inside closed <details> element (uncollapsed via resilient click and clicked with force: true)
      const clickDetailsRes = await callBrowser(browserTool, {
        action: "click",
        selector: "#details-hidden-btn",
      })
      expect(clickDetailsRes).toContain("Clicked [#details-hidden-btn]")

      const statusAfterDetails = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.getElementById('status').textContent",
      })
      expect(statusAfterDetails).toBe("details clicked")

      const isDetailsOpen = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.getElementById('details-elem').open",
      })
      expect(isDetailsOpen).toBe("true")

      // 2. Click button inside .mw-collapsed container (uncollapsed and clicked with force: true)
      const clickCollapsedRes = await callBrowser(browserTool, {
        action: "click",
        selector: "#collapsed-hidden-btn",
      })
      expect(clickCollapsedRes).toContain("Clicked [#collapsed-hidden-btn]")

      const statusAfterCollapsed = await callBrowser(browserTool, {
        action: "evaluate",
        script: "document.getElementById('status').textContent",
      })
      expect(statusAfterCollapsed).toBe("collapsed clicked")

      const isMwCollapsedRemoved = await callBrowser(browserTool, {
        action: "evaluate",
        script: "!document.getElementById('collapsed-parent').classList.contains('mw-collapsed')",
      })
      expect(isMwCollapsedRemoved).toBe("true")
    } finally {
      await res.dispose?.()
    }
  }, 60000)

  test("resolves multi-match selector by clicking first visible element and annotates output", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: `${serverUrl}/multi` })

      // Click selector matching 3 links: should click the first one and navigate to /target-1
      const clickRes = await callBrowser(browserTool, {
        action: "click",
        selector: "a.multi-link",
      })
      expect(clickRes).toContain("Clicked [a.multi-link]")
      expect(clickRes).toContain("Target 1 Page")
      expect(clickRes).toContain("/target-1")
      expect(clickRes).toMatch(/matched 3 elements/i)
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("supports query parameter in snapshot action", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: `${serverUrl}/multi` })

      const querySnap = await callBrowser(browserTool, {
        action: "snapshot",
        query: "Second Choice",
      })
      expect(querySnap).toContain("Second Choice")
      expect(querySnap).not.toContain("First Choice")
      expect(querySnap).not.toContain("Third Choice")
    } finally {
      await res.dispose?.()
    }
  }, 30000)

  test("deduplicates repeated console errors in ActionTrace diagnostics", async () => {
    const res = await browser.init(ctx(), {}, { busy: {} as any, toolName: (n) => n })
    const browserTool = res.tool!.browser

    try {
      await callBrowser(browserTool, { action: "navigate", url: serverUrl })

      await callBrowser(browserTool, {
        action: "evaluate",
        script: `
          const btn = document.createElement("button");
          btn.id = "multi-err-button";
          btn.onclick = () => {
            for (let i = 0; i < 5; i++) {
              console.error("Failed to load resource: net::ERR_FAILED");
            }
          };
          document.body.appendChild(btn);
        `,
      })

      const clickRes = await callBrowser(browserTool, {
        action: "click",
        selector: "#multi-err-button",
      })
      expect(clickRes).toContain("[ActionTrace Diagnostics: Browser Console Errors]")
      expect(clickRes).toContain("Failed to load resource: net::ERR_FAILED (5 occurrences)")
    } finally {
      await res.dispose?.()
    }
  }, 30000)
})
