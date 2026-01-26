/**
 * Rotation Pairs Chart
 * Bar chart showing inverse correlations (rotation opportunities)
 */

class RotationPairsChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(correlations, momentumData) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        const inversePairs = correlations.filter(c => c.correlation < -0.2).sort((a, b) => a.correlation);

        if (inversePairs.length === 0) {
            const svg = d3.select(`#${this.containerId}`)
                .append('svg')
                .attr('width', container.clientWidth)
                .attr('height', container.clientHeight);

            svg.append('text')
                .attr('x', container.clientWidth / 2)
                .attr('y', container.clientHeight / 2)
                .attr('text-anchor', 'middle')
                .style('fill', '#8b949e')
                .style('font-size', '14px')
                .text('No inverse correlations found in this time period.');
            return;
        }

        const margin = { top: 40, right: 15, bottom: 15, left: 120 };
        const width = container.clientWidth - margin.left - margin.right;
        const height = container.clientHeight - margin.top - margin.bottom;

        const svg = d3.select(`#${this.containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Subtitle explaining the chart
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', -25)
            .attr('text-anchor', 'middle')
            .style('fill', '#8b949e')
            .style('font-size', '10px')
            .text('💡 Sectors that move in OPPOSITE directions • Use to: rotate money, pair trade (long one/short other), or hedge risk');

        const y = d3.scaleBand().domain(inversePairs.map(p => `${p.sector1} ↔ ${p.sector2}`)).range([0, height]).padding(0.3);
        const x = d3.scaleLinear().domain([-1, 0]).range([0, width]);

        svg.selectAll('.bar').data(inversePairs).enter().append('rect')
            .attr('class', 'bar')
            .attr('x', d => x(d.correlation))
            .attr('y', d => y(`${d.sector1} ↔ ${d.sector2}`))
            .attr('width', d => x(0) - x(d.correlation))
            .attr('height', y.bandwidth())
            .attr('fill', '#f85149')
            .attr('rx', 4)
            .on('mouseover', (event, d) => {
                const m1 = momentumData.find(m => m.sector === d.sector1);
                const m2 = momentumData.find(m => m.sector === d.sector2);
                showTooltip(event, `<strong>${d.sector1}</strong>: ${m1 ? m1.m3.toFixed(1) : 'N/A'}%<br><strong>${d.sector2}</strong>: ${m2 ? m2.m3.toFixed(1) : 'N/A'}%`);
            })
            .on('mouseout', hideTooltip);

        svg.append('g').call(d3.axisLeft(y)).selectAll('text').style('font-size', '10px');
        svg.append('g').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x).ticks(5));
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RotationPairsChart;
}
