import Box from "@mui/material/Box";
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
      <Box
        component="span"
        data-testid={testId}
        sx={{ fontSize: REPORT_FONT.xs, lineHeight: 1, color: palette.TEXT_MUTED, whiteSpace: "nowrap" }}
      >
        {side} —
      </Box>
    );
  }
  const dist = `${level.pct > 0 ? "+" : ""}${level.pct.toFixed(2)}% ${level.pts > 0 ? "+" : ""}${Math.round(level.pts)}p`;
  return (
    <Box
      data-testid={testId}
      sx={{
        display: "flex",
        alignItems: "baseline",
        gap: "4px",
        minWidth: 0,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      <Box component="span" sx={{ color: tone, fontSize: REPORT_FONT.xs, fontWeight: 800, lineHeight: 1 }}>{side}</Box>
      <Box
        component="span"
        sx={{
          fontFamily: palette.MONO,
          fontSize: REPORT_FONT.sm,
          fontWeight: 700,
          color: palette.TEXT,
          lineHeight: 1,
        }}
      >
        {formatNumberIN(Math.round(level.strike))}
      </Box>
      <Box
        component="span"
        data-testid={`levels-dist-${rowLabel}-${side}`}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          height: 14,
          fontFamily: palette.MONO,
          fontSize: REPORT_FONT.sm,
          fontWeight: 800,
          lineHeight: 1,
          color: level.tag === "AT" ? palette.NEGATIVE : tone,
          bgcolor: level.tag === "AT" ? palette.TINT_NEGATIVE : palette.SURFACE_ALT,
          border: `1px solid ${level.tag === "AT" ? palette.NEGATIVE : "transparent"}`,
          borderRadius: "2px",
          px: "3px",
          py: 0,
        }}
      >
        {dist}
      </Box>
      <Box
        component="span"
        sx={{
          fontSize: REPORT_FONT.xs,
          fontWeight: 800,
          letterSpacing: 0.2,
          lineHeight: 1,
          color: level.tag === "AT" ? palette.NEGATIVE : level.tag === "NEAR" ? tone : palette.TEXT_MUTED,
        }}
      >
        {level.tag}
      </Box>
      <Box
        component="span"
        sx={{ fontFamily: palette.MONO, fontSize: REPORT_FONT.xs, lineHeight: 1, color: palette.TEXT_MUTED }}
      >
        {level.oi >= 1e6 ? `${(level.oi / 1e6).toFixed(1)}M` : `${Math.round(level.oi / 1e3)}k`}
      </Box>
    </Box>
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
  return (
    <Box
      data-testid={`levels-row-${label}`}
      sx={{
        display: "flex",
        // Keep one dense line (CE beside PE, no 1fr tracks to spread them), but
        // let the row wrap instead of clipping MP when the panel is narrow.
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "flex-start",
        columnGap: { xs: "6px", sm: "8px" },
        rowGap: "1px",
        py: 0,
        borderTop: `1px solid ${palette.BORDER}`,
        minWidth: 0,
        "&:first-of-type": { borderTop: 0 },
      }}
    >
      <Box
        data-testid={`levels-label-${label}`}
        sx={{ display: "flex", alignItems: "baseline", gap: "3px", minWidth: 84, flexShrink: 0 }}
      >
        <Text size="xs" fw={800} style={{ fontSize: REPORT_FONT.xs, letterSpacing: 0.3, lineHeight: 1 }}>
          {label}
        </Text>
        <Text size="xs" c="dimmed" style={{ fontFamily: palette.MONO, fontSize: REPORT_FONT.xs, lineHeight: 1 }}>
          {formatNumberIN(Math.round(spot))}
        </Text>
      </Box>
      <LevelInline side="CE" level={read.call} rowLabel={label} />
      <LevelInline side="PE" level={read.put} rowLabel={label} />
      <Box
        component="span"
        sx={{
          fontFamily: palette.MONO,
          fontSize: REPORT_FONT.xs,
          lineHeight: 1,
          color: palette.TEXT_MUTED,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        MP {maxPain > 0 ? formatNumberIN(Math.round(maxPain)) : "—"}
      </Box>
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
    <Box sx={{ minWidth: 0 }}>
      {report ? (
        <IndexRow label="NIFTY" spot={report.spot} maxPain={report.maxPain} read={nifty ?? { call: null, put: null }} />
      ) : null}
      {sensex ? (
        <IndexRow label="SENSEX" spot={sensex.spot} maxPain={sensex.maxPain} read={sensexRead ?? { call: null, put: null }} />
      ) : null}
    </Box>
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
