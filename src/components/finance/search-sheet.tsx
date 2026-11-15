import { Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useMizan } from "@/components/finance/context";
import { IconTile } from "@/components/finance/icons";
import { Amount, Group, PersonName, PillButton, Row, Section, Sheet } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import { dayLabel, debtStatus, debtStatusLabel, shiftISO, shortDate, todayISO, unifiedSearch } from "@/lib/finance/logic";
import { useFinance } from "@/lib/finance/store";

type DatePreset = "all" | "7d" | "30d" | "month" | "custom";

export function UnifiedSearchSheet() {
  const { closeSheet, frame, month, openSheet, openDebt, openPerson } = useMizan();
  const data = useFinance();
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [personId, setPersonId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [onlyRecurring, setOnlyRecurring] = useState(false);
  const [onlyUnsettled, setOnlyUnsettled] = useState(false);

  const effectiveRange = useMemo(() => {
    const today = todayISO();
    if (datePreset === "7d") return { from: shiftISO(-6), to: today };
    if (datePreset === "30d") return { from: shiftISO(-29), to: today };
    if (datePreset === "month") return { from: `${month}-01`, to: `${month}-31` };
    if (datePreset === "custom") return { from: dateFrom, to: dateTo };
    return { from: "", to: "" };
  }, [datePreset, dateFrom, dateTo, month]);

  const results = useMemo(() => {
    const min = minAmount.trim() ? Number(minAmount) : undefined;
    const max = maxAmount.trim() ? Number(maxAmount) : undefined;
    return unifiedSearch(data, {
      query,
      dateFrom: effectiveRange.from || undefined,
      dateTo: effectiveRange.to || undefined,
      categoryId: categoryId || undefined,
      personId: personId || undefined,
      walletId: walletId || undefined,
      minAmount: Number.isFinite(min) ? min : undefined,
      maxAmount: Number.isFinite(max) ? max : undefined,
      onlyRecurring,
      onlyUnsettled,
    });
  }, [data, query, effectiveRange, categoryId, personId, walletId, minAmount, maxAmount, onlyRecurring, onlyUnsettled]);

  function resetFilters() {
    setQuery("");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setCategoryId("");
    setPersonId("");
    setWalletId("");
    setMinAmount("");
    setMaxAmount("");
    setOnlyRecurring(false);
    setOnlyUnsettled(false);
  }

  const totalHits = results.txns.length + results.debts.length + results.people.length;

  return (
    <Sheet
      title="بحث شامل ومرشحات"
      description="البحث في المعاملات والأشخاص والديون"
      container={frame}
      onClose={closeSheet}
      trailing={
        <PillButton tone="plain" onClick={resetFilters}>
          إعادة ضبط
        </PillButton>
      }
    >
      <div className="px-4 pt-1">
        <div className="flex items-center gap-2 rounded-cell bg-fill px-3">
          <Search size={18} className="shrink-0 text-label-2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في المعاملات، الأشخاص، الديون، المحافظ…"
            className="field"
            autoFocus
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="مسح البحث" className="text-label-2">
              <X size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="إظهار أو إخفاء المرشحات"
            className={cn(
              "inline-flex min-h-9 items-center gap-1 rounded-inner px-2 text-caption font-semibold",
              showFilters ? "bg-tint text-on-tint" : "bg-cell text-label",
            )}
          >
            <SlidersHorizontal size={14} />
            <span>فلاتر</span>
          </button>
        </div>

        {showFilters ? (
          <div className="surface-card mt-3 space-y-2.5 rounded-cell p-3">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "كل التواريخ"],
                  ["7d", "آخر 7 أيام"],
                  ["30d", "آخر 30 يوم"],
                  ["month", "الشهر المختار"],
                  ["custom", "نطاق مخصص"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDatePreset(id)}
                  className={cn(
                    "min-h-8 rounded-pill px-3 text-caption font-semibold",
                    datePreset === id ? "bg-tint text-on-tint" : "bg-fill text-label-2",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {datePreset === "custom" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-caption text-label-2">من تاريخ</span>
                  <input
                    type="date"
                    dir="ltr"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="field mt-1 rounded-inner bg-fill px-2 text-sub"
                  />
                </label>
                <label className="block">
                  <span className="text-caption text-label-2">إلى تاريخ</span>
                  <input
                    type="date"
                    dir="ltr"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="field mt-1 rounded-inner bg-fill px-2 text-sub"
                  />
                </label>
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-caption text-label-2">التصنيف</span>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="field mt-1 rounded-inner bg-fill px-2 text-foot"
                >
                  <option value="">الكل</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-caption text-label-2">الشخص</span>
                <select
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                  className="field mt-1 rounded-inner bg-fill px-2 text-foot"
                >
                  <option value="">الكل</option>
                  {data.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-caption text-label-2">طريقة الدفع</span>
                <select
                  value={walletId}
                  onChange={(e) => setWalletId(e.target.value)}
                  className="field mt-1 rounded-inner bg-fill px-2 text-foot"
                >
                  <option value="">الكل</option>
                  {data.wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-caption text-label-2">أقل مبلغ</span>
                <input
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  className="field num mt-1 rounded-inner bg-fill px-2.5 text-sub"
                />
              </label>
              <label className="block">
                <span className="text-caption text-label-2">أعلى مبلغ</span>
                <input
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="∞"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  className="field num mt-1 rounded-inner bg-fill px-2.5 text-sub"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOnlyRecurring((v) => !v)}
                className={cn(
                  "min-h-9 rounded-pill px-3 text-caption font-semibold",
                  onlyRecurring ? "bg-tint text-on-tint" : "bg-fill text-label-2",
                )}
              >
                {onlyRecurring ? "✓ " : ""}المتكررة فقط
              </button>
              <button
                type="button"
                onClick={() => setOnlyUnsettled((v) => !v)}
                className={cn(
                  "min-h-9 rounded-pill px-3 text-caption font-semibold",
                  onlyUnsettled ? "bg-tint text-on-tint" : "bg-fill text-label-2",
                )}
              >
                {onlyUnsettled ? "✓ " : ""}غير المسددة فقط
              </button>
            </div>
          </div>
        ) : null}

        <p className="mt-3 px-1 text-foot text-label-2">
          النتائج: {totalHits} ({results.txns.length} حركة · {results.debts.length} دين · {results.people.length} شخص)
        </p>
      </div>

      {results.debts.length ? (
        <Section title={`الديون (${results.debts.length})`} className="mt-4">
          <Group>
            {results.debts.slice(0, 12).map(({ debt, rem }) => {
              const person = data.people.find((p) => p.id === debt.personId);
              const status = debtStatus(debt, data.payments);
              return (
                <Row
                  key={debt.id}
                  title={debt.title}
                  sub={
                    <>
                      {person ? <PersonName name={person.name} /> : "بدون شخص"} · {debtStatusLabel(status)}
                      {debt.dueDate ? ` · ${shortDate(debt.dueDate)}` : ""}
                    </>
                  }
                  trailing={<Amount value={rem} currency={data.currency} sign={rem <= 0 ? "none" : debt.direction === "receivable" ? "plus" : "minus"} />}
                  chevron
                  onClick={() => {
                    closeSheet();
                    openDebt(debt.id);
                  }}
                />
              );
            })}
          </Group>
        </Section>
      ) : null}

      {results.people.length ? (
        <Section title={`الأشخاص (${results.people.length})`} className="mt-4">
          <Group>
            {results.people.slice(0, 10).map(({ person, net }) => (
              <Row
                key={person.id}
                title={<PersonName name={person.name} />}
                sub={person.note || person.phone || "تفاصيل الحساب"}
                trailing={<Amount value={net} currency={data.currency} sign="auto" />}
                chevron
                onClick={() => {
                  closeSheet();
                  openPerson(person.id);
                }}
              />
            ))}
          </Group>
        </Section>
      ) : null}

      {results.txns.length ? (
        <Section title={`المعاملات (${results.txns.length})`} className="mt-4">
          <Group sep="icon">
            {results.txns.slice(0, 30).map((t) => {
              const cat = data.categories.find((c) => c.id === t.categoryId);
              const wallet = data.wallets.find((w) => w.id === (t.walletId || "w-cash"));
              const person = t.personId ? data.people.find((p) => p.id === t.personId) : undefined;
              return (
                <Row
                  key={t.id}
                  leading={cat ? <IconTile name={cat.icon} tone={cat.tone} /> : null}
                  title={t.note || cat?.name || "حركة"}
                  sub={
                    <>
                      {cat?.name ?? ""} · {wallet?.name ?? "كاش"} · {dayLabel(t.date)}
                      {person ? (
                        <>
                          {" · "}
                          <PersonName name={person.name} />
                        </>
                      ) : null}
                    </>
                  }
                  trailing={<Amount value={t.amount} currency={data.currency} sign={t.kind === "income" ? "plus" : "minus"} />}
                  onClick={() => openSheet({ kind: "txn", id: t.id })}
                />
              );
            })}
          </Group>
        </Section>
      ) : null}
    </Sheet>
  );
}
