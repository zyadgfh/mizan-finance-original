import { getSupabaseClient } from "../supabase/client.ts";
import type { Currency, Data } from "../finance/types.ts";
import {
  enqueueTenantOutboxOps,
  loadTenantOutbox,
  loadTenantSyncCursor,
  mergeRemoteRecordsIntoData,
  saveTenantOutbox,
  saveTenantSyncCursor,
  type RemoteTenantRecord,
} from "./storage.ts";
import type {
  AdminTenantOverview,
  AuditLogItem,
  OutboxOp,
  PlanCode,
  SubscriptionPlan,
  SubscriptionStatus,
  SyncRejectedItem,
  TenantInvite,
  TenantKind,
  TenantMember,
  TenantRole,
  TenantSummary,
  TenantUser,
} from "./types.ts";

function mapPlanRow(row: Record<string, unknown>): SubscriptionPlan {
  return {
    code: row.code === "yearly" ? "yearly" : "monthly",
    nameAr: String(row.name_ar ?? ""),
    nameEn: String(row.name_en ?? ""),
    priceEgp: Number(row.price_egp ?? 0),
    billingInterval: row.billing_interval === "year" ? "year" : "month",
    trialDays: Number(row.trial_days ?? 14),
    isActive: row.is_active !== false,
  };
}

function mapTenantRow(row: Record<string, unknown>, role: TenantRole): TenantSummary {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    kind: (row.kind as TenantKind) || "personal",
    mode: "cloud",
    baseCurrency: (row.base_currency as Currency) || "EGP",
    role,
    planCode: row.plan_code === "yearly" ? "yearly" : "monthly",
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) || "trialing",
    currentPeriodEnd: String(row.current_period_end ?? new Date().toISOString()),
    ownerId: String(row.owner_id),
    openingBalance: row.opening_balance !== undefined ? Number(row.opening_balance) : undefined,
    exchangeRates: (row.exchange_rates as Partial<Record<Currency, number>> | undefined) ?? undefined,
    phoneCountryCode: typeof row.phone_country_code === "string" ? row.phone_country_code : undefined,
    goalsHidden: Boolean(row.goals_hidden),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

export async function signInWithEmailPassword(email: string, password: string): Promise<TenantUser> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("تعذّر تسجيل الدخول");
  return userFromAuth(data.user);
}

export async function signUpWithEmailPassword(
  email: string,
  password: string,
  displayName: string,
): Promise<{ user: TenantUser; needsConfirmation: boolean }> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        display_name: displayName.trim() || email.split("@")[0] || "مستخدم ميزان",
        full_name: displayName.trim() || email.split("@")[0] || "مستخدم ميزان",
      },
    },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("تعذّر إنشاء الحساب");
  return {
    user: userFromAuth(data.user),
    needsConfirmation: !data.session,
  };
}

export async function signInWithGoogleOAuth(redirectTo?: string): Promise<void> {
  const sb = getSupabaseClient();
  const target =
    redirectTo ||
    (typeof window !== "undefined" ? `${window.location.origin}/` : "http://localhost:8080/");
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: target },
  });
  if (error) throw new Error(error.message);
}

export async function signOutSupabase(): Promise<void> {
  const sb = getSupabaseClient();
  await sb.auth.signOut();
}

export function userFromAuth(u: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): TenantUser {
  const meta = u.user_metadata ?? {};
  const email = u.email ?? "";
  const displayName =
    (typeof meta.display_name === "string" && meta.display_name.trim()) ||
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    email.split("@")[0] ||
    "مستخدم ميزان";
  const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : undefined;
  return { id: u.id, email, displayName, avatarUrl };
}

export async function fetchMyWorkspaceBundle(user: TenantUser): Promise<{
  user: TenantUser;
  workspaces: TenantSummary[];
  plans: SubscriptionPlan[];
  isSuperAdmin: boolean;
}> {
  const sb = getSupabaseClient();

  // Attempt one-time bootstrap if platform_admins is empty or owner email matches
  let isSuperAdmin = false;
  try {
    const { data: adminFlag } = await sb.rpc("bootstrap_first_super_admin");
    isSuperAdmin = Boolean(adminFlag);
  } catch {
    isSuperAdmin = false;
  }

  const [{ data: profile }, { data: planRows }, { data: memberRows, error: memberErr }] = await Promise.all([
    sb.from("profiles").select("display_name, email, avatar_url").eq("id", user.id).maybeSingle(),
    sb.from("subscription_plans").select("*").order("price_egp", { ascending: true }),
    sb
      .from("tenant_members")
      .select("role, tenants!inner(*)")
      .eq("user_id", user.id)
      .is("tenants.deleted_at", null),
  ]);

  if (memberErr) {
    throw new Error(memberErr.message);
  }

  const resolvedUser: TenantUser = {
    ...user,
    displayName: (profile?.display_name as string) || user.displayName,
    email: (profile?.email as string) || user.email,
    avatarUrl: (profile?.avatar_url as string | undefined) || user.avatarUrl,
  };

  const plans = (planRows ?? []).map((r) => mapPlanRow(r as Record<string, unknown>));
  const workspaces: TenantSummary[] = [];

  for (const row of memberRows ?? []) {
    const rec = row as unknown as { role: TenantRole; tenants: Record<string, unknown> | Record<string, unknown>[] };
    const t = Array.isArray(rec.tenants) ? rec.tenants[0] : rec.tenants;
    if (!t || t.deleted_at) continue;
    workspaces.push(mapTenantRow(t, rec.role));
  }

  return { user: resolvedUser, workspaces, plans, isSuperAdmin };
}

export async function createCloudWorkspace(input: {
  name: string;
  slug?: string;
  kind: TenantKind;
  baseCurrency: Currency;
  planCode?: PlanCode;
}): Promise<TenantSummary> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc("create_tenant_workspace", {
    p_name: input.name.trim(),
    p_slug: input.slug?.trim() || null,
    p_kind: input.kind,
    p_base_currency: input.baseCurrency,
    p_plan_code: input.planCode ?? "monthly",
  });
  if (error) throw new Error(error.message);
  return mapTenantRow(data as Record<string, unknown>, "owner");
}

export async function updateCloudWorkspaceSettings(
  tenantId: string,
  patch: Partial<{
    name: string;
    slug: string;
    kind: TenantKind;
    baseCurrency: Currency;
    openingBalance: number;
    exchangeRates: Partial<Record<Currency, number>>;
    phoneCountryCode: string;
    goalsHidden: boolean;
  }>,
): Promise<void> {
  const sb = getSupabaseClient();
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name.trim();
  if (patch.slug !== undefined) updates.slug = patch.slug.trim().toLowerCase();
  if (patch.kind !== undefined) updates.kind = patch.kind;
  if (patch.baseCurrency !== undefined) updates.base_currency = patch.baseCurrency;
  if (patch.openingBalance !== undefined) updates.opening_balance = patch.openingBalance;
  if (patch.exchangeRates !== undefined) updates.exchange_rates = patch.exchangeRates;
  if (patch.phoneCountryCode !== undefined) updates.phone_country_code = patch.phoneCountryCode;
  if (patch.goalsHidden !== undefined) updates.goals_hidden = patch.goalsHidden;

  const { error } = await sb.from("tenants").update(updates).eq("id", tenantId);
  if (error) throw new Error(error.message);
}

export async function fetchTenantMembers(tenantId: string): Promise<TenantMember[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("tenant_members")
    .select("tenant_id, user_id, role, display_name, email, joined_at")
    .eq("tenant_id", tenantId)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({
    tenantId: String(m.tenant_id),
    userId: String(m.user_id),
    role: m.role as TenantRole,
    displayName: String(m.display_name ?? ""),
    email: String(m.email ?? ""),
    joinedAt: String(m.joined_at),
  }));
}

export async function updateMemberRole(
  tenantId: string,
  userId: string,
  role: Exclude<TenantRole, "owner">,
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("tenant_members")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function removeTenantMember(tenantId: string, userId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("tenant_members")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const a = Array.from(bytes.slice(0, 4), (b) => chars[b % chars.length]).join("");
  const b = Array.from(bytes.slice(4, 8), (x) => chars[x % chars.length]).join("");
  return `MZN-${a}-${b}`;
}

export async function listTenantInvites(tenantId: string): Promise<TenantInvite[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("tenant_invites")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    inviteCode: String(r.invite_code),
    email: (r.email as string | null) ?? null,
    role: r.role as Exclude<TenantRole, "owner">,
    expiresAt: String(r.expires_at),
    maxUses: Number(r.max_uses),
    usesCount: Number(r.uses_count),
    revokedAt: (r.revoked_at as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}

export async function createTenantInvite(input: {
  tenantId: string;
  createdBy: string;
  role: Exclude<TenantRole, "owner">;
  email?: string;
  maxUses?: number;
}): Promise<TenantInvite> {
  const sb = getSupabaseClient();
  const inviteCode = generateInviteCode();
  const { data, error } = await sb
    .from("tenant_invites")
    .insert({
      tenant_id: input.tenantId,
      created_by: input.createdBy,
      invite_code: inviteCode,
      role: input.role,
      email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
      max_uses: input.maxUses ?? 10,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    id: String(data.id),
    tenantId: String(data.tenant_id),
    inviteCode: String(data.invite_code),
    email: (data.email as string | null) ?? null,
    role: data.role as Exclude<TenantRole, "owner">,
    expiresAt: String(data.expires_at),
    maxUses: Number(data.max_uses),
    usesCount: Number(data.uses_count),
    revokedAt: (data.revoked_at as string | null) ?? null,
    createdAt: String(data.created_at),
  };
}

export async function revokeTenantInvite(inviteId: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("tenant_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (error) throw new Error(error.message);
}

export async function redeemTenantInvite(code: string): Promise<{
  tenantId: string;
  slug: string;
  name: string;
  role: TenantRole;
}> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc("redeem_tenant_invite", { p_code: code.trim() });
  if (error) throw new Error(error.message);
  const res = data as Record<string, unknown>;
  return {
    tenantId: String(res.tenant_id),
    slug: String(res.slug),
    name: String(res.name),
    role: res.role as TenantRole,
  };
}

export async function activateTenantPlan(tenantId: string, planCode: PlanCode): Promise<TenantSummary> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc("activate_tenant_subscription", {
    p_tenant_id: tenantId,
    p_plan_code: planCode,
  });
  if (error) throw new Error(error.message);
  return mapTenantRow(data as Record<string, unknown>, "owner");
}

export async function fetchTenantAuditLogs(tenantId: string, limit = 50): Promise<AuditLogItem[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("tenant_audit_logs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    actorId: (r.actor_id as string | null) ?? null,
    actorName: String(r.actor_name ?? ""),
    action: String(r.action),
    entityType: (r.entity_type as string | null) ?? null,
    entityId: (r.entity_id as string | null) ?? null,
    summary: String(r.summary ?? ""),
    createdAt: String(r.created_at),
  }));
}

export async function pushTenantAuditLog(input: {
  tenantId: string;
  actorId: string;
  actorName: string;
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string;
}): Promise<void> {
  const sb = getSupabaseClient();
  await sb.from("tenant_audit_logs").insert({
    tenant_id: input.tenantId,
    actor_id: input.actorId,
    actor_name: input.actorName,
    action: input.action,
    summary: input.summary,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
  });
}

export async function syncTenantWithSupabase(
  tenantId: string,
  localData: Data,
  storage?: Storage,
): Promise<{
  mergedData: Data;
  pushedCount: number;
  pulledCount: number;
  rejected: SyncRejectedItem[];
  remainingOutboxCount: number;
}> {
  const sb = getSupabaseClient();
  const outbox = loadTenantOutbox(tenantId, storage);
  const rejected: SyncRejectedItem[] = [];
  let pushedCount = 0;

  if (outbox.length > 0) {
    const { data: pushResult, error: pushErr } = await sb.rpc("sync_push_tenant_records", {
      p_tenant_id: tenantId,
      p_ops: outbox,
    });
    if (pushErr) {
      throw new Error(pushErr.message);
    }

    const resObj = (pushResult ?? {}) as {
      applied?: Array<{ entityType: string; entityId: string }>;
      stale?: Array<{ entityType: string; entityId: string }>;
      rejected?: Array<{ entityType: string; entityId: string; error: string; code?: string }>;
    };

    const doneKeys = new Set<string>();
    for (const item of resObj.applied ?? []) {
      doneKeys.add(`${item.entityType}:${item.entityId}`);
      pushedCount += 1;
    }
    for (const item of resObj.stale ?? []) {
      doneKeys.add(`${item.entityType}:${item.entityId}`);
    }
    for (const item of resObj.rejected ?? []) {
      doneKeys.add(`${item.entityType}:${item.entityId}`);
      rejected.push({
        entityType: item.entityType,
        entityId: item.entityId,
        error: item.error,
        code: item.code,
        at: Date.now(),
      });
    }

    const remaining = outbox.filter((op) => !doneKeys.has(`${op.entityType}:${op.entityId}`));
    saveTenantOutbox(tenantId, remaining, storage);
  }

  const cursorIso = loadTenantSyncCursor(tenantId, storage);
  let query = sb
    .from("tenant_records")
    .select(
      "entity_type, entity_id, payload, updated_at_ms, deleted_at_ms, created_by, created_by_name, updated_by, updated_by_name, server_updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("server_updated_at", { ascending: true });

  if (cursorIso) {
    query = query.gt("server_updated_at", cursorIso);
  }

  const { data: remoteRows, error: pullErr } = await query;
  if (pullErr) throw new Error(pullErr.message);

  const rows = (remoteRows ?? []) as RemoteTenantRecord[];
  const remainingOutbox = loadTenantOutbox(tenantId, storage);
  const mergedData = mergeRemoteRecordsIntoData(localData, rows, remainingOutbox);

  if (rows.length > 0) {
    const maxServerTs = rows[rows.length - 1]?.server_updated_at;
    if (maxServerTs) saveTenantSyncCursor(tenantId, maxServerTs, storage);
  }

  return {
    mergedData,
    pushedCount,
    pulledCount: rows.length,
    rejected,
    remainingOutboxCount: remainingOutbox.length,
  };
}

export function queueOutboxOperations(
  tenantId: string,
  ops: OutboxOp[],
  storage?: Storage,
): number {
  if (!ops.length) return loadTenantOutbox(tenantId, storage).length;
  return enqueueTenantOutboxOps(tenantId, ops, storage).length;
}

// Super-Admin APIs
export async function adminListTenants(): Promise<AdminTenantOverview[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc("admin_list_tenants");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    kind: (r.kind as TenantKind) || "personal",
    baseCurrency: (r.base_currency as Currency) || "EGP",
    planCode: r.plan_code === "yearly" ? "yearly" : "monthly",
    subscriptionStatus: (r.subscription_status as SubscriptionStatus) || "trialing",
    currentPeriodEnd: String(r.current_period_end),
    ownerEmail: String(r.owner_email ?? ""),
    memberCount: Number(r.member_count ?? 0),
    recordCount: Number(r.record_count ?? 0),
    createdAt: String(r.created_at),
  }));
}

export async function adminUpdateTenantSubscription(input: {
  tenantId: string;
  planCode?: PlanCode;
  status?: SubscriptionStatus;
  extendDays?: number;
}): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc("admin_update_tenant_subscription", {
    p_tenant_id: input.tenantId,
    p_plan_code: input.planCode ?? null,
    p_status: input.status ?? null,
    p_extend_days: input.extendDays ?? 0,
  });
  if (error) throw new Error(error.message);
}

export async function adminUpdatePlanPrice(code: PlanCode, priceEgp: number): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from("subscription_plans")
    .update({ price_egp: priceEgp, updated_at: new Date().toISOString() })
    .eq("code", code);
  if (error) throw new Error(error.message);
}
