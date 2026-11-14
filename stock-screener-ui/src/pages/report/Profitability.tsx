import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Alert, Button, Select, Skeleton, Text, ToolbarRow } from "@/ui";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { NumCell, SymbolCell, TextCell } from "@/components/common/tableCells";
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
} from "../../utils/ui-helpers";

interface ProfitabilityPageProps {
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

function Money(props: { value: number; testId?: string }) {
  return (
    <NumCell value={props.value} signed fw={700} format={formatCurrencyCompact} testId={props.testId} />
  );
}

const STRATEGY_COLUMNS: TableColumnDef<StrategyProfitRow>[] = [
  {
    id: "label",
    header: "Strategy",
    accessorKey: "label",
    meta: { align: "left" },
    cell: (ctx) => (
      <TextCell value={ctx.row.original.label} fw={600} testId={`profit-strategy-${ctx.row.original.id}`} />
    ),
  },
  {
    id: "trades",
    header: "Trades",
    accessorKey: "trades",
    meta: { align: "right" },
    cell: (ctx) => <NumCell value={ctx.row.original.trades} />,
  },
  {
    id: "win_rate",
    header: "Win%",
    accessorKey: "win_rate",
    meta: { align: "right" },
    cell: (ctx) => (
      <NumCell
        value={(ctx.row.original.win_rate ?? 0) * 100}
        format={(v) => formatPercentage(v, 1, false)}
      />
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
      <NumCell value={ctx.row.original.profit_factor ?? 0} format={(v) => v.toFixed(2)} />
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
      <NumCell value={ctx.row.original.avg_hold_days ?? 0} format={(v) => v.toFixed(1)} />
    ),
  },
];

const SIGNAL_COLUMNS: TableColumnDef<ProfitTopSignal>[] = [
  {
    id: "symbol",
    header: "Symbol",
    accessorKey: "symbol",
    meta: { align: "left" },
    cell: (ctx) => (
      <SymbolCell
        symbol={ctx.row.original.symbol}
        fw={600}
        testId={`profit-signal-${ctx.row.original.symbol}-${ctx.row.index}`}
      />
    ),
  },
  {
    id: "strategy",
    header: "Pattern",
    accessorKey: "strategy",
    meta: { align: "left" },
    cell: (ctx) => <TextCell value={ctx.row.original.strategy} />,
  },
  {
    id: "entry_date",
    header: "Entry",
    accessorKey: "entry_date",
    meta: { align: "left" },
    cell: (ctx) => <TextCell value={ctx.row.original.entry_date} mono />,
  },
  {
    id: "entry",
    header: "In ₹",
    accessorKey: "entry",
    meta: { align: "right" },
    cell: (ctx) => <NumCell value={ctx.row.original.entry} format={formatCurrencyCompact} />,
  },
  {
    id: "exit",
    header: "Out ₹",
    accessorKey: "exit",
    meta: { align: "right" },
    cell: (ctx) => <NumCell value={ctx.row.original.exit} format={formatCurrencyCompact} />,
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
 * Dense TanStack tables sorted by net desc; `@/ui` only. */
export function ProfitabilityPage(props: ProfitabilityPageProps) {
  const [universe, setUniverse] = createSignal<string>(props.universe ?? "nifty500");
  const [weeks, setWeeks] = createSignal<number>(4);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [data, setData] = createSignal<ProfitabilityResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const prop = props.universe;
    if (prop) setUniverse(prop);
  });

  createEffect(() => {
    const w = weeks();
    const u = universe();
    refreshKey();
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    setLoading(true);
    setError(null);
    fetchProfitability(w, u)
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
  });

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const isEmpty = () => {
    const value = data();
    return (
      !loading() &&
      !error() &&
      (value?.strategies ?? []).every((r) => (r.trades ?? 0) === 0) &&
      (value?.top_signals ?? []).length === 0
    );
  };

  return (
    <div data-testid="profitability-report" class="flex flex-col gap-2 min-w-0 w-full flex-1">
      <ToolbarRow gap={8} wrap={false} data-testid="profitability-toolbar" style={{ height: "48px" }}>
        <Text size="sm" fw={700} span data-testid="profitability-title" className="whitespace-nowrap">
          Pattern Profitability
        </Text>
        <Select
          size="xs"
          w={140}
          value={universe()}
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
          value={String(weeks())}
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
        <div class="flex-1 min-w-0" />
        <Show when={data()?.as_of}>
          {(asOf) => (
            <Text size="xs" c="dimmed" truncate span data-testid="profitability-asof">
              as of {formatTimeOnly(asOf())}
              {data()?.cached ? " (cached)" : null}
            </Text>
          )}
        </Show>
      </ToolbarRow>

      <Show
        when={!loading()}
        fallback={
          <div class="flex flex-col gap-2 w-full min-w-0" data-testid="profitability-loading">
            <Skeleton h={16} />
            <Skeleton h={16} />
            <Skeleton h={16} />
          </div>
        }
      >
        <Show
          when={error()}
          fallback={
            <Show
              when={!isEmpty()}
              fallback={
                <div class="p-4 text-center w-full" data-testid="profitability-empty">
                  <Text size="xs" c="dimmed">
                    No pattern trades in the last {weeks()} week{weeks() === 1 ? "" : "s"}
                  </Text>
                </div>
              }
            >
              <ToolbarRow gap={8} wrap={false}>
                <Text size="sm" fw={700} span data-testid="profitability-strategies-title">
                  Strategies by net P&amp;L
                </Text>
              </ToolbarRow>
              <TanStackTable<StrategyProfitRow>
                data={data()?.strategies ?? []}
                columns={STRATEGY_COLUMNS}
                dataTestId="profitability-strategies"
                initialState={{ sorting: [{ id: "net_pnl", desc: true }] }}
                emptyMessage="No strategy data"
                dense
              />
              <ToolbarRow gap={8} wrap={false}>
                <Text size="sm" fw={700} span data-testid="profitability-signals-title">
                  Top signals
                </Text>
              </ToolbarRow>
              <TanStackTable<ProfitTopSignal>
                data={data()?.top_signals ?? []}
                columns={SIGNAL_COLUMNS}
                dataTestId="profitability-signals"
                initialState={{ sorting: [{ id: "net", desc: true }] }}
                emptyMessage="No signals"
                dense
                onRowClick={props.onOpenSymbol ? (row) => props.onOpenSymbol?.(row.symbol) : undefined}
                getRowTestId={(row, index) => `profitability-signal-row-${row.symbol}-${index}`}
              />
            </Show>
          }
        >
          {(message) => (
            <div data-testid="profitability-error">
              <Alert color="error" data-testid="profitability-error-alert">
                {message()}
              </Alert>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}

export default ProfitabilityPage;
