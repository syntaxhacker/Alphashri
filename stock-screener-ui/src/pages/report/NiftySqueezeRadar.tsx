import { formatNumberIN } from "@/utils/ui-helpers";
import { memo, useMemo } from "react";
import { Box } from "@/ui";
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
function pickWalls(report: NiftyReport): { up: NiftyWall | null; down: NiftyWall | null } {
  const walls = resolveWallBoard(report.wallsNear, report.walls);
  if (!walls) return { up: null, down: null };
  const spot = report.spot;
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
export function NiftySqueezeRadarInner({
  report,
  preMove,
  setup,
  history,
  wallHistory = [],
  spotMove1m = null,
  metrics,
  walls = null,
}: NiftySqueezeRadarProps) {
  const { up, down } = pickWalls(report);
  const upDist = up ? Math.abs(wallDistance(up, report.spot)) : Infinity;
  const downDist = down ? Math.abs(wallDistance(down, report.spot)) : Infinity;
  const side: Side = upDist <= downDist ? "ce" : "pe";
  const wall = side === "ce" ? up : down;
  const distance = Math.min(upDist, downDist);
  const hasWall = Number.isFinite(distance);

  // Derive symbol-aware metrics once per report; the parent also passes a
  // memoised value. Do not recompute on every 1 s spot tick.
  const m = useMemo(() => metrics ?? symbolMetrics(report), [metrics, report]);
  const effectiveRange = m.squeezeRangePts;
  const distScore = hasWall ? clamp01(1 - distance / effectiveRange) : 0;
  const flowScore = clamp01(preMove.score / Math.max(preMove.max, 1));
  const gateScore = setup.gates.length > 0 ? clamp01(setup.score / setup.gates.length) : 0;
  // Nearest wall on either side from the walls payload: the heavier-fuel side
  // wins, falling back to the side spot is already closest to.
  const nearest = pickNearestWalls(walls ?? null);
  const callFuel = nearest.call?.fuel_score ?? 0;
  const putFuel = nearest.put?.fuel_score ?? 0;
  const erosionRow: WallsRow | null =
    callFuel > putFuel || (callFuel === putFuel && side === "ce")
      ? nearest.call ?? nearest.put ?? null
      : nearest.put ?? nearest.call ?? null;
  const erodeScore = Math.round(clamp01((erosionRow?.fuel_score ?? 0) / 100) * 100);
  const erosion30m = erosionRow?.erosion_30m ?? null;

  const proximity = Math.round(
    100 * clamp01(0.35 * distScore + 0.20 * flowScore + 0.15 * gateScore + 0.30 * (erodeScore / 100)),
  );

  const lastSpot = report.spot;
  const priorSpot = history.length >= 6 ? history[history.length - 6].spot : null;
  const move60 = lastSpot != null && priorSpot != null ? lastSpot - priorSpot : 0;
  /** A 15-pt move in the last minute is the squeeze itself. The tape move is
   *  preferred (1-min, replay-filtered); the history fallback covers live. */
  const moveForBreak = spotMove1m ?? move60;
  const priceBreak = Math.abs(moveForBreak) >= m.squeezePriceBreakPts;

  const isTrigger =
    setup.state === "TRIGGER" ||
    priceBreak ||
    (hasWall && distance <= m.squeezeAtWallPts && preMove.state === "armed");
  const stage: Stage = isTrigger
    ? "TRIGGER"
    : isPreBlast(erosionRow, walls?.regime)
      ? "PRE-BLAST"
      : preMove.state === "armed" || (proximity >= 45 && (flowScore >= 0.3 || gateScore >= 0.5))
        ? "ARMING"
        : "QUIET";

  const opposite = side === "ce" ? down : up;
  const oppositeDist = opposite ? Math.abs(wallDistance(opposite, report.spot)) : null;

  // Wall OI change: same side + strike, at least 60s old (panel polls ~10s).
  const wallNow = wallHistory.length ? Math.max(...wallHistory.map((s) => s.t)) : null;
  const priorWall =
    wall && wallNow != null
      ? wallHistory
          .filter(
            (s) => s.side === side && s.strike === wall.strike && wallNow - s.t >= 60_000,
          )
          .sort((a, b) => b.t - a.t)[0]
      : undefined;
  const wallDelta = wall && priorWall ? wall.oi - priorWall.oi : null;
  const wallDeltaSec = priorWall && wallNow ? Math.round((wallNow - priorWall.t) / 1000) : null;

  const spans = armedSpans(history);
  const armedSince = spans.length ? spans[spans.length - 1].from : null;
  // Replay must measure from the playhead, not the wall clock (devtools showed
  // "armed 218m" while replaying 12:40).
  const lastHistoryT = history.length ? history[history.length - 1].t : Date.now();
  const armedMin = armedSince ? Math.max(0, Math.round((lastHistoryT - armedSince) / 60_000)) : 0;

  const components = preMove.components ?? [];
  const wallLabel = wall
    ? `${formatNumberIN(wall.strike)} ${side === "ce" ? "CE" : "PE"}`
    : "no wall";
  const directionLabel = side === "ce" ? "above" : "below";
  const gammaLabel = walls?.regime === "LONG" ? "LONG" : walls?.regime === "SHORT" ? "SHORT" : "—";
  const distScorePct = Math.round(distScore * 100);
  const flowScorePct = Math.round(flowScore * 100);

  // Sparkline geometry.
  const n = history.length;
  const scoreY = (score: number) => 2 + (1 - Math.min(9, Math.max(0, score)) / 9) * 18;
  const xAt = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 1000);
  const scoreLine = history.map((p, i) => `${xAt(i)},${scoreY(p.score)}`).join(" ");
  const t0 = history[0]?.t;
  const t1 = history[n - 1]?.t;

  return (
    <Box
      data-testid="nifty-squeeze-radar"
      data-stage={stage}
      data-proximity={proximity}
      title={
        `proximity = 0.35 x distance (${distScorePct}) ` +
        `+ 0.20 x flow (${flowScorePct}) ` +
        `+ 0.15 x setup (${Math.round(gateScore * 100)}) ` +
        `+ 0.30 x erosion (${erodeScore})`
      }
      className="w-full min-w-0 flex flex-col gap-[6px] px-2 py-[6px] shrink-0"
      style={{
        border: `1px solid ${palette.TERM_BORDER}`,
        "border-radius": 4,
        "background-color": palette.TERM_HEADER,
        "font-family": palette.MONO,
      }}
    >
      {/* Row 1: title, stage, wall, proximity */}
      <Box className="flex items-center gap-[6px] min-w-0">
        <Box component="span" className="text-[9px] font-extrabold tracking-[0.08em]" style={{ color: palette.TEXT_MUTED }}>
          SQUEEZE
        </Box>
        <Box
          component="span"
          data-testid="nifty-squeeze-stage"
          className="px-[4px] py-[1px] rounded-[3px] text-[9px] font-extrabold tracking-[0.04em] whitespace-nowrap"
          style={{
            border: `1px solid ${STAGE_COLOR[stage]}`,
            color: STAGE_COLOR[stage],
            "background-color":
              stage === "TRIGGER"
                ? "rgba(63,185,80,0.14)"
                : stage === "ARMING" || stage === "PRE-BLAST"
                  ? "rgba(210,153,34,0.12)"
                  : "transparent",
          }}
        >
          {STAGE_LABEL[stage]}
        </Box>
        <Box
          component="span"
          data-testid="nifty-squeeze-wall"
          className="text-[10px] font-bold whitespace-nowrap"
          style={{ color: palette.TEXT }}
        >
          {wallLabel}
          <Box component="span" className="font-medium" style={{ color: palette.TEXT_MUTED }}>
            {" "}
            · {hasWall ? `${distance.toFixed(0)} pts ${directionLabel}${erosion30m != null ? ` · ${fmtPct(erosion30m)}/30m` : ""}` : "—"}
          </Box>
        </Box>
        {wall ? (
          <Box component="span" className="text-[9px] whitespace-nowrap" style={{ color: palette.TEXT_MUTED }}>
            OI {fmtOi(wall.oi)}
          </Box>
        ) : null}
        {wallDelta != null ? (
          <Box
            component="span"
            data-testid="nifty-squeeze-wall-delta"
            title="largest call/put wall OI change — negative = the wall is being consumed (squeeze fuel)"
            className="text-[9px] font-bold whitespace-nowrap"
            style={{
              color: wallDelta <= 0 ? palette.POSITIVE : palette.WARNING,
            }}
          >
            {wallDelta <= 0 ? "▼" : "▲"} {fmtOi(Math.abs(wallDelta))}
            <Box component="span" className="font-medium" style={{ color: palette.TEXT_MUTED }}>
              /{wallDeltaSec}s
            </Box>
          </Box>
        ) : null}
        {opposite && oppositeDist != null ? (
          <Box
            component="span"
            data-testid="nifty-squeeze-opposite"
            className="text-[8px] whitespace-nowrap"
            style={{ color: palette.TEXT_MUTED }}
          >
            ↔ {formatNumberIN(opposite.strike)} {side === "ce" ? "PE" : "CE"}{" "}
            {oppositeDist.toFixed(0)}p
          </Box>
        ) : null}
        <Box className="ml-auto flex items-baseline gap-[3px]">
          <Box
            component="span"
            data-testid="nifty-squeeze-proximity"
            className="text-[16px] font-extrabold leading-1"
            style={{ color: STAGE_COLOR[stage] }}
          >
            {proximity}%
          </Box>
          <Box component="span" className="text-[8px] tracking-[0.04em]" style={{ color: palette.TEXT_MUTED }}>
            AT LEVEL
          </Box>
        </Box>
      </Box>

      {/* Row 1.5: score decomposition — distance / flow / erosion / gamma regime */}
      <Box className="flex items-center gap-[4px] text-[8px] min-w-0" style={{ color: palette.TEXT_MUTED }}>
        <Box component="span" data-testid="squeeze-erosion">
          DIST {distScorePct} · FLOW {flowScorePct} · ERODE {erodeScore} · Γ {gammaLabel}
        </Box>
      </Box>

      {/* Row 2: proximity meter with stage zones */}
      <Box
        className="relative h-[8px] rounded-[4px] overflow-hidden"
        style={{
          background: `linear-gradient(90deg, ${palette.TERM_BORDER} 0%, ${palette.TERM_BORDER} 38%, ${palette.WARNING} 62%, ${palette.POSITIVE} 100%)`,
          opacity: 0.9,
        }}
      >
        <Box
          className="absolute left-0 top-0 bottom-0"
          style={{
            width: `${proximity}%`,
            background: `linear-gradient(90deg, ${palette.WARNING}, ${STAGE_COLOR[stage]})`,
            opacity: 0.55,
          }}
        />
        <Box
          className="absolute top-[-2px] bottom-[-2px] w-[2px]"
          style={{
            left: `calc(${proximity}% - 1px)`,
            "background-color": STAGE_COLOR[stage],
            "box-shadow": `0 0 4px ${STAGE_COLOR[stage]}`,
          }}
        />
      </Box>
      <Box className="flex justify-between text-[7px] mt-[-4px]" style={{ color: palette.TEXT_MUTED }}>
        <span>far</span>
        <span>building</span>
        <span>at the wall</span>
      </Box>

      {/* Row 3: component chips with values (no glyphs) */}
      <Box className="flex flex-wrap gap-[4px] items-center">
        {components.length === 0 ? (
          <Box component="span" className="text-[9px]" style={{ color: palette.TEXT_MUTED }}>
            no flow edge yet — waiting for covering / writing
          </Box>
        ) : (
          components.map((c, i) => (
            <Box
              key={`${c.key}-${i}`}
              component="span"
              data-testid={`nifty-squeeze-chip-${c.key}`}
              title={`${c.label}: ${c.detail} (${c.points > 0 ? "+" : ""}${c.points})`}
              className="px-[4px] py-[1px] rounded-[3px] text-[9px] font-bold whitespace-nowrap shrink-0"
              style={{
                border: `1px solid ${c.points > 0 ? palette.POSITIVE : palette.NEGATIVE}`,
                "background-color": c.points > 0 ? "rgba(63,185,80,0.10)" : "rgba(248,81,73,0.08)",
                color: c.points > 0 ? palette.POSITIVE : palette.NEGATIVE,
              }}
            >
              {c.label}
              <Box component="span" className="font-medium" style={{ opacity: 0.7 }}>
                {" "}{c.points > 0 ? "+" : ""}{c.points}
              </Box>
            </Box>
          ))
        )}
        <Box
          component="span"
          className="px-[4px] py-[1px] rounded-[3px] border border-solid text-[9px] shrink-0 ml-auto"
          style={{ "border-color": palette.TERM_BORDER, color: palette.TEXT_MUTED }}
        >
          setup {setup.score}/{setup.gates.length} · flow {preMove.score}/{preMove.max}
        </Box>
      </Box>

      {/* Row 4: labelled score sparkline + how long armed */}
      {n >= 3 ? (
        <Box className="flex items-center gap-[6px] min-w-0">
          <Box component="span" className="text-[8px] shrink-0" style={{ color: palette.TEXT_MUTED }}>
            {t0 ? fmtTime(t0) : "—"}
          </Box>
          <svg
            width="100%"
            height={22}
            viewBox="0 0 1000 22"
            preserveAspectRatio="none"
            aria-label="pre-move score, last 30 minutes"
            style={{ flex: 1, "min-width": 0 }}
          >
            {spans.map((s, i) => {
              const x0 = n <= 1 ? 0 : ((s.from - t0!) / (t1! - t0! || 1)) * 1000;
              const x1 = n <= 1 ? 0 : ((s.to - t0!) / (t1! - t0! || 1)) * 1000;
              return (
                <rect
                  key={i}
                  x={x0}
                  y={0}
                  width={Math.max(1, x1 - x0)}
                  height={22}
                  fill={palette.POSITIVE}
                  opacity={0.12}
                />
              );
            })}
            <line
              x1={0}
              x2={1000}
              y1={scoreY(5)}
              y2={scoreY(5)}
              stroke={palette.WARNING}
              stroke-width={0.6}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <polyline points={scoreLine} fill="none" stroke={STAGE_COLOR[stage]} stroke-width={1.4} />
            {n > 0 ? (
              <circle
                cx={1000}
                cy={scoreY(history[n - 1].score)}
                r={2}
                fill={STAGE_COLOR[stage]}
              />
            ) : null}
          </svg>
          <Box component="span" className="text-[8px] shrink-0" style={{ color: palette.TEXT_MUTED }}>
            {t1 ? fmtTime(t1) : "—"}
          </Box>
          {armedSince ? (
            <Box
              component="span"
              data-testid="nifty-squeeze-armed"
              className="text-[8px] font-bold shrink-0"
              style={{ color: palette.POSITIVE }}
            >
              armed {armedMin}m
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Box className="flex items-baseline gap-[6px] text-[8px] min-w-0" style={{ color: palette.TEXT_MUTED }}>
        <Box
          component="span"
          className="overflow-hidden truncate whitespace-nowrap"
        >
          ARM = prepare · TRIGGER = 1-min close through the wall · the score is an early warning, not an entry
        </Box>
        <Box
          component="span"
          data-testid="nifty-squeeze-calibration"
          title="Causal study: 10s chain arms (Oct 26-28) and 1-min 100-level breaks (10 sessions). Historical, not live."
          className="ml-auto shrink-0 whitespace-nowrap"
          style={{ color: palette.TEXT_MUTED }}
        >
          hist: ARM {SQUEEZE_CALIBRATION.armLift.toFixed(1)}× (n={SQUEEZE_CALIBRATION.armN}) ·
          {" "}TRIG {Math.round(SQUEEZE_CALIBRATION.triggerHold * 100)}% (n={SQUEEZE_CALIBRATION.triggerN})
        </Box>
      </Box>
    </Box>
  );
}

/** Memoised: all inputs are identity-stable between report frames while the
 *  parent re-renders on the ~1 s spot tick. */
export const NiftySqueezeRadar = memo(NiftySqueezeRadarInner);
NiftySqueezeRadar.displayName = "NiftySqueezeRadar";
