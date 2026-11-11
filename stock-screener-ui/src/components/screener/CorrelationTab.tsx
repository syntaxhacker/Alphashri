import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Flex,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Text,
  useDebouncedValue,
} from "@/ui";
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
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchData, setSearchData] = useState<SymbolResult[]>([]);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch] = useDebouncedValue(searchText, 250);
  const [localSymbols, setLocalSymbols] = useState<string[]>(
    () => searchParams.get("symbols")?.split(",").filter(Boolean) || symbols,
  );

  useEffect(() => {
    const syms = searchParams.get("symbols");
    const tf = searchParams.get("timeframe") as "daily" | "intraday" | null;
    const p = searchParams.get("period");

    if (syms) {
      const parts = syms.split(",").filter(Boolean);
      if (parts.length >= 2) {
        setSymbols(parts);
        setLocalSymbols(parts);
        if (tf) setTimeframe(tf);
        if (p) {
          setPeriod(parseInt(p, 10));
          setPeriodUnit(tf === "intraday" ? "minutes" : "days");
        }
        setTimeout(() => fetchCorrelationData(), 0);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = debouncedSearch.trim();
    if (q.length < 2) {
      setSearchData([]);
      return;
    }
    let active = true;
    searchSymbols(q, 10)
      .then((results) => {
        if (active) setSearchData(results);
      })
      .catch(() => {
        if (active) setSearchData([]);
      });
    return () => {
      active = false;
    };
  }, [debouncedSearch]);

  const handleTimeframeChange = useCallback((value: string) => {
    setTimeframe(value as "daily" | "intraday");
    if (value === "daily") {
      setPeriod(90);
      setPeriodUnit("days");
    } else {
      setPeriod(1);
      setPeriodUnit("days");
    }
  }, []);

  const handlePeriodChange = useCallback((value: string | null) => {
    if (value) setPeriod(parseInt(value, 10));
  }, []);

  const handleCalculate = useCallback(() => {
    setSymbols(localSymbols);
    void fetchCorrelationData();
    setSearchParams(
      (prev) => {
        prev.set("symbols", localSymbols.join(","));
        prev.set("timeframe", timeframe);
        prev.set("period", period.toString());
        return prev;
      },
      { replace: true },
    );
  }, [localSymbols, timeframe, period, setSearchParams]);

  const periods = timeframe === "daily" ? DAILY_PERIODS : INTRADAY_PERIODS;
  const currentPeriod = period.toString();

  return (
    <Stack spacing={2} className="h-full w-full" data-testid="correlation-tab">
      <CompactPanel title="Correlation Analysis" description="Analyze price correlation between symbols">
        <Stack spacing={2} className="w-full items-center">
          <Flex className="w-full justify-center">
            <div className="grid w-full grid-cols-1 items-center justify-center gap-4 md:grid-cols-[auto_auto_auto_auto]">
              <Stack spacing={1} className="items-center">
                <Text size="xs" c="dimmed">
                  Symbols
                </Text>
                <MultiSelect
                  placeholder="Search and select symbols"
                  data={searchData.map((s) => ({ value: s.symbol, label: s.symbol }))}
                  value={localSymbols}
                  onChange={setLocalSymbols}
                  searchValue={searchText}
                  onSearchChange={setSearchText}
                  searchable
                  size="sm"
                  w={280}
                  aria-label="Symbols"
                />
              </Stack>
              <SegmentedControl
                value={timeframe}
                onChange={handleTimeframeChange}
                data={[
                  { label: "Daily", value: "daily" },
                  { label: "Intraday", value: "intraday" },
                ]}
                size="sm"
                data-testid="correlation-timeframe"
              />
              <Select
                label="Period"
                value={currentPeriod}
                onChange={handlePeriodChange}
                data={periods}
                size="sm"
                w={110}
                data-testid="correlation-period"
              />
              <Button
                onClick={handleCalculate}
                loading={isLoading}
                disabled={localSymbols.length < 2}
                size="sm"
                leftSection={<IconChartLine size={16} />}
                fullWidth
              >
                Calculate
              </Button>
            </div>
          </Flex>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="error" size="sm">
              {error}
            </Alert>
          )}

          {meta && (
            <CompactStatGrid>
              <CompactStat
                label="Date Range"
                value={`${formatDateRange(meta.start_date)} → ${formatDateRange(meta.end_date)}`}
              />
              <CompactStat label="Data Points" value={meta.data_points} />
              <CompactStat label="Symbols" value={symbols.length} />
              <CompactStat label="Timeframe" value={timeframe === "daily" ? "Daily" : "Intraday"} />
            </CompactStatGrid>
          )}
        </Stack>
      </CompactPanel>

      <Stack spacing={2} className="min-h-0 flex-1">
        <CompactPanel title="Correlation Matrix">
          <CorrelationMatrix matrix={matrix || []} symbols={symbols} isLoading={isLoading} />
        </CompactPanel>

        <CompactPanel title="Normalized Price Chart">
          <CorrelationChart normalized={normalized || {}} symbols={symbols} isLoading={isLoading} />
        </CompactPanel>
      </Stack>
    </Stack>
  );
}
