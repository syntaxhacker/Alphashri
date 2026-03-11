# Market Replay & Data Recording Blueprint

This document outlines the strategy for recording live Option Chain data to enable a synchronized "Market Replay" feature (Historical Candles vs. Animated OI Changes).

## 1. The Vision
A "Time-Travel" dashboard for traders to analyze market behavior post-session.
- **Left Panel:** Historical Candlestick Chart (Price Action).
- **Right Panel:** Animated OI Change Distribution (Smart Money Movement).
- **Control:** A playback slider to move through time, seeing how OI walls were built or broken candle-by-candle.

## 2. The Data Challenge
- **Upstox API** provides historical data for **Candles** (Price).
- **Upstox API** does **NOT** provide historical snapshots for the **Option Chain** (OI/Greeks).
- **Solution:** We must implement a "Recorder Service" that captures live snapshots and stores them in a time-series database.

## 3. Implementation Strategy (The Recorder)

### Frequency
- Recommended: Every **1 minute** or **5 minutes** during market hours (09:15 to 15:30).

### Data Schema (Snapshot)
Each recording entry should store:
- `timestamp`: UTC/IST datetime.
- `underlying`: e.g., "NIFTY".
- `spot_price`: Current price of the index.
- `chain_data`: A JSON blob containing:
  - `strike_price`
  - `ce_oi`, `ce_vol`, `ce_ltp`
  - `pe_oi`, `pe_vol`, `pe_ltp`
  - `ce_delta`, `pe_delta` (Greeks)

### Storage Options
1. **SQLite (Current Project):** A new table `option_snapshots` with a JSON column.
2. **Flat Files:** Daily JSON files stored in `data/recordings/YYYY-MM-DD/`.

## 4. Replay Logic (The UI)
1. **Sync Engine:** The UI fetches historical candles for the day.
2. **Scrubbing:** As the user moves the chart crosshair or hits "Play":
   - The UI identifies the closest `timestamp` in the recorded snapshots.
   - The **OI Distribution Chart** updates its bars to reflect the OI state at that exact second.
3. **Delta Animation:** Smoothly transition bar widths to visualize "Intraday Buildup."

## 5. Potential Profit/Utility
- **Education:** Identify how "Short Squeezes" look before they happen.
- **Strategy Validation:** Test if "Max Pain" shifts towards the spot price during the day.
- **Institutional Tracking:** See where "Walls" are shifting in real-time vs. price trend.

## 6. Next Steps (Future Phase)
- [ ] Create a background Python worker using `apscheduler` to poll the API.
- [ ] Implement data compression (only store strikes near ATM to save space).
- [ ] Build the `MarketReplayView.tsx` with a dual-pane layout.
