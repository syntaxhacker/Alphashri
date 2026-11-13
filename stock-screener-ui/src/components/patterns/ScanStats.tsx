import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
export function ScanStats(props: ScanStatsProps) {
  // `relativeAge` derives from `Date.now()`, so without a tick it freezes until
  // the next store update. Re-render every 60s to keep "x min ago" fresh.
  const [tick, setTick] = createSignal(0);
  onMount(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    onCleanup(() => window.clearInterval(id));
  });

  const cells = createMemo(() => {
    // Subscribe to the minute tick so `relativeAge` recomputes from Date.now().
    tick();
    return buildCells(props.summary, props.job);
  });
  const clickable = (key: StatCell["key"]): boolean =>
    !!props.onSelect && (key === "confirmed" || key === "bull_bear");

  return (
    <Box
      data-testid="patterns-stats"
      className="flex min-h-[18px] items-center overflow-x-auto tabular-nums"
    >
      <ToolbarRow gap={0} wrap={false} style={{ "overflow-x": "auto" }}>
        <For each={cells()}>
          {(cell, index) => (
            <Box className="flex shrink-0 items-center">
              <Show when={index() > 0}>
                <Divider orientation="vertical" style={{ height: "16px" }} className="mx-3" />
              </Show>
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
                  cell.key === "confirmed" && props.onSelect
                    ? () => props.onSelect?.("confirmed")
                    : undefined
                }
                className={`flex min-w-0 items-baseline gap-1.5 whitespace-nowrap ${
                  clickable(cell.key)
                    ? "cursor-pointer rounded-[4px] px-[2px] transition-colors hover:bg-fin-surface-alt"
                    : ""
                }`}
              >
                <Text size="xs" c="dimmed" style={{ "text-transform": "uppercase", "font-size": "10px" }} fw={700} truncate>
                  {cell.label}
                </Text>
                <Text size="xs" fw={700} c={cell.tone ?? "default"} style={{ "font-size": "10px" }} truncate>
                  <Show when={cell.key === "bull_bear" && props.onSelect} fallback={cell.value}>
                    <>
                      <span
                        role="button"
                        data-testid="patterns-stat-bullish"
                        className="hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onSelect?.("bullish");
                        }}
                      >
                        {num(props.summary?.bullish)}
                      </span>
                      {" / "}
                      <span
                        role="button"
                        data-testid="patterns-stat-bearish"
                        className="hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onSelect?.("bearish");
                        }}
                      >
                        {num(props.summary?.bearish)}
                      </span>
                    </>
                  </Show>
                </Text>
              </Box>
            </Box>
          )}
        </For>
      </ToolbarRow>
    </Box>
  );
}
