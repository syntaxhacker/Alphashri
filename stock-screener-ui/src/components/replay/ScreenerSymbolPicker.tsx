import { useState } from "react";
import {
  Modal,
  Stack,
  Group,
  Select,
  Button,
  Checkbox,
  ScrollArea,
  Text,
  Badge,
  Divider,
} from "@/ui";
import { IconDatabase, IconPlus } from "@tabler/icons-react";
import { fetchWithAuth } from "../../state/auth";
import type { Stock } from "../../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

const SCREENER_OPTIONS = [
  { value: "52w_high", label: "52W High" },
  { value: "near_52w_breakout", label: "Near 52W Breakout (Legacy)" },
  { value: "touched_52w_high", label: "Touched 52W High (Legacy)" },
  { value: "trending", label: "Trending" },
  { value: "high_momentum", label: "High Momentum" },
  { value: "buyer_interest", label: "Buyer Interest" },
  { value: "intraday_5m", label: "5-Min Movers" },
  { value: "intraday_10m", label: "10-Min Movers" },
  { value: "intraday_15m", label: "15-Min Movers" },
];

function getScoreColor(score: number): string {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "error";
}

function pctColor(pct: number): string {
  return pct >= 0 ? "info.main" : "error.main";
}

function formatPrice(p: number): string {
  return "₹" + p.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatTouchDate(stock: Stock): string {
  if (stock.last_touched) {
    const d = new Date(stock.last_touched);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }
  if (stock.days_ago !== null && stock.days_ago !== undefined) {
    if (stock.days_ago === 0) return "Today";
    if (stock.days_ago === 1) return "Yesterday";
    const d = new Date();
    d.setDate(d.getDate() - stock.days_ago);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }
  return "-";
}

interface ScreenerSymbolPickerProps {
  symbols: string[];
  onAddSymbols: (newSymbols: string[]) => void;
}

export function ScreenerSymbolPicker({ symbols, onAddSymbols }: ScreenerSymbolPickerProps) {
  const [opened, setOpened] = useState(false);
  const [selectedScreener, setSelectedScreener] = useState<string>("52w_high");
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());

  const handleLoad = async () => {
    setIsLoading(true);
    setError(null);
    setHasLoaded(false);
    setSelectedSet(new Set());
    try {
      const res = await fetchWithAuth(
        `${API_BASE}/api/screener?provider=upstox&mode=intraday&screener=${selectedScreener}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const allStocks: Stock[] = [...(data.approaching || []), ...(data.touched || [])];
      setStocks(allStocks);
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load screener");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = () => {
    const existing = new Set(symbols);
    const newSymbols = [...selectedSet].filter((s) => !existing.has(s));
    if (newSymbols.length > 0) {
      onAddSymbols(newSymbols);
    }
    setOpened(false);
  };

  const toggleStock = (symbol: string) => {
    const next = new Set(selectedSet);
    if (next.has(symbol)) next.delete(symbol);
    else next.add(symbol);
    setSelectedSet(next);
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedSet(new Set(stocks.map((s) => s.symbol)));
    } else {
      setSelectedSet(new Set());
    }
  };

  const toggleTouched = (checked: boolean) => {
    const touchedStocks = stocks.filter((s) => s.touched_52w);
    if (checked) {
      const next = new Set(selectedSet);
      touchedStocks.forEach((s) => next.add(s.symbol));
      setSelectedSet(next);
    } else {
      const next = new Set(selectedSet);
      touchedStocks.forEach((s) => next.delete(s.symbol));
      setSelectedSet(next);
    }
  };

  const allSelected = stocks.length > 0 && selectedSet.size === stocks.length;
  const touchedCount = stocks.filter((s) => s.touched_52w).length;
  const touchedChecked = stocks.length > 0 && stocks.filter((s) => s.touched_52w).every((s) => selectedSet.has(s.symbol));

  return (
    <>
      <Button
        size="sm"
        variant="subtle"
        color="secondary"
        leftSection={<IconDatabase size={16} />}
        onClick={() => setOpened(true)}
        data-testid="screener-picker-btn"
      >
        Load
      </Button>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Load Symbols from Screener"
        size="md"
        data-testid="screener-picker-modal"
      >
        <Stack gap="sm">
          <Group gap="xs" wrap="nowrap">
            <Select
              size="sm"
              w={260}
              data={SCREENER_OPTIONS}
              value={selectedScreener}
              onChange={(v) => v && setSelectedScreener(v)}
              data-testid="screener-select"
            />
            <Button
              size="sm"
              variant="light"
              onClick={handleLoad}
              loading={isLoading}
              leftSection={<IconPlus size={14} />}
              data-testid="screener-load-btn"
            >
              Load
            </Button>
          </Group>

          {error && (
            <Text size="sm" c="error" data-testid="screener-error">
              {error}
            </Text>
          )}

          {isLoading && (
            <Text size="sm" c="dimmed" ta="center" py="md">
              Loading stocks...
            </Text>
          )}

          {!isLoading && hasLoaded && stocks.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="md" data-testid="screener-empty">
              No stocks found for this screener.
            </Text>
          )}

          {!isLoading && stocks.length > 0 && (
            <>
              <Group gap="md">
                <Checkbox
                  size="xs"
                  checked={allSelected}
                  onChange={(checked) => toggleAll(checked)}
                  label={`All (${stocks.length})`}
                  data-testid="screener-select-all"
                />
                {touchedCount > 0 && (
                  <Checkbox
                    size="xs"
                    checked={touchedChecked}
                    indeterminate={!touchedChecked && [...selectedSet].some((s) => stocks.find((st) => st.symbol === s)?.touched_52w)}
                    onChange={(checked) => toggleTouched(checked)}
                    label={`Touched (${touchedCount})`}
                    data-testid="screener-select-touched"
                  />
                )}
              </Group>

              <Divider />

              <ScrollArea h={350} data-testid="screener-stock-list">
                <Stack gap={0}>
                  {stocks.map((stock, idx) => {
                    const price = stock.upstox_price || stock.tv_price || 0;
                    const pct = stock.to_52w_high || 0;
                    return (
                      <Group
                        key={stock.symbol}
                        gap="xs"
                        wrap="nowrap"
                        px="xs"
                        py={3}
                        sx={{
                          borderRadius: 1,
                          cursor: "pointer",
                          bgcolor: idx % 2 === 1 ? "background.default" : undefined,
                          "&:hover": { bgcolor: "action.hover" },
                        }}

                      >
                        <Checkbox
                          size="xs"
                          checked={selectedSet.has(stock.symbol)}
                          onChange={() => toggleStock(stock.symbol)}
                          data-testid={`stock-check-${stock.symbol}`}
                        />
                        <Text size="xs" w={88} fw={500} style={{ fontFamily: "monospace" }}>
                          {stock.symbol}
                        </Text>
                        <Text size="xs" w={82} ta="right" style={{ fontFamily: "monospace" }}>
                          {formatPrice(price)}
                        </Text>
                        <Text size="xs" w={65} ta="right" c={pctColor(pct)} style={{ fontFamily: "monospace" }}>
                          {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                        </Text>
                        {stock.touched_52w ? (
                          <Text size="xs" w={72} ta="center" c="primary" style={{ fontFamily: "monospace" }}>
                            {formatTouchDate(stock)}
                          </Text>
                        ) : (
                          <Text size="xs" w={72} ta="center" c="dimmed">
                            -
                          </Text>
                        )}
                        <Badge size="sm" color={getScoreColor(stock.score)} variant="light" w={36}>
                          {stock.score}
                        </Badge>
                      </Group>
                    );
                  })}
                </Stack>
              </ScrollArea>
            </>
          )}

          {!isLoading && stocks.length > 0 && (
            <>
              <Divider />
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  {selectedSet.size} of {stocks.length} selected
                </Text>
                <Button
                  size="sm"
                  disabled={selectedSet.size === 0}
                  onClick={handleAdd}
                  leftSection={<IconPlus size={14} />}
                  data-testid="screener-add-btn"
                >
                  Add {selectedSet.size} &rarr; Symbols
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
}
