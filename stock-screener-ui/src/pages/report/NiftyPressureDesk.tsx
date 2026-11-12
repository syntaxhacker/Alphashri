import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Box } from "@/ui";
import { PanelModal } from "@/components/common/PanelModal";
import { TanStackTable } from "@/components/common/TanStackTable";
import * as palette from "@/ui/palette";
import type { WallsPayload, WallsRow } from "@/api/reportNifty";
import { fmtOI, fmtPct, flowLabel, statusTone } from "./niftyWallsFormat";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
  REPORT_RADIUS,
} from "./reportTokens";
import {
  combineWalls,
  confidenceOf,
  quadrantFlowText,
  flowText,
  isShortGamma,
  nearestWall,
  normalizeHistory,
  pathRead,
  planeWalls,
  sentenceFor,
  wallLabel,
  whyRead,
  type PressureSide,
  type PressureWall,
} from "./pressureDesk";

const CE = palette.TERM_CE;
const PE = palette.TERM_PE;
const SELECTED = palette.TEXT;
const MUTED = palette.TEXT_MUTED;
const BORDER = palette.TERM_BORDER;
const SURFACE = palette.TERM_BG;
const MONO = palette.MONO;

const sideColor = (side: PressureSide): string => (side === "CALL" ? CE : PE);

const statusColor = (status: string | null | undefined): string => {
  switch (statusTone(status)) {
    case "positive":
      return palette.POSITIVE;
    case "warning":
      return palette.WARNING;
    case "negative":
      return palette.NEGATIVE;
    default:
      return MUTED;
  }
};

interface NiftyPressureDeskProps {
  open: boolean;
  onClose: () => void;
  walls: WallsPayload | null;
}

interface FlowPlaneProps {
  payload: WallsPayload;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

interface HistoryProps {
  wall: PressureWall;
}

interface WallReadProps {
  wall: PressureWall;
  payload: WallsPayload;
}

interface WallListProps {
  walls: PressureWall[];
  selectedKey: string | null;
  spot: number;
  onSelect: (key: string) => void;
}

function panelTitleStyles() {
  return {
    fontSize: `${REPORT_FONT.micro}px`,
    fontWeight: String(REPORT_FONT_WEIGHT.extrabold),
    letterSpacing: REPORT_LETTER_SPACING.wider,
    textTransform: "uppercase",
    color: MUTED,
    lineHeight: REPORT_LINE_HEIGHT.tight,
  };
}

function PanelTitle({ children }: { children: string }) {
  return (
    <div className="mb-1.5" style={{ ...panelTitleStyles() }}>
      {children}
    </div>
  );
}

function SideMark({ side, size = 7 }: { side: PressureSide; size?: number }) {
  return (
    <span
      className="inline-block shrink-0"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: side === "CALL" ? "50%" : "1px",
        backgroundColor: sideColor(side),
      }}
    />
  );
}

function FuelBar({ score, width = 54 }: { score: number | undefined; width?: number }) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div
      className="relative shrink-0"
      style={{ width, height: 4 }}
    >
      <div
        className="absolute inset-0 rounded-[1px]"
        style={{ borderRadius: 1, backgroundColor: BORDER }}
      />
      <div
        className="absolute left-0 top-0 bottom-0 rounded-[1px]"
        style={{ width: `${value}%`, borderRadius: 1, backgroundColor: palette.TEXT }}
      />
      <div
        className="absolute left-[60%] top-[-2px] bottom-[-2px] w-[1px]"
        style={{ borderRadius: 1, backgroundColor: palette.WARNING }}
      />
    </div>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  const tone = statusColor(status);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-1 py-[2px] font-mono text-[10px] font-black tracking-[0.08em] leading-tight whitespace-nowrap"
      style={{
        border: `1px solid ${tone}`,
        borderRadius: `${REPORT_RADIUS.sm}px`,
        color: tone,
      }}
    >
      {status ?? "—"}
    </span>
  );
}

function FlowPlane({ payload, selectedKey, onSelect }: FlowPlaneProps) {
  const walls = useMemo(() => planeWalls(payload), [payload]);
  const W = 520;
  const H = 500;
  const m = { l: 42, r: 150, t: 14, b: 34 };
  const x0 = m.l;
  const x1 = W - m.r;
  const y0 = m.t;
  const y1 = H - m.b;
  const domain = 16;
  const scaleX = (value: number) => x0 + ((value + domain) / (domain * 2)) * (x1 - x0);
  const sy = (value: number) => y1 - ((value + domain) / (domain * 2)) * (y1 - y0);
  const clamp = (value: number) => Math.max(-domain, Math.min(domain, value));

  const placed = useMemo(() => {
    let lastY = -Infinity;
    return walls
      .map((wall) => ({
        wall,
        x: scaleX(clamp(wall.oiPct ?? 0)),
        y: sy(clamp(wall.premPct ?? 0)),
      }))
      .sort((a, b) => a.y - b.y)
      .map((entry) => {
        const ly = Math.max(entry.y, lastY + 14);
        lastY = ly;
        return { ...entry, ly: Math.min(ly, y1 - 2) };
      });
  }, [walls, x0, x1, y0, y1]);

  return (
    <div className="flex flex-col min-w-0">
      <PanelTitle>Flow phase plane</PanelTitle>
      <div className="flex-1 min-h-[270px] max-h-[460px] flex items-center justify-center">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Wall OI change versus premium change over thirty minutes"
          className="w-full h-full"
          style={{ overflow: "visible" }}
        >
          {[-12, -8, -4, 0, 4, 8, 12].map((value) => (
            <g key={value}>
              <line
                x1={scaleX(value)}
                y1={y0}
                x2={scaleX(value)}
                y2={y1}
                stroke={value === 0 ? palette.AXIS_LINE : BORDER}
                strokeOpacity={value === 0 ? 0.9 : 0.55}
                stroke-width={1}
              />
              <line
                x1={x0}
                y1={sy(value)}
                x2={x1}
                y2={sy(value)}
                stroke={value === 0 ? palette.AXIS_LINE : BORDER}
                strokeOpacity={value === 0 ? 0.9 : 0.55}
                stroke-width={1}
              />
            </g>
          ))}
          <text x={x0 + 4} y={y0 + 11} fill={MUTED} font-size={9} fontFamily={MONO}>
            COVER
          </text>
          <text x={x1 - 4} y={y0 + 11} fill={MUTED} font-size={9} fontFamily={MONO} textAnchor="end">
            BUILD
          </text>
          <text x={x0 + 4} y={y1 - 5} fill={MUTED} font-size={9} fontFamily={MONO}>
            UNWIND
          </text>
          <text x={x1 - 4} y={y1 - 5} fill={MUTED} font-size={9} fontFamily={MONO} textAnchor="end">
            SELL
          </text>
          <text x={(x0 + x1) / 2} y={H - 8} fill={MUTED} font-size={8} fontFamily={MONO} textAnchor="middle">
            OI Δ / 30m %
          </text>
          <text
            x={12}
            y={(y0 + y1) / 2}
            fill={MUTED}
            font-size={8}
            fontFamily={MONO}
            textAnchor="middle"
            transform={`rotate(-90 12 ${(y0 + y1) / 2})`}
          >
            PREMIUM Δ / 30m %
          </text>

          {placed.map(({ wall, x, y, ly }) => {
            const selected = wall.key === selectedKey;
            const color = sideColor(wall.side);
            return (
              <g
                key={wall.key}
                data-testid={`pressure-plane-${wall.key}`}
                role="button"
                tabIndex={0}
                aria-label={`Select ${wallLabel(wall.side, wall.strike)}`}
                onClick={() => onSelect(wall.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(wall.key);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <title>{wallLabel(wall.side, wall.strike)}</title>
                <line
                  x1={x}
                  y1={y}
                  x2={x1 + 8}
                  y2={ly}
                  stroke={selected ? SELECTED : BORDER}
                  strokeOpacity={selected ? 0.95 : 0.7}
                  stroke-width={1}
                  pointer-events="none"
                />
                {selected ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={8}
                    fill="none"
                    stroke={SELECTED}
                    strokeOpacity={0.5}
                    stroke-width={1}
                    pointer-events="none"
                  />
                ) : null}
                {wall.side === "CALL" ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={selected ? 5 : 3.7}
                    fill={color}
                    stroke={selected ? SELECTED : SURFACE}
                    stroke-width={selected ? 2 : 1.5}
                  />
                ) : (
                  <rect
                    x={x - (selected ? 5 : 3.7)}
                    y={y - (selected ? 5 : 3.7)}
                    width={selected ? 10 : 7.4}
                    height={selected ? 10 : 7.4}
                    rx={1}
                    fill={color}
                    stroke={selected ? SELECTED : SURFACE}
                    stroke-width={selected ? 2 : 1.5}
                  />
                )}
                {wall.side === "CALL" ? (
                  <circle cx={x1 + 13} cy={ly - 3} r={3} fill={color} pointer-events="none" />
                ) : (
                  <rect x={x1 + 10} y={ly - 6} width={6} height={6} rx={1} fill={color} pointer-events="none" />
                )}
                <text
                  x={x1 + 22}
                  y={ly}
                  fill={selected ? SELECTED : MUTED}
                  font-size={9}
                  font-weight={selected ? 700 : 400}
                  fontFamily={MONO}
                  pointer-events="none"
                >
                  {wall.strike.toLocaleString("en-IN")} {wall.side === "CALL" ? "CE" : "PE"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 font-mono text-[10px] text-fin-text-muted">
        x = OI Δ / 30m · y = premium Δ / 30m · ±16% · click a dot or a row
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex items-center gap-[3px]">
          <SideMark side="CALL" />
          <div className="text-[10px] text-fin-text-muted">call</div>
        </div>
        <div className="flex items-center gap-[3px]">
          <SideMark side="PUT" />
          <div className="text-[10px] text-fin-text-muted">put</div>
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({
  values,
  color,
  label,
  top,
  height,
}: {
  values: (number | null)[];
  color: string;
  label: string;
  top: number;
  height: number;
}) {
  const finite = values.filter((value): value is number => value != null);
  if (finite.length < 2) {
    return (
      <g>
        <text x={8} y={top + 10} fill={color} font-size={7.5} fontFamily={MONO}>
          {label} · INDEX 100
        </text>
        <text x={272} y={top + 10} fill={MUTED} font-size={7.5} textAnchor="end" fontFamily={MONO}>
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
  const x = (index: number) => 8 + (index / Math.max(1, values.length - 1)) * 264;
  const y = (value: number) => top + height - ((value - min) / (max - min)) * height;
  const points = values
    .map((value, index) => (value == null ? null : `${x(index).toFixed(1)},${y(value).toFixed(1)}`))
    .filter((point): point is string => point != null)
    .join(" ");
  const last = finite[finite.length - 1];
  return (
    <g>
      <line x1={8} y1={top + height} x2={272} y2={top + height} stroke={BORDER} stroke-width={1} />
      <line
        x1={8}
        y1={y(100)}
        x2={272}
        y2={y(100)}
        stroke={BORDER}
        stroke-width={1}
        strokeDasharray="2 3"
      />
      <text x={8} y={top + 10} fill={color} font-size={7.5} fontFamily={MONO}>
        {label} · INDEX 100
      </text>
      <text x={272} y={top + 10} fill={color} font-size={7.5} textAnchor="end" fontFamily={MONO}>
        {last.toFixed(1)}
      </text>
      <text x={272} y={y(100) - 3} fill={MUTED} font-size={6.5} textAnchor="end" fontFamily={MONO}>
        100
      </text>
      <polyline points={points} fill="none" stroke={color} stroke-width={1.7} />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2} fill={color} />
    </g>
  );
}

function WallHistory({ wall }: HistoryProps) {
  const oi = useMemo(() => normalizeHistory(wall.row.oi_history ?? []), [wall.row.oi_history]);
  const prem = useMemo(() => normalizeHistory(wall.row.ltp_history ?? []), [wall.row.ltp_history]);
  const color = sideColor(wall.side);
  return (
    <div className="mt-1.5 border-t border-fin-border pt-1">
      <div className="mb-[2px]" style={{ ...panelTitleStyles() }}>30m path</div>
      <svg
        viewBox="0 0 280 230"
        role="img"
        aria-label={`${wallLabel(wall.side, wall.strike)} OI and premium history`}
        className="block w-full h-[188px]"
      >
        <HistoryPanel values={oi} color={color} label="OI" top={12} height={78} />
        <HistoryPanel values={prem} color={palette.TEXT_MUTED} label="PREM" top={118} height={78} />
        <text x={8} y={226} fill={MUTED} font-size={6.5} fontFamily={MONO}>
          last 30 tape minutes
        </text>
        <text x={272} y={226} fill={MUTED} font-size={6.5} textAnchor="end" fontFamily={MONO}>
          indexed at start
        </text>
      </svg>
      <div className="mt-[2px] font-mono text-[10px] text-fin-text-muted">
        30m path · <span style={{ color: palette.TEXT }}>{pathRead(wall.row)}</span>
      </div>
    </div>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div
        className="text-[10px] text-fin-text-muted tracking-[0.08em]"
        style={{ fontSize: REPORT_FONT.micro, color: MUTED, letterSpacing: REPORT_LETTER_SPACING.wide }}
      >
        {label}
      </div>
      <div
        className="font-mono text-[12px] font-semibold tabular-nums whitespace-nowrap"
        style={{
          fontFamily: MONO,
          fontSize: REPORT_FONT.sm,
          fontWeight: REPORT_FONT_WEIGHT.semibold,
          color: color ?? palette.TEXT,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function WallRead({ wall, payload }: WallReadProps) {
  const row: WallsRow = wall.row;
  const confidence = confidenceOf(row);
  const sentence = sentenceFor(wall.quadrant);
  const why = whyRead(row, payload.spot, payload.flip);
  const distance = row.distance_pts ?? wall.strike - payload.spot;
  const distanceText = `${distance >= 0 ? "+" : ""}${distance.toFixed(1)} pts`;
  const status = row.status ?? "STABLE";
  const short = isShortGamma(payload.spot, payload.flip);

  return (
    <div className="min-w-0 flex flex-col h-full">
      <div className="mb-1.5" style={{ ...panelTitleStyles() }}>Selected wall</div>
      <div className="flex items-center flex-wrap gap-1.5">
        <SideMark side={wall.side} size={9} />
        <div
          data-testid="pressure-read-name"
          className="text-[14px] font-bold tracking-[-0.01em]"
          style={{ fontSize: REPORT_FONT.lg, fontWeight: REPORT_FONT_WEIGHT.bold, letterSpacing: "-0.01em" }}
        >
          {wallLabel(wall.side, wall.strike)}
        </div>
        <div className="font-mono text-[10px] font-black tracking-[0.08em] text-fin-text-muted uppercase">
          {quadrantFlowText(wall.quadrant)}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="font-mono text-[10px] text-fin-text-muted tracking-[0.08em]">
          FUEL
        </div>
        <div className="font-mono text-[15px] font-semibold">{row.fuel_score ?? "—"}</div>
        <FuelBar score={row.fuel_score} width={76} />
        <div className="ml-auto font-mono text-[10px] text-fin-text-muted">
          {short ? "SHORT Γ" : "LONG Γ"}
        </div>
      </div>
      <div className="mt-1.5 text-[11.5px] leading-loose text-fin-text" style={{ fontSize: REPORT_FONT.xsPlus, lineHeight: REPORT_LINE_HEIGHT.loose, color: palette.TEXT }}>
        {sentence}
      </div>
      <div className="mt-[2px] text-[11px] leading-loose text-fin-text-muted" style={{ fontSize: REPORT_FONT.xs, lineHeight: REPORT_LINE_HEIGHT.loose, color: MUTED }}>
        {why}
      </div>
      <div
        className="mt-1.5 grid grid-cols-[1fr_1fr] gap-1.5 row-gap-[3px]"
        style={{ mt: 0.75, display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 1.5, rowGap: 0.4 }}
      >
        <Detail label="OI" value={fmtOI(row.oi)} />
        <Detail label="Open" value={fmtOI(row.oi_open)} />
        <Detail
          label="30m OI"
          value={fmtPct(row.erosion_30m)}
          color={row.erosion_30m != null && row.erosion_30m < 0 ? palette.WARNING : undefined}
        />
        <Detail label="30m prem" value={fmtPct(row.prem_chg_30m)} />
        <Detail label="5m OI" value={fmtPct(row.erosion_5m)} />
        <Detail label="Wall" value={distanceText} />
      </div>
      <div className="flex items-center flex-wrap gap-2 mt-1.5">
        <StatusPill status={status} />
        <div className="font-mono text-[10px] text-fin-text-muted">
          {confidence.level} confidence · {confidence.text}
        </div>
      </div>
      <WallHistory wall={wall} />
    </div>
  );
}

function WallList({ walls, selectedKey, spot, onSelect }: WallListProps) {
  const view = useMemo(() => {
    const groups: { label: string; rows: PressureWall[] }[] = [
      { label: "CALLS", rows: walls.filter((wall) => wall.side === "CALL") },
      { label: "PUTS", rows: walls.filter((wall) => wall.side === "PUT") },
    ];
    return groups;
  }, [walls]);
  const nearest = nearestWall(walls, spot);

  return (
    <div className="min-w-0 flex flex-col h-full">
      <div className="mb-1.5" style={{ ...panelTitleStyles() }}>Walls</div>
      <div
        className="grid grid-cols-[minmax(0,1fr)_50px_46px_58px] gap-1.5 pb-[2px] border-b border-fin-border font-mono text-[10px] font-black tracking-[0.08em] text-fin-text-muted uppercase"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 50px 46px 58px",
          columnGap: 0.75,
          borderBottom: `1px solid ${BORDER}`,
          fontFamily: MONO,
          fontSize: `${REPORT_FONT.micro}px`,
          fontWeight: String(REPORT_FONT_WEIGHT.extrabold),
          letterSpacing: REPORT_LETTER_SPACING.wide,
          color: MUTED,
          textTransform: "uppercase",
        }}
      >
        <span>Wall</span>
        <span style={{ textAlign: "right" }}>OI</span>
        <span style={{ textAlign: "right" }}>30m</span>
        <span style={{ textAlign: "right" }}>Fuel</span>
      </div>
      <div className="overflow-auto min-h-0 max-h-[430px]">
        {view.map((group) => (
          <div key={group.label}>
            <div className="mb-1.5" style={{ ...panelTitleStyles(), mt: 0.75, mb: 0.25 }}>{group.label}</div>
            {group.rows.map((wall) => {
              const selected = wall.key === selectedKey;
              const borderLeft = selected ? `2px solid ${SELECTED}` : "2px solid transparent";
              const backgroundColor = selected ? palette.SURFACE_ALT : "transparent";
              return (
                <div
                  key={wall.key}
                  role="button"
                  tabIndex={0}
                  data-testid={`pressure-row-${wall.key}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(wall.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(wall.key);
                    }
                  }}
                  className="grid grid-cols-[minmax(0,1fr)_50px_46px_58px] gap-1.5 items-center min-h-[28px] px-1 cursor-pointer hover:bg-fin-surface-alt"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 50px 46px 58px",
                    columnGap: 0.75,
                    alignItems: "center",
                    minHeight: 28,
                    px: 0.5,
                    borderLeft: borderLeft as any,
                    backgroundColor,
                  }}
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <SideMark side={wall.side} />
                    <div
                      className={`font-mono text-[11px] text-fin-text whitespace-nowrap overflow-hidden overflow-ellipsis ${selected ? "font-bold" : "font-medium"}`}
                      style={{
                        fontFamily: MONO,
                        fontSize: REPORT_FONT.xs,
                        fontWeight: selected ? REPORT_FONT_WEIGHT.bold : REPORT_FONT_WEIGHT.medium,
                        color: palette.TEXT,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {wall.strike.toLocaleString("en-IN")}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-fin-text text-right">{fmtOI(wall.row.oi)}</div>
                  <div
                    className="font-mono text-[11px] text-right"
                    style={{
                      fontFamily: MONO,
                      fontSize: REPORT_FONT.xs,
                      textAlign: "right",
                      color: wall.oiPct != null && wall.oiPct < 0 ? palette.WARNING : MUTED,
                    }}
                  >
                    {fmtPct(wall.row.erosion_30m)}
                  </div>
                  <div className="flex items-center justify-end gap-[3px]">
                    <FuelBar score={wall.row.fuel_score} width={34} />
                    <div className="font-mono text-[10px] text-fin-text-muted">{wall.row.fuel_score ?? "—"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-auto pt-1 border-t border-fin-border font-mono text-[10px] text-fin-text-muted">
        nearest{" "}
        <span style={{ color: palette.TEXT }}>
          {nearest ? wallLabel(nearest.side, nearest.strike) : "—"}
        </span>{" "}
        · click a row to inspect
      </div>
    </div>
  );
}

function pressureColumns(): ColumnDef<PressureWall>[] {
  return [
    {
      id: "wall",
      header: "WALL",
      accessorFn: (wall) => wallLabel(wall.side, wall.strike),
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <SideMark side={row.original.side} />
          <span>{wallLabel(row.original.side, row.original.strike)}</span>
        </div>
      ),
      meta: { align: "left" },
      size: 118,
    },
    {
      id: "oi",
      header: "OI",
      accessorFn: (wall) => wall.row.oi,
      cell: ({ row }) => fmtOI(row.original.row.oi),
      meta: { align: "right" },
      size: 62,
    },
    {
      id: "open",
      header: "OPEN",
      accessorFn: (wall) => wall.row.oi_open ?? 0,
      cell: ({ row }) => fmtOI(row.original.row.oi_open),
      meta: { align: "right" },
      size: 62,
    },
    {
      id: "oi5",
      header: "5m OI",
      accessorFn: (wall) => wall.row.erosion_5m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.erosion_5m),
      meta: { align: "right" },
      size: 56,
    },
    {
      id: "oi15",
      header: "15m OI",
      accessorFn: (wall) => wall.row.erosion_15m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.erosion_15m),
      meta: { align: "right" },
      size: 58,
    },
    {
      id: "oi30",
      header: "30m OI",
      accessorFn: (wall) => wall.row.erosion_30m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.erosion_30m),
      meta: { align: "right" },
      size: 60,
    },
    {
      id: "prem5",
      header: "5m PREM",
      accessorFn: (wall) => wall.row.prem_chg_5m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.prem_chg_5m),
      meta: { align: "right" },
      size: 62,
    },
    {
      id: "prem15",
      header: "15m PREM",
      accessorFn: (wall) => wall.row.prem_chg_15m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.prem_chg_15m),
      meta: { align: "right" },
      size: 66,
    },
    {
      id: "prem30",
      header: "30m PREM",
      accessorFn: (wall) => wall.row.prem_chg_30m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.prem_chg_30m),
      meta: { align: "right" },
      size: 66,
    },
    {
      id: "fuel",
      header: "FUEL",
      accessorFn: (wall) => wall.row.fuel_score ?? 0,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <FuelBar score={row.original.row.fuel_score} width={38} />
          <span>{row.original.row.fuel_score ?? "—"}</span>
        </div>
      ),
      meta: { align: "right" },
      size: 72,
    },
    {
      id: "flow",
      header: "FLOW 5m",
      accessorFn: (wall) => flowLabel(wall.row.flow),
      cell: ({ row }) => flowText(row.original.row.flow),
      meta: { align: "left" },
      size: 88,
    },
    {
      id: "conf",
      header: "CONF",
      accessorFn: (wall) => confidenceOf(wall.row).level,
      cell: ({ row }) => confidenceOf(row.original.row).level,
      meta: { align: "center" },
      size: 52,
    },
    {
      id: "status",
      header: "STATUS",
      accessorFn: (wall) => wall.row.status ?? "",
      cell: ({ row }) => <span style={{ color: statusColor(row.original.row.status) }}>{row.original.row.status ?? "—"}</span>,
      meta: { align: "center" },
      size: 76,
    },
  ];
}

function PressureTable({
  walls,
  selectedKey,
  onSelect,
}: {
  walls: PressureWall[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const columns = useMemo(() => pressureColumns(), []);
  return (
    <div className="h-[218px] min-w-0">
      <TanStackTable<PressureWall>
        data={walls}
        columns={columns}
        dataTestId="pressure-desk-table"
        ariaLabel="Pressure desk wall values"
        dense
        fillContainer
        minTableWidth={1050}
        onRowClick={(wall) => onSelect(wall.key)}
        getRowClassName={(wall) => (wall.key === selectedKey ? "pressure-row-selected" : undefined)}
        getRowStyle={(wall) =>
          wall.key === selectedKey
            ? { background: palette.SURFACE_ALT, boxShadow: `inset 2px 0 0 ${SELECTED}` }
            : undefined
        }
        getRowTestId={(wall) => `pressure-table-${wall.key}`}
      />
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-[2px] text-[10px] font-mono whitespace-nowrap"
      style={{
        height: 20,
        borderColor: BORDER,
        color: palette.TEXT,
        border: `1px solid ${BORDER}`,
      }}
    >
      <span className="text-fin-text-muted" style={{ marginRight: 4 }}>
        {label}
      </span>
      {value}
    </span>
  );
}

export function NiftyPressureDesk({ open, onClose, walls }: NiftyPressureDeskProps) {
  const allWalls = useMemo(() => (walls ? combineWalls(walls) : []), [walls]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = allWalls.find((wall) => wall.key === selectedKey) ?? allWalls[0] ?? null;

  useEffect(() => {
    if (!open || !walls) return;
    const keys = new Set(allWalls.map((wall) => wall.key));
    setSelectedKey((prev) => {
      if (prev && keys.has(prev)) return prev;
      return nearestWall(allWalls, walls.spot)?.key ?? allWalls[0]?.key ?? null;
    });
  }, [open, walls, allWalls]);

  const title = (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="font-mono text-[11px] font-black tracking-[0.1em] text-fin-text whitespace-nowrap">
        PRESSURE DESK
      </div>
      {walls ? (
        <>
          <SummaryChip label="" value={walls.symbol} />
          <SummaryChip label="" value={`${walls.date} · ${walls.dte == null ? "—" : `${walls.dte}-DTE`}`} />
          <SummaryChip
            label="spot"
            value={walls.spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          />
          {walls.expiry ? <SummaryChip label="exp" value={walls.expiry} /> : null}
        </>
      ) : null}
    </div>
  );

  return (
    <PanelModal open={open} onClose={onClose} max-width={1480} title={title}>
      <div data-testid="pressure-desk" className="p-1 min-h-0">
        {!walls || allWalls.length === 0 || !selected ? (
          <div data-testid="pressure-desk-empty" className="py-10 text-center text-fin-text-muted font-mono text-[12px]">
            No walls tape at this replay time.
          </div>
        ) : (
          <>
            {/* Responsive grid with breakpoint-based column widths (md = 900px). */}
            <Box
              className="grid grid-cols-1 min-[900px]:grid-cols-[minmax(330px,1.05fr)_minmax(290px,0.9fr)_minmax(320px,1fr)] min-[900px]:gap-x-3 gap-y-3 items-stretch min-h-0"
            >
              <div className="min-w-0 flex">
                <FlowPlane payload={walls} selectedKey={selected.key} onSelect={setSelectedKey} />
              </div>
              {/* Left padding + left border only apply at the md breakpoint */}
              <Box
                className="min-w-0 min-[900px]:pl-3 min-[900px]:border-l min-[900px]:border-fin-border"
              >
                <WallRead wall={selected} payload={walls} />
              </Box>
              <Box
                className="min-w-0 min-[900px]:pl-3 min-[900px]:border-l min-[900px]:border-fin-border"
              >
                <WallList walls={allWalls} selectedKey={selected.key} spot={walls.spot} onSelect={setSelectedKey} />
              </Box>
            </Box>
            <div className="mt-2 pt-[6px] border-t border-fin-border min-w-0" style={{ borderTop: `1px solid ${BORDER}`, minWidth: 0 }}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <div className="mb-1.5" style={{ ...panelTitleStyles() }}>Current minute · full values</div>
                <div className="font-mono text-[10px] text-fin-text-muted">% vs 5 / 15 / 30m</div>
              </div>
              <PressureTable walls={allWalls} selectedKey={selected.key} onSelect={setSelectedKey} />
            </div>
          </>
        )}
      </div>
    </PanelModal>
  );
}
