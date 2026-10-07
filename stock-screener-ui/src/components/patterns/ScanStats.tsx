import { useEffect, useState } from "react";
import { Box, Divider, Text, ToolbarRow } from "@/ui";
import type { PatternSummary } from "@/types/chartPatterns";

export interface ScanStatsProps {
  summary: PatternSummary | null;
}

interface StatCell {
  key: "scanned" | "patterns" | "in_view" | "confirmed" | "bull_bear" | "data_through" | "last_scan";
  label: string;
  value: string;
  tone?: string;
}

function num(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-IN");
}

/** Compact relative age of the last completed scan ("12 min ago", "2 h ago"). */
function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins <= 0) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function buildCells(summary: PatternSummary | null): StatCell[] {
  return [
    { key: "scanned", label: "Scanned", value: num(summary?.scanned) },
    { key: "patterns", label: "Patterns", value: num(summary?.patterns) },
    { key: "in_view", label: "In view", value: num(summary?.in_view) },
    { key: "confirmed", label: "Confirmed", value: num(summary?.confirmed), tone: "success" },
    {
      key: "bull_bear",
      label: "Bull / Bear",
      value: `${num(summary?.bullish)} / ${num(summary?.bearish)}`,
      tone: "primary",
    },
    { key: "data_through", label: "Data through", value: summary?.data_through ?? "—" },
    { key: "last_scan", label: "Last scan", value: relativeAge(summary?.last_scan_at) },
  ];
}

/** Dense inline stat strip (~32px): `LABEL value` pairs separated by dividers, no Card. */
export function ScanStats({ summary }: ScanStatsProps) {
  // `relativeAge` derives from `Date.now()`, so without a tick it freezes until
  // the next store update. Re-render every 60s to keep "x min ago" fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const cells = buildCells(summary);
  return (
    <Box
      data-testid="patterns-stats"
      sx={{
        display: "flex",
        alignItems: "center",
        minHeight: 32,
        overflowX: "auto",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <ToolbarRow gap={0} wrap={false} style={{ overflowX: "auto" }}>
        {cells.map((cell, index) => (
          <Box key={cell.key} sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {index > 0 ? (
              <Divider orientation="vertical" sx={{ height: 16, mx: 1.5 }} />
            ) : null}
            <Box
              data-testid={`patterns-stat-${cell.key}`}
              sx={{
                display: "flex",
                alignItems: "baseline",
                gap: 0.75,
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              <Text size="xs" c="dimmed" style={{ textTransform: "uppercase" }} fw={700} truncate>
                {cell.label}
              </Text>
              <Text size="xs" fw={700} c={cell.tone ?? "text.primary"} truncate>
                {cell.value}
              </Text>
            </Box>
          </Box>
        ))}
      </ToolbarRow>
    </Box>
  );
}
