import { useState, useEffect, useCallback, useRef } from "react";
import {
  Stack,
  Text,
  Badge,
  Group,
  Box,
  Button,
  ScrollArea,
  Divider,
  Modal,
  TextInput,
  Checkbox,
  Select,
  NumberInput,
  ActionIcon,
} from "@mantine/core";
import type { ScreenerOption, Stock, ProfileFilter, ColumnDef } from "../../types";
import { ScreenerTable } from "./ScreenerTable";
import { SelectionBar } from "./SelectionBar";
import { createScreener, updateScreener, deleteScreener } from "../../api/screeners";
import { loadScreeners } from "../../api/index";
import { useScreenerPreview } from "../../hooks/useScreenerApi";

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

export function ScreenerConfigView({ screenerOptions, activeScreener, onScreenerChange }: Props) {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingScreener, setEditingScreener] = useState<ScreenerOption | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScreenerForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>("score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [touchedSymbols] = useState<Set<string>>(new Set());
  const [modalSortColumn, setModalSortColumn] = useState<string | null>("score");
  const [modalSortDirection, setModalSortDirection] = useState<"asc" | "desc">("desc");

  const activeOption = screenerOptions.find((o) => o.id === activeScreener);
  const columns = activeOption?.columns || [
    "symbol",
    "score",
    "rsi",
    "day_change",
    "volume_m",
    "perf_w",
    "sector",
  ];

  const activeFilters = activeOption?.filters;
  const filterArr: { key: string; default: any; min?: number; max?: number }[] = [];
  if (activeFilters) {
    Object.entries(activeFilters as Record<string, any>).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length === 2) {
        filterArr.push({ key: key + "_min", default: value[0] });
        filterArr.push({ key: key + "_max", default: value[1] });
      } else {
        filterArr.push({ key, default: value });
      }
    });
  }

  const { stocks, loading: previewLoading, refresh: loadPreview } = useScreenerPreview(
    activeScreener,
    columns,
    filterArr,
  );

  // Refresh when screener or filters change (debounced)
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      loadPreview();
    }, 500);
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, [activeScreener, columns, filterArr]);

  const columnDefs: ColumnDef[] = columns.map((key) => ({
    key,
    label: ALL_COLUMNS.find((c) => c.key === key)?.label || key,
    sortable: true,
  }));

const handleSortChange = useCallback(
    (column: string) => {
      if (sortColumn === column) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortColumn(column);
        setSortDirection("desc");
      }
    },
    [sortColumn],
  );

  const handleSymbolClick = useCallback((_symbol: string) => {
    // No-op for config preview - could open detail modal in future
  }, []);

  const handleSymbolHover = useCallback((_symbol: string | null) => {
    // No-op for config preview
  }, []);

  const handleCreate = async () => {
    if (!form.label || form.columns.length === 0) return;
    setSaving(true);
    try {
      await createScreener({
        name: form.label,
        description: form.description,
        indicators: form.indicators,
        columns: form.columns,
        filters: Object.fromEntries((form.filters || []).map((f) => [f.key, f.default])),
        default_sort: form.defaultSortColumn
          ? { column: form.defaultSortColumn, direction: form.defaultSortDirection }
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
    if (!form.label || form.columns.length === 0 || !editingScreener) return;
    setSaving(true);
    try {
      await updateScreener(Number(editingScreener.id), {
        name: form.label,
        description: form.description,
        indicators: form.indicators,
        columns: form.columns,
        filters: Object.fromEntries((form.filters || []).map((f) => [f.key, f.default])),
        default_sort: form.defaultSortColumn
          ? { column: form.defaultSortColumn, direction: form.defaultSortDirection }
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
    if (!deletingId) return;
    setSaving(true);
    try {
      await deleteScreener(Number(deletingId));
      setDeleteConfirmOpen(false);
      setDeletingId(null);
      if (activeScreener === deletingId) {
        onScreenerChange("trending");
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
    let newIndicators: string[];
    let newFilters: ProfileFilter[];

    if (checked) {
      newIndicators = [...form.indicators, indicator];
      const defaultFilter = DEFAULT_FILTERS[indicator];
      newFilters = defaultFilter ? [...form.filters, { ...defaultFilter }] : [...form.filters];
    } else {
      newIndicators = form.indicators.filter((i) => i !== indicator);
      newFilters = form.filters.filter((f) => f.key !== DEFAULT_FILTERS[indicator]?.key);
    }
    setForm({ ...form, indicators: newIndicators, filters: newFilters });
  };

  const updateFilterValue = (key: string, value: number | string) => {
    const newFilters = form.filters.map((f) => (f.key === key ? { ...f, default: value } : f));
    setForm({ ...form, filters: newFilters });
  };

  const renderFilterInput = (filter: ProfileFilter) => {
    if (filter.type === "number") {
      return (
        <NumberInput
          key={filter.key}
          label={filter.label}
          value={filter.default as number}
          onChange={(val) => updateFilterValue(filter.key, val || 0)}
          min={filter.min}
          max={filter.max}
          step={filter.step}
          style={{ width: 120 }}
        />
      );
    }
    if (filter.type === "select" && filter.options) {
      return (
        <Select
          key={filter.key}
          label={filter.label}
          data={filter.options}
          value={filter.default as string}
          onChange={(val) => updateFilterValue(filter.key, val || "")}
          style={{ width: 120 }}
        />
      );
    }
    return null;
  };

  return (
    <Box style={{ display: "flex", height: "100%", gap: 8 }}>
      <Box
        style={{
          width: 280,
          flexShrink: 0,
          borderRight: "1px solid var(--mantine-color-default-border)",
        }}
        data-testid="screener-list-panel"
      >
        <ScrollArea h="100%">
          <Stack gap={4} p="xs">
            <Group justify="space-between" data-testid="screener-list-header">
              <Text fw={600} size="xs" data-testid="screener-configs-title">
                CONFIGS
              </Text>
              <Button
                size="xs"
                variant="light"
                onClick={() => {
                  setForm({
                    ...EMPTY_FORM,
                    columns: [
                      "symbol",
                      "score",
                      "rsi",
                      "day_change",
                      "volume_m",
                      "perf_w",
                      "sector",
                    ],
                    filters: [
                      {
                        key: "min_rsi",
                        label: "Min RSI",
                        type: "number",
                        default: 30,
                        min: 0,
                        max: 100,
                        step: 1,
                      },
                      {
                        key: "min_adx",
                        label: "Min ADX",
                        type: "number",
                        default: 15,
                        min: 0,
                        max: 100,
                        step: 1,
                      },
                      {
                        key: "min_volume_m",
                        label: "Min Vol (M)",
                        type: "number",
                        default: 2,
                        min: 0,
                        max: 100,
                        step: 0.5,
                      },
                    ],
                  });
                  setCreateModalOpen(true);
                }}
                data-testid="create-screener-btn"
              >
                + Create
              </Button>
            </Group>
            <Divider />

            {screenerOptions.map((option) => (
              <Box
                key={option.id}
                p={4}
                data-testid={`screener-row-${option.id}`}
                style={{
                  borderRadius: 4,
                  cursor: "pointer",
                  backgroundColor:
                    option.id === activeScreener
                      ? "var(--mantine-color-blue-light)"
                      : "transparent",
                  border:
                    option.id === activeScreener
                      ? "1px solid var(--mantine-color-blue)"
                      : "1px solid transparent",
                }}
                onClick={() => onScreenerChange(option.id)}
              >
                <Group justify="space-between" mb={4}>
                  <Group gap={4}>
                    <Text size="sm" fw={500}>
                      {option.label}
                    </Text>
                    {option.id === activeScreener && (
                      <Badge size="xs" color="blue" data-testid="screener-active-badge">
                        Active
                      </Badge>
                    )}
                  </Group>
                  <Group gap={4}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(option);
                      }}
                      data-testid={`edit-screener-${option.id}`}
                    >
                      <Text size="xs">Edit</Text>
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeleteConfirm(option.id);
                      }}
                      data-testid={`delete-screener-${option.id}`}
                    >
                      <Text size="xs">Del</Text>
                    </ActionIcon>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {option.id}
                </Text>
              </Box>
            ))}
          </Stack>
        </ScrollArea>
      </Box>

      <Box
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
        data-testid="screener-preview-panel"
      >
        <Box p="xs" style={{ overflow: "auto" }} data-testid="screener-details-bar">
          {activeOption && (
            <Group gap={8} wrap="wrap" data-testid="screener-filters">
              <Badge size="xs" color="blue" data-testid="screener-name-badge">
                {activeOption.label}
              </Badge>
              {(() => {
                let filterObj: Record<string, any> = {};
                if (Array.isArray(activeOption.filters)) {
                  activeOption.filters.forEach((f: any) => {
                    if (f.key && f.default !== undefined) filterObj[f.key] = f.default;
                  });
                } else if (activeOption.filters && typeof activeOption.filters === "object") {
                  filterObj = activeOption.filters as Record<string, any>;
                }
                return Object.entries(filterObj).map(([key, value]) => (
                  <Badge key={key} size="xs" color="red" variant="light">
                    {key.replace(/_/g, " ")}: {String(value)}
                  </Badge>
                ));
              })()}
            </Group>
          )}
        </Box>
        <Group justify="space-between" px="xs" data-testid="preview-header">
          <Text fw={600} size="xs" data-testid="preview-count">
            PREVIEW ({stocks.length})
          </Text>
          <Button
            size="xs"
            variant="light"
            onClick={() => loadPreview()}
            loading={previewLoading}
            data-testid="preview-refresh-btn"
          >
            ↻
          </Button>
        </Group>
        <Box style={{ flex: 1, overflow: "auto" }} p="xs">
          {previewLoading ? (
            <Text size="sm" c="dimmed" ta="center" py="xl" data-testid="preview-loading">
              Loading...
            </Text>
          ) : stocks.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl" data-testid="preview-empty">
              No stocks
            </Text>
          ) : (
            <ScreenerTable
              stocks={stocks}
              columns={columnDefs}
              touchedSymbols={touchedSymbols}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
              onSymbolClick={handleSymbolClick}
              onSymbolHover={handleSymbolHover}
              data-testid="preview-table"
            />
          )}
        </Box>
        <SelectionBar
          onCompare={() => {
            /* no-op for config preview */
          }}
        />
      </Box>

      <Modal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create New Screener"
        size="xl"
      >
        {renderFormModal(false, handleCreate, saving)}
      </Modal>

      <Modal
        opened={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setEditingScreener(null);
          setForm(EMPTY_FORM);
        }}
        title="Edit Screener"
        size="xl"
      >
        {renderFormModal(true, handleUpdate, saving)}
      </Modal>

      <Modal
        opened={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setDeletingId(null);
        }}
        title="Delete Screener"
        size="sm"
      >
        <Text mb="md">
          Are you sure you want to delete this screener? This action cannot be undone.
        </Text>
        <Group justify="flex-end">
          <Button
            variant="light"
            onClick={() => {
              setDeleteConfirmOpen(false);
              setDeletingId(null);
            }}
          >
            Cancel
          </Button>
          <Button color="red" onClick={handleDelete} loading={saving}>
            Delete
          </Button>
        </Group>
      </Modal>
    </Box>
  );

  function renderFormModal(isEdit: boolean, onSubmit: () => void, isSaving: boolean) {
    return (
      <Box style={{ display: "flex", gap: 24 }}>
        <Box style={{ flex: 1 }}>
          <Stack gap="md" data-testid="create-screener-form">
            <TextInput
              label="Name"
              data-testid="screener-name-input"
              placeholder="e.g., My Custom Screener"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <TextInput
              label="Description"
              placeholder="Brief description of this screener"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />

            <Text size="sm" fw={600}>
              Indicators
            </Text>
            <Group gap="md">
              {["RSI", "ADX", "Volume", "52W Gap %", "Stochastic", "ATR", "MACD", "Momentum"].map(
                (ind) => (
                  <Checkbox
                    key={ind}
                    label={ind}
                    checked={form.indicators.includes(ind)}
                    onChange={(e) => handleIndicatorToggle(ind, e.target.checked)}
                  />
                ),
              )}
            </Group>

            {form.filters.length > 0 && (
              <>
                <Text size="sm" fw={600}>
                  Filter Values
                </Text>
                <Group gap="md">{form.filters.map(renderFilterInput)}</Group>
              </>
            )}

            <Select
              label="Default Sort Column"
              data={ALL_COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
              value={form.defaultSortColumn}
              onChange={(val) => setForm({ ...form, defaultSortColumn: val || "score" })}
            />

            <Select
              label="Default Sort Direction"
              data={[
                { value: "desc", label: "Descending ↓" },
                { value: "asc", label: "Ascending ↑" },
              ]}
              value={form.defaultSortDirection}
              onChange={(val) =>
                setForm({ ...form, defaultSortDirection: (val as "asc" | "desc") || "desc" })
              }
            />

            <Group justify="flex-end" mt="md">
              <Button
                variant="light"
                onClick={() => {
                  setCreateModalOpen(false);
                  setEditModalOpen(false);
                  setForm(EMPTY_FORM);
                }}
                data-testid="cancel-create-btn"
              >
                Cancel
              </Button>
              <Button
                data-testid="confirm-create-btn"
                onClick={onSubmit}
                disabled={!form.label || form.columns.length === 0}
                loading={isSaving}
              >
                {isEdit ? "Update" : "Create"}
              </Button>
            </Group>
          </Stack>
        </Box>

        <Box
          style={{
            flex: 1,
            borderLeft: "1px solid var(--mantine-color-default-border)",
            paddingLeft: 24,
          }}
        >
          <Stack gap="xs" data-testid="create-modal-preview">
            <Group justify="space-between">
              <Text fw={600} size="sm" data-testid="modal-live-preview-title">
                LIVE PREVIEW
              </Text>
              <Badge size="sm" color="blue">
                {stocks.length} stocks
              </Badge>
            </Group>
            {form.columns.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                Select columns to preview
              </Text>
            ) : stocks.length > 0 ? (
              <Box style={{ height: 300, overflow: "auto" }}>
                <ScreenerTable
                  stocks={stocks.slice(0, 10)}
                  columns={form.columns.slice(0, 5).map((key) => ({
                    key,
                    label: ALL_COLUMNS.find((c) => c.key === key)?.label || key,
                    sortable: true,
                  }))}
                  touchedSymbols={touchedSymbols}
                  sortColumn={modalSortColumn}
                  sortDirection={modalSortDirection}
                  onSortChange={(col) => {
                    if (modalSortColumn === col) {
                      setModalSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setModalSortColumn(col);
                      setModalSortDirection("desc");
                    }
                  }}
                  onSymbolClick={() => {}}
                  onSymbolHover={() => {}}
                />
              </Box>
            ) : (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                No stocks available
              </Text>
            )}
          </Stack>
        </Box>
      </Box>
    );
  }
}
