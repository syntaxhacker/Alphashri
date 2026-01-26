/**
 * Dashboard Chart Utilities
 * Common functions used across all charts
 */

class ChartUtils {
    /**
     * Create SVG with common setup
     */
    static createSVG(containerId, margin = { top: 20, right: 20, bottom: 40, left: 60 }) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Container ${containerId} not found`);
            return null;
        }

        container.innerHTML = '';

        const width = container.clientWidth - margin.left - margin.right;
        const height = container.clientHeight - margin.top - margin.bottom;

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        return { svg, width, height, container };
    }

    /**
     * Add title to chart showing the current range
     */
    static addTitle(svg, width, currentRange, icon = '📊') {
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', -25)
            .attr('text-anchor', 'middle')
            .style('fill', '#58a6ff')
            .style('font-size', '12px')
            .style('font-weight', 'bold')
            .text(`${icon} Period: ${currentRange.toUpperCase()}`);
    }

    /**
     * Add subtitle to explain the chart
     */
    static addSubtitle(svg, width, text, yPos = -5) {
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', yPos)
            .attr('text-anchor', 'middle')
            .style('fill', '#8b949e')
            .style('font-size', '10px')
            .text(text);
    }

    /**
     * Add zero line to chart
     */
    static addZeroLine(svg, width, zeroY, dashed = false) {
        svg.append('line')
            .attr('class', 'zero-line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', zeroY)
            .attr('y2', zeroY)
            .attr('stroke-dasharray', dashed ? '3,3' : null);
    }

    /**
     * Add X and Y axes
     */
    static addAxes(svg, xScale, yScale, height, rotateXLabels = false) {
        const xAxis = svg.append('g')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(xScale));

        if (rotateXLabels) {
            xAxis.selectAll('text')
                .attr('transform', 'rotate(-45)')
                .style('text-anchor', 'end');
        }

        svg.append('g').call(d3.axisLeft(yScale).ticks(8));
    }

    /**
     * Create tooltip content for momentum data
     */
    static createMomentumTooltip(d, title = d.sector) {
        return `<strong>${title}</strong><br>Last 1M: ${d.m1.toFixed(1)}%<br>Last 3M: ${d.m3.toFixed(1)}%<br>Last 6M: ${d.m6.toFixed(1)}%<br>Period Total: ${d.total.toFixed(1)}%`;
    }

    /**
     * Setup common bar styles
     */
    static setupBarStyle(selection) {
        selection
            .attr('class', 'bar')
            .attr('rx', 4)
            .style('cursor', 'pointer');
    }

    /**
     * Create legend with color items
     */
    static createLegend(parent, items, x, y) {
        const legend = parent.append('g').attr('transform', `translate(${x}, ${y})`);

        items.forEach((item, i) => {
            const itemY = i * 20;

            legend.append('rect')
                .attr('y', itemY)
                .attr('width', 12)
                .attr('height', 12)
                .attr('fill', item.color)
                .attr('rx', 2);

            legend.append('text')
                .attr('x', 18)
                .attr('y', itemY + 10)
                .style('fill', '#8b949e')
                .style('font-size', '10px')
                .text(item.label);
        });

        return legend;
    }

    /**
     * Format percentage with sign
     */
    static formatPercent(value, decimals = 1) {
        const sign = value >= 0 ? '+' : '';
        return sign + value.toFixed(decimals) + '%';
    }

    /**
     * Get color based on value (positive/negative)
     */
    static getValueColor(value, positiveColor, negativeColor = '#f85149') {
        return value >= 0 ? positiveColor : negativeColor;
    }
}

/**
 * Global tooltip functions
 */
function showTooltip(event, html) {
    const tooltip = d3.select('#tooltip');
    tooltip.classed('visible', true)
        .style('left', (event.pageX + 12) + 'px')
        .style('top', (event.pageY - 12) + 'px')
        .html(html);
}

function hideTooltip() {
    d3.select('#tooltip').classed('visible', false);
}

// Export for browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChartUtils;
}
