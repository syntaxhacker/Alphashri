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
  const clickableSx = (key: StatCell["key"]) =>
    clickable(key)
      ? {
          cursor: "pointer",
          borderRadius: 0.5,
          px: 0.25,
          "&:hover": { bgcolor: "action.hover" },
        }
      : {};
  return (
    <Box
      data-testid="patterns-stats"
      sx={{
        display: "flex",
        alignItems: "center",
        minHeight: 18,
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
              sx={[{
                display: "flex",
                alignItems: "baseline",
                gap: 0.75,
                whiteSpace: "nowrap",
                minWidth: 0,
              }, clickableSx(cell.key)]}
            >
              <Text size="xs" c="dimmed" style={{ textTransform: "uppercase", fontSize: 10 }} fw={700} truncate>
                {cell.label}
              </Text>
              <Text size="xs" fw={700} c={cell.tone ?? "text.primary"} style={{ fontSize: 10 }} truncate>
                {cell.key === "bull_bear" && onSelect ? (
                  <>
                    <Box
                      component="span"
                      role="button"
                      data-testid="patterns-stat-bullish"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect("bullish");
                      }}
                      sx={{ "&:hover": { textDecoration: "underline" } }}
                    >
                      {num(summary?.bullish)}
                    </Box>
                    {" / "}
                    <Box
                      component="span"
                      role="button"
                      data-testid="patterns-stat-bearish"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect("bearish");
                      }}
                      sx={{ "&:hover": { textDecoration: "underline" } }}
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
