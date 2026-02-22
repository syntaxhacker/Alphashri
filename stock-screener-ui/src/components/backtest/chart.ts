/**
 * Candlestick Chart Component
 *
 * ECharts-based candlestick chart with trade markers.
 */

import { getBacktestState, setSelectedChartSymbol, setChartOptions } from '../../state/backtest'
import { fetchChartData } from '../../api/backtest'
import type { SymbolChartData, CandleData, ChartTrade, ORBZone } from '../../types/backtest'

// Chart instances storage
const chartInstances: Map<string, any> = new Map()

export function renderChartContainer(): string {
  const state = getBacktestState()

  if (!state.showCharts || !state.results || state.results.length === 0) {
    return `
      <div class="chart-container chart-placeholder-full" data-testid="chart-container">
        <p>Select a symbol to view chart</p>
      </div>
    `
  }

  const symbols = state.results.map(r => r.symbol)
  const selectedSymbol = state.selectedChartSymbol || symbols[0] || null

  return `
    <div class="chart-container" data-testid="chart-container">
      <div class="chart-header">
        <div class="chart-tabs" data-testid="chart-tabs">
          ${symbols.map(s => `
            <button
              class="chart-tab ${s === selectedSymbol ? 'active' : ''}"
              data-symbol="${s}"
              onclick="window.selectChartSymbol('${s}')"
            >
              ${s}
            </button>
          `).join('')}
        </div>
        <select
          class="chart-zoom-select"
          onchange="window.setChartZoom(this.value)"
        >
          <option value="all">All</option>
          <option value="30d">30D</option>
          <option value="7d">7D</option>
          <option value="1d">1D</option>
        </select>
      </div>

      <div class="chart-body">
        ${selectedSymbol ? renderChart(selectedSymbol, state.chartData.get(selectedSymbol)) : `
          <div class="chart-placeholder">
            <p>Loading...</p>
          </div>
        `}
      </div>

      <div class="chart-legend">
        <span class="legend-item"><span class="legend-marker entry"></span> Entry</span>
        <span class="legend-item"><span class="legend-marker tp"></span> TP</span>
        <span class="legend-item"><span class="legend-marker sl"></span> SL</span>
        <span class="legend-item"><span class="legend-marker eod"></span> EOD</span>
      </div>
    </div>
  `
}

function renderChart(symbol: string, chartData: SymbolChartData | undefined): string {
  if (!chartData) {
    return `
      <div class="chart-loading" data-testid="chart-loading">
        <p>Loading ${symbol}...</p>
      </div>
    `
  }

  return `
    <div
      id="echarts-${symbol}"
      class="echarts-container"
      data-testid="echarts-container"
      data-symbol="${symbol}"
      style="width: 100%; height: 100%;"
    ></div>
  `
}

// Initialize ECharts after DOM is ready
export function initCharts() {
  const state = getBacktestState()

  if (!state.showCharts || !state.results) return

  // Only render the selected symbol's chart
  const selectedSymbol = state.selectedChartSymbol || state.results[0]?.symbol
  if (!selectedSymbol) return

  const chartData = state.chartData.get(selectedSymbol)
  if (chartData) {
    console.log('initCharts: Rendering chart for', selectedSymbol)
    renderECharts(selectedSymbol, chartData)
  } else {
    console.log('initCharts: No chart data for', selectedSymbol)
  }
}

function renderECharts(symbol: string, chartData: SymbolChartData) {
  const container = document.getElementById(`echarts-${symbol}`)
  console.log('renderECharts:', symbol, 'container:', !!container, 'candles:', chartData.candles.length)

  if (!container) {
    console.warn('Container not found for', symbol)
    return
  }

  // Check if echarts is available
  if (!(window as any).echarts) {
    console.error('ECharts not loaded')
    return
  }

  // Destroy existing chart
  const existingChart = chartInstances.get(symbol)
  if (existingChart) {
    existingChart.dispose()
  }

  // Create new chart
  const chart = (window as any).echarts.init(container)
  chartInstances.set(symbol, chart)

  const option = buildChartOption(chartData)
  chart.setOption(option)

  // Handle resize
  window.addEventListener('resize', () => chart.resize())
}

function buildChartOption(data: SymbolChartData): any {
  const { candles, orb_zones, trades } = data

  console.log('buildChartOption for', data.symbol, {
    candleCount: candles.length,
    orbZoneCount: orb_zones.length,
    tradeCount: trades.length
  })

  // Build candlestick data
  const candleData = candles.map(c => [c.open, c.close, c.low, c.high])
  const timeData = candles.map(c => c.time)

  // Build trade markers using pre-computed candle_idx from chartBuilder
  // chartBuilder already matches trade times to candle indices
  const entryMarkers = trades
    .filter(t => t.type === 'entry' && t.candle_idx !== undefined)
    .map(t => ({
      value: [t.candle_idx!, t.price],
      itemStyle: { color: '#00BFFF' },
      symbol: 'triangle',
      symbolRotate: 180,
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  const tpMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'TP' && t.candle_idx !== undefined)
    .map(t => ({
      value: [t.candle_idx!, t.price],
      itemStyle: { color: '#00E676' },
      symbol: 'circle',
      symbolSize: 14,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  const slMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'SL' && t.candle_idx !== undefined)
    .map(t => ({
      value: [t.candle_idx!, t.price],
      itemStyle: { color: '#FF1744' },
      symbol: 'circle',
      symbolSize: 14,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  const eodMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'EOD' && t.candle_idx !== undefined)
    .map(t => ({
      value: [t.candle_idx!, t.price],
      itemStyle: { color: '#FFEA00' },
      symbol: 'diamond',
      symbolSize: 14,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  console.log('Markers built:', {
    entry: entryMarkers.length,
    tp: tpMarkers.length,
    sl: slMarkers.length,
    eod: eodMarkers.length
  })

  return {
    backgroundColor: '#0a0a0a',
    title: {
      text: `${data.symbol} - Backtest Results`,
      left: 'center',
      textStyle: { fontSize: 14, color: '#e0e0e0' },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#666' } },
      backgroundColor: 'rgba(20, 20, 20, 0.95)',
      borderColor: '#333',
      borderWidth: 1,
      textStyle: { color: '#e0e0e0' },
      formatter: function(params: any) {
        // Helper function to format date human-readable: "12th Thu Jan 2025"
        const formatDateHuman = (dateStr: string) => {
          // dateStr is YYYY-MM-DD
          const [year, month, day] = dateStr.split('-')
          const d = parseInt(day)
          const m = parseInt(month) - 1
          const y = parseInt(year)

          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          const date = new Date(y, m, d)
          const dayName = days[date.getDay()]
          const monthName = months[m]
          const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th'
          return `${d}${suffix} ${dayName} ${monthName} ${y}`
        }

        // Format time from ISO string to human readable
        const formatTime = (isoStr: string) => {
          if (!isoStr) return '-'
          const parts = isoStr.split('T')
          const datePart = parts[0] // YYYY-MM-DD
          const timePart = parts[1]?.replace('Z', '').replace(/\+00:00/g, '').replace(/\+05:30/g, '').substring(0, 5)
          return `${formatDateHuman(datePart)} ${timePart}`
        }

        // Find if this is a trade marker
        for (const p of params) {
          if (p.data && p.data.trade) {
            const t = p.data.trade
            const holdHours = Math.floor(t.hold_duration_minutes / 60)
            const holdMins = t.hold_duration_minutes % 60
            const holdStr = holdHours > 0 ? `${holdHours}h ${holdMins}m` : `${holdMins}m`
            const pnlColor = t.net_pnl >= 0 ? '#00E676' : '#FF1744'
            const exitColor = t.exit_reason === 'TP' ? '#00E676' : t.exit_reason === 'SL' ? '#FF1744' : '#FFEA00'

            return `
              <div style="padding: 10px; font-family: 'SF Mono', Monaco, monospace; font-size: 11px; line-height: 1.5;">
                <div style="font-size: 12px; font-weight: bold; margin-bottom: 6px; color: #00BFFF;">
                  📊 Trade #${p.data.trade_id || ''}
                </div>
                <div style="color: #888; margin-bottom: 4px;">
                  Entry: ${formatTime(t.entry_time)}<br/>
                  Exit: ${formatTime(t.exit_time)}
                </div>
                <hr style="border-color: #333; margin: 6px 0;"/>
                <table style="width: 100%;">
                  <tr><td style="color: #888;">Entry:</td><td style="text-align: right;">₹${t.entry_price.toFixed(2)}</td></tr>
                  <tr><td style="color: #888;">Exit:</td><td style="text-align: right;">₹${t.exit_price.toFixed(2)}</td></tr>
                  <tr><td style="color: #888;">Qty:</td><td style="text-align: right;">${t.quantity}</td></tr>
                </table>
                <hr style="border-color: #333; margin: 6px 0;"/>
                <table style="width: 100%;">
                  <tr><td style="color: #888;">Gross P&L:</td><td style="text-align: right;">₹${t.gross_pnl.toFixed(0)}</td></tr>
                  <tr><td style="color: #888;">Costs:</td><td style="text-align: right;">₹${t.trading_costs.toFixed(0)}</td></tr>
                  <tr>
                    <td style="color: #888;">Net P&L:</td>
                    <td style="text-align: right; color: ${pnlColor}; font-weight: bold;">
                      ₹${t.net_pnl.toFixed(0)} (${t.net_pnl_pct >= 0 ? '+' : ''}${t.net_pnl_pct.toFixed(2)}%)
                    </td>
                  </tr>
                </table>
                <hr style="border-color: #333; margin: 6px 0;"/>
                <table style="width: 100%;">
                  <tr><td style="color: #888;">Exit:</td><td style="text-align: right; color: ${exitColor}; font-weight: bold;">${t.exit_reason}</td></tr>
                  <tr><td style="color: #888;">Hold:</td><td style="text-align: right;">${holdStr}</td></tr>
                  <tr><td style="color: #00E676;">ORB High:</td><td style="text-align: right;">₹${t.or_high?.toFixed(2) || '-'}</td></tr>
                  <tr><td style="color: #FF1744;">ORB Low:</td><td style="text-align: right;">₹${t.or_low?.toFixed(2) || '-'}</td></tr>
                </table>
              </div>
            `
          }
        }

        // Candlestick tooltip
        const candle = params.find((p: any) => p.seriesType === 'candlestick')
        if (candle) {
          const idx = candle.dataIndex
          const c = candles[idx]
          const change = ((c.close - c.open) / c.open * 100).toFixed(2)
          const changeColor = c.close >= c.open ? '#00E676' : '#FF1744'

          return `
            <div style="padding: 10px; font-family: 'SF Mono', Monaco, monospace; font-size: 11px; line-height: 1.5;">
              <div style="font-size: 12px; font-weight: bold; margin-bottom: 6px;">
                📅 ${formatDateHuman(c.date)} ${c.time_str}
              </div>
              <hr style="border-color: #333; margin: 6px 0;"/>
              <table style="width: 100%;">
                <tr><td style="color: #888;">Open:</td><td style="text-align: right;">₹${c.open.toFixed(2)}</td></tr>
                <tr><td style="color: #888;">High:</td><td style="text-align: right;">₹${c.high.toFixed(2)}</td></tr>
                <tr><td style="color: #888;">Low:</td><td style="text-align: right;">₹${c.low.toFixed(2)}</td></tr>
                <tr><td style="color: #888;">Close:</td><td style="text-align: right;">₹${c.close.toFixed(2)}</td></tr>
                <tr>
                  <td style="color: #888;">Change:</td>
                  <td style="text-align: right; color: ${changeColor};">${c.close >= c.open ? '+' : ''}${change}%</td>
                </tr>
                <tr><td style="color: #888;">Volume:</td><td style="text-align: right;">${(c.volume / 1000).toFixed(0)}K</td></tr>
              </table>
            </div>
          `
        }
        return ''
      },
    },
    legend: {
      data: ['Price', 'Entry', 'TP Exit', 'SL Exit', 'EOD Exit'],
      bottom: 10,
      textStyle: { color: '#888' },
    },
    grid: {
      left: '8%',
      right: '8%',
      bottom: '18%',
      top: '15%',
    },
    xAxis: {
      type: 'category',
      data: timeData,
      scale: true,
      splitLine: { show: false, lineStyle: { color: '#222' } },
      axisLine: { lineStyle: { color: '#333' } },
      axisLabel: {
        color: '#888',
        rotate: 45,
        formatter: function(value: string) {
          // Value is "2025-10-24T09:15" (YYYY-MM-DDTHH:MM)
          if (!value || !value.includes('T')) return value
          const parts = value.split('T')
          const datePart = parts[0] // "2025-10-24"
          const timePart = parts[1] || '' // "09:15"
          const [year, month, day] = datePart.split('-')
          const d = parseInt(day)
          const m = parseInt(month)
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th'
          return `${d}${suffix} ${months[m - 1]} ${timePart}`
        },
      },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.01)'] } },
      splitLine: { lineStyle: { color: '#222' } },
      axisLine: { lineStyle: { color: '#333' } },
      axisLabel: {
        color: '#888',
        formatter: function(value: number) {
          return '₹' + value.toFixed(0)
        },
      },
    },
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100,
        borderColor: '#333',
        fillerColor: 'rgba(0, 230, 118, 0.1)',
        handleStyle: { color: '#00E676' },
      },
      {
        type: 'slider',
        show: true,
        start: 0,
        end: 100,
        bottom: 40,
        borderColor: '#333',
        backgroundColor: '#111',
        fillerColor: 'rgba(0, 230, 118, 0.1)',
        handleStyle: { color: '#00E676' },
        textStyle: { color: '#666' },
      },
    ],
    series: [
      {
        name: 'Price',
        type: 'candlestick',
        data: candleData,
        itemStyle: {
          color: '#00E676',       // Bullish - bright green
          color0: '#FF1744',      // Bearish - bright red
          borderColor: '#00E676',
          borderColor0: '#FF1744',
        },
      },
      {
        name: 'Entry',
        type: 'scatter',
        data: entryMarkers,
        symbolSize: 16,
        z: 10,
      },
      {
        name: 'TP Exit',
        type: 'scatter',
        data: tpMarkers,
        symbolSize: 14,
        z: 10,
      },
      {
        name: 'SL Exit',
        type: 'scatter',
        data: slMarkers,
        symbolSize: 14,
        z: 10,
      },
      {
        name: 'EOD Exit',
        type: 'scatter',
        data: eodMarkers,
        symbolSize: 14,
        z: 10,
      },
    ],
  }
}

// Register window handlers
export function initChartHandlers() {
  ;(window as any).selectChartSymbol = (symbol: string) => {
    setSelectedChartSymbol(symbol)

    // Fetch chart data if not loaded
    const state = getBacktestState()
    if (!state.chartData.has(symbol)) {
      fetchChartData(symbol)
    }
  }

  ;(window as any).setChartZoom = (zoom: string) => {
    setChartOptions({ date_range: zoom as any })
  }

  // Zoom chart to a specific trade
  ;(window as any).zoomToTrade = (tradeIndex: number) => {
    const state = getBacktestState()
    const symbol = state.selectedChartSymbol
    if (!symbol) return

    const chartData = state.chartData.get(symbol)
    if (!chartData) return

    // Get the entry and exit markers for this trade (tradeIndex is 0-based, trades are 1-based in trade_id)
    const entryMarker = chartData.trades.find(t => t.type === 'entry' && t.trade_id === tradeIndex + 1)
    const exitMarker = chartData.trades.find(t => t.type === 'exit' && t.trade_id === tradeIndex + 1)

    if (!entryMarker || entryMarker.candle_idx === undefined) {
      console.warn('Entry marker not found for trade', tradeIndex + 1)
      return
    }

    const chart = chartInstances.get(symbol)
    if (!chart) {
      console.warn('Chart instance not found for', symbol)
      return
    }

    const entryIdx = entryMarker.candle_idx
    const exitIdx = exitMarker?.candle_idx ?? entryIdx

    // Calculate zoom range with some padding (5 candles on each side)
    const padding = 5
    const totalCandles = chartData.candles.length
    const startIdx = Math.max(0, entryIdx - padding)
    const endIdx = Math.min(totalCandles - 1, exitIdx + padding)

    // Convert to percentage for dataZoom
    const startPercent = (startIdx / totalCandles) * 100
    const endPercent = ((endIdx + 1) / totalCandles) * 100

    console.log(`Zooming to trade ${tradeIndex + 1}: candles ${startIdx} to ${endIdx} (${startPercent.toFixed(1)}% - ${endPercent.toFixed(1)}%)`)

    // Apply zoom to the chart
    chart.dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 0,
      start: startPercent,
      end: endPercent,
    })

    // Also update the slider
    chart.dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 1,
      start: startPercent,
      end: endPercent,
    })
  }
}
