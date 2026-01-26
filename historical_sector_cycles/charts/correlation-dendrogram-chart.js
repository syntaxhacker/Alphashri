/**
 * Correlation Cluster Dendrogram Chart
 * Visualizes sector relationships using hierarchical clustering
 * Helps identify sector families and diversification opportunities
 */

class CorrelationDendrogramChart {
    constructor(containerId) {
        this.containerId = containerId;
    }

    render(correlations, sectors, currentRange) {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        container.innerHTML = '';

        // Build correlation matrix
        const corrMatrix = this.buildCorrelationMatrix(correlations, sectors);

        // Perform hierarchical clustering
        const clusters = this.hierarchicalClustering(corrMatrix, sectors);

        this.renderDendrogram(container, clusters, corrMatrix, sectors);
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

    hierarchicalClustering(corrMatrix, sectors) {
        // Initialize each sector as its own cluster
        let clusters = sectors.map(s => ({
            sectors: [s],
            height: 0,
            left: null,
            right: null
        }));

        // Store merge history for dendrogram
        const mergeHistory = [];

        // Iteratively merge closest clusters
        while (clusters.length > 1) {
            let minDist = Infinity;
            let mergeI = -1;
            let mergeJ = -1;

            // Find two closest clusters
            for (let i = 0; i < clusters.length; i++) {
                for (let j = i + 1; j < clusters.length; j++) {
                    const dist = this.clusterDistance(clusters[i], clusters[j], corrMatrix);
                    if (dist < minDist) {
                        minDist = dist;
                        mergeI = i;
                        mergeJ = j;
                    }
                }
            }

            if (mergeI === -1) break;

            // Merge clusters
            const newCluster = {
                sectors: [...clusters[mergeI].sectors, ...clusters[mergeJ].sectors],
                height: minDist,
                left: clusters[mergeI],
                right: clusters[mergeJ]
            };

            mergeHistory.push(newCluster);

            // Remove old clusters and add new one
            const newClusters = clusters.filter((_, i) => i !== mergeI && i !== mergeJ);
            newClusters.push(newCluster);
            clusters = newClusters;
        }

        return mergeHistory.length > 0 ? mergeHistory[mergeHistory.length - 1] : null;
    }

    clusterDistance(cluster1, cluster2, corrMatrix) {
        // Use average linkage
        let totalDist = 0;
        let count = 0;

        cluster1.sectors.forEach(s1 => {
            cluster2.sectors.forEach(s2 => {
                // Distance = 1 - correlation (so high correlation = low distance)
                const dist = 1 - Math.abs(corrMatrix[s1][s2]);
                totalDist += dist;
                count++;
            });
        });

        return count > 0 ? totalDist / count : 1;
    }

    renderDendrogram(container, rootCluster, corrMatrix, sectors) {
        if (!rootCluster) {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: #8b949e;">
                    <p style="font-size: 14px;">📊 Unable to build cluster tree</p>
                </div>
            `;
            return;
        }

        let html = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                <div style="color: #58a6ff; font-size: 13px; font-weight: 600; margin-bottom: 10px;">
                    🔗 Sector Correlation Clusters
                </div>
                <div style="color: #8b949e; font-size: 11px; line-height: 1.6;">
                    💡 Sectors closer together move in sync (high correlation)<br>
                    💡 Use for pair trading, diversification, and rotation strategies<br>
                    💡 Sectors in different clusters provide better diversification
                </div>
            </div>
        `;

        // Identify clusters (groups of sectors with high correlation)
        const sectorGroups = this.identifySectorGroups(rootCluster);

        // Render sector groups
        html += `
            <div style="margin-bottom: 20px;">
                <div style="color: #58a6ff; font-size: 12px; font-weight: 600; margin-bottom: 12px;">📊 Sector Families (High Correlation Groups)</div>
                <div style="display: flex; flex-wrap: wrap; gap: 12px;">
        `;

        const colors = ['#388bfd', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#14b8a6'];

        sectorGroups.forEach((group, idx) => {
            const color = colors[idx % colors.length];
            html += `
                <div style="background: ${color}22; border: 1px solid ${color}; border-radius: 8px; padding: 12px;">
                    <div style="color: ${color}; font-size: 11px; font-weight: 600; margin-bottom: 8px;">
                        Group ${idx + 1} (${group.length} sectors)
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${group.map(s => `
                            <span style="background: ${color}; color: #0d1117; padding: 3px 8px; border-radius: 10px; font-size: 10px; cursor: pointer;" onclick="showSectorStocks('${s}')">${s}</span>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        // Render simplified dendrogram as HTML structure
        html += `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px;">
                <div style="color: #58a6ff; font-size: 12px; font-weight: 600; margin-bottom: 15px;">🌳 Cluster Hierarchy</div>
                <div style="max-height: 400px; overflow-y: auto;">
                    ${this.renderClusterTree(rootCluster, 0)}
                </div>
            </div>
        `;

        // Diversification insights
        html += `
            <div style="margin-top: 20px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px;">
                <div style="color: #58a6ff; font-size: 12px; font-weight: 600; margin-bottom: 12px;">💡 Diversification Insights</div>
                ${this.generateDiversificationInsights(sectorGroups, corrMatrix)}
            </div>
        `;

        container.innerHTML = html;
    }

    identifySectorGroups(cluster, minCorrelation = 0.5) {
        const groups = [];
        const visited = new Set();

        const traverse = (node, currentGroup) => {
            if (!node) return;

            if (!node.left && !node.right) {
                // Leaf node (single sector)
                currentGroup.push(node.sectors[0]);
                visited.add(node.sectors[0]);
            } else {
                // Check if this is a tight cluster (low height = high correlation)
                if ((1 - node.height) >= minCorrelation) {
                    const newGroup = [];
                    traverse(node.left, newGroup);
                    traverse(node.right, newGroup);
                    if (newGroup.length > 1) {
                        groups.push(newGroup);
                    }
                } else {
                    traverse(node.left, currentGroup);
                    traverse(node.right, currentGroup);
                }
            }
        };

        traverse(cluster, []);

        // Add remaining unvisited sectors as individual groups
        return groups;
    }

    renderClusterTree(node, depth, maxDepth = 5) {
        if (!node || depth > maxDepth) return '';

        const indent = depth * 20;
        const correlation = 1 - node.height;

        if (!node.left && !node.right) {
            // Leaf node
            return `
                <div style="padding-left: ${indent}px; padding: 4px 0;">
                    <span style="color: #c9d1d9; font-size: 11px;">📁 ${node.sectors[0]}</span>
                </div>
            `;
        }

        // Internal node
        const color = correlation > 0.7 ? '#22c55e' : correlation > 0.4 ? '#f59e0b' : '#ef4444';

        return `
            <div style="padding-left: ${indent}px; padding: 4px 0;">
                <div style="color: ${color}; font-size: 10px; margin-bottom: 4px;">
                    🔗 Correlation: <strong>${correlation.toFixed(2)}</strong> (${node.sectors.length} sectors)
                </div>
                <div style="border-left: 1px solid #30363d; margin-left: 4px;">
                    ${this.renderClusterTree(node.left, depth + 1, maxDepth)}
                    ${this.renderClusterTree(node.right, depth + 1, maxDepth)}
                </div>
            </div>
        `;
    }

    generateDiversificationInsights(groups, corrMatrix) {
        let insights = '<div style="font-size: 11px; color: #8b949e; line-height: 1.8;">';

        if (groups.length >= 2) {
            // Find least correlated groups
            let minInterCorr = Infinity;
            let bestPair = null;

            for (let i = 0; i < groups.length; i++) {
                for (let j = i + 1; j < groups.length; j++) {
                    let totalCorr = 0;
                    let count = 0;

                    groups[i].forEach(s1 => {
                        groups[j].forEach(s2 => {
                            totalCorr += Math.abs(corrMatrix[s1][s2]);
                            count++;
                        });
                    });

                    const avgCorr = count > 0 ? totalCorr / count : 0;
                    if (avgCorr < minInterCorr) {
                        minInterCorr = avgCorr;
                        bestPair = [i, j];
                    }
                }
            }

            if (bestPair && minInterCorr < 0.3) {
                insights += `
                    <div style="margin-bottom: 8px;">
                        ✅ <strong>Best Diversification</strong>: Combine Group ${bestPair[0] + 1} with Group ${bestPair[1] + 1}
                        (correlation: ${minInterCorr.toFixed(2)})
                    </div>
                `;
            }
        }

        insights += `
            <div style="margin-top: 8px; padding: 8px; background: #21262d; border-radius: 4px;">
                💡 <strong>Tip</strong>: For diversification, pick sectors from different groups.
                For momentum strategies, focus on the strongest group.
            </div>
        `;

        insights += '</div>';
        return insights;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CorrelationDendrogramChart;
}
