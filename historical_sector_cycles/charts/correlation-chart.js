/**
 * Correlation Matrix Chart
 * Heatmap showing correlations between sectors
 */

class CorrelationChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(correlations, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        const sectors = [...new Set(correlations.map(c => c.sector1))];
        const matrixSize = 900;
        const cellSize = matrixSize / sectors.length;

        const svg = d3.select(`#${this.containerId}`)
            .append('svg')
            .attr('width', matrixSize + 150)
            .attr('height', matrixSize + 100)
            .append('g')
            .attr('transform', 'translate(130, 40)');

        // Title showing range
        svg.append('text')
            .attr('x', matrixSize / 2)
            .attr('y', -25)
            .attr('text-anchor', 'middle')
            .style('fill', '#58a6ff')
            .style('font-size', '12px')
            .style('font-weight', 'bold')
            .text(`📊 Period: ${currentRange.toUpperCase()}`);

        // Subtitle explaining the chart
        svg.append('text')
            .attr('x', matrixSize / 2)
            .attr('y', -5)
            .attr('text-anchor', 'middle')
            .style('fill', '#8b949e')
            .style('font-size', '10px')
            .text('💡 Blue = Move together • Red = Move opposite • Diagonal = Perfect correlation (same vs same)');

        // Draw correlation cells
        correlations.forEach(c => {
            const i = sectors.indexOf(c.sector1);
            const j = sectors.indexOf(c.sector2);

            let color;
            if (c.correlation >= 0) {
                const intensity = Math.min(Math.abs(c.correlation), 1);
                color = d3.interpolateRgb("#21262d", "#388bfd")(intensity);
            } else {
                const intensity = Math.min(Math.abs(c.correlation), 1);
                color = d3.interpolateRgb("#21262d", "#f85149")(intensity);
            }

            svg.append('rect')
                .attr('x', j * cellSize)
                .attr('y', i * cellSize)
                .attr('width', cellSize - 1)
                .attr('height', cellSize - 1)
                .attr('fill', color)
                .attr('rx', 2)
                .on('mouseover', () => {
                    showTooltip(event, `<strong>${c.sector1}</strong> ↔ <strong>${c.sector2}</strong><br>Correlation: <strong>${c.correlation.toFixed(3)}</strong>`);
                })
                .on('mouseout', hideTooltip);

            // Show correlation value for stronger correlations
            if (Math.abs(c.correlation) > 0.5) {
                svg.append('text')
                    .attr('x', j * cellSize + cellSize / 2)
                    .attr('y', i * cellSize + cellSize / 2 + 3)
                    .attr('text-anchor', 'middle')
                    .style('fill', c.correlation > 0 ? '#fff' : '#000')
                    .style('font-size', '9px')
                    .style('font-weight', 'bold')
                    .text(c.correlation.toFixed(2));
            }
        });

        // Labels
        sectors.forEach((s, i) => {
            svg.append('text')
                .attr('x', -8)
                .attr('y', i * cellSize + cellSize / 2 + 3)
                .attr('text-anchor', 'end')
                .style('fill', '#8b949e')
                .style('font-size', '11px')
                .text(s);

            svg.append('text')
                .attr('x', i * cellSize + cellSize / 2)
                .attr('y', matrixSize + 15)
                .attr('text-anchor', 'middle')
                .attr('class', 'rank-label')
                .style('font-size', '11px')
                .text(s);
        });

        // Legend
        const legend = svg.append('g').attr('transform', `translate(0, ${matrixSize + 50})`);

        const defs = svg.append('defs');
        const linearGradient = defs.append('linearGradient')
            .attr('id', 'correlationGradient')
            .attr('x1', '0%').attr('y1', '0%')
            .attr('x2', '100%').attr('y2', '0%');

        linearGradient.append('stop').attr('offset', '0%').attr('stop-color', '#f85149');
        linearGradient.append('stop').attr('offset', '50%').attr('stop-color', '#21262d');
        linearGradient.append('stop').attr('offset', '100%').attr('stop-color', '#388bfd');

        legend.append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', 200)
            .attr('height', 12)
            .attr('fill', 'url(#correlationGradient)')
            .attr('rx', 2);

        legend.append('text')
            .attr('x', 0)
            .attr('y', -5)
            .attr('text-anchor', 'middle')
            .style('fill', '#f85149')
            .style('font-size', '10px')
            .text('-1.0');

        legend.append('text')
            .attr('x', 100)
            .attr('y', -5)
            .attr('text-anchor', 'middle')
            .style('fill', '#8b949e')
            .style('font-size', '10px')
            .text('0.0');

        legend.append('text')
            .attr('x', 200)
            .attr('y', -5)
            .attr('text-anchor', 'middle')
            .style('fill', '#388bfd')
            .style('font-size', '10px')
            .text('+1.0');

        legend.append('text')
            .attr('x', 100)
            .attr('y', 25)
            .attr('text-anchor', 'middle')
            .style('fill', '#58a6ff')
            .style('font-size', '11px')
            .style('font-weight', 'bold')
            .text('Sector Correlation (-1 to +1)');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CorrelationChart;
}
