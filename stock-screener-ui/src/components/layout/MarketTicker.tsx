import { memo, useCallback, useMemo, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { Box, Text, Skeleton } from "@/ui";
import * as palette from "@/ui/palette";
import { useMarketTickerEnabled } from "../../hooks/useMarketTickerEnabled";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday, getHolidayState } from "../../state/holidays";

export interface MarketTickerItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  is_positive: boolean;
}

export interface MarketTickerData {
  tickers: Record<string, MarketTickerItem>;
  last_updated: string | null;
  loading: boolean;
  error: string | null;
}

import { API_ENDPOINTS } from "../../api/config";

const MARKET_TICKER_API = API_ENDPOINTS.MARKET_TICKER;
const POLL_INTERVAL_MS = 300000; // 5 minutes

const PRIORITY_ORDER = ["^NSEI", "^NSEBANK", "GC=F", "SI=F", "CL=F", "USDINR=X"];

function getTickerLabel(symbol: string): string {
  switch (symbol) {
    case "^NSEBANK":
      return "Bank Nifty";
    case "^NSEI":
      return "Nifty 50";
    case "GC=F":
      return "Gold";
    case "SI=F":
      return "Silver";
    case "CL=F":
      return "Crude Oil";
    case "USDINR=X":
      return "USD/INR";
    default:
      return symbol;
  }
}

function sortTickersByPriority(tickers: Record<string, MarketTickerItem>): string[] {
  return Object.keys(tickers).sort((a, b) => {
    const aPriority = PRIORITY_ORDER.indexOf(a);
    const bPriority = PRIORITY_ORDER.indexOf(b);
    return aPriority - bPriority;
  });
}

function formatLastUpdated(lastUpdated: string | null): string {
  return lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "--";
}

/** Every item is the same three-track grid, so label / price / change share a
 *  baseline and a column across the whole tape. The change track is a fixed
 *  82px even though the text is plain (no pill): `+9.30 (0.22%)` and
 *  `−511.20 (−0.92%)` then line up from item to item. */
const TICKER_GRID = {
  display: "grid",
  "grid-template-columns": "minmax(56px, auto) minmax(64px, 1fr) 82px",
  "align-items": "center",
  "column-gap": "6px",
  "flex-shrink": 0,
} as const;

function createErrorState(error: unknown): MarketTickerData {
  return {
    tickers: {},
    last_updated: new Date().toISOString(),
    loading: false,
    error: error instanceof Error ? error.message : "Failed to fetch market data",
  };
}

interface TickerItemProps {
  symbol: string;
  item: MarketTickerItem;
}

function TickerItem({ symbol, item }: TickerItemProps) {
  const label = getTickerLabel(symbol);
  const price = Number(item.price ?? 0);
  const change = Number(item.change ?? 0);
  const changePercent = Number(item.change_percent ?? 0);
  const isPositive = change >= 0;
  const tone = isPositive ? palette.POSITIVE : palette.NEGATIVE;
  const testId = symbol.replace(/[\^=]/g, "").toLowerCase();

  return (
    <Box
      key={symbol}
      style={TICKER_GRID}
      className="market-ticker-item"
      data-testid={`ticker-${testId}`}
    >
      <Text
        size="sm"
        fw={600}
        c="dimmed"
        style={{ "font-size": 9.5, "line-height": 1.1, "white-space": "nowrap" }}
      >
        {label}
      </Text>
      <Text
        size="sm"
        fw={700}
        data-testid={`ticker-price-${testId}`}
        style={{
          "font-size": 11,
          "line-height": 1.1,
          fontFamily: palette.MONO,
          fontVariantNumeric: "tabular-nums",
          "text-align": "right",
          "white-space": "nowrap",
        }}
      >
        {price.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </Text>
      {/* Plain coloured change — no pill, no icon box. The 9px arrow is an
          inline glyph inside the fixed 82px track so the sign never shifts
          the numerals. */}
      <Box
        component="span"
        data-testid={`ticker-change-${testId}`}
        title={`${change >= 0 ? "+" : ""}${change.toFixed(2)} (${changePercent.toFixed(2)}%)`}
        className="flex items-center justify-end gap-[2px] min-w-0 overflow-hidden whitespace-nowrap font-mono"
        style={{ color: tone, fontVariantNumeric: "tabular-nums" }}
      >
        <Box component="span" aria-hidden className="text-[9px] leading-none">
          {isPositive ? "▲" : "▼"}
        </Box>
        <Text
          size="sm"
          span
          fw={700}
          style={{
            "font-size": 9.5,
            "line-height": 1.1,
            color: tone,
            fontVariantNumeric: "tabular-nums",
            "white-space": "nowrap",
          }}
        >
          {isPositive ? "+" : ""}
          {change.toFixed(2)} ({changePercent.toFixed(2)}%)
        </Text>
      </Box>
    </Box>
  );
}

interface TickerContainerProps {
  children: React.ReactNode;
  background: string;
  title?: string;
}

function TickerContainer({ children, background, title }: TickerContainerProps) {
  return (
    <Box
      bg={background}
      data-testid="market-ticker"
      id="market-ticker"
      className="market-ticker"
      title={title}
      px="sm"
      style={{
        display: "flex",
        "align-items": "center",
        gap: 10,
        height: 22,
        "overflow-x": "auto",
        "overflow-y": "hidden",
        "flex-wrap": "nowrap",
        "min-width": 0,
      }}
    >
      {children}
    </Box>
  );
}

function TickerLoadingState({ background }: { background: string }) {
  return (
    <Box
      bg={background}
      data-testid="market-ticker"
      id="market-ticker"
      className="market-ticker market-ticker-loading"
      px="sm"
      style={{
        display: "flex",
        "align-items": "center",
        gap: 10,
        height: 22,
        overflow: "hidden",
      }}
    >
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Skeleton key={i} w={88} h={14} />
      ))}
    </Box>
  );
}

function TickerErrorState({ background }: { background: string }) {
  return (
    <Box
      bg={background}
      data-testid="market-ticker"
      id="market-ticker"
      className="market-ticker market-ticker-error"
      px="sm"
      style={{ display: "flex", "align-items": "center", height: 22 }}
    >
      <Text size="sm" c="dimmed" style={{ "font-size": 9.5, "line-height": 1.2 }}>
        Market data unavailable
      </Text>
    </Box>
  );
}

function TickerStatus({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <Box
      data-testid="market-ticker-status"
      className="flex items-center gap-0.75 min-w-0 overflow-hidden"
      style={{ "padding-left": 4, "padding-right": 4 }}
    >
      <Box
        aria-hidden
        className="size-6 rounded-full flex-shrink-0"
        style={{ "background-color": palette.TEXT_MUTED }}
      />
      <Text size="sm" fw={600} c="dimmed" style={{ "font-size": 9.5, "line-height": 1.2 }}>{label}</Text>
      {detail ? (
        <Text
          size="sm"
          c="dimmed"
          style={{ "font-size": 9.5, "line-height": 1.2 }}
          className="opacity-75 min-w-0 overflow-hidden truncate"
        >
          · {detail}
        </Text>
      ) : null}
    </Box>
  );
}

function findTodayHoliday() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return getHolidayState().holidays.find((h) => h.date === today) ?? null;
}

/**
 * Single source of truth for "is the exchange open right now?" — the sidebar
 * status dot and the tape must never disagree, and both need the holiday that
 * explains a closure.
 */
function useMarketState() {
  useStoreSubscription(subscribeToHolidays);
  const closed = isMarketClosedToday();
  return { closed, holiday: closed ? findTodayHoliday() : null };
}

/**
 * Standalone market-state indicator for the sidebar. The old top app bar was
 * the only place that said whether the exchange was open; removing that bar
 * must not remove the information, so the dot + label lives next to the brand.
 */
export const MarketStatus = memo(function MarketStatus({ compact = false }: { compact?: boolean }) {
  const { closed, holiday } = useMarketState();
  const label = closed ? "Market closed" : "Market live";
  const detail = closed ? holiday?.description : null;
  const title = detail ? `${label} · ${detail}` : label;

  return (
    <Box
      data-testid="app-market-status"
      title={title}
      className="flex items-center min-w-0 overflow-hidden"
      style={{
        "justify-content": compact ? "center" : "flex-start",
        gap: compact ? 0 : 6,
        "padding-left": compact ? 0 : 2,
        "padding-right": compact ? 0 : 2,
      }}
    >
      <Box
        aria-hidden
        data-testid="app-market-status-dot"
        style={{
          width: 6,
          height: 6,
          "border-radius": "50%",
          "flex-shrink": 0,
          "background-color": closed ? palette.TEXT_MUTED : palette.POSITIVE,
        }}
      />
      {!compact ? (
        <>
          <Text size="sm" fw={600} c="dimmed" style={{ "font-size": 9.5, "line-height": 1.2, "white-space": "nowrap" }}>
            {label}
          </Text>
          {detail ? (
            <Text
              size="sm"
              c="dimmed"
              style={{ "font-size": 9.5, "line-height": 1.2 }}
              className="opacity-75 min-w-0 overflow-hidden truncate"
            >
              · {detail}
            </Text>
          ) : null}
        </>
      ) : null}
    </Box>
  );
});

interface MarketTickerProps {
  /**
   * `full` (default) keeps the legacy behaviour: tape when live, status text
   * when closed. `tape` renders the tape only — the sidebar owns the status,
   * so the page must not reserve a strip for it outside market hours.
   */
  variant?: "full" | "tape";
}

export const MarketTicker = memo(function MarketTicker({ variant = "full" }: MarketTickerProps) {
  const [enabled] = useMarketTickerEnabled();
  const [data, setData] = useState<MarketTickerData | null>(null);
  const { closed, holiday } = useMarketState();
  const tickers = data?.tickers;
  // Ordering is derived from the fetched payload only: tooltip/hover renders
  // must not re-sort the tape.
  const sortedSymbols = useMemo(() => (tickers ? sortTickersByPriority(tickers) : []), [tickers]);

  const fetchTicker = useCallback(async () => {
    if (isMarketClosedToday()) return;
    try {
      const response = await fetch(MARKET_TICKER_API, { priority: "low" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const tickerData = await response.json();
      setData(tickerData);
    } catch (error) {
      setData(createErrorState(error));
    }
  }, []);

  usePolling(fetchTicker, POLL_INTERVAL_MS, {
    enabled: enabled && !closed,
    immediate: true,
    skipIfRunning: false,
  });

  if (!enabled) {
    return null;
  }

  // A closed exchange has no tape to poll: state the reason instead of
  // leaving skeletons (or a blank flex row) sitting in the header.
  if (closed) {
    if (variant === "tape") return null;
    return <TickerStatus label="Market closed" detail={holiday?.description} />;
  }

  if (!data || data.loading) {
    return <TickerLoadingState background="background.paper" />;
  }

  if (data.error) {
    return <TickerErrorState background="background.paper" />;
  }

  const lastUpdated = formatLastUpdated(data.last_updated);
  const rows = tickers ?? {};

  return (
    <TickerContainer background="background.paper" title={`Updated: ${lastUpdated}`}>
      {sortedSymbols.map((symbol) => (
        <TickerItem key={symbol} symbol={symbol} item={rows[symbol]} />
      ))}
    </TickerContainer>
  );
});
