import { useState, useEffect, useMemo } from "react";
import { Group, Box, Text, Select, Button, Switch, Loader, Alert, MultiSelect, Tooltip, ActionIcon, Badge, Modal, TextInput, Stack } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconPlayerPlay, IconPlayerStop, IconAlertTriangle, IconX, IconDeviceFloppy, IconFolderOpen, IconTrash } from "@tabler/icons-react";
import { ScreenerSymbolPicker } from "./ScreenerSymbolPicker";
import { listBots } from "../../api/bots";
import { searchSymbols } from "../../api/symbols";
import { fetchSavedConfigs, saveReplayConfig, deleteReplayConfig } from "../../api/replay";
import type { BotConfig } from "../../types/bots";
import type { ReplayConfig as ReplayConfigType, ReplaySavedConfig } from "../../types/replay";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { TradingDatePicker } from "../common/TradingDatePicker";
import {
  getHolidayState,
  subscribeToHolidays,
  loadHolidays,
  isTradingHoliday,
} from "../../state/holidays";

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
  const [savedConfigs, setSavedConfigs] = useState<ReplaySavedConfig[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [newConfigName, setNewConfigName] = useState("");
  const [newConfigDescription, setNewConfigDescription] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    fetchSavedConfigs()
      .then(setSavedConfigs)
      .catch(() => {});
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

  const handleSave = async () => {
    setSaveError(null);
    if (!newConfigName.trim()) {
      setSaveError("Name is required");
      return;
    }
    try {
      await saveReplayConfig(newConfigName.trim(), config, newConfigDescription.trim() || undefined);
      setSaveModalOpen(false);
      setNewConfigName("");
      setNewConfigDescription("");
      const updated = await fetchSavedConfigs();
      setSavedConfigs(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save config");
    }
  };

  const handleLoadConfig = (saved: ReplaySavedConfig) => {
    setConfig(saved.config);
    setLoadModalOpen(false);
  };

  const handleDeleteConfig = async (saved: ReplaySavedConfig) => {
    setLoadError(null);
    try {
      await deleteReplayConfig(saved.id);
      setSavedConfigs((prev) => prev.filter((c) => c.id !== saved.id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to delete config");
    }
  };

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
          <>
            <Button
              size="sm"
              leftSection={<IconPlayerPlay size={16} />}
              disabled={!config.date}
              onClick={startReplay}
              data-testid="replay-run-btn"
            >
              Run Replay
            </Button>

            <Tooltip label="Save current config">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setNewConfigName("");
                  setNewConfigDescription("");
                  setSaveError(null);
                  setSaveModalOpen(true);
                }}
                data-testid="replay-save-config-btn"
              >
                <IconDeviceFloppy size={16} />
              </ActionIcon>
            </Tooltip>

            <Tooltip label="Load saved config">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setLoadError(null);
                  setLoadModalOpen(true);
                }}
                data-testid="replay-load-config-btn"
              >
                <IconFolderOpen size={16} />
              </ActionIcon>
            </Tooltip>
          </>
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

      {/* Save Config Modal */}
      <Modal
        opened={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save Replay Config"
        size="sm"
        data-testid="replay-save-modal"
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            placeholder="e.g. 52W May 18-22"
            value={newConfigName}
            onChange={(e) => setNewConfigName(e.currentTarget.value)}
            data-testid="replay-save-name-input"
          />
          <TextInput
            label="Description (optional)"
            placeholder="Touched 52W stocks with 52W bot"
            value={newConfigDescription}
            onChange={(e) => setNewConfigDescription(e.currentTarget.value)}
            data-testid="replay-save-desc-input"
          />
          {saveError && (
            <Text size="xs" c="red">
              {saveError}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="subtle" color="gray" onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button size="xs" onClick={handleSave} data-testid="replay-save-confirm-btn">
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Load Config Modal */}
      <Modal
        opened={loadModalOpen}
        onClose={() => setLoadModalOpen(false)}
        title="Load Saved Config"
        size="md"
        data-testid="replay-load-modal"
      >
        <Stack gap="xs">
          {loadError && (
            <Text size="xs" c="red">
              {loadError}
            </Text>
          )}
          {savedConfigs.length === 0 ? (
            <Text size="sm" c="dimmed">
              No saved configs yet.
            </Text>
          ) : (
            savedConfigs.map((saved) => (
              <Group key={saved.id} gap="xs" wrap="nowrap">
                <Box style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>
                    {saved.name}
                  </Text>
                  {saved.description && (
                    <Text size="xs" c="dimmed">
                      {saved.description}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    {saved.config.date}
                    {saved.config.end_date ? ` → ${saved.config.end_date}` : ""}
                    {" · "}
                    {saved.config.strategy}
                    {saved.config.symbols.length > 0
                      ? ` · ${saved.config.symbols.length} symbols`
                      : ""}
                  </Text>
                </Box>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => handleLoadConfig(saved)}
                  data-testid={`load-config-${saved.id}`}
                >
                  Load
                </Button>
                <Tooltip label="Delete">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => handleDeleteConfig(saved)}
                    data-testid={`delete-config-${saved.id}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))
          )}
        </Stack>
      </Modal>

      {holidayWarning && (
        <Alert mt="xs" color="orange" icon={<IconAlertTriangle size={16} />} p="xs">
          <Text size="xs">{holidayWarning}</Text>
        </Alert>
      )}
    </Box>
  );
}
