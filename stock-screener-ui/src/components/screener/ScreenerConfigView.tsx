import { useState, useEffect, useCallback } from "react";
import Paper from "@mui/material/Paper";
import {
  Stack,
  Text,
  Badge,
  Group,
  Box,
  Button,
  ScrollArea,
  Divider,
  TextInput,
  Checkbox,
  Select,
  NumberInput,
  ActionIcon,
  Skeleton,
} from "@/ui";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import type { ScreenerOption, Stock, ProfileFilter, ColumnDef} from "../../types";
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
  const [touchedSymbols] = useState<Set<string>>(new Set());

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

  const {
    stocks,
    loading: previewLoading,
    refresh: loadPreview,
  } = useScreenerPreview(activeScreener, columns, filterArr);

  // Config preview: load once per screener selection (debounced, NOT on
  // every filter keystroke — too many loaders). Manual reload via ↻ button.
  useEffect(() => {
    const t = setTimeout(() => loadPreview(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScreener]);

  const columnDefs: ColumnDef[] = columns.map((key) => ({
    key,
    label: ALL_COLUMNS.find((c) => c.key === key)?.label || key,
    sortable: true,
  }));

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
        <Box key={filter.key} sx={{ display: "flex", alignItems: "center", width: 120 }}>
          <NumberInput
            label={filter.label}
            value={filter.default as number}
            onChange={(val) => updateFilterValue(filter.key, val || 0)}
            min={filter.min}
            max={filter.max}
            step={filter.step}
            sx={{ width: 120 }}
          />
        </Box>
      );
    }
    if (filter.type === "select" && filter.options) {
      return (
        <Box key={filter.key} sx={{ display: "flex", alignItems: "center", width: 120 }}>
          <Select
            label={filter.label}
            data={filter.options}
            value={filter.default as string}
            onChange={(val) => updateFilterValue(filter.key, val || "")}
            sx={{ width: 120 }}
          />
        </Box>
      );
    }
    return null;
  };

  return (
    <Box sx={{ display: "flex", height: "100%", gap: 1, p: 1, bgcolor: palette.BG }}>
      <Paper
        elevation={0}
        data-testid="screener-list-panel"
        sx={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", border: 1, borderColor: palette.BORDER, borderRadius: 2, bgcolor: palette.SURFACE }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, borderBottom: 1, borderColor: palette.BORDER, bgcolor: palette.SURFACE_ALT, height: 36, flexShrink: 0 }}>
          <Text fw={600} size="xs" data-testid="screener-configs-title" style={{ fontSize: 11, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>
            CONFIGS
          </Text>
          <Button
            size="xs"
            variant="outline"
            color="inherit"
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
            style={{ fontSize: 11, height: 24 }}
          >
            + Create
          </Button>
        </Box>
        <ScrollArea h="100%" type="auto">
          <Stack gap={0} p={1}>
            {screenerOptions.map((option) => (
              <Box
                key={option.id}
                p={1}
                data-testid={`screener-row-${option.id}`}
                sx={{
                  borderRadius: 1,
                  cursor: "pointer",
                  bgcolor: option.id === activeScreener ? palette.SURFACE_ALT : "transparent",
                  border: option.id === activeScreener ? 1 : 0,
                  borderColor: palette.BORDER,
                  mb: 0.5,
                }}
                onClick={() => onScreenerChange(option.id)}
              >
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                  <Group gap={1} align="center">
                    <Text size="xs" fw={500} style={{ fontSize: 12, color: palette.TEXT }}>
                      {option.label}
                    </Text>
                    {option.id === activeScreener && (
                      <Badge size="xs" color="default" variant="light" data-testid="screener-active-badge">
                        Active
                      </Badge>
                    )}
                  </Group>
                  <Group gap={0.5} align="center">
                    <Button
                      size="xs"
                      variant="outline"
                      color="inherit"
                      onClick={(e: any) => {
                        e.stopPropagation();
                        openEditModal(option);
                      }}
                      data-testid={`edit-screener-${option.id}`}
                      style={{ fontSize: 11, height: 22, padding: "0 6px", borderColor: palette.BORDER, color: palette.TEXT }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      color="error"
                      onClick={(e: any) => {
                        e.stopPropagation();
                        openDeleteConfirm(option.id);
                      }}
                      data-testid={`delete-screener-${option.id}`}
                      style={{ fontSize: 11, height: 22, padding: "0 6px" }}
                    >
                      Del
                    </Button>
                  </Group>
                </Box>
                <Text size="xs" c="dimmed" lineClamp={1} style={{ fontSize: 11, color: palette.TEXT_MUTED }}>
                  {option.id}
                </Text>
              </Box>
            ))}
          </Stack>
        </ScrollArea>
      </Paper>

      <Paper
        elevation={0}
        data-testid="screener-preview-panel"
        sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", border: 1, borderColor: palette.BORDER, borderRadius: 2, bgcolor: palette.SURFACE }}
      >
        <Box data-testid="preview-header" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, borderBottom: 1, borderColor: palette.BORDER, bgcolor: palette.SURFACE_ALT, height: 36, flexShrink: 0 }}>
          <Group gap={1} wrap="wrap" data-testid="screener-filters" align="center">
            {activeOption ? (
              <>
                <Badge size="xs" color="default" variant="light" data-testid="screener-name-badge">
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
                    <Badge key={key} size="xs" color="default" variant="light">
                      {key.replace(/_/g, " ")}: {String(value)}
                    </Badge>
                  ));
                })()}
              </>
            ) : (
              <Text size="xs" c="dimmed" style={{ fontSize: 11, color: palette.TEXT_MUTED }}>
                Select a screener
              </Text>
            )}
          </Group>
          <Group gap={1} align="center" sx={{ flexShrink: 0 }}>
            <Text fw={600} size="xs" data-testid="preview-count" style={{ fontSize: 11, color: palette.TEXT_MUTED }}>
              PREVIEW ({stocks.length})
            </Text>
            <Button
              size="xs"
              variant="outline"
              color="inherit"
              onClick={() => loadPreview()}
              loading={previewLoading}
              data-testid="preview-refresh-btn"
              style={{ height: 24, fontSize: 11 }}
            >
              ↻
            </Button>
          </Group>
        </Box>
        {(createModalOpen || editModalOpen) && (
          <Box sx={{ p: 1.5, borderBottom: 1, borderColor: palette.BORDER, bgcolor: palette.BG, maxHeight: 380, overflow: "auto" }} data-testid="inline-form">
            <Stack gap={1}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                <Text fw={600} size="xs" style={{ fontSize: 11, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>{editModalOpen ? "EDIT SCREENER" : "NEW SCREENER"}</Text>
                <Button size="xs" variant="subtle" color="inherit" onClick={() => { setCreateModalOpen(false); setEditModalOpen(false); setEditingScreener(null); setForm(EMPTY_FORM); }} style={{ height: 22 }}>✕</Button>
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextInput label="Name" data-testid="screener-name-input" placeholder="e.g., My Screener" value={form.label} onChange={(val) => setForm({ ...form, label: val })} size="xs" style={{ flex: 1 }} />
                <TextInput label="Description" placeholder="Brief description" value={form.description} onChange={(val) => setForm({ ...form, description: val })} size="xs" style={{ flex: 1 }} />
              </Box>
              <Text size="xs" fw={600} style={{ fontSize: 11, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>Indicators</Text>
              <Group gap={1} style={{ flexWrap: "wrap" }}>
                {["RSI", "ADX", "Volume", "52W Gap %", "Stochastic", "ATR", "MACD", "Momentum"].map((ind) => (
                  <Checkbox key={ind} label={ind} checked={form.indicators.includes(ind)} onChange={(checked) => handleIndicatorToggle(ind, checked)} size="xs" />
                ))}
              </Group>
              {form.filters.length > 0 && (
                <>
                  <Text size="xs" fw={600} style={{ fontSize: 11, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>Filters</Text>
                  <Group gap={1} style={{ flexWrap: "wrap" }}>{form.filters.map(renderFilterInput)}</Group>
                </>
              )}
              <Box sx={{ display: "flex", gap: 1 }}>
                <Select label="Sort Column" data={ALL_COLUMNS.map((c) => ({ value: c.key, label: c.label }))} value={form.defaultSortColumn} onChange={(val) => setForm({ ...form, defaultSortColumn: val || "score" })} size="xs" style={{ flex: 1 }} />
                <Select label="Direction" data={[{ value: "desc", label: "Desc ↓" }, { value: "asc", label: "Asc ↑" }]} value={form.defaultSortDirection} onChange={(val) => setForm({ ...form, defaultSortDirection: (val as "asc" | "desc") || "desc" })} size="xs" style={{ flex: 1 }} />
              </Box>
              <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, pt: 1, borderTop: 1, borderColor: palette.BORDER, mt: 1 }}>
                <Button size="xs" variant="outline" color="inherit" onClick={() => { setCreateModalOpen(false); setEditModalOpen(false); setEditingScreener(null); setForm(EMPTY_FORM); }} data-testid="cancel-create-btn">Cancel</Button>
                <Button size="xs" data-testid="confirm-create-btn" onClick={() => (editModalOpen ? handleUpdate() : handleCreate())} disabled={!form.label || form.columns.length === 0} loading={saving}>{editModalOpen ? "Update" : "Create"}</Button>
              </Box>
            </Stack>
          </Box>
        )}
        {deleteConfirmOpen && (
          <Box sx={{ p: 1.5, borderBottom: 1, borderColor: palette.BORDER, bgcolor: withAlpha(palette.NEGATIVE, 0.08), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Text size="xs" style={{ color: palette.NEGATIVE }}>Are you sure you want to delete {deletingId}?</Text>
            <Group gap={1}>
              <Button size="xs" variant="outline" color="inherit" onClick={() => { setDeleteConfirmOpen(false); setDeletingId(null); }}>Cancel</Button>
              <Button size="xs" color="error" onClick={handleDelete} loading={saving}>Delete</Button>
            </Group>
          </Box>
        )}
        <Box sx={{ flex: 1, overflow: "auto", p: 1, minHeight: 0 }}>
          {previewLoading ? (
            <Stack gap={1} data-testid="preview-loading">
              <Text size="xs" c="dimmed" ta="center">Loading...</Text>
              <Skeleton h={28} radius={1} />
              <Skeleton h={20} />
              <Skeleton h={20} />
              <Skeleton h={20} />
              <Skeleton h={20} />
            </Stack>
          ) : stocks.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="xl" data-testid="preview-empty">
              No stocks
            </Text>
          ) : (
            <ScreenerTable
              stocks={stocks}
              columns={columnDefs}
              touchedSymbols={touchedSymbols}
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
      </Paper>
    </Box>
  );

  function renderFormModal(isEdit: boolean, onSubmit: () => void, isSaving: boolean) {
    return (
      <Box sx={{ display: "flex", gap: 2, bgcolor: palette.BG }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack gap={1} data-testid="create-screener-form">
            <TextInput
              label="Name"
              data-testid="screener-name-input"
              placeholder="e.g., My Custom Screener"
              value={form.label}
              onChange={(val) => setForm({ ...form, label: val })}
              size="xs"
            />
            <TextInput
              label="Description"
              placeholder="Brief description of this screener"
              value={form.description}
              onChange={(val) => setForm({ ...form, description: val })}
              size="xs"
            />

            <Text size="xs" fw={600} style={{ fontSize: 11, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>
              Indicators
            </Text>
            <Group gap={1} align="center" style={{ flexWrap: "wrap" }}>
              {["RSI", "ADX", "Volume", "52W Gap %", "Stochastic", "ATR", "MACD", "Momentum"].map(
                (ind) => (
                  <Checkbox
                    key={ind}
                    label={ind}
                    checked={form.indicators.includes(ind)}
                    onChange={(checked) => handleIndicatorToggle(ind, checked)}
                    size="xs"
                  />
                ),
              )}
            </Group>

            {form.filters.length > 0 && (
              <>
                <Text size="xs" fw={600} style={{ fontSize: 11, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>
                  Filter Values
                </Text>
                <Group gap={1} align="center" style={{ flexWrap: "wrap" }}>{form.filters.map(renderFilterInput)}</Group>
              </>
            )}

            <Select
              label="Default Sort Column"
              data={ALL_COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
              value={form.defaultSortColumn}
              onChange={(val) => setForm({ ...form, defaultSortColumn: val || "score" })}
              size="xs"
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
              size="xs"
            />

            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1, mt: 1.5 }}>
              <Button
                variant="outline"
                color="inherit"
                onClick={() => {
                  setCreateModalOpen(false);
                  setEditModalOpen(false);
                  setForm(EMPTY_FORM);
                }}
                data-testid="cancel-create-btn"
                size="xs"
              >
                Cancel
              </Button>
              <Button
                data-testid="confirm-create-btn"
                onClick={onSubmit}
                disabled={!form.label || form.columns.length === 0}
                loading={isSaving}
                size="xs"
              >
                {isEdit ? "Update" : "Create"}
              </Button>
            </Box>
          </Stack>
        </Box>

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            borderLeft: 1,
            borderColor: palette.BORDER,
            pl: 2,
          }}
        >
            <Stack gap={1} data-testid="create-modal-preview">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", pb: 1, borderBottom: 1, borderColor: palette.BORDER }}>
              <Text fw={600} size="xs" data-testid="modal-live-preview-title" style={{ fontSize: 11, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>
                LIVE PREVIEW
              </Text>
              <Badge size="xs" color="default" variant="light">
                {stocks.length} stocks
              </Badge>
            </Box>
            {form.columns.length === 0 ? (
              <Text size="xs" c="dimmed" ta="center" py="xl" style={{ color: palette.TEXT_MUTED }}>
                Select columns to preview
              </Text>
            ) : stocks.length > 0 ? (
              <Paper elevation={0} sx={{ height: 300, overflow: "hidden", border: 1, borderColor: palette.BORDER, borderRadius: 1, bgcolor: palette.SURFACE }}>
                <Box sx={{ height: 300, overflow: "auto", p: 0.5 }}>
                <ScreenerTable
                  stocks={stocks.slice(0, 10)}
                  columns={form.columns.slice(0, 5).map((key) => ({
                    key,
                    label: ALL_COLUMNS.find((c) => c.key === key)?.label || key,
                    sortable: true,
                  }))}
                  touchedSymbols={touchedSymbols}
                  onSymbolClick={() => {}}
                  onSymbolHover={() => {}}
                />
                </Box>
              </Paper>
            ) : (
              <Text size="xs" c="dimmed" ta="center" py="xl" style={{ color: palette.TEXT_MUTED }}>
                No stocks available
              </Text>
            )}
          </Stack>
        </Box>
      </Box>
    );
  }
}
