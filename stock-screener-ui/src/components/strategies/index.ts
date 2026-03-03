/**
 * Strategy Management View Component
 *
 * Main strategies view for managing strategy templates and variations.
 */

import { renderTemplateCard, initTemplateHandlers } from "./templates";
import { renderVariationsPanel, initVariationsHandlers } from "./variations";
import { renderStrategyForm, initFormHandlers } from "./form";
import {
  renderPerformanceView,
  initPerformanceHandlers,
  clearPerformanceCache,
} from "./performance";
import {
  getStrategiesState,
  getCurrentView,
  setCurrentView,
  loadTemplates,
  loadStrategies,
  loadInitialData,
  clearError,
  loadAllPerformance,
  initStrategiesState,
} from "../../state/strategies";
import type { StrategiesView, StrategiesState } from "../../types/strategies";

export function renderStrategiesView(): string {
  const currentState = getStrategiesState();
  const currentViewValue = getCurrentView();

  return `
    <div class="strategies-view" data-testid="strategies-view">
      <!-- Header with tabs -->
      <div class="strategies-header">
        <div class="strategies-tabs">
          <button
            class="strategy-tab ${currentViewValue === "templates" ? "active" : ""}"
            onclick="window.setStrategyView('templates')"
          >
            <span class="tab-icon">📊</span>
            Templates
          </button>
          <button
            class="strategy-tab ${currentViewValue === "list" ? "active" : ""}"
            onclick="window.setStrategyView('list')"
          >
            <span class="tab-icon">📋</span>
            All Strategies
          </button>
          <button
            class="strategy-tab ${currentViewValue === "performance" ? "active" : ""}"
            onclick="window.setStrategyView('performance')"
          >
            <span class="tab-icon">📈</span>
            Performance
          </button>
        </div>
        <div class="strategies-actions">
          <button
            class="btn btn-primary"
            onclick="window.openCreateStrategyModal()"
            data-testid="create-strategy-btn"
          >
            + New Strategy
          </button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="strategies-content">
        ${renderMainContent(currentViewValue, currentState)}
      </div>

      <!-- Create/Edit Modal -->
      ${
        currentState.showCreateModal || currentState.showEditModal
          ? renderStrategyForm(currentState.editingStrategy, currentState.parentTemplate)
          : ""
      }

      ${
        currentState.error
          ? `
        <div class="strategies-error" data-testid="strategies-error">
          <p>❌ ${currentState.error}</p>
          <button class="btn btn-secondary" onclick="window.clearStrategyError()">Dismiss</button>
        </div>
      `
          : ""
      }

      ${
        currentState.isLoading
          ? `
        <div class="strategies-loading" data-testid="strategies-loading">
          <div class="spinner"></div>
          <p>Loading strategies...</p>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function renderMainContent(view: StrategiesView, state: StrategiesState): string {
  if (view === "performance") {
    return renderPerformanceView(state);
  }

  if (view === "list") {
    return renderAllStrategiesList(state);
  }

  // Templates view (default)
  if (state.templates.length === 0) {
    return `
      <div class="strategies-empty">
        <p>No strategy templates found. Run the migration script to create templates.</p>
      </div>
    `;
  }

  return `
    <div class="strategies-templates" data-testid="strategies-templates">
      ${state.templates.map((template) => renderTemplateCard(template, state.strategies)).join("")}
    </div>
  `;
}

function renderAllStrategiesList(state: StrategiesState): string {
  const nonTemplates = state.strategies.filter((s) => !s.is_template);

  if (nonTemplates.length === 0) {
    return `
      <div class="strategies-empty">
        <p>No strategy variations created yet. Click "New Strategy" to create one.</p>
      </div>
    `;
  }

  return `
    <div class="strategies-list" data-testid="strategies-list">
      <table class="strategies-table" data-testid="strategies-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Parent</th>
            <th>SL%</th>
            <th>TP%</th>
            <th>Max Positions</th>
            <th>Default</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${nonTemplates
            .map(
              (s) => `
            <tr class="strategy-row ${s.is_default ? "default" : ""}" data-strategy-id="${s.id}">
              <td class="strategy-name">
                ${s.is_default ? '<span class="default-badge">⭐</span>' : ""}
                ${s.name}
              </td>
              <td>${s.strategy_type}</td>
              <td>${s.parent_id ? getParentName(s.parent_id, state) : "-"}</td>
              <td>${s.sl_pct}%</td>
              <td>${s.tp_pct}%</td>
              <td>${s.max_positions}</td>
              <td>${s.is_default ? "✓" : ""}</td>
              <td class="strategy-actions">
                <button
                  class="btn btn-small btn-secondary"
                  onclick="window.editStrategy(${s.id})"
                  data-testid="edit-strategy-btn"
                >
                  Edit
                </button>
                <button
                  class="btn btn-small btn-danger"
                  onclick="window.deleteStrategy(${s.id})"
                  ${s.is_default ? "disabled title='Cannot delete default strategy'" : ""}
                  data-testid="delete-strategy-btn"
                >
                  Delete
                </button>
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

function getParentName(parentId: number, state: StrategiesState): string {
  const parent = state.templates.find((t) => t.id === parentId);
  return parent ? parent.name : `#${parentId}`;
}

// Initialize all strategy handlers
export function initStrategiesHandlers() {
  initTemplateHandlers();
  initVariationsHandlers();
  initFormHandlers();
  initPerformanceHandlers();

  // View switching
  (window as any).setStrategyView = (view: StrategiesView) => {
    setCurrentView(view);
    if (view === "templates") {
      loadTemplates();
    } else if (view === "list") {
      loadStrategies(true);
    } else if (view === "performance") {
      loadAllPerformance();
    }
  };

  (window as any).clearStrategyError = () => {
    clearError();
  };

  // Trigger initial data load
  initStrategiesState();
}

// Clean up when switching views
export function cleanupStrategies() {
  clearPerformanceCache();
}
