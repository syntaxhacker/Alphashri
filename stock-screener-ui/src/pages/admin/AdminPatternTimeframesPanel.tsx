import { Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { TableColumnDef } from "../../components/common/TanStackTable";
import { ActionIcon, Alert, Box, Button, Loader, NumberInput, Select, Switch, Text } from "@/ui";
import { Icon } from "../../components/common/Icons";
import { useAuth } from "../../components/auth/AuthProvider2";
import { TanStackTable } from "../../components/common/TanStackTable";
import {
  addAdminPatternTimeframe,
  deleteAdminPatternTimeframe,
  fetchAdminPatternTimeframes,
  reorderAdminPatternTimeframes,
  setAdminPatternTimeframeEnabled,
} from "../../api/adminPatternTimeframes";
import type { AdminPatternTimeframe } from "../../types/admin";

const UNIT_OPTIONS = [
  { value: "m", label: "minutes", multiplier: 1 },
  { value: "h", label: "hours", multiplier: 60 },
  { value: "D", label: "days", multiplier: 1440 },
  { value: "W", label: "weeks", multiplier: 10080 },
  { value: "M", label: "months", multiplier: 43200 },
] as const;

const UNIT_DATA = UNIT_OPTIONS.map(({ value, label }) => ({ value, label }));
const SOURCE_AUTO = "auto";

const MONO = "font-mono tabular-nums";

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${formatUnits(minutes / 60)} h`;
  if (minutes < 10080) return `${formatUnits(minutes / 1440)} D`;
  if (minutes < 43200) return `${formatUnits(minutes / 10080)} W`;
  return `${formatUnits(minutes / 43200)} M`;
}

function formatUnits(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function cell(align: "left" | "right" | "center", children: JSX.Element) {
  const justify = align === "right" ? "end" : align === "center" ? "center" : "start";
  return (
    <Box className={`flex items-center gap-1 justify-${justify}`}>
      {children}
    </Box>
  );
}

export function AdminPatternTimeframesPanel() {
  const { fetchWithAuth } = useAuth();
  const [timeframes, setTimeframes] = createSignal<AdminPatternTimeframe[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [savingId, setSavingId] = createSignal<string | null>(null);
  const [reordering, setReordering] = createSignal(false);
  const [amount, setAmount] = createSignal<number | string>("");
  const [unit, setUnit] = createSignal<string>("m");
  const [sourceTf, setSourceTf] = createSignal<string>(SOURCE_AUTO);
  const [adding, setAdding] = createSignal(false);
  const [addError, setAddError] = createSignal<string | null>(null);
  const [deletingId, setDeletingId] = createSignal<string | null>(null);

  onMount(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetchAdminPatternTimeframes(fetchWithAuth)
      .then((rows) => {
        if (active) setTimeframes(rows);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : "Failed to load timeframes");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    onCleanup(() => {
      active = false;
    });
  });

  const updateRow = (id: string, patch: Partial<AdminPatternTimeframe>) => {
    setTimeframes((prev) => prev.map((tf) => (tf.id === id ? { ...tf, ...patch } : tf)));
  };

  const handleToggle = async (timeframe: AdminPatternTimeframe, enabled: boolean) => {
    setActionError(null);
    setSavingId(timeframe.id);
    updateRow(timeframe.id, { enabled });
    try {
      const updated = await setAdminPatternTimeframeEnabled(fetchWithAuth, timeframe.id, enabled);
      updateRow(timeframe.id, updated);
    } catch (err) {
      updateRow(timeframe.id, { enabled: timeframe.enabled });
      setActionError(err instanceof Error ? err.message : "Failed to update timeframe");
    } finally {
      setSavingId(null);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const current = timeframes();
    if (target < 0 || target >= current.length) return;
    setActionError(null);
    setReordering(true);
    const previous = current;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    const reordered = next.map((tf, i) => ({ ...tf, sort_order: i }));
    setTimeframes(reordered);
    try {
      const updated = await reorderAdminPatternTimeframes(
        fetchWithAuth,
        reordered.map((tf) => tf.id),
      );
      if (updated.length > 0) setTimeframes(updated);
    } catch (err) {
      setTimeframes(previous);
      setActionError(err instanceof Error ? err.message : "Failed to reorder timeframes");
    } finally {
      setReordering(false);
    }
  };

  const multiplier = () => UNIT_OPTIONS.find((option) => option.value === unit())?.multiplier ?? 1;
  const amountValue = () => {
    const a = amount();
    return typeof a === "number" ? a : Number.NaN;
  };
  const validAmount = () => Number.isInteger(amountValue()) && amountValue() >= 1;
  const minutes = () => (validAmount() ? amountValue() * multiplier() : 0);
  const targetId = () => (validAmount() ? `${amountValue()}${unit()}` : "");
  const duplicateId = () => targetId() !== "" && timeframes().some((tf) => tf.id === targetId());
  const canAdd = () => targetId() !== "" && !duplicateId() && !adding();

  const sourceOptions = createMemo(() => {
    if (targetId() === "") return [];
    const mins = minutes();
    const candidates = timeframes()
      .filter((tf) => tf.native && tf.minutes < mins && mins % tf.minutes === 0)
      .sort((a, b) => b.minutes - a.minutes)
      .map((tf) => ({ value: tf.id, label: tf.label }));
    return candidates.length === 0 ? [] : [{ value: SOURCE_AUTO, label: "Auto" }, ...candidates];
  });

  const effectiveSource = () =>
    sourceOptions().some((option) => option.value === sourceTf()) ? sourceTf() : SOURCE_AUTO;

  const handleAdd = async () => {
    if (!canAdd()) return;
    setAddError(null);
    setActionError(null);
    setAdding(true);
    try {
      const row = await addAdminPatternTimeframe(fetchWithAuth, {
        id: targetId(),
        label: targetId(),
        minutes: minutes(),
        ...(effectiveSource() === SOURCE_AUTO ? {} : { source_tf: effectiveSource() }),
      });
      setTimeframes((prev) => [...prev, row]);
      setAmount("");
      setSourceTf(SOURCE_AUTO);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add timeframe");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (timeframe: AdminPatternTimeframe) => {
    if (deletingId() !== null) return;
    setActionError(null);
    setAddError(null);
    setDeletingId(timeframe.id);
    const previous = timeframes();
    setTimeframes((prev) => prev.filter((tf) => tf.id !== timeframe.id));
    try {
      await deleteAdminPatternTimeframe(fetchWithAuth, timeframe.id);
    } catch (err) {
      setTimeframes(previous);
      setActionError(err instanceof Error ? err.message : "Failed to delete timeframe");
    } finally {
      setDeletingId(null);
    }
  };

  const columns = createMemo<TableColumnDef<AdminPatternTimeframe>[]>(() => [
    {
      id: "order",
      header: () => cell("right", "#"),
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box className={`flex justify-end ${MONO}`}>
          <Text size="xs" c="dimmed">{row.index + 1}</Text>
        </Box>
      ),
    },
    {
      id: "label",
      header: () => cell("left", "Timeframe"),
      accessorKey: "label",
      meta: { align: "left" },
      cell: ({ row }) => {
        const tf = row.original;
        return (
          <Box className="flex items-center justify-start">
            <Text size="xs" fw={700} data-testid={`admin-tf-label-${tf.id}`}>{tf.label}</Text>
          </Box>
        );
      },
    },
    {
      id: "duration",
      header: () => cell("right", "Duration"),
      accessorKey: "minutes",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box className={`flex justify-end ${MONO}`}>
          <Text size="xs">{formatDuration(row.original.minutes)}</Text>
        </Box>
      ),
    },
    {
      id: "native",
      header: () => cell("left", "Native"),
      accessorFn: (tf) => (tf.native ? "Yes" : `Resampled from ${tf.source_tf ?? "—"}`),
      meta: { align: "left" },
      cell: ({ row }) => {
        const tf = row.original;
        return (
          <Box className="flex items-center justify-start">
            <Text size="xs" c={tf.native ? "text.primary" : "dimmed"}>
              {tf.native ? "Yes" : `Resampled from ${tf.source_tf ?? "—"}`}
            </Text>
          </Box>
        );
      },
    },
    {
      id: "max_lookback_days",
      header: () => cell("right", "Max lookback"),
      accessorKey: "max_lookback_days",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box className={`flex justify-end ${MONO}`}>
          <Text size="xs">{row.original.max_lookback_days.toLocaleString()}</Text>
        </Box>
      ),
    },
    {
      id: "min_bars",
      header: () => cell("right", "Min bars"),
      accessorKey: "min_bars",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box className={`flex justify-end ${MONO}`}>
          <Text size="xs">{row.original.min_bars.toLocaleString()}</Text>
        </Box>
      ),
    },
    {
      id: "enabled",
      header: () => cell("center", "Enabled"),
      accessorKey: "enabled",
      meta: { align: "center" },
      cell: ({ row }) => {
        const tf = row.original;
        return (
          <Box className="flex justify-center">
            <Switch
              size="xs"
              checked={tf.enabled}
              disabled={savingId() === tf.id}
              onChange={(event) => void handleToggle(tf, event.currentTarget.checked)}
              data-testid={`admin-tf-toggle-${tf.id}`}
            />
          </Box>
        );
      },
    },
    {
      id: "move",
      header: () => cell("center", "Move"),
      meta: { align: "center" },
      cell: ({ row }) => {
        const tf = row.original;
        const index = row.index;
        return (
          <Box className="flex justify-center gap-1">
            <ActionIcon
              size="xs"
              variant="subtle"
              aria-label={`Move ${tf.id} up`}
              disabled={index === 0 || reordering() || savingId() !== null}
              onClick={() => void handleMove(index, -1)}
              data-testid={`admin-tf-up-${tf.id}`}
            >
              <Icon name="arrow-up" size={13} />
              <span className="sr-only">Move {tf.id} up</span>
            </ActionIcon>
            <ActionIcon
              size="xs"
              variant="subtle"
              aria-label={`Move ${tf.id} down`}
              disabled={index === timeframes().length - 1 || reordering() || savingId() !== null}
              onClick={() => void handleMove(index, 1)}
              data-testid={`admin-tf-down-${tf.id}`}
            >
              <Icon name="arrow-down" size={13} />
              <span className="sr-only">Move {tf.id} down</span>
            </ActionIcon>
          </Box>
        );
      },
    },
    {
      id: "delete",
      header: () => cell("center", ""),
      meta: { align: "center" },
      cell: ({ row }) => {
        const tf = row.original;
        if (!tf.custom) return null;
        return (
          <Box className="flex justify-center">
            <ActionIcon
              size="xs"
              variant="subtle"
              color="error"
              aria-label={`Delete ${tf.id}`}
              disabled={deletingId() !== null}
              onClick={() => void handleDelete(tf)}
              data-testid={`admin-tf-delete-${tf.id}`}
            >
              <Icon name="trash" size={13} />
              <span className="sr-only">Delete {tf.id}</span>
            </ActionIcon>
          </Box>
        );
      },
    },
  ]);


  const enabledCount = () => timeframes().filter((tf) => tf.enabled).length;
  const totalCount = () => timeframes().length;
  const resampledCount = () => timeframes().filter((tf) => !tf.native).length;

  return (
    <Show
      when={!loading() || timeframes().length > 0}
      fallback={
        <Box data-testid="admin-pattern-timeframes-panel" className="flex items-center gap-1 p-1">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">Loading pattern timeframes…</Text>
        </Box>
      }
    >
      <Box
        data-testid="admin-pattern-timeframes-panel"
        className="flex h-full min-h-0 flex-col p-[2px]"
      >
        <Box className="flex shrink-0 items-center justify-between gap-2 px-1 py-[2px]">
          <Text size="xs" c="dimmed" data-testid="admin-tf-summary" style={{ "font-size": "10px" }}>
            {`${enabledCount()} enabled / ${totalCount()} total · ${Math.max(0, totalCount() - enabledCount())} disabled · ${resampledCount()} resampled`}
          </Text>
          <Text size="xs" c="dimmed" data-testid="admin-tf-note" style={{ "font-size": "10px" }}>
            3m and 2h are off by default
          </Text>
        </Box>

        <Show when={loadError()}>
          <Alert color="error" variant="light" data-testid="admin-tf-load-error">{loadError()}</Alert>
        </Show>

        <Box
          data-testid="admin-tf-add-row"
          className="flex min-h-[26px] shrink-0 flex-wrap items-center gap-1 px-1 py-0"
        >
          <NumberInput
            size="xs"
            w={52}
            min={1}
            placeholder="15"
            value={amount()}
            onChange={setAmount}
            data-testid="admin-tf-amount"
          />
          <Select
            size="xs"
            w={86}
            data={UNIT_DATA}
            value={unit()}
            onChange={(value) => setUnit(value ?? "m")}
            data-testid="admin-tf-unit"
          />
          <Show when={sourceOptions().length > 0}>
            <Text size="xs" c="dimmed" style={{ "font-size": "10px" }}>src</Text>
            <Select
              size="xs"
              w={90}
              data={sourceOptions()}
              value={effectiveSource()}
              onChange={(value) => setSourceTf(value ?? SOURCE_AUTO)}
              data-testid="admin-tf-source"
            />
          </Show>
          <Show
            when={canAdd()}
            fallback={
              <Button
                size="xs"
                variant="filled"
                disabled
                onClick={() => void handleAdd()}
                data-testid="admin-tf-add"
                style={{ "min-width": 0, "min-height": "24px", padding: "2px 10px", "font-size": "11px", "line-height": 1.2 }}
              >
                Add
              </Button>
            }
          >
            <Button
              size="xs"
              variant="filled"
              onClick={() => void handleAdd()}
              data-testid="admin-tf-add"
              style={{ "min-width": 0, "min-height": "24px", padding: "2px 10px", "font-size": "11px", "line-height": 1.2 }}
            >
              Add
            </Button>
          </Show>
          <Text size="xs" c="dimmed" style={{ "font-size": "10px" }}>e.g. 45m, 6h, 2D, 3W, 3M</Text>
          <Show when={addError()}>
            <Text size="xs" c="error" data-testid="admin-tf-add-error" style={{ "font-size": "10px" }}>
              <span data-testid="admin-tf-error">{addError()}</span>
            </Text>
          </Show>
        </Box>

        <Show when={actionError()}>
          <Alert color="error" variant="light" data-testid="admin-tf-error">{actionError()}</Alert>
        </Show>

        <Box className="flex flex-1 min-h-0 flex-col">
          <TanStackTable<AdminPatternTimeframe>
            data={timeframes()}
            columns={columns()}
            dataTestId="admin-pattern-timeframes"
            enableSorting={false}
            dense
            fillContainer
            loading={loading()}
            loadingMessage="Loading pattern timeframes…"
            emptyMessage="No timeframes configured"
            getRowTestId={(tf) => `admin-tf-row-${tf.id}`}
          />
        </Box>
      </Box>
    </Show>
  );
}
