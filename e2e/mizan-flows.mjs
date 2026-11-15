import assert from "node:assert/strict";
import { chromium } from "playwright";

export async function runMizanE2eFlows(baseUrl = "http://127.0.0.1:8080/", executablePath) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: executablePath || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    // 1. Desktop viewport (1280x800): splash -> Arabic default -> multi-currency txn -> desktop sidebar check
    const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await desktopCtx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Splash appears then transitions out (or tap to skip)
    const splash = page.locator('[data-testid="mizan-splash"]');
    if ((await splash.count()) > 0) {
      await splash.click().catch(() => {});
      await splash.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    }

    await page.waitForSelector("aside", { timeout: 10_000 });
    assert.equal(await page.locator("html").getAttribute("lang"), "ar");
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await page.locator("aside").isVisible(), true);

    // Boot perf metric recorded locally
    const perfCount = await page.evaluate(() => {
      const raw = localStorage.getItem("mizan.perf.v1");
      return raw ? JSON.parse(raw).length : 0;
    });
    assert.ok(perfCount >= 1);

    // 2. Add multi-currency transaction with frozen rate
    await page.getByRole("button", { name: "+ مصروف سريع" }).click();
    await page.getByLabel("المبلغ").fill("150");
    await page.getByLabel("العملة").selectOption("USD");
    await page.getByLabel("سعر الصرف").fill("50");
    await page.getByRole("button", { name: "حفظ" }).click();

    // Navigate to Ledger and confirm converted transaction appears
    await page.locator("aside").getByRole("button", { name: "السجل" }).click();
    await page.waitForSelector('text=USD', { timeout: 5000 });

    // 3. Open CSV import modal from Ledger and import 2 transactions
    await page.locator("aside").getByRole("button", { name: /CSV/i }).click();
    await page.getByLabel("لصق بيانات CSV").fill(
      [
        "date,type,amount,currency,rate,category,note",
        "2026-11-12,expense,20,USD,50,طعام,E2E Lunch",
        "2026-11-13,income,3000,EGP,1,راتب,E2E Bonus",
      ].join("\n"),
    );
    await page.getByRole("button", { name: /استيراد/ }).click();
    await page.waitForSelector("text=E2E Lunch", { timeout: 5000 });

    // 4. Switch to More -> toggle English + Arabic-Indic numerals + analytics opt-out
    await page.locator("aside").getByRole("button", { name: "أكثر" }).click();
    await page.getByRole("tab", { name: "English" }).click();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator("html").getAttribute("dir"), "ltr");

    await page.getByRole("tab", { name: /Arabic-Indic/i }).click();
    await page.getByRole("switch", { name: "Local Spending Analytics" }).click();

    await page.locator("aside").getByRole("button", { name: "Today" }).click();
    await page.waitForSelector("text=Local analytics are turned off by your preference", { timeout: 5000 });

    // Restore Arabic primary default
    await page.locator("aside").getByRole("button", { name: "More" }).click();
    await page.getByRole("tab", { name: "العربية" }).click();
    assert.equal(await page.locator("html").getAttribute("lang"), "ar");
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");

    await desktopCtx.close();

    // 5. Mobile viewport (390x844): bottom tab-bar visible, no horizontal overflow
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileCtx.newPage();
    await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const mSplash = mobilePage.locator('[data-testid="mizan-splash"]');
    if ((await mSplash.count()) > 0) {
      await mSplash.click().catch(() => {});
    }
    await mobilePage.waitForSelector("nav.tab-bar", { timeout: 10_000 });
    assert.equal(await mobilePage.locator("nav.tab-bar").isVisible(), true);
    const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    assert.equal(overflow, false);
    await mobileCtx.close();

    assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join("; ")}`);
    assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join("; ")}`);
  } finally {
    await browser.close();
  }
}
