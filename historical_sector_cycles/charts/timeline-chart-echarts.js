/**
 * Timeline Chart (ECharts) - Optimized
 * Line chart showing all sectors' performance over time
 */

class TimelineChart {
    constructor(containerId) {
        this.containerId = containerId;
        this.chart = null;
        this.resizeHandler = null;
    }

    render(timeSeriesData, sectorColors, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        // Dispose existing chart to prevent memory leaks
        if (this.chart) {
            this.chart.dispose();
        }

        // Initialize chart with renderer optimizations
        this.chart = echarts.init(container, null, {
            renderer: 'canvas',
            useDirtyRect: true  // Optimize rendering
        });

        const sectors = Object.keys(timeSeriesData);

        // Prepare data for ECharts - sample data if too many points
        const dates = [];
        const series = [];

        // Get all unique dates from the first sector
        if (sectors.length > 0) {
            const firstSectorData = timeSeriesData[sectors[0]];
            firstSectorData.forEach(d => {
                dates.push(this.formatDate(d.date));
            });
        }

        // Downsample data if more than 50 points for better performance
        const maxDataPoints = 50;
        const samplingRate = Math.max(1, Math.floor(dates.length / maxDataPoints));

        const sampledDates = dates.filter((_, i) => i % samplingRate === 0);

        // Create series for each sector with sampling
        sectors.forEach((sector, i) => {
            const data = timeSeriesData[sector]
                .filter((_, index) => index % samplingRate === 0)
                .map(d => d.value);

            series.push({
                name: sector,
                type: 'line',
                data: data,
                smooth: true,
                showSymbol: false,  // Don't show symbols for better performance
                lineStyle: {
                    width: 1.5,  // Thinner lines for better performance
                    opacity: 0.85
                },
                itemStyle: {
                    color: sectorColors[i % sectorColors.length]
                },
                // Disable emphasis animation for better performance
                emphasis: {
                    disabled: true
                },
                // Enable progressive rendering
                progressive: 200,
                progressiveThreshold: 1000
            });
        });

        // Calculate date range for title
        const allDates = Object.values(timeSeriesData).flatMap(d => d.map(x => x.date));
        const minDate = new Date(Math.min(...allDates));
        const maxDate = new Date(Math.max(...allDates));
        const dateRangeText = `${this.formatDate(minDate)} - ${this.formatDate(maxDate)}`;

        // Calculate value range and sort sectors by final value for labels
        const allValues = Object.values(timeSeriesData).flatMap(d => d.map(x => x.value));
        const minValue = Math.min(...allValues);
        const maxValue = Math.max(...allValues);

        // Sort sectors by their final value to prevent label overlap
        const sortedSectors = sectors.map((sector, i) => {
            const data = timeSeriesData[sector];
            const lastValue = data[data.length - 1].value;
            return { sector, lastValue, colorIndex: i, originalIndex: i };
        }).sort((a, b) => b.lastValue - a.lastValue);

        const option = {
            // Disable animations for better performance
            animation: false,

            title: {
                text: `📅 ${dateRangeText} (${currentRange.toUpperCase()})`,
                left: 'center',
                top: 10,
                textStyle: {
                    color: '#58a6ff',
                    fontSize: 13,
                    fontWeight: 'bold'
                }
            },
            grid: {
                left: 60,
                right: 160,  // More space for labels
                top: 50,
                bottom: 50,
                containLabel: false
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: '#161b22',
                borderColor: '#30363d',
                textStyle: {
                    color: '#c9d1d9',
                    fontSize: 11
                },
                // Simplified tooltip for better performance
                formatter: function(params) {
                    let result = `<div style="color: #8b949e; font-size: 11px; margin-bottom: 3px;">${params[0].axisValue}</div>`;
                    // Show top 5 and bottom 5 only
                    const sortedParams = params.sort((a, b) => b.value - a.value);
                    const top5 = sortedParams.slice(0, 5);
                    const bottom5 = sortedParams.slice(-5);

                    result += '<div style="margin: 5px 0;"><strong style="color: #22c55e;">Top 5:</strong></div>';
                    top5.forEach(param => {
                        result += `<div style="display: flex; align-items: center; margin: 2px 0; font-size: 10px;">
                            <span style="display: inline-block; width: 8px; height: 8px; background: ${param.color}; border-radius: 50%; margin-right: 6px;"></span>
                            <span style="color: #c9d1d9; flex: 1;">${param.seriesName}</span>
                            <span style="color: ${param.value >= 0 ? '#22c55e' : '#ef4444'}; font-weight: 600;">${param.value.toFixed(1)}%</span>
                        </div>`;
                    });

                    result += '<div style="margin: 5px 0;"><strong style="color: #ef4444;">Bottom 5:</strong></div>';
                    bottom5.forEach(param => {
                        result += `<div style="display: flex; align-items: center; margin: 2px 0; font-size: 10px;">
                            <span style="display: inline-block; width: 8px; height: 8px; background: ${param.color}; border-radius: 50%; margin-right: 6px;"></span>
                            <span style="color: #c9d1d9; flex: 1;">${param.seriesName}</span>
                            <span style="color: ${param.value >= 0 ? '#22c55e' : '#ef4444'}; font-weight: 600;">${param.value.toFixed(1)}%</span>
                        </div>`;
                    });

                    return result;
                }
            },
            legend: {
                show: false
            },
            xAxis: {
                type: 'category',
                data: sampledDates,
                axisLine: {
                    lineStyle: {
                        color: '#30363d'
                    }
                },
                axisLabel: {
                    color: '#8b949e',
                    fontSize: 10,
                    rotate: 0,
                    interval: 'auto',  // Auto-adjust label density
                    formatter: function(value) {
                        const parts = value.split('/');
                        if (parts.length === 2) {
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            return `${months[parseInt(parts[0]) - 1]} ${parts[1]}`;
                        }
                        return value;
                    }
                },
                axisTick: {
                    lineStyle: {
                        color: '#30363d'
                    }
                }
            },
            yAxis: {
                type: 'value',
                axisLine: {
                    show: false
                },
                axisTick: {
                    show: false
                },
                axisLabel: {
                    color: '#8b949e',
                    fontSize: 10,
                    formatter: '{value}%'
                },
                splitLine: {
                    lineStyle: {
                        color: '#21262d',
                        type: 'dashed',
                        width: 1
                    }
                }
            },
            series: series
        };

        this.chart.setOption(option, { notMerge: true });

        // Add labels with collision avoidance
        this.addLineLabels(sortedSectors, sectorColors, minValue, maxValue);

        // Remove old resize handler and add new one
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }

        this.resizeHandler = () => {
            if (this.chart) {
                this.chart.resize();
                this.addLineLabels(sortedSectors, sectorColors, minValue, maxValue);
            }
        };

        window.addEventListener('resize', this.resizeHandler);
    }

    addLineLabels(sortedSectors, sectorColors, minValue, maxValue) {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        // Remove existing labels
        const existingLabels = container.querySelectorAll('.timeline-label');
        existingLabels.forEach(label => label.remove());

        const valueRange = maxValue - minValue || 1; // Avoid division by zero

        // Get chart dimensions
        const chartWidth = container.clientWidth - 220;
        const chartHeight = container.clientHeight - 100;

        // Track label positions to avoid collision
        const labelPositions = [];
        const minLabelSpacing = 14; // Minimum pixels between labels

        sortedSectors.forEach((item, i) => {
            const { sector, lastValue, colorIndex } = item;

            // Calculate vertical position
            const normalizedY = 1 - ((lastValue - minValue) / valueRange);
            let yPos = 50 + (normalizedY * chartHeight);

            // Adjust position to avoid collision
            let adjusted = false;
            let attempts = 0;
            const maxAttempts = 20;

            while (!adjusted && attempts < maxAttempts) {
                let collision = false;
                for (const pos of labelPositions) {
                    if (Math.abs(pos - yPos) < minLabelSpacing) {
                        collision = true;
                        break;
                    }
                }

                if (!collision) {
                    labelPositions.push(yPos);
                    adjusted = true;
                } else {
                    // Move label up or down
                    const offset = (attempts % 2 === 0 ? 1 : -1) * Math.ceil((attempts + 1) / 2) * minLabelSpacing;
                    yPos += offset;
                    attempts++;
                }
            }

            // Ensure label stays within chart bounds
            yPos = Math.max(50, Math.min(yPos, container.clientHeight - 30));

            // Create label element
            const label = document.createElement('div');
            label.className = 'timeline-label';
            label.textContent = `${sector}: ${lastValue.toFixed(0)}%`;
            label.style.cssText = `
                position: absolute;
                right: 10px;
                top: ${yPos}px;
                color: ${sectorColors[colorIndex % sectorColors.length]};
                font-size: 10px;
                font-weight: 500;
                pointer-events: none;
                white-space: nowrap;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            `;

            container.appendChild(label);
        });
    }

    formatDate(date) {
        const d = new Date(date);
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${month}/${day}`;
    }

    dispose() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        if (this.chart) {
            this.chart.dispose();
            this.chart = null;
        }

        // Remove labels
        const container = document.getElementById(this.containerId);
        if (container) {
            const labels = container.querySelectorAll('.timeline-label');
            labels.forEach(label => label.remove());
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimelineChart;
}
