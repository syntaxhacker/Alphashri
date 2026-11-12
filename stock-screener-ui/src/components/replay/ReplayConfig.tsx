import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { Text, Select, Button, Switch, Alert, MultiSelect, Tooltip, ActionIcon, Badge, TextInput, Modal, Group, Box, Stack } from "@/ui";
import { IconPlayerPlay, IconPlayerStop, IconAlertTriangle, IconX, IconDeviceFloppy, IconFolderOpen, IconTrash } from "@/components/common/Icons";
import { ScreenerSymbolPicker } from "./ScreenerSymbolPicker";
import { listBots } from "../../api/bots";
import { searchSymbols } from "../../api/symbols";
import { fetchSavedConfigs, saveReplayConfig, deleteReplayConfig } from "../../api/replay";
import type { BotConfig } from "../../types/bots";
import type { ReplayConfig as ReplayConfigType, ReplaySavedConfig } from "../../types/replay";
import { useStoreSnapshot } from "../paper-trading/storeSnapshot";
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

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDisplayDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const monthIdx = Number(m) - 1;
  if (!y || !d || Number.isNaN(monthIdx) || !MONTHS_SHORT[monthIdx]) return iso;
  return `${d} ${MONTHS_SHORT[monthIdx]} ${y}`;
}

function getMaxDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ReplayConfigBar(props: ReplayConfigProps) {
  const maxDate = getMaxDate();
  const [bots, setBots] = createSignal<BotConfig[]>([]);
  const [holidayWarning, setHolidayWarning] = createSignal<string | null>(null);
  const [symbolSearch, setSymbolSearch] = createSignal("");
  const [symbolOptions, setSymbolOptions] = createSignal<{ value: string; label: string }[]>([]);
  const [savedConfigs, setSavedConfigs] = createSignal<ReplaySavedConfig[]>([]);
  const [saveModalOpen, setSaveModalOpen] = createSignal(false);
  const [loadModalOpen, setLoadModalOpen] = createSignal(false);
  const [newConfigName, setNewConfigName] = createSignal("");
  const [newConfigDescription, setNewConfigDescription] = createSignal("");
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  const botOptions = createMemo(() => bots().map((b) => ({ value: b.uuid, label: b.name })));

  // Debounced symbol search — local effect instead of @/ui's useDebouncedValue,
  // which never re-fires after mount (it reads the value once at setup).
  createEffect(() => {
    const q = symbolSearch().trim();
    if (q.length < 1) {
      setSymbolOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      searchSymbols(q, 20)
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
    }, 300);
    onCleanup(() => clearTimeout(timer));
  });

  const holidaySnap = useStoreSnapshot(subscribeToHolidays, getHolidayState);

  onMount(() => {
    listBots()
      .then(setBots)
      .catch(() => {});
    loadHolidays(2026);
    fetchSavedConfigs()
      .then(setSavedConfigs)
      .catch(() => {});
  });

  createEffect(() => {
    const date = props.config.date;
    holidaySnap();
    if (!date) {
      setHolidayWarning(null);
      return;
    }
    if (isTradingHoliday(date)) {
      const h = holidaySnap().holidays.find((h) => h.date === date);
      setHolidayWarning(h ? `${h.description} — market closed` : "Trading holiday — market closed");
    } else {
      setHolidayWarning(null);
    }
  });

  const handleSave = async () => {
    setSaveError(null);
    if (!newConfigName().trim()) {
      setSaveError("Name is required");
      return;
    }
    try {
      await saveReplayConfig(newConfigName().trim(), props.config, newConfigDescription().trim() || undefined);
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
    props.setConfig(saved.config);
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
      <Group gap="sm" wrap="wrap" align="flex-start" data-testid="replay-config">
        <Box>
          <Text size="xs" fw={500} style={{ marginBottom: "8px" }}>
            Bot
          </Text>
          <Select
            size="sm"
            w={180}
            data={botOptions()}
            value={props.config.bot_uuid || null}
            onChange={(v) => props.setConfig({ bot_uuid: v ?? "" })}
            allowDeselect
            clearable
            searchable
            placeholder="Default bot"
            data-testid="replay-bot-select"
          />
        </Box>

        <Group gap="xs" align="flex-start">
          <Box data-testid="replay-date-from">
            <Text size="xs" fw={500} style={{ marginBottom: "8px" }}>
              From
            </Text>
            <TradingDatePicker
              w={140}
              maxDate={maxDate}
              value={props.config.date}
              onChange={(v) => props.setConfig({ date: v })}
              placeholder="From"
            />
            {props.config.date && <span style={{ display: "none" }}>{formatDisplayDate(props.config.date)}</span>}
          </Box>
          <Box data-testid="replay-date-to">
            <Text size="xs" fw={500} style={{ marginBottom: "8px" }}>
              To
            </Text>
            <TradingDatePicker
              w={140}
              maxDate={maxDate}
              value={props.config.end_date}
              onChange={(v) => props.setConfig({ end_date: v })}
              placeholder="To"
            />
            {props.config.end_date && <span style={{ display: "none" }}>{formatDisplayDate(props.config.end_date)}</span>}
          </Box>
        </Group>

        <Box>
          <Text size="xs" fw={500} style={{ marginBottom: "8px" }}>
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
              onSearchChange={setSymbolSearch}
              clearable
              hidePickedOptions
              placeholder="Search symbols..."
              nothingFoundMessage="No symbols found"
              maxDropdownHeight={200}
              data-testid="replay-symbols-select"
            />
            <Show when={props.config.symbols.length > 0}>
              <Tooltip label="Clear all symbols">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="secondary"
                  onClick={() => props.setConfig({ symbols: [] })}
                  data-testid="clear-symbols-btn"
                >
                  <IconX size={14} />
                </ActionIcon>
              </Tooltip>
            </Show>
          </Group>
          <Show when={props.config.symbols.length > 0}>
            <Box mt={4} data-testid="symbol-chips">
              <For each={props.config.symbols}>{(symbol) => (
                <Badge
                  variant="outline"
                  size="sm"
                  style={{ marginRight: "8px", marginBottom: "8px" }}
                  rightSection={
                    <IconX
                      size={10}
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        props.setConfig({ symbols: props.config.symbols.filter((s) => s !== symbol) })
                      }
                    />
                  }
                >
                  {symbol}
                </Badge>
              )}</For>
            </Box>
          </Show>
        </Box>

        <Box>
          <Text size="xs" fw={500} style={{ marginBottom: "8px" }}>
            Refresh Cache
          </Text>
          <Switch
            size="sm"
            checked={props.config.refresh_cache}
            onChange={(e) => props.setConfig({ refresh_cache: e.currentTarget.checked })}
            data-testid="replay-refresh-cache-switch"
          />
        </Box>

        <Box>
          <Text size="xs" fw={500} style={{ marginBottom: "8px" }}>
            &nbsp;
          </Text>
          <Group gap="xs" align="center">
            <Show
              when={props.isRunning}
              fallback={
                <>
                  <Button
                    size="sm"
                    leftSection={<IconPlayerPlay size={16} />}
                    disabled={!props.config.date}
                    onClick={props.startReplay}
                    data-testid="replay-run-btn"
                  >
                    Run Replay
                  </Button>

                  <Tooltip label="Save current config">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="secondary"
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
                      color="secondary"
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
              }
            >
              <Button
                size="sm"
                color="error"
                variant="filled"
                leftSection={<IconPlayerStop size={16} />}
                onClick={props.stopReplay}
                data-testid="replay-stop-btn"
              >
                Stop
              </Button>
            </Show>

            <Show when={!props.isRunning && props.config.date}>
              <Button
                size="sm"
                variant="subtle"
                color="secondary"
                onClick={props.reset}
                data-testid="replay-reset-btn"
              >
                Reset
              </Button>
            </Show>
          </Group>
        </Box>
      </Group>

      {/* Save Config Modal */}
      <Modal
        opened={saveModalOpen()}
        onClose={() => setSaveModalOpen(false)}
        title="Save Replay Config"
        size="sm"
        data-testid="replay-save-modal"
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            placeholder="e.g. 52W May 18-22"
            value={newConfigName()}
            onChange={(val) => setNewConfigName(val)}
            data-testid="replay-save-name-input"
          />
          <TextInput
            label="Description (optional)"
            placeholder="Touched 52W stocks with 52W bot"
            value={newConfigDescription()}
            onChange={(val) => setNewConfigDescription(val)}
            data-testid="replay-save-desc-input"
          />
          <Show when={saveError()}>
            {(err) => (
              <Text size="xs" c="error">
                {err()}
              </Text>
            )}
          </Show>
          <Group justify="flex-end" gap="xs" align="center">
            <Button size="xs" variant="subtle" color="secondary" onClick={() => setSaveModalOpen(false)}>
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
        opened={loadModalOpen()}
        onClose={() => setLoadModalOpen(false)}
        title="Load Saved Config"
        size="md"
        data-testid="replay-load-modal"
      >
        <Stack gap="xs">
          <Show when={loadError()}>
            {(err) => (
              <Text size="xs" c="error">
                {err()}
              </Text>
            )}
          </Show>
          <Show
            when={savedConfigs().length > 0}
            fallback={<Text size="sm" c="dimmed">No saved configs yet.</Text>}
          >
            <For each={savedConfigs()}>{(saved) => (
              <Group gap="xs" wrap="nowrap" align="center">
                <Box style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>
                    {saved.name}
                  </Text>
                  <Show when={saved.description}>
                    <Text size="xs" c="dimmed">
                      {saved.description}
                    </Text>
                  </Show>
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
                    color="error"
                    onClick={() => handleDeleteConfig(saved)}
                    data-testid={`delete-config-${saved.id}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}</For>
          </Show>
        </Stack>
      </Modal>

      <Show when={holidayWarning()}>
        {(warning) => (
          <Box mt="xs">
            <Alert color="warning" icon={<IconAlertTriangle size={16} />}>
              <Text size="xs">{warning()}</Text>
            </Alert>
          </Box>
        )}
      </Show>
    </Box>
  );
}
