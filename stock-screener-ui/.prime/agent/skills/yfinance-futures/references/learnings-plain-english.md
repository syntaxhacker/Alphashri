# Learnings & Patterns — ES/NQ (Plain English)

*From `scripts/eda_futures.py:1` — window `2026-08-17 → 2026-08-29`, yfinance `ES=F`/`NQ=F` 1h UTC→ET.*

## The story in one line
Last week was down, this week was up. NQ fell harder and bounced harder. The move started overnight (Asia + Europe), New York just finished it.

## 5 patterns anyone can use

**1. Overnight sets the test for New York.**
- Every night (18:00-09:30 ET) the market makes a high (ONH) and low (ONL) while you sleep.
- Next day, New York almost always *touches* one of those levels first, then decides to break through or bounce off.
- Last week: ES ONH 7824 / ONL 7661 — NY broke *below* ONL and stayed down. This week: ES ONL 7655 held and NY bounced.
- *Simple rule:* Before the open, note ONH/ONL. If NY opens near ONH and holds above, stay long. If it rejects ONH, fade back toward the middle.

**2. Europe (03:00-09:30 ET) is the bias setter, not Asia.**
- Asia (18:00-03:00) is thin. Europe is where volume doubles and direction is chosen.
- Last week Europe was the weakest session (ES -0.94%, NQ -2.29% overall; NQ Europe -3.37% last week alone). This week Europe was strongest (NQ +1.59%).
- *Simple rule:* Check 03:00-09:30. If Europe is green and pushing highs, lean long into NY open. If Europe is red and making lows, lean short.

**3. When Asia and Europe agree, New York follows. When they fight, New York chops.**
- Last week Asia -1.78% and Europe -1.78% (ES) — both down → NY down -1.44% (trend).
- This week Asia +0.79% and Europe +0.95% — both up → NY up +0.58% (trend).
- If Asia up, Europe down (or vice versa) → expect a choppy NY that fakes both sides → smaller size, wait for the 10:00 break.
- *Simple rule:* Two greens = trend, mixed colors = chop.

**4. NY does the work, overnight sets the levels.**
- NY is 65-67% of daily volume (ES 9.7M vs overnight 3.1M; NQ 3.9M vs 1.9M). But the *range* is only ~60% of the day.
- Translation: you get cleaner fills in NY, but the *levels* you trade *to* were made overnight.
- *Simple rule:* Plan overnight, execute in NY (09:30-11:30 and 15:00-16:00 are best; 12:00-13:00 is lunch-thin; 17:00-18:00 is dead).

**5. NQ is just a louder ES. ES is cleaner, NQ is bigger.**
- Close correlation 0.88 overall, 0.99 this week when trending, 0.81 last week when selling (they diverge when stressed).
- NQ moves ~1.6-1.8× ES (Fig3: NY range ES 0.57% vs NQ 0.98%). Beta(ES|NQ) ~0.49 = NQ is ~2× ES.
- 2-week ES -0.60% vs NQ -2.01% — ES held up better.
- *Simple rule:* Want same idea with more punch? Use NQ but use 60-70% wider stop. Want calmer? Use ES. Don't double-count — they are the same bet.

## Weekly comparison in plain numbers

|  | Last week (08/17-22) | This week (08/24-28) | What changed |
|---|---|---|---|
| ES | -1.00% | +0.68% (+1.68pp) | Bear → bounce |
| NQ | -2.35% | +1.33% (+3.68pp) | Tech led both ways |
| Corr | 0.81 | 0.99 | Moves synced this week |

## Monday checklist (do this before 09:30 ET)

1. Write down ONH/ONL (ES 7824.5/7655, NQ 30343/28946 for the window; update Friday close).
2. Check Europe 03:00-09:30 color + high/low. That's your bias.
3. Decide: both sessions green/red → trend size; mixed → small size / fade the open.
4. Set stops: NQ ~1.6× ES width. Trail below Europe low (longs) / above Europe high (shorts).

*Caveat:* This is 10 trading days only. These are tendencies, not guarantees. Use yfinance `ES=F`/`NQ=F` 1h to re-check next week with `python scripts/eda_futures.py --start YYYY-MM-DD --end YYYY-MM-DD` — no code change needed.
