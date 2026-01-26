/**
 * Dashboard UI Controller
 * Main UI logic that orchestrates all charts and data processing
 */

// Global state
let dashboardData = null;
let currentView = 'overview';
let currentRange = '5m';
let processor = null;

// Chart instances
const charts = {
    performance: null,
    momentumRank: null,
    timeline: null,
    rotationHeatmap: null,
    rotationTimeline: null,
    correlation: null,
    rotationPairs: null,
    momentumDetail: null,
    volumeCalendar: null,
    seasonality: null,
    drawdown: null,
    meanReversion: null,
    volumePriceDivergence: null,
    relativeStrength: null,
    correlationDendrogram: null
};

// Colors
const sectorColors = ['#388bfd', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#fbbf24', '#84cc16', '#22c55e', '#10b981', '#14b8a6'];

/**
 * Initialize dashboard
 */
async function initializeDashboard() {
    try {
        const response = await fetch('rotation_dashboard_data.json');
        dashboardData = await response.json();

        // Initialize data processor
        processor = new DashboardDataProcessor();
        processor.initialize(dashboardData);

        // Initialize chart instances
        charts.performance = new PerformanceChart('performance-chart');
        charts.momentumRank = new MomentumRankChart('momentum-rank-chart');
        charts.timeline = new TimelineChart('timeline-chart');
        charts.rotationHeatmap = new RotationHeatmapChart('rotation-heatmap');
        charts.rotationTimeline = new RotationTimelineChart('rotation-timeline');
        charts.correlation = new CorrelationChart('correlation-chart');
        charts.rotationPairs = new RotationPairsChart('rotation-pairs-chart');
        charts.momentumDetail = new MomentumDetailChart('momentum-detail-chart');

        // Hide loading, show dashboard
        document.getElementById('loading').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';

        // Apply initial filter
        setTimeout(() => applyCustomRange(), 50);
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('loading').innerHTML = '<p style="color: #f85149;">Error loading data: ' + error.message + '</p>';
    }
}

/**
 * Apply custom range filter
 */
function applyCustomRange() {
    const value = parseInt(document.getElementById('custom-range-value').value);
    const unit = document.getElementById('custom-range-unit').value;
    const range = value + unit;

    currentRange = range;
    const result = processor.applyFilter(range);

    console.log('Filtered:', result);

    renderDashboard();
}

/**
 * Filter by preset range
 */
function filterByRange(range) {
    currentRange = range;
    const result = processor.applyFilter(range);

    console.log('Filtered:', result);

    renderDashboard();
}

/**
 * Show specific view
 */
function showView(view, event) {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    }
    currentView = view;

    document.getElementById('overview-panel').style.display = view === 'overview' ? 'block' : 'none';
    document.getElementById('rotation-panel').style.display = view === 'rotation' ? 'block' : 'none';
    document.getElementById('correlation-panel').style.display = view === 'correlation' ? 'block' : 'none';
    document.getElementById('momentum-panel').style.display = view === 'momentum' ? 'block' : 'none';
    document.getElementById('volume-panel').style.display = view === 'volume' ? 'block' : 'none';
    document.getElementById('seasonality-panel').style.display = view === 'seasonality' ? 'block' : 'none';
    document.getElementById('risk-panel').style.display = view === 'risk' ? 'block' : 'none';
    document.getElementById('advanced-panel').style.display = view === 'advanced' ? 'block' : 'none';
    document.getElementById('forecast-panel').style.display = view === 'forecast' ? 'block' : 'none';

    renderDashboard();
}

/**
 * Render dashboard based on current view
 */
function renderDashboard() {
    const data = processor.getFilteredData();

    // Update signals
    updateSignals(data.momentum, data.correlations);

    // Render charts based on view
    if (currentView === 'overview') {
        charts.performance.render(data.momentum, sectorColors, currentRange);
        charts.momentumRank.render(data.momentum, currentRange);
        charts.timeline.render(data.timeSeries, sectorColors, currentRange);
    } else if (currentView === 'rotation') {
        charts.rotationHeatmap.render(Object.values(data.heatmap), currentRange);
        charts.rotationTimeline.render(data.quarterly, sectorColors, Object.keys(processor.getRawData().timeSeries), currentRange);
    } else if (currentView === 'correlation') {
        charts.correlation.render(data.correlations, currentRange);
        charts.rotationPairs.render(data.correlations, data.momentum);
        updateCorrelationInsights(data.correlations, data.momentum);
        initializeCorrelationDendrogram(data);
    } else if (currentView === 'momentum') {
        charts.momentumDetail.render(data.momentum, currentRange);
    } else if (currentView === 'volume') {
        initializeVolumeView();
    } else if (currentView === 'seasonality') {
        initializeSeasonalityView(data);
    } else if (currentView === 'risk') {
        initializeRiskView(data);
    } else if (currentView === 'advanced') {
        initializeAdvancedView(data);
    } else if (currentView === 'forecast') {
        updateForecastView(data);
    }
}

/**
 * Update signals panel
 */
function updateSignals(momentumData, correlations) {
    const container = document.getElementById('signals-grid');

    const buySignals = momentumData.filter(s => s.m3 > 10 && s.m1 > 0);
    const sellSignals = momentumData.filter(s => s.m3 < -5);
    const rotationPairs = correlations.filter(c => c.correlation < -0.5);

    let html = '';

    if (buySignals.length > 0) {
        html += `<div class="signal-card signal-buy">
            <div class="signal-title">🔵 BUY NOW</div>`;
        buySignals.slice(0, 3).forEach(s => {
            html += `<div class="signal-metric"><strong>${s.sector}</strong> - Strong momentum</div>`;
            html += `<div class="signal-metric">1M: <strong>${s.m1.toFixed(1)}%</strong> | 3M: <strong>${s.m3.toFixed(1)}%</strong> | Total: <strong>${s.total.toFixed(1)}%</strong></div>`;
        });
        html += `</div>`;
    }

    if (rotationPairs.length > 0) {
        html += `<div class="signal-card signal-rotate">
            <div class="signal-title">🔄 ROTATION PLAYS</div>`;
        rotationPairs.slice(0, 3).forEach(p => {
            const m1 = momentumData.find(x => x.sector === p.sector1);
            const m2 = momentumData.find(x => x.sector === p.sector2);
            html += `<div class="signal-metric"><strong>${p.sector1}</strong> ↔ <strong>${p.sector2}</strong></div>`;
            html += `<div class="signal-metric">Inverse correlation: <strong>${p.correlation.toFixed(2)}</strong> | ${p.sector1}: ${m1 ? m1.m3.toFixed(1) : 'N/A'}%, ${p.sector2}: ${m2 ? m2.m3.toFixed(1) : 'N/A'}%</div>`;
        });
        html += `</div>`;
    }

    if (sellSignals.length > 0) {
        html += `<div class="signal-card signal-sell">
            <div class="signal-title">🔴 AVOID / REDUCE</div>`;
        sellSignals.slice(0, 2).forEach(s => {
            html += `<div class="signal-metric"><strong>${s.sector}</strong> - Momentum fading</div>`;
            html += `<div class="signal-metric">3M: <strong>${s.m3.toFixed(1)}%</strong></div>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

/**
 * Show sector stocks panel with live data from API
 */
async function showSectorStocks(sectorName) {
    // Determine which panel to use based on current view
    const isForecastView = document.getElementById('forecast-panel').style.display === 'block';

    const panelId = isForecastView ? 'forecast-sector-stocks-panel' : 'sector-stocks-panel';
    const titleId = isForecastView ? 'forecast-sector-stocks-title' : 'sector-stocks-title';
    const tableId = isForecastView ? 'forecast-sector-stocks-table' : 'sector-stocks-table';

    const panel = document.getElementById(panelId);
    const title = document.getElementById(titleId);
    const tableContainer = document.getElementById(tableId);

    // Show loading state
    title.textContent = `${sectorName} - Loading...`;
    panel.style.display = 'block';
    tableContainer.innerHTML = '<p style="color: #8b949e; padding: 20px; text-align: center;">🔄 Fetching live data from Upstox...</p>';

    try {
        // Fetch live contributor data from API
        const apiUrl = `http://localhost:5555/api/sector-contributors?sector=${encodeURIComponent(sectorName)}&range=${currentRange}`;
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error(data.error || 'Failed to fetch data');
        }

        const contributors = data.contributors || [];

        if (contributors.length === 0) {
            tableContainer.innerHTML = '<p style="color: #8b949e; padding: 20px;">No contributor data available for this sector.</p>';
            title.textContent = `${sectorName} - Top Stocks`;
            return;
        }

        // Get sector momentum data
        const sectorData = processor.getFilteredData().momentum.find(m => m.sector === sectorName);
        const momentumInfo = sectorData ?
            `1M: <strong>${ChartUtils.formatPercent(sectorData.m1)}</strong> | ` +
            `3M: <strong>${ChartUtils.formatPercent(sectorData.m3)}</strong> | ` +
            `6M: <strong>${ChartUtils.formatPercent(sectorData.m6)}</strong>` : '';

        // Create table HTML
        let tableHtml = `
            <div style="margin-bottom: 15px; padding: 12px; background: #21262d; border-radius: 6px;">
                <span style="color: #8b949e; font-size: 0.9em;">Sector Momentum: ${momentumInfo}</span>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 1px solid #30363d;">
                        <th style="text-align: left; padding: 10px; color: #58a6ff; font-size: 0.85em;">#</th>
                        <th style="text-align: left; padding: 10px; color: #58a6ff; font-size: 0.85em;">Symbol</th>
                        <th style="text-align: right; padding: 10px; color: #58a6ff; font-size: 0.85em;">Start Price</th>
                        <th style="text-align: right; padding: 10px; color: #58a6ff; font-size: 0.85em;">End Price</th>
                        <th style="text-align: right; padding: 10px; color: #58a6ff; font-size: 0.85em;">Period Return</th>
                        <th style="text-align: right; padding: 10px; color: #58a6ff; font-size: 0.85em;">3M Return</th>
                    </tr>
                </thead>
                <tbody>
        `;

        contributors.forEach((stock, index) => {
            const returnColor = stock.periodReturn >= 0 ? '#22c55e' : '#ef4444';
            const returnSign = stock.periodReturn >= 0 ? '+' : '';

            tableHtml += `
                <tr style="border-bottom: 1px solid #21262d; transition: background 0.2s;" onmouseover="this.style.background='#21262d'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 10px; color: #8b949e; font-size: 0.9em;">${index + 1}</td>
                    <td style="padding: 10px; color: #c9d1d9; font-weight: 500; font-size: 0.9em;">${stock.symbol}</td>
                    <td style="padding: 10px; color: #8b949e; font-size: 0.9em; text-align: right;">₹${stock.startPrice}</td>
                    <td style="padding: 10px; color: #8b949e; font-size: 0.9em; text-align: right;">₹${stock.endPrice}</td>
                    <td style="padding: 10px; color: ${returnColor}; font-weight: 600; font-size: 0.9em; text-align: right;">${returnSign}${stock.periodReturn}%</td>
                    <td style="padding: 10px; color: ${stock.m3Return >= 0 ? '#22c55e' : '#ef4444'}; font-size: 0.85em; text-align: right;">${stock.m3Return >= 0 ? '+' : ''}${stock.m3Return}%</td>
                </tr>
            `;
        });

        tableHtml += `
                </tbody>
            </table>
            <div style="margin-top: 15px; padding: 10px; background: rgba(56, 139, 253, 0.1); border-left: 3px solid #388bfd; border-radius: 4px;">
                <p style="color: #8b949e; font-size: 0.85em; margin: 0;">
                    💡 <strong>Live data from Upstox</strong> • Period: <strong>${currentRange.toUpperCase()}</strong>
                    • ${contributors.length} stocks analyzed • Sorted by contribution
                </p>
            </div>
        `;

        tableContainer.innerHTML = tableHtml;
        title.textContent = `${sectorName} - Stock Contributors`;

    } catch (error) {
        console.error('Error fetching sector contributors:', error);
        tableContainer.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <p style="color: #f85149; margin-bottom: 10px;">⚠️ Unable to fetch live data</p>
                <p style="color: #8b949e; font-size: 0.9em; margin-bottom: 15px;">${error.message}</p>
                <p style="color: #8b949e; font-size: 0.85em;">Make sure the API server is running on <code>python sector_contributors_api.py</code></p>
            </div>
        `;
        title.textContent = `${sectorName} - Error`;
    }

    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Close sector stocks panel
 */
function closeSectorStocks() {
    // Close both panels (one will be hidden, one visible)
    const overviewPanel = document.getElementById('sector-stocks-panel');
    const forecastPanel = document.getElementById('forecast-sector-stocks-panel');
    if (overviewPanel) overviewPanel.style.display = 'none';
    if (forecastPanel) forecastPanel.style.display = 'none';
}

/**
 * Update correlation insights panel
 */
function updateCorrelationInsights(correlations, momentumData) {
    const container = document.getElementById('correlation-insights');

    console.log('Correlation data:', correlations);
    console.log('Momentum data:', momentumData);

    // Filter out self-correlations (same sector)
    const crossCorrelations = correlations.filter(c => c.sector1 !== c.sector2);

    console.log('Cross correlations:', crossCorrelations);

    // Get top positive and negative correlations
    const topPositive = [...crossCorrelations]
        .sort((a, b) => b.correlation - a.correlation)
        .slice(0, 5);

    const topNegative = [...crossCorrelations]
        .filter(c => c.correlation < 0)
        .sort((a, b) => a.correlation - b.correlation)
        .slice(0, 5);

    console.log('Top positive:', topPositive);
    console.log('Top negative:', topNegative);

    let html = '';

    // If no data, show message
    if (crossCorrelations.length === 0) {
        container.innerHTML = '<div style="padding: 20px; color: #8b949e; text-align: center;">No correlation data available</div>';
        return;
    }

    // Highest correlated (move together)
    html += `
        <div style="margin-bottom: 20px;">
            <div style="color: #22c55e; font-size: 0.9em; font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 1.2em;">📈</span> Highest Correlated (Move Together)
            </div>
            <div style="background: #21262d; border-radius: 6px; overflow: hidden;">
    `;

    topPositive.forEach((p, i) => {
        const m1 = momentumData.find(m => m.sector === p.sector1);
        const m2 = momentumData.find(m => m.sector === p.sector2);
        const intensity = Math.min(Math.abs(p.correlation), 1);
        const color = d3.interpolateRgb("#21262d", "#22c55e")(intensity);

        html += `
            <div style="padding: 10px 12px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;" onmouseover="this.style.background='#30363d'" onmouseout="this.style.background='transparent'">
                <div style="flex: 1;">
                    <div style="color: #c9d1d9; font-weight: 500; font-size: 0.9em; margin-bottom: 3px;">
                        <strong>${p.sector1}</strong> ↔ <strong>${p.sector2}</strong>
                    </div>
                    <div style="color: #8b949e; font-size: 0.8em;">
                        3M: ${m1 ? m1.m3.toFixed(1) : 'N/A'}% | ${m2 ? m2.m3.toFixed(1) : 'N/A'}%
                    </div>
                </div>
                <div style="text-align: right; min-width: 60px;">
                    <div style="background: ${color}; color: ${p.correlation > 0.5 ? '#fff' : '#000'}; padding: 4px 10px; border-radius: 4px; font-weight: 600; font-size: 0.85em;">
                        ${p.correlation > 0 ? '+' : ''}${p.correlation.toFixed(2)}
                    </div>
                </div>
            </div>
        `;
    });

    if (topPositive.length === 0) {
        html += `<div style="padding: 15px; color: #8b949e; font-size: 0.85em; text-align: center;">No positive correlations found</div>`;
    }

    html += `</div></div>`;

    // Least correlated / inverse correlated (move opposite)
    html += `
        <div>
            <div style="color: #ef4444; font-size: 0.9em; font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 1.2em;">📉</span> Least Correlated (Move Opposite)
            </div>
            <div style="background: #21262d; border-radius: 6px; overflow: hidden;">
    `;

    topNegative.forEach((p, i) => {
        const m1 = momentumData.find(m => m.sector === p.sector1);
        const m2 = momentumData.find(m => m.sector === p.sector2);
        const intensity = Math.min(Math.abs(p.correlation), 1);
        const color = d3.interpolateRgb("#21262d", "#ef4444")(intensity);

        html += `
            <div style="padding: 10px 12px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;" onmouseover="this.style.background='#30363d'" onmouseout="this.style.background='transparent'">
                <div style="flex: 1;">
                    <div style="color: #c9d1d9; font-weight: 500; font-size: 0.9em; margin-bottom: 3px;">
                        <strong>${p.sector1}</strong> ↔ <strong>${p.sector2}</strong>
                    </div>
                    <div style="color: #8b949e; font-size: 0.8em;">
                        3M: ${m1 ? m1.m3.toFixed(1) : 'N/A'}% | ${m2 ? m2.m3.toFixed(1) : 'N/A'}%
                    </div>
                </div>
                <div style="text-align: right; min-width: 60px;">
                    <div style="background: ${color}; color: #fff; padding: 4px 10px; border-radius: 4px; font-weight: 600; font-size: 0.85em;">
                        ${p.correlation.toFixed(2)}
                    </div>
                </div>
            </div>
        `;
    });

    if (topNegative.length === 0) {
        html += `<div style="padding: 15px; color: #8b949e; font-size: 0.85em; text-align: center;">No inverse correlations found</div>`;
    }

    html += `</div></div>`;

    // Add explanation at bottom
    html += `
        <div style="margin-top: 15px; padding: 10px; background: rgba(56, 139, 253, 0.1); border-left: 3px solid #388bfd; border-radius: 4px;">
            <p style="color: #8b949e; font-size: 0.8em; margin: 0;">
                💡 <strong>+1.0</strong> = Always move together • <strong>-1.0</strong> = Always move opposite •
                Use inverse correlations for <strong>pair trading</strong> or <strong>rotation strategies</strong>
            </p>
        </div>
    `;

    container.innerHTML = html;
}

/**
 * Update forecast view with predictions
 */
function updateForecastView(data) {
    const container = document.getElementById('forecast-container');

    // Calculate various prediction signals
    const momentumRanking = [...data.momentum].sort((a, b) => b.m3 - a.m3);
    const topPerformers = momentumRanking.slice(0, 5);
    const bottomPerformers = momentumRanking.slice(-5);

    // Calculate momentum trend (improving vs worsening)
    const momentumTrendUp = data.momentum.filter(m => m.m1 > 0 && m.m3 > 0 && m.m3 > m.m1);
    const momentumTrendDown = data.momentum.filter(m => m.m1 < 0 && m.m3 < 0);

    // Calculate 1M vs 3M momentum shift
    const momentumAccelerating = data.momentum.filter(m => m.m3 > 0 && m.m1 > m.m3 * 0.5);
    const momentumDecelerating = data.momentum.filter(m => m.m3 > 0 && m.m1 < m.m3 * 0.3);

    // Get recent quarterly leaders
    // quarterly is {quarter: [{sector, return}, ...], ...}
    const quarterEntries = Object.entries(data.quarterly);
    const recentQuarters = quarterEntries
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-2);

    const recentLeaders = recentQuarters.map(([q, quarterData]) => {
        if (!Array.isArray(quarterData)) {
            return { quarter: q, leaders: [] };
        }
        const sortedData = [...quarterData].sort((a, b) => b.return - a.return);
        const top3 = sortedData.slice(0, 3);
        return { quarter: q, leaders: top3.map(t => t.sector) };
    });

    let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px;">
    `;

    // 1. Current Leaders
    html += `
        <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid #22c55e; border-radius: 8px; padding: 15px;">
            <div style="color: #22c55e; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">🚀</span> Current Leaders (Top 5 by 3M Momentum)
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
    `;

    topPerformers.forEach((s, i) => {
        html += `
            <div style="background: #21262d; padding: 10px 12px; border-radius: 6px; border-left: 3px solid #22c55e; cursor: pointer; transition: background 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.background='#30363d'" onmouseout="this.style.background='#21262d'">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #c9d1d9; font-weight: 500;">#${i + 1} ${s.sector}</span>
                    <span style="color: #22c55e; font-weight: 600;">${s.m3.toFixed(1)}%</span>
                </div>
                <div style="color: #8b949e; font-size: 0.8em; margin-top: 4px;">1M: ${s.m1.toFixed(1)}% | 6M: ${s.m6.toFixed(1)}%</div>
            </div>
        `;
    });

    html += `</div></div>`;

    // 2. Momentum Acceleration (Picking Up Speed)
    html += `
        <div style="background: rgba(56, 139, 253, 0.1); border: 1px solid #388bfd; border-radius: 8px; padding: 15px;">
            <div style="color: #388bfd; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">📈</span> Gaining Momentum (Acceleration)
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 8px;">
                <strong>Formula:</strong> Sectors where <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">3M > 0</code> AND <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">1M > 50% of 3M</code>
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 10px;">
                💡 <strong>Meaning:</strong> These sectors had good 3-month performance AND recent 1-month return is more than half of that 3-month return, indicating momentum is <strong>accelerating</strong> recently.
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
    `;

    momentumAccelerating.slice(0, 8).forEach(s => {
        html += `
            <span style="background: #388bfd; color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 500; cursor: pointer; transition: transform 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                ${s.sector} (${s.m1.toFixed(1)}%)
            </span>
        `;
    });

    if (momentumAccelerating.length === 0) {
        html += `<div style="color: #8b949e; font-size: 0.85em;">No sectors accelerating</div>`;
    }

    html += `</div></div>`;

    // 3. Momentum Deceleration (Losing Speed)
    html += `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 15px;">
            <div style="color: #ef4444; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">📉</span> Losing Momentum (Deceleration)
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 8px;">
                <strong>Formula:</strong> Sectors where <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">3M > 0</code> BUT <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">1M < 30% of 3M</code>
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 10px;">
                💡 <strong>Meaning:</strong> These sectors had strong 3-month gains BUT recent 1-month return is less than 30% of that, indicating momentum is <strong>slowing down</strong> - could be cooling off or reversing.
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
    `;

    momentumDecelerating.slice(0, 8).forEach(s => {
        html += `
            <span style="background: #ef4444; color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 500; cursor: pointer; transition: transform 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                ${s.sector} (${s.m1.toFixed(1)}%)
            </span>
        `;
    });

    if (momentumDecelerating.length === 0) {
        html += `<div style="color: #8b949e; font-size: 0.85em;">No sectors decelerating</div>`;
    }

    html += `</div></div>`;

    // 4. Rotation Predictions
    html += `
        <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid #fbbf24; border-radius: 8px; padding: 15px;">
            <div style="color: #fbbf24; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">🔄</span> Rotation Predictions (Next 1-3 Months)
            </div>
    `;

    // Find sectors that might rotate in
    const readyToBreakout = data.momentum.filter(m => m.m3 > 5 && m.m3 < 15 && m.m1 > m.m3 * 0.8);
    if (readyToBreakout.length > 0) {
        html += `<div style="margin-bottom: 12px;">
            <div style="color: #fbbf24; font-weight: 600; margin-bottom: 6px;">Ready to Breakout:</div>
            <div style="color: #8b949e; font-size: 0.82em; margin-bottom: 8px; padding-left: 8px; border-left: 2px solid #fbbf24;">
                <strong>Formula:</strong> <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">5% < 3M < 15%</code> AND <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">1M > 80% of 3M</code><br>
                💡 Sectors with moderate gains but <strong>very strong recent momentum</strong> - could be next leaders
            </div>
        </div>`;
        html += `<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">`;
        readyToBreakout.forEach(s => {
            html += `<span style="background: #fbbf24; color: #000; padding: 4px 10px; border-radius: 15px; font-size: 0.8em; font-weight: 600; cursor: pointer; transition: transform 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">${s.sector}</span>`;
        });
        html += `</div>`;
    }

    // Find sectors that might be overextended
    const overextended = data.momentum.filter(m => m.m3 > 30 && m.m1 < m.m3 * 0.5);
    if (overextended.length > 0) {
        html += `<div style="margin-bottom: 12px;">
            <div style="color: #ef4444; font-weight: 600; margin-bottom: 6px;">Potentially Overextended (may pull back):</div>
            <div style="color: #8b949e; font-size: 0.82em; margin-bottom: 8px; padding-left: 8px; border-left: 2px solid #ef4444;">
                <strong>Formula:</strong> <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">3M > 30%</code> BUT <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">1M < 50% of 3M</code><br>
                💡 Sectors with <strong>very high 3-month gains</strong> but <strong>slowing recently</strong> - risk of pullback or profit-booking
            </div>
        </div>`;
        html += `<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">`;
        overextended.forEach(s => {
            html += `<span style="background: #ef4444; color: #fff; padding: 4px 10px; border-radius: 15px; font-size: 0.8em; font-weight: 600; cursor: pointer; transition: transform 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">${s.sector} (${s.m3.toFixed(0)}%)</span>`;
        });
        html += `</div>`;
    }

    html += `</div>`;

    // 5. Historical Pattern Analysis
    html += `
        <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid #a855f7; border-radius: 8px; padding: 15px;">
            <div style="color: #a855f7; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">📊</span> Recent Quarterly Leadership
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 10px;">Track which sectors led in recent quarters to spot rotation patterns</div>
    `;

    recentLeaders.forEach(r => {
        html += `
            <div style="background: #21262d; padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                <div style="color: #a855f7; font-weight: 600; font-size: 0.9em; margin-bottom: 6px;">${r.quarter}</div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        `;
        r.leaders.forEach((leader, i) => {
            const medals = ['🥇', '🥈', '🥉'];
            html += `<span style="color: #c9d1d9; font-size: 0.85em;">${medals[i]} ${leader}</span>`;
        });
        html += `</div></div>`;
    });

    html += `</div>`;

    // 6. Consistency Analysis - Most Consistent Performers
    html += `
        <div style="background: rgba(20, 184, 166, 0.1); border: 1px solid #14b8a6; border-radius: 8px; padding: 15px;">
            <div style="color: #14b8a6; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">🎯</span> Consistency Leaders (Steady Performers)
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 8px;">
                <strong>Formula:</strong> Sectors with <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">1M, 3M, 6M ALL > 0</code><br>
                💡 <strong>Meaning:</strong> These sectors show <strong>consistent positive returns</strong> across all timeframes - lower volatility, steady compounders
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
    `;

    const consistentPerformers = data.momentum.filter(m => m.m1 > 0 && m.m3 > 0 && m.m6 > 0)
        .sort((a, b) => b.m6 - a.m6)
        .slice(0, 8);

    consistentPerformers.forEach(s => {
        const avgReturn = (s.m1 + s.m3 + s.m6) / 3;
        html += `
            <span style="background: #14b8a6; color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 500; cursor: pointer; transition: transform 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                ${s.sector} <span style="opacity: 0.8; font-size: 0.85em;">(${s.m6.toFixed(0)}%)</span>
            </span>
        `;
    });

    if (consistentPerformers.length === 0) {
        html += `<div style="color: #8b949e; font-size: 0.85em;">No consistent performers in current period</div>`;
    }

    html += `</div></div>`;

    // 7. Recovery Candidates - Falling but showing signs of life
    html += `
        <div style="background: rgba(244, 114, 182, 0.1); border: 1px solid #f472b6; border-radius: 8px; padding: 15px;">
            <div style="color: #f472b6; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">🔄</span> Recovery Candidates (Potential Turnaround)
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 8px;">
                <strong>Formula:</strong> Sectors with <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">6M < 0</code> BUT <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">1M > 0</code><br>
                💡 <strong>Meaning:</strong> These sectors were down over 6 months but showing <strong>recent positive momentum</strong> - could be bottoming out
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
    `;

    const recoveryCandidates = data.momentum.filter(m => m.m6 < 0 && m.m1 > 0)
        .sort((a, b) => b.m1 - a.m1);

    recoveryCandidates.slice(0, 8).forEach(s => {
        html += `
            <span style="background: #f472b6; color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 500; cursor: pointer; transition: transform 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                ${s.sector} <span style="opacity: 0.8; font-size: 0.85em;">(${s.m6.toFixed(0)}% → ${s.m1.toFixed(0)}%)</span>
            </span>
        `;
    });

    if (recoveryCandidates.length === 0) {
        html += `<div style="color: #8b949e; font-size: 0.85em;">No recovery candidates in current period</div>`;
    }

    html += `</div></div>`;

    // 8. Volatility Analysis - High Beta Sectors
    html += `
        <div style="background: rgba(251, 146, 60, 0.1); border: 1px solid #fb923c; border-radius: 8px; padding: 15px;">
            <div style="color: #fb923c; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">🎢</span> High Volatility Sectors
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 8px;">
                <strong>Formula:</strong> Sectors with <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">|Best Month - Worst Month| > 15%</code> in selected period<br>
                💡 <strong>Meaning:</strong> These sectors have <strong>large price swings</strong> - higher risk/reward, trade with caution
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
    `;

    // Calculate volatility from heatmap data
    const sectorVolatility = {};
    Object.values(processor.filteredHeatmapData).forEach(d => {
        if (!sectorVolatility[d.sector]) {
            sectorVolatility[d.sector] = { ranks: [], returns: [] };
        }
        sectorVolatility[d.sector].ranks.push(d.rank);
        sectorVolatility[d.sector].returns.push(d.return);
    });

    const volatileSectors = Object.keys(sectorVolatility)
        .map(sector => {
            const returns = sectorVolatility[sector].returns;
            if (returns.length < 2) return { sector, range: 0 };
            const minRet = Math.min(...returns);
            const maxRet = Math.max(...returns);
            const range = maxRet - minRet;
            const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - returns.reduce((s, x) => s + x, 0) / returns.length, 2), 0) / returns.length);
            return { sector, range, stdDev, avgReturn: returns.reduce((s, x) => s + x, 0) / returns.length };
        })
        .filter(s => s.range > 15)
        .sort((a, b) => b.range - a.range)
        .slice(0, 8);

    volatileSectors.forEach(s => {
        html += `
            <span style="background: #fb923c; color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 500; cursor: pointer; transition: transform 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                ${s.sector} <span style="opacity: 0.8; font-size: 0.85em;">(±${s.range.toFixed(0)}%)</span>
            </span>
        `;
    });

    if (volatileSectors.length === 0) {
        html += `<div style="color: #8b949e; font-size: 0.85em;">No high volatility sectors in current period</div>`;
    }

    html += `</div></div>`;

    // 9. Defensive Sectors - Safe Havens
    html += `
        <div style="background: rgba(129, 140, 248, 0.1); border: 1px solid #818cf8; border-radius: 8px; padding: 15px;">
            <div style="color: #818cf8; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">🛡️</span> Defensive Sectors (Low Correlation with Market)
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 8px;">
                <strong>Formula:</strong> Sectors with <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">Average correlation < 0.3</code> with all other sectors<br>
                💡 <strong>Meaning:</strong> These sectors move <strong>independently</strong> - good for diversification and hedging
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
    `;

    // Calculate average correlation for each sector
    const sectorAvgCorr = {};
    data.correlations.forEach(c => {
        if (c.sector1 !== c.sector2) {
            if (!sectorAvgCorr[c.sector1]) sectorAvgCorr[c.sector1] = [];
            if (!sectorAvgCorr[c.sector2]) sectorAvgCorr[c.sector2] = [];
            sectorAvgCorr[c.sector1].push(Math.abs(c.correlation));
            sectorAvgCorr[c.sector2].push(Math.abs(c.correlation));
        }
    });

    const defensiveSectors = Object.keys(sectorAvgCorr)
        .map(sector => ({
            sector,
            avgCorr: sectorAvgCorr[sector].reduce((a, b) => a + b, 0) / sectorAvgCorr[sector].length
        }))
        .filter(s => s.avgCorr < 0.4)
        .sort((a, b) => a.avgCorr - b.avgCorr)
        .slice(0, 8);

    defensiveSectors.forEach(s => {
        html += `
            <span style="background: #818cf8; color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 500; cursor: pointer; transition: transform 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                ${s.sector} <span style="opacity: 0.8; font-size: 0.85em;">(corr: ${(s.avgCorr * 100).toFixed(0)}%)</span>
            </span>
        `;
    });

    if (defensiveSectors.length === 0) {
        html += `<div style="color: #8b949e; font-size: 0.85em;">All sectors highly correlated in current period</div>`;
    }

    html += `</div></div>`;

    // 10. Key Insights Summary
    html += `
        <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid #38bdf8; border-radius: 8px; padding: 15px;">
            <div style="color: #38bdf8; font-size: 1em; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3em;">💡</span> Key Market Insights
            </div>
            <div style="color: #c9d1d9; font-size: 0.9em; line-height: 1.6;">
    `;

    // Generate insights
    const insights = [];

    // Check market regime
    const avg3M = data.momentum.reduce((sum, m) => sum + m.m3, 0) / data.momentum.length;
    const positive3M = data.momentum.filter(m => m.m3 > 0).length;
    const positiveRatio = positive3M / data.momentum.length;

    if (positiveRatio > 0.7) {
        insights.push(`📈 <strong>Bullish Phase:</strong> ${positive3M}/${data.momentum.length} sectors showing positive 3M momentum (avg: ${avg3M.toFixed(1)}%)`);
    } else if (positiveRatio < 0.3) {
        insights.push(`📉 <strong>Bearish Phase:</strong> Only ${positive3M}/${data.momentum.length} sectors positive (avg: ${avg3M.toFixed(1)}%)`);
    } else {
        insights.push(`⚖️ <strong>Mixed Market:</strong> ${positive3M}/${data.momentum.length} sectors positive - stock picking environment`);
    }

    // Rotation detection
    if (recentLeaders.length >= 2) {
        const prevLeaders = new Set(recentLeaders[0]?.leaders || []);
        const currLeaders = new Set(recentLeaders[1]?.leaders || []);
        const newLeaders = [...currLeaders].filter(l => !prevLeaders.has(l));
        const droppedLeaders = [...prevLeaders].filter(l => !currLeaders.has(l));

        if (newLeaders.length > 0 || droppedLeaders.length > 0) {
            insights.push(`🔄 <strong>Rotation Detected:</strong> ${newLeaders.length > 0 ? newLeaders.join(', ') + ' entered' : ''}${newLeaders.length > 0 && droppedLeaders.length > 0 ? ', ' : ''}${droppedLeaders.length > 0 ? droppedLeaders.join(', ') + ' exited' : ''} leadership`);
        }
    }

    // Concentration risk
    const top3Concentration = data.momentum.sort((a, b) => b.m3 - a.m3).slice(0, 3)
        .reduce((sum, m) => sum + m.m3, 0);
    const totalMarket3M = data.momentum.reduce((sum, m) => sum + m.m3, 0);
    const concentration = totalMarket3M !== 0 ? (top3Concentration / Math.abs(totalMarket3M)) * 100 : 0;

    if (concentration > 60) {
        insights.push(`⚠️ <strong>Concentrated Market:</strong> Top 3 sectors contribute ${concentration.toFixed(0)}% of total returns - high concentration risk`);
    } else if (concentration < 30) {
        insights.push(`🌐 <strong>Broad Market:</strong> Returns distributed across ${data.momentum.length} sectors - healthy diversification`);
    }

    // Volatility regime
    const avgVolatility = volatileSectors.length > 0
        ? volatileSectors.reduce((sum, s) => sum + s.range, 0) / volatileSectors.length
        : 0;

    if (avgVolatility > 25) {
        insights.push(`🎢 <strong>High Volatility:</strong> ${volatileSectors.length} sectors with >15% monthly swings - elevated risk environment`);
    }

    // Correlation regime
    const allCorrs = data.correlations
        .filter(c => c.sector1 !== c.sector2)
        .map(c => Math.abs(c.correlation));
    const avgCorr = allCorrs.reduce((a, b) => a + b, 0) / allCorrs.length;

    if (avgCorr > 0.6) {
        insights.push(`🔗 <strong>High Correlation:</strong> Avg ${(avgCorr * 100).toFixed(0)}% - sectors moving together, low diversification benefit`);
    } else if (avgCorr < 0.3) {
        insights.push(`🔀 <strong>Low Correlation:</strong> Avg ${(avgCorr * 100).toFixed(0)}% - good stock picking opportunities`);
    }

    insights.forEach(insight => {
        html += `<div style="margin-bottom: 8px;">• ${insight}</div>`;
    });

    html += `</div></div>`;

    html += `</div>`; // Close grid

    // 11. Outlier Stocks - Rapid Growth Stars
    html += `
        <div style="margin-top: 25px; padding: 20px; background: rgba(34, 197, 94, 0.08); border: 1px solid #22c55e; border-radius: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                <div style="color: #22c55e; font-size: 1.1em; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 1.4em;">⚡</span> Rapid Growth Stars (Outlier Stocks)
                </div>
                <button onclick="fetchOutlierStocks()" style="padding: 8px 16px; font-size: 0.85em; background: #22c55e; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    🔄 Load Live Data
                </button>
            </div>
            <div style="color: #8b949e; font-size: 0.85em; margin-bottom: 15px;">
                <strong>Formula:</strong> Stocks with <code style="background: #21262d; padding: 2px 6px; border-radius: 3px;">Period Return > 2× Sector Average</code><br>
                💡 <strong>Meaning:</strong> These stocks are <strong>significantly outperforming</strong> their sector's average return - potential multi-baggers or momentum leaders
            </div>
            <div id="outlier-stocks-container" style="color: #8b949e; font-size: 0.9em; padding: 15px; text-align: center; background: rgba(0,0,0,0.2); border-radius: 6px;">
                Click "Load Live Data" to fetch outlier stocks from the API
            </div>
        </div>
    `;

    // Disclaimer
    html += `
        <div style="margin-top: 20px; padding: 12px; background: rgba(251, 146, 60, 0.1); border-left: 3px solid #fb923c; border-radius: 6px;">
            <p style="color: #8b949e; font-size: 0.85em; margin: 0;">
                ⚠️ <strong>Disclaimer:</strong> These predictions and outlier stock analysis are based on historical momentum patterns and correlations.
                They are NOT financial advice. Always do your own research and consider market conditions before making investment decisions.
                Outlier stocks may be volatile and risky - invest carefully.
            </p>
        </div>
    `;

    container.innerHTML = html;
}

/**
 * Fetch outlier stocks showing rapid growth compared to sector
 */
async function fetchOutlierStocks() {
    const container = document.getElementById('outlier-stocks-container');
    container.innerHTML = '<p style="color: #8b949e; padding: 20px; text-align: center;">🔄 Fetching live data from Upstox...</p>';

    try {
        // Get sector averages first
        const data = processor.getFilteredData();
        const sectorAverages = {};
        data.momentum.forEach(m => {
            sectorAverages[m.sector] = m.m3; // Use 3M return as sector average
        });

        // Fetch stocks for each sector
        const allOutliers = [];
        const sectorPromises = data.momentum.map(async (sector) => {
            try {
                const apiUrl = `http://localhost:5555/api/sector-contributors?sector=${encodeURIComponent(sector.sector)}&range=${currentRange}`;
                const response = await fetch(apiUrl);
                const result = await response.json();

                if (!response.ok || result.error) {
                    return [];
                }

                const contributors = result.contributors || [];
                const sectorAvg = sectorAverages[sector.sector] || 0;

                // Find outliers: stocks significantly outperforming their sector
                // For positive sectors: return > 2x sector average
                // For negative sectors: return > sector average by at least 10 percentage points
                return contributors
                    .filter(stock => {
                        if (sectorAvg >= 0) {
                            // Positive sector: stock must beat 2x sector average
                            return stock.periodReturn > sectorAvg * 2;
                        } else {
                            // Negative sector: stock must be significantly better (less negative) than sector
                            // and preferably positive
                            const outperformance = stock.periodReturn - sectorAvg;
                            return outperformance > 10; // At least 10% better than sector
                        }
                    })
                    .map(stock => {
                        // Calculate outperformance multiple properly
                        let outperformanceMultiple;
                        if (sectorAvg > 0) {
                            // For positive sectors: ratio of stock return to sector return
                            outperformanceMultiple = stock.periodReturn / sectorAvg;
                        } else if (sectorAvg < 0) {
                            // For negative sectors: how much better is the stock than sector?
                            // e.g., sector -10%, stock +20%: stock is 30% better = 3x better
                            const outperformance = stock.periodReturn - sectorAvg;
                            // Use absolute value of sector average as baseline
                            const baseline = Math.abs(sectorAvg);
                            outperformanceMultiple = baseline > 0 ? outperformance / baseline : stock.periodReturn;
                        } else {
                            // Sector is 0: just use the stock return
                            outperformanceMultiple = stock.periodReturn;
                        }

                        return {
                            ...stock,
                            sectorName: sector.sector,
                            sectorAvg: sectorAvg,
                            outperformanceMultiple: outperformanceMultiple
                        };
                    })
                    .sort((a, b) => b.periodReturn - a.periodReturn)
                    .slice(0, 3); // Top 3 outliers per sector
            } catch (error) {
                console.error(`Error fetching ${sector.sector}:`, error);
                return [];
            }
        });

        const sectorResults = await Promise.all(sectorPromises);
        sectorResults.forEach(outliers => {
            allOutliers.push(...outliers);
        });

        // Sort by return and get top 15 overall
        const topOutliers = allOutliers.sort((a, b) => b.periodReturn - a.periodReturn).slice(0, 15);

        if (topOutliers.length === 0) {
            container.innerHTML = '<p style="color: #8b949e; padding: 20px; text-align: center;">No outlier stocks found in current period. Try extending the time range.</p>';
            return;
        }

        // Generate HTML
        let html = `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px;">
        `;

        topOutliers.forEach(stock => {
            const returnColor = stock.periodReturn >= 50 ? '#22c55e' : stock.periodReturn >= 20 ? '#fbbf24' : stock.periodReturn >= 0 ? '#fff' : '#ef4444';
            const returnSign = stock.periodReturn >= 0 ? '+' : '';

            // Choose emoji based on raw return, not multiple
            const multipleEmoji = stock.periodReturn >= 50 ? '🚀' : stock.periodReturn >= 25 ? '⚡' : stock.periodReturn >= 0 ? '📈' : '📉';

            // Calculate outperformance display
            let outperformanceDisplay;
            if (stock.sectorAvg > 0) {
                // Positive sector: show multiple
                outperformanceDisplay = `${stock.outperformanceMultiple.toFixed(1)}x`;
            } else if (stock.sectorAvg < 0) {
                // Negative sector: show percentage points better
                const pointsBetter = stock.periodReturn - stock.sectorAvg;
                outperformanceDisplay = `+${pointsBetter.toFixed(0)} pts`;
            } else {
                outperformanceDisplay = `${stock.outperformanceMultiple.toFixed(1)}x`;
            }

            html += `
                <div style="background: #21262d; padding: 12px; border-radius: 6px; border-left: 3px solid ${returnColor}; transition: background 0.2s; cursor: pointer;" onmouseover="this.style.background='#30363d'" onmouseout="this.style.background='#21262d'">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                        <div>
                            <div style="color: #c9d1d9; font-weight: 600; font-size: 0.95em;">${stock.symbol}</div>
                            <div style="color: #8b949e; font-size: 0.8em;">${stock.sectorName}</div>
                        </div>
                        <span style="font-size: 1.2em;">${multipleEmoji}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85em;">
                        <div>
                            <span style="color: #8b949e;">Return:</span>
                            <span style="color: ${returnColor}; font-weight: 600; margin-left: 6px;">${returnSign}${stock.periodReturn}%</span>
                        </div>
                        <div style="color: #8b949e;">
                            Sector: <span style="color: #c9d1d9;">${stock.sectorAvg >= 0 ? '+' : ''}${stock.sectorAvg.toFixed(0)}%</span>
                        </div>
                    </div>
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #30363d; font-size: 0.8em;">
                        <span style="color: #8b949e;">${stock.sectorAvg > 0 ? 'Outperforming sector by' : 'Beating sector by'}</span>
                        <span style="color: ${returnColor}; font-weight: 600; margin-left: 6px;">${outperformanceDisplay}</span>
                    </div>
                </div>
            `;
        });

        html += `</div>`;

        // Add summary
        html += `
            <div style="margin-top: 15px; padding: 10px; background: rgba(34, 197, 94, 0.1); border-radius: 6px; font-size: 0.85em; color: #8b949e;">
                <strong>Summary:</strong> Found ${topOutliers.length} outlier stocks across ${data.momentum.length} sectors
                ${topOutliers.length > 0 ? ` • Best performer: <strong style="color: #22c55e;">${topOutliers[0].symbol} (+${topOutliers[0].periodReturn}%)</strong>` : ''}
            </div>
        `;

        container.innerHTML = html;

    } catch (error) {
        console.error('Error fetching outlier stocks:', error);
        container.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <p style="color: #f85149; margin-bottom: 10px;">⚠️ Unable to fetch outlier stocks</p>
                <p style="color: #8b949e; font-size: 0.9em; margin-bottom: 15px;">${error.message}</p>
                <p style="color: #8b949e; font-size: 0.85em;">Make sure the API server is running on <code>python sector_contributors_api.py</code></p>
            </div>
        `;
    }
}

/**
 * Initialize Volume View
 */
async function initializeVolumeView() {
    const sectorSelect = document.getElementById('volume-sector-select');
    const yearSelect = document.getElementById('volume-year-select');

    if (!sectorSelect || !yearSelect) return;

    // If sectors are already loaded, don't reload
    if (sectorSelect.options.length > 1) return;

    try {
        // Fetch available sectors
        const response = await fetch('http://localhost:5555/api/sectors');
        const data = await response.json();

        // Populate sector dropdown
        sectorSelect.innerHTML = '';
        data.sectors.forEach(sector => {
            const option = document.createElement('option');
            option.value = sector;
            option.textContent = sector;
            sectorSelect.appendChild(option);
        });

        // Determine available years based on current system date
        // The API now returns 2 years of data
        const currentYear = new Date().getFullYear();
        yearSelect.innerHTML = '';

        // Show last 3 years (we request 2 years, plus current year for overlap)
        for (let year = currentYear; year >= currentYear - 2; year--) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year === currentYear) option.selected = true;
            yearSelect.appendChild(option);
        }

        // Load initial data for first sector
        loadVolumeData();

    } catch (error) {
        console.error('Error loading sectors:', error);
        const container = document.getElementById('volume-calendar-chart');
        if (container) {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #8b949e;">
                    <p style="margin-bottom: 10px;">⚠️ Unable to load sectors</p>
                    <p style="font-size: 0.9em;">Make sure the API server is running on <code>python sector_contributors_api.py</code></p>
                </div>
            `;
        }
    }
}

/**
 * Load volume data for selected sector and year
 */
async function loadVolumeData() {
    const sector = document.getElementById('volume-sector-select').value;
    const year = parseInt(document.getElementById('volume-year-select').value);
    const container = document.getElementById('volume-calendar-chart');

    if (!sector || !container) return;

    // Show loading state
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 400px; color: #8b949e;">
            <p style="font-size: 14px; margin-bottom: 12px;">🔄 Fetching volume data...</p>
            <p style="font-size: 12px;">This may take a moment</p>
        </div>
    `;

    try {
        // Request 2 years of data to have more historical context
        const response = await fetch(`http://localhost:5555/api/sector-volume?sector=${encodeURIComponent(sector)}&range=2y`);
        const result = await response.json();

        if (!response.ok || result.error) {
            throw new Error(result.error || 'Failed to fetch volume data');
        }

        // Initialize chart and render
        if (!charts.volumeCalendar) {
            charts.volumeCalendar = new VolumeCalendarChart('volume-calendar-chart');
        }

        charts.volumeCalendar.render(result.volumeData, year);

    } catch (error) {
        console.error('Error loading volume data:', error);
        container.innerHTML = `
            <div style="padding: 40px; text-align: center; color: #8b949e;">
                <p style="margin-bottom: 10px;">⚠️ Unable to load volume data</p>
                <p style="font-size: 0.9em; margin-bottom: 15px;">${error.message}</p>
                <p style="font-size: 0.85em;">Make sure the API server is running on <code>python sector_contributors_api.py</code></p>
            </div>
        `;
    }
}

/**
 * Initialize Seasonality View
 */
function initializeSeasonalityView(data) {
    if (!charts.seasonality) {
        charts.seasonality = new SeasonalityChart('seasonality-chart');
    }

    const sectors = Object.keys(data.timeSeries);
    charts.seasonality.render(data.timeSeries, sectors, currentRange);
}

/**
 * Initialize Risk Analysis View
 */
function initializeRiskView(data) {
    // Drawdown Chart
    if (!charts.drawdown) {
        charts.drawdown = new DrawdownChart('drawdown-chart');
    }

    const sectors = Object.keys(data.timeSeries);
    charts.drawdown.render(data.timeSeries, sectors, currentRange);

    // Mean Reversion Chart
    if (!charts.meanReversion) {
        charts.meanReversion = new MeanReversionChart('mean-reversion-chart');
    }

    charts.meanReversion.render(data.momentum, data.timeSeries, sectors, currentRange);
}

/**
 * Initialize Correlation Dendrogram
 */
function initializeCorrelationDendrogram(data) {
    if (!charts.correlationDendrogram) {
        charts.correlationDendrogram = new CorrelationDendrogramChart('correlation-dendrogram-chart');
    }

    const sectors = Object.keys(data.timeSeries);
    charts.correlationDendrogram.render(data.correlations, sectors, currentRange);
}

/**
 * Initialize Advanced Analysis View
 */
async function initializeAdvancedView(data) {
    const sectors = Object.keys(data.timeSeries);

    // Volume-Price Divergence Chart (requires volume data from API)
    if (!charts.volumePriceDivergence) {
        charts.volumePriceDivergence = new VolumePriceDivergenceChart('volume-price-divergence-chart');
    }

    // Fetch volume data for all sectors
    try {
        const volumePromises = sectors.map(async (sector) => {
            try {
                const response = await fetch(`http://localhost:5555/api/sector-volume?sector=${encodeURIComponent(sector)}&range=2y`);
                const result = await response.json();
                return { sector, volumeData: result.volumeData };
            } catch (error) {
                console.error(`Error fetching volume for ${sector}:`, error);
                return { sector, volumeData: [] };
            }
        });

        const volumeResults = await Promise.all(volumePromises);
        const volumeDataMap = {};
        volumeResults.forEach(({ sector, volumeData }) => {
            volumeDataMap[sector] = volumeData;
        });

        charts.volumePriceDivergence.render(volumeDataMap, data.timeSeries, sectors, currentRange);
    } catch (error) {
        console.error('Error loading volume data for divergence analysis:', error);
        const container = document.getElementById('volume-price-divergence-chart');
        if (container) {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #8b949e;">
                    <p style="margin-bottom: 10px;">⚠️ Unable to load volume data</p>
                    <p style="font-size: 0.9em;">Make sure the API server is running on <code>python sector_contributors_api.py</code></p>
                </div>
            `;
        }
    }

    // Relative Strength Chart
    if (!charts.relativeStrength) {
        charts.relativeStrength = new RelativeStrengthChart('relative-strength-chart');
    }

    charts.relativeStrength.render(data.timeSeries, sectors, currentRange);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initializeDashboard);

// Handle window resize
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderDashboard, 200);
});
