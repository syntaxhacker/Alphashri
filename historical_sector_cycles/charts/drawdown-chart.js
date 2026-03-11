/**
 * Drawdown Chart
 * Shows maximum drawdown and recovery analysis for each sector
 */

class DrawdownChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(timeSeriesData, sectors, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        // Calculate drawdown statistics for each sector
        const drawdownStats = this.calculateDrawdownStats(timeSeriesData, sectors);

        // Sort by max drawdown (worst first for risk awareness)
        const sortedByDrawdown = [...drawdownStats].sort((a, b) => b.maxDrawdown - a.maxDrawdown);

        // Create drawdown display
        this.renderDrawdownCards(container, sortedByDrawdown, currentRange);
    }

    calculateDrawdownStats(timeSeriesData, sectors) {
        const stats = [];

        sectors.forEach(sector => {
            const data = timeSeriesData[sector];
            if (!data || data.length < 10) return;

            // Filter out invalid data (null, undefined, NaN, Infinity)
            // Note: The time series data is normalized (starting from 0), so we allow values near 0
            const validData = data.filter(d =>
                d != null &&
                d.value != null &&
                typeof d.value === 'number' &&
                !isNaN(d.value) &&
                isFinite(d.value)
                // Removed: d.value > 0 check because normalized data can be near 0
            );

            if (validData.length < 10) return;

            let maxDrawdown = 0;
            let maxDrawdownStart = null;
            let maxDrawdownEnd = null;
            let peak = validData[0].value;
            let peakIndex = 0;

            // Calculate drawdowns
            for (let i = 1; i < validData.length; i++) {
                const value = validData[i].value;

                // New peak
                if (value > peak) {
                    peak = value;
                    peakIndex = i;
                }

                // Current drawdown - guard against division by zero
                if (peak > 0 && isFinite(peak) && !isNaN(peak)) {
                    const drawdown = ((peak - value) / peak) * 100;

                    if (isFinite(drawdown) && !isNaN(drawdown) && drawdown > maxDrawdown) {
                        maxDrawdown = drawdown;
                        maxDrawdownStart = validData[peakIndex].date;
                        maxDrawdownEnd = validData[i].date;
                    }
                }
            }

            // Calculate recovery time (days to recover from max drawdown)
            let recoveryDays = null;
            let recovered = false;
            if (maxDrawdownStart && maxDrawdownEnd) {
                const peakValue = peak;
                const endIndex = validData.findIndex(d => d.date.getTime() === maxDrawdownEnd.getTime());
                if (endIndex >= 0) {
                    for (let i = endIndex; i < validData.length; i++) {
                        if (validData[i].value >= peakValue) {
                            recoveryDays = Math.round((validData[i].date.getTime() - maxDrawdownEnd.getTime()) / (1000 * 60 * 60 * 24));
                            recovered = true;
                            break;
                        }
                    }
                }
            }

            // Calculate average return and volatility with validation
            const returns = [];
            for (let i = 1; i < validData.length; i++) {
                const prevValue = validData[i - 1].value;
                const currValue = validData[i].value;

                // For normalized data, handle cases where prevValue could be 0
                if (isFinite(prevValue) && isFinite(currValue) && !isNaN(prevValue) && !isNaN(currValue)) {
                    let ret;
                    if (Math.abs(prevValue) < 0.0001) {
                        // If prevValue is essentially 0, use the raw difference
                        ret = currValue * 100;
                    } else {
                        ret = ((currValue - prevValue) / Math.abs(prevValue)) * 100;
                    }

                    if (isFinite(ret) && !isNaN(ret)) {
                        returns.push(ret);
                    }
                }
            }

            // Handle empty returns array with safe defaults
            let avgReturn = 0;
            let volatility = 0;
            let sharpe = 0;
            let totalReturn = 0;

            if (returns.length > 0) {
                avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
                const variance = returns.reduce((sum, r) => sum + r * r, 0) / returns.length;
                volatility = Math.sqrt(Math.max(0, variance));
                sharpe = (volatility !== 0 && isFinite(volatility) && !isNaN(volatility)) ? avgReturn / volatility : 0;
            }

            // Calculate total return (handle normalized data that may start near 0)
            const startValue = validData[0].value;
            const endValue = validData[validData.length - 1].value;
            if (isFinite(startValue) && isFinite(endValue) && !isNaN(startValue) && !isNaN(endValue)) {
                if (Math.abs(startValue) > 0.0001) {
                    totalReturn = ((endValue - startValue) / Math.abs(startValue)) * 100;
                } else {
                    // For normalized data starting near 0, just use the end value scaled
                    totalReturn = endValue * 100;
                }
            }

            // Always add the stat with safe defaults
            stats.push({
                sector,
                maxDrawdown: isFinite(maxDrawdown) && !isNaN(maxDrawdown) ? maxDrawdown : 0,
                maxDrawdownStart,
                maxDrawdownEnd,
                recoveryDays,
                recovered,
                avgReturn: isFinite(avgReturn) && !isNaN(avgReturn) ? avgReturn : 0,
                volatility: isFinite(volatility) && !isNaN(volatility) ? volatility : 0,
                sharpe: isFinite(sharpe) && !isNaN(sharpe) ? sharpe : 0,
                totalReturn: isFinite(totalReturn) && !isNaN(totalReturn) ? totalReturn : 0
            });
        });

        console.log(`Calculated drawdown stats for ${stats.length} out of ${sectors.length} sectors`);
        return stats;
    }

    renderDrawdownCards(container, stats, currentRange) {
        let html = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                <div style="color: #58a6ff; font-size: 13px; font-weight: 600; margin-bottom: 10px;">
                    📉 Sector Risk Analysis - Maximum Drawdown
                </div>
                <div style="color: #8b949e; font-size: 11px;">
                    💡 Shows the maximum peak-to-trough decline for each sector. Higher drawdown = higher risk.
                    Recovery time shows how long it took to bounce back.
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 12px;">
        `;

        stats.forEach(s => {
            const ddColor = s.maxDrawdown > 30 ? '#ef4444' : s.maxDrawdown > 15 ? '#f59e0b' : '#22c55e';

            html += `
                <div style="background: #21262d; border-radius: 8px; padding: 15px; border-left: 4px solid ${ddColor}; cursor: pointer; transition: background 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.background='#30363d'" onmouseout="this.style.background='#21262d'">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                        <div style="color: #c9d1d9; font-weight: 600; font-size: 13px;">${s.sector}</div>
                        <div style="color: #8b949e; font-size: 10px;">Period: ${currentRange.toUpperCase()}</div>
                    </div>

                    <div style="margin-bottom: 10px;">
                        <div style="color: #8b949e; font-size: 11px; margin-bottom: 4px;">Maximum Drawdown</div>
                        <div style="color: ${ddColor}; font-weight: 700; font-size: 20px;">-${s.maxDrawdown.toFixed(1)}%</div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px;">
                        <div>
                            <span style="color: #8b949e;">Recovery:</span>
                            <span style="color: ${s.recovered ? '#22c55e' : '#ef4444'}; font-weight: 600; margin-left: 4px;">
                                ${s.recovered ? `${s.recoveryDays} days` : 'Not yet'}
                            </span>
                        </div>
                        <div>
                            <span style="color: #8b949e;">Volatility:</span>
                            <span style="color: #c9d1d9; font-weight: 600; margin-left: 4px;">${s.volatility.toFixed(1)}%</span>
                        </div>
                        <div>
                            <span style="color: #8b949e;">Sharpe:</span>
                            <span style="color: ${s.sharpe > 1 ? '#22c55e' : s.sharpe > 0 ? '#f59e0b' : '#ef4444'}; font-weight: 600; margin-left: 4px;">${s.sharpe.toFixed(2)}</span>
                        </div>
                        <div>
                            <span style="color: #8b949e;">Total Return:</span>
                            <span style="color: ${s.totalReturn >= 0 ? '#22c55e' : '#ef4444'}; font-weight: 600; margin-left: 4px;">${s.totalReturn >= 0 ? '+' : ''}${s.totalReturn.toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;

        // Add risk summary
        const avgDrawdown = stats.reduce((sum, s) => sum + s.maxDrawdown, 0) / stats.length;
        const worstSector = stats.reduce((worst, s) => s.maxDrawdown > worst.maxDrawdown ? s : worst);
        const bestSector = stats.reduce((best, s) => s.maxDrawdown < best.maxDrawdown ? s : best);
        const recoveredCount = stats.filter(s => s.recovered).length;

        html += `
            <div style="margin-top: 20px; padding: 15px; background: #161b22; border: 1px solid #30363d; border-radius: 8px;">
                <div style="color: #58a6ff; font-size: 12px; font-weight: 600; margin-bottom: 10px;">📊 Risk Summary</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 11px;">
                    <div>
                        <span style="color: #8b949e;">Average Max DD:</span>
                        <strong style="color: #c9d1d9; margin-left: 6px;">-${avgDrawdown.toFixed(1)}%</strong>
                    </div>
                    <div>
                        <span style="color: #8b949e;">Highest Risk:</span>
                        <strong style="color: #ef4444; margin-left: 6px;">${worstSector.sector} (-${worstSector.maxDrawdown.toFixed(1)}%)</strong>
                    </div>
                    <div>
                        <span style="color: #8b949e;">Lowest Risk:</span>
                        <strong style="color: #22c55e; margin-left: 6px;">${bestSector.sector} (-${bestSector.maxDrawdown.toFixed(1)}%)</strong>
                    </div>
                    <div>
                        <span style="color: #8b949e;">Recovered:</span>
                        <strong style="color: ${recoveredCount === stats.length ? '#22c55e' : '#f59e0b'}; margin-left: 6px;">${recoveredCount}/${stats.length} sectors</strong>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DrawdownChart;
}
