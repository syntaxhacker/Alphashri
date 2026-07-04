import { useState, useEffect, useMemo } from "react";
import {
  Group,
  Box,
  Text,
  Button,
  MultiSelect,
  Tooltip,
  ActionIcon,
  Progress,
  Stack,
  Badge,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconPlayerPlay, IconPlayerStop, IconRotate, IconX } from "@tabler/icons-react";
import { searchSymbols } from "../../api/symbols";
import type { SymbolResult } from "../../api/symbols";
import { ScreenerSymbolPicker } from "../replay/ScreenerSymbolPicker";
import { TradingDatePicker } from "../common/TradingDatePicker";
import type { StrategyRunnerConfig, BotInfo } from "../../types/strategyRunner";

interface Props {
  config: StrategyRunnerConfig;
  bots: BotInfo[];
  isRunning: boolean;
  progress: { currentBot: number; totalBots: number; currentBotName: string };
  setConfig: (partial: Partial<StrategyRunnerConfig>) => void;
  loadBots: () => Promise<void>;
  startRunner: () => void;
  stopRunner: () => void;
  reset: () => void;
}

function getMaxDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function StrategyRunnerConfig({
  config,
  bots,
  isRunning,
  progress,
  setConfig,
  loadBots,
  startRunner,
  stopRunner,
  reset,
}: Props) {
  const maxDate = useMemo(() => getMaxDate(), []);

  const [symbolSearch, setSymbolSearch] = useState("");
  const [debouncedSymbolSearch] = useDebouncedValue(symbolSearch, 300);
  const [symbolOptions, setSymbolOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    loadBots();
  }, [loadBots]);

  useEffect(() => {
    if (!debouncedSymbolSearch) {
      setSymbolOptions([]);
      return;
    }
    let cancelled = false;
    searchSymbols(debouncedSymbolSearch, 20).then((results: SymbolResult[]) => {
      if (!cancelled) {
        setSymbolOptions(results.map((r) => ({ value: r.symbol, label: `${r.symbol} - ${r.name}` })));
      }
    });
    return () => { cancelled = true; };
  }, [debouncedSymbolSearch]);

  const allWatchlistSymbols = useMemo(
    () => Array.from(new Set(bots.flatMap((b) => b.watchlist))),
    [bots],
  );

  const handleAddAllSymbols = () => {
    setConfig({ symbols: allWatchlistSymbols });
  };

  const progressPct =
    progress.totalBots > 0
      ? Math.round((progress.currentBot / progress.totalBots) * 100)
      : 0;

  return (
    <Box data-testid="sr-config-bar">
      <Stack gap="sm">
        <Group gap="sm" wrap="wrap" align="flex-end">
          <Box data-testid="sr-bot-select">
            <Text size="xs" fw={500} mb={2}>
              Bots
            </Text>
            <MultiSelect
              size="sm"
              w={260}
              data={bots.map((b) => ({ value: b.uuid, label: b.name }))}
              value={config.bot_uuids}
              onChange={(v) => setConfig({ bot_uuids: v })}
              searchable
              clearable
              placeholder="Select bots..."
              nothingFoundMessage="No bots found"
              maxDropdownHeight={200}
            />
          </Box>

          <Group gap="xs">
            <Box>
              <Text size="xs" fw={500} mb={2}>
                From
              </Text>
              <TradingDatePicker
                w={140}
                maxDate={maxDate}
                value={config.date}
                onChange={(v) => setConfig({ date: v })}
                placeholder="From"
              />
            </Box>
            <Box>
              <Text size="xs" fw={500} mb={2}>
                To
              </Text>
              <TradingDatePicker
                w={140}
                maxDate={maxDate}
                value={config.end_date}
                onChange={(v) => setConfig({ end_date: v })}
                placeholder="To"
              />
            </Box>
          </Group>

          <Box>
            <Text size="xs" fw={500} mb={2}>
              Symbols
            </Text>
            <Group gap={4}>
              <ScreenerSymbolPicker
                symbols={config.symbols}
                onAddSymbols={(newSymbols) => setConfig({ symbols: [...config.symbols, ...newSymbols] })}
              />
              <MultiSelect
                size="sm"
                w={220}
                data={symbolOptions}
                value={config.symbols}
                onChange={(v) => setConfig({ symbols: v })}
                searchable
                searchValue={symbolSearch}
                onSearchChange={setSymbolSearch}
                clearable
                hidePickedOptions
                placeholder="Search symbols..."
                nothingFoundMessage="No symbols found"
                maxDropdownHeight={200}
              />
              {allWatchlistSymbols.length > 0 && (
                <Tooltip label="Add all watchlist symbols">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={handleAddAllSymbols}
                  >
                    <Text size="xs" fw={700}>
                      ALL
                    </Text>
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
            {config.symbols.length > 0 && (
              <Box mt={4}>
                {config.symbols.slice(0, 10).map((sym) => (
                  <Badge
                    key={sym}
                    variant="outline"
                    size="sm"
                    mr={4}
                    mb={4}
                    rightSection={
                      <IconX
                        size={10}
                        style={{ cursor: "pointer" }}
                        onClick={() => setConfig({ symbols: config.symbols.filter((s) => s !== sym) })}
                      />
                    }
                  >
                    {sym}
                  </Badge>
                ))}
                {config.symbols.length > 10 && (
                  <Text size="xs" c="dimmed" span>
                    +{config.symbols.length - 10} more
                  </Text>
                )}
              </Box>
            )}
          </Box>

          <Box>
            <Text size="xs" fw={500} mb={2}>
              &nbsp;
            </Text>
            {isRunning ? (
              <Button
                size="sm"
                color="red"
                variant="light"
                leftSection={<IconPlayerStop size={16} />}
                onClick={stopRunner}
                data-testid="sr-stop-btn"
              >
                Stop
              </Button>
            ) : (
              <Group gap="xs">
                <Button
                  size="sm"
                  leftSection={<IconPlayerPlay size={16} />}
                  disabled={config.bot_uuids.length === 0 || !config.date}
                  onClick={startRunner}
                  data-testid="sr-run-btn"
                >
                  Run
                </Button>
                {config.date && (
                  <Tooltip label="Reset">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      onClick={reset}
                    >
                      <IconRotate size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            )}
          </Box>
        </Group>

        {isRunning && progress.totalBots > 0 && (
          <Box>
            <Group gap="xs" mb={4}>
              <Text size="xs" c="dimmed">
                {progress.currentBotName
                  ? `Processing ${progress.currentBotName}`
                  : "Starting..."}
              </Text>
              <Text size="xs" c="dimmed">
                ({progress.currentBot}/{progress.totalBots})
              </Text>
            </Group>
            <Progress value={progressPct} size="sm" animated />
          </Box>
        )}
      </Stack>
    </Box>
  );
}
