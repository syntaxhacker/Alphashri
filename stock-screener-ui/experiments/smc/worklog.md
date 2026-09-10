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

### Run 7: 15m HTF trend gate (Agent B spec) — pf_test=0.231 (DISCARD, reverted)
- Gate 1m entries on 15m bull/bear states (BOS+expansion+displacement, history-only).
- Result: test PF 0.928 -> 0.231, trades collapse 97 -> 49. Classifier labels 41-79% of
  bars sideways and trend labels lag entries past the move. Chop description is accurate;
  trend-timing is unusable for 1m entries. Reverted. Lesson: HTF *description* != HTF *timing*.
- Next: tp-near default (validated +1104 divided) under current best config; then full-month exam.

### Run 8: tp-near under session+ATR — pf_test=0.543 (DISCARD)
- tp-near won on divided stacks (+1104) but loses under session+ATR (0.928 -> 0.543).
  Nearer targets get faded more in the filtered regime. Config-dependent: no default change.
- Best stands: run 5 (session 12-23 + ATR>=8, pf_test=0.928).
- Next: full-July month exam (800/month goal needs contiguous month, not scattered sessions).

### Month exam (July, best config session+ATR): +560.53 PF 1.06 — 800 goal FAIL, $150/day FAIL
- 460 trades, win 25%. 6 trend days (+2650) carry 6 chop days (-2235). Worst day -549pts.
- Morning-range day filter: NO separation (loser median 203 vs winner 199). Logged, not pursued.
- MNQ adopted ($5/pt): July = +$2,802/contract; 800pts = $4,000/mo; $150/day = 30pts/day.

### Run 9: daystop 30pts on July — PF 0.99, net -13.56 (DISCARD)
- Kills the month: trend days dip >30 intraday before printing +500 (07-02 +658->-32, 07-08 +673->-55).
- Worse: entry-block doesn't cap — open positions run past it (worst day still -116).
  A flatten-at-breach would cap properly but sacrifices the same trend days.
- Lesson: $150/day hard cap conflicts with 800pts/month on 15-40pt risk profile. The cap
  needs win-rate (shorter loss strings), not tighter stops. Sizing (MNQ) handles dollars.

### Month exam #2 (July, divided stacks + session/ATR): +1446.20 PF 1.09 — 800pts PASS, quality+DD FAIL
- 1095 trades (47/day), win 22%, nets +$7,231 MNQ. Worst day -839pts (-$4,197 MNQ).
- Passes points on VOLUME (+1.32/trade), not quality. Retest stack is the churn engine
  (up to 80 trades/day on chop days like 07-13). Violates "high-quality only" + "$150/day".
- Scorecard vs user goals: points PASS / quality FAIL / drawdown FAIL.
- Next: cut trades 3-4x while keeping net — gate the retest stack harder (RR5? longer
  cooldown? chop-day skip for retest only), then re-run July.

### Forensics: July losers deep-dive (856 losers, -16321 vs +17767 winners = +1446 net)
- MFE clusters: never-went-anywhere 312 (-6465), faded 0.3-1.5R 352 (-6547), round-trips 192 (-3310).
- Retest losers spread ALL hours 12-22 (25-72/hr) — no hour filter helps. Tiny-risk stops negligible.
- No ex-ante separator found at trade level; direction is day-regime + HTF bias work (open).

### Run 10: yfinance daily-bias direction gate — pf_test=0.384 (DISCARD)
- Bear days -> shorts only, bull -> longs only, neutral -> both. Test 0.928 -> 0.384.
- Daily swings (2-day confirmation lag) miss the days that matter; 07-10's winning longs
  were cut. Kept as opt-in params (default off). Seventh failed gate: the pattern holds —
  HTF direction filters cost more than they save on this engine.

### 3-month validation (best config session+ATR): June -1971 / July +561 / August -2327 — TOTAL -3737 PF 0.87
- The 6-session loop results were small-sample luck. Out-of-sample the engine fails badly.
- Regime explains everything (yfinance daily): June = violent chop (range 803, drift +43,
  efficiency 0.00) -> dies. July = directional (drift +1690, eff 0.22) -> works. August =
  small-range chop (440) -> dies worst (-2327).
- Consequence: a trend-continuation engine CANNOT make 800/month every month. Either gate by
  regime (abandons every-month) or build a chop-mode (mean-reversion) complement system.
- The loop's train/test split (4+2 sessions) was too small to catch this. All future keeps
  require month-level validation.

### Parallel research wave (4 agents): forensics-3m + chop engine + regime + risk — all landed
- Forensics-3m: top entry fixes = zone-age>30 (PF 0.87->0.94), displacement<0.25ATR skip (->0.90),
  ATR 8->10 (->0.90). Negatives: no loss-cooldowns, no day-drift filter, chase is not the enemy.
- Chop engine (trading/smc_chop.py): Jun+Aug +936.6, worst -161.6 vs trend -458/-414. July flat.
  Verdict: complement-only. My re-run confirms direction (chop-days +481).
- Regime (scripts/regime.py): locked pre-12:00 rule, Aug OOS 76% chop-correct. Allocator
  (trend->engine, chop->0): +573.5 vs -3737.2. August trend days still -930.
- Risk (trading/risk.py): flatten-35 turns Jul+Aug -1766 -> +130 worst -35; flatten-20 -> +52
  worst -20. Entry-block-only proven broken. $150/day = 30pts MNQ; literal cap untradeable
  at 1x — needs MES sizing, not tighter stops.
- Combined allocator (trend-engine on trend days + chop-engine on chop days): ~+1050/3mo.
  Still short of 800/mo. Next: integrate allocator + forensics top fixes + flatten into the
  loop as measured runs; then 30-session confirmation.

### Runs 11-13: forensics gates under session+ATR — only ATR->10 keeps
- Run 11 zone-age>30: test 0.557 (DISCARD). Forensics' +0.07 came from unfiltered regime;
  under session+ATR it cuts winners. Small-sample disagreement noted.
- Run 12 displacement skip: test 0.744 (DISCARD). Train improved (1.93) but test pays.
- Run 13 ATR 8->10: test 0.928 -> 0.979 (KEEP). Convergent with forensics (+0.902 on 3mo).
- New best config: SMC_SESS=12:00-23:00 + SMC_ATR_MIN=10.

### Run 14: day-flatten-150 (tick-level DD cap) — pf_test=0.979 (KEEP as DD infra)
- Test PF equal (0.979), test net -53 -> -14, train PF 1.71 -> 1.46 (train pays).
- July month: net keeps 97% (+1230 vs +1264), worst day -461 -> -151 (-67%), PF 1.15 -> 1.19.
- 3-month still negative (regime problem untouched) — flatten is loss-control, not edge.
- Best config now: session 12-23 + ATR>=10 + flatten-150 (DD) — validated stack for the
  regime allocator + chop engine integration next.

### A++ pursuit: count caps FAIL (July)
- cap3/day: 69 trades, net -5.7, PF 0.99. cap5/day: 115 trades, +140.5, PF 1.09.
- Base (uncapped): 332 trades, +1230, PF 1.19. First-N signals are morning chop;
  the big winners arrive later in the day. Selectivity by count/RR-gate/cooldown all fail
  the same way: restrictions cut winners faster than losers.
- Standing conclusion: this engine's edge is volume of +EV structured shots (+4.6/trade),
  not a few perfect setups. "A++ only" by restriction is exhausted; selectivity must come
  from better setup GRADING (unbuilt), not throttling.

### A++ investigation closed: selectivity by restriction is exhausted
- Winner profile (July top-20 by R): retest 16/20, planned RR med 8.0, risk/ATR med 0.88.
- Operationalizations tested on July: retest+RR5 +1669/538 (best); +riskcap1.2 +732/504
  (winners need wide stops); RR6 +1338; RR8 +606; count caps (kill month); cooldowns (kill).
- Verdict: top-decile signature cannot be isolated ex-ante — every filter that removes the
  500+ small trades also removes the conditions producing the 20 best. A++ as "few trades,
  all high-RR" does not exist in this engine family at 1m. Closest: retest-RR5 (PF 1.27).

### All-months validation (single configs, sess+ATR10)
- retest-RR5: Jun -173 / Jul +1669 / Aug -1401 = +96 total PF 1.01. July-only star, fails elsewhere.
- divided-ATR10: Jun -1698 / Jul +2706 / Aug -3957 = -2948 PF 0.93. Volume without edge.

### Allocator (trend->single, chop->chop engine): Jun +82 / Jul +1772 / Aug -662 = +1192 PF 1.08
- First config positive on 2/3 months. August (-662, small-range 440) still bleeds — neither
  engine fits dead-small tape.
### Allocator + flat150: Jun -280 / Jul +1799 / Aug -298 = +1221 PF 1.12, worst -153
- DD control without net cost (worst -468 -> -153). Flat150 validated on allocator too.
- Remaining gap to goals: ~400pts/mo net (need 800), worst -153pts (-$764 MNQ vs $150 goal),
  August small-range regime unsolved.

### TRUE out-of-sample exam (May 2026, never touched in dev): -710.8 PF 0.69 — GOAL FAIL
- Locked system (allocator + flat150): 150 trades, win 32/150, worst -176.9.
- Regime called 15/21 chop correctly, but BOTH engines lost on May (trend days -562, chop days ~-150).
- Flat150 caps visible working as designed (four days pinned ~-150).
- Verdict: curve-fit confirmed as the central problem. The family is regime-fit to July-like
  conditions. No further single-lever tuning; needs new alpha or accepts trend-regime-only trading.

### Run 15: overnight history (8h) + double-rejection exit — DISCARDED (+704 vs +875)
- Built exactly as designed: structure sees overnight zones (TPs now target them, e.g. 29123),
  REJ exits fire on 2nd deep rejection. Mechanics verified working.
- But: REJ scalps rides everywhere (-0.60 to +9.84 dust exits displace TPs/trails),
  history reshuffles morning signals. 07-24 collapses +194 -> -30.
- Sep 2 improves (-220 -> -175) but that's the tuned session. System-negative overall.
- Kept as opt-in params (default off). Lesson reinforced: exit-layer additions that look
  surgical per-trade redistribute P&L system-wide, usually downward.
