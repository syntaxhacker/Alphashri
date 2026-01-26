/**
 * Volume vs Price Divergence Chart
 * Detects and visualizes divergences between volume and price trends
 * A divergence occurs when volume trend opposes price trend, signaling potential reversals
 */

class VolumePriceDivergenceChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(volumeData, timeSeriesData, sectors, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        // Calculate divergences for each sector
        const divergences = [];
        sectors.forEach(sector => {
            const divergence = this.calculateDivergence(sector, volumeData[sector], timeSeriesData[sector]);
            if (divergence) {
                divergences.push(divergence);
            }
        });

        // Sort by divergence strength
        divergences.sort((a, b) => Math.abs(b.divergenceScore) - Math.abs(a.divergenceScore));

        this.renderDivergences(container, divergences);
    }

    calculateDivergence(sector, volumeData, priceData) {
        if (!volumeData || !priceData || volumeData.length < 20 || priceData.length < 20) {
            return null;
        }

        // Get recent data (last 30 data points)
        const recentVolume = volumeData.slice(-30);
        const recentPrice = priceData.slice(-30);

        // Calculate volume trend (linear regression slope)
        const volumeTrend = this.calculateTrend(recentVolume.map(d => d.volume));
        const priceTrend = this.calculateTrend(recentPrice.map(d => d.value));

        // Calculate volume momentum (average of last 5 days vs previous 5 days)
        const recentVol = recentVolume.slice(-5).reduce((sum, d) => sum + d.volume, 0) / 5;
        const prevVol = recentVolume.slice(-10, -5).reduce((sum, d) => sum + d.volume, 0) / 5;
        const volumeMomentum = (recentVol - prevVol) / prevVol * 100;

        // Calculate price momentum
        const recentPriceVal = recentPrice[recentPrice.length - 1].value;
        const prevPriceVal = recentPrice[recentPrice.length - 6].value;
        const priceMomentum = ((recentPriceVal - prevPriceVal) / prevPriceVal) * 100;

        // Detect divergence type
        let divergenceType = 'none';
        let divergenceStrength = 0;

        // Bullish divergence: Price falling, volume rising (potential reversal up)
        if (priceTrend < -0.5 && volumeTrend > 0.5) {
            divergenceType = 'bullish';
            divergenceStrength = Math.abs(volumeTrend) * Math.abs(priceTrend) * 10;
        }
        // Bearish divergence: Price rising, volume falling (potential reversal down)
        else if (priceTrend > 0.5 && volumeTrend < -0.5) {
            divergenceType = 'bearish';
            divergenceStrength = Math.abs(volumeTrend) * Math.abs(priceTrend) * 10;
        }
        // Confirmation: Price and volume both rising (uptrend continuation)
        else if (priceTrend > 0.5 && volumeTrend > 0.5) {
            divergenceType = 'confirmation-uptrend';
            divergenceStrength = (priceTrend + volumeTrend) * 5;
        }
        // Confirmation: Price and volume both falling (downtrend continuation)
        else if (priceTrend < -0.5 && volumeTrend < -0.5) {
            divergenceType = 'confirmation-downtrend';
            divergenceStrength = (Math.abs(priceTrend) + Math.abs(volumeTrend)) * 5;
        }

        // Calculate average volume for comparison
        const avgVolume = volumeData.reduce((sum, d) => sum + d.volume, 0) / volumeData.length;
        const currentVolume = volumeData[volumeData.length - 1].volume;
        const volumeVsAvg = ((currentVolume - avgVolume) / avgVolume) * 100;

        return {
            sector,
            divergenceType,
            divergenceScore: divergenceStrength,
            volumeTrend,
            priceTrend,
            volumeMomentum,
            priceMomentum,
            volumeVsAvg,
            recentVolume: currentVolume,
            avgVolume
        };
    }

    calculateTrend(values) {
        // Simple linear regression to calculate trend
        const n = values.length;
        const xValues = Array.from({length: n}, (_, i) => i);
        const sumX = xValues.reduce((a, b) => a + b, 0);
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = xValues.reduce((sum, x, i) => sum + x * values[i], 0);
        const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        return slope;
    }

    renderDivergences(container, divergences) {
        if (divergences.length === 0) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: #8b949e;">
                    <p style="font-size: 14px; margin-bottom: 10px;">📊 No divergences detected</p>
                    <p style="font-size: 12px;">Volume and price are moving in sync</p>
                </div>
            `;
            return;
        }

        let html = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <div style="color: #58a6ff; font-size: 13px; font-weight: 600; margin-bottom: 10px;">
                    📊 Volume-Price Divergence Analysis
                </div>
                <div style="color: #8b949e; font-size: 11px; line-height: 1.6;">
                    💡 <strong>Bullish Divergence</strong>: Price falling with rising volume → Potential reversal upward<br>
                    💡 <strong>Bearish Divergence</strong>: Price rising with falling volume → Potential reversal downward<br>
                    💡 <strong>Confirmation</strong>: Price and volume aligned → Trend likely to continue
                </div>
            </div>
        `;

        // Group by divergence type
        const bullish = divergences.filter(d => d.divergenceType === 'bullish');
        const bearish = divergences.filter(d => d.divergenceType === 'bearish');
        const confirmUp = divergences.filter(d => d.divergenceType === 'confirmation-uptrend');
        const confirmDown = divergences.filter(d => d.divergenceType === 'confirmation-downtrend');

        // Bullish Divergences
        if (bullish.length > 0) {
            html += `
                <div style="margin-bottom: 20px;">
                    <div style="color: #22c55e; font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                        🟢 Bullish Divergences (Potential Reversal Up)
                        <span style="background: #22c55e; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${bullish.length}</span>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            `;

            bullish.forEach(d => {
                html += this.createDivergenceCard(d, 'bullish');
            });

            html += `</div></div>`;
        }

        // Bearish Divergences
        if (bearish.length > 0) {
            html += `
                <div style="margin-bottom: 20px;">
                    <div style="color: #ef4444; font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                        🔴 Bearish Divergences (Potential Reversal Down)
                        <span style="background: #ef4444; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${bearish.length}</span>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            `;

            bearish.forEach(d => {
                html += this.createDivergenceCard(d, 'bearish');
            });

            html += `</div></div>`;
        }

        // Confirmations
        if (confirmUp.length > 0 || confirmDown.length > 0) {
            html += `
                <div style="margin-bottom: 20px;">
                    <div style="color: #8b949e; font-size: 14px; font-weight: 600; margin-bottom: 12px;">
                        ⚪ Trend Confirmations
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            `;

            [...confirmUp, ...confirmDown].forEach(d => {
                const isUp = d.divergenceType === 'confirmation-uptrend';
                html += `
                    <div style="background: ${isUp ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; border: 1px solid ${isUp ? '#22c55e' : '#ef4444'}; border-radius: 20px; padding: 8px 16px; font-size: 11px; cursor: pointer;" onclick="showSectorStocks('${d.sector}')">
                        <span style="color: #c9d1d9; font-weight: 600;">${d.sector}</span>
                        <span style="color: #8b949e; margin-left: 8px;">${isUp ? '↗️' : '↘️'}</span>
                    </div>
                `;
            });

            html += `</div></div>`;
        }

        // Divergence Strength Chart
        html += `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; margin-top: 20px;">
                <div style="color: #58a6ff; font-size: 12px; font-weight: 600; margin-bottom: 15px;">📊 Divergence Strength</div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
        `;

        divergences.slice(0, 10).forEach(d => {
            const barWidth = Math.min(Math.abs(d.divergenceScore) * 5, 100);
            const color = d.divergenceType === 'bullish' ? '#22c55e' :
                         d.divergenceType === 'bearish' ? '#ef4444' : '#8b949e';

            html += `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 100px; font-size: 11px; color: #c9d1d9;">${d.sector}</div>
                    <div style="flex: 1; height: 8px; background: #21262d; border-radius: 4px; overflow: hidden;">
                        <div style="width: ${barWidth}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
                    </div>
                    <div style="width: 60px; font-size: 10px; color: ${color}; text-align: right;">${d.divergenceScore.toFixed(1)}</div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    createDivergenceCard(divergence, type) {
        const isBullish = type === 'bullish';
        const color = isBullish ? '#22c55e' : '#ef4444';
        const bgColor = isBullish ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';

        return `
            <div style="background: ${bgColor}; border: 1px solid ${color}; border-radius: 6px; padding: 12px; min-width: 220px; cursor: pointer; transition: background 0.2s;" onclick="showSectorStocks('${divergence.sector}')" onmouseover="this.style.background='${isBullish ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}'" onmouseout="this.style.background='${bgColor}'">
                <div style="color: #c9d1d9; font-weight: 600; margin-bottom: 8px;">${divergence.sector}</div>
                <div style="font-size: 11px; color: #8b949e;">
                    <div>Price Trend: <strong style="color: ${divergence.priceTrend > 0 ? '#22c55e' : '#ef4444'};">${divergence.priceTrend > 0 ? '+' : ''}${divergence.priceTrend.toFixed(2)}</strong></div>
                    <div>Volume Trend: <strong style="color: ${divergence.volumeTrend > 0 ? '#22c55e' : '#ef4444'};">${divergence.volumeTrend > 0 ? '+' : ''}${divergence.volumeTrend.toFixed(2)}</strong></div>
                    <div>Vol vs Avg: <strong style="color: ${divergence.volumeVsAvg > 0 ? '#22c55e' : '#ef4444'};">${divergence.volumeVsAvg > 0 ? '+' : ''}${divergence.volumeVsAvg.toFixed(1)}%</strong></div>
                    <div style="margin-top: 6px; color: ${color}; font-weight: 600;">
                        ${isBullish ? '📈 Potential Bounce' : '📉 Potential Pullback'}
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolumePriceDivergenceChart;
}
