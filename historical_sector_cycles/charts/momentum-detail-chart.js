/**
 * Momentum Detail Chart
 * Grouped bar chart showing 1M, 3M, 6M, 1Y momentum
 */

class MomentumDetailChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(momentumData, currentRange) {
        const margin = { top: 70, right: 90, bottom: 40, left: 60 };
        const result = ChartUtils.createSVG(this.containerId, margin);
        if (!result) return;

        const { svg, width, height } = result;

        // Title
        ChartUtils.addTitle(svg, width, currentRange);

        // Subtitle explaining the chart
        ChartUtils.addSubtitle(svg, width, '💡 Compare returns across timeframes • 1M=short-term, 1Y=long-term trend • Helps identify momentum shifts');

        const sectors = momentumData.map(d => d.sector);
        const metrics = ['m1', 'm3', 'm6', 'y1'];
        const metricLabels = ['1M', '3M', '6M', '1Y'];
        const metricColors = ['#388bfd', '#22c55e', '#f59e0b', '#ef4444'];

        const allValues = momentumData.flatMap(d => metrics.map(metric => d[metric]));
        const minY = Math.min(0, d3.min(allValues));
        const maxY = d3.max(allValues);

        const x0 = d3.scaleBand().domain(sectors).range([0, width]).padding(0.2);
        const x1 = d3.scaleBand().domain(metricLabels).range([0, x0.bandwidth()]).padding(0.05);
        const y = d3.scaleLinear().domain([minY, maxY]).nice().range([height, 0]);

        // Zero line
        ChartUtils.addZeroLine(svg, width, y(0));

        // Draw bars
        momentumData.forEach(sectorData => {
            metrics.forEach((metric, i) => {
                const value = sectorData[metric];
                svg.append('rect')
                    .attr('x', x0(sectorData.sector) + x1(metricLabels[i]))
                    .attr('y', value >= 0 ? y(value) : y(0))
                    .attr('width', x1.bandwidth())
                    .attr('height', Math.abs(y(value) - y(0)))
                    .attr('fill', ChartUtils.getValueColor(value, metricColors[i]))
                    .attr('rx', 2)
                    .attr('fill-opacity', 0.8)
                    .on('mouseover', (event) => {
                        showTooltip(event, `<strong>${sectorData.sector}</strong><br>${metricLabels[i]}: <strong>${ChartUtils.formatPercent(value)}</strong>`);
                    })
                    .on('mouseout', hideTooltip);
            });
        });

        ChartUtils.addAxes(svg, x0, y, height);

        // Legend
        const legendItems = metricLabels.map((label, i) => ({
            label: label,
            color: metricColors[i]
        }));

        ChartUtils.createLegend(svg, legendItems, width + 10, 0);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MomentumDetailChart;
}
