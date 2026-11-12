import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Box, Text } from "@/ui";
import { IconX } from "@tabler/icons-react";
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
function Fact({ m }: { m: MarketAlertMetric }) {
  return (
    <Box component="span" style={{ "white-space": "nowrap" }}>
      <Text size="xs" span c="dimmed">{m.label}&nbsp;</Text>
      <Text size="xs" span fw={600} c={metricTone(m.tone)}>{m.value}</Text>
    </Box>
  );
}

/** 2px state rail — the only full-height colour in the row. */
function Rail({ severity }: { severity: AlertSeverity }) {
  return (
    <Box
      aria-hidden="true"
      style={{
        width: 2,
        alignSelf: "stretch",
        "flex-shrink": 0,
        "background-color": ALERT_SEVERITY[severity].rail,
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
export function MarketAlertRow({
  alert,
  active = false,
  compact = false,
  onSelect,
  onOpen,
  onDismiss,
}: MarketAlertRowProps) {
  const sev = ALERT_SEVERITY[alert.severity];
  const clickable = typeof onOpen === "function" || typeof onSelect === "function";
  return (
    <Box
      role="alert"
      aria-live={alert.severity === "critical" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={`${ALERT_KIND_LABEL[alert.kind]} ${alert.severity} — ${alert.symbol}`}
      data-testid={`market-alert-${alert.kind}`}
      data-severity={alert.severity}
      data-active={active ? "1" : undefined}
      title={`${alert.symbol} · ${ALERT_KIND_LABEL[alert.kind]} · ${alert.title} — ${alert.detail}${alert.source ? ` (${alert.source})` : ""}`}
      onClick={clickable ? () => (onSelect ?? onOpen)?.(alert) : undefined}
      className="flex items-center gap-1 h-[20px] font-mono cursor-pointer"
      style={{
        "padding-left": 0,
        "padding-right": 4,
        "background-color": active ? palette.SURFACE_ALT : palette.BG,
        borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
        cursor: clickable ? "pointer" : "default",
        fontVariantNumeric: "tabular-nums",
        ...(active ? { "box-shadow": `inset 2px 0 0 0 ${palette.PRIMARY}` } : {}),
      }}
    >
      <Rail severity={alert.severity} />
      <Box
        style={{
          width: 34,
          "padding-left": 6,
          "flex-shrink": 0,
          display: compact ? "none" : "block",
        }}
      >
        <Text size="xs" span c="dimmed">{ALERT_KIND_CODE[alert.kind]}</Text>
      </Box>
      <Box
        component="span"
        data-testid="market-alert-severity"
        style={{
          width: compact ? 62 : 70,
          "flex-shrink": 0,
          overflow: "hidden",
        }}
      >
        <Text
          size="xs"
          span
          fw={sev.emphasize ? 700 : 400}
          c={sev.emphasize ? sev.rail : "dimmed"}
          style={{ "text-transform": "uppercase", "letter-spacing": "0.03em" }}
        >
          {sev.label}
        </Text>
      </Box>
      <Box style={{ width: 92, "flex-shrink": 0, overflow: "hidden" }}>
        <Text size="xs" span fw={700} truncate>{alert.symbol}</Text>
      </Box>
      <Box className="flex-1 min-w-0 overflow-hidden">
        <Text size="xs" span truncate>{alert.title}</Text>
      </Box>
      {!compact ? (
        alert.metrics && alert.metrics.length > 0 ? (
          <Box
            data-testid="market-alert-metrics"
            className="flex gap-1.5"
            style={{ width: 232, "flex-shrink": 0, overflow: "hidden" }}
          >
            {alert.metrics.slice(0, 3).map((m) => (
              <Fact key={m.label} m={m} />
            ))}
          </Box>
        ) : (
          <Box style={{ width: 232, "flex-shrink": 0 }} />
        )
      ) : null}
      <Text size="xs" span c="dimmed" style={{ "flex-shrink": 0 }}>{formatAlertHm(alert.ts)}</Text>
      {onDismiss ? (
        <ActionIcon
          size="small"
          aria-label="Dismiss alert"
          data-testid="market-alert-dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(alert.id);
          }}
          className="rounded-none hover:text-fin-text"
          style={{ padding: 0, color: palette.TEXT_MUTED }}
        >
          <IconX size={11} />
        </ActionIcon>
      ) : null}
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
export function MarketAlertCard({
  alert,
  density = "comfortable",
  onDismiss,
  onOpen,
}: MarketAlertCardProps) {
  const sev = ALERT_SEVERITY[alert.severity];
  const compact = density === "compact";
  const clickable = typeof onOpen === "function";

  return (
    <Box
      role="alert"
      aria-live={alert.severity === "critical" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={`${ALERT_KIND_LABEL[alert.kind]} ${alert.severity} — ${alert.symbol}`}
      data-testid={`market-alert-${alert.kind}`}
      data-severity={alert.severity}
      onClick={clickable ? () => onOpen?.(alert) : undefined}
      className="flex gap-1 font-mono cursor-pointer"
      style={{
        "padding-top": compact ? 4 : 6,
        "padding-bottom": compact ? 4 : 6,
        "padding-right": 4,
        "background-color": palette.BG,
        borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
        cursor: clickable ? "pointer" : "default",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Rail severity={alert.severity} />
      <Box style={{ flex: 1, "min-width": 0, display: "flex", "flex-direction": "column", gap: compact ? 0 : 2 }}>
        <Box style={{ display: "flex", "align-items": "center", gap: 4, "min-width": 0 }}>
          <Text size="xs" span c="dimmed">{ALERT_KIND_CODE[alert.kind]}</Text>
          <Text size={compact ? "xs" : "sm"} span fw={700} truncate>{alert.symbol}</Text>
          <Box component="span" data-testid="market-alert-severity" style={{ "flex-shrink": 0 }}>
            <Text
              size="xs"
              span
              fw={sev.emphasize ? 700 : 400}
              c={sev.emphasize ? sev.rail : "dimmed"}
              style={{ "text-transform": "uppercase", "letter-spacing": "0.03em" }}
            >
              {sev.label}
            </Text>
          </Box>
          <Box style={{ flex: 1, "min-width": 4 }} />
          <Text size="xs" span c="dimmed">{formatAlertTime(alert.ts)}</Text>
        </Box>
        <Text size={compact ? "xs" : "sm"} span fw={600} truncate>{alert.title}</Text>
        {alert.detail ? (
          <Text size="xs" span c="dimmed" truncate>{alert.detail}</Text>
        ) : null}
        {alert.metrics && alert.metrics.length > 0 ? (
          <Box
            data-testid="market-alert-metrics"
            className="flex flex-wrap"
            style={{ "column-gap": 8, overflow: "hidden" }}
          >
            {alert.metrics.map((m) => (
              <Fact key={m.label} m={m} />
            ))}
          </Box>
        ) : null}
        {alert.source ? (
          <Text size="xs" span c="dimmed" truncate>{alert.source}</Text>
        ) : null}
      </Box>
      {onDismiss ? (
        <ActionIcon
          size="small"
          aria-label="Dismiss alert"
          data-testid="market-alert-dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(alert.id);
          }}
          className="rounded-none hover:text-fin-text"
          style={{ alignSelf: "flex-start", padding: 0, color: palette.TEXT_MUTED }}
        >
          <IconX size={11} />
        </ActionIcon>
      ) : null}
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
export function MarketAlertLog({
  alerts,
  ["fill"] = true,
  height,
  onOpen,
  onDismiss,
  max,
}: MarketAlertLogProps) {
  const rows = useMemo(() => (max ? alerts.slice(0, max) : alerts), [alerts, max]);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the selection inside the list when rows are dismissed / cleared.
  useEffect(() => {
    setActiveIndex((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(rows.length - 1, i)),
    [rows.length],
  );

  const focusRow = useCallback(
    (index: number) => {
      setActiveIndex(index);
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
      el?.scrollIntoView({ block: "nearest" });
    },
    [],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rows.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusRow(clamp(activeIndex + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusRow(clamp(activeIndex - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        focusRow(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusRow(rows.length - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const a = rows[activeIndex];
        if (a) onOpen?.(a);
      } else if (e.key === "Escape") {
        e.preventDefault();
        const a = rows[activeIndex];
        if (a) onDismiss?.(a.id);
      }
    },
    [activeIndex, clamp, focusRow, onDismiss, onOpen, rows],
  );

  const heightStyle = typeof height === "number" ? `${height}px` : height;

  return (
    <Box
      data-testid="market-alert-log"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col min-w-0 font-mono outline-none"
      style={{
        "background-color": palette.BG,
        border: `1px solid ${palette.BORDER}`,
        borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
        outline: "none",
        ...(fill
          ? { flex: 1, "min-height": 0, height: heightStyle ?? "100%" }
          : { height: heightStyle ?? "320px" }),
      }}
    >
      {/* sticky header — uppercase micro-labels, greyscale */}
      <Box
        data-testid="market-alert-log-head"
        className="flex items-center gap-1 flex-shrink-0"
        style={{
          height: 22,
          "padding-left": 0,
          "padding-right": 4,
          "background-color": palette.SURFACE,
          borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
        }}
      >
        <Box style={{ width: 2, "flex-shrink": 0 }} />
        <Box style={{ width: 34, "padding-left": 6, "flex-shrink": 0 }}>
          <Text size="xs" span c="dimmed">K</Text>
        </Box>
        <Box style={{ width: 70, "flex-shrink": 0 }}>
          <Text size="xs" span c="dimmed">SEV</Text>
        </Box>
        <Box style={{ width: 92, "flex-shrink": 0 }}>
          <Text size="xs" span c="dimmed">SYMBOL</Text>
        </Box>
        <Box className="flex-1 min-w-0 overflow-hidden">
          <Text size="xs" span c="dimmed">HEADLINE</Text>
        </Box>
        <Box style={{ width: 232, "flex-shrink": 0 }}>
          <Text size="xs" span c="dimmed">FACTS</Text>
        </Box>
        <Box style={{ width: 34, "flex-shrink": 0, "text-align": "right" }}>
          <Text size="xs" span c="dimmed">IST</Text>
        </Box>
        <Box style={{ width: 18, "flex-shrink": 0 }} />
      </Box>

      <Box ref={scrollRef} style={{ flex: 1, "min-height": 0, overflow: "auto" }}>
        {rows.length === 0 ? (
          <Box style={{ padding: 8 }}>
            <Text size="xs" c="dimmed">NO ALERTS</Text>
          </Box>
        ) : (
          rows.map((a, i) => (
            <Box key={a.id} data-row-index={i}>
              <MarketAlertRow
                alert={a}
                active={i === activeIndex}
                onSelect={(al) => {
                  setActiveIndex(i);
                  onOpen?.(al);
                }}
                onOpen={onOpen}
                onDismiss={onDismiss}
              />
            </Box>
          ))
        )}
      </Box>

      <Box
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          height: 18,
          "flex-shrink": 0,
          "padding-left": 8,
          "padding-right": 8,
          borderTop: `1px solid ${palette.AXIS_SPLIT}`,
          "background-color": palette.SURFACE,
        }}
      >
        <Text size="xs" span c="dimmed">{rows.length} rows</Text>
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
export function MarketAlertStack({
  alerts,
  density = "compact",
  max = 3,
  onDismiss,
  onOpen,
  width,
}: MarketAlertStackProps) {
  if (alerts.length === 0) return null;
  const shown = alerts.slice(0, max);
  const overflow = alerts.length - shown.length;

  return (
    <Box
      data-testid="market-alert-stack"
      className="flex flex-col font-mono"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: 0,
        width: width ?? "100%",
        "min-width": 0,
        "background-color": palette.BG,
        border: `1px solid ${palette.BORDER}`,
        borderBottom: `1px solid ${palette.AXIS_SPLIT}`,
      }}
    >
      {shown.map((a) => (
        <MarketAlertRow
          key={a.id}
          alert={a}
          compact={density !== "comfortable"}
          onOpen={onOpen}
          onDismiss={onDismiss}
        />
      ))}
      {overflow > 0 ? (
        <Box
          data-testid="market-alert-overflow"
          style={{
            height: 18,
            display: "flex",
            "align-items": "center",
            "padding-left": 8,
            "background-color": palette.SURFACE,
          }}
        >
          <Text size="xs" span c="dimmed">+{overflow} more alerts</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export { LOG_COLUMNS };
