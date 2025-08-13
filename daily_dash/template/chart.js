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
            textStyle: { color: '#fff' }
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
                    
                    const timeStr = trade.entry_time ? new Date(trade.entry_time).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit', 
                        second: '2-digit',
                        hour12: false
                    }) : 'Unknown';
                    
                    const dateStr = trade.entry_time ? new Date(trade.entry_time).toLocaleDateString('en-IN') : 'Unknown';
                    const amount = trade.entry_price && trade.qty ? (trade.entry_price * trade.qty).toFixed(2) : 'Unknown';
                    
                    return `
                        <div style="margin-bottom: 12px; padding: 8px; background: rgba(76, 175, 80, 0.1); border-left: 4px solid #4caf50; font-weight: bold; color: #4caf50; border-radius: 4px;">
                            ↗ ENTRY - ${trade.symbol ? trade.symbol.replace('NSE:', '') : 'Unknown'}
                        </div>
                        <div style="margin-bottom: 6px;"><strong>Date:</strong> ${dateStr}</div>
                        <div style="margin-bottom: 6px;"><strong>Time:</strong> ${timeStr}</div>
                        <div style="margin-bottom: 6px;"><strong>Action:</strong> <span style="color: #4caf50; font-weight: bold;">ENTRY</span></div>
                        <div style="margin-bottom: 6px;"><strong>Entry Price:</strong> ₹${(trade.entry_price || 0).toFixed(2)}</div>
                        <div style="margin-bottom: 6px;"><strong>Quantity:</strong> ${trade.qty || 0}</div>
                        <div style="margin-bottom: 6px;"><strong>Investment:</strong> ₹${amount}</div>
                        <div style="margin-bottom: 6px;"><strong>Symbol:</strong> ${trade.symbol || 'Unknown'}</div>
                        <div style="padding-top: 8px; border-top: 1px solid #444;"><strong>Cumulative P&L:</strong> <span style="color: ${(marker.cumulative_pnl || 0) >= 0 ? '#4caf50' : '#e53935'}; font-weight: bold;">${(marker.cumulative_pnl || 0) >= 0 ? '+' : ''}₹${(marker.cumulative_pnl || 0).toFixed(2)}</span></div>
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
                    
                    const exitTimeStr = trade.exit_time ? new Date(trade.exit_time).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit', 
                        hour12: false
                    }) : 'Unknown';
                    
                    const entryTimeStr = trade.entry_time ? new Date(trade.entry_time).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    }) : 'Unknown';
                    
                    const dateStr = trade.exit_time ? new Date(trade.exit_time).toLocaleDateString('en-IN') : 'Unknown';
                    const exitAmount = trade.exit_price && trade.qty ? (trade.exit_price * trade.qty).toFixed(2) : 'Unknown';
                    const pnlColor = trade.pl_amount >= 0 ? '#4caf50' : '#e53935';
                    const pnlSign = trade.pl_amount >= 0 ? '+' : '';
                    
                    return `
                        <div style="margin-bottom: 12px; padding: 8px; background: rgba(${trade.pl_amount >= 0 ? '76, 175, 80' : '229, 57, 53'}, 0.1); border-left: 4px solid ${pnlColor}; font-weight: bold; color: ${pnlColor}; border-radius: 4px;">
                            ↙ EXIT - ${trade.symbol ? trade.symbol.replace('NSE:', '') : 'Unknown'}
                        </div>
                        
                        <div style="margin-bottom: 12px; padding: 8px; background: rgba(${trade.pl_amount >= 0 ? '76, 175, 80' : '229, 57, 53'}, 0.15); border-radius: 4px; border: 2px solid ${pnlColor};">
                            <div style="font-size: 16px; font-weight: bold; color: ${pnlColor}; margin-bottom: 4px;">
                                P&L: ${pnlSign}₹${Math.abs(trade.pl_amount || 0).toFixed(2)} (${pnlSign}${(trade.pl_percent || 0).toFixed(2)}%)
                            </div>
                            <div style="font-size: 14px; color: #ccc;">
                                <strong>Exit Reason:</strong> ${trade.exit_reason || 'Unknown'}
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 6px;"><strong>Date:</strong> ${dateStr}</div>
                        <div style="margin-bottom: 6px;"><strong>Entry Time:</strong> ${entryTimeStr}</div>
                        <div style="margin-bottom: 6px;"><strong>Exit Time:</strong> ${exitTimeStr}</div>
                        <div style="margin-bottom: 6px;"><strong>Action:</strong> <span style="color: ${pnlColor}; font-weight: bold;">EXIT</span></div>
                        
                        <div style="margin: 8px 0; padding: 4px 0; border-top: 1px solid #444; border-bottom: 1px solid #444;">
                            <div style="margin-bottom: 4px;"><strong>Entry Price:</strong> ₹${(trade.entry_price || 0).toFixed(2)}</div>
                            <div style="margin-bottom: 4px;"><strong>Exit Price:</strong> ₹${(trade.exit_price || 0).toFixed(2)}</div>
                            <div style="margin-bottom: 4px;"><strong>Quantity:</strong> ${trade.qty || 0}</div>
                            <div style="margin-bottom: 4px;"><strong>Exit Amount:</strong> ₹${exitAmount}</div>
                        </div>
                        
                        <div style="margin-bottom: 6px;"><strong>Symbol:</strong> ${trade.symbol || 'Unknown'}</div>
                        <div style="padding-top: 8px; border-top: 2px solid #555;"><strong>Cumulative P&L:</strong> <span style="color: ${(marker.cumulative_pnl || 0) >= 0 ? '#4caf50' : '#e53935'}; font-weight: bold;">${(marker.cumulative_pnl || 0) >= 0 ? '+' : ''}₹${(marker.cumulative_pnl || 0).toFixed(2)}</span></div>
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