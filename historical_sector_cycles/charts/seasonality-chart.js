/**
 * Seasonality Calendar Chart
 * Shows historical monthly performance patterns for sectors
 * Identifies best/worst months for each sector
 */

class SeasonalityChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(timeSeriesData, sectors) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        // Calculate monthly returns by sector
        const monthlyReturns = this.calculateMonthlyReturns(timeSeriesData, sectors);

        if (Object.keys(monthlyReturns).length === 0) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #8b949e;">
                    <p style="font-size: 14px;">Insufficient data for seasonality analysis</p>
                    <p style="font-size: 12px; margin-top: 8px;">Try selecting a longer time range</p>
                </div>
            `;
            return;
        }

        // Create seasonality summary
        this.renderSeasonalitySummary(container, monthlyReturns, sectors);
    }

    calculateMonthlyReturns(timeSeriesData, sectors) {
        const monthlyReturns = {};
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        sectors.forEach(sector => {
            const data = timeSeriesData[sector];
            if (!data || data.length < 60) return; // Need at least 5 years

            // Group by year and month to calculate proper monthly returns
            const monthlyData = {};

            for (let i = 0; i < data.length; i++) {
                const date = data[i].date;
                const year = date.getFullYear();
                const month = date.getMonth();
                const key = `${year}-${month}`;

                if (!monthlyData[key]) {
                    monthlyData[key] = {
                        year,
                        month,
                        firstPrice: data[i].value,
                        lastPrice: data[i].value,
                        firstDate: date,
                        lastDate: date
                    };
                } else {
                    monthlyData[key].lastPrice = data[i].value;
                    monthlyData[key].lastDate = date;
                }
            }

            // Calculate monthly returns and group by month
            const returnsByMonth = Array(12).fill().map(() => []);

            Object.values(monthlyData).forEach(monthData => {
                const firstPrice = monthData.firstPrice;
                const lastPrice = monthData.lastPrice;

                // Skip invalid prices (zero, negative, or NaN)
                if (!firstPrice || !lastPrice || firstPrice <= 0 || lastPrice <= 0 ||
                    !isFinite(firstPrice) || !isFinite(lastPrice)) {
                    return;
                }

                const monthlyReturn = ((lastPrice - firstPrice) / firstPrice) * 100;

                // Skip invalid returns (NaN, Infinity)
                if (!isFinite(monthlyReturn)) {
                    return;
                }

                returnsByMonth[monthData.month].push(monthlyReturn);
            });

            // Calculate average return for each month
            const avgMonthlyReturns = returnsByMonth.map((returns, monthIndex) => {
                if (returns.length === 0) return null;

                const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
                const positiveRatio = returns.filter(r => r > 0).length / returns.length;
                const years = returns.length;

                return {
                    month: monthIndex,
                    monthName: monthNames[monthIndex],
                    avgReturn: avg,
                    positiveRatio: positiveRatio,
                    years: years,
                    minReturn: Math.min(...returns),
                    maxReturn: Math.max(...returns),
                    stdDev: Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / returns.length)
                };
            }).filter(m => m !== null);

            monthlyReturns[sector] = avgMonthlyReturns;
        });

        return monthlyReturns;
    }

    renderSeasonalitySummary(container, monthlyReturns, sectors) {
        // Create summary card
        const summaryDiv = document.createElement('div');
        summaryDiv.style.cssText = 'margin-bottom: 20px;';

        let html = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <div style="color: #58a6ff; font-size: 14px; font-weight: 600; margin-bottom: 15px;">
                    📅 Sector Seasonality Analysis
                </div>
                <div style="color: #8b949e; font-size: 12px; margin-bottom: 20px; line-height: 1.6;">
                    💡 Shows which months have been historically strong/weak for each sector based on ${Object.values(monthlyReturns)[0]?.[0]?.years || 0}+ years of data.
                    Positive returns in green, negative in red. Hover for details.
                </div>
        `;

        // Create grid for sector seasonality
        html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 15px;">`;

        Object.keys(monthlyReturns).forEach(sector => {
            const months = monthlyReturns[sector];

            // Find best and worst months
            const sortedMonths = [...months].sort((a, b) => b.avgReturn - a.avgReturn);
            const bestMonth = sortedMonths[0];
            const worstMonth = sortedMonths[sortedMonths.length - 1];

            // Calculate overall stats
            const allReturns = months.map(m => m.avgReturn);
            const avgReturn = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
            const volatility = Math.sqrt(allReturns.reduce((sum, r) => sum + r * r, 0) / allReturns.length);

            html += `
                <div style="background: #21262d; border-radius: 8px; padding: 15px; border-left: 3px solid ${avgReturn >= 0 ? '#22c55e' : '#ef4444'};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <span style="color: #c9d1d9; font-weight: 600; font-size: 13px;">${sector}</span>
                        <span style="color: ${avgReturn >= 0 ? '#22c55e' : '#ef4444'}; font-weight: 600; font-size: 12px;">
                            ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}% avg
                        </span>
                    </div>

                    <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
            `;

            // Month badges
            months.forEach(m => {
                const color = this.getReturnColor(m.avgReturn);
                const intensity = Math.min(Math.abs(m.avgReturn) / 5, 1);

                html += `
                    <div style="
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 10px;
                        font-weight: 600;
                        background: ${color};
                        opacity: ${0.4 + intensity * 0.6};
                        cursor: pointer;
                        transition: transform 0.2s;
                    " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                        ${m.monthName}
                    </div>
                `;
            });

            html += `
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 11px; padding-top: 10px; border-top: 1px solid #30363d;">
                        <div style="color: #22c55e;">
                            📈 Best: ${bestMonth.monthName} (+${bestMonth.avgReturn.toFixed(1)}%)
                        </div>
                        <div style="color: #ef4444;">
                            📉 Worst: ${worstMonth.monthName} (${worstMonth.avgReturn.toFixed(1)}%)
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div></div>`;
        summaryDiv.innerHTML = html;
        container.appendChild(summaryDiv);
    }

    getReturnColor(returnValue) {
        if (returnValue >= 3) return 'rgba(34, 197, 94, 0.8)'; // Strong green
        if (returnValue >= 1) return 'rgba(34, 197, 94, 0.6)'; // Light green
        if (returnValue >= -1) return 'rgba(201, 203, 207, 0.3)'; // Gray/neutral
        if (returnValue >= -3) return 'rgba(239, 68, 68, 0.6)'; // Light red
        return 'rgba(239, 68, 68, 0.8)'; // Strong red
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SeasonalityChart;
}
