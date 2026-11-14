import { For } from "solid-js";
import { CompactStat, CompactStatGrid } from "../common/compact";
import type { SummaryItem, ScreenerSummaryProps } from "./types";

export function buildSummaryItems(items: SummaryItem[]): SummaryItem[] {
  return items;
}

const COLOR_MAP: Record<string, string> = {
  green: "var(--color-fin-positive)",
  teal: "var(--color-fin-info)",
  red: "var(--color-fin-negative)",
  blue: "var(--color-fin-primary)",
  cyan: "var(--color-fin-info)",
  violet: "var(--color-fin-text-muted)",
  orange: "var(--color-fin-warning)",
  gray: "var(--color-fin-text-muted)",
};
export function getTone(item: SummaryItem): string {
  if (item.color) {
    return COLOR_MAP[item.color] || "var(--color-fin-text)";
  }
  return "var(--color-fin-text)";
}

export function ScreenerSummary(props: ScreenerSummaryProps) {
  return (
    <CompactStatGrid className="gap-1 p-2">
      <For each={props.summary}>
        {(item) => (
          <CompactStat
            label={item.label}
            value={item.value}
            tone={getTone(item)}
            data-testid={`summary-card-${item.label}`}
            className="flex items-center justify-between"
          />
        )}
      </For>
    </CompactStatGrid>
  );
}
