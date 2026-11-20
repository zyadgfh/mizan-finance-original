import type { Data } from "../finance/types.ts";
import { SUPABASE_AUTH_STORAGE_KEY } from "../supabase/client.ts";

export function hasLocalPkceVerifier(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): boolean {
  if (!storage) return false;
  try {
    const verifier = storage.getItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`);
    return typeof verifier === "string" && verifier.trim().length > 0;
  } catch {
    return false;
  }
}

export function parseSafeDeepLinkAction(rawUrl: string): {
  pkceCode: string | null;
  linkType: string | null;
  inviteCode: string | null;
  rejectedImplicitTokens: boolean;
} {
  const parsed = new URL(rawUrl);
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const hasImplicitTokens = Boolean(
    hashParams.get("access_token") ||
      hashParams.get("refresh_token") ||
      parsed.searchParams.get("access_token") ||
      parsed.searchParams.get("refresh_token"),
  );
  const pkceCode = parsed.searchParams.get("code")?.trim() || null;
  const linkType = parsed.searchParams.get("type") ?? hashParams.get("type") ?? null;
  const fullPath = parsed.host ? `/${parsed.host}${parsed.pathname}` : parsed.pathname;
  const inviteMatch = fullPath.match(/\/invite\/([A-Za-z0-9-]+)/);
  const rawInvite = parsed.searchParams.get("invite")?.trim() || inviteMatch?.[1] || "";
  const inviteCode = rawInvite ? rawInvite.toUpperCase() : null;
  return {
    pkceCode,
    linkType,
    inviteCode,
    rejectedImplicitTokens: hasImplicitTokens,
  };
}

export function hasMeaningfulLegacyLedgerData(data: Data | null): boolean {
  if (!data) return false;
  return Boolean(
    data.txns.length > 0 ||
      data.people.length > 0 ||
      data.debts.length > 0 ||
      data.payments.length > 0 ||
      (data.transfers?.length ?? 0) > 0 ||
      (data.goals?.length ?? 0) > 0 ||
      (data.goalMoves?.length ?? 0) > 0 ||
      (data.recurring?.length ?? 0) > 0 ||
      (data.budgets?.length ?? 0) > 0 ||
      Number(data.openingBalance ?? 0) !== 0,
  );
}
