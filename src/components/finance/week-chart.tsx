import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Amount } from "@/components/finance/ui";
import { useI18n } from "@/lib/finance/i18n";
import { formatNumber } from "@/lib/finance/logic";
import { useFinance } from "@/lib/finance/store";

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
  label?: string;
}) {
  const currency = useFinance((s) => s.currency);
  const { dir } = useI18n();
  if (!active || !payload?.length) return null;
  return (
    <div dir={dir} className="surface-card rounded-cell px-3 py-2 text-caption text-label">
      <p className="text-label-2">{label}</p>
      {payload.map((p) => (
        <p key={p.name}>
          {p.name}: <Amount value={Number(p.value ?? 0)} currency={currency} />
        </p>
      ))}
    </div>
  );
}

export function WeekChart({ weeks }: { weeks: { label: string; income: number; expense: number }[] }) {
  const { lang, numeralStyle, isRtl, t } = useI18n();
  return (
    <div className="h-44" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weeks} barGap={2} barCategoryGap="28%">
          <XAxis
            dataKey="label"
            reversed={isRtl}
            tick={{ fontSize: 11, fill: "var(--label-2)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            orientation={isRtl ? "right" : "left"}
            width={44}
            tick={{ fontSize: 10, fill: "var(--label-3)" }}
            tickFormatter={(v) => formatNumber(Number(v), numeralStyle, lang)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTip />} cursor={{ fill: "var(--fill)" }} />
          <Bar dataKey="income" name={t("incomeSingular")} fill="var(--green)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expense" name={t("expenseSingular")} fill="var(--red)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export default WeekChart;
