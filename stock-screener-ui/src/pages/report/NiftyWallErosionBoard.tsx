import Box from "@mui/material/Box";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import { CompactPanel } from "@/components/common/compact";
import { Sparkline } from "@/components/common/Sparkline";
import {
  fuelTone,
  isPreBlast,
  pickNearestWalls,
  wallErosionView,
  type FuelTone,
} from "./wallErosion";
import {
  dist,
  erosionColor,
  fmtNum,
  fmtTimeToBreak,
  statusTone,
} from "./niftyWallsFormat";
import { formatReportPoints, REPORT_MINUS } from "./reportFormat";
import { REPORT_FONT, REPORT_RADIUS } from "./reportTokens";

/**
 * Always-visible wall-erosion board for the Index Report: the nearest call
 * and put wall with OI erosion, volume, premium flow, fuel score, status and
 * time-to-break. Reads the same `walls` payload as the walls card; no fetch
 * of its own.
 */

interface NiftyWallErosionBoardProps {
  walls: WallsPayload | null;
  symbol?: string;
  asOf?: string | null;
}

const FLOW_TONE_COLOR: Record<"bull" | "bear" | "muted", string> = {
  bull: palette.POSITIVE,
  bear: palette.NEGATIVE,
  muted: palette.TEXT_MUTED,
};

const STATUS_TONE_COLOR: Record<
  "positive" | "warning" | "negative" | "muted",
  string
> = {
  positive: palette.POSITIVE,
  warning: palette.WARNING,
  negative: palette.NEGATIVE,
  muted: palette.TEXT_MUTED,
};

const FUEL_TONE_COLOR: Record<FuelTone, string> = {
  positive: palette.POSITIVE,
  warning: palette.WARNING,
  negative: palette.NEGATIVE,
  muted: palette.TEXT_MUTED,
};

/** `HH:MM` straight out of an ISO-ish string — host-TZ independent. */
function hhmm(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/** Signed distance for a row; falls back to the percent when pts is absent. */
function distanceOf(row: WallsRow | null | undefined): string {
  const pts = row?.distance_pts;
  if (pts != null && Number.isFinite(pts)) {
    return formatReportPoints(pts, { minus: REPORT_MINUS });
  }
  return dist(row?.distance_pct);
}

/** Fuel sub-scores for the card tooltip, `—` for missing buckets. */
function fuelPartsTooltip(row: WallsRow | null | undefined): string {
  const parts = row?.fuel_parts;
  const part = (label: string, value: number | null | undefined): string => {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : "—";
    return `${label} ${n}`;
  };
  if (!parts) {
    return `Fuel parts — erosion — · volume — · proximity — · gamma — · flow — | flow: ${row?.flow ?? "—"}`;
  }
  return `Fuel parts — ${part("erosion", parts.erosion)} · ${part("volume", parts.volume)} · ${part("proximity", parts.proximity)} · ${part("gamma", parts.gamma)} · ${part("flow", parts.flow)} | flow: ${row?.flow ?? "—"}`;
}

function Stat({
  label,
  value,
  tone = palette.TEXT,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "baseline", gap: "3px", minWidth: 0 }}
    >
      <Text size="xs" c="dimmed" lh={1.1} sx={{ fontSize: REPORT_FONT.micro }}>
        {label}
      </Text>
      <Text
        size="xs"
        fw={700}
        lh={1.1}
        c={tone}
        sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
      >
        {value}
      </Text>
    </Box>
  );
}

function WallCard({
  row,
  side,
  regime,
}: {
  row: WallsRow | null;
  side: "CALL" | "PUT";
  regime: "LONG" | "SHORT" | null;
}) {
  const view = wallErosionView(row, side);
  const sideColor = side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const statusColor = STATUS_TONE_COLOR[statusTone(row?.status)];
  const flowColor = FLOW_TONE_COLOR[view.flowTone];
  const fuelColor = FUEL_TONE_COLOR[fuelTone(view.fuelScore)];
  const preBlast = isPreBlast(row, regime);
  const cardTestId = side === "CALL" ? "wall-erosion-call" : "wall-erosion-put";
  const timeToBreakMin = row?.time_to_break_min;
  const hasTimeToBreak =
    timeToBreakMin != null && Number.isFinite(timeToBreakMin);

  return (
    <Box
      data-testid={cardTestId}
      title={fuelPartsTooltip(row)}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        p: 1,
        minWidth: 0,
        bgcolor: palette.SURFACE_ALT,
        borderRadius: `${REPORT_RADIUS.sm}px`,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
        <Text
          size="sm"
          fw={800}
          lh={1.1}
          sx={{ color: sideColor, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
        >
          {side} {view.strikeText}
        </Text>
        <Box
          component="span"
          aria-hidden
          sx={{ color: palette.TEXT_MUTED, fontSize: REPORT_FONT.micro, lineHeight: 1 }}
        >
          {view.arrow}
        </Box>
        <Box
          component="span"
          sx={{
            ml: "auto",
            px: 0.5,
            py: "1px",
            border: `1px solid ${statusColor}`,
            color: statusColor,
            borderRadius: `${REPORT_RADIUS.sm}px`,
            fontSize: REPORT_FONT.micro,
            fontWeight: 800,
            lineHeight: 1.4,
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
          }}
        >
          {view.statusText}
        </Box>
      </Box>

      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 0.5, minWidth: 0 }}>
        <Text size="xs" c="dimmed" lh={1.1} sx={{ fontSize: REPORT_FONT.micro }}>
          DIST
        </Text>
        <Text
          size="xs"
          fw={700}
          lh={1.1}
          sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
        >
          {distanceOf(row)}
        </Text>
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, minWidth: 0 }}>
        <Stat label="OI" value={view.oiText} />
        <Stat label="30m" value={view.erosion30Text} tone={erosionColor(row?.erosion_30m)} />
        <Stat label="rate" value={view.rateText} />
        <Stat label="vol" value={view.volText} />
        <Stat label="prem" value={view.premText} />
      </Box>

      <Box sx={{ "& svg": { width: "100%", height: 18 } }}>
        <Sparkline
          values={view.spark}
          width={240}
          height={18}
          color={sideColor}
          testId={`${cardTestId}-spark`}
          responsive
        />
      </Box>

      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5, minWidth: 0 }}>
        <Text size="xs" c="dimmed" lh={1.2} sx={{ fontSize: REPORT_FONT.micro }}>
          FLOW
        </Text>
        <Text
          size="xs"
          fw={800}
          lh={1.2}
          sx={{ color: flowColor, letterSpacing: "0.05em", whiteSpace: "nowrap" }}
        >
          {view.flowText}
        </Text>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
        <Text
          size="xs"
          fw={800}
          lh={1.1}
          sx={{ color: fuelColor, letterSpacing: "0.05em", whiteSpace: "nowrap" }}
        >
          {preBlast
            ? `PRE-BLAST ${view.fuelScore}`
            : `FUEL ${view.fuelScore}`}
        </Text>
        <Box
          sx={{
            height: 4,
            borderRadius: 999,
            bgcolor: palette.BORDER,
            overflow: "hidden",
          }}
        >
          <Box
            data-testid={`${cardTestId}-fuel-fill`}
            sx={{ width: `${view.fuelScore}%`, height: "100%", bgcolor: fuelColor }}
          />
        </Box>
      </Box>

      {view.breached ? (
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5, minWidth: 0 }}>
          <Text
            size="sm"
            fw={900}
            lh={1}
            sx={{ color: palette.NEGATIVE, letterSpacing: "0.08em" }}
          >
            BREACHED
          </Text>
          <Text size="xs" c="dimmed" lh={1.2} sx={{ fontSize: REPORT_FONT.micro }}>
            spot crossed
          </Text>
        </Box>
      ) : (
        <Text size="xs" c="dimmed" lh={1.2} sx={{ fontVariantNumeric: "tabular-nums" }}>
          {hasTimeToBreak ? `${fmtTimeToBreak(timeToBreakMin)} to break` : "—"}
        </Text>
      )}
    </Box>
  );
}

export function NiftyWallErosionBoard({
  walls,
  symbol,
  asOf,
}: NiftyWallErosionBoardProps) {
  if (!walls) {
    return (
      <CompactPanel title="WALL EROSION" testId="wall-erosion-board">
        <Text size="sm" c="dimmed">
          Waiting for walls data.
        </Text>
      </CompactPanel>
    );
  }

  const symbolLabel = symbol ?? walls.symbol ?? "—";
  const { call, put } = pickNearestWalls(walls);
  const freshnessT = walls.freshness?.last_t;
  const asOfText = hhmm(asOf ?? freshnessT);
  const regime = walls.regime ?? null;
  const flip = walls.flip;
  const hasFlip = typeof flip === "number" && Number.isFinite(flip);
  const regimeColor = regime === "SHORT" ? palette.NEGATIVE : palette.POSITIVE;

  return (
    <CompactPanel
      title="WALL EROSION"
      testId="wall-erosion-board"
      action={
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            minWidth: 0,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <Text
            size="xs"
            fw={800}
            lh={1.2}
            c="dimmed"
            sx={{ whiteSpace: "nowrap", textTransform: "uppercase" }}
          >
            {symbolLabel}
          </Text>
          {asOfText ? (
            <Text size="xs" c="dimmed" lh={1.2} sx={{ whiteSpace: "nowrap" }}>
              as of {asOfText}
            </Text>
          ) : null}
          {regime ? (
            <Box
              component="span"
              data-testid="wall-erosion-regime"
              sx={{
                px: 0.5,
                py: "1px",
                border: `1px solid ${regimeColor}`,
                color: regimeColor,
                borderRadius: `${REPORT_RADIUS.sm}px`,
                fontSize: REPORT_FONT.micro,
                fontWeight: 800,
                lineHeight: 1.4,
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              {regime} Γ
            </Box>
          ) : null}
          {hasFlip ? (
            <Text
              size="xs"
              c="dimmed"
              lh={1.2}
              sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
            >
              flip {fmtNum(flip)}
            </Text>
          ) : null}
        </Box>
      }
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
            gap: 1,
            minWidth: 0,
          }}
        >
          <WallCard row={call} side="CALL" regime={regime} />
          <WallCard row={put} side="PUT" regime={regime} />
        </Box>
        <Text
          size="xs"
          c="dimmed"
          lh={1.2}
          sx={{ fontSize: REPORT_FONT.micro }}
        >
          OI erosion + volume + premium flow. PRE-BLAST when short gamma and the wall is being covered.
        </Text>
      </Box>
    </CompactPanel>
  );
}
