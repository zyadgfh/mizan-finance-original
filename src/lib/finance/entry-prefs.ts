import { normalizeSearch } from "./logic.ts";
import type { Category, Recurring, Tx, TxKind } from "./types.ts";

const ENTRY_PREFS_KEY = "mizan.entry-prefs.v1";

export type EntryPrefs = {
  lastWalletId?: string;
  lastCategoryByKind?: Partial<Record<TxKind, string>>;
};

export type QuickTemplate = {
  id: string;
  title: string;
  kind: TxKind;
  amount: number;
  categoryId: string;
  walletId: string;
  note: string;
  source: "recurring" | "frequent";
};

export function loadEntryPrefs(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): EntryPrefs {
  try {
    const raw = storage?.getItem(ENTRY_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<EntryPrefs>;
    return {
      lastWalletId: typeof parsed.lastWalletId === "string" ? parsed.lastWalletId : undefined,
      lastCategoryByKind:
        parsed.lastCategoryByKind && typeof parsed.lastCategoryByKind === "object"
          ? parsed.lastCategoryByKind
          : undefined,
    };
  } catch {
    return {};
  }
}

export function saveEntryPrefs(
  prefs: EntryPrefs,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  try {
    storage?.setItem(ENTRY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore storage unavailable */
  }
}

export function rememberEntryChoice(
  kind: TxKind,
  categoryId: string,
  walletId: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  const prev = loadEntryPrefs(storage);
  saveEntryPrefs(
    {
      lastWalletId: walletId || prev.lastWalletId,
      lastCategoryByKind: {
        ...prev.lastCategoryByKind,
        [kind]: categoryId,
      },
    },
    storage,
  );
}

export function frequentTemplates(
  txns: Tx[],
  recurring: Recurring[],
  categories: Category[],
  limit = 6,
): QuickTemplate[] {
  const templates: QuickTemplate[] = [];
  const seen = new Set<string>();
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";

  for (const r of recurring.filter((item) => item.active)) {
    const label = r.note.trim() || catName(r.categoryId) || "متكرر";
    const sig = `${r.kind}:${r.categoryId}:${normalizeSearch(label)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    templates.push({
      id: `tpl-rec-${r.id}`,
      title: label,
      kind: r.kind,
      amount: r.amount,
      categoryId: r.categoryId,
      walletId: r.walletId || "w-cash",
      note: r.note.trim() || label,
      source: "recurring",
    });
    if (templates.length >= limit) return templates;
  }

  const freq = new Map<string, { count: number; latest: Tx }>();
  for (const t of txns) {
    if (t.reported === false || t.source === "debt") continue;
    const label = t.note.trim() || catName(t.categoryId);
    if (!label) continue;
    const sig = `${t.kind}:${t.categoryId}:${normalizeSearch(label)}`;
    const prev = freq.get(sig);
    if (!prev) freq.set(sig, { count: 1, latest: t });
    else {
      prev.count += 1;
      if (t.createdAt > prev.latest.createdAt) prev.latest = t;
    }
  }

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].latest.createdAt - a[1].latest.createdAt)
    .map(([sig, entry]) => ({ sig, tx: entry.latest }));

  for (const { sig, tx } of ranked) {
    if (seen.has(sig)) continue;
    seen.add(sig);
    const label = tx.note.trim() || catName(tx.categoryId);
    templates.push({
      id: `tpl-tx-${tx.id}`,
      title: label,
      kind: tx.kind,
      amount: tx.amount,
      categoryId: tx.categoryId,
      walletId: tx.walletId || "w-cash",
      note: tx.note.trim(),
      source: "frequent",
    });
    if (templates.length >= limit) break;
  }

  return templates;
}

export { ENTRY_PREFS_KEY };
