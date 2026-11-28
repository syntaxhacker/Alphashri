import { createMemo, createSignal, For } from "solid-js";
import { Box, Text, typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import type { OptionsAnalytics } from "@/api/optionsAnalytics";
import type { DockLeg } from "@/state/optionsDock";
import { expectedMove } from "@/utils/optionsMath";
import { formatNumber } from "@/utils/ui-helpers";
import {
  PayoffChartCore,
  formatPop,
  type PayoffGuide,
  type PayoffSnapshot,
} from "../PayoffChartCore";
import { volPointsToIvDecimal } from "../charts/payoffMath";
import type { ProfitScenario } from "./probRead";
import { readProb } from "./probRead";
import type { AnalyticsMetricVM, AnalyticsTone } from "./types";

const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

const TONE_VAR: Record<AnalyticsTone, string> = {
  positive: "var(--color-fin-positive)",
  negative: "var(--color-fin-negative)",
  warning: "var(--color-fin-warning)",
  info: "var(--color-fin-info)",
  neutral: "var(--color-fin-text-muted)",
};

const POP_HINT = "flat-vol POP / skew-adjusted POP — chance of finishing in profit under each model";
const MODEL_HINT = "flat vol = constant-IV lognormal · skew-adjusted = IV smile";
const SIGMA_HINT = "one standard deviation of the expiry distribution, in rupees";

const METRIC_HINTS: Record<string, string> = {
  "prob-metric-density": MODEL_HINT,
  "prob-metric-pop": POP_HINT,
  "prob-metric-sigma": SIGMA_HINT,
};

function modelLabel(model: string | null | undefined): string {
  if (!model) return "flat vol";
  const normalized = model.toLowerCase();
  if (normalized.includes("svi") || normalized.includes("skew") || normalized.includes("rnd")) {
    return "skew-adjusted";
  }
  return "flat vol";
}

function signedRupees(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
}

/** The compact P&L ladder under the canvas: one scrollable line, five rungs. */
function ScenarioRow(props: { scenarios: ProfitScenario[] }) {
  return (
    <Box
      className="flex shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-t border-fin-border px-2 py-1"
      data-testid="prob-scenarios"
    >
      <For each={props.scenarios}>
        {(scenario, index) => (
          <>
            <Text
              size="xs"
              className="font-mono tabular-nums"
              style={{
                "font-size": `${typeSize("micro")}px`,
                color:
                  scenario.pnl >= 0
                    ? "var(--color-fin-positive)"
                    : "var(--color-fin-negative)",
              }}
              data-testid={`prob-scenario-${index()}`}
            >
              {scenario.label} {signedRupees(scenario.pnl)}
            </Text>
            {index() < props.scenarios.length - 1 ? (
              <Text size="xs" c="dimmed" style={{ "font-size": `${typeSize("micro")}px` }}>
                ·
              </Text>
            ) : null}
          </>
        )}
      </For>
    </Box>
  );
}

/** Local footer cell: same shape as the shared metric, plus a native tooltip. */
function ProbMetric(props: {
  label: string;
  value: string;
  testId: string;
  tone?: AnalyticsTone;
  bordered?: boolean;
  hint?: string;
}) {
  return (
    <Box
      className={`flex min-w-0 flex-1 flex-col justify-center px-1.5${
        props.bordered ? " border-l border-fin-border" : ""
      }`}
      data-testid={props.testId}
      title={props.hint}
    >
      <Text
        size="xs"
        c="dimmed"
        className="truncate uppercase"
        style={{ "font-size": `${typeSize("micro")}px`, "letter-spacing": "0.06em", "line-height": "1.1" }}
      >
        {props.label}
        {props.hint ? " ⓘ" : ""}
      </Text>
      <Text
        size="xs"
        fw={700}
        className="truncate font-mono tabular-nums"
        style={{
          "font-size": `${typeSize("micro")}px`,
          "line-height": "1.2",
          ...(props.tone ? { color: TONE_VAR[props.tone] } : {}),
        }}
        data-testid={`${props.testId}-value`}
      >
        {props.value}
      </Text>
    </Box>
  );
}

function ProbFooter(props: { metrics: AnalyticsMetricVM[]; testId?: string }) {
  return (
    <Box
      className="flex h-[24px] shrink-0 items-stretch border-t border-fin-border"
      data-testid={props.testId ?? "prob-footer"}
    >
      <For each={props.metrics}>
        {(metric, index) => (
          <ProbMetric
            label={metric.label}
            value={metric.value}
            testId={metric.testId ?? `prob-metric-${index() + 1}`}
            tone={metric.tone}
            bordered={index() > 0}
            hint={METRIC_HINTS[metric.testId ?? ""]}
          />
        )}
      </For>
    </Box>
  );
}

/** Probability view of the same position: flat-vol payoff plus the skew read. */
export function ProbPanel(props: {
  legs: DockLeg[];
  spot: number;
  /** ATM IV in vol points (13.8 = 13.8 %). */
  iv: number | null;
  dteYears: number;
  data: OptionsAnalytics | null;
}) {
  const [snapshot, setSnapshot] = createSignal<PayoffSnapshot | null>(null);
  const ivDecimal = () => volPointsToIvDecimal(props.iv);
  const hasLegs = () => props.legs.length > 0;

  const prob = createMemo(() => readProb(props.legs, props.spot));

  const sigma = createMemo(() => {
    const probability = props.data?.probability;
    if (finite(probability?.sigma)) return probability!.sigma!;
    return Number.isFinite(ivDecimal())
      ? expectedMove(props.spot, ivDecimal(), props.dteYears)
      : null;
  });

  const sigmaBand = createMemo((): [number, number] | null => {
    const value = sigma();
    return finite(value) ? [props.spot - value!, props.spot + value!] : null;
  });

  const guides = createMemo((): PayoffGuide[] => {
    const out: PayoffGuide[] = [];
    const seen = new Set<string>();
    for (const leg of props.legs) {
      const key = `${leg.type}|${leg.strike}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        x: leg.strike,
        color: leg.type === "CE" ? palette.INFO : palette.WARNING,
        dash: "dotted",
        label: `${leg.type} ${formatNumber(leg.strike)}`,
      });
    }
    const pain = props.data?.levels.maxPain;
    if (finite(pain)) {
      out.push({ x: pain!, color: palette.PRIMARY, dash: "dashed", label: "MP" });
    }
    return out;
  });

  const metrics = (): AnalyticsMetricVM[] => {
    const snap = snapshot();
    const probability = props.data?.probability;
    const flatPop = finite(probability?.flatPop)
      ? formatPop(probability!.flatPop!)
      : snap
        ? formatPop(snap.pop)
        : "—";
    const skewAvailable = finite(probability?.skewPop);
    const popValue = skewAvailable
      ? `${flatPop} / ${formatPop(probability!.skewPop!)}`
      : `${flatPop} · skew POP unavailable for stocks`;
    const pnl = finite(probability?.expectedPnl)
      ? probability!.expectedPnl!
      : (snap?.expectedPnl ?? null);
    const pnlText = finite(pnl)
      ? `${pnl! > 0 ? "+" : pnl! < 0 ? "−" : ""}₹${formatNumber(Math.abs(pnl!))}`
      : "—";
    const move = sigma();
    const moveText = finite(move) ? `₹${formatNumber(move!)}` : "—";
    return [
      {
        label: "MODEL",
        value: modelLabel(probability?.model),
        testId: "prob-metric-density",
      },
      {
        label: "POP",
        value: popValue,
        testId: "prob-metric-pop",
      },
      {
        label: "EXPECTED P&L",
        value: pnlText,
        testId: "prob-metric-pnl",
        tone: finite(pnl) ? (pnl! > 0 ? "positive" : "negative") : undefined,
      },
      {
        label: "1σ MOVE",
        value: moveText,
        testId: "prob-metric-sigma",
      },
    ];
  };

  return (
    <Box className="flex min-h-0 flex-1 flex-col" data-testid="analytics-prob">
      {hasLegs() ? (
        <>
          <PayoffChartCore
            legs={props.legs}
            spot={props.spot}
            iv={ivDecimal()}
            dteYears={props.dteYears}
            guides={guides()}
            footer={false}
            data-testid="prob-chart"
            onSnapshot={setSnapshot}
            shadeProfitLoss={true}
            breakevens={prob().breakevens}
            sigmaBand={sigmaBand()}
          />
          <ScenarioRow scenarios={prob().scenarios} />
          <ProbFooter metrics={metrics()} testId="prob-footer" />
        </>
      ) : (
        <Box
          className="flex min-h-0 flex-1 items-center justify-center"
          data-testid="prob-empty"
        >
          <Text size="xs" c="dimmed">
            Add a leg to see probability
          </Text>
        </Box>
      )}
    </Box>
  );
}
