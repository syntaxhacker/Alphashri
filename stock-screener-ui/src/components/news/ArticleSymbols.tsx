import { Box, Badge, Group, Text, Tooltip } from "@/ui";
import { IconChartLine } from "@tabler/icons-react";
import type { NewsSymbol } from "./news-types";

export function ArticleSymbols({
  symbols,
  onSymbolClick,
}: {
  symbols: NewsSymbol[];
  onSymbolClick: (s: NewsSymbol) => void;
}) {
  if (!symbols || symbols.length === 0) return null;
  return (
    <Box data-testid="news-article-symbols">
      <Text size="sm" c="dimmed" mb="xs">
        Stocks mentioned:
      </Text>
      <Group gap="xs">
        {symbols.map((symbol, idx) => (
          <Tooltip
            key={idx}
            label={
              symbol.instrument_key
                ? `View ${symbol.trading_symbol} chart`
                : `Open ${symbol.code} on Moneycontrol`
            }
          >
            <Badge
              variant="light"
              color={symbol.instrument_key ? "blue" : "gray"}
              onClick={() => onSymbolClick(symbol)}
              data-testid={`news-symbol-${symbol.code}`}
            >
              {symbol.name || symbol.code}
              {symbol.instrument_key && <IconChartLine size={12} style={{ marginLeft: 4 }} />}
            </Badge>
          </Tooltip>
        ))}
      </Group>
    </Box>
  );
}
