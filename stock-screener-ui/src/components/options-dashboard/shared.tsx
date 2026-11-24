/**
 * Small presentational pieces shared by the four pillars: a focusable, aria-
 * labelled chart frame, the expiry chip row and the metric band. Every panel
 * keeps the same outer shape so switching pillars never shifts the layout.
 */

import { createMemo, For, Show } from "solid-js";
import { Box, Text, useMediaQuery, typeSize } from "@/ui";
import { EXPIRY_CHIP_FOCUS } from "@/config/focusTokens";
import * as palette from "@/ui/palette";
import { AnalyticsChartCore } from "@/components/options-dock/analytics/AnalyticsChartCore";
import { COMPACT_CHART_GRID } from "./chartBase";
import type { ExpiryOption } from "./dataRead";

const NARROW_CHART_QUERY = "(max-width: 1200px)";

/**
 * The pillar grid. On mobile each chart gets its own `minmax(200px, auto)` row
 * and the page body scrolls: `auto-rows-fr` across four rows computed ~135px
 * rows under 200px frames, so the charts overlapped each other and the metric
 * band. From `sm` up the rows share the body height and the grid scrolls
 * itself. `rows` is 1 for a two-chart pillar — a second `fr` row would sit
 * empty.
 */
export function pillarGridClass(rows: 1 | 2): string {
  return [
    "grid min-h-0 grid-cols-1 gap-2 p-1.5",
    "auto-rows-[minmax(200px,auto)]",
    "sm:flex-1 sm:auto-rows-fr sm:grid-cols-2 sm:overflow-x-hidden sm:overflow-y-auto",
    rows === 2 ? "sm:grid-rows-2" : "sm:grid-rows-1",
  ].join(" ");
}

export const PILLAR_CAPTION_CLASS =
  "truncate font-mono text-ui-micro uppercase tracking-[0.06em] text-fin-text-muted";

/**
 * A rotated y-axis name cannot coexist with `containLabel`: the tick-label band
 * grows with the widest number ("15,000,000") while the name gap is fixed, so
 * the name lands on the numbers at one width or the other. The frame prints the
 * unit as DOM text in its top-left corner instead, and the canvas axis goes
 * unnamed.
 */
function yAxisUnit(option: unknown): string {
  const yAxis = (option as Record<string, unknown> | undefined)?.yAxis;
  if (!yAxis || typeof yAxis !== "object" || Array.isArray(yAxis)) return "";
  const name = (yAxis as Record<string, unknown>).name;
  return typeof name === "string" ? name : "";
}

function withoutYAxisName(yAxis: unknown): unknown {
  if (!yAxis || typeof yAxis !== "object" || Array.isArray(yAxis)) return yAxis;
  return { ...(yAxis as Record<string, unknown>), name: "" };
}

const INK = { "font-size": `${typeSize("micro")}px`, "line-height": "1.1", "letter-spacing": "0.06em" } as const;

export interface MetricVM {
  label: string;
  value: string;
  testId: string;
  tone?: "positive" | "negative" | "warning" | "info";
}

const TONE: Record<NonNullable<MetricVM["tone"]>, string> = {
  positive: palette.POSITIVE,
  negative: palette.NEGATIVE,
  warning: palette.WARNING,
  info: palette.INFO,
};

/** A 30px metric band; a missing metric prints an em dash, never disappears. */
export function MetricBand(props: { metrics: MetricVM[]; testId: string }) {
  return (
    <Box
      className="flex h-[30px] shrink-0 items-stretch border-t border-fin-border"
      data-testid={props.testId}
    >
      <For each={props.metrics}>
        {(metric, index) => (
          <Box
            className={`flex min-w-0 flex-1 flex-col justify-center px-1.5${
              index() > 0 ? " border-l border-fin-border" : ""
            }`}
            data-testid={metric.testId}
          >
            <Text size="xs" c="dimmed" className="truncate uppercase" style={INK}>
              {metric.label}
            </Text>
            <Text
              size="xs"
              fw={700}
              className="truncate font-mono tabular-nums"
              style={{
                "font-size": `${typeSize("micro")}px`,
                "line-height": "1.2",
                ...(metric.tone ? { color: TONE[metric.tone] } : {}),
              }}
              data-testid={`${metric.testId}-value`}
            >
              {metric.value}
            </Text>
          </Box>
        )}
      </For>
    </Box>
  );
}

/**
 * ECharts paints to a canvas, which screen readers cannot read. The frame adds
 * a focusable `img` role, a short label and a visually-hidden data summary;
 * the canvas itself stays the shared AnalyticsChartCore (one lifecycle, one
 * empty state, disposed on unmount).
 */
export function ChartFrame(props: {
  testId: string;
  label: string;
  description: string;
  option: unknown;
  optionKey: string;
  empty?: boolean;
  emptyText?: string;
}) {
  const narrow = useMediaQuery(NARROW_CHART_QUERY);
  const unit = createMemo(() => yAxisUnit(props.option));
  const option = createMemo(() => {
    const base = props.option as Record<string, unknown>;
    return {
      ...base,
      ...(narrow() ? { grid: COMPACT_CHART_GRID } : {}),
      yAxis: withoutYAxisName(base.yAxis),
    };
  });
  const key = createMemo(() => `${props.optionKey}|${narrow() ? "narrow" : "wide"}`);
  return (
    <Box
      role="img"
      aria-label={props.label}
      tabIndex={0}
      className="relative flex h-full min-h-[200px] min-w-0 flex-col overflow-hidden rounded-fin border border-fin-border bg-fin-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-fin-primary sm:min-h-[180px]"
      data-testid={`${props.testId}-frame`}
    >
      <Show when={unit()}>
        <Text
          size="xs"
          c="dimmed"
          className="pointer-events-none absolute left-2 top-[3px] z-10 font-mono uppercase"
          style={{ "font-size": `${typeSize("micro")}px`, "letter-spacing": "0.06em" }}
          data-testid={`${props.testId}-unit`}
        >
          {unit()}
        </Text>
      </Show>
      <Text size="xs" className="sr-only" data-testid={`${props.testId}-desc`}>
        {props.description}
      </Text>
      <AnalyticsChartCore
        option={option()}
        optionKey={key()}
        empty={props.empty}
        emptyText={props.emptyText}
        testId={props.testId}
      />
    </Box>
  );
}

export function ExpiryChips(props: {
  options: ExpiryOption[];
  selectedExpiry: string | null;
  onExpiry: (expiry: string) => void;
  testId: string;
}) {
  // Arrow keys move between chips; every chip stays in the Tab order so the
  // group is never a dead end. Enter/Space activate via the native button.
  const moveFocus = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const current = (event.currentTarget ?? event.target) as HTMLButtonElement;
    const group = current.parentElement;
    const chips = Array.from(group?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const idx = chips.indexOf(current);
    if (idx < 0 || chips.length === 0) return;
    event.preventDefault();
    let next = idx;
    if (event.key === "ArrowLeft") next = (idx - 1 + chips.length) % chips.length;
    else if (event.key === "ArrowRight") next = (idx + 1) % chips.length;
    else if (event.key === "Home") next = 0;
    else next = chips.length - 1;
    chips[next].focus();
  };

  return (
    <Box
      className="flex min-h-[24px] shrink-0 flex-wrap items-center gap-1 px-1.5 py-1"
      role="group"
      aria-label="Expiry"
      data-testid={props.testId}
    >
      <Show when={props.options.length > 0} fallback={<Text size="xs" c="dimmed">No expiries</Text>}>
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              role="button"
              aria-pressed={props.selectedExpiry === option.date}
              onKeyDown={moveFocus}
              onClick={() => props.onExpiry(option.date)}
              className={`inline-flex h-[22px] items-center rounded-fin border border-fin-border px-1.5 font-mono text-ui-micro text-fin-text-muted transition-colors hover:bg-fin-surface-alt aria-[pressed=true]:border-fin-primary aria-[pressed=true]:bg-fin-primary/15 aria-[pressed=true]:text-fin-primary ${EXPIRY_CHIP_FOCUS}`}
              data-testid={`${props.testId}-${option.date}`}
            >
              {option.label}
            </button>
          )}
        </For>
      </Show>
    </Box>
  );
}

/** One-line chart caption with the panel's reading rule. */
export function ChartCaption(props: { text: string; testId: string; reason?: string | null }) {
  return (
    <Box className="flex h-[18px] shrink-0 items-center gap-2 px-1.5" data-testid={props.testId}>
      <Text size="xs" c="dimmed" className="truncate font-mono" style={{ "font-size": `${typeSize("micro")}px` }}>
        {props.text}
      </Text>
      <Show when={props.reason}>
        <Text
          size="xs"
          className="shrink-0 font-mono"
          style={{ "font-size": `${typeSize("micro")}px`, color: palette.WARNING }}
          data-testid={`${props.testId}-reason`}
        >
          {props.reason}
        </Text>
      </Show>
    </Box>
  );
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function formatCompact(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(0);
}
