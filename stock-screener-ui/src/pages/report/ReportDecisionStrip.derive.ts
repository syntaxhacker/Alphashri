import { createMemo, type Accessor } from "solid-js";
import * as palette from "@/ui/palette";
import type { NiftyReportStore } from "./niftyReportStore";
import { formatOiCr, formatSignedPoints } from "./reportCells";
import { gexFlipAtSpot } from "./niftyGex";
import { buildDeskPlan } from "./deskPlan";
import { summarizeDeskPlan, type PlanInput } from "./deskPlanSummary";
import { pinRisk } from "./niftyPin";
import { resolveWallBoard } from "./niftyWallsFormat";
import { REPORT_FONT } from "./reportTokens";
import {
  decisionEvidenceSources,
  formatInt,
  planConfidenceLabel,
  resolveDecisionState,
  snapshotTimeLabel,
} from "./ReportDecisionStrip.format";

/** All reactive derivations behind the decision strip live here. The facade
 *  stays a composition root; every view module reads the same memo instances. */
export function createDecisionView(store: NiftyReportStore, narrow: Accessor<boolean>) {
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

  const wallsBoard = createMemo(() => resolveWallBoard(report()?.wallsNear, report()?.walls));

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

  // The backend does not ship a previous close, so the header change is measured
  // from the session open (`ohlc.open`) and says so — a "change" against an
  // invented prev-close would be a lie on every gap day.
  const sessionChange = createMemo(() => {
    const current = report();
    const open = current?.ohlc?.open ?? 0;
    if (!current || open <= 0 || !Number.isFinite(current.spot)) return null;
    const pts = current.spot - open;
    return { pts, pct: (pts / open) * 100 };
  });

  const changeTone = () => {
    const change = sessionChange();
    if (!change) return palette.TEXT_MUTED;
    if (change.pts > 0) return palette.POSITIVE;
    if (change.pts < 0) return palette.NEGATIVE;
    return palette.TEXT_MUTED;
  };

  const setupCounts = createMemo(() => {
    const gates = setup().gates;
    return { passed: gates.filter((gate) => gate.pass).length, total: gates.length };
  });

  const setupSummary = () => `${setupCounts().passed} of ${setupCounts().total} · ${preMove().state}`;

  const setupHelp = () => {
    const { passed, total } = setupCounts();
    const state = preMove().state;
    const meaning =
      state === "quiet"
        ? "no setup is armed"
        : state === "armed"
          ? "conditions are lined up"
          : state === "watch"
            ? "a setup is forming"
            : "the pre-move state is not available";
    return `Setup checks: ${passed} of ${total} passed. The checks are COIL, TREND, RVOL, LEVEL, WALL, GAMMA and FUEL. Pre-move "${state}" means ${meaning}. Opens the Setup tab with every check.`;
  };

  const gammaChipHelp = () => {
    if (gexDegraded()) {
      return "Dealer gamma is unavailable in this report: option greeks are missing from the snapshot, so no regime or flip strike can be shown.";
    }
    const regimeLabel =
      gexForDisplay()?.regime === "short"
        ? "short (moves are amplified)"
        : gexForDisplay()?.regime === "long"
          ? "long (moves are dampened)"
          : "flat";
    const flip = gammaFlip();
    return flip != null
      ? `Dealer gamma is ${regimeLabel}. The flip at ${formatInt(flip)} is the strike where cumulative dealer gamma crosses zero at spot.`
      : `Dealer gamma is ${regimeLabel}. The value is a dash because the profile does not cross zero at spot, so there is no flip strike to show.`;
  };

  const INTEL_CHIP_HELP =
    "Institutional flows: FII means foreign institutional investors and DII means domestic institutional investors — their net cash flows. The Intel panel shows a dash with a reason when no snapshot is available or its fetch failed. Opens the market panel.";

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

  const planConfidence = createMemo(() => planConfidenceLabel(planSummary()?.confidence));

  const evidenceSources = createMemo(() =>
    decisionEvidenceSources({
      regimeVerdict: report()?.regime?.verdict,
      controlVerdict: report()?.control?.verdict,
      gexPresent: !gexDegraded() && report()?.gex != null,
      hasWalls: !!(maxCallWall() || maxPutWall()),
      hasTape: tapeRows().length > 0,
      hasFlow: !!flowReport() || !!report()?.flow_window,
      vixPresent: Number.isFinite(report()?.vix?.ltp ?? NaN),
      setupReady: setupCounts().passed > 0,
    }),
  );

  const decision = createMemo(() =>
    resolveDecisionState({
      marketClosed: report()?.market?.is_open === false,
      eod: mode() === "eod",
      snapshotTime: snapshotTimeLabel(
        report()?.market?.as_of ?? report()?.snapshotAt ?? report()?.fetchedAt ?? null,
      ),
      evidenceSources: evidenceSources(),
      headline: planSummary()?.headline ?? null,
      confidenceComputed: planConfidence().computed,
    }),
  );

  const claimTone = () => {
    const state = decision();
    if (state.kind === "live" && state.chip === "decision") return planTone();
    return palette.TEXT_MUTED;
  };

  return {
    store,
    narrow,
    report,
    metrics,
    tapeRows,
    setup,
    preMove,
    tapeSpeed,
    lastFlip,
    flowReport,
    isDesk,
    symbol,
    mode,
    expiry,
    date,
    regime,
    gexDegraded,
    gexForDisplay,
    gammaFlip,
    flipDelta,
    wallsBoard,
    maxCallWall,
    maxPutWall,
    maxCallDistance,
    maxPutDistance,
    nearCallWall,
    pin,
    squeezeFuel,
    dayRange,
    pcrSeries,
    maxPainSeries,
    sessionChange,
    changeTone,
    setupCounts,
    setupSummary,
    setupHelp,
    gammaChipHelp,
    INTEL_CHIP_HELP,
    planSummary,
    planTone,
    tapeBadge,
    planConfidence,
    evidenceSources,
    decision,
    claimTone,
    formatInt,
    formatSignedPoints,
    formatOiCr,
    REPORT_FONT,
  };
}

export type DecisionView = ReturnType<typeof createDecisionView>;
