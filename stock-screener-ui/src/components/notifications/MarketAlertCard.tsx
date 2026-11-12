import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js";
import { ActionIcon, Box, Text } from "@/ui";
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
    <Box component="span" style={{ whiteSpace: "nowrap" }}>
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
        width: 2,
        alignSelf: "stretch",
        flexShrink: 0,
        backgroundColor: ALERT_SEVERITY[props.severity].rail,
      }}
    />
  );
}

export interface MarketAlertRowProps {
  alert: MarketAlert;
  active?: boolean;
  /** Toast width: drop the KIND + FACTS columns so the headline stays readable. */
  compact?: boolean;
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
  const sev = () => ALERT_SEVERITY[alert().severity];
  const clickable = () => typeof onOpen() === "function" || typeof onSelect() === "function";
  return (
    <Box
      role="alert"
      aria-live={alert.severity === "critical" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={`${ALERT_KIND_LABEL[alert.kind]} ${alert.severity} — ${alert().symbol}`}
      data-testid={`market-alert-${alert().kind}`}
      data-severity={alert().severity}
      data-active={active() ? "1" : undefined}
      title={`${alert().symbol} · ${ALERT_KIND_LABEL[alert().kind]} · ${alert().title} — ${alert().detail}${alert().source ? ` (${alert().source})` : ""}`}
      onClick={clickable() ? () => (onSelect() ?? onOpen())?.(alert()) : undefined}
      className="flex items-center gap-1 h-[20px] font-mono cursor-pointer"
      style={{
        paddingLeft: 0,
        paddingRight: 4,
        backgroundColor: active() ? palette.SURFACE_ALT : palette.BG,
        borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
        cursor: clickable() ? "pointer" : "default",
        fontVariantNumeric: "tabular-nums",
        ...(active() ? { boxShadow: `inset 2px 0 0 0 ${palette.PRIMARY}` } : {}),
      }}
    >
      <Rail severity={alert().severity} />
      <Box
        style={{
          width: 34,
          paddingLeft: 6,
          flexShrink: 0,
          display: compact() ? "none" : "block",
        }}
      >
        <Text size="xs" span c="dimmed">{ALERT_KIND_CODE[alert().kind]}</Text>
      </Box>
      <Box
        component="span"
        data-testid="market-alert-severity"
        style={{
          width: compact() ? 62 : 70,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <Text
          size="xs"
          span
          fw={sev().emphasize ? 700 : 400}
          c={sev().emphasize ? sev().rail : "dimmed"}
          style={{ textTransform: "uppercase", letterSpacing: "0.03em" }}
        >
          {sev().label}
        </Text>
      </Box>
      <Box style={{ width: 92, flexShrink: 0, overflow: "hidden" }}>
        <Text size="xs" span fw={700} truncate>{alert().symbol}</Text>
      </Box>
      <Box className="flex-1 min-w-0 overflow-hidden">
        <Text size="xs" span truncate>{alert().title}</Text>
      </Box>
      <Show when={!compact()}>
        <Show
          when={alert().metrics && alert().metrics!.length > 0}
          fallback={<Box style={{ width: 232, flexShrink: 0 }} />}
        >
          <Box
            data-testid="market-alert-metrics"
            className="flex gap-1.5"
            style={{ width: 232, flexShrink: 0, overflow: "hidden" }}
          >
            <For each={alert().metrics!.slice(0, 3)}>{(m) => <Fact m={m} />}</For>
          </Box>
        </Show>
      </Show>
      <Text size="xs" span c="dimmed" style={{ flexShrink: 0 }}>{formatAlertHm(alert().ts)}</Text>
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
          style={{ padding: 0, color: palette.TEXT_MUTED }}
        >
          <IconX size={11} />
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
  const clickable = () => typeof onOpen() === "function";

  return (
    <Box
      role="alert"
      aria-live={alert.severity === "critical" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={`${ALERT_KIND_LABEL[alert.kind]} ${alert.severity} — ${alert.symbol}`}
      data-testid={`market-alert-${alert().kind}`}
      data-severity={alert().severity}
      onClick={clickable() ? () => onOpen()?.(alert()) : undefined}
      className="flex gap-1 font-mono cursor-pointer"
      style={{
        paddingTop: compact() ? 4 : 6,
        paddingBottom: compact() ? 4 : 6,
        paddingRight: 4,
        backgroundColor: palette.BG,
        borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
        cursor: clickable() ? "pointer" : "default",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Rail severity={alert().severity} />
      <Box style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: compact() ? 0 : 2 }}>
        <Box style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <Text size="xs" span c="dimmed">{ALERT_KIND_CODE[alert().kind]}</Text>
          <Text size={compact() ? "xs" : "sm"} span fw={700} truncate>{alert().symbol}</Text>
          <Box component="span" data-testid="market-alert-severity" style={{ flexShrink: 0 }}>
            <Text
              size="xs"
              span
              fw={sev().emphasize ? 700 : 400}
              c={sev().emphasize ? sev().rail : "dimmed"}
              style={{ textTransform: "uppercase", letterSpacing: "0.03em" }}
            >
              {sev().label}
            </Text>
          </Box>
          <Box style={{ flex: 1, minWidth: 4 }} />
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
            style={{ columnGap: 8, overflow: "hidden" }}
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
          style={{ alignSelf: "flex-start", padding: 0, color: palette.TEXT_MUTED }}
        >
          <IconX size={11} />
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

  return (
    <Box
      data-testid="market-alert-log"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col min-w-0 font-mono outline-none"
      style={{
        backgroundColor: palette.BG,
        border: `1px solid ${palette.BORDER}`,
        borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
        outline: "none",
        ...(fill()
          ? { flex: 1, minHeight: 0, height: heightStyle() ?? "100%" }
          : { height: heightStyle() ?? "320px" }),
      }}
    >
      {/* sticky header — uppercase micro-labels, greyscale */}
      <Box
        data-testid="market-alert-log-head"
        className="flex items-center gap-1 flex-shrink-0"
        style={{
          height: 22,
          paddingLeft: 0,
          paddingRight: 4,
          backgroundColor: palette.SURFACE,
          borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
        }}
      >
        <Box style={{ width: 2, flexShrink: 0 }} />
        <Box style={{ width: 34, paddingLeft: 6, flexShrink: 0 }}>
          <Text size="xs" span c="dimmed">K</Text>
        </Box>
        <Box style={{ width: 70, flexShrink: 0 }}>
          <Text size="xs" span c="dimmed">SEV</Text>
        </Box>
        <Box style={{ width: 92, flexShrink: 0 }}>
          <Text size="xs" span c="dimmed">SYMBOL</Text>
        </Box>
        <Box className="flex-1 min-w-0 overflow-hidden">
          <Text size="xs" span c="dimmed">HEADLINE</Text>
        </Box>
        <Box style={{ width: 232, flexShrink: 0 }}>
          <Text size="xs" span c="dimmed">FACTS</Text>
        </Box>
        <Box style={{ width: 34, flexShrink: 0, textAlign: "right" }}>
          <Text size="xs" span c="dimmed">IST</Text>
        </Box>
        <Box style={{ width: 18, flexShrink: 0 }} />
      </Box>

      <Box ref={(el: HTMLDivElement) => (scrollRef = el)} style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Show when={rows().length > 0} fallback={
          <Box style={{ padding: 8 }}>
            <Text size="xs" c="dimmed">NO ALERTS</Text>
          </Box>
        }>
          <For each={rows()}>{(a, i) => (
            <Box data-row-index={i()}>
              <MarketAlertRow
                alert={a}
                active={i() === activeIndex()}
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
          alignItems: "center",
          justifyContent: "space-between",
          height: 18,
          flexShrink: 0,
          paddingLeft: 8,
          paddingRight: 8,
          borderTop: `1px solid ${palette.AXIS_SPLIT}`,
          backgroundColor: palette.SURFACE,
        }}
      >
        <Text size="xs" span c="dimmed">{rows().length} rows</Text>
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
        flexDirection: "column",
        gap: 0,
        width: props.width ?? "100%",
        minWidth: 0,
        backgroundColor: palette.BG,
        border: `1px solid ${palette.BORDER}`,
        borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
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
            height: 18,
            display: "flex",
            alignItems: "center",
            paddingLeft: 8,
            backgroundColor: palette.SURFACE,
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
