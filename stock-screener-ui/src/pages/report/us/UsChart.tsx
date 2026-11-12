import { createMemo, For, Show } from "solid-js";

import { Text } from "@/ui";
import { INFO, NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
import type { UsRow } from "../../../types/usReport";
import { buildChart, fmtInt, fmtNum, fmtTime, niceTicks, toBars } from "./usReportMath";

const H = 260;

interface Props {
  frames: UsRow[];
  cursor: number;
  /** Candle aggregation in minutes: 1, 5 or 15. */
  bucket?: number;
}

interface Wall {
  v: number;
  color: string;
  label: string;
}

/** Candles + only the walls that fit the traded range; far walls get edge tags. */
export function UsChart(props: Props) {
  const bucket = () => props.bucket ?? 1;
  const bars = createMemo(() => toBars(props.frames, bucket()));
  const frame = () =>
    props.frames[Math.max(0, Math.min(props.cursor, props.frames.length - 1))] ?? null;

  const barIdx = createMemo(() => {
    const f = frame();
    const b = bars();
    if (!b.length || !f) return 0;
    const i = b.findIndex((x) => x.t >= f.t);
    return i < 0 ? b.length - 1 : i;
  });

  const nearWalls = createMemo(() => {
    const f = frame();
    if (!f) return [];
    return [f.put_wall, f.call_wall, f.max_pain].filter(
      (v) => Number.isFinite(v) && Math.abs(v / f.spot - 1) <= 0.015,
    );
  });
  const g = createMemo(() => buildChart(bars(), barIdx(), nearWalls()));

  const walls = (): Wall[] => {
    const f = frame();
    if (!f) return [];
    return [
      { v: f.put_wall, color: NEGATIVE, label: "PUT" },
      { v: f.call_wall, color: POSITIVE, label: "CALL" },
      { v: f.max_pain, color: WARNING, label: "PAIN" },
    ];
  };
  const inRange = () => {
    const gg = g();
    return gg ? walls().filter((w) => w.v >= gg.min && w.v <= gg.max) : [];
  };
  const above = () => {
    const gg = g();
    return gg ? walls().filter((w) => w.v > gg.max) : [];
  };
  const below = () => {
    const gg = g();
    return gg ? walls().filter((w) => w.v < gg.min) : [];
  };

  const yFor = (v: number) => {
    const gg = g()!;
    return H - ((v - gg.min) / (gg.max - gg.min)) * H;
  };
  const pctFor = (v: number) => {
    const gg = g()!;
    return 100 - ((v - gg.min) / (gg.max - gg.min)) * 100;
  };
  const step = () => {
    const gg = g()!;
    return gg.width / Math.max(1, bars().length);
  };
  const bodyW = () => Math.max(1.2, Math.min(16, step() * 0.66));
  const ticks = () => {
    const gg = g()!;
    return niceTicks(gg.min, gg.max, 4);
  };
  const last = () => bars()[bars().length - 1];
  const first = () => bars()[0];

  return (
    <Show
      when={g() && frame()}
      fallback={
        <div class="flex-1 grid place-items-center border border-fin-border">
          <Text size="xs" c="dimmed">
            no tape yet
          </Text>
        </div>
      }
    >
    <div
      data-testid="us-chart"
      class="flex-1 min-h-0 relative border border-fin-border overflow-hidden"
    >
      <svg
        viewBox={`0 0 ${g()!.width} ${H}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        shapeRendering="crispEdges"
        role="img"
        aria-label="NQ candles against put wall, call wall and max pain"
      >
        <For each={ticks()}>{(t) => (
          <line x1={0} x2={g()!.width} y1={yFor(t)} y2={yFor(t)} stroke="rgba(255,255,255,0.05)" stroke-width={1} vectorEffect="non-scaling-stroke" />
        )}</For>

        <For each={inRange()}>{(w) => (
          <line
            x1={0}
            x2={g()!.width}
            y1={yFor(w.v)}
            y2={yFor(w.v)}
            stroke={w.color}
            stroke-width={1}
            strokeDasharray={w.label === "PAIN" ? "2 5" : "6 4"}
            vectorEffect="non-scaling-stroke"
            opacity={0.75}
          />
        )}</For>

        <For each={bars()}>{(b, i) => {
          const x = step() * i() + step() / 2;
          const up = b.c >= b.o;
          const color = up ? POSITIVE : NEGATIVE;
          const top = yFor(Math.max(b.o, b.c));
          const bottom = yFor(Math.min(b.o, b.c));
          return (
            <g key={b.t}>
              <line x1={x} x2={x} y1={yFor(b.h)} y2={yFor(b.l)} stroke={color} stroke-width={1} vectorEffect="non-scaling-stroke" opacity={0.95} />
              <rect
                x={x - bodyW / 2}
                y={top}
                width={bodyW}
                height={Math.max(1.2, bottom - top)}
                fill={color}
                opacity={up ? 0.9 : 0.95}
              />
            </g>
          );
        }}
        </For>

        <line x1={g()!.cursorX} x2={g()!.cursorX} y1={0} y2={H} stroke="rgba(240,246,252,0.4)" stroke-width={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={g()!.width} y1={yFor(frame()!.spot)} y2={yFor(frame()!.spot)} stroke={INFO} stroke-width={1} strokeDasharray="1 3" vectorEffect="non-scaling-stroke" opacity={0.6} />
      </svg>

      {/* y-axis ticks */}
      <For each={ticks()}>
        {(t) => (
          <div
            class="absolute left-[3px] font-mono text-[9px] text-fin-text-muted bg-black/55 px-0.5 pointer-events-none"
            style={{ top: pctFor(t) > 94 ? "calc(100% - 12px)" : pctFor(t) < 6 ? "2px" : `calc(${pctFor(t)}% - 5px)` }}
          >
            {fmtInt(t)}
          </div>
        )}
      </For>

      {/* in-range wall labels, pinned to the right edge */}
      <For each={inRange()}>
        {(w, i) => (
          <div
            class="absolute right-1 font-mono text-[9px] bg-black/65 px-1 leading-[11px] pointer-events-none"
            style={{ top: `calc(${pctFor(w.v)}% - 6px)`, color: w.color, "border-left": `2px solid ${w.color}`, "z-index": 2 + i() }}
          >
            {w.label} {fmtInt(w.v)}
          </div>
        )}
      </For>

      {/* far walls: edge tags instead of stretching the scale */}
      <Show when={above().length > 0}>
        <div class="absolute top-[2px] right-1 flex gap-1 font-mono text-[9px] pointer-events-none">
          <For each={above()}>
            {(w) => (
              <Text size="xs" span style={{ color: w.color }}>
                ↑ {w.label} {fmtInt(w.v)} ({fmtNum(((w.v - frame()!.spot) / frame()!.spot) * 100, 1)}%)
              </Text>
            )}
          </For>
        </div>
      </Show>
      <Show when={below().length > 0}>
        <div class="absolute bottom-[14px] right-1 flex gap-1 font-mono text-[9px] pointer-events-none">
          <For each={below()}>
            {(w) => (
              <Text size="xs" span style={{ color: w.color }}>
                ↓ {w.label} {fmtInt(w.v)} ({fmtNum(((w.v - frame()!.spot) / frame()!.spot) * 100, 1)}%)
              </Text>
            )}
          </For>
        </div>
      </Show>

      {/* last price chip */}
      <div
        class="absolute right-1 font-mono text-[9.5px] font-bold bg-black/75 px-1 leading-[12px] pointer-events-none"
        style={{ top: `calc(${pctFor(last().c)}% - 7px)`, color: INFO, "border-left": `2px solid ${INFO}` }}
      >
        {fmtInt(last().c)}
      </div>

      {/* x-axis */}
      <div
        class="absolute left-[46px] right-[60px] bottom-[1px] flex justify-between font-mono text-[9px] text-fin-text-muted pointer-events-none"
      >
        <span>{fmtTime(first().t)}</span>
        <span>{fmtTime(frame()!.t)} ET</span>
        <span>{fmtTime(last().t)}</span>
      </div>
    </div>
    </Show>
  );
}
