import { useEffect, useState } from "react";
import { Box, Divider, Text, ToolbarRow } from "@/ui";
import type { JobDTO, PatternSummary } from "@/types/chartPatterns";
import { formatAgeLong, formatNumberIN } from "@/utils/ui-helpers";

export interface ScanStatsProps {
  summary: PatternSummary | null;
  /**
   * Live scan job. While `queued`/`running` the strip reports the job's own
   * progress instead of the last completed scan, which would otherwise look
   * current while the progress bar is still moving.
   */
  job?: JobDTO | null;
  /**
   * Makes the actionable cells filter the results: `confirmed` toggles the
   * status filter, `bullish` / `bearish` toggle the direction filter.
   */
  onSelect?: (kind: "confirmed" | "bullish" | "bearish") => void;
}

interface StatCell {
  key: "scanned" | "patterns" | "in_view" | "confirmed" | "bull_bear" | "data_through" | "last_scan";
  label: string;
  value: string;
  tone?: string;
}

function num(value: number | null | undefined): string {
  return value == null ? "—" : formatNumberIN(value);
}

/** Compact relative age of the last completed scan ("12 min ago", "2 h ago"). */
function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  return formatAgeLong(Date.now() - ts);
}

function buildCells(summary: PatternSummary | null, job?: JobDTO | null): StatCell[] {
  const activeJob =
    job && (job.status === "queued" || job.status === "running") ? job : null;
  const scanned =
    activeJob && activeJob.total
      ? `${num(activeJob.done ?? 0)} / ${num(activeJob.total)}`
      : num(summary?.scanned);
  const lastScan = activeJob
    ? activeJob.status === "queued"
      ? activeJob.queue_position != null
        ? `queued #${activeJob.queue_position}`
        : "queued"
      : "running…"
    : relativeAge(summary?.last_scan_at);
  return [
    { key: "scanned", label: "Scanned", value: scanned },
    { key: "patterns", label: "Patterns", value: num(summary?.patterns) },
    { key: "in_view", label: "In view", value: num(summary?.in_view) },
    { key: "confirmed", label: "Confirmed", value: num(summary?.confirmed), tone: "success" },
    {
      key: "bull_bear",
      label: "Bull / Bear",
      value: `${num(summary?.bullish)} / ${num(summary?.bearish)}`,
      tone: "primary",
    },
    {
      key: "data_through",
      label: "Last candle",
      value: activeJob?.data_through ?? summary?.data_through ?? "—",
    },
    { key: "last_scan", label: "Last scan", value: lastScan },
  ];
}

/** Dense inline stat strip (~28px): `LABEL value` pairs separated by dividers, no Card. */
export function ScanStats({ summary, job = null, onSelect }: ScanStatsProps) {
  // `relativeAge` derives from `Date.now()`, so without a tick it freezes until
  // the next store update. Re-render every 60s to keep "x min ago" fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const cells = buildCells(summary, job);
  const clickable = (key: StatCell["key"]): boolean =>
    !!onSelect && (key === "confirmed" || key === "bull_bear");
  return (
    <Box
      data-testid="patterns-stats"
      className="flex min-h-[18px] items-center overflow-x-auto tabular-nums"
    >
      <ToolbarRow gap={0} wrap={false} style={{ "overflow-x": "auto" }}>
        {cells.map((cell, index) => (
          <Box key={cell.key} className="flex shrink-0 items-center">
            {index > 0 ? (
              <Divider orientation="vertical" style={{ height: 16 }} className="mx-3" />
            ) : null}
            <Box
              data-testid={`patterns-stat-${cell.key}`}
              title={
                cell.key === "confirmed"
                  ? "Click to filter: confirmed only"
                  : cell.key === "bull_bear"
                    ? "Click a number to filter by direction"
                    : undefined
              }
              onClick={
                cell.key === "confirmed" && onSelect
                  ? () => onSelect("confirmed")
                  : undefined
              }
              className={`flex min-w-0 items-baseline gap-1.5 whitespace-nowrap ${
                clickable(cell.key)
                  ? "cursor-pointer rounded-[4px] px-[2px] transition-colors hover:bg-fin-surface-alt"
                  : ""
              }`}
            >
              <Text size="xs" c="dimmed" style={{ "text-transform": "uppercase", "font-size": 10 }} fw={700} truncate>
                {cell.label}
              </Text>
              <Text size="xs" fw={700} c={cell.tone ?? "default"} style={{ "font-size": 10 }} truncate>
                {cell.key === "bull_bear" && onSelect ? (
                  <>
                    <Box
                      component="span"
                      role="button"
                      data-testid="patterns-stat-bullish"
                      className="hover:underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect("bullish");
                      }}
                    >
                      {num(summary?.bullish)}
                    </Box>
                    {" / "}
                    <Box
                      component="span"
                      role="button"
                      data-testid="patterns-stat-bearish"
                      className="hover:underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect("bearish");
                      }}
                    >
                      {num(summary?.bearish)}
                    </Box>
                  </>
                ) : (
                  cell.value
                )}
              </Text>
            </Box>
          </Box>
        ))}
      </ToolbarRow>
    </Box>
  );
}
