# Tomorrow's Test Plan: Top-5 SENSEX Strategy Horse-Race

Date: next trading day (2026-08-06). Run 5 OOS-validated strategies live in parallel virtual books and learn which one actually performs.

## The 5 strategies (all out-of-sample validated)

| # | Strategy | OOS median/day | OOS %pos | Trade style |
|---|---|---|---|---|
| 1 | **momentum scalp** lb5 thr10 tgt+300/sl−150 | +₹857 | 57% | 1-min momentum |
| 2 | **momentum scalp** lb3 thr10 tgt+500/sl−200 | +₹506 | 57% | 1-min momentum |
| 3 | **range scalp** lb5 tgt+300/sl−150 | +₹757 | 57% | 1-min range fade |
| 4 | **range scalp** lb3 tgt+300/sl−150 | +₹589 | 71% | 1-min range fade |
| 5 | **range/reversion** notrend-t600-sl200-on | +₹584 | 86% | S/R + trend both sides |

## How to run (tomorrow, market open 09:15–15:30)

```bash
cd /home/mysyntax/Documents/Alphashri/stock-screener-ui
source .venv/bin/activate
# run the horse-race (use -u for live output):
python3 -u scripts/paper_sensex.py top5 --until 15:30 --interval 30
```

All 5 strategies share the same live SENSEX spot. Each keeps its own virtual open
position with its own target/SL. Every trade (open + close) appends to:
`experiments/data/top5_live_<date>.csv`.

## What to watch / log during the day

- **Which strategy enters first** and how its positions behave in the opening range.
- **Momentum vs range divergence**: momentum chases breakouts, range fades extremes —
  watch which wins in that day's regime (trend day → momentum, chop day → range).
- **The notrend/reversion strategy** as the "control" (fewer trades, 86% pos days historically).
- Note **CAS closing auction** (15:15–15:30) impact on any open positions at EOD.

## End-of-day learning checklist

1. **Pull the CSV**: `python3 -c "import csv; print(list(csv.DictReader(open('experiments/data/top5_live_<date>.csv'))))"` or open in Excel.
2. **Rank the 5 by net P&L and win rate.** Which won? Why?
3. **Regime check**: was it a trend day (down-day) or chop? Did momentum or range fit better?
4. **Costs check**: high-churn scalps (momentum) — did ~₹15/trade cost eat the edge?
5. **Update `docs/SENSEX_PAPER_LESSONS.md`** with what actually worked live vs backtest.
6. **Decide**: promote the winner to the real live monitor
   (`monitor --strategy --scalp` for scalps, or `--config notrend-t600-sl200-on` for range).

## Rules

- Only ONE real position at a time in the real book (if you promote a winner).
- The horse-race itself is virtual/parallel — safe, no risk.
- Stop at 15:30; do the post-mortem after close.
