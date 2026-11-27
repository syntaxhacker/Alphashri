import { createMemo, For } from "solid-js";
import * as palette from "@/ui/palette";
import { BORDER, MUTED, MONO, SELECTED, panelTitleStyles } from "./NiftyPressureDesk.format";
import { FuelBar, PanelTitle, SideMark } from "./NiftyPressureDesk.legend";
import { fmtOI, fmtPct } from "./niftyWallsFormat";
import { nearestWall, wallLabel, type PressureWall } from "./pressureDesk";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

interface WallListProps {
  walls: PressureWall[];
  selectedKey: string | null;
  spot: number;
  onSelect: (key: string) => void;
}

export function WallList(props: WallListProps) {
  const view = createMemo(() => [
    { label: "CALLS", rows: props.walls.filter((wall) => wall.side === "CALL") },
    { label: "PUTS", rows: props.walls.filter((wall) => wall.side === "PUT") },
  ]);
  const nearest = createMemo(() => nearestWall(props.walls, props.spot));

  return (
    <div class="min-w-0 flex flex-col h-full">
      <PanelTitle>Walls</PanelTitle>
      <div
        data-report-spacing="8"
        class="grid grid-cols-[minmax(0,1fr)_50px_46px_58px] gap-2 pb-1 border-b border-fin-border font-mono text-ui-micro font-black tracking-[0.08em] text-fin-text-muted uppercase"
        style={{
          display: "grid",
          "grid-template-columns": "minmax(0,1fr) 50px 46px 58px",
          "column-gap": "8px",
          "border-bottom": `1px solid ${BORDER}`,
          "font-family": MONO,
          "font-size": `${REPORT_FONT.micro}px`,
          "font-weight": String(REPORT_FONT_WEIGHT.extrabold),
          "letter-spacing": REPORT_LETTER_SPACING.wide,
          color: MUTED,
          "text-transform": "uppercase",
        }}
      >
        <span>Wall</span>
        <span style={{ "text-align": "right" }}>OI</span>
        <span style={{ "text-align": "right" }}>30m</span>
        <span style={{ "text-align": "right" }}>Fuel</span>
      </div>
      <div class="overflow-auto min-h-0 max-h-[430px]">
        <For each={view()}>{(group) => (
          <div>
            <div
              data-report-text="label"
              class="mb-1"
              style={{ ...panelTitleStyles(), "font-size": `${REPORT_FONT.micro}px`, "margin-top": "8px", "margin-bottom": "4px" }}
            >
              {group.label}
            </div>
            <For each={group.rows}>{(wall) => {
              const selected = wall.key === props.selectedKey;
              const borderLeft = selected ? `2px solid ${SELECTED}` : "2px solid transparent";
              const backgroundColor = selected ? palette.SURFACE_ALT : "transparent";
              return (
                <div
                  role="button"
                  tabIndex={0}
                  data-testid={`pressure-row-${wall.key}`}
                  aria-pressed={selected}
                  onClick={() => props.onSelect(wall.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      props.onSelect(wall.key);
                    }
                  }}
                  class="grid grid-cols-[minmax(0,1fr)_50px_46px_58px] gap-2 items-center min-h-[28px] px-2 cursor-pointer hover:bg-fin-surface-alt"
                  style={{
                    display: "grid",
                    "grid-template-columns": "minmax(0,1fr) 50px 46px 58px",
                    "column-gap": "8px",
                    "align-items": "center",
                    "min-height": "28px",
                    "margin-left": "2px",
                    "padding-left": "4px",
                    "padding-right": "4px",
                    "border-left": borderLeft,
                    "background-color": backgroundColor,
                  }}
                >
                  <div class="flex items-center gap-1 min-w-0">
                    <SideMark side={wall.side} />
                    <div
                      data-report-text="value"
                      class={`font-mono text-ui-body text-fin-text whitespace-nowrap ${selected ? "font-bold" : "font-medium"}`}
                      style={{
                        "font-family": MONO,
                        "font-size": `${REPORT_FONT.body}px`,
                        "font-weight": String(selected ? REPORT_FONT_WEIGHT.bold : REPORT_FONT_WEIGHT.medium),
                        color: palette.TEXT,
                        "white-space": "nowrap",
                      }}
                    >
                      {wall.strike.toLocaleString("en-IN")}
                    </div>
                  </div>
                  <div class="font-mono text-ui-micro text-fin-text text-right">{fmtOI(wall.row.oi)}</div>
                  <div
                    class="font-mono text-ui-micro text-right"
                    style={{
                      "font-family": MONO,
                      "font-size": `${REPORT_FONT.xs}px`,
                      "text-align": "right",
                      color: wall.oiPct != null && wall.oiPct < 0 ? palette.WARNING : MUTED,
                    }}
                  >
                    {fmtPct(wall.row.erosion_30m)}
                  </div>
                  <div class="flex items-center justify-end gap-[3px]">
                    <FuelBar score={wall.row.fuel_score} width={34} />
                    <div class="font-mono text-ui-micro text-fin-text-muted">{wall.row.fuel_score ?? "—"}</div>
                  </div>
                </div>
              );
            }}</For>
          </div>
        )}</For>
      </div>
      <div class="mt-auto pt-1 border-t border-fin-border font-mono text-ui-micro text-fin-text-muted">
        nearest{" "}
        <span style={{ color: palette.TEXT }}>
          {nearest() ? wallLabel(nearest()!.side, nearest()!.strike) : "—"}
        </span>{" "}
        · click a row to inspect
      </div>
    </div>
  );
}
