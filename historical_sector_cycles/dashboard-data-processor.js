/**
 * Dashboard Data Processor
 * Pure business logic for processing sector rotation data
 * No UI/DOM dependencies - can run in Node.js or browser
 */

// Sector to stocks mapping
const SECTOR_STOCKS = {
    'Finance': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK'],
    'Technology': ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LTIM'],
    'Energy': ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'TATAPOWER'],
    'Automotive': ['TATAMOTORS', 'MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT'],
    'Pharma': ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'AUROPHARMA', 'DIVISLAB'],
    'Consumer': ['TITAN', 'WHIRLPOOL', 'VOLTAS', 'BLUESTAR', 'HAVELLS'],
    'Infrastructure': ['LT', 'DLF', 'ADANIPORTS', 'BHARTIARTL', 'ABB'],
    'Metals': ['TATASTEEL', 'HINDALCO', 'JSWSTEEL', 'COALINDIA', 'NMDC'],
    'FMCG': ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR'],
    'Healthcare': ['APOLLOHOSP', 'MAXHEALTH', 'FORTIS', 'GLENMARK'],
    'Telecom': ['RELIANCE', 'BHARTIARTL', 'VODAFONEIDEA'],
    'Chemicals': ['PIIND', 'SRF', 'DEEPAKNTR', 'TATACHEM'],
    'Oil & Gas': ['RELIANCE', 'ONGC', 'GAIL', 'BPCL', 'IOC'],
    'Power': ['NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIPOWER', 'JSWENERGY'],
    'Real Estate': ['DLF', 'GODREJPROP', 'BRIGADE', 'OBEROIRLTY', 'PHOENIXLTD']
};

class DashboardDataProcessor {
    constructor() {
        this.timeSeriesBySector = null;
        this.heatmapData = null;
        this.filteredTimeSeries = null;
        this.filteredHeatmapData = null;
        this.filteredQuarterlyData = null;
        this.momentumData = null;
        this.correlations = null;
        this.dashboardData = null;
    }

    /**
     * Initialize with raw dashboard data
     */
    initialize(dashboardData) {
        this.dashboardData = dashboardData;

        // Build time series data
        this.timeSeriesBySector = {};
        dashboardData.time_series.forEach(d => {
            if (!this.timeSeriesBySector[d.sector]) {
                this.timeSeriesBySector[d.sector] = [];
            }
            this.timeSeriesBySector[d.sector].push({
                date: new Date(d.date),
                value: d.cumulative_return,
                dailyReturn: d.daily_return
            });
        });

        // Build heatmap data for multiple granularities
        this.heatmapData = {};
        this.weeklyHeatmapData = {};
        this.dailyHeatmapData = {};

        // Monthly rankings
        dashboardData.rankings_heatmap.forEach(d => {
            const key = `${d.date}-${d.sector}`;
            this.heatmapData[key] = d;
        });

        // Weekly rankings (if available)
        if (dashboardData.weekly_rankings_heatmap) {
            dashboardData.weekly_rankings_heatmap.forEach(d => {
                const key = `${d.date}-${d.sector}`;
                this.weeklyHeatmapData[key] = d;
            });
        }

        // Daily rankings (if available)
        if (dashboardData.daily_rankings_heatmap) {
            dashboardData.daily_rankings_heatmap.forEach(d => {
                const key = `${d.date}-${d.sector}`;
                this.dailyHeatmapData[key] = d;
            });
        }

        // Initialize filtered data with full data
        this.filteredTimeSeries = this.timeSeriesBySector;
        this.filteredHeatmapData = this.heatmapData;
        this.filteredWeeklyHeatmapData = this.weeklyHeatmapData;
        this.filteredDailyHeatmapData = this.dailyHeatmapData;
        this.filteredQuarterlyData = dashboardData.quarterly_returns;

        return {
            sectors: Object.keys(this.timeSeriesBySector).length,
            heatmapPoints: Object.keys(this.heatmapData).length,
            weeklyHeatmapPoints: Object.keys(this.weeklyHeatmapData).length,
            dailyHeatmapPoints: Object.keys(this.dailyHeatmapData).length,
            dateRange: `${dashboardData.metadata.data_start} to ${dashboardData.metadata.data_end}`
        };
    }

    /**
     * Calculate start date from range string (e.g., '1m', '3y', 'ytd')
     */
    calculateStartDate(range) {
        const now = new Date();

        if (range === 'ytd') {
            return new Date(now.getFullYear(), 0, 1);
        }

        // Parse range: number + unit (e.g., '1m', '3y', '6w')
        const match = range.match(/^(\d+)([dwmy])$/);
        if (!match) return new Date('2021-01-01');

        const value = parseInt(match[1]);
        const unit = match[2];

        switch(unit) {
            case 'd': // days
                return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
            case 'w': // weeks
                return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
            case 'm': // months
                return new Date(now.getFullYear(), now.getMonth() - value, now.getDate());
            case 'y': // years
                return new Date(now.getFullYear() - value, now.getMonth(), now.getDate());
            default:
                return new Date('2021-01-01');
        }
    }

    /**
     * Apply time range filter
     */
    applyFilter(range) {
        const startDate = this.calculateStartDate(range);

        // Filter time series
        this.filteredTimeSeries = {};
        Object.keys(this.timeSeriesBySector).forEach(sector => {
            const rawData = this.timeSeriesBySector[sector].filter(d => d.date >= startDate);

            // Normalize values to start from 0 for the filtered period
            if (rawData.length > 0) {
                const baseValue = rawData[0].value;
                this.filteredTimeSeries[sector] = rawData.map(d => ({
                    date: d.date,
                    value: d.value - baseValue,  // Normalized to filtered period start
                    dailyReturn: d.dailyReturn
                }));
            } else {
                this.filteredTimeSeries[sector] = rawData;
            }
        });

        // Recalculate momentum
        this.momentumData = this.calculateMomentum(this.filteredTimeSeries);

        // Recalculate correlations
        this.correlations = this.calculateCorrelations(this.filteredTimeSeries);

        // Filter heatmap data based on range - auto-select granularity
        this.filteredHeatmapData = {};
        this.selectedGranularity = this.selectGranularity(range);

        const dataSource = this.selectedGranularity === 'weekly' ? this.weeklyHeatmapData :
                          this.selectedGranularity === 'daily' ? this.dailyHeatmapData :
                          this.heatmapData;

        Object.keys(dataSource).forEach(key => {
            const data = dataSource[key];
            let dataDate;

            // Parse date based on granularity
            if (this.selectedGranularity === 'daily') {
                // Format: YYYY-MM-DD
                dataDate = new Date(data.date);
            } else if (this.selectedGranularity === 'weekly') {
                // Format: YYYY-WWW (ISO week format)
                const match = data.date.match(/(\d+)-W(\d+)/);
                if (match) {
                    const year = parseInt(match[1]);
                    const weekNum = parseInt(match[2]);
                    // Calculate approximate date from ISO week number
                    // January 4th is always in week 1, so use that as reference
                    const jan4 = new Date(year, 0, 4);
                    const daysToAdd = (weekNum - 1) * 7;
                    dataDate = new Date(jan4.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
                } else {
                    // Fallback if format doesn't match
                    dataDate = new Date('2021-01-01');
                }
            } else {
                // Monthly: Format: YYYY-MM
                const [year, month] = data.date.split('-').map(Number);
                dataDate = new Date(year, month - 1, 1);
            }

            if (dataDate >= startDate) {
                this.filteredHeatmapData[key] = data;
            }
        });

        // Filter quarterly data
        this.filteredQuarterlyData = this.dashboardData.quarterly_returns.filter(d => {
            const parts = d.quarter.split('-');
            const year = parseInt(parts[0]);
            const quarter = parseInt(parts[1].replace('Q', ''));
            const quarterDate = new Date(year, (quarter - 1) * 3, 1);
            return quarterDate >= startDate;
        });

        return {
            range: range,
            startDate: startDate.toISOString().split('T')[0],
            timeSeriesPoints: Object.keys(this.filteredTimeSeries).map(
                s => `${s}: ${this.filteredTimeSeries[s].length}`
            ).join(', '),
            heatmapPoints: Object.keys(this.filteredHeatmapData).length,
            weeklyHeatmapPoints: Object.keys(this.weeklyHeatmapData).length,
            dailyHeatmapPoints: Object.keys(this.dailyHeatmapData).length,
            quarterlyPoints: this.filteredQuarterlyData.length,
            momentum: this.momentumData.map(m => `${m.sector}: ${m.m3.toFixed(1)}%`),
            selectedGranularity: this.selectedGranularity
        };
    }

    /**
     * Select the best granularity based on the time range
     */
    selectGranularity(range) {
        const rangeDays = this.convertRangeToDays(range);

        // Daily: for ranges <= 30 days (1 month)
        // Weekly: for ranges > 30 days and <= 90 days (3 months)
        // Monthly: for ranges > 90 days

        if (rangeDays <= 30) {
            return 'daily';
        } else if (rangeDays <= 90) {
            return 'weekly';
        } else {
            return 'monthly';
        }
    }

    /**
     * Convert range string to approximate number of days
     */
    convertRangeToDays(range) {
        const match = range.match(/^(\d+)([dwmy])$/);
        if (!match) return 365; // Default to 1 year

        const value = parseInt(match[1]);
        const unit = match[2];

        switch(unit) {
            case 'd': return value;
            case 'w': return value * 7;
            case 'm': return value * 30;  // Approximate
            case 'y': return value * 365;
            default: return 365;
        }
    }

    /**
     * Calculate momentum data from filtered time series
     * Values are already normalized to filtered period start (0-based)
     */
    calculateMomentum(timeSeries) {
        const filteredMomentum = [];

        Object.keys(timeSeries).forEach(sector => {
            const data = timeSeries[sector];

            if (data.length > 0) {
                // Values are already normalized (start from 0)
                const firstValue = data[0].value;  // Should be 0
                const lastValue = data[data.length - 1].value;

                // Calculate period returns with fallback for insufficient data
                const m1Value = data.length >= 22 ? data[data.length - 22].value : firstValue;
                const m3Value = data.length >= 66 ? data[data.length - 66].value : firstValue;
                const m6Value = data.length >= 132 ? data[data.length - 132].value : firstValue;
                const y1Value = data.length >= 252 ? data[data.length - 252].value : firstValue;

                filteredMomentum.push({
                    sector: sector,
                    total: lastValue,  // Since firstValue is 0, total is just lastValue
                    m1: lastValue - m1Value,
                    m3: lastValue - m3Value,
                    m6: lastValue - m6Value,
                    y1: lastValue - y1Value,
                    volatility: 0
                });
            }
        });

        return filteredMomentum.sort((a, b) => b.m3 - a.m3);
    }

    /**
     * Calculate correlations between sectors using monthly returns
     */
    calculateCorrelations(timeSeries) {
        const sectors = Object.keys(timeSeries);
        const correlationList = [];

        // Calculate monthly returns for each sector
        const sectorMonthlyReturns = {};
        sectors.forEach(sector => {
            const data = timeSeries[sector];
            const monthlyReturns = [];

            let lastMonth = null;
            let lastValue = null;

            data.forEach((d, i) => {
                const year = d.date.getFullYear();
                const month = d.date.getMonth();
                const monthKey = `${year}-${month.toString().padStart(2, '0')}`;

                if (lastMonth !== monthKey && i > 0) {
                    if (lastValue !== null) {
                        const monthlyRet = (d.value - lastValue);
                        monthlyReturns.push({ month: monthKey, value: monthlyRet });
                    }
                    lastValue = d.value;
                } else if (i === 0) {
                    lastValue = d.value;
                }
                lastMonth = monthKey;
            });

            sectorMonthlyReturns[sector] = monthlyReturns;
        });

        // Get all unique months
        const allMonths = [...new Set(
            Object.values(sectorMonthlyReturns).flatMap(m => m.map(r => r.month))
        )].sort();

        // Build aligned monthly return vectors
        const alignedReturns = {};
        sectors.forEach(sector => {
            alignedReturns[sector] = allMonths.map(month => {
                const ret = sectorMonthlyReturns[sector].find(r => r.month === month);
                return ret ? ret.value : 0;
            });
        });

        // Calculate correlations between all sector pairs
        for (let i = 0; i < sectors.length; i++) {
            for (let j = i; j < sectors.length; j++) {
                const s1 = sectors[i];
                const s2 = sectors[j];
                const ret1 = alignedReturns[s1];
                const ret2 = alignedReturns[s2];

                const corr = this.calculateCorrelation(ret1, ret2);
                correlationList.push({ sector1: s1, sector2: s2, correlation: corr });
            }
        }

        return correlationList;
    }

    /**
     * Calculate correlation between two arrays
     */
    calculateCorrelation(arr1, arr2) {
        const n = arr1.length;
        if (n === 0) return 0;

        const mean1 = arr1.reduce((a, b) => a + b, 0) / n;
        const mean2 = arr2.reduce((a, b) => a + b, 0) / n;

        let num = 0, den1 = 0, den2 = 0;
        for (let i = 0; i < n; i++) {
            const diff1 = arr1[i] - mean1;
            const diff2 = arr2[i] - mean2;
            num += diff1 * diff2;
            den1 += diff1 * diff1;
            den2 += diff2 * diff2;
        }

        return num / Math.sqrt(den1 * den2) || 0;
    }

    /**
     * Get current filtered data for UI rendering
     */
    getFilteredData() {
        return {
            timeSeries: this.filteredTimeSeries,
            heatmap: this.filteredHeatmapData,
            quarterly: this.filteredQuarterlyData,
            momentum: this.momentumData,
            correlations: this.correlations
        };
    }

    /**
     * Get raw data for reference
     */
    getRawData() {
        return {
            timeSeries: this.timeSeriesBySector,
            heatmap: this.heatmapData
        };
    }

    /**
     * Get stocks for a specific sector
     */
    getSectorStocks(sectorName) {
        return SECTOR_STOCKS[sectorName] || [];
    }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DashboardDataProcessor, SECTOR_STOCKS };
}
