# Sector Covariance Analyzer Usage

## Quick Commands

```bash
# Watch mode for intraday (morning 9:15-12:00 best)
python sector_covariance_analyzer.py --watch

# Analyze all sectors
python sector_covariance_analyzer.py --analyze-sectors

# Predict if Tech rises 2%
python sector_covariance_analyzer.py --predict-stocks --trigger-sector "Electronic Technology" --trigger-movement 2.0

# Interactive visualization
python sector_covariance_analyzer.py --visualize
```

## Daily Usage

**Morning (9:15-10:30):** Use `--watch` to monitor sector rotations
**Midday:** Use `--predict-stocks` to check correlation plays
**Evening:** Use `--analyze-sectors` for next day planning

## Key Features

- **Sector Correlations:** Find which sectors move together
- **Stock Correlations:** Within sector stock relationships  
- **Real-time Alerts:** ENTER/SHORT/WATCH signals
- **Interactive Charts:** Dark theme with clickable sectors
- **Historical Analysis:** 90-365 day lookback periods

## Parameters

- `--watch-interval 30` (seconds between updates)
- `--movement-threshold 1.5` (% movement for alerts)
- `--lookback-days 90` (historical data period)
- `--min-correlation 0.3` (correlation threshold)