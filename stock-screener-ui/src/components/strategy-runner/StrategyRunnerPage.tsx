import { useState, useRef, useEffect, useCallback } from "react";
import { Stack, Box, Text, Title, Progress } from "@/ui";
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
    if (isRunning) return;
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
  }, [isRunning]);

  const stopRunner = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    setTrades([]);
    setSummary(null);
    setError(null);
    setIsRunning(false);

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
          <Text size="sm" c="error">{error}</Text>
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


