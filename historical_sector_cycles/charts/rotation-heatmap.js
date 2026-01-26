/**
 * Rotation Heatmap Chart
 * Heatmap showing sector rankings by month
 */

class RotationHeatmapChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(heatmapDataArray, currentRange) {
        const margin = { top: 70, right: 10, bottom: 70, left: 100 };
        const result = ChartUtils.createSVG(this.containerId, margin);
        if (!result) return;

        const { svg, container } = result;

        // Title with period
        ChartUtils.addTitle(svg, container.clientWidth - margin.left - margin.right, currentRange);

        // Add instruction subtitle
        svg.append('text')
            .attr('x', (container.clientWidth - margin.left - margin.right) / 2)
            .attr('y', -40)
            .attr('text-anchor', 'middle')
            .style('fill', '#8b949e')
            .style('font-size', '10px')
            .text('🟢 Green = Best Performance (Rank 1) | 🔴 Red = Worst Performance (Rank 15)');

        const allMonths = [...new Set(heatmapDataArray.map(d => d.date))].sort();
        const sectors = [...new Set(heatmapDataArray.map(d => d.sector))];

        const cellWidth = (container.clientWidth - margin.left - margin.right) / (allMonths.length + 1);
        const cellHeight = (container.clientHeight - margin.top - margin.bottom) / sectors.length;

        // Draw heatmap cells with rank numbers
        heatmapDataArray.forEach(d => {
            const x = allMonths.indexOf(d.date) * cellWidth;
            const y = sectors.indexOf(d.sector) * cellHeight;

            // Color mapping with better contrast
            let color, textColor;
            if (d.rank <= 3) {
                // Top 3 - Green gradient
                color = d.rank === 1 ? '#15803d' : d.rank === 2 ? '#16a34a' : '#22c55e';
                textColor = '#ffffff';
            } else if (d.rank <= 7) {
                // Good performance - Light green
                color = '#4ade80';
                textColor = '#000000';
            } else if (d.rank <= 11) {
                // Average - Yellow/Orange
                color = d.rank <= 9 ? '#fbbf24' : '#fb923c';
                textColor = '#000000';
            } else {
                // Poor performance - Red
                color = d.rank <= 13 ? '#ef4444' : '#dc2626';
                textColor = '#ffffff';
            }

            svg.append('rect')
                .attr('x', x)
                .attr('y', y)
                .attr('width', cellWidth - 2)
                .attr('height', cellHeight - 2)
                .attr('fill', color)
                .attr('class', 'rank-box')
                .attr('rx', 4)
                .attr('stroke', '#1f2937')
                .attr('stroke-width', 1)
                .on('mouseover', function() {
                    d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2);
                    showTooltip(event, `<strong>${d.sector}</strong><br>${d.date}<br>Rank: ${d.rank} out of ${sectors.length}<br>${d.rank <= 5 ? '🔥 Top Performer' : d.rank >= 11 ? '❄️ Underperformer' : '➡️ Average'}`);
                })
                .on('mouseout', function() {
                    d3.select(this).attr('stroke', '#1f2937').attr('stroke-width', 1);
                    hideTooltip();
                });

            // Add rank number inside the cell
            const fontSize = Math.min(cellWidth, cellHeight) * 0.38;
            if (fontSize >= 9) {
                svg.append('text')
                    .attr('x', x + (cellWidth - 2) / 2)
                    .attr('y', y + (cellHeight - 2) / 2)
                    .attr('dy', '0.35em')
                    .attr('text-anchor', 'middle')
                    .style('fill', textColor)
                    .style('font-size', `${Math.max(9, fontSize)}px`)
                    .style('font-weight', 'bold')
                    .style('text-shadow', textColor === '#ffffff' ? '1px 1px 2px rgba(0,0,0,0.5)' : 'none')
                    .text(d.rank);
            }
        });

        // Sector labels
        sectors.forEach((s, i) => {
            svg.append('text')
                .attr('x', -8)
                .attr('y', i * cellHeight + cellHeight / 2 + 4)
                .attr('text-anchor', 'end')
                .style('fill', '#c9d1d9')
                .style('font-size', '11px')
                .style('font-weight', '500')
                .text(s);
        });

        // Month labels - show ALL months, not just every 3rd
        allMonths.forEach((m, i) => {
            // Parse the date to get month name
            const [year, month] = m.split('-');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthName = monthNames[parseInt(month) - 1];
            const yearShort = year.substring(2);

            svg.append('text')
                .attr('x', i * cellWidth + cellWidth / 2)
                .attr('y', -10)
                .attr('text-anchor', 'middle')
                .style('fill', '#58a6ff')
                .style('font-size', '9px')
                .style('font-weight', '500')
                .text(`${monthName}${yearShort}`);
        });

        // Enhanced legend
        const legendY = container.clientHeight - 35;
        svg.append('text')
            .attr('x', cellWidth)
            .attr('y', legendY - 10)
            .style('fill', '#58a6ff')
            .style('font-size', '11px')
            .style('font-weight', 'bold')
            .text('Performance Ranking:');

        // Create legend bar with distinct colors
        const legendStartX = cellWidth + 130;
        const legendWidth = 180;
        const legendSegmentWidth = legendWidth / 4;

        // Rank 1-3 (Best)
        svg.append('rect')
            .attr('x', legendStartX)
            .attr('y', legendY - 8)
            .attr('width', legendSegmentWidth)
            .attr('height', 12)
            .attr('fill', '#15803d')
            .attr('rx', 2);
        svg.append('text')
            .attr('x', legendStartX)
            .attr('y', legendY - 12)
            .attr('text-anchor', 'start')
            .style('fill', '#22c55e')
            .style('font-size', '9px')
            .style('font-weight', 'bold')
            .text('1-3 Best');

        // Rank 4-7 (Good)
        svg.append('rect')
            .attr('x', legendStartX + legendSegmentWidth)
            .attr('y', legendY - 8)
            .attr('width', legendSegmentWidth)
            .attr('height', 12)
            .attr('fill', '#4ade80')
            .attr('rx', 2);
        svg.append('text')
            .attr('x', legendStartX + legendSegmentWidth)
            .attr('y', legendY - 12)
            .attr('text-anchor', 'middle')
            .style('fill', '#4ade80')
            .style('font-size', '9px')
            .style('font-weight', 'bold')
            .text('4-7 Good');

        // Rank 8-11 (Average)
        svg.append('rect')
            .attr('x', legendStartX + legendSegmentWidth * 2)
            .attr('y', legendY - 8)
            .attr('width', legendSegmentWidth)
            .attr('height', 12)
            .attr('fill', '#fbbf24')
            .attr('rx', 2);
        svg.append('text')
            .attr('x', legendStartX + legendSegmentWidth * 2)
            .attr('y', legendY - 12)
            .attr('text-anchor', 'middle')
            .style('fill', '#fbbf24')
            .style('font-size', '9px')
            .style('font-weight', 'bold')
            .text('8-11 Avg');

        // Rank 12-15 (Worst)
        svg.append('rect')
            .attr('x', legendStartX + legendSegmentWidth * 3)
            .attr('y', legendY - 8)
            .attr('width', legendSegmentWidth)
            .attr('height', 12)
            .attr('fill', '#dc2626')
            .attr('rx', 2);
        svg.append('text')
            .attr('x', legendStartX + legendSegmentWidth * 3 + legendSegmentWidth)
            .attr('y', legendY - 12)
            .attr('text-anchor', 'end')
            .style('fill', '#ef4444')
            .style('font-size', '9px')
            .style('font-weight', 'bold')
            .text('12-15 Worst');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RotationHeatmapChart;
}
