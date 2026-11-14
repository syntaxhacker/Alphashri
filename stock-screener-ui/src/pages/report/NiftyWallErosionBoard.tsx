import { createMemo, Show } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import { LocalCompactPanel } from "./reportBits";
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

function Stat(props: {
  label: string;
  value: string;
  tone?: string;
  /** Secondary columns (rate/prem) drop out on narrow viewports. */
  hideBelowMd?: boolean;
}) {
  return (
    <div
      class="inline-flex items-baseline gap-[2px] min-w-0 shrink-0"
      style={{ display: (props.hideBelowMd ?? false) ? "none" : "inline-flex" }}
    >
      <Text size="xs" c="dimmed" lh={1.1} style={{ "font-size": `${REPORT_FONT.micro}px` }}>
        {props.label}
      </Text>
      <Text
        size="xs"
        fw={700}
        lh={1.1}
        c={props.tone ?? palette.TEXT}
        className="font-mono tabular-nums whitespace-nowrap"
      >
        {props.value}
      </Text>
    </div>
  );
}

function ErosionRow(props: {
  row: WallsRow | null;
  side: "CALL" | "PUT";
  regime: "LONG" | "SHORT" | null;
  testId: string;
}) {
  const view = createMemo(() => wallErosionView(props.row, props.side));
  const sideColor = props.side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const statusColor = createMemo(() => STATUS_TONE_COLOR[statusTone(props.row?.status)]);
  const flowColor = createMemo(() => FLOW_TONE_COLOR[view().flowTone]);
  const fuelColor = createMemo(() => FUEL_TONE_COLOR[fuelTone(view().fuelScore)]);
  const preBlast = createMemo(() => isPreBlast(props.row, props.regime));
  const ttb = () => props.row?.time_to_break_min;
  const hasTtb = createMemo(() => {
    const t = ttb();
    return t != null && Number.isFinite(t);
  });

  return (
    <div
      data-testid="wall-erosion-row"
      data-side={props.side}
      title={fuelPartsTooltip(props.row)}
      class="flex items-center flex-nowrap min-w-0 shrink-0 overflow-hidden h-[24px]"
      style={{
        "border-top": `1px solid ${palette.BORDER}`,
        height: `${ROW_H}px`,
      }}
    >
      {/* `display: contents` keeps the side wrapper out of the flex layout, so
          the row children stay direct flex items while the side testid still
          scopes the row's content. */}
      <span data-testid={props.testId} class="contents">
        <Text
          size="xs"
          fw={800}
          lh={1.1}
          className="font-mono tabular-nums whitespace-nowrap shrink-0"
          style={{
            "width": "108px",
            "flex-shrink": 0,
            color: sideColor,
            "white-space": "nowrap",
          }}
        >
          {props.side} {view().strikeText} {view().arrow}
        </Text>
        <span
          class="inline-flex items-center justify-center shrink-0 whitespace-nowrap"
          style={{
            padding: "4px 2px",
            border: `1px solid ${statusColor()}`,
            color: statusColor(),
            "border-radius": `${REPORT_RADIUS.sm}px`,
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": 800,
            "line-height": 1.2,
            "letter-spacing": "0.06em",
          }}
        >
          {view().statusText}
        </span>
        <Text
          size="xs"
          fw={700}
          lh={1.1}
          className="font-mono tabular-nums whitespace-nowrap shrink-0"
        >
          {distanceOf(props.row)}
        </Text>
        <Stat label="OI" value={view().oiText} />
        <Stat
          label="30m"
          value={view().erosion30Text}
          tone={erosionColor(props.row?.erosion_30m)}
        />
        <Stat label="rate" value={view().rateText} hideBelowMd />
        <Stat label="vol" value={view().volText} />
        <Stat label="prem" value={view().premText} hideBelowMd />
        <Text
          size="xs"
          fw={800}
          lh={1.1}
          className="font-mono tabular-nums whitespace-nowrap shrink-0"
          style={{
            color: flowColor(),
            "letter-spacing": "0.04em",
            "white-space": "nowrap",
            "max-width": `${FLOW_MAX_W}px`,
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "min-width": "0px",
            "flex-shrink": 1,
          }}
        >
          {view().flowText}
        </Text>
        <Text
          size="xs"
          fw={800}
          lh={1.1}
          className="font-mono tabular-nums whitespace-nowrap shrink-0"
          style={{
            color: fuelColor(),
            "letter-spacing": "0.04em",
            "white-space": "nowrap",
            "min-width": `${FUEL_MIN_W}px`,
            "flex-shrink": 0,
          }}
        >
          {preBlast() ? `PRE-BLAST ${view().fuelScore}` : `FUEL ${view().fuelScore}`}
        </Text>
        <div
          class="ml-auto flex items-center justify-end"
          style={{
            width: `${RIGHT_GROUP_W}px`,
            "min-width": "0px",
            "flex-shrink": 0,
            overflow: "hidden",
            display: "flex",
            "align-items": "center",
            "justify-content": "flex-end",
          }}
        >
          <Show
            when={view().breached}
            fallback={
            <Text
              size="xs"
              c="dimmed"
              lh={1.1}
              className="font-mono tabular-nums whitespace-nowrap shrink-0 min-w-0 overflow-hidden truncate"
              style={{ "min-width": "0px", "flex-shrink": 1 }}
            >
              {hasTtb() ? `${fmtTimeToBreak(ttb())} to break` : "—"}
            </Text>
            }
          >
              <Text
                size="xs"
                fw={900}
                lh={1.1}
                className="whitespace-nowrap shrink-0"
                style={{ color: palette.NEGATIVE, "letter-spacing": "0.06em" }}
              >
                BREACHED
              </Text>
              <Text
                size="xs"
                c="dimmed"
                lh={1.1}
                className="min-w-0 overflow-hidden truncate whitespace-nowrap shrink-0"
                style={{ "font-size": `${REPORT_FONT.micro}px`, "min-width": "0px", "flex-shrink": 1 }}
              >
                spot crossed
              </Text>
          </Show>
          <div
            class="flex items-center justify-end overflow-hidden shrink-0"
            style={{
              width: `${SPARK_W}px`,
              height: `${SPARK_H}px`,
              "flex-shrink": 0,
              display: "flex",
              "align-items": "center",
              "justify-content": "flex-end",
              overflow: "hidden",
            }}
          >
            <Sparkline
              values={view().spark}
              width={SPARK_W}
              height={SPARK_H}
              color={sideColor}
              testId={`${props.testId}-spark`}
              responsive
            />
          </div>
        </div>
      </span>
    </div>
  );
}

export function NiftyWallErosionBoard(props: NiftyWallErosionBoardProps) {
  const nearest = createMemo(() => pickNearestWalls(props.walls));
  const call = () => nearest().call;
  const put = () => nearest().put;
  const symbolLabel = props.symbol ?? props.walls?.symbol ?? "—";
  const asOfText = hhmm(props.asOf ?? props.walls?.freshness?.last_t) ?? "—";
  const regime = createMemo(() => props.walls?.regime ?? null);
  const flip = props.walls?.flip;
  const hasFlip = typeof flip === "number" && Number.isFinite(flip);
  const regimeColor = createMemo(() => regime() === "SHORT" ? palette.NEGATIVE : palette.POSITIVE);

  return (
    <LocalCompactPanel
      title="WALL EROSION"
      testId="wall-erosion-board"
      action={
        <div class="flex items-center gap-[4px] min-w-0 flex-nowrap justify-end overflow-hidden">
          <Text
            size="xs"
            fw={800}
            lh={1.2}
            c="dimmed"
            className="whitespace-nowrap uppercase shrink-0"
          >
            {symbolLabel}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            lh={1.2}
            className="whitespace-nowrap shrink-0"
          >
            as of {asOfText}
          </Text>
          <span
            data-testid={regime() ? "wall-erosion-regime" : undefined}
            aria-hidden={regime() ? undefined : true}
            class="inline-flex items-center justify-center shrink-0"
            style={{
              width: `${REGIME_SLOT_W}px`,
              height: `${REGIME_SLOT_H}px`,
              "flex-shrink": 0,
              visibility: regime() ? "visible" : "hidden",
              ...(regime()
                ? {
                    padding: "4px 2px",
                    border: `1px solid ${regimeColor()}`,
                    color: regimeColor(),
                    "border-radius": `${REPORT_RADIUS.sm}px`,
                    "font-size": `${REPORT_FONT.micro}px`,
                    "font-weight": 800,
                    "line-height": 1.2,
                    "letter-spacing": "0.06em",
                  }
                : {}),
            }}
          >
            {regime() ? `${regime()} Γ` : ""}
          </span>
          <Text
            size="xs"
            c="dimmed"
            lh={1.2}
            className="font-mono tabular-nums whitespace-nowrap shrink-0"
            style={{
              width: `${FLIP_SLOT_W}px`,
              height: `${FLIP_SLOT_H}px`,
              display: "flex",
              "align-items": "center",
              "justify-content": "flex-end",
              "flex-shrink": 0,
              visibility: hasFlip ? "visible" : "hidden",
            }}
          >
            {hasFlip ? `flip ${fmtNum(flip)}` : ""}
          </Text>
        </div>
      }
    >
      <div
        data-testid="wall-erosion-body"
        data-layout="fixed"
        data-rows="2"
        aria-busy={props.walls ? undefined : "true"}
        title="OI erosion + volume + premium flow. PRE-BLAST = short gamma and the wall is being consumed."
        class="relative flex flex-col min-w-0 overflow-hidden"
        style={{
          height: `${ROW_H * 2 + 2}px`,
          "min-height": `${ROW_H * 2 + 2}px`,
        }}
      >
        {/* Zero-size marker: the strip keeps its shape while the payload loads. */}
        {!props.walls ? (
          <span
            data-testid="wall-erosion-skeleton"
            class="absolute overflow-hidden"
            style={{
              width: 0,
              height: 0,
              "pointer-events": "none",
            }}
          />
        ) : null}
        <ErosionRow
          row={call()}
          side="CALL"
          regime={regime()}
          testId="wall-erosion-call"
        />
        <ErosionRow
          row={put()}
          side="PUT"
          regime={regime()}
          testId="wall-erosion-put"
        />
      </div>
    </LocalCompactPanel>
  );
}
