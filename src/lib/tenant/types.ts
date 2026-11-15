import type { Currency } from "../finance/types.ts";

export type TenantRole = "owner" | "admin" | "member" | "viewer";
export type TenantKind = "personal" | "family" | "business";
export type TenantMode = "cloud" | "local";
export type PlanCode = "monthly" | "quarterly" | "semiannual" | "yearly";
export type BillingInterval = "month" | "quarter" | "semiannual" | "year";
export type SubscriptionStatus =
  | "pending_approval"
  | "trialing"
  | "active"
  | "past_due"
  | "expired"
  | "suspended";
export type SubscriptionBlockReason = "pending_approval" | "expired" | "suspended";
export type PaymentMethod = "instapay" | "vodafone_cash" | "bank_transfer" | "other";
export type PaymentRequestStatus = "pending" | "approved" | "rejected";
export type PaymentRequestType = "new_registration" | "renewal";

export type EntityType =
  | "tx"
  | "person"
  | "debt"
  | "payment"
  | "wallet"
  | "transfer"
  | "budget"
  | "goal"
  | "goalMove"
  | "recurring"
  | "category"
  | "debtAudit";

export type TenantUser = {
  id: string;
  email: string;
  phone?: string | null;
  displayName: string;
  avatarUrl?: string;
};

export type SubscriptionPlan = {
  code: PlanCode;
  nameAr: string;
  nameEn: string;
  priceEgp: number;
  billingInterval: BillingInterval;
  durationDays: number;
  trialDays: number;
  sortOrder: number;
  isActive: boolean;
};

export const DEFAULT_SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    code: "monthly",
    nameAr: "باقة شهر واحد",
    nameEn: "1 Month",
    priceEgp: 29,
    billingInterval: "month",
    durationDays: 30,
    trialDays: 0,
    sortOrder: 1,
    isActive: true,
  },
  {
    code: "quarterly",
    nameAr: "باقة 3 أشهر",
    nameEn: "3 Months",
    priceEgp: 75,
    billingInterval: "quarter",
    durationDays: 90,
    trialDays: 0,
    sortOrder: 2,
    isActive: true,
  },
  {
    code: "semiannual",
    nameAr: "باقة 6 أشهر",
    nameEn: "6 Months",
    priceEgp: 135,
    billingInterval: "semiannual",
    durationDays: 180,
    trialDays: 0,
    sortOrder: 3,
    isActive: true,
  },
  {
    code: "yearly",
    nameAr: "باقة سنة كاملة",
    nameEn: "1 Year",
    priceEgp: 240,
    billingInterval: "year",
    durationDays: 365,
    trialDays: 0,
    sortOrder: 4,
    isActive: true,
  },
];

export type PlatformBillingInfo = {
  instapayHandle: string;
  vodafoneCashNumber: string;
  bankDetails: string;
  instructionsAr: string;
  instructionsEn: string;
  updatedAt: string;
};

export type PaymentRequestItem = {
  id: string;
  tenantId: string;
  tenantName: string;
  submittedBy: string;
  submitterEmail: string;
  submitterContact: string;
  requestType: PaymentRequestType;
  planCode: PlanCode;
  durationDays: number;
  amountEgp: number;
  paymentMethod: PaymentMethod;
  referenceCode: string;
  senderHandle: string | null;
  proofPath: string | null;
  notes: string | null;
  status: PaymentRequestStatus;
  reviewedAt: string | null;
  adminNote: string | null;
  createdAt: string;
};

export type AdminManagedUser = {
  id: string;
  email: string;
  phone?: string | null;
  displayName: string;
  isSuperAdmin: boolean;
  banned: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  workspaces: Array<{
    tenantId: string;
    name: string;
    slug: string;
    role: string;
    subscriptionStatus?: string;
    currentPeriodEnd?: string;
  }>;
};

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  kind: TenantKind;
  mode: TenantMode;
  baseCurrency: Currency;
  role: TenantRole;
  planCode: PlanCode;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string;
  autoDeactivatedAt?: string | null;
  ownerId: string;
  openingBalance?: number;
  exchangeRates?: Partial<Record<Currency, number>>;
  phoneCountryCode?: string;
  goalsHidden?: boolean;
  createdAt: string;
};

export type TenantMember = {
  tenantId: string;
  userId: string;
  role: TenantRole;
  displayName: string;
  email: string;
  joinedAt: string;
};

export type TenantInvite = {
  id: string;
  tenantId: string;
  inviteCode: string;
  email: string | null;
  role: Exclude<TenantRole, "owner">;
  expiresAt: string;
  maxUses: number;
  usesCount: number;
  revokedAt: string | null;
  createdAt: string;
};

export type AuditLogItem = {
  id: string;
  tenantId: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  createdAt: string;
};

export type OutboxOp = {
  entityType: EntityType;
  entityId: string;
  payload: Record<string, unknown>;
  updatedAtMs: number;
  deletedAtMs: number | null;
};

export type SyncRejectedItem = {
  entityType: string;
  entityId: string;
  error: string;
  code?: string;
  at: number;
};

export type AdminTenantOverview = {
  id: string;
  slug: string;
  name: string;
  kind: TenantKind;
  baseCurrency: Currency;
  planCode: PlanCode;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string;
  autoDeactivatedAt: string | null;
  ownerId?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  memberCount: number;
  recordCount: number;
  createdAt: string;
};

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export function normalizePlanCode(raw: unknown): PlanCode {
  if (raw === "quarterly" || raw === "semiannual" || raw === "yearly") return raw;
  return "monthly";
}

export function normalizeSubscriptionStatus(raw: unknown): SubscriptionStatus {
  if (
    raw === "pending_approval" ||
    raw === "trialing" ||
    raw === "active" ||
    raw === "past_due" ||
    raw === "expired" ||
    raw === "suspended"
  ) {
    return raw;
  }
  return "active";
}

export function canWriteRole(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function canAdminRole(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isOwnerRole(role: TenantRole | undefined): boolean {
  return role === "owner";
}

export function getEffectiveSubscriptionStatus(
  tenant: Pick<TenantSummary, "mode" | "subscriptionStatus" | "currentPeriodEnd"> | null | undefined,
  isSuperAdmin = false,
  nowMs = Date.now(),
): SubscriptionStatus {
  if (!tenant) return "active";
  if (isSuperAdmin || tenant.mode === "local") return tenant.subscriptionStatus;
  if (
    tenant.subscriptionStatus === "pending_approval" ||
    tenant.subscriptionStatus === "suspended" ||
    tenant.subscriptionStatus === "expired"
  ) {
    return tenant.subscriptionStatus;
  }
  const endMs = Date.parse(tenant.currentPeriodEnd);
  if (Number.isFinite(endMs) && endMs <= nowMs) {
    return "expired";
  }
  return tenant.subscriptionStatus;
}

export function getSubscriptionAccessBlock(
  tenant: Pick<TenantSummary, "mode" | "subscriptionStatus" | "currentPeriodEnd"> | null | undefined,
  isSuperAdmin = false,
  nowMs = Date.now(),
): SubscriptionBlockReason | null {
  if (!tenant || isSuperAdmin || tenant.mode === "local") return null;
  const effective = getEffectiveSubscriptionStatus(tenant, isSuperAdmin, nowMs);
  if (effective === "pending_approval") return "pending_approval";
  if (effective === "expired") return "expired";
  if (effective === "suspended") return "suspended";
  return null;
}

export function canEditWorkspace(
  tenant:
    | Pick<TenantSummary, "role" | "subscriptionStatus">
    | Pick<TenantSummary, "role" | "mode" | "subscriptionStatus" | "currentPeriodEnd">
    | null
    | undefined,
  isSuperAdmin = false,
  nowMs = Date.now(),
): boolean {
  if (!tenant) return true;
  if (!isSuperAdmin) {
    if (
      tenant.subscriptionStatus === "suspended" ||
      tenant.subscriptionStatus === "expired" ||
      tenant.subscriptionStatus === "pending_approval"
    ) {
      return false;
    }
    if ("currentPeriodEnd" in tenant && "mode" in tenant && tenant.mode === "cloud") {
      const endMs = Date.parse(tenant.currentPeriodEnd);
      if (Number.isFinite(endMs) && endMs <= nowMs) {
        return false;
      }
    }
  }
  return canWriteRole(tenant.role);
}

export function getRemainingSubscriptionDays(currentPeriodEnd: string, nowMs = Date.now()): number {
  const endMs = Date.parse(currentPeriodEnd);
  if (!Number.isFinite(endMs)) return 0;
  const days = Math.ceil((endMs - nowMs) / 86_400_000);
  return Object.is(days, -0) ? 0 : days;
}

export function formatPlanLabel(code: PlanCode, lang: "ar" | "en"): string {
  const ar: Record<PlanCode, string> = {
    monthly: "شهر واحد",
    quarterly: "3 أشهر",
    semiannual: "6 أشهر",
    yearly: "سنة كاملة",
  };
  const en: Record<PlanCode, string> = {
    monthly: "1 Month",
    quarterly: "3 Months",
    semiannual: "6 Months",
    yearly: "1 Year",
  };
  return (lang === "en" ? en : ar)[code] ?? code;
}

export function formatSubscriptionStatusLabel(status: SubscriptionStatus, lang: "ar" | "en"): string {
  const ar: Record<SubscriptionStatus, string> = {
    pending_approval: "بانتظار مراجعة المالك",
    trialing: "تجريبي",
    active: "نشط",
    past_due: "مستحق التجديد",
    expired: "منتهي (معطّل تلقائياً)",
    suspended: "موقوف إدارياً",
  };
  const en: Record<SubscriptionStatus, string> = {
    pending_approval: "Pending Approval",
    trialing: "Trialing",
    active: "Active",
    past_due: "Past Due",
    expired: "Expired (Auto-Deactivated)",
    suspended: "Suspended",
  };
  return (lang === "en" ? en : ar)[status] ?? status;
}

export function formatRoleLabel(role: TenantRole, lang: "ar" | "en"): string {
  const ar: Record<TenantRole, string> = {
    owner: "مالك",
    admin: "مدير",
    member: "محرر",
    viewer: "مشاهد فقط",
  };
  const en: Record<TenantRole, string> = {
    owner: "Owner",
    admin: "Admin",
    member: "Editor",
    viewer: "Viewer",
  };
  return (lang === "en" ? en : ar)[role];
}

export function formatTenantKindLabel(kind: TenantKind, lang: "ar" | "en"): string {
  const ar: Record<TenantKind, string> = {
    personal: "شخصي",
    family: "عائلي",
    business: "نشاط تجاري",
  };
  const en: Record<TenantKind, string> = {
    personal: "Personal",
    family: "Family",
    business: "Business",
  };
  return (lang === "en" ? en : ar)[kind];
}
