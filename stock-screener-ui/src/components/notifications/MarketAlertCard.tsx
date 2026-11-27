import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { ActionIcon, Box, Text } from "@/ui";
import { displaySymbol } from "@/config/tvSymbols";
import { IconX } from "../common/Icons";
import * as palette from "@/ui/palette";

/**
 * Unified market-alert domain.
 *
 * Single shape every producer emits (OI bursts, price spikes, volume spikes,
 * breakouts, system) so one renderer handles all of them.
 *
 * RENDER CONTRACT — terminal, not a website (Bloomberg-grade density):
 *  - #000 ground, 1px hairline grid, zero radius, zero shadow, zero ornament
 *  - monospace only, 11–13px, tabular numerals, uppercase micro-labels
 *  - greyscale base; colour is reserved for state (severity rail, up/down)
 *  - no tints, no pills, no per-kind icons, no coloured text on colour
 *  - density over beauty; keyboard-driven (↑/↓ move, ⏎ open, Esc dismiss)
 */
export type AlertKind =
  | "oi_burst"
  | "price_spike"
  | "volume_spike"
  | "breakout"
  | "system";

export type AlertSeverity = "info" | "watch" | "alert" | "critical";

export interface MarketAlertMetric {
  label: string;
  value: string;
  tone?: "up" | "down" | "neutral";
}

export interface MarketAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  symbol: string;
  title: string;
  detail: string;
  metrics?: MarketAlertMetric[];
  /** Epoch ms — rendered as IST HH:MM:SS. */
  ts: number;
  source?: string;
  href?: string;
  /** false = heads-up, not an instruction (must not take the sticky banner). */
  actionable?: boolean;
}

/** Terminal surface tokens — local to this module, all from palette.ts. */
export const ALERT_TERM = {
  bg: palette.BG,            // near-black ground
  grid: palette.BORDER,      // 1px hairline
  gridSoft: palette.AXIS_SPLIT,
  label: palette.TEXT_MUTED, // micro-labels
  text: palette.TEXT,
  select: palette.PRIMARY,
} as const;

/** 2–3 char kind code shown in the log — text, never an icon. */
export const ALERT_KIND_CODE: Record<AlertKind, string> = {
  oi_burst: "OI",
  price_spike: "PX",
  volume_spike: "VOL",
  breakout: "BRK",
  system: "SYS",
};

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  oi_burst: "OI burst",
  price_spike: "Price spike",
  volume_spike: "Volume spike",
  breakout: "Breakout",
  system: "System",
};

/**
 * Severity → the single state colour. Rail is always drawn; only `alert`/
 * `critical` colour the severity text (greyscale until it needs action).
 */
export const ALERT_SEVERITY: Record<
  AlertSeverity,
  { label: string; rail: string; emphasize: boolean; rank: number }
> = {
  info: { label: "Info", rail: ALERT_TERM.grid, emphasize: false, rank: 0 },
  watch: { label: "Watch", rail: palette.MARKER_EOD, emphasize: false, rank: 1 },
  alert: { label: "Alert", rail: palette.WARNING, emphasize: true, rank: 2 },
  critical: { label: "Critical", rail: palette.NEGATIVE, emphasize: true, rank: 3 },
};

/** IST HH:MM:SS for an epoch-ms value; host-TZ independent. */
export function formatAlertTime(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

/** Moment formatted as IST HH:MM (log/table column). */
export function formatAlertHm(ts: number): string {
  return formatAlertTime(ts).slice(0, 5);
}

function metricTone(tone: MarketAlertMetric["tone"]): string {
  if (tone === "up") return palette.POSITIVE;
  if (tone === "down") return palette.NEGATIVE;
  return ALERT_TERM.text;
}

/** Inline `LABEL value` fact, tabular and unadorned. */
function Fact(props: { m: MarketAlertMetric }) {
  return (
    <Box component="span" style={{ "white-space": "nowrap" }}>
      <Text size="xs" span c="dimmed">{props.m.label}&nbsp;</Text>
      <Text size="xs" span fw={600} c={metricTone(props.m.tone)}>{props.m.value}</Text>
    </Box>
  );
}

/** 2px state rail — the only full-height colour in the row. */
function Rail(props: { severity: AlertSeverity }) {
  return (
    <Box
      aria-hidden="true"
      style={{
        width: "2px",
        "align-self": "stretch",
        "flex-shrink": 0,
        "background-color": ALERT_SEVERITY[props.severity].rail,
      }}
    />
  );
}

export interface MarketAlertRowProps {
  alert: MarketAlert;
  active?: boolean;
  /** Toast width: drop the KIND + FACTS columns so the headline stays readable. */
  compact?: boolean;
  /** Column geometry supplied by the log; standalone rows use the wide layout. */
  layout?: LogLayout;
  onSelect?: (alert: MarketAlert) => void;
  onOpen?: (alert: MarketAlert) => void;
  onDismiss?: (id: string) => void;
}

/**
 * One dense log line. Everything on a single 20px row: state rail, kind code,
 * symbol, headline (flex, ellipsis), inline facts, IST, dismiss. Full detail
 * lives in the row `title` tooltip — density first.
 */
export function MarketAlertRow(props: MarketAlertRowProps) {
  const alert = () => props.alert;
  const active = () => props.active ?? false;
  const compact = () => props.compact ?? false;
  const onSelect = () => props.onSelect;
  const onOpen = () => props.onOpen;
  const onDismiss = () => props.onDismiss;
  const layout = () => props.layout ?? LOG_LAYOUT_WIDE;
  const sev = () => ALERT_SEVERITY[alert().severity];
  const symbol = () => displaySymbol(alert().symbol);
  const clickable = () => typeof onOpen() === "function" || typeof onSelect() === "function";
  return (
    <Box
      role="alert"
      aria-live={alert().severity === "critical" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={`${ALERT_KIND_LABEL[alert().kind]} ${alert().severity} — ${symbol()}`}
      data-testid={`market-alert-${alert().kind}`}
      data-severity={alert().severity}
      data-active={active() ? "1" : undefined}
      title={`${symbol()} · ${ALERT_KIND_LABEL[alert().kind]} · ${alert().title} — ${alert().detail}${alert().source ? ` (${alert().source})` : ""}`}
      onClick={clickable() ? () => (onSelect() ?? onOpen())?.(alert()) : undefined}
      tabIndex={clickable() && !alert().href ? 0 : undefined}
      onKeyDown={
        clickable() && !alert().href
          ? (e: KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              (onSelect() ?? onOpen())?.(alert());
            }
          : undefined
      }
      className="flex items-center gap-1 h-[20px] font-mono cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-fin-primary"
      style={{
        "padding-left": "0px",
        "padding-right": "4px",
        "background-color": active() ? palette.SURFACE_ALT : palette.BG,
        "border-bottom": `1px solid ${palette.AXIS_SPLIT}`,
        cursor: clickable() ? "pointer" : "default",
        "font-variant-numeric": "tabular-nums",
        ...(active() ? { "box-shadow": `inset 2px 0 0 0 ${palette.PRIMARY}` } : {}),
      }}
    >
      <Rail severity={alert().severity} />
      <Box
        data-col="kind"
        style={{
          width: `${layout().kind}px`,
          "padding-left": "6px",
          "flex-shrink": 0,
          display: compact() || layout().kind === 0 ? "none" : "block",
        }}
      >
        <Text size="xs" span c="dimmed">{ALERT_KIND_CODE[alert().kind]}</Text>
      </Box>
      <Box
        component="span"
        data-testid="market-alert-severity"
        data-col="sev"
        style={{
          width: compact() ? "62px" : `${layout().sev}px`,
          "flex-shrink": 0,
          overflow: "hidden",
        }}
      >
        <Text
          size="xs"
          span
          fw={sev().emphasize ? 700 : 400}
          c={sev().emphasize ? sev().rail : "dimmed"}
          style={{ "text-transform": "uppercase", "letter-spacing": "0.03em" }}
        >
          {sev().label}
        </Text>
      </Box>
      <Show
        when={alert().href}
        fallback={
          <Box data-col="symbol" style={{ width: `${layout().symbol}px`, "flex-shrink": 0, overflow: "hidden" }}>
            <Text size="xs" span fw={700} truncate>{symbol()}</Text>
          </Box>
        }
      >
        <a
          href={alert()!.href}
          data-testid="market-alert-link"
          data-col="symbol"
          aria-label={`Open ${symbol()} — ${alert().title}`}
          title={alert()!.href}
          onClick={(e) => e.stopPropagation()}
          class="inline-flex shrink-0 items-center overflow-hidden text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary"
          style={{ width: `${layout().symbol}px`, color: "inherit" }}
        >
          <Text size="xs" span fw={700} truncate>{symbol()}</Text>
        </a>
      </Show>
      <Box
        data-col="headline"
        data-testid="market-alert-row-headline"
        className="flex-1 min-w-0 overflow-hidden"
        style={{ "min-width": `${layout().headlineMin}px` }}
      >
        <Text size="xs" span truncate>
          {layout().kind === 0 ? `${ALERT_KIND_CODE[alert().kind]} · ${alert().title}` : alert().title}
        </Text>
      </Box>
      <Show when={!compact()}>
        <Show
          when={alert().metrics && alert().metrics!.length > 0}
          fallback={<Box data-col="facts" style={{ width: `${layout().facts}px`, "flex-shrink": 0 }} />}
        >
          <Box
            data-testid="market-alert-metrics"
            data-col="facts"
            className="flex gap-1.5"
            style={{ width: `${layout().facts}px`, "flex-shrink": 0, overflow: "hidden" }}
          >
            <For each={alert().metrics!.slice(0, 3)}>{(m) => <Fact m={m} />}</For>
          </Box>
        </Show>
      </Show>
      <Text size="xs" span c="dimmed" style={{ "flex-shrink": 0 }}>{formatAlertHm(alert().ts)}</Text>
      <Show when={!!onDismiss()}>
        <ActionIcon
          size="xs"
          aria-label="Dismiss alert"
          data-testid="market-alert-dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss()?.(alert().id);
          }}
          className="rounded-none hover:text-fin-text"
          style={{ padding: "0px", color: palette.TEXT_MUTED }}
        >
          <IconX size={12} />
        </ActionIcon>
      </Show>
    </Box>
  );
}

export interface MarketAlertCardProps {
  alert: MarketAlert;
  /** "comfortable" = notification centre (detail visible), "compact" = toast. */
  density?: "comfortable" | "compact";
  onDismiss?: (id: string) => void;
  onOpen?: (alert: MarketAlert) => void;
}

/**
 * Two-to-three line stacked alert for the centre / toast region when a
 * single line would clip. Same flat terminal skin as the row; no cards.
 */
export function MarketAlertCard(props: MarketAlertCardProps) {
  const alert = () => props.alert;
  const density = () => props.density ?? "comfortable";
  const sev = () => ALERT_SEVERITY[alert().severity];
  const compact = () => density() === "compact";
  const onOpen = () => props.onOpen;
  const onDismiss = () => props.onDismiss;
  const symbol = () => displaySymbol(alert().symbol);
  const clickable = () => typeof onOpen() === "function";

  return (
    <Box
      role="alert"
      aria-live={alert().severity === "critical" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={`${ALERT_KIND_LABEL[alert().kind]} ${alert().severity} — ${symbol()}`}
      data-testid={`market-alert-${alert().kind}`}
      data-severity={alert().severity}
      onClick={clickable() ? () => onOpen()?.(alert()) : undefined}
      tabIndex={clickable() && !alert().href ? 0 : undefined}
      onKeyDown={
        clickable() && !alert().href
          ? (e: KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onOpen()?.(alert());
            }
          : undefined
      }
      className="flex gap-1 font-mono cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-fin-primary"
      style={{
        "padding-top": compact() ? "4px" : "6px",
        "padding-bottom": compact() ? "4px" : "6px",
        "padding-right": "4px",
        "background-color": palette.BG,
        "border-bottom": `1px solid ${palette.AXIS_SPLIT}`,
        cursor: clickable() ? "pointer" : "default",
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <Rail severity={alert().severity} />
      <Box style={{ flex: 1, "min-width": "0px", display: "flex", "flex-direction": "column", gap: compact() ? 0 : "2px" }}>
        <Box style={{ display: "flex", "align-items": "center", gap: "4px", "min-width": "0px" }}>
          <Text size="xs" span c="dimmed">{ALERT_KIND_CODE[alert().kind]}</Text>
          <Show
            when={alert().href}
            fallback={
              <Text size={compact() ? "xs" : "sm"} span fw={700} truncate>
                {symbol()}
              </Text>
            }
          >
            <a
              href={alert()!.href}
              data-testid="market-alert-link"
              aria-label={`Open ${symbol()} — ${alert().title}`}
              title={alert()!.href}
              onClick={(e) => e.stopPropagation()}
              class="inline-flex items-center overflow-hidden text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary"
              style={{ color: "inherit" }}
            >
              <Text size={compact() ? "xs" : "sm"} span fw={700} truncate>
                {symbol()}
              </Text>
            </a>
          </Show>
          <Box component="span" data-testid="market-alert-severity" style={{ "flex-shrink": 0 }}>
            <Text
              size="xs"
              span
              fw={sev().emphasize ? 700 : 400}
              c={sev().emphasize ? sev().rail : "dimmed"}
              style={{ "text-transform": "uppercase", "letter-spacing": "0.03em" }}
            >
              {sev().label}
            </Text>
          </Box>
          <Box style={{ flex: 1, "min-width": "4px" }} />
          <Text size="xs" span c="dimmed">{formatAlertTime(alert().ts)}</Text>
        </Box>
        <Text size={compact() ? "xs" : "sm"} span fw={600} truncate>{alert().title}</Text>
        <Show when={alert().detail}>
          <Text size="xs" span c="dimmed" truncate>{alert().detail}</Text>
        </Show>
        <Show when={alert().metrics && alert().metrics!.length > 0}>
          <Box
            data-testid="market-alert-metrics"
            className="flex flex-wrap"
            style={{ "column-gap": "8px", overflow: "hidden" }}
          >
            <For each={alert().metrics ?? []}>{(m) => <Fact m={m} />}</For>
          </Box>
        </Show>
        <Show when={alert().source}>
          <Text size="xs" span c="dimmed" truncate>{alert().source}</Text>
        </Show>
      </Box>
      <Show when={!!onDismiss()}>
        <ActionIcon
          size="xs"
          aria-label="Dismiss alert"
          data-testid="market-alert-dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss()?.(alert().id);
          }}
          className="rounded-none hover:text-fin-text"
          style={{ "align-self": "flex-start", padding: "0px", color: palette.TEXT_MUTED }}
        >
          <IconX size={12} />
        </ActionIcon>
      </Show>
    </Box>
  );
}

export interface MarketAlertLogProps {
  alerts: MarketAlert[];
  /** Fill the parent's height and scroll internally (viewport look). */
  fill?: boolean;
  height?: number | string;
  onOpen?: (alert: MarketAlert) => void;
  onDismiss?: (id: string) => void;
  max?: number;
}

const LOG_COLUMNS = ["", "KIND", "SEV", "SYMBOL", "HEADLINE", "FACTS", "IST"] as const;

/** Below this width the fixed terminal columns starve HEADLINE of all space. */
export const LOG_NARROW_BREAKPOINT = 640;
const LOG_RAIL = 2;
const LOG_GAP = 4;
const LOG_CHROME = 6;

export interface LogLayout {
  /** 0 = the KIND column is dropped so TYPE can keep a readable headline. */
  kind: number;
  sev: number;
  symbol: number;
  facts: number;
  ist: number;
  dismiss: number;
  headlineMin: number;
}

const LOG_LAYOUT_WIDE: LogLayout = {
  kind: 34,
  sev: 70,
  symbol: 92,
  facts: 232,
  ist: 34,
  dismiss: 18,
  headlineMin: 0,
};

const LOG_LAYOUT_NARROW: LogLayout = {
  kind: 0,
  sev: 64,
  symbol: 70,
  facts: 96,
  ist: 34,
  dismiss: 18,
  headlineMin: 48,
};

export function logLayoutFor(width: number): LogLayout {
  return width > 0 && width <= LOG_NARROW_BREAKPOINT ? LOG_LAYOUT_NARROW : LOG_LAYOUT_WIDE;
}

/** Every column except HEADLINE, plus the gaps between the flex children. */
export function logFixedWidth(layout: LogLayout): number {
  const columns = [
    LOG_RAIL,
    layout.kind,
    layout.sev,
    layout.symbol,
    layout.facts,
    layout.ist,
    layout.dismiss,
  ].filter((w) => w > 0);
  return columns.reduce((sum, w) => sum + w, columns.length * LOG_GAP + LOG_CHROME);
}

/** HEADLINE keeps at least its minimum when the layout is used at `width`. */
export function logLayoutFits(width: number, layout = logLayoutFor(width)): boolean {
  return logFixedWidth(layout) + layout.headlineMin <= width;
}

/**
 * The Bloomberg view: a sticky-header log that fills the viewport, one alert
 * per 20px row, keyboard driven. ↑/↓ move the active row, ⏎ opens, Esc
 * dismisses the active row.
 */
export function MarketAlertLog(props: MarketAlertLogProps) {
  const rows = createMemo(() => (props.max ? props.alerts.slice(0, props.max) : props.alerts));
  const [activeIndex, setActiveIndex] = createSignal(0);
  let scrollRef: HTMLDivElement | undefined;

  // Keep the selection inside the list when rows are dismissed / cleared.
  createEffect(() => {
    const len = rows().length;
    setActiveIndex((i) => (len === 0 ? 0 : Math.min(i, len - 1)));
  });

  const clamp = (i: number) => Math.max(0, Math.min(rows().length - 1, i));

  const focusRow = (index: number) => {
    setActiveIndex(index);
    const el = scrollRef?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (rows().length === 0) return;
    const index = activeIndex();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(clamp(index + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(clamp(index - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      focusRow(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusRow(rows().length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const a = rows()[index];
      if (a) props.onOpen?.(a);
    } else if (e.key === "Escape") {
      e.preventDefault();
      const a = rows()[index];
      if (a) props.onDismiss?.(a.id);
    }
  };

  const heightStyle = () => (typeof props.height === "number" ? `${props.height}px` : props.height);
  const fill = () => props.fill ?? true;

  const [viewportWidth, setViewportWidth] = createSignal(
    typeof window === "undefined" ? Number.MAX_SAFE_INTEGER : window.innerWidth,
  );
  onMount(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });
  const layout = createMemo(() => logLayoutFor(viewportWidth()));
  const fits = createMemo(() => logLayoutFits(viewportWidth(), layout()));

  return (
    <Box
      data-testid="market-alert-log"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col min-w-0 font-mono outline-none"
      style={{
        "background-color": palette.BG,
        border: `1px solid ${palette.BORDER}`,
        "border-bottom": `1px solid ${palette.AXIS_SPLIT}`,
        outline: "none",
        ...(fill()
          ? { flex: 1, "min-height": "0px", height: heightStyle() ?? "100%" }
          : { height: heightStyle() ?? "320px" }),
      }}
    >
      {/* sticky header — uppercase micro-labels, greyscale */}
      <Box
        data-testid="market-alert-log-head"
        className="flex items-center gap-1 flex-shrink-0"
        style={{
          height: "22px",
          "padding-left": "0px",
          "padding-right": "4px",
          "background-color": palette.SURFACE,
          "border-bottom": `1px solid ${palette.AXIS_SPLIT}`,
        }}
      >
        <Box style={{ width: "2px", "flex-shrink": 0 }} />
        <Box
          data-col="kind"
          style={{
            width: `${layout().kind}px`,
            "padding-left": "6px",
            "flex-shrink": 0,
            display: layout().kind === 0 ? "none" : "block",
          }}
        >
          <Text size="xs" span c="dimmed">K</Text>
        </Box>
        <Box data-col="sev" style={{ width: `${layout().sev}px`, "flex-shrink": 0 }}>
          <Text size="xs" span c="dimmed">SEV</Text>
        </Box>
        <Box data-col="symbol" style={{ width: `${layout().symbol}px`, "flex-shrink": 0 }}>
          <Text size="xs" span c="dimmed">SYMBOL</Text>
        </Box>
        <Box
          data-col="headline"
          data-testid="market-alert-log-headline"
          className="flex-1 min-w-0 overflow-hidden"
          style={{ "min-width": `${layout().headlineMin}px` }}
        >
          <Text size="xs" span c="dimmed">HEADLINE</Text>
        </Box>
        <Box data-col="facts" style={{ width: `${layout().facts}px`, "flex-shrink": 0 }}>
          <Text size="xs" span c="dimmed">FACTS</Text>
        </Box>
        <Box data-col="ist" style={{ width: `${layout().ist}px`, "flex-shrink": 0, "text-align": "right" }}>
          <Text size="xs" span c="dimmed">IST</Text>
        </Box>
        <Box style={{ width: `${layout().dismiss}px`, "flex-shrink": 0 }} />
      </Box>

      <Box
        ref={(el: HTMLDivElement) => (scrollRef = el)}
        data-testid="market-alert-log-scroll"
        tabIndex={fits() ? undefined : 0}
        role={fits() ? undefined : "region"}
        aria-label={fits() ? undefined : "Alert log — scroll horizontally"}
        style={{ flex: 1, "min-height": "0px", overflow: "auto" }}
      >
        <Show when={rows().length > 0} fallback={
          <Box style={{ padding: "8px" }}>
            <Text size="xs" c="dimmed">NO ALERTS</Text>
          </Box>
        }>
          <For each={rows()}>{(a, i) => (
            <Box data-row-index={i()}>
              <MarketAlertRow
                alert={a}
                active={i() === activeIndex()}
                layout={layout()}
                onSelect={(al) => {
                  setActiveIndex(i());
                  props.onOpen?.(al);
                }}
                onOpen={props.onOpen}
                onDismiss={props.onDismiss}
              />
            </Box>
          )}</For>
        </Show>
      </Box>

      <Box
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          height: "18px",
          "flex-shrink": 0,
          "padding-left": "8px",
          "padding-right": "8px",
          "border-top": `1px solid ${palette.AXIS_SPLIT}`,
          "background-color": palette.SURFACE,
        }}
      >
        <Box className="flex items-center gap-1">
          <Text size="xs" span c="dimmed">{rows().length} rows</Text>
          <Show when={!fits()}>
            <Text data-testid="market-alert-log-scroll-cue" size="xs" span c="dimmed">SCROLL →</Text>
          </Show>
        </Box>
        <Text size="xs" span c="dimmed">↑↓ MOVE · ⏎ OPEN · ESC DISMISS</Text>
      </Box>
    </Box>
  );
}

export interface MarketAlertStackProps {
  alerts: MarketAlert[];
  density?: "comfortable" | "compact";
  /** Visible cap — the tail coalesces into a single "+N" line. */
  max?: number;
  onDismiss?: (id: string) => void;
  onOpen?: (alert: MarketAlert) => void;
  width?: number | string;
}

/**
 * Toast column. A burst of 20 OI alerts must never stack 20 cards: the tail
 * collapses into one muted line.
 */
export function MarketAlertStack(props: MarketAlertStackProps) {
  const alerts = () => props.alerts;
  const density = () => props.density ?? "compact";
  const max = () => props.max ?? 3;
  const shown = () => alerts().slice(0, max());
  const overflow = () => alerts().length - shown().length;

  return (
    <Show when={alerts().length > 0}>
    <Box
      data-testid="market-alert-stack"
      className="flex flex-col font-mono"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0px",
        width: props.width == null ? "100%" : `${props.width}px`,
        "min-width": "0px",
        "background-color": palette.BG,
        border: `1px solid ${palette.BORDER}`,
        "border-bottom": `1px solid ${palette.AXIS_SPLIT}`,
      }}
    >
      <For each={shown()}>{(a) => (
        <MarketAlertRow
          alert={a}
          compact={density() !== "comfortable"}
          onOpen={props.onOpen}
          onDismiss={props.onDismiss}
        />
      )}</For>
      <Show when={overflow() > 0}>
        <Box
          data-testid="market-alert-overflow"
          style={{
            height: "18px",
            display: "flex",
            "align-items": "center",
            "padding-left": "8px",
            "background-color": palette.SURFACE,
          }}
        >
          <Text size="xs" span c="dimmed">+{overflow()} more alerts</Text>
        </Box>
      </Show>
    </Box>
    </Show>
  );
}

export { LOG_COLUMNS };
