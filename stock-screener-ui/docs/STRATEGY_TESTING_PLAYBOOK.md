# Strategy testing playbook

How we test a strategy in this repo, what we have learned, and what not to do.
Read this before starting a new study.

---

## 1. The protocol (non-negotiable)

1. **Pre-register the hypothesis and the metric** before looking at results.
   Write it in the study's markdown: setup, entry, exit, metric, split.
2. **Split by date, not randomly.** Train = earlier, test = later.
   Never shuffle intraday bars across the split.
3. **Select on TRAIN only.** The test set is read **once**, after the config is
   frozen. If you score configs by test net, the test is no longer out-of-sample
   (this happened: 72 configs scored on test → PF 3.07 that collapsed on a clean
   train-only selection).
4. **Walk-forward** for the real answer: fit on months 1..k, test on k+1, roll.
   Report the concatenated out-of-sample curve.
5. **Costs always on.** `options_paper/costs.py`, 65 lot. Include slippage as a
   haircut if the strike is illiquid.
6. **No look-ahead.** Signal at bar `t`, fill at `t+1`. Exits on the current
   close only. No future OI, no future wall, no exit price in the entry.
7. **Sample size.** Fewer than 30 trades is a hypothesis, not a result. Report
   the t-stat or a bootstrap CI. A PF of 3 on 19 trades is noise until proven.
8. **Concentration checks.** Drop the best month, drop the best trade, drop the
   best side. If the edge disappears, it is a bet, not an edge.
9. **Regime checks.** Split by volatility regime (ATR / realized vol) and by
   trend vs chop. A strategy that only works in one regime is a regime bet.
10. **Log every experiment** in `reports/.../autoresearch.jsonl` + a worklog.
    Never delete a failed run — the failures are the map.

---

## 2. Data integrity (the traps that cost us time)

| trap | what happened | rule |
|---|---|---|
| **Parity spot** | USB archive has no index file; spot rebuilt from `K + C − P`. Error median ~10 pts, tails ±45 | prefer a real index/futures feed; if parity, record the residual and gate entries on it |
| **Forward-filled option prices** | illiquid strikes carry the last trade; a "fill" can be hours stale | check volume at the entry/exit bar; skip if 0 |
| **ITM short legs** | a "strangle" sold a call below spot | enforce call ≥ ATM+50, put ≤ ATM−50 |
| **Contract files span expiries** | a strike CSV can contain older expiries | filter to the front-expiry window only |
| **Sparse early chains** | 2024 folders are a 100–400 pt strike sample | require a 50-pt grid near spot (`chain_complete`) |
| **Lot 65 vs 75** | NIFTY lot changed; one constant is wrong for part of the sample | make lot a function of date |
| **Close-only stops** | 13/43 trades pierced the intrabar stop | use OHLC lows for stops, or state "close-only" and haircut |
| **Cost per order** | 4 orders per structure; a 50% target can be smaller than the cost | compute the break-even move before sizing |

---

## 3. What we have learned (the map)

### Works (survived train **and** test)
- **Wall fade** (CE-only, put-wall rejection, OI rising, 60-min hold):
  19 trades, PF 4.72, DD −₹2,332, 7/8 positive months.
- **Time stop 30** (exit if not in profit after 30 min): +₹30,237, PF 6.22,
  DD −₹1,821 — cuts the average loss from −₹769 to −₹446.
- **Premium strangle + HTF bias skew**: train PF 1.12 / test 1.28, DD −₹15,050,
  60% win — but margin-heavy and regime-dependent.

### Fails (do not re-litigate)
- **Break side** of the wall book: −₹55k test, PF 0.64.
- **Aggressive spot strategies** (ORB, VWAP trend, momentum, PDHL): test PF
  0.8–1.1; train PF 2.3 → test 0.9 for PDHL. Regime bets.
- **Failed-break fade**: train PF 0.73.
- **Next-expiry chain**: train PF 0.41.
- **Naked premium / condor / credit spreads**: PF 0.6–0.9; the tail days eat
  the credit.
- **Spot chart patterns → ATM options**: 15m PF 0.82 (−₹23,606), 5m PF 0.68
  (−₹125,206) — worse than the index baseline (0.85). The positive cells are
  five sessions (113% of net); ex-top-5 PF 0.95. No directional edge on spot at
  5m/15m, and theta + costs convert it into a loss.

### The economics
- A long option round trip is ~₹95. A high-frequency book at PF 1.0 is just
  paying brokerage.
- Frequency and edge are in tension: 5.3 trades/week = PF 1.00; 3.1/week = 1.55;
  2.4/week = 4.72.
- The edge must be **structural** (OI walls, risk premium, flow) — not a pattern
  fitted on 1-min candles.

---

## 4. Checklist for a new strategy

- [ ] Hypothesis written before the data is touched.
- [ ] Data source documented; spot is real or parity with a residual gate.
- [ ] Front-expiry, complete-chain sessions only.
- [ ] Signal at t, fill at t+1; no future data.
- [ ] Costs + slippage on.
- [ ] Train/test split by date; config chosen on train.
- [ ] Test read once.
- [ ] n ≥ 30; t-stat / bootstrap CI reported.
- [ ] Drop-best-month / drop-best-trade / drop-best-side checks.
- [ ] Regime split (vol / trend).
- [ ] Monthly table and max DD.
- [ ] Report generated from code, not hand-written numbers.
- [ ] Logged in JSONL + worklog.

---

## 5. Templates

- **Engine**: `scripts/strategy_engine.py` — `StrategyEngine` base class
  (load, loop, fill at t+1, costs, stats, split). Override `signal()` and
  `exit_rules()`.
- **Report**: `scripts/report_template.py` — `Report` + `trade_chart` (dark
  SNDK theme, sidebar, cards, per-trade sections, embedded charts). Works for
  long options and multi-leg structures.
- **Existing engines** (for reference):
  `hist_fade.py` (wall fade), `hist_premium.py` (selling), `hist_spot.py`
  (spot signals), `parallel.py` (6 workers), `fade_report.py` /
  `premium_report.py` (reports).

---

## 6. Reporting rules

- Every number in the HTML must be **computed**, never typed. A stale "51
  trades" in a 19-trade report is a credibility bug.
- The report must show: train and test separately, monthly, max DD, worst
  trade, and the count.
- The hero sentence must be derived from the same stats object as the cards.
- If the live sample is < 10 trades, say "too few to judge" — never "agrees on
  direction".
