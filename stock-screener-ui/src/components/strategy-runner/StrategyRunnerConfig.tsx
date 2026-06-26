import { useState, useEffect, useMemo } from "react";
import {
  Group,
  Box,
  Text,
  Button,
  MultiSelect,
  Checkbox,
  Tooltip,
  ActionIcon,
  Progress,
  Stack,
} from "@mantine/core";
import { IconPlayerPlay, IconPlayerStop, IconRotate } from "@tabler/icons-react";
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

  const [symbolInput, setSymbolInput] = useState("");

  useEffect(() => {
    loadBots();
  }, [loadBots]);

  const symbolOptions = useMemo(() => {
    const symbols = new Set<string>();
    for (const bot of bots) {
      for (const sym of bot.watchlist) {
        symbols.add(sym);
      }
    }
    return Array.from(symbols).map((s) => ({ value: s, label: s }));
  }, [bots]);

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
    <Box>
      <Stack gap="sm">
        <Group gap="sm" wrap="wrap" align="flex-end">
          <Box>
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
              <MultiSelect
                size="sm"
                w={220}
                data={symbolOptions}
                value={config.symbols}
                onChange={(v) => setConfig({ symbols: v })}
                searchable
                searchValue={symbolInput}
                onSearchChange={setSymbolInput}
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
