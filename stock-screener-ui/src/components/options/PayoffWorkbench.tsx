import { createMemo, createSignal, type JSX } from "solid-js";
import { Box, Text, Tooltip } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import {
  PayoffChartCore,
  formatPop,
  type PayoffGuide,
  type PayoffSnapshot,
} from "@/components/options-dock/PayoffChartCore";
import type { DockLeg } from "@/state/optionsDock";
import { dteYearsBetween } from "@/utils/optionsMath";

/** A leg as the replay/paper book stores it, before the dock mapping. */
export interface WorkbenchLeg {
  action: string;
  opt: string;
  strike: number;
  qty: number;
  entryPremium: number;
}

export interface PayoffWorkbenchProps {
  legs: WorkbenchLeg[];
  spot: number;
  /** ATM IV in vol points (13.8 = 13.8 %); `null` when the chain quotes none. */
  ivVolPoints: number | null;
  asOf: string;
  expiry: string;
  /** Half-width of the sampled spot window, in percent (default 10). */
  rangePct?: number;
  dataTestId?: string;
  onSnapshot?: (snapshot: PayoffSnapshot | null) => void;
}

/** Pure: map incoming legs onto the dock's leg contract. */
export function toDockLegs(legs: readonly WorkbenchLeg[], expiry: string): DockLeg[] {
  return legs.map((leg) => ({
    key: `${leg.opt}-${leg.strike}`,
    expiry,
    side: leg.action.toLowerCase() as DockLeg["side"],
    type: leg.opt as DockLeg["type"],
    strike: leg.strike,
    premium: leg.entryPremium,
    lots: 1,
    lotSize: leg.qty,
  }));
}

/** Pure: one labelled strike line per leg, drawn over the model's zero/BE/spot guides. */
export function buildLegGuides(legs: readonly WorkbenchLeg[]): PayoffGuide[] {
  return legs.map((leg) => ({
    x: leg.strike,
    color: palette.INFO,
    dash: "dotted",
    label: `${leg.opt} ${formatNumberIN(leg.strike)}`,
  }));
}

function signedInr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}₹${formatNumberIN(value)}`;
}

function beLabel(values: number[]): string {
  return values.length ? values.map((be) => `₹${formatNumberIN(be)}`).join(" / ") : "—";
}

function tone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return palette.TEXT_MUTED;
  return value > 0 ? palette.POSITIVE : value < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
}

function KpiCell(props: { label: string; children: JSX.Element }) {
  return (
    <Box className="flex min-w-0 flex-col gap-1 rounded-fin border border-fin-border-subtle bg-fin-surface px-2 py-2">
      <Text span className="uppercase tracking-[0.06em] text-fin-text-muted" style={{ "font-size": "9px" }}>
        {props.label}
      </Text>
      <Text span className="block w-full text-right font-mono tabular-nums" style={{ "font-size": "12px" }}>
        {props.children}
      </Text>
    </Box>
  );
}

/**
 * Dock-style payoff workbench for replay/paper. One clean payoff line with split
 * green/red areas and the model's guides, a NET DEBIT / POP header and a compact
 * KPI strip — all read from the single snapshot published by PayoffChartCore.
 * No heatmap machinery and no second payoff integral live in the default view.
 */
export function PayoffWorkbench(props: PayoffWorkbenchProps) {
  const [snapshot, setSnapshot] = createSignal<PayoffSnapshot | null>(null);
  const dockLegs = createMemo(() => toDockLegs(props.legs, props.expiry));
  const guides = createMemo(() => buildLegGuides(props.legs));

  const ivDecimal = () => {
    const iv = props.ivVolPoints;
    return iv != null && Number.isFinite(iv) && iv > 0 ? iv / 100 : Number.NaN;
  };
  const ivUnavailable = () => !Number.isFinite(ivDecimal());

  const publish = (next: PayoffSnapshot | null) => {
    setSnapshot(next);
    props.onSnapshot?.(next);
  };

  const debit = () => signedInr(snapshot()?.netPremium ?? null);
  const maxLoss = () => signedInr(snapshot()?.maxLoss ?? null);
  const maxProfit = () => signedInr(snapshot()?.maxProfit ?? null);
  const expected = () => signedInr(snapshot()?.expectedPnl ?? null);
  const sigma = () => {
    const s = snapshot()?.sigma;
    return s != null && Number.isFinite(s) ? formatNumberIN(Math.round(s)) : "—";
  };
  const be = () => beLabel(snapshot()?.breakevens ?? []);
  const pop = () => formatPop(snapshot()?.pop ?? Number.NaN);
  const profitTone = () => tone(snapshot()?.maxProfit ?? null);
  const lossTone = () => tone(snapshot()?.maxLoss ?? null);
  const expectedTone = () => tone(snapshot()?.expectedPnl ?? null);

  return (
    <Box
      data-testid={props.dataTestId ?? "replay-payoff-workbench"}
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <Box className="flex shrink-0 items-baseline justify-between gap-2">
        <Box className="flex items-baseline gap-1.5">
          <Text size="xs" c="dimmed" className="uppercase" style={{ "font-size": "9px" }}>
            NET DEBIT
          </Text>
          <Text size="xs" fw={700} className="font-mono tabular-nums" style={{ "font-size": "12px" }} data-testid="replay-matrix-kpi-debit">
            {debit()}
          </Text>
        </Box>
        <Tooltip
          label={ivUnavailable() ? "IV unavailable — intrinsic only" : "Model POP at the supplied IV"}
          data-testid="replay-matrix-kpi-pop-tooltip"
          className="shrink-0"
        >
          <Box className="flex items-baseline gap-1.5">
            <Text size="xs" c="dimmed" className="uppercase" style={{ "font-size": "9px" }}>
              CHANCE OF PROFIT
            </Text>
            <Text size="xs" fw={700} className="font-mono tabular-nums" style={{ "font-size": "12px" }} data-testid="replay-matrix-kpi-pop">
              {pop()}
            </Text>
          </Box>
        </Tooltip>
      </Box>

      <Box className="flex min-h-0 flex-1 flex-col" style={{ "min-height": "180px" }}>
        <PayoffChartCore
          legs={dockLegs()}
          spot={props.spot}
          iv={ivDecimal()}
          dteYears={dteYearsBetween(props.asOf, props.expiry)}
          widthPct={props.rangePct ?? 10}
          footer={false}
          guides={guides()}
          onSnapshot={publish}
          data-testid="replay-payoff-chart"
        />
      </Box>

      <Box data-testid="replay-matrix-kpis" className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCell label="BE">
          <span data-testid="replay-matrix-kpi-breakevens">{be()}</span>
        </KpiCell>
        <KpiCell label="MAX P/L">
          <span data-testid="replay-matrix-kpi-max-profit" style={{ color: profitTone() }}>{maxProfit()}</span>
          <span style={{ color: palette.TEXT_MUTED }}> / </span>
          <span data-testid="replay-matrix-kpi-max-loss" style={{ color: lossTone() }}>{maxLoss()}</span>
        </KpiCell>
        <KpiCell label="MODEL E[P&L]">
          <span style={{ color: expectedTone() }}>{expected()}</span>
        </KpiCell>
        <KpiCell label="±1σ">
          <span>{sigma()}</span>
        </KpiCell>
      </Box>
    </Box>
  );
}
