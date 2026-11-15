import type { Currency } from "../finance/types.ts";

export type TenantRole = "owner" | "admin" | "member" | "viewer";
export type TenantKind = "personal" | "family" | "business";
export type TenantMode = "cloud" | "local";
export type PlanCode = "monthly" | "yearly";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "suspended";
export type PaymentMethod = "instapay" | "vodafone_cash" | "bank_transfer" | "other";
export type PaymentRequestStatus = "pending" | "approved" | "rejected";

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
  displayName: string;
  avatarUrl?: string;
};

export type SubscriptionPlan = {
  code: PlanCode;
  nameAr: string;
  nameEn: string;
  priceEgp: number;
  billingInterval: "month" | "year";
  trialDays: number;
  isActive: boolean;
};

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
  planCode: PlanCode;
  amountEgp: number;
  paymentMethod: PaymentMethod;
  referenceCode: string;
  senderHandle: string | null;
  notes: string | null;
  status: PaymentRequestStatus;
  reviewedAt: string | null;
  adminNote: string | null;
  createdAt: string;
};

export type AdminManagedUser = {
  id: string;
  email: string;
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
  ownerEmail: string;
  memberCount: number;
  recordCount: number;
  createdAt: string;
};

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export function canWriteRole(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function canAdminRole(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isOwnerRole(role: TenantRole | undefined): boolean {
  return role === "owner";
}

export function canEditWorkspace(tenant: Pick<TenantSummary, "role" | "subscriptionStatus"> | null | undefined): boolean {
  if (!tenant) return true;
  if (tenant.subscriptionStatus === "suspended") return false;
  return canWriteRole(tenant.role);
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
