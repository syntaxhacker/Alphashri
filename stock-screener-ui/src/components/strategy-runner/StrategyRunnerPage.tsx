import { useState, useRef, useEffect, useCallback } from "react";
import { Stack, Box, Text, Title, Button, Progress, Group } from "@mantine/core";
import { StrategyRunnerConfig as StrategyRunnerConfigComp } from "./StrategyRunnerConfig";
import { StrategyRunnerStats } from "./StrategyRunnerStats";
import { StrategyRunnerTabs } from "./StrategyRunnerTabs";
import { runStrategyRunner } from "../../api/strategyRunner";
import { listBots } from "../../api/bots";
import type { BotConfig } from "../../types/bots";
import type { StrategyRunnerTrade, StrategyRunnerSummary, BotInfo, StrategyRunnerConfig } from "../../types/strategyRunner";

function botConfigToBotInfo(bot: BotConfig): BotInfo {
  const s = bot.strategies?.[0];
  return { uuid: bot.uuid, name: bot.name, strategy_name: s?.name || "", strategy_type: s?.strategy_type || "", sl_pct: s?.sl_pct || 0, tp_pct: s?.tp_pct || 0, watchlist: [] };
}

function readConfigFromURL(): Partial<StrategyRunnerConfig> {
  const p = new URLSearchParams(window.location.search);
  const cfg: Partial<StrategyRunnerConfig> = {};
  const bots = p.get("bots");
  if (bots) cfg.bot_uuids = bots.split(",");
  const d = p.get("date");
  if (d) cfg.date = d;
  const ed = p.get("end_date");
  if (ed) cfg.end_date = ed;
  const syms = p.get("symbols");
  if (syms) cfg.symbols = syms.split(",");
  return cfg;
}

function writeConfigToURL(config: StrategyRunnerConfig) {
  const p = new URLSearchParams();
  if (config.bot_uuids.length) p.set("bots", config.bot_uuids.join(","));
  if (config.date) p.set("date", config.date);
  if (config.end_date) p.set("end_date", config.end_date);
  if (config.symbols.length) p.set("symbols", config.symbols.join(","));
  const qs = p.toString();
  const url = qs ? `/strategy-runner?${qs}` : "/strategy-runner";
  window.history.replaceState({}, "", url);
}

export function StrategyRunnerPage() {
  const [config, setConfigRaw] = useState<StrategyRunnerConfig>(() => {
    const initial: StrategyRunnerConfig = { bot_uuids: [], date: "", end_date: "", symbols: [] };
    return { ...initial, ...readConfigFromURL() };
  });
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [trades, setTrades] = useState<StrategyRunnerTrade[]>([]);
  const [summary, setSummary] = useState<StrategyRunnerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ currentBot: 0, totalBots: 0, currentBotName: "" });

  const configRef = useRef(config);
  configRef.current = config;
  const startRunnerRef = useRef<(() => void) | null>(null);
  const autoRunDone = useRef(false);

  const setConfig = useCallback((partial: Partial<StrategyRunnerConfig>) => {
    setConfigRaw((prev) => {
      const next = { ...prev, ...partial };
      writeConfigToURL(next);
      return next;
    });
  }, []);

  useEffect(() => {
    listBots()
      .then((data) => setBots(data.map(botConfigToBotInfo)))
      .catch(() => {}); // auth-dependent, ignore silently
  }, []);

  const startRunner = useCallback(async () => {
    const cfg = configRef.current;
    setIsRunning(true);
    setTrades([]);
    setSummary(null);
    setError(null);
    setProgress((p) => ({ ...p, currentBotName: "Running..." }));

    try {
      const result = await runStrategyRunner(cfg);
      const trades = (result.trades || []) as StrategyRunnerTrade[];
      setTrades(trades);
      if (result.summary) {
        setSummary(result.summary as StrategyRunnerSummary);
      }
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setIsRunning(false);
    }
  }, []);

  startRunnerRef.current = startRunner;

  // Auto-run on first load if URL has params (only once)
  useEffect(() => {
    if (autoRunDone.current) return;
    const canRun = config.bot_uuids.length > 0 && config.date && config.symbols.length > 0 && !isRunning && trades.length === 0;
    if (canRun) {
      autoRunDone.current = true;
      const timer = setTimeout(() => startRunnerRef.current?.(), 800);
      return () => clearTimeout(timer);
    }
  }, [config.bot_uuids.length, config.date, config.symbols.length, isRunning, trades.length]);

  const stopRunner = useCallback(() => {
    sseRef.current?.();
    sseRef.current = null;
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    sseRef.current?.();
    sseRef.current = null;
    setTrades([]);
    setSummary(null);
    setError(null);
    setIsRunning(false);
    collectedRef.current = [];
    writeConfigToURL({ bot_uuids: [], date: "", end_date: "", symbols: [] });
  }, []);

  return (
    <Stack gap="md" p="md" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "auto" }}>
      <Box flex="0 0 auto" data-testid="sr-header">
        <Title order={2} size="h4">Strategy Runner</Title>
        <Text size="sm" c="dimmed">Compare bot strategies side by side</Text>
      </Box>

      <Box flex="0 0 auto" data-testid="sr-config">
        <StrategyRunnerConfigComp
          config={config}
          bots={bots}
          isRunning={isRunning}
          progress={progress}
          setConfig={setConfig}
          loadBots={() => {}}
          startRunner={startRunner}
          stopRunner={stopRunner}
          reset={reset}
        />
      </Box>

      {isRunning && (
        <Box flex="0 0 auto" data-testid="sr-progress">
          <Progress value={progress.totalBots > 0 ? ((progress.currentBot + (progress.currentBotName.includes("done") ? 1 : 0)) / progress.totalBots) * 100 : 0} size="sm" animated />
          <Text size="xs" c="dimmed" mt={2}>{progress.currentBotName}</Text>
        </Box>
      )}

      {error && (
        <Box flex="0 0 auto" data-testid="sr-error">
          <Text size="sm" c="red">{error}</Text>
        </Box>
      )}

      <Box flex="0 0 auto" data-testid="sr-stats">
        <StrategyRunnerStats trades={trades} summary={summary} isRunning={isRunning} progress={progress} />
      </Box>

      <Box style={{ flex: 1, minHeight: 300 }} data-testid="sr-tabs">
        <StrategyRunnerTabs trades={trades} summary={summary} bots={bots} />
      </Box>
    </Stack>
  );
}

function computeSummary(trades: StrategyRunnerTrade[], setSummary: (s: StrategyRunnerSummary) => void) {
  const wins = trades.filter((t) => t.pnl > 0);
  const gp = wins.reduce((s, t) => s + t.pnl, 0);
  const gl = Math.abs(trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));

  const byBot: Record<string, any> = {};
  for (const t of trades) {
    const bn = t.bot_name || "?";
    if (!byBot[bn]) byBot[bn] = { trades: [] };
    byBot[bn].trades.push(t);
  }
  for (const [bn, d] of Object.entries(byBot)) {
    const bt = d.trades;
    const bw = bt.filter((t: any) => t.pnl > 0).length;
    const bgp = bt.filter((t: any) => t.pnl > 0).reduce((s: number, t: any) => s + t.pnl, 0);
    const bgl = Math.abs(bt.filter((t: any) => t.pnl <= 0).reduce((s: number, t: any) => s + t.pnl, 0));
    d.summary = { total_trades: bt.length, winners: bw, win_rate: bt.length > 0 ? (bw / bt.length) * 100 : 0, net_pnl: bt.reduce((s: number, t: any) => s + t.net_pnl, 0), profit_factor: bgl > 0 ? bgp / bgl : bw > 0 ? Infinity : 0 };
  }

  const bySym: Record<string, any> = {};
  for (const t of trades) {
    const sym = t.symbol || "?";
    if (!bySym[sym]) bySym[sym] = { trades: [], bots: new Set<string>() };
    bySym[sym].trades.push(t);
    bySym[sym].bots.add(t.bot_name || "?");
  }
  const symbolSummary: Record<string, any> = {};
  for (const [sym, d] of Object.entries(bySym)) {
    const st = d.trades;
    const sw = st.filter((t: any) => t.pnl > 0).length;
    const sgp = st.filter((t: any) => t.pnl > 0).reduce((s: number, t: any) => s + t.pnl, 0);
    const sgl = Math.abs(st.filter((t: any) => t.pnl <= 0).reduce((s: number, t: any) => s + t.pnl, 0));
    const botPnl: Record<string, number> = {};
    for (const t of st) botPnl[t.bot_name || "?"] = (botPnl[t.bot_name || "?"] || 0) + t.net_pnl;
    const best = Object.entries(botPnl).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    symbolSummary[sym] = { total_trades: st.length, winners: sw, win_rate: st.length > 0 ? (sw / st.length) * 100 : 0, net_pnl: st.reduce((s: number, t: any) => s + t.net_pnl, 0), profit_factor: sgl > 0 ? sgp / sgl : sw > 0 ? Infinity : 0, bots_traded: d.bots.size, best_bot: best };
  }

  setSummary({ total_trades: trades.length, winners: wins.length, win_rate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0, net_pnl: trades.reduce((s, t) => s + t.net_pnl, 0), profit_factor: gl > 0 ? gp / gl : wins.length > 0 ? Infinity : 0, by_bot: Object.fromEntries(Object.entries(byBot).map(([k, v]) => [k, { summary: v.summary }])), by_symbol: symbolSummary });
}
