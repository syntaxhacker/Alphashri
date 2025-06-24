import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import * as echarts from 'echarts'

const ResultsChart = forwardRef(({ data }, ref) => {
  const chartRef = useRef(null)
  const chartInstance = useRef(null)
  const dateCategories = useRef([])

  // Expose zoom function to parent component
  useImperativeHandle(ref, () => ({
    zoomToDate: (targetDate, rangeDays = 10) => {
      if (!chartInstance.current || !dateCategories.current.length) return
      
      // Find the index of the target date
      const targetIndex = dateCategories.current.findIndex(date => date === targetDate)
      if (targetIndex === -1) return
      
      // Calculate zoom range (±rangeDays around target)
      const totalDays = dateCategories.current.length
      const startIndex = Math.max(0, targetIndex - rangeDays)
      const endIndex = Math.min(totalDays - 1, targetIndex + rangeDays)
      
      // Convert to percentage for dataZoom
      const startPercent = (startIndex / totalDays) * 100
      const endPercent = (endIndex / totalDays) * 100
      
      console.log(`Zooming to date: ${targetDate}, index: ${targetIndex}, range: ${startPercent}% - ${endPercent}%`)
      
      // Update dataZoom
      chartInstance.current.dispatchAction({
        type: 'dataZoom',
        startValue: startIndex,
        endValue: endIndex
      })
    },
    zoomToTradeRange: (entryDate, exitDate, paddingDays = 5) => {
      if (!chartInstance.current || !dateCategories.current.length) return
      
      console.log('Attempting to zoom to trade range:', { entryDate, exitDate, availableDates: dateCategories.current.length })
      
      // Find indices for entry and exit dates with fuzzy matching
      let entryIndex = dateCategories.current.findIndex(date => date === entryDate)
      let exitIndex = dateCategories.current.findIndex(date => date === exitDate)
      
      // If exact match fails, try to find closest dates
      if (entryIndex === -1) {
        const entryTime = new Date(entryDate).getTime()
        let closestDiff = Infinity
        dateCategories.current.forEach((date, idx) => {
          const diff = Math.abs(new Date(date).getTime() - entryTime)
          if (diff < closestDiff) {
            closestDiff = diff
            entryIndex = idx
          }
        })
        console.log('Entry date not found exactly, using closest:', dateCategories.current[entryIndex])
      }
      
      if (exitIndex === -1) {
        const exitTime = new Date(exitDate).getTime()
        let closestDiff = Infinity
        dateCategories.current.forEach((date, idx) => {
          const diff = Math.abs(new Date(date).getTime() - exitTime)
          if (diff < closestDiff) {
            closestDiff = diff
            exitIndex = idx
          }
        })
        console.log('Exit date not found exactly, using closest:', dateCategories.current[exitIndex])
      }
      
      if (entryIndex === -1 || exitIndex === -1) {
        console.warn('Trade dates not found in chart data:', { entryDate, exitDate, entryIndex, exitIndex })
        return
      }
      
      // Ensure proper order (entry before exit)
      const startIndex = Math.min(entryIndex, exitIndex)
      const endIndex = Math.max(entryIndex, exitIndex)
      
      // Calculate zoom range with padding
      const totalDays = dateCategories.current.length
      const paddedStartIndex = Math.max(0, startIndex - paddingDays)
      const paddedEndIndex = Math.min(totalDays - 1, endIndex + paddingDays)
      
      // Ensure minimum visible range (at least 10 data points)
      const minRange = 10
      const currentRange = paddedEndIndex - paddedStartIndex
      if (currentRange < minRange) {
        const extraPadding = Math.floor((minRange - currentRange) / 2)
        const finalStartIndex = Math.max(0, paddedStartIndex - extraPadding)
        const finalEndIndex = Math.min(totalDays - 1, paddedEndIndex + extraPadding)
        
        console.log(`Zooming to trade range: ${entryDate} to ${exitDate}`)
        console.log(`Indices: entry=${entryIndex}, exit=${exitIndex}, final range=${finalStartIndex}-${finalEndIndex}`)
        
        // Update dataZoom to show the trade range
        chartInstance.current.dispatchAction({
          type: 'dataZoom',
          startValue: finalStartIndex,
          endValue: finalEndIndex
        })
      } else {
        console.log(`Zooming to trade range: ${entryDate} to ${exitDate}`)
        console.log(`Indices: entry=${entryIndex}, exit=${exitIndex}, padded range=${paddedStartIndex}-${paddedEndIndex}`)
        
        // Update dataZoom to show the trade range
        chartInstance.current.dispatchAction({
          type: 'dataZoom',
          startValue: paddedStartIndex,
          endValue: paddedEndIndex
        })
      }
    }
  }))

  useEffect(() => {
    if (!data || !data.price_data || !chartRef.current) return

    // Initialize chart with dark theme
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark', {
        renderer: 'canvas',
        useDirtyRect: false
      })
    }

    // Prepare data
    const priceData = data.price_data || []
    const signals = data.signals || []
    
    console.log('Chart data:', { priceDataLength: priceData.length, signalsLength: signals.length })
    console.log('Sample price data:', priceData.slice(0, 3))
    
    // Format data for candlesticks - ensure all values are numbers
    const candleData = priceData.map(d => {
      // First convert all values to numbers and handle any NaN
      const open = Number(d.open)
      const close = Number(d.close)
      const high = Number(d.high)
      const low = Number(d.low)
      const volume = Number(d.volume)

      // If open is NaN, use close price
      const validOpen = isNaN(open) ? close : open
      // If close is NaN, use open price
      const validClose = isNaN(close) ? validOpen : close
      // For high, use the maximum of open/close if NaN
      const validHigh = isNaN(high) ? Math.max(validOpen, validClose) : high
      // For low, use the minimum of open/close if NaN
      const validLow = isNaN(low) ? Math.min(validOpen, validClose) : low
      // Default volume to 0 if NaN
      const validVolume = isNaN(volume) ? 0 : volume

      // ECharts candlestick format: [open, close, low, high]
      return [validOpen, validClose, validLow, validHigh]
    })
    
    // Volume data array
    const volumeData = priceData.map(d => Number(d.volume) || 0)
    
    // X-axis categories (dates) - store in ref for zoom function
    dateCategories.current = priceData.map(d => d.date)
    
    console.log('Candlestick data:', candleData.slice(0, 3))
    console.log('Date categories:', dateCategories.current.slice(0, 3))
    
    // Create signal data points
    const buySignals = signals
      .filter(s => s.type === 'entry')
      .map(signal => [signal.date, Number(signal.price) || 0])
    
    const sellSignals = signals
      .filter(s => s.type === 'exit')
      .map(signal => [signal.date, Number(signal.price) || 0])

    const option = {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 1500,
      animationEasing: 'cubicOut',
      legend: {
        show: false
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          lineStyle: {
            color: '#4488ff'
          }
        },
        backgroundColor: '#1a1a1a',
        borderColor: '#333333',
        textStyle: {
          color: '#ffffff',
          fontSize: 11
        },
        formatter: function(params) {
          const candleParam = params.find(p => p.seriesName === 'Candlestick')
          if (!candleParam) return ''
          
          try {
            const date = candleParam.name
            const candleData = candleParam.data
            
            // ECharts candlestick format: [open, close, low, high]
            const open = candleData[0]
            const close = candleData[1]
            const low = candleData[2]
            const high = candleData[3]
            
            // Get volume from the original data
            const dataIndex = candleParam.dataIndex
            const volume = volumeData[dataIndex] || 0
            
            // Ensure all values are valid numbers
            const validOpen = isNaN(open) ? '-' : open.toFixed(2)
            const validClose = isNaN(close) ? '-' : close.toFixed(2)
            const validHigh = isNaN(high) ? '-' : high.toFixed(2)
            const validLow = isNaN(low) ? '-' : low.toFixed(2)
            const validVolume = isNaN(volume) ? '0' : volume.toLocaleString()
            
            const color = Number(close) >= Number(open) ? '#00ff88' : '#ff4444'
            
            let result = `<div style="font-size: 12px; font-weight: bold">${date}</div>`
            result += `<div style="color: ${color}">
              Open: ₹${validOpen}<br/>
              High: ₹${validHigh}<br/>
              Low: ₹${validLow}<br/>
              Close: ₹${validClose}<br/>
              Volume: ${validVolume}
            </div>`
            
            // Add signals if present
            params.forEach(param => {
              if (param.seriesName === 'Buy Signals') {
                const price = Number(param.value[1])
                result += `<div style="color: #00ff88">🔵 BUY: ₹${isNaN(price) ? '-' : price.toFixed(2)}</div>`
              } else if (param.seriesName === 'Sell Signals') {
                const price = Number(param.value[1])
                result += `<div style="color: #ff4444">🔴 SELL: ₹${isNaN(price) ? '-' : price.toFixed(2)}</div>`
              }
            })
            
            return result
          } catch (error) {
            console.error('Tooltip formatting error:', error)
            return ''
          }
        }
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }]
      },
      grid: [{
        left: '8%',
        right: '8%',
        top: '5%',
        bottom: '30%',
        height: '55%',
        containLabel: true
      }, {
        left: '8%',
        right: '8%',
        top: '70%',
        height: '20%',
        containLabel: true
      }],
      xAxis: [{
        type: 'category',
        data: dateCategories.current,
        axisLine: { lineStyle: { color: '#333333' } },
        axisLabel: {
          color: '#888888',
          fontSize: 10,
          rotate: 30,
          hideOverlap: true,
          formatter: (value) => {
            const date = new Date(value)
            return date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            })
          }
        },
        min: 'dataMin',
        max: 'dataMax',
        gridIndex: 0,
        splitLine: {
          show: true,
          lineStyle: {
            color: '#333333',
            type: 'dashed'
          }
        }
      }, {
        type: 'category',
        gridIndex: 1,
        data: dateCategories.current,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        min: 'dataMin',
        max: 'dataMax'
      }],
      yAxis: [{
        scale: true,
        position: 'right',
        splitLine: {
          show: true,
          lineStyle: {
            color: '#333333',
            type: 'dashed'
          }
        },
        axisLabel: {
          color: '#888888',
          fontSize: 10,
          formatter: '₹{value}'
        },
        axisLine: { show: false },
        axisTick: { show: false },
        gridIndex: 0
      }, {
        scale: true,
        position: 'right',
        gridIndex: 1,
        splitNumber: 2,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false }
      }],
      dataZoom: [{
        type: 'inside',
        xAxisIndex: [0, 1],
        start: 50,
        end: 100,
        minValueSpan: 5  // Minimum 5 data points visible
      }, {
        show: true,
        type: 'slider',
        bottom: 5,
        height: 20,
        xAxisIndex: [0, 1],
        borderColor: '#333333',
        textStyle: {
          color: '#888888'
        },
        handleStyle: {
          color: '#4488ff'
        },
        start: 50,
        end: 100,
        minValueSpan: 5  // Minimum 5 data points visible
      }],
      series: [{
        name: 'Candlestick',
        type: 'candlestick',
        data: candleData,
        xAxisIndex: 0,
        yAxisIndex: 0,
        itemStyle: {
          color: '#00ff88',
          color0: '#ff4444',
          borderColor: '#00ff88',
          borderColor0: '#ff4444',
          borderWidth: 1
        },
        barWidth: '80%',
        barMinWidth: 4,
        barMaxWidth: 20,
        emphasis: {
          itemStyle: {
            borderWidth: 2,
            shadowBlur: 5,
            shadowColor: 'rgba(0,0,0,0.2)'
          }
        },
        animation: true,
        animationDuration: 500,
        animationEasing: 'cubicOut'
      }, {
        name: 'Buy Signals',
        type: 'scatter',
        data: buySignals,
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbol: 'triangle',
        symbolSize: 12,
        symbolRotate: 0,
        itemStyle: {
          color: '#00ff88',
          borderColor: '#ffffff',
          borderWidth: 2,
          shadowColor: '#00ff88',
          shadowBlur: 15,
          shadowOffsetY: 3
        },
        emphasis: {
          scale: 1.5,
          itemStyle: {
            borderWidth: 3,
            shadowBlur: 25,
            color: '#00ffaa'
          }
        },
        animation: true,
        animationDuration: 800,
        animationDelay: (idx) => idx * 200,
        animationEasing: 'elasticOut',
        zlevel: 2
      }, {
        name: 'Sell Signals',
        type: 'scatter',
        data: sellSignals.map((signal, idx) => {
          // Get corresponding entry signal to determine profit/loss
          const entrySignal = buySignals[idx]
          const isProfit = entrySignal && signal[1] > entrySignal[1]
          return {
            value: signal,
            itemStyle: {
              color: isProfit ? '#00ff88' : '#ff4444',
              borderColor: '#ffffff',
              borderWidth: 2,
              shadowColor: isProfit ? '#00ff88' : '#ff4444',
              shadowBlur: 15,
              shadowOffsetY: 3
            },
            symbol: isProfit ? 'diamond' : 'circle',
            symbolSize: isProfit ? 14 : 12
          }
        }),
        xAxisIndex: 0,
        yAxisIndex: 0,
        emphasis: {
          scale: 1.5,
          itemStyle: {
            borderWidth: 3,
            shadowBlur: 25
          }
        },
        animation: true,
        animationDuration: 1000,
        animationDelay: (idx) => 400 + idx * 250,
        animationEasing: 'bounceOut',
        zlevel: 2
      }, {
        name: 'Volume',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeData,
        barWidth: '70%',
        barMinWidth: 5,
        barMaxWidth: 15,
        itemStyle: {
          color: (params) => {
            const open = candleData[params.dataIndex][0]
            const close = candleData[params.dataIndex][1]
            return Number(close) >= Number(open) ? '#00ff8844' : '#ff444444'
          }
        },
        animation: true,
        animationDuration: 300,
        animationDelay: (idx) => idx * 5,
        animationEasing: 'cubicOut'
      }]
    }

    console.log('Setting chart option...')
    chartInstance.current.setOption(option, true)
    console.log('Chart option set successfully')
    
    // Force resize after setting option
    setTimeout(() => {
      if (chartInstance.current) {
        chartInstance.current.resize()
      }
    }, 100)

    // Handle resize
    const handleResize = () => {
      if (chartInstance.current) {
        chartInstance.current.resize()
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    return () => {
      if (chartInstance.current && !chartInstance.current.isDisposed()) {
        chartInstance.current.dispose()
        chartInstance.current = null
      }
    }
  }, [])

  return (
    <div className="chart-container" ref={chartRef}>
      {!data && (
        <div className="chart-placeholder">
          <p>No data available</p>
        </div>
      )}
      {data && data.price_data && data.price_data.length > 0 && (
        <div className="data-warning" style={{
          color: '#ff8800',
          fontSize: '12px',
          padding: '4px 8px',
          backgroundColor: 'rgba(255, 136, 0, 0.1)',
          borderRadius: '4px',
          marginBottom: '8px'
        }}>
          ⚠️ Using historical data from {data.price_data[data.price_data.length - 1].date}
        </div>
      )}
      <div 
        style={{ 
          width: '100%', 
          height: '400px',
          marginBottom: '20px'
        }} 
      />
      
      {data && (
        <div className="chart-legend">
          <div className="legend-item">
            <span className="legend-symbol buy"></span>
            BUY ({data.signals?.length || 0})
          </div>
          <div className="legend-item">
            <span className="legend-symbol sell"></span>
            SELL ({data.exits?.length || 0})
          </div>
        </div>
      )}
    </div>
  )
})

export default ResultsChart 