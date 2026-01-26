/**
 * Relative Strength Matrix Chart
 * Shows how each sector performs relative to a benchmark (Nifty/Market)
 * and identifies relative strength leaders and laggards
 */

class RelativeStrengthChart {
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

        // Calculate relative strength for each sector
        const relativeStrengths = [];
        const benchmarkData = this.calculateBenchmark(timeSeriesData, sectors);

        if (!benchmarkData || benchmarkData.length === 0) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: #8b949e;">
                    <p style="font-size: 14px;">📊 Unable to calculate benchmark</p>
                </div>
            `;
            return;
        }

        sectors.forEach(sector => {
            const sectorData = timeSeriesData[sector];
            if (!sectorData || sectorData.length < 20) {
                console.log(`RS: Skipping ${sector} - insufficient data`);
                return;
            }

            const rs = this.calculateRelativeStrength(sector, sectorData, benchmarkData);
            if (rs) {
                relativeStrengths.push(rs);
            }
        });

        console.log(`RS: Calculated ${relativeStrengths.length} of ${sectors.length} sectors`);

        // Sort by RS score
        relativeStrengths.sort((a, b) => b.rsScore - a.rsScore);

        this.renderRelativeStrength(container, relativeStrengths, currentRange);
    }

    calculateBenchmark(timeSeriesData, sectors) {
        // Create a market benchmark by averaging all sectors
        if (sectors.length === 0) return [];

        // Find the minimum length
        const minLength = Math.min(...sectors.map(s => timeSeriesData[s]?.length || 0));

        if (minLength < 10) return [];

        const benchmark = [];
        for (let i = 0; i < minLength; i++) {
            let sum = 0;
            let count = 0;

            sectors.forEach(sector => {
                const data = timeSeriesData[sector];
                if (data && data[i] && isFinite(data[i].value) && !isNaN(data[i].value)) {
                    // Use the actual value (data is already normalized)
                    sum += data[i].value;
                    count++;
                }
            });

            if (count > 0) {
                benchmark.push(sum / count);
            }
        }

        return benchmark;
    }

    calculateRelativeStrength(sector, sectorData, benchmarkData) {
        if (!benchmarkData || benchmarkData.length < 10) return null;

        const minLength = Math.min(sectorData.length, benchmarkData.length);
        if (minLength < 10) return null;

        // Filter out invalid data
        const validSectorData = sectorData.filter(d =>
            isFinite(d.value) && !isNaN(d.value)
        );

        if (validSectorData.length < 10) return null;

        // Calculate sector return (handle normalized data that may start at 0)
        const sectorStart = validSectorData[0].value;
        const sectorEnd = validSectorData[validSectorData.length - 1].value;
        let sectorReturn = 0;

        if (Math.abs(sectorStart) > 0.0001) {
            sectorReturn = ((sectorEnd - sectorStart) / Math.abs(sectorStart)) * 100;
        } else {
            // For normalized data starting near 0, use the end value scaled
            sectorReturn = sectorEnd * 100;
        }

        // Calculate benchmark return (handle normalized data that may start at 0)
        const benchmarkStart = benchmarkData[0];
        const benchmarkEnd = benchmarkData[benchmarkData.length - 1];
        let benchmarkReturn = 0;

        if (Math.abs(benchmarkStart) > 0.0001) {
            benchmarkReturn = ((benchmarkEnd - benchmarkStart) / Math.abs(benchmarkStart)) * 100;
        } else {
            benchmarkReturn = benchmarkEnd * 100;
        }

        // Validate returns
        if (!isFinite(sectorReturn) || isNaN(sectorReturn)) sectorReturn = 0;
        if (!isFinite(benchmarkReturn) || isNaN(benchmarkReturn)) benchmarkReturn = 0;

        // RS Score: How much sector outperformed/underperformed benchmark
        const rsScore = sectorReturn - benchmarkReturn;

        // Calculate RS momentum (recent trend)
        const recentIndex = Math.max(0, validSectorData.length - 22);
        let recentSectorReturn = 0;
        let recentBenchmarkReturn = 0;

        if (recentIndex > 0 && recentIndex < validSectorData.length) {
            const recentStartValue = validSectorData[recentIndex].value;
            const recentEndValue = validSectorData[validSectorData.length - 1].value;

            if (Math.abs(recentStartValue) > 0.0001) {
                recentSectorReturn = ((recentEndValue - recentStartValue) / Math.abs(recentStartValue)) * 100;
            } else {
                recentSectorReturn = recentEndValue * 100;
            }

            const benchRecentIndex = Math.max(0, benchmarkData.length - 22);
            const benchRecentStart = benchmarkData[benchRecentIndex];
            const benchRecentEnd = benchmarkData[benchmarkData.length - 1];

            if (Math.abs(benchRecentStart) > 0.0001) {
                recentBenchmarkReturn = ((benchRecentEnd - benchRecentStart) / Math.abs(benchRecentStart)) * 100;
            } else {
                recentBenchmarkReturn = benchRecentEnd * 100;
            }
        }

        const rsMomentum = recentSectorReturn - recentBenchmarkReturn;

        // RS Trend: Is RS improving or deteriorating?
        const rsTrendValues = [];
        const lookback = 20;

        for (let i = lookback; i < minLength; i += Math.max(1, Math.floor(minLength / 20))) {
            if (!validSectorData[i] || !validSectorData[i - lookback]) continue;
            if (!isFinite(benchmarkData[i]) || !isFinite(benchmarkData[i - lookback])) continue;

            const sectorValue = validSectorData[i].value;
            const sectorPrevValue = validSectorData[i - lookback].value;
            const benchValue = benchmarkData[i];
            const benchPrevValue = benchmarkData[i - lookback];

            let sectorRet = 0;
            if (Math.abs(sectorPrevValue) > 0.0001) {
                sectorRet = ((sectorValue - sectorPrevValue) / Math.abs(sectorPrevValue)) * 100;
            } else {
                sectorRet = sectorValue * 100;
            }

            let benchRet = 0;
            if (Math.abs(benchPrevValue) > 0.0001) {
                benchRet = ((benchValue - benchPrevValue) / Math.abs(benchPrevValue)) * 100;
            } else {
                benchRet = benchValue * 100;
            }

            rsTrendValues.push(sectorRet - benchRet);
        }

        const rsTrend = rsTrendValues.length > 1
            ? (rsTrendValues[rsTrendValues.length - 1] - rsTrendValues[0])
            : 0;

        // Classify relative strength
        let classification = 'neutral';
        if (rsScore > 10 && rsMomentum > 0) {
            classification = 'strong-outperformer';
        } else if (rsScore > 5) {
            classification = 'outperformer';
        } else if (rsScore < -10 && rsMomentum < 0) {
            classification = 'strong-underperformer';
        } else if (rsScore < -5) {
            classification = 'underperformer';
        }

        return {
            sector,
            rsScore: isFinite(rsScore) ? rsScore : 0,
            rsMomentum: isFinite(rsMomentum) ? rsMomentum : 0,
            rsTrend: isFinite(rsTrend) ? rsTrend : 0,
            sectorReturn: isFinite(sectorReturn) ? sectorReturn : 0,
            benchmarkReturn: isFinite(benchmarkReturn) ? benchmarkReturn : 0,
            classification
        };
    }

    renderRelativeStrength(container, strengths, currentRange) {
        if (strengths.length === 0) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: #8b949e;">
                    <p style="font-size: 14px;">📊 Insufficient data for relative strength analysis</p>
                </div>
            `;
            return;
        }

        let html = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <div style="color: #58a6ff; font-size: 13px; font-weight: 600; margin-bottom: 10px;">
                    📊 Relative Strength Matrix (vs Market Benchmark)
                </div>
                <div style="color: #8b949e; font-size: 11px; line-height: 1.6;">
                    💡 <strong>RS Score</strong>: Sector return minus market return. Positive = outperformance.<br>
                    💡 <strong>RS Momentum</strong>: Recent relative strength trend.<br>
                    💡 Focus on strong outperformers with positive momentum for long positions.
                </div>
            </div>
        `;

        // Classification groups
        const strongOut = strengths.filter(s => s.classification === 'strong-outperformer');
        const outperformers = strengths.filter(s => s.classification === 'outperformer');
        const underperformers = strengths.filter(s => s.classification === 'underperformer');
        const strongUnder = strengths.filter(s => s.classification === 'strong-underperformer');
        const neutral = strengths.filter(s => s.classification === 'neutral');

        // Strong Outperformers
        if (strongOut.length > 0) {
            html += this.renderGroup('🟢 Strong Outperformers', strongOut, '#22c55e', 'rgba(34, 197, 94, 0.1)');
        }

        // Outperformers
        if (outperformers.length > 0) {
            html += this.renderGroup('📈 Outperformers', outperformers, '#10b981', 'rgba(16, 185, 129, 0.1)');
        }

        // Neutral
        if (neutral.length > 0) {
            html += `
                <div style="margin-bottom: 15px;">
                    <div style="color: #8b949e; font-size: 13px; font-weight: 600; margin-bottom: 10px;">
                        ⚪ Neutral Zone
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${neutral.map(s => `
                            <span style="background: #21262d; border: 1px solid #30363d; padding: 6px 12px; border-radius: 20px; font-size: 11px; cursor: pointer;" onclick="showSectorStocks('${s.sector}')">
                                ${s.sector} <span style="color: #8b949e; margin-left: 6px;">RS: ${s.rsScore.toFixed(1)}</span>
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Underperformers
        if (underperformers.length > 0) {
            html += this.renderGroup('📉 Underperformers', underperformers, '#f59e0b', 'rgba(245, 158, 11, 0.1)');
        }

        // Strong Underperformers
        if (strongUnder.length > 0) {
            html += this.renderGroup('🔴 Strong Underperformers', strongUnder, '#ef4444', 'rgba(239, 68, 68, 0.1)');
        }

        // RS Score Chart
        html += `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; margin-top: 20px;">
                <div style="color: #58a6ff; font-size: 12px; font-weight: 600; margin-bottom: 15px;">📊 Relative Strength Score Distribution</div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
        `;

        const maxScore = Math.max(...strengths.map(s => Math.abs(s.rsScore)), 1); // Default to 1 to avoid division by zero

        strengths.forEach(s => {
            const barWidth = (Math.abs(s.rsScore) / maxScore) * 100;
            const color = s.rsScore > 0 ? '#22c55e' : '#ef4444';
            const safeRsScore = isFinite(s.rsScore) ? s.rsScore : 0;

            html += `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 100px; font-size: 11px; color: #c9d1d9;">${s.sector}</div>
                    <div style="flex: 1; height: 10px; background: #21262d; border-radius: 5px; overflow: hidden; position: relative;">
                        <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: #8b949e;"></div>
                        <div style="position: absolute; ${safeRsScore > 0 ? 'left: 50%' : 'right: 50%'}; top: 0; bottom: 0; width: ${barWidth / 2}%; background: ${color};"></div>
                    </div>
                    <div style="width: 60px; font-size: 10px; color: ${color}; text-align: right; font-weight: 600;">${safeRsScore > 0 ? '+' : ''}${safeRsScore.toFixed(1)}%</div>
                </div>
            `;
        });

        html += `
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 10px; color: #8b949e;">
                    <span>Underperforming Market</span>
                    <span>Market Return</span>
                    <span>Outperforming Market</span>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    renderGroup(title, items, color, bgColor) {
        return `
            <div style="margin-bottom: 15px;">
                <div style="color: ${color}; font-size: 13px; font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                    ${title}
                    <span style="background: ${color}; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${items.length}</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${items.map(s => {
                        const safeRsScore = isFinite(s.rsScore) ? s.rsScore : 0;
                        const safeRsMomentum = isFinite(s.rsMomentum) ? s.rsMomentum : 0;
                        const safeSectorReturn = isFinite(s.sectorReturn) ? s.sectorReturn : 0;
                        const safeBenchmarkReturn = isFinite(s.benchmarkReturn) ? s.benchmarkReturn : 0;

                        return `
                        <div style="background: ${bgColor}; border: 1px solid ${color}; border-radius: 6px; padding: 10px 14px; min-width: 180px; cursor: pointer; transition: background 0.2s;" onclick="showSectorStocks('${s.sector}')" onmouseover="this.style.background='${color}33'" onmouseout="this.style.background='${bgColor}'">
                            <div style="color: #c9d1d9; font-weight: 600; margin-bottom: 6px;">${s.sector}</div>
                            <div style="font-size: 10px; color: #8b949e;">
                                <div>RS Score: <strong style="color: ${color};">${safeRsScore > 0 ? '+' : ''}${safeRsScore.toFixed(1)}%</strong></div>
                                <div>RS Momentum: <strong style="color: ${safeRsMomentum > 0 ? '#22c55e' : '#ef4444'};">${safeRsMomentum > 0 ? '+' : ''}${safeRsMomentum.toFixed(1)}%</strong></div>
                                <div style="margin-top: 4px;">Return: <strong style="color: ${safeSectorReturn > 0 ? '#22c55e' : '#ef4444'};">${safeSectorReturn.toFixed(1)}%</strong> vs Market ${safeBenchmarkReturn.toFixed(1)}%</div>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            </div>
        `;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RelativeStrengthChart;
}
