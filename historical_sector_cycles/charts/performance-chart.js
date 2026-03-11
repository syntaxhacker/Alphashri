/**
 * Sector Performance Chart
 * Bar chart showing cumulative returns by sector
 */

class PerformanceChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(momentumData, sectorColors, currentRange) {
        const margin = { top: 70, right: 30, bottom: 40, left: 60 };
        const result = ChartUtils.createSVG(this.containerId, margin);
        if (!result) return;

        const { svg, width, height } = result;

        // Title
        ChartUtils.addTitle(svg, width, currentRange);

        // Subtitle explaining the chart
        ChartUtils.addSubtitle(svg, width, '💡 Total return for each sector in selected period • Click bars to see top contributing stocks');

        const data = momentumData.slice(0, 10);
        const x = d3.scaleBand().domain(data.map(d => d.sector)).range([0, width]).padding(0.3);

        const allValues = data.map(d => d.total);
        const minY = Math.min(0, d3.min(allValues));
        const maxY = d3.max(allValues);
        const y = d3.scaleLinear().domain([minY, maxY]).nice().range([height, 0]);

        // Zero line
        ChartUtils.addZeroLine(svg, width, y(0));

        // Bars
        svg.selectAll('.bar').data(data).enter().append('rect')
            .attr('x', d => x(d.sector))
            .attr('y', d => d.total >= 0 ? y(d.total) : y(0))
            .attr('width', x.bandwidth())
            .attr('height', d => Math.abs(y(d.total) - y(0)))
            .attr('fill', (d, i) => ChartUtils.getValueColor(d.total, sectorColors[i]))
            .call(ChartUtils.setupBarStyle)
            .on('mouseover', (event, d) => showTooltip(event, ChartUtils.createMomentumTooltip(d)))
            .on('mouseout', hideTooltip)
            .on('click', (event, d) => {
                event.stopPropagation();
                if (typeof showSectorStocks === 'function') {
                    showSectorStocks(d.sector);
                }
            })
            .style('cursor', 'pointer');

        ChartUtils.addAxes(svg, x, y, height);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceChart;
}
