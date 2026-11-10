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
 * one line each. The strip is a FIXED two-row box — the walls payload landing
 * (or a long flow string) must never resize the one-page report.
 */

/** Row height (px). The body is exactly two of these plus the 2 row borders. */
const ROW_H = 24;

/** Header slots keep a fixed box so a missing regime/flip never resizes the bar. */
const REGIME_SLOT_W = 60;
const REGIME_SLOT_H = 16;
const FLIP_SLOT_W = 72;
const FLIP_SLOT_H = 14;

/** Right cluster (time-to-break + sparkline) — fixed width so rows never reflow. */
const RIGHT_GROUP_W = 150;
const SPARK_W = 54;
const SPARK_H = 12;

/** Flow text is the longest field; cap it and ellipsize instead of wrapping. */
const FLOW_MAX_W = 132;
/** Fuel text keeps a reserved column so its box never nudges the row. */
const FUEL_MIN_W = 86;

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
  hideBelowMd = false,
}: {
  label: string;
  value: string;
  tone?: string;
  /** Secondary columns (rate/prem) drop out on narrow viewports. */
  hideBelowMd?: boolean;
}) {
  return (
    <Box
      component="span"
      sx={{
        display: hideBelowMd ? { xs: "none", md: "inline-flex" } : "inline-flex",
        alignItems: "baseline",
        gap: "2px",
        minWidth: 0,
        flexShrink: 0,
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
      data-testid="wall-erosion-row"
      data-side={side}
      title={fuelPartsTooltip(row)}
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "nowrap",
        columnGap: 0.75,
        minWidth: 0,
        height: ROW_H,
        flexShrink: 0,
        overflow: "hidden",
        borderTop: `1px solid ${palette.BORDER}`,
      }}
    >
      {/* `display: contents` keeps the side wrapper out of the flex layout, so
          the row children stay direct flex items while the side testid still
          scopes the row's content. */}
      <Box component="span" data-testid={testId} sx={{ display: "contents" }}>
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
            flexShrink: 0,
          }}
        >
          {view.statusText}
        </Box>
        <Text
          size="xs"
          fw={700}
          lh={1.1}
          sx={{
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {distanceOf(row)}
        </Text>
        <Stat label="OI" value={view.oiText} />
        <Stat
          label="30m"
          value={view.erosion30Text}
          tone={erosionColor(row?.erosion_30m)}
        />
        <Stat label="rate" value={view.rateText} hideBelowMd />
        <Stat label="vol" value={view.volText} />
        <Stat label="prem" value={view.premText} hideBelowMd />
        <Text
          size="xs"
          fw={800}
          lh={1.1}
          sx={{
            color: flowColor,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            maxWidth: FLOW_MAX_W,
            overflow: "hidden",
            textOverflow: "ellipsis",
            // Flexible field: it absorbs a tight row (ellipsis) instead of
            // pushing the time-to-break cluster out of view.
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          {view.flowText}
        </Text>
        <Text
          size="xs"
          fw={800}
          lh={1.1}
          sx={{
            color: fuelColor,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            minWidth: FUEL_MIN_W,
            flexShrink: 0,
          }}
        >
          {preBlast ? `PRE-BLAST ${view.fuelScore}` : `FUEL ${view.fuelScore}`}
        </Text>
        <Box
          sx={{
            ml: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 0.5,
            width: RIGHT_GROUP_W,
            minWidth: 0,
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {view.breached ? (
            <>
              <Text
                size="xs"
                fw={900}
                lh={1.1}
                sx={{
                  color: palette.NEGATIVE,
                  letterSpacing: "0.06em",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                BREACHED
              </Text>
              <Text
                size="xs"
                c="dimmed"
                lh={1.1}
                sx={{
                  fontSize: REPORT_FONT.micro,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flexShrink: 1,
                }}
              >
                spot crossed
              </Text>
            </>
          ) : (
            <Text
              size="xs"
              c="dimmed"
              lh={1.1}
              sx={{
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                flexShrink: 1,
              }}
            >
              {hasTtb ? `${fmtTimeToBreak(ttb)} to break` : "—"}
            </Text>
          )}
          <Box
            sx={{
              width: SPARK_W,
              height: SPARK_H,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              overflow: "hidden",
              "& svg": { width: SPARK_W, height: SPARK_H },
            }}
          >
            <Sparkline
              values={view.spark}
              width={SPARK_W}
              height={SPARK_H}
              color={sideColor}
              testId={`${testId}-spark`}
              responsive
            />
          </Box>
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
  const { call, put } = pickNearestWalls(walls);
  const symbolLabel = symbol ?? walls?.symbol ?? "—";
  const asOfText = hhmm(asOf ?? walls?.freshness?.last_t) ?? "—";
  const regime = walls?.regime ?? null;
  const flip = walls?.flip;
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
            flexWrap: "nowrap",
            justifyContent: "flex-end",
            overflow: "hidden",
          }}
        >
          <Text
            size="xs"
            fw={800}
            lh={1.2}
            c="dimmed"
            sx={{ whiteSpace: "nowrap", textTransform: "uppercase", flexShrink: 0 }}
          >
            {symbolLabel}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            lh={1.2}
            sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
          >
            as of {asOfText}
          </Text>
          <Box
            component="span"
            data-testid={regime ? "wall-erosion-regime" : undefined}
            aria-hidden={regime ? undefined : true}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: REGIME_SLOT_W,
              height: REGIME_SLOT_H,
              flexShrink: 0,
              visibility: regime ? "visible" : "hidden",
              ...(regime
                ? {
                    px: 0.4,
                    border: `1px solid ${regimeColor}`,
                    color: regimeColor,
                    borderRadius: `${REPORT_RADIUS.sm}px`,
                    fontSize: REPORT_FONT.micro,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    letterSpacing: "0.06em",
                  }
                : {}),
            }}
          >
            {regime ? `${regime} Γ` : ""}
          </Box>
          <Text
            size="xs"
            c="dimmed"
            lh={1.2}
            sx={{
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              width: FLIP_SLOT_W,
              height: FLIP_SLOT_H,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              flexShrink: 0,
              visibility: hasFlip ? "visible" : "hidden",
            }}
          >
            {hasFlip ? `flip ${fmtNum(flip)}` : ""}
          </Text>
        </Box>
      }
    >
      <Box
        data-testid="wall-erosion-body"
        data-layout="fixed"
        data-rows="2"
        aria-busy={walls ? undefined : "true"}
        title="OI erosion + volume + premium flow. PRE-BLAST = short gamma and the wall is being covered."
        sx={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: ROW_H * 2 + 2,
          minHeight: ROW_H * 2 + 2,
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {/* Zero-size marker: the strip keeps its shape while the payload loads. */}
        {!walls ? (
          <Box
            component="span"
            data-testid="wall-erosion-skeleton"
            sx={{
              position: "absolute",
              width: 0,
              height: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          />
        ) : null}
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
