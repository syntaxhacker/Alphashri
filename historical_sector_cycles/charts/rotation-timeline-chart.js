/**
 * Rotation Timeline Chart
 * Bar chart showing top 3 sectors per quarter
 */

class RotationTimelineChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(quarterlyData, sectorColors, allSectors, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        const quarters = [...new Set(quarterlyData.map(d => d.quarter))].sort();
        const top3ByQuarter = quarters.map(q => {
            const quarterReturns = quarterlyData.filter(d => d.quarter === q);
            const ranked = quarterReturns.sort((a, b) => b.return - a.return).slice(0, 3);
            return { quarter: q, top3: ranked };
        });

        const margin = { top: 70, right: 30, bottom: 80, left: 60 };
        const width = container.clientWidth - margin.left - margin.right;
        const height = container.clientHeight - margin.top - margin.bottom;

        const svg = d3.select(`#${this.containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Title showing range
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', -45)
            .attr('text-anchor', 'middle')
            .style('fill', '#58a6ff')
            .style('font-size', '12px')
            .style('font-weight', 'bold')
            .text(`📊 Period: ${currentRange.toUpperCase()}`);

        // Instruction subtitle
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', -25)
            .attr('text-anchor', 'middle')
            .style('fill', '#8b949e')
            .style('font-size', '10px')
            .text('💡 Shows which sectors led each quarter • Watch leadership change (rotation) • Example: Q1=Tech→Q2=Pharma means money rotated from Tech to Pharma');

        const barWidth = width / quarters.length;

        // Calculate scaling
        const allReturns = top3ByQuarter.flatMap(d => d.top3.map(t => t.return));
        const globalMax = d3.max(allReturns);
        const globalMin = d3.min(allReturns);
        const useZeroBaseline = globalMin < 0;

        const yDomain = useZeroBaseline ? [Math.min(globalMin, 0), Math.max(globalMax, 0)] : [globalMin, globalMax];
        const yScale = d3.scaleLinear().domain(yDomain).nice().range([height, 0]);
        const zeroY = yScale(0);

        // Zero line
        if (useZeroBaseline) {
            svg.append('line')
                .attr('x1', 0)
                .attr('x2', width)
                .attr('y1', zeroY)
                .attr('y2', zeroY)
                .attr('stroke', '#58a6ff')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '3,3');
        }

        // Baseline
        svg.append('line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', height)
            .attr('y2', height)
            .attr('stroke', '#30363d')
            .attr('stroke-width', 1);

        // Draw bars with invisible hover area for small bars
        top3ByQuarter.forEach((d, i) => {
            const groupWidth = barWidth - 6;
            const individualBarWidth = (groupWidth - 4) / 3;
            const minBarHeight = 8; // Minimum visible bar height

            d.top3.forEach((item, rank) => {
                const barY = yScale(item.return);
                const barBottomY = useZeroBaseline && item.return >= 0 ? zeroY : height;
                const barTopY = useZeroBaseline && item.return < 0 ? zeroY : barY;
                let h = Math.abs(barBottomY - barTopY);
                const xOffset = i * barWidth + 3 + rank * individualBarWidth;

                const sectorIndex = allSectors.indexOf(item.sector);
                const color = sectorColors[sectorIndex % sectorColors.length];

                // Determine text color based on bar brightness
                const isPositive = item.return >= 0;
                const textColor = '#ffffff';

                // Actual bar (with minimum height for visibility)
                const displayHeight = Math.max(h, minBarHeight);
                const displayY = isPositive ? barBottomY - displayHeight : barTopY;

                // Invisible wider hover area for small bars
                const hoverArea = svg.append('rect')
                    .attr('x', xOffset - 1)
                    .attr('y', barTopY)
                    .attr('width', individualBarWidth)
                    .attr('height', Math.max(h, 20)) // At least 20px hover area
                    .attr('fill', 'transparent')
                    .style('cursor', 'pointer')
                    .on('mouseover', function() {
                        showTooltip(event, `<strong>${d.quarter}</strong><br>Rank ${rank + 1}: ${item.sector}<br>Return: <strong>${item.return.toFixed(1)}%</strong>`);
                    })
                    .on('mouseout', hideTooltip);

                // Visible bar
                svg.append('rect')
                    .attr('x', xOffset)
                    .attr('y', displayY)
                    .attr('width', individualBarWidth - 2)
                    .attr('height', displayHeight)
                    .attr('fill', color)
                    .attr('rx', 2)
                    .attr('fill-opacity', 0.9)
                    .attr('stroke', '#30363d')
                    .attr('stroke-width', 0.5)
                    .style('cursor', 'pointer')
                    .on('mouseover', function() {
                        d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2).attr('fill-opacity', 1);
                        showTooltip(event, `<strong>${d.quarter}</strong><br>Rank ${rank + 1}: ${item.sector}<br>Return: <strong>${item.return.toFixed(1)}%</strong>`);
                    })
                    .on('mouseout', function() {
                        d3.select(this).attr('stroke', '#30363d').attr('stroke-width', 0.5).attr('fill-opacity', 0.9);
                        hideTooltip();
                    });

                // Add sector name and return inside bar if tall enough
                if (h > 25) {
                    const fontSize = Math.min(11, h / 3);
                    const line1Y = isPositive ? displayY + fontSize + 4 : displayY + displayHeight - fontSize * 2 - 2;
                    const line2Y = isPositive ? displayY + fontSize * 2 + 8 : displayY + displayHeight - fontSize - 2;

                    // Sector name (abbreviated if needed)
                    const shortName = item.sector.length > 8 && individualBarWidth < 40
                        ? item.sector.substring(0, 6) + '..'
                        : item.sector;

                    svg.append('text')
                        .attr('x', xOffset + (individualBarWidth - 2) / 2)
                        .attr('y', line1Y)
                        .attr('text-anchor', 'middle')
                        .style('fill', textColor)
                        .style('font-size', `${fontSize}px`)
                        .style('font-weight', '600')
                        .style('pointer-events', 'none')
                        .text(shortName);

                    // Return percentage
                    svg.append('text')
                        .attr('x', xOffset + (individualBarWidth - 2) / 2)
                        .attr('y', line2Y)
                        .attr('text-anchor', 'middle')
                        .style('fill', textColor)
                        .style('font-size', `${fontSize - 1}px`)
                        .style('font-weight', '500')
                        .style('pointer-events', 'none')
                        .text(`${item.return.toFixed(0)}%`);
                }

                // Add value label on top of very small bars
                if (h < 25 && h > 0) {
                    svg.append('text')
                        .attr('x', xOffset + (individualBarWidth - 2) / 2)
                        .attr('y', isPositive ? displayY - 5 : displayY + displayHeight + 12)
                        .attr('text-anchor', 'middle')
                        .style('fill', '#8b949e')
                        .style('font-size', '8px')
                        .style('font-weight', '500')
                        .style('pointer-events', 'none')
                        .text(`${item.return.toFixed(0)}%`);
                }
            });

            // Quarter label below bars - rotate if many quarters
            const needRotation = quarters.length > 8;
            const quarterLabel = svg.append('text')
                .attr('x', i * barWidth + barWidth / 2)
                .attr('y', height + 15)
                .attr('text-anchor', 'middle')
                .style('fill', '#8b949e')
                .style('font-size', '9px')
                .style('font-weight', '500')
                .text(d.quarter);

            if (needRotation) {
                quarterLabel
                    .attr('transform', `rotate(-45, ${i * barWidth + barWidth / 2}, ${height + 15})`)
                    .attr('text-anchor', 'end');
            }
        });

        // Y-axis
        svg.append('g')
            .call(d3.axisLeft(yScale).ticks(8))
            .selectAll('text')
            .style('fill', '#8b949e')
            .style('font-size', '10px');

        // Y-axis label
        svg.append('text')
            .attr('x', -40)
            .attr('y', -15)
            .style('fill', '#8b949e')
            .style('font-size', '10px')
            .style('font-weight', '500')
            .text('Return %');

        // Add medallions for top 3 positions
        const legend = svg.append('g').attr('transform', `translate(${width - 140}, -40)`);

        legend.append('text')
            .attr('x', 0)
            .attr('y', 0)
            .style('fill', '#fbbf24')
            .style('font-size', '12px')
            .text('🥇');
        legend.append('text')
            .attr('x', 15)
            .attr('y', 0)
            .style('fill', '#8b949e')
            .style('font-size', '9px')
            .text('1st');

        legend.append('text')
            .attr('x', 40)
            .attr('y', 0)
            .style('fill', '#c0c0c0')
            .style('font-size', '12px')
            .text('🥈');
        legend.append('text')
            .attr('x', 55)
            .attr('y', 0)
            .style('fill', '#8b949e')
            .style('font-size', '9px')
            .text('2nd');

        legend.append('text')
            .attr('x', 80)
            .attr('y', 0)
            .style('fill', '#cd7f32')
            .style('font-size', '12px')
            .text('🥉');
        legend.append('text')
            .attr('x', 95)
            .attr('y', 0)
            .style('fill', '#8b949e')
            .style('font-size', '9px')
            .text('3rd');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RotationTimelineChart;
}
