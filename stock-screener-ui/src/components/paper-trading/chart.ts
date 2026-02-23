/**
 * Paper Trading Chart Component
 *
 * ECharts-based candlestick chart for paper trading.
 * Reuses the same chart implementation as backtest.
 */

import { getPaperTradingState } from '../../state/paperTrading'
import type { PaperChartData, CandleData, PaperTrade, PaperPosition } from '../../types/paperTrading'

// ECharts type
declare const echarts: any

// Chart instance
let chartInstance: any = null

export function renderChartContainer(): string {
  const state = getPaperTradingState()

  if (!state.selectedSymbol) {
    return `
      <div class="paper-chart-container chart-placeholder-full" data-testid="paper-chart-container">
        <div class="chart-placeholder-content">
          <span class="placeholder-icon">📈</span>
          <p>Select a position or trade to view chart</p>
        </div>
      </div>
    `
  }

  if (state.chartLoading) {
    return `
      <div class="paper-chart-container" data-testid="paper-chart-container">
        <div class="chart-loading">
          <p>Loading ${state.selectedSymbol} chart...</p>
        </div>
      </div>
    `
  }

  if (!state.chartData) {
    return `
      <div class="paper-chart-container" data-testid="paper-chart-container">
        <div class="chart-error">
          <span class="error-icon">⚠️</span>
          <p>No data available for ${state.selectedSymbol}</p>
          <p class="error-hint">Stock data may not be available or symbol is invalid</p>
        </div>
      </div>
    `
  }

  // Check if chartData has actual candles
  if (!state.chartData.candles || state.chartData.candles.length === 0) {
    return `
      <div class="paper-chart-container" data-testid="paper-chart-container">
        <div class="chart-error">
          <span class="error-icon">⚠️</span>
          <p>No candle data for ${state.selectedSymbol}</p>
          <p class="error-hint">Market may be closed or data unavailable for this date</p>
        </div>
      </div>
    `
  }

  return `
    <div class="paper-chart-container" data-testid="paper-chart-container">
      <div class="paper-chart-header">
        <h4>${state.chartData.symbol} - ${state.chartData.date}</h4>
        ${state.chartData.current_position ? renderPositionInfo(state.chartData.current_position) : ''}
      </div>
      <div
        id="paper-echarts"
        class="echarts-container"
        data-testid="paper-echarts"
        style="width: 100%; height: calc(100% - 60px);"
      ></div>
      <div class="chart-legend">
        <span class="legend-item"><span class="legend-marker entry"></span> Entry</span>
        <span class="legend-item"><span class="legend-marker tp"></span> TP</span>
        <span class="legend-item"><span class="legend-marker sl"></span> SL</span>
      </div>
    </div>
  `
}

function renderPositionInfo(position: PaperPosition): string {
  const pnlClass = position.pnl >= 0 ? 'positive' : 'negative'
  const sideIcon = position.side === 'BUY' ? '▲' : '▼'

  return `
    <div class="position-info ${pnlClass}">
      <span>${sideIcon} ${position.side} ${position.quantity} @ ₹${position.entry_price.toFixed(2)}</span>
      <span>P&L: ₹${position.pnl.toFixed(0)} (${position.pnl_pct >= 0 ? '+' : ''}${position.pnl_pct.toFixed(2)}%)</span>
    </div>
  `
}

export function initChartHandlers() {
  // Chart handlers are initialized after render
}

// Initialize ECharts after DOM is ready
export function initPaperChart() {
  const state = getPaperTradingState()

  if (!state.chartData || !state.selectedSymbol) return

  const chartDom = document.getElementById('paper-echarts')
  if (!chartDom) return

  // Dispose old instance
  if (chartInstance) {
    chartInstance.dispose()
  }

  chartInstance = echarts.init(chartDom, 'dark')

  const option = buildChartOption(state.chartData)
  chartInstance.setOption(option)

  // Resize handler
  window.addEventListener('resize', () => {
    chartInstance?.resize()
  })
}

function buildChartOption(data: PaperChartData) {
  const { candles, trades, orb_levels, current_position } = data

  if (!candles || candles.length === 0) {
    return {}
  }

  console.log('buildChartOption for paper trading:', {
    candleCount: candles.length,
    tradeCount: trades.length,
    hasCurrentPosition: !!current_position,
    orbLevels: orb_levels
  })

  // Build OHLC data for candlestick
  const ohlcData = candles.map((c: CandleData) => [
    c.open,
    c.close,
    c.low,
    c.high,
  ])

  // Build volume data
  const volumeData = candles.map((c: CandleData, i: number) => [
    i,
    c.volume,
    c.close >= c.open ? 1 : -1,  // Color based on direction
  ])

  // Build x-axis labels (time)
  const times = candles.map((c: CandleData) => {
    const time = c.time.split('T')[1]?.substring(0, 5) || c.time
    return time
  })

  // Build trade markers using scatter series (like backtest)
  // Use bright popping colors that don't match candle colors
  const entryMarkers: any[] = []
  const tpMarkers: any[] = []
  const slMarkers: any[] = []
  const eodMarkers: any[] = []

  // Add completed trades
  trades.forEach((trade: PaperTrade, idx: number) => {
    const entryIdx = findCandleIndex(candles, trade.entry_time)
    const exitIdx = findCandleIndex(candles, trade.exit_time)

    console.log(`Trade ${idx}: ${trade.symbol}`, {
      entryTime: trade.entry_time,
      exitTime: trade.exit_time,
      entryIdx,
      exitIdx,
      side: trade.side,
      exitReason: trade.exit_reason
    })

    if (entryIdx >= 0) {
      entryMarkers.push({
        value: [entryIdx, trade.entry_price],
        itemStyle: { color: '#00FFFF', borderColor: '#FFFFFF', borderWidth: 2 },  // Bright cyan
        symbol: trade.side === 'BUY' ? 'triangle' : 'triangleRotated',
        symbolSize: 18,
        trade: trade,
      })
    }

    if (exitIdx >= 0) {
      if (trade.exit_reason === 'TP') {
        tpMarkers.push({
          value: [exitIdx, trade.exit_price],
          itemStyle: { color: '#FFFF00', borderColor: '#FFFFFF', borderWidth: 2 },  // Bright yellow
          symbol: 'circle',
          symbolSize: 16,
          trade: trade,
        })
      } else if (trade.exit_reason === 'SL') {
        slMarkers.push({
          value: [exitIdx, trade.exit_price],
          itemStyle: { color: '#FF00FF', borderColor: '#FFFFFF', borderWidth: 2 },  // Magenta
          symbol: 'circle',
          symbolSize: 16,
          trade: trade,
        })
      } else {
        eodMarkers.push({
          value: [exitIdx, trade.exit_price],
          itemStyle: { color: '#FFA500', borderColor: '#FFFFFF', borderWidth: 2 },  // Orange
          symbol: 'diamond',
          symbolSize: 16,
          trade: trade,
        })
      }
    }
  })

  // Add current position if exists
  if (current_position) {
    const entryIdx = findCandleIndex(candles, current_position.entry_time)
    console.log('Current position:', {
      entryTime: current_position.entry_time,
      entryIdx,
      side: current_position.side
    })

    if (entryIdx >= 0) {
      entryMarkers.push({
        value: [entryIdx, current_position.entry_price],
        itemStyle: { color: '#00FFFF', borderColor: '#FFFFFF', borderWidth: 3 },
        symbol: current_position.side === 'BUY' ? 'triangle' : 'triangleRotated',
        symbolSize: 22,
        trade: current_position,
        label: {
          show: true,
          formatter: 'LIVE',
          position: 'top',
          color: '#fff',
          fontSize: 10,
        },
      })
    }
  }

  // Build mark lines for SL/TP
  const markLines: any[] = []

  if (current_position) {
    markLines.push({
      name: 'SL',
      yAxis: current_position.stop_loss,
      lineStyle: { color: '#FF00FF', type: 'dashed', width: 2 },
      label: { formatter: 'SL', position: 'end', color: '#FF00FF' },
    })
    markLines.push({
      name: 'TP',
      yAxis: current_position.take_profit,
      lineStyle: { color: '#FFFF00', type: 'dashed', width: 2 },
      label: { formatter: 'TP', position: 'end', color: '#FFFF00' },
    })
  }

  // Add ORB level lines if available
  if (orb_levels) {
    markLines.push({
      name: 'OR High',
      yAxis: orb_levels.or_high,
      lineStyle: { color: '#2196F3', type: 'dashed', width: 1 },
      label: { formatter: 'OR High', position: 'start', color: '#2196F3', fontSize: 10 },
    })
    markLines.push({
      name: 'OR Low',
      yAxis: orb_levels.or_low,
      lineStyle: { color: '#2196F3', type: 'dashed', width: 1 },
      label: { formatter: 'OR Low', position: 'start', color: '#2196F3', fontSize: 10 },
    })
  }

  console.log('Paper trading markers built:', {
    entry: entryMarkers.length,
    tp: tpMarkers.length,
    sl: slMarkers.length,
    eod: eodMarkers.length
  })

  const option = {
    backgroundColor: '#0a0a0a',
    animation: false,
    legend: {
      data: ['Price', 'Entry', 'TP Exit', 'SL Exit', 'Other Exit'],
      bottom: 10,
      textStyle: { color: '#888' },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(20, 20, 20, 0.95)',
      borderColor: '#333',
      borderWidth: 1,
      textStyle: { color: '#e0e0e0', fontSize: 10 },
      formatter: function(params: any[]) {
        // Check if hovering over a trade marker
        for (const p of params) {
          if (p.data && p.data.trade) {
            const t = p.data.trade
            const isPosition = 'order_id' in t // Check if it's a PaperPosition

            if (isPosition) {
              // Current position tooltip
              const pos = t as PaperPosition
              const pnlColor = pos.pnl >= 0 ? '#00E676' : '#FF1744'
              return `
                <div style="padding: 6px 8px; font-family: 'SF Mono', Monaco, monospace; font-size: 10px; line-height: 1.4;">
                  <div style="color: #00BFFF; font-weight: bold; margin-bottom: 4px;">
                    LIVE POSITION | ${pos.side}
                  </div>
                  <div style="display: flex; gap: 12px; margin-bottom: 2px;">
                    <span>Entry: <b>₹${pos.entry_price.toFixed(2)}</b></span>
                    <span>Current: <b>₹${pos.current_price.toFixed(2)}</b></span>
                    <span>Qty: ${pos.quantity}</span>
                  </div>
                  <div style="display: flex; gap: 12px;">
                    <span style="color: #FF00FF;">SL: ₹${pos.stop_loss.toFixed(2)}</span>
                    <span style="color: #FFFF00;">TP: ₹${pos.take_profit.toFixed(2)}</span>
                  </div>
                  <div style="margin-top: 4px;">
                    <span style="color: ${pnlColor}; font-weight: bold;">
                      P&L: ₹${pos.pnl.toFixed(0)} (${pos.pnl_pct >= 0 ? '+' : ''}${pos.pnl_pct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              `
            } else {
              // Completed trade tooltip
              const trade = t as PaperTrade
              const pnlColor = trade.net_pnl >= 0 ? '#00E676' : '#FF1744'
              const formatTime = (iso: string) => iso.split('T')[1]?.substring(0, 5) || iso

              return `
                <div style="padding: 6px 8px; font-family: 'SF Mono', Monaco, monospace; font-size: 10px; line-height: 1.4;">
                  <div style="color: #00BFFF; font-weight: bold; margin-bottom: 4px;">
                    Trade | ${trade.side} | ${trade.exit_reason}
                  </div>
                  <div style="color: #888; margin-bottom: 4px; font-size: 9px;">
                    ${formatTime(trade.entry_time)} → ${formatTime(trade.exit_time)}
                  </div>
                  <div style="display: flex; gap: 12px; margin-bottom: 2px;">
                    <span>Entry: <b>₹${trade.entry_price.toFixed(2)}</b></span>
                    <span>Exit: <b>₹${trade.exit_price.toFixed(2)}</b></span>
                    <span>Qty: ${trade.quantity}</span>
                  </div>
                  <div style="display: flex; gap: 12px;">
                    <span style="color: ${pnlColor}; font-weight: bold;">
                      Net: ₹${trade.net_pnl.toFixed(0)} (${trade.pnl_pct >= 0 ? '+' : ''}${trade.pnl_pct.toFixed(2)}%)
                    </span>
                    <span style="color: #888;">Cost: ₹${trade.costs.toFixed(0)}</span>
                  </div>
                </div>
              `
            }
          }
        }

        // Candlestick tooltip
        const candle = params.find((p: any) => p.seriesType === 'candlestick')
        if (candle) {
          const idx = candle.dataIndex
          const c = candles[idx]
          if (!c) return ''
          const change = ((c.close - c.open) / c.open * 100).toFixed(2)
          const changeColor = c.close >= c.open ? '#00E676' : '#FF1744'
          const timeStr = c.time.split('T')[1]?.substring(0, 5) || c.time

          return `
            <div style="padding: 6px 8px; font-family: 'SF Mono', Monaco, monospace; font-size: 10px; line-height: 1.4;">
              <div style="font-weight: bold; margin-bottom: 4px;">${timeStr}</div>
              <div style="display: flex; gap: 12px;">
                <span>O: ₹${c.open.toFixed(2)}</span>
                <span>H: ₹${c.high.toFixed(2)}</span>
                <span>L: ₹${c.low.toFixed(2)}</span>
                <span>C: ₹${c.close.toFixed(2)}</span>
              </div>
              <div style="display: flex; gap: 12px; color: #888;">
                <span style="color: ${changeColor}; font-weight: bold;">${c.close >= c.open ? '+' : ''}${change}%</span>
                <span>Vol: ${formatVolume(c.volume)}</span>
              </div>
            </div>
          `
        }
        return ''
      },
    },
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
    },
    grid: [
      { left: '8%', right: '3%', top: '5%', height: '60%' },
      { left: '8%', right: '3%', top: '72%', height: '18%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: times,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#444' } },
        axisLabel: { color: '#888', fontSize: 10 },
        splitLine: { show: false },
        min: 'dataMin',
        max: 'dataMax',
      },
      {
        type: 'category',
        gridIndex: 1,
        data: times,
        boundaryGap: true,
        axisLine: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
        min: 'dataMin',
        max: 'dataMax',
      },
    ],
    yAxis: [
      {
        scale: true,
        axisLine: { lineStyle: { color: '#444' } },
        axisLabel: { color: '#888', fontSize: 10 },
        splitLine: { lineStyle: { color: '#333' } },
      },
      {
        scale: true,
        gridIndex: 1,
        axisLine: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: 0,
        end: 100,
      },
    ],
    series: [
      {
        name: 'Price',
        type: 'candlestick',
        data: ohlcData,
        itemStyle: {
          color: '#00E676',       // Bullish - bright green
          color0: '#FF1744',      // Bearish - bright red
          borderColor: '#00E676',
          borderColor0: '#FF1744',
        },
        markLine: markLines.length > 0 ? {
          symbol: ['none', 'none'],
          data: markLines,
          label: {
            color: '#fff',
            fontSize: 10,
          },
        } : undefined,
        markArea: orb_levels ? {
          data: [[
            { xAxis: times[0], yAxis: orb_levels.or_low, itemStyle: { color: 'rgba(33, 150, 243, 0.15)' } },
            { xAxis: times[Math.min(8, times.length - 1)], yAxis: orb_levels.or_high },
          ]],
        } : undefined,
      },
      {
        name: 'Entry',
        type: 'scatter',
        data: entryMarkers,
        symbolSize: 18,
        z: 10,
      },
      {
        name: 'TP Exit',
        type: 'scatter',
        data: tpMarkers,
        symbolSize: 16,
        z: 10,
      },
      {
        name: 'SL Exit',
        type: 'scatter',
        data: slMarkers,
        symbolSize: 16,
        z: 10,
      },
      {
        name: 'Other Exit',
        type: 'scatter',
        data: eodMarkers,
        symbolSize: 16,
        z: 10,
      },
      {
        name: 'Volume',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeData,
        itemStyle: {
          color: function(params: any) {
            return params.data[2] === 1 ? 'rgba(0, 230, 118, 0.5)' : 'rgba(255, 23, 68, 0.5)'
          },
        },
      },
    ],
  }

  return option
}

function findCandleIndex(candles: CandleData[], timeStr: string): number {
  if (!timeStr || candles.length === 0) return -1

  // Parse the target time to minutes since midnight
  const parseTimeToMinutes = (str: string): number => {
    const timePart = str.split('T')[1] || str
    const parts = timePart.split(':')
    if (parts.length >= 2) {
      const hours = parseInt(parts[0], 10)
      const minutes = parseInt(parts[1], 10)
      return hours * 60 + minutes
    }
    return -1
  }

  const targetMinutes = parseTimeToMinutes(timeStr)
  if (targetMinutes < 0) return -1

  // First try exact match (same 5-min bucket)
  for (let i = 0; i < candles.length; i++) {
    const candleMinutes = parseTimeToMinutes(candles[i].time)
    if (candleMinutes === targetMinutes) {
      return i
    }
  }

  // If no exact match, find the closest candle
  let closestIdx = 0
  let minDiff = Infinity

  for (let i = 0; i < candles.length; i++) {
    const candleMinutes = parseTimeToMinutes(candles[i].time)
    const diff = Math.abs(candleMinutes - targetMinutes)
    if (diff < minDiff) {
      minDiff = diff
      closestIdx = i
    }
  }

  // Only return if within 10 minutes (2 candles)
  if (minDiff <= 10) {
    console.log(`findCandleIndex: ${timeStr} -> closest candle at idx ${closestIdx} (diff: ${minDiff} mins)`)
    return closestIdx
  }

  console.log(`findCandleIndex: ${timeStr} -> no match found (minDiff: ${minDiff} mins)`)
  return -1
}

function formatVolume(vol: number): string {
  if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M'
  if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K'
  return vol.toString()
}
