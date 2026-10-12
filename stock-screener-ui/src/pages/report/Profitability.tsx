import { useCallback, useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, Box, Button, Select, Skeleton, Text, ToolbarRow } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { fetchProfitability } from "../../api/profitability";
import type {
  ProfitabilityResponse,
  ProfitTopSignal,
  StrategyProfitRow,
} from "../../types/profitability";
import {
  formatCurrencyCompact,
  formatPercentage,
  formatTimeOnly,
  getPnLTextColor,
} from "../../utils/ui-helpers";

export interface ProfitabilityPageProps {
  universe?: string;
  onOpenSymbol?: (symbol: string) => void;
}

const UNIVERSE_OPTIONS = [
  { value: "nifty500", label: "Nifty 500" },
  { value: "nifty200", label: "Nifty 200" },
  { value: "nifty100", label: "Nifty 100" },
  { value: "nifty50", label: "Nifty 50" },
  { value: "all", label: "All NSE" },
];

const WEEKS_OPTIONS = [
  { value: "1", label: "1 week" },
  { value: "2", label: "2 weeks" },
  { value: "4", label: "4 weeks" },
  { value: "8", label: "8 weeks" },
  { value: "12", label: "12 weeks" },
];

function Money({ value, testId }: { value: number; testId?: string }) {
  return (
    <Text size="xs" fw={700} c={getPnLTextColor(value)} span data-testid={testId} sx={{ fontVariantNumeric: "tabular-nums" }}>
      {formatCurrencyCompact(value)}
    </Text>
  );
}

const STRATEGY_COLUMNS: ColumnDef<StrategyProfitRow>[] = [
  {
    id: "label",
    header: "Strategy",
    accessorKey: "label",
    meta: { align: "left" },
    cell: (ctx) => (
      <Text size="xs" fw={600} span data-testid={`profit-strategy-${ctx.row.original.id}`}>
        {ctx.row.original.label}
      </Text>
    ),
  },
  {
    id: "trades",
    header: "Trades",
    accessorKey: "trades",
    meta: { align: "right" },
    cell: (ctx) => (
      <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {ctx.row.original.trades}
      </Text>
    ),
  },
  {
    id: "win_rate",
    header: "Win%",
    accessorKey: "win_rate",
    meta: { align: "right" },
    cell: (ctx) => (
      <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {formatPercentage((ctx.row.original.win_rate ?? 0) * 100, 1, false)}
      </Text>
    ),
  },
  {
    id: "net_pnl",
    header: "Net ₹",
    accessorKey: "net_pnl",
    meta: { align: "right" },
    cell: (ctx) => <Money value={ctx.row.original.net_pnl ?? 0} />,
  },
  {
    id: "expectancy",
    header: "Exp/trade",
    accessorKey: "expectancy",
    meta: { align: "right" },
    cell: (ctx) => <Money value={ctx.row.original.expectancy ?? 0} />,
  },
  {
    id: "profit_factor",
    header: "PF",
    accessorKey: "profit_factor",
    meta: { align: "right" },
    cell: (ctx) => (
      <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {(ctx.row.original.profit_factor ?? 0).toFixed(2)}
      </Text>
    ),
  },
  {
    id: "max_dd",
    header: "MaxDD",
    accessorKey: "max_dd",
    meta: { align: "right" },
    cell: (ctx) => <Money value={-(ctx.row.original.max_dd ?? 0)} />,
  },
  {
    id: "avg_hold_days",
    header: "Hold(d)",
    accessorKey: "avg_hold_days",
    meta: { align: "right" },
    cell: (ctx) => (
      <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {(ctx.row.original.avg_hold_days ?? 0).toFixed(1)}
      </Text>
    ),
  },
];

const SIGNAL_COLUMNS: ColumnDef<ProfitTopSignal>[] = [
  {
    id: "symbol",
    header: "Symbol",
    accessorKey: "symbol",
    meta: { align: "left" },
    cell: (ctx) => (
      <Text size="xs" fw={600} span data-testid={`profit-signal-${ctx.row.original.symbol}-${ctx.row.index}`}>
        {ctx.row.original.symbol}
      </Text>
    ),
  },
  {
    id: "strategy",
    header: "Pattern",
    accessorKey: "strategy",
    meta: { align: "left" },
    cell: (ctx) => (
      <Text size="xs" span>
        {ctx.row.original.strategy}
      </Text>
    ),
  },
  {
    id: "entry_date",
    header: "Entry",
    accessorKey: "entry_date",
    meta: { align: "left" },
    cell: (ctx) => (
      <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {ctx.row.original.entry_date || "—"}
      </Text>
    ),
  },
  {
    id: "entry",
    header: "In ₹",
    accessorKey: "entry",
    meta: { align: "right" },
    cell: (ctx) => (
      <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {formatCurrencyCompact(ctx.row.original.entry)}
      </Text>
    ),
  },
  {
    id: "exit",
    header: "Out ₹",
    accessorKey: "exit",
    meta: { align: "right" },
    cell: (ctx) => (
      <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {formatCurrencyCompact(ctx.row.original.exit)}
      </Text>
    ),
  },
  {
    id: "net",
    header: "Net ₹",
    accessorKey: "net",
    meta: { align: "right" },
    cell: (ctx) => <Money value={ctx.row.original.net ?? 0} />,
  },
];

/** Pattern-profitability screener: which patterns make money.
 * Mount at `/report/profit` (see App.tsx route snippet below the component).
 * Dense TanStack tables sorted by net desc; `@/ui` only. */
export function ProfitabilityPage({ universe: universeProp = "nifty500", onOpenSymbol }: ProfitabilityPageProps) {
  const [universe, setUniverse] = useState<string>(universeProp);
  const [weeks, setWeeks] = useState<number>(4);
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<ProfitabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUniverse(universeProp);
  }, [universeProp]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProfitability(weeks, universe)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load profitability");
        setData(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weeks, universe, refreshKey]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const isEmpty =
    !loading &&
    !error &&
    (data?.strategies ?? []).every((r) => (r.trades ?? 0) === 0) &&
    (data?.top_signals ?? []).length === 0;

  return (
    <Box data-testid="profitability-report" sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, width: "100%", flex: 1 }}>
      <ToolbarRow gap={8} wrap={false} data-testid="profitability-toolbar" style={{ height: 48 }}>
        <Text size="sm" fw={700} span data-testid="profitability-title" sx={{ whiteSpace: "nowrap" }}>
          Pattern Profitability
        </Text>
        <Select
          size="xs"
          w={140}
          value={universe}
          onChange={(v) => {
            if (v) setUniverse(v);
          }}
          data={UNIVERSE_OPTIONS}
          data-testid="profitability-universe"
          aria-label="Universe"
        />
        <Select
          size="xs"
          w={110}
          value={String(weeks)}
          onChange={(v) => {
            const n = Number(v);
            if (Number.isFinite(n)) setWeeks(n);
          }}
          data={WEEKS_OPTIONS}
          data-testid="profitability-weeks"
          aria-label="Weeks"
        />
        <Button size="xs" variant="subtle" onClick={handleRefresh} data-testid="profitability-refresh" aria-label="Refresh profitability">
          Refresh
        </Button>
        <Box sx={{ flex: 1, minWidth: 0 }} />
        {data?.as_of ? (
          <Text size="xs" c="dimmed" truncate span data-testid="profitability-asof">
            as of {formatTimeOnly(data.as_of)}
            {data.cached ? " (cached)" : null}
          </Text>
        ) : null}
      </ToolbarRow>

      {loading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }} data-testid="profitability-loading">
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
        </Box>
      ) : error ? (
        <Box data-testid="profitability-error">
          <Alert color="error" data-testid="profitability-error-alert">
            {error}
          </Alert>
        </Box>
      ) : isEmpty ? (
        <Box sx={{ p: 2, textAlign: "center", width: "100%" }} data-testid="profitability-empty">
          <Text size="xs" c="dimmed">
            No pattern trades in the last {weeks} week{weeks === 1 ? "" : "s"}
          </Text>
        </Box>
      ) : (
        <>
          <ToolbarRow gap={8} wrap={false}>
            <Text size="sm" fw={700} span data-testid="profitability-strategies-title">
              Strategies by net P&amp;L
            </Text>
          </ToolbarRow>
          <TanStackTable<StrategyProfitRow>
            data={data?.strategies ?? []}
            columns={STRATEGY_COLUMNS}
            dataTestId="profitability-strategies"
            initialState={{ sorting: [{ id: "net_pnl", desc: true }] }}
            emptyMessage="No strategy data"
          />
          <ToolbarRow gap={8} wrap={false}>
            <Text size="sm" fw={700} span data-testid="profitability-signals-title">
              Top signals
            </Text>
          </ToolbarRow>
          <TanStackTable<ProfitTopSignal>
            data={data?.top_signals ?? []}
            columns={SIGNAL_COLUMNS}
            dataTestId="profitability-signals"
            initialState={{ sorting: [{ id: "net", desc: true }] }}
            emptyMessage="No signals"
            onRowClick={onOpenSymbol ? (row) => onOpenSymbol(row.symbol) : undefined}
            getRowTestId={(row, index) => `profitability-signal-row-${row.symbol}-${index}`}
          />
        </>
      )}
    </Box>
  );
}

export default ProfitabilityPage;

// Route mount (for the integrator — App.tsx):
//   const ProfitabilityPage = lazy(() => import("./pages/report/Profitability").then(m => ({ default: m.ProfitabilityPage })));
//   <Route path="/report/profit" element={<ProfitabilityPage />} />
