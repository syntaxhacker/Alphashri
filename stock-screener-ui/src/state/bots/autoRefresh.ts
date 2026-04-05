import { loadBotStatus } from "./crudActions";

let autoRefreshIntervalValue: ReturnType<typeof setInterval> | null = null;

export function getAutoRefreshInterval(): ReturnType<typeof setInterval> | null {
  return autoRefreshIntervalValue;
}

export function startAutoRefresh(botId: string, intervalMs: number = 5000): void {
  stopAutoRefresh();
  autoRefreshIntervalValue = setInterval(() => {
    loadBotStatus(botId);
  }, intervalMs);
}

export function stopAutoRefresh(): void {
  if (autoRefreshIntervalValue !== null) {
    clearInterval(autoRefreshIntervalValue);
    autoRefreshIntervalValue = null;
  }
}
