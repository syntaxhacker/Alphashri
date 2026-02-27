/**
 * Paper Trading Settings Component
 *
 * Settings panel for configuring strategy parameters.
 */

import {
  getPaperTradingState,
  updateConfigValue as updateConfigValueState,
} from "../../state/paperTrading";
import {
  fetchStrategyConfig,
  updateStrategyConfig,
  resetStrategyConfig as resetConfigApi,
} from "../../api/paperTrading";
import type { StrategyConfig } from "../../types/paperTrading";

export function renderSettingsPanel(): string {
  const state = getPaperTradingState();
  const config = state.strategyConfig;

  if (state.configLoading && !config) {
    return `
      <div class="settings-panel" data-testid="settings-panel">
        <div class="settings-loading">
          <p>Loading configuration...</p>
        </div>
      </div>
    `;
  }

  if (state.configError && !config) {
    return `
      <div class="settings-panel" data-testid="settings-panel">
        <div class="settings-error">
          <p>❌ ${state.configError}</p>
          <button class="btn btn-secondary" onclick="window.reloadStrategyConfig()">Retry</button>
        </div>
      </div>
    `;
  }

  if (!config) {
    return `
      <div class="settings-panel" data-testid="settings-panel">
        <div class="settings-empty">
          <p>No configuration loaded.</p>
          <button class="btn btn-primary" onclick="window.reloadStrategyConfig()">Load Config</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="settings-panel" data-testid="settings-panel">
      ${state.configError ? `<div class="settings-error-bar">❌ ${state.configError}</div>` : ""}

      <div class="settings-header">
        <h3>Strategy Configuration</h3>
        <span class="config-name">${config.name} (${config.strategy_type})</span>
      </div>

      <div class="settings-sections">
        ${renderORBSection(config)}
        ${renderRiskSection(config)}
        ${renderRunnerSection(config)}
        ${renderCostsSection(config)}
      </div>

      <div class="settings-actions">
        <button
          class="btn btn-secondary"
          onclick="window.resetStrategyConfig()"
          ${state.configLoading ? "disabled" : ""}
        >
          Reset to Defaults
        </button>
        <button
          class="btn btn-primary"
          onclick="window.saveStrategyConfig()"
          ${state.configLoading || !state.configDirty ? "disabled" : ""}
        >
          ${state.configLoading ? "Saving..." : state.configDirty ? "Save Changes" : "Saved"}
        </button>
      </div>
    </div>
  `;
}

function renderORBSection(config: StrategyConfig): string {
  return `
    <div class="settings-section">
      <div class="settings-section-header">
        <span class="settings-section-icon">📊</span>
        <h4>ORB Strategy</h4>
      </div>
      <div class="settings-row">
        <div class="settings-field">
          <label>Stop Loss %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-sl-pct"
            value="${config.sl_pct}"
            min="0.1"
            max="5"
            step="0.1"
            onchange="window.updateConfigValue('sl_pct', parseFloat(this.value))"
          />
        </div>
        <div class="settings-field">
          <label>Take Profit %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-tp-pct"
            value="${config.tp_pct}"
            min="0.1"
            max="10"
            step="0.1"
            onchange="window.updateConfigValue('tp_pct', parseFloat(this.value))"
          />
        </div>
        <div class="settings-field">
          <label>OR Minutes</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-or-minutes"
            value="${config.or_minutes}"
            min="15"
            max="120"
            step="15"
            onchange="window.updateConfigValue('or_minutes', parseInt(this.value))"
          />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-field">
          <label>Min OR Range %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-min-or-range"
            value="${config.min_or_range_pct}"
            min="0.1"
            max="5"
            step="0.1"
            onchange="window.updateConfigValue('min_or_range_pct', parseFloat(this.value))"
          />
        </div>
        <div class="settings-field">
          <label>Max OR Range %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-max-or-range"
            value="${config.max_or_range_pct}"
            min="1"
            max="10"
            step="0.5"
            onchange="window.updateConfigValue('max_or_range_pct', parseFloat(this.value))"
          />
        </div>
      </div>
    </div>
  `;
}

function renderRiskSection(config: StrategyConfig): string {
  return `
    <div class="settings-section">
      <div class="settings-section-header">
        <span class="settings-section-icon">🛡️</span>
        <h4>Risk Management</h4>
      </div>
      <div class="settings-row">
        <div class="settings-field">
          <label>Max Positions</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-max-positions"
            value="${config.max_positions}"
            min="1"
            max="10"
            step="1"
            onchange="window.updateConfigValue('max_positions', parseInt(this.value))"
          />
        </div>
        <div class="settings-field">
          <label>Capital/Trade %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-capital-per-trade"
            value="${(config.max_capital_per_trade_pct * 100).toFixed(0)}"
            min="5"
            max="25"
            step="1"
            onchange="window.updateConfigValue('max_capital_per_trade_pct', parseFloat(this.value) / 100)"
          />
        </div>
        <div class="settings-field">
          <label>Daily Loss %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-daily-loss"
            value="${(config.max_daily_loss_pct * 100).toFixed(0)}"
            min="1"
            max="10"
            step="1"
            onchange="window.updateConfigValue('max_daily_loss_pct', parseFloat(this.value) / 100)"
          />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-field">
          <label>Max Exposure %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-max-exposure"
            value="${(config.max_total_exposure_pct * 100).toFixed(0)}"
            min="20"
            max="100"
            step="5"
            onchange="window.updateConfigValue('max_total_exposure_pct', parseFloat(this.value) / 100)"
          />
        </div>
        <div class="settings-field">
          <label>Risk/Trade %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-risk-per-trade"
            value="${(config.risk_per_trade_pct * 100).toFixed(1)}"
            min="0.5"
            max="5"
            step="0.5"
            onchange="window.updateConfigValue('risk_per_trade_pct', parseFloat(this.value) / 100)"
          />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-field">
          <label>Min Trade Value ₹</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-min-trade"
            value="${config.min_trade_value}"
            min="1000"
            max="50000"
            step="1000"
            onchange="window.updateConfigValue('min_trade_value', parseFloat(this.value))"
          />
        </div>
        <div class="settings-field">
          <label>Max Trade Value ₹</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-max-trade"
            value="${config.max_trade_value}"
            min="10000"
            max="500000"
            step="10000"
            onchange="window.updateConfigValue('max_trade_value', parseFloat(this.value))"
          />
        </div>
      </div>
    </div>
  `;
}

function renderRunnerSection(config: StrategyConfig): string {
  return `
    <div class="settings-section">
      <div class="settings-section-header">
        <span class="settings-section-icon">⚙️</span>
        <h4>Runner Settings</h4>
      </div>
      <div class="settings-row">
        <div class="settings-field">
          <label>Cooldown (min)</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-cooldown"
            value="${config.cooldown_minutes}"
            min="0"
            max="120"
            step="5"
            onchange="window.updateConfigValue('cooldown_minutes', parseInt(this.value))"
          />
        </div>
        <div class="settings-field">
          <label>Max Distance from OR %</label>
          <input
            type="number"
            class="settings-input"
            data-testid="config-max-distance"
            value="${config.max_distance_from_or_pct}"
            min="0.5"
            max="5"
            step="0.25"
            onchange="window.updateConfigValue('max_distance_from_or_pct', parseFloat(this.value))"
          />
        </div>
      </div>
    </div>
  `;
}

function renderCostsSection(config: StrategyConfig): string {
  return `
    <div class="settings-section settings-section-collapsible">
      <div class="settings-section-header" onclick="window.toggleCostsSection()">
        <span class="settings-section-icon">💰</span>
        <h4>Trading Costs</h4>
        <span class="settings-collapse-icon" id="costs-collapse-icon">▼</span>
      </div>
      <div class="settings-section-content" id="costs-section-content" style="display: none;">
        <div class="settings-row">
          <div class="settings-field">
            <label>Brokerage %</label>
            <input
              type="number"
              class="settings-input"
              value="${config.brokerage_pct * 100}"
              min="0"
              max="1"
              step="0.01"
              onchange="window.updateConfigValue('brokerage_pct', parseFloat(this.value) / 100)"
            />
          </div>
          <div class="settings-field">
            <label>Min Brokerage ₹</label>
            <input
              type="number"
              class="settings-input"
              value="${config.min_brokerage}"
              min="0"
              max="100"
              step="1"
              onchange="window.updateConfigValue('min_brokerage', parseFloat(this.value))"
            />
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-field">
            <label>STT %</label>
            <input
              type="number"
              class="settings-input"
              value="${config.stt_pct * 100}"
              min="0"
              max="0.1"
              step="0.001"
              onchange="window.updateConfigValue('stt_pct', parseFloat(this.value) / 100)"
            />
          </div>
          <div class="settings-field">
            <label>Exchange %</label>
            <input
              type="number"
              class="settings-input"
              value="${config.exchange_pct * 100}"
              min="0"
              max="0.01"
              step="0.0001"
              onchange="window.updateConfigValue('exchange_pct', parseFloat(this.value) / 100)"
            />
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-field">
            <label>GST %</label>
            <input
              type="number"
              class="settings-input"
              value="${config.gst_pct * 100}"
              min="0"
              max="30"
              step="1"
              onchange="window.updateConfigValue('gst_pct', parseFloat(this.value) / 100)"
            />
          </div>
          <div class="settings-field">
            <label>Stamp %</label>
            <input
              type="number"
              class="settings-input"
              value="${config.stamp_pct * 100}"
              min="0"
              max="0.01"
              step="0.0001"
              onchange="window.updateConfigValue('stamp_pct', parseFloat(this.value) / 100)"
            />
          </div>
        </div>
      </div>
    </div>
  `;
}

// Initialize settings handlers
export function initSettingsHandlers() {
  (window as any).updateConfigValue = (key: string, value: any) => {
    updateConfigValueState(key, value);
  };

  (window as any).saveStrategyConfig = async () => {
    const state = getPaperTradingState();
    if (state.strategyConfig) {
      await updateStrategyConfig(state.strategyConfig);
    }
  };

  (window as any).resetStrategyConfig = async () => {
    if (confirm("Reset all settings to default values?")) {
      await resetConfigApi();
    }
  };

  (window as any).reloadStrategyConfig = async () => {
    await fetchStrategyConfig();
  };

  (window as any).toggleCostsSection = () => {
    const content = document.getElementById("costs-section-content");
    const icon = document.getElementById("costs-collapse-icon");
    if (content && icon) {
      if (content.style.display === "none") {
        content.style.display = "block";
        icon.textContent = "▲";
      } else {
        content.style.display = "none";
        icon.textContent = "▼";
      }
    }
  };
}
