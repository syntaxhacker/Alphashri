import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import {
  Alert,
  Button,
  Flex,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@/ui";
import { IconAlertCircle, IconChartLine } from "./icons";
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

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? null;
}

// Inline Solid twin of useDebouncedValue (the ui-kit helper captures the
// first value only, so the debounce never fires on later input).
function useDebouncedSignal(getValue: () => string, wait: number) {
  const [debounced, setDebounced] = createSignal(getValue());
  createEffect(() => {
    const value = getValue();
    const timer = setTimeout(() => setDebounced(value), wait);
    onCleanup(() => clearTimeout(timer));
  });
  return debounced;
}

// src/hooks/useStoreSubscription.ts's useStoreSnapshot misses its createMemo
// import, so the snapshot is inlined here with the same semantics.
function useCorrelationSnapshot() {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubscribe = subscribe(() => setTick((n) => n + 1));
    onCleanup(unsubscribe);
  });
  return createMemo(() => {
    tick();
    return { symbols, timeframe, period, matrix, normalized, meta, isLoading, error };
  });
}

export function CorrelationTab() {
  const store = useCorrelationSnapshot();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchData, setSearchData] = createSignal<SymbolResult[]>([]);
  const [searchText, setSearchText] = createSignal("");
  const debouncedSearch = useDebouncedSignal(searchText, 250);
  const [localSymbols, setLocalSymbols] = createSignal<string[]>(
    firstParam(searchParams.symbols)?.split(",").filter(Boolean) || symbols,
  );

  onMount(() => {
    const syms = firstParam(searchParams.symbols);
    const tf = firstParam(searchParams.timeframe) as "daily" | "intraday" | null;
    const p = firstParam(searchParams.period);

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
  });

  createEffect(() => {
    const q = debouncedSearch().trim();
    if (q.length < 2) {
      setSearchData([]);
      return;
    }
    let active = true;
    onCleanup(() => {
      active = false;
    });
    searchSymbols(q, 10)
      .then((results) => {
        if (active) setSearchData(results);
      })
      .catch(() => {
        if (active) setSearchData([]);
      });
  });

  const handleTimeframeChange = (value: string) => {
    setTimeframe(value as "daily" | "intraday");
    if (value === "daily") {
      setPeriod(90);
      setPeriodUnit("days");
    } else {
      setPeriod(1);
      setPeriodUnit("days");
    }
  };

  const handlePeriodChange = (value: string | null) => {
    if (value) setPeriod(parseInt(value, 10));
  };

  const handleCalculate = () => {
    setSymbols(localSymbols());
    void fetchCorrelationData();
    setSearchParams(
      {
        symbols: localSymbols().join(","),
        timeframe: store().timeframe,
        period: store().period.toString(),
      },
      { replace: true },
    );
  };

  const periods = () => (store().timeframe === "daily" ? DAILY_PERIODS : INTRADAY_PERIODS);
  const currentPeriod = () => store().period.toString();
  const isIntraday = () => store().timeframe === "intraday";

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
                  data={searchData().map((s) => ({ value: s.symbol, label: s.symbol }))}
                  value={localSymbols()}
                  onChange={setLocalSymbols}
                  searchValue={searchText()}
                  onSearchChange={setSearchText}
                  searchable
                  size="sm"
                  w={280}
                  aria-label="Symbols"
                />
              </Stack>
              <SegmentedControl
                value={store().timeframe}
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
                value={currentPeriod()}
                onChange={handlePeriodChange}
                data={periods()}
                size="sm"
                w={110}
                data-testid="correlation-period"
              />
              <Button
                onClick={handleCalculate}
                loading={store().isLoading}
                disabled={localSymbols().length < 2}
                size="sm"
                leftSection={<IconChartLine size={16} />}
                fullWidth
              >
                Calculate
              </Button>
            </div>
          </Flex>

          <Show when={store().error}>
            <Alert icon={<IconAlertCircle size={16} />} color="error" size="sm">
              {store().error}
            </Alert>
          </Show>

          <Show when={store().meta}>
            {(m) => (
              <CompactStatGrid>
                <CompactStat
                  label="Date Range"
                  value={`${formatDateRange(m().start_date)} → ${formatDateRange(m().end_date)}`}
                />
                <CompactStat label="Data Points" value={m().data_points} />
                <CompactStat label="Symbols" value={store().symbols.length} />
                <CompactStat label="Timeframe" value={isIntraday() ? "Intraday" : "Daily"} />
              </CompactStatGrid>
            )}
          </Show>
        </Stack>
      </CompactPanel>

      <Stack spacing={2} className="min-h-0 flex-1">
        <CompactPanel title="Correlation Matrix">
          <CorrelationMatrix matrix={store().matrix || []} symbols={store().symbols} isLoading={store().isLoading} />
        </CompactPanel>

        <CompactPanel title="Normalized Price Chart">
          <CorrelationChart normalized={store().normalized || {}} symbols={store().symbols} isLoading={store().isLoading} />
        </CompactPanel>
      </Stack>
    </Stack>
  );
}
