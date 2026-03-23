/**
 * Bot Configuration Form Component
 *
 * Form for creating and editing multi-strategy bot configurations.
 */

import type {
  BotConfig,
  AvailableStrategy,
  StrategyAllocation,
  StrategyWithAllocation,
} from "../../types/bots";
import {
  createBotAction,
  updateBotAction,
  closeCreateModal,
  closeEditModal,
  getBotsState,
} from "../../state/bots";

export function calculateTotalAllocation(strategies: StrategyAllocation[]): number {
  return strategies.reduce((sum, s) => sum + s.capital_allocation_pct * 100, 0);
}

export function isAllocationOverLimit(total: number): boolean {
  return total > 100;
}

export function formatAllocationPct(decimal: number): number {
  return decimal * 100;
}

export function parseAllocationInput(percentage: number): number {
  return percentage / 100;
}

export function formatMaxCapitalPct(decimal: number): number {
  return decimal * 100;
}

export function parseMaxCapitalInput(percentage: number): number {
  return percentage / 100;
}

export function renderBotConfigForm(
  bot: BotConfig | null,
  availableStrategies: AvailableStrategy[],
): string {
  const isEdit = bot !== null;
  const state = getBotsState();

  // Filter out templates for selection
  const selectableStrategies = availableStrategies.filter((s) => !s.is_template);

  return `
    <div class="modal-overlay" data-testid="bot-config-modal">
      <div class="modal bot-config-modal" data-testid="bot-config">
        <div class="modal-header">
          <h3>${isEdit ? "Edit Bot" : "Create New Bot"}</h3>
          <button class="modal-close" onclick="window.closeBotConfigModal()">&times;</button>
        </div>

        <div class="modal-body">
          <form id="bot-config-form" data-testid="bot-config-form" onsubmit="window.saveBotConfig(event)">
            <!-- Basic Info -->
            <div class="form-section">
              <h4>Basic Information</h4>
              <div class="form-row">
                <div class="form-group">
                  <label for="bot-name">Bot Name *</label>
                  <input
                    type="text"
                    id="bot-name"
                    name="name"
                    value="${bot?.name || ""}"
                    required
                    placeholder="e.g., Multi-ORB Test"
                    data-testid="bot-name-input"
                  />
                </div>
                <div class="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      id="bot-active"
                      name="is_active"
                      ${bot?.is_active !== false ? "checked" : ""}
                      data-testid="bot-active-checkbox"
                    />
                    Active
                  </label>
                </div>
              </div>
            </div>

            <!-- Global Limits -->
            <div class="form-section">
              <h4>Global Limits</h4>
              <div class="form-row">
                <div class="form-group">
                  <label for="max-positions">Max Total Positions</label>
                  <input
                    type="number"
                    id="max-positions"
                    name="max_total_positions"
                    value="${bot?.max_total_positions || 10}"
                    min="1"
                    max="20"
                    data-testid="max-positions-input"
                  />
                </div>
                <div class="form-group">
                  <label for="max-capital">Max Total Capital (%)</label>
                  <input
                    type="number"
                    id="max-capital"
                    name="max_total_capital_pct"
                    value="${(bot?.max_total_capital_pct || 0.8) * 100}"
                    min="10"
                    max="100"
                    step="5"
                    data-testid="max-capital-input"
                  />
                </div>
              </div>
            </div>

            <!-- Strategy Allocations -->
            <div class="form-section">
              <h4>Strategy Allocations</h4>
              <p class="help-text">
                Configure which strategies to run and their capital allocations.
                Total allocation should not exceed 100%.
              </p>

              <div id="strategy-allocations" class="strategy-allocations" data-testid="strategy-allocations">
                ${(bot?.strategies || []).map((s, i) => renderStrategyAllocationRow(s, i, selectableStrategies)).join("")}
              </div>

              <button
                type="button"
                class="btn btn-secondary btn-small"
                onclick="window.addStrategyAllocation()"
                data-testid="add-strategy-btn"
              >
                + Add Strategy
              </button>

              <div class="allocation-summary">
                <span>Total Allocation: </span>
                <span id="total-allocation">0%</span>
                <span id="allocation-warning" class="warning hidden">⚠️ Over 100%</span>
              </div>
            </div>

            <input type="hidden" name="bot_id" value="${bot?.id || ""}" />
          </form>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="window.closeBotConfigModal()" data-testid="cancel-bot-config-btn">
            Cancel
          </button>
          <button type="submit" form="bot-config-form" class="btn btn-primary" data-testid="save-bot-config-btn">
            ${isEdit ? "Update Bot" : "Create Bot"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderStrategyAllocationRow(
  strategy: StrategyWithAllocation | null,
  index: number,
  availableStrategies: AvailableStrategy[],
): string {
  const selectedId = strategy?.id || "";
  const maxPositions = strategy?.max_positions || 3;
  const allocationPct = strategy ? strategy.capital_allocation_pct * 100 : 20;

  return `
    <div class="strategy-allocation-row" data-index="${index}" data-testid="strategy-allocation-row">
      <div class="form-group strategy-select">
        <label>Strategy</label>
        <select name="strategy_id_${index}" onchange="window.updateAllocationSummary()">
          <option value="">Select a strategy...</option>
          ${availableStrategies
            .map(
              (s) => `
            <option value="${s.id}" ${selectedId === s.id ? "selected" : ""}>
              ${s.name} (${s.strategy_type})
            </option>
          `,
            )
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Allocation %</label>
        <input
          type="number"
          name="allocation_${index}"
          value="${allocationPct}"
          min="5"
          max="100"
          step="5"
          onchange="window.updateAllocationSummary()"
        />
      </div>
      <div class="form-group">
        <label>Max Positions</label>
        <input
          type="number"
          name="max_positions_${index}"
          value="${maxPositions}"
          min="1"
          max="10"
        />
      </div>
      <button
        type="button"
        class="btn btn-small btn-danger"
        onclick="window.removeStrategyAllocation(${index})"
        title="Remove"
      >
        ×
      </button>
    </div>
  `;
}

// Initialize config form handlers
export function initConfigHandlers() {
  let strategyRowIndex = 0;

  (window as any).closeBotConfigModal = () => {
    const state = getBotsState();
    if (state.showCreateModal) {
      closeCreateModal();
    } else {
      closeEditModal();
    }
  };

  (window as any).addStrategyAllocation = () => {
    const state = getBotsState();
    const selectableStrategies = state.availableStrategies.filter((s) => !s.is_template);
    const container = document.getElementById("strategy-allocations");
    if (!container) return;

    const newRow = document.createElement("div");
    newRow.innerHTML = renderStrategyAllocationRow(null, strategyRowIndex, selectableStrategies);
    container.appendChild(newRow.firstElementChild!);
    strategyRowIndex++;
    (window as any).updateAllocationSummary();
  };

  (window as any).removeStrategyAllocation = (index: number) => {
    const row = document.querySelector(`.strategy-allocation-row[data-index="${index}"]`);
    if (row) {
      row.remove();
      (window as any).updateAllocationSummary();
    }
  };

  (window as any).updateAllocationSummary = () => {
    const rows = document.querySelectorAll(".strategy-allocation-row");
    let total = 0;

    rows.forEach((row) => {
      const input = row.querySelector('input[name^="allocation_"]') as HTMLInputElement;
      if (input) {
        total += parseFloat(input.value) || 0;
      }
    });

    const totalEl = document.getElementById("total-allocation");
    const warningEl = document.getElementById("allocation-warning");

    if (totalEl) {
      totalEl.textContent = `${total.toFixed(0)}%`;
    }

    if (warningEl) {
      if (total > 100) {
        warningEl.classList.remove("hidden");
      } else {
        warningEl.classList.add("hidden");
      }
    }
  };

  (window as any).saveBotConfig = async (event: Event) => {
    event.preventDefault();

    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const botId = formData.get("bot_id") as string;

    // Collect strategy allocations
    const strategies: StrategyAllocation[] = [];
    const rows = document.querySelectorAll(".strategy-allocation-row");

    rows.forEach((row) => {
      const index = row.getAttribute("data-index");
      const strategyId = formData.get(`strategy_id_${index}`);
      const allocation = formData.get(`allocation_${index}`);
      const maxPositions = formData.get(`max_positions_${index}`);

      if (strategyId && allocation) {
        strategies.push({
          strategy_id: strategyId as string,
          capital_allocation_pct: parseFloat(allocation as string) / 100,
          max_positions: parseInt(maxPositions as string) || 3,
        });
      }
    });

    const data = {
      name: formData.get("name") as string,
      is_active: formData.has("is_active"),
      max_total_positions: parseInt(formData.get("max_total_positions") as string) || 10,
      max_total_capital_pct:
        (parseFloat(formData.get("max_total_capital_pct") as string) || 80) / 100,
      strategies,
    };

    if (botId) {
      // Update existing bot
      await updateBotAction(botId, data);
    } else {
      // Create new bot
      await createBotAction(data);
    }
  };

  // Initialize allocation summary on load
  setTimeout(() => {
    (window as any).updateAllocationSummary();
  }, 100);
}
