import { createMemo } from "solid-js";
import * as palette from "@/ui/palette";
import type { WallsPayload } from "@/api/reportNifty";
import {
  BORDER,
  MUTED,
  MONO,
  panelTitleStyles,
  sideColor,
} from "./NiftyPressureDesk.format";
import { FuelBar, PanelTitle, SideMark, StatusPill } from "./NiftyPressureDesk.legend";
import { fmtOI, fmtPct } from "./niftyWallsFormat";
import {
  confidenceOf,
  isShortGamma,
  normalizeHistory,
  pathRead,
  quadrantFlowText,
  sentenceFor,
  wallLabel,
  whyRead,
  type PressureWall,
} from "./pressureDesk";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
} from "./reportTokens";

interface HistoryProps {
  wall: PressureWall;
}

interface WallReadProps {
  wall: PressureWall;
  payload: WallsPayload;
}

function HistoryPanel(props: {
  values: (number | null)[];
  color: string;
  label: string;
  top: number;
  height: number;
}) {
  const finite = props.values.filter((value): value is number => value != null);
  if (finite.length < 2) {
    return (
      <g>
        <text x={8} y={props.top + 10} fill={props.color} font-size={`${REPORT_FONT.micro}`} font-family={MONO}>
          {props.label} · INDEX 100
        </text>
        <text x={272} y={props.top + 10} fill={MUTED} font-size={`${REPORT_FONT.micro}`} text-anchor="end" font-family={MONO}>
          no history
        </text>
      </g>
    );
  }
  let min = Math.min(...finite, 100);
  let max = Math.max(...finite, 100);
  const pad = Math.max(0.4, (max - min) * 0.12);
  min -= pad;
  max += pad;
  const x = (index: number) => 8 + (index / Math.max(1, props.values.length - 1)) * 264;
  const y = (value: number) => props.top + props.height - ((value - min) / (max - min)) * props.height;
  const points = props.values
    .map((value, index) => (value == null ? null : `${x(index).toFixed(1)},${y(value).toFixed(1)}`))
    .filter((point): point is string => point != null)
    .join(" ");
  const last = finite[finite.length - 1];
  return (
    <g>
      <line x1={8} y1={props.top + props.height} x2={272} y2={props.top + props.height} stroke={BORDER} stroke-width={1} />
      <line
        x1={8}
        y1={y(100)}
        x2={272}
        y2={y(100)}
        stroke={BORDER}
        stroke-width={1}
        stroke-dasharray="2 3"
      />
      <text x={8} y={props.top + 10} fill={props.color} font-size={`${REPORT_FONT.micro}`} font-family={MONO}>
        {props.label} · INDEX 100
      </text>
      <text x={272} y={props.top + 10} fill={props.color} font-size={`${REPORT_FONT.micro}`} text-anchor="end" font-family={MONO}>
        {last.toFixed(1)}
      </text>
      <text x={272} y={y(100) - 3} fill={MUTED} font-size={`${REPORT_FONT.micro}`} text-anchor="end" font-family={MONO}>
        100
      </text>
      <polyline points={points} fill="none" stroke={props.color} stroke-width={1.7} />
      <circle cx={x(props.values.length - 1)} cy={y(last)} r={2} fill={props.color} />
    </g>
  );
}

function WallHistory(props: HistoryProps) {
  const oi = createMemo(() => normalizeHistory(props.wall.row.oi_history ?? []));
  const prem = createMemo(() => normalizeHistory(props.wall.row.ltp_history ?? []));
  const color = () => sideColor(props.wall.side);
  return (
    <div class="mt-1.5 border-t border-fin-border pt-1">
      <div data-report-text="title" class="mb-1" style={{ ...panelTitleStyles() }}>30m path</div>
      <svg
        viewBox="0 0 280 230"
        role="img"
        aria-label={`${wallLabel(props.wall.side, props.wall.strike)} OI and premium history`}
        class="block w-full h-[188px]"
      >
        <HistoryPanel values={oi()} color={color()} label="OI" top={12} height={78} />
        <HistoryPanel values={prem()} color={palette.TEXT_MUTED} label="PREM" top={118} height={78} />
        <text x={8} y={226} fill={MUTED} font-size={`${REPORT_FONT.micro}`} font-family={MONO}>
          last 30 tape minutes
        </text>
        <text x={272} y={226} fill={MUTED} font-size={`${REPORT_FONT.micro}`} text-anchor="end" font-family={MONO}>
          indexed at start
        </text>
      </svg>
      <div class="mt-[2px] font-mono text-ui-micro text-fin-text-muted">
        30m path · <span style={{ color: palette.TEXT }}>{pathRead(props.wall.row)}</span>
      </div>
    </div>
  );
}

function Detail(props: { label: string; value: string; color?: string }) {
  return (
    <div class="min-w-0">
      <div
        data-report-text="label"
        class="text-ui-micro text-fin-text-muted tracking-[0.08em]"
        style={{ "font-size": `${REPORT_FONT.micro}px`, color: MUTED, "letter-spacing": REPORT_LETTER_SPACING.wide }}
      >
        {props.label}
      </div>
      <div
        data-report-text="value"
        class="font-mono text-ui-body font-semibold tabular-nums whitespace-nowrap"
        style={{
          "font-family": MONO,
          "font-size": `${REPORT_FONT.sm}px`,
          "font-weight": String(REPORT_FONT_WEIGHT.semibold),
          color: props.color ?? palette.TEXT,
          "font-variant-numeric": "tabular-nums",
          "white-space": "nowrap",
        }}
      >
        {props.value}
      </div>
    </div>
  );
}

export function WallRead(props: WallReadProps) {
  const row = () => props.wall.row;
  const confidence = createMemo(() => confidenceOf(row()));
  const sentence = createMemo(() => sentenceFor(props.wall.quadrant));
  const why = createMemo(() => whyRead(row(), props.payload.spot, props.payload.flip));
  const distance = () => row().distance_pts ?? props.wall.strike - props.payload.spot;
  const distanceText = () => `${distance() >= 0 ? "+" : ""}${distance().toFixed(1)} pts`;
  const status = () => row().status ?? "STABLE";
  const short = () => isShortGamma(props.payload.spot, props.payload.flip);

  return (
    <div class="min-w-0 flex flex-col h-full">
      <PanelTitle>Selected wall</PanelTitle>
      <div class="flex items-center flex-wrap gap-1.5">
        <SideMark side={props.wall.side} size={9} />
        <div
          data-testid="pressure-read-name"
          class="text-ui-title font-bold tracking-[-0.01em]"
          style={{ "font-size": `${REPORT_FONT.lg}px`, "font-weight": String(REPORT_FONT_WEIGHT.bold), "letter-spacing": "-0.01em" }}
        >
          {wallLabel(props.wall.side, props.wall.strike)}
        </div>
        <div class="font-mono text-ui-micro font-black tracking-[0.08em] text-fin-text-muted uppercase">
          {quadrantFlowText(props.wall.quadrant)}
        </div>
      </div>
      <div class="flex items-center gap-2 mt-1">
        <div class="font-mono text-ui-micro text-fin-text-muted tracking-[0.08em]">
          FUEL
        </div>
        <div class="font-mono text-ui-title font-semibold">{row().fuel_score ?? "—"}</div>
        <FuelBar score={row().fuel_score} width={76} />
        <div class="ml-auto font-mono text-ui-micro text-fin-text-muted">
          {short() ? "SHORT Γ" : "LONG Γ"}
        </div>
      </div>
      <div class="mt-1.5 text-ui-micro leading-loose text-fin-text" style={{ "font-size": `${REPORT_FONT.xsPlus}px`, "line-height": REPORT_LINE_HEIGHT.loose, color: palette.TEXT }}>
        {sentence()}
      </div>
      <div class="mt-1 text-ui-micro leading-loose text-fin-text-muted" style={{ "font-size": `${REPORT_FONT.xs}px`, "line-height": REPORT_LINE_HEIGHT.loose, color: MUTED }}>
        {why()}
      </div>
      <div
        data-report-spacing="12"
        class="mt-2 grid grid-cols-[1fr_1fr] gap-2"
        style={{ display: "grid", "grid-template-columns": "1fr 1fr", "column-gap": "12px", "row-gap": "8px" }}
      >
        <Detail label="OI" value={fmtOI(row().oi)} />
        <Detail label="Open" value={fmtOI(row().oi_open)} />
        <Detail
          label="30m OI"
          value={fmtPct(row().erosion_30m)}
          color={row().erosion_30m != null && row().erosion_30m! < 0 ? palette.WARNING : undefined}
        />
        <Detail label="30m prem" value={fmtPct(row().prem_chg_30m)} />
        <Detail label="5m OI" value={fmtPct(row().erosion_5m)} />
        <Detail label="Wall" value={distanceText()} />
      </div>
      <div class="flex items-center flex-wrap gap-2 mt-1.5">
        <StatusPill status={status()} />
        <div class="font-mono text-ui-micro text-fin-text-muted">
          {confidence().level} confidence · {confidence().text}
        </div>
      </div>
      <WallHistory wall={props.wall} />
    </div>
  );
}
