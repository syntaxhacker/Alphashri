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
 * Dense wall-erosion strip for the Index Report: the nearest call/put wall on
 * one line each. The full walls table lives below; this is the at-a-glance
 * answer (erosion, volume, flow, fuel, time-to-break) with no extra height.
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

/** Fuel sub-scores for the row tooltip, `—` for missing buckets. */
function fuelPartsTooltip(row: WallsRow | null | undefined): string {
  const parts = row?.fuel_parts;
  const part = (label: string, value: number | null | undefined): string => {
    const n =
      typeof value === "number" && Number.isFinite(value)
        ? Math.round(value)
        : "—";
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
      sx={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "2px",
        minWidth: 0,
      }}
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

function ErosionRow({
  row,
  side,
  regime,
  testId,
}: {
  row: WallsRow | null;
  side: "CALL" | "PUT";
  regime: "LONG" | "SHORT" | null;
  testId: string;
}) {
  const view = wallErosionView(row, side);
  const sideColor = side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const statusColor = STATUS_TONE_COLOR[statusTone(row?.status)];
  const flowColor = FLOW_TONE_COLOR[view.flowTone];
  const fuelColor = FUEL_TONE_COLOR[fuelTone(view.fuelScore)];
  const preBlast = isPreBlast(row, regime);
  const ttb = row?.time_to_break_min;
  const hasTtb = ttb != null && Number.isFinite(ttb);

  return (
    <Box
      data-testid={testId}
      title={fuelPartsTooltip(row)}
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: 0.75,
        rowGap: "2px",
        minWidth: 0,
        py: "1px",
        borderTop: `1px solid ${palette.BORDER}`,
      }}
    >
      <Text
        size="xs"
        fw={800}
        lh={1.1}
        sx={{
          width: 108,
          flexShrink: 0,
          color: sideColor,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {side} {view.strikeText} {view.arrow}
      </Text>
      <Box
        component="span"
        sx={{
          px: 0.4,
          py: "1px",
          border: `1px solid ${statusColor}`,
          color: statusColor,
          borderRadius: `${REPORT_RADIUS.sm}px`,
          fontSize: REPORT_FONT.micro,
          fontWeight: 800,
          lineHeight: 1.2,
          letterSpacing: "0.06em",
          whiteSpace: "nowrap",
        }}
      >
        {view.statusText}
      </Box>
      <Text
        size="xs"
        fw={700}
        lh={1.1}
        sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
      >
        {distanceOf(row)}
      </Text>
      <Stat label="OI" value={view.oiText} />
      <Stat
        label="30m"
        value={view.erosion30Text}
        tone={erosionColor(row?.erosion_30m)}
      />
      <Stat label="rate" value={view.rateText} />
      <Stat label="vol" value={view.volText} />
      <Stat label="prem" value={view.premText} />
      <Text
        size="xs"
        fw={800}
        lh={1.1}
        sx={{ color: flowColor, letterSpacing: "0.04em", whiteSpace: "nowrap" }}
      >
        {view.flowText}
      </Text>
      <Text
        size="xs"
        fw={800}
        lh={1.1}
        sx={{ color: fuelColor, letterSpacing: "0.04em", whiteSpace: "nowrap" }}
      >
        {preBlast ? `PRE-BLAST ${view.fuelScore}` : `FUEL ${view.fuelScore}`}
      </Text>
      <Box
        sx={{
          ml: "auto",
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          minWidth: 0,
        }}
      >
        {view.breached ? (
          <>
            <Text
              size="xs"
              fw={900}
              lh={1.1}
              sx={{ color: palette.NEGATIVE, letterSpacing: "0.06em" }}
            >
              BREACHED
            </Text>
            <Text
              size="xs"
              c="dimmed"
              lh={1.1}
              sx={{ fontSize: REPORT_FONT.micro }}
            >
              spot crossed
            </Text>
          </>
        ) : (
          <Text
            size="xs"
            c="dimmed"
            lh={1.1}
            sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
          >
            {hasTtb ? `${fmtTimeToBreak(ttb)} to break` : "—"}
          </Text>
        )}
        <Box sx={{ "& svg": { width: 54, height: 12 } }}>
          <Sparkline
            values={view.spark}
            width={54}
            height={12}
            color={sideColor}
            testId={`${testId}-spark`}
            responsive
          />
        </Box>
      </Box>
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
        <Text size="xs" c="dimmed">
          Waiting for walls data.
        </Text>
      </CompactPanel>
    );
  }

  const symbolLabel = symbol ?? walls.symbol ?? "—";
  const { call, put } = pickNearestWalls(walls);
  const asOfText = hhmm(asOf ?? walls.freshness?.last_t);
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
            gap: 0.6,
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
                px: 0.4,
                py: "1px",
                border: `1px solid ${regimeColor}`,
                color: regimeColor,
                borderRadius: `${REPORT_RADIUS.sm}px`,
                fontSize: REPORT_FONT.micro,
                fontWeight: 800,
                lineHeight: 1.2,
                letterSpacing: "0.06em",
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
      <Box
        data-testid="wall-erosion-body"
        title="OI erosion + volume + premium flow. PRE-BLAST = short gamma and the wall is being covered."
        sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        <ErosionRow
          row={call}
          side="CALL"
          regime={regime}
          testId="wall-erosion-call"
        />
        <ErosionRow
          row={put}
          side="PUT"
          regime={regime}
          testId="wall-erosion-put"
        />
      </Box>
    </CompactPanel>
  );
}
