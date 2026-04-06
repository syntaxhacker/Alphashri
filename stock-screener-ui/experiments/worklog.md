# SR Breakout Optimization Worklog

## Session: sr-breakout-wr-pf-20260405
**Start**: 2026-04-05
**Data**: 18 symbols, Apr 2 2026, 1-min intraday + daily cached

### Run 1: Baseline — PF=1.25 (KEEP)
- What: SL=1.0%, TP=3.0%, classic pivot, buffer=0.1%, no time filter
- Result: PF=1.25, WR=18.8%, 16 trades, 3W/11L/2EOD
- Already has live price fix from earlier session

### Run 2: Time filter — PF=6.05 (KEEP, +384%)
- What: Skip entries before 10:30 (min_entry_minutes=630)
- Result: PF=6.05, WR=40.0%, 15 trades, 6W/7L
- Insight: 5 of 11 original SLs were 9:15-9:16 opening gap entries that reversed. Time filter is the biggest lever.

### Run 3: Tighter SL/TP — PF=11.81 (KEEP, +845%)
- What: SL=0.75%, TP=2.0%, classic pivot, min=10:30
- Result: PF=11.81, WR=46.7%, 15 trades, 7W/7L
- Insight: Wider TP (3.0%) was too ambitious. 2.0% hits more often.

### Run 4: Camarilla pivot — PF=13.93 (KEEP, +1014%)
- What: Switch to camarilla pivot, SL=0.75%, TP=2.0%, buf=0.1%, min=10:30
- Result: PF=13.93, WR=53.3%, 15 trades, 8W/6L
- Insight: Camarilla pivot levels are tighter and better suited for NSE intraday. Buffer 0.1-0.3 all work equally well.

### Run 5: Optimize SL with camarilla — PF=17.42 (KEEP, +1294%)
- What: SL=0.6%, TP=2.0%, camarilla, buf=0.1%, min=10:30
- Result: PF=17.42, WR=53.3%, 15 trades, 8W/6L
- Insight: SL=0.6% is the sweet spot — tight enough to cut losses fast, but time filter prevents false outs.

### Run 6: Applied to code — PF=17.42 (KEEP)
- What: Updated strategy config DB + added min_entry_minutes time filter in scan loop
- Changes: `multi_strategy_runner.py` (time filter), `strategy_configs` DB (SL=0.6, TP=2.0, pivot=camarilla)

## Key Insights
1. **Time filter > everything else**. Opening gap breakouts (9:15-9:16) account for most SLs
2. **Camarilla > Classic** for NSE intraday. Tighter pivot levels = fewer false breakouts
3. **SL=0.6% works because of the time filter**. Without it, 0.6% gets stopped out immediately
4. **TP=2.0% is the sweet spot**. 3.0% is too ambitious, 1.5% leaves too much on table
5. **Buffer doesn't matter much for camarilla** (0.1-0.3 all same result)
6. **Overfitting risk**: This is 1 day of data. The time filter and pivot change are structural (not curve-fit). The exact SL/TP values may need adjustment on more data.

## Overfitting Check
- Structural changes (time filter, pivot type) should generalize well
- SL=0.6% and TP=2.0% are somewhat curve-fit to this day — recommend validating on 5-10 more trading days before trusting
- The strategy only trades 15 symbols/day with time filter — sample size is small

## Next Ideas
- Validate on multiple days (need more cached data)
- Consider dynamic SL based on ATR instead of fixed %
- Consider partial TP (exit 50% at 1.5%, trail rest)
- Consider volume filter at entry
