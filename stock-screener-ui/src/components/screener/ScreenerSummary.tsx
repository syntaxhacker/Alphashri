import { CompactStat, CompactStatGrid } from "../common/compact";
import type { SummaryItem } from "../../types";

interface ScreenerSummaryProps {
  summary: SummaryItem[];
}

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
      {summary.map((item, index) => (
        <CompactStat
          key={index}
          label={item.label}
          value={item.value}
          tone={item.color ? `var(--mantine-color-${item.color}-6)` : "var(--mantine-color-text)"}
          className="summary-card"
          testId={`summary-card-${index}`}
        />
      ))}
    </CompactStatGrid>
  );
}
