# 52W Chaser entry logic frozen as-of 2026-10-03 wall clock

## 1. Freeze-date correction (premise was off by one day + a holiday)

The mission brief said "Friday 2026-10-03". Verification:

| Date | Weekday | Trading status |
|------|---------|----------------|
| 2026-10-01 | Thursday | session (close 15:30 IST) |
| 2026-10-02 | Friday | **NSE trading holiday — Gandhi Jayanti** (`market_holidays`: `2026-10-02 / Mahatma Gandhi Jayanti / TRADING`) |
| 2026-10-03 | **Saturday** | weekend |
| 2026-10-04 | Sunday | weekend |

Both session logics agree, pinned with explicit `now` values:

- `trading.calendar.last_completed_session(2026-10-03T10:00 IST)` → **2026-10-01**
- `chart_patterns.candles._last_completed_session(2026-10-03T10:00 IST)` → **2026-10-01**
- Same result for `2026-10-03T16:00` and `2026-10-04T10:00`.

**Freeze = Thursday 2026-10-01 close. All frames fetched with
`to_date=2026-10-01`, hard-sliced to IST date ≤ 2026-10-01 with an assert
(no-peek); indicators computed on the sliced frame only, gate values read
at the freeze bar.**

## 2. Method — gate mirror of `backtest/strategies/week52_chaser.py`

Universe: `experiments/target_universe_symbols.json` (227 symbols,
`tv_avg_volume_10d>=500k`), reused as-is.

| Gate | Code mirrored | Rule at freeze bar |
|------|---------------|--------------------|
| sufficiency | `on_bar`: `len>=20`, 52w not None | n_bars ≥ 20 and 52W high computable |
| proximity | `_should_enter`: `((h52-close)/close)*100 <= entry_threshold_pct` | dist ≤ **3.0%** (wrapper `get_params`/`run_single` default; Nautilus `Week52ChaserConfig` defaults 2.0 — `proximity_2pct_ok` recorded per symbol so both are derivable) |
| adx | `_check_entry_filters`: `adx<25 → False` | ADX(14) ≥ 25 (NaN → pass, as in code) |
| rsi | `rsi<50 or rsi>70 → False` | 50 ≤ RSI(14) ≤ 70 (NaN → pass) |
| vol | `volume < vol_avg*1.5 → False` | vol ≥ 1.5 × 20d avg (NaN → pass) |
| ma | `close<ma50 → False`, `close<ma200 → False` | close ≥ MA50 and ≥ MA200 (NaN → pass) |

52W high = `calculate_52w_high(highs, 252, exclude_current=True)` on the
frozen frame (matches `Week52HighTracker.update`, which appends the current
bar then excludes it). ADX/RSI via canonical `trading.indicators`
(same functions the strategy wrappers call). Signal = AND of all gates.

Coverage: **225 fresh** (`data_through=2026-10-01`), 0 stale, 2 no-data
(HFCL, STLTECH — Upstox returned no daily frame).

## 3. Result: 0 signals — genuine market state, not a bug

Distance-to-52W-high distribution (225 symbols, median **24.9%**):

| Bucket | Symbols |
|--------|---------|
| ≤ 0% (new 52W high at freeze bar) | 2 |
| 0–3% | 1 |
| 3–5% | 7 |
| 5–10% | 17 |
| 10–20% | 46 |
| > 20% | 152 |

152/225 symbols sat >20% below their 52W high — a broad drawdown into
Oct 1. Only 3 symbols cleared proximity; each was then killed downstream:

| Symbol | Close | 52W high | Dist | ADX | RSI | Vol ratio | Killed by |
|--------|-------|----------|------|-----|-----|-----------|-----------|
| WELSPUNLIV | 239.17 | 233.00 | **−2.58%** (new high, +5.2% day, 4.16× vol) | 49.09 ✓ | **79.92 ✗** (>70) | 4.163 ✓ | **RSI** (overbought breakout) |
| CUPID | 312.50 | 312.00 | **−0.16%** (new high) | **24.34 ✗** (<25) | 67.01 ✓ | 1.104 ✗ | **ADX** (also fails vol) |
| LGEINDIA | 1721.80 | 1755.00 | **1.93%** | 28.43 ✓ | 60.53 ✓ | **1.011 ✗** | **VOL** (no expansion) |

Funnel (chaser check order): 225 → proximity kills 222 → 3 left →
ADX kills 1 → 2 left → RSI kills 1 → 1 left → VOL kills 1 → **0 signals**.

## 4. Kill-attribution table (independent kills, n=225)

| Gate | Killed | Pass rate | Notes |
|------|--------|-----------|-------|
| proximity (≤3%) | **222** | 1.3% | dominant gate; market-wide drawdown |
| rsi (50–70) | **197** | 12.4% | mostly RSI<50 (weak momentum) |
| ma (≥MA50 & ≥MA200) | **190** | 15.6% | ↳ MA50 killed 186, MA200 killed 143 |
| vol (≥1.5× avg20) | **164** | 27.1% | |
| adx (≥25) | **138** | 38.7% | weakest filter |

Overlap (row gate's kills also killed by column gate):

| | +prox | +adx | +rsi | +vol | +ma |
|---|---|---|---|---|---|
| **prox (222)** | — | 137 | 196 | 162 | 190 |
| **adx (138)** | 137 | — | 124 | 101 | 120 |
| **rsi (197)** | 196 | 124 | — | 141 | 184 |
| **vol (164)** | 162 | 101 | 141 | — | 139 |
| **ma (190)** | 190 | 120 | 184 | 139 | — |

Reading: ADX killed 138, of which 101 also failed volume; RSI killed 197,
of which 141 also failed volume and 184 also failed MA. All 190 MA kills
were also proximity kills (symbols below both MAs sit far from highs).
Only 1 ADX kill and 1 RSI kill fell outside proximity kills — i.e. the
filters barely bind beyond proximity in this tape.

## 5. Hand-verification (2 symbols, fully independent path)

Recomputed from **raw candles** via `UpstoxAPI.fetch_historical_data_v3`
directly (not the `market_data` wrapper), plain-Python 52W max, and
hand-rolled Wilder ADX/RSI (not `trading.indicators`):

- **WELSPUNLIV**: all 6 gates + signal MATCH (close 239.17, h52 233.00,
  dist −2.580%, adx 49.09, rsi 79.92, ma50 190.24, ma200 149.43, ratio 4.163).
- **LGEINDIA**: all 6 gates + signal MATCH (close 1721.80, h52 1755.00,
  dist 1.928%, adx 28.43, rsi 60.53, ma50 1632.84, ma200 1550.33, ratio 1.011;
  vol_avg20 554002 vs 554001 — 1-lot rounding, same verdict).

Raw last-3-bars printed by `experiments/chaser_asof_verify.py` confirm the
Oct-01 freeze bar (IST) in both paths.

## 6. Files

- `experiments/chaser_asof.json` — per-symbol gate matrix (225 rows) + kills + overlap + funnel
- `experiments/chaser_asof.md` — this report
- `experiments/chaser_asof_run.py` — runner (resume via `chaser_asof_progress.json`)
- `experiments/chaser_asof_verify.py` — independent 2-symbol verifier
- `experiments/chaser_asof_progress.json` — resume state (intermediate)

Not committed, per mission.
