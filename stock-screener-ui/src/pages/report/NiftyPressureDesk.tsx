import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
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

const PANEL_TITLE = {
  fontSize: REPORT_FONT.micro,
  lineHeight: REPORT_LINE_HEIGHT.tight,
  fontWeight: REPORT_FONT_WEIGHT.extrabold,
  letterSpacing: REPORT_LETTER_SPACING.wider,
  color: MUTED,
  textTransform: "uppercase" as const,
};

function PanelTitle({ children }: { children: string }) {
  return <Typography sx={{ ...PANEL_TITLE, mb: 0.75 }}>{children}</Typography>;
}

function SideMark({ side, size = 7 }: { side: PressureSide; size?: number }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: side === "CALL" ? "50%" : "1px",
        bgcolor: sideColor(side),
      }}
    />
  );
}

function FuelBar({ score, width = 54 }: { score: number | undefined; width?: number }) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  return (
    <Box sx={{ position: "relative", width, height: 4, flexShrink: 0 }}>
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          borderRadius: 1,
          bgcolor: BORDER,
        }}
      />
      <Box
        sx={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${value}%`,
          borderRadius: 1,
          bgcolor: palette.TEXT,
        }}
      />
      <Box
        sx={{
          position: "absolute",
          left: "60%",
          top: -2,
          bottom: -2,
          width: 1,
          bgcolor: palette.WARNING,
        }}
      />
    </Box>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${statusColor(status)}`,
        borderRadius: `${REPORT_RADIUS.sm}px`,
        px: 0.5,
        py: "1px",
        color: statusColor(status),
        fontFamily: MONO,
        fontSize: REPORT_FONT.micro,
        fontWeight: REPORT_FONT_WEIGHT.extrabold,
        letterSpacing: REPORT_LETTER_SPACING.wide,
        lineHeight: REPORT_LINE_HEIGHT.tight,
        whiteSpace: "nowrap",
      }}
    >
      {status ?? "—"}
    </Box>
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
  const sx = (value: number) => x0 + ((value + domain) / (domain * 2)) * (x1 - x0);
  const sy = (value: number) => y1 - ((value + domain) / (domain * 2)) * (y1 - y0);
  const clamp = (value: number) => Math.max(-domain, Math.min(domain, value));

  const placed = useMemo(() => {
    let lastY = -Infinity;
    return walls
      .map((wall) => ({
        wall,
        x: sx(clamp(wall.oiPct ?? 0)),
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
    <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <PanelTitle>Flow phase plane</PanelTitle>
      <Box
        sx={{
          flex: 1,
          minHeight: 270,
          maxHeight: 460,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Box
          component="svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Wall OI change versus premium change over thirty minutes"
          sx={{ width: "100%", height: "100%", overflow: "visible" }}
        >
          {[-12, -8, -4, 0, 4, 8, 12].map((value) => (
            <g key={value}>
              <line
                x1={sx(value)}
                y1={y0}
                x2={sx(value)}
                y2={y1}
                stroke={value === 0 ? palette.AXIS_LINE : BORDER}
                strokeOpacity={value === 0 ? 0.9 : 0.55}
                strokeWidth={1}
              />
              <line
                x1={x0}
                y1={sy(value)}
                x2={x1}
                y2={sy(value)}
                stroke={value === 0 ? palette.AXIS_LINE : BORDER}
                strokeOpacity={value === 0 ? 0.9 : 0.55}
                strokeWidth={1}
              />
            </g>
          ))}
          <text x={x0 + 4} y={y0 + 11} fill={MUTED} fontSize={9} fontFamily={MONO}>
            COVER
          </text>
          <text x={x1 - 4} y={y0 + 11} fill={MUTED} fontSize={9} fontFamily={MONO} textAnchor="end">
            BUILD
          </text>
          <text x={x0 + 4} y={y1 - 5} fill={MUTED} fontSize={9} fontFamily={MONO}>
            UNWIND
          </text>
          <text x={x1 - 4} y={y1 - 5} fill={MUTED} fontSize={9} fontFamily={MONO} textAnchor="end">
            SELL
          </text>
          <text x={(x0 + x1) / 2} y={H - 8} fill={MUTED} fontSize={8} fontFamily={MONO} textAnchor="middle">
            OI Δ / 30m %
          </text>
          <text
            x={12}
            y={(y0 + y1) / 2}
            fill={MUTED}
            fontSize={8}
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
                  strokeWidth={1}
                  pointerEvents="none"
                />
                {selected ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={8}
                    fill="none"
                    stroke={SELECTED}
                    strokeOpacity={0.5}
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                ) : null}
                {wall.side === "CALL" ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={selected ? 5 : 3.7}
                    fill={color}
                    stroke={selected ? SELECTED : SURFACE}
                    strokeWidth={selected ? 2 : 1.5}
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
                    strokeWidth={selected ? 2 : 1.5}
                  />
                )}
                {wall.side === "CALL" ? (
                  <circle cx={x1 + 13} cy={ly - 3} r={3} fill={color} pointerEvents="none" />
                ) : (
                  <rect x={x1 + 10} y={ly - 6} width={6} height={6} rx={1} fill={color} pointerEvents="none" />
                )}
                <text
                  x={x1 + 22}
                  y={ly}
                  fill={selected ? SELECTED : MUTED}
                  fontSize={9}
                  fontWeight={selected ? 700 : 400}
                  fontFamily={MONO}
                  pointerEvents="none"
                >
                  {wall.strike.toLocaleString("en-IN")} {wall.side === "CALL" ? "CE" : "PE"}
                </text>
              </g>
            );
          })}
        </Box>
      </Box>
      <Typography sx={{ mt: 0.5, fontFamily: MONO, fontSize: REPORT_FONT.micro, color: MUTED }}>
        x = OI Δ / 30m · y = premium Δ / 30m · ±16% · click a dot or a row
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "center" }}>
        <Stack direction="row" spacing={0.4} sx={{ alignItems: "center" }}>
          <SideMark side="CALL" />
          <Typography sx={{ fontSize: REPORT_FONT.micro, color: MUTED }}>call</Typography>
        </Stack>
        <Stack direction="row" spacing={0.4} sx={{ alignItems: "center" }}>
          <SideMark side="PUT" />
          <Typography sx={{ fontSize: REPORT_FONT.micro, color: MUTED }}>put</Typography>
        </Stack>
      </Stack>
    </Box>
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
        <text x={8} y={top + 10} fill={color} fontSize={7.5} fontFamily={MONO}>
          {label} · INDEX 100
        </text>
        <text x={272} y={top + 10} fill={MUTED} fontSize={7.5} textAnchor="end" fontFamily={MONO}>
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
      <line x1={8} y1={top + height} x2={272} y2={top + height} stroke={BORDER} strokeWidth={1} />
      <line
        x1={8}
        y1={y(100)}
        x2={272}
        y2={y(100)}
        stroke={BORDER}
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <text x={8} y={top + 10} fill={color} fontSize={7.5} fontFamily={MONO}>
        {label} · INDEX 100
      </text>
      <text x={272} y={top + 10} fill={color} fontSize={7.5} textAnchor="end" fontFamily={MONO}>
        {last.toFixed(1)}
      </text>
      <text x={272} y={y(100) - 3} fill={MUTED} fontSize={6.5} textAnchor="end" fontFamily={MONO}>
        100
      </text>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.7} />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2} fill={color} />
    </g>
  );
}

function WallHistory({ wall }: HistoryProps) {
  const oi = useMemo(() => normalizeHistory(wall.row.oi_history ?? []), [wall.row.oi_history]);
  const prem = useMemo(() => normalizeHistory(wall.row.ltp_history ?? []), [wall.row.ltp_history]);
  const color = sideColor(wall.side);
  return (
    <Box sx={{ mt: 0.75, borderTop: `1px solid ${BORDER}`, pt: 0.5 }}>
      <Typography sx={{ ...PANEL_TITLE, mb: 0.25 }}>30m path</Typography>
      <Box
        component="svg"
        viewBox="0 0 280 230"
        role="img"
        aria-label={`${wallLabel(wall.side, wall.strike)} OI and premium history`}
        sx={{ display: "block", width: "100%", height: 188 }}
      >
        <HistoryPanel values={oi} color={color} label="OI" top={12} height={78} />
        <HistoryPanel values={prem} color={palette.TEXT_MUTED} label="PREM" top={118} height={78} />
        <text x={8} y={226} fill={MUTED} fontSize={6.5} fontFamily={MONO}>
          last 30 tape minutes
        </text>
        <text x={272} y={226} fill={MUTED} fontSize={6.5} textAnchor="end" fontFamily={MONO}>
          indexed at start
        </text>
      </Box>
      <Typography sx={{ fontFamily: MONO, fontSize: REPORT_FONT.micro, color: MUTED, mt: 0.25 }}>
        30m path · <Box component="span" sx={{ color: palette.TEXT }}>{pathRead(wall.row)}</Box>
      </Typography>
    </Box>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: REPORT_FONT.micro, color: MUTED, letterSpacing: REPORT_LETTER_SPACING.wide }}>
        {label}
      </Typography>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: REPORT_FONT.sm,
          fontWeight: REPORT_FONT_WEIGHT.semibold,
          color: color ?? palette.TEXT,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </Typography>
    </Box>
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
    <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
      <PanelTitle>Selected wall</PanelTitle>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <SideMark side={wall.side} size={9} />
        <Typography
          data-testid="pressure-read-name"
          sx={{ fontSize: REPORT_FONT.lg, fontWeight: REPORT_FONT_WEIGHT.bold, letterSpacing: "-0.01em" }}
        >
          {wallLabel(wall.side, wall.strike)}
        </Typography>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: REPORT_FONT.micro,
            fontWeight: REPORT_FONT_WEIGHT.extrabold,
            letterSpacing: REPORT_LETTER_SPACING.wide,
            color: palette.TEXT_MUTED,
            textTransform: "uppercase",
          }}
        >
          {quadrantFlowText(wall.quadrant)}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.5 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: REPORT_FONT.micro, color: MUTED, letterSpacing: REPORT_LETTER_SPACING.wide }}>
          FUEL
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: REPORT_FONT.xl, fontWeight: REPORT_FONT_WEIGHT.semibold }}>
          {row.fuel_score ?? "—"}
        </Typography>
        <FuelBar score={row.fuel_score} width={76} />
        <Typography sx={{ fontFamily: MONO, fontSize: REPORT_FONT.micro, color: MUTED, ml: "auto" }}>
          {short ? "SHORT Γ" : "LONG Γ"}
        </Typography>
      </Stack>
      <Typography sx={{ mt: 0.75, fontSize: REPORT_FONT.xsPlus, lineHeight: REPORT_LINE_HEIGHT.loose, color: palette.TEXT }}>
        {sentence}
      </Typography>
      <Typography sx={{ mt: 0.3, fontSize: REPORT_FONT.xs, lineHeight: REPORT_LINE_HEIGHT.loose, color: MUTED }}>
        {why}
      </Typography>
      <Box
        sx={{
          mt: 0.75,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 1.5,
          rowGap: 0.4,
        }}
      >
        <Detail label="OI" value={fmtOI(row.oi)} />
        <Detail label="Open" value={fmtOI(row.oi_open)} />
        <Detail label="30m OI" value={fmtPct(row.erosion_30m)} color={row.erosion_30m != null && row.erosion_30m < 0 ? palette.WARNING : undefined} />
        <Detail label="30m prem" value={fmtPct(row.prem_chg_30m)} />
        <Detail label="5m OI" value={fmtPct(row.erosion_5m)} />
        <Detail label="Wall" value={distanceText} />
      </Box>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.75, flexWrap: "wrap" }}>
        <StatusPill status={status} />
        <Typography sx={{ fontFamily: MONO, fontSize: REPORT_FONT.micro, color: MUTED }}>
          {confidence.level} confidence · {confidence.text}
        </Typography>
      </Stack>
      <WallHistory wall={wall} />
    </Box>
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
    <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
      <PanelTitle>Walls</PanelTitle>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 50px 46px 58px",
          columnGap: 0.75,
          pb: 0.25,
          borderBottom: `1px solid ${BORDER}`,
          fontFamily: MONO,
          fontSize: REPORT_FONT.micro,
          fontWeight: REPORT_FONT_WEIGHT.extrabold,
          letterSpacing: REPORT_LETTER_SPACING.wide,
          color: MUTED,
          textTransform: "uppercase",
        }}
      >
        <span>Wall</span>
        <span style={{ textAlign: "right" }}>OI</span>
        <span style={{ textAlign: "right" }}>30m</span>
        <span style={{ textAlign: "right" }}>Fuel</span>
      </Box>
      <Box sx={{ overflow: "auto", minHeight: 0, maxHeight: 430 }}>
        {view.map((group) => (
          <Box key={group.label}>
            <Typography sx={{ ...PANEL_TITLE, mt: 0.75, mb: 0.25 }}>{group.label}</Typography>
            {group.rows.map((wall) => {
              const selected = wall.key === selectedKey;
              return (
                <Box
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
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 50px 46px 58px",
                    columnGap: 0.75,
                    alignItems: "center",
                    minHeight: 28,
                    px: 0.5,
                    borderLeft: `2px solid ${selected ? SELECTED : "transparent"}`,
                    bgcolor: selected ? palette.SURFACE_ALT : "transparent",
                    cursor: "pointer",
                    "&:hover": { bgcolor: palette.SURFACE_ALT },
                  }}
                >
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
                    <SideMark side={wall.side} />
                    <Typography
                      sx={{
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
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontFamily: MONO, fontSize: REPORT_FONT.xs, color: palette.TEXT, textAlign: "right" }}>
                    {fmtOI(wall.row.oi)}
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: MONO,
                      fontSize: REPORT_FONT.xs,
                      textAlign: "right",
                      color: wall.oiPct != null && wall.oiPct < 0 ? palette.WARNING : MUTED,
                    }}
                  >
                    {fmtPct(wall.row.erosion_30m)}
                  </Typography>
                  <Stack direction="row" spacing={0.4} sx={{ alignItems: "center", justifyContent: "flex-end" }}>
                    <FuelBar score={wall.row.fuel_score} width={34} />
                    <Typography sx={{ fontFamily: MONO, fontSize: REPORT_FONT.micro, color: MUTED }}>
                      {wall.row.fuel_score ?? "—"}
                    </Typography>
                  </Stack>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
      <Box sx={{ mt: "auto", pt: 0.5, borderTop: `1px solid ${BORDER}`, fontFamily: MONO, fontSize: REPORT_FONT.micro, color: MUTED }}>
        nearest{" "}
        <Box component="span" sx={{ color: palette.TEXT }}>
          {nearest ? wallLabel(nearest.side, nearest.strike) : "—"}
        </Box>{" "}
        · click a row to inspect
      </Box>
    </Box>
  );
}

function pressureColumns(): ColumnDef<PressureWall>[] {
  return [
    {
      id: "wall",
      header: "WALL",
      accessorFn: (wall) => wallLabel(wall.side, wall.strike),
      cell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          <SideMark side={row.original.side} />
          <span>{wallLabel(row.original.side, row.original.strike)}</span>
        </Stack>
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
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", justifyContent: "flex-end" }}>
          <FuelBar score={row.original.row.fuel_score} width={38} />
          <span>{row.original.row.fuel_score ?? "—"}</span>
        </Stack>
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
    <Box sx={{ height: 218, minWidth: 0 }}>
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
    </Box>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={
        <Box component="span" sx={{ fontFamily: MONO, fontSize: REPORT_FONT.micro }}>
          <Box component="span" sx={{ color: MUTED, mr: 0.4 }}>{label}</Box>
          {value}
        </Box>
      }
      sx={{ height: 20, borderColor: BORDER, color: palette.TEXT, "& .MuiChip-label": { px: 0.75 } }}
    />
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
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: REPORT_FONT.xs,
          fontWeight: REPORT_FONT_WEIGHT.extrabold,
          letterSpacing: REPORT_LETTER_SPACING.wider,
          color: palette.TEXT,
          whiteSpace: "nowrap",
        }}
      >
        PRESSURE DESK
      </Typography>
      {walls ? (
        <>
          <SummaryChip label="" value={walls.symbol} />
          <SummaryChip label="" value={`${walls.date} · ${walls.dte == null ? "—" : `${walls.dte}-DTE`}`} />
          <SummaryChip label="spot" value={walls.spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })} />
          {walls.expiry ? <SummaryChip label="exp" value={walls.expiry} /> : null}
        </>
      ) : null}
    </Stack>
  );

  return (
    <PanelModal open={open} onClose={onClose} maxWidth={1480} title={title}>
      <Box data-testid="pressure-desk" sx={{ p: 0.5, minHeight: 0 }}>
        {!walls || allWalls.length === 0 || !selected ? (
          <Box data-testid="pressure-desk-empty" sx={{ py: 5, textAlign: "center", color: MUTED, fontFamily: MONO, fontSize: REPORT_FONT.sm }}>
            No walls tape at this replay time.
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "minmax(330px,1.05fr) minmax(290px,.9fr) minmax(320px,1fr)" },
                columnGap: { md: 1.5 },
                rowGap: 1.5,
                alignItems: "stretch",
                minHeight: 0,
              }}
            >
              <Box sx={{ minWidth: 0, display: "flex" }}>
                <FlowPlane payload={walls} selectedKey={selected.key} onSelect={setSelectedKey} />
              </Box>
              <Box sx={{ minWidth: 0, pl: { md: 1.5 }, borderLeft: { md: `1px solid ${BORDER}` } }}>
                <WallRead wall={selected} payload={walls} />
              </Box>
              <Box sx={{ minWidth: 0, pl: { md: 1.5 }, borderLeft: { md: `1px solid ${BORDER}` } }}>
                <WallList walls={allWalls} selectedKey={selected.key} spot={walls.spot} onSelect={setSelectedKey} />
              </Box>
            </Box>
            <Box sx={{ mt: 1, pt: 0.75, borderTop: `1px solid ${BORDER}`, minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 0.5 }}>
                <PanelTitle>Current minute · full values</PanelTitle>
                <Typography sx={{ fontFamily: MONO, fontSize: REPORT_FONT.micro, color: MUTED }}>
                  % vs 5 / 15 / 30m
                </Typography>
              </Stack>
              <PressureTable walls={allWalls} selectedKey={selected.key} onSelect={setSelectedKey} />
            </Box>
          </>
        )}
      </Box>
    </PanelModal>
  );
}
