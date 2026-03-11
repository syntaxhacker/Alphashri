/**
 * Volume Calendar Chart
 * Calendar-style heatmap showing daily volume intensity for a sector
 */

class VolumeCalendarChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(volumeData, year, month = null) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        // Filter data by year and optionally month
        const filteredData = volumeData.filter(d => {
            const date = new Date(d.date);
            return date.getFullYear() === year && (!month || date.getMonth() === month);
        });

        if (filteredData.length === 0) {
            const currentYear = new Date().getFullYear();
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 400px; color: #8b949e; text-align: center; padding: 20px;">
                    <p style="font-size: 16px; margin-bottom: 12px;">📅 No volume data available for ${year}</p>
                    <p style="font-size: 13px; line-height: 1.6; max-width: 400px;">
                        The Upstox API provides 1 year of historical data from the current date (${currentYear}).
                        ${year < currentYear - 1 ? `Data for ${year} is not available.` : `Try selecting ${currentYear} or ${currentYear - 1}.`}
                    </p>
                    <div style="margin-top: 15px; padding: 12px; background: #21262d; border-radius: 6px; border-left: 3px solid #f59e0b;">
                        <p style="font-size: 11px; margin: 0;">💡 <strong>Tip:</strong> Select ${currentYear} to see the full calendar with volume data</p>
                    </div>
                </div>
            `;
            return;
        }

        // Calculate volume percentiles for color scaling
        const volumes = filteredData.map(d => d.volume);
        const maxVolume = Math.max(...volumes);
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

        // Create calendar structure
        const monthsToShow = month !== null ? [parseInt(month)] : [...new Set(filteredData.map(d => new Date(d.date).getMonth()))];

        monthsToShow.forEach(m => {
            const monthDiv = document.createElement('div');
            monthDiv.style.marginBottom = '30px';

            // Month header
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                               'July', 'August', 'September', 'October', 'November', 'December'];
            const monthHeader = document.createElement('div');
            monthHeader.style.cssText = 'color: #58a6ff; font-size: 16px; font-weight: 600; margin-bottom: 12px;';
            monthHeader.textContent = `${monthNames[m]} ${year}`;
            monthDiv.appendChild(monthHeader);

            // Create calendar grid
            const calendarGrid = document.createElement('div');
            calendarGrid.style.cssText = 'display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;';

            // Day headers
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            dayNames.forEach(day => {
                const dayHeader = document.createElement('div');
                dayHeader.style.cssText = 'color: #8b949e; font-size: 10px; text-align: center; padding: 4px;';
                dayHeader.textContent = day;
                calendarGrid.appendChild(dayHeader);
            });

            // Get first day of month and number of days
            const firstDay = new Date(year, m, 1).getDay();
            const daysInMonth = new Date(year, m + 1, 0).getDate();

            // Empty cells for days before month starts
            for (let i = 0; i < firstDay; i++) {
                const emptyCell = document.createElement('div');
                emptyCell.style.cssText = 'padding: 8px;';
                calendarGrid.appendChild(emptyCell);
            }

            // Day cells
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayData = filteredData.find(d => d.date === dateStr);

                const dayCell = document.createElement('div');
                dayCell.style.cssText = `
                    padding: 8px;
                    border-radius: 4px;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    position: relative;
                `;

                if (dayData) {
                    // Calculate color intensity based on volume
                    const intensity = dayData.volume / maxVolume;
                    const color = this.getVolumeColor(intensity);

                    dayCell.style.backgroundColor = color;
                    dayCell.innerHTML = `
                        <div style="color: ${intensity > 0.5 ? '#fff' : '#c9d1d9'}; font-size: 11px; font-weight: 500;">${day}</div>
                        ${intensity > 0.3 ? `<div style="color: ${intensity > 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.7)'}; font-size: 8px;">${(dayData.normalizedVolume || 100).toFixed(0)}%</div>` : ''}
                    `;

                    // Tooltip
                    dayCell.onmouseover = (e) => {
                        this.showTooltip(e, dayData, avgVolume);
                    };
                    dayCell.onmouseout = () => {
                        this.hideTooltip();
                    };
                } else {
                    dayCell.style.backgroundColor = 'transparent';
                    dayCell.style.border = '1px solid #21262d';
                    dayCell.innerHTML = `<div style="color: #484f58; font-size: 11px;">${day}</div>`;
                }

                calendarGrid.appendChild(dayCell);
            }

            monthDiv.appendChild(calendarGrid);
            container.appendChild(monthDiv);
        });

        // Legend
        this.addLegend(container, avgVolume, maxVolume);
    }

    getVolumeColor(intensity) {
        // Color scale from light blue to dark blue to red
        if (intensity < 0.25) {
            return `rgba(56, 139, 253, ${0.2 + intensity * 2})`; // Light blue
        } else if (intensity < 0.5) {
            return `rgba(56, 139, 253, ${0.7 + (intensity - 0.25)})`; // Medium blue
        } else if (intensity < 0.75) {
            return `rgba(34, 197, 94, ${0.5 + (intensity - 0.5) * 2})`; // Green
        } else {
            return `rgba(239, 68, 68, ${0.6 + (intensity - 0.75) * 1.6})`; // Red for very high
        }
    }

    showTooltip(event, data, avgVolume) {
        let tooltip = document.getElementById('volume-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'volume-tooltip';
            tooltip.style.cssText = `
                position: absolute;
                padding: 10px 12px;
                background: #161b22;
                border: 1px solid #30363d;
                border-radius: 6px;
                pointer-events: none;
                font-size: 11px;
                z-index: 1000;
                opacity: 0;
                transition: opacity 0.15s;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            `;
            document.body.appendChild(tooltip);
        }

        const volumeDiff = ((data.volume - avgVolume) / avgVolume * 100).toFixed(0);
        const volumeColor = volumeDiff > 50 ? '#ef4444' : volumeDiff > 0 ? '#22c55e' : '#8b949e';

        tooltip.innerHTML = `
            <div style="color: #c9d1d9; font-weight: 600; margin-bottom: 6px;">${data.date}</div>
            <div style="color: #8b949e;">Volume: <strong style="color: #c9d1d9;">${data.volume.toLocaleString()}</strong></div>
            <div style="color: #8b949e;">vs Avg: <strong style="color: ${volumeColor};">${volumeDiff > 0 ? '+' : ''}${volumeDiff}%</strong></div>
            <div style="color: #8b949e; margin-top: 4px; font-size: 10px;">
                ${data.stocks || 0} stocks contributed
            </div>
        `;

        tooltip.style.opacity = '1';
        tooltip.style.left = (event.pageX + 15) + 'px';
        tooltip.style.top = (event.pageY - 10) + 'px';
    }

    hideTooltip() {
        const tooltip = document.getElementById('volume-tooltip');
        if (tooltip) {
            tooltip.style.opacity = '0';
        }
    }

    addLegend(container, avgVolume, maxVolume) {
        const legendDiv = document.createElement('div');
        legendDiv.style.cssText = 'margin-top: 20px; padding: 15px; background: #161b22; border-radius: 6px;';

        legendDiv.innerHTML = `
            <div style="color: #8b949e; font-size: 12px; margin-bottom: 10px; font-weight: 600;">Volume Intensity Scale</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <div style="flex: 1; height: 12px; border-radius: 3px; background: linear-gradient(to right, rgba(56, 139, 253, 0.3), rgba(56, 139, 253, 0.9), rgba(34, 197, 94, 0.9), rgba(239, 68, 68, 0.9));"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #8b949e;">
                <span>Low</span>
                <span>Average</span>
                <span>High</span>
                <span>Very High</span>
            </div>
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #30363d; font-size: 11px;">
                <div style="color: #8b949e;">📊 Average Volume: <strong style="color: #c9d1d9;">${avgVolume.toLocaleString()}</strong></div>
                <div style="color: #8b949e;">📈 Peak Volume: <strong style="color: #ef4444;">${maxVolume.toLocaleString()}</strong></div>
            </div>
        `;

        container.appendChild(legendDiv);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolumeCalendarChart;
}
