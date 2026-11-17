import { createMemo, Show } from "solid-js";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { ChainRow } from "@/api/optionsDock";
import type { AnalyticsIvPoint, OptionsAnalytics } from "@/api/optionsAnalytics";
import type { DockLeg } from "@/state/optionsDock";
import { maxPain } from "@/utils/optionsMath";
import {
  formatVp,
  ivSignature,
  riskReversal,
  smilePoints,
  type OptionSide,
} from "@/utils/optionsAnalyticsMath";
import { AnalyticsChartCore } from "./AnalyticsChartCore";
import { AnalyticsFooter } from "./AnalyticsFooter";
import { useChartInk } from "./chartInk";
import {
  atmStrikeOf,
  buildSmileOption,
  findWing,
  formatStrike,
  wingAnnotation,
  wingVerdict,
} from "./smileChart";
import type { AnalyticsMetricVM } from "./types";

function ivPoints(rows: readonly ChainRow[], side: OptionSide): AnalyticsIvPoint[] {
  return rows.map((row) => {
    const leg = side === "CE" ? row.ce : row.pe;
    return {
      strike: row.strike,
      moneyness: null,
      iv: leg.iv,
      delta: leg.delta,
      oi: leg.oi,
    };
  });
}

const INK_STYLE = {
  "font-size": "10px",
  color: "var(--color-fin-text-muted)",
} as const;

/**
 * IV smile from the *current* chain frame. No analytics request: the OTM wings,
 * the 25Δ read and max pain all come from the rows already on screen.
 */
export function SmilePanel(props: {
  rows: ChainRow[];
  spot: number;
  atmIv: number | null;
  legs: DockLeg[];
  /** Front-expiry 25Δ butterfly, when the analytics frame has arrived. */
  bf25?: number | null;
  /** Backend analytics payload — `levels.maxPain` is authoritative when present. */
  data?: OptionsAnalytics | null;
  /** Optional expiry caption, e.g. `23 NOV · 6d`. */
  expiryLabel?: string;
}) {
  const ink = useChartInk();
  const ceRows = createMemo(() => ivPoints(props.rows, "CE"));
  const peRows = createMemo(() => ivPoints(props.rows, "PE"));
  const ce = createMemo(() => smilePoints(ceRows(), props.spot, "CE"));
  const pe = createMemo(() => smilePoints(peRows(), props.spot, "PE"));
  const all = createMemo(() => [...ceRows(), ...peRows()]);
  const rr = createMemo(() => riskReversal(all()));
  const callWing = createMemo(() => findWing(ce(), "CE"));
  const putWing = createMemo(() => findWing(pe(), "PE"));
  const annotation = createMemo(() => wingAnnotation(callWing(), putWing()));
  // A present backend frame is authoritative: a null maxPain means no strike
  // qualified (zero/empty OI) and must stay a dash, never a recomputed fake.
  // The pure calc is only the legacy fallback for frames without backend levels.
  const pain = createMemo(() => {
    if (props.data) {
      const strike = props.data.levels?.maxPain;
      return strike != null && Number.isFinite(strike) ? strike : null;
    }
    return maxPain(props.rows.map((row) => ({ strike: row.strike, ceOi: row.ce.oi, peOi: row.pe.oi })));
  });
  const legStrikes = createMemo(() =>
    [...new Set(props.legs.map((leg) => leg.strike))].sort((a, b) => a - b),
  );
  const empty = createMemo(() => ce().length === 0 && pe().length === 0);
  const rrHint = createMemo(() => wingVerdict(rr()));

  const option = createMemo(() =>
    buildSmileOption({
      ce: ce(),
      pe: pe(),
      spot: props.spot,
      legStrikes: legStrikes(),
      pain: pain(),
      callWing: callWing(),
      putWing: putWing(),
      ink: ink(),
    }),
  );

  const optionKey = createMemo(
    () =>
      `${ivSignature(all(), props.spot)}|${rr()}|${props.bf25 ?? "x"}|${pain() ?? "x"}|${legStrikes().join(",")}` +
      `|atm${atmStrikeOf(all(), props.spot) ?? "x"}|c${callWing()?.strike ?? "x"}|p${putWing()?.strike ?? "x"}`,
  );

  const metrics = (): AnalyticsMetricVM[] => [
    {
      label: "ATM IV",
      value: props.atmIv != null ? props.atmIv.toFixed(1) : "—",
      testId: "smile-metric-atm",
    },
    {
      label: rrHint() ? `25Δ RR · ${rrHint()}` : "25Δ RR",
      value: formatVp(rr()),
      testId: "smile-metric-rr",
      tone: rr() == null ? undefined : (rr() as number) > 0 ? "positive" : "negative",
    },
    {
      label: "WINGS VS ATM",
      value: formatVp(props.bf25 ?? null),
      testId: "smile-metric-wings",
    },
    {
      label: "MAX PAIN ₹",
      value: pain() != null ? formatStrike(pain() as number) : "—",
      testId: "smile-metric-max-pain",
    },
  ];

  return (
    <Box className="flex min-h-0 flex-1 flex-col" data-testid="analytics-smile">
      <Box className="flex h-[18px] shrink-0 items-center gap-2 overflow-hidden px-2">
        <Text
          size="xs"
          className="shrink-0 truncate font-mono uppercase"
          style={{ ...INK_STYLE, "letter-spacing": "0.06em" }}
          data-testid="smile-caption"
        >
          IV by strike{props.expiryLabel ? ` · ${props.expiryLabel}` : ""}
        </Text>
        <Box
          className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto whitespace-nowrap"
          style={{ "scrollbar-width": "none" }}
          data-testid="smile-legend"
        >
          <Text size="xs" className="shrink-0 font-mono" style={INK_STYLE}>
            <span style={{ color: palette.INFO }}>●</span> Calls
          </Text>
          <Text size="xs" className="shrink-0 font-mono" style={INK_STYLE}>
            <span style={{ color: palette.WARNING }}>●</span> Puts
          </Text>
          <Text size="xs" className="shrink-0 font-mono" style={INK_STYLE}>
            <span style={{ color: palette.PRIMARY }}>▲</span> Spot
          </Text>
          <Text size="xs" className="shrink-0 font-mono" style={INK_STYLE}>
            <span style={{ color: palette.WARNING }}>╎</span> Max pain
          </Text>
        </Box>
      </Box>
      <AnalyticsChartCore
        option={option()}
        optionKey={optionKey()}
        empty={empty()}
        emptyText="No IV quotes — No valid IV quotes for this expiry — try another expiry"
        testId="smile-chart"
      />
      <Show when={!empty()}>
        <Box
          className="flex h-[16px] shrink-0 items-center overflow-x-auto whitespace-nowrap px-2"
          style={{ "scrollbar-width": "none" }}
          data-testid="smile-wings"
        >
          <Text size="xs" className="truncate font-mono" style={INK_STYLE}>
            {annotation()}
          </Text>
        </Box>
      </Show>
      <AnalyticsFooter metrics={metrics()} testId="smile-footer" />
    </Box>
  );
}
