import { useEffect, useState } from "react";
import { Box, Group, Text, Badge, Skeleton } from "@mantine/core";
import { IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";
import { useThemeColors } from "../../hooks/useThemeColors";

interface MarketTickerItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
  is_positive: boolean;
}

interface MarketTickerData {
  tickers: Record<string, MarketTickerItem>;
  last_updated: string | null;
  loading: boolean;
  error: string | null;
}

const MARKET_TICKER_API = "http://localhost:8765/api/market-ticker";

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

export function MarketTicker() {
  const [data, setData] = useState<MarketTickerData | null>(null);
  const { background, border, theme } = useThemeColors();

  useEffect(() => {
    const fetchTicker = async () => {
      try {
        const response = await fetch(MARKET_TICKER_API);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const tickerData = await response.json();
        setData(tickerData);
      } catch (error) {
        setData({
          tickers: {},
          last_updated: new Date().toISOString(),
          loading: false,
          error: error instanceof Error ? error.message : "Failed to fetch market data",
        });
      }
    };

    fetchTicker();
    const interval = setInterval(fetchTicker, 30000);

    return () => clearInterval(interval);
  }, []);

  if (!data || data.loading) {
    return (
      <Box
        bg={background}
        data-testid="market-ticker"
        style={{
          borderBottom: `1px solid ${border}`,
          padding: `${theme.spacing.xs} ${theme.spacing.md}`,
        }}
      >
        <Group gap="md">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} width={120} height={30} />
          ))}
        </Group>
      </Box>
    );
  }

  if (data.error) {
    return (
      <Box
        bg={background}
        data-testid="market-ticker"
        style={{
          borderBottom: `1px solid ${border}`,
          padding: `${theme.spacing.xs} ${theme.spacing.md}`,
        }}
      >
        <Text size="xs" c="dimmed">
          Market data unavailable
        </Text>
      </Box>
    );
  }

  const tickers = data.tickers || {};
  const sortedSymbols = Object.keys(tickers).sort((a, b) => {
    const aPriority = PRIORITY_ORDER.indexOf(a);
    const bPriority = PRIORITY_ORDER.indexOf(b);
    return aPriority - bPriority;
  });

  const lastUpdated = data.last_updated ? new Date(data.last_updated).toLocaleTimeString() : "--";

  return (
    <Box
      bg={background}
      data-testid="market-ticker"
      style={{
        borderBottom: `1px solid ${border}`,
        padding: `${theme.spacing.xs} ${theme.spacing.md}`,
        overflowX: "auto",
      }}
    >
      <Group gap="md" wrap="nowrap">
        {sortedSymbols.map((symbol) => {
          const item = tickers[symbol];
          const label = getTickerLabel(symbol);
          const price = Number(item.price ?? 0);
          const change = Number(item.change ?? 0);
          const changePercent = Number(item.change_percent ?? 0);
          const isPositive = change >= 0;

          return (
            <Group key={symbol} gap="xs" wrap="nowrap">
              <Text size="xs" fw={600} c="dimmed">
                {label}
              </Text>
              <Text size="xs" fw={700}>
                {price.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
              <Badge
                size="xs"
                color={isPositive ? "green" : "red"}
                variant="light"
                leftSection={
                  isPositive ? <IconTrendingUp size={10} /> : <IconTrendingDown size={10} />
                }
              >
                {isPositive ? "+" : ""}
                {change.toFixed(2)} ({changePercent.toFixed(2)}%)
              </Badge>
            </Group>
          );
        })}
        <Text size="xs" c="dimmed" ml="auto">
          Updated: {lastUpdated}
        </Text>
      </Group>
    </Box>
  );
}
