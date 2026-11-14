import { Show, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { Sparkline } from "@/components/common/Sparkline";
import {
  ContextCell,
  DecisionCell,
  DecisionChip,
  NiftySpotValue,
  formatOiCr,
  formatSignedPoints,
} from "./reportCells";
import {
  NiftyVerdictStrip,
  resolveRegimeLabel,
  regimeAccent,
  regimeDetail,
} from "./NiftyVerdictStrip";
import { NiftyFlowWindows } from "./NiftyFlowWindows";
import { IndexMoversStrip } from "./IndexMoversStrip";
import { NiftyIntelStrip } from "./NiftyIntelStrip";
import { NiftyGammaStrip } from "./NiftyGammaStrip";
import { SetupRadarStrip } from "./SetupRadarStrip";
import { gexFlipAtSpot } from "./niftyGex";
import { buildDeskPlan } from "./deskPlan";
import { summarizeDeskPlan } from "./deskPlanSummary";
import type { PlanInput } from "./deskPlanSummary";
import { pinHint, pinRisk } from "./niftyPin";
import { resolveWallBoard } from "./niftyWallsFormat";
import { useNiftyReport } from "./ReportContext";

const formatInt = (value: number): string => formatNumberIN(value);

const format2dp = (value: number): string => value.toFixed(2);

const DECISION_STRIP_STYLE: JSX.CSSProperties = {
  "background-color": palette.TERM_HEADER,
  "--desk-border": palette.TERM_BORDER,
};

const INDIA_VIX_STYLE: JSX.CSSProperties = {
  "flex-shrink": 0,
  "font-size": "9px",
  "font-weight": 700,
  "letter-spacing": "0.06em",
  color: palette.TEXT_MUTED,
  border: `1px solid ${palette.TERM_BORDER}`,
  "border-radius": "3px",
  "padding-left": "2px",
  "padding-right": "2px",
  "padding-top": "1px",
  "padding-bottom": "1px",
  "white-space": "nowrap",
};

const PLAN_ONELINER_STYLE: JSX.CSSProperties = {
  "border-color": palette.TERM_BORDER,
  "background-color": palette.TERM_HEADER,
};

const PLAN_BAR_STYLE: JSX.CSSProperties = {
  width: "3px",
  "align-self": "stretch",
  "margin-top": "6px",
  "margin-bottom": "6px",
  "border-radius": "1px",
  "flex-shrink": 0,
};

const PLAN_HEADLINE_STYLE: JSX.CSSProperties = {
  flex: 1,
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  "font-size": "12px",
  "font-weight": 700,
  "letter-spacing": "0.02em",
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
};

const PLAN_CONFIDENCE_STYLE: JSX.CSSProperties = {
  "font-size": "9px",
  "font-weight": 700,
  color: palette.TEXT_MUTED,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  "flex-shrink": 0,
  opacity: 0.8,
};

const TAPE_BADGE_STYLE: JSX.CSSProperties = {
  "flex-shrink": 0,
  "padding-left": "4px",
  "padding-right": "4px",
  "padding-top": "1px",
  "padding-bottom": "1px",
  "border-radius": "3px",
  "font-size": "9px",
  "font-weight": 800,
  "letter-spacing": "0.03em",
  "font-family": palette.MONO,
  "white-space": "nowrap",
};

export function ReportDecisionStrip() {
  const store = useNiftyReport();

  const report = () => store.data.report();
  const metrics = () => store.data.metrics();
  const tapeRows = () => store.data.tapeRows();
  const setup = () => store.data.setup();
  const preMove = () => store.data.preMove();
  const tapeSpeed = () => store.data.tapeSpeed();
  const lastFlip = () => store.data.lastFlip();
  const flowReport = () => store.data.flowReport();
  const isDesk = () => store.ui.isDesk();
  const symbol = () => store.selection.symbol();
  const mode = () => store.selection.mode();
  const expiry = () => store.selection.expiry();
  const date = () => store.selection.date();

  const regime = () => report()?.regime ?? null;

  const gexDegraded = createMemo(() => {
    const current = report();
    if (!current?.gex) return false;
    if (current.gex.degraded === true) return true;
    const strikes = current.strikes ?? [];
    if (strikes.length === 0) return false;
    const hasGamma = (value: number | null | undefined) =>
      typeof value === "number" && Number.isFinite(value);
    return !strikes.some((strike) => hasGamma(strike.ce.gamma) || hasGamma(strike.pe.gamma));
  });

  const gexForDisplay = () => (gexDegraded() ? undefined : report()?.gex);

  const gammaFlip = createMemo(() =>
    gexDegraded() ? null : gexFlipAtSpot(report()?.gex, report()?.spot ?? 0),
  );

  const flipDelta = createMemo(() => {
    const current = report();
    const flip = gammaFlip();
    return current && flip != null ? current.spot - flip : null;
  });

  const wallsBoard = createMemo(() =>
    resolveWallBoard(report()?.wallsNear, report()?.walls),
  );

  const maxCallWall = createMemo(
    () => wallsBoard()?.calls?.[0] ?? report()?.walls?.calls?.[0] ?? null,
  );

  const maxPutWall = createMemo(
    () => wallsBoard()?.puts?.[0] ?? report()?.walls?.puts?.[0] ?? null,
  );

  const maxCallDistance = createMemo(() => {
    const wall = maxCallWall();
    const spot = report()?.spot;
    return wall && spot ? wall.strike - spot : null;
  });

  const maxPutDistance = createMemo(() => {
    const wall = maxPutWall();
    const spot = report()?.spot;
    return wall && spot ? wall.strike - spot : null;
  });

  const nearCallWall = createMemo(
    () => (report()?.wallsNear?.calls ?? report()?.walls?.calls)?.[0] ?? null,
  );

  const pin = createMemo(() => {
    const symbolMetrics = metrics();
    if (!symbolMetrics) return null;
    const current = report();
    return pinRisk({
      spot: current?.spot,
      maxPain: current?.maxPain,
      wallsNear: current?.wallsNear,
      walls: current?.walls,
      metrics: symbolMetrics,
    });
  });

  const squeezeFuel = createMemo(() => {
    const read = pin();
    const wall = nearCallWall();
    if (read?.level !== "HIGH" || !wall) return null;
    const row = (report()?.strikes ?? []).find(
      (strike) => Math.round(Number(strike.strike)) === Math.round(Number(wall.strike)),
    );
    const sentiment = String(row?.ce?.sentiment ?? "").trim().toUpperCase();
    const covering =
      sentiment === "SC" ||
      sentiment === "SHORT COVER" ||
      sentiment === "LU" ||
      sentiment === "LONG UNWIND";
    if (!covering) return null;
    return { strike: Math.round(Number(wall.strike)), sentiment };
  });

  const dayRange = createMemo(() => {
    const current = report();
    if (!current) return null;
    const bars = current.intraday?.length ? current.intraday : (current.candles ?? []);
    let low = current.ohlc?.low ?? 0;
    let high = current.ohlc?.high ?? 0;
    if ((!low || !high) && bars.length > 0) {
      low = Math.min(...bars.map((candle) => candle.low));
      high = Math.max(...bars.map((candle) => candle.high));
    }
    return low > 0 && high > 0 ? { low, high } : null;
  });

  const pcrSeries = createMemo(() => tapeRows().map((row) => row.pcr_oi));

  const maxPainSeries = createMemo(() => tapeRows().map((row) => row.max_pain));

  const setupSummary = () => {
    const gates = setup().gates;
    const passed = gates.filter((gate) => gate.pass).length;
    return `${passed}/${gates.length} · ${preMove().state}`;
  };

  const planSummary = createMemo(() => {
    const current = report();
    if (!current) return null;
    const plan = buildDeskPlan(current);
    const active = plan.bias === "bearish" ? plan.bear : plan.bull;
    const input: PlanInput = {
      bias: plan.bias,
      spot: plan.spot ?? 0,
      bull: {
        do: {
          action: plan.bull.action,
          trigger: plan.bull.entryTrigger,
          stop: plan.bull.stop,
          target: plan.bull.target,
          rr: plan.bull.rr,
        },
      },
      bear: {
        do: {
          action: plan.bear.action,
          trigger: plan.bear.entryTrigger,
          stop: plan.bear.stop,
          target: plan.bear.target,
          rr: plan.bear.rr,
        },
      },
      reasons: active.reasons.map((reason) => ({ tag: reason.tag, text: reason.text })),
    };
    return summarizeDeskPlan(input);
  });

  const planTone = () => {
    const tone = planSummary()?.tone;
    if (tone === "positive") return palette.POSITIVE;
    if (tone === "negative") return palette.NEGATIVE;
    return palette.WARNING;
  };

  const tapeBadge = createMemo(() => {
    const speed = tapeSpeed();
    const summary = planSummary();
    if (!speed || !summary || speed.ratio < 1.5) return null;
    const up = speed.delta > 0;
    const side = summary.headline.startsWith("BEARISH")
      ? "bear"
      : summary.headline.startsWith("BULLISH")
        ? "bull"
        : null;
    const conflict = (side === "bear" && up) || (side === "bull" && !up);
    const tone = conflict ? palette.WARNING : up ? palette.POSITIVE : palette.NEGATIVE;
    return { up, conflict, ratio: speed.ratio, delta: speed.delta, tone };
  });

  const planOneLiner = () => {
    const summary = planSummary();
    const badge = tapeBadge();
    if (!summary) return null;
    return (
      <Box
        data-testid="nifty-plan-oneliner"
        className="flex items-center gap-1 px-2 min-h-[20px] rounded-[4px] border w-full max-w-full min-w-0 shrink-0"
        style={PLAN_ONELINER_STYLE}
      >
        <span aria-hidden style={{ ...PLAN_BAR_STYLE, "background-color": planTone() }} />
        <Box
          data-testid="nifty-plan-headline"
          title={`${summary.action} · confidence ${summary.confidence}%`}
          className="min-w-0"
          style={{ ...PLAN_HEADLINE_STYLE, color: planTone() }}
        >
          {summary.headline}
        </Box>
        <Box data-testid="nifty-plan-confidence" title="Weighted confidence behind the active side" className="shrink-0" style={PLAN_CONFIDENCE_STYLE}>
          {summary.confidence}%
        </Box>
        <Show when={badge}>
          {(current) => (
            <span
              data-testid="nifty-plan-tape"
              data-conflict={current().conflict ? "true" : "false"}
              title={`Last 5 min ${current().up ? "+" : ""}${Math.round(current().delta)} pts — ${current().ratio.toFixed(1)}× the median 5-min move${current().conflict ? " · this OPPOSES the plan side" : ""}`}
              style={{ ...TAPE_BADGE_STYLE, border: `1px solid ${current().tone}`, color: current().tone }}
            >
              {current().conflict ? "⚠ " : ""}TAPE {current().up ? "↑" : "↓"} {current().ratio.toFixed(1)}×
            </span>
          )}
        </Show>
        <Button
          data-testid="nifty-plan-reasons-button"
          size="xs"
          variant="subtle"
          aria-label="Open the full two-sided desk plan"
          title="Open the full two-sided desk plan (E)"
          onClick={store.ui.openPlanReasons}
        >
          ▸
        </Button>
      </Box>
    );
  };

  return (
    <Show when={report()}>
      <Box
        data-testid="nifty-stat-strip"
        className="flex flex-col border border-[var(--desk-border)] rounded-[4px] overflow-hidden w-full max-w-full min-w-0 shrink-0"
        style={DECISION_STRIP_STYLE}
      >
        <Box className="flex flex-wrap min-[1200px]:flex-nowrap items-stretch min-w-0 min-h-[28px]">
          <Box data-testid="nifty-decision-stats" className="flex flex-wrap flex-auto min-w-0">
            <DecisionCell
              testId="nifty-stat-spot"
              label="Spot"
              value={
                <NiftySpotValue
                  live={mode() === "live"}
                  fallback={report()?.spot ?? 0}
                />
              }
              valueSize={15}
              hint={
                dayRange()
                  ? `day ${formatNumberIN(Math.round(dayRange()!.low))}–${formatNumberIN(
                      Math.round(dayRange()!.high),
                    )}`
                  : "intraday range"
              }
              title="NIFTY 50 spot, with today's low–high range underneath."
            />
            <DecisionCell
              testId="nifty-stat-regime"
              label="Regime"
              value={
                regime()?.verdict ? resolveRegimeLabel(regime()!.verdict, regime()) : "—"
              }
              hint={regimeDetail(regime())}
              accent={regimeAccent(regime()?.verdict)}
              title="Volatility regime: sell premium in a range (realised < implied), buy premium in expansion (realised > implied)."
            />
            <DecisionCell
              testId="nifty-stat-flip"
              label="γ flip"
              value={
                gexDegraded()
                  ? "n/a"
                  : gammaFlip() != null
                    ? formatInt(gammaFlip()!)
                    : "—"
              }
              hint={
                gexDegraded()
                  ? "no option greeks in this snapshot"
                  : flipDelta() != null
                    ? `spot ${formatSignedPoints(flipDelta()!)}`
                    : "no zero-γ cross"
              }
              accent={palette.TERM_FLIP}
              title="Gamma flip (GEX zero-γ): strike where cumulative dealer gamma crosses zero at spot. Above it dealers damp moves; below it they amplify. Hint is spot minus the flip."
            />
            <DecisionCell
              testId="nifty-stat-call-wall"
              label="Max-OI call"
              value={maxCallWall() ? formatInt(maxCallWall()!.strike) : "—"}
              hint={
                maxCallWall()
                  ? `CE OI ${formatOiCr(maxCallWall()!.oi)}${
                      maxCallDistance() != null && Number.isFinite(maxCallDistance()!)
                        ? ` · ${maxCallDistance()! > 0 ? "+" : ""}${Math.round(maxCallDistance()!)} pts`
                        : ""
                    }`
                  : "no call OI"
              }
              accent={palette.TERM_CE}
              title="Heaviest OI across the chain (not the nearest strike). Max-OI call wall is the dealers' upside hedge; the distance from spot is shown next to the OI."
            />
            <DecisionCell
              testId="nifty-stat-put-wall"
              label="Max-OI put"
              value={maxPutWall() ? formatInt(maxPutWall()!.strike) : "—"}
              hint={
                maxPutWall()
                  ? `PE OI ${formatOiCr(maxPutWall()!.oi)}${
                      maxPutDistance() != null && Number.isFinite(maxPutDistance()!)
                        ? ` · ${maxPutDistance()! > 0 ? "+" : ""}${Math.round(maxPutDistance()!)} pts`
                        : ""
                    }`
                  : "no put OI"
              }
              accent={palette.TERM_PE}
              title="Heaviest OI across the chain (not the nearest strike). Max-OI put wall is the dealers' downside hedge; the distance from spot is shown next to the OI."
            />
            <DecisionCell
              testId="nifty-stat-pin"
              label="Pin risk"
              value={pin() ? pin()!.level : "—"}
              hint={pin() ? pinHint(pin()) : "spot / max pain missing"}
              accent={
                pin()?.level === "HIGH"
                  ? palette.WARNING
                  : pin()?.level === "MEDIUM"
                    ? palette.TEXT
                    : palette.TEXT_MUTED
              }
              title="Pin detection: a wall at spot AND max pain at least 100 pts on the far side means the market is being pinned into expiry. A break there is usually a sweep — sell the range, and only buy a break after two consecutive 1-min closes beyond the wall."
            />
            <Show when={squeezeFuel()}>
              {(fuel) => (
                <DecisionCell
                  testId="nifty-squeeze-fuel"
                  label="Squeeze"
                  value="FUEL ↑"
                  hint={`${fuel().strike} call wall is ${fuel().sentiment === "SC" ? "short-covering" : "unwinding"} — a break above it accelerates`}
                  accent={palette.WARNING}
                  title="Squeeze fuel: price is pinned under the call wall and that wall's call OI is being covered (SC/LU). Writers are buying back the ceiling, so a break above it is fuel, not a cap. Inverse of a defended wall (SB)."
                />
              )}
            </Show>
          </Box>
          <Box data-testid="nifty-context-stats" className="flex items-stretch shrink-0 ml-auto">
            <ContextCell
              testId="nifty-stat-pcr-oi"
              label="PCR (OI)"
              value={
                <>
                  <AnimatedValue value={report()?.pcrOi ?? 0} format={format2dp} />
                  <Sparkline
                    values={pcrSeries()}
                    testId="nifty-pcr-spark"
                    color={palette.TERM_CE}
                  />
                </>
              }
            />
            <ContextCell
              testId="nifty-stat-pcr-vol"
              label="PCR (Vol)"
              value={<AnimatedValue value={report()?.pcrVol ?? 0} format={format2dp} />}
            />
            <ContextCell
              testId="nifty-stat-max-pain"
              label="Max pain"
              value={
                <>
                  <AnimatedValue value={report()?.maxPain ?? 0} format={formatInt} />
                  <Sparkline
                    values={maxPainSeries()}
                    testId="nifty-maxpain-spark"
                    color={palette.PRIMARY}
                  />
                </>
              }
            />
          </Box>
          <Show when={isDesk()}>
            <Box className="flex items-center gap-0.5 shrink-0 pl-1">
              <DecisionChip
                testId="nifty-chip-setup"
                label="SETUP"
                value={setupSummary()}
                onClick={() => store.ui.setDeskDockTab("setup")}
              />
              <DecisionChip
                testId="nifty-chip-intel"
                label="INTEL"
                value="FII/DII"
                onClick={() => store.ui.setDeskDockTab("market")}
              />
              <DecisionChip
                testId="nifty-chip-gamma"
                label="Γ"
                value={
                  gexDegraded()
                    ? "n/a"
                    : `${gexForDisplay()?.regime === "short" ? "SHORT" : "LONG"} ${gammaFlip() != null ? formatInt(gammaFlip()!) : "—"}`
                }
                onClick={() => store.ui.setGammaOpen(true)}
                tone={gexForDisplay()?.regime === "short" ? palette.NEGATIVE : palette.POSITIVE}
              />
            </Box>
          </Show>
        </Box>
        <Box
          data-testid="nifty-verdict-wrap"
          className="flex items-center gap-1 min-w-0 h-6 overflow-hidden"
        >
          <Box className="flex-[1_1_0] min-w-0 flex">
            <NiftyVerdictStrip report={report()!} mode="context" />
          </Box>
          <Show when={symbol() !== "NIFTY"}>
            <span
              data-testid="nifty-india-vix-label"
              title="VIX source: INDIA_VIX — this is India VIX, not a US VIX."
              style={INDIA_VIX_STYLE}
            >
              INDIA VIX
            </span>
          </Show>
          <Show when={isDesk() && planOneLiner()}>
            <Box className="flex-[1.2_1_0] min-w-0 [&>*]:w-full [&>*]:min-w-0">
              {planOneLiner()}
            </Box>
          </Show>
        </Box>
      </Box>

      <Show when={flowReport()}>
        {(flow) => (
          <NiftyFlowWindows
            report={flow()}
            lastFlip={lastFlip()}
            showSessionValue={symbol() === "NIFTY"}
          />
        )}
      </Show>

      <Show when={symbol() === "NIFTY" || symbol() === "SENSEX"}>
        <IndexMoversStrip
          index={symbol() === "NIFTY" ? "NIFTY" : "SENSEX"}
          onExpand={store.ui.openMovers}
          liveOnly={mode() === "eod" || report()?.market?.is_open === false}
        />
      </Show>

      <Show when={!isDesk()}>
        <Box
          data-testid="nifty-context-rail"
          className="flex items-stretch gap-0.5 w-full max-w-full min-w-0 shrink-0"
        >
          <Show when={planOneLiner()}>
            <Box className="flex-[38_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
              {planOneLiner()}
            </Box>
          </Show>
          <Show when={symbol() === "NIFTY"}>
            <Box
              data-testid="nifty-intel-cell"
              className="flex-[34_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0"
            >
              <NiftyIntelStrip
                date={mode() === "eod" ? date() || null : null}
                expiry={expiry() === "nearest" ? null : expiry()}
                eod={mode() === "eod"}
              />
            </Box>
          </Show>
          <Box
            data-testid="nifty-gamma-cell"
            className="flex-[28_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0"
          >
            <NiftyGammaStrip
              gex={gexForDisplay()}
              positioning={report()?.positioning}
              spot={report()?.spot ?? 0}
            />
          </Box>
        </Box>

        <SetupRadarStrip read={setup()} preMove={preMove()} />
      </Show>
    </Show>
  );
}