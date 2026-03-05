/**
 * Trade History Panel Component
 */

import {
  getPaperTradingState,
  setSelectedSymbol,
  setFilterStrategy,
  setFilterBot,
  deleteTradeAction
} from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import type { PaperTrade } from "../../types/paperTrading";

export function renderHistoryPanel(): string {
  const state = getPaperTradingState();

  if (state.isLoading && state.trades.length === 0) {
    return `
      <div class="history-panel" data-testid="history-panel">
        <div class="loading-indicator">
          <p>Loading trade history...</p>
        </div>
      </div>
    `;
  }

  // Filter trades
  let filteredTrades = [...state.trades];
  if (state.filterSymbol) {
    filteredTrades = filteredTrades.filter((t) => t.symbol === state.filterSymbol);
  }
  if (state.filterFromDate || state.filterToDate) {
    filteredTrades = filterByRange(filteredTrades, state.filterFromDate, state.filterToDate);
  }
  if (state.filterStrategy) {
    filteredTrades = filteredTrades.filter((t) => t.strategy_name === state.filterStrategy);
  }
  if (state.filterBot) {
    filteredTrades = filteredTrades.filter((t) => t.bot_id === state.filterBot);
  }

  // Get unique strategies and filter dropdown
  const strategies = getUniqueStrategies(state.trades);
  // Get unique bots for filter dropdown
  const bots = getUniqueBots(state.trades);

  return `
    <div class="history-panel" data-testid="history-panel">
      ${renderBotFilter(bots, state.filterBot)}
      ${renderStrategyFilter(strategies, state.filterStrategy)}
      ${renderTradesTable(filteredTrades, state.selectedSymbol)}
    </div>
  `;
}

function getUniqueStrategies(trades: PaperTrade[]): string[] {
  const strategies = new Set<string>();
  for (const trade of trades) {
    if (trade.strategy_name) {
      strategies.add(trade.strategy_name);
    }
  }
  return Array.from(strategies).sort();
}

function getUniqueBots(trades: PaperTrade[]): Array<{ id: number; name: string }> {
  const botsMap = new Map<number, string>();
  for (const trade of trades) {
    if (trade.bot_id && trade.bot_name) {
      botsMap.set(trade.bot_id, trade.bot_name);
    }
  }
  return Array.from(botsMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderStrategyFilter(strategies: string[], currentFilter: string | null): string {
  // Always show filter bar if there's an active filter, even with only one strategy
  if (strategies.length <= 1 && !currentFilter) {
    return "";
  }

  return `
    <div class="strategy-filter-bar" data-testid="strategy-filter-bar">
      <label>Strategy:</label>
      <select onchange="window.filterByStrategy(this.value)" class="strategy-filter-select" data-testid="strategy-filter-select">
        <option value="">All Strategies</option>
        ${strategies
          .map(
            (s) => `
          <option value="${s}" ${currentFilter === s ? "selected" : ""}>${s}</option>
        `,
          )
          .join("")}
      </select>
      ${
        currentFilter
          ? `
        <span class="filter-active-indicator">Showing: ${currentFilter}</span>
        <button class="btn btn-small btn-secondary" onclick="window.clearStrategyFilter()">Clear</button>
      `
          : ""
      }
    </div>
  `;
}

function renderBotFilter(bots: Array<{ id: number; name: string }>, currentFilter: number | null): string {
  // Always show filter bar if there's an active filter, even with only one bot
  if (bots.length <= 1 && !currentFilter) {
    return "";
  }

  return `
    <div class="bot-filter-bar" data-testid="bot-filter-bar">
      <label>Bot:</label>
      <select onchange="window.filterByBot(this.value)" class="bot-filter-select" data-testid="bot-filter-select">
        <option value="">All Bots</option>
        ${bots
          .map(
            (b) => `
          <option value="${b.id}" ${currentFilter === b.id ? "selected" : ""}>${b.name}</option>
        `,
          )
          .join("")}
      </select>
      ${
        currentFilter
          ? `
        <span class="filter-active-indicator">Showing: ${bots.find(bot => bot.id === currentFilter)?.name || ""}</span>
        <button class="btn btn-small btn-secondary" onclick="window.clearBotFilter()">Clear</button>
      `
          : ""
      }
    </div>
  `;
}

function filterByRange(
  trades: PaperTrade[],
  fromDate: string | null,
  toDate: string | null,
): PaperTrade[] {
  const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
  const to = toDate ? new Date(`${toDate}T23:59:59`) : null;

  return trades.filter((t) => {
    const tradeDate = new Date(t.exit_time);
    if (from && tradeDate < from) return false;
    if (to && tradeDate > to) return false;
    return true;
  });
}

function renderTradesTable(trades: PaperTrade[], selectedSymbol: string | null): string {
  if (trades.length === 0) {
    return `
      <div class="trades-empty">
        <div class="empty-icon">📊</div>
        <p>No trades found</p>
        <p class="empty-hint">Completed trades will appear here</p>
      </div>
    `;
  }

  // Group trades by date
  const tradesByDate = groupTradesByDate(trades);

  // Calculate overall totals
  const totalPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0);
  const totalWins = trades.filter((t) => t.net_pnl > 0).length;
  const totalLosses = trades.filter((t) => t.net_pnl < 0).length;

  return `
    <div class="trades-table-container" data-testid="trades-table-container">
      <div class="trades-header" data-testid="trades-header">
        <h3>Trade History (${trades.length} trades)</h3>
        <div class="trades-summary">
          <span>Total: <strong class="${totalPnl >= 0 ? "positive" : "negative"}">₹${formatNumber(totalPnl)}</strong></span>
          <span class="win-loss">
            <span class="wins">▲${totalWins}</span>
            <span class="losses">▼${totalLosses}</span>
          </span>
        </div>
      </div>
      <div class="trades-by-date">
        ${Object.entries(tradesByDate)
          .sort(([a], [b]) => b.localeCompare(a)) // Most recent first
          .map(([date, dayTrades]) => renderDayGroup(date, dayTrades, selectedSymbol))
          .join("")}
      </div>
    </div>
  `;
}

function groupTradesByDate(trades: PaperTrade[]): Record<string, PaperTrade[]> {
  const groups: Record<string, PaperTrade[]> = {};

  for (const trade of trades) {
    const date = trade.exit_time.split("T")[0];
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(trade);
  }

  // Sort each day's trades by exit time (most recent first)
  for (const date of Object.keys(groups)) {
    groups[date].sort((a, b) => b.exit_time.localeCompare(a.exit_time));
  }

  return groups;
}

function renderDayGroup(date: string, trades: PaperTrade[], selectedSymbol: string | null): string {
  const dayPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0);
  const wins = trades.filter((t) => t.net_pnl > 0).length;
  const losses = trades.filter((t) => t.net_pnl < 0).length;
  const pnlClass = dayPnl >= 0 ? "positive" : "negative";
  const pnlSign = dayPnl >= 0 ? "+" : "";

  // Format date nicely
  const dateObj = new Date(date);
  const formattedDate = dateObj.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  return `
    <div class="day-group" data-date="${date}" data-testid="day-group-${date}">
      <div class="day-header ${pnlClass}" data-testid="day-header-${date}">
        <div class="day-left">
          <span class="day-icon">📅</span>
          <span class="day-date">${formattedDate}</span>
        </div>
        <div class="day-right">
          <span class="day-pnl">₹${pnlSign}${formatNumber(Math.abs(dayPnl))}</span>
          <span class="day-win-loss">
            <span class="wins">▲${wins}</span>
            <span class="losses">▼${losses}</span>
          </span>
        </div>
      </div>
      <table class="trades-table" data-testid="trades-table-${date}">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>P&L</th>
            <th>Bot</th>
            <th>Strategy</th>
            <th>Type</th>
            <th>Time</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${trades
            .map((trade) => {
              const isSelected = trade.symbol === selectedSymbol;
              const tradePnlClass = trade.net_pnl >= 0 ? "positive" : "negative";
              const sideClass = trade.side === "BUY" ? "side-long" : "side-short";
              const sideIcon = trade.side === "BUY" ? "▲" : "▼";
              const time = formatTradeTimeOnly(trade.exit_time);
              const tooltipContent = generateTradeTooltip(trade);

              return `
              <tr class="trade-row ${isSelected ? "selected" : ""} ${trade.net_pnl >= 0 ? "trade-win" : "trade-loss"}"
                  onclick="window.selectTrade('${trade.symbol}', '${trade.exit_time}')"
                  onmouseenter="window.showTradeTooltip(event, '${trade.trade_id}')"
                  onmouseleave="window.hideTradeTooltip()"
                  data-symbol="${trade.symbol}"
                  data-trade-id="${trade.trade_id}"
                  data-testid="trade-row-${trade.trade_id}"
                  data-tooltip='${tooltipContent}'>
                <td class="symbol-cell"><strong>${trade.symbol}</strong></td>
                <td class="${sideClass}">${sideIcon}</td>
                <td>${trade.quantity}</td>
                <td>₹${trade.entry_price.toFixed(2)}</td>
                <td>₹${trade.exit_price.toFixed(2)}</td>
                <td class="${tradePnlClass}">
                  <strong>₹${formatNumber(trade.net_pnl)}</strong>
                </td>
                <td class="bot-cell" onclick="event.stopPropagation(); window.viewBotHistory(${trade.bot_id || 0})" title="Click to view trades for this bot">
                  ${trade.bot_name || "-"}
                </td>
                <td class="strategy-cell" onclick="event.stopPropagation(); window.viewStrategyHistory('${trade.strategy_name || "default"}')" title="Click to view trades for this strategy">
                  ${trade.strategy_name || "default"}
                </td>
                <td class="exit-${trade.exit_reason.toLowerCase()}">${trade.exit_reason}</td>
                <td class="time-cell">${time}</td>
                <td class="actions-cell">
                  <button
                    class="btn btn-small btn-danger"
                    onclick="event.stopPropagation(); window.deleteTrade('${trade.trade_id}')"
                    title="Delete Trade"
                    data-testid="delete-trade-btn-${trade.trade_id}"
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) {
    return "0";
  }
  if (Math.abs(num) >= 100000) {
    return (num / 100000).toFixed(1) + "L";
  }
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toFixed(0);
}

function formatTradeTime(isoStr: string): string {
  if (!isoStr) return "-";
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;

  // Human-readable: 24 Feb 2026, 10:38:36
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", "");
}

function formatTradeTimeOnly(isoStr: string): string {
  if (!isoStr) return "-";
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;

  // Just time: 10:38
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function generateTradeTooltip(trade: PaperTrade): string {
  const peakPrice = trade.peak_price || trade.exit_price;
  const lowPrice = trade.low_price || trade.entry_price;

  // Calculate excursions
  const mfe = peakPrice - trade.entry_price; // Max Favorable Excursion
  const mae = lowPrice - trade.entry_price; // Max Adverse Excursion
  const mfePct = (mfe / trade.entry_price) * 100;
  const maePct = (mae / trade.entry_price) * 100;

  // Calculate hold duration
  const entryTime = new Date(trade.entry_time);
  const exitTime = new Date(trade.exit_time);
  const holdMinutes = Math.round((exitTime.getTime() - entryTime.getTime()) / 60000);
  const holdStr =
    holdMinutes >= 60 ? `${Math.floor(holdMinutes / 60)}h ${holdMinutes % 60}m` : `${holdMinutes}m`;

  const tooltipData = {
    tradeId: trade.trade_id,
    symbol: trade.symbol,
    side: trade.side,
    qty: trade.quantity,
    entry: trade.entry_price.toFixed(2),
    exit: trade.exit_price.toFixed(2),
    peak: peakPrice.toFixed(2),
    low: lowPrice.toFixed(2),
    mfe: mfe.toFixed(2),
    mfePct: mfePct.toFixed(2),
    mae: mae.toFixed(2),
    maePct: maePct.toFixed(2),
    grossPnl: trade.pnl.toFixed(2),
    costs: trade.costs.toFixed(2),
    netPnl: trade.net_pnl.toFixed(2),
    pnlPct: trade.pnl_pct.toFixed(2),
    exitReason: trade.exit_reason,
    slPrice: trade.sl_price.toFixed(2),
    tpPrice: trade.tp_price.toFixed(2),
    holdTime: holdStr,
    entryTime: formatTradeTime(trade.entry_time),
    exitTime: formatTradeTime(trade.exit_time),
    strategyId: trade.strategy_id || 0,
    strategyName: trade.strategy_name || "default",
  };

  return JSON.stringify(tooltipData).replace(/'/g, "&#39;");
}

export function initHistoryHandlers() {
  (window as any).selectTrade = async (symbol: string, exitTime: string) => {
    setSelectedSymbol(symbol);
    // Extract date from exit time for chart
    const date = exitTime.split("T")[0];
    const state = getPaperTradingState();
    await fetchPaperChart(symbol, date, state.chartTimeframe);
  };

  // Strategy filter handlers
  (window as any).filterByStrategy = (strategy: string) => {
    setFilterStrategy(strategy || null);
  };

  (window as any).clearStrategyFilter = () => {
    setFilterStrategy(null);
  };

  // Navigate to strategy detail view (Strategies > Performance with strategy selected)
  (window as any).viewStrategyHistory = (strategyName: string) => {
    console.log("viewStrategyHistory called with:", strategyName);

    // Navigate to strategies view and select this strategy
    // We pass the strategy name via localStorage so the strategies view can find and select it
    localStorage.setItem("selectStrategyByName", strategyName);
    if ((window as any).navigateToRoute) {
      (window as any).navigateToRoute("strategies");
    }
  };

  // Check for strategy filter from navigation (from strategies view)
  const savedFilter = localStorage.getItem("filterStrategy");
  if (savedFilter) {
    setFilterStrategy(savedFilter);
    localStorage.removeItem("filterStrategy");
  }

  // Tooltip handlers
  let tooltipEl: HTMLDivElement | null = null;

  (window as any).showTradeTooltip = (event: MouseEvent, tradeId: string) => {
    const row = (event.target as HTMLElement).closest("tr");
    if (!row) return;

    const tooltipDataStr = row.getAttribute("data-tooltip");
    if (!tooltipDataStr) return;

    try {
      const data = JSON.parse(tooltipDataStr);

      // Create tooltip element if it doesn't exist
      if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.className = "trade-tooltip";
        tooltipEl.id = "trade-tooltip";
        document.body.appendChild(tooltipEl);
      }

      // Build tooltip content
      const pnlColor = parseFloat(data.netPnl) >= 0 ? "#10b981" : "#ef4444";
      const mfeColor = parseFloat(data.mfe) >= 0 ? "#10b981" : "#ef4444";
      const maeColor = parseFloat(data.mae) >= 0 ? "#10b981" : "#ef4444";

      tooltipEl.innerHTML = `
        <div class="tooltip-header">
          <strong>${data.symbol}</strong> <span class="tooltip-side">${data.side}</span>
          <span class="tooltip-trade-id">${data.tradeId}</span>
        </div>

        <div class="tooltip-section">
          <div class="tooltip-row">
            <span class="tooltip-label">Strategy:</span>
            <span class="tooltip-value strategy-link" onclick="window.viewStrategyHistory('${data.strategyName}')" title="Click to view trades for this strategy">
              ${data.strategyName} →
            </span>
          </div>
        </div>

        <div class="tooltip-section">
          <div class="tooltip-row">
            <span class="tooltip-label">Quantity:</span>
            <span class="tooltip-value">${data.qty}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Hold Time:</span>
            <span class="tooltip-value">${data.holdTime}</span>
          </div>
        </div>

        <div class="tooltip-section">
          <div class="tooltip-section-title">Prices</div>
          <div class="tooltip-row">
            <span class="tooltip-label">Entry:</span>
            <span class="tooltip-value">₹${data.entry}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Exit:</span>
            <span class="tooltip-value">₹${data.exit}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Peak:</span>
            <span class="tooltip-value">₹${data.peak} ⬆️</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Low:</span>
            <span class="tooltip-value">₹${data.low} ⬇️</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">SL / TP:</span>
            <span class="tooltip-value">₹${data.slPrice} / ₹${data.tpPrice}</span>
          </div>
        </div>

        <div class="tooltip-section">
          <div class="tooltip-section-title">Price Movement</div>
          <div class="tooltip-row">
            <span class="tooltip-label">Best Price Reached:</span>
            <span class="tooltip-value" style="color: ${mfeColor}">₹${data.mfe} (${data.mfePct}%)</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Worst Price Reached:</span>
            <span class="tooltip-value" style="color: ${maeColor}">₹${data.mae} (${data.maePct}%)</span>
          </div>
        </div>

        <div class="tooltip-section">
          <div class="tooltip-section-title">P&L</div>
          <div class="tooltip-row">
            <span class="tooltip-label">Gross P&L:</span>
            <span class="tooltip-value">₹${data.grossPnl}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Costs:</span>
            <span class="tooltip-value">₹${data.costs}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-label">Net P&L:</span>
            <span class="tooltip-value" style="color: ${pnlColor}; font-weight: bold;">₹${data.netPnl} (${data.pnlPct}%)</span>
          </div>
        </div>

        <div class="tooltip-section">
          <div class="tooltip-row">
            <span class="tooltip-label">Exit Reason:</span>
            <span class="tooltip-value tooltip-exit-${data.exitReason.toLowerCase()}">${data.exitReason}</span>
          </div>
          <div class="tooltip-row tooltip-times">
            <span class="tooltip-label">Entry:</span>
            <span class="tooltip-value">${data.entryTime}</span>
          </div>
          <div class="tooltip-row tooltip-times">
            <span class="tooltip-label">Exit:</span>
            <span class="tooltip-value">${data.exitTime}</span>
          </div>
        </div>
      `;

      // Position tooltip
      const rect = row.getBoundingClientRect();

      // Make tooltip visible but off-screen to measure its dimensions
      tooltipEl.style.left = "-9999px";
      tooltipEl.style.top = "-9999px";
      tooltipEl.style.display = "block";

      // Now get the actual tooltip dimensions
      const tooltipRect = tooltipEl.getBoundingClientRect();

      let left = rect.right + 10;
      let top = rect.top;

      // Adjust if tooltip goes off right edge
      if (left + tooltipRect.width > window.innerWidth - 10) {
        left = rect.left - tooltipRect.width - 10;
      }

      // Adjust if tooltip goes off left edge
      if (left < 10) {
        left = 10;
      }

      // Adjust if tooltip goes off bottom edge
      if (top + tooltipRect.height > window.innerHeight - 10) {
        top = window.innerHeight - tooltipRect.height - 10;
      }

      // Adjust if tooltip goes off top edge
      if (top < 10) {
        top = 10;
      }

      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${top}px`;
    } catch (e) {
      console.error("Error showing tooltip:", e);
    }
  };

  (window as any).hideTradeTooltip = () => {
    if (tooltipEl) {
      tooltipEl.style.display = "none";
    }
  };
}
