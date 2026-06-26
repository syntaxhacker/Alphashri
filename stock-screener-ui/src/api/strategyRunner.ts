import type { StrategyRunnerConfig, StrategyRunnerSummary } from "../types/strategyRunner";

const API_BASE = "";

export async function runStrategyRunner(
  config: StrategyRunnerConfig,
): Promise<{ summary: StrategyRunnerSummary; trades: any[] }> {
  const response = await fetch(`${API_BASE}/api/strategy-runner/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    throw new Error(`Strategy runner failed: ${response.status}`);
  }

  return response.json();
}
