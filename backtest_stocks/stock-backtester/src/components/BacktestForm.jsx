import { useState } from 'react'
import { Play, Settings } from 'lucide-react'

const BacktestForm = ({ onRun, loading, disabled }) => {
  const [params, setParams] = useState({
    strategy: 'golden_cross',
    timeframe: '1d',
    days: 730,
    // Golden Cross params
    short_ma: 50,
    long_ma: 200,
    volume_threshold: 1.2,
    // Engulfing params
    momentum_candles: 3,
    min_momentum_pct: 0.5,
    engulf_ratio: 1.1
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    onRun(params)
  }

  const handleParamChange = (key, value) => {
    setParams(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const renderStrategyParams = () => {
    if (params.strategy === 'golden_cross') {
      return (
        <>
          <div className="form-group">
            <label htmlFor="short_ma">
              Short MA Period
              <span className="hint">({params.short_ma} days)</span>
            </label>
            <input
              type="range"
              id="short_ma"
              min="10"
              max="100"
              step="5"
              value={params.short_ma}
              onChange={(e) => handleParamChange('short_ma', parseInt(e.target.value))}
            />
            <div className="range-labels">
              <span>10</span>
              <span>100</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="long_ma">
              Long MA Period
              <span className="hint">({params.long_ma} days)</span>
            </label>
            <input
              type="range"
              id="long_ma"
              min="100"
              max="300"
              step="10"
              value={params.long_ma}
              onChange={(e) => handleParamChange('long_ma', parseInt(e.target.value))}
            />
            <div className="range-labels">
              <span>100</span>
              <span>300</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="volume_threshold">
              Volume Threshold
              <span className="hint">({params.volume_threshold}x)</span>
            </label>
            <input
              type="range"
              id="volume_threshold"
              min="1.0"
              max="3.0"
              step="0.1"
              value={params.volume_threshold}
              onChange={(e) => handleParamChange('volume_threshold', parseFloat(e.target.value))}
            />
            <div className="range-labels">
              <span>1.0x</span>
              <span>3.0x</span>
            </div>
          </div>
        </>
      )
    } else {
      return (
        <>
          <div className="form-group">
            <label htmlFor="momentum_candles">
              Momentum Candles
              <span className="hint">({params.momentum_candles})</span>
            </label>
            <input
              type="range"
              id="momentum_candles"
              min="1"
              max="5"
              step="1"
              value={params.momentum_candles}
              onChange={(e) => handleParamChange('momentum_candles', parseInt(e.target.value))}
            />
            <div className="range-labels">
              <span>1</span>
              <span>5</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="min_momentum_pct">
              Min Momentum %
              <span className="hint">({params.min_momentum_pct}%)</span>
            </label>
            <input
              type="range"
              id="min_momentum_pct"
              min="0.1"
              max="2.0"
              step="0.1"
              value={params.min_momentum_pct}
              onChange={(e) => handleParamChange('min_momentum_pct', parseFloat(e.target.value))}
            />
            <div className="range-labels">
              <span>0.1%</span>
              <span>2%</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="engulf_ratio">
              Engulf Ratio
              <span className="hint">({params.engulf_ratio}x)</span>
            </label>
            <input
              type="range"
              id="engulf_ratio"
              min="1.0"
              max="2.0"
              step="0.05"
              value={params.engulf_ratio}
              onChange={(e) => handleParamChange('engulf_ratio', parseFloat(e.target.value))}
            />
            <div className="range-labels">
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>
        </>
      )
    }
  }

  const getStrategyDescription = () => {
    if (params.strategy === 'golden_cross') {
      return `Tests when ${params.short_ma}-day MA crosses above ${params.long_ma}-day MA with ${params.volume_threshold}x volume confirmation.`
    } else {
      return `Tests bullish engulfing patterns after ${params.momentum_candles} red candles with ${params.min_momentum_pct}% momentum.`
    }
  }

  return (
    <form className="backtest-form" onSubmit={handleSubmit}>
      
      <div className="form-group">
        <label htmlFor="strategy">Trading Strategy</label>
        <select
          id="strategy"
          value={params.strategy}
          onChange={(e) => handleParamChange('strategy', e.target.value)}
        >
          <option value="golden_cross">Golden Cross (MA Crossover)</option>
          <option value="engulfing">Bullish Engulfing Pattern</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="timeframe">Timeframe</label>
        <select
          id="timeframe"
          value={params.timeframe}
          onChange={(e) => handleParamChange('timeframe', e.target.value)}
        >
          <option value="1d">Daily (1d)</option>
          <option value="2h">2 Hours (2h)</option>
          <option value="45m">45 Minutes (45m)</option>
          <option value="15m">15 Minutes (15m)</option>
          <option value="5m">5 Minutes (5m)</option>
          <option value="1w">Weekly (1w)</option>
          <option value="1M">Monthly (1M)</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="days">
          Historical Days
          <span className="hint">({params.days} days)</span>
        </label>
        <input
          type="range"
          id="days"
          min="180"
          max="1095"
          step="90"
          value={params.days}
          onChange={(e) => handleParamChange('days', parseInt(e.target.value))}
        />
        <div className="range-labels">
          <span>6mo</span>
          <span>3yr</span>
        </div>
      </div>

      <div className="form-grid">
        {renderStrategyParams()}
      </div>

      <div className="strategy-info">
        <p>
          <strong>{params.strategy === 'golden_cross' ? 'Golden Cross Strategy:' : 'Engulfing Strategy:'}</strong> {getStrategyDescription()}
        </p>
      </div>

      <button 
        type="submit" 
        className="run-button"
        disabled={disabled || loading}
      >
        <Play size={16} />
        {loading ? 'Running...' : 'Run Backtest'}
      </button>
    </form>
  )
}

export default BacktestForm 