import { CompactStat, CompactStatGrid } from "../common/compact";

interface ScreenerSummaryProps {
  summary: Array<{
    label: string;
    value: string | number;
    color?: string;
  }>;
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
