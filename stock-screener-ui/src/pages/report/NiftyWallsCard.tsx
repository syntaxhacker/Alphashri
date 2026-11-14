import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Text, Button, Badge } from "@/ui";
import { LocalCompactPanel } from "./reportBits";
import { Sparkline } from "@/components/common/Sparkline";
import * as palette from "@/ui/palette";
import type { WallsEvent, WallsPayload, WallsRow } from "@/api/reportNifty";
import {
  STATE_COLOR,
  dist,
  erosionColor,
  firstBreakEvent,
  erosionArrow,
  flowLabel,
  flowTone,
  fmtNum,
  fmtOI,
  fmtPct,
  fmtPremChange,
  fmtRate,
  fmtSignedOI,
  fmtVolMult,
  formatDte,
  lastBreakEvent,
  newOiTint,
  statusTone,
  wallsMaxOi,
} from "./niftyWallsFormat";
import { wallCode, wallSide } from "./niftyChartMath";
import { wallErosionView } from "./wallErosion";
import {
  REPORT_FONT,
  REPORT_ROW,
  REPORT_PAD,
  REPORT_RADIUS,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

/** The walls band always reserves three rows per side: the Index Report is a
 *  one-page layout, so a thin payload (or a null payload) must never shrink
 *  the card. */
const WALLS_ROWS = 3;

/** Capped columns: strike minmax(0,210px) so strike and numbers stay one unit;
 *  OI 48px, NEW 48px, 5m 40px, 30m 40px, DIST 44px stay fixed and readable. */

const WALLS_HEADINGS = ["OI", "NEW", "5m", "30m", "DIST"] as const;

/** Fixed reservation for the READ/SEQ and tracked-history columns so the null
 *  skeleton keeps the same band height as the populated card. */
const WALLS_RESERVED_H = 96;

function Stat(props: { label: string; value: string; color?: string }) {
  return (
    <div class="min-w-0 py-[2px]">
      <Text
        size="xs"
        span
        fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
        style={{
          "font-size": `${REPORT_FONT.micro}px`,
          "line-height": REPORT_LINE_HEIGHT.tight,
          color: palette.TEXT_MUTED,
          "letter-spacing": REPORT_LETTER_SPACING.wide,
        }}
      >
        {props.label}
      </Text>
      <Text
        size="xs"
        span
        fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
        className="tabular-nums whitespace-nowrap overflow-hidden truncate"
        style={{
          "font-size": `${REPORT_FONT.md}px`,
          "line-height": REPORT_LINE_HEIGHT.snug,
          color: props.color ?? palette.TEXT_COLOR,
          "white-space": "nowrap",
          overflow: "hidden",
          "text-overflow": "ellipsis",
        }}
      >
        {props.value}
      </Text>
    </div>
  );
}

function toneColor(tone: "positive" | "warning" | "negative" | "muted"): string {
  switch (tone) {
    case "positive":
      return palette.POSITIVE;
    case "negative":
      return palette.NEGATIVE;
    case "warning":
      return palette.WARNING;
    default:
      return palette.TEXT_MUTED;
  }
}

function flowToneColor(tone: "bull" | "bear" | "muted"): string {
  return tone === "bull" ? palette.POSITIVE : tone === "bear" ? palette.NEGATIVE : palette.TEXT_MUTED;
}

// Call-wall erosion is upside fuel for the desk and put-wall erosion is
// downside fuel, so colour the erosion cells by that fuel direction (side +
// status) — never by the erosion sign alone.
function wallFuelColor(side: "CALL" | "PUT", row: WallsRow): string {
  const arrow = erosionArrow(side, row.status ?? "");
  if (arrow === "▲") return palette.POSITIVE;
  if (arrow === "▼") return palette.NEGATIVE;
  return toneColor(statusTone(row.status));
}

/** A reserved row slot: same grid, same two-line strike cell and the same
 *  row height as a live row, so the table never shrinks. */
function WallPlaceholderRow(props: { side: "CALL" | "PUT" }) {
  return (
    <div
      data-testid={`nifty-walls-${props.side.toLowerCase()}-placeholder`}
      data-placeholder="true"
      data-wall-row="true"
      class="grid grid-cols-[minmax(0,210px)_48px_48px_40px_40px_44px] gap-[4px] items-center pl-[8px]"
      style={{
        "column-gap": `${REPORT_PAD.xs}px`,
        "padding-top": `${REPORT_PAD.xs}px`,
        "padding-bottom": `${REPORT_PAD.xs}px`,
        "padding-left": `${REPORT_PAD.sm}px`,
        "min-height": `${REPORT_ROW.walls}px`,
        "border-left": "2px solid transparent",
      }}
    >
      <div class="flex flex-col gap-[4px] min-w-0" style={{ "padding-left": `${REPORT_PAD.xs}px` }}>
        <Text
          size="xs"
          span
          style={{
            "font-size": `${REPORT_FONT.sm}px`,
            "line-height": REPORT_LINE_HEIGHT.snug,
            color: palette.TEXT_MUTED,
            "font-variant-numeric": "tabular-nums",
          }}
        >
          —
        </Text>
        <Text
          size="xs"
          span
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "line-height": REPORT_LINE_HEIGHT.tight,
            color: palette.TEXT_MUTED,
          }}
        >
          —
        </Text>
      </div>
      <For each={WALLS_HEADINGS}>{() => (
        <Text
          size="xs"
          span
          style={{
            "font-size": `${REPORT_FONT.sm}px`,
            "line-height": REPORT_LINE_HEIGHT.snug,
            "text-align": "right",
            color: palette.TEXT_MUTED,
            "font-variant-numeric": "tabular-nums",
          }}
        >
          —
        </Text>
      )}</For>
    </div>
  );
}

function WallTable(props: { side: "CALL" | "PUT"; rows: WallsRow[]; spot: number }) {
  const color = props.side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const maxOi = createMemo(() => wallsMaxOi(props.rows));
  const sideKey = props.side.toLowerCase();
  // Three rows always: the missing ones are reserved slots, so a one-wall
  // payload leaves the table exactly as tall as a three-wall payload.
  const placeholders = createMemo(() => Math.max(0, WALLS_ROWS - Math.min(props.rows.length, WALLS_ROWS)));
  const display = createMemo(() => [
    ...props.rows.slice(0, WALLS_ROWS),
    ...Array.from({ length: placeholders() }, () => null),
  ]);
  return (
    <div data-testid={`nifty-walls-${sideKey}`} class="min-w-0">
      <div
        class="grid grid-cols-[minmax(0,210px)_48px_48px_40px_40px_44px] gap-[4px] border-b border-solid pb-[4px] mb-[4px]"
        style={{
          "column-gap": `${REPORT_PAD.xs}px`,
          "border-bottom": `1px solid ${palette.BORDER}`,
          "padding-bottom": `${REPORT_PAD.xs}px`,
          "margin-bottom": `${REPORT_PAD.xs}px`,
        }}
      >
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.xs}px`,
            color,
            "letter-spacing": REPORT_LETTER_SPACING.wider,
          }}
        >
          {props.side}
        </Text>
        <For each={WALLS_HEADINGS}>{(heading) => (
          <Text
            size="xs"
            span
            title={heading === "NEW" ? "New OI since session open (old book → new book)" : undefined}
            style={{
              "font-size": `${REPORT_FONT.xs}px`,
              color: palette.TEXT_MUTED,
              "text-align": "right",
              "letter-spacing": REPORT_LETTER_SPACING.normal,
            }}
          >
            {heading}
          </Text>
        )}</For>
      </div>
      <For each={display()}>{(row) => {
        if (!row) {
          return <WallPlaceholderRow side={props.side} />;
        }
        const view = wallErosionView(row, props.side);
        const nearest = Boolean(row.nearest);
        const tracked = Boolean(row.tracked);
        const flowLabelText = flowLabel(row.flow);
        const volText = fmtVolMult(row.vol_mult);
        const flowSuffix =
          flowLabelText !== "—" || volText !== "—" ? `${flowLabelText} · vol ${volText}` : "—";
        const parts = row.fuel_parts;
        const partsTitle = parts
          ? ` · parts: erosion ${parts.erosion}, volume ${parts.volume}, proximity ${parts.proximity}, gamma ${parts.gamma}, flow ${parts.flow}`
          : "";
        const cellColor = wallFuelColor(props.side, row);
        const border = nearest
          ? `2px solid ${cellColor}`
          : tracked
            ? `2px solid ${color}`
            : "2px solid transparent";
        return (
          <div
            data-wall-row="true"
            class="grid grid-cols-[minmax(0,210px)_48px_48px_40px_40px_44px] gap-[4px] items-center pl-[8px]"
            style={{
              "column-gap": `${REPORT_PAD.xs}px`,
              "align-items": "center",
              "padding-top": `${REPORT_PAD.xs}px`,
              "padding-bottom": `${REPORT_PAD.xs}px`,
              "padding-left": `${REPORT_PAD.sm}px`,
              "min-height": `${REPORT_ROW.walls}px`,
              "border-left": border,
              "background-color": (nearest || tracked) ? palette.SURFACE_ALT : "transparent",
              transition: "background-color 180ms ease",
            }}
          >
            <div class="flex flex-col gap-[4px] min-w-0" style={{ "padding-left": `${REPORT_PAD.xs}px` }}>
              <div class="flex items-baseline gap-[4px] min-w-0">
                <Text
                  size="xs"
                  span
                  fw={tracked ? REPORT_FONT_WEIGHT.bold : REPORT_FONT_WEIGHT.medium}
                  style={{
                    "font-size": `${REPORT_FONT.sm}px`,
                    "line-height": REPORT_LINE_HEIGHT.snug,
                    "font-weight": tracked ? REPORT_FONT_WEIGHT.bold : REPORT_FONT_WEIGHT.medium,
                    color: tracked ? color : palette.TEXT_COLOR,
                    "font-variant-numeric": "tabular-nums",
                    "white-space": "nowrap",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                  }}
                >
                  {fmtNum(row.strike)}
                </Text>
                <Show when={nearest}>
                  <div class="w-[3px] h-[3px] rounded-full shrink-0" style={{ "background-color": cellColor }} />
                </Show>
                <Show when={view.arrow !== "—"}>
                  <Text
                    size="xs"
                    span
                    fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                    style={{
                      "font-size": `${REPORT_FONT.micro}px`,
                      "font-weight": REPORT_FONT_WEIGHT.extrabold,
                      color: cellColor,
                      "margin-left": `${REPORT_PAD.xs}px`,
                      "flex-shrink": 0,
                    }}
                  >
                    {view.arrow}
                  </Text>
                </Show>
                <span style={{ "font-size": `${REPORT_FONT.micro}px`, "margin-left": "3px", color: palette.TEXT_MUTED }}>
                  {wallCode(props.side === "CALL", wallSide(row.strike, props.spot), false)}
                </span>
              </div>
              <Text
                size="xs"
                span
                fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
                title={
                  flowSuffix !== "—"
                    ? `${flowLabelText} · vol ${volText} · prem ${fmtPremChange(row.prem_chg_5m)} · fuel ${view.fuelScore}${partsTitle}`
                    : undefined
                }
                data-testid={`nifty-walls-${props.side.toLowerCase()}-${row.strike}-flow`}
                style={{
                  "font-size": `${REPORT_FONT.micro}px`,
                  "line-height": REPORT_LINE_HEIGHT.tight,
                  color: flowToneColor(flowTone(row.flow)),
                  "font-weight": REPORT_FONT_WEIGHT.bold,
                  "min-width": 0,
                }}
              >
                {flowSuffix}
              </Text>
            </div>
            <div
              title={`Old ${fmtOI(row.oi_open)} → new ${fmtOI(row.oi)}`}
              style={{
                position: "relative",
                "min-width": 0,
                "align-self": "stretch",
                display: "flex",
                "align-items": "center",
                "justify-content": "flex-end",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  "height": "2px",
                  "background-color": palette.SURFACE,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (row.oi / maxOi()) * 100)}%`,
                    height: "100%",
                    "background-color": color,
                    opacity: 0.55,
                    transition: "width 280ms cubic-bezier(.22,1,.36,1)",
                  }}
                />
              </div>
              <Text
                size="sm"
                span
                style={{
                  "font-size": `${REPORT_FONT.sm}px`,
                  "line-height": REPORT_LINE_HEIGHT.snug,
                  "text-align": "right",
                  "font-variant-numeric": "tabular-nums",
                  color: palette.TEXT_COLOR,
                }}
              >
                {fmtOI(row.oi)}
              </Text>
            </div>
            <Text
              size="sm"
              span
              title={`Old ${fmtOI(row.oi_open)} → new ${fmtOI(row.oi)} · ${fmtPct(row.new_oi_pct)} of old book`}
              style={{
                "font-size": `${REPORT_FONT.sm}px`,
                "line-height": REPORT_LINE_HEIGHT.snug,
                "text-align": "right",
                "font-variant-numeric": "tabular-nums",
                color: erosionColor(row.new_oi),
                "background-color": newOiTint(row.new_oi, props.rows),
                "border-radius": `${REPORT_RADIUS.sm}px`,
                "padding-left": `${REPORT_PAD.xs}px`,
                "padding-right": `${REPORT_PAD.xs}px`,
                transition: "background-color 220ms ease",
              }}
            >
              {fmtSignedOI(row.new_oi)}
            </Text>
            <Text
              size="sm"
              span
              title={row.erosion_5m != null ? `5m erosion ${fmtPct(row.erosion_5m)} · 30m rate ${fmtRate(row.erosion_rate_30m)}` : undefined}
              style={{
                "font-size": `${REPORT_FONT.sm}px`,
                "line-height": REPORT_LINE_HEIGHT.snug,
                "text-align": "right",
                color: cellColor,
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {fmtPct(row.erosion_5m)}
            </Text>
            <Text
              size="sm"
              span
              title={`30m erosion ${fmtPct(row.erosion_30m)} · rate ${fmtRate(row.erosion_rate_30m)} · prem ${fmtPremChange(row.prem_chg_5m)}`}
              style={{
                "font-size": `${REPORT_FONT.sm}px`,
                "line-height": REPORT_LINE_HEIGHT.snug,
                "text-align": "right",
                color: cellColor,
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {fmtPct(row.erosion_30m)}
            </Text>
            <Text
              size="sm"
              span
              style={{
                "font-size": `${REPORT_FONT.sm}px`,
                "line-height": REPORT_LINE_HEIGHT.snug,
                "text-align": "right",
                color: palette.TEXT_MUTED,
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {dist(row.distance_pct)}
            </Text>
          </div>
        );
      }}</For>
    </div>
  );
}

function SequenceLine(props: { events: WallsEvent[] }) {
  const recent = () => props.events.slice(-3);
  const hidden = () => props.events.length - recent().length;
  const firstBreakAt = () => firstBreakEvent(props.events)?.at;
  return (
    <div class="flex items-center gap-[8px] min-w-0 overflow-hidden" style={{ "margin-left": `${REPORT_PAD.sm}px` }}>
      <Text
        size="xs"
        span
        fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
        style={{
          "font-size": `${REPORT_FONT.micro}px`,
          color: palette.TEXT_MUTED,
          "letter-spacing": REPORT_LETTER_SPACING.wider,
          "flex-shrink": 0,
        }}
      >
        SEQ
      </Text>
      <Show when={hidden() > 0}>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED, "flex-shrink": 0 }}>
          +{hidden()}
        </Text>
      </Show>
      <For each={recent()}>{(event) => {
        const isBreak = event.kind === "BREAK";
        const isFirst = isBreak && event.at === firstBreakAt();
        return (
          <div
            data-wall-anim=""
            class="flex items-center gap-[4px] shrink-0"
            style={{
              display: "flex",
              "align-items": "center",
              gap: `${REPORT_PAD.xs}px`,
              "flex-shrink": 0,
              animation: "wall-event-in 160ms cubic-bezier(.22,1,.36,1)",
            }}
          >
            <div class="w-[4px] h-[4px] rounded-full shrink-0" style={{ "background-color": isBreak ? palette.NEGATIVE : palette.WARNING }} />
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.micro}px`,
                color: isBreak ? palette.NEGATIVE : palette.TEXT_MUTED,
                "font-variant-numeric": "tabular-nums",
              }}
            >
              {event.at.slice(11, 16)}
            </Text>
            <Text
              size="xs"
              span
              fw={isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium}
              style={{
                "font-size": `${REPORT_FONT.xsPlus}px`,
                "font-weight": isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
                color: isBreak ? palette.NEGATIVE : palette.TEXT_MUTED,
              }}
            >
              {isBreak ? (isFirst ? "BREAK" : "RE-BRK") : "TOUCH"}
            </Text>
          </div>
        );
      }}</For>
    </div>
  );
}

function MiniHistory(props: { walls: WallsPayload }) {
  const callValues = () => props.walls.history.map((point) => point.call_oi ?? null);
  const putValues = () => props.walls.history.map((point) => point.put_oi ?? null);
  const first = () => props.walls.history[0];
  const last = () => props.walls.history[props.walls.history.length - 1];
  return (
    <div class="min-w-0">
      <div class="flex items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
          }}
        >
          TRACKED WALL {fmtNum(props.walls.call_wall.strike)} · LAST {props.walls.window_min}m
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>
          {first()?.t?.slice(11, 16)} → {last()?.t?.slice(11, 16)}
        </Text>
      </div>
      <div class="flex items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between", "margin-top": `${REPORT_PAD.xs}px` }}>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>call OI · 30m Δ</Text>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.xs}px`,
            "font-weight": REPORT_FONT_WEIGHT.bold,
            color: erosionColor(props.walls.tracked_call_erosion_30m),
          }}
        >
          {fmtPct(props.walls.tracked_call_erosion_30m)}
        </Text>
      </div>
      <Sparkline values={callValues()} width={420} height={18} color={palette.NEGATIVE} testId="walls-card-call-spark" animate responsive />
      <div class="flex items-center justify-between" style={{ "align-items": "center", "justify-content": "space-between" }}>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>put OI · 30m Δ</Text>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.xs}px`,
            "font-weight": REPORT_FONT_WEIGHT.bold,
            color: erosionColor(props.walls.tracked_put_build_30m),
          }}
        >
          {fmtPct(props.walls.tracked_put_build_30m)}
        </Text>
      </div>
      <Sparkline values={putValues()} width={420} height={18} color={palette.POSITIVE} testId="walls-card-put-spark" animate responsive />
    </div>
  );
}

/** Muted placeholder block used by the null-payload skeleton. */
function SkeletonBar(props: { height: number; width?: number | string }) {
  return (
    <div
      style={{
        height: `${props.height}px`,
        width: typeof props.width === "number" ? `${props.width}px` : props.width ?? "100%",
        "border-radius": `${REPORT_RADIUS.sm}px`,
        "background-color": palette.SURFACE_ALT,
      }}
    />
  );
}

/** Mirrors the `Stat` block (label over value) so the reserved stats column
 *  keeps the height of the live one. */
function SkeletonStat() {
  return (
    <div class="min-w-0 py-[2px]">
      <SkeletonBar height={11} width="42%" />
      <SkeletonBar height={15} width="68%" />
    </div>
  );
}

/** The levels rows live inside this card in both states — dropping them on a
 *  null payload would change the card height by the levels band. */
function WallsLevelsBlock(props: { levels?: JSX.Element }) {
  if (!props.levels) return null;
  return (
    <div
      style={{
        "border-top": `1px solid ${palette.BORDER}`,
        "padding-top": `${REPORT_PAD.sm}px`,
        "min-width": 0,
      }}
    >
      {props.levels}
    </div>
  );
}

/** Null-payload skeleton: same bands, same row counts and the same reserved
 *  heights as the populated card, so the one-page Index Report never reflows
 *  when the walls payload arrives.
 *
 *  Height budget: the CALL/PUT tables are the tallest band (~21px header +
 *  3 rows of ~31px ≈ 114px) and both states render exactly three rows per
 *  side, so the skeleton body lands on the same height as the populated one.
 *  The READ/SEQ and tracked-history bands are reserved at 96px so they can
 *  never collapse below the live bands. */
function WallsSkeleton(props: { emptyText: string }) {
  return (
    <div
      data-testid="nifty-walls-skeleton"
      class="grid gap-[8px] p-[8px] items-start"
      style={{
        display: "grid",
        "grid-template-columns": "minmax(0,1fr)",
        gap: `${REPORT_PAD.sm}px`,
        padding: `${REPORT_PAD.sm}px`,
        "align-items": "start",
      }}
    >
      <div data-testid="nifty-walls-skeleton-strip" class="min-w-0">
        <div class="flex items-center flex-wrap gap-2" style={{ "align-items": "center", "flex-wrap": "wrap", "row-gap": `${REPORT_PAD.xs}px` }}>
          <SkeletonBar height={18} width={64} />
          <SkeletonBar height={12} width={46} />
          <SkeletonBar height={12} width={108} />
        </div>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "1fr 1fr",
            "column-gap": `${REPORT_PAD.md}px`,
            "row-gap": `${REPORT_PAD.xs}px`,
            "margin-top": `${REPORT_PAD.sm}px`,
          }}
        >
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </div>
        <Text
          size="xs"
          span
          style={{
            "font-size": `${REPORT_FONT.xs}px`,
            color: palette.TEXT_MUTED,
            "margin-top": `${REPORT_PAD.xs}px`,
          }}
        >
          {props.emptyText}
        </Text>
      </div>

      <WallTable side="CALL" rows={[]} spot={0} />
      <WallTable side="PUT" rows={[]} spot={0} />

      <div
        data-testid="nifty-walls-skeleton-read"
        style={{
          "min-height": `${WALLS_RESERVED_H}px`,
          "min-width": 0,
          "border-left": `1px solid ${palette.BORDER}`,
          "padding-left": `${REPORT_PAD.sm}px`,
          display: "flex",
          "flex-direction": "column",
          gap: `${REPORT_PAD.xs}px`,
        }}
      >
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            "letter-spacing": REPORT_LETTER_SPACING.wider,
          }}
        >
          READ
        </Text>
        <SkeletonBar height={10} width="92%" />
        <SkeletonBar height={10} width="76%" />
        <SkeletonBar height={10} width="84%" />
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color: palette.TEXT_MUTED,
            "letter-spacing": REPORT_LETTER_SPACING.wider,
            "margin-top": `${REPORT_PAD.sm}px`,
          }}
        >
          SEQ
        </Text>
        <SkeletonBar height={10} width="60%" />
      </div>

      <div
        data-testid="nifty-walls-skeleton-history"
        style={{
          "min-height": `${WALLS_RESERVED_H}px`,
          "min-width": 0,
          display: "flex",
          "flex-direction": "column",
          gap: `${REPORT_PAD.xs}px`,
        }}
      >
        <SkeletonBar height={11} width="58%" />
        <SkeletonBar height={10} width="34%" />
        <SkeletonBar height={18} />
        <SkeletonBar height={10} width="34%" />
        <SkeletonBar height={18} />
      </div>
    </div>
  );
}

export function NiftyWallsCardInner(props: {
  walls: WallsPayload | null;
  onExpand: () => void;
  /** Opens the deeper pressure desk (phase plane + selected-wall path). */
  onOpenDesk?: () => void;
  emptyText?: string;
  /** Optional dense levels rows (e.g. LevelsInPlayContent) rendered inside
   *  this same card, after the walls grid. */
  levels?: JSX.Element;
}) {
  const walls = () => props.walls;
  const [dismissed, setDismissed] = createSignal<string | null>(null);

  // One alert per wall per cooldown: the backend latches `alert.at` to the
  // first break of the run; localStorage makes the dismiss survive reloads
  // and suppresses a re-break inside the same 15-minute window.
  createEffect(() => {
    const currentWalls = walls();
    if (!currentWalls?.alert) return;
    const alert = currentWalls.alert;
    const key = `walls.alert.v1.${currentWalls.symbol}.${currentWalls.date}.${alert.wall}`;
    try {
      const stored = window.localStorage.getItem(key);
      if (!stored) return;
      const storedAt = Date.parse(stored);
      const at = Date.parse(alert.at);
      if (
        storedAt === at ||
        (Number.isFinite(at) &&
          Number.isFinite(storedAt) &&
          at - storedAt < alert.cooldown_min * 60_000)
      ) {
        setDismissed(alert.at);
      }
    } catch {
      /* localStorage can be blocked; the in-memory dismiss still works */
    }
  });

  if (!walls()) {
    return (
      <LocalCompactPanel title="WALLS" testId="nifty-walls-card" flush>
        <WallsSkeleton emptyText={props.emptyText ?? "No walls data."} />
        <WallsLevelsBlock levels={props.levels} />
      </LocalCompactPanel>
    );
  }
  const stateColor = () => STATE_COLOR[walls()!.state] ?? palette.TEXT_MUTED;
  const alert = () => walls()!.alert;
  const showAlert = () => Boolean(alert() && walls()!.alert_eligible && dismissed() !== alert()!.at);
  const events = () => walls()!.events ?? [];
  const firstBreak = () => firstBreakEvent(events()) ?? null;
  const lastBreak = () => lastBreakEvent(events()) ?? null;
  const breakEvent = () => firstBreak() ?? lastBreak();
  const dteLabel = () => formatDte(walls()!.dte);
  const pinColor = () =>
    Math.abs(walls()!.pin_distance_pct) <= 0.15 ? palette.PRIMARY : palette.TEXT_MUTED;
  const dismiss = (at: string, wall: number) => {
    setDismissed(at);
    const currentWalls = walls();
    if (!currentWalls) return;
    try {
      window.localStorage.setItem(
        `walls.alert.v1.${currentWalls.symbol}.${currentWalls.date}.${wall}`,
        at,
      );
    } catch {
      /* ignore */
    }
  };

  return (
    <LocalCompactPanel
      title="WALLS"
      testId="nifty-walls-card"
      action={
        <div class="flex items-center gap-1">
          {props.onOpenDesk ? (
            <Button
              size="xs"
              variant="outline"
              data-testid="nifty-walls-desk"
              onClick={props.onOpenDesk}
              className="min-w-0"
              style={{
                "padding-left": `${REPORT_PAD.sm}px`,
                "padding-right": `${REPORT_PAD.sm}px`,
                "min-width": 0,
                "font-size": `${REPORT_FONT.micro}px`,
              }}
            >
              DESK
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            onClick={props.onExpand}
            className="min-w-0"
            style={{
              "padding-left": `${REPORT_PAD.sm}px`,
              "padding-right": `${REPORT_PAD.sm}px`,
              "min-width": 0,
              "font-size": `${REPORT_FONT.micro}px`,
            }}
          >
            EXPAND
          </Button>
        </div>
      }
      style={{ "border-top": "none" }}
    >
      <div
        // The five-column band is the point of this card: at the xs variant it
        // stacked CALL/PUT/READ/history into one column and grew to 475px,
        // which pushed the chart below the fold. Media query, not inline style,
        // so the wide layout actually wins at desk width.
        class="grid items-start gap-[8px] p-[8px] grid-cols-1 min-[1100px]:grid-cols-[250px_1fr_1fr_minmax(280px,1fr)_minmax(120px,1fr)]"
        data-testid="nifty-walls-grid"
      >
        <div class="min-w-0">
          <div class="flex items-center flex-wrap gap-2" style={{ "align-items": "center", "flex-wrap": "wrap", "row-gap": `${REPORT_PAD.xs}px` }}>
            <Badge
              size="xs"
              variant="outline"
              color={stateColor()}
              className="min-w-0"
              style={{
                "height": "18px",
                "font-size": `${REPORT_FONT.xs}px`,
                "font-weight": REPORT_FONT_WEIGHT.extrabold,
                "letter-spacing": REPORT_LETTER_SPACING.wide,
                color: stateColor(),
                "background-color": "transparent",
                border: `1px solid ${stateColor()}`,
                "padding-left": `${REPORT_PAD.xs}px`,
                "padding-right": `${REPORT_PAD.xs}px`,
              }}
            >
              {walls()!.state.replace("_", " ")}
            </Badge>
            {dteLabel() && (
              <Text
                size="xs"
                span
                fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
                style={{
                  "font-size": `${REPORT_FONT.xs}px`,
                  "font-weight": REPORT_FONT_WEIGHT.bold,
                  color: walls()!.expiry_day ? palette.WARNING : palette.TEXT_MUTED,
                  "white-space": "nowrap",
                }}
              >
                {dteLabel()}
              </Text>
            )}
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.xs}px`,
                color: palette.TEXT_MUTED,
                "white-space": "nowrap",
              }}
            >
              {walls()!.expiry ?? "—"} · tape {walls()!.freshness.last_t.slice(11, 16)}
            </Text>
            {walls()!.freshness.stale && (
              <Badge
                size="xs"
                variant="outline"
                color="warning"
                className="min-w-0"
                style={{
                  "height": "17px",
                  "font-size": `${REPORT_FONT.xs}px`,
                  color: palette.WARNING,
                  "background-color": "transparent",
                  border: `1px solid ${palette.WARNING}`,
                  "padding-left": `${REPORT_PAD.xs}px`,
                  "padding-right": `${REPORT_PAD.xs}px`,
                }}
              >
                STALE
              </Badge>
            )}
          </div>

          <div
            style={{
              display: "grid",
              "grid-template-columns": "1fr 1fr",
              "column-gap": `${REPORT_PAD.md}px`,
              "row-gap": `${REPORT_PAD.xs}px`,
              "margin-top": `${REPORT_PAD.sm}px`,
            }}
          >
            <Stat label="SPOT" value={fmtNum(walls()!.spot, 2)} />
            <Stat label="MAX PAIN" value={fmtNum(walls()!.max_pain)} />
            <Stat
              label="PIN"
              value={`${walls()!.pin_distance_pts > 0 ? "+" : ""}${fmtNum(walls()!.pin_distance_pts, 0)} (${walls()!.pin_distance_pct.toFixed(2)}%)`}
              color={pinColor()}
            />
            <Stat
              label="GEX"
              value={walls()!.gex_degraded ? "n/a" : fmtNum(walls()!.net_gex, 1)}
              color={walls()!.gex_degraded ? palette.TEXT_MUTED : palette.TEXT_COLOR}
            />
          </div>

        </div>

        <WallTable side="CALL" rows={walls()!.calls} spot={walls()!.spot} />
        <WallTable side="PUT" rows={walls()!.puts} spot={walls()!.spot} />

        <div
          style={{
            "min-width": 0,
            display: "grid",
            "grid-template-columns": "minmax(0,1.15fr) minmax(0,1fr)",
            gap: `${REPORT_PAD.md}px`,
          }}
        >
          <div style={{ "min-width": 0, display: "flex", "flex-direction": "column", gap: `${REPORT_PAD.sm}px` }}>
            {showAlert() && alert() ? (
              <div
                data-testid="nifty-walls-alert"
                data-wall-anim=""
                style={{
                  "border-left": `3px solid ${palette.NEGATIVE}`,
                  "background-color": palette.SURFACE_ALT,
                  "padding-left": `${REPORT_PAD.sm}px`,
                  "padding-top": `${REPORT_PAD.xs}px`,
                  "padding-bottom": `${REPORT_PAD.xs}px`,
                  animation: "wall-alert-in 180ms cubic-bezier(.22,1,.36,1)",
                }}
              >
                <div class="flex items-center justify-between gap-2" style={{ "align-items": "center", "justify-content": "space-between", gap: `${REPORT_PAD.sm}px` }}>
                  <Text
                    size="xs"
                    span
                    fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                    style={{
                      "font-size": `${REPORT_FONT.xs}px`,
                      "font-weight": REPORT_FONT_WEIGHT.extrabold,
                      color: palette.NEGATIVE,
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                    }}
                  >
                    WALL BREAK · {fmtNum(alert()!.wall)} · {fmtNum(alert()!.spot, 1)}
                  </Text>
                  <Button
                    size="xs"
                    variant="filled"
                    onClick={() => dismiss(alert()!.at, alert()!.wall)}
                    className="min-w-0 shrink-0"
                    style={{
                      "min-width": 0,
                      "padding-left": `${REPORT_PAD.xs}px`,
                      "padding-right": `${REPORT_PAD.xs}px`,
                      "font-size": `${REPORT_FONT.micro}px`,
                      color: palette.TEXT_MUTED,
                      "flex-shrink": 0,
                    }}
                  >
                    dismiss
                  </Button>
                </div>
                <Text
                  size="xs"
                  span
                  style={{
                    "font-size": `${REPORT_FONT.xsPlus}px`,
                    "line-height": REPORT_LINE_HEIGHT.relaxed,
                    color: palette.TEXT_MUTED,
                  }}
                >
                  call {fmtPct(alert()!.erosion_30m)} · put {fmtPct(alert()!.put_build_30m)} · {alert()!.at.slice(11, 19)}
                </Text>
              </div>
            ) : breakEvent() ? (
              <div style={{ "padding-left": `${REPORT_PAD.sm}px`, "border-left": `2px solid ${palette.NEGATIVE}`, display: "flex", "flex-direction": "column", gap: `${REPORT_PAD.xs}px` }}>
                <div class="flex items-center flex-wrap gap-2" style={{ "align-items": "center", "flex-wrap": "wrap", "row-gap": `${REPORT_PAD.xs}px` }}>
                  <Text
                    size="xs"
                    span
                    fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                    style={{
                      "font-size": `${REPORT_FONT.micro}px`,
                      "font-weight": REPORT_FONT_WEIGHT.extrabold,
                      color: palette.TEXT_MUTED,
                      "letter-spacing": REPORT_LETTER_SPACING.wide,
                    }}
                  >
                    FIRST BREAK
                  </Text>
                  <Text
                    size="xs"
                    span
                    fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                    className="tabular-nums"
                    style={{
                      "font-size": `${REPORT_FONT.xs}px`,
                      "font-weight": REPORT_FONT_WEIGHT.extrabold,
                      color: palette.NEGATIVE,
                      "font-variant-numeric": "tabular-nums",
                    }}
                  >
                    {breakEvent()!.at.slice(11, 19)} · {fmtNum(breakEvent()!.wall)}
                  </Text>
                  <Text
                    size="xs"
                    span
                    style={{
                      "font-size": `${REPORT_FONT.xsPlus}px`,
                      color: palette.TEXT_MUTED,
                    }}
                  >
                    call {fmtPct(breakEvent()!.erosion_30m)} · put {fmtPct(breakEvent()!.put_build_30m)}
                  </Text>
                </div>
                {lastBreak() && lastBreak()!.at !== breakEvent()!.at && (
                  <div class="flex items-center flex-wrap gap-2" style={{ "align-items": "center", "flex-wrap": "wrap", "row-gap": `${REPORT_PAD.xs}px` }}>
                    <Text
                      size="xs"
                      span
                      fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
                      style={{
                        "font-size": `${REPORT_FONT.micro}px`,
                        "font-weight": REPORT_FONT_WEIGHT.extrabold,
                        color: palette.WARNING,
                        "letter-spacing": REPORT_LETTER_SPACING.wide,
                      }}
                    >
                      RE-BROKE
                    </Text>
                    <Text
                      size="xs"
                      span
                      fw={REPORT_FONT_WEIGHT.bold as "normal" | "medium" | "semibold" | "bold" | number}
                      className="tabular-nums"
                      style={{
                        "font-size": `${REPORT_FONT.xs}px`,
                        "font-weight": REPORT_FONT_WEIGHT.bold,
                        color: palette.WARNING,
                        "font-variant-numeric": "tabular-nums",
                      }}
                    >
                      {lastBreak()!.at.slice(11, 19)} · {fmtNum(lastBreak()!.wall)}
                    </Text>
                    <Text
                      size="xs"
                      span
                      style={{
                        "font-size": `${REPORT_FONT.xsPlus}px`,
                        color: palette.TEXT_MUTED,
                      }}
                    >
                      call {fmtPct(lastBreak()!.erosion_30m)} · put {fmtPct(lastBreak()!.put_build_30m)}
                    </Text>
                  </div>
                )}
              </div>
            ) : walls()!.expiry_day ? (
              <Text
                size="xs"
                span
                style={{
                  "font-size": `${REPORT_FONT.xs}px`,
                  "line-height": REPORT_LINE_HEIGHT.relaxed,
                  color: palette.TEXT_MUTED,
                }}
              >
                No confirmed break in the window.
              </Text>
            ) : null}
            <SequenceLine events={events()} />
          </div>

          <div style={{ "min-width": 0, "border-left": `1px solid ${palette.BORDER}`, "padding-left": `${REPORT_PAD.sm}px` }}>
            <Text
              size="xs"
              span
              fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
              style={{
                "font-size": `${REPORT_FONT.micro}px`,
                "font-weight": REPORT_FONT_WEIGHT.extrabold,
                color: palette.TEXT_MUTED,
                "letter-spacing": REPORT_LETTER_SPACING.wider,
              }}
            >
              READ
            </Text>
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.xsPlus}px`,
                "line-height": REPORT_LINE_HEIGHT.relaxed,
                color: palette.TEXT_MUTED,
                "margin-top": `${REPORT_PAD.xs}px`,
              }}
            >
              {walls()!.reasons.slice(0, 4).join(" · ")}
            </Text>
            <Text
              size="xs"
              span
              style={{
                "font-size": `${REPORT_FONT.xsPlus}px`,
                "line-height": REPORT_LINE_HEIGHT.relaxed,
                color: palette.TEXT_MUTED,
                "margin-top": `${REPORT_PAD.sm}px`,
              }}
            >
              {walls()!.expiry_day ? "break = erosion + put floor" : "Non-expiry: positioning, not gamma"}
            </Text>
          </div>
        </div>

        <MiniHistory walls={walls()!} />
      </div>
      <WallsLevelsBlock levels={props.levels} />
    </LocalCompactPanel>
  );
}

export const NiftyWallsCard = NiftyWallsCardInner;
