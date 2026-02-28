/**
 * Sidemenu Component
 *
 * Navigation between Screener, Backtest, and Paper Trading views.
 */

import { getBacktestState, setCurrentView } from "../state/backtest";
import type { AppView } from "../types/backtest";

interface UserInfo {
  displayName: string;
  email: string;
}

// Get user info from window (set by React AuthProvider)
function getUserInfo(): UserInfo | null {
  const userInfo = (window as any).__ALPHASHRI_USER__;
  if (userInfo) {
    return userInfo;
  }
  return null;
}

export function renderSidemenu(): string {
  const state = getBacktestState();
  const currentView = state.currentView;
  const user = getUserInfo();

  const userSection = user
    ? `
      <div class="sidemenu-user">
        <div class="sidemenu-user-avatar">${user.displayName?.charAt(0)?.toUpperCase() || "U"}</div>
        <div class="sidemenu-user-info">
          <div class="sidemenu-user-name">${user.displayName}</div>
          <div class="sidemenu-user-email">${user.email}</div>
        </div>
        <button class="sidemenu-logout" onclick="window.handleLogout()" title="Sign Out">
          Sign Out
        </button>
      </div>
    `
    : "";

  return `
    <div class="sidemenu" data-testid="sidemenu">
      <div class="sidemenu-header">
        <div class="sidemenu-title">📊 Menu</div>
      </div>

      <nav class="sidemenu-nav">
        <button
          class="sidemenu-item ${currentView === "screener" ? "active" : ""}"
          data-testid="nav-screener"
          onclick="window.setAppView('screener')"
        >
          <span class="sidemenu-icon">🚀</span>
          <span class="sidemenu-label">Screener</span>
          <span class="sidemenu-desc">Live stock scanner</span>
        </button>

        <button
          class="sidemenu-item ${currentView === "backtest" ? "active" : ""}"
          data-testid="nav-backtest"
          onclick="window.setAppView('backtest')"
        >
          <span class="sidemenu-icon">📈</span>
          <span class="sidemenu-label">Backtest</span>
          <span class="sidemenu-desc">Strategy testing</span>
        </button>

        <button
          class="sidemenu-item ${currentView === "paper" ? "active" : ""}"
          data-testid="nav-paper"
          onclick="window.setAppView('paper')"
        >
          <span class="sidemenu-icon">💹</span>
          <span class="sidemenu-label">Paper Trading</span>
          <span class="sidemenu-desc">Live & completed trades</span>
        </button>

        <button
          class="sidemenu-item ${currentView === "sector" ? "active" : ""}"
          data-testid="nav-sector"
          onclick="window.setAppView('sector')"
        >
          <span class="sidemenu-icon">🏭</span>
          <span class="sidemenu-label">Sector Analysis</span>
          <span class="sidemenu-desc">Rotation & cycles dashboard</span>
        </button>

        <button
          class="sidemenu-item ${currentView === "strategies" ? "active" : ""}"
          data-testid="nav-strategies"
          onclick="window.setAppView('strategies')"
        >
          <span class="sidemenu-icon">📊</span>
          <span class="sidemenu-label">Strategies</span>
          <span class="sidemenu-desc">Manage strategy variations</span>
        </button>
      </nav>

      <div class="sidemenu-footer">
        ${userSection}
        <div class="sidemenu-version">v1.1.0 • Alphashri</div>
      </div>
    </div>
  `;
}

// Register window handlers
export function initSidemenu() {
  (window as any).setAppView = (view: AppView) => {
    setCurrentView(view);
    if (typeof (window as any).navigateToRoute === "function") {
      (window as any).navigateToRoute(view);
    }
  };
}
