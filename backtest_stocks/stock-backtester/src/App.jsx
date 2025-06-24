import { useState, useRef } from 'react'
import './App.css'
import BacktestForm from './components/BacktestForm'
import StockSearch from './components/StockSearch'
import ResultsChart from './components/ResultsChart'
import ResultsTable from './components/ResultsTable'

function App() {
  const [selectedStock, setSelectedStock] = useState(null)
  const [backtestResult, setBacktestResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastParams, setLastParams] = useState(null)
  const chartRef = useRef(null)

  const handleStockSelect = (stock) => {
    setSelectedStock(stock)
    setBacktestResult(null)
    setError(null)
  }

  const handleBacktestRun = async (params) => {
    if (!selectedStock) {
      setError('Please select a stock first')
      return
    }

    setLoading(true)
    setError(null)
    setBacktestResult(null)
    setLastParams(params)

    try {
      const response = await fetch('http://localhost:8000/backtest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: selectedStock.symbol,
          timeframe: params.timeframe,
          days: params.days,
          momentum_candles: params.momentum_candles,
          min_momentum_pct: params.min_momentum_pct,
          engulf_ratio: params.engulf_ratio
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to run backtest')
      }

      // Validate required data
      if (!data.chart_data || !data.chart_data.price_data) {
        throw new Error('Invalid response data: Missing price data')
      }

      // Process and set the result
      setBacktestResult({
        ...data,
        total_return: Number(data.total_return) || 0,
        win_rate: Number(data.win_rate) || 0,
        sharpe_ratio: Number(data.sharpe_ratio) || 0,
        max_drawdown: Number(data.max_drawdown) || 0,
        total_trades: Number(data.total_trades) || 0,
        chart_data: {
          price_data: data.chart_data.price_data.map(d => ({
            date: d.date,
            open: Number(d.open) || 0,
            high: Number(d.high) || 0,
            low: Number(d.low) || 0,
            close: Number(d.close) || 0,
            volume: Number(d.volume) || 0
          })),
          signals: (data.chart_data.signals || []).map(s => ({
            date: s.date,
            type: s.type,
            price: Number(s.price) || 0,
            return: Number(s.return) || 0
          }))
        }
      })

    } catch (err) {
      console.error('Backtest error:', err)
      setError(err.message || 'Failed to run backtest')
      setBacktestResult(null)
    } finally {
      setLoading(false)
    }
  }

  const handleTradeClick = (trade) => {
    if (chartRef.current && chartRef.current.zoomToTrade) {
      chartRef.current.zoomToTrade(trade)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>📈 Stock Backtesting Platform</h1>
        <p>Test trading strategies with historical data</p>
      </header>

      <main className="main">
        {/* Top Controls Grid */}
        <div className="grid">
          <div className="panel">
            <h2>🔍 Select Stock</h2>
            <StockSearch onStockSelect={handleStockSelect} />
            {selectedStock && (
              <div className="selected-stock">
                <h3>{selectedStock.symbol}</h3>
                <p>{selectedStock.name}</p>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>⚙️ Strategy Parameters</h2>
            <BacktestForm 
              onRun={handleBacktestRun}
              loading={loading}
              disabled={!selectedStock}
            />
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="loading-banner">
            <div className="loading-spinner"></div>
            <span>Running backtest analysis...</span>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Results Grid */}
        {backtestResult && (
          <div className="results-grid">
            <div className="panel">
              <h2>📊 Trade Log</h2>
              <ResultsTable data={backtestResult} onTradeClick={handleTradeClick} />
            </div>

            <div className="panel chart-panel">
              <h2>📈 Price Chart & Signals</h2>
              <ResultsChart data={backtestResult.chart_data} ref={chartRef} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
