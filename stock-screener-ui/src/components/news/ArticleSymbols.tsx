import { Show, For } from "solid-js";
import { Box, Badge, Group, Text, Tooltip } from "@/ui";
import { IconChartLine } from "../common/Icons";
import type { NewsSymbol } from "./news-types";

export function ArticleSymbols(props: {
  symbols: NewsSymbol[];
  onSymbolClick: (s: NewsSymbol) => void;
}) {
  return (
    <Show when={props.symbols.length > 0}>
      <Box data-testid="news-article-symbols">
        <Text size="sm" c="dimmed" mb="xs">
          Stocks mentioned:
        </Text>
        <Group gap="xs" align="center">
          <For each={props.symbols}>
            {(symbol) => (
              <Tooltip
                label={
                  symbol.instrument_key
                    ? `View ${symbol.trading_symbol} chart`
                    : `Open ${symbol.code} on Moneycontrol`
                }
              >
                <Badge
                  variant="light"
                  color={symbol.instrument_key ? "primary" : "secondary"}
                  onClick={() => props.onSymbolClick(symbol)}
                  data-testid={`news-symbol-${symbol.code}`}
                >
                  {symbol.name || symbol.code}
                  {symbol.instrument_key ? (
                    <IconChartLine size={12} style={{ "margin-left": "4px" }} />
                  ) : null}
                </Badge>
              </Tooltip>
            )}
          </For>
        </Group>
      </Box>
    </Show>
  );
}
