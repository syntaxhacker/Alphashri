import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Box, Text, Tooltip } from "@/ui";
import { useMediaQuery } from "@/ui/hooks";
import {
  CREAM,
  ROTATION_IMPROVING,
  ROTATION_LAGGING,
  ROTATION_LEADING,
  ROTATION_WEAKENING,
  SURFACE,
  SURFACE_ALT,
  TEXT,
  TEXT_MUTED,
} from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { formatSectorPercentage as formatPercentage } from "./sectorUtils";
import type { RotationQuadrant, RotationRow } from "@/types/rotation";

const QUADRANT_COLORS: Record<RotationQuadrant, string> = {
  leading: ROTATION_LEADING,
  improving: ROTATION_IMPROVING,
  weakening: ROTATION_WEAKENING,
  lagging: ROTATION_LAGGING,
};

/** A group with an unknown quadrant must not crash the RRG paint path. */
function safeTint(color: string | null | undefined, opacity: number): string {
  const token = typeof color === "string" && color.length > 0 ? color : TEXT_MUTED;
  return withAlpha(token, opacity);
}

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

function shortName(name: string, max = 22): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/** Dot radius grows with the group's member count (4–9px). */
function dotRadius(row: RotationRow): number {
  return 4 + Math.min(5, Math.sqrt(Math.max(1, row.members)) * 0.55);
}

export const RRG_LABEL_HEIGHT = 18;
const LABEL_PAD = 4;
const LABEL_GAP = 4;
const TICK_RESERVE = 26;
const DOT_GAP = 8;
export const RRG_COMPACT_FALLBACK = { w: 320, h: 200 };
export const RRG_DESKTOP_FALLBACK = { w: 640, h: 320 };

export interface RrgLabelCandidate {
  id: string;
  name: string;
  px: number;
  py: number;
  selected: boolean;
}

export interface RrgLabelBox {
  id: string;
  name: string;
  selected: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  below: boolean;
}

function boxesIntersect(a: RrgLabelBox, b: RrgLabelBox): boolean {
  return (
    a.x < b.x + b.w + LABEL_GAP &&
    a.x + a.w + LABEL_GAP > b.x &&
    a.y < b.y + b.h + LABEL_GAP &&
    a.y + a.h + LABEL_GAP > b.y
  );
}

function labelWidth(name: string, compact: boolean): number {
  // 12px UI sans advances ~7.2px; the extra 16px is the two 4px paddings plus
  // the rounding slack that used to turn every 12-character compact label into
  // "Consumer N…". A box must be wide enough for the text it was measured for.
  return Math.min(compact ? 172 : 168, Math.max(52, name.length * 7.8 + 16));
}

/**
 * Pixel-space label layout: selected first (always placed), then the most
 * extreme groups. A candidate is dropped when neither side stays inside the
 * plot and clear of every placed box or reserved quadrant caption, so compact
 * plots cannot stack labels on top of LEADING/WEAKENING.
 */
export function layoutRrgLabels(
  candidates: RrgLabelCandidate[],
  width: number,
  height: number,
  compact: boolean,
  obstacles: RrgLabelBox[] = [],
): RrgLabelBox[] {
  if (width <= 0 || height <= 0) return [];
  const placed: RrgLabelBox[] = [];

  for (const candidate of candidates) {
    const display = shortName(candidate.name, compact ? 20 : 22);
    const h = RRG_LABEL_HEIGHT;
    const w = Math.min(labelWidth(display, compact), Math.max(24, width - LABEL_PAD * 2));
    const dotX = (candidate.px / 100) * width;
    const dotY = (1 - candidate.py / 100) * height;
    const primaryBelow = dotY < height / 2;
    let box: RrgLabelBox | null = null;

    for (const below of [primaryBelow, !primaryBelow]) {
      let y = below ? dotY + DOT_GAP : dotY - h - DOT_GAP;
      const maxY = height - TICK_RESERVE - h;
      if (below && y > maxY) {
        if (!candidate.selected) continue;
        y = maxY;
      } else if (!below && y < LABEL_PAD) {
        if (!candidate.selected) continue;
        y = LABEL_PAD;
      }
      y = Math.max(LABEL_PAD, Math.min(y, maxY));
      const x = Math.max(LABEL_PAD, Math.min(dotX - w / 2, width - LABEL_PAD - w));
      const next: RrgLabelBox = {
        id: candidate.id,
        name: display,
        selected: candidate.selected,
        x,
        y,
        w,
        h,
        below,
      };
      if (
        !placed.some((other) => boxesIntersect(other, next)) &&
        !obstacles.some((other) => boxesIntersect(other, next))
      ) {
        box = next;
        break;
      }
    }
    if (box) placed.push(box);
  }

  return placed;
}

function Meta(props: { label: string; value: string }) {
  return (
    <>
      <Text className="text-ui-micro leading-[1.35] text-fin-text-muted">{props.label}</Text>
      <Text
        className="text-ui-micro leading-[1.35] font-mono text-right tabular-nums"
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
  const compact = useMediaQuery("(max-width: 640px)", undefined, { noSsr: true });
  const rows = () => props.rows;
  const selectedId = () => props.selectedId;
  const xDomain = createMemo(() => domainOf(rows().map((r) => r.rs_pct)));
  const yDomain = createMemo(() => domainOf(rows().map((r) => r.mom_pct)));
  const x = (v: number) => scale(v, xDomain());
  const y = (v: number) => scale(v, yDomain());

  const selectedRow = createMemo(
    () => rows().find((r) => r.id === selectedId()) ?? rows()[0] ?? null,
  );

  const [plotEl, setPlotEl] = createSignal<HTMLElement>();
  const [plotSize, setPlotSize] = createSignal(
    compact() ? RRG_COMPACT_FALLBACK : RRG_DESKTOP_FALLBACK,
  );

  createEffect(() => {
    const el = plotEl();
    if (!el) return;
    const measure = () => {
      const fallback = compact() ? RRG_COMPACT_FALLBACK : RRG_DESKTOP_FALLBACK;
      setPlotSize({
        w: el.clientWidth > 0 ? el.clientWidth : fallback.w,
        h: el.clientHeight > 0 ? el.clientHeight : fallback.h,
      });
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    onCleanup(() => observer?.disconnect());
  });

  // Compact plots get the selection plus the four most extreme groups; larger
  // plots can afford the existing ten-label budget.
  const labelCandidates = createMemo(() => {
    const sorted = [...rows()].sort((a, b) => extremity(b) - extremity(a));
    const selected = selectedRow();
    const out: RotationRow[] = [];
    if (selected) out.push(selected);
    const limit = compact() ? 5 : MAX_LABELS;
    for (const row of sorted) {
      if (out.length >= limit) break;
      if (!out.some((item) => item.id === row.id)) out.push(row);
    }
    return out;
  });

  // The quadrant captions are part of the plot, so a sector label that lands on
  // LEADING/WEAKENING is as unreadable as a label-on-label overlap.
  const quadrantCaptionBoxes = createMemo<RrgLabelBox[]>(() => {
    const w = plotSize().w;
    const h = plotSize().h;
    if (w <= 0 || h <= 0) return [];
    const pad = compact() ? 30 : 12;
    const crossY = (1 - y(50) / 100) * h;
    const caption = (name: string, leftSide: boolean, bottomSide: boolean) => {
      const boxW = Math.min(104, name.length * 7.8 + 16);
      const boxH = 16;
      const boxY = Math.max(
        LABEL_PAD,
        Math.min(bottomSide ? crossY + 4 : crossY - 4 - boxH, h - TICK_RESERVE - boxH),
      );
      return {
        id: `quadrant:${name}`,
        name,
        selected: false,
        x: leftSide ? pad : Math.max(pad, w - pad - boxW),
        y: boxY,
        w: boxW,
        h: boxH,
        below: bottomSide,
      } satisfies RrgLabelBox;
    };
    return [
      caption("IMPROVING", true, false),
      caption("LEADING", false, false),
      caption("LAGGING", true, true),
      caption("WEAKENING", false, true),
    ];
  });

  const labelBoxes = createMemo(() =>
    layoutRrgLabels(
      labelCandidates().map((row) => ({
        id: row.id,
        name: row.name,
        px: x(row.rs_pct),
        py: y(row.mom_pct),
        selected: row.id === selectedId(),
      })),
      plotSize().w,
      plotSize().h,
      compact(),
      quadrantCaptionBoxes(),
    ),
  );

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
      className="flex w-full max-w-full flex-col flex-1 h-full min-h-0 min-w-0 overflow-hidden"
    >
      <Box
        data-testid="rotation-rrg-plot"
        className="grid w-full min-w-0 flex-1 min-h-0 grid-cols-[16px_28px_minmax(0,1fr)] gap-x-[4px] overflow-hidden p-2 pb-[4px]"
      >
        <Box className="flex h-full w-[16px] min-w-0 items-center justify-center overflow-hidden">
          <Box
            component="span"
            data-testid="rotation-rrg-axis-title"
            className="text-ui-micro leading-none tracking-[0.6px] uppercase text-fin-text-muted whitespace-nowrap"
            style={{ "writing-mode": "vertical-rl", transform: "rotate(180deg)" }}
          >
            Momentum
          </Box>
        </Box>

        <Box
          data-testid="rotation-rrg-y-axis"
          className="relative h-full w-[28px] min-w-0 overflow-hidden"
        >
          <For each={yTicks()}>
            {(tick) => {
            const isLo = tick === yDomain().lo;
            const isHi = tick === yDomain().hi;
            return (
              <Box
                data-testid={`rotation-rrg-y-tick-${isLo ? "lo" : isHi ? "hi" : "mid"}`}
                className="absolute text-right font-mono text-ui-micro text-fin-text-muted tabular-nums whitespace-nowrap"
                style={{
                  right: "4px",
                  bottom: isLo ? "6px" : isHi ? "auto" : `${y(tick)}%`,
                  top: isHi ? "6px" : "auto",
                  transform: isLo || isHi ? "none" : "translateY(50%)",
                }}
              >
                {Math.round(tick)}
              </Box>
            );
            }}
          </For>
        </Box>

        <Box
          ref={setPlotEl}
          data-testid="rotation-rrg-chart"
          data-plot-width={plotSize().w}
          data-plot-height={plotSize().h}
          className="relative h-full w-full max-w-full flex-1 min-w-0 min-h-0 border border-fin-border rounded-[1px] overflow-hidden bg-fin-surface"
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
                      "background-color": safeTint(color, 0.055),
                    }}
                  >
                    <Box
                      component="span"
                      className="absolute font-bold tracking-[0.6px] whitespace-nowrap text-ui-micro"
                      style={{
                        // Both rows hug the 50/50 crosshair, never the outer
                        // axis where the month and benchmark ticks live. At
                        // compact widths the labels shift in far enough to
                        // clear the inset x/y tick labels in the corners.
                        top: topSide ? "auto" : "4px",
                        bottom: topSide ? "4px" : "auto",
                        left: leftSide ? (compact() ? "30px" : "12px") : "auto",
                        right: leftSide ? "auto" : compact() ? "30px" : "12px",
                        // The tint is the area, never the ink: saturated
                        // quadrant colours fail 4.5:1 on the tinted fill.
                        color: TEXT,
                        // A dot can land anywhere in the quadrant. The caption
                        // owns its 16px strip so a mark behind it cannot turn
                        // LEADING into a smudge.
                        "background-color": SURFACE,
                        // Above the selected dot (z=6): a caption must stay
                        // readable even when a mark lands on the crosshair.
                        "z-index": 8,
                        padding: "0 6px",
                        "line-height": "16px",
                        "box-shadow": `0 0 0 2px ${SURFACE}`,
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
                  "border-left": "1px dashed var(--color-fin-border)",
                }}
              />
              <Box
                className="absolute pointer-events-none"
                style={{
                  left: 0,
                  right: 0,
                  bottom: `${cy()}%`,
                  "border-top": "1px dashed var(--color-fin-border)",
                }}
              />

              <For each={xTicks()}>
                {(tick) => {
                const isLo = tick === xDomain().lo;
                const isHi = tick === xDomain().hi;
                return (
                  <Box
                    data-testid={`rotation-rrg-x-tick-${isLo ? "lo" : isHi ? "hi" : "mid"}`}
                    className="font-mono absolute pointer-events-none text-ui-micro text-fin-text-muted tabular-nums"
                    style={{
                      left: isLo ? "8px" : isHi ? "auto" : `${x(tick)}%`,
                      right: isHi ? "10px" : "auto",
                      bottom: "6px",
                      transform: isLo || isHi ? "none" : "translateX(-50%)",
                    }}
                  >
                    {Math.round(tick)}
                  </Box>
                );
                }}
              </For>

              <For each={rows()}>
                {(row) => {
                const color = QUADRANT_COLORS[row.quadrant];
                const selected = row.id === selectedId();
                const labelled = () => labelBoxes().some((box) => box.id === row.id);
                const r = dotRadius(row) + (selected ? 2 : 0);
                const px = x(row.rs_pct);
                const py = y(row.mom_pct);
                // `100%` would put half the mark outside the plot. Keep the
                // whole dot (plus its selected ring) inside the chart box at
                // every viewport; the axis still labels the true 100 edge.
                const center = () => {
                  const width = plotSize().w;
                  const height = plotSize().h;
                  const margin = r + (selected ? 4 : 2);
                  return {
                    x: Math.max(margin, Math.min(width - margin, (px / 100) * width)),
                    y: Math.max(
                      margin,
                      Math.min(height - margin, (1 - py / 100) * height),
                    ),
                  };
                };
                return (
                  <>
                    <Box
                      data-testid={`rotation-rrg-dot-anchor-${row.id}`}
                      className="absolute"
                      style={{
                        left: `${center().x}px`,
                        top: `${center().y}px`,
                        transform: "translate(-50%, -50%)",
                        "z-index": selected ? 6 : 3,
                      }}
                    >
                      <Tooltip
                        position="top"
                        openDelay={120}
                        withArrow
                        label={
                          <Box className="min-w-[148px]">
                            <Text className="text-ui-micro font-bold leading-[1.25]">
                              {row.name}
                            </Text>
                            <Text className="text-ui-micro leading-[1.3] text-fin-text-muted">
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
                          data-testid={`rotation-rrg-dot-${row.id}`}
                          data-labelled={labelled() ? "true" : "false"}
                          aria-label={`${row.name} — ${QUADRANT_LABELS[row.quadrant]}`}
                          onClick={() => props.onSelect(row.id)}
                          className="block rounded-full p-0 cursor-pointer transition-transform duration-[120ms] hover:scale-135 focus-visible:outline-[1px] focus-visible:outline-solid focus-visible:outline-offset-[2px] focus-visible:outline-fin-text"
                          style={{
                            width: `${r * 2}px`,
                            height: `${r * 2}px`,
                            border: selected
                              ? `1.5px solid ${CREAM}`
                              : `1px solid ${safeTint(color, labelled() ? 0.9 : 0.55)}`,
                            "background-color": safeTint(
                              color,
                              selected ? 1 : labelled() ? 0.9 : 0.45,
                            ),
                            "box-shadow": selected
                              ? `0 0 0 3px ${safeTint(color, 0.25)}`
                              : "none",
                          }}
                        />
                      </Tooltip>
                    </Box>
                  </>
                );
                }}
              </For>

              <For each={labelBoxes()}>
                {(box) => (
                  <Box
                    data-testid={`rotation-rrg-label-${box.id}`}
                    data-side={box.below ? "below" : "above"}
                    data-surface={box.selected ? "raised" : "panel"}
                    className="absolute flex items-center overflow-hidden pointer-events-none rounded-[0.5px] px-[4px]"
                    style={{
                      left: `${box.x}px`,
                      top: `${box.y}px`,
                      width: `${box.w}px`,
                      height: `${box.h}px`,
                      "z-index": box.selected ? 5 : 2,
                      "background-color": box.selected ? SURFACE_ALT : SURFACE,
                    }}
                  >
                    <Text
                      className="text-ui-micro leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{
                        "font-weight": box.selected ? 700 : 500,
                        color: box.selected ? TEXT : TEXT_MUTED,
                      }}
                    >
                      {box.name}
                    </Text>
                  </Box>
                )}
              </For>
            </>
          }>
            <Box className="absolute inset-0 flex items-center justify-center">
              <Text className="text-ui-micro text-fin-text-muted">No rotation groups</Text>
            </Box>
          </Show>
        </Box>
      </Box>

      <Show when={rows().length > 0}>
        <Box
          data-testid="rotation-rrg-compact-summary"
          className="flex min-w-0 items-center gap-1.5 px-2 pb-1 xl:hidden"
        >
          <Show when={selectedRow()}>
            {(row) => (
              <>
                <Box
                  className="size-[6px] shrink-0 rounded-full"
                  style={{ "background-color": QUADRANT_COLORS[row().quadrant] ?? TEXT_MUTED }}
                />
                <Text truncate className="min-w-0 text-ui-micro font-semibold text-fin-text">
                  {row().name}
                </Text>
                <Text className="shrink-0 text-ui-micro font-bold tracking-[0.3px] text-fin-text-muted">
                  {QUADRANT_LABELS[row().quadrant] ?? ""}
                </Text>
              </>
            )}
          </Show>
          <Box className="flex-1" />
          <Text className="shrink-0 text-ui-micro text-fin-text-muted">
            {rows().length} groups
          </Text>
        </Box>
      </Show>

      <Show when={rows().length > 0}>
        <Box
          data-testid="rotation-rrg-legend"
          className="hidden flex-wrap items-center gap-x-2 gap-y-0.5 px-2 pb-1 xl:flex"
        >
          <For each={rows()}>
            {(row) => (
              <Box
                data-testid={`rrg-legend-${row.id}`}
                className="inline-flex min-w-0 items-center gap-1"
              >
                <Box
                  className="size-[6px] shrink-0 rounded-full"
                  style={{ "background-color": QUADRANT_COLORS[row.quadrant] ?? TEXT_MUTED }}
                />
                <Text className="text-ui-micro text-fin-text-muted">
                  {shortName(row.name, 22)}
                </Text>
              </Box>
            )}
          </For>
        </Box>
      </Show>

      <Box
        data-testid="rotation-rrg-footer"
        className="flex w-full min-w-0 flex-col gap-y-0.5 px-2 pb-[6px] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-2"
      >
        <Text className="shrink-0 whitespace-nowrap text-ui-micro tracking-[0.6px] uppercase text-fin-text-muted">
          RS 1M percentile
        </Text>
        <Box
          data-testid="rotation-rrg-count-legend"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
        >
          <For each={["leading", "improving", "weakening", "lagging"] as RotationQuadrant[]}>
            {(key) => (
            <Box
              data-testid={`rotation-rrg-count-${key}`}
              className="inline-flex shrink-0 items-center gap-[3.2px]"
            >
              <Box className="size-[5px] rounded-full shrink-0" style={{ "background-color": QUADRANT_COLORS[key] }} />
              <Text className="text-ui-micro font-bold tracking-[0.3px] text-fin-text-muted">
                {QUADRANT_LABELS[key]}
              </Text>
              <Text className="font-mono text-ui-micro font-semibold text-fin-text-muted tabular-nums">
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
