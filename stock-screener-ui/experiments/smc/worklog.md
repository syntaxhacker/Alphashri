# Worklog: SMC trend-break autoresearch

## Session setup — 2026-09-03
- Goal: PF on held-out tick sessions. Train: 07-02, 07-22, 07-24, 08-26. Test: 07-10, 09-02.
- Engine: trading/smc_ifvg.py (RR3 default, coupled). Ticks cached in experiments/data/duka_cache.
- Prior art (from earlier analysis, pre-loop): baseline test-PF ~0.8; known losers = chase entries,
  counter-trend bounce longs, round-trip TP misses; MFE law (median 1R, p75 2.8R).

### Run 1: baseline RR3 coupled engine — pf_test=0.841 (KEEP, reference)
- Timestamp: 2026-09-03
- What changed: setup only; engine = validated RR3 config, no new rules.
- Result: test PF 0.841 (net -143.92, 52 trades) / train PF 1.569 (net +1019.27, 102 trades).
- Insight: train prints, held-out bleeds — overfit confirmed as the loop target. Forensics (Agent A):
  50 immediate failures (-1335), 40 mid-fades (-1026), 14 round-trips (-335). BOS-break (Agent C):
  REJECTED (PF 1.06 vs 1.32). 15m trend classifier spec ready (Agent B).
- Next: BE stop at +1.5R (forensics #1, est +150-300 test net).

### Run 2: BE stop at +1.5R — pf_test=0.498 (DISCARD, reverted)
- What changed: new be_trigger_r param; stop -> entry once favorable >= 1.5*risk.
- Result: test PF 0.841 -> 0.498 (net -144 -> -580). Train flat (1.569 -> 1.571).
- Insight: forensics est. +150-300 assumed winners survive; instead TPs (+60-120) get
  scratched at breakeven mid-ride. BE triggers chop losers into scratches but converts
  winners into scratches at the same rate. Reverted to HEAD.
- Next: relative chase filter (forensics #2, est +144 on small sample).

### Run 3: relative chase filter (max_chase_r=1.0) — pf_test=0.841 (DISCARD, reverted)
- Forensics #2 est. +144; actual: test PF identical (0.841), train-only gain (1.57 -> 1.72).
- Per protocol (equal = discard): reverted engine + tests + bench plumbing.
- New goal from user: >800 pts/month every month, deep setups only, session-aware
  (Asia/London/NY), volatility-aware, daily loss cap, minimal drawdown.
- Next: session window + ATR gate + daily stop (quality-windows idea), then full-month validation.

### Run 4: session 12:00-23:00 IST — pf_test=0.838 (DISCARD, equal)
- Cut trades 40% (154 -> 97 total) holding PF flat. Kept as opt-in infra, not as default.

### Run 5: session 12-23 + ATR(14)>=8 — pf_test=0.928 (KEEP)
- Test PF 0.841 -> 0.928 (+10%), train 1.569 -> 1.713. Both up, same trade paths trimmed.
- Current best config: SMC_SESS=12:00-23:00 + SMC_ATR_MIN=8. Deep setups only: volatility
  gate kills dead-tape entries, session gate kills overnight chop.

### Run 6: + daystop 40 (and 7.5) — pf_test=0.0 (DISCARD)
- Daystop 40: train PF best-ever 1.864 but test collapses (5 trades, 0 wins) — textbook
  overfit shape (winners arrive after early losers on held-out days). REJECTED.
- Daystop 7.5 (=$150 @1 NQ contract): kills everything (2-6 trades, PF ~0). A literal $150/day
  cap is untradeable with 15-40pt stops ($300-800/SL). Viable path: MES micros ($5/pt) make
  30pts = $150 — size down, don't tighten the stop.
