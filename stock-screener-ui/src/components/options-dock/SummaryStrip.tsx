import { For, Show, createMemo } from "solid-js";
import { Box, Text, Tooltip, useMediaQuery, typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumber } from "@/utils/ui-helpers";
import { expectedMove, maxPain, pcr } from "@/utils/optionsMath";
import type { ChainLevel, ChainRow, OptionChainLevels } from "@/api/optionsDock";
import { optionsDockState } from "../../state/optionsDock";
import { CHAIN_NARROW_QUERY } from "./OptionChainTable";

/** One dense readout cell in the summary strip. */
function Stat(props: { label: string; value: string; title?: string; testId: string }) {
  return (
    <Tooltip label={props.title ?? props.label}>
      <Box className="flex min-w-0 flex-col items-start" data-testid={props.testId}>
        <Text
          size="xs"
          c="dimmed"
          className="uppercase"
          style={{ "font-size": `${typeSize("micro")}px`, "letter-spacing": "0.06em", "line-height": "1.1" }}
        >
          {props.label}
        </Text>
        <Text
          size="xs"
          fw={700}
          className="font-mono tabular-nums"
          style={{ "font-size": `${typeSize("micro")}px`, "line-height": "1.2" }}
        >
          {props.value}
        </Text>
      </Box>
    </Tooltip>
  );
}

/**
 * A level marker: coloured dot + label + strike. The tint and the dot carry the
 * side's meaning; the ink stays TEXT so the strike is readable on the tint.
 */
function LevelChip(props: {
  label: string;
  strikeText: string;
  color: string;
  title: string;
  testId: string;
}) {
  return (
    <Box
      component="span"
      className="inline-block shrink-0 whitespace-nowrap rounded px-1 py-0.5 font-mono tabular-nums"
      style={{
        "font-size": `${typeSize("micro")}px`,
        "line-height": "1.2",
        "background-color": palette.alpha(props.color, 0.10),
        color: palette.TEXT,
      }}
      title={props.title}
      data-testid={props.testId}
    >
      <span
        style={{ color: props.color }}
        data-testid={`options-level-dot-${props.label.toLowerCase()}`}
        aria-hidden="true"
      >
        ●
      </span>{" "}
      <span className="uppercase">{props.label}</span>{" "}
      <span>{props.strikeText}</span>
    </Box>
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
  /** Strike levels; falls back to the chain frame in the dock store. */
  levels?: OptionChainLevels | null;
}) {
  const narrow = useMediaQuery(CHAIN_NARROW_QUERY);
  // Levels are the last frame the dock rendered; the dock shows that frame's time, so no freshness gate here.
  const levels = () => (props.levels !== undefined ? props.levels : (optionsDockState.chain?.levels ?? null));

  // A present levels block is authoritative: a null maxPain means no strike
  // qualified (zero/empty OI) and must stay a dash, never a lowest-strike fake.
  // The pure calculation is only the legacy fallback for frames with no levels.
  const pain = createMemo(() => {
    const lv = levels();
    if (lv) {
      const strike = lv.maxPain?.strike;
      return strike != null && Number.isFinite(strike) && strike > 0 ? strike : null;
    }
    return maxPain(props.rows.map((row) => ({ strike: row.strike, ceOi: row.ce.oi, peOi: row.pe.oi })));
  });
  const ratio = createMemo(() => pcr(props.rows.map((row) => ({ ceOi: row.ce.oi, peOi: row.pe.oi }))));
  const totalOi = createMemo(() =>
    props.rows.reduce((sum, row) => sum + row.ce.oi + row.pe.oi, 0),
  );
  const sigma = createMemo(() =>
    props.atmIv != null && props.atmIv > 0
      ? expectedMove(props.spot, props.atmIv / 100, props.dteYears)
      : 0,
  );
  const atmIvText = () => (props.atmIv != null && props.atmIv > 0 ? `${props.atmIv.toFixed(1)}%` : "—");
  const thin = createMemo(() => {
    const total = totalOi();
    if (total < 50_000) return true;
    const largest = props.rows.reduce((max, row) => Math.max(max, row.ce.oi, row.pe.oi), 0);
    return total > 0 && largest / total > 0.4;
  });
  const isThin = createMemo(() => thin() || levels()?.thin === true);

  const levelLine = createMemo(() => {
    const parts: { label: string; strikeText: string; title: string; color: string }[] = [];
    const add = (level: ChainLevel | null | undefined, label: string, name: string, color: string) => {
      if (!level) return;
      const strength =
        level.strength != null && Number.isFinite(level.strength)
          ? `${Math.round(level.strength * 100)}% confidence`
          : "strength unavailable";
      const strikeText = level.strike.toLocaleString("en-IN");
      parts.push({
        label,
        color,
        strikeText,
        title: `${name} ${strikeText} · ${strength}`,
      });
    };
    add(levels()?.gex?.support, "SUP", "Gamma support", palette.LEVEL_SUPPORT);
    add(levels()?.gex?.resistance, "RES", "Gamma resistance", palette.LEVEL_RESISTANCE);
    add(levels()?.putWall, "PW", "Put wall", palette.LEVEL_PUT_WALL);
    add(levels()?.callWall, "CW", "Call wall", palette.LEVEL_CALL_WALL);
    return parts;
  });
  const visibleLevels = createMemo(() => (narrow() ? levelLine().filter((p) => p.label === "SUP" || p.label === "RES") : levelLine()));

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
      title: `spot × ATM IV × √T = ${props.spot.toFixed(1)} × ${atmIvText()} × √(${props.dteYears.toFixed(4)})`,
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
      <Show when={!isThin() && visibleLevels().length > 0}>
        <Box
          className="flex shrink-0 items-center gap-1 self-center font-mono tabular-nums"
          data-testid="options-levels-line"
        >
          <For each={visibleLevels()}>
            {(part) => (
              <LevelChip
                label={part.label}
                strikeText={part.strikeText}
                color={part.color}
                title={part.title}
                testId={`options-level-${part.label.toLowerCase()}`}
              />
            )}
          </For>
        </Box>
      </Show>
      <Text
        size="xs"
        c="warning"
        className="self-center uppercase"
        data-testid="options-thin-chain"
        title="A single strike holding most of the OI, or a very thin book"
        style={{ "font-size": `${typeSize("micro")}px`, display: isThin() ? undefined : "none" }}
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
