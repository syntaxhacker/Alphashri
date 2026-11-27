import { createMemo, Show } from "solid-js";
import { Box, Loader, Paper, Text } from "@/ui";
import { formatNumberIN, formatPercentage, formatTimeOnly } from "@/utils/ui-helpers";
import type { MarketRow } from "../../types/marketScreener";
import { BREADTH_MIN_COVERAGE, computeMarketBreadth } from "./marketBreadth";

const DASH = "—";

const countText = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? DASH : formatNumberIN(value);

function BreadthStat(props: {
  label: string;
  value: string;
  testId: string;
  tone?: "success" | "error" | "dimmed";
  hint?: string;
}) {
  return (
    <Box className="flex flex-col flex-shrink-0 gap-0.5" title={props.hint}>
      <Text size="xs" c="dimmed" className="leading-none">
        {props.label}
      </Text>
      <Text
        size="xs"
        fw={600}
        c={props.tone}
        className="font-mono tabular-nums leading-none"
        data-testid={props.testId}
      >
        {props.value}
      </Text>
    </Box>
  );
}

export interface MarketBreadthStripProps {
  /** Full snapshot rows, never the filtered/sorted table view. */
  rows: MarketRow[];
  /** Snapshot timestamp from `useMarketSnapshotSolid`. */
  asOf?: string | null;
  /** A cached snapshot stays visible while refreshing; only a bare load shows the skeleton. */
  isLoading?: boolean;
}

/**
 * One compact strip directly under the Market toolbar. The scroll container
 * keeps all nine stats on one line at 1600 and confines overflow to itself at
 * 390 — the panel's flex column must never become page-wide scrollable.
 */
export function MarketBreadthStrip(props: MarketBreadthStripProps) {
  const breadth = createMemo(() => computeMarketBreadth(props.rows));
  const empty = () => props.rows.length === 0;
  const loading = () => props.isLoading === true && empty();
  const asOfText = () => (props.asOf ? `as of ${formatTimeOnly(props.asOf)}` : `as of ${DASH}`);

  const coverageNote = createMemo(() => {
    const b = breadth();
    const thin: string[] = [];
    if (!b.changeCoverage.reliable) thin.push(`day change ${b.changeCoverage.covered}/${b.changeCoverage.total}`);
    if (!b.high52Coverage.reliable) thin.push(`52W highs ${b.high52Coverage.covered}/${b.high52Coverage.total}`);
    if (!b.low52Coverage.reliable) thin.push(`52W lows ${b.low52Coverage.covered}/${b.low52Coverage.total}`);
    if (!b.volumeCoverage.reliable) thin.push(`volume ${b.volumeCoverage.covered}/${b.volumeCoverage.total}`);
    return thin.length > 0
      ? `Low field coverage: ${thin.join("; ")} (need ≥${Math.round(BREADTH_MIN_COVERAGE * 100)}%) — affected stats show ${DASH}`
      : null;
  });

  return (
    <Paper
      elevation={0}
      data-testid="market-breadth"
      role="region"
      aria-label="Market breadth from loaded rows"
      className="flex items-center gap-2 px-2 py-1 border border-fin-border rounded-sm bg-fin-surface flex-shrink-0 min-w-0 overflow-hidden"
    >
      <Show when={loading()} fallback={
        <Show when={!empty()} fallback={
          <Box data-testid="market-breadth-empty" className="flex items-center gap-2 min-w-0">
            <Text size="xs" c="dimmed">Breadth</Text>
            <Text size="xs" c="dimmed" data-testid="market-breadth-empty-text">
              No rows loaded — breadth unavailable
            </Text>
          </Box>
        }>
          <Box className="flex items-center gap-3 min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" className="flex-shrink-0 leading-none">
              Breadth
            </Text>
            <BreadthStat
              label="Adv"
              testId="market-breadth-advances"
              value={countText(breadth().advances)}
              tone="success"
              hint="Loaded rows with a positive day change"
            />
            <BreadthStat
              label="Dec"
              testId="market-breadth-declines"
              value={countText(breadth().declines)}
              tone="error"
              hint="Loaded rows with a negative day change"
            />
            <BreadthStat
              label="Unch"
              testId="market-breadth-unchanged"
              value={countText(breadth().unchanged)}
              tone="dimmed"
              hint="Loaded rows with no signed move (including missing change)"
            />
            <BreadthStat
              label="New highs"
              testId="market-breadth-new-highs"
              value={countText(breadth().newHighs)}
              tone="success"
              hint="Close at/above 52W high (raw level or signed gap)"
            />
            <BreadthStat
              label="New lows"
              testId="market-breadth-new-lows"
              value={countText(breadth().newLows)}
              tone="error"
              hint="Close at/below 52W low (raw level or signed gap)"
            />
            <BreadthStat
              label="Avg"
              testId="market-breadth-avg"
              value={formatPercentage(breadth().avgChange)}
            />
            <BreadthStat
              label="Median"
              testId="market-breadth-median"
              value={formatPercentage(breadth().medianChange)}
            />
            <BreadthStat
              label="Up vol"
              testId="market-breadth-up-volume"
              value={countText(breadth().upVolumeCount)}
              tone="success"
              hint="Count of advancing names with volume ≥ average (not summed volume)"
            />
            <BreadthStat
              label="Down vol"
              testId="market-breadth-down-volume"
              value={countText(breadth().downVolumeCount)}
              tone="error"
              hint="Count of declining names with volume ≥ average (not summed volume)"
            />
            <Box className="flex flex-col flex-shrink-0 gap-0.5">
              <Text size="xs" c="dimmed" className="leading-none">Rows</Text>
              <Text
                size="xs"
                className="font-mono tabular-nums leading-none"
                data-testid="market-breadth-rows"
              >
                {countText(breadth().loadedRows)}
                <Show when={breadth().etfsExcluded > 0}>
                  {` (${breadth().etfsExcluded} ETF${breadth().etfsExcluded === 1 ? "" : "s"} excluded)`}
                </Show>
              </Text>
            </Box>
            <Text
              size="xs"
              c="dimmed"
              className="flex-shrink-0 whitespace-nowrap"
              data-testid="market-breadth-as-of"
            >
              {asOfText()}
            </Text>
            <Show when={coverageNote()}>
              {(note) => (
                <Text
                  size="xs"
                  c="warning"
                  className="flex-shrink-0 whitespace-nowrap"
                  data-testid="market-breadth-coverage"
                  title={note()}
                >
                  Coverage: {note()}
                </Text>
              )}
            </Show>
          </Box>
        </Show>}>
        <Box data-testid="market-breadth-loading" className="flex items-center gap-2 min-w-0">
          <Loader size={12} />
          <Text size="xs" c="dimmed">Loading breadth…</Text>
        </Box>
      </Show>
    </Paper>
  );
}
