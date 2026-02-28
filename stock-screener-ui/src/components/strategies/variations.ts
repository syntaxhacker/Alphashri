/**
 * Strategy Variations Panel Component
 */

import type { StrategyConfig, StrategyPerformance } from "../../types/strategies";
import {
  selectStrategy,
  loadStrategy,
  openEditModal,
  deleteStrategyAction,
} from "../../state/strategies";

export function renderVariationsPanel(
  template: StrategyConfig,
  variations: StrategyConfig[]
): string {
  return `
    <div class="variations-panel">
      <div class="variations-header">
        <h3>Variations of ${template.name}</h3>
        <button
          class="btn btn-primary btn-small"
          onclick="window.createVariation(${template.id}, '${template.name}', '${template.strategy_type}')"
        >
          + Add Variation
        </button>
      </div>

      <div class="variations-grid">
        ${variations.map((v) => renderVariationDetailCard(v)).join("")}
      </div>
    </div>
  `;
}

function renderVariationDetailCard(variation: StrategyConfig): string {
  return `
    <div class="variation-detail-card ${variation.is_default ? "default" : ""}" data-variation-id="${variation.id}">
      <div class="variation-detail-header">
        <h4>
          ${variation.is_default ? '<span class="default-badge">⭐ Default</span>' : ""}
          ${variation.name}
        </h4>
        <div class="variation-actions">
          <button
            class="btn btn-icon"
            onclick="window.editStrategy(${variation.id})"
            title="Edit"
          >
            ✏️
          </button>
          <button
            class="btn btn-icon btn-danger"
            onclick="window.confirmDeleteStrategy(${variation.id})"
            ${variation.is_default ? "disabled" : ""}
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>

      ${
        variation.description
          ? `<p class="variation-desc">${variation.description}</p>`
          : ""
      }

      <div class="variation-sections">
        <div class="variation-section">
          <h5>ORB Parameters</h5>
          <div class="param-grid">
            <div class="param-item">
              <span class="label">OR Minutes</span>
              <span class="value">${variation.or_minutes}</span>
            </div>
            <div class="param-item">
              <span class="label">Stop Loss</span>
              <span class="value">${variation.sl_pct}%</span>
            </div>
            <div class="param-item">
              <span class="label">Take Profit</span>
              <span class="value">${variation.tp_pct}%</span>
            </div>
            <div class="param-item">
              <span class="label">Min OR Range</span>
              <span class="value">${variation.min_or_range_pct}%</span>
            </div>
            <div class="param-item">
              <span class="label">Max OR Range</span>
              <span class="value">${variation.max_or_range_pct}%</span>
            </div>
          </div>
        </div>

        <div class="variation-section">
          <h5>Risk Management</h5>
          <div class="param-grid">
            <div class="param-item">
              <span class="label">Max Positions</span>
              <span class="value">${variation.max_positions}</span>
            </div>
            <div class="param-item">
              <span class="label">Capital/Trade</span>
              <span class="value">${variation.max_capital_per_trade_pct * 100}%</span>
            </div>
            <div class="param-item">
              <span class="label">Risk/Trade</span>
              <span class="value">${variation.risk_per_trade_pct * 100}%</span>
            </div>
            <div class="param-item">
              <span class="label">Daily Loss Limit</span>
              <span class="value">${variation.max_daily_loss_pct * 100}%</span>
            </div>
            <div class="param-item">
              <span class="label">Total Exposure</span>
              <span class="value">${variation.max_total_exposure_pct * 100}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderPerformancePanel(performance: StrategyPerformance): string {
  const winRateColor =
    performance.win_rate >= 60 ? "green" : performance.win_rate >= 40 ? "yellow" : "red";
  const pnlColor = performance.net_pnl >= 0 ? "green" : "red";

  return `
    <div class="performance-panel">
      <h4>Performance: ${performance.strategy_name}</h4>
      <div class="performance-stats">
        <div class="stat-item">
          <span class="stat-label">Total Trades</span>
          <span class="stat-value">${performance.total_trades}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Winners</span>
          <span class="stat-value text-green">${performance.winners}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Losers</span>
          <span class="stat-value text-red">${performance.losers}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Win Rate</span>
          <span class="stat-value text-${winRateColor}">${performance.win_rate.toFixed(1)}%</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Total P&L</span>
          <span class="stat-value">₹${performance.total_pnl.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Net P&L</span>
          <span class="stat-value text-${pnlColor}">₹${performance.net_pnl.toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;
}

export function initVariationsHandlers() {
  // Edit strategy
  (window as any).editStrategy = async (strategyId: number) => {
    try {
      const result = await import("../../api/strategies").then((m) => m.getStrategy(strategyId));
      openEditModal(result.strategy);
    } catch (error) {
      console.error("Failed to load strategy for editing:", error);
    }
  };

  // Delete strategy with confirmation
  (window as any).confirmDeleteStrategy = (strategyId: number) => {
    if (confirm("Are you sure you want to delete this strategy? This action cannot be undone.")) {
      deleteStrategyAction(strategyId);
    }
  };

  // Direct delete (for list view)
  (window as any).deleteStrategy = (strategyId: number) => {
    if (confirm("Are you sure you want to delete this strategy?")) {
      deleteStrategyAction(strategyId);
    }
  };
}
