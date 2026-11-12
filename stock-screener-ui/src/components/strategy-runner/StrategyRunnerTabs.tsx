import { createEffect, createMemo, createSignal, Show } from "solid-js";
import {
  Tabs,
  Text,
  ScrollArea,
  Group,
  Badge,
  Box,
  ActionIcon,
} from "@/ui";
import type { TableColumnDef } from "../common/TanStackTable";
import * as palette from "@/ui/palette";
import {
  getPnLTextColor,
  formatTimeOnly,
} from "../../utils/ui-helpers";
import { TanStackTable } from "../common/TanStackTable";
import { TradeChart } from "./TradeChart";
import { SideBadge } from "../common/BadgeComponents";
import { getMetricColor, getMetricTextColor } from "../../pages/heatmap/heatmapUtils";
import type {
  StrategyRunnerTrade,
  StrategyRunnerSummary,
  BotSummary,
  SymbolSummary,
  BotInfo,
} from "../../types/strategyRunner";

interface TabsProps {
  trades: StrategyRunnerTrade[];
  summary: StrategyRunnerSummary | null;
  bots: BotInfo[];
}

type BotEntry = {
  uuid: string;
  name: string;
  trades: StrategyRunnerTrade[];
  summary: BotSummary;
};

type SymbolEntry = SymbolSummary & { symbol: string };

function toN(v: any, fallback: number = 0): number {
  return (typeof v === "number" && !Number.isNaN(v)) ? v : fallback;
}
function f2(v: any): string { return toN(v).toFixed(2); }
function f1(v: any): string { return toN(v).toFixed(1); }
function formatPF(pf: number): string {
  if (pf === 0 || !isFinite(pf)) return "\u2014";
  return pf.toFixed(2);
}

/* ───── By Bot Tab ───── */

function ByBotTab(props: { summary: StrategyRunnerSummary | null; trades: StrategyRunnerTrade[] }) {
  const botEntries = createMemo<BotEntry[]>(() => {
    const summary = props.summary;
    const trades = props.trades;
    if (summary?.by_bot) {
      return Object.entries(summary.by_bot).map(([name, data]) => ({
        uuid: name,
        name,
        trades: [],
        summary: data.summary,
      }));
    }
    const grouped = new Map<string, StrategyRunnerTrade[]>();
    for (const t of trades) {
      const arr = grouped.get(t.bot_uuid) || [];
      arr.push(t);
      grouped.set(t.bot_uuid, arr);
    }
    return Array.from(grouped.entries()).map(([uuid, btrades]) => {
      const winners = btrades.filter((t) => t.pnl > 0).length;
      const losers = btrades.filter((t) => t.pnl <= 0).length;
      const netPnl = btrades.reduce((s, t) => s + t.net_pnl, 0);
      const pf = losers > 0
        ? btrades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) /
          Math.abs(btrades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0))
        : btrades.filter((t) => t.pnl > 0).length > 0 ? Infinity : 0;
      return {
        uuid,
        name: btrades[0]?.bot_name || uuid,
        trades: btrades,
        summary: {
          total_trades: btrades.length,
          winners,
          losers,
          win_rate: btrades.length > 0 ? (winners / btrades.length) * 100 : 0,
          net_pnl: netPnl,
          profit_factor: pf,
        } as BotSummary,
      };
    });
  });

  const columns = createMemo<TableColumnDef<BotEntry>[]>(() => [
    { id: "name", header: "Bot", accessorKey: "name", meta: { align: "left" }, cell: ({ row }) => <Text size="xs" fw={500}>{row.original.name}</Text> },
    { id: "total_trades", header: "Trades", accessorKey: "summary.total_trades", meta: { align: "right" }, cell: ({ row }) => <Text size="xs" ta="right" class="font-mono tabular-nums">{row.original.summary.total_trades}</Text> },
    {
      id: "win_rate",
      header: "Win Rate",
      accessorKey: "summary.win_rate",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" c={row.original.summary.win_rate >= 50 ? "success" : "error"} ta="right" class="font-mono tabular-nums">
          {f1(row.original.summary.win_rate)}%
        </Text>
      ),
    },
    {
      id: "net_pnl",
      header: "Net P&L",
      accessorKey: "summary.net_pnl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" fw={500} c={getPnLTextColor(row.original.summary.net_pnl)} ta="right" class="font-mono tabular-nums">
          {row.original.summary.net_pnl >= 0 ? "+" : ""}{f2(row.original.summary.net_pnl)}
        </Text>
      ),
    },
    {
      id: "profit_factor",
      header: "Profit Factor",
      accessorKey: "summary.profit_factor",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" c={row.original.summary.profit_factor > 1 ? "success" : row.original.summary.profit_factor < 1 ? "error" : undefined} ta="right" class="font-mono tabular-nums">
          {formatPF(row.original.summary.profit_factor)}
        </Text>
      ),
    },
  ]);

  return (
    <Show when={botEntries().length > 0} fallback={<Text c="dimmed" ta="center" py="lg">No bot data yet</Text>}>
      <ScrollArea>
        <TanStackTable data={botEntries()} columns={columns()} enableSorting={false} />
      </ScrollArea>
    </Show>
  );
}

/* ───── By Symbol Tab ───── */

function BySymbolTab(props: TabsProps) {
  const symbolEntries = createMemo<SymbolEntry[]>(() => {
    const summary = props.summary;
    const trades = props.trades;
    const bots = props.bots;
    if (summary?.by_symbol) {
      return Object.entries(summary.by_symbol).map(([symbol, s]) => ({ symbol, ...s }));
    }
    const grouped = new Map<string, StrategyRunnerTrade[]>();
    for (const t of trades) {
      const arr = grouped.get(t.symbol) || [];
      arr.push(t);
      grouped.set(t.symbol, arr);
    }
    return Array.from(grouped.entries()).map(([symbol, strades]) => {
      const winners = strades.filter((t) => t.pnl > 0).length;
      const losers = strades.filter((t) => t.pnl <= 0).length;
      const netPnl = strades.reduce((s, t) => s + t.net_pnl, 0);
      const uniqueBots = new Set(strades.map((t) => t.bot_uuid));
      const pf = losers > 0
        ? strades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) /
          Math.abs(strades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0))
        : strades.filter((t) => t.pnl > 0).length > 0 ? Infinity : 0;
      const botPnlMap = new Map<string, number>();
      for (const t of strades) {
        botPnlMap.set(t.bot_uuid, (botPnlMap.get(t.bot_uuid) || 0) + t.net_pnl);
      }
      let bestBot = "";
      let bestPnl = -Infinity;
      for (const [buuid, bpnl] of botPnlMap) {
        if (bpnl > bestPnl) {
          bestPnl = bpnl;
          bestBot = strades.find((t) => t.bot_uuid === buuid)?.bot_name || buuid;
        }
      }
      return {
        symbol,
        total_trades: strades.length,
        winners,
        losers,
        win_rate: strades.length > 0 ? (winners / strades.length) * 100 : 0,
        net_pnl: netPnl,
        profit_factor: pf,
        bots_traded: uniqueBots.size,
        total_bots: bots.length,
        best_bot: bestBot,
      } as SymbolEntry;
    });
  });

  const pnlValues = createMemo(() => symbolEntries().map((s) => s.net_pnl));
  const minPnl = createMemo(() => Math.min(...pnlValues(), 0));
  const maxPnl = createMemo(() => Math.max(...pnlValues(), 1));

  const columns = createMemo<TableColumnDef<SymbolEntry>[]>(() => [
    { id: "symbol", header: "Symbol", accessorKey: "symbol", meta: { align: "left" }, cell: ({ row }) => <Text size="xs" fw={500} class="font-mono tabular-nums">{row.original.symbol}</Text> },
    {
      id: "bots_traded",
      header: "Bots Hit",
      meta: { align: "center" },
      cell: ({ row }) => <Text size="xs" ta="center" class="font-mono tabular-nums">{row.original.bots_traded}/{row.original.total_bots}</Text>,
    },
    { id: "total_trades", header: "Trades", accessorKey: "total_trades", meta: { align: "right" }, cell: ({ row }) => <Text size="xs" ta="right" class="font-mono tabular-nums">{row.original.total_trades}</Text> },
    {
      id: "win_rate",
      header: "Win Rate",
      accessorKey: "win_rate",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" c={row.original.win_rate >= 50 ? "success" : "error"} ta="right" class="font-mono tabular-nums">
          {f1(row.original.win_rate)}%
        </Text>
      ),
    },
    {
      id: "net_pnl",
      header: "Net P&L",
      accessorKey: "net_pnl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box
          ta="right"
          style={{
            background: getMetricColor(row.original.net_pnl, minPnl() < 0 ? minPnl() : 0, maxPnl()),
            padding: "2px 6px",
          }}
        >
          <Text size="xs" fw={500} c={getMetricTextColor(row.original.net_pnl, minPnl() < 0 ? minPnl() : 0, maxPnl())} class="font-mono tabular-nums">
            {row.original.net_pnl >= 0 ? "+" : ""}{f2(row.original.net_pnl)}
          </Text>
        </Box>
      ),
    },
    {
      id: "profit_factor",
      header: "PF",
      accessorKey: "profit_factor",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" c={row.original.profit_factor > 1 ? "success" : row.original.profit_factor < 1 ? "error" : undefined} ta="right" class="font-mono tabular-nums">
          {formatPF(row.original.profit_factor)}
        </Text>
      ),
    },
    { id: "best_bot", header: "Best Bot", accessorKey: "best_bot", meta: { align: "left" }, cell: ({ row }) => <Text size="xs">{row.original.best_bot}</Text> },
  ]);

  return (
    <Show when={symbolEntries().length > 0} fallback={<Text c="dimmed" ta="center" py="lg">No symbol data yet</Text>}>
      <ScrollArea>
        <TanStackTable data={symbolEntries()} columns={columns()} enableSorting={false} />
      </ScrollArea>
    </Show>
  );
}

/* ───── Trade Log Tab ───── */

function TradeLogTab(props: { trades: StrategyRunnerTrade[] }) {
  let bottomRef: HTMLDivElement | undefined;
  const [expandedTrade, setExpandedTrade] = createSignal<string | null>(null);

  createEffect(() => {
    const count = props.trades.length;
    if (count > 0 && bottomRef) {
      bottomRef.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  });

  const columns = createMemo<TableColumnDef<StrategyRunnerTrade>[]>(() => [
    {
      id: "bot_name",
      header: "Bot",
      accessorKey: "bot_name",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" fw={500}>{row.original.bot_name}</Text>,
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" fw={500} class="font-mono tabular-nums">{row.original.symbol}</Text>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => <SideBadge side={row.original.side} size="xs" />,
    },
    {
      id: "entry_time",
      header: "Entry Time",
      accessorKey: "entry_time",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" class="font-mono tabular-nums">{formatTimeOnly(row.original.entry_time)}</Text>,
    },
    {
      id: "exit_time",
      header: "Exit Time",
      accessorKey: "exit_time",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" class="font-mono tabular-nums">{row.original.exit_time ? formatTimeOnly(row.original.exit_time) : "-"}</Text>,
    },
    {
      id: "entry_price",
      header: "Entry Price",
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row }) => <Text size="xs" ta="right" class="font-mono tabular-nums">{f2(row.original.entry_price)}</Text>,
    },
    {
      id: "exit_price",
      header: "Exit Price",
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row }) => <Text size="xs" ta="right" class="font-mono tabular-nums">{f2(row.original.exit_price)}</Text>,
    },
    {
      id: "pnl",
      header: "P&L",
      accessorKey: "pnl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" fw={500} c={getPnLTextColor(row.original.pnl)} ta="right" class="font-mono tabular-nums">
          {row.original.pnl >= 0 ? "+" : ""}{f2(row.original.pnl)}
        </Text>
      ),
    },
    {
      id: "net_pnl",
      header: "Net",
      accessorKey: "net_pnl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" fw={500} c={getPnLTextColor(row.original.net_pnl)} ta="right" class="font-mono tabular-nums">
          {row.original.net_pnl >= 0 ? "+" : ""}{f2(row.original.net_pnl)}
        </Text>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => (
        <Badge size="xs" color="secondary" variant="light">
          {row.original.reason || "-"}
        </Badge>
      ),
    },
    {
      id: "chart_toggle",
      header: "Chart",
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => {
        const tradeKey = `${row.original.bot_uuid}-${row.original.symbol}-${row.original.entry_time}`;
        return (
          <ActionIcon
            size="xs"
            variant={expandedTrade() === tradeKey ? "filled" : "subtle"}
            color={expandedTrade() === tradeKey ? "primary" : "secondary"}
            onClick={(e: MouseEvent) => { e.stopPropagation(); setExpandedTrade(expandedTrade() === tradeKey ? null : tradeKey); }}
          >
            <Text size="xs">{expandedTrade() === tradeKey ? "−" : "+"}</Text>
          </ActionIcon>
        );
      },
    },
  ]);

  return (
    <Show when={props.trades.length > 0} fallback={<Text c="dimmed" ta="center" py="lg">No trades yet</Text>}>
      <Box style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
        <Group gap="sm" align="center" mb="xs" style={{ flex: "0 0 auto" }}>
          <Text size="xs" fw={500}>Trade Log</Text>
          <Text size="xs" c="dimmed" class="font-mono tabular-nums">{props.trades.length} trade{props.trades.length !== 1 ? "s" : ""}</Text>
        </Group>
        <ScrollArea style={{ flex: 1 }} h="100%">
          <TanStackTable<StrategyRunnerTrade>
            data={props.trades}
            columns={columns()}
            enableSorting
            getRowCanExpand={(trade) => {
              const key = `${trade.bot_uuid}-${trade.symbol}-${trade.entry_time}`;
              return expandedTrade() === key;
            }}
            renderSubComponent={(trade) => (
              <Box p="md" className="bg-fin-surface">
                <TradeChart
                  symbol={trade.symbol}
                  date={trade.entry_time?.slice(0, 10) || ""}
                  entryPrice={trade.entry_price}
                  exitPrice={trade.exit_price}
                  entryTime={trade.entry_time}
                  exitTime={trade.exit_time || ""}
                  height={280}
                />
              </Box>
            )}
          />
          <div ref={(el) => (bottomRef = el)} />
        </ScrollArea>
      </Box>
    </Show>
  );
}

/* ───── Correlation Tab ───── */

function CorrelationTab(props: TabsProps) {
  const activeBotNames = createMemo(() => {
    const names = new Set<string>();
    for (const t of props.trades) names.add(t.bot_name);
    return Array.from(names).sort();
  });

  const symbols = createMemo(() => {
    const set = new Set<string>();
    for (const t of props.trades) set.add(t.symbol);
    if (props.summary?.by_symbol) {
      for (const sym of Object.keys(props.summary.by_symbol)) set.add(sym);
    }
    return Array.from(set).sort();
  });

  const columns = createMemo<TableColumnDef<{ symbol: string }>[]>(() => {
    const cols: TableColumnDef<{ symbol: string }>[] = [
      {
        id: "symbol",
        header: "Symbol",
        cell: ({ row }) => (
          <Text size="xs" fw={500} class="font-mono tabular-nums">
            {row.original.symbol}
          </Text>
        ),
        enableSorting: false,
        meta: { align: "left" },
      },
    ];
    for (const botName of activeBotNames()) {
      cols.push({
        id: botName,
        header: () => <Text size="xs" fw={500}>{botName}</Text>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => {
          const symbol = row.original.symbol;
          const botTrades = props.trades.filter((t) => t.symbol === symbol && t.bot_name === botName);
          if (botTrades.length === 0) {
            return (
              <Text size="xs" c="dimmed" ta="center">{"\u2014"}</Text>
            );
          }
          const netPnl = botTrades.reduce((s, t) => s + t.net_pnl, 0);
          const wins = botTrades.filter((t) => t.pnl > 0).length;
          return (
            <Box ta="center" className="px-1 py-[2px]" style={{ "background-color": netPnl > 0 ? palette.TINT_POSITIVE : palette.TINT_NEGATIVE }}>
              <Text size="xs" fw={500} c={netPnl > 0 ? "success" : "error"} class="font-mono tabular-nums">
                {netPnl >= 0 ? "+" : ""}{netPnl.toFixed(0)}
              </Text>
              <Text size="xs" c="dimmed" class="font-mono tabular-nums">{wins}/{botTrades.length}</Text>
            </Box>
          );
        },
      });
    }
    return cols;
  });

  const symbolRows = createMemo(() => symbols().map((s) => ({ symbol: s })));

  return (
    <Show
      when={symbols().length > 0 && activeBotNames().length > 0}
      fallback={
        <Text c="dimmed" ta="center" py="lg">
          Run a comparison to see correlation data
        </Text>
      }
    >
      <ScrollArea>
        <TanStackTable data={symbolRows()} columns={columns()} enableSorting={false} />
      </ScrollArea>
    </Show>
  );
}

/* ───── Exported Tabs Container ───── */

export function StrategyRunnerTabs(props: TabsProps) {
  return (
    <Tabs defaultValue="by_bot">
      <Tabs.List>
        <Tabs.Tab value="by_bot" data-testid="sr-tab-bybot">By Bot</Tabs.Tab>
        <Tabs.Tab value="by_symbol" data-testid="sr-tab-bysymbol">By Symbol</Tabs.Tab>
        <Tabs.Tab value="trade_log" data-testid="sr-tab-trades">Trade Log</Tabs.Tab>
        <Tabs.Tab value="correlation" data-testid="sr-tab-correlation">Correlation</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="by_bot" className="pt-2">
        <ByBotTab summary={props.summary} trades={props.trades} />
      </Tabs.Panel>
      <Tabs.Panel value="by_symbol" className="pt-2">
        <BySymbolTab summary={props.summary} trades={props.trades} bots={props.bots} />
      </Tabs.Panel>
      <Tabs.Panel value="trade_log" className="pt-2" style={{ flex: 1, "min-height": "300px" }}>
        <TradeLogTab trades={props.trades} />
      </Tabs.Panel>
      <Tabs.Panel value="correlation" className="pt-2">
        <CorrelationTab summary={props.summary} trades={props.trades} bots={props.bots} />
      </Tabs.Panel>
    </Tabs>
  );
}
