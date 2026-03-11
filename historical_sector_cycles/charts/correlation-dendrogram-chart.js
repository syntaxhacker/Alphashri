/**
 * Correlation Cluster Network Chart (ECharts)
 * Interactive force-directed graph showing sector families
 * Sectors with high correlation cluster together
 */

class CorrelationDendrogramChart {
    constructor(containerId) {
        this.containerId = containerId;
        this.chart = null;
        this.resizeHandler = null;
    }

    render(correlations, sectors, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        console.log('CorrelationDendrogramChart.render called with:', {
            correlationsCount: correlations?.length,
            sectorsCount: sectors?.length,
            currentRange
        });

        // Dispose existing chart
        if (this.chart) {
            this.chart.dispose();
        }

        // Initialize chart
        this.chart = echarts.init(container, null, {
            renderer: 'canvas',
            useDirtyRect: true
        });

        // Build correlation matrix
        const corrMatrix = this.buildCorrelationMatrix(correlations, sectors);

        // Identify sector families (high correlation groups)
        const sectorFamilies = this.identifySectorFamilies(corrMatrix, sectors);

        console.log('Sector families:', sectorFamilies.map(f => ({ size: f.length, sectors: f })));

        // Create network graph data
        const { nodes, links } = this.createNetworkData(corrMatrix, sectorFamilies);

        console.log('Network data:', { nodesCount: nodes.length, linksCount: links.length });

        // Color palette for families
        const familyColors = [
            '#388bfd', // Blue
            '#8b5cf6', // Purple
            '#ec4899', // Pink
            '#f59e0b', // Orange
            '#22c55e', // Green
            '#14b8a6', // Teal
            '#ef4444', // Red
            '#06b6d4'  // Cyan
        ];

        // Assign colors to nodes based on family
        const nodeColors = nodes.map(node => {
            const familyIndex = sectorFamilies.findIndex(family =>
                family.some(s => s.name === node.name)
            );
            return familyColors[familyIndex % familyColors.length];
        });

        // Create circular layout positions
        const radius = 150;
        const angleStep = (2 * Math.PI) / nodes.length;
        nodes.forEach((node, i) => {
            node.x = Math.cos(i * angleStep) * radius;
            node.y = Math.sin(i * angleStep) * radius;
            node.fixed = true; // Fix positions for circular layout
        });

        const option = {
            animation: true,
            animationDuration: 1000,
            animationEasing: 'cubicOut',

            title: {
                text: '🔗 Sector Families (High Correlation Groups)',
                left: 'center',
                top: 10,
                textStyle: {
                    color: '#58a6ff',
                    fontSize: 14,
                    fontWeight: 'bold'
                }
            },

            tooltip: {
                backgroundColor: '#161b22',
                borderColor: '#30363d',
                textStyle: {
                    color: '#c9d1d9',
                    fontSize: 11
                },
                formatter: function(params) {
                    if (params.dataType === 'node') {
                        const data = params.data;
                        const family = data.family || 'Independent';
                        return `
                            <div style="padding: 8px;">
                                <div style="color: #58a6ff; font-weight: 600; margin-bottom: 6px;">${data.name}</div>
                                <div style="font-size: 10px; color: #8b949e;">
                                    <div>Family: <strong style="color: ${nodeColors[params.dataIndex]};">${family}</strong></div>
                                    <div>Connections: <strong>${data.value}</strong></div>
                                </div>
                            </div>
                        `;
                    } else if (params.dataType === 'edge') {
                        const source = nodes[params.data.source].name;
                        const target = nodes[params.data.target].name;
                        const correlation = params.data.value;
                        const color = correlation > 0.7 ? '#22c55e' :
                                      correlation > 0.4 ? '#f59e0b' : '#ef4444';
                        return `
                            <div style="padding: 8px;">
                                <div style="color: #58a6ff; font-weight: 600; margin-bottom: 6px;">
                                    ${source} ↔ ${target}
                                </div>
                                <div style="font-size: 10px; color: #8b949e;">
                                    Correlation: <strong style="color: ${color};">${correlation.toFixed(2)}</strong>
                                </div>
                            </div>
                        `;
                    }
                }
            },

            legend: {
                show: true,
                data: sectorFamilies.map((family, i) => `Family ${i + 1}`),
                top: 40,
                textStyle: {
                    color: '#8b949e',
                    fontSize: 10
                },
                selectedMode: false
            },

            series: [{
                type: 'graph',
                layout: 'none', // Use fixed positions instead of force
                data: nodes.map((node, i) => ({
                    ...node,
                    itemStyle: {
                        color: nodeColors[i],
                        borderColor: '#fff',
                        borderWidth: 2
                    },
                    label: {
                        show: true,
                        position: 'right',
                        formatter: '{b}',
                        fontSize: 10,
                        color: '#c9d1d9'
                    }
                })),
                links: links.map(link => ({
                    ...link,
                    lineStyle: {
                        color: link.value > 0.7 ? '#22c55e' :
                               link.value > 0.4 ? '#f59e0b' : '#ef4444',
                        width: Math.max(1, link.value * 4),
                        opacity: 0.6,
                        curveness: 0.2
                    }
                })),
                roam: true,
                draggable: true,
                focusNodeAdjacency: true,
                itemStyle: {
                    borderColor: '#fff',
                    borderWidth: 1,
                    shadowColor: 'rgba(0, 0, 0, 0.3)',
                    shadowBlur: 10
                },
                lineStyle: {
                    opacity: 0.4,
                    curveness: 0.3
                },
                label: {
                    show: true,
                    fontSize: 10,
                    color: '#c9d1d9'
                },
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: {
                        width: 3,
                        opacity: 1
                    },
                    itemStyle: {
                        shadowColor: 'rgba(88, 166, 255, 0.8)',
                        shadowBlur: 20,
                        borderWidth: 3
                    }
                }
            }]
        };

        this.chart.setOption(option, { notMerge: true });

        // Force a resize after a short delay
        setTimeout(() => {
            if (this.chart) {
                this.chart.resize();
            }
        }, 100);

        // Add legend for families below chart
        this.addFamilyLegend(container, sectorFamilies, familyColors, corrMatrix);

        // Handle resize
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }

        this.resizeHandler = () => {
            if (this.chart) {
                this.chart.resize();
            }
        };

        window.addEventListener('resize', this.resizeHandler);
    }

    buildCorrelationMatrix(correlations, sectors) {
        const matrix = {};
        sectors.forEach(s1 => {
            matrix[s1] = {};
            sectors.forEach(s2 => {
                if (s1 === s2) {
                    matrix[s1][s2] = 1.0;
                } else {
                    const corr = correlations.find(c =>
                        (c.sector1 === s1 && c.sector2 === s2) ||
                        (c.sector1 === s2 && c.sector2 === s1)
                    );
                    matrix[s1][s2] = corr ? corr.correlation : 0;
                }
            });
        });
        return matrix;
    }

    identifySectorFamilies(corrMatrix, sectors, minCorrelation = 0.5) {
        const families = [];
        const visited = new Set();

        sectors.forEach(sector => {
            if (visited.has(sector)) return;

            const family = [sector];
            visited.add(sector);

            // Find highly correlated sectors
            sectors.forEach(otherSector => {
                if (sector !== otherSector && !visited.has(otherSector)) {
                    const correlation = Math.abs(corrMatrix[sector][otherSector]);
                    if (correlation >= minCorrelation) {
                        family.push(otherSector);
                        visited.add(otherSector);
                    }
                }
            });

            // Sort family by internal correlation strength
            if (family.length > 1) {
                family.sort((a, b) => {
                    const avgCorrA = this.getAvgFamilyCorrelation(a, family, corrMatrix);
                    const avgCorrB = this.getAvgFamilyCorrelation(b, family, corrMatrix);
                    return avgCorrB - avgCorrA;
                });
            }

            families.push(family);
        });

        // Sort families by size (largest first)
        return families.sort((a, b) => b.length - a.length);
    }

    getAvgFamilyCorrelation(sector, family, corrMatrix) {
        let total = 0;
        let count = 0;

        family.forEach(other => {
            if (sector !== other) {
                total += Math.abs(corrMatrix[sector][other]);
                count++;
            }
        });

        return count > 0 ? total / count : 0;
    }

    createNetworkData(corrMatrix, sectorFamilies) {
        const nodes = [];
        const links = [];
        const minCorrelation = 0.3; // Only show edges above this threshold

        const sectors = Object.keys(corrMatrix);

        // Create nodes
        sectors.forEach((sector, i) => {
            const familyIndex = sectorFamilies.findIndex(family =>
                family.includes(sector)
            );

            // Count strong connections
            let connections = 0;
            sectors.forEach(other => {
                if (sector !== other && Math.abs(corrMatrix[sector][other]) > minCorrelation) {
                    connections++;
                }
            });

            nodes.push({
                id: i,
                name: sector,
                value: connections,
                symbolSize: Math.max(20, Math.min(50, connections * 5 + 20)),
                family: familyIndex >= 0 ? `Family ${familyIndex + 1}` : 'Independent',
                familyIndex: familyIndex,
                category: familyIndex
            });
        });

        // Create links (only show significant correlations)
        for (let i = 0; i < sectors.length; i++) {
            for (let j = i + 1; j < sectors.length; j++) {
                const correlation = Math.abs(corrMatrix[sectors[i]][sectors[j]]);
                if (correlation >= minCorrelation) {
                    links.push({
                        source: i,
                        target: j,
                        value: correlation,
                        lineStyle: {
                            width: correlation * 3
                        }
                    });
                }
            }
        }

        return { nodes, links };
    }

    addFamilyLegend(container, sectorFamilies, familyColors, corrMatrix) {
        // Remove existing legend
        const existingLegend = container.querySelector('.family-legend');
        if (existingLegend) {
            existingLegend.remove();
        }

        const legend = document.createElement('div');
        legend.className = 'family-legend';
        legend.style.cssText = `
            margin-top: 20px;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 15px;
        `;

        let html = `
            <div style="color: #58a6ff; font-size: 12px; font-weight: 600; margin-bottom: 12px;">
                📊 Sector Families Details
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;">
        `;

        sectorFamilies.forEach((family, idx) => {
            if (family.length === 0) return;

            const color = familyColors[idx % familyColors.length];

            // Calculate family internal correlation
            const internalCorr = this.calculateFamilyInternalCorrelation(family, corrMatrix);

            html += `
                <div style="background: ${color}11; border: 1px solid ${color}44; border-radius: 6px; padding: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="color: ${color}; font-size: 11px; font-weight: 600;">
                            Family ${idx + 1}
                        </div>
                        <div style="color: #8b949e; font-size: 10px;">
                            ${family.length} sectors • Avg corr: <strong style="color: ${internalCorr > 0.5 ? '#22c55e' : '#f59e0b'};">${internalCorr.toFixed(2)}</strong>
                        </div>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${family.map(s => `
                            <span style="
                                background: ${color}22;
                                color: ${color};
                                border: 1px solid ${color}44;
                                padding: 3px 8px;
                                border-radius: 10px;
                                font-size: 10px;
                                cursor: pointer;
                                transition: all 0.2s;
                            " onmouseover="this.style.background='${color}44'" onmouseout="this.style.background='${color}22'" onclick="showSectorStocks('${s}')">${s}</span>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        html += `
            </div>
            <div style="margin-top: 12px; padding: 10px; background: #21262d; border-radius: 6px;">
                <div style="color: #8b949e; font-size: 10px; line-height: 1.6;">
                    💡 <strong>Interpretation</strong>: Sectors in the same family move together (high correlation)<br>
                    💡 <strong>Diversification</strong>: Pick sectors from different families to reduce risk<br>
                    💡 <strong>Momentum</strong>: Focus on strongest family for sector rotation plays<br>
                    💡 <strong>Thick lines</strong> = High correlation (>0.7), <strong>Thin lines</strong> = Lower correlation
                </div>
            </div>
        `;

        legend.innerHTML = html;
        container.appendChild(legend);
    }

    calculateFamilyInternalCorrelation(family, corrMatrix) {
        if (family.length < 2) return 0;

        let total = 0;
        let count = 0;

        for (let i = 0; i < family.length; i++) {
            for (let j = i + 1; j < family.length; j++) {
                total += Math.abs(corrMatrix[family[i]][family[j]]);
                count++;
            }
        }

        return count > 0 ? total / count : 0;
    }

    dispose() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        if (this.chart) {
            this.chart.dispose();
            this.chart = null;
        }

        // Remove legend
        const container = document.getElementById(this.containerId);
        if (container) {
            const legend = container.querySelector('.family-legend');
            if (legend) {
                legend.remove();
            }
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CorrelationDendrogramChart;
}
