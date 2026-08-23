import { CompactStat, CompactStatGrid } from "../common/compact";
import type { SummaryItem, ScreenerSummaryProps } from "./types";

export function buildSummaryItems(items: SummaryItem[]): SummaryItem[] {
  return items;
}

const COLOR_MAP: Record<string, string> = {
  green: "success.main",
  teal: "success.main",
  red: "error.main",
  blue: "primary.main",
  cyan: "info.main",
  violet: "secondary.main",
  orange: "warning.main",
  gray: "text.secondary",
};
export function getTone(item: SummaryItem): string {
  if (item.color) {
    return COLOR_MAP[item.color] || "text.primary";
  }
  return "text.primary";
}

export function ScreenerSummary({ summary }: ScreenerSummaryProps) {
  return (
    <CompactStatGrid>
      {summary.map((item) => (
        <CompactStat
          key={item.label}
          label={item.label}
          value={item.value}
          tone={item.color ? COLOR_MAP[item.color] || "text.primary" : "text.primary"}
          className="summary-card"
          testId={`summary-card-${item.label}`}
        />
      ))}
    </CompactStatGrid>
  );
}
