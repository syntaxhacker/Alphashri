import { formatNumberIN } from "@/utils/ui-helpers";
import { createMemo, For, Show } from "solid-js";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import * as palette from "@/ui/palette";
import type { NiftyReport, NiftyWall } from "@/types/niftyReport";
import type { PreMoveScore } from "./niftyPreMove";
import { armedSpans, type PreMovePoint } from "./niftyPreMoveHistory";
import type { SetupRead } from "./niftySetup";
import { resolveWallBoard, fmtPct } from "./niftyWallsFormat";
import { pickNearestWalls, isPreBlast } from "./wallErosion";
import { symbolMetrics, type SymbolMetrics } from "./symbolMetrics";

export interface NiftySqueezeRadarProps {
  report: NiftyReport;
  preMove: PreMoveScore;
  setup: SetupRead;
  history: PreMovePoint[];
  /** Nearest-wall OI snapshots (panel appends every report poll, ~3 min kept). */
  wallHistory?: WallSnapshot[];
  /** Last 1-min spot move from the replay-filtered tape (no lookahead). */
  spotMove1m?: number | null;
  /** Optional pre-computed symbol metrics (avoids re-deriving). */
  metrics?: SymbolMetrics;
  /** Latest walls payload (nearest walls + erosion fuel); optional. */
  walls?: WallsPayload | null;
}

export interface WallSnapshot {
  t: number;
  side: "ce" | "pe";
  strike: number;
  oi: number;
}

/** Calibration from the causal studies (10s arms / 1-min level breaks). */
export const SQUEEZE_CALIBRATION = {
  armLift: 2.0,
  armN: 422,
  triggerHold: 0.4,
  triggerN: 47,
};

type Side = "ce" | "pe";
type Stage = "QUIET" | "ARMING" | "PRE-BLAST" | "TRIGGER";

const STAGE_COLOR: Record<Stage, string> = {
  QUIET: palette.TEXT_MUTED,
  ARMING: palette.WARNING,
  "PRE-BLAST": palette.WARNING,
  TRIGGER: palette.POSITIVE,
};

const STAGE_LABEL: Record<Stage, string> = {
  QUIET: "QUIET",
  ARMING: "ARMING",
  "PRE-BLAST": "PRE-BLAST",
  TRIGGER: "TRIGGER",
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function wallDistance(wall: NiftyWall, spot: number): number {
  return typeof wall.distance === "number" ? wall.distance : wall.strike - spot;
}

/** Nearest actionable wall in each direction (heaviest when distances tie). */
function pickWalls(value: NiftyReport): { up: NiftyWall | null; down: NiftyWall | null } {
  const walls = resolveWallBoard(value.wallsNear, value.walls);
  if (!walls) return { up: null, down: null };
  const spot = value.spot;
  const up = (walls.calls ?? [])
    .filter((w) => wallDistance(w, spot) >= 0)
    .sort((a, b) => wallDistance(a, spot) - wallDistance(b, spot) || (b.oi ?? 0) - (a.oi ?? 0))[0] ?? null;
  const down = (walls.puts ?? [])
    .filter((w) => wallDistance(w, spot) <= 0)
    .sort((a, b) => Math.abs(wallDistance(a, spot)) - Math.abs(wallDistance(b, spot)) || (b.oi ?? 0) - (a.oi ?? 0))[0] ?? null;
  return { up, down };
}

function fmtOi(oi: number): string {
  if (!Number.isFinite(oi)) return "—";
  if (oi >= 1e7) return `${(oi / 1e7).toFixed(1)}Cr`;
  if (oi >= 1e5) return `${(oi / 1e5).toFixed(1)}L`;
  return formatNumberIN(Math.round(oi));
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Squeeze radar — "how near are we to a move?" in one visual.
 *
 * The old timeline drew five cryptic swimlanes and a spiky score; this shows
 * the three things a trader actually needs:
 *
 * 1. **Proximity** (0-100): distance to the wall being tested (35%), flow
 *    score (20%), setup gates (15%), wall erosion (30%).
 * 2. **The wall** in points: `22,700 · 25 pts away`, with the OI at it.
 * 3. **The stage**: QUIET -> ARMING -> TRIGGER (ARM = prepare, TRIGGER = trade).
 *
 * A compact score sparkline with labelled time bounds sits underneath, so the
 * history is readable without a legend of single-letter glyphs.
 *
 * All point thresholds are now expressed in basis points of spot, preserving
 * NIFTY behavior (120/22800 ≈ 52.6 bps, 10/22800 ≈ 4.4 bps, 5/22800 ≈ 2.2 bps)
 * while scaling correctly for SENSEX (~79k), RELIANCE (~1.4k), etc.
 */
export function NiftySqueezeRadar(props: NiftySqueezeRadarProps) {
  const report = () => props.report;
  const preMove = () => props.preMove;
  const setup = () => props.setup;
  const history = () => props.history;
  const wallHistory = () => props.wallHistory ?? [];
  const spotMove1m = () => props.spotMove1m ?? null;
  const walls = () => props.walls ?? null;

  const selection = createMemo(() => {
    const { up, down } = pickWalls(report());
    const upDist = up ? Math.abs(wallDistance(up, report().spot)) : Infinity;
    const downDist = down ? Math.abs(wallDistance(down, report().spot)) : Infinity;
    const side: Side = upDist <= downDist ? "ce" : "pe";
    const wall = side === "ce" ? up : down;
    const distance = Math.min(upDist, downDist);
    return { up, down, side, wall, distance, hasWall: Number.isFinite(distance) };
  });

  // Derive symbol-aware metrics once per report; the parent also passes a
  // memoised value. Do not recompute on every 1 s spot tick.
  const m = createMemo(() => props.metrics ?? symbolMetrics(props.report));

  const distScore = createMemo(() => {
    const sel = selection();
    return sel.hasWall ? clamp01(1 - sel.distance / m().squeezeRangePts) : 0;
  });
  const flowScore = createMemo(() => clamp01(preMove().score / Math.max(preMove().max, 1)));
  const gateScore = createMemo(() =>
    setup().gates.length > 0 ? clamp01(setup().score / setup().gates.length) : 0,
  );

  // Nearest wall on either side from the walls payload: the heavier-fuel side
  // wins, falling back to the side spot is already closest to.
  const nearest = createMemo(() => pickNearestWalls(walls()));
  const callFuel = createMemo(() => nearest().call?.fuel_score ?? 0);
  const putFuel = createMemo(() => nearest().put?.fuel_score ?? 0);
  const erosionRow = createMemo((): WallsRow | null => {
    const sel = selection();
    const n = nearest();
    const cf = callFuel();
    const pf = putFuel();
    return cf > pf || (cf === pf && sel.side === "ce")
      ? n.call ?? n.put ?? null
      : n.put ?? n.call ?? null;
  });
  const erodeScore = createMemo(() => Math.round(clamp01((erosionRow()?.fuel_score ?? 0) / 100) * 100));
  const erosion30m = createMemo(() => erosionRow()?.erosion_30m ?? null);

  const proximity = createMemo(() =>
    Math.round(
      100 * clamp01(0.35 * distScore() + 0.20 * flowScore() + 0.15 * gateScore() + 0.30 * (erodeScore() / 100)),
    ),
  );

  const move60 = createMemo(() => {
    const h = history();
    const lastSpot = report().spot;
    const priorSpot = h.length >= 6 ? h[h.length - 6].spot : null;
    return lastSpot != null && priorSpot != null ? lastSpot - priorSpot : 0;
  });
  /** A 15-pt move in the last minute is the squeeze itself. The tape move is
   *  preferred (1-min, replay-filtered); the history fallback covers live. */
  const priceBreak = createMemo(() => Math.abs(spotMove1m() ?? move60()) >= m().squeezePriceBreakPts);

  const isTrigger = createMemo(() => {
    const sel = selection();
    return (
      setup().state === "TRIGGER" ||
      priceBreak() ||
      (sel.hasWall && sel.distance <= m().squeezeAtWallPts && preMove().state === "armed")
    );
  });
  const stage = createMemo((): Stage => {
    if (isTrigger()) return "TRIGGER";
    if (isPreBlast(erosionRow(), walls()?.regime)) return "PRE-BLAST";
    if (preMove().state === "armed" || (proximity() >= 45 && (flowScore() >= 0.3 || gateScore() >= 0.5))) {
      return "ARMING";
    }
    return "QUIET";
  });

  const opposite = createMemo(() => (selection().side === "ce" ? selection().down : selection().up));
  const oppositeDist = createMemo(() => {
    const opp = opposite();
    return opp ? Math.abs(wallDistance(opp, report().spot)) : null;
  });

  // Wall OI change: same side + strike, at least 60s old (panel polls ~10s).
  const wallNow = createMemo(() => {
    const wh = wallHistory();
    return wh.length ? Math.max(...wh.map((s) => s.t)) : null;
  });
  const priorWall = createMemo(() => {
    const sel = selection();
    const wn = wallNow();
    if (!sel.wall || wn == null) return undefined;
    return wallHistory()
      .filter((s) => s.side === sel.side && s.strike === sel.wall!.strike && wn - s.t >= 60_000)
      .sort((a, b) => b.t - a.t)[0];
  });
  const wallDelta = createMemo(() => {
    const sel = selection();
    const prior = priorWall();
    return sel.wall && prior ? sel.wall.oi - prior.oi : null;
  });
  const wallDeltaSec = createMemo(() => {
    const prior = priorWall();
    const wn = wallNow();
    return prior && wn != null ? Math.round((wn - prior.t) / 1000) : null;
  });

  const spans = createMemo(() => armedSpans(history()));
  const armedSince = createMemo(() => {
    const s = spans();
    return s.length ? s[s.length - 1].from : null;
  });
  // Replay must measure from the playhead, not the wall clock (devtools showed
  // "armed 218m" while replaying 12:40).
  const lastHistoryT = createMemo(() => {
    const h = history();
    return h.length ? h[h.length - 1].t : Date.now();
  });
  const armedMin = createMemo(() => {
    const since = armedSince();
    return since ? Math.max(0, Math.round((lastHistoryT() - since) / 60_000)) : 0;
  });

  const components = () => preMove().components ?? [];
  const wallLabel = () => {
    const sel = selection();
    return sel.wall
      ? `${formatNumberIN(sel.wall.strike)} ${sel.side === "ce" ? "CE" : "PE"}`
      : "no wall";
  };
  const directionLabel = () => (selection().side === "ce" ? "above" : "below");
  const gammaLabel = () => {
    const regime = walls()?.regime;
    return regime === "LONG" ? "LONG" : regime === "SHORT" ? "SHORT" : "—";
  };
  const distScorePct = () => Math.round(distScore() * 100);
  const flowScorePct = () => Math.round(flowScore() * 100);

  // Sparkline geometry.
  const n = () => history().length;
  const scoreY = (score: number) => 2 + (1 - Math.min(9, Math.max(0, score)) / 9) * 18;
  const xAt = (i: number) => (n() <= 1 ? 0 : (i / (n() - 1)) * 1000);
  const scoreLine = createMemo(() => history().map((p, i) => `${xAt(i)},${scoreY(p.score)}`).join(" "));
  const t0 = () => history()[0]?.t;
  const t1 = () => history()[n() - 1]?.t;

  return (
    <div
      data-testid="nifty-squeeze-radar"
      data-stage={stage()}
      data-proximity={proximity()}
      title={
        `proximity = 0.35 x distance (${distScorePct()}) ` +
        `+ 0.20 x flow (${flowScorePct()}) ` +
        `+ 0.15 x setup (${Math.round(gateScore() * 100)}) ` +
        `+ 0.30 x erosion (${erodeScore()})`
      }
      class="w-full min-w-0 flex flex-col gap-[6px] px-2 py-[6px] shrink-0"
      style={{
        border: `1px solid ${palette.TERM_BORDER}`,
        "border-radius": "4px",
        "background-color": palette.TERM_HEADER,
        "font-family": palette.MONO,
      }}
    >
      {/* Row 1: title, stage, wall, proximity */}
      <div class="flex items-center gap-[6px] min-w-0">
        <span class="text-[9px] font-extrabold tracking-[0.08em]" style={{ color: palette.TEXT_MUTED }}>
          SQUEEZE
        </span>
        <span
          data-testid="nifty-squeeze-stage"
          class="px-[4px] py-[1px] rounded-[3px] text-[9px] font-extrabold tracking-[0.04em] whitespace-nowrap"
          style={{
            border: `1px solid ${STAGE_COLOR[stage()]}`,
            color: STAGE_COLOR[stage()],
            "background-color":
              stage() === "TRIGGER"
                ? "rgba(63,185,80,0.14)"
                : stage() === "ARMING" || stage() === "PRE-BLAST"
                  ? "rgba(210,153,34,0.12)"
                  : "transparent",
          }}
        >
          {STAGE_LABEL[stage()]}
        </span>
        <span
          data-testid="nifty-squeeze-wall"
          class="text-[10px] font-bold whitespace-nowrap"
          style={{ color: palette.TEXT }}
        >
          {wallLabel()}
          <span class="font-medium" style={{ color: palette.TEXT_MUTED }}>
            {" "}
            · {selection().hasWall ? `${selection().distance.toFixed(0)} pts ${directionLabel()}${erosion30m() != null ? ` · ${fmtPct(erosion30m()!)}/30m` : ""}` : "—"}
          </span>
        </span>
        <Show when={selection().wall}>
          {(wall) => (
            <span class="text-[9px] whitespace-nowrap" style={{ color: palette.TEXT_MUTED }}>
              OI {fmtOi(wall().oi)}
            </span>
          )}
        </Show>
        <Show when={wallDelta() != null ? wallDelta() : undefined}>
          {(delta) => (
            <span
              data-testid="nifty-squeeze-wall-delta"
              title="largest call/put wall OI change — negative = the wall is being consumed (squeeze fuel)"
              class="text-[9px] font-bold whitespace-nowrap"
              style={{
                color: delta() <= 0 ? palette.POSITIVE : palette.WARNING,
              }}
            >
              {delta() <= 0 ? "▼" : "▲"} {fmtOi(Math.abs(delta()))}
              <span class="font-medium" style={{ color: palette.TEXT_MUTED }}>
                /{wallDeltaSec()}s
              </span>
            </span>
          )}
        </Show>
        <Show when={opposite() && oppositeDist() != null}>
          <span
            data-testid="nifty-squeeze-opposite"
            class="text-[8px] whitespace-nowrap"
            style={{ color: palette.TEXT_MUTED }}
          >
            ↔ {formatNumberIN(opposite()!.strike)} {selection().side === "ce" ? "PE" : "CE"}{" "}
            {oppositeDist()!.toFixed(0)}p
          </span>
        </Show>
        <div class="ml-auto flex items-baseline gap-[3px]">
          <span
            data-testid="nifty-squeeze-proximity"
            class="text-[16px] font-extrabold leading-1"
            style={{ color: STAGE_COLOR[stage()] }}
          >
            {proximity()}%
          </span>
          <span class="text-[8px] tracking-[0.04em]" style={{ color: palette.TEXT_MUTED }}>
            AT LEVEL
          </span>
        </div>
      </div>

      {/* Row 1.5: score decomposition — distance / flow / erosion / gamma regime */}
      <div class="flex items-center gap-[4px] text-[8px] min-w-0" style={{ color: palette.TEXT_MUTED }}>
        <span data-testid="squeeze-erosion">
          DIST {distScorePct()} · FLOW {flowScorePct()} · ERODE {erodeScore()} · Γ {gammaLabel()}
        </span>
      </div>

      {/* Row 2: proximity meter with stage zones */}
      <div
        class="relative h-[8px] rounded-[4px] overflow-hidden"
        style={{
          background: `linear-gradient(90deg, ${palette.TERM_BORDER} 0%, ${palette.TERM_BORDER} 38%, ${palette.WARNING} 62%, ${palette.POSITIVE} 100%)`,
          opacity: 0.9,
        }}
      >
        <div
          class="absolute left-0 top-0 bottom-0"
          style={{
            width: `${proximity()}%`,
            background: `linear-gradient(90deg, ${palette.WARNING}, ${STAGE_COLOR[stage()]})`,
            opacity: 0.55,
          }}
        />
        <div
          class="absolute top-[-2px] bottom-[-2px] w-[2px]"
          style={{
            left: `calc(${proximity()}% - 1px)`,
            "background-color": STAGE_COLOR[stage()],
            "box-shadow": `0 0 4px ${STAGE_COLOR[stage()]}`,
          }}
        />
      </div>
      <div class="flex justify-between text-[7px] mt-[-4px]" style={{ color: palette.TEXT_MUTED }}>
        <span>far</span>
        <span>building</span>
        <span>at the wall</span>
      </div>

      {/* Row 3: component chips with values (no glyphs) */}
      <div class="flex flex-wrap gap-[4px] items-center">
        <Show
          when={components().length === 0}
          fallback={
            <For each={components()}>{(c) => (
              <span
                data-testid={`nifty-squeeze-chip-${c.key}`}
                title={`${c.label}: ${c.detail} (${c.points > 0 ? "+" : ""}${c.points})`}
                class="px-[4px] py-[1px] rounded-[3px] text-[9px] font-bold whitespace-nowrap shrink-0"
                style={{
                  border: `1px solid ${c.points > 0 ? palette.POSITIVE : palette.NEGATIVE}`,
                  "background-color": c.points > 0 ? "rgba(63,185,80,0.10)" : "rgba(248,81,73,0.08)",
                  color: c.points > 0 ? palette.POSITIVE : palette.NEGATIVE,
                }}
              >
                {c.label}
                <span class="font-medium" style={{ opacity: 0.7 }}>
                  {" "}{c.points > 0 ? "+" : ""}{c.points}
                </span>
              </span>
            )}</For>
          }
        >
          <span class="text-[9px]" style={{ color: palette.TEXT_MUTED }}>
            no flow edge yet — waiting for covering / writing
          </span>
        </Show>
        <span
          class="px-[4px] py-[1px] rounded-[3px] border border-solid text-[9px] shrink-0 ml-auto"
          style={{ "border-color": palette.TERM_BORDER, color: palette.TEXT_MUTED }}
        >
          setup {setup().score}/{setup().gates.length} · flow {preMove().score}/{preMove().max}
        </span>
      </div>

      {/* Row 4: labelled score sparkline + how long armed */}
      <Show when={n() >= 3}>
        <div class="flex items-center gap-[6px] min-w-0">
          <span class="text-[8px] shrink-0" style={{ color: palette.TEXT_MUTED }}>
            {t0() ? fmtTime(t0()!) : "—"}
          </span>
          <svg
            width="100%"
            height={22}
            viewBox="0 0 1000 22"
            preserveAspectRatio="none"
            aria-label="pre-move score, last 30 minutes"
            style={{ flex: 1, "min-width": 0 }}
          >
            <For each={spans()}>{(s) => {
              const x0 = n() <= 1 ? 0 : ((s.from - t0()!) / (t1()! - t0()! || 1)) * 1000;
              const x1 = n() <= 1 ? 0 : ((s.to - t0()!) / (t1()! - t0()! || 1)) * 1000;
              return (
                <rect
                  x={x0}
                  y={0}
                  width={Math.max(1, x1 - x0)}
                  height={22}
                  fill={palette.POSITIVE}
                  opacity={0.12}
                />
              );
            }}</For>
            <line
              x1={0}
              x2={1000}
              y1={scoreY(5)}
              y2={scoreY(5)}
              stroke={palette.WARNING}
              stroke-width={0.6}
              stroke-dasharray="3 3"
              opacity={0.5}
            />
            <polyline points={scoreLine()} fill="none" stroke={STAGE_COLOR[stage()]} stroke-width={1.4} />
            <Show when={n() > 0}>
              <circle
                cx={1000}
                cy={scoreY(history()[n() - 1].score)}
                r={2}
                fill={STAGE_COLOR[stage()]}
              />
            </Show>
          </svg>
          <span class="text-[8px] shrink-0" style={{ color: palette.TEXT_MUTED }}>
            {t1() ? fmtTime(t1()!) : "—"}
          </span>
          <Show when={armedSince()}>
            <span
              data-testid="nifty-squeeze-armed"
              class="text-[8px] font-bold shrink-0"
              style={{ color: palette.POSITIVE }}
            >
              armed {armedMin()}m
            </span>
          </Show>
        </div>
      </Show>

      <div class="flex items-baseline gap-[6px] text-[8px] min-w-0" style={{ color: palette.TEXT_MUTED }}>
        <span class="overflow-hidden truncate whitespace-nowrap">
          ARM = prepare · TRIGGER = 1-min close through the wall · the score is an early warning, not an entry
        </span>
        <span
          data-testid="nifty-squeeze-calibration"
          title="Causal study: 10s chain arms (Oct 26-28) and 1-min 100-level breaks (10 sessions). Historical, not live."
          class="ml-auto shrink-0 whitespace-nowrap"
          style={{ color: palette.TEXT_MUTED }}
        >
          hist: ARM {SQUEEZE_CALIBRATION.armLift.toFixed(1)}× (n={SQUEEZE_CALIBRATION.armN}) ·
          {" "}TRIG {Math.round(SQUEEZE_CALIBRATION.triggerHold * 100)}% (n={SQUEEZE_CALIBRATION.triggerN})
        </span>
      </div>
    </div>
  );
}
