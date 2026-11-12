import { Show, Switch, Match, createEffect, createMemo, createSignal, For, onCleanup, type JSX } from "solid-js";
import {
  Stack,
  Text,
  Badge,
  Group,
  ToolbarRow,
  Box,
  Button,
  ScrollArea,
  TextInput,
  Checkbox,
  Select,
  NumberInput,
  Skeleton,
  Paper,
} from "@/ui";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { fetchWithAuth } from "@/state/auth";
import type { ScreenerOption, ProfileFilter, ColumnDef } from "../../types";
import { ScreenerTable } from "./ScreenerTable";
import { SelectionBar } from "./SelectionBar";
import { createScreener, updateScreener, deleteScreener } from "../../api/screeners";
import { loadScreeners } from "../../api/index";
import {
  approachingStocksOf,
  buildScreenerPreviewUrl,
  type ScreenerFilterDefault,
} from "@/api/screenerQuery";
import type { Stock } from "../../types";

const ALL_COLUMNS = [
  { key: "symbol", label: "Symbol" },
  { key: "score", label: "Score" },
  { key: "tv_price", label: "Price" },
  { key: "upstox_price", label: "LTP" },
  { key: "to_52w_high", label: "52W Gap %" },
  { key: "recent_return_5d", label: "Return 5D" },
  { key: "perf_w", label: "Perf W" },
  { key: "sector", label: "Sector" },
  { key: "day_change", label: "Day Change" },
  { key: "rsi", label: "RSI" },
  { key: "adx", label: "ADX" },
  { key: "volume_m", label: "Volume (M)" },
  { key: "volume_surge", label: "Vol Surge" },
  { key: "wick_close_pct", label: "Wick %" },
  { key: "atr_pct", label: "ATR %" },
  { key: "market_cap_b", label: "Market Cap" },
  { key: "touched_52w", label: "Touched 52W" },
];

const DEFAULT_FILTERS: Record<string, ProfileFilter> = {
  RSI: { key: "rsi", label: "RSI", type: "number", min: 0, max: 100, default: 50, step: 1 },
  ADX: { key: "adx", label: "ADX", type: "number", min: 0, max: 100, default: 20, step: 1 },
  Volume: { key: "volume_m", label: "Volume (M)", type: "number", min: 0, default: 1, step: 0.1 },
  "52W Gap %": {
    key: "to_52w_high",
    label: "52W Gap %",
    type: "number",
    min: -100,
    default: 10,
    step: 1,
  },
  Stochastic: {
    key: "stochastic",
    label: "Stochastic",
    type: "number",
    min: 0,
    max: 100,
    default: 20,
    step: 1,
  },
  ATR: { key: "atr_pct", label: "ATR %", type: "number", min: 0, default: 2, step: 0.1 },
  MACD: {
    key: "macd",
    label: "MACD",
    type: "select",
    options: ["bullish", "bearish", "neutral"],
    default: "bullish",
  },
  Momentum: { key: "momentum", label: "Momentum", type: "number", min: -100, default: 0, step: 1 },
};

interface Props {
  screenerOptions: ScreenerOption[];
  activeScreener: string;
  onScreenerChange: (id: string) => void;
}

interface ScreenerForm {
  id?: string;
  label: string;
  description: string;
  indicators: string[];
  columns: string[];
  filters: ProfileFilter[];
  defaultSortColumn: string;
  defaultSortDirection: "asc" | "desc";
}

const EMPTY_FORM: ScreenerForm = {
  label: "",
  description: "",
  indicators: [],
  columns: [],
  filters: [],
  defaultSortColumn: "score",
  defaultSortDirection: "desc",
};

export function ScreenerConfigView(props: Props) {
  const [createModalOpen, setCreateModalOpen] = createSignal(false);
  const [editModalOpen, setEditModalOpen] = createSignal(false);
  const [editingScreener, setEditingScreener] = createSignal<ScreenerOption | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);
  const [deletingId, setDeletingId] = createSignal<string | null>(null);
  const [form, setForm] = createSignal<ScreenerForm>(EMPTY_FORM);
  const [saving, setSaving] = createSignal(false);
  const [touchedSymbols] = createSignal<Set<string>>(new Set());

  const activeOption = createMemo(() =>
    props.screenerOptions.find((o) => o.id === props.activeScreener) ?? null,
  );
  const columns = createMemo(() =>
    activeOption()?.columns || [
      "symbol",
      "score",
      "rsi",
      "day_change",
      "volume_m",
      "perf_w",
      "sector",
    ],
  );

  const filterArr = createMemo(() => {
    const out: { key: string; default: any; min?: number; max?: number }[] = [];
    const activeFilters = activeOption()?.filters;
    if (activeFilters) {
      Object.entries(activeFilters as Record<string, any>).forEach(([key, value]) => {
        if (Array.isArray(value) && value.length === 2) {
          out.push({ key: key + "_min", default: value[0] });
          out.push({ key: key + "_max", default: value[1] });
        } else {
          out.push({ key, default: value });
        }
      });
    }
    return out;
  });

  // Config preview: load once per screener selection (debounced, NOT on
  // every filter keystroke — too many loaders). Manual reload via ↻ button.
  const [previewStocks, setPreviewStocks] = createSignal<Stock[]>([]);
  const [previewLoading, setPreviewLoading] = createSignal(true);
  let previewAbort: AbortController | null = null;

  const loadPreview = () => {
    const url = buildScreenerPreviewUrl({
      screener: props.activeScreener,
      columns: columns(),
      filters: filterArr() as unknown as ScreenerFilterDefault[] | undefined,
    });
    previewAbort?.abort();
    const controller = new AbortController();
    previewAbort = controller;
    setPreviewLoading(true);
    fetchWithAuth(url, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        setPreviewStocks(approachingStocksOf(json));
        setPreviewLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load screener preview:", err);
        setPreviewStocks([]);
        setPreviewLoading(false);
      });
  };

  createEffect(() => {
    void props.activeScreener;
    const timer = setTimeout(loadPreview, 500);
    onCleanup(() => clearTimeout(timer));
  });
  onCleanup(() => previewAbort?.abort());

  const columnDefs = createMemo<ColumnDef[]>(() =>
    columns().map((key) => ({
      key,
      label: ALL_COLUMNS.find((c) => c.key === key)?.label || key,
      sortable: true,
    })),
  );

  const handleCreate = async () => {
    const f = form();
    if (!f.label || f.columns.length === 0) return;
    setSaving(true);
    try {
      await createScreener({
        name: f.label,
        description: f.description,
        indicators: f.indicators,
        columns: f.columns,
        filters: Object.fromEntries((f.filters || []).map((filter) => [filter.key, filter.default])),
        default_sort: f.defaultSortColumn
          ? { column: f.defaultSortColumn, direction: f.defaultSortDirection }
          : undefined,
      });
      setCreateModalOpen(false);
      setForm(EMPTY_FORM);
      await loadScreeners(false);
    } catch (e) {
      console.error("Failed to create screener:", e);
      alert(`Failed to create screener: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    const f = form();
    const editing = editingScreener();
    if (!f.label || f.columns.length === 0 || !editing) return;
    setSaving(true);
    try {
      await updateScreener(Number(editing.id), {
        name: f.label,
        description: f.description,
        indicators: f.indicators,
        columns: f.columns,
        filters: Object.fromEntries((f.filters || []).map((filter) => [filter.key, filter.default])),
        default_sort: f.defaultSortColumn
          ? { column: f.defaultSortColumn, direction: f.defaultSortDirection }
          : undefined,
      });
      setEditModalOpen(false);
      setEditingScreener(null);
      setForm(EMPTY_FORM);
      await loadScreeners(false);
    } catch (e) {
      console.error("Failed to update screener:", e);
      alert(`Failed to update screener: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const id = deletingId();
    if (!id) return;
    setSaving(true);
    try {
      await deleteScreener(Number(id));
      setDeleteConfirmOpen(false);
      setDeletingId(null);
      if (props.activeScreener === id) {
        props.onScreenerChange("trending");
      }
      await loadScreeners(false);
    } catch (e) {
      console.error("Failed to delete screener:", e);
      alert(`Failed to delete screener: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (screener: ScreenerOption) => {
    setEditingScreener(screener);
    setForm({
      id: screener.id,
      label: screener.label,
      description: screener.description || "",
      indicators: screener.indicators || [],
      columns: screener.columns || [],
      filters: screener.filters || [],
      defaultSortColumn: screener.default_sort?.column || "score",
      defaultSortDirection: screener.default_sort?.direction || "desc",
    });
    setEditModalOpen(true);
  };

  const openDeleteConfirm = (id: string) => {
    setDeletingId(id);
    setDeleteConfirmOpen(true);
  };

  const handleIndicatorToggle = (indicator: string, checked: boolean) => {
    const f = form();
    let newIndicators: string[];
    let newFilters: ProfileFilter[];

    if (checked) {
      newIndicators = [...f.indicators, indicator];
      const defaultFilter = DEFAULT_FILTERS[indicator];
      newFilters = defaultFilter ? [...f.filters, { ...defaultFilter }] : [...f.filters];
    } else {
      newIndicators = f.indicators.filter((i) => i !== indicator);
      newFilters = f.filters.filter((filter) => filter.key !== DEFAULT_FILTERS[indicator]?.key);
    }
    setForm({ ...f, indicators: newIndicators, filters: newFilters });
  };

  const updateFilterValue = (key: string, value: number | string) => {
    const f = form();
    const newFilters = f.filters.map((filter) => (filter.key === key ? { ...filter, default: value } : filter));
    setForm({ ...f, filters: newFilters });
  };

  const renderFilterInput = (filter: ProfileFilter): JSX.Element => {
    if (filter.type === "number") {
      return (
        <Box className="flex items-center w-[120px]">
          <NumberInput
            label={filter.label}
            value={filter.default as number}
            onChange={(val) => updateFilterValue(filter.key, val || 0)}
            min={filter.min}
            max={filter.max}
            step={filter.step}
            className="w-[120px]"
          />
        </Box>
      );
    }
    if (filter.type === "select" && filter.options) {
      return (
        <Box className="flex items-center w-[120px]">
          <Select
            label={filter.label}
            data={filter.options}
            value={filter.default as string}
            onChange={(val) => updateFilterValue(filter.key, val || "")}
            className="w-[120px]"
          />
        </Box>
      );
    }
    return <></>;
  };

  const activeFilterBadges = (): Record<string, any> => {
    const active = activeOption();
    if (!active) return {};
    if (Array.isArray(active.filters)) {
      const obj: Record<string, any> = {};
      active.filters.forEach((f: any) => {
        if (f.key && f.default !== undefined) obj[f.key] = f.default;
      });
      return obj;
    }
    if (active.filters && typeof active.filters === "object") {
      return active.filters as Record<string, any>;
    }
    return {};
  };

  const formOpen = () => createModalOpen() || editModalOpen();

  return (
    <Box flex={1} p={1} gap={1} bg={palette.BG} className="h-full min-h-0 min-w-0 flex">
      <Paper
        w={260}
        radius={2}
        data-testid="screener-list-panel"
        className="flex-shrink-0 flex flex-col overflow-hidden border border-fin-border"
      >
        <Box className="flex items-center justify-between gap-2 px-3 py-2 h-[36px] flex-shrink-0 border-b border-fin-border bg-fin-surface-alt">
          <Text fw={600} size="xs" data-testid="screener-configs-title" style={{ "font-size": 11, "letter-spacing": 0.5, color: palette.TEXT_MUTED }}>
            CONFIGS
          </Text>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setForm({
                ...EMPTY_FORM,
                columns: ["symbol", "score", "rsi", "day_change", "volume_m", "perf_w", "sector"],
                filters: [
                  { key: "min_rsi", label: "Min RSI", type: "number", default: 30, min: 0, max: 100, step: 1 },
                  { key: "min_adx", label: "Min ADX", type: "number", default: 15, min: 0, max: 100, step: 1 },
                  { key: "min_volume_m", label: "Min Vol (M)", type: "number", default: 2, min: 0, max: 100, step: 0.5 },
                ],
              });
              setCreateModalOpen(true);
            }}
            data-testid="create-screener-btn"
            style={{ "font-size": 11, height: 24, color: palette.TEXT }}
          >
            + Create
          </Button>
        </Box>
        <ScrollArea h="100%" type="auto">
          <Stack gap={0} p={1}>
            <For each={props.screenerOptions}>
              {(option) => (
                <Box
                  p={1}
                  data-testid={`screener-row-${option.id}`}
                  className={[
                    "rounded-sm cursor-pointer mb-1 border-fin-border",
                    option.id === props.activeScreener ? "bg-fin-surface-alt border" : "bg-transparent border-0",
                  ].join(" ")}
                  onClick={() => props.onScreenerChange(option.id)}
                >
                  <Box className="flex items-center justify-between gap-2 mb-1">
                    <Group gap={1} align="center">
                      <Text size="xs" fw={500} style={{ "font-size": 12, color: palette.TEXT }}>
                        {option.label}
                      </Text>
                      <Show when={option.id === props.activeScreener}>
                        <Badge size="xs" color="default" variant="light" data-testid="screener-active-badge">
                          Active
                        </Badge>
                      </Show>
                    </Group>
                    <Group className="gap-1" align="center">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation();
                          openEditModal(option);
                        }}
                        data-testid={`edit-screener-${option.id}`}
                        style={{ "font-size": 11, height: 22, padding: "0 6px", "border-color": palette.BORDER, color: palette.TEXT }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        color="error"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation();
                          openDeleteConfirm(option.id);
                        }}
                        data-testid={`delete-screener-${option.id}`}
                        style={{ "font-size": 11, height: 22, padding: "0 6px" }}
                      >
                        Del
                      </Button>
                    </Group>
                  </Box>
                  <Text size="xs" c="dimmed" lineClamp={1} style={{ "font-size": 11, color: palette.TEXT_MUTED }}>
                    {option.id}
                  </Text>
                </Box>
              )}
            </For>
          </Stack>
        </ScrollArea>
      </Paper>

      <Paper
        data-testid="screener-preview-panel"
        radius={2}
        className="flex-1 min-w-0 flex flex-col overflow-hidden border border-fin-border"
      >
        <Box data-testid="preview-header" className="flex items-center justify-between gap-2 px-3 py-2 h-[36px] flex-shrink-0 border-b border-fin-border bg-fin-surface-alt">
          <Group gap={1} wrap="wrap" data-testid="screener-filters" align="center">
            <Show
              when={activeOption()}
              fallback={
                <Text size="xs" c="dimmed" style={{ "font-size": 11, color: palette.TEXT_MUTED }}>
                  Select a screener
                </Text>
              }
            >
              {(active) => (
                <>
                  <Badge size="xs" color="default" variant="light" data-testid="screener-name-badge">
                    {active().label}
                  </Badge>
                  <For each={Object.entries(activeFilterBadges())}>
                    {([key, value]) => (
                      <Badge size="xs" color="default" variant="light">
                        {key.replace(/_/g, " ")}: {String(value)}
                      </Badge>
                    )}
                  </For>
                </>
              )}
            </Show>
          </Group>
          <Group gap={1} align="center" className="flex-shrink-0">
            <Text fw={600} size="xs" data-testid="preview-count" style={{ "font-size": 11, color: palette.TEXT_MUTED }}>
              PREVIEW ({previewStocks().length})
            </Text>
            <Button
              size="xs"
              variant="outline"
              onClick={() => loadPreview()}
              loading={previewLoading()}
              data-testid="preview-refresh-btn"
              style={{ height: 24, "font-size": 11 }}
            >
              ↻
            </Button>
          </Group>
        </Box>
        <Show when={formOpen()}>
          <Box gap={2} bg={palette.BG} className="flex p-3 border-b border-fin-border max-h-[380px] overflow-auto" data-testid="inline-form">
            <Stack gap={1}>
              <Box className="flex items-center justify-between gap-2 mb-1">
                <Text fw={600} size="xs" style={{ "font-size": 11, "letter-spacing": 0.5, color: palette.TEXT_MUTED }}>{editModalOpen() ? "EDIT SCREENER" : "NEW SCREENER"}</Text>
                <Button size="xs" variant="subtle" onClick={() => { setCreateModalOpen(false); setEditModalOpen(false); setEditingScreener(null); setForm(EMPTY_FORM); }} style={{ height: 22 }}>✕</Button>
              </Box>
              <ToolbarRow gap={8} wrap={false}>
                <Box className="flex-1 min-w-0">
                  <TextInput label="Name" data-testid="screener-name-input" placeholder="e.g., My Screener" value={form().label} onChange={(val) => setForm({ ...form(), label: val })} size="xs" style={{ width: "100%" }} />
                </Box>
                <Box className="flex-1 min-w-0">
                  <TextInput label="Description" placeholder="Brief description" value={form().description} onChange={(val) => setForm({ ...form(), description: val })} size="xs" style={{ width: "100%" }} />
                </Box>
              </ToolbarRow>
              <Text size="xs" fw={600} style={{ "font-size": 11, "letter-spacing": 0.5, color: palette.TEXT_MUTED }}>Indicators</Text>
              <ToolbarRow gap={8}>
                <For each={["RSI", "ADX", "Volume", "52W Gap %", "Stochastic", "ATR", "MACD", "Momentum"]}>
                  {(ind) => (
                    <Checkbox
                      label={ind}
                      checked={form().indicators.includes(ind)}
                      // @/ui Checkbox forwards the raw DOM change event, not a checked boolean
                      onChange={(e: Event) => {
                        const target = e?.currentTarget as HTMLInputElement | null;
                        handleIndicatorToggle(ind, target?.checked ?? Boolean(e));
                      }}
                      size="xs"
                    />
                  )}
                </For>
              </ToolbarRow>
              <Show when={form().filters.length > 0}>
                <Text size="xs" fw={600} style={{ "font-size": 11, "letter-spacing": 0.5, color: palette.TEXT_MUTED }}>Filters</Text>
                <ToolbarRow gap={8}><For each={form().filters}>{renderFilterInput}</For></ToolbarRow>
              </Show>
              <ToolbarRow gap={8} wrap={false}>
                <Box className="flex-1 min-w-0">
                  <Select label="Sort Column" data={ALL_COLUMNS.map((c) => ({ value: c.key, label: c.label }))} value={form().defaultSortColumn} onChange={(val) => setForm({ ...form(), defaultSortColumn: val || "score" })} size="xs" style={{ width: "100%" }} />
                </Box>
                <Box className="flex-1 min-w-0">
                  <Select label="Direction" data={[{ value: "desc", label: "Desc ↓" }, { value: "asc", label: "Asc ↑" }]} value={form().defaultSortDirection} onChange={(val) => setForm({ ...form(), defaultSortDirection: (val as "asc" | "desc") || "desc" })} size="xs" style={{ width: "100%" }} />
                </Box>
              </ToolbarRow>
              <Box className="flex justify-end gap-2 pt-2 border-t border-fin-border mt-2">
                <Button size="xs" variant="outline" onClick={() => { setCreateModalOpen(false); setEditModalOpen(false); setEditingScreener(null); setForm(EMPTY_FORM); }} data-testid="cancel-create-btn">Cancel</Button>
                <Button size="xs" data-testid="confirm-create-btn" onClick={() => (editModalOpen() ? handleUpdate() : handleCreate())} disabled={!form().label || form().columns.length === 0} loading={saving()}>{editModalOpen() ? "Update" : "Create"}</Button>
              </Box>
            </Stack>
          </Box>
        </Show>
        <Show when={deleteConfirmOpen()}>
          <Box className="p-3 border-b border-fin-border flex items-center justify-between gap-2" style={{ "background-color": withAlpha(palette.NEGATIVE, 0.08) }}>
            <Text size="xs" style={{ color: palette.NEGATIVE }}>Are you sure you want to delete {deletingId()}?</Text>
            <ToolbarRow gap={8}>
              <Button size="xs" variant="outline" onClick={() => { setDeleteConfirmOpen(false); setDeletingId(null); }}>Cancel</Button>
              <Button size="xs" color="error" onClick={handleDelete} loading={saving()}>Delete</Button>
            </ToolbarRow>
          </Box>
        </Show>
        <Box className="flex-1 overflow-auto p-2 min-h-0">
          <Switch>
            <Match when={previewLoading()}>
              <Stack gap={1} data-testid="preview-loading">
                <Text size="xs" c="dimmed" ta="center">Loading...</Text>
                <Skeleton h={28} radius={1} />
                <Skeleton h={20} />
                <Skeleton h={20} />
                <Skeleton h={20} />
                <Skeleton h={20} />
              </Stack>
            </Match>
            <Match when={previewStocks().length === 0}>
              <Text size="sm" c="dimmed" ta="center" py="xl" data-testid="preview-empty">
                No stocks
              </Text>
            </Match>
            <Match when={true}>
              <ScreenerTable
                stocks={previewStocks()}
                columns={columnDefs()}
                touchedSymbols={touchedSymbols()}
                onSymbolClick={() => {
                  /* No-op for config preview - could open detail modal in future */
                }}
                onSymbolHover={() => {
                  /* No-op for config preview */
                }}
                testId="preview-table"
              />
            </Match>
          </Switch>
        </Box>
        <SelectionBar
          onCompare={() => {
            /* no-op for config preview */
          }}
        />
      </Paper>
    </Box>
  );
}
