import { For } from "solid-js";
import { Box, Text } from "@/ui";
import type { WallsEvent, WallsRow } from "@/api/reportNifty";
import * as palette from "@/ui/palette";
import { wallCode, wallSide } from "./niftyChartMath";
import {
  dist,
  erosionColor,
  firstBreakEvent,
  fmtNum,
  fmtOI,
  fmtPct,
  fmtSignedOI,
  newOiTint,
  wallsMaxOi,
} from "./niftyWallsFormat";
import { wallsEventLabel } from "./NiftyWallsExpanded.format";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_ROW,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

/** Expanded tables use 12px headers, 13px values and a fixed min width so a
 *  narrow viewport scrolls instead of squeezing a number out of its cell. */
const TABLE_CELL_PAD = `${REPORT_PAD.sm}px ${REPORT_PAD.md}px`;
const EXPANDED_ROW_H = REPORT_ROW.comfortable;
const TABLE_MIN_W = "min-w-[720px]";

function ErosionBar(props: { value: number | null | undefined }) {
  if (props.value == null) return null;
  const width = Math.min(100, Math.abs(props.value) * 500);
  return (
    <div style={{ width: "100%", "height": "4px", "background-color": palette.SURFACE, overflow: "hidden" }}>
      <div
        style={{
          width: `${width}%`,
          height: "100%",
          "background-color": erosionColor(props.value),
          "margin-left": props.value < 0 ? "auto" : 0,
          transition: "width 280ms cubic-bezier(.22,1,.36,1)",
        }}
      />
    </div>
  );
}

export function WallsTable(props: { title: string; side: "CALL" | "PUT"; rows: WallsRow[]; spot: number }) {
  const color = props.side === "CALL" ? palette.NEGATIVE : palette.POSITIVE;
  const maxOi = wallsMaxOi(props.rows);
  return (
    <div data-testid={`walls-table-${props.side.toLowerCase()}`} class="min-w-0">
      <div class="items-center" style={{ "margin-bottom": `${REPORT_PAD.sm}px`, "align-items": "center" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            color,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
          }}
        >
          {props.title}
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>top {props.rows.length} by OI</Text>
      </div>
      <div
        data-testid={`walls-table-${props.side.toLowerCase()}-scroll`}
        class="w-full min-w-0 overflow-x-auto"
      >
        <div class={TABLE_MIN_W}>
          <Box
            component="table"
            style={{
              width: "100%",
              "table-layout": "fixed",
              "border-collapse": "collapse",
              "font-size": `${REPORT_FONT.sm}px`,
              "font-variant-numeric": "tabular-nums",
            }}
          >
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr style={{ color: palette.TEXT_MUTED, height: `${EXPANDED_ROW_H}px`, "font-size": `${REPORT_FONT.micro}px` }}>
                <th align="left" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>Strike</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>OI</th>
                <th align="right" title="New OI since session open" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>NEW</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>5m</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>30m Δ</th>
                <th align="left" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>erosion</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>dist</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.rows}>{(row) => {
                const ws = wallSide(row.strike, props.spot);
                const tag = wallCode(props.side === "CALL", ws, false);
                return (
                  <tr
                    style={{
                      background: row.tracked ? palette.SURFACE_ALT : "transparent",
                      "font-weight": row.tracked ? 700 : 400,
                      "border-top": `1px solid ${palette.BORDER}`,
                      height: `${EXPANDED_ROW_H}px`,
                      transition: "background-color 180ms ease",
                    }}
                  >
                    <td
                      style={{
                        padding: TABLE_CELL_PAD,
                        color: row.tracked ? color : palette.TEXT_COLOR,
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                        "white-space": "nowrap",
                      }}
                    >
                      {fmtNum(row.strike)}
                      <span style={{ "font-size": `${REPORT_FONT.micro}px`, "margin-left": "3px", color: palette.TEXT_MUTED }}>{tag}</span>
                      {row.tracked ? (
                        <span style={{ "font-size": `${REPORT_FONT.micro}px`, "margin-left": "3px", color: palette.TEXT_MUTED }}>TRACKED</span>
                      ) : null}
                    </td>
                    <td
                      align="right"
                      title={`Old ${fmtOI(row.oi_open ?? 0)} → new ${fmtOI(row.oi)}`}
                      style={{ padding: TABLE_CELL_PAD, position: "relative" }}
                    >
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          "left": "4px",
                          "right": "4px",
                          "bottom": "1px",
                          "height": "2px",
                          background: palette.SURFACE,
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            width: `${Math.min(100, (row.oi / maxOi) * 100)}%`,
                            height: "100%",
                            background: color,
                            opacity: 0.55,
                            transition: "width 280ms cubic-bezier(.22,1,.36,1)",
                          }}
                        />
                      </span>
                      {fmtOI(row.oi)}
                    </td>
                    <td
                      align="right"
                      title={`Old ${fmtOI(row.oi_open ?? 0)} → new ${fmtOI(row.oi)} · ${fmtPct(row.new_oi_pct)} of old book`}
                      style={{
                        padding: TABLE_CELL_PAD,
                        color: erosionColor(row.new_oi),
                        "background-color": newOiTint(row.new_oi, props.rows),
                        transition: "background-color 220ms ease",
                      }}
                    >
                      {fmtSignedOI(row.new_oi)}
                    </td>
                    <td align="right" style={{ padding: TABLE_CELL_PAD, color: erosionColor(row.erosion_5m) }}>{fmtPct(row.erosion_5m)}</td>
                    <td align="right" style={{ padding: TABLE_CELL_PAD, color: erosionColor(row.erosion_30m) }}>{fmtPct(row.erosion_30m)}</td>
                    <td style={{ padding: TABLE_CELL_PAD }}><ErosionBar value={row.erosion_30m} /></td>
                    <td align="right" style={{ padding: TABLE_CELL_PAD, color: palette.TEXT_MUTED }}>{dist(row.distance_pct)}</td>
                  </tr>
                );
              }}</For>
            </tbody>
          </Box>
        </div>
      </div>
      <div
        data-testid={`walls-table-${props.side.toLowerCase()}-scroll-cue`}
        class="text-ui-micro text-fin-text-muted mt-1 min-[720px]:hidden"
      >
        scroll → for all seven columns
      </div>
    </div>
  );
}

export function WallsSequenceTable(props: { events: WallsEvent[] }) {
  const recent = () => props.events.slice(-10);
  const hidden = () => props.events.length - recent().length;
  const firstBreakAt = () => firstBreakEvent(props.events)?.at;
  return (
    <div data-testid="walls-events" class="min-w-0">
      <div class="items-center justify-between" style={{ "margin-bottom": `${REPORT_PAD.sm}px`, "align-items": "center", "justify-content": "space-between" }}>
        <Text
          size="xs"
          span
          fw={REPORT_FONT_WEIGHT.extrabold as "normal" | "medium" | "semibold" | "bold" | number}
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.extrabold,
            "letter-spacing": REPORT_LETTER_SPACING.wide,
            color: palette.TEXT_COLOR,
          }}
        >
          SEQUENCE · {props.events.length} events
        </Text>
        <Text size="xs" span style={{ color: palette.TEXT_MUTED }}>touch → break · last 10</Text>
      </div>
      <div data-testid="walls-events-scroll" class="w-full min-w-0 overflow-x-auto">
        <div class={TABLE_MIN_W}>
          <Box
            component="table"
            style={{
              width: "100%",
              "table-layout": "fixed",
              "border-collapse": "collapse",
              "font-size": `${REPORT_FONT.sm}px`,
              "font-variant-numeric": "tabular-nums",
            }}
          >
            <colgroup>
              <col style={{ width: "11%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "17%" }} />
            </colgroup>
            <thead>
              <tr style={{ color: palette.TEXT_MUTED, height: `${EXPANDED_ROW_H}px`, "font-size": `${REPORT_FONT.micro}px` }}>
                <th align="left" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>Time</th>
                <th align="left" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>Event</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>Wall</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>Call Δ30m</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>Put Δ30m</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>Spot</th>
                <th align="right" style={{ "font-weight": 500, padding: TABLE_CELL_PAD }}>Max pain</th>
              </tr>
            </thead>
            <tbody>
              <For each={recent()}>{(event) => {
                const isBreak = event.kind === "BREAK";
                const isFirst = isBreak && event.at === firstBreakAt();
                return (
                  <tr
                    style={{
                      background: isBreak ? palette.SURFACE_ALT : "transparent",
                      "border-top": `1px solid ${palette.BORDER}`,
                      height: `${EXPANDED_ROW_H}px`,
                    }}
                  >
                    <td style={{ padding: TABLE_CELL_PAD, color: palette.TEXT_MUTED }}>{event.at.slice(11, 19)}</td>
                    <td
                      style={{
                        padding: TABLE_CELL_PAD,
                        "font-weight": isBreak ? REPORT_FONT_WEIGHT.extrabold : REPORT_FONT_WEIGHT.medium,
                        color: isBreak ? palette.NEGATIVE : palette.WARNING,
                      }}
                    >
                      {wallsEventLabel(event, isFirst)}
                    </td>
                    <td align="right" style={{ padding: TABLE_CELL_PAD }}>{fmtNum(event.wall)}</td>
                    <td align="right" style={{ padding: TABLE_CELL_PAD, color: erosionColor(event.erosion_30m) }}>
                      {fmtPct(event.erosion_30m)}
                    </td>
                    <td
                      align="right"
                      style={{
                        padding: TABLE_CELL_PAD,
                        color: (event.put_build_30m ?? 0) > 0 ? palette.POSITIVE : palette.TEXT_MUTED,
                      }}
                    >
                      {fmtPct(event.put_build_30m)}
                    </td>
                    <td align="right" style={{ padding: TABLE_CELL_PAD }}>{fmtNum(event.spot, 1)}</td>
                    <td align="right" style={{ padding: TABLE_CELL_PAD, color: palette.TEXT_MUTED }}>{fmtNum(event.max_pain)}</td>
                  </tr>
                );
              }}</For>
            </tbody>
          </Box>
        </div>
      </div>
      <div class="text-ui-micro text-fin-text-muted mt-1 min-[720px]:hidden">
        scroll → for all seven columns
      </div>
      {hidden() > 0 && (
        <Text
          size="xs"
          span
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            color: palette.TEXT_MUTED,
            "margin-top": `${REPORT_PAD.sm}px`,
          }}
        >
          +{hidden()} earlier events in the recorded window
        </Text>
      )}
    </div>
  );
}
