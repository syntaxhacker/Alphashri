import { useState } from "react";
import { IconDownload, IconRefresh } from "@tabler/icons-react";
import {
  ActionIcon,
  Alert,
  Box,
  Divider,
  Loader,
  Paper,
  Select,
  Tab,
  Tabs,
  TabsList,
  Text,
  ToolbarRow,
} from "@/ui";
import { useValueScan } from "../../hooks/useValueScan";
import {
  VALUE_MARKETS,
  VALUE_PRESETS,
  type ValueFilters,
  type ValueRow,
} from "../../api/valueScan";
import { ValueFilters as ValueFilterBar } from "./ValueFilters";
import { ValueTable } from "./ValueTable";
import { ValueDetailDrawer } from "./ValueDetailDrawer";
import { VALUE_CSV_HEADERS, escapeCsvCell, valueRowToCsvRow } from "./valueColumns";

interface ValuePanelProps {
  initialFilters?: Partial<ValueFilters>;
  onRowClick?: (row: ValueRow) => void;
  sectorOptions?: string[];
}

const PRESET_OPTIONS = Object.entries(VALUE_PRESETS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export function ValuePanel({ initialFilters = {}, onRowClick, sectorOptions = [] }: ValuePanelProps) {
  const [filters, setFilters] = useState<ValueFilters>(() => ({
    market: "india",
    limit: 100,
    sort: "score_desc",
    ...initialFilters,
  }));
  const [selected, setSelected] = useState<ValueRow | null>(null);
  const { rows, sectors, meta, isLoading, error, refresh, warnings, lastUpdated } =
    useValueScan(filters);

  const patch = (p: Partial<ValueFilters>): void =>
    setFilters((f) => ({ ...f, ...p }));

  const handleRowClick = (row: ValueRow): void => {
    setSelected(row);
    onRowClick?.(row);
  };

  const exportCsv = (): void => {
    const lines = [
      VALUE_CSV_HEADERS.join(","),
      ...rows.map((r) => valueRowToCsvRow(r).map(escapeCsvCell).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deep-value-${filters.market ?? "india"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const showLoading = isLoading && rows.length === 0;
  const showError = error !== null && rows.length === 0;
  const showEmpty = !isLoading && error === null && rows.length === 0;
  const sectorSummary = sectors
    .slice(0, 5)
    .map((s) => `${s.name} (${s.count})`)
    .join(" · ");

  return (
    <Paper data-testid="value-panel" p={16}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <ToolbarRow justify="space-between" data-testid="value-header">
          <ToolbarRow gap={8}>
            <Text size="sm" fw={700} data-testid="value-title">
              DEEP VALUE
            </Text>
            <Tabs
              value={filters.market ?? "india"}
              onChange={(v) => patch({ market: (v ?? "india") as ValueFilters["market"] })}
              data-testid="value-market-tabs"
            >
              <TabsList>
                {VALUE_MARKETS.map((m) => (
                  <Tab
                    key={m.value}
                    value={m.value}
                    data-testid={`value-market-tab-${m.value}`}
                  >
                    {m.label}
                  </Tab>
                ))}
              </TabsList>
            </Tabs>
            <Select
              placeholder="Preset"
              data={PRESET_OPTIONS}
              value={filters.preset ?? ""}
              onChange={(v) => patch({ preset: v ?? undefined })}
              w={150}
              size="sm"
              data-testid="value-preset-select"
            />
          </ToolbarRow>
          <ToolbarRow gap={8}>
            {lastUpdated && (
              <Text size="xs" c="dimmed" data-testid="value-as-of">
                {`as of ${lastUpdated}`}
              </Text>
            )}
            <ActionIcon
              size="sm"
              onClick={refresh}
              loading={isLoading}
              data-testid="value-refresh"
              aria-label="Refresh"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </ToolbarRow>
        </ToolbarRow>

        <ValueFilterBar filters={filters} onChange={patch} sectorOptions={sectorOptions} />
        <Divider />

        {showLoading && (
          <Box
            data-testid="value-loading"
            sx={{ display: "flex", alignItems: "center", gap: 1, py: 4, justifyContent: "center" }}
          >
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Scanning for deep value…
            </Text>
          </Box>
        )}
        {showError && (
          <Alert color="error" data-testid="value-error">
            {`Value scan failed: ${error?.message ?? "unknown error"}`}
          </Alert>
        )}
        {showEmpty && (
          <Box data-testid="value-empty" sx={{ py: 4, textAlign: "center" }}>
            <Text size="sm" c="dimmed">
              No deep-value matches for these filters — loosen a gate or two.
            </Text>
          </Box>
        )}
        {!showEmpty && (
          <ValueTable rows={rows} loading={isLoading} onRowClick={handleRowClick} />
        )}

        <Divider />
        <ToolbarRow justify="space-between" data-testid="value-footer">
          <ToolbarRow gap={8}>
            <Text size="xs" c="dimmed" data-testid="value-summary">
              {`${rows.length} of ${meta?.matched ?? rows.length} matches · scanned ${meta?.scanned ?? 0}`}
            </Text>
            {sectorSummary && (
              <Text size="xs" c="dimmed" data-testid="value-sectors">
                {`sectors: ${sectorSummary}`}
              </Text>
            )}
          </ToolbarRow>
          <ToolbarRow gap={8}>
            {warnings.length > 0 && (
              <Text size="xs" c="dimmed" data-testid="value-warnings">
                {warnings.join(" · ")}
              </Text>
            )}
            <ActionIcon
              size="sm"
              onClick={exportCsv}
              data-testid="value-export-csv"
              aria-label="Export CSV"
            >
              <IconDownload size={14} />
            </ActionIcon>
          </ToolbarRow>
        </ToolbarRow>
      </Box>
      <ValueDetailDrawer row={selected} onClose={() => setSelected(null)} />
    </Paper>
  );
}
