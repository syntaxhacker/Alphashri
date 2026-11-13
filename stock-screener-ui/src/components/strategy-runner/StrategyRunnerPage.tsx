import { createSignal, onMount, Show } from "solid-js";
import { Box, Text, Title, Progress, ToolbarRow } from "@/ui";
import { StrategyRunnerConfig as StrategyRunnerConfigComp } from "./StrategyRunnerConfig";
import { StrategyRunnerStats } from "./StrategyRunnerStats";
import { StrategyRunnerTabs } from "./StrategyRunnerTabs";
import { runStrategyRunner } from "../../api/strategyRunner";
import { listBots } from "../../api/bots";
import type { BotConfig } from "../../types/bots";
import type { StrategyRunnerTrade, StrategyRunnerSummary, BotInfo, StrategyRunnerConfig } from "../../types/strategyRunner";
import * as palette from "@/ui/palette";

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
  const [config, setConfigRaw] = createSignal<StrategyRunnerConfig>({
    bot_uuids: [],
    date: "",
    end_date: "",
    symbols: [],
    ...readConfigFromURL(),
  });
  const [bots, setBots] = createSignal<BotInfo[]>([]);
  const [isRunning, setIsRunning] = createSignal(false);
  const [trades, setTrades] = createSignal<StrategyRunnerTrade[]>([]);
  const [summary, setSummary] = createSignal<StrategyRunnerSummary | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal({ currentBot: 0, totalBots: 0, currentBotName: "" });

  const setConfig = (partial: Partial<StrategyRunnerConfig>) => {
    const next = { ...config(), ...partial };
    setConfigRaw(next);
    writeConfigToURL(next);
  };

  onMount(() => {
    listBots()
      .then((data) => setBots(data.map(botConfigToBotInfo)))
      .catch(() => {}); // auth-dependent, ignore silently
  });

  const startRunner = async () => {
    if (isRunning()) return;
    const cfg = config();
    setIsRunning(true);
    setTrades([]);
    setSummary(null);
    setError(null);
    setProgress((p) => ({ ...p, currentBotName: "Running..." }));

    try {
      const result = await runStrategyRunner(cfg);
      const resultTrades = (result.trades || []) as StrategyRunnerTrade[];
      setTrades(resultTrades);
      if (result.summary) {
        setSummary(result.summary as StrategyRunnerSummary);
      }
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setIsRunning(false);
    }
  };

  const stopRunner = () => {
    setIsRunning(false);
  };

  const reset = () => {
    setTrades([]);
    setSummary(null);
    setError(null);
    setIsRunning(false);

    writeConfigToURL({ bot_uuids: [], date: "", end_date: "", symbols: [] });
  };

  return (
    <Box className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-fin-bg">
      <ToolbarRow
        gap={8}
        wrap={false}
        data-testid="sr-header"
        style={{ flex: "0 0 auto", height: `${palette.FIN_HEADER_H}px`, padding: `0 ${palette.FIN_OUTER_PAD}px`, "border-bottom": "1px solid var(--color-fin-border)" }}
      >
        <Title order={2} size="h4">Strategy Runner</Title>
        <Text size="sm" c="dimmed" style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
          Compare bot strategies side by side
          {config().bot_uuids.length > 0 || config().symbols.length > 0
            ? ` · ${config().bot_uuids.length} bot${config().bot_uuids.length === 1 ? "" : "s"} · ${config().symbols.length} symbol${config().symbols.length === 1 ? "" : "s"}`
            : ""}
        </Text>
      </ToolbarRow>

      <Box flex="0 0 auto" data-testid="sr-config" className="border-b border-fin-border px-4 py-2">
        <StrategyRunnerConfigComp
          config={config()}
          bots={bots()}
          isRunning={isRunning()}
          progress={progress()}
          setConfig={setConfig}
          loadBots={() => Promise.resolve()}
          startRunner={startRunner}
          stopRunner={stopRunner}
          reset={reset}
        />
      </Box>

      <Show when={isRunning()}>
        <Box flex="0 0 auto" data-testid="sr-progress" className="px-4 pt-2">
          <Progress value={progress().totalBots > 0 ? ((progress().currentBot + (progress().currentBotName.includes("done") ? 1 : 0)) / progress().totalBots) * 100 : 0} size="sm" animated />
          <Text size="xs" c="dimmed" mt={2}>{progress().currentBotName}</Text>
        </Box>
      </Show>

      <Show when={error()}>
        <Box flex="0 0 auto" data-testid="sr-error" className="px-4 pt-2">
          <Text size="sm" c="error">{error()}</Text>
        </Box>
      </Show>

      <Box flex="0 0 auto" data-testid="sr-stats" className="border-b border-fin-border px-4 py-2">
        <StrategyRunnerStats trades={trades()} summary={summary()} isRunning={isRunning()} progress={progress()} />
      </Box>

      <Box style={{ flex: 1, "min-height": 0, "min-width": 0, overflow: "hidden", display: "flex", "flex-direction": "column" }} data-testid="sr-tabs">
        <StrategyRunnerTabs trades={trades()} summary={summary()} bots={bots()} />
      </Box>
    </Box>
  );
}
