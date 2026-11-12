import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
} from "@/ui";
import { IconPlayerPlay, IconPlayerStop, IconRotate, IconX } from "../common/Icons";
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

export function StrategyRunnerConfig(props: Props) {
  const maxDate = getMaxDate();

  const [symbolSearch, setSymbolSearch] = createSignal("");
  const [debouncedSymbolSearch, setDebouncedSymbolSearch] = createSignal("");
  const [symbolOptions, setSymbolOptions] = createSignal<{ value: string; label: string }[]>([]);

  // Debounce locally; the shared useDebouncedValue hook captures a single
  // value and is not reactive under Solid.
  createEffect(() => {
    const q = symbolSearch();
    const timer = setTimeout(() => setDebouncedSymbolSearch(q), 300);
    onCleanup(() => clearTimeout(timer));
  });

  onMount(() => {
    void props.loadBots();
  });

  createEffect(() => {
    const q = debouncedSymbolSearch();
    if (!q) {
      setSymbolOptions([]);
      return;
    }
    let cancelled = false;
    searchSymbols(q, 20).then((results: SymbolResult[]) => {
      if (!cancelled) {
        setSymbolOptions(results.map((r) => ({ value: r.symbol, label: `${r.symbol} - ${r.name}` })));
      }
    });
    onCleanup(() => { cancelled = true; });
  });

  const allWatchlistSymbols = createMemo(() =>
    Array.from(new Set(props.bots.flatMap((b) => b.watchlist))),
  );

  const handleAddAllSymbols = () => {
    props.setConfig({ symbols: allWatchlistSymbols() });
  };

  const progressPct = createMemo(() =>
    props.progress.totalBots > 0
      ? Math.round((props.progress.currentBot / props.progress.totalBots) * 100)
      : 0,
  );

  return (
    <Box data-testid="sr-config-bar">
      <Stack gap="sm">
        <Group gap="sm" wrap="wrap" align="flex-start">
          <Box data-testid="sr-bot-select">
            <Text size="xs" fw={500} mb={2}>
              Bots
            </Text>
            <MultiSelect
              size="sm"
              w={260}
              data={props.bots.map((b) => ({ value: b.uuid, label: b.name }))}
              value={props.config.bot_uuids}
              onChange={(v) => props.setConfig({ bot_uuids: v })}
              searchable
              clearable
              placeholder="Select bots..."
              nothingFoundMessage="No bots found"
              maxDropdownHeight={200}
            />
          </Box>

          <Group gap="xs" align="flex-start">
            <Box>
              <Text size="xs" fw={500} mb={2}>
                From
              </Text>
              <TradingDatePicker
                w={140}
                maxDate={maxDate}
                value={props.config.date}
                onChange={(v) => props.setConfig({ date: v })}
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
                value={props.config.end_date}
                onChange={(v) => props.setConfig({ end_date: v })}
                placeholder="To"
              />
            </Box>
          </Group>

          <Box>
            <Text size="xs" fw={500} mb={2}>
              Symbols
            </Text>
            <Group gap={4} align="center">
              <ScreenerSymbolPicker
                symbols={props.config.symbols}
                onAddSymbols={(newSymbols) => props.setConfig({ symbols: [...props.config.symbols, ...newSymbols] })}
              />
              <MultiSelect
                size="sm"
                w={220}
                data={symbolOptions()}
                value={props.config.symbols}
                onChange={(v) => props.setConfig({ symbols: v })}
                searchable
                searchValue={symbolSearch()}
                onSearchChange={(v) => setSymbolSearch(v)}
                clearable
                hidePickedOptions
                placeholder="Search symbols..."
                nothingFoundMessage="No symbols found"
                maxDropdownHeight={200}
              />
              <Show when={allWatchlistSymbols().length > 0}>
                <Tooltip label="Add all watchlist symbols">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="secondary"
                    onClick={handleAddAllSymbols}
                  >
                    <Text size="xs" fw={700}>
                      ALL
                    </Text>
                  </ActionIcon>
                </Tooltip>
              </Show>
            </Group>
            <Show when={props.config.symbols.length > 0}>
              <Box mt={4}>
                <For each={props.config.symbols.slice(0, 10)}>
                  {(sym) => (
                    <Badge
                      variant="outline"
                      size="sm"
                      className="mr-1 mb-1"
                      rightSection={
                        <ActionIcon
                          size="xs"
                          variant="transparent"
                          color="secondary"
                          className="cursor-pointer"
                          onClick={() => props.setConfig({ symbols: props.config.symbols.filter((s) => s !== sym) })}
                          aria-label={`Remove ${sym}`}
                        >
                          <IconX size={10} />
                        </ActionIcon>
                      }
                    >
                      {sym}
                    </Badge>
                  )}
                </For>
                <Show when={props.config.symbols.length > 10}>
                  <Text size="xs" c="dimmed" span>
                    +{props.config.symbols.length - 10} more
                  </Text>
                </Show>
              </Box>
            </Show>
          </Box>

          <Box>
            <Text size="xs" fw={500} mb={2}>
              &nbsp;
            </Text>
            <Show
              when={props.isRunning}
              fallback={
                <Group gap="xs" align="center">
                  <Button
                    size="sm"
                    leftSection={<IconPlayerPlay size={16} />}
                    disabled={props.config.bot_uuids.length === 0 || !props.config.date}
                    onClick={props.startRunner}
                    data-testid="sr-run-btn"
                  >
                    Run
                  </Button>
                  <Show when={props.config.date}>
                    <Tooltip label="Reset">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="secondary"
                        onClick={props.reset}
                      >
                        <IconRotate size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Show>
                </Group>
              }
            >
              <Button
                size="sm"
                color="error"
                variant="filled"
                leftSection={<IconPlayerStop size={16} />}
                onClick={props.stopRunner}
                data-testid="sr-stop-btn"
              >
                Stop
              </Button>
            </Show>
          </Box>
        </Group>

        <Show when={props.isRunning && props.progress.totalBots > 0}>
          <Box>
            <Group gap="xs" align="center" mb={4}>
              <Text size="xs" c="dimmed">
                {props.progress.currentBotName
                  ? `Processing ${props.progress.currentBotName}`
                  : "Starting..."}
              </Text>
              <Text size="xs" c="dimmed" class="font-mono tabular-nums">
                ({props.progress.currentBot}/{props.progress.totalBots})
              </Text>
            </Group>
            <Progress value={progressPct()} size="sm" animated />
          </Box>
        </Show>
      </Stack>
    </Box>
  );
}
