import { useState, useCallback } from "react";
import {
  Stack,
  Group,
  MultiSelect,
  SegmentedControl,
  Select,
  Button,
  Alert,
} from "@mantine/core";
import { IconAlertCircle, IconChartLine } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  subscribe,
  symbols,
  timeframe,
  period,
  matrix,
  normalized,
  meta,
  isLoading,
  error,
  setSymbols,
  setTimeframe,
  setPeriod,
  setPeriodUnit,
  fetchCorrelationData,
} from "../../state/correlation";
import { searchSymbols } from "../../api/symbols";
import type { SymbolResult } from "../../api/symbols";
import { CorrelationMatrix } from "./CorrelationMatrix";
import { CorrelationChart } from "./CorrelationChart";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";

const DAILY_PERIODS = [
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "180", label: "180d" },
  { value: "365", label: "1Y" },
];

const INTRADAY_PERIODS = [
  { value: "1", label: "1d" },
  { value: "5", label: "5d" },
];

function formatDateRange(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function CorrelationTab() {
  useStoreSubscription(subscribe);

  const [searchData, setSearchData] = useState<SymbolResult[]>([]);
  const [localSymbols, setLocalSymbols] = useState<string[]>(symbols);

  const handleSearch = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSearchData([]);
      return;
    }
    const results = await searchSymbols(query, 10);
    setSearchData(results);
  }, []);

  const handleTimeframeChange = useCallback(
    (value: string) => {
      setTimeframe(value as "daily" | "intraday");
      if (value === "daily") {
        setPeriod(90);
        setPeriodUnit("days");
      } else {
        setPeriod(1);
        setPeriodUnit("days");
      }
    },
    [],
  );

  const handlePeriodChange = useCallback(
    (value: string | null) => {
      if (value) {
        setPeriod(parseInt(value, 10));
      }
    },
    [],
  );

  const handleCalculate = useCallback(() => {
    setSymbols(localSymbols);
    fetchCorrelationData();
  }, [localSymbols]);

  const periods = timeframe === "daily" ? DAILY_PERIODS : INTRADAY_PERIODS;
  const currentPeriod = timeframe === "daily" ? period.toString() : period.toString();

  return (
    <Stack data-testid="correlation-tab" gap="sm" style={{ height: "100%" }}>
      <CompactPanel title="Correlation Analysis" description="Analyze price correlation between symbols">
        <Stack gap="sm">
          <Group gap="sm" align="flex-end">
            <MultiSelect
              label="Symbols"
              placeholder="Search and select symbols"
              data={searchData.map((s) => ({ value: s.symbol, label: s.symbol }))}
              value={localSymbols}
              onChange={setLocalSymbols}
              onSearchChange={handleSearch}
              searchable
              size="sm"
              style={{ flex: 1 }}
            />
            <SegmentedControl
              value={timeframe}
              onChange={handleTimeframeChange}
              data={[
                { label: "Daily", value: "daily" },
                { label: "Intraday", value: "intraday" },
              ]}
              size="sm"
            />
            <Select
              label="Period"
              value={currentPeriod}
              onChange={handlePeriodChange}
              data={periods}
              size="sm"
              w={80}
            />
            <Button
              onClick={handleCalculate}
              loading={isLoading}
              disabled={localSymbols.length < 2}
              size="sm"
              leftSection={<IconChartLine size={16} />}
            >
              Calculate
            </Button>
          </Group>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" size="sm">
              {error}
            </Alert>
          )}

          {meta && (
            <CompactStatGrid>
              <CompactStat label="Date Range" value={`${formatDateRange(meta.start_date)} → ${formatDateRange(meta.end_date)}`} />
              <CompactStat label="Data Points" value={meta.data_points} />
              <CompactStat label="Symbols" value={symbols.length} />
              <CompactStat label="Timeframe" value={timeframe === "daily" ? "Daily" : "Intraday"} />
            </CompactStatGrid>
          )}
        </Stack>
      </CompactPanel>

      <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
        <CompactPanel title="Correlation Matrix" scrollable>
          <CorrelationMatrix matrix={matrix || []} symbols={symbols} isLoading={isLoading} />
        </CompactPanel>

        <CompactPanel title="Normalized Price Chart" scrollable>
          <CorrelationChart
            normalized={normalized || {}}
            symbols={symbols}
            isLoading={isLoading}
          />
        </CompactPanel>
      </Stack>
    </Stack>
  );
}
