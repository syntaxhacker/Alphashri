/**
 * Sidemenu Component
 *
 * Navigation between Screener, Backtest, and Paper Trading views.
 */

import { getBacktestState, setCurrentView } from '../state/backtest'
import type { AppView } from '../types/backtest'

export function renderSidemenu(): string {
  const state = getBacktestState()
  const currentView = state.currentView

  return `
    <div class="sidemenu" data-testid="sidemenu">
      <div class="sidemenu-header">
        <div class="sidemenu-title">📊 Menu</div>
      </div>

      <nav class="sidemenu-nav">
        <button
          class="sidemenu-item ${currentView === 'screener' ? 'active' : ''}"
          data-testid="nav-screener"
          onclick="window.setAppView('screener')"
        >
          <span class="sidemenu-icon">🚀</span>
          <span class="sidemenu-label">Screener</span>
          <span class="sidemenu-desc">Live stock scanner</span>
        </button>

        <button
          class="sidemenu-item ${currentView === 'backtest' ? 'active' : ''}"
          data-testid="nav-backtest"
          onclick="window.setAppView('backtest')"
        >
          <span class="sidemenu-icon">📈</span>
          <span class="sidemenu-label">Backtest</span>
          <span class="sidemenu-desc">Strategy testing</span>
        </button>

        <button
          class="sidemenu-item ${currentView === 'paper' ? 'active' : ''}"
          data-testid="nav-paper"
          onclick="window.setAppView('paper')"
        >
          <span class="sidemenu-icon">💹</span>
          <span class="sidemenu-label">Paper Trading</span>
          <span class="sidemenu-desc">Live & completed trades</span>
        </button>

        <button
          class="sidemenu-item ${currentView === 'sector' ? 'active' : ''}"
          data-testid="nav-sector"
          onclick="window.setAppView('sector')"
        >
          <span class="sidemenu-icon">🏭</span>
          <span class="sidemenu-label">Sector Analysis</span>
          <span class="sidemenu-desc">Rotation & cycles dashboard</span>
        </button>
      </nav>

      <div class="sidemenu-footer">
        <div class="sidemenu-version">v1.1.0</div>
      </div>
    </div>
  `
}

// Register window handlers
export function initSidemenu() {
  ;(window as any).setAppView = (view: AppView) => {
    setCurrentView(view)
    if (typeof (window as any).navigateToRoute === 'function') {
      ;(window as any).navigateToRoute(view)
    }
  }
}
