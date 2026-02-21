/**
 * Strategy Config Component
 *
 * Form for configuring backtest parameters.
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
    <div class="strategy-config" data-testid="strategy-config">
      <div class="config-header">
        <h3>⚙️ Strategy Configuration</h3>
      </div>

      <div class="config-body">
        <!-- Strategy Selector -->
        <div class="config-row">
          <label class="config-label">Strategy</label>
          <select
            class="config-select"
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

        ${strategy ? renderParams(strategy.params, params) : ''}

        <!-- Symbols -->
        <div class="config-row symbols-row">
          <label class="config-label">Stocks</label>
          <div class="symbols-input">
            <div class="symbols-tags" data-testid="symbols-tags">
              ${selectedSymbols.map(s => `
                <span class="symbol-tag">
                  ${s}
                  <button class="symbol-remove" onclick="window.removeSymbol('${s}')" title="Remove">×</button>
                </span>
              `).join('')}
            </div>
            <input
              type="text"
              class="symbol-add-input"
              data-testid="symbol-add-input"
              placeholder="Add symbol..."
              onkeydown="if(event.key==='Enter')window.addSymbolFromInput(this)"
            />
          </div>
        </div>

        <!-- Days -->
        <div class="config-row">
          <label class="config-label">Days</label>
          <input
            type="number"
            class="config-input"
            data-testid="days-input"
            value="${state.days}"
            min="30"
            max="365"
            step="30"
            onchange="window.setDays(parseInt(this.value))"
          />
        </div>

        <!-- Include Costs -->
        <div class="config-row checkbox-row">
          <label class="checkbox-label">
            <input
              type="checkbox"
              data-testid="include-costs-checkbox"
              ${state.includeCosts ? 'checked' : ''}
              onchange="window.setIncludeCosts(this.checked)"
            />
            Include Trading Costs (Brokerage, STT, GST, etc.)
          </label>
        </div>
      </div>

      <div class="config-footer">
        <button
          class="btn btn-secondary"
          data-testid="reset-btn"
          onclick="window.resetConfig()"
        >
          Reset
        </button>
        <button
          class="btn btn-primary"
          data-testid="run-backtest-btn"
          onclick="window.runBacktest()"
          ${state.isRunning ? 'disabled' : ''}
        >
          ${state.isRunning ? '⏳ Running...' : '▶ Run Backtest'}
        </button>
      </div>
    </div>
  `
}

function renderParams(paramDefs: StrategyParam[], currentParams: Record<string, any>): string {
  return paramDefs.map(param => `
    <div class="config-row">
      <label class="config-label">${param.label}</label>
      ${param.type === 'select' ? `
        <select
          class="config-select"
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
          class="config-checkbox"
          data-testid="param-${param.key}"
          ${currentParams[param.key] ? 'checked' : ''}
          onchange="window.setParam('${param.key}', this.checked)"
        />
      ` : `
        <input
          type="number"
          class="config-input"
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
