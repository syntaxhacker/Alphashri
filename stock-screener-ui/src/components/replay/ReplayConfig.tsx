import { useMemo } from "react";
import { Group, Box, Text, TextInput, Select, Button, Switch, Loader } from "@mantine/core";
import { IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import type { ReplayConfig as ReplayConfigType } from "../../types/replay";

const STRATEGY_OPTIONS = [
  { value: "ALL", label: "All Strategies" },
  { value: "ORB", label: "ORB Only" },
  { value: "SR", label: "SR Breakout" },
  { value: "EMA", label: "EMA Cross" },
  { value: "52W", label: "52W Chaser" },
];

const SYMBOL_OPTIONS = [
  { value: "DEFAULT", label: "Default Watchlist (20)" },
  { value: "TOP25", label: "Top 25 Volatile" },
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
  return d.toISOString().split("T")[0];
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

  return (
    <Group gap="sm" wrap="wrap" data-testid="replay-config">
      <Box>
        <Text size="xs" fw={500} mb={2}>
          Date
        </Text>
        <TextInput
          type="date"
          size="sm"
          w={160}
          max={maxDate}
          value={config.date}
          onChange={(e) => setConfig({ date: e.currentTarget.value })}
        />
      </Box>

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
        />
      </Box>

      <Box>
        <Text size="xs" fw={500} mb={2}>
          Symbols
        </Text>
        <Select
          size="sm"
          w={180}
          data={SYMBOL_OPTIONS}
          value={config.symbols ?? "DEFAULT"}
          onChange={(v) => setConfig({ symbols: v })}
          creatable
          allowDeselect={false}
          searchable
        />
      </Box>

      <Box>
        <Text size="xs" fw={500} mb={2}>
          Refresh Cache
        </Text>
        <Switch
          size="sm"
          checked={config.refresh_cache}
          onChange={(e) => setConfig({ refresh_cache: e.currentTarget.checked })}
        />
      </Box>

      {isRunning ? (
        <Button
          size="sm"
          color="red"
          variant="light"
          leftSection={<IconPlayerStop size={16} />}
          onClick={stopReplay}
        >
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          leftSection={isRunning ? <Loader size={14} type="dots" /> : <IconPlayerPlay size={16} />}
          disabled={!config.date}
          onClick={startReplay}
        >
          Run Replay
        </Button>
      )}

      {!isRunning && config.date && (
        <Button size="sm" variant="subtle" color="gray" onClick={reset}>
          Reset
        </Button>
      )}
    </Group>
  );
}
