/**
 * Strategy Form Component
 *
 * Form for creating and editing strategy variations.
 */

import type { StrategyConfig, StrategyCreate, StrategyUpdate } from "../../types/strategies";
import {
  createStrategy,
  updateStrategy,
  closeCreateModal,
  closeEditModal,
} from "../../state/strategies";

export function renderStrategyForm(
  editingStrategy: StrategyConfig | null,
  parentTemplate: StrategyConfig | null,
): string {
  const isEdit = editingStrategy !== null;
  const title = isEdit
    ? "Edit Strategy"
    : `New ${parentTemplate?.strategy_type || "ORB"} Variation`;

  // Default values
  const defaults = {
    name: editingStrategy?.name || "",
    description: editingStrategy?.description || "",
    strategy_type: editingStrategy?.strategy_type || parentTemplate?.strategy_type || "ORB",
    parent_id: editingStrategy?.parent_id || parentTemplate?.id || null,
    // ORB params
    or_minutes: editingStrategy?.or_minutes ?? parentTemplate?.or_minutes ?? 45,
    sl_pct: editingStrategy?.sl_pct ?? parentTemplate?.sl_pct ?? 0.4,
    tp_pct: editingStrategy?.tp_pct ?? parentTemplate?.tp_pct ?? 1.2,
    min_or_range_pct: editingStrategy?.min_or_range_pct ?? parentTemplate?.min_or_range_pct ?? 0.5,
    max_or_range_pct: editingStrategy?.max_or_range_pct ?? parentTemplate?.max_or_range_pct ?? 3.0,
    // Risk params
    max_positions: editingStrategy?.max_positions ?? parentTemplate?.max_positions ?? 5,
    max_capital_per_trade_pct:
      (editingStrategy?.max_capital_per_trade_pct ??
        parentTemplate?.max_capital_per_trade_pct ??
        0.1) * 100,
    max_daily_loss_pct:
      (editingStrategy?.max_daily_loss_pct ?? parentTemplate?.max_daily_loss_pct ?? 0.02) * 100,
    max_total_exposure_pct:
      (editingStrategy?.max_total_exposure_pct ?? parentTemplate?.max_total_exposure_pct ?? 0.5) *
      100,
    risk_per_trade_pct:
      (editingStrategy?.risk_per_trade_pct ?? parentTemplate?.risk_per_trade_pct ?? 0.01) * 100,
    min_trade_value: editingStrategy?.min_trade_value ?? parentTemplate?.min_trade_value ?? 5000,
    max_trade_value: editingStrategy?.max_trade_value ?? parentTemplate?.max_trade_value ?? 100000,
    // Runner params
    cooldown_minutes: editingStrategy?.cooldown_minutes ?? parentTemplate?.cooldown_minutes ?? 30,
    max_distance_from_or_pct:
      editingStrategy?.max_distance_from_or_pct ?? parentTemplate?.max_distance_from_or_pct ?? 1.5,
    is_default: editingStrategy?.is_default ?? false,
  };

  return `
    <div class="modal-overlay" data-testid="strategy-modal">
      <div class="modal-content strategy-form-modal">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="btn btn-icon modal-close" onclick="window.closeStrategyModal()">✕</button>
        </div>

        <form id="strategy-form" onsubmit="return window.saveStrategyForm(event)">
          <div class="modal-body">
            <input type="hidden" id="strategy-id" value="${editingStrategy?.id || ""}" />
            <input type="hidden" id="strategy-type" value="${defaults.strategy_type}" />
            <input type="hidden" id="parent-id" value="${defaults.parent_id || ""}" />

            <!-- Basic Info -->
            <div class="form-section">
              <h4>Basic Information</h4>
              <div class="form-group">
                <label for="strategy-name">Name *</label>
                <input
                  type="text"
                  id="strategy-name"
                  class="form-input"
                  value="${defaults.name}"
                  required
                  placeholder="e.g., ORB Conservative"
                  data-testid="strategy-name-input"
                />
              </div>
              <div class="form-group">
                <label for="strategy-description">Description</label>
                <textarea
                  id="strategy-description"
                  class="form-input"
                  rows="2"
                  placeholder="Optional notes about this strategy"
                >${defaults.description}</textarea>
              </div>
              ${
                isEdit
                  ? `
                <div class="form-group">
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      id="strategy-is-default"
                      ${defaults.is_default ? "checked" : ""}
                    />
                    Set as default strategy
                  </label>
                </div>
              `
                  : ""
              }
            </div>

            <!-- ORB Parameters -->
            <div class="form-section">
              <h4>ORB Parameters</h4>
              <div class="form-row">
                <div class="form-group">
                  <label for="or-minutes">OR Minutes</label>
                  <input
                    type="number"
                    id="or-minutes"
                    class="form-input"
                    value="${defaults.or_minutes}"
                    min="5"
                    max="120"
                    step="5"
                  />
                </div>
                <div class="form-group">
                  <label for="sl-pct">Stop Loss %</label>
                  <input
                    type="number"
                    id="sl-pct"
                    class="form-input"
                    value="${defaults.sl_pct}"
                    min="0.1"
                    max="5"
                    step="0.1"
                    data-testid="sl-pct-input"
                  />
                </div>
                <div class="form-group">
                  <label for="tp-pct">Take Profit %</label>
                  <input
                    type="number"
                    id="tp-pct"
                    class="form-input"
                    value="${defaults.tp_pct}"
                    min="0.1"
                    max="10"
                    step="0.1"
                    data-testid="tp-pct-input"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="min-or-range">Min OR Range %</label>
                  <input
                    type="number"
                    id="min-or-range"
                    class="form-input"
                    value="${defaults.min_or_range_pct}"
                    min="0.1"
                    max="5"
                    step="0.1"
                  />
                </div>
                <div class="form-group">
                  <label for="max-or-range">Max OR Range %</label>
                  <input
                    type="number"
                    id="max-or-range"
                    class="form-input"
                    value="${defaults.max_or_range_pct}"
                    min="1"
                    max="10"
                    step="0.5"
                  />
                </div>
              </div>
            </div>

            <!-- Risk Management -->
            <div class="form-section">
              <h4>Risk Management</h4>
              <div class="form-row">
                <div class="form-group">
                  <label for="max-positions">Max Positions</label>
                  <input
                    type="number"
                    id="max-positions"
                    class="form-input"
                    value="${defaults.max_positions}"
                    min="1"
                    max="20"
                    data-testid="max-positions-input"
                  />
                </div>
                <div class="form-group">
                  <label for="capital-per-trade">Capital/Trade %</label>
                  <input
                    type="number"
                    id="capital-per-trade"
                    class="form-input"
                    value="${defaults.max_capital_per_trade_pct}"
                    min="1"
                    max="50"
                    step="1"
                  />
                </div>
                <div class="form-group">
                  <label for="risk-per-trade">Risk/Trade %</label>
                  <input
                    type="number"
                    id="risk-per-trade"
                    class="form-input"
                    value="${defaults.risk_per_trade_pct}"
                    min="0.1"
                    max="5"
                    step="0.1"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="daily-loss">Daily Loss Limit %</label>
                  <input
                    type="number"
                    id="daily-loss"
                    class="form-input"
                    value="${defaults.max_daily_loss_pct}"
                    min="0.5"
                    max="10"
                    step="0.5"
                  />
                </div>
                <div class="form-group">
                  <label for="total-exposure">Total Exposure %</label>
                  <input
                    type="number"
                    id="total-exposure"
                    class="form-input"
                    value="${defaults.max_total_exposure_pct}"
                    min="10"
                    max="100"
                    step="5"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="min-trade-value">Min Trade Value (₹)</label>
                  <input
                    type="number"
                    id="min-trade-value"
                    class="form-input"
                    value="${defaults.min_trade_value}"
                    min="1000"
                    step="1000"
                  />
                </div>
                <div class="form-group">
                  <label for="max-trade-value">Max Trade Value (₹)</label>
                  <input
                    type="number"
                    id="max-trade-value"
                    class="form-input"
                    value="${defaults.max_trade_value}"
                    min="10000"
                    step="10000"
                  />
                </div>
              </div>
            </div>

            <!-- Runner Parameters -->
            <div class="form-section">
              <h4>Runner Parameters</h4>
              <div class="form-row">
                <div class="form-group">
                  <label for="cooldown">Cooldown Minutes</label>
                  <input
                    type="number"
                    id="cooldown"
                    class="form-input"
                    value="${defaults.cooldown_minutes}"
                    min="0"
                    max="120"
                    step="5"
                  />
                </div>
                <div class="form-group">
                  <label for="max-distance">Max Distance from OR %</label>
                  <input
                    type="number"
                    id="max-distance"
                    class="form-input"
                    value="${defaults.max_distance_from_or_pct}"
                    min="0.5"
                    max="5"
                    step="0.25"
                  />
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="window.closeStrategyModal()">
              Cancel
            </button>
            <button type="submit" class="btn btn-primary" data-testid="save-strategy-btn">
              ${isEdit ? "Save Changes" : "Create Strategy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function initFormHandlers() {
  // Open create modal
  (window as any).openCreateStrategyModal = () => {
    closeEditModal();
    // The modal will show via state subscription
    window.dispatchEvent(new CustomEvent("strategy-modal-open"));
  };

  // Close modal
  (window as any).closeStrategyModal = () => {
    closeCreateModal();
    closeEditModal();
    window.dispatchEvent(new CustomEvent("strategy-modal-close"));
  };

  // Save form
  (window as any).saveStrategyForm = async (event: Event) => {
    event.preventDefault();

    const form = document.getElementById("strategy-form") as HTMLFormElement;
    if (!form) return false;

    const strategyId = (document.getElementById("strategy-id") as HTMLInputElement)?.value;
    const isEdit = strategyId && strategyId !== "";

    // Collect form values
    const data: StrategyCreate | StrategyUpdate = {
      name: (document.getElementById("strategy-name") as HTMLInputElement)?.value,
      description:
        (document.getElementById("strategy-description") as HTMLTextAreaElement)?.value || null,
      strategy_type: (document.getElementById("strategy-type") as HTMLInputElement)?.value,
      parent_id:
        parseInt((document.getElementById("parent-id") as HTMLInputElement)?.value) || null,
      // ORB params
      or_minutes: parseFloat((document.getElementById("or-minutes") as HTMLInputElement)?.value),
      sl_pct: parseFloat((document.getElementById("sl-pct") as HTMLInputElement)?.value),
      tp_pct: parseFloat((document.getElementById("tp-pct") as HTMLInputElement)?.value),
      min_or_range_pct: parseFloat(
        (document.getElementById("min-or-range") as HTMLInputElement)?.value,
      ),
      max_or_range_pct: parseFloat(
        (document.getElementById("max-or-range") as HTMLInputElement)?.value,
      ),
      // Risk params (convert % to decimals)
      max_positions: parseInt(
        (document.getElementById("max-positions") as HTMLInputElement)?.value,
      ),
      max_capital_per_trade_pct:
        parseFloat((document.getElementById("capital-per-trade") as HTMLInputElement)?.value) / 100,
      max_daily_loss_pct:
        parseFloat((document.getElementById("daily-loss") as HTMLInputElement)?.value) / 100,
      max_total_exposure_pct:
        parseFloat((document.getElementById("total-exposure") as HTMLInputElement)?.value) / 100,
      risk_per_trade_pct:
        parseFloat((document.getElementById("risk-per-trade") as HTMLInputElement)?.value) / 100,
      min_trade_value: parseFloat(
        (document.getElementById("min-trade-value") as HTMLInputElement)?.value,
      ),
      max_trade_value: parseFloat(
        (document.getElementById("max-trade-value") as HTMLInputElement)?.value,
      ),
      // Runner params
      cooldown_minutes: parseInt((document.getElementById("cooldown") as HTMLInputElement)?.value),
      max_distance_from_or_pct: parseFloat(
        (document.getElementById("max-distance") as HTMLInputElement)?.value,
      ),
    };

    // Add is_default only for edits
    if (isEdit) {
      (data as StrategyUpdate).is_default =
        (document.getElementById("strategy-is-default") as HTMLInputElement)?.checked || false;
    }

    try {
      if (isEdit) {
        await updateStrategy(parseInt(strategyId), data as StrategyUpdate);
      } else {
        await createStrategy(data as StrategyCreate);
      }
    } catch (error) {
      console.error("Failed to save strategy:", error);
    }

    return false;
  };
}
