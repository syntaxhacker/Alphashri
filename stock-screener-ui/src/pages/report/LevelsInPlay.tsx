import { Box } from "@/ui";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import { formatNumberIN } from "@/utils/ui-helpers";
import type { NiftyReport, NiftySensex, NiftyWall } from "@/types/niftyReport";
import { REPORT_FONT } from "./reportTokens";

type Side = "call" | "put";

interface LevelRead {
  strike: number;
  oi: number;
  pts: number;
  pct: number;
  tag: "AT" | "NEAR" | "WATCH" | "CLEAR";
}

function dedupe(walls: NiftyWall[]): NiftyWall[] {
  const byStrike = new Map<number, NiftyWall>();
  for (const wall of walls) {
    if (!wall || !Number.isFinite(wall.strike) || !Number.isFinite(wall.oi)) continue;
    const prior = byStrike.get(wall.strike);
    if (!prior || wall.oi > prior.oi) byStrike.set(wall.strike, wall);
  }
  return [...byStrike.values()];
}

/** Nearest *significant* wall, not merely the heaviest in the ±300 window. */
function nearestLevel(
  walls: NiftyWall[] | undefined,
  near: NiftyWall[] | undefined,
  spot: number,
  side: Side,
): LevelRead | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  const all = dedupe([...(near ?? []), ...(walls ?? [])]);
  const sideRows = all.filter((wall) =>
    side === "call" ? wall.strike > spot : wall.strike < spot,
  );
  if (!sideRows.length) return null;
  const peak = Math.max(...sideRows.map((wall) => wall.oi));
  const significant = sideRows.filter((wall) => wall.oi >= peak * 0.35);
  const pool = significant.length ? significant : sideRows;
  const wall = pool.sort(
    (a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot),
  )[0];
  const pts = wall.strike - spot;
  const pct = (pts / spot) * 100;
  const abs = Math.abs(pct);
  return {
    strike: wall.strike,
    oi: wall.oi,
    pts,
    pct,
    tag: abs <= 0.25 ? "AT" : abs <= 0.75 ? "NEAR" : abs <= 1.5 ? "WATCH" : "CLEAR",
  };
}

function readIndex(
  spot: number | undefined,
  walls: { calls: NiftyWall[]; puts: NiftyWall[] } | undefined,
  near: { calls: NiftyWall[]; puts: NiftyWall[] } | undefined,
): { call: LevelRead | null; put: LevelRead | null } {
  if (spot == null) return { call: null, put: null };
  return {
    call: nearestLevel(walls?.calls, near?.calls, spot, "call"),
    put: nearestLevel(walls?.puts, near?.puts, spot, "put"),
  };
}

function isNear(level: LevelRead | null): boolean {
  return level != null && (level.tag === "AT" || level.tag === "NEAR");
}

function confluenceLabel(
  nifty: { call: LevelRead | null; put: LevelRead | null } | null,
  sensex: { call: LevelRead | null; put: LevelRead | null } | null,
): string {
  if (!nifty || !sensex) return "ONE INDEX";
  const nc = isNear(nifty.call);
  const np = isNear(nifty.put);
  const sc = isNear(sensex.call);
  const sp = isNear(sensex.put);
  if (nc && sc) return "DUAL RESISTANCE";
  if (np && sp) return "DUAL SUPPORT";
  if ((nc && sp) || (np && sc)) return "DIVERGENT";
  return "NO CONFLUENCE";
}

function LevelInline({
  side,
  level,
  rowLabel,
}: {
  side: "CE" | "PE";
  level: LevelRead | null;
  rowLabel: string;
}) {
  const tone = side === "CE" ? palette.TERM_CE : palette.TERM_PE;
  const testId = `levels-${side.toLowerCase()}-${rowLabel}`;
  if (!level) {
    return (
      <span
        data-testid={testId}
        className="text-[11px] leading-none whitespace-nowrap"
        style={{ color: palette.TEXT_MUTED, fontSize: REPORT_FONT.xs }}
      >
        {side} —
      </span>
    );
  }
  const dist = `${level.pct > 0 ? "+" : ""}${level.pct.toFixed(2)}% ${level.pts > 0 ? "+" : ""}${Math.round(level.pts)}p`;
  return (
    <span
      data-testid={testId}
      className="flex items-baseline gap-1 shrink-0 whitespace-nowrap"
      style={{
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      <span className="font-black text-[11px] leading-none" style={{ color: tone, fontSize: REPORT_FONT.xs, fontWeight: 800 }}>
        {side}
      </span>
      <span
        className="font-mono text-[12px] font-bold leading-none"
        style={{ color: palette.TEXT, fontSize: REPORT_FONT.sm, fontWeight: 700 }}
      >
        {formatNumberIN(Math.round(level.strike))}
      </span>
      <span
        data-testid={`levels-dist-${rowLabel}-${side}`}
        className="inline-flex items-center shrink-0"
        style={{
          display: "inline-flex",
          alignItems: "center",
          height: 14,
          minWidth: 0,
          flexShrink: 0,
          whiteSpace: "nowrap",
          fontFamily: palette.MONO,
          fontSize: REPORT_FONT.sm,
          fontWeight: 800,
          lineHeight: 1,
          color: level.tag === "AT" ? palette.NEGATIVE : tone,
          backgroundColor: level.tag === "AT" ? palette.TINT_NEGATIVE : palette.SURFACE_ALT,
          border: `1px solid ${level.tag === "AT" ? palette.NEGATIVE : "transparent"}`,
          borderRadius: "2px",
          padding: "0 3px",
        }}
      >
        {dist}
      </span>
      <span
        className="text-[11px] font-bold leading-none"
        style={{
          fontSize: REPORT_FONT.xs,
          fontWeight: 800,
          letterSpacing: 0.2,
          lineHeight: 1,
          color: level.tag === "AT" ? palette.NEGATIVE : level.tag === "NEAR" ? tone : palette.TEXT_MUTED,
        }}
      >
        {level.tag}
      </span>
      <span className="font-mono text-[11px] leading-none" style={{ color: palette.TEXT_MUTED, fontSize: REPORT_FONT.xs }}>
        {level.oi >= 1e6 ? `${(level.oi / 1e6).toFixed(1)}M` : `${Math.round(level.oi / 1e3)}k`}
      </span>
    </span>
  );
}

function IndexRow({
  label,
  spot,
  maxPain,
  read,
}: {
  label: string;
  spot: number;
  maxPain: number;
  read: { call: LevelRead | null; put: LevelRead | null };
}) {
  // `columnGap` is breakpoint-responsive (xs/sm) and the first row drops its
  // top border — both are expressible as Tailwind variants.
  return (
    <Box
      data-testid={`levels-row-${label}`}
      className="flex flex-wrap items-center justify-start gap-x-[6px] sm:gap-x-2 gap-y-px py-0 min-w-0 border-t border-fin-border first-of-type:border-t-0"
    >
      <div
        data-testid={`levels-label-${label}`}
        className="flex items-baseline gap-[3px] shrink-0"
        style={{ minWidth: 84 }}
      >
        <Text size="xs" fw={800} style={{ fontSize: REPORT_FONT.xs, letterSpacing: 0.3, lineHeight: 1 }}>
          {label}
        </Text>
        <Text size="xs" c="dimmed" style={{ fontFamily: palette.MONO, fontSize: REPORT_FONT.xs, lineHeight: 1 }}>
          {formatNumberIN(Math.round(spot))}
        </Text>
      </div>
      <LevelInline side="CE" level={read.call} rowLabel={label} />
      <LevelInline side="PE" level={read.put} rowLabel={label} />
      <span
        className="font-mono text-[11px] leading-none whitespace-nowrap shrink-0"
        style={{ color: palette.TEXT_MUTED, fontSize: REPORT_FONT.xs }}
      >
        MP {maxPain > 0 ? formatNumberIN(Math.round(maxPain)) : "—"}
      </span>
    </Box>
  );
}

interface LevelsInPlayProps {
  report: NiftyReport | null;
  sensex: NiftySensex | null;
}

/** Just the dense rows — CE beside PE, one row per index, no panel/title/badge.
 *  Meant to be passed as `levels` to `NiftyWallsCard` (NIFTY) or rendered
 *  standalone where there is no walls card (SENSEX focus). */
export function LevelsInPlayContent({ report, sensex }: LevelsInPlayProps) {
  if (!report && !sensex) return null;
  const nifty = report ? readIndex(report.spot, report.walls, report.wallsNear) : null;
  const sensexRead = sensex ? readIndex(sensex.spot, sensex.walls, sensex.wallsNear) : null;

  return (
    <div className="min-w-0">
      {report ? (
        <IndexRow label="NIFTY" spot={report.spot} maxPain={report.maxPain} read={nifty ?? { call: null, put: null }} />
      ) : null}
      {sensex ? (
        <IndexRow label="SENSEX" spot={sensex.spot} maxPain={sensex.maxPain} read={sensexRead ?? { call: null, put: null }} />
      ) : null}
    </div>
  );
}

export function LevelsInPlay({ report, sensex }: LevelsInPlayProps) {
  if (!report && !sensex) return null;
  const nifty = report ? readIndex(report.spot, report.walls, report.wallsNear) : null;
  const sensexRead = sensex ? readIndex(sensex.spot, sensex.walls, sensex.wallsNear) : null;
  const badge = confluenceLabel(nifty, sensexRead);

  return (
    <CompactPanel
      title="Levels"
      testId="levels-in-play"
      flush
      action={
        <Text
          size="xs"
          fw={800}
          data-testid="levels-badge"
          style={{
            fontSize: REPORT_FONT.xs,
            letterSpacing: 0.35,
            color: badge === "DUAL RESISTANCE" ? palette.NEGATIVE : badge === "DUAL SUPPORT" ? palette.POSITIVE : palette.TEXT_MUTED,
          }}
        >
          {badge}
        </Text>
      }
    >
      <LevelsInPlayContent report={report} sensex={sensex} />
    </CompactPanel>
  );
}
