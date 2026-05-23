import { useState, useEffect, useMemo } from "react";
import { Group, Box, Text, Select, Button, Switch, Loader, Alert, MultiSelect, Tooltip, ActionIcon, Badge } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconPlayerPlay, IconPlayerStop, IconAlertTriangle, IconX } from "@tabler/icons-react";
import { listBots } from "../../api/bots";
import { searchSymbols } from "../../api/symbols";
import type { BotConfig } from "../../types/bots";
import type { ReplayConfig as ReplayConfigType } from "../../types/replay";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { TradingDatePicker } from "../common/TradingDatePicker";
import {
  getHolidayState,
  subscribeToHolidays,
  loadHolidays,
  isTradingHoliday,
} from "../../state/holidays";

const STRATEGY_OPTIONS = [
  { value: "ALL", label: "All Strategies" },
  { value: "ORB", label: "ORB Only" },
  { value: "SR", label: "SR Breakout" },
  { value: "EMA", label: "EMA Cross" },
  { value: "52W", label: "52W Chaser" },
];

interface ReplayConfigProps {
  config: ReplayConfigType;
  isRunning: boolean;
  setConfig: (config: Partial<ReplayConfigType>) => void;
  startReplay: () => void;
  stopReplay: () => void;
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

export function ReplayConfigBar({
  config,
  isRunning,
  setConfig,
  startReplay,
  stopReplay,
  reset,
}: ReplayConfigProps) {
  const maxDate = useMemo(() => getMaxDate(), []);
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [holidayWarning, setHolidayWarning] = useState<string | null>(null);
  const [symbolSearch, setSymbolSearch] = useState("");
  const [symbolOptions, setSymbolOptions] = useState<{ value: string; label: string }[]>([]);
  const [debouncedSearch] = useDebouncedValue(symbolSearch, 300);
  const botOptions = useMemo(() => bots.map((b) => ({ value: b.uuid, label: b.name })), [bots]);

  useEffect(() => {
    if (debouncedSearch.trim().length < 1) {
      setSymbolOptions([]);
      return;
    }
    searchSymbols(debouncedSearch, 20)
      .then((results) => {
        setSymbolOptions(
          results.map((r) => ({
            value: r.symbol,
            label: `${r.symbol} - ${r.name}`,
          })),
        );
      })
      .catch((err) => {
        console.error("Failed to search symbols:", err);
      });
  }, [debouncedSearch]);

  useStoreSubscription(subscribeToHolidays);
  const holidayState = getHolidayState();

  useEffect(() => {
    listBots()
      .then(setBots)
      .catch(() => {});
    loadHolidays(2026);
  }, []);

  useEffect(() => {
    if (!config.date) {
      setHolidayWarning(null);
      return;
    }
    if (isTradingHoliday(config.date)) {
      const h = holidayState.holidays.find((h) => h.date === config.date);
      setHolidayWarning(h ? `${h.description} — market closed` : "Trading holiday — market closed");
    } else {
      setHolidayWarning(null);
    }
  }, [config.date, holidayState.holidays]);

  return (
    <Box>
      <Group gap="sm" wrap="wrap" data-testid="replay-config">
        <Box>
          <Text size="xs" fw={500} mb={2}>
            Bot
          </Text>
          <Select
            size="sm"
            w={180}
            data={botOptions}
            value={config.bot_uuid || null}
            onChange={(v) => setConfig({ bot_uuid: v ?? "" })}
            allowDeselect
            clearable
            searchable
            placeholder="Default bot"
            data-testid="replay-bot-select"
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
              data-testid="replay-date-from"
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
              data-testid="replay-date-to"
            />
          </Box>
        </Group>

        <Box>
          <Text size="xs" fw={500} mb={2}>
            Strategy
          </Text>
          <Select
            size="sm"
            w={160}
            data={STRATEGY_OPTIONS}
            value={config.strategy}
            onChange={(v) => setConfig({ strategy: v ?? "ALL" })}
            allowDeselect={false}
            data-testid="replay-strategy-select"
          />
        </Box>

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
              searchValue={symbolSearch}
              onSearchChange={setSymbolSearch}
              clearable
              hidePickedOptions
              placeholder="Search symbols..."
              nothingFoundMessage="No symbols found"
              maxDropdownHeight={200}
              data-testid="replay-symbols-select"
            />
            {config.symbols.length > 0 && (
              <Tooltip label="Clear all symbols">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  onClick={() => setConfig({ symbols: [] })}
                  data-testid="clear-symbols-btn"
                >
                  <IconX size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          {config.symbols.length > 0 && (
            <Box mt={4} data-testid="symbol-chips">
              {config.symbols.map((symbol) => (
                <Badge
                  key={symbol}
                  variant="outline"
                  size="sm"
                  mr={4}
                  mb={4}
                  rightSection={
                    <IconX
                      size={10}
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        setConfig({ symbols: config.symbols.filter((s) => s !== symbol) })
                      }
                    />
                  }
                >
                  {symbol}
                </Badge>
              ))}
            </Box>
          )}
        </Box>

        <Box>
          <Text size="xs" fw={500} mb={2}>
            Refresh Cache
          </Text>
          <Switch
            size="sm"
            checked={config.refresh_cache}
            onChange={(e) => setConfig({ refresh_cache: e.currentTarget.checked })}
            data-testid="replay-refresh-cache-switch"
          />
        </Box>

        {isRunning ? (
          <Button
            size="sm"
            color="red"
            variant="light"
            leftSection={<IconPlayerStop size={16} />}
            onClick={stopReplay}
            data-testid="replay-stop-btn"
          >
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            leftSection={
              isRunning ? <Loader size={14} type="dots" /> : <IconPlayerPlay size={16} />
            }
            disabled={!config.date}
            onClick={startReplay}
            data-testid="replay-run-btn"
          >
            Run Replay
          </Button>
        )}

        {!isRunning && config.date && (
          <Button
            size="sm"
            variant="subtle"
            color="gray"
            onClick={reset}
            data-testid="replay-reset-btn"
          >
            Reset
          </Button>
        )}
      </Group>

      {holidayWarning && (
        <Alert mt="xs" color="orange" icon={<IconAlertTriangle size={16} />} p="xs">
          <Text size="xs">{holidayWarning}</Text>
        </Alert>
      )}
    </Box>
  );
}
