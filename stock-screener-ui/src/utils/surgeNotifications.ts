import { notifications } from "@mantine/notifications";
import type { ScreenerData } from "../types";
import { recordSurge } from "../api/notifications";

const SURGE_COOLDOWN_MS = 5 * 60 * 1000;
const notifiedSymbols = new Map<string, number>();

function isMarketHours(): boolean {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  // Indian market hours: 9:15 AM - 3:30 PM IST (convert from local browser time — 
  // for simplicity, check a generous window. The backend is the source of truth.)
  // Monday-Friday only
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  // Approximate market window in any timezone: 3:45 AM UTC = 9:15 AM IST, 
  // 10:00 AM UTC = 3:30 PM IST. Use a loose UTC check.
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const totalUtcMinutes = utcH * 60 + utcM;
  return totalUtcMinutes >= 225 && totalUtcMinutes <= 600; // 3:45 UTC (9:15 IST) to 10:00 UTC (15:30 IST)
}

type SurgeConfig = { field: string; label: string; threshold: number };

const SURGE_CONFIG: Record<string, SurgeConfig> = {
  intraday_5m: { field: "move_5m", label: "5-Min Move", threshold: 3 },
  intraday_10m: { field: "move_10m", label: "10-Min Move", threshold: 3 },
  intraday_15m: { field: "move_15m", label: "15-Min Move", threshold: 3 },
};

const DEFAULT_CONFIG: SurgeConfig = {
  field: "day_change",
  label: "Day Change",
  threshold: 5,
};

// Global click listener to navigate to chart on surge notification click
if (typeof document !== "undefined" && !document.querySelector("[data-surge-init]")) {
  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest("[data-surge-symbol]");
    if (el) {
      const symbol = el.getAttribute("data-surge-symbol");
      if (symbol) {
        window.location.href = `/chart/${symbol}`;
      }
    }
  });
  // Add cursor style for surge notifications
  const style = document.createElement("style");
  style.textContent = "[data-surge-symbol]:not(:has([data-close-button]:hover)) { cursor: pointer; }";
  style.setAttribute("data-surge-init", "");
  document.head.appendChild(style);
}

function isSurge(value: number | undefined, threshold: number): boolean {
  return value != null && Math.abs(value) >= threshold;
}

export function checkPriceSurges(
  data: ScreenerData,
  screenerId: string,
  screenLabel: string,
): void {
  if (!isMarketHours()) return;
  const config = SURGE_CONFIG[screenerId] ?? DEFAULT_CONFIG;
  const { field, label: moveLabel, threshold } = config;

  const allStocks = [
    ...(data.approaching || []),
    ...(data.touched || []),
  ];

  const now = Date.now();

  for (const stock of allStocks) {
    const moveValue = stock[field];
    if (!isSurge(moveValue, threshold)) continue;

    if (notifiedSymbols.has(stock.symbol)) {
      const lastNotified = notifiedSymbols.get(stock.symbol)!;
      if (now - lastNotified < SURGE_COOLDOWN_MS) continue;
    }

    notifiedSymbols.set(stock.symbol, now);

    const signed = moveValue > 0
      ? `+${moveValue.toFixed(1)}%`
      : `${moveValue.toFixed(1)}%`;
    const dir = moveValue > 0 ? "\u{1F680}" : "\u{1F4C9}";
    const priceStr = stock.upstox_price != null ? ` | \u20B9${stock.upstox_price}` : "";

    notifications.show({
      title: `${dir} ${stock.symbol} ${signed}`,
      message: `${screenLabel} | ${moveLabel}${priceStr}`,
      color: moveValue > 0 ? "green" : "red",
      autoClose: 8000,
      withCloseButton: true,
      style: { cursor: "pointer" },
      "data-surge-symbol": stock.symbol,
    } as any);

    recordSurge({
      symbol: stock.symbol,
      move_pct: moveValue,
      direction: moveValue > 0 ? "up" : "down",
      price: stock.upstox_price,
      screener_id: screenerId,
      screen_label: screenLabel,
    }).catch(() => {});
  }
}

export function clearSurgeCache(): void {
  notifiedSymbols.clear();
}
