import { CompactStat, CompactStatGrid } from "../common/compact";
import type { SummaryItem, ScreenerSummaryProps } from "./types";

export function buildSummaryItems(items: SummaryItem[]): SummaryItem[] {
  return items;
}

export function getTone(item: SummaryItem): string {
  if (item.color) {
    return `var(--mantine-color-${item.color}-6)`;
  }
  return "var(--mantine-color-text)";
}

export function ScreenerSummary({ summary }: ScreenerSummaryProps) {
  return (
    <CompactStatGrid>
      {summary.map((item) => (
        <CompactStat
          key={item.label}
          label={item.label}
          value={item.value}
          tone={item.color ? `var(--mantine-color-${item.color}-6)` : "var(--mantine-color-text)"}
          className="summary-card"
          testId={`summary-card-${item.label}`}
        />
      ))}
    </CompactStatGrid>
  );
}
