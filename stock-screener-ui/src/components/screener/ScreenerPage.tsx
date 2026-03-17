import { Stack, Alert, Box, Button, Title, Text, Paper, Group, NumberInput, Select } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useState, useMemo } from "react";
import { ScreenerNav } from "./ScreenerNav";
import { ScreenerHeader } from "./ScreenerHeader";
import { ScreenerTable } from "./ScreenerTable";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { ScreenerLoading } from "./ScreenerLoading";
import { getColumnsForScreener } from "./columns";
import type { Stock } from "../../types";
import type { ProfileFilterDef } from "./types";

interface ScreenerPageProps {
  screenerOptions: Array<{ id: string; label: string; description?: string }>;
  activeScreener: string;
  onScreenerChange: (id: string) => void;

  title: string;
  status: string;
  isLoading: boolean;
  autoRefreshSeconds: number;
  provider: string;
  mode: string;
  onRefresh: () => void;
  onAutoRefreshChange: (value: number) => void;
  onProviderChange: (value: string) => void;
  onModeChange: (value: string) => void;

  filters: {
    minScore: number;
    maxPrice: number;
    minReturn: number;
    sector: string;
    [key: string]: any;
  };
  sectors: string[];
  profileFilters?: ProfileFilterDef[];
  onFilterChange: (key: string, value: any) => void;
  onResetFilters: () => void;

  approachingStocks: Stock[];
  touchedStocks: Stock[];

  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;

  error?: string | null;
}

function sortStocks(
  stocks: Stock[],
  sortColumn: string | null,
  sortDirection: "asc" | "desc",
): Stock[] {
  if (!sortColumn) return stocks;
  return [...stocks].sort((a, b) => {
    const aVal = a[sortColumn];
    const bVal = b[sortColumn];
    if (aVal === bVal) return 0;
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    const comparison = aVal < bVal ? -1 : 1;
    return sortDirection === "asc" ? comparison : -comparison;
  });
}

export function ScreenerPage({
  screenerOptions,
  activeScreener,
  onScreenerChange,
  title,
  status,
  isLoading,
  autoRefreshSeconds,
  provider,
  mode,
  onRefresh,
  onAutoRefreshChange,
  onProviderChange,
  onModeChange,
  filters,
  sectors,
  profileFilters,
  onFilterChange,
  onResetFilters,
  approachingStocks,
  touchedStocks,
  onSymbolClick,
  onSymbolHover,
  error,
}: ScreenerPageProps) {
  const [sortColumn, setSortColumn] = useState<string | null>("score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const sectorOptions = (sectors ?? []).map((s) => ({ value: s, label: s }));

  const sortedApproaching = useMemo(
    () => sortStocks(approachingStocks ?? [], sortColumn, sortDirection),
    [approachingStocks, sortColumn, sortDirection],
  );

  const sortedTouched = useMemo(
    () => sortStocks(touchedStocks ?? [], sortColumn, sortDirection),
    [touchedStocks, sortColumn, sortDirection],
  );

  const handleSortChange = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const columns = getColumnsForScreener(activeScreener);
  const emptySet = new Set<string>();
  const totalStocks = (approachingStocks ?? []).length + (touchedStocks ?? []).length;

  const renderProfileFilter = (filter: ProfileFilterDef) => {
    if (filter.type === "number") {
      return (
        <NumberInput
          key={filter.key}
          label={filter.label}
          value={filters[filter.key] ?? ""}
          onChange={(value) => onFilterChange(filter.key, value)}
          min={filter.min}
          max={filter.max}
          step={filter.step}
          style={{ minWidth: 120 }}
          data-testid={`filter-${filter.key}`}
          id={`filter-${filter.key}`}
          className={`filter-input filter-${filter.key}`}
        />
      );
    }

    if (filter.type === "select" && filter.options) {
      return (
        <Select
          key={filter.key}
          label={filter.label}
          value={filters[filter.key] ?? ""}
          onChange={(value) => onFilterChange(filter.key, value)}
          data={filter.options}
          clearable
          style={{ minWidth: 140 }}
          data-testid={`filter-${filter.key}`}
          id={`filter-${filter.key}`}
          className={`filter-select filter-${filter.key}`}
        />
      );
    }

    return null;
  };

  const renderContent = () => {
    if (isLoading) {
      return <ScreenerLoading />;
    }

    if (error) {
      return (
        <Stack
          gap="md"
          align="center"
          className="screener-error-container"
          data-testid="screener-error-container"
        >
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Error"
            color="red"
            variant="filled"
            data-testid="screener-error"
            className="screener-alert"
          >
            {error}
          </Alert>
          <Button onClick={onRefresh} variant="light" color="red" data-testid="screener-retry-btn">
            Retry
          </Button>
        </Stack>
      );
    }

    if (totalStocks === 0) {
      return <ScreenerEmpty />;
    }

    return (
      <Stack gap="xl" style={{ height: "100%", overflow: "auto" }}>
        {sortedApproaching.length > 0 && (
          <Box
            id="approaching-section"
            className="screener-section approaching-section"
            data-testid="screener-approaching-section"
          >
            <Stack gap="xs" mb="sm">
              <Title order={5} c="blue" className="section-title" data-testid="approaching-title">
                ⏳ Approaching ({sortedApproaching.length})
              </Title>
              <Text size="sm" c="dimmed" className="section-description">
                Stocks nearing but have not yet touched the 52W high
              </Text>
            </Stack>
            <ScreenerTable
              stocks={sortedApproaching}
              columns={columns}
              touchedSymbols={emptySet}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
              onSymbolClick={onSymbolClick}
              onSymbolHover={onSymbolHover}
              screenerType={activeScreener}
            />
          </Box>
        )}

        {sortedTouched.length > 0 && (
          <Box
            id="touched-section"
            className="screener-section touched-section"
            data-testid="screener-touched-section"
          >
            <Stack gap="xs" mb="sm">
              <Title order={5} c="green" className="section-title" data-testid="touched-title">
                ✅ Touched ({sortedTouched.length})
              </Title>
              <Text size="sm" c="dimmed" className="section-description">
                Stocks that have touched or broken out of the 52W high
              </Text>
            </Stack>
            <ScreenerTable
              stocks={sortedTouched}
              columns={columns}
              touchedSymbols={new Set(sortedTouched.map((s) => s.symbol))}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
              onSymbolClick={onSymbolClick}
              onSymbolHover={onSymbolHover}
              screenerType={activeScreener}
            />
          </Box>
        )}
      </Stack>
    );
  };

  return (
    <Box
      h="100%"
      id="screener-main"
      className="screener-page"
      style={{ display: "flex", flexDirection: "column", padding: "var(--mantine-spacing-md)" }}
      data-testid="screener-page"
    >
      <Box flex="0 0 auto" className="screener-controls" data-testid="screener-controls">
        <Stack gap="md">
          <ScreenerNav
            options={screenerOptions}
            activeScreener={activeScreener}
            onChange={onScreenerChange}
          />

          <ScreenerHeader
            title={title}
            status={status}
            isLoading={isLoading}
            autoRefreshSeconds={autoRefreshSeconds}
            provider={provider}
            mode={mode}
            onRefresh={onRefresh}
            onAutoRefreshChange={onAutoRefreshChange}
            onProviderChange={onProviderChange}
            onModeChange={onModeChange}
          />

          <Paper
            withBorder
            p="md"
            mb="md"
            id="filter-panel"
            className="screener-filters"
            data-testid="screener-filters"
          >
            <Group
              gap="md"
              wrap="wrap"
              align="flex-end"
              className="filter-controls"
              data-testid="filter-controls"
            >
              <NumberInput
                label="Min Score"
                value={filters.minScore}
                onChange={(value) => onFilterChange("minScore", value)}
                min={0}
                max={100}
                step={1}
                style={{ minWidth: 100 }}
                data-testid="min-score-input"
                id="min-score-filter"
                className="filter-input min-score-filter"
              />

              <NumberInput
                label="Max Price"
                value={filters.maxPrice}
                onChange={(value) => onFilterChange("maxPrice", value)}
                min={0}
                step={1}
                style={{ minWidth: 100 }}
                data-testid="max-price-input"
                id="max-price-filter"
                className="filter-input max-price-filter"
              />

              <NumberInput
                label="Min Return %"
                value={filters.minReturn}
                onChange={(value) => onFilterChange("minReturn", value)}
                step={0.5}
                decimalScale={2}
                style={{ minWidth: 120 }}
                data-testid="min-return-input"
                id="min-return-filter"
                className="filter-input min-return-filter"
              />

              <Select
                label="Sector"
                value={filters.sector}
                onChange={(value) => onFilterChange("sector", value)}
                data={sectorOptions}
                clearable
                placeholder="All sectors"
                style={{ minWidth: 160 }}
                data-testid="sector-select"
                id="sector-filter"
                className="filter-select sector-filter"
              />

              {(profileFilters ?? []).map(renderProfileFilter)}

              <Button
                variant="subtle"
                onClick={onResetFilters}
                data-testid="reset-filters-btn"
                id="reset-filters"
                className="reset-filters-btn"
              >
                Reset
              </Button>
            </Group>
          </Paper>
        </Stack>
      </Box>

      <Box
        flex={1}
        id="screener-content"
        className="screener-content"
        style={{ minHeight: 0 }}
        data-testid="screener-content"
      >
        {renderContent()}
      </Box>
    </Box>
  );
}
