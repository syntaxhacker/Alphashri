import { useEffect, useState, useCallback } from "react";
import { Box, Group, Text, Badge, Skeleton } from "@/ui";
import { IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";
import { useThemeColors } from "../../hooks/useThemeColors";
import { useMarketTickerEnabled } from "../../hooks/useMarketTickerEnabled";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";

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

  return (
    <Group
      key={symbol}
      gap="xs"
      wrap="nowrap"
      className="market-ticker-item"
      data-testid={`ticker-${symbol.replace(/[\\^\\=]/g, "").toLowerCase()}`}
    >
      <Text size="sm" fw={600} c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={700}>
        {price.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </Text>
      <Badge
        size="sm"
        color={isPositive ? "green" : "red"}
        variant="light"
        leftSection={isPositive ? <IconTrendingUp size={10} /> : <IconTrendingDown size={10} />}
      >
        {isPositive ? "+" : ""}
        {change.toFixed(2)} ({changePercent.toFixed(2)}%)
      </Badge>
    </Group>
  );
}

interface TickerContainerProps {
  children: React.ReactNode;
  background: string;
}

function TickerContainer({ children, background }: TickerContainerProps) {
  return (
    <Box
      bg={background}
      data-testid="market-ticker"
      id="market-ticker"
      className="market-ticker"
      px="sm"
      py="xs"
      style={{
        overflowX: "auto",
      }}
    >
      <Group gap="sm" wrap="nowrap" className="market-ticker-items">
        {children}
      </Group>
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
      py="xs"
    >
      <Group gap="sm">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} width={120} height={30} />
        ))}
      </Group>
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
      py="xs"
    >
      <Text size="sm" c="dimmed">
        Market data unavailable
      </Text>
    </Box>
  );
}

export function MarketTicker() {
  const [enabled] = useMarketTickerEnabled();
  const [data, setData] = useState<MarketTickerData | null>(null);
  const { background } = useThemeColors();
  useStoreSubscription(subscribeToHolidays);

  // If disabled, render nothing
  if (!enabled) {
    return null;
  }

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
    fetchTicker();
    const interval = setInterval(fetchTicker, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchTicker]);

  if (!data || data.loading) {
    return <TickerLoadingState background={background} />;
  }

  if (data.error) {
    return <TickerErrorState background={background} />;
  }

  const tickers = data.tickers || {};
  const sortedSymbols = sortTickersByPriority(tickers);
  const lastUpdated = formatLastUpdated(data.last_updated);

  return (
    <TickerContainer background={background}>
      {sortedSymbols.map((symbol) => (
        <TickerItem key={symbol} symbol={symbol} item={tickers[symbol]} />
      ))}
      <Text size="sm" c="dimmed" ml="auto" data-testid="market-ticker-updated">
        Updated: {lastUpdated}
      </Text>
    </TickerContainer>
  );
}
