import { getSupabaseClient, SUPABASE_ANON_KEY, SUPABASE_URL } from "../supabase/client.ts";
import type { Currency, Data } from "../finance/types.ts";
import { cleanDisplayContact, normalizeSubscriberIdentity } from "./identity.ts";
import {
  enqueueTenantOutboxOps,
  loadTenantOutbox,
  loadTenantSyncCursor,
  mergeRemoteRecordsIntoData,
  saveTenantOutbox,
  saveTenantSyncCursor,
  type RemoteTenantRecord,
} from "./storage.ts";
import {
  DEFAULT_SUBSCRIPTION_PLANS,
  normalizePlanCode,
  normalizeSubscriptionStatus,
  type AdminManagedUser,
  type AdminTenantOverview,
  type AuditLogItem,
  type BillingInterval,
  type OutboxOp,
  type PaymentMethod,
  type PaymentRequestItem,
  type PaymentRequestStatus,
  type PaymentRequestType,
  type PlanCode,
  type PlatformBillingInfo,
  type SubscriptionPlan,
  type SubscriptionStatus,
  type SyncRejectedItem,
  type TenantInvite,
  type TenantKind,
  type TenantMember,
  type TenantRole,
  type TenantSummary,
  type TenantUser,
} from "./types.ts";

function mapPlanRow(row: Record<string, unknown>): SubscriptionPlan {
  const code = normalizePlanCode(row.code);
  const rawInterval = String(row.billing_interval ?? "month");
  const billingInterval: BillingInterval =
    rawInterval === "year" || rawInterval === "semiannual" || rawInterval === "quarter"
      ? rawInterval
      : "month";
  const defaultDays = code === "yearly" ? 365 : code === "semiannual" ? 180 : code === "quarterly" ? 90 : 30;
  return {
    code,
    nameAr: String(row.name_ar ?? ""),
    nameEn: String(row.name_en ?? ""),
    priceEgp: Number(row.price_egp ?? 0),
    billingInterval,
    durationDays: Number(row.duration_days ?? defaultDays),
    trialDays: Number(row.trial_days ?? 0),
    sortOrder: Number(row.sort_order ?? 1),
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
    planCode: normalizePlanCode(row.plan_code),
    subscriptionStatus: normalizeSubscriptionStatus(row.subscription_status),
    currentPeriodEnd: String(row.current_period_end ?? new Date().toISOString()),
    autoDeactivatedAt: (row.auto_deactivated_at as string | null) ?? null,
    ownerId: String(row.owner_id),
    openingBalance: row.opening_balance !== undefined ? Number(row.opening_balance) : undefined,
    exchangeRates: (row.exchange_rates as Partial<Record<Currency, number>> | undefined) ?? undefined,
    phoneCountryCode: typeof row.phone_country_code === "string" ? row.phone_country_code : undefined,
    goalsHidden: Boolean(row.goals_hidden),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapPaymentRequestRow(r: Record<string, unknown>): PaymentRequestItem {
  const planCode = normalizePlanCode(r.plan_code);
  const defaultDays =
    planCode === "yearly" ? 365 : planCode === "semiannual" ? 180 : planCode === "quarterly" ? 90 : 30;
  const submitterEmail = String(r.submitter_email ?? "");
  const submitterContact = cleanDisplayContact(
    submitterEmail,
    null,
    (r.submitter_contact as string | null) ?? submitterEmail,
  );
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    tenantName: String(r.tenant_name ?? ""),
    submittedBy: String(r.submitted_by ?? ""),
    submitterEmail,
    submitterContact,
    requestType: r.request_type === "new_registration" ? ("new_registration" as PaymentRequestType) : "renewal",
    planCode,
    durationDays: Number(r.duration_days ?? defaultDays),
    amountEgp: Number(r.amount_egp ?? 0),
    paymentMethod: (r.payment_method as PaymentMethod) || "instapay",
    referenceCode: String(r.reference_code ?? ""),
    senderHandle: (r.sender_handle as string | null) ?? null,
    proofPath: (r.proof_path as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    status: (r.status as PaymentRequestStatus) || "pending",
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    adminNote: (r.admin_note as string | null) ?? null,
    createdAt: String(r.created_at ?? new Date().toISOString()),
  };
}

/** Raised when the credentials are valid but the mailbox was never confirmed. */
export class EmailNotVerifiedError extends Error {
  readonly identifier: string;
  constructor(identifier: string) {
    super("يجب تأكيد بريدك الإلكتروني أولاً. تحقق من رسالة التأكيد أو أرسل رابطاً جديداً.");
    this.name = "EmailNotVerifiedError";
    this.identifier = identifier;
  }
}

export async function signInWithEmailPassword(identifier: string, password: string): Promise<TenantUser> {
  const normalized = normalizeSubscriberIdentity(identifier);
  if (!normalized) {
    throw new Error("أدخل بريداً إلكترونياً صحيحاً أو رقم هاتف صحيح (مثل 01012345678)");
  }
  const sb = getSupabaseClient();
  const { data, error } = await sb.auth.signInWithPassword({
    email: normalized.authEmail,
    password,
  });
  if (error) {
    const lower = error.message.toLowerCase();
    if (lower.includes("invalid login credentials")) {
      throw new Error("البريد الإلكتروني / رقم الهاتف أو كلمة المرور غير صحيحة");
    }
    if (lower.includes("banned")) {
      throw new Error("هذا الحساب موقوف حالياً، يرجى التواصل مع مالك المنصة");
    }
    if (lower.includes("not confirmed") || lower.includes("email not confirmed")) {
      throw new EmailNotVerifiedError(identifier);
    }
    throw new Error(error.message);
  }
  if (!data.user) throw new Error("تعذّر تسجيل الدخول");
  return userFromAuth(data.user);
}

export async function requestPasswordResetEmail(email: string, redirectTo?: string): Promise<void> {
  const normalized = normalizeSubscriberIdentity(email);
  if (!normalized || normalized.kind !== "email") {
    throw new Error("استعادة كلمة المرور عبر الرابط تتطلب بريداً إلكترونياً مسجلاً؛ لحسابات الهاتف تواصل مع إدارة المنصة");
  }
  const sb = getSupabaseClient();
  const target =
    redirectTo ||
    (typeof window !== "undefined" ? `${window.location.origin}/` : "https://mizan-finance-rho.vercel.app/");
  const { error } = await sb.auth.resetPasswordForEmail(normalized.authEmail, { redirectTo: target });
  if (error) throw new Error(error.message);
}

export async function updateMyPassword(newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف");
  }
  const sb = getSupabaseClient();
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function checkHasPlatformOwner(): Promise<boolean> {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.rpc("has_platform_owner");
    if (error) return true;
    return Boolean(data);
  } catch {
    return true;
  }
}

async function callAdminUsersFunction(
  body: Record<string, unknown>,
  requireAuth = true,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (requireAuth) {
    const sb = getSupabaseClient();
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("يجب تسجيل الدخول أولاً");
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof json.error === "string" ? json.error : "تعذّر تنفيذ العملية، حاول مرة أخرى");
  }
  return json;
}

export type SignupPendingVerification = {
  requiresEmailVerification: true;
  verificationEmailSent: boolean;
  authEmail: string;
  contactDisplay: string;
};

/**
 * One-time platform owner bootstrap. Requires the server-side
 * MIZAN_BOOTSTRAP_SECRET; the account is never auto-confirmed, so the owner
 * has to verify the mailbox before signing in.
 */
export async function setupInitialPlatformOwner(input: {
  email: string;
  password: string;
  displayName?: string;
  bootstrapSecret: string;
}): Promise<SignupPendingVerification> {
  const res = await callAdminUsersFunction(
    {
      action: "setup_owner",
      email: input.email.trim(),
      password: input.password,
      displayName: input.displayName?.trim() || "مالك المنصة",
      bootstrapSecret: input.bootstrapSecret,
    },
    false,
  );
  return {
    requiresEmailVerification: true,
    verificationEmailSent: Boolean(res.verificationEmailSent),
    authEmail: String(res.email ?? input.email.trim().toLowerCase()),
    contactDisplay: String(res.email ?? input.email.trim().toLowerCase()),
  };
}

export async function fetchPublicSignupConfig(): Promise<{
  plans: SubscriptionPlan[];
  billingInfo: PlatformBillingInfo;
}> {
  const sb = getSupabaseClient();
  const [{ data: planRows }, billingInfo] = await Promise.all([
    sb
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    fetchPlatformBillingInfo(),
  ]);

  const plans =
    planRows && planRows.length > 0
      ? planRows.map((r) => mapPlanRow(r as Record<string, unknown>))
      : DEFAULT_SUBSCRIPTION_PLANS;

  return { plans, billingInfo };
}

export async function registerNewSubscriberWithPayment(input: {
  identifier: string;
  password: string;
  displayName?: string;
  planCode: PlanCode;
  paymentMethod: "instapay" | "vodafone_cash";
  senderHandle: string;
  proofDataUrl: string;
  notes?: string;
  /** Required when the identifier is a phone number: used to verify the account. */
  email?: string;
}): Promise<SignupPendingVerification> {
  const res = await callAdminUsersFunction(
    {
      action: "register_subscriber",
      identifier: input.identifier.trim(),
      password: input.password,
      displayName: input.displayName?.trim() || "",
      planCode: input.planCode,
      paymentMethod: input.paymentMethod,
      senderHandle: input.senderHandle.trim(),
      proofDataUrl: input.proofDataUrl,
      notes: input.notes?.trim() || "",
      email: input.email?.trim() || "",
    },
    false,
  );

  return {
    requiresEmailVerification: true,
    verificationEmailSent: Boolean(res.verificationEmailSent),
    authEmail: String(res.authEmail ?? ""),
    contactDisplay: String(res.contactDisplay ?? input.identifier.trim()),
  };
}

/**
 * Re-sends the signup confirmation email. Used when a subscriber tries to sign
 * in before confirming the mailbox.
 */
export async function resendSignupVerification(identifier: string, redirectTo?: string): Promise<void> {
  const normalized = normalizeSubscriberIdentity(identifier);
  if (!normalized) {
    throw new Error("أدخل بريداً إلكترونياً صحيحاً أو رقم هاتف صحيح");
  }
  if (normalized.kind !== "email") {
    throw new Error("تأكيد الحساب يتم عبر البريد الإلكتروني المسجل عند التسجيل");
  }
  const sb = getSupabaseClient();
  const target =
    redirectTo ||
    (typeof window !== "undefined" ? `${window.location.origin}/` : "https://mizan-finance-rho.vercel.app/");
  const { error } = await sb.auth.resend({
    type: "signup",
    email: normalized.authEmail,
    options: { emailRedirectTo: target },
  });
  if (error) throw new Error(error.message);
}

export async function submitRenewalPaymentWithProof(input: {
  tenantId: string;
  planCode: PlanCode;
  paymentMethod: PaymentMethod;
  senderHandle: string;
  proofDataUrl: string;
  notes?: string;
}): Promise<PaymentRequestItem> {
  const res = await callAdminUsersFunction(
    {
      action: "submit_renewal_payment",
      tenantId: input.tenantId,
      planCode: input.planCode,
      paymentMethod: input.paymentMethod,
      senderHandle: input.senderHandle.trim(),
      proofDataUrl: input.proofDataUrl,
      notes: input.notes?.trim() || "",
    },
    true,
  );
  return mapPaymentRequestRow((res.request ?? {}) as Record<string, unknown>);
}

export async function getPaymentProofSignedUrl(proofPath: string): Promise<string | null> {
  if (!proofPath) return null;
  const sb = getSupabaseClient();
  const { data, error } = await sb.storage
    .from("mizan-payment-proofs")
    .createSignedUrl(proofPath, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function enforceExpiredSubscriptionsNow(): Promise<number> {
  const sb = getSupabaseClient();
  // The sweep is no longer executable by anon/authenticated; platform admins
  // call the guarded wrapper instead.
  const { data, error } = await sb.rpc("admin_enforce_expired_subscriptions");
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
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
  const rawEmail = u.email ?? "";
  const phone = typeof meta.phone === "string" ? meta.phone : null;
  const contactDisplay = cleanDisplayContact(
    rawEmail,
    phone,
    typeof meta.contact_display === "string" ? meta.contact_display : null,
  );
  const displayName =
    (typeof meta.display_name === "string" && meta.display_name.trim()) ||
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    contactDisplay.split("@")[0] ||
    "مشترك ميزان";
  const avatarUrl = typeof meta.avatar_url === "string" ? meta.avatar_url : undefined;
  return { id: u.id, email: contactDisplay, phone, displayName, avatarUrl };
}

export async function fetchMyWorkspaceBundle(user: TenantUser): Promise<{
  user: TenantUser;
  workspaces: TenantSummary[];
  plans: SubscriptionPlan[];
  isSuperAdmin: boolean;
}> {
  const sb = getSupabaseClient();

  let isSuperAdmin = false;
  try {
    // Also triggers enforce_expired_subscriptions() server-side on every load!
    const { data: adminFlag } = await sb.rpc("bootstrap_first_super_admin");
    isSuperAdmin = Boolean(adminFlag);
  } catch {
    isSuperAdmin = false;
  }

  const [{ data: profile }, { data: planRows }, { data: memberRows, error: memberErr }] = await Promise.all([
    sb
      .from("profiles")
      .select("display_name, email, phone, contact_display, avatar_url")
      .eq("id", user.id)
      .maybeSingle(),
    sb.from("subscription_plans").select("*").order("sort_order", { ascending: true }),
    sb
      .from("tenant_members")
      .select("role, tenants!inner(*)")
      .eq("user_id", user.id)
      .is("tenants.deleted_at", null),
  ]);

  if (memberErr) {
    throw new Error(memberErr.message);
  }

  const cleanEmail = cleanDisplayContact(
    (profile?.email as string | undefined) ?? user.email,
    (profile?.phone as string | null | undefined) ?? user.phone ?? null,
    (profile?.contact_display as string | null | undefined) ?? null,
  );

  const resolvedUser: TenantUser = {
    ...user,
    displayName: (profile?.display_name as string) || user.displayName,
    email: cleanEmail || user.email,
    phone: (profile?.phone as string | null | undefined) ?? user.phone ?? null,
    avatarUrl: (profile?.avatar_url as string | undefined) || user.avatarUrl,
  };

  const plans =
    planRows && planRows.length > 0
      ? planRows.map((r) => mapPlanRow(r as Record<string, unknown>))
      : DEFAULT_SUBSCRIPTION_PLANS;
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
    email: cleanDisplayContact(String(m.email ?? "")),
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

export async function fetchPlatformBillingInfo(): Promise<PlatformBillingInfo> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.from("platform_billing_info").select("*").eq("id", 1).maybeSingle();
  if (error || !data) {
    return {
      instapayHandle: "",
      vodafoneCashNumber: "",
      bankDetails: "",
      instructionsAr:
        "حوّل قيمة الباقة عبر إنستاباي أو فودافون كاش ثم اكتب الرقم المحوّل منه أو اسم مستخدم إنستا باي وارفع صورة التحويل لتفعيل حسابك.",
      instructionsEn:
        "Transfer the package amount via InstaPay or Vodafone Cash, enter your sender number/IPA handle, and upload the transfer screenshot.",
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    instapayHandle: String(data.instapay_handle ?? ""),
    vodafoneCashNumber: String(data.vodafone_cash_number ?? ""),
    bankDetails: String(data.bank_details ?? ""),
    instructionsAr: String(data.instructions_ar ?? ""),
    instructionsEn: String(data.instructions_en ?? ""),
    updatedAt: String(data.updated_at ?? new Date().toISOString()),
  };
}

export async function adminUpdatePlatformBillingInfo(
  patch: Partial<Omit<PlatformBillingInfo, "updatedAt">>,
): Promise<void> {
  const sb = getSupabaseClient();
  const updates: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
  if (patch.instapayHandle !== undefined) updates.instapay_handle = patch.instapayHandle.trim();
  if (patch.vodafoneCashNumber !== undefined) updates.vodafone_cash_number = patch.vodafoneCashNumber.trim();
  if (patch.bankDetails !== undefined) updates.bank_details = patch.bankDetails.trim();
  if (patch.instructionsAr !== undefined) updates.instructions_ar = patch.instructionsAr.trim();
  if (patch.instructionsEn !== undefined) updates.instructions_en = patch.instructionsEn.trim();

  const { error } = await sb.from("platform_billing_info").upsert(updates);
  if (error) throw new Error(error.message);
}

export async function submitPaymentRequest(input: {
  tenantId: string;
  planCode: PlanCode;
  paymentMethod: PaymentMethod;
  referenceCode: string;
  senderHandle?: string;
  notes?: string;
  proofPath?: string;
}): Promise<PaymentRequestItem> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc("submit_payment_request", {
    p_tenant_id: input.tenantId,
    p_plan_code: input.planCode,
    p_payment_method: input.paymentMethod,
    p_reference_code: input.referenceCode.trim(),
    p_sender_handle: input.senderHandle?.trim() || input.referenceCode.trim(),
    p_notes: input.notes?.trim() || null,
    p_proof_path: input.proofPath || null,
  });
  if (error) throw new Error(error.message);
  return mapPaymentRequestRow(data as Record<string, unknown>);
}

export async function listPaymentRequests(tenantId?: string): Promise<PaymentRequestItem[]> {
  const sb = getSupabaseClient();
  let query = sb.from("payment_requests").select("*").order("created_at", { ascending: false }).limit(150);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapPaymentRequestRow);
}

export async function adminReviewPaymentRequest(input: {
  requestId: string;
  decision: "approved" | "rejected";
  adminNote?: string;
}): Promise<PaymentRequestItem> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.rpc("admin_review_payment_request", {
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_admin_note: input.adminNote?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return mapPaymentRequestRow(data as Record<string, unknown>);
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

/**
 * Writes an audit entry. The actor id/name and timestamp are derived on the
 * server (`log_tenant_audit_event`); the client only supplies the tenant, an
 * allow-listed action and a short summary, so entries cannot be forged.
 */
export async function pushTenantAuditLog(input: {
  tenantId: string;
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  /** @deprecated ignored — the server always uses the authenticated actor. */
  actorId?: string;
  /** @deprecated ignored — the server always uses the authenticated actor. */
  actorName?: string;
}): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc("log_tenant_audit_event", {
    p_tenant_id: input.tenantId,
    p_action: input.action,
    p_summary: input.summary,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
  });
  if (error) throw new Error(error.message);
}

const SYNC_PAGE_SIZE = 500;
const SYNC_MAX_PAGES = 40;

/** Cursor format: `rev:<n>` — a monotonic, server-assigned revision. */
function parseRevisionCursor(cursor: string | null): number | null {
  if (!cursor) return null;
  const match = /^rev:(\d+)$/.exec(cursor.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
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

  const storedCursor = loadTenantSyncCursor(tenantId, storage);
  const revisionCursor = parseRevisionCursor(storedCursor);

  // Paginate the whole delta instead of trusting the default PostgREST page
  // size. Ordering follows the server-assigned monotonic `revision`, so ties
  // inside one transaction can no longer swallow records (findings 04/09).
  const byEntity = new Map<string, RemoteTenantRecord>();
  let maxRevision: number | null = revisionCursor;
  let maxServerUpdatedAt: string | null = null;

  for (let page = 0; page < SYNC_MAX_PAGES; page += 1) {
    let query = sb
      .from("tenant_records")
      .select(
        "entity_type, entity_id, payload, updated_at_ms, deleted_at_ms, created_by, created_by_name, updated_by, updated_by_name, server_updated_at, revision",
      )
      .eq("tenant_id", tenantId)
      .order("revision", { ascending: true })
      .limit(SYNC_PAGE_SIZE);

    if (revisionCursor !== null) {
      query = query.gt("revision", revisionCursor);
    } else if (storedCursor) {
      // Legacy ISO cursor from an older client: re-read inclusively so nothing
      // is skipped, then switch to the revision cursor below.
      query = query.gte("server_updated_at", storedCursor);
    }

    const { data: remoteRows, error: pullErr } = await query;
    if (pullErr) throw new Error(pullErr.message);

    const batch = ((remoteRows ?? []) as RemoteTenantRecord[]).filter(Boolean);
    for (const row of batch) {
      byEntity.set(`${row.entity_type}:${row.entity_id}`, row);
      const rev = Number((row as { revision?: number | string }).revision);
      if (Number.isSafeInteger(rev) && (maxRevision === null || rev > maxRevision)) {
        maxRevision = rev;
      }
      if (row.server_updated_at && (!maxServerUpdatedAt || row.server_updated_at > maxServerUpdatedAt)) {
        maxServerUpdatedAt = row.server_updated_at;
      }
    }

    if (batch.length < SYNC_PAGE_SIZE) break;
  }

  const rows = [...byEntity.values()];
  const remainingOutbox = loadTenantOutbox(tenantId, storage);
  const mergedData = mergeRemoteRecordsIntoData(localData, rows, remainingOutbox);

  if (rows.length > 0) {
    const nextCursor =
      maxRevision !== null && maxRevision > (revisionCursor ?? -1)
        ? `rev:${maxRevision}`
        : maxServerUpdatedAt;
    if (nextCursor) saveTenantSyncCursor(tenantId, nextCursor, storage);
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

// Super-Admin APIs (Subscriptions, Payment Proofs & User Accounts)
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
    planCode: normalizePlanCode(r.plan_code),
    subscriptionStatus: normalizeSubscriptionStatus(r.subscription_status),
    currentPeriodEnd: String(r.current_period_end),
    autoDeactivatedAt: (r.auto_deactivated_at as string | null) ?? null,
    ownerId: r.owner_id ? String(r.owner_id) : undefined,
    ownerName: String(r.owner_name ?? "مشترك"),
    ownerEmail: cleanDisplayContact(String(r.owner_email ?? ""), (r.owner_phone as string | null) ?? null),
    ownerPhone: String(r.owner_phone ?? ""),
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
  exactPeriodEnd?: string | null;
}): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb.rpc("admin_update_tenant_subscription", {
    p_tenant_id: input.tenantId,
    p_plan_code: input.planCode ?? null,
    p_status: input.status ?? null,
    p_extend_days: input.extendDays ?? 0,
    p_exact_period_end: input.exactPeriodEnd ?? null,
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

export async function adminListUsers(): Promise<AdminManagedUser[]> {
  const res = await callAdminUsersFunction({ action: "list_users" });
  return ((res.users ?? []) as Record<string, unknown>[]).map((u) => ({
    id: String(u.id),
    email: cleanDisplayContact(String(u.email ?? ""), (u.phone as string | null) ?? null),
    phone: (u.phone as string | null) ?? null,
    displayName: String(u.displayName ?? ""),
    isSuperAdmin: Boolean(u.isSuperAdmin),
    banned: Boolean(u.banned),
    emailVerified: u.emailVerified === undefined ? undefined : Boolean(u.emailVerified),
    createdAt: String(u.createdAt ?? ""),
    lastSignInAt: (u.lastSignInAt as string | null) ?? null,
    workspaces: Array.isArray(u.workspaces)
      ? (u.workspaces as Array<{
          tenantId: string;
          name: string;
          slug: string;
          role: string;
          subscriptionStatus?: string;
          currentPeriodEnd?: string;
        }>)
      : [],
  }));
}

export async function adminCreateUserAccount(input: {
  email: string;
  password: string;
  displayName?: string;
  workspaceMode: "create" | "existing" | "none";
  workspaceName?: string;
  workspaceKind?: TenantKind;
  baseCurrency?: Currency;
  planCode?: PlanCode;
  subscriptionStatus?: "active" | "trialing" | "pending_approval";
  existingTenantId?: string;
  existingRole?: Exclude<TenantRole, "owner">;
}): Promise<{ user: { id: string; email: string; displayName: string }; tenantId: string | null }> {
  const res = await callAdminUsersFunction({
    action: "create_user",
    ...input,
  });
  const u = (res.user ?? {}) as Record<string, unknown>;
  return {
    user: {
      id: String(u.id ?? ""),
      email: String(u.email ?? ""),
      displayName: String(u.displayName ?? ""),
    },
    tenantId: (res.tenantId as string | null) ?? null,
  };
}

export async function adminUpdateUserAccount(input: {
  userId: string;
  password?: string;
  displayName?: string;
  banned?: boolean;
}): Promise<void> {
  await callAdminUsersFunction({
    action: "update_user",
    ...input,
  });
}

export async function adminDeleteUserAccount(userId: string): Promise<void> {
  await callAdminUsersFunction({
    action: "delete_user",
    userId,
  });
}
