/**
 * Momentum Ranking Chart
 * Bar chart showing 3M momentum by sector
 */

class MomentumRankChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(momentumData, currentRange) {
        const margin = { top: 70, right: 15, bottom: 80, left: 50 };
        const result = ChartUtils.createSVG(this.containerId, margin);
        if (!result) return;

        const { svg, width, height } = result;

        // Title
        ChartUtils.addTitle(svg, width, currentRange);

        // Subtitle explaining the chart
        ChartUtils.addSubtitle(svg, width, '💡 Sectors ranked by 3-month return • Higher = Stronger recent momentum • Click to see stock contributors');

        const x = d3.scaleBand().domain(momentumData.map(d => d.sector)).range([0, width]).padding(0.3);
        const y = d3.scaleLinear().domain(d3.extent(momentumData, d => d.m3)).nice().range([height, 0]);

        // Bars
        svg.selectAll('.bar').data(momentumData).enter().append('rect')
            .attr('x', d => x(d.sector))
            .attr('y', d => y(Math.max(0, d.m3)))
            .attr('width', x.bandwidth())
            .attr('height', d => Math.abs(y(d.m3) - y(0)))
            .attr('fill', d => ChartUtils.getValueColor(d.m3, '#388bfd'))
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

        ChartUtils.addZeroLine(svg, width, y(0));
        ChartUtils.addAxes(svg, x, y, height, true);

        // Legend
        const legendItems = [
            { label: 'Positive', color: '#388bfd' },
            { label: 'Negative', color: '#f85149' }
        ];

        const legend = svg.append('g').attr('transform', `translate(${width - 120}, 10)`);
        legend.append('text')
            .attr('x', 0)
            .attr('y', 0)
            .style('fill', '#58a6ff')
            .style('font-size', '10px')
            .style('font-weight', 'bold')
            .text('Momentum:');

        ChartUtils.createLegend(legend, legendItems, 0, 8);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MomentumRankChart;
}
