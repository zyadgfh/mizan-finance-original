import {
  Briefcase,
  Car,
  Clapperboard,
  Ellipsis,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  ShoppingBag,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { IconName, Tone } from "@/lib/finance/types";
import { cn } from "@/lib/cn";

const ICONS: Record<IconName, LucideIcon> = {
  utensils: Utensils,
  car: Car,
  zap: Zap,
  house: House,
  bag: ShoppingBag,
  health: HeartPulse,
  edu: GraduationCap,
  fun: Clapperboard,
  more: Ellipsis,
  briefcase: Briefcase,
  wallet: Wallet,
  gift: Gift,
  trend: TrendingUp,
  tag: Tag,
};

const TONE: Record<Tone, string> = {
  tint: "bg-tint",
  green: "bg-income",
  red: "bg-expense",
  orange: "bg-warn",
  gray: "bg-sysgray",
};

export function Glyph({
  name,
  size = 18,
  className,
  filled = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  filled?: boolean;
}) {
  const Icon = ICONS[name] ?? Tag;
  return (
    <Icon
      className={className}
      size={size}
      strokeWidth={filled ? 2.25 : 1.9}
      fill={filled ? "currentColor" : "none"}
      aria-hidden
    />
  );
}

export function IconTile({
  name,
  tone,
  className,
}: {
  name: IconName;
  tone: Tone;
  className?: string;
}) {
  return (
    <span className={cn("icon-tile", TONE[tone], className)}>
      <Glyph name={name} size={16} />
    </span>
  );
}
