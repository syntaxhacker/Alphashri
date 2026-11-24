import { createMemo, For, Show } from "solid-js";
import * as palette from "@/ui/palette";
import type { WallsPayload } from "@/api/reportNifty";
import {
  BORDER,
  MUTED,
  MONO,
  SELECTED,
  SURFACE,
  sideColor,
} from "./NiftyPressureDesk.format";
import { PanelTitle, SideMark } from "./NiftyPressureDesk.legend";
import { planeWalls, wallLabel } from "./pressureDesk";
import { REPORT_FONT } from "./reportTokens";

interface FlowPlaneProps {
  payload: WallsPayload;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export function FlowPlane(props: FlowPlaneProps) {
  const walls = createMemo(() => planeWalls(props.payload));
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

  const placed = createMemo(() => {
    let lastY = -Infinity;
    return walls()
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
  });

  return (
    <div class="flex flex-col min-w-0">
      <PanelTitle>Flow phase plane</PanelTitle>
      <div class="flex-1 min-h-[270px] max-h-[460px] flex items-center justify-center">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Wall OI change versus premium change over thirty minutes"
          class="w-full h-full"
          style={{ overflow: "visible" }}
        >
          <For each={[-12, -8, -4, 0, 4, 8, 12]}>{(value) => (
            <g>
              <line
                x1={scaleX(value)}
                y1={y0}
                x2={scaleX(value)}
                y2={y1}
                stroke={value === 0 ? palette.AXIS_LINE : BORDER}
                stroke-opacity={value === 0 ? 0.9 : 0.55}
                stroke-width={1}
              />
              <line
                x1={x0}
                y1={sy(value)}
                x2={x1}
                y2={sy(value)}
                stroke={value === 0 ? palette.AXIS_LINE : BORDER}
                stroke-opacity={value === 0 ? 0.9 : 0.55}
                stroke-width={1}
              />
            </g>
          )}</For>
          <text x={x0 + 4} y={y0 + 11} fill={MUTED} font-size={`${REPORT_FONT.micro}`} font-family={MONO}>
            COVER
          </text>
          <text x={x1 - 4} y={y0 + 11} fill={MUTED} font-size={`${REPORT_FONT.micro}`} font-family={MONO} text-anchor="end">
            BUILD
          </text>
          <text x={x0 + 4} y={y1 - 5} fill={MUTED} font-size={`${REPORT_FONT.micro}`} font-family={MONO}>
            UNWIND
          </text>
          <text x={x1 - 4} y={y1 - 5} fill={MUTED} font-size={`${REPORT_FONT.micro}`} font-family={MONO} text-anchor="end">
            SELL
          </text>
          <text x={(x0 + x1) / 2} y={H - 8} fill={MUTED} font-size={`${REPORT_FONT.micro}`} font-family={MONO} text-anchor="middle">
            OI Δ / 30m %
          </text>
          <text
            x={12}
            y={(y0 + y1) / 2}
            fill={MUTED}
            font-size={`${REPORT_FONT.micro}`}
            font-family={MONO}
            text-anchor="middle"
            transform={`rotate(-90 12 ${(y0 + y1) / 2})`}
          >
            PREMIUM Δ / 30m %
          </text>

          <For each={placed()}>{({ wall, x, y, ly }) => {
            const selected = wall.key === props.selectedKey;
            const color = sideColor(wall.side);
            return (
              <g
                data-testid={`pressure-plane-${wall.key}`}
                role="button"
                tabIndex={0}
                aria-label={`Select ${wallLabel(wall.side, wall.strike)}`}
                onClick={() => props.onSelect(wall.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onSelect(wall.key);
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
                  stroke-opacity={selected ? 0.95 : 0.7}
                  stroke-width={1}
                  pointer-events="none"
                />
                <Show when={selected}>
                  <circle
                    cx={x}
                    cy={y}
                    r={8}
                    fill="none"
                    stroke={SELECTED}
                    stroke-opacity={0.5}
                    stroke-width={1}
                    pointer-events="none"
                  />
                </Show>
                <Show when={wall.side === "CALL"}>
                  <circle
                    cx={x}
                    cy={y}
                    r={selected ? 5 : 3.7}
                    fill={color}
                    stroke={selected ? SELECTED : SURFACE}
                    stroke-width={selected ? 2 : 1.5}
                  />
                </Show>
                <Show when={wall.side !== "CALL"}>
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
                </Show>
                <Show when={wall.side === "CALL"} fallback={
                  <rect x={x1 + 10} y={ly - 6} width={6} height={6} rx={1} fill={color} pointer-events="none" />
                }>
                  <circle cx={x1 + 13} cy={ly - 3} r={3} fill={color} pointer-events="none" />
                </Show>
                <text
                  x={x1 + 22}
                  y={ly}
                  fill={selected ? SELECTED : MUTED}
                  font-size={`${REPORT_FONT.micro}`}
                  font-weight={selected ? 700 : 400}
                  font-family={MONO}
                  pointer-events="none"
                >
                  {wall.strike.toLocaleString("en-IN")} {wall.side === "CALL" ? "CE" : "PE"}
                </text>
              </g>
            );
          }}</For>
        </svg>
      </div>
      <div class="mt-1 font-mono text-ui-micro text-fin-text-muted">
        x = OI Δ / 30m · y = premium Δ / 30m · ±16% · click a dot or a row
      </div>
      <div class="flex items-center gap-2 mt-1">
        <div class="flex items-center gap-[3px]">
          <SideMark side="CALL" />
          <div class="text-ui-micro text-fin-text-muted">call</div>
        </div>
        <div class="flex items-center gap-[3px]">
          <SideMark side="PUT" />
          <div class="text-ui-micro text-fin-text-muted">put</div>
        </div>
      </div>
    </div>
  );
}
