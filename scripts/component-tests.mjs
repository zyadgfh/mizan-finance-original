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
      { code: "monthly", nameAr: "الخطة الشهرية", nameEn: "Monthly Plan", priceEgp: 19, billingInterval: "month", trialDays: 14, isActive: true },
      { code: "yearly", nameAr: "الخطة السنوية", nameEn: "Yearly Plan", priceEgp: 149, billingInterval: "year", trialDays: 14, isActive: true },
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
    assert.ok(screen.getByText("ميزان متعدد المساحات"));
  });
  const inviteInput = screen.getByPlaceholderText("MZN-XXXX-YYYY");
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
    assert.ok(screen.getByText(/Workspace is suspended/i));
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

  // Open Workspace Settings -> Plan tab shows symbolic 19 EGP / 149 EGP plans
  fireEvent.click(screen.getByRole("button", { name: /Workspace & Members/i }));
  const planTab = await screen.findByRole("button", { name: "Plan" });
  fireEvent.click(planTab);
  await waitFor(() => {
    assert.ok(screen.getByText(/Monthly Plan/));
    assert.ok(screen.getByText(/Yearly Plan/));
  });

  // Open Super-Admin Console (visible because isSuperAdmin=true)
  fireEvent.click(screen.getByRole("button", { name: /Super-Admin/i }));
  await waitFor(() => {
    assert.ok(screen.getByText(/Platform Super-Admin/));
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

test("AuthScreen disables public sign-up and Google OAuth, enforcing owner-only accounts with forgot-password support", async () => {
  const { AuthScreen } = await viteServer.ssrLoadModule("/src/components/finance/auth-screen.tsx");
  const { updateUiPrefs } = await viteServer.ssrLoadModule("/src/lib/finance/prefs.ts");

  updateUiPrefs({ language: "ar", numeralStyle: "latn", analyticsEnabled: true });
  render(React.createElement(AuthScreen, {}));

  assert.ok(screen.getByText(/مالك المنصة فقط هو من ينشئ الحسابات/));
  assert.equal(screen.queryByRole("tab", { name: /إنشاء حساب/i }), null);
  assert.equal(screen.queryByText(/Google/i), null);

  fireEvent.click(screen.getByRole("button", { name: "نسيت كلمة المرور؟" }));
  await waitFor(() => {
    assert.ok(screen.getByText("استعادة كلمة المرور"));
  });
});

test("SuperAdminScreen renders owner-only account provisioning and payment confirmation tabs", async () => {
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
    assert.ok(screen.getByText(/إنشاء حساب مستخدم جديد/));
  });

  fireEvent.click(screen.getByRole("button", { name: /المدفوعات/ }));
  await waitFor(() => {
    assert.ok(screen.getByText(/طلبات تأكيد الدفع/));
  });
});

test("TenantSettingsScreen Billing tab shows manual payment reference submission for non-super-admins", async () => {
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
    assert.ok(screen.getByText(/تأكيد الدفع عبر إنستاباي أو فودافون كاش/));
  });
});

