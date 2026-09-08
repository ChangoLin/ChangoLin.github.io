// Run against a local Quartz build. Playwright can be installed outside this repository.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node scripts/check-responsive.mjs
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright-core")
const output = process.env.SCREENSHOT_DIR ?? path.join(homedir(), ".hermes/cache/site-redesign")
const base = process.env.SITE_URL ?? "http://127.0.0.1:8080"
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
})
const report = []
try {
  for (const width of [375, 390, 768, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: "light",
    })
    const page = await context.newPage()
    console.log(`Checking ${width}px`)
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(base, { waitUntil: "networkidle" })
    await page.waitForSelector(".explorer-content a", { state: "attached" })
    assert.equal(await page.title(), "探索")
    const portalCards = page.locator(".portal-card")
    assert.equal(await portalCards.count(), 2, "portal has exactly two destinations")
    assert.deepEqual(
      await portalCards.evaluateAll((cards) => cards.map((card) => card.getAttribute("href"))),
      ["./garden", "./name-fight/"],
    )
    assert.deepEqual(
      await portalCards.evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("aria-label")),
      ),
      ["进入知识花园", "进入名字打架游戏"],
    )
    for (const card of await portalCards.all()) {
      const bounds = await card.boundingBox()
      assert.ok(bounds.width >= 44 && bounds.height >= 44, "portal card is a touch target")
    }
    const [firstCard, secondCard] = await Promise.all([
      portalCards.nth(0).boundingBox(),
      portalCards.nth(1).boundingBox(),
    ])
    if (width <= 800) {
      assert.ok(secondCard.y > firstCard.y + firstCard.height, "mobile cards stack vertically")
    } else {
      assert.ok(Math.abs(secondCard.y - firstCard.y) < 2, "desktop cards share a row")
    }
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${width} portal: no page overflow`,
    )
    await page.screenshot({ path: path.join(output, `${width}-portal-light.png`), fullPage: true })
    await page.locator(".darkmode").click()
    assert.equal(await page.locator("html").getAttribute("saved-theme"), "dark")
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(output, `${width}-portal-dark.png`), fullPage: true })
    await page.locator(".darkmode").click()
    report.push({
      width,
      page: "portal",
      overflow: false,
      cards: 2,
      theme: true,
      errors: [...errors],
    })
    await page.evaluate(() => {
      window.__spaProbe = true
    })
    await page.locator('.portal-card[aria-label="进入知识花园"]').click()
    await page.waitForURL(/\/garden$/)
    assert.equal(await page.evaluate(() => window.__spaProbe), true, "portal navigation uses SPA")
    const publicArticles = await page
      .locator("article li a.internal")
      .evaluateAll((links) => links.slice(2).map((link) => link.href))
    const article = await page
      .locator("article a")
      .filter({ hasText: "DeepSeek" })
      .getAttribute("href")
    assert.ok(article, "home links to an existing public article")
    const articleUrl = new URL(article, page.url()).href
    for (const kind of ["garden", "article"]) {
      if (kind === "article") {
        await page.locator("article a").filter({ hasText: "DeepSeek" }).click()
        await page.waitForURL(articleUrl)
        await page.waitForSelector(".toc-header")
        assert.equal(await page.evaluate(() => window.__spaProbe), true, "navigation uses SPA")
        const toc = page.locator(".toc-header")
        assert.equal(await toc.getAttribute("aria-expanded"), "false")
        await toc.click()
        assert.equal(await toc.getAttribute("aria-expanded"), "true")
        assert.ok(await page.locator(".toc-content a").first().isVisible())
        await page.screenshot({ path: path.join(output, `${width}-${kind}-toc.png`) })
        await toc.click()
      }
      await page.evaluate(() => document.fonts.ready)
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${width} ${kind}: no page overflow`,
      )
      assert.ok(
        await page.evaluate(
          () => document.querySelector("main").getBoundingClientRect().right <= innerWidth,
        ),
        "main fits viewport",
      )
      for (const selector of [
        ".search-button",
        ".darkmode",
        ...(width <= 800 ? [".mobile-explorer"] : []),
      ]) {
        const bounds = await page.locator(selector).boundingBox()
        assert.ok(bounds.width >= 44 && bounds.height >= 44, `${selector}: 44px touch target`)
      }
      if (kind === "garden") {
        assert.equal(await page.title(), "知识花园")
        assert.equal(await page.locator("article li a.internal").count(), 15)
        const firstArticle = await page
          .locator("article ul")
          .nth(1)
          .locator("a")
          .first()
          .boundingBox()
        assert.ok(firstArticle.height >= 44, "garden article entries have generous touch targets")
      }
      await page.screenshot({
        path: path.join(output, `${width}-${kind}-light.png`),
        fullPage: kind === "garden",
      })
      if (width <= 800) {
        const menu = page.locator(".mobile-explorer")
        await menu.click()
        await page.waitForFunction(
          () => document.querySelector(".mobile-explorer").getAttribute("aria-expanded") === "true",
        )
        assert.ok(await page.locator(".explorer-content").isVisible())
        assert.equal(await page.locator("main").evaluate((el) => el.inert), true)
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "open menu does not overflow",
        )
        await page.screenshot({ path: path.join(output, `${width}-${kind}-menu.png`) })
        await page.keyboard.press("Escape")
        assert.equal(await menu.getAttribute("aria-expanded"), "false")
        await menu.click()
        await menu.click()
        assert.equal(await page.locator("main").evaluate((el) => el.inert), false)
      }
      await page.locator(".search-button").click()
      await page.locator(".search-bar").fill("DeepSeek")
      await page.waitForSelector(".result-card")
      assert.ok(await page.locator(".result-card").count())
      await page.screenshot({ path: path.join(output, `${width}-${kind}-search.png`) })
      await page.locator(".search-close").click()
      assert.equal(
        await page.locator(".search-container").isVisible(),
        false,
        "touch close dismisses search",
      )
      await page.locator(".darkmode").click()
      assert.equal(await page.locator("html").getAttribute("saved-theme"), "dark")
      await page.waitForTimeout(250) // Let theme color transitions finish before capture.
      await page.screenshot({
        path: path.join(output, `${width}-${kind}-dark.png`),
        fullPage: kind === "garden",
      })
      await page.locator(".darkmode").click()
      report.push({
        width,
        page: kind,
        overflow: false,
        search: true,
        theme: true,
        menu: width <= 800 ? true : "desktop",
        errors: [...errors],
      })
      assert.deepEqual(errors, [])
    }
    if (width > 800) {
      const toggle = page.locator(".desktop-explorer")
      await toggle.click()
      assert.equal(await toggle.getAttribute("aria-expanded"), "false")
      assert.equal(await page.locator(".explorer-content").isVisible(), false)
      await toggle.click()
    }
    if (width === 768) {
      await page.locator(".mobile-explorer").click()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.waitForFunction(() => !document.querySelector("main").inert)
      await page.setViewportSize({ width, height: 900 })
      await page.waitForFunction(
        () => document.querySelector(".mobile-explorer").getAttribute("aria-expanded") === "false",
      )
    }
    // Follow real plugin links, then verify theme persistence through SPA and reload.
    await page.locator(".darkmode").click()
    if (width <= 800) await page.locator(".mobile-explorer").click()
    await page.locator(".explorer-content a").filter({ hasText: "睡眠革命" }).click()
    await page.waitForURL(/睡眠革命|%E7%9D%A1/)
    assert.equal(await page.evaluate(() => window.__spaProbe), true)
    assert.equal(await page.locator("html").getAttribute("saved-theme"), "dark")
    if (width <= 800) {
      await page.waitForFunction(
        () => document.querySelector(".mobile-explorer").getAttribute("aria-expanded") === "false",
      )
      assert.equal(await page.locator("main").evaluate((el) => el.inert), false)
    }
    await page.locator(".search-button").click()
    await page.locator(".search-bar").fill("DeepSeek")
    await page.locator(".result-card").first().click()
    await page.waitForURL(articleUrl)
    await page.reload({ waitUntil: "networkidle" })
    assert.equal(await page.locator("html").getAttribute("saved-theme"), "dark")
    assert.deepEqual(errors, [])
    // Existing long notes include tables, code and formulas: check every public article.
    for (const url of publicArticles) {
      await page.goto(url, { waitUntil: "networkidle" })
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${width}: overflow in ${url}`,
      )
    }
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally {
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`Passed ${report.length} page/viewport checks. Screenshots: ${output}`)
