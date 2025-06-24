import { TrendingUp, TrendingDown, Calendar, Target, ZoomIn } from 'lucide-react'

const ResultsTable = ({ data, onTradeClick }) => {
  if (!data || !data.chart_data || !data.chart_data.signals) {
    return (
      <div className="no-trades">
        <p>No trades executed</p>
      </div>
    )
  }

  const trades = data.chart_data.signals.filter(s => s.type === 'exit')

  if (trades.length === 0) {
    return (
      <div className="no-trades">
        <p>No trades completed</p>
      </div>
    )
  }

  const formatCurrency = (value) => `₹${value.toFixed(2)}`
  const formatPercent = (value) => `${value.toFixed(2)}%`
  
  // Create proper trade pairs from entry and exit signals
  const createTradePairs = () => {
    const entrySignals = data.chart_data.signals.filter(s => s.type === 'entry')
    const exitSignals = data.chart_data.signals.filter(s => s.type === 'exit')
    
    const tradePairs = []
    
    // Match entries with exits (assuming they are paired in order)
    for (let i = 0; i < Math.min(entrySignals.length, exitSignals.length); i++) {
      const entry = entrySignals[i]
      const exit = exitSignals[i]
      
      if (entry && exit) {
        tradePairs.push({
          tradeIndex: i + 1,
          entryDate: entry.date,
          exitDate: exit.date,
          entryPrice: entry.price,
          exitPrice: exit.price,
          return: exit.return || ((exit.price - entry.price) / entry.price * 100),
          type: exit.return >= 0 ? 'WIN' : 'LOSS',
          duration: calculateTradeDuration(entry.date, exit.date)
        })
      }
    }
    
    return tradePairs
  }
  
  const calculateTradeDuration = (entryDate, exitDate) => {
    const entry = new Date(entryDate)
    const exit = new Date(exitDate)
    const diffTime = Math.abs(exit - entry)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }
  
  const tradeTable = createTradePairs()

  const handleTradeClick = (trade) => {
    console.log('Trade clicked:', trade)
    if (onTradeClick) {
      // Pass both entry and exit dates for range zoom
      onTradeClick(trade.entryDate, trade.exitDate)
    }
  }

  return (
    <div className="results-table">
      
      {/* Summary Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <TrendingUp size={18} className="stat-icon positive" />
            <h4>Performance</h4>
          </div>
          <div className="stat-content">
            <div className="stat-row">
              <span>Total Return:</span>
              <span className={data.total_return >= 0 ? 'positive' : 'negative'}>
                {formatPercent(data.total_return)}
              </span>
            </div>
            <div className="stat-row">
              <span>Win Rate:</span>
              <span>{formatPercent(data.win_rate)}</span>
            </div>
            <div className="stat-row">
              <span>Sharpe Ratio:</span>
              <span>{data.sharpe_ratio.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <Target size={18} className="stat-icon" />
            <h4>Strategy Details</h4>
          </div>
          <div className="stat-content">
            <div className="stat-row">
              <span>Pattern:</span>
              <span>Engulfing</span>
            </div>
            <div className="stat-row">
              <span>Timeframe:</span>
              <span>Daily</span>
            </div>
            <div className="stat-row">
              <span>Max Drawdown:</span>
              <span className="negative">{formatPercent(Math.abs(data.max_drawdown))}</span>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <Calendar size={18} className="stat-icon" />
            <h4>Period Info</h4>
          </div>
          <div className="stat-content">
            <div className="stat-row">
              <span>Total Trades:</span>
              <span>{data.total_trades}</span>
            </div>
            <div className="stat-row">
              <span>First Date:</span>
              <span>{data.chart_data?.price_data?.[0]?.date || 'N/A'}</span>
            </div>
            <div className="stat-row">
              <span>Last Date:</span>
              <span>
                {data.chart_data?.price_data?.[data.chart_data.price_data.length - 1]?.date || 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Trades Table */}
      <div className="trades-table-container">
        <h4>
          Trade History 
          <span className="table-hint">
            <ZoomIn size={14} />
            Click on any trade to zoom chart
          </span>
        </h4>
        <div className="table-wrapper">
          <table className="trades-table">
            <thead>
              <tr>
                <th>Date Range</th>
                <th>Type</th>
                <th>Exit Price</th>
                <th>Return</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {tradeTable.map((trade, i) => (
                <tr 
                  key={i} 
                  className={`trade-row clickable-row ${trade.return >= 0 ? 'positive' : 'negative'}`}
                  onClick={() => handleTradeClick(trade)}
                  title="Click to zoom chart to this trade range"
                >
                  <td>
                    <div className="date-range">
                      <div className="entry-date">Entry: {trade.entryDate}</div>
                      <div className="exit-date">Exit: {trade.exitDate}</div>
                    </div>
                  </td>
                  <td>
                    {trade.return >= 0 ? (
                      <span className="win">
                        <TrendingUp size={14} />
                        WIN
                      </span>
                    ) : (
                      <span className="loss">
                        <TrendingDown size={14} />
                        LOSS
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="price-info">
                      <div className="exit-price">₹{trade.exitPrice.toFixed(2)}</div>
                      <div className="entry-price">Entry: ₹{trade.entryPrice.toFixed(2)}</div>
                    </div>
                  </td>
                  <td className={trade.return >= 0 ? 'positive' : 'negative'}>
                    {trade.return >= 0 ? '+' : ''}{trade.return.toFixed(1)}%
                  </td>
                  <td>
                    <span className="duration">{trade.duration} days</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strategy Summary */}
      {data.summary && (
        <div className="strategy-summary">
          <h4>Strategy Summary</h4>
          <div className="summary-content">
            <div className="summary-row">
              <span className="label">Analysis Period:</span>
              <span>{data.summary.period}</span>
            </div>
            <div className="summary-row">
              <span className="label">Strategy Type:</span>
              <span>{data.summary.strategy}</span>
            </div>
            <div className="summary-row">
              <span className="label">Performance Grade:</span>
              <span className={`grade grade-${data.summary.performance_grade?.toLowerCase()}`}>
                {data.summary.performance_grade}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ResultsTable 