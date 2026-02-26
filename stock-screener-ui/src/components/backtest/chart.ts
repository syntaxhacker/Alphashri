/**
 * Candlestick Chart Component
 *
 * ECharts-based candlestick chart with trade markers.
 */

import { getBacktestState, setSelectedChartSymbol, setChartOptions } from '../../state/backtest'
import { fetchChartData } from '../../api/backtest'
import { normalizeTime } from '../../utils/ui-helpers'
import type { SymbolChartData, CandleData, ChartTrade, ORBZone, PivotLevels } from '../../types/backtest'

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
  const { candles, orb_zones, pivot_levels, trades } = data

  console.log('buildChartOption for', data.symbol, {
    candleCount: candles.length,
    orbZoneCount: orb_zones.length,
    pivotLevelCount: pivot_levels?.length || 0,
    tradeCount: trades.length
  })

  // Build candlestick data
  const candleData = candles.map(c => [c.open, c.close, c.low, c.high])
  const timeData = candles.map(c => c.time)

  // Build candle time to index map for matching trades
  const candleTimeMap = new Map(candles.map((c, i) => [normalizeTime(c.time), i]))

  // Also build a date-only map for daily candles (fallback when times don't align)
  const candleDateMap = new Map(candles.map((c, i) => [c.date, i]))

  // Debug: Log sample data
  if (trades.length > 0) {
    console.log('DEBUG: Sample candle dates:', candles.slice(0, 3).map(c => c.date))
    console.log('DEBUG: Sample trade:', { time: trades[0].time, date: trades[0].date, normalizedTime: normalizeTime(trades[0].time) })
    console.log('DEBUG: Candle date map has date:', candleDateMap.has(trades[0].date), 'for date:', trades[0].date)
  }

  // Helper to get candle index for a trade
  const getCandleIdx = (trade: ChartTrade): number | undefined => {
    if (trade.candle_idx !== undefined) return trade.candle_idx

    // First try exact time match
    const normalized = normalizeTime(trade.time)
    let idx = candleTimeMap.get(normalized)

    // If not found, try matching by date only (for daily candles)
    if (idx === undefined && trade.date) {
      idx = candleDateMap.get(trade.date)
    }

    return idx
  }

  // Build trade markers - compute candle_idx if not provided
  // Use bright popping colors that don't match candle colors (green/red)
  const entryMarkers = trades
    .filter(t => t.type === 'entry')
    .map(t => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter(t => t.computedIdx !== undefined)
    .map(t => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: '#00FFFF', borderColor: '#FFFFFF', borderWidth: 2 },  // Bright cyan with white border
      symbol: 'triangle',
      symbolRotate: 180,
      symbolSize: 18,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  const tpMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'TP')
    .map(t => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter(t => t.computedIdx !== undefined)
    .map(t => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: '#FFFF00', borderColor: '#FFFFFF', borderWidth: 2 },  // Bright yellow with white border
      symbol: 'circle',
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  const slMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'SL')
    .map(t => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter(t => t.computedIdx !== undefined)
    .map(t => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: '#FF00FF', borderColor: '#FFFFFF', borderWidth: 2 },  // Magenta with white border
      symbol: 'circle',
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  const eodMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'EOD')
    .map(t => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter(t => t.computedIdx !== undefined)
    .map(t => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: '#FFA500', borderColor: '#FFFFFF', borderWidth: 2 },  // Bright orange with white border
      symbol: 'diamond',
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  // 52W Chaser: Trailing Stop exits
  const trailingMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'TRAILING_STOP')
    .map(t => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter(t => t.computedIdx !== undefined)
    .map(t => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: '#9C27B0', borderColor: '#FFFFFF', borderWidth: 2 },  // Purple
      symbol: 'circle',
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  // 52W Chaser: Max Holding exits
  const maxHoldMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'MAX_HOLDING')
    .map(t => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter(t => t.computedIdx !== undefined)
    .map(t => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: '#FF9800', borderColor: '#FFFFFF', borderWidth: 2 },  // Orange
      symbol: 'diamond',
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  // 52W Chaser: New 52W High exits
  const new52wMarkers = trades
    .filter(t => t.type === 'exit' && t.trade.exit_reason === 'NEW_52W_HIGH')
    .map(t => ({ ...t, computedIdx: getCandleIdx(t) }))
    .filter(t => t.computedIdx !== undefined)
    .map(t => ({
      value: [t.computedIdx!, t.price],
      itemStyle: { color: '#00BCD4', borderColor: '#FFFFFF', borderWidth: 2 },  // Cyan
      symbol: 'circle',
      symbolSize: 16,
      trade: t.trade,
      trade_id: t.trade_id,
    }))

  console.log('Markers built:', {
    entry: entryMarkers.length,
    tp: tpMarkers.length,
    sl: slMarkers.length,
    eod: eodMarkers.length,
    trailing: trailingMarkers.length,
    maxHold: maxHoldMarkers.length,
    new52w: new52wMarkers.length
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
      textStyle: { color: '#e0e0e0', fontSize: 10 },
      formatter: function(params: any) {
        // Helper function to format date compact: "12th Jan 10:30" or "12th Jan" for daily
        const formatDateTimeCompact = (isoStr: string) => {
          if (!isoStr) return '-'
          const parts = isoStr.split('T')
          const datePart = parts[0]
          const timePart = parts[1]?.replace(/Z|\+00:00|\+05:30/g, '').substring(0, 5) || ''
          const [year, month, day] = datePart.split('-')
          const d = parseInt(day)
          const m = parseInt(month) - 1
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th'
          // If no time part or time is 00:00, show date only (daily candles)
          if (!timePart || timePart === '00:00') {
            return `${d}${suffix} ${months[m]}`
          }
          return `${d}${suffix} ${months[m]} ${timePart}`
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

            // Compact horizontal layout
            return `
              <div style="padding: 6px 8px; font-family: 'SF Mono', Monaco, monospace; font-size: 10px; line-height: 1.4;">
                <div style="color: #00BFFF; font-weight: bold; margin-bottom: 4px;">
                  Trade #${p.data.trade_id} | ${t.exit_reason}
                </div>
                <div style="color: #888; margin-bottom: 4px; font-size: 9px;">
                  ${formatDateTimeCompact(t.entry_time)} → ${formatDateTimeCompact(t.exit_time)} (${holdStr})
                </div>
                <div style="display: flex; gap: 12px; margin-bottom: 2px;">
                  <span>Entry: <b>₹${t.entry_price.toFixed(0)}</b></span>
                  <span>Exit: <b>₹${t.exit_price.toFixed(0)}</b></span>
                  <span>Qty: ${t.quantity}</span>
                </div>
                <div style="display: flex; gap: 12px;">
                  <span>Gross: ₹${t.gross_pnl.toFixed(0)}</span>
                  <span>Cost: ₹${t.trading_costs.toFixed(0)}</span>
                  <span style="color: ${pnlColor}; font-weight: bold;">
                    Net: ₹${t.net_pnl.toFixed(0)} (${t.net_pnl_pct >= 0 ? '+' : ''}${t.net_pnl_pct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            `
          }
        }

        // Candlestick tooltip - compact
        const candle = params.find((p: any) => p.seriesType === 'candlestick')
        if (candle) {
          const idx = candle.dataIndex
          const c = candles[idx]
          const change = ((c.close - c.open) / c.open * 100).toFixed(2)
          const changeColor = c.close >= c.open ? '#00E676' : '#FF1744'

          return `
            <div style="padding: 6px 8px; font-family: 'SF Mono', Monaco, monospace; font-size: 10px; line-height: 1.4;">
              <div style="font-weight: bold; margin-bottom: 4px;">${c.date} ${c.time_str}</div>
              <div style="display: flex; gap: 12px;">
                <span>O: ₹${c.open.toFixed(0)}</span>
                <span>H: ₹${c.high.toFixed(0)}</span>
                <span>L: ₹${c.low.toFixed(0)}</span>
                <span>C: ₹${c.close.toFixed(0)}</span>
              </div>
              <div style="display: flex; gap: 12px; color: #888;">
                <span style="color: ${changeColor}; font-weight: bold;">${c.close >= c.open ? '+' : ''}${change}%</span>
                <span>Vol: ${(c.volume / 1000).toFixed(0)}K</span>
              </div>
            </div>
          `
        }
        return ''
      },
    },
    legend: {
      data: [
        'Price', 'Entry', 'TP', 'SL', 'EOD',
        // Add pivot levels for S/R Breakout strategy
        ...(pivot_levels && pivot_levels.length > 0 ? ['R1', 'PP', 'S1'] : []),
        // Add ORB zones for ORB strategy
        ...(orb_zones && orb_zones.length > 0 ? ['OR High', 'OR Low'] : []),
      ],
      bottom: 5,
      itemWidth: 14,
      itemHeight: 10,
      itemGap: 8,
      textStyle: { color: '#888', fontSize: 10 },
      type: 'scroll',
      pageIconColor: '#888',
      pageIconInactiveColor: '#333',
      pageTextStyle: { color: '#888', fontSize: 10 },
    },
    grid: {
      left: '8%',
      right: '8%',
      bottom: '22%',
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
        name: 'TP',
        type: 'scatter',
        data: tpMarkers,
        symbolSize: 14,
        z: 10,
      },
      {
        name: 'SL',
        type: 'scatter',
        data: slMarkers,
        symbolSize: 14,
        z: 10,
      },
      {
        name: 'EOD',
        type: 'scatter',
        data: eodMarkers,
        symbolSize: 14,
        z: 10,
      },
      // Pivot level lines (R1, S1, PP) for S/R Breakout strategy
      ...(buildPivotLevelSeries(candles, pivot_levels) || []),
    ],
  }
}

/**
 * Build ECharts line series for pivot levels.
 * Each level (R1, PP, S1) is shown as a horizontal line for its day.
 */
function buildPivotLevelSeries(candles: CandleData[], pivotLevels?: PivotLevels[]): any[] {
  if (!pivotLevels || pivotLevels.length === 0) {
    return []
  }

  // Build sparse data arrays: value on the level's date, null elsewhere
  const r1Data = candles.map(c => {
    const level = pivotLevels.find(p => p.date_raw === c.date)
    return level ? level.r1 : null
  })

  const s1Data = candles.map(c => {
    const level = pivotLevels.find(p => p.date_raw === c.date)
    return level ? level.s1 : null
  })

  const ppData = candles.map(c => {
    const level = pivotLevels.find(p => p.date_raw === c.date)
    return level ? level.pp : null
  })

  return [
    {
      id: 'pivot-r1',
      name: 'R1',
      type: 'line',
      data: r1Data,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 5,
      lineStyle: {
        color: '#EF5350',  // Red for resistance
        width: 1,
        type: 'dashed',
      },
      tooltip: {
        show: true,
        formatter: (params: any) => {
          if (params.value === null) return ''
          return `<span style="color:#EF5350">R1 (Resistance): ₹${params.value.toFixed(2)}</span>`
        }
      },
    },
    {
      id: 'pivot-pp',
      name: 'PP',
      type: 'line',
      data: ppData,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 5,
      lineStyle: {
        color: '#AB47BC',  // Purple for pivot
        width: 1,
        type: 'dotted',
      },
      tooltip: {
        show: true,
        formatter: (params: any) => {
          if (params.value === null) return ''
          return `<span style="color:#AB47BC">PP (Pivot): ₹${params.value.toFixed(2)}</span>`
        }
      },
    },
    {
      id: 'pivot-s1',
      name: 'S1',
      type: 'line',
      data: s1Data,
      showSymbol: false,
      connectNulls: false,
      silent: true,
      z: 5,
      lineStyle: {
        color: '#26A69A',  // Teal for support
        width: 1,
        type: 'dashed',
      },
      tooltip: {
        show: true,
        formatter: (params: any) => {
          if (params.value === null) return ''
          return `<span style="color:#26A69A">S1 (Support): ₹${params.value.toFixed(2)}</span>`
        }
      },
    },
  ]
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
    console.log('zoomToTrade called for trade index:', tradeIndex)
    const state = getBacktestState()
    // Use selected symbol, or fallback to first result's symbol
    const symbol = state.selectedChartSymbol || state.results?.[0]?.symbol
    console.log('Selected symbol:', symbol)
    if (!symbol) return

    const chartData = state.chartData.get(symbol)
    if (!chartData) return

    // Get the entry and exit markers for this trade (tradeIndex is 0-based, trades are 1-based in trade_id)
    const entryMarker = chartData.trades.find(t => t.type === 'entry' && t.trade_id === tradeIndex + 1)
    const exitMarker = chartData.trades.find(t => t.type === 'exit' && t.trade_id === tradeIndex + 1)

    if (!entryMarker) {
      console.warn('Entry marker not found for trade', tradeIndex + 1)
      return
    }

    let chart = chartInstances.get(symbol)
    if (!chart) {
      // Chart not initialized yet, try to initialize it
      console.log('Chart not initialized, attempting to init for', symbol)
      initCharts()
      chart = chartInstances.get(symbol)
      if (!chart) {
        console.warn('Chart instance still not found for', symbol)
        return
      }
    }

    // Find candle index - either from pre-computed candle_idx or by matching time
    let entryIdx = entryMarker.candle_idx
    let exitIdx = exitMarker?.candle_idx

    if (entryIdx === undefined) {
      // Find candle by matching time
      const entryTime = normalizeTime(entryMarker.time)
      const candleIndexMap = new Map(chartData.candles.map((c, i) => [normalizeTime(c.time), i]))
      entryIdx = candleIndexMap.get(entryTime)
    }

    if (exitIdx === undefined && exitMarker) {
      const exitTime = normalizeTime(exitMarker.time)
      const candleIndexMap = new Map(chartData.candles.map((c, i) => [normalizeTime(c.time), i]))
      exitIdx = candleIndexMap.get(exitTime)
    }

    if (entryIdx === undefined) {
      console.warn('Could not find candle index for trade', tradeIndex + 1)
      return
    }

    exitIdx = exitIdx ?? entryIdx
    const selectedTrade = entryMarker.trade

    // Extract date from the normalized time (which is in IST) instead of raw entry_time (which is in UTC)
    // This ensures we match the candle's date field correctly
    const normalizedEntryTime = normalizeTime(entryMarker.time)
    const selectedDate = normalizedEntryTime.split('T')[0]

    const totalCandles = chartData.candles.length

    // Zoom to full day for the selected trade.
    // Fallback to entry/exit padded range if day boundaries aren't found.
    let startIdx = entryIdx
    let endIdx = exitIdx
    if (selectedDate) {
      const dayIndices = chartData.candles
        .map((c, idx) => ({ date: c.date, idx }))
        .filter(item => item.date === selectedDate)
        .map(item => item.idx)

      if (dayIndices.length > 0) {
        startIdx = dayIndices[0]
        endIdx = dayIndices[dayIndices.length - 1]
      } else {
        const padding = 5
        startIdx = Math.max(0, entryIdx - padding)
        endIdx = Math.min(totalCandles - 1, exitIdx + padding)
      }
    } else {
      const padding = 5
      startIdx = Math.max(0, entryIdx - padding)
      endIdx = Math.min(totalCandles - 1, exitIdx + padding)
    }

    // Convert to percentage for dataZoom
    const startPercent = (startIdx / totalCandles) * 100
    const endPercent = ((endIdx + 1) / totalCandles) * 100

    console.log(`Zooming to trade ${tradeIndex + 1} day: candles ${startIdx} to ${endIdx} (${startPercent.toFixed(1)}% - ${endPercent.toFixed(1)}%)`)

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

    // Show level lines only for the selected trade day.
    // Build sparse line series: value on selected date candles, null elsewhere.
    // Works for both ORB (or_high/or_low) and S/R Breakout (r1/s1)
    if (selectedTrade && selectedDate) {
      const levelHigh = selectedTrade.or_high ?? selectedTrade.r1
      const levelLow = selectedTrade.or_low ?? selectedTrade.s1

      const levelHighData = chartData.candles.map(c => (c.date === selectedDate ? levelHigh : null))
      const levelLowData = chartData.candles.map(c => (c.date === selectedDate ? levelLow : null))

      chart.setOption({
        series: [
          {
            id: 'selected-or-high',
            name: 'Selected Level High',
            type: 'line',
            data: levelHighData,
            showSymbol: false,
            connectNulls: false,
            silent: true,
            z: 6,
            lineStyle: {
              color: '#42A5F5',
              width: 2,
              type: 'dashed',
            },
            tooltip: { show: false },
          },
          {
            id: 'selected-or-low',
            name: 'Selected Level Low',
            type: 'line',
            data: levelLowData,
            showSymbol: false,
            connectNulls: false,
            silent: true,
            z: 6,
            lineStyle: {
              color: '#1E88E5',
              width: 2,
              type: 'dashed',
            },
            tooltip: { show: false },
          },
        ],
      })
    }
  }
}
