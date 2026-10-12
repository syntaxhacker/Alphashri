# 52W-High Hitters — Week Mon 2026-10-05 → Fri 2026-10-09

- Universe: `experiments/target_universe_symbols.json` — 227 liquid symbols
  (Nifty 500 filtered to TV `avg_volume_10d ≥ 500k`).
- Data: `chart_patterns.candles` 1D frames (disk cache, last bar Fri 2026-10-09).
- Prior 52W high = max high of 252 sessions strictly before 2026-10-05.
- Hitter = any session Oct 5–9 with **high ≥ prior high**.
- Costs: `backtest/costs.py:calculate_trading_costs` on every trade, ₹1L/trade
  (`qty = floor(100000 / entry)`).
- Trading-day check: Oct 5,6,7,8,9 all NSE trading days (Mon–Fri, no holiday).
  Note **Fri 2026-10-02 was a holiday (Gandhi Jayanti)** — pre-week close = Thu Oct 1.
- No-data symbols (2): HFCL, STLTECH (empty 1D frames).

## Result: 5 hitters out of 227 (2.2%)

### Day distribution (first-hit day)

| Day | First-hits | Note |
|---|---|---|
| Mon Oct 5 | 2 (CUPID, LGEINDIA) | CUPID gapped open AT prior high — unchaseable at/below breakout |
| Tue Oct 6 | 1 (BHEL) | clean intraday breakout (prior high from Jul 17) |
| Wed Oct 7 | 2 (LAURUSLABS, WELSPUNLIV) | both wick-only touches, closed BELOW prior high |
| Thu Oct 8 | 0 | — |
| Fri Oct 9 | 0 | — |

Monday gaps (open ≥ prior high with Oct-1 close below): **CUPID only**.
CUPID nuance: its "prior 52W high" (₹314.30) was set on **Oct 1 itself** (the
last pre-week session) — this is a continuation gap, not a breakout from an
old level. Its first-hit (Monday) close (₹310.10, −1.34% vs prior high)
failed to hold, yet the week ended +18%.

### Per-symbol table (₹1L/trade)

Scenario A = buy first-hit close → sell Fri close.
Scenario B = buy first close ABOVE prior high in window, 2% SL on daily lows, Fri exit.
Scenario C = scenario-A trade restricted to chaser band
(first-hit close +0.5%…+3.0% above prior high, mirroring
`Week52ChaserSignalGenerator`: `min_breakout_pct=0.5`, `entry_threshold_pct=3.0`).

| Symbol | Prior 52W | First hit | Hit days | FHC (₹) | Fri (₹) | A: gross / net | B entry→exit | B: gross / net | C elig | C: net |
|---|---|---|---|---|---|---|---|---|---|---|
| BHEL | 446.50 | Tue | 6,7,8 | 452.00 (+1.23%) | 433.60 | −4066.40 / **−4147.64** | 452.00 (Tue)→442.96 SL (Thu) | −1997.84 / **−2079.68** | yes | −4147.64 |
| CUPID | 314.30 | Mon ⚠gap | 5,6,7,8,9 | 310.10 (−1.34%) | 366.10 | +18032.00 / **+17944.45** | 324.20 (Tue)→366.10 (Fri) | +12905.20 / **+12819.11** | no | — |
| LAURUSLABS | 2055.30 | Wed | 7 | 2052.80 (−0.12%) | 2036.60 | −777.60 / **−859.31** | no close above prior → no entry | — | no | — |
| LGEINDIA | 1755.00 | Mon | 5,6,7,8,9 | 1770.90 (+0.91%) | 1757.00 | −778.40 / **−860.33** | 1770.90 (Mon)→1735.48 SL (Thu) | −1983.41 / **−2065.00** | yes | −860.33 |
| WELSPUNLIV | 244.89 | Wed | 7 | 235.86 (−3.69%) | 223.75 | −5122.53 / **−5203.43** | no close above prior → no entry | — | no | — |

(FHC = first-hit close; % = vs prior 52W high.)

### Scenario totals

| Scenario | Trades | Gross (₹) | Costs (₹) | Net (₹) | Wins / Losses |
|---|---|---|---|---|---|
| A (first-hit close → Fri) | 5 | +7287.07 | 413.33 | **+6873.74** | 1 / 4 |
| B (close-breakout + 2% SL → Fri) | 3 | +8923.95 | 249.52 | **+8674.43** | 1 / 2 |
| C (chaser band subset of A) | 2 | −4844.80 | 163.17 | **−5007.97** | 0 / 2 |

- Scenario B detail: 2 stopped (BHEL Thu, LGEINDIA Thu); 2 no-entry
  (LAURUSLABS, WELSPUNLIV never closed above prior high in-window).
- Costs ≈ ₹81–88 per round trip — negligible vs move sizes.

### Top-5 (all hitters, ranked by scenario-A net)

1. CUPID +17944.45 (the only winner; Monday gap, unchaseable at breakout)
2. LAURUSLABS −859.31 (wick touch, faded)
3. LGEINDIA −860.33 (chaser-band entry, stopped in B, faded to −0.8%)
4. BHEL −4147.64 (true breakout Tue, then −4.1% into Friday)
5. WELSPUNLIV −5203.43 (wick touch, −5.1% into Friday)

### Takeaway for the chaser

- 4 of 5 hitters lost money on a buy-first-hit-close→Friday hold; the only
  winner (CUPID) gapped Monday and couldn't be chased at the breakout print.
- Both chaser-band-eligible entries (BHEL, LGEINDIA) lost; both scenario-B
  stop-loss exits also stopped out before Friday.
- Midweek wick-only touches (LAURUSLABS, WELSPUNLIV) were bull traps into Friday.
- Small sample (n=5): no long-side chase edge this week; the distribution
  (Monday gaps + Wednesday wicks) is exactly the unchaseable/fakeout mix.

## Hand verification (raw 1D candles, bypassing aggregation)

- **CUPID**: prior max = 314.30 set 2026-10-01 (O 313.50 H 314.30 C 312.50);
  Mon O 314.30 H 316.00 C 310.10 ✓ hit; Tue C 324.20 first close above ✓;
  Fri C 366.10 ✓. Gap flag ✓ (Mon open = prior high, Oct-1 close below).
- **BHEL**: prior max = 446.50 (2026-07-17); Mon H 433.45 < prior ✓ no-hit;
  Tue H 453.90 C 452.00 ✓ first hit; SL 442.96 vs Wed L 446.60 (hold) /
  Thu L 429.45 (stop) ✓; Fri C 433.60 ✓.
- **LGEINDIA**: prior max = 1755.00 (2026-08-17); Mon H 1825.00 C 1770.90
  (+0.906%, in chaser band) ✓; SL 1735.48 vs Tue L 1750.00 / Wed L 1751.50
  (holds) / Thu L 1705.00 (stop) ✓; Fri C 1757.00 ✓.

Full table: `experiments/chaser_outcome.json`. Generator:
`experiments/chaser_outcome_run.py` (re-runnable; reads cache only, no network
needed while the Oct-9-pinned cache is fresh).
