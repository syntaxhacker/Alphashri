/**
 * Timeline Chart
 * Line chart showing all sectors' performance over time
 */

class TimelineChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(timeSeriesData, sectorColors, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        const margin = { top: 60, right: 150, bottom: 50, left: 60 };
        const width = container.clientWidth - margin.left - margin.right;
        const height = container.clientHeight - margin.top - margin.bottom;

        const svg = d3.select(`#${this.containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        const sectors = Object.keys(timeSeriesData);
        const allData = [];

        sectors.forEach((sector, i) => {
            timeSeriesData[sector].forEach(d => {
                allData.push({ date: d.date, value: d.value, sector: sector });
            });
        });

        const x = d3.scaleTime().domain(d3.extent(allData, d => d.date)).range([0, width]);
        const y = d3.scaleLinear().domain(d3.extent(allData, d => d.value)).nice().range([height, 0]);
        const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);

        // Title showing date range
        const allDates = Object.values(timeSeriesData).flatMap(d => d.map(x => x.date));
        const minDate = d3.min(allDates);
        const maxDate = d3.max(allDates);
        const dateRangeText = `${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`;

        svg.append('text')
            .attr('x', width / 2)
            .attr('y', -40)
            .attr('text-anchor', 'middle')
            .style('fill', '#58a6ff')
            .style('font-size', '12px')
            .style('font-weight', 'bold')
            .text(`📅 ${dateRangeText} (${currentRange.toUpperCase()})`);

        // Subtitle explaining the chart
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', -20)
            .attr('text-anchor', 'middle')
            .style('fill', '#8b949e')
            .style('font-size', '10px')
            .text('💡 Track sector performance over time • Line going up = gaining value • Compare sectors to spot trends');

        // Grid
        svg.selectAll('.grid-line').data(y.ticks(8)).enter()
            .append('line').attr('class', 'grid-line')
            .attr('x1', 0).attr('x2', width)
            .attr('y1', d => y(d)).attr('y2', d => y(d));

        // Zero line
        svg.append('line').attr('class', 'zero-line')
            .attr('x1', 0).attr('x2', width)
            .attr('y1', y(0)).attr('y2', y(0));

        // Collect label positions to avoid collision
        const labelPositions = [];

        // Lines for each sector
        sectors.forEach((sector, i) => {
            const sectorData = timeSeriesData[sector];
            svg.append('path').datum(sectorData)
                .attr('class', 'line')
                .attr('d', line)
                .attr('stroke', sectorColors[i % sectorColors.length])
                .style('opacity', 0.8);

            const last = sectorData[sectorData.length - 1];
            let labelY = y(last.value);

            // Adjust label position to avoid collision
            let adjusted = false;
            let offset = 0;
            const maxOffset = 12;

            while (!adjusted && offset < maxOffset) {
                let collision = false;
                for (const pos of labelPositions) {
                    if (Math.abs(pos - labelY) < 12) {
                        collision = true;
                        break;
                    }
                }

                if (!collision) {
                    labelPositions.push(labelY);
                    adjusted = true;
                } else {
                    // Try adjusting position
                    labelY += (offset % 2 === 0 ? 1 : -1) * Math.ceil(offset / 2) * 12;
                    offset++;
                }
            }

            svg.append('text')
                .attr('x', width + 5)
                .attr('y', labelY)
                .attr('dy', '0.35em')
                .style('fill', sectorColors[i % sectorColors.length])
                .style('font-size', '9px')
                .style('font-weight', '500')
                .text(`${sector}: ${last.value.toFixed(0)}%`);
        });

        svg.append('g').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x).ticks(width / 80));
        svg.append('g').call(d3.axisLeft(y).ticks(8));
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimelineChart;
}
