/**
 * Bot Management View Component
 *
 * Main view for managing multi-strategy trading bots.
 */

import { renderBotConfigForm, initConfigHandlers } from "./config";
import { renderBotStatusPanel, initStatusHandlers } from "./status";
import {
  getBotsState,
  getCurrentView,
  setCurrentView,
  loadBotStatus,
  loadBotTrades,
  selectBot,
  startAutoRefresh,
  stopAutoRefresh,
  openCreateModal,
  openEditModal,
  deleteBotAction,
  startBotAction,
  stopBotAction,
  clearError,
  initBotsState,
} from "../../state/bots";
import type { BotConfig, BotsView } from "../../types/bots";
import { isLoading } from "../../utils/loading";

export function renderBotsView(): string {
  const state = getBotsState();
  const currentViewValue = getCurrentView();

  return `
    <div class="bots-view" data-testid="bots-view">
      <!-- Header with tabs -->
      <div class="bots-header">
        <div class="bots-tabs">
          <button
            class="bots-tab ${currentViewValue === "list" ? "active" : ""}"
            onclick="window.setBotsView('list')"
            data-testid="bots-tab-list"
          >
            <span class="tab-icon">🤖</span>
            Bots
          </button>
          <button
            class="bots-tab ${currentViewValue === "status" ? "active" : ""}"
            onclick="window.setBotsView('status')"
            ${!state.selectedBot ? "disabled" : ""}
            data-testid="bots-tab-status"
          >
            <span class="tab-icon">📊</span>
            Status
          </button>
        </div>
        <div class="bots-actions">
          <button
            class="btn btn-primary"
            onclick="window.openCreateBotModal()"
            data-testid="create-bot-btn"
          >
            + New Bot
          </button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="bots-content">
        ${renderMainContent(currentViewValue, state)}
      </div>

      <!-- Create/Edit Modal -->
      ${
        state.showCreateModal
          ? renderBotConfigForm(null, state.availableStrategies)
          : state.showEditModal && state.editingBot
            ? renderBotConfigForm(state.editingBot, state.availableStrategies)
            : ""
      }

      ${
        state.error
          ? `
        <div class="bots-error" data-testid="bots-error">
          <p>❌ ${state.error}</p>
          <button class="btn btn-secondary" onclick="window.clearBotError()">Dismiss</button>
        </div>
      `
          : ""
      }

      ${(function () {
        const state = getBotsState();
        if (isLoading(state.loading, "list")) {
          return `
              <div class="bots-loading" data-testid="bots-loading">
                <div class="spinner"></div>
                <p>Loading bots...</p>
              </div>
            `;
        } else if (isLoading(state.loading, "create")) {
          return `
              <div class="bots-loading" data-testid="bots-loading">
                <div class="spinner"></div>
                <p>Creating bot...</p>
              </div>
            `;
        } else if (isLoading(state.loading, "update")) {
          return `
              <div class="bots-loading" data-testid="bots-loading">
                <div class="spinner"></div>
                <p>Updating bot...</p>
              </div>
            `;
        } else if (isLoading(state.loading, "delete")) {
          return `
              <div class="bots-loading" data-testid="bots-loading">
                <div class="spinner"></div>
                <p>Deleting bot...</p>
              </div>
            `;
        } else if (isLoading(state.loading, "start")) {
          return `
              <div class="bots-loading" data-testid="bots-loading">
                <div class="spinner"></div>
                <p>Starting bot...</p>
              </div>
            `;
        } else if (isLoading(state.loading, "stop")) {
          return `
              <div class="bots-loading" data-testid="bots-loading">
                <div class="spinner"></div>
                <p>Stopping bot...</p>
              </div>
            `;
        } else if (Object.values(state.loading).some((v) => v)) {
          return `
              <div class="bots-loading" data-testid="bots-loading">
                <div class="spinner"></div>
                <p>Loading...</p>
              </div>
            `;
        }
        return "";
      })()}
    </div>
  `;
}

function renderMainContent(view: BotsView, state: ReturnType<typeof getBotsState>): string {
  if (view === "status" && state.selectedBot) {
    return renderBotStatusPanel(state.selectedBot, state.botStatus);
  }

  // List view (default)
  return renderBotsList(state.bots, state.selectedBot);
}

function renderBotsList(bots: BotConfig[], selectedBot: BotConfig | null): string {
  if (bots.length === 0) {
    return `
      <div class="bots-empty">
        <p>No bots configured. Click "New Bot" to create one.</p>
      </div>
    `;
  }

  return `
    <div class="bots-list" data-testid="bots-list">
      <table class="bots-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Strategies</th>
            <th>Max Positions</th>
            <th>Max Capital</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${bots
            .map(
              (bot) => `
            <tr class="bot-row ${selectedBot?.id === bot.id ? "selected" : ""} ${bot.running ? "running" : ""}" data-bot-id="${bot.id}" data-testid="bot-card" data-bot-id-testid="${bot.id}">
              <td class="bot-name">
                <span class="status-indicator ${bot.running ? "running" : "stopped"}"></span>
                ${bot.name}
                ${!bot.is_active ? '<span class="inactive-badge">Inactive</span>' : ""}
              </td>
              <td>
                <span class="bot-status ${bot.running ? "running" : "stopped"}">
                  ${bot.running ? `Running (PID ${bot.pid})` : "Stopped"}
                </span>
              </td>
              <td>${bot.strategies.length} strategies</td>
              <td>${bot.max_total_positions}</td>
              <td>${(bot.max_total_capital_pct * 100).toFixed(0)}%</td>
              <td class="bot-actions">
                <button
                  class="btn btn-small btn-secondary"
                  onclick="window.viewBotStatus('${bot.id}')"
                  title="View Status"
                  data-testid="view-bot-status-btn-${bot.id}"
                >
                  📊
                </button>
                ${
                  bot.running
                    ? `
                  <button
                    class="btn btn-small btn-warning"
                    onclick="window.stopBot('${bot.id}')"
                    title="Stop Bot"
                    data-testid="stop-bot-btn-${bot.id}"
                  >
                    ⏹
                  </button>
                `
                    : `
                  <button
                    class="btn btn-small btn-success"
                    onclick="window.startBot('${bot.id}')"
                    title="Start Bot"
                    ${!bot.is_active ? "disabled" : ""}
                    data-testid="start-bot-btn-${bot.id}"
                  >
                    ▶
                  </button>
                `
                }
                <button
                  class="btn btn-small btn-secondary"
                  onclick="window.editBot('${bot.id}')"
                  title="Edit Bot"
                  data-testid="edit-bot-btn-${bot.id}"
                >
                  ✏️
                </button>
                <button
                  class="btn btn-small btn-danger"
                  onclick="window.deleteBot('${bot.id}')"
                  title="Delete Bot"
                  ${bot.running ? "disabled" : ""}
                  data-testid="delete-bot-btn-${bot.id}"
                >
                  🗑️
                </button>
              </td>
            </tr>
            ${
              selectedBot?.id === bot.id
                ? `
              <tr class="bot-strategies-row">
                <td colspan="6">
                  <div class="bot-strategies-detail">
                    ${renderStrategiesDetail(bot)}
                  </div>
                </td>
              </tr>
            `
                : ""
            }
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderStrategiesDetail(bot: BotConfig): string {
  if (bot.strategies.length === 0) {
    return '<p class="no-strategies">No strategies configured</p>';
  }

  const totalAllocation = bot.strategies.reduce((sum, s) => sum + s.capital_allocation_pct, 0);

  return `
    <div class="strategies-summary">
      <h4>Strategy Allocations</h4>
      <div class="strategies-list-mini">
        ${bot.strategies
          .map(
            (s) => `
          <div class="strategy-mini">
            <span class="strategy-name">${s.name}</span>
            <span class="strategy-allocation">${(s.capital_allocation_pct * 100).toFixed(0)}%</span>
            <span class="strategy-positions">Max ${s.max_positions} pos</span>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="allocation-total">
        Total: ${(totalAllocation * 100).toFixed(0)}%
        ${totalAllocation > 1 ? '<span class="warning">⚠️ Over 100%</span>' : ""}
      </div>
    </div>
  `;
}

// Initialize all bot handlers
export function initBotsHandlers() {
  initConfigHandlers();
  initStatusHandlers();

  // View switching
  window.setBotsView = (view: BotsView) => {
    stopAutoRefresh();
    setCurrentView(view);
  };

  window.clearBotError = () => {
    clearError();
  };

  // Bot actions
  window.viewBotStatus = (botId: string) => {
    const state = getBotsState();
    const bot = state.bots.find((b) => b.id === botId);
    if (bot) {
      selectBot(bot);
      setCurrentView("status");
      loadBotTrades(botId);
      if (bot.running) {
        loadBotStatus(botId);
        startAutoRefresh(botId, 5000);
      }
    }
  };

  window.startBot = async (botId: string) => {
    await startBotAction(botId, false);
  };

  window.stopBot = async (botId: string) => {
    await stopBotAction(botId);
    stopAutoRefresh();
  };

  window.editBot = (botId: string) => {
    const state = getBotsState();
    const bot = state.bots.find((b) => b.id === botId);
    if (bot) {
      openEditModal(bot);
    }
  };

  window.deleteBot = async (botId: string) => {
    if (confirm("Are you sure you want to delete this bot?")) {
      await deleteBotAction(botId);
    }
  };

  window.openCreateBotModal = () => {
    openCreateModal();
  };

  // Trigger initial data load
  initBotsState();
}

// Clean up when switching views
export function cleanupBots() {
  stopAutoRefresh();
}
