import { useMemo, useState, useRef, useEffect } from "react";
import {
  Tabs,
  Text,
  ScrollArea,
  Group,
  Badge,
  Box,
  ActionIcon,
} from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
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

function ByBotTab({ summary, trades }: { summary: StrategyRunnerSummary | null; trades: StrategyRunnerTrade[] }) {
  const botEntries = useMemo(() => {
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
  }, [summary, trades]);

  const columns = useMemo<ColumnDef<typeof botEntries[0]>[]>(
    () => [
      { id: "name", header: "Bot", accessorKey: "name", cell: ({ row }) => <Text size="xs" fw={500}>{row.original.name}</Text> },
      { id: "total_trades", header: "Trades", accessorKey: "summary.total_trades", cell: ({ row }) => <Text size="xs" ta="right">{row.original.summary.total_trades}</Text> },
      {
        id: "win_rate",
        header: "Win Rate",
        accessorKey: "summary.win_rate",
        cell: ({ row }) => (
          <Text size="xs" c={row.original.summary.win_rate >= 50 ? "green" : "red"} ta="right">
            {f1(row.original.summary.win_rate)}%
          </Text>
        ),
      },
      {
        id: "net_pnl",
        header: "Net P&L",
        accessorKey: "summary.net_pnl",
        cell: ({ row }) => (
          <Text size="xs" fw={500} c={getPnLTextColor(row.original.summary.net_pnl)} ta="right">
            {row.original.summary.net_pnl >= 0 ? "+" : ""}{f2(row.original.summary.net_pnl)}
          </Text>
        ),
      },
      {
        id: "profit_factor",
        header: "Profit Factor",
        accessorKey: "summary.profit_factor",
        cell: ({ row }) => (
          <Text size="xs" c={row.original.summary.profit_factor > 1 ? "green" : row.original.summary.profit_factor < 1 ? "red" : undefined} ta="right">
            {formatPF(row.original.summary.profit_factor)}
          </Text>
        ),
      },
    ],
    [],
  );

  if (botEntries.length === 0) {
    return <Text c="dimmed" ta="center" py="lg">No bot data yet</Text>;
  }

  return (
    <ScrollArea>
      <TanStackTable data={botEntries} columns={columns} enableSorting={false} />
    </ScrollArea>
  );
}

/* ───── By Symbol Tab ───── */

function BySymbolTab({ summary, trades, bots }: TabsProps) {
  const symbolEntries = useMemo(() => {
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
      } as SymbolSummary & { symbol: string };
    });
  }, [summary, trades, bots]);

  const pnlValues = symbolEntries.map((s) => s.net_pnl);
  const minPnl = Math.min(...pnlValues, 0);
  const maxPnl = Math.max(...pnlValues, 1);

  const columns = useMemo<ColumnDef<(typeof symbolEntries)[0]>[]>(
    () => [
      { id: "symbol", header: "Symbol", accessorKey: "symbol", cell: ({ row }) => <Text size="xs" fw={500}>{row.original.symbol}</Text> },
      {
        id: "bots_traded",
        header: "Bots Hit",
        cell: ({ row }) => <Text size="xs" ta="center">{row.original.bots_traded}/{row.original.total_bots}</Text>,
      },
      { id: "total_trades", header: "Trades", accessorKey: "total_trades", cell: ({ row }) => <Text size="xs" ta="right">{row.original.total_trades}</Text> },
      {
        id: "win_rate",
        header: "Win Rate",
        accessorKey: "win_rate",
        cell: ({ row }) => (
          <Text size="xs" c={row.original.win_rate >= 50 ? "green" : "red"} ta="right">
            {f1(row.original.win_rate)}%
          </Text>
        ),
      },
      {
        id: "net_pnl",
        header: "Net P&L",
        accessorKey: "net_pnl",
        cell: ({ row }) => (
          <Box
            ta="right"
            style={{
              background: getMetricColor(row.original.net_pnl, minPnl < 0 ? minPnl : 0, maxPnl),
              padding: "2px 6px",
            }}
          >
            <Text size="xs" fw={500} c={getMetricTextColor(row.original.net_pnl, minPnl < 0 ? minPnl : 0, maxPnl)}>
              {row.original.net_pnl >= 0 ? "+" : ""}{f2(row.original.net_pnl)}
            </Text>
          </Box>
        ),
      },
      {
        id: "profit_factor",
        header: "PF",
        accessorKey: "profit_factor",
        cell: ({ row }) => (
          <Text size="xs" c={row.original.profit_factor > 1 ? "green" : row.original.profit_factor < 1 ? "red" : undefined} ta="right">
            {formatPF(row.original.profit_factor)}
          </Text>
        ),
      },
      { id: "best_bot", header: "Best Bot", accessorKey: "best_bot", cell: ({ row }) => <Text size="xs">{row.original.best_bot}</Text> },
    ],
    [minPnl, maxPnl],
  );

  if (symbolEntries.length === 0) {
    return <Text c="dimmed" ta="center" py="lg">No symbol data yet</Text>;
  }

  return (
    <ScrollArea>
      <TanStackTable data={symbolEntries} columns={columns} enableSorting={false} />
    </ScrollArea>
  );
}

/* ───── Trade Log Tab ───── */

function TradeLogTab({ trades }: { trades: StrategyRunnerTrade[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [trades.length]);

  const columns = useMemo<ColumnDef<StrategyRunnerTrade>[]>(
    () => [
      {
        id: "bot_name",
        header: "Bot",
        accessorKey: "bot_name",
        cell: ({ row }) => <Text size="xs" fw={500}>{row.original.bot_name}</Text>,
      },
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        cell: ({ row }) => <Text size="xs" fw={500}>{row.original.symbol}</Text>,
      },
      {
        id: "side",
        header: "Side",
        accessorKey: "side",
        enableSorting: false,
        cell: ({ row }) => <SideBadge side={row.original.side} size="xs" />,
      },
      {
        id: "entry_time",
        header: "Entry Time",
        accessorKey: "entry_time",
        cell: ({ row }) => <Text size="xs">{formatTimeOnly(row.original.entry_time)}</Text>,
      },
      {
        id: "exit_time",
        header: "Exit Time",
        accessorKey: "exit_time",
        cell: ({ row }) => <Text size="xs">{row.original.exit_time ? formatTimeOnly(row.original.exit_time) : "-"}</Text>,
      },
      {
        id: "entry_price",
        header: "Entry Price",
        enableSorting: false,
        cell: ({ row }) => <Text size="xs" ta="right">{f2(row.original.entry_price)}</Text>,
      },
      {
        id: "exit_price",
        header: "Exit Price",
        enableSorting: false,
        cell: ({ row }) => <Text size="xs" ta="right">{f2(row.original.exit_price)}</Text>,
      },
      {
        id: "pnl",
        header: "P&L",
        accessorKey: "pnl",
        cell: ({ row }) => (
          <Text size="xs" fw={500} c={getPnLTextColor(row.original.pnl)} ta="right">
            {row.original.pnl >= 0 ? "+" : ""}{f2(row.original.pnl)}
          </Text>
        ),
      },
      {
        id: "net_pnl",
        header: "Net",
        accessorKey: "net_pnl",
        cell: ({ row }) => (
          <Text size="xs" fw={500} c={getPnLTextColor(row.original.net_pnl)} ta="right">
            {row.original.net_pnl >= 0 ? "+" : ""}{f2(row.original.net_pnl)}
          </Text>
        ),
      },
      {
        id: "reason",
        header: "Reason",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge size="xs" color="gray" variant="light">
            {row.original.reason || "-"}
          </Badge>
        ),
      },
      {
        id: "chart_toggle",
        header: "Chart",
        enableSorting: false,
        cell: ({ row }) => {
          const tradeKey = `${row.original.bot_uuid}-${row.original.symbol}-${row.original.entry_time}`;
          const isExpanded = expandedTrade === tradeKey;
          return (
            <ActionIcon
              size="xs"
              variant={isExpanded ? "filled" : "subtle"}
              color={isExpanded ? "blue" : "gray"}
              onClick={(e) => { e.stopPropagation(); setExpandedTrade(isExpanded ? null : tradeKey); }}
            >
              <Text size="xs">{isExpanded ? "−" : "+"}</Text>
            </ActionIcon>
          );
        },
      },
    ],
    [expandedTrade],
  );

  if (trades.length === 0) {
    return <Text c="dimmed" ta="center" py="lg">No trades yet</Text>;
  }

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Group gap="sm" mb="xs" style={{ flex: "0 0 auto" }}>
        <Text size="xs" fw={500}>Trade Log</Text>
        <Text size="xs" c="dimmed">{trades.length} trade{trades.length !== 1 ? "s" : ""}</Text>
      </Group>
      <ScrollArea style={{ flex: 1 }} h="100%">
        <TanStackTable<StrategyRunnerTrade>
          data={trades}
          columns={columns}
          enableSorting
          getRowCanExpand={(trade) => {
            const key = `${trade.bot_uuid}-${trade.symbol}-${trade.entry_time}`;
            return expandedTrade === key;
          }}
          renderSubComponent={(trade) => (
            <Box p="md" style={{ background: "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))" }}>
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
        <div ref={bottomRef} />
      </ScrollArea>
    </Box>
  );
}

/* ───── Correlation Tab ───── */

function CorrelationTab({ summary, trades, bots }: TabsProps) {
  const activeBotNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of trades) names.add(t.bot_name);
    return Array.from(names).sort();
  }, [trades]);

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) set.add(t.symbol);
    if (summary?.by_symbol) {
      for (const sym of Object.keys(summary.by_symbol)) set.add(sym);
    }
    return Array.from(set).sort();
  }, [summary, trades]);

  const columns = useMemo<ColumnDef<{ symbol: string }>[]>(() => {
    const cols: ColumnDef<{ symbol: string }>[] = [
      {
        id: "symbol",
        header: "Symbol",
        cell: ({ row }) => (
          <Text size="xs" fw={500}>
            {row.original.symbol}
          </Text>
        ),
        enableSorting: false,
      },
    ];
    for (const botName of activeBotNames) {
      cols.push({
        id: botName,
        header: () => <Text size="xs" fw={500}>{botName}</Text>,
        enableSorting: false,
        cell: ({ row }) => {
          const symbol = row.original.symbol;
          const botTrades = trades.filter((t) => t.symbol === symbol && t.bot_name === botName);
          if (botTrades.length === 0) {
            return (
              <Text size="xs" c="dimmed" ta="center">{"\u2014"}</Text>
            );
          }
          const netPnl = botTrades.reduce((s, t) => s + t.net_pnl, 0);
          const wins = botTrades.filter((t) => t.pnl > 0).length;
          const bgColor = netPnl > 0 ? "var(--mantine-color-green-1)" : "var(--mantine-color-red-1)";
          const textColor = netPnl > 0 ? "var(--mantine-color-green-8)" : "var(--mantine-color-red-8)";
          return (
            <Box ta="center" style={{ background: bgColor, padding: "2px 4px" }}>
              <Text size="xs" fw={500} c={textColor}>
                {netPnl >= 0 ? "+" : ""}{netPnl.toFixed(0)}
              </Text>
              <Text size="xs" c="dimmed">{wins}/{botTrades.length}</Text>
            </Box>
          );
        },
      });
    }
    return cols;
  }, [activeBotNames, trades]);

  const symbolRows = useMemo(() => symbols.map((s) => ({ symbol: s })), [symbols]);

  if (symbols.length === 0 || activeBotNames.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        Run a comparison to see correlation data
      </Text>
    );
  }

  return (
    <ScrollArea>
      <TanStackTable data={symbolRows} columns={columns} enableSorting={false} />
    </ScrollArea>
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
      <Tabs.Panel value="by_bot" pt="sm">
        <ByBotTab summary={props.summary} trades={props.trades} />
      </Tabs.Panel>
      <Tabs.Panel value="by_symbol" pt="sm">
        <BySymbolTab {...props} />
      </Tabs.Panel>
      <Tabs.Panel value="trade_log" pt="sm" style={{ flex: 1, minHeight: 300 }}>
        <TradeLogTab trades={props.trades} />
      </Tabs.Panel>
      <Tabs.Panel value="correlation" pt="sm">
        <CorrelationTab {...props} />
      </Tabs.Panel>
    </Tabs>
  );
}
