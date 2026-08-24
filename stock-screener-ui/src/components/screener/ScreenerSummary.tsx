import { CompactStat, CompactStatGrid } from "../common/compact";
import type { SummaryItem, ScreenerSummaryProps } from "./types";

export function buildSummaryItems(items: SummaryItem[]): SummaryItem[] {
  return items;
}

const COLOR_MAP: Record<string, string> = {
  green: "var(--mui-palette-success-main)",
  teal: "var(--mui-palette-info-main)",
  red: "var(--mui-palette-error-main)",
  blue: "var(--mui-palette-primary-main)",
  cyan: "var(--mui-palette-info-main)",
  violet: "var(--mui-palette-secondary-main)",
  orange: "var(--mui-palette-warning-main)",
  gray: "var(--mui-palette-secondary-main)",
};
export function getTone(item: SummaryItem): string {
  if (item.color) {
    return COLOR_MAP[item.color] || "var(--mui-palette-text-primary)";
  }
  return "var(--mui-palette-text-primary)";
}

export function ScreenerSummary({ summary }: ScreenerSummaryProps) {
  return (
    <CompactStatGrid sx={{ gap: 1, p: 1 }}>
      {summary.map((item) => (
        <CompactStat
          key={item.label}
          label={item.label}
          value={item.value}
          tone={item.color ? COLOR_MAP[item.color] || "text.primary" : "text.primary"}
          testId={`summary-card-${item.label}`}
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        />
      ))}
    </CompactStatGrid>
  );
}
