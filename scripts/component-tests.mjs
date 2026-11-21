import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { GlobalWindow } from "happy-dom";

// Install happy-dom globals BEFORE importing React or @testing-library/react
const win = new GlobalWindow({ url: "http://localhost:8080/" });
const SKIP_KEYS = new Set([
  "undefined",
  "NaN",
  "Infinity",
  "global",
  "globalThis",
  "window",
  "self",
  "console",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "structuredClone",
  "crypto",
  "performance",
  "fetch",
  "Headers",
  "Request",
  "Response",
  "AbortController",
  "AbortSignal",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "Blob",
  "File",
]);

for (const key of Object.getOwnPropertyNames(win)) {
  if (SKIP_KEYS.has(key) || key in globalThis) continue;
  try {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: win[key],
    });
  } catch {
    /* skip non-configurable host symbols */
  }
}

const defineGlobal = (key, value) => {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
};

defineGlobal("window", win);
defineGlobal("document", win.document);
defineGlobal("navigator", win.navigator);
defineGlobal("localStorage", win.localStorage);
defineGlobal("sessionStorage", win.sessionStorage);
defineGlobal("HTMLElement", win.HTMLElement);
defineGlobal("Element", win.Element);
defineGlobal("Node", win.Node);
defineGlobal("Event", win.Event);
defineGlobal("CustomEvent", win.CustomEvent);
defineGlobal("MouseEvent", win.MouseEvent);
defineGlobal("KeyboardEvent", win.KeyboardEvent);
defineGlobal("getComputedStyle", win.getComputedStyle.bind(win));
defineGlobal("requestAnimationFrame", (cb) => setTimeout(() => cb(Date.now()), 0));
defineGlobal("cancelAnimationFrame", (id) => clearTimeout(id));
const reducedMatchMedia = () => ({
  matches: true,
  media: "(prefers-reduced-motion: reduce)",
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
win.matchMedia = reducedMatchMedia;
defineGlobal("matchMedia", reducedMatchMedia);
defineGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const stubFetch = async (input) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  if (url.includes("supabase.co")) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`Unexpected fetch in component test: ${url}`);
};
win.fetch = stubFetch;
defineGlobal("fetch", stubFetch);

const React = await import("react");
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { createServer } = await import("vite");
const viteReact = (await import("@vitejs/plugin-react")).default;

const ROOT = process.cwd();
let viteServer;

test.before(async () => {
  viteServer = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: "silent",
    plugins: [viteReact()],
    resolve: {
      alias: {
        "@": path.join(ROOT, "src"),
      },
    },
    optimizeDeps: { noDiscovery: true },
    ssr: {
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@testing-library/react",
        "zustand",
        "lucide-react",
        "sonner",
        "gsap",
        "@gsap/react",
        "@radix-ui/react-dialog",
      ],
    },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
});

test.after(async () => {
  cleanup();
  try {
    const { getSupabaseClient } = await viteServer.ssrLoadModule("/src/lib/supabase/client.ts");
    await getSupabaseClient().auth.stopAutoRefresh();
  } catch {
    /* ignore */
  }
  if (viteServer) await viteServer.close();
  try {
    await win.happyDOM?.abort();
  } catch {
    /* ignore */
  }
  await win.close();
});

test.afterEach(async () => {
  cleanup();
  const { clearFinanceTenantScope } = await viteServer.ssrLoadModule("/src/lib/finance/store.ts");
  clearFinanceTenantScope();
  win.localStorage.clear();
  win.sessionStorage.clear();
  win.document.documentElement.lang = "ar";
  win.document.documentElement.dir = "rtl";
});

function makeTestSession(overrides = {}) {
  const defaultTenant = {
    id: "t-personal-1",
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
  };
  return {
    user: { id: "u-test-1", email: "zyad@mizan.test", displayName: "زياد جمال" },
    isSuperAdmin: false,
    workspaces: [defaultTenant],
    activeTenantId: defaultTenant.id,
    plans: [
      { code: "monthly", nameAr: "باقة شهر واحد", nameEn: "1 Month Plan", priceEgp: 29, billingInterval: "month", durationDays: 30, trialDays: 0, sortOrder: 1, isActive: true },
      { code: "quarterly", nameAr: "باقة 3 أشهر", nameEn: "3 Months Plan", priceEgp: 75, billingInterval: "quarter", durationDays: 90, trialDays: 0, sortOrder: 2, isActive: true },
      { code: "semiannual", nameAr: "باقة 6 أشهر", nameEn: "6 Months Plan", priceEgp: 135, billingInterval: "semiannual", durationDays: 180, trialDays: 0, sortOrder: 3, isActive: true },
      { code: "yearly", nameAr: "باقة سنة كاملة", nameEn: "1 Year Plan", priceEgp: 240, billingInterval: "year", durationDays: 365, trialDays: 0, sortOrder: 4, isActive: true },
    ],
    ...overrides,
  };
}

test("SplashScreen renders Mizan SVG mark and dismisses cleanly on tap / reduced-motion", async () => {
  const { SplashScreen } = await viteServer.ssrLoadModule("/src/components/finance/splash-screen.tsx");
  let doneCalled = 0;
  render(
    React.createElement(SplashScreen, {
      onDone: () => {
        doneCalled += 1;
      },
    }),
  );
  const splash = screen.getByTestId("mizan-splash");
  assert.ok(splash);
  fireEvent.click(splash);
  await waitFor(() => {
    assert.ok(doneCalled >= 1);
  });
});

test("MizanRoot renders AuthScreen when unauthenticated and supports invite code prefill", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  render(React.createElement(MizanRoot, { skipSplash: true, requestedInviteCode: "MZN-TEAM-2026" }));

  await waitFor(() => {
    assert.ok(screen.getByText("ميزان لإدارة أموالك"));
  });
  const inviteInput = screen.getByPlaceholderText("MZN-XXXX-XXXX");
  assert.equal(inviteInput.value, "MZN-TEAM-2026");
});

test("MizanRoot defaults to Arabic RTL, records boot metrics, and navigates tabs", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { loadPerfMetrics } = await viteServer.ssrLoadModule("/src/lib/finance/perf-metrics.ts");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  win.localStorage.setItem("mizan.tenant.t-personal-1.v1", JSON.stringify(seedData()));

  render(React.createElement(MizanRoot, { skipSplash: true, initialSession: makeTestSession() }));
  assert.equal(win.document.documentElement.lang, "ar");
  assert.equal(win.document.documentElement.dir, "rtl");
  assert.ok(screen.getAllByText("اليوم").length >= 1);
  assert.ok(loadPerfMetrics().length >= 1);

  // Switch to Ledger tab
  const ledgerBtn = screen.getAllByRole("button", { name: "السجل" })[0];
  fireEvent.click(ledgerBtn);
  await waitFor(() => {
    assert.ok(screen.getAllByPlaceholderText("بحث في الحركات").length >= 1);
  });

  // Switch to More tab
  const moreBtn = screen.getAllByRole("button", { name: "أكثر" })[0];
  fireEvent.click(moreBtn);
  await waitFor(() => {
    assert.ok(screen.getByText("المزيد"));
  });
});

test("HomeScreen shows on-device analytics and respects explicit opt-out toggle", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  win.localStorage.setItem("mizan.tenant.t-personal-1.v1", JSON.stringify(seedData()));

  render(React.createElement(MizanRoot, { skipSplash: true, initialSession: makeTestSession() }));
  await waitFor(() => {
    assert.ok(screen.getByText("تحليلات محلية"));
  });
  assert.ok(screen.getByText("متوسط الإنفاق اليومي"));

  // Navigate to More and toggle analytics off
  fireEvent.click(screen.getAllByRole("button", { name: "أكثر" })[0]);
  await waitFor(() => {
    assert.ok(screen.getByRole("switch", { name: "تحليلات الإنفاق المحلية" }));
  });
  fireEvent.click(screen.getByRole("switch", { name: "تحليلات الإنفاق المحلية" }));

  // Navigate back to Home and verify analytics are disabled with opt-in prompt
  fireEvent.click(screen.getAllByRole("button", { name: "اليوم" })[0]);
  await waitFor(() => {
    assert.ok(screen.getByText("التحليلات المحلية متوقفة بناءً على اختيارك"));
    assert.equal(screen.queryByText("متوسط الإنفاق اليومي"), null);
  });
});

test("MoreScreen toggles English LTR and Arabic-Indic numerals live", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  win.localStorage.setItem("mizan.tenant.t-personal-1.v1", JSON.stringify(seedData()));

  render(React.createElement(MizanRoot, { skipSplash: true, initialSession: makeTestSession() }));
  fireEvent.click(screen.getAllByRole("button", { name: "أكثر" })[0]);
  await waitFor(() => {
    assert.ok(screen.getByRole("tab", { name: "English" }));
  });

  fireEvent.click(screen.getByRole("tab", { name: "English" }));
  await waitFor(() => {
    assert.equal(win.document.documentElement.lang, "en");
    assert.equal(win.document.documentElement.dir, "ltr");
    assert.ok(screen.getByRole("heading", { name: "More" }));
  });

  fireEvent.click(screen.getByRole("tab", { name: /Arabic-Indic/i }));
  await waitFor(() => {
    assert.ok(screen.getAllByText(/[٠-٩]/).length >= 1);
  });
});

test("Viewer role and suspended tenants enforce read-only banners and hide write actions", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "en", numeralStyle: "latn", analyticsEnabled: true });
  win.localStorage.setItem("mizan.tenant.t-viewer.v1", JSON.stringify(seedData()));

  const viewerSession = makeTestSession({
    workspaces: [
      {
        id: "t-viewer",
        slug: "family",
        name: "Family Ledger",
        kind: "family",
        baseCurrency: "EGP",
        openingBalance: 0,
        role: "viewer",
        mode: "cloud",
        planCode: "monthly",
        subscriptionStatus: "active",
        trialEndsAt: new Date(Date.now() + 86_400_000 * 7).toISOString(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000 * 30).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ],
    activeTenantId: "t-viewer",
  });

  render(React.createElement(MizanRoot, { skipSplash: true, initialSession: viewerSession }));
  await waitFor(() => {
    assert.ok(screen.getByText(/Viewer access/i));
  });
  assert.equal(screen.queryByRole("button", { name: "Add" }), null);

  cleanup();
  win.localStorage.setItem("mizan.tenant.t-susp.v1", JSON.stringify(seedData()));
  const suspendedSession = makeTestSession({
    workspaces: [
      {
        ...viewerSession.workspaces[0],
        id: "t-susp",
        role: "owner",
        subscriptionStatus: "suspended",
      },
    ],
    activeTenantId: "t-susp",
  });

  render(React.createElement(MizanRoot, { skipSplash: true, initialSession: suspendedSession }));
  await waitFor(() => {
    assert.ok(screen.getByText(/Account Suspended by Admin/i));
  });

  cleanup();
  // Expired active subscription is automatically deactivated and locked
  win.localStorage.setItem("mizan.tenant.t-exp.v1", JSON.stringify(seedData()));
  const expiredSession = makeTestSession({
    workspaces: [
      {
        ...viewerSession.workspaces[0],
        id: "t-exp",
        role: "owner",
        subscriptionStatus: "active",
        currentPeriodEnd: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    activeTenantId: "t-exp",
  });

  render(React.createElement(MizanRoot, { skipSplash: true, initialSession: expiredSession }));
  await waitFor(() => {
    assert.ok(screen.getByText(/Subscription Period Ended — Account Auto-Deactivated/i));
  });
});

test("Multi-tenant workspace switcher isolates data across workspaces and opens tenant billing & Super-Admin", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "en", numeralStyle: "latn", analyticsEnabled: true });
  const seed = seedData();
  win.localStorage.setItem(
    "mizan.tenant.t-one.v1",
    JSON.stringify({
      ...seed,
      txns: [
        {
          id: "tx-t1",
          kind: "expense",
          amount: 111,
          categoryId: "c-food",
          note: "Tenant One Coffee",
          date: seed.txns[0]?.date ?? "2026-11-14",
          createdAt: Date.now(),
        },
      ],
    }),
  );
  win.localStorage.setItem(
    "mizan.tenant.t-two.v1",
    JSON.stringify({
      ...seed,
      txns: [
        {
          id: "tx-t2",
          kind: "expense",
          amount: 999,
          categoryId: "c-food",
          note: "Tenant Two Rent",
          date: seed.txns[0]?.date ?? "2026-11-14",
          createdAt: Date.now(),
        },
      ],
    }),
  );

  const session = makeTestSession({
    isSuperAdmin: true,
    workspaces: [
      {
        id: "t-one",
        slug: "personal",
        name: "Alpha Space",
        kind: "personal",
        baseCurrency: "EGP",
        openingBalance: 0,
        role: "owner",
        mode: "cloud",
        planCode: "monthly",
        subscriptionStatus: "trialing",
        trialEndsAt: new Date(Date.now() + 86_400_000 * 14).toISOString(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000 * 14).toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: "t-two",
        slug: "company",
        name: "Beta Co",
        kind: "business",
        baseCurrency: "EGP",
        openingBalance: 0,
        role: "admin",
        mode: "local",
        planCode: "yearly",
        subscriptionStatus: "active",
        trialEndsAt: new Date(Date.now() + 86_400_000 * 14).toISOString(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000 * 365).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ],
    activeTenantId: "t-one",
  });

  render(React.createElement(MizanRoot, { skipSplash: true, initialSession: session }));
  fireEvent.click(screen.getAllByRole("button", { name: "Ledger" })[0]);
  await waitFor(() => {
    assert.ok(screen.getByText("Tenant One Coffee"));
    assert.equal(screen.queryByText("Tenant Two Rent"), null);
  });

  // Switch workspace to Beta Co via switcher
  fireEvent.click(screen.getByRole("button", { name: /Switch Workspace/i }));
  const betaBtn = await screen.findByText("Beta Co");
  fireEvent.click(betaBtn);

  fireEvent.click(screen.getAllByRole("button", { name: "Ledger" })[0]);
  await waitFor(() => {
    assert.ok(screen.getByText("Tenant Two Rent"));
    assert.equal(screen.queryByText("Tenant One Coffee"), null);
  });

  // Open Workspace Settings -> Plan tab shows all 4 affordable packages
  fireEvent.click(screen.getByRole("button", { name: /Workspace & Members/i }));
  const planTab = await screen.findByRole("button", { name: "Plan" });
  fireEvent.click(planTab);
  await waitFor(() => {
    assert.ok(screen.getAllByText(/1 Month/).length >= 1);
    assert.ok(screen.getAllByText(/3 Months/).length >= 1);
    assert.ok(screen.getAllByText(/6 Months/).length >= 1);
    assert.ok(screen.getAllByText(/1 Year/).length >= 1);
  });

  // Open Super-Admin Console (visible because isSuperAdmin=true)
  fireEvent.click(screen.getByRole("button", { name: /Super-Admin/i }));
  await waitFor(() => {
    assert.ok(screen.getByText(/Subscriptions & Billing Console/));
  });
});

test("TxnForm saves multi-currency transaction with frozen exchange rate and baseAmount", async () => {
  const { TxnForm } = await viteServer.ssrLoadModule("/src/components/finance/forms.tsx");
  const { MizanContext } = await viteServer.ssrLoadModule("/src/components/finance/context.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { useFinance } = await viteServer.ssrLoadModule("/src/lib/finance/store.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "en", numeralStyle: "latn", analyticsEnabled: true });
  useFinance.getState().replaceAll({ ...seedData(), txns: [], currency: "EGP" });

  let closed = false;
  const ctxVal = {
    tab: "home",
    setTab: () => {},
    month: "2026-11",
    shiftMonth: () => {},
    route: { name: "main" },
    openPerson: () => {},
    openDebt: () => {},
    openReport: () => {},
    openGoals: () => {},
    openGoal: () => {},
    openWallets: () => {},
    openRecurring: () => {},
    openNotifications: () => {},
    openDrive: () => {},
    openSecurity: () => {},
    openDebtsFiltered: () => {},
    openLedgerFiltered: () => {},
    debtFilter: "open",
    setDebtFilter: () => {},
    ledgerCategoryFilter: "",
    setLedgerCategoryFilter: () => {},
    back: () => {},
    sheet: { kind: "txn" },
    openSheet: () => {},
    closeSheet: () => {
      closed = true;
    },
    query: "",
    setQuery: () => {},
    frame: null,
    pinHash: null,
    setPinHash: () => {},
  };

  render(React.createElement(MizanContext.Provider, { value: ctxVal }, React.createElement(TxnForm, {})));

  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "200" } });
  fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "USD" } });
  const rateInput = await screen.findByLabelText("Exchange Rate");
  fireEvent.change(rateInput, { target: { value: "50" } });

  await waitFor(() => {
    assert.ok(screen.getByText(/10,000 EGP/));
  });

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    assert.equal(useFinance.getState().txns.length, 1);
  });

  const saved = useFinance.getState().txns[0];
  assert.equal(saved.currency, "USD");
  assert.equal(saved.exchangeRate, 50);
  assert.equal(saved.baseAmount, 10000);
  assert.equal(closed, true);
});

test("CsvImportSheet parses pasted CSV rows and imports into finance store", async () => {
  const { CsvImportSheet } = await viteServer.ssrLoadModule("/src/components/finance/csv-import-sheet.tsx");
  const { MizanContext } = await viteServer.ssrLoadModule("/src/components/finance/context.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { useFinance } = await viteServer.ssrLoadModule("/src/lib/finance/store.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "en", numeralStyle: "latn", analyticsEnabled: true });
  useFinance.getState().replaceAll({ ...seedData(), txns: [], currency: "EGP" });

  let closed = false;
  const ctxVal = {
    tab: "ledger",
    setTab: () => {},
    month: "2026-11",
    shiftMonth: () => {},
    route: { name: "main" },
    openPerson: () => {},
    openDebt: () => {},
    openReport: () => {},
    openGoals: () => {},
    openGoal: () => {},
    openWallets: () => {},
    openRecurring: () => {},
    openNotifications: () => {},
    openDrive: () => {},
    openSecurity: () => {},
    openDebtsFiltered: () => {},
    openLedgerFiltered: () => {},
    debtFilter: "open",
    setDebtFilter: () => {},
    ledgerCategoryFilter: "",
    setLedgerCategoryFilter: () => {},
    back: () => {},
    sheet: { kind: "csv-import" },
    openSheet: () => {},
    closeSheet: () => {
      closed = true;
    },
    query: "",
    setQuery: () => {},
    frame: null,
    pinHash: null,
    setPinHash: () => {},
  };

  render(React.createElement(MizanContext.Provider, { value: ctxVal }, React.createElement(CsvImportSheet, {})));

  const csvSample = [
    "Date,Type,Amount,Currency,Rate,Category,Note",
    "2026-11-12,expense,30,USD,50,طعام,Airport coffee",
    "2026-11-13,income,5000,EGP,1,راتب,Bonus",
  ].join("\n");

  const textarea = screen.getByLabelText("Paste CSV text");
  fireEvent.change(textarea, { target: { value: csvSample } });

  const importBtn = await screen.findByRole("button", { name: /Import/i });
  fireEvent.click(importBtn);

  await waitFor(() => {
    assert.equal(useFinance.getState().txns.length, 2);
  });
  assert.equal(closed, true);
});

test("ErrorBoundary catches crashes with recovery UI and scrubs financial data from error log", async () => {
  const { ErrorBoundary } = await viteServer.ssrLoadModule("/src/components/finance/error-boundary.tsx");
  const { clearErrorLogs, loadErrorLogs } = await viteServer.ssrLoadModule("/src/lib/finance/error-log.ts");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { useFinance } = await viteServer.ssrLoadModule("/src/lib/finance/store.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "en", numeralStyle: "latn", analyticsEnabled: true });
  useFinance.getState().replaceAll(seedData());
  clearErrorLogs();

  let shouldThrow = true;
  function BuggyView() {
    if (shouldThrow) {
      throw new Error("Render crash for سارة محمود balance 8500 EGP note: secret rent");
    }
    return React.createElement("div", { "data-testid": "recovered-ok" }, "Recovered Screen");
  }

  const origConsoleError = console.error;
  console.error = () => {};
  try {
    render(
      React.createElement(
        ErrorBoundary,
        { scopeName: "test-screen", routeName: "home", tabName: "home" },
        React.createElement(BuggyView),
      ),
    );

    const fallback = screen.getByTestId("mizan-error-boundary");
    assert.ok(fallback);
    assert.ok(screen.getByText("Something went wrong"));

    const logs = loadErrorLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].message.includes("8500"), false);
    assert.equal(logs[0].message.includes("سارة محمود"), false);
    assert.equal(logs[0].message.includes("secret rent"), false);

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    await waitFor(() => {
      assert.ok(screen.getByTestId("recovered-ok"));
    });
  } finally {
    console.error = origConsoleError;
  }
});

test("AuthScreen supports Email-or-Phone login, 2-step New Account Registration with 4 packages + payment proof, and Forgot Password", async () => {
  const { AuthScreen } = await viteServer.ssrLoadModule("/src/components/finance/auth-screen.tsx");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  render(React.createElement(AuthScreen, {}));

  // Sign-in tab accepts email or phone
  assert.ok(screen.getByText(/البريد الإلكتروني أو رقم الهاتف/));
  assert.equal(screen.queryByText(/Google/i), null);

  // Click "تسجيل حساب جديد" -> Step 1 shows Email/Phone, Password, and 4 packages (1m / 3m / 6m / 1y)
  fireEvent.click(screen.getByRole("button", { name: "تسجيل حساب جديد" }));
  await waitFor(() => {
    assert.ok(screen.getByText(/اختر باقة الاشتراك المناسبة لك/));
    assert.ok(screen.getAllByText(/شهر واحد/).length >= 1);
    assert.ok(screen.getAllByText(/3 أشهر/).length >= 1);
    assert.ok(screen.getAllByText(/6 أشهر/).length >= 1);
    assert.ok(screen.getAllByText(/سنة كاملة/).length >= 1);
  });

  // Fill Egyptian phone + password and advance directly to Step 2 ("الدفع").
  // Account activation happens via Super-Admin approval of the transfer receipt.
  fireEvent.change(screen.getByPlaceholderText("010xxxxxxxx أو name@mail.com"), {
    target: { value: "01012345678" },
  });
  assert.equal(screen.queryByText(/البريد الإلكتروني لتأكيد الحساب/), null);
  fireEvent.change(screen.getByPlaceholderText("••••••••"), {
    target: { value: "secret123" },
  });
  fireEvent.click(screen.getByRole("button", { name: /الدفع \(/ }));

  await waitFor(() => {
    assert.ok(screen.getByText(/اضغط لرفع صورة التحويل/));
    assert.ok(screen.getByText(/تم الدفع — إرسال طلب التفعيل للمالك/));
  });

  // Switch back to sign-in and verify forgot password
  fireEvent.click(screen.getByRole("button", { name: /تسجيل الدخول/ }));
  fireEvent.click(screen.getByRole("button", { name: "نسيت كلمة المرور؟" }));
  await waitFor(() => {
    assert.ok(screen.getByText("استعادة كلمة المرور"));
  });
});

test("SuperAdminScreen renders payment proof review, subscription expiration controls, 4-package pricing, and accounts directory", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  win.localStorage.setItem("mizan.tenant.t-personal-1.v1", JSON.stringify(seedData()));

  render(
    React.createElement(MizanRoot, {
      skipSplash: true,
      initialRoute: { name: "admin" },
      initialSession: makeTestSession({ isSuperAdmin: true }),
    }),
  );

  await waitFor(() => {
    assert.ok(screen.getByText(/إدارة الاشتراكات والمدفوعات \(المالك\)/));
  });

  fireEvent.click(screen.getByRole("button", { name: /التحكم بالاشتراكات/ }));
  await waitFor(() => {
    assert.ok(screen.getByText(/منتهي ومعطّل/));
  });

  fireEvent.click(screen.getByRole("button", { name: /الباقات والدفع/ }));
  await waitFor(() => {
    assert.ok(screen.getByText(/أسعار الباقات الأربع/));
  });

  fireEvent.click(screen.getByRole("button", { name: /الحسابات/ }));
  await waitFor(() => {
    assert.ok(screen.getByText(/إنشاء حساب مشترك يدوياً/));
  });
});

test("TenantSettingsScreen Billing tab shows 4 packages and transfer screenshot renewal for subscribers", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  win.localStorage.setItem("mizan.tenant.t-personal-1.v1", JSON.stringify(seedData()));

  render(
    React.createElement(MizanRoot, {
      skipSplash: true,
      initialRoute: { name: "tenant" },
      initialSession: makeTestSession({ isSuperAdmin: false }),
    }),
  );

  const billingTab = await screen.findByRole("button", { name: "الاشتراك" });
  fireEvent.click(billingTab);

  await waitFor(() => {
    assert.ok(screen.getByText(/تجديد الاشتراك ورفع إيصال التحويل/));
  });
});

test("HomeScreen renders Apple Wallet cards with direct rename buttons and /appledesign1 Design Studio", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({
    language: "ar",
    numeralStyle: "latn",
    analyticsEnabled: true,
    appleTheme: "liquid-glass",
    colorMode: "system",
    cardsSectionTitle: "",
  });
  win.localStorage.setItem("mizan.tenant.t-personal-1.v1", JSON.stringify(seedData()));

  render(
    React.createElement(MizanRoot, {
      skipSplash: true,
      initialSession: makeTestSession({ isSuperAdmin: false }),
    }),
  );

  // Direct rename button right on the Cash card on HomeScreen
  const editCashBtn = await screen.findByRole("button", { name: /تعديل اسم وتصميم كاش/ });
  fireEvent.click(editCashBtn);

  const nameInput = await screen.findByPlaceholderText(/بطاقة البنك الأهلي/);
  fireEvent.change(nameInput, { target: { value: "بطاقة البنك الأهلي المصري" } });
  fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

  await waitFor(() => {
    assert.ok(screen.getByText("بطاقة البنك الأهلي المصري"));
  });

  // Open /appledesign1 Design Studio and switch to Titanium Pro
  const openStudioBtn = screen.getByRole("button", { name: /تصميمات Apple وتعديل البطاقات/ });
  fireEvent.click(openStudioBtn);

  const titaniumThemeBtn = await screen.findByRole("button", { name: /تيتانيوم برو الفاخر/ });
  fireEvent.click(titaniumThemeBtn);

  assert.equal(win.document.documentElement.dataset.appleTheme, "titanium-pro");
});

test("MizanRoot boots cleanly even when Android MizanNative bridge throws on consumeLaunchUrl", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");

  win.MizanNative = {
    consumeLaunchUrl() {
      throw new Error("Java exception was raised during method invocation");
    },
    setSystemBarStyle() {
      throw new Error("Java exception was raised during method invocation");
    },
  };

  try {
    render(React.createElement(MizanRoot, { skipSplash: true }));
    const heading = await screen.findByText(/ميزان لإدارة أموالك/);
    assert.ok(heading);
    assert.equal(win.document.querySelector("[data-testid=mizan-error-boundary]"), null);
  } finally {
    delete win.MizanNative;
  }
});

test("ApkUpdateBanner renders blocking modal for [CRITICAL] release and opens external download", async () => {
  const { ApkUpdateBanner } = await viteServer.ssrLoadModule(
    "/src/components/finance/apk-update-banner.tsx",
  );
  const { triggerManualApkUpdateCheck } = await viteServer.ssrLoadModule(
    "/src/lib/update/apk-updater.ts",
  );

  let openedUrl = "";
  const originalFetch = globalThis.fetch;
  win.MizanNative = {
    getAppVersion: () => "2.0.80",
    openExternalUrl: (url) => {
      openedUrl = url;
      return true;
    },
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        tag_name: "v2.0.95",
        name: "Mizan Finance v2.0.95 [CRITICAL]",
        body: "تحديث أمني حرج ومزامنة فورية",
        draft: false,
        prerelease: false,
        assets: [
          {
            name: "mizan-finance-release.apk",
            browser_download_url:
              "https://github.com/zyadgfh/mizan-finance-original/releases/download/v2.0.95/mizan-finance-release.apk",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    render(React.createElement(ApkUpdateBanner));
    await waitFor(() => {
      triggerManualApkUpdateCheck();
      assert.ok(screen.getByText(/يلزم تحديث تطبيق ميزان للمتابعة/));
    });

    const downloadBtn = screen.getByRole("button", { name: /تحميل التحديث الإجباري الآن/ });
    fireEvent.click(downloadBtn);
    assert.equal(
      openedUrl,
      "https://github.com/zyadgfh/mizan-finance-original/releases/download/v2.0.95/mizan-finance-release.apk",
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete win.MizanNative;
    win.sessionStorage.clear();
  }
});

test("AuthScreen allows Egyptian phone signup to proceed to payment step without requiring a separate email", async () => {
  const { AuthScreen } = await viteServer.ssrLoadModule("/src/components/finance/auth-screen.tsx");

  render(React.createElement(AuthScreen));
  fireEvent.click(screen.getAllByRole("button", { name: /تسجيل حساب جديد/ })[0]);

  const phoneInput = await screen.findByPlaceholderText(/010xxxxxxxx/);
  fireEvent.change(phoneInput, { target: { value: "01012345678" } });

  const passInput = screen.getByPlaceholderText("••••••••");
  fireEvent.change(passInput, { target: { value: "StrongPass123" } });

  const nextBtn = screen.getByRole("button", { name: /الدفع \(/ });
  fireEvent.click(nextBtn);

  // Advances directly to step 2 (payment proof) without asking for an email
  const proofPrompt = await screen.findByText(/اختر وسيلة التحويل/);
  assert.ok(proofPrompt);
});

test("Phase 2: Offline SmartCaptureSheet records InstaPay SMS and ZakatScreen computes net-worth Zakat", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { useFinance } = await viteServer.ssrLoadModule("/src/lib/finance/store.ts");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  const base = seedData();
  const seeded = {
    ...base,
    demo: false,
    currency: "EGP",
    wallets: [
      { id: "w-insta", name: "إنستا باي", kind: "instapay", opening: 450000, createdAt: 1 },
    ],
    txns: [],
    debts: [],
    payments: [],
  };
  win.localStorage.setItem("mizan.tenant.t-personal-1.v1", JSON.stringify(seeded));

  render(
    React.createElement(MizanRoot, {
      skipSplash: true,
      initialSession: makeTestSession({ isSuperAdmin: false }),
    }),
  );

  // Open Smart Capture from HomeScreen
  const smartBtn = await screen.findByRole("button", { name: /التقاط ذكي للرسائل والإيصالات/ });
  fireEvent.click(smartBtn);

  const smsBox = await screen.findByLabelText(/نص الرسالة أو الجملة السريعة/);
  fireEvent.change(smsBox, {
    target: { value: "تم تحويل مبلغ 750 ج.م بنجاح عبر إنستاباي إلى كافيه" },
  });

  const recordBtn = await screen.findByRole("button", { name: /تسجيل الحركة فوراً بضغطة واحدة/ });
  fireEvent.click(recordBtn);

  await waitFor(() => {
    const txns = useFinance.getState().txns;
    assert.equal(txns.length, 1);
    assert.equal(txns[0].amount, 750);
    assert.equal(txns[0].walletId, "w-insta");
  });

  // Navigate to More -> Zakat Calculator
  const moreTab = screen.getAllByRole("button", { name: "أكثر" })[0];
  fireEvent.click(moreTab);

  const zakatRow = await screen.findByText(/حاسبة زكاة المال الشرعية/);
  fireEvent.click(zakatRow);

  await waitFor(() => {
    assert.ok(screen.getByText(/بلغ النصاب/));
    assert.ok(screen.getByText(/صافي الوعاء الزكوي/));
  });
});

test("Phase 3: Non-intrusive live sync preserves open TxnForm draft and SecurityScreen enables AES-256-GCM encryption", async () => {
  const { MizanRoot } = await viteServer.ssrLoadModule("/src/components/finance/app.tsx");
  const { applySyncedTenantData, useFinance } = await viteServer.ssrLoadModule("/src/lib/finance/store.ts");
  const { seedData } = await viteServer.ssrLoadModule("/src/lib/finance/seed.ts");
  const { hashPin, writePinHash } = await viteServer.ssrLoadModule("/src/lib/finance/pin.ts");
  const { isEncryptedLedgerEnvelope, resetLedgerCryptoForTests } = await viteServer.ssrLoadModule(
    "/src/lib/finance/ledger-crypto.ts",
  );
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  resetLedgerCryptoForTests();
  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  const base = { ...seedData(), demo: false };
  win.localStorage.setItem("mizan.tenant.t-personal-1.v1", JSON.stringify(base));

  render(
    React.createElement(MizanRoot, {
      skipSplash: true,
      initialSession: makeTestSession({ isSuperAdmin: false }),
    }),
  );

  // 1. Open Add Transaction form and type a draft amount ("321")
  const addBtns = await screen.findAllByRole("button", { name: "إضافة" });
  fireEvent.click(addBtns[0]);

  const amountInput = await screen.findByLabelText("المبلغ");
  fireEvent.change(amountInput, { target: { value: "321" } });
  assert.equal(amountInput.value, "321");

  // Simulate Realtime background merge arriving from another member while TxnForm is open!
  applySyncedTenantData("t-personal-1", {
    ...base,
    txns: [
      {
        id: "tx-realtime-1",
        kind: "income",
        amount: 9000,
        categoryId: "c-salary",
        note: "تحويل فوري من شريك المساحة",
        date: "2026-11-20",
        walletId: "w-cash",
        createdAt: Date.now(),
      },
    ],
  });

  // Open form MUST remain open with "321" untouched while store absorbed the remote transaction!
  assert.equal(amountInput.value, "321");
  assert.equal(useFinance.getState().txns.some((t) => t.id === "tx-realtime-1"), true);

  // Unmount first tree, set PIN, and mount SecurityScreen to test AES-256-GCM toggle
  cleanup();
  const pinHash = await hashPin("4321");
  writePinHash(pinHash);

  // Re-mount cleanly at security route to test SecurityScreen AES-256-GCM toggle
  const { SecurityScreen } = await viteServer.ssrLoadModule("/src/components/finance/security-screen.tsx");
  const { MizanContext } = await viteServer.ssrLoadModule("/src/components/finance/context.tsx");

  render(
    React.createElement(
      MizanContext.Provider,
      {
        value: {
          tab: "more",
          setTab: () => {},
          month: "2026-11",
          shiftMonth: () => {},
          route: { name: "security" },
          openPerson: () => {},
          openDebt: () => {},
          openReport: () => {},
          openGoals: () => {},
          openGoal: () => {},
          openWallets: () => {},
          openRecurring: () => {},
          openNotifications: () => {},
          openDrive: () => {},
          openSecurity: () => {},
          openZakat: () => {},
          openTenant: () => {},
          openAdmin: () => {},
          openDebtsFiltered: () => {},
          openLedgerFiltered: () => {},
          debtFilter: "open",
          setDebtFilter: () => {},
          ledgerCategoryFilter: "",
          setLedgerCategoryFilter: () => {},
          back: () => {},
          sheet: null,
          openSheet: () => {},
          closeSheet: () => {},
          query: "",
          setQuery: () => {},
          frame: null,
          pinHash,
          setPinHash: () => {},
        },
      },
      React.createElement(SecurityScreen),
    ),
  );

  const strictBtn = await screen.findByRole("button", { name: /فائق الأمان برمز PIN فقط/ });
  fireEvent.click(strictBtn);

  const pinConfirm = await screen.findByLabelText("تأكيد رمز PIN للتشفير");
  fireEvent.change(pinConfirm, { target: { value: "4321" } });
  fireEvent.click(screen.getByRole("button", { name: "تأكيد وتطبيق" }));

  await waitFor(() => {
    const storedAfter = win.localStorage.getItem("mizan.tenant.t-personal-1.v1");
    assert.equal(isEncryptedLedgerEnvelope(storedAfter), true);
  });

  resetLedgerCryptoForTests();
});






