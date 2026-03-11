/**
 * Live Positions Panel Component
 *
 * Supports multi-strategy view with tabs for each strategy.
 */

import {
  getPaperTradingState,
  setSelectedSymbol,
  getPaperTradingState as getState,
  setSelectedStrategyTab,
} from "../../state/paperTrading";
import { fetchPaperChart, closePaperPosition, refreshLiveData } from "../../api/paperTrading";

export function renderPositionsPanel(): string {
  const state = getPaperTradingState();

  if (state.isLoading && state.positions.length === 0) {
    return `
      <div class="positions-panel">
        <div class="loading-indicator">
          <p>Loading positions...</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="positions-panel" data-testid="positions-panel">
      ${renderPortfolioSummary(state.portfolio)}
      ${renderWatchlistScan(state.botSnapshot)}
      ${renderPositionsTable(state.positions, state.selectedSymbol, state.selectedStrategyTab)}
    </div>
  `;
}

function renderWatchlistScan(
  snapshot: ReturnType<typeof getPaperTradingState>["botSnapshot"],
): string {
  const state = getPaperTradingState();

  if (!snapshot || !snapshot.scan_items || snapshot.scan_items.length === 0) {
    return `
      <div class="scan-card">
        <div class="scan-header">
          <h3>Watchlist Scan</h3>
          <span class="scan-time">No scan data yet</span>
        </div>
      </div>
    `;
  }

  const scanTime = snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleTimeString() : "-";

  // Filter scan items by selected strategy tab (if any)
  let scanItems = snapshot.scan_items;
  if (state.selectedStrategyTab && state.selectedStrategyTab !== "all") {
    scanItems = scanItems.filter(
      (item) => (item as any).strategy_name === state.selectedStrategyTab,
    );
  }

  const rows = [...scanItems].sort((a, b) => nearBreakoutPct(a) - nearBreakoutPct(b)).slice(0, 12);

  return `
    <div class="scan-card" data-testid="watchlist-scan-card">
      <div class="scan-header">
        <h3>Watchlist Scan</h3>
        <span class="scan-time">${scanTime}</span>
      </div>
      <table class="scan-table" data-testid="scan-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Strategy</th>
            <th>Status</th>
            <th>Price</th>
            <th>OR H/L</th>
            <th>Near</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (item) => `
            <tr
              class="scan-row ${state.selectedSymbol === item.symbol ? "selected" : ""}"
              onclick="window.selectWatchlistSymbol('${item.symbol}')"
              data-symbol="${item.symbol}"
              data-testid="scan-row-${item.symbol}"
            >
              <td><strong>${item.symbol}</strong></td>
              <td class="strategy-cell"><span class="strategy-badge">${(item as any).strategy_name || "-"}</span></td>
              <td class="scan-status scan-${item.status}">${item.status}${item.side ? ` ${item.side}` : ""}</td>
              <td>${item.price ? `₹${item.price.toFixed(2)}` : "-"}</td>
              <td>${item.or_high && item.or_low ? `₹${item.or_high.toFixed(2)} / ₹${item.or_low.toFixed(2)}` : "-"}</td>
              <td>${formatNear(item)}</td>
              <td>${item.reason || "-"}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function nearBreakoutPct(
  item: NonNullable<ReturnType<typeof getPaperTradingState>["botSnapshot"]>["scan_items"][number],
): number {
  const price = item.price;
  const orHigh = item.or_high;
  const orLow = item.or_low;
  if (price == null || orHigh == null || orLow == null || orHigh <= 0 || orLow <= 0) return 9999;

  // If inside opening range, use nearest boundary distance.
  if (price <= orHigh && price >= orLow) {
    const toHigh = ((orHigh - price) / orHigh) * 100;
    const toLow = ((price - orLow) / orLow) * 100;
    return Math.max(0, Math.min(toHigh, toLow));
  }

  // If already outside range, distance from crossed boundary.
  if (price > orHigh) return ((price - orHigh) / orHigh) * 100;
  return ((orLow - price) / orLow) * 100;
}

function formatNear(
  item: NonNullable<ReturnType<typeof getPaperTradingState>["botSnapshot"]>["scan_items"][number],
): string {
  const v = nearBreakoutPct(item);
  if (!Number.isFinite(v) || v >= 9999) return "-";
  return `${v.toFixed(2)}%`;
}

function renderPortfolioSummary(
  portfolio: ReturnType<typeof getPaperTradingState>["portfolio"],
): string {
  if (!portfolio) {
    return `
      <div class="portfolio-card">
        <p class="loading-text">Loading portfolio...</p>
      </div>
    `;
  }

  const pnlClass = (portfolio.daily_pnl ?? 0) >= 0 ? "positive" : "negative";
  const pnlSign = (portfolio.daily_pnl ?? 0) >= 0 ? "+" : "";

  return `
    <div class="portfolio-card" data-testid="portfolio-card">
      <div class="portfolio-row">
        <div class="portfolio-item">
          <span class="portfolio-label">Capital</span>
          <span class="portfolio-value">₹${formatCurrency(portfolio.initial_capital ?? 0)}</span>
        </div>
        <div class="portfolio-item">
          <span class="portfolio-label">Cash</span>
          <span class="portfolio-value">₹${formatCurrency(portfolio.cash ?? 0)}</span>
        </div>
        <div class="portfolio-item">
          <span class="portfolio-label">Margin Used</span>
          <span class="portfolio-value">₹${formatCurrency(portfolio.margin_used ?? 0)}</span>
        </div>
      </div>
      <div class="portfolio-row portfolio-highlight">
        <div class="portfolio-item">
          <span class="portfolio-label">Total Value</span>
          <span class="portfolio-value">₹${formatCurrency(portfolio.total_value ?? 0)}</span>
        </div>
        <div class="portfolio-item">
          <span class="portfolio-label">Day P&L</span>
          <span class="portfolio-value ${pnlClass}">
            ${pnlSign}₹${formatCurrency(portfolio.daily_pnl ?? 0)}
            <span class="pnl-pct">(${pnlSign}${(portfolio.daily_pnl_pct ?? 0).toFixed(2)}%)</span>
          </span>
        </div>
        <div class="portfolio-item">
          <span class="portfolio-label">Positions</span>
          <span class="portfolio-value">${portfolio.positions ?? 0}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Group positions by strategy
 */
function groupPositionsByStrategy(
  positions: ReturnType<typeof getPaperTradingState>["positions"],
): Map<string, typeof positions> {
  const groups = new Map<string, typeof positions>();

  for (const pos of positions) {
    const key = pos.strategy_name || `Strategy ${pos.strategy_id || 0}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(pos);
  }

  return groups;
}

/**
 * Calculate strategy summary from positions
 */
function calcStrategySummary(
  positions: typeof getPaperTradingState extends { positions: infer P } ? P : never,
) {
  let totalPnl = 0;
  let marginUsed = 0;

  for (const pos of positions) {
    totalPnl += pos.pnl || 0;
    marginUsed += pos.margin_used || 0;
  }

  return { totalPnl, marginUsed, count: positions.length };
}

function renderPositionsTable(
  positions: ReturnType<typeof getPaperTradingState>["positions"],
  selectedSymbol: string | null,
  selectedStrategyTab: string | null,
): string {
  if (positions.length === 0) {
    return `
      <div class="positions-empty">
        <div class="empty-icon">📭</div>
        <p>No open positions</p>
        <p class="empty-hint">Positions will appear here when trades are placed</p>
      </div>
    `;
  }

  // Group positions by strategy
  const strategyGroups = groupPositionsByStrategy(positions);
  const strategies = Array.from(strategyGroups.keys());

  // If only one strategy or no strategy info, show simple view
  if (strategies.length <= 1) {
    return renderSimplePositionsTable(positions, selectedSymbol);
  }

  // Multi-strategy view with tabs
  const activeTab = selectedStrategyTab || "all";

  // Calculate totals for "All" tab
  const allSummary = calcStrategySummary(positions);

  // Filter positions for active tab
  const filteredPositions = activeTab === "all" ? positions : strategyGroups.get(activeTab) || [];

  return `
    <div class="positions-table-container multi-strategy">
      <div class="positions-header">
        <h3>Open Positions</h3>
        <span class="live-indicator">
          <span class="live-dot"></span>
          LIVE
        </span>
      </div>

      <!-- Strategy Tabs -->
      <div class="strategy-tabs" data-testid="strategy-tabs">
        <button
          class="strategy-tab ${activeTab === "all" ? "active" : ""}"
          onclick="window.selectStrategyTab('all')"
          data-testid="strategy-tab-all"
        >
          <span class="tab-name">All</span>
          <span class="tab-count">${positions.length}</span>
          <span class="tab-pnl ${allSummary.totalPnl >= 0 ? "positive" : "negative"}">
            ${allSummary.totalPnl >= 0 ? "+" : ""}₹${formatNum(allSummary.totalPnl)}
          </span>
        </button>
        ${strategies
          .map((strategy) => {
            const strategyPositions = strategyGroups.get(strategy) || [];
            const summary = calcStrategySummary(strategyPositions);
            const isActive = activeTab === strategy;

            return `
            <button
              class="strategy-tab ${isActive ? "active" : ""}"
              onclick="window.selectStrategyTab('${strategy}')"
              data-testid="strategy-tab-${strategy.replace(/\s+/g, "-").toLowerCase()}"
            >
              <span class="tab-name">${strategy}</span>
              <span class="tab-count">${summary.count}</span>
              <span class="tab-pnl ${summary.totalPnl >= 0 ? "positive" : "negative"}">
                ${summary.totalPnl >= 0 ? "+" : ""}₹${formatNum(summary.totalPnl)}
              </span>
            </button>
          `;
          })
          .join("")}
      </div>

      <!-- Positions Table -->
      ${renderPositionsTableBody(filteredPositions, selectedSymbol)}

      <!-- Strategy Summary Footer -->
      ${activeTab === "all" ? renderStrategySummaryFooter(strategyGroups) : ""}
    </div>
  `;
}

function renderSimplePositionsTable(
  positions: ReturnType<typeof getPaperTradingState>["positions"],
  selectedSymbol: string | null,
): string {
  return `
    <div class="positions-table-container">
      <div class="positions-header">
        <h3>Open Positions</h3>
        <span class="live-indicator">
          <span class="live-dot"></span>
          LIVE
        </span>
      </div>
      ${renderPositionsTableBody(positions, selectedSymbol)}
    </div>
  `;
}

function renderPositionsTableBody(
  positions: ReturnType<typeof getPaperTradingState>["positions"],
  selectedSymbol: string | null,
): string {
  return `
    <table class="positions-table" data-testid="positions-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Entry</th>
          <th>Current</th>
          <th>P&L</th>
          <th>SL</th>
          <th>TP</th>
          <th>Strategy</th>
          <th>Time</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${positions
          .map((pos) => {
            const isSelected = pos.symbol === selectedSymbol;
            const pnlClass = (pos.pnl ?? 0) >= 0 ? "positive" : "negative";
            const sideClass = pos.side === "BUY" ? "side-long" : "side-short";
            const sideIcon = pos.side === "BUY" ? "▲" : "▼";
            const duration = formatDuration(pos.entry_time);

            return `
            <tr class="position-row ${isSelected ? "selected" : ""}"
                onclick="window.selectPosition('${pos.symbol}')"
                data-symbol="${pos.symbol}"
                data-testid="position-row-${pos.symbol}">
              <td class="symbol-cell"><strong>${pos.symbol}</strong></td>
              <td class="${sideClass}">${sideIcon} ${pos.side}</td>
              <td>${pos.quantity}</td>
              <td>₹${(pos.entry_price ?? 0).toFixed(2)}</td>
              <td>₹${(pos.current_price ?? 1).toFixed(2)}</td>
              <td class="${pnlClass}">
                <strong>₹${formatNum(pos.pnl)}</strong>
                <span class="pnl-pct">(${(pos.pnl_pct ?? 1) >= 0 ? "+" : ""}${(pos.pnl_pct ?? 0).toFixed(2)}%)</span>
              </td>
              <td class="sl-cell">₹${(pos.stop_loss ?? 1).toFixed(2)}</td>
              <td class="tp-cell">₹${(pos.take_profit ?? 1).toFixed(2)}</td>
              <td class="strategy-cell">
                <span class="strategy-badge" title="${pos.strategy_name || "Default"}">
                  ${pos.strategy_name || "Default"}
                </span>
              </td>
              <td class="time-cell">${duration}</td>
              <td class="actions-cell">
                <div class="position-actions">
                  <button class="action-btn close-btn" data-testid="close-position-${pos.symbol}" onclick="event.stopPropagation(); window.closePosition('${pos.symbol}', ${pos.current_price})" title="Close Position">
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderStrategySummaryFooter(
  strategyGroups: Map<
    string,
    typeof getPaperTradingState extends { positions: infer P } ? P : never
  >,
): string {
  const summaries = Array.from(strategyGroups.entries()).map(([name, positions]) => ({
    name,
    ...calcStrategySummary(positions),
  }));

  return `
    <div class="strategy-summary-footer">
      <table class="strategy-summary-table">
        <thead>
          <tr>
            <th>Strategy</th>
            <th>Positions</th>
            <th>Margin</th>
            <th>Unrealized P&L</th>
          </tr>
        </thead>
        <tbody>
          ${summaries
            .map(
              (s) => `
            <tr>
              <td><strong>${s.name}</strong></td>
              <td>${s.count}</td>
              <td>₹${formatCurrency(s.marginUsed)}</td>
              <td class="${s.totalPnl >= 0 ? "positive" : "negative"}">
                ${s.totalPnl >= 0 ? "+" : ""}₹${formatNum(s.totalPnl)}
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatCurrency(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) {
    return "0";
  }
  return num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatNum(num: number | undefined | null): string {
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

function formatDuration(entryTime: string): string {
  if (!entryTime) return "-";
  try {
    const entry = new Date(entryTime);
    const now = new Date();
    const diffMs = now.getTime() - entry.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) {
      return `${diffMins}m`;
    }
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return `${hours}h ${mins}m`;
  } catch {
    return "-";
  }
}

export function initPositionsHandlers() {
  (window as any).selectPosition = async (symbol: string) => {
    setSelectedSymbol(symbol);
    const state = getState();
    await fetchPaperChart(symbol, undefined, state.chartTimeframe);
  };

  (window as any).selectWatchlistSymbol = async (symbol: string) => {
    setSelectedSymbol(symbol);
    const state = getState();
    await fetchPaperChart(symbol, undefined, state.chartTimeframe);
  };

  (window as any).closePosition = async (symbol: string, currentPrice: number) => {
    if (confirm(`Close position for ${symbol} at ₹${currentPrice.toFixed(2)}?`)) {
      try {
        await closePaperPosition(symbol, currentPrice, "MANUAL");
        await refreshLiveData();
      } catch (error) {
        console.error("Failed to close position:", error);
        alert("Failed to close position. Check console for details.");
      }
    }
  };

  (window as any).selectStrategyTab = (strategy: string) => {
    setSelectedStrategyTab(strategy);
    // Trigger re-render by dispatching a custom event
    window.dispatchEvent(new CustomEvent("paperTradingUpdate"));
  };
}
