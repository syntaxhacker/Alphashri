/**
 * Strategy Config Component
 *
 * Horizontal form for configuring backtest parameters.
 */

import { getBacktestState, setSelectedStrategy, setParam, setDays, setIncludeCosts, addSymbol, removeSymbol, resetBacktestState } from '../../state/backtest'
import { runBacktest as runBacktestApi } from '../../api/backtest'
import type { Strategy, StrategyParam } from '../../types/backtest'

export function renderStrategyConfig(): string {
  const state = getBacktestState()
  const strategies = state.strategies
  const selectedStrategy = state.selectedStrategy
  const params = state.params
  const selectedSymbols = state.selectedSymbols

  // Find selected strategy
  const strategy = strategies.find(s => s.id === selectedStrategy)

  return `
    <div class="strategy-config-horizontal" data-testid="strategy-config">
      <div class="config-section">
        <label>Strategy</label>
        <select
          class="config-select-small"
          data-testid="strategy-select"
          onchange="window.setStrategy(this.value)"
        >
          ${strategies.map(s => `
            <option value="${s.id}" ${s.id === selectedStrategy ? 'selected' : ''}>
              ${s.name}
            </option>
          `).join('')}
        </select>
      </div>

      ${strategy ? renderParamsHorizontal(strategy.params, params) : ''}

      <div class="config-section">
        <label>Stocks</label>
        <div class="symbols-input-inline">
          ${selectedSymbols.map(s => `
            <span class="symbol-tag-small">
              ${s}
              <button class="symbol-remove-small" onclick="window.removeSymbol('${s}')" title="Remove">×</button>
            </span>
          `).join('')}
          <input
            type="text"
            class="symbol-add-input-small"
            data-testid="symbol-add-input"
            placeholder="+"
            onkeydown="if(event.key==='Enter')window.addSymbolFromInput(this)"
          />
        </div>
      </div>

      <div class="config-section">
        <label>Days</label>
        <input
          type="number"
          class="config-input-small"
          data-testid="days-input"
          value="${state.days}"
          min="30"
          max="365"
          step="30"
          onchange="window.setDays(parseInt(this.value))"
        />
      </div>

      <div class="config-section checkbox-section">
        <label class="checkbox-label-inline">
          <input
            type="checkbox"
            data-testid="include-costs-checkbox"
            ${state.includeCosts ? 'checked' : ''}
            onchange="window.setIncludeCosts(this.checked)"
          />
          <span>Costs</span>
        </label>
      </div>

      <div class="config-section config-actions">
        <button
          class="btn btn-secondary btn-small"
          data-testid="reset-btn"
          onclick="window.resetConfig()"
        >
          Reset
        </button>
        <button
          class="btn btn-primary btn-small"
          data-testid="run-backtest-btn"
          onclick="window.runBacktest()"
          ${state.isRunning ? 'disabled' : ''}
        >
          ${state.isRunning ? '⏳' : '▶ Run'}
        </button>
      </div>
    </div>
  `
}

function renderParamsHorizontal(paramDefs: StrategyParam[], currentParams: Record<string, any>): string {
  return paramDefs.map(param => `
    <div class="config-section">
      <label>${param.label}</label>
      ${param.type === 'select' ? `
        <select
          class="config-select-small"
          data-testid="param-${param.key}"
          onchange="window.setParam('${param.key}', this.value)"
        >
          ${(param.options || []).map(opt => `
            <option value="${opt}" ${currentParams[param.key] === opt ? 'selected' : ''}>
              ${opt}
            </option>
          `).join('')}
        </select>
      ` : param.type === 'boolean' ? `
        <input
          type="checkbox"
          class="config-checkbox-small"
          data-testid="param-${param.key}"
          ${currentParams[param.key] ? 'checked' : ''}
          onchange="window.setParam('${param.key}', this.checked)"
        />
      ` : `
        <input
          type="number"
          class="config-input-small"
          data-testid="param-${param.key}"
          value="${currentParams[param.key] ?? param.default}"
          min="${param.min ?? ''}"
          max="${param.max ?? ''}"
          step="${param.step ?? 1}"
          onchange="window.setParam('${param.key}', parseFloat(this.value))"
        />
      `}
    </div>
  `).join('')
}

// Register window handlers
export function initConfigHandlers() {
  ;(window as any).setStrategy = (id: string) => {
    setSelectedStrategy(id)
  }

  ;(window as any).setParam = (key: string, value: any) => {
    setParam(key, value)
  }

  ;(window as any).setDays = (days: number) => {
    setDays(days)
  }

  ;(window as any).setIncludeCosts = (include: boolean) => {
    setIncludeCosts(include)
  }

  ;(window as any).addSymbolFromInput = (input: HTMLInputElement) => {
    const symbol = input.value.trim().toUpperCase()
    if (symbol) {
      addSymbol(symbol)
      input.value = ''
    }
  }

  ;(window as any).removeSymbol = (symbol: string) => {
    removeSymbol(symbol)
  }

  ;(window as any).resetConfig = () => {
    resetBacktestState()
  }

  ;(window as any).runBacktest = async () => {
    await runBacktestApi()
  }
}
