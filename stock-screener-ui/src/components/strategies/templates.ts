/**
 * Strategy Template Card Component
 */

import type { StrategyConfig } from "../../types/strategies";
import {
  openCreateModal,
  selectStrategy,
  loadStrategy,
} from "../../state/strategies";

export function renderTemplateCard(
  template: StrategyConfig,
  allStrategies: StrategyConfig[]
): string {
  const variations = allStrategies.filter((s) => s.parent_id === template.id);

  return `
    <div class="template-card" data-template-id="${template.id}">
      <div class="template-header" onclick="window.toggleTemplateExpand(${template.id})">
        <div class="template-info">
          <span class="template-icon">${getStrategyTypeIcon(template.strategy_type)}</span>
          <div class="template-details">
            <h3 class="template-name">${template.name}</h3>
            <p class="template-type">${template.strategy_type}</p>
          </div>
        </div>
        <div class="template-meta">
          <span class="variation-count">${variations.length} variation${variations.length !== 1 ? "s" : ""}</span>
          <span class="expand-icon" id="expand-icon-${template.id}">▶</span>
        </div>
      </div>

      <div class="template-variations" id="variations-${template.id}" style="display: none;">
        ${
          variations.length > 0
            ? `
          <div class="variations-list">
            ${variations.map((v) => renderVariationCard(v)).join("")}
          </div>
        `
            : `
          <div class="no-variations">
            <p>No variations created yet.</p>
          </div>
        `
        }
        <div class="variations-actions">
          <button
            class="btn btn-secondary btn-small"
            onclick="window.createVariation(${template.id}, '${template.name}', '${template.strategy_type}')"
          >
            + Add Variation
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderVariationCard(variation: StrategyConfig): string {
  return `
    <div class="variation-card ${variation.is_default ? "default" : ""}" data-variation-id="${variation.id}">
      <div class="variation-header">
        <h4 class="variation-name">
          ${variation.is_default ? '<span class="default-badge">⭐</span>' : ""}
          ${variation.name}
        </h4>
        <div class="variation-actions">
          <button
            class="btn btn-small btn-secondary"
            onclick="window.editStrategy(${variation.id})"
            title="Edit variation"
          >
            ✏️
          </button>
          <button
            class="btn btn-small btn-danger"
            onclick="window.deleteStrategy(${variation.id})"
            ${variation.is_default ? "disabled" : ""}
            title="Delete variation"
          >
            🗑️
          </button>
        </div>
      </div>
      <div class="variation-params">
        <div class="param">
          <span class="param-label">SL:</span>
          <span class="param-value">${variation.sl_pct}%</span>
        </div>
        <div class="param">
          <span class="param-label">TP:</span>
          <span class="param-value">${variation.tp_pct}%</span>
        </div>
        <div class="param">
          <span class="param-label">Risk:</span>
          <span class="param-value">${variation.risk_per_trade_pct}%</span>
        </div>
        <div class="param">
          <span class="param-label">Positions:</span>
          <span class="param-value">${variation.max_positions}</span>
        </div>
      </div>
      ${
        variation.description
          ? `<p class="variation-description">${variation.description}</p>`
          : ""
      }
    </div>
  `;
}

function getStrategyTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    ORB: "📊",
    EMA_CROSS: "📈",
    "52W_CHASER": "🎯",
  };
  return icons[type] || "📋";
}

// Export for testing
export { renderVariationCard };

export function initTemplateHandlers() {
  // Toggle template expansion
  (window as any).toggleTemplateExpand = (templateId: number) => {
    const variationsEl = document.getElementById(`variations-${templateId}`);
    const iconEl = document.getElementById(`expand-icon-${templateId}`);

    if (variationsEl && iconEl) {
      const isHidden = variationsEl.style.display === "none";
      variationsEl.style.display = isHidden ? "block" : "none";
      iconEl.textContent = isHidden ? "▼" : "▶";
    }
  };

  // Create variation from template
  (window as any).createVariation = (
    templateId: number,
    templateName: string,
    strategyType: string
  ) => {
    const template: StrategyConfig = {
      id: templateId,
      name: templateName,
      strategy_type: strategyType,
    } as StrategyConfig;
    openCreateModal(template);
  };
}
