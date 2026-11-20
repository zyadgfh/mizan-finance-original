import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeErrorRecord } from "../finance/error-log.ts";
import { APPLE_THEMES, loadUiPrefs, updateUiPrefs } from "../finance/prefs.ts";
import { seedData } from "../finance/seed.ts";
import { safeRandomUUID } from "../mobile-safe.ts";
import {
  clearFinanceTenantScope,
  hydrateTenantFinance,
  useFinance,
} from "../finance/store.ts";
import {
  diffFinanceDataToOps,
  loadActiveTenantId,
  loadCachedSessionBundle,
  loadLocalWorkspaces,
  loadTenantOutbox,
  markLegacyMizanV1Migrated,
  mergeRemoteRecordsIntoData,
  saveActiveTenantId,
  saveCachedSessionBundle,
  saveLocalWorkspaces,
  snapshotToOutboxOps,
  tenantDataKey,
  wipeAllTenantCachesOnSignOut,
  wipeTenantCache,
  type RemoteTenantRecord,
} from "./storage.ts";
import { cleanDisplayContact, normalizeSubscriberIdentity } from "./identity.ts";
import { sanitizeAuthRedirectUrl } from "./api.ts";
import {
  hasLocalPkceVerifier,
  hasMeaningfulLegacyLedgerData,
  parseSafeDeepLinkAction,
} from "./security-guards.ts";
import { getSupabaseClient, SUPABASE_AUTH_STORAGE_KEY } from "../supabase/client.ts";
import {
  canAdminRole,
  canEditWorkspace,
  canWriteRole,
  DEFAULT_SUBSCRIPTION_PLANS,
  formatRoleLabel,
  getRemainingSubscriptionDays,
  getSubscriptionAccessBlock,
  isOwnerRole,
  type TenantSummary,
} from "./types.ts";

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

function makeTenant(overrides: Partial<TenantSummary> = {}): TenantSummary {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "acme",
    name: "Acme",
    kind: "business",
    baseCurrency: "EGP",
    openingBalance: 0,
    role: "owner",
    mode: "cloud",
    planCode: "monthly",
    subscriptionStatus: "trialing",
    currentPeriodEnd: new Date(Date.now() + 86_400_000 * 14).toISOString(),
    ownerId: "user-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("RBAC and workspace edit permissions enforce 4-tier roles & suspension", () => {
  assert.equal(canEditWorkspace(makeTenant({ role: "owner", subscriptionStatus: "active" })), true);
  assert.equal(canEditWorkspace(makeTenant({ role: "admin", subscriptionStatus: "trialing" })), true);
  assert.equal(canEditWorkspace(makeTenant({ role: "member", subscriptionStatus: "active" })), true);
  assert.equal(canEditWorkspace(makeTenant({ role: "viewer", subscriptionStatus: "active" })), false);
  assert.equal(canEditWorkspace(makeTenant({ role: "owner", subscriptionStatus: "suspended" })), false);
  assert.equal(canEditWorkspace(makeTenant({ mode: "local", role: "owner" })), true);

  assert.equal(canAdminRole("owner"), true);
  assert.equal(canAdminRole("admin"), true);
  assert.equal(canAdminRole("member"), false);
  assert.equal(canAdminRole("viewer"), false);

  assert.equal(canWriteRole("owner"), true);
  assert.equal(canWriteRole("member"), true);
  assert.equal(canWriteRole("viewer"), false);
  assert.equal(isOwnerRole("owner"), true);
  assert.equal(isOwnerRole("admin"), false);

  assert.equal(formatRoleLabel("owner", "en"), "Owner");
  assert.equal(formatRoleLabel("viewer", "ar"), "مشاهد فقط");
});

test("Entity-level diff produces upserts and tombstones cleanly", () => {
  const base = seedData();
  const prev = { ...base, txns: [], people: [], debts: [], payments: [], goals: [], goalMoves: [] };
  const next = {
    ...prev,
    txns: [
      {
        id: "tx-1",
        kind: "expense" as const,
        amount: 250,
        categoryId: "c-food",
        note: "غداء",
        date: "2026-11-14",
        createdAt: 1000,
        updatedAt: 2000,
        createdBy: "u-1",
        createdByName: "Zyad",
      },
    ],
  };

  const upsertOps = diffFinanceDataToOps(prev, next, 2000);
  assert.ok(upsertOps.some((op) => op.entityType === "tx" && op.entityId === "tx-1" && op.deletedAtMs === null));

  const deleted = { ...next, txns: [] };
  const deleteOps = diffFinanceDataToOps(next, deleted, 3000);
  assert.ok(deleteOps.some((op) => op.entityType === "tx" && op.entityId === "tx-1" && typeof op.deletedAtMs === "number"));
});

test("Entity-level LWW merge keeps newer local entity and honors newer remote tombstones", () => {
  const base = seedData();
  const local = {
    ...base,
    txns: [
      {
        id: "tx-local-newer",
        kind: "expense" as const,
        amount: 300,
        categoryId: "c-food",
        note: "local newer",
        date: "2026-11-14",
        createdAt: 1000,
        updatedAt: 5000,
      },
      {
        id: "tx-remote-deleted",
        kind: "expense" as const,
        amount: 120,
        categoryId: "c-food",
        note: "to be deleted",
        date: "2026-11-14",
        createdAt: 1000,
        updatedAt: 2000,
      },
    ],
  };

  const remote: RemoteTenantRecord[] = [
    {
      entity_type: "tx",
      entity_id: "tx-local-newer",
      payload: {
        id: "tx-local-newer",
        kind: "expense",
        amount: 999,
        categoryId: "c-food",
        note: "stale remote",
        date: "2026-11-14",
        createdAt: 1000,
        updatedAt: 3000,
      },
      updated_at_ms: 3000,
      deleted_at_ms: null,
      created_by: "u-2",
      updated_by: "u-2",
      server_updated_at: new Date().toISOString(),
    },
    {
      entity_type: "tx",
      entity_id: "tx-remote-deleted",
      payload: {},
      updated_at_ms: 4000,
      deleted_at_ms: 4500,
      created_by: "u-2",
      updated_by: "u-2",
      server_updated_at: new Date().toISOString(),
    },
    {
      entity_type: "tx",
      entity_id: "tx-remote-new",
      payload: {
        id: "tx-remote-new",
        kind: "income",
        amount: 1500,
        categoryId: "c-salary",
        note: "remote income",
        date: "2026-11-14",
        createdAt: 1500,
        updatedAt: 4200,
      },
      updated_at_ms: 4200,
      deleted_at_ms: null,
      created_by: "u-2",
      created_by_name: "Partner",
      updated_by: "u-2",
      server_updated_at: new Date().toISOString(),
    },
  ];

  const merged = mergeRemoteRecordsIntoData(local, remote);
  const kept = merged.txns.find((t) => t.id === "tx-local-newer");
  assert.equal(kept?.amount, 300);
  assert.equal(kept?.note, "local newer");
  assert.equal(merged.txns.some((t) => t.id === "tx-remote-deleted"), false);
  const added = merged.txns.find((t) => t.id === "tx-remote-new");
  assert.equal(added?.amount, 1500);
  assert.equal(added?.createdByName, "Partner");
});

test("Storage isolation wipes revoked tenant and clears caches cleanly on sign-out", () => {
  const storage = new MemoryStorage();
  const t1 = makeTenant({ id: "t-1", slug: "one" });
  const t2 = makeTenant({ id: "t-2", slug: "two", mode: "local" });

  storage.setItem(tenantDataKey(t1.id), JSON.stringify({ txns: [{ id: "a" }] }));
  storage.setItem(tenantDataKey(t2.id), JSON.stringify({ txns: [{ id: "b" }] }));
  saveActiveTenantId(t1.id, storage);
  saveLocalWorkspaces("u-1", [t2], storage);
  saveCachedSessionBundle(
    {
      user: { id: "u-1", email: "a@b.com", displayName: "A" },
      workspaces: [t1],
      plans: [],
      isSuperAdmin: false,
      cachedAt: Date.now(),
    },
    storage,
  );
  markLegacyMizanV1Migrated(t1.id, storage);

  assert.equal(loadActiveTenantId(storage), "t-1");
  assert.equal(loadLocalWorkspaces("u-1", storage).length, 1);

  wipeTenantCache(t1.id, storage);
  assert.equal(storage.getItem(tenantDataKey(t1.id)), null);
  assert.ok(storage.getItem(tenantDataKey(t2.id)));

  wipeAllTenantCachesOnSignOut(storage);
  assert.equal(loadCachedSessionBundle(storage), null);
  assert.equal(loadActiveTenantId(storage), null);
  assert.equal(storage.getItem(tenantDataKey(t2.id)), null);
});

test("Store tenant scoping isolates mutations and stamps actorMeta across tenants", () => {
  const mem = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: mem });

  const queuedA: string[] = [];
  const dataA = { ...seedData(), txns: [], people: [], debts: [], payments: [] };
  hydrateTenantFinance(
    {
      tenantId: "tenant-A",
      mode: "cloud",
      actorId: "user-1",
      actorName: "زياد",
      canWrite: true,
      onOpsQueued: (ops) => queuedA.push(...ops.map((o) => `${o.entityType}:${o.entityId}`)),
    },
    dataA,
  );

  const txId = useFinance.getState().addTxn({
    kind: "expense",
    amount: 420,
    categoryId: "c-food",
    note: "قهوة الفريق",
    date: "2026-11-14",
  });
  const saved = useFinance.getState().txns.find((t) => t.id === txId);
  assert.equal(saved?.createdBy, "user-1");
  assert.equal(saved?.createdByName, "زياد");
  assert.ok(loadTenantOutbox("tenant-A", mem).length >= 1);
  assert.ok(queuedA.some((k) => k === `tx:${txId}`));

  // Switch to tenant B -> must see zero records from tenant A
  const dataB = { ...seedData(), txns: [], people: [], debts: [], payments: [] };
  hydrateTenantFinance(
    {
      tenantId: "tenant-B",
      mode: "local",
      actorId: "user-1",
      actorName: "زياد",
      canWrite: true,
    },
    dataB,
  );
  assert.equal(useFinance.getState().txns.length, 0);
  clearFinanceTenantScope();
});

test("snapshotToOutboxOps serializes full legacy snapshot and error-log scrubs JWTs & invite codes", () => {
  const ops = snapshotToOutboxOps(seedData(), 9999);
  assert.ok(ops.some((o) => o.entityType === "wallet"));
  assert.ok(ops.some((o) => o.entityType === "tx"));

  const sanitized = sanitizeErrorRecord(
    new Error("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc failed for MZN-AB12-CD34"),
    { boundary: "tenant-sync", knownPeople: ["أحمد علي"] },
  );
  assert.equal(sanitized.message.includes("eyJhbGciOiJIUzI1NiJ9"), false);
  assert.equal(sanitized.message.includes("MZN-AB12-CD34"), false);
});

test("normalizeSubscriberIdentity supports email, Egyptian mobile, Arabic digits, and international phones", () => {
  const emailRes = normalizeSubscriberIdentity("  User.Name@Gmail.COM ");
  assert.deepEqual(emailRes, {
    kind: "email",
    authEmail: "user.name@gmail.com",
    contactDisplay: "user.name@gmail.com",
    phone: null,
  });

  const egLocal = normalizeSubscriberIdentity("01036042165");
  assert.equal(egLocal?.kind, "phone");
  assert.equal(egLocal?.authEmail, "p.201036042165@phone.mizan-app.local");
  assert.equal(egLocal?.contactDisplay, "01036042165");

  const egArabic = normalizeSubscriberIdentity("٠١٠٣٦٠٤٢١٦٥");
  assert.equal(egArabic?.authEmail, "p.201036042165@phone.mizan-app.local");
  assert.equal(egArabic?.contactDisplay, "01036042165");

  const egPlus = normalizeSubscriberIdentity("+20 103 604 2165");
  assert.equal(egPlus?.authEmail, "p.201036042165@phone.mizan-app.local");

  assert.equal(cleanDisplayContact("p.201036042165@phone.mizan-app.local"), "01036042165");
  assert.equal(cleanDisplayContact("p.966501234567@phone.mizan-app.local"), "+966501234567");
  assert.equal(normalizeSubscriberIdentity("123"), null);
  assert.equal(normalizeSubscriberIdentity("bad@email"), null);
});

test("4-tier packages & automatic subscription expiration gate work accurately", () => {
  assert.deepEqual(
    DEFAULT_SUBSCRIPTION_PLANS.map((p) => p.code),
    ["monthly", "quarterly", "semiannual", "yearly"],
  );
  assert.deepEqual(
    DEFAULT_SUBSCRIPTION_PLANS.map((p) => p.durationDays),
    [30, 90, 180, 365],
  );

  // Pending new registration -> blocked until Owner confirms payment
  const pendingWs = makeTenant({ subscriptionStatus: "pending_approval" });
  assert.equal(getSubscriptionAccessBlock(pendingWs, false), "pending_approval");
  assert.equal(canEditWorkspace(pendingWs), false);

  // Active subscription whose period has ended -> auto-deactivated immediately
  const expiredActiveWs = makeTenant({
    subscriptionStatus: "active",
    currentPeriodEnd: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(getRemainingSubscriptionDays(expiredActiveWs.currentPeriodEnd), 0);
  assert.equal(getSubscriptionAccessBlock(expiredActiveWs, false), "expired");
  assert.equal(canEditWorkspace(expiredActiveWs), false);

  // Valid active subscription -> full access
  const validWs = makeTenant({
    subscriptionStatus: "active",
    currentPeriodEnd: new Date(Date.now() + 86_400_000 * 10).toISOString(),
  });
  assert.equal(getRemainingSubscriptionDays(validWs.currentPeriodEnd), 10);
  assert.equal(getSubscriptionAccessBlock(validWs, false), null);
  assert.equal(canEditWorkspace(validWs), true);

  // Super-Admin is never blocked
  assert.equal(getSubscriptionAccessBlock(expiredActiveWs, true), null);
});

test("Mobile UUID, /appledesign1 themes, and Apple Wallet card rename/customization persist cleanly", () => {
  const uuid1 = safeRandomUUID();
  const uuid2 = safeRandomUUID();
  assert.match(uuid1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(uuid1, uuid2);

  const mem = new MemoryStorage();
  assert.equal(APPLE_THEMES.length, 6);
  updateUiPrefs(
    {
      appleTheme: "titanium-pro",
      colorMode: "dark",
      cardsSectionTitle: "محافظي الذهبية",
    },
    mem,
  );
  const loadedPrefs = loadUiPrefs(mem);
  assert.equal(loadedPrefs.appleTheme, "titanium-pro");
  assert.equal(loadedPrefs.colorMode, "dark");
  assert.equal(loadedPrefs.cardsSectionTitle, "محافظي الذهبية");

  // Rename default cash wallet and add custom bank card with Apple Card skin & last4
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: mem });
  useFinance.setState(seedData());
  useFinance.getState().updateWallet("w-cash", {
    name: "كاش الجيب اليومي",
    kind: "cash",
    opening: 1500,
    cardDesign: "emerald-cash",
    subtitle: "مصروف البيت",
  });
  const cashWallet = useFinance.getState().wallets.find((w) => w.id === "w-cash");
  assert.equal(cashWallet?.name, "كاش الجيب اليومي");
  assert.equal(cashWallet?.cardDesign, "emerald-cash");
  assert.equal(cashWallet?.subtitle, "مصروف البيت");

  const newCardId = useFinance.getState().addWallet({
    name: "بطاقة CIB Platinum",
    kind: "card",
    opening: 12000,
    cardDesign: "titanium-dark",
    last4: "98421",
    subtitle: "بطاقة المشتريات",
  });
  const addedCard = useFinance.getState().wallets.find((w) => w.id === newCardId);
  assert.equal(addedCard?.name, "بطاقة CIB Platinum");
  assert.equal(addedCard?.kind, "card");
  assert.equal(addedCard?.cardDesign, "titanium-dark");
  assert.equal(addedCard?.last4, "8421");
  clearFinanceTenantScope();
});

test("Security audit client regressions: PKCE deep-link guard, redirect sanitizer, legacy migration consent, and receipt queue wipe", () => {
  // 1. Implicit-grant bearer tokens in deep-links are rejected; only PKCE code + invite code are parsed
  const maliciousImplicit = parseSafeDeepLinkAction(
    "com.mizan.finance://auth#access_token=attacker_jwt&refresh_token=attacker_rt&type=recovery",
  );
  assert.equal(maliciousImplicit.rejectedImplicitTokens, true);
  assert.equal(maliciousImplicit.pkceCode, null);

  const validPkce = parseSafeDeepLinkAction("com.mizan.finance://auth?code=pkce-auth-code-123&type=recovery");
  assert.equal(validPkce.rejectedImplicitTokens, false);
  assert.equal(validPkce.pkceCode, "pkce-auth-code-123");
  assert.equal(validPkce.linkType, "recovery");

  const inviteLink = parseSafeDeepLinkAction("https://mizan-finance-rho.vercel.app/invite/mzn-abcd-1234");
  assert.equal(inviteLink.inviteCode, "MZN-ABCD-1234");
  assert.equal(inviteLink.rejectedImplicitTokens, false);

  // 2. Local PKCE verifier check requires stored code-verifier
  const pkceMem = new MemoryStorage();
  assert.equal(hasLocalPkceVerifier(pkceMem as unknown as Storage), false);
  pkceMem.setItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`, "verifier-secret-value");
  assert.equal(hasLocalPkceVerifier(pkceMem as unknown as Storage), true);

  // 3. Auth redirect sanitizer blocks arbitrary domains & foreign *.vercel.app tenants
  assert.equal(
    sanitizeAuthRedirectUrl("https://attacker-controlled.vercel.app/steal"),
    "https://mizan-finance-rho.vercel.app/",
  );
  assert.equal(
    sanitizeAuthRedirectUrl("https://mizan-finance-evil.vercel.app/steal"),
    "https://mizan-finance-rho.vercel.app/",
  );
  assert.equal(
    sanitizeAuthRedirectUrl("https://mizan-z-zyadgams-projects.vercel.app/reset"),
    "https://mizan-z-zyadgams-projects.vercel.app/",
  );
  assert.equal(
    sanitizeAuthRedirectUrl("https://evil.example/phish"),
    "https://mizan-finance-rho.vercel.app/",
  );
  assert.equal(
    sanitizeAuthRedirectUrl("https://mizan-finance-rho.vercel.app/reset"),
    "https://mizan-finance-rho.vercel.app/",
  );
  assert.equal(sanitizeAuthRedirectUrl("com.mizan.finance://callback"), "com.mizan.finance://auth");

  // 4. Meaningful legacy data detector ignores empty seed data and flags real records
  const emptySeed = { ...seedData(), txns: [], people: [], debts: [], payments: [], goals: [], goalMoves: [], budgets: [], recurring: [], transfers: [], openingBalance: 0 };
  assert.equal(hasMeaningfulLegacyLedgerData(emptySeed), false);
  assert.equal(hasMeaningfulLegacyLedgerData({ ...emptySeed, openingBalance: 500 }), true);

  // 5. Receipt upload/delete queues and PKCE verifiers are wiped on revocation & sign-out
  const receiptMem = new MemoryStorage();
  receiptMem.setItem("mizan.receiptUploads.t-revoked.v1", JSON.stringify(["r-1"]));
  receiptMem.setItem("mizan.receiptDeletes.t-revoked.v1", JSON.stringify(["r-2"]));
  receiptMem.setItem("mizan.receiptUploads.t-keep.v1", JSON.stringify(["r-3"]));
  receiptMem.setItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`, "v-1");

  wipeTenantCache("t-revoked", receiptMem as unknown as Storage);
  assert.equal(receiptMem.getItem("mizan.receiptUploads.t-revoked.v1"), null);
  assert.equal(receiptMem.getItem("mizan.receiptDeletes.t-revoked.v1"), null);
  assert.ok(receiptMem.getItem("mizan.receiptUploads.t-keep.v1"));

  wipeAllTenantCachesOnSignOut(receiptMem as unknown as Storage);
  assert.equal(receiptMem.getItem("mizan.receiptUploads.t-keep.v1"), null);
  assert.equal(receiptMem.getItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`), null);

  // Ensure Supabase client initializes cleanly with PKCE flow
  assert.ok(getSupabaseClient());
});



