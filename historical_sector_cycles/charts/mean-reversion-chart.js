/**
 * Mean Reversion Chart
 * Shows Z-scores and identifies overbought/oversold sectors
 */

class MeanReversionChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(momentumData, timeSeriesData, sectors, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        // Calculate Z-scores and other mean reversion indicators
        const indicators = this.calculateIndicators(momentumData, timeSeriesData, sectors);

        // Display results
        this.renderIndicators(container, indicators, currentRange);
    }

    calculateIndicators(momentumData, timeSeriesData, sectors) {
        const indicators = [];

        sectors.forEach(sector => {
            const timeSeries = timeSeriesData[sector];

            // Skip if no data
            if (!timeSeries || timeSeries.length < 20) {
                console.log(`Skipping ${sector}: no timeseries data`);
                return;
            }

            // Filter out invalid data (null, undefined, 0, negative, NaN, Infinity)
            // Note: The time series data is normalized (starting from 0), so values can be close to 0
            // We need to be more lenient - just check for valid numbers
            const validData = timeSeries.filter(d =>
                d != null &&
                d.value != null &&
                typeof d.value === 'number' &&
                isFinite(d.value) &&
                !isNaN(d.value)
                // Removed: d.value > 0 check because normalized data can be near 0
            );

            if (validData.length < 20) {
                console.log(`Skipping ${sector}: only ${validData.length} valid data points`);
                return;
            }

            // Calculate daily returns with validation
            const returns = [];
            for (let i = 1; i < validData.length; i++) {
                const prevValue = validData[i - 1].value;
                const currValue = validData[i].value;

                // For normalized data, we need to handle the case where prevValue could be 0
                // Use absolute difference when prevValue is very small
                if (isFinite(prevValue) && isFinite(currValue) && !isNaN(prevValue) && !isNaN(currValue)) {
                    let ret;
                    if (Math.abs(prevValue) < 0.0001) {
                        // If prevValue is essentially 0, use the raw difference
                        ret = currValue * 100; // Scale up for visibility
                    } else {
                        ret = ((currValue - prevValue) / Math.abs(prevValue)) * 100;
                    }

                    if (isFinite(ret) && !isNaN(ret)) {
                        returns.push(ret);
                    }
                }
            }

            if (returns.length < 10) {
                console.log(`Skipping ${sector}: only ${returns.length} valid returns`);
                return;
            }

            // Calculate statistics with validation
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
            const stdDev = Math.sqrt(Math.max(0, variance)); // Ensure non-negative

            // Calculate 3-month return from the actual time series (in percentage)
            const threeMonthIndex = Math.max(0, validData.length - 66); // Approx 3 months of trading days
            const threeMonthStartValue = validData[threeMonthIndex].value;
            const threeMonthEndValue = validData[validData.length - 1].value;
            // Handle division by zero for normalized data
            let threeMonthReturn = 0;
            if (Math.abs(threeMonthStartValue) > 0.0001) {
                threeMonthReturn = ((threeMonthEndValue - threeMonthStartValue) / Math.abs(threeMonthStartValue)) * 100;
            } else {
                // For normalized data starting near 0, just use the difference scaled
                threeMonthReturn = threeMonthEndValue * 100;
            }

            // Calculate 1-month and 6-month returns
            const oneMonthIndex = Math.max(0, validData.length - 22);
            const oneMonthStartValue = validData[oneMonthIndex].value;
            const oneMonthEndValue = validData[validData.length - 1].value;
            let oneMonthReturn = 0;
            if (Math.abs(oneMonthStartValue) > 0.0001) {
                oneMonthReturn = ((oneMonthEndValue - oneMonthStartValue) / Math.abs(oneMonthStartValue)) * 100;
            } else {
                oneMonthReturn = oneMonthEndValue * 100;
            }

            const sixMonthIndex = Math.max(0, validData.length - 132);
            const sixMonthStartValue = validData[sixMonthIndex].value;
            const sixMonthEndValue = validData[validData.length - 1].value;
            let sixMonthReturn = 0;
            if (Math.abs(sixMonthStartValue) > 0.0001) {
                sixMonthReturn = ((sixMonthEndValue - sixMonthStartValue) / Math.abs(sixMonthStartValue)) * 100;
            } else {
                sixMonthReturn = sixMonthEndValue * 100;
            }

            // Calculate Z-score for current 3M return vs daily returns distribution
            let zScore = 0;
            if (stdDev !== 0 && isFinite(stdDev) && !isNaN(stdDev) && isFinite(mean) && !isNaN(mean) && isFinite(threeMonthReturn)) {
                // Z-score = (current 3M return - mean of daily returns) / stdDev of daily returns
                // This tells us how unusual the current 3M performance is compared to typical daily moves
                zScore = threeMonthReturn / stdDev; // Since daily mean is close to 0 for normalized data
                if (!isFinite(zScore) || isNaN(zScore)) {
                    zScore = 0;
                }
            }

            // Calculate RSI (simplified - using recent momentum)
            const recentReturns = returns.slice(-22); // Last ~1 month
            const gains = recentReturns.filter(r => r > 0);
            const losses = recentReturns.filter(r => r < 0);
            const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
            const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0)) / losses.length : 0;
            const rs = avgLoss !== 0 ? avgGain / avgLoss : (avgGain > 0 ? 100 : 0);
            let rsi = 100 - (100 / (1 + rs));
            if (!isFinite(rsi) || isNaN(rsi)) {
                rsi = 50; // Default to neutral
            }

            // Bollinger Band position (0-1, where 0.5 is middle)
            const bbPosition = (stdDev !== 0 && isFinite(stdDev)) ? Math.max(0, Math.min(1, 0.5 + (zScore / 4))) : 0.5;

            // Always add the indicator, use safe defaults
            indicators.push({
                sector,
                zScore: isFinite(zScore) && !isNaN(zScore) ? zScore : 0,
                mean: isFinite(mean) && !isNaN(mean) ? mean : 0,
                stdDev: isFinite(stdDev) && !isNaN(stdDev) ? stdDev : 0,
                rsi: isFinite(rsi) && !isNaN(rsi) ? Math.max(0, Math.min(100, rsi)) : 50,
                bbPosition: isFinite(bbPosition) && !isNaN(bbPosition) ? bbPosition : 0.5,
                m3: isFinite(threeMonthReturn) && !isNaN(threeMonthReturn) ? threeMonthReturn : 0,
                m1: isFinite(oneMonthReturn) && !isNaN(oneMonthReturn) ? oneMonthReturn : 0,
                m6: isFinite(sixMonthReturn) && !isNaN(sixMonthReturn) ? sixMonthReturn : 0,
                overbought: zScore > 2 || rsi > 70,
                oversold: zScore < -2 || rsi < 30,
                neutral: zScore >= -1 && zScore <= 1 && rsi >= 40 && rsi <= 60
            });
        });

        console.log(`Calculated ${indicators.length} indicators out of ${sectors.length} sectors`);
        return indicators.sort((a, b) => b.zScore - a.zScore);
    }

    renderIndicators(container, indicators, currentRange) {
        const overbought = indicators.filter(i => i.overbought);
        const oversold = indicators.filter(i => i.oversold);
        const neutral = indicators.filter(i => i.neutral);

        let html = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <div style="color: #58a6ff; font-size: 13px; font-weight: 600; margin-bottom: 10px;">
                    🔄 Mean Reversion Signals
                </div>
                <div style="color: #8b949e; font-size: 11px; line-height: 1.6;">
                    💡 <strong>Z-score</strong>: How many standard deviations from mean. >2 = overbought, <-2 = oversold.<br>
                    💡 <strong>RSI</strong>: Relative Strength Index. >70 = overbought, <30 = oversold.<br>
                    💡 Overbought sectors may pull back. Oversold sectors may bounce.
                </div>
            </div>
        `;

        // Overbought section
        html += `
            <div style="margin-bottom: 20px;">
                <div style="color: #ef4444; font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    🔴 Overbought (Potential Pullback)
                    <span style="background: #ef4444; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${overbought.length}</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">
        `;

        overbought.forEach(i => {
            html += `
                <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 6px; padding: 12px; min-width: 200px; cursor: pointer; transition: background 0.2s;" onclick="showSectorStocks('${i.sector}')" onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'">
                    <div style="color: #c9d1d9; font-weight: 600; margin-bottom: 8px;">${i.sector}</div>
                    <div style="font-size: 11px; color: #8b949e;">
                        <div>Z-Score: <strong style="color: #ef4444;">${i.zScore.toFixed(2)}</strong></div>
                        <div>RSI: <strong style="color: ${i.rsi > 80 ? '#ef4444' : '#f59e0b'};">${i.rsi.toFixed(0)}</strong></div>
                        <div style="margin-top: 4px;">3M: <strong style="color: #c9d1d9;">+${i.m3.toFixed(1)}%</strong></div>
                    </div>
                </div>
            `;
        });

        if (overbought.length === 0) {
            html += `<div style="color: #8b949e; font-style: italic; padding: 10px;">No overbought sectors detected</div>`;
        }

        html += `</div></div>`;

        // Oversold section
        html += `
            <div style="margin-bottom: 20px;">
                <div style="color: #22c55e; font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    🟢 Oversold (Potential Bounce)
                    <span style="background: #22c55e; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${oversold.length}</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">
        `;

        oversold.forEach(i => {
            html += `
                <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid #22c55e; border-radius: 6px; padding: 12px; min-width: 200px; cursor: pointer; transition: background 0.2s;" onclick="showSectorStocks('${i.sector}')" onmouseover="this.style.background='rgba(34, 197, 94, 0.2)'" onmouseout="this.style.background='rgba(34, 197, 94, 0.1)'">
                    <div style="color: #c9d1d9; font-weight: 600; margin-bottom: 8px;">${i.sector}</div>
                    <div style="font-size: 11px; color: #8b949e;">
                        <div>Z-Score: <strong style="color: #22c55e;">${i.zScore.toFixed(2)}</strong></div>
                        <div>RSI: <strong style="color: ${i.rsi < 20 ? '#22c55e' : '#f59e0b'};">${i.rsi.toFixed(0)}</strong></div>
                        <div style="margin-top: 4px;">3M: <strong style="color: #c9d1d9;">${i.m3.toFixed(1)}%</strong></div>
                    </div>
                </div>
            `;
        });

        if (oversold.length === 0) {
            html += `<div style="color: #8b949e; font-style: italic; padding: 10px;">No oversold sectors detected</div>`;
        }

        html += `</div></div>`;

        // Neutral zone
        html += `
            <div style="margin-bottom: 20px;">
                <div style="color: #8b949e; font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    ⚪ Neutral Zone
                    <span style="background: #8b949e; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${neutral.length}</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        `;

        neutral.forEach(i => {
            html += `
                <span style="background: #21262d; border: 1px solid #30363d; padding: 6px 12px; border-radius: 20px; font-size: 11px; cursor: pointer; transition: background 0.2s;" onclick="showSectorStocks('${i.sector}')" onmouseover="this.style.background='#30363d'" onmouseout="this.style.background='#21262d'">
                    ${i.sector} <span style="color: #8b949e; margin-left: 6px;">Z: ${i.zScore.toFixed(1)}</span>
                </span>
            `;
        });

        html += `</div></div>`;

        // Z-score distribution chart
        html += `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px;">
                <div style="color: #58a6ff; font-size: 12px; font-weight: 600; margin-bottom: 15px;">📊 Z-Score Distribution</div>
                <div style="display: flex; align-items: center; gap: 4px;">
        `;

        // Simple Z-score bar chart
        const minZ = Math.min(...indicators.map(i => i.zScore));
        const maxZ = Math.max(...indicators.map(i => i.zScore));
        const range = maxZ - minZ || 1;

        indicators.forEach(i => {
            const normalized = (i.zScore - minZ) / range;
            const barWidth = Math.max(normalized * 100, 5);
            const color = i.zScore > 2 ? '#ef4444' : i.zScore < -2 ? '#22c55e' : '#8b949e';

            html += `
                <div style="display: flex; flex-direction: column; align-items: center; margin-right: 8px;">
                    <div style="font-size: 9px; color: #8b949e; margin-bottom: 4px; writing-mode: vertical-rl; text-orientation: mixed;">${i.sector.substring(0, 6)}</div>
                    <div style="width: 20px; height: ${barWidth}px; background: ${color}; border-radius: 2px; opacity: 0.8;"></div>
                    <div style="font-size: 9px; color: ${color}; margin-top: 4px; font-weight: 600;">${i.zScore.toFixed(1)}</div>
                </div>
            `;
        });

        html += `
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 20px; font-size: 11px; color: #8b949e;">
                    <span>-3 (Oversold)</span>
                    <span>0 (Mean)</span>
                    <span>+3 (Overbought)</span>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MeanReversionChart;
}
