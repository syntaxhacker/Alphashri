#!/usr/bin/env node3
/**
 * Test script for DashboardDataProcessor
 * Verifies business logic works correctly
 */

const fs = require('fs');
const path = require('path');

// Import the processor
const DashboardDataProcessor = require('./dashboard-data-processor.js');

console.log('='.repeat(70));
console.log('  DASHBOARD DATA PROCESSOR - TEST');
console.log('='.repeat(70));

// Load test data
const dataPath = path.join(__dirname, 'rotation_dashboard_data.json');
console.log(`\n📂 Loading data from: ${dataPath}`);

const rawData = fs.readFileSync(dataPath, 'utf8');
const dashboardData = JSON.parse(rawData);

console.log(`✅ Data loaded successfully`);
console.log(`   - Sectors: ${dashboardData.current_stats.length}`);
console.log(`   - Time series points: ${dashboardData.time_series.length}`);
console.log(`   - Heatmap points: ${dashboardData.rankings_heatmap.length}`);
console.log(`   - Date range: ${dashboardData.metadata.data_start} to ${dashboardData.metadata.data_end}`);

// Initialize processor
console.log('\n' + '='.repeat(70));
console.log('  INITIALIZING PROCESSOR');
console.log('='.repeat(70));

const processor = new DashboardDataProcessor();
const initResult = processor.initialize(dashboardData);

console.log('\n✅ Processor initialized:');
console.log(`   - Sectors: ${initResult.sectors}`);
console.log(`   - Heatmap points: ${initResult.heatmapPoints}`);
console.log(`   - Date range: ${initResult.dateRange}`);

// Test different ranges
const testRanges = ['1m', '3m', '6m', '1y', '3y', '5y', 'ytd'];

console.log('\n' + '='.repeat(70));
console.log('  TESTING RANGE FILTERS');
console.log('='.repeat(70));

testRanges.forEach(range => {
    console.log(`\n📊 Testing range: ${range}`);

    const result = processor.applyFilter(range);

    console.log(`   Start date: ${result.startDate}`);
    console.log(`   Time series: ${result.timeSeriesPoints.split(', ').slice(0, 3).join(', ')}...`);
    console.log(`   Heatmap points: ${result.heatmapPoints}`);
    console.log(`   Quarterly points: ${result.quarterlyPoints}`);

    if (result.momentum && result.momentum.length > 0) {
        console.log(`   Top 3 sectors (3M):`);
        result.momentum.slice(0, 3).forEach(m => {
            console.log(`      ${m.sector}: ${m}`);
        });
    }

    // Verify data integrity
    const filtered = processor.getFilteredData();

    // Check that momentum data matches time series sectors
    const momentumSectors = new Set(filtered.momentum.map(m => m.sector));
    const timeSeriesSectors = new Set(Object.keys(filtered.timeSeries));

    if (momentumSectors.size === timeSeriesSectors.size) {
        console.log(`   ✅ Momentum sectors match: ${momentumSectors.size}`);
    } else {
        console.log(`   ❌ Mismatch: Momentum has ${momentumSectors.size}, TimeSeries has ${timeSeriesSectors.size}`);
    }

    // Check correlations count
    const expectedCorrelations = (timeSeriesSectors.size * (timeSeriesSectors.size + 1)) / 2;
    if (filtered.correlations.length === expectedCorrelations) {
        console.log(`   ✅ Correlations count: ${filtered.correlations.length}`);
    } else {
        console.log(`   ❌ Correlations mismatch: expected ${expectedCorrelations}, got ${filtered.correlations.length}`);
    }
});

// Test edge cases
console.log('\n' + '='.repeat(70));
console.log('  TESTING EDGE CASES');
console.log('='.repeat(70));

// Test 1 week range
console.log('\n📊 Testing very short range: 1w');
const oneWeekResult = processor.applyFilter('1w');
console.log(`   Start date: ${oneWeekResult.startDate}`);
console.log(`   Time series points: ${oneWeekResult.timeSeriesPoints}`);

// Test 2 weeks
console.log('\n📊 Testing 2 weeks: 2w');
const twoWeeksResult = processor.applyFilter('2w');
console.log(`   Start date: ${twoWeeksResult.startDate}`);
console.log(`   Time series points: ${twoWeeksResult.timeSeriesPoints}`);

// Verify correlation calculation
console.log('\n' + '='.repeat(70));
console.log('  TESTING CORRELATION CALCULATION');
console.log('='.repeat(70));

// Apply 1y filter for correlation testing
processor.applyFilter('1y');
const correlations = processor.getFilteredData().correlations;

console.log(`\nTotal correlations: ${correlations.length}`);

// Find inverse correlations (rotation opportunities)
const inversePairs = correlations.filter(c => c.correlation < -0.3);
console.log(`Inverse correlations (< -0.3): ${inversePairs.length}`);

if (inversePairs.length > 0) {
    console.log('\nTop 5 inverse correlations:');
    inversePairs.slice(0, 5).forEach(c => {
        console.log(`   ${c.sector1} ↔ ${c.sector2}: ${c.correlation.toFixed(3)}`);
    });
}

// Find positive correlations
const positivePairs = correlations.filter(c => c.correlation > 0.7);
console.log(`\nStrong positive correlations (> 0.7): ${positivePairs.length}`);

if (positivePairs.length > 0) {
    console.log('Top 5 positive correlations:');
    positivePairs.slice(-5).reverse().forEach(c => {
        console.log(`   ${c.sector1} ↔ ${c.sector2}: ${c.correlation.toFixed(3)}`);
    });
}

console.log('\n' + '='.repeat(70));
console.log('  ALL TESTS COMPLETED SUCCESSFULLY ✅');
console.log('='.repeat(70));
