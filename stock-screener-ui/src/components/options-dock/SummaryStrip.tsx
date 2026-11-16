import { For, createMemo } from "solid-js";
import { Box, Text, Tooltip } from "@/ui";
import { formatNumber } from "@/utils/ui-helpers";
import { expectedMove, maxPain, pcr } from "@/utils/optionsMath";
import type { ChainRow } from "@/api/optionsDock";

/** One dense readout cell in the summary strip. */
function Stat(props: { label: string; value: string; title?: string; testId: string }) {
  return (
    <Tooltip label={props.title ?? props.label}>
      <Box className="flex min-w-0 flex-col items-start" data-testid={props.testId}>
        <Text
          size="xs"
          c="dimmed"
          className="uppercase"
          style={{ "font-size": "9px", "letter-spacing": "0.06em", "line-height": "1.1" }}
        >
          {props.label}
        </Text>
        <Text
          size="xs"
          fw={700}
          className="font-mono tabular-nums"
          style={{ "font-size": "11px", "line-height": "1.2" }}
        >
          {props.value}
        </Text>
      </Box>
    </Tooltip>
  );
}

export function formatDte(dteDays: number): string {
  if (dteDays <= 0) return "0-DTE";
  if (dteDays === 1) return "1d";
  return `${dteDays}d`;
}

/**
 * PCR · max pain · ±1σ · ATM IV · DTE · total OI.
 *
 * Everything is derived from the frame the table below is showing, so a strip
 * that disagrees with the chain is not possible.
 */
export function SummaryStrip(props: {
  rows: ChainRow[];
  spot: number;
  pcr: number | null;
  atmIv: number | null;
  dteDays: number;
  dteYears: number;
}) {
  const pain = createMemo(() =>
    maxPain(props.rows.map((row) => ({ strike: row.strike, ceOi: row.ce.oi, peOi: row.pe.oi }))),
  );
  const ratio = createMemo(() => pcr(props.rows.map((row) => ({ ceOi: row.ce.oi, peOi: row.pe.oi }))));
  const totalOi = createMemo(() =>
    props.rows.reduce((sum, row) => sum + row.ce.oi + row.pe.oi, 0),
  );
  const sigma = createMemo(() =>
    props.atmIv != null && props.atmIv > 0
      ? expectedMove(props.spot, props.atmIv / 100, props.dteYears)
      : 0,
  );
  const thin = createMemo(() => {
    const total = totalOi();
    if (total < 50_000) return true;
    const largest = props.rows.reduce((max, row) => Math.max(max, row.ce.oi, row.pe.oi), 0);
    return total > 0 && largest / total > 0.4;
  });

  const stats = createMemo(() => [
    {
      label: "PCR",
      value: formatRatio(props.pcr ?? ratio()),
      testId: "options-stat-pcr",
      title: "Put OI ÷ call OI. A level, not a signal — its meaning flips with regime.",
    },
    {
      label: "PAIN",
      value: pain() == null ? "—" : Math.round(pain()!).toLocaleString("en-IN"),
      testId: "options-stat-max-pain",
      title: "Max pain: the strike where option writers lose the least.",
    },
    {
      label: "±1σ",
      value: sigma() > 0 ? Math.round(sigma()!).toLocaleString("en-IN") : "—",
      testId: "options-stat-sigma",
      title: `spot × ATM IV × √T = ${props.spot.toFixed(1)} × ${(props.atmIv ?? 0).toFixed(1)}% × √(${props.dteYears.toFixed(4)})`,
    },
    {
      label: "ATM IV",
      value: props.atmIv != null && props.atmIv > 0 ? `${props.atmIv.toFixed(1)}` : "—",
      testId: "options-stat-atm-iv",
      title: "Implied vol at the strike nearest spot, in vol points.",
    },
    {
      label: "DTE",
      value: formatDte(props.dteDays),
      testId: "options-stat-dte",
      title: "Calendar days to expiry. 0-DTE means the contract expires today.",
    },
    {
      label: "OI",
      value: totalOi() > 0 ? formatNumber(totalOi()) : "—",
      testId: "options-stat-total-oi",
      title: "Call + put open interest across the listed strikes.",
    },
  ]);

  return (
    <Box
      className="flex shrink-0 items-stretch gap-3 border-b border-fin-border px-2 py-1"
      data-testid="options-summary"
    >
      <Box className="flex flex-1 flex-wrap items-stretch gap-x-3 gap-y-1">
        <For each={stats()}>{(stat) => <Stat {...stat} />}</For>
      </Box>
      <Text
        size="xs"
        c="warning"
        className="self-center uppercase"
        data-testid="options-thin-chain"
        title="A single strike holding most of the OI, or a very thin book"
        style={{ "font-size": "9px", display: thin() ? undefined : "none" }}
      >
        thin chain
      </Text>
    </Box>
  );
}

function formatRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}
