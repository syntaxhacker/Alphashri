import { For, Show, createMemo } from "solid-js";
import { Box, Text, Tooltip } from "@/ui";
import { CREAM, TEXT, TEXT_MUTED } from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { formatPercentage } from "@/utils/ui-helpers";
import type { RotationQuadrant, RotationRow } from "@/types/rotation";

const QUADRANT_COLORS: Record<RotationQuadrant, string> = {
  leading: "#4C9A8F",
  improving: "#5B8DEF",
  weakening: "#C9A227",
  lagging: "#C05A5A",
};

const QUADRANT_LABELS: Record<RotationQuadrant, string> = {
  leading: "LEADING",
  improving: "IMPROVING",
  weakening: "WEAKENING",
  lagging: "LAGGING",
};

const MAX_LABELS = 10;

/** Data-driven domain that always contains the 50% benchmark line. */
function domainOf(values: number[]): { lo: number; hi: number } {
  if (values.length === 0) return { lo: 25, hi: 75 };
  const min = Math.min(50, ...values);
  const max = Math.max(50, ...values);
  const span = Math.max(8, max - min);
  const pad = span * 0.14;
  return { lo: Math.max(0, min - pad), hi: Math.min(100, max + pad) };
}

function scale(value: number, domain: { lo: number; hi: number }): number {
  const span = domain.hi - domain.lo || 1;
  return Math.max(0, Math.min(100, ((value - domain.lo) / span) * 100));
}

function extremity(row: RotationRow): number {
  return Math.abs(row.rs_pct - 50) + Math.abs(row.mom_pct - 50);
}

function shortName(name: string): string {
  return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

/** Dot radius grows with the group's member count (4–9px). */
function dotRadius(row: RotationRow): number {
  return 4 + Math.min(5, Math.sqrt(Math.max(1, row.members)) * 0.55);
}

function Meta(props: { label: string; value: string }) {
  return (
    <>
      <Text className="text-[9.5px] leading-[1.35] text-fin-text-muted">{props.label}</Text>
      <Text
        className="text-[9.5px] leading-[1.35] font-mono text-right tabular-nums"
      >
        {props.value}
      </Text>
    </>
  );
}

export interface RotationRrgProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RotationRrg(props: RotationRrgProps) {
  const rows = () => props.rows;
  const selectedId = () => props.selectedId;
  const xDomain = createMemo(() => domainOf(rows().map((r) => r.rs_pct)));
  const yDomain = createMemo(() => domainOf(rows().map((r) => r.mom_pct)));
  const x = (v: number) => scale(v, xDomain());
  const y = (v: number) => scale(v, yDomain());

  // Labels: the most extreme groups plus the selection, dropping any label
  // whose anchor sits on top of one already placed.
  const labelledIds = createMemo(() => {
    const placed: { x: number; y: number }[] = [];
    const ids = new Set<string>();
    const sorted = [...rows()].sort((a, b) => extremity(b) - extremity(a));
    for (const row of sorted) {
      if (ids.size >= MAX_LABELS && row.id !== selectedId()) continue;
      const px = scale(row.rs_pct, xDomain());
      const py = scale(row.mom_pct, yDomain());
      const collides = placed.some((p) => Math.abs(p.x - px) < 8 && Math.abs(p.y - py) < 7);
      if (collides && row.id !== selectedId()) continue;
      placed.push({ x: px, y: py });
      ids.add(row.id);
    }
    return ids;
  });

  const counts = createMemo(() => {
    const base: Record<RotationQuadrant, number> = {
      leading: 0,
      improving: 0,
      weakening: 0,
      lagging: 0,
    };
    for (const row of rows()) base[row.quadrant] += 1;
    return base;
  });

  const xTicks = () => [xDomain().lo, 50, xDomain().hi];
  const yTicks = () => [yDomain().lo, 50, yDomain().hi];
  const cx = () => x(50);
  const cy = () => y(50);

  return (
    <Box
      data-testid="rotation-rrg"
      className="flex flex-col flex-1 h-full min-h-0 min-w-0"
    >
      <Box className="flex-1 min-h-0 flex gap-[6px] p-2 pb-[4px]">
        <Box className="w-[12px] shrink-0 flex items-center justify-center">
          <Box
            component="span"
            className="writing-mode-vertical-rl rotate-180 text-[9px] tracking-[0.6px] uppercase text-fin-text-muted whitespace-nowrap"
          >
            Momentum
          </Box>
        </Box>

        <Box
          data-testid="rotation-rrg-chart"
          className="relative flex-1 min-w-0 min-h-0 border border-fin-border rounded-[1px] overflow-hidden bg-fin-surface"
        >
          <Show when={rows().length === 0} fallback={
            <>
              {/* Quadrant tints anchored to the scaled 50/50 split. */}
              <For each={[
                  { key: "improving" as RotationQuadrant, left: 0, top: 0, w: cx(), h: 100 - cy() },
                  { key: "leading" as RotationQuadrant, left: cx(), top: 0, w: 100 - cx(), h: 100 - cy() },
                  { key: "lagging" as RotationQuadrant, left: 0, top: 100 - cy(), w: cx(), h: cy() },
                  { key: "weakening" as RotationQuadrant, left: cx(), top: 100 - cy(), w: 100 - cx(), h: cy() },
                ]}>
                {({ key, left, top, w, h }) => {
                const color = QUADRANT_COLORS[key];
                const topSide = top === 0;
                const leftSide = left === 0;
                return (
                  <Box
                    className="absolute pointer-events-none"
                    style={{
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${w}%`,
                      height: `${h}%`,
                      backgroundColor: withAlpha(color, 0.055),
                    }}
                  >
                    <Box
                      component="span"
                      className="absolute font-bold tracking-[0.6px] whitespace-nowrap text-[8.5px]"
                      style={{
                        top: topSide ? 5 : "auto",
                        bottom: topSide ? "auto" : 5,
                        left: leftSide ? 6 : "auto",
                        right: leftSide ? "auto" : 6,
                        color: withAlpha(color, 0.95),
                      }}
                    >
                      {QUADRANT_LABELS[key]}
                    </Box>
                  </Box>
                );
                }}
              </For>

              {/* Benchmark crosshair. */}
              <Box
                className="absolute pointer-events-none"
                style={{
                  top: 0,
                  bottom: 0,
                  left: `${cx()}%`,
                  borderLeft: "1px dashed var(--color-fin-border)",
                }}
              />
              <Box
                className="absolute pointer-events-none"
                style={{
                  left: 0,
                  right: 0,
                  bottom: `${cy()}%`,
                  borderTop: "1px dashed var(--color-fin-border)",
                }}
              />

              <For each={xTicks()}>
                {(tick) => {
                const isLo = tick === xDomain().lo;
                const isHi = tick === xDomain().hi;
                return (
                  <Box
                    className="absolute pointer-events-none text-[8px] text-fin-text-muted tabular-nums"
                    style={{
                      left: isLo ? 4 : isHi ? "auto" : `${x(tick)}%`,
                      right: isHi ? 4 : "auto",
                      bottom: 3,
                      transform: isLo || isHi ? "none" : "translateX(-50%)",
                    }}
                  >
                    {Math.round(tick)}
                  </Box>
                );
                }}
              </For>
              <For each={yTicks()}>
                {(tick) => {
                const isLo = tick === yDomain().lo;
                const isHi = tick === yDomain().hi;
                return (
                  <Box
                    className="absolute pointer-events-none text-[8px] text-fin-text-muted tabular-nums"
                    style={{
                      right: 4,
                      bottom: isLo ? 2 : isHi ? "auto" : `${y(tick)}%`,
                      top: isHi ? 2 : "auto",
                      transform: isLo || isHi ? "none" : "translateY(50%)",
                    }}
                  >
                    {Math.round(tick)}
                  </Box>
                );
                }}
              </For>

              <For each={rows()}>
                {(row, index) => {
                const color = QUADRANT_COLORS[row.quadrant];
                const selected = row.id === selectedId();
                const r = dotRadius(row) + (selected ? 2 : 0);
                const px = x(row.rs_pct);
                const py = y(row.mom_pct);
                const below = (index() % 2 === 1 || py > 80) && !selected && py > 6;
                const anchor =
                  px > 80 ? "translateX(-100%)" : px < 20 ? "none" : "translateX(-50%)";
                return (
                  <>
                    <Box
                      className="absolute"
                      style={{
                        left: `${px}%`,
                        bottom: `${py}%`,
                        transform: "translate(-50%, 50%)",
                        zIndex: selected ? 6 : 3,
                      }}
                    >
                      <Tooltip
                        position="top"
                        openDelay={120}
                        withArrow
                        label={
                          <Box className="min-w-[148px]">
                            <Text className="text-[11px] font-bold leading-[1.25]">
                              {row.name}
                            </Text>
                            <Text className="text-[9.5px] leading-[1.3] text-fin-text-muted">
                              {row.category || row.kind} · {row.members} members
                            </Text>
                            <Box
                              className="grid grid-cols-[auto_auto] column-gap-[12px] row-gap-[2px] mt-1"
                            >
                              <Meta label="1D" value={formatPercentage(row.returns["1D"], 2, true)} />
                              <Meta label="1W" value={formatPercentage(row.returns["1W"], 2, true)} />
                              <Meta label="1M" value={formatPercentage(row.returns["1M"], 2, true)} />
                              <Meta label="RS 1M" value={row.rs_1m.toFixed(2)} />
                              <Meta label="Breadth" value={`${row.breadth.toFixed(0)}%`} />
                              <Meta label="Status" value={row.status.toUpperCase()} />
                            </Box>
                          </Box>
                        }
                      >
                        <Box
                          component="button"
                          type="button"
                          aria-label={`${row.name} — ${QUADRANT_LABELS[row.quadrant]}`}
                          onClick={() => props.onSelect(row.id)}
                          className="block rounded-full p-0 cursor-pointer transition-transform duration-[120ms] hover:scale-135 focus-visible:outline-[1px] focus-visible:outline-solid focus-visible:outline-offset-[2px] focus-visible:outline-fin-text"
                          style={{
                            width: r * 2,
                            height: r * 2,
                            border: selected
                              ? `1.5px solid ${CREAM}`
                              : `1px solid ${withAlpha(color, 0.9)}`,
                            backgroundColor: withAlpha(color, selected ? 1 : 0.9),
                            boxShadow: selected
                              ? `0 0 0 3px ${withAlpha(color, 0.25)}`
                              : "none",
                          }}
                        />
                      </Tooltip>
                    </Box>
                    <Show when={labelledIds().has(row.id)}>
                      <Box
                        className="absolute pointer-events-none max-w-[132px] px-[2px] rounded-[0.5px]"
                        style={{
                          left: `${px}%`,
                          ...(below
                            ? { top: `calc(${100 - py}% + ${r + 5}px)` }
                            : { bottom: `calc(${py}% + ${r + 5}px)` }),
                          transform: anchor,
                          zIndex: selected ? 5 : 2,
                          backgroundColor: selected
                            ? "background.paper"
                            : withAlpha("#000000", 0.38),
                        }}
                      >
                        <Text
                          className="text-[9.5px] leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis"
                          style={{ fontWeight: selected ? 700 : 500, color: selected ? TEXT : TEXT_MUTED }}
                        >
                          {shortName(row.name)}
                        </Text>
                      </Box>
                    </Show>
                  </>
                );
                }}
              </For>
            </>
          }>
            <Box className="absolute inset-0 flex items-center justify-center">
              <Text className="text-[11px] text-fin-text-muted">No rotation groups</Text>
            </Box>
          </Show>
        </Box>
      </Box>

      <Box
        className="flex items-center justify-between gap-2 px-2 pb-[6px] min-w-0"
      >
        <Text className="text-[9px] tracking-[0.6px] uppercase text-fin-text-muted">
          RS 1M percentile
        </Text>
        <Box className="flex items-center gap-2 min-w-0 overflow-hidden">
          <For each={["leading", "improving", "weakening", "lagging"] as RotationQuadrant[]}>
            {(key) => (
            <Box className="inline-flex items-center gap-[3.2px]">
              <Box className="size-[5px] rounded-full shrink-0" style={{ backgroundColor: QUADRANT_COLORS[key] }} />
              <Text className="text-[8.5px] font-bold tracking-[0.3px] text-fin-text-muted">
                {QUADRANT_LABELS[key]}
              </Text>
              <Text className="text-[9px] font-semibold text-fin-text-muted tabular-nums">
                {counts()[key]}
              </Text>
            </Box>
            )}
          </For>
        </Box>
      </Box>
    </Box>
  );
}
