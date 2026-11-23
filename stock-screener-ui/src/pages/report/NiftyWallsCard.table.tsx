import { createMemo, For, Show } from "solid-js";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { WallsRow } from "@/api/reportNifty";
import {
  dist,
  erosionColor,
  flowLabel,
  flowTone,
  fmtNum,
  fmtOI,
  fmtPct,
  fmtPremChange,
  fmtRate,
  fmtSignedOI,
  fmtVolMult,
  newOiTint,
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
import {
  WALLS_ROWS,
  WALLS_HEADINGS,
  WALLS_GRID_COLS,
  WALLS_MIN_W,
  wallFuelColor,
  flowToneColor,
} from "./NiftyWallsCard.shared";

/** A reserved row slot: same grid, same two-line strike cell and the same
 *  row height as a live row, so the table never shrinks. */
export function WallPlaceholderRow(props: { side: "CALL" | "PUT" }) {
  return (
    <div
      data-testid={`nifty-walls-${props.side.toLowerCase()}-placeholder`}
      data-placeholder="true"
      data-wall-row="true"
      class={`grid ${WALLS_GRID_COLS} gap-[4px] items-center pl-[8px] ${WALLS_MIN_W}`}
      style={{
        "column-gap": `${REPORT_PAD.sm}px`,
        "padding-top": `${REPORT_PAD.sm}px`,
        "padding-bottom": `${REPORT_PAD.sm}px`,
        "padding-left": `${REPORT_PAD.sm}px`,
        "min-height": `${REPORT_ROW.comfortable}px`,
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

export function WallTable(props: { side: "CALL" | "PUT"; rows: WallsRow[]; spot: number }) {
  const color = props.side === "CALL" ? palette.LEVEL_CALL_WALL : palette.LEVEL_PUT_WALL;
  // OI is side-coded (CE blue / PE orange), never bullish/bearish — the wall
  // colour above is for the level, not the size of its open interest.
  const oiBarColor = props.side === "CALL" ? palette.OI_CALL : palette.OI_PUT;
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
      <div data-testid={`nifty-walls-${sideKey}-scroll`} class="w-full min-w-0 overflow-x-auto">
      <div class="w-max min-w-full">
      <div
        class={`grid ${WALLS_GRID_COLS} gap-[4px] ${WALLS_MIN_W}`}
        style={{
          "column-gap": `${REPORT_PAD.sm}px`,
          "border-bottom": `1px solid ${palette.alpha(palette.BORDER, 0.6)}`,
          "padding-bottom": `${REPORT_PAD.sm}px`,
          "margin-bottom": `${REPORT_PAD.sm}px`,
        }}
      >
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
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
              "font-size": `${REPORT_FONT.micro}px`,
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
            class={`grid ${WALLS_GRID_COLS} gap-[4px] items-center pl-[8px] ${WALLS_MIN_W}`}
            style={{
              "column-gap": `${REPORT_PAD.sm}px`,
              "align-items": "center",
              "padding-top": `${REPORT_PAD.sm}px`,
              "padding-bottom": `${REPORT_PAD.sm}px`,
              "padding-left": `${REPORT_PAD.sm}px`,
              "min-height": `${REPORT_ROW.comfortable}px`,
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
                      "font-size": `${REPORT_FONT.body}px`,
                      "font-weight": REPORT_FONT_WEIGHT.extrabold,
                      color: cellColor,
                      "margin-left": `${REPORT_PAD.xs}px`,
                      "flex-shrink": 0,
                    }}
                  >
                    {view.arrow}
                  </Text>
                </Show>
                <span style={{ "font-size": `${REPORT_FONT.body}px`, "margin-left": "3px", color: palette.TEXT_MUTED }}>
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
                  "font-size": `${REPORT_FONT.body}px`,
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
                    "background-color": oiBarColor,
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
      </div>
      <div
        data-testid={`nifty-walls-${sideKey}-scroll-cue`}
        class="text-ui-micro text-fin-text-muted mt-1 min-[520px]:hidden"
      >
        scroll → for 5m · 30m · DIST
      </div>
    </div>
  );
}
