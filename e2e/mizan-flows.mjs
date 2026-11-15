import assert from "node:assert/strict";
import { chromium } from "playwright";

function makeOfflineBundleScript() {
  return (payload) => {
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => false,
    });
    localStorage.setItem("mizan.auth.session.v1", JSON.stringify(payload));
    localStorage.setItem("mizan.activeTenant.v1", "t-e2e-personal");
  };
}

export async function runMizanE2eFlows(baseUrl = "http://127.0.0.1:8080/", executablePath) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: executablePath || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    // 0. Unauthenticated entrypoint check: / shows AuthScreen, /invite/MZN-TEST-2026 prefills code
    const authCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const authPage = await authCtx.newPage();
    authPage.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    authPage.on("pageerror", (e) => pageErrors.push(String(e)));

    await authPage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const authSplash = authPage.locator('[data-testid="mizan-splash"]');
    if ((await authSplash.count()) > 0) {
      await authSplash.click().catch(() => {});
      await authSplash.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    }
    await authPage.waitForSelector('text="ميزان متعدد المساحات"', { timeout: 10_000 });
    assert.equal(await authPage.locator("html").getAttribute("lang"), "ar");
    assert.equal(await authPage.locator("html").getAttribute("dir"), "rtl");

    const inviteUrl = new URL("/invite/MZN-TEST-2026", baseUrl).toString();
    await authPage.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const splashInv = authPage.locator('[data-testid="mizan-splash"]');
    if ((await splashInv.count()) > 0) {
      await splashInv.click().catch(() => {});
    }
    await authPage.waitForSelector('input[placeholder="MZN-XXXX-YYYY"]', { timeout: 10_000 });
    assert.equal(await authPage.locator('input[placeholder="MZN-XXXX-YYYY"]').inputValue(), "MZN-TEST-2026");
    await authCtx.close();

    // 1. Authenticated offline-first Desktop viewport (1280x800): splash -> Arabic default -> multi-currency txn -> multi-tenant isolation
    const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const bundleArg = {
      user: { id: "u-e2e-1", email: "zyadgamal796@gmail.com", displayName: "زياد جمال" },
      isSuperAdmin: true,
      workspaces: [
        {
          id: "t-e2e-personal",
          slug: "personal",
          name: "مساحتي الشخصية",
          kind: "personal",
          baseCurrency: "EGP",
          openingBalance: 1000,
          role: "owner",
          mode: "cloud",
          planCode: "monthly",
          subscriptionStatus: "trialing",
          trialEndsAt: new Date(Date.now() + 86_400_000 * 14).toISOString(),
          currentPeriodEnd: new Date(Date.now() + 86_400_000 * 14).toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          id: "t-e2e-business",
          slug: "acme",
          name: "شركة النور",
          kind: "business",
          baseCurrency: "EGP",
          openingBalance: 5000,
          role: "owner",
          mode: "local",
          planCode: "yearly",
          subscriptionStatus: "active",
          trialEndsAt: new Date(Date.now() + 86_400_000 * 14).toISOString(),
          currentPeriodEnd: new Date(Date.now() + 86_400_000 * 365).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      plans: [
        { code: "monthly", nameAr: "الخطة الشهرية", nameEn: "Monthly Plan", priceEgp: 19, billingInterval: "month", trialDays: 14, isActive: true },
        { code: "yearly", nameAr: "الخطة السنوية", nameEn: "Yearly Plan", priceEgp: 149, billingInterval: "year", trialDays: 14, isActive: true },
      ],
      cachedAt: Date.now(),
    };
    await desktopCtx.addInitScript(makeOfflineBundleScript(), bundleArg);
    const page = await desktopCtx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const splash = page.locator('[data-testid="mizan-splash"]');
    if ((await splash.count()) > 0) {
      await splash.click().catch(() => {});
      await splash.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    }

    await page.waitForSelector("aside", { timeout: 10_000 });
    assert.equal(await page.locator("html").getAttribute("lang"), "ar");
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await page.locator("aside").isVisible(), true);

    const perfCount = await page.evaluate(() => {
      const raw = localStorage.getItem("mizan.perf.v1");
      return raw ? JSON.parse(raw).length : 0;
    });
    assert.ok(perfCount >= 1);

    // 2. Add multi-currency transaction with frozen rate in personal workspace
    await page.getByRole("button", { name: "+ مصروف سريع" }).click();
    await page.getByLabel("المبلغ").fill("150");
    await page.getByLabel("العملة").selectOption("USD");
    await page.getByLabel("سعر الصرف").fill("50");
    await page.getByRole("button", { name: "حفظ" }).click();

    await page.locator("aside").getByRole("button", { name: "السجل" }).click();
    await page.waitForSelector("text=USD", { timeout: 5000 });

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

    // 4. Switch to second workspace -> confirm E2E Lunch is strictly isolated per tenant!
    await page.getByRole("button", { name: /تبديل مساحة العمل/ }).click();
    await page.getByRole("button", { name: /شركة النور/ }).click();
    await page.locator("aside").getByRole("button", { name: "السجل" }).click();
    assert.equal(await page.locator("text=E2E Lunch").count(), 0);

    // Switch back to personal workspace -> data & outbox remain persisted
    await page.getByRole("button", { name: /تبديل مساحة العمل/ }).click();
    await page.getByRole("button", { name: /مساحتي الشخصية/ }).click();
    await page.locator("aside").getByRole("button", { name: "السجل" }).click();
    await page.waitForSelector("text=E2E Lunch", { timeout: 5000 });

    // 5. Open Workspace Settings & Plan + Super-Admin route
    await page.locator("aside").getByRole("button", { name: /المساحة والأعضاء/ }).click();
    await page.getByRole("button", { name: "الاشتراك" }).click();
    await page.waitForSelector("text=الخطة الشهرية", { timeout: 5000 });
    await page.waitForSelector("text=الخطة السنوية", { timeout: 5000 });

    await page.locator("aside").getByRole("button", { name: /لوحة المنصة/ }).click();
    await page.waitForSelector("text=لوحة تحكم المنصة", { timeout: 5000 });

    // 6. Switch to More -> toggle English + Arabic-Indic numerals + analytics opt-out
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

    // 7. Mobile viewport (390x844): bottom tab-bar visible, no horizontal overflow
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mobileCtx.addInitScript(makeOfflineBundleScript(), bundleArg);
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
