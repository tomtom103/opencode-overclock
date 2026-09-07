import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core"
import {
  captureSnapshot,
  formatSnapshotMarkdown,
  type SnapshotElement,
} from "../src/lib/browser/snapshot.ts"
import { createBrowserSessionManager } from "../src/lib/browser/session.ts"

describe("browser snapshot engine", () => {
  describe("formatSnapshotMarkdown", () => {
    test("formats elements in standard interactive markdown matching specification", () => {
      const elements: SnapshotElement[] = [
        {
          ref: 1,
          role: "link",
          text: "United States",
          href: "/wiki/United_States",
          detail: "/wiki/United_States",
        },
        {
          ref: 2,
          role: "link",
          text: "2020 Summer Olympics",
          href: "/wiki/2020_Summer_Olympics",
          detail: "/wiki/2020_Summer_Olympics",
        },
        {
          ref: 3,
          role: "input",
          text: "Search Wikipedia",
          placeholder: "Search Wikipedia",
          detail: 'placeholder="Search Wikipedia"',
        },
        {
          ref: 4,
          role: "button",
          text: "Search",
        },
      ]

      const formatted = formatSnapshotMarkdown("Wikipedia", "https://en.wikipedia.org", elements)

      expect(formatted).toContain("## Interactive Snapshot: Wikipedia")
      expect(formatted).toContain("URL: https://en.wikipedia.org")
      expect(formatted).toContain(
        "### Interactive Elements (use ref to interact, e.g. click with ref: 1):",
      )
      expect(formatted).toContain('[1] link: "United States" (href: /wiki/United_States)')
      expect(formatted).toContain('[2] link: "2020 Summer Olympics" (href: /wiki/2020_Summer_Olympics)')
      expect(formatted).toContain('[3] input: "Search Wikipedia" [placeholder="Search Wikipedia"]')
      expect(formatted).toContain('[4] button: "Search"')
    })

    test("formats empty elements list cleanly", () => {
      const formatted = formatSnapshotMarkdown("Empty Page", "http://localhost", [])
      expect(formatted).toContain("(No interactive elements found)")
    })

    test("formats inputs with both placeholder and value", () => {
      const elements: SnapshotElement[] = [
        {
          ref: 1,
          role: "input",
          text: "John Doe",
          placeholder: "Your Name",
          value: "John Doe",
        },
      ]
      const formatted = formatSnapshotMarkdown("Form", "http://localhost", elements)
      expect(formatted).toContain('[1] input: "John Doe" [placeholder="Your Name"] [value="John Doe"]')
    })

    test("adds pagination line when totalMatching exceeds maxElements", () => {
      const elements: SnapshotElement[] = [
        { ref: 1, role: "button", text: "First" },
        { ref: 2, role: "button", text: "Second" },
      ]
      const formatted = formatSnapshotMarkdown("Page", "http://localhost", elements, {
        totalMatching: 10,
        maxElements: 2,
        offset: 0,
      })
      expect(formatted).toContain("Showing elements 1-2 of 10 matching. Use offset to view more.")
    })

    test("handles non-zero offset in pagination line", () => {
      const elements: SnapshotElement[] = [
        { ref: 1, role: "button", text: "Third" },
        { ref: 2, role: "button", text: "Fourth" },
      ]
      const formatted = formatSnapshotMarkdown("Page", "http://localhost", elements, {
        totalMatching: 10,
        maxElements: 2,
        offset: 2,
      })
      expect(formatted).toContain("Showing elements 3-4 of 10 matching. Use offset to view more.")
    })

    test("omits pagination line when totalMatching <= maxElements", () => {
      const elements: SnapshotElement[] = [{ ref: 1, role: "button", text: "First" }]
      const formatted = formatSnapshotMarkdown("Page", "http://localhost", elements, {
        totalMatching: 1,
        maxElements: 2,
        offset: 0,
      })
      expect(formatted).not.toContain("Showing elements")
    })

    test("falls back cleanly when element text is empty or whitespace", () => {
      const elements: SnapshotElement[] = [
        { ref: 1, role: "link", text: "", href: "/empty-link" },
        { ref: 2, role: "button", text: "   " },
      ]
      const formatted = formatSnapshotMarkdown("Page", "http://localhost", elements)
      expect(formatted).toContain('[1] link: "[link]" (href: /empty-link)')
      expect(formatted).toContain('[2] button: "[button]"')
      expect(formatted).not.toContain('link: ""')
    })

    test("normalizes multiline text into single clean line", () => {
      const elements: SnapshotElement[] = [
        { ref: 1, role: "link", text: "First line\nSecond line\r\nThird line", href: "/multiline" },
      ]
      const formatted = formatSnapshotMarkdown("Page", "http://localhost", elements)
      expect(formatted).toContain('[1] link: "First line Second line Third line" (href: /multiline)')
    })
  })

  describe("captureSnapshot in-browser evaluation", () => {
    let server: ReturnType<typeof Bun.serve>
    let serverUrl: string
    let session: ReturnType<typeof createBrowserSessionManager>
    let page: Page

    beforeAll(async () => {
      server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/") {
            return new Response(
              `<!DOCTYPE html>
<html>
  <head><title>Snapshot Test Page</title></head>
  <body>
    <header>
      <a href="/wiki/United_States">United States</a>
      <a href="/wiki/2020_Summer_Olympics">2020 Summer Olympics</a>
    </header>
    <main>
      <input id="search-input" type="text" placeholder="Search Wikipedia" />
      <button id="search-btn">Search</button>
      <div role="button" id="custom-role-btn">Custom Button</div>
      <div role="tab" id="tab-1">Tab 1</div>
      <textarea id="bio" placeholder="Write bio"></textarea>
      <select id="country">
        <option value="US" selected>United States</option>
        <option value="UK">United Kingdom</option>
      </select>

      <!-- Invisible elements that must be filtered out -->
      <button style="display: none;">Hidden Button</button>
      <button style="visibility: hidden;">Invisible Button</button>
      <button style="opacity: 0;">Zero Opacity Button</button>
      <div style="display: none;">
        <a href="/hidden">Hidden Link</a>
      </div>

      <a id="img-link" href="/wiki/File:Globe.png"><img src="/globe.png" alt="Wikipedia Globe" /></a>
      <a id="svg-link" href="/search"><svg aria-label="Search Icon"></svg></a>
      <a id="empty-img-link" href="/wiki/File:NoAlt.png"><img src="/noalt.png" /></a>

      <section id="section">
        <h2 id="section-heading">Section Title</h2>
        <a href="/section-link">Section Link</a>
        <button id="section-btn">Section Button</button>
      </section>

      <div class="container">
        <h3 id="container-heading">Container Title</h3>
        <a href="/container-link">Container Link</a>
        <button id="container-btn">Container Button</button>
      </div>

      <div id="flat-sections">
        <h2 id="flat-heading-1">Flat Section 1</h2>
        <a href="/flat-1">Flat Link 1</a>
        <h2 id="flat-heading-2">Flat Section 2</h2>
        <a href="/flat-2">Flat Link 2</a>
      </div>
    </main>
  </body>
</html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          }
          return new Response("Not found", { status: 404 })
        },
      })
      serverUrl = `http://127.0.0.1:${server.port}`

      session = createBrowserSessionManager({
        channel: (process.platform === "linux" ? "chrome" : undefined) as any,
      })
      page = await session.getPage()
      await page.goto(serverUrl, { waitUntil: "domcontentloaded" })
    })

    afterAll(async () => {
      await session?.dispose()
      server?.stop(true)
    })

    test("captures interactive elements, injects 1-based data-oc-ref, and filters invisible elements", async () => {
      const snapshot = await captureSnapshot(page)

      expect(snapshot.title).toBe("Snapshot Test Page")
      expect(snapshot.url).toBe(serverUrl + "/")
      expect(snapshot.elements.length).toBeGreaterThanOrEqual(6)

      // Elements inside <main> are prioritized first
      expect(snapshot.elements[0].ref).toBe(1)
      expect(snapshot.elements[0].role).toBe("input")
      expect(snapshot.elements[0].text).toBe("Search Wikipedia")

      // Elements outside <main> (in <header>) appear after main content
      const usLink = snapshot.elements.find((e) => e.text === "United States" && e.role === "link")
      expect(usLink).toBeDefined()
      expect(usLink!.href).toBe("/wiki/United_States")

      const olympicsLink = snapshot.elements.find(
        (e) => e.text === "2020 Summer Olympics" && e.role === "link",
      )
      expect(olympicsLink).toBeDefined()
      expect(olympicsLink!.href).toBe("/wiki/2020_Summer_Olympics")

      // Search input
      const inputEl = snapshot.elements.find((e) => e.placeholder === "Search Wikipedia")
      expect(inputEl).toBeDefined()
      expect(inputEl!.role).toBe("input")
      expect(inputEl!.text).toBe("Search Wikipedia")

      // Search button
      const searchBtn = snapshot.elements.find((e) => e.text === "Search" && e.role === "button")
      expect(searchBtn).toBeDefined()

      // Custom role button
      const customBtn = snapshot.elements.find((e) => e.text === "Custom Button")
      expect(customBtn).toBeDefined()
      expect(customBtn!.role).toBe("button")

      // Tab role
      const tabEl = snapshot.elements.find((e) => e.text === "Tab 1")
      expect(tabEl).toBeDefined()
      expect(tabEl!.role).toBe("tab")

      // Verify invisible elements were NOT captured
      const hiddenLink = snapshot.elements.find((e) => e.text === "Hidden Link")
      expect(hiddenLink).toBeUndefined()
      const hiddenBtn = snapshot.elements.find((e) => e.text === "Hidden Button")
      expect(hiddenBtn).toBeUndefined()

      // Verify DOM attributes data-oc-ref were injected
      const firstRefAttr = await page.getAttribute("#search-input", "data-oc-ref")
      expect(firstRefAttr).toBe("1")
    })

    test("cleans previous data-oc-ref attributes before new snapshot", async () => {
      // First snapshot set ref attributes
      await captureSnapshot(page)
      const attrBefore = await page.getAttribute("#search-input", "data-oc-ref")
      expect(attrBefore).toBe("1")

      // Run snapshot with filter matching only Olympics
      const filteredSnapshot = await captureSnapshot(page, { filter: "olympics" })
      expect(filteredSnapshot.elements.length).toBeGreaterThan(0)
      expect(filteredSnapshot.elements[0].ref).toBe(1)

      // The original search input should NO LONGER have data-oc-ref="1" since it was not in the filtered set
      const attrAfter = await page.getAttribute("#search-input", "data-oc-ref")
      expect(attrAfter).toBeNull()

      // The olympics link should now have data-oc-ref="1"
      const olympicsRef = await page.getAttribute('a[href="/wiki/2020_Summer_Olympics"]', "data-oc-ref")
      expect(olympicsRef).toBe("1")
    })

    test("respects maxElements option", async () => {
      const snapshot = await captureSnapshot(page, { maxElements: 2 })
      expect(snapshot.elements.length).toBe(2)
      expect(snapshot.elements.map((e) => e.ref)).toEqual([1, 2])
    })

    test("filters case-insensitively against text, href, placeholder, or value", async () => {
      const snapshotHref = await captureSnapshot(page, { filter: "olympics" })
      expect(snapshotHref.elements.length).toBe(1)
      expect(snapshotHref.elements[0].text).toBe("2020 Summer Olympics")

      const snapshotPlaceholder = await captureSnapshot(page, { filter: "write bio" })
      expect(snapshotPlaceholder.elements.length).toBe(1)
      expect(snapshotPlaceholder.elements[0].role).toBe("textarea")
    })

    test("supports pagination with offset and reports totalMatching", async () => {
      const page1 = await captureSnapshot(page, { maxElements: 2, offset: 0 })
      expect(page1.elements.length).toBe(2)
      expect(page1.elements[0].ref).toBe(1)
      expect(page1.elements[1].ref).toBe(2)
      expect(page1.totalMatching).toBeGreaterThanOrEqual(6)
      expect(page1.formatted).toContain(
        `Showing elements 1-2 of ${page1.totalMatching} matching. Use offset to view more.`,
      )

      const page2 = await captureSnapshot(page, { maxElements: 2, offset: 2 })
      expect(page2.elements.length).toBe(2)
      expect(page2.elements[0].ref).toBe(1)
      expect(page2.elements[1].ref).toBe(2)
      expect(page2.elements[0].text).not.toBe(page1.elements[0].text)
      expect(page2.formatted).toContain(
        `Showing elements 3-4 of ${page2.totalMatching} matching. Use offset to view more.`,
      )
    })

    test("robust multi-word and slug matching against text and href", async () => {
      // Test hyphen/slug matching
      const slugMatch = await captureSnapshot(page, { filter: "summer-olympics" })
      expect(slugMatch.elements.length).toBe(1)
      expect(slugMatch.elements[0].text).toBe("2020 Summer Olympics")

      // Test multi-word matching
      const multiWordMatch = await captureSnapshot(page, { filter: "summer 2020" })
      expect(multiWordMatch.elements.length).toBe(1)
      expect(multiWordMatch.elements[0].text).toBe("2020 Summer Olympics")

      // Test underscore matching
      const underscoreMatch = await captureSnapshot(page, { filter: "Summer_Olympics" })
      expect(underscoreMatch.elements.length).toBe(1)
      expect(underscoreMatch.elements[0].text).toBe("2020 Summer Olympics")
    })

    test("scopes snapshot to #section (only elements within scope are returned)", async () => {
      const snapshot = await captureSnapshot(page, { scope: "#section" })
      expect(snapshot.elements.length).toBe(2)
      expect(snapshot.elements[0].text).toBe("Section Link")
      expect(snapshot.elements[0].role).toBe("link")
      expect(snapshot.elements[0].href).toBe("/section-link")
      expect(snapshot.elements[0].ref).toBe(1)
      expect(snapshot.elements[1].text).toBe("Section Button")
      expect(snapshot.elements[1].role).toBe("button")
      expect(snapshot.elements[1].ref).toBe(2)

      // Ensure elements outside #section are not returned
      expect(snapshot.elements.some((e) => e.text === "Search Wikipedia")).toBe(false)
      expect(snapshot.elements.some((e) => e.text === "Container Link")).toBe(false)
    })

    test("scopes snapshot to .container (only elements within scope are returned)", async () => {
      const snapshot = await captureSnapshot(page, { scope: ".container" })
      expect(snapshot.elements.length).toBe(2)
      expect(snapshot.elements[0].text).toBe("Container Link")
      expect(snapshot.elements[0].role).toBe("link")
      expect(snapshot.elements[0].href).toBe("/container-link")
      expect(snapshot.elements[0].ref).toBe(1)
      expect(snapshot.elements[1].text).toBe("Container Button")
      expect(snapshot.elements[1].role).toBe("button")
      expect(snapshot.elements[1].ref).toBe(2)

      // Ensure elements outside .container are not returned
      expect(snapshot.elements.some((e) => e.text === "Search Wikipedia")).toBe(false)
      expect(snapshot.elements.some((e) => e.text === "Section Link")).toBe(false)
    })

    test("scopes snapshot to a heading without child links directly, finding section or elements until next heading", async () => {
      // Heading inside <section>
      const headingInSec = await captureSnapshot(page, { scope: "#section-heading" })
      expect(headingInSec.elements.length).toBe(2)
      expect(headingInSec.elements[0].text).toBe("Section Link")
      expect(headingInSec.elements[1].text).toBe("Section Button")

      // Heading in flat structure with siblings until next heading
      const flatHead1 = await captureSnapshot(page, { scope: "#flat-heading-1" })
      expect(flatHead1.elements.length).toBe(1)
      expect(flatHead1.elements[0].text).toBe("Flat Link 1")

      const flatHead2 = await captureSnapshot(page, { scope: "#flat-heading-2" })
      expect(flatHead2.elements.length).toBe(1)
      expect(flatHead2.elements[0].text).toBe("Flat Link 2")
    })

    test("filtered snapshot returning 0 items does not destroy existing [data-oc-ref] tags on the page", async () => {
      // 1. Initial snapshot tags interactive elements with data-oc-ref
      await captureSnapshot(page)
      const inputRefBefore = await page.getAttribute("#search-input", "data-oc-ref")
      expect(inputRefBefore).toBe("1")
      const btnRefBefore = await page.getAttribute("#search-btn", "data-oc-ref")
      expect(btnRefBefore).toBe("2")

      // 2. Filtered snapshot that matches 0 elements
      const emptySnapshot = await captureSnapshot(page, {
        filter: "nonexistent-element-query-xyz-12345",
      })
      expect(emptySnapshot.elements.length).toBe(0)
      expect(emptySnapshot.totalMatching).toBe(0)

      // 3. Existing data-oc-ref tags must NOT have been destroyed
      const inputRefAfter = await page.getAttribute("#search-input", "data-oc-ref")
      expect(inputRefAfter).toBe("1")
      const btnRefAfter = await page.getAttribute("#search-btn", "data-oc-ref")
      expect(btnRefAfter).toBe("2")

      // Subsequent click/locator by ref still succeeds
      const elByRef = await page.$('[data-oc-ref="1"]')
      expect(elByRef).not.toBeNull()
      expect(await elByRef?.getAttribute("id")).toBe("search-input")
    })

    test("extracts text from child img alt/title and svg aria-label for icon links", async () => {
      const snapshot = await captureSnapshot(page)

      const imgLink = snapshot.elements.find((e) => e.href === "/wiki/File:Globe.png")
      expect(imgLink).toBeDefined()
      expect(imgLink!.text).toBe("Wikipedia Globe")

      const svgLink = snapshot.elements.find((e) => e.href === "/search")
      expect(svgLink).toBeDefined()
      expect(svgLink!.text).toBe("Search Icon")

      const emptyImgLink = snapshot.elements.find((e) => e.href === "/wiki/File:NoAlt.png")
      expect(emptyImgLink).toBeDefined()
      expect(emptyImgLink!.text).toBe("[image]")
    })

    test("supports query option alias for filter", async () => {
      const snapshot = await captureSnapshot(page, { query: "Globe" })
      expect(snapshot.elements.length).toBe(1)
      expect(snapshot.elements[0].text).toBe("Wikipedia Globe")
    })
  })

  describe("media and analytics route aborting", () => {
    test("aborts analytics domains and media resources by default unless screenshot requested", async () => {
      const intercepted: Array<{ url: string; aborted: boolean; continued: boolean }> = []

      // Create a mock page that records route interception
      const mockRouteHandler: any = (route: any) => {
        const req = route.request()
        const url = req.url().toLowerCase()
        if (url.includes("google-analytics.com") || url.includes("doubleclick.net")) {
          intercepted.push({ url, aborted: true, continued: false })
          return
        }
        const resourceType = req.resourceType()
        if (
          (resourceType === "image" || resourceType === "media" || resourceType === "font") &&
          !session.isScreenshotRequested()
        ) {
          intercepted.push({ url, aborted: true, continued: false })
          return
        }
        intercepted.push({ url, aborted: false, continued: true })
      }

      const session = createBrowserSessionManager()

      // Test analytics abort
      mockRouteHandler({
        request: () => ({
          url: () => "https://www.google-analytics.com/collect",
          resourceType: () => "xhr",
        }),
        abort: async () => {},
        continue: async () => {},
      })
      expect(intercepted[0].aborted).toBe(true)

      // Test doubleclick abort
      mockRouteHandler({
        request: () => ({
          url: () => "https://stats.doubleclick.net/r/collect",
          resourceType: () => "xhr",
        }),
        abort: async () => {},
        continue: async () => {},
      })
      expect(intercepted[1].aborted).toBe(true)

      // Test heavy media abort by default
      mockRouteHandler({
        request: () => ({
          url: () => "https://example.com/huge-image.png",
          resourceType: () => "image",
        }),
        abort: async () => {},
        continue: async () => {},
      })
      expect(intercepted[2].aborted).toBe(true)

      // Enable screenshot / allow media
      session.setScreenshotRequested(true)
      mockRouteHandler({
        request: () => ({
          url: () => "https://example.com/huge-image.png",
          resourceType: () => "image",
        }),
        abort: async () => {},
        continue: async () => {},
      })
      expect(intercepted[3].continued).toBe(true)

      // Normal script/document should always continue
      mockRouteHandler({
        request: () => ({
          url: () => "https://example.com/app.js",
          resourceType: () => "script",
        }),
        abort: async () => {},
        continue: async () => {},
      })
      expect(intercepted[4].continued).toBe(true)
    })
  })
})
