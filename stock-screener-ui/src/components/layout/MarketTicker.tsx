import { useEffect, useState, useCallback } from "react";
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
  gridTemplateColumns: "minmax(56px, auto) minmax(64px, 1fr) 82px",
  alignItems: "center",
  columnGap: "6px",
  flexShrink: 0,
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
        style={{ fontSize: 9.5, lineHeight: 1.1, whiteSpace: "nowrap" }}
      >
        {label}
      </Text>
      <Text
        size="sm"
        fw={700}
        data-testid={`ticker-price-${testId}`}
        style={{
          fontSize: 11,
          lineHeight: 1.1,
          fontFamily: palette.MONO,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          whiteSpace: "nowrap",
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
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "2px",
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          color: tone,
          fontFamily: palette.MONO,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Box component="span" aria-hidden sx={{ fontSize: 9, lineHeight: 1 }}>
          {isPositive ? "▲" : "▼"}
        </Box>
        <Text
          size="sm"
          span
          fw={700}
          style={{
            fontSize: 9.5,
            lineHeight: 1.1,
            color: tone,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
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
        alignItems: "center",
        gap: 10,
        height: 22,
        overflowX: "auto",
        overflowY: "hidden",
        flexWrap: "nowrap",
        minWidth: 0,
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
        alignItems: "center",
        gap: 10,
        height: 22,
        overflow: "hidden",
      }}
    >
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Skeleton key={i} width={88} height={14} />
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
      style={{ display: "flex", alignItems: "center", height: 22 }}
    >
      <Text size="sm" c="dimmed" style={{ fontSize: 9.5, lineHeight: 1.2 }}>
        Market data unavailable
      </Text>
    </Box>
  );
}

function TickerStatus({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <Box
      data-testid="market-ticker-status"
      sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, px: 0.5, overflow: "hidden" }}
    >
      <Box
        aria-hidden
        sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "text.disabled", flexShrink: 0 }}
      />
      <Text size="sm" fw={600} c="dimmed" style={{ fontSize: 9.5, lineHeight: 1.2 }}>{label}</Text>
      {detail ? (
        <Text
          size="sm"
          c="dimmed"
          style={{ fontSize: 9.5, lineHeight: 1.2 }}
          sx={{ opacity: 0.75, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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

export function MarketTicker() {
  const [enabled] = useMarketTickerEnabled();
  const [data, setData] = useState<MarketTickerData | null>(null);
  useStoreSubscription(subscribeToHolidays);
  const closed = isMarketClosedToday();
  const holiday = closed ? findTodayHoliday() : null;

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

  useEffect(() => {
    if (!enabled || closed) return;
    fetchTicker();
    const interval = setInterval(fetchTicker, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, closed, fetchTicker]);

  if (!enabled) {
    return null;
  }

  // A closed exchange has no tape to poll: state the reason instead of
  // leaving skeletons (or a blank flex row) sitting in the header.
  if (closed) {
    return <TickerStatus label="Market closed" detail={holiday?.description} />;
  }

  if (!data || data.loading) {
    return <TickerLoadingState background="background.paper" />;
  }

  if (data.error) {
    return <TickerErrorState background="background.paper" />;
  }

  const tickers = data.tickers || {};
  const sortedSymbols = sortTickersByPriority(tickers);
  const lastUpdated = formatLastUpdated(data.last_updated);

  return (
    <TickerContainer background="background.paper" title={`Updated: ${lastUpdated}`}>
      {sortedSymbols.map((symbol) => (
        <TickerItem key={symbol} symbol={symbol} item={tickers[symbol]} />
      ))}
    </TickerContainer>
  );
}
