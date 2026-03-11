# Dashboard Modular Architecture

## Overview
The sector rotation dashboard has been refactored into separate, testable modules:

```
historical_sector_cycles/
├── dashboard-data-processor.js     # Business logic (pure JS, no DOM)
├── dashboard-ui.js                  # UI controller (orchestrates charts)
├── dashboard-modular.html           # New modular dashboard
├── test-processor.js                # Node.js tests for business logic
└── charts/                          # Individual chart modules
    ├── performance-chart.js
    ├── momentum-chart.js
    ├── timeline-chart.js
    ├── rotation-heatmap.js
    ├── rotation-timeline-chart.js
    ├── correlation-chart.js
    ├── rotation-pairs-chart.js
    └── momentum-detail-chart.js
```

## Module Descriptions

### 1. `dashboard-data-processor.js` (Business Logic)
**Pure JavaScript** - No DOM dependencies, runs in Node.js or browser.

**Class: `DashboardDataProcessor`**
- `initialize(dashboardData)` - Load and structure raw data
- `calculateStartDate(range)` - Parse range strings ('1m', '3y', etc.)
- `applyFilter(range)` - Filter data by time range
- `calculateMomentum(timeSeries)` - Calculate momentum metrics
- `calculateCorrelations(timeSeries)` - Calculate sector correlations
- `getFilteredData()` - Get current filtered data
- `getRawData()` - Get raw unfiltered data

### 2. Chart Modules (`charts/`)

Each chart is a self-contained class:

| Chart | File | Description |
|-------|------|-------------|
| Performance | `performance-chart.js` | Bar chart of cumulative returns |
| Momentum Rank | `momentum-chart.js` | Bar chart of 3M momentum |
| Timeline | `timeline-chart.js` | Multi-line chart over time |
| Rotation Heatmap | `rotation-heatmap.js` | Heatmap of sector rankings |
| Rotation Timeline | `rotation-timeline-chart.js` | Top 3 sectors per quarter |
| Correlation | `correlation-chart.js` | Correlation matrix heatmap |
| Rotation Pairs | `rotation-pairs-chart.js` | Inverse correlations |
| Momentum Detail | `momentum-detail-chart.js` | Grouped bar chart (1M,3M,6M,1Y) |

**Pattern:**
```javascript
class ChartName {
    constructor(containerId) { ... }
    render(data, ...options) { ... }
}
```

### 3. `dashboard-ui.js` (UI Controller)
Orchestrates all modules:
- Initializes data processor
- Creates chart instances
- Handles user interactions
- Updates signals panel
- Manages view switching

### 4. `dashboard-modular.html` (Main UI)
Clean HTML structure that:
- Loads all modules in correct order
- Defines container elements
- Contains only CSS and structure (no inline JS)

## Testing

Business logic tested with Node.js:

```bash
cd historical_sector_cycles
node test-processor.js
```

**Tests:**
- ✅ Data loading and initialization
- ✅ Range parsing ('1m', '3y', 'ytd', etc.)
- ✅ Time series filtering
- ✅ Momentum calculation
- ✅ Correlation calculation
- ✅ Data integrity checks

## Usage

### Development
1. Modify chart modules in `charts/` directory
2. Test business logic with `node test-processor.js`
3. Open `dashboard-modular.html` in browser

### Production
Serve `dashboard-modular.html` with HTTP server:
```bash
python3 -m http.server 8001
# Open http://localhost:8001/dashboard-modular.html
```

## Benefits

1. **Separation of Concerns**: Business logic separate from UI
2. **Testability**: Business logic tested in Node.js
3. **Reusability**: Charts can be used in other projects
4. **Maintainability**: Each chart in its own file
5. **Performance**: Pure functions, no DOM thrashing in business logic

## Data Flow

```
rotation_dashboard_data.json
        ↓
DashboardDataProcessor (filters, calculates)
        ↓
getFilteredData()
        ↓
Chart.render() methods
        ↓
D3.js visualizations
```

## Key Improvements Over Original

1. **No global variables** (except for UI state)
2. **No fallback logic** - filtered data always initialized
3. **Consistent filtering** - all charts use same filtered data
4. **DRY code** - single `calculateStartDate()` function
5. **Type safety** - clear data structures and contracts
