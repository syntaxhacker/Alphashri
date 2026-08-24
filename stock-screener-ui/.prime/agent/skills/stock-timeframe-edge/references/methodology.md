# Timeframe Edge — Methodology & Thresholds

## 1. Session decomposition

Each trading day (09:15–15:30 IST, 375 minutes) is split into four chained buckets:

| Bucket | Window | Return definition |
|---|---|---|
| overnight | prev close → open | `open_t / close_{t-1} − 1` |
| open | 09:15 → 10:30 | first 5m bar open → last <75m bar close |
| midday | 10:30 → 14:00 | chain from open bucket's last close |
| close | 14:00 → 15:30 | chain to the daily close |

**Exact chaining property:** `(1+gap)(1+open)(1+mid)(1+close) = close_t/close_{t-1}`,
enforced by folding each day's residual (`official daily move ÷ minute-bar chain`)
into that day's **close bucket** — the residual exists because the official daily
close includes the closing-auction print, which intrabar closes miss. The report
footer prints chained vs actual; a large residual mean means data problems.

**Attribution shares use log returns**: `share_b = Σlog(1+r_b) / Σ_all log(1+r)`.
Additive and sign-consistent; plain % attribution breaks for compounding.

Interpretation thresholds:
- Overnight share > 60% → momentum/smallcap profile; intraday trading fights drift.
- Open-session share > 40% with positive PF at 5m/15m → ORB-style strategies fit.
- Volume share vs return share divergence (e.g. 35% of volume in the first hour
  but 10% of the move) → activity ≠ payment; don't scalp just because it's liquid.

## 2. Monte-Carlo holding-period backtest

For each horizon h ∈ {5m, 15m, 1h, 4h, overnight, 1d, 3d, 5d}:

- **Population** = every valid entry (intraday horizons enforce same-day exit).
- **Sample** = seeded (`--seed`, default 42) uniform subsample without replacement,
  capped at `--samples` (default 2000). Deterministic across runs.
- **Trade** = buy bar open, sell bar close n_bars later (n_bars = 1 for native-TF
  intraday horizons; n = h_days for daily). Net of round-trip cost (default 12 bps).

Metrics per horizon:

- **Profit factor** `PF = Σ wins / |Σ losses|` (∞ if no losses; nan if flat).
- **95% bootstrap CI on PF** — 1000 resamples, percentile method. The verdict
  requires `CI_lo > 1` to call an edge "statistically real".
- **Win rate**, mean/median per-trade P&L.
- **t-stat** = mean / (std/√n) — sanity vs CI.
- **Annualized Sharpe (approx)** = mean/std × √(trades/year), trades/year =
  252/holding_days (375/h minutes for intraday). Arithmetic approximation — stated as such.
- **Annualized edge** = mean × trades/year ("return per unit of time-in-market").
  This is the efficiency ranking, not a compounding forecast.

### SL/TP overlay
Stops/targets at ±1%, ±2%, ±3% checked on native-bar high/low within the holding window:
- Gap through stop → filled at the (worse) open, never at the stop level.
- Both hit in one bar → SL assumed filled first (conservative).
- Overnight horizon: fills only via the opening gap.
Reading: edge that survives ±2–3% stops is tradeable; edge that dies at ±1% is
drift masked by noise.

### Regime split
Regime = previous day's `close > SMA200` (no lookahead). PF reported separately;
the down-regime PF is the honest base expectation for always-on strategies.

## 3. Verdict rubric

1. Rank by PF; require n ≥ 30 and CI_lo > 1 for "real edge".
2. If best is 5m/15m with huge n but CI straddles 1 → label expected-noise.
3. Cross-check against session shares (a "1d best" verdict must match overnight/
   multi-day concentration in fig1/fig2).
4. Compare overnight split vs NIFTY over the same span — only the excess is stock-specific.
5. State regime dependence and stop-sensitivity in the final line.

## 4. Known limitations

- Random-entry sampling measures average drift structure, not setup quality.
- Flat bps costs; slippage, impact, and STT granularity not modeled.
- Upstox minute history depth limits intraday lookback (~1y); daily rows cover full window.
- Same-day rule means "4h" excludes late-day entries that would cross into tomorrow.
