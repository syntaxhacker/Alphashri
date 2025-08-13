/* -----------------------------------------------------------
   Chart configuration with data from Python
   ----------------------------------------------------------- */

/* ---------- Render ECharts P&L chart with actual trade data ---------- */
function renderChart() {
    const chartDom = document.getElementById('priceChart');
    const myChart = echarts.init(chartDom);
    
    // Extract data from chartData object with fallbacks
    const pnlData = chartData.pnl_data || [];
    const entryMarkers = chartData.entry_markers || [];
    const exitMarkers = chartData.exit_markers || [];
    const timeLabels = chartData.time_labels || [];
    
    // Debug logging
    console.log('Chart data:', chartData);
    console.log('Entry markers:', entryMarkers);
    console.log('Exit markers:', exitMarkers);
    
    // Create a simple chart that works with the actual data structure
    const option = {
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(0,0,0,.8)',
            borderColor: '#555',
            textStyle: { color: '#fff' },
            formatter: function(params) {
                const dataIndex = params[0].dataIndex;
                const dataPoint = pnlData[dataIndex];
                const time = timeLabels[dataIndex];
                const pnl = dataPoint.cumulative_pnl;

                let tradeInfo = '';

                // Find entry marker for this time
                const entryMarker = entryMarkers.find(marker => {
                    const entryTime = marker.trade ? marker.trade.entry_time : marker.time;
                    if (!entryTime) return false;
                    const markerTimeStr = new Date(entryTime).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                    return timeLabels[dataIndex] === markerTimeStr;
                });

                if (entryMarker) {
                    const trade = entryMarker.trade;
                    tradeInfo += `
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #555;">
                            <div style="margin-bottom: 8px; font-weight: bold; color: #4caf50;">ENTRY - ${trade.symbol.replace('NSE:', '')}</div>
                            <div>Symbol: ${trade.symbol}</div>
                            <div>Action: ENTRY</div>
                            <div>Entry Price: ₹${trade.entry_price.toFixed(2)}</div>
                            <div>Quantity: ${trade.qty}</div>
                        </div>
                    `;
                }

                // Find exit marker for this time
                const exitMarker = exitMarkers.find(marker => {
                    const exitTime = marker.trade ? marker.trade.exit_time : marker.time;
                    if (!exitTime) return false;
                    const markerTimeStr = new Date(exitTime).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                    return timeLabels[dataIndex] === markerTimeStr;
                });

                if (exitMarker) {
                    const trade = exitMarker.trade;
                    tradeInfo += `
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #555;">
                            <div style="margin-bottom: 8px; font-weight: bold; color: ${trade.pl_amount >= 0 ? '#4caf50' : '#e53935'};">EXIT - ${trade.symbol.replace('NSE:', '')}</div>
                            <div>Symbol: ${trade.symbol}</div>
                            <div>Action: EXIT</div>
                            <div>Exit Price: ₹${trade.exit_price.toFixed(2)}</div>
                            <div>Quantity: ${trade.qty}</div>
                            <div>Trade P&L: ${trade.pl_symbol}₹${Math.abs(trade.pl_amount).toFixed(2)}</div>
                            <div>Exit Reason: ${trade.exit_reason}</div>
                        </div>
                    `;
                }

                return `
                        <div style="font-weight: bold;">Time: ${time}</div>
                        <div>Cumulative P&L: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}</div>
                        ${tradeInfo}
                    `;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'category',
            data: timeLabels,
            axisLine: { lineStyle: { color: '#777' } },
            axisLabel: { color: '#ccc' },
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            name: 'P&L (₹)',
            nameTextStyle: { color: '#ccc' },
            axisLine: { lineStyle: { color: '#777' } },
            axisLabel: {
                color: '#ccc',
                formatter: function(value) {
                    return '₹' + value.toLocaleString();
                }
            },
            splitLine: {
                lineStyle: { color: 'rgba(255,255,255,.05)' }
            }
        },
        series: [{
            name: 'Cumulative P&L',
            type: 'line',
            data: pnlData.map(point => point.cumulative_pnl),
            smooth: true,
            lineStyle: { color: '#00bcd4', width: 3 },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: '#00bcd440' },
                    { offset: 1, color: '#00bcd405' }
                ])
            },
            itemStyle: { opacity: 0 }
        },
        // Entry markers as separate series for proper tooltips
        {
            name: 'Entry Trades',
            type: 'scatter',
            symbolSize: 20,
            symbol: 'circle',
            data: entryMarkers.map((marker, index) => {
                // Find the correct time index for this entry marker
                const entryTime = marker.trade ? marker.trade.entry_time : marker.time;
                let timeIndex = -1;
                
                if (entryTime) {
                    // Find matching time index in timeLabels
                    const markerTimeStr = new Date(entryTime).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                    timeIndex = timeLabels.findIndex(label => label === markerTimeStr);
                }
                
                // Fallback to proportional index if time matching fails
                if (timeIndex === -1) {
                    timeIndex = Math.floor((index / entryMarkers.length) * timeLabels.length);
                }
                
                return {
                    value: [timeIndex, marker.cumulative_pnl || 0],
                    itemStyle: {
                        color: '#4caf50',
                        borderColor: '#81c784',
                        borderWidth: 2,
                        shadowColor: '#4caf50',
                        shadowBlur: 8
                    },
                    emphasis: {
                        itemStyle: {
                            color: '#66bb6a',
                            borderColor: '#a5d6a7',
                            borderWidth: 3,
                            shadowColor: '#66bb6a',
                            shadowBlur: 12
                        }
                    },
                    marker: marker,
                    timeIndex: timeIndex
                };
            }),
            tooltip: {
                formatter: function(params) {
                    const marker = params.data.marker;
                    const trade = marker.trade;
                    if (!marker || !trade) return '';

                    const time = new Date(trade.entry_time).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });

                    return `
                        <div style="margin-bottom: 8px; font-weight: bold; color: #4caf50;">ENTRY - ${trade.symbol.replace('NSE:', '')}</div>
                        <div>Time: ${time}</div>
                        <div>Symbol: ${trade.symbol}</div>
                        <div>Action: ENTRY</div>
                        <div>Entry Price: ₹${trade.entry_price.toFixed(2)}</div>
                        <div>Quantity: ${trade.qty}</div>
                    `;
                }
            },
            zlevel: 2
        },
        // Exit markers as separate series for proper tooltips  
        {
            name: 'Exit Trades',
            type: 'scatter',
            symbolSize: 20,
            symbol: 'triangle',
            data: exitMarkers.map((marker, index) => {
                // Find the correct time index for this exit marker
                const exitTime = marker.trade ? marker.trade.exit_time : marker.time;
                let timeIndex = -1;
                
                if (exitTime) {
                    // Find matching time index in timeLabels
                    const markerTimeStr = new Date(exitTime).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                    timeIndex = timeLabels.findIndex(label => label === markerTimeStr);
                }
                
                // Fallback to proportional index if time matching fails
                if (timeIndex === -1) {
                    timeIndex = Math.floor(((entryMarkers.length + index) / (entryMarkers.length + exitMarkers.length)) * timeLabels.length);
                }
                
                const plAmount = marker.trade ? marker.trade.pl_amount : 0;
                
                return {
                    value: [timeIndex, marker.cumulative_pnl || 0],
                    itemStyle: {
                        color: plAmount >= 0 ? '#4caf50' : '#e53935',
                        borderColor: plAmount >= 0 ? '#81c784' : '#e57373',
                        borderWidth: 2,
                        shadowColor: plAmount >= 0 ? '#4caf50' : '#e53935',
                        shadowBlur: 8
                    },
                    emphasis: {
                        itemStyle: {
                            color: plAmount >= 0 ? '#66bb6a' : '#ef5350',
                            borderColor: plAmount >= 0 ? '#a5d6a7' : '#ef9a9a',
                            borderWidth: 3,
                            shadowColor: plAmount >= 0 ? '#66bb6a' : '#ef5350',
                            shadowBlur: 12
                        }
                    },
                    marker: marker,
                    timeIndex: timeIndex
                };
            }),
            tooltip: {
                formatter: function(params) {
                    const marker = params.data.marker;
                    const trade = marker.trade;
                    if (!marker || !trade) return '';

                    const time = new Date(trade.exit_time).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                    const pnl = marker.cumulative_pnl;

                    return `
                        <div style="margin-bottom: 8px; font-weight: bold; color: ${trade.pl_amount >= 0 ? '#4caf50' : '#e53935'};">EXIT - ${trade.symbol.replace('NSE:', '')}</div>
                        <div>Time: ${time}</div>
                        <div>Symbol: ${trade.symbol}</div>
                        <div>Action: EXIT</div>
                        <div>Exit Price: ₹${trade.exit_price.toFixed(2)}</div>
                        <div>Quantity: ${trade.qty}</div>
                        <div>Trade P&L: ${trade.pl_symbol}₹${Math.abs(trade.pl_amount).toFixed(2)}</div>
                        <div>Cumulative P&L: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}</div>
                        <div>Exit Reason: ${trade.exit_reason}</div>
                    `;
                }
            },
            zlevel: 2
        }],
        animationDuration: 1200,
        dataZoom: [
            {
                type: 'inside',
                start: 0,
                end: 100
            },
            {
                show: true,
                type: 'slider',
                bottom: 10,
                start: 0,
                end: 100
            }
        ]
    };

    myChart.setOption(option);
    window.addEventListener('resize', () => myChart.resize());
}

/* -----------------------------------------------------------
   Initial rendering
   ----------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', function() {
    renderChart();
});
