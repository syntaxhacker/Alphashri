# GEX call-wall fade — data inventory & backtest

**Scope:** what historical data actually exists in the local MotiveWave store and on
Unusual Whales, and whether a GEX-conditioned "call wall fade" (plus its non-GEX
cousins) has any testable edge.

**Bottom line up front**

- The MotiveWave **tick** store is thin: for MNQ there are only **2 near-complete
  sessions** (2026-09-28, 2026-09-29). 121 calendar days contain *some* ticks, but
  almost all are 1–4 one-hour blocks. The user's belief that they have "a lot" of
  tick data is **wrong**.
- The **1-minute bar** store is deep: a front-month continuous MNQ series is dense
  from **2023-10-31 to 2026-09-29** (738 full 1,380-bar sessions, 1.02 M bars).
  That is the real asset.
- The premise that "GEX is not retrospectively testable" is **false**. UW's
  `/api/stock/NDX/gex-levels` and `/api/stock/NDX/spot-exposures` **both accept
  `?date=YYYY-MM-DD`** and serve history back to **2023-10-30** (730 trading days).
  Historical GEX *is* available.
- Tested with prior-day levels (no look-ahead), the wall fade **loses badly**:
  548 trades, 63.7 % win rate, **−24.1 net points/trade, −13,202 points total
  (−$26,403 per contract)**. Even the *leaky* same-day-levels variant is only
  ~breakeven. The high win rate masks large losses (negative skew).
- Every non-GEX mean-reversion variant also loses. The only positive series is
  buy-and-hold RTH, which is just 2024–2026 Nasdaq beta.

---

## A. Data inventory

Full generated inventory (every instrument, every bar size): `mw_inventory.md`
appended below. Headline numbers:

- **Disk:** 1.59 GB across 3,680 files (`~/.motivewave/historical_data/`).
- **Ticks:** 23,002,798 ticks in 1,697 blocks (644 plain `.tick_data` + 1,053
  `.tick_data.zip`), 40 empty blocks, 1.45 GB.
- **Bars:** 1 m: 1,507 files / 4,034,842 bars · 5 m: 340 / 955,048 · 30 m: 74 /
  190,751 · 1440 m: 60 / 28,967. Bar files span **2019-08 → 2026-09** per contract.
- **Sources:** `RITHMIC/` (live capture, 513 MB), `CQG/` (backfill, 1.01 GB),
  `BINANCE/` (3.4 MB crypto).

### A.1 Ticks per instrument (UTC)

| source/instrument | plain | zip | blocks | ticks | empty | first tick (UTC) | last tick (UTC) |
|---|---:|---:|---:|---:|---:|---|---|
| CQG/ENQU26 | 0 | 150 | 150 | 1,309,158 | 0 | 2026-03-30 04:00 | 2026-09-18 05:59 |
| CQG/EPU26 | 0 | 150 | 150 | 2,719,802 | 0 | 2026-03-30 04:00 | 2026-09-18 05:59 |
| **CQG/MNQU26** | 0 | 150 | 150 | **6,677,954** | 0 | 2026-03-30 04:00 | 2026-09-18 05:59 |
| RITHMIC/ESZ6.CME | 65 | 155 | 220 | 3,066,170 | 0 | 2026-04-08 15:00 | 2026-09-29 20:59 |
| RITHMIC/MESZ6.CME | 41 | 149 | 190 | 1,206,029 | 2 | 2026-04-01 11:00 | 2026-09-29 20:59 |
| **RITHMIC/MNQZ6.CME** | 65 | 155 | 220 | **5,531,151** | 0 | 2026-04-01 11:00 | 2026-09-29 20:59 |
| RITHMIC/NQZ6.CME | 65 | 144 | 209 | 1,442,807 | 0 | 2026-04-28 14:00 | 2026-09-29 20:59 |
| RITHMIC/CLX6.NYMEX | 33 | 0 | 33 | 226,024 | 2 | 2026-09-22 21:00 | 2026-09-29 20:59 |
| RITHMIC/MCLX6.NYMEX | 34 | 0 | 34 | 192,545 | 2 | 2026-09-22 21:00 | 2026-09-29 20:59 |
| RITHMIC/MYMZ6.CBOT | 31 | 0 | 31 | 112,994 | 2 | 2026-09-22 21:00 | 2026-09-29 20:59 |
| RITHMIC/M2KZ6.CME | 33 | 0 | 33 | 82,014 | 2 | 2026-09-22 21:00 | 2026-09-29 20:59 |
| RITHMIC/NGX26.NYMEX | 7 | 0 | 7 | 45,072 | 0 | 2026-09-29 11:00 | 2026-09-29 20:59 |
| RITHMIC/MGCZ6.COMEX | 2 | 0 | 2 | 33,552 | 0 | 2026-09-23 12:00 | 2026-09-23 13:45 |
| RITHMIC/NGV26.NYMEX | 17 | 0 | 17 | 15,856 | 1 | 2026-09-22 21:00 | 2026-09-28 15:12 |
| RITHMIC/EMDZ6.CME | 21 | 0 | 21 | 9,974 | 2 | 2026-09-22 21:00 | 2026-09-29 20:57 |
| RITHMIC/QMX6.NYMEX | 22 | 0 | 22 | 4,653 | 1 | 2026-09-22 21:00 | 2026-09-29 20:59 |
| RITHMIC/HOV6.NYMEX | 22 | 0 | 22 | 3,893 | 1 | 2026-09-22 21:00 | 2026-09-29 20:51 |
| RITHMIC/RBV6.NYMEX | 22 | 0 | 22 | 2,425 | 1 | 2026-09-22 21:00 | 2026-09-29 20:59 |
| RITHMIC/NKDZ6.CME | 22 | 0 | 22 | 2,087 | 1 | 2026-09-22 21:00 | 2026-09-29 20:58 |
| RITHMIC/MNGV6.NYMEX | 15 | 0 | 15 | 2,035 | 1 | 2026-09-22 21:00 | 2026-09-23 20:57 |
| RITHMIC/MNGX6.NYMEX | 7 | 0 | 7 | 1,774 | 0 | 2026-09-28 14:00 | 2026-09-29 20:59 |
| RITHMIC/QGX6.NYMEX | 7 | 0 | 7 | 408 | 0 | 2026-09-28 14:00 | 2026-09-29 20:58 |
| RITHMIC/QGV6.NYMEX | 14 | 0 | 14 | 278 | 1 | 2026-09-22 21:00 | 2026-09-23 20:57 |
| BINANCE/BTCUSDT | 19 | 0 | 19 | 30,558 | 16 | 2026-09-18 00:00 | 2026-09-18 18:42 |

**Every non-MNQ tick stream is ≤ 6 calendar days long.** The 172-day "span" of the
CQG rows is an artifact of sparse one-hour blocks, not contiguous coverage.

### A.2 MNQ tick coverage (what the user trades)

| source/contract | ticks | distinct UTC days | first (UTC) | last (UTC) |
|---|---:|---:|---|---|
| CQG/MNQU26 | 6,677,954 | 113 | 2026-03-30 04:00 | 2026-09-18 05:59 |
| RITHMIC/MNQZ6.CME | 5,531,151 | 104 | 2026-04-01 11:00 | 2026-09-29 20:59 |

- **121** combined calendar days contain at least one hourly block.
- **2** days have a near-complete session (≥ 15 hourly blocks): **2026-09-28** (25
  blocks) and **2026-09-29** (21 blocks).
- All other days have **1–4** blocks. There are 114+ gaps > 1 h in the RITHMIC
  stream. The data is *not* contiguous; it is a handful of hours scattered across
  six months plus two full sessions at the end.

### A.3 Bars (deep history lives here)

| bar size | files | bars |
|---|---:|---:|
| 1 m | 1,507 | 4,034,842 |
| 5 m | 340 | 955,048 |
| 30 m | 74 | 190,751 |
| 1,440 m (daily) | 60 | 28,967 |

Per-contract 1-minute data exists from **MNQH20 (2019)** through **MNQU26 (2026)**;
CQG backfills each contract's full life but it is only dense in the ~6 months before
expiry. Rolling to the nearest-expiry contract per day produces a **dense
front-month continuous MNQ 1-minute series**:

- range **2023-10-31 → 2026-09-29**,
- **738 sessions** with a near-full 1,380-bar (23 h) session (≥ 1,000 bars),
- median 1,380 bars/day, **1,016,802** bars in the window.

The full per-instrument bar table (including ES/NQ/MES/CL/GC/… and all contract
months) is in the appendix.

### A.4 Is the tick store still being written?

Sampled the newest RITHMIC MNQ block twice, 10 s apart, at 2026-09-29 21:16 UTC
(02:46 IST 2026-09-30):

```json
{"instrument":"MNQZ6.CME","block":"1790712000000.tick_data",
 "count_t0":25968,"count_t1":25968,
 "last_ts_t0":"2026-09-29 20:59:58","last_ts_t1":"2026-09-29 20:59:58",
 "changed_over_10.0s":false,"file_mtime_age_s":208.4}
```

The file had been modified 208 s earlier but did not change over the 10 s sample
because the session had just closed (16:00 ET = 20:00 UTC; the block holds
post-close ticks to 20:59:58). During market hours the writer is live — the two
final sessions (09-28, 09-29) each filled ~20–25 hourly blocks.

---

## B. Is GEX retrospectively testable? — Yes (the brief was wrong)

Evidence gathered:

1. **Schema check (confirms the negative half):** `unusual_whales/data/alerts.db`
   contains a single `alerts` table with no gamma/GEX/greek columns. The repo has
   never persisted GEX snapshots.
2. **Endpoint check (overturns the premise):** `docs/endpoints.json` lists
   `/api/stock/{ticker}/gex-levels`, `/api/stock/{ticker}/spot-exposures` ("Spot GEX
   exposures per 1min"), and per-strike variants. Reading `docs/openapi.yaml`
   (`Optional_Market_Date`, "by default the last trading date") shows **all accept a
   `?date=YYYY-MM-DD` query param**.
3. **Empirical check:** live calls returned historical rows:
   - `GET /api/stock/NDX/gex-levels?date=2026-06-15` → `call_wall 32800`,
     `put_wall 29450`, `gamma_flip 30523.59`, `gamma_magnet 29450`.
   - `GET /api/stock/NDX/spot-exposures?date=2026-09-24` → **391 per-minute rows**
     (13:30–20:00 UTC) with NDX price + net gamma per minute.
   - History floor: a 2022 date returned
     `historic_data_access_missing` — "earliest date currently available to this
     token is **2023-10-30** (730 trading days)".
4. **Warmed cache:** fetched **761 weekdays** (2023-10-31 → 2026-09-29):
   - 703 sessions with intraday `spot-exposures` price,
   - 682 sessions with `vol`-source levels; the other 166 were backfilled with
     `source=oi` (the `vol` source returns `call_wall: null` before ~2024-07).
   - API budget used: ~1,600 calls, 11,801 of 40,000/day remaining.

**Caveat:** `/gex-levels` is an **end-of-day** snapshot (`time` ≈ 20:14 UTC), so the
levels for day *D* are only finalised after *D*'s close. A leak-free intraday rule
must use day *D−1*'s levels. The per-strike endpoint is daily (not per-minute), so a
true *developing* intraday wall cannot be reconstructed retroactively — it must be
logged live going forward.

---

## C. Backtest

Mechanics (all tests): MNQ = $2.00/point; round-trip cost = $1 commission +
$1 slippage = **1.0 point**; entry at the trigger bar close (bars) or the first
breaching tick (ticks); exits checked on every subsequent bar/tick; when a bar's
range spans both stop and target the **STOP** is assumed.

### C.1 GEX call-wall / put-wall fade (NDX, prior-day levels) — primary test

703 sessions, 2023-12-08 → 2026-09-29. Call wall touched in 389 sessions (55 %),
put wall in 324 (46 %). Rule: short after price trades above the prior call wall
and prints back below it; long mirror at the prior put wall; target = prior
`gamma_magnet` (fallback flip); stop = failure extreme + buffer; EOD exit.

| variant | trades | win rate | avg net pts | total net pts | total $/contract | worst DD (pts) | avg win | avg loss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **prior-day (honest)** | 548 | 63.7 % | **−24.09** | **−13,201.7** | **−$26,403** | 13,403 | +28.2 | −115.8 |
| same-day levels (**leaky**) | 734 | 74.0 % | +1.44 | +1,057.4 | +$2,115 | 3,666 | +36.4 | −97.8 |

Side split (prior-day): short 279 trades, 63.4 % win, −20.3 avg; long 269 trades,
63.9 % win, −28.0 avg. **Both sides lose.** 187 of 374 traded sessions were net
positive — no better than a coin flip after the fat losses.

Same-day levels are computed *after* the close; the fact that even this look-ahead
variant is only ~breakeven is the strongest single piece of evidence that the fade
has no edge — the leak buys you nothing.

#### Stop sensitivity (prior-day levels, buffer in points)

| buffer | 8 | 12 | 15 | 20 | 25 | 30 | 40 | 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| win rate | 62.8 % | 63.7 % | 63.7 % | 63.7 % | 65.0 % | 65.5 % | 66.4 % | 67.3 % |
| avg net pts | −23.9 | −23.3 | −24.1 | −25.1 | −24.4 | −24.8 | −25.6 | −25.7 |
| total net pts | −13,074 | −12,773 | −13,202 | −13,742 | −13,355 | −13,585 | −14,048 | −14,068 |

Widening the stop raises the win rate but **monotonically worsens P&L** — the classic
signature of no edge plus negative skew. The naive "failure extreme + buffer" stop is
also **unbounded**: a single 2025-11-20 short was stopped −1,286 points because price
had run ~1,270 points above the wall before closing back below it.

#### Bounded-stop / excursion-filtered variants

| max stop / max excursion | trades | win rate | avg net pts | total net pts | worst DD |
|---|---:|---:|---:|---:|---:|
| 25 / 25 | 160 | 38.1 % | −3.86 | −617 | 1,031 |
| 40 / 40 | 212 | 44.3 % | −8.74 | −1,852 | 2,141 |
| 40 / 60 | 260 | 44.6 % | −8.41 | −2,185 | 2,538 |
| 60 / 80 | 291 | 51.2 % | −10.50 | −3,055 | 3,440 |

Capping risk removes the tail but the rule still loses in every configuration.

### C.2 Non-GEX overnight-value mean reversion (MNQ front-month 1-minute bars)

739 sessions, 2023-10-31 → 2026-09-29. Overnight value area (POC/VAH/VAL, 5-pt
bins) from the prior 18:00 ET → 09:30 ET window; failed-breakout entries during RTH
(09:30–16:00 ET); EOD exit.

| target | trades | win rate | avg net pts | total net pts | total $/contract | worst DD |
|---|---:|---:|---:|---:|---:|---:|
| POC | 1,048 | 59.4 % | −2.36 | −2,470 | −$4,940 | 3,031 |
| VWAP | 1,048 | 58.3 % | −2.92 | −3,055 | −$6,109 | 3,165 |
| opposite edge | 1,048 | 40.5 % | −4.87 | −5,103 | −$10,205 | 5,497 |

Side split (POC): short 536 trades 58.6 % win −1.68 avg; long 512 trades 60.4 % win
−3.07 avg. Capped-excursion variants (20/30/40/60 pts) still lose (−734 → −1,531
total). Stop sweep again worsens with width.

#### Baselines

| baseline | trades | win rate | avg net pts | total net pts | total $/contract | worst DD | avg MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| Buy & hold RTH | 739 | 53.0 % | +4.39 | +3,246.5 | +$6,493 | 4,360 | 159.8 |
| Random entry, ±15 stop/target | 2,217 | 49.0 % | −1.23 | −2,715 | −$5,430 | 2,757 | 13.2 |

Buy-and-hold made money purely from the 2024–2026 Nasdaq uptrend, with a 4,360-pt
drawdown and 160-pt average adverse excursion. The random baseline loses roughly the
cost drag, as expected. **No tested mean-reversion rule beats the random baseline.**

### C.3 Tick-level fidelity check (real MNQ ticks, CVD filter)

Only **2** sessions clear a 100 k RTH-tick threshold (2026-09-28, 2026-09-29), so
this is an anecdote, not a sample. Overnight value from bars, execution on the tick
path; CVD = aggressor-signed volume (`is_ask` → +size) over the 60 s into the entry.

| variant | trades | win rate | total net pts | $/contract |
|---|---:|---:|---:|---:|
| tick failed-breakout (all) | 4 | 50 % | +72.5 | +$145 |
| same, only when CVD agrees | 1 | 0 % | −66.3 | −$133 |
| buy & hold (tick sessions) | 2 | 0 % | −245.5 | −$491 |

Per session: 2026-09-28 −85 pts (both trades stopped), 2026-09-29 +157.5 pts (both
targets). The CVD filter kept exactly one trade and it lost. Nothing here is
statistically meaningful.

---

## D. Leakage / validity notes

- **GEX levels:** the prior-day variant uses only day *D−1*'s EOD levels → no
  look-ahead. The same-day variant is explicitly labelled leaky and shown only to
  quantify how little the leak is worth.
- **Value area / VWAP:** computed only from bars at or before the entry minute.
- **Front-month roll:** nearest-expiry contract with expiry > date (expiry is known
  ex ante). Real desks roll ~8 days before expiry; this simplification is noted.
- **Fill model:** entries at bar close / first breaching tick; ambiguous bars resolve
  to the stop. No intrabar tick reconstruction on bar tests, so bar-based results are
  *approximate* — but the sign is so consistently negative that the approximation is
  not doing the work.
- **NDX vs MNQ:** levels and intraday price are both NDX cash, so the test is
  self-consistent. Point *distances* transfer 1:1 to MNQ; absolute levels differ by
  the futures basis (~+290 pts in Sep-2026).
- **Survivorship/regime:** the bar window is a single strong bull market; buy-and-hold
  positive is beta, not alpha.

---

## E. Conclusions (blunt)

**What is real**

- MNQ **1-minute** history is genuinely deep: a dense front-month series from Oct-2023
  to Sep-2026 (738 full sessions). 5 m / 30 m / daily are available per contract from
  2019. This is enough to test intraday rules with real statistical power.
- Historical GEX *is* retrievable (gex-levels + per-minute spot-exposures, 730
  trading days). The "no history" assumption in the task brief is incorrect.
- The **walls are not reliable reversal points**: the call wall was breached in 55 %
  of sessions and the put wall in 46 %.

**What is noise**

- The tick store. 2 usable sessions cannot support any conclusion. Every "edge" seen
  in the tick test (or its CVD filter) is a coin flip on 2–4 trades.
- The 60 %+ win rates everywhere. They come with −$100+ average losses; win rate is
  meaningless here.

**What cannot be known yet**

- Whether a *bounded*, *regime-filtered* fade (only when net gamma is short / price
  is below the flip, hard stop, wall not already blown through) has an edge. The
  naive rule loses; the conditioned rule is untested.
- Any real-time *developing* wall — the per-strike data is daily, so intraday wall
  evolution must be captured live.

**Single most important next step**

Stop looking for edge in the naive fade — it is negative across every stop, target
and cap tested. Instead: **persist an intraday GEX-levels snapshot** (the dashboard
already polls `/gex-levels`; log it every 1–5 min with a timestamp) so a
*no-look-ahead, developing-wall* rule can be tested, and re-run the fade with (a) a
hard stop cap, (b) a wall-distance filter, and (c) a net-gamma regime filter. Also
begin accumulating MNQ ticks continuously — the 2-day tick sample is the binding
constraint on any microstructure claim.

---

## Appendix — full generated inventory


<!-- generated by scripts/backtest/mw_inventory.py -->
# MotiveWave local data inventory

Root: `/home/mysyntax/.motivewave/historical_data`  
Total on disk: **1.59 GB** across 3680 files  
Generated (UTC): 2026-09-29 21:15:41

## Ticks

| source/instrument | plain | zip | blocks | ticks | empty | first tick (UTC) | last tick (UTC) | span |
|---|---:|---:|---:|---:|---:|---|---|---|
| BINANCE/BTCUSDT | 19 | 0 | 19 | 30,558 | 16 | 2026-09-18 00:00:00 | 2026-09-18 18:42:34 | 18:42:34.734000 |
| CQG/ENQU26 | 0 | 150 | 150 | 1,309,158 | 0 | 2026-03-30 04:00:00 | 2026-09-18 05:59:27 | 172 days, 1:59:27.084000 |
| CQG/EPU26 | 0 | 150 | 150 | 2,719,802 | 0 | 2026-03-30 04:00:00 | 2026-09-18 05:59:27 | 172 days, 1:59:27.280000 |
| CQG/MNQU26 | 0 | 150 | 150 | 6,677,954 | 0 | 2026-03-30 04:00:00 | 2026-09-18 05:59:59 | 172 days, 1:59:59.632000 |
| RITHMIC/CLX6.NYMEX | 33 | 0 | 33 | 226,024 | 2 | 2026-09-22 21:00:00 | 2026-09-29 20:59:56 | 6 days, 23:59:56.963000 |
| RITHMIC/EMDZ6.CME | 21 | 0 | 21 | 9,974 | 2 | 2026-09-22 21:00:00 | 2026-09-29 20:57:45 | 6 days, 23:57:45.001000 |
| RITHMIC/ESZ6.CME | 65 | 155 | 220 | 3,066,170 | 0 | 2026-04-08 15:00:00 | 2026-09-29 20:59:56 | 174 days, 5:59:56.982000 |
| RITHMIC/HOV6.NYMEX | 22 | 0 | 22 | 3,893 | 1 | 2026-09-22 21:00:00 | 2026-09-29 20:51:04 | 6 days, 23:51:04.114000 |
| RITHMIC/M2KZ6.CME | 33 | 0 | 33 | 82,014 | 2 | 2026-09-22 21:00:00 | 2026-09-29 20:59:57 | 6 days, 23:59:57.772000 |
| RITHMIC/MCLX6.NYMEX | 34 | 0 | 34 | 192,545 | 2 | 2026-09-22 21:00:00 | 2026-09-29 20:59:57 | 6 days, 23:59:57.963000 |
| RITHMIC/MESZ6.CME | 41 | 149 | 190 | 1,206,029 | 2 | 2026-04-01 11:00:00 | 2026-09-29 20:59:57 | 181 days, 9:59:57.991000 |
| RITHMIC/MGCZ6.COMEX | 2 | 0 | 2 | 33,552 | 0 | 2026-09-23 12:00:00 | 2026-09-23 13:45:14 | 1:45:14.800000 |
| RITHMIC/MNGV6.NYMEX | 15 | 0 | 15 | 2,035 | 1 | 2026-09-22 21:00:00 | 2026-09-23 20:57:11 | 23:57:11.054000 |
| RITHMIC/MNGX6.NYMEX | 7 | 0 | 7 | 1,774 | 0 | 2026-09-28 14:00:00 | 2026-09-29 20:59:30 | 1 day, 6:59:29.568000 |
| RITHMIC/MNQZ6.CME | 65 | 155 | 220 | 5,531,151 | 0 | 2026-04-01 11:00:00 | 2026-09-29 20:59:58 | 181 days, 9:59:58.093000 |
| RITHMIC/MYMZ6.CBOT | 31 | 0 | 31 | 112,994 | 2 | 2026-09-22 21:00:00 | 2026-09-29 20:59:56 | 6 days, 23:59:56.627000 |
| RITHMIC/NGV26.NYMEX | 17 | 0 | 17 | 15,856 | 1 | 2026-09-22 21:00:00 | 2026-09-28 15:12:51 | 5 days, 18:12:51.244000 |
| RITHMIC/NGX26.NYMEX | 7 | 0 | 7 | 45,072 | 0 | 2026-09-29 11:00:00 | 2026-09-29 20:59:54 | 9:59:54.294000 |
| RITHMIC/NKDZ6.CME | 22 | 0 | 22 | 2,087 | 1 | 2026-09-22 21:00:00 | 2026-09-29 20:58:29 | 6 days, 23:58:29.222000 |
| RITHMIC/NQZ6.CME | 65 | 144 | 209 | 1,442,807 | 0 | 2026-04-28 14:00:00 | 2026-09-29 20:59:58 | 154 days, 6:59:58.774000 |
| RITHMIC/QGV6.NYMEX | 14 | 0 | 14 | 278 | 1 | 2026-09-22 21:00:00 | 2026-09-23 20:57:53 | 23:57:53.971000 |
| RITHMIC/QGX6.NYMEX | 7 | 0 | 7 | 408 | 0 | 2026-09-28 14:00:00 | 2026-09-29 20:58:26 | 1 day, 6:58:26.630000 |
| RITHMIC/QMX6.NYMEX | 22 | 0 | 22 | 4,653 | 1 | 2026-09-22 21:00:00 | 2026-09-29 20:59:47 | 6 days, 23:59:47.994000 |
| RITHMIC/RBV6.NYMEX | 22 | 0 | 22 | 2,425 | 1 | 2026-09-22 21:00:00 | 2026-09-29 20:59:58 | 6 days, 23:59:58.204000 |
| RITHMIC/RTYZ6.CME | 30 | 0 | 30 | 178,590 | 2 | 2026-09-22 21:00:00 | 2026-09-29 20:59:56 | 6 days, 23:59:56.550000 |
| RITHMIC/SIZ6.COMEX | 20 | 0 | 20 | 28,927 | 1 | 2026-09-23 12:00:00 | 2026-09-29 20:59:41 | 6 days, 8:59:41.014000 |
| RITHMIC/YMZ6.CBOT | 30 | 0 | 30 | 76,068 | 2 | 2026-09-22 21:00:00 | 2026-09-29 20:59:55 | 6 days, 23:59:55.501000 |

**Tick totals:** 23,002,798 ticks in 1,697 blocks (644 plain / 1,053 zip), 40 empty blocks, 1.45 GB.

## Bars

| source/instrument | bar size | files | bars | first (UTC) | last (UTC) | span |
|---|---:|---:|---:|---|---|---|
| BINANCE/BCHBTC | 1m | 2 | 6,737 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/BCHBTC | 5m | 1 | 2,098 | 2026-09-15 21:35:00 | 2026-09-23 04:20:00 | 7 days, 6:45:00 |
| BINANCE/BCHBTC | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/BCHUSDT | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/BCHUSDT | 5m | 1 | 3,267 | 2026-09-11 20:10:00 | 2026-09-23 04:20:00 | 11 days, 8:10:00 |
| BINANCE/BCHUSDT | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/BTCEUR | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/BTCEUR | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/BTCUSDT | 1m | 2 | 7,684 | 2026-09-16 00:42:00 | 2026-09-23 04:32:00 | 7 days, 3:50:00 |
| BINANCE/BTCUSDT | 5m | 1 | 3,271 | 2026-09-11 19:50:00 | 2026-09-23 04:20:00 | 11 days, 8:30:00 |
| BINANCE/BTCUSDT | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/ETHBTC | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/ETHBTC | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/ETHEUR | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/ETHEUR | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/ETHUSDT | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/ETHUSDT | 5m | 1 | 2,098 | 2026-09-15 21:35:00 | 2026-09-23 04:20:00 | 7 days, 6:45:00 |
| BINANCE/ETHUSDT | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/LTCBTC | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/LTCBTC | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/LTCUSDT | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/LTCUSDT | 5m | 1 | 2,098 | 2026-09-15 21:35:00 | 2026-09-23 04:20:00 | 7 days, 6:45:00 |
| BINANCE/LTCUSDT | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/XRPBTC | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/XRPBTC | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/XRPEUR | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/XRPEUR | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| BINANCE/XRPUSDT | 1m | 2 | 6,742 | 2026-09-16 16:24:00 | 2026-09-23 04:32:00 | 6 days, 12:08:00 |
| BINANCE/XRPUSDT | 5m | 1 | 2,098 | 2026-09-15 21:35:00 | 2026-09-23 04:20:00 | 7 days, 6:45:00 |
| BINANCE/XRPUSDT | 1440m | 1 | 1,004 | 2023-12-24 00:00:00 | 2026-09-22 00:00:00 | 1003 days, 0:00:00 |
| CQG/ENQH26 | 1440m | 1 | 374 | 2024-09-18 22:00:00 | 2026-03-17 22:00:00 | 545 days, 0:00:00 |
| CQG/ENQM26 | 1440m | 1 | 373 | 2024-12-18 23:00:00 | 2026-06-15 22:00:00 | 543 days, 23:00:00 |
| CQG/ENQU26 | 1m | 48 | 118,924 | 2025-10-20 19:59:00 | 2026-09-17 03:59:00 | 331 days, 8:00:00 |
| CQG/ENQU26 | 5m | 12 | 29,224 | 2025-10-20 19:55:00 | 2026-09-17 03:55:00 | 331 days, 8:00:00 |
| CQG/ENQU26 | 30m | 3 | 5,999 | 2025-10-20 19:30:00 | 2026-09-17 03:30:00 | 331 days, 8:00:00 |
| CQG/ENQU26 | 1440m | 1 | 376 | 2025-03-19 22:00:00 | 2026-09-15 22:00:00 | 545 days, 0:00:00 |
| CQG/ENQZ26 | 1440m | 1 | 882 | 2023-03-20 22:00:00 | 2026-09-21 22:00:00 | 1281 days, 0:00:00 |
| CQG/EPH26 | 1440m | 1 | 648 | 2023-08-17 22:00:00 | 2026-03-17 22:00:00 | 943 days, 0:00:00 |
| CQG/EPM26 | 1440m | 1 | 710 | 2023-08-17 22:00:00 | 2026-06-15 22:00:00 | 1033 days, 0:00:00 |
| CQG/EPU26 | 1m | 48 | 121,379 | 2025-10-20 05:50:00 | 2026-09-17 03:59:00 | 331 days, 22:09:00 |
| CQG/EPU26 | 5m | 12 | 30,358 | 2025-10-20 05:50:00 | 2026-09-17 03:55:00 | 331 days, 22:05:00 |
| CQG/EPU26 | 30m | 3 | 6,427 | 2025-10-20 05:30:00 | 2026-09-17 03:30:00 | 331 days, 22:00:00 |
| CQG/EPU26 | 1440m | 1 | 773 | 2023-08-17 22:00:00 | 2026-09-15 22:00:00 | 1125 days, 0:00:00 |
| CQG/EPZ26 | 1440m | 1 | 883 | 2023-03-20 22:00:00 | 2026-09-21 22:00:00 | 1281 days, 0:00:00 |
| CQG/MESH26 | 1440m | 1 | 318 | 2024-12-08 23:00:00 | 2026-03-17 22:00:00 | 463 days, 23:00:00 |
| CQG/MESM26 | 1440m | 1 | 321 | 2025-03-09 22:00:00 | 2026-06-15 22:00:00 | 463 days, 0:00:00 |
| CQG/MESU26 | 1m | 48 | 137,848 | 2025-10-20 19:59:00 | 2026-09-17 03:59:00 | 331 days, 8:00:00 |
| CQG/MESU26 | 5m | 12 | 35,139 | 2025-10-20 19:55:00 | 2026-09-17 03:55:00 | 331 days, 8:00:00 |
| CQG/MESU26 | 30m | 3 | 7,079 | 2025-10-20 19:30:00 | 2026-09-17 03:30:00 | 331 days, 8:00:00 |
| CQG/MESU26 | 1440m | 1 | 321 | 2025-06-08 22:00:00 | 2026-09-15 22:00:00 | 464 days, 0:00:00 |
| CQG/MESZ26 | 1440m | 1 | 263 | 2025-09-07 22:00:00 | 2026-09-21 22:00:00 | 379 days, 0:00:00 |
| CQG/MNQH20 | 1m | 31 | 94,536 | 2019-08-23 16:02:00 | 2020-03-20 03:55:00 | 209 days, 11:53:00 |
| CQG/MNQH20 | 5m | 8 | 21,244 | 2019-08-23 16:00:00 | 2020-03-20 03:55:00 | 209 days, 11:55:00 |
| CQG/MNQH20 | 30m | 2 | 4,564 | 2019-08-23 16:00:00 | 2020-03-20 03:30:00 | 209 days, 11:30:00 |
| CQG/MNQH20 | 1440m | 2 | 224 | 2019-05-06 00:00:00 | 2020-03-19 07:00:00 | 318 days, 7:00:00 |
| CQG/MNQH21 | 1m | 44 | 116,506 | 2020-05-20 20:14:00 | 2021-03-16 03:59:00 | 299 days, 7:45:00 |
| CQG/MNQH21 | 5m | 11 | 30,159 | 2020-05-20 20:10:00 | 2021-03-16 03:55:00 | 299 days, 7:45:00 |
| CQG/MNQH21 | 30m | 3 | 6,150 | 2020-05-20 20:00:00 | 2021-03-16 03:30:00 | 299 days, 7:30:00 |
| CQG/MNQH21 | 1440m | 2 | 310 | 2019-12-19 05:00:00 | 2021-03-15 04:00:00 | 451 days, 23:00:00 |
| CQG/MNQH22 | 1m | 45 | 118,862 | 2021-05-03 15:12:00 | 2022-03-16 03:59:00 | 316 days, 12:47:00 |
| CQG/MNQH22 | 5m | 11 | 29,825 | 2021-05-03 15:10:00 | 2022-03-16 03:55:00 | 316 days, 12:45:00 |
| CQG/MNQH22 | 30m | 3 | 6,000 | 2021-05-03 15:00:00 | 2022-03-16 03:30:00 | 316 days, 12:30:00 |
| CQG/MNQH22 | 1440m | 1 | 312 | 2020-12-17 05:00:00 | 2022-03-14 04:00:00 | 451 days, 23:00:00 |
| CQG/MNQH23 | 1m | 49 | 128,499 | 2022-04-11 19:59:00 | 2023-03-14 03:59:00 | 336 days, 8:00:00 |
| CQG/MNQH23 | 5m | 12 | 32,839 | 2022-04-11 19:55:00 | 2023-03-14 03:55:00 | 336 days, 8:00:00 |
| CQG/MNQH23 | 30m | 3 | 6,359 | 2022-04-11 19:30:00 | 2023-03-14 03:30:00 | 336 days, 8:00:00 |
| CQG/MNQH23 | 1440m | 1 | 310 | 2021-12-16 05:00:00 | 2023-03-13 04:00:00 | 451 days, 23:00:00 |
| CQG/MNQH24 | 1m | 49 | 133,811 | 2023-04-10 19:59:00 | 2024-03-14 03:59:00 | 338 days, 8:00:00 |
| CQG/MNQH24 | 5m | 12 | 33,935 | 2023-04-10 19:55:00 | 2024-03-14 03:55:00 | 338 days, 8:00:00 |
| CQG/MNQH24 | 30m | 3 | 6,841 | 2023-04-10 19:30:00 | 2024-03-14 03:30:00 | 338 days, 8:00:00 |
| CQG/MNQH24 | 1440m | 1 | 313 | 2022-12-14 05:00:00 | 2024-03-12 22:00:00 | 454 days, 17:00:00 |
| CQG/MNQH25 | 1m | 48 | 136,888 | 2024-04-22 19:59:00 | 2025-03-20 03:59:00 | 331 days, 8:00:00 |
| CQG/MNQH25 | 5m | 12 | 35,312 | 2024-04-22 19:55:00 | 2025-03-20 03:55:00 | 331 days, 8:00:00 |
| CQG/MNQH25 | 30m | 3 | 7,168 | 2024-04-22 19:30:00 | 2025-03-20 03:30:00 | 331 days, 8:00:00 |
| CQG/MNQH25 | 1440m | 1 | 324 | 2023-12-03 23:00:00 | 2025-03-18 22:00:00 | 470 days, 23:00:00 |
| CQG/MNQH26 | 1m | 48 | 140,788 | 2025-04-21 14:06:00 | 2026-03-19 03:59:00 | 331 days, 13:53:00 |
| CQG/MNQH26 | 5m | 12 | 34,951 | 2025-04-21 14:05:00 | 2026-03-19 03:55:00 | 331 days, 13:50:00 |
| CQG/MNQH26 | 30m | 3 | 6,918 | 2025-04-21 14:00:00 | 2026-03-19 03:30:00 | 331 days, 13:30:00 |
| CQG/MNQH26 | 1440m | 1 | 318 | 2024-12-08 23:00:00 | 2026-03-17 22:00:00 | 463 days, 23:00:00 |
| CQG/MNQM20 | 1m | 34 | 101,224 | 2019-10-28 08:14:00 | 2020-06-17 03:59:00 | 232 days, 19:45:00 |
| CQG/MNQM20 | 5m | 9 | 23,741 | 2019-10-28 08:10:00 | 2020-06-17 03:55:00 | 232 days, 19:45:00 |
| CQG/MNQM20 | 30m | 2 | 4,982 | 2019-10-28 08:00:00 | 2020-06-17 03:30:00 | 232 days, 19:30:00 |
| CQG/MNQM20 | 1440m | 2 | 253 | 2019-06-17 04:00:00 | 2020-06-16 04:00:00 | 365 days, 0:00:00 |
| CQG/MNQM21 | 1m | 48 | 123,809 | 2020-07-20 14:05:00 | 2021-06-16 03:59:00 | 330 days, 13:54:00 |
| CQG/MNQM21 | 5m | 12 | 31,237 | 2020-07-20 14:05:00 | 2021-06-16 03:55:00 | 330 days, 13:50:00 |
| CQG/MNQM21 | 30m | 2 | 6,517 | 2020-07-20 14:00:00 | 2021-06-16 03:30:00 | 330 days, 13:30:00 |
| CQG/MNQM21 | 1440m | 1 | 313 | 2020-03-19 04:00:00 | 2021-06-14 04:00:00 | 452 days, 0:00:00 |
| CQG/MNQM22 | 1m | 47 | 139,534 | 2021-07-19 19:59:00 | 2022-06-15 03:59:00 | 330 days, 8:00:00 |
| CQG/MNQM22 | 5m | 12 | 34,278 | 2021-07-19 19:55:00 | 2022-06-15 03:55:00 | 330 days, 8:00:00 |
| CQG/MNQM22 | 30m | 2 | 6,605 | 2021-07-19 19:30:00 | 2022-06-15 03:30:00 | 330 days, 8:00:00 |
| CQG/MNQM22 | 1440m | 1 | 313 | 2021-03-22 04:00:00 | 2022-06-14 04:00:00 | 449 days, 0:00:00 |
| CQG/MNQM23 | 1m | 49 | 128,738 | 2022-07-11 19:59:00 | 2023-06-15 03:59:00 | 338 days, 8:00:00 |
| CQG/MNQM23 | 5m | 12 | 32,380 | 2022-07-11 19:55:00 | 2023-06-15 03:55:00 | 338 days, 8:00:00 |
| CQG/MNQM23 | 30m | 2 | 6,502 | 2022-07-11 19:30:00 | 2023-06-15 03:30:00 | 338 days, 8:00:00 |
| CQG/MNQM23 | 1440m | 1 | 314 | 2022-03-17 04:00:00 | 2023-06-14 04:00:00 | 454 days, 0:00:00 |
| CQG/MNQM24 | 1m | 49 | 141,718 | 2023-07-17 19:59:00 | 2024-06-20 03:59:00 | 338 days, 8:00:00 |
| CQG/MNQM24 | 5m | 12 | 35,542 | 2023-07-17 19:55:00 | 2024-06-20 03:55:00 | 338 days, 8:00:00 |
| CQG/MNQM24 | 30m | 2 | 7,216 | 2023-07-17 19:30:00 | 2024-06-20 03:30:00 | 338 days, 8:00:00 |
| CQG/MNQM24 | 1440m | 1 | 319 | 2023-03-15 22:00:00 | 2024-06-19 22:00:00 | 462 days, 0:00:00 |
| CQG/MNQM25 | 1m | 48 | 147,625 | 2024-07-22 14:13:00 | 2025-06-19 23:08:00 | 332 days, 8:55:00 |
| CQG/MNQM25 | 5m | 12 | 35,364 | 2024-07-22 14:10:00 | 2025-06-19 23:05:00 | 332 days, 8:55:00 |
| CQG/MNQM25 | 30m | 2 | 6,663 | 2024-07-22 14:00:00 | 2025-06-19 23:00:00 | 332 days, 9:00:00 |
| CQG/MNQM25 | 1440m | 1 | 326 | 2024-03-03 23:00:00 | 2025-06-17 22:00:00 | 470 days, 23:00:00 |
| CQG/MNQM26 | 1m | 48 | 140,908 | 2025-07-21 19:59:00 | 2026-06-17 03:59:00 | 330 days, 8:00:00 |
| CQG/MNQM26 | 5m | 12 | 35,545 | 2025-07-21 19:55:00 | 2026-06-17 03:55:00 | 330 days, 8:00:00 |
| CQG/MNQM26 | 30m | 2 | 7,199 | 2025-07-21 19:30:00 | 2026-06-17 03:30:00 | 330 days, 8:00:00 |
| CQG/MNQM26 | 1440m | 1 | 321 | 2025-03-09 22:00:00 | 2026-06-15 22:00:00 | 463 days, 0:00:00 |
| CQG/MNQU20 | 1m | 44 | 96,674 | 2019-11-21 21:14:00 | 2020-09-14 03:59:00 | 297 days, 6:45:00 |
| CQG/MNQU20 | 5m | 11 | 23,942 | 2019-11-21 21:10:00 | 2020-09-14 03:55:00 | 297 days, 6:45:00 |
| CQG/MNQU20 | 30m | 3 | 5,339 | 2019-11-21 21:00:00 | 2020-09-14 03:30:00 | 297 days, 6:30:00 |
| CQG/MNQU20 | 1440m | 2 | 311 | 2019-06-20 04:00:00 | 2020-09-11 04:00:00 | 449 days, 0:00:00 |
| CQG/MNQU21 | 1m | 47 | 117,634 | 2020-10-19 03:34:00 | 2021-09-13 03:59:00 | 329 days, 0:25:00 |
| CQG/MNQU21 | 5m | 12 | 30,287 | 2020-10-19 03:30:00 | 2021-09-13 03:55:00 | 329 days, 0:25:00 |
| CQG/MNQU21 | 30m | 3 | 6,352 | 2020-10-19 03:30:00 | 2021-09-13 03:30:00 | 329 days, 0:00:00 |
| CQG/MNQU21 | 1440m | 1 | 312 | 2020-06-18 04:00:00 | 2021-09-10 04:00:00 | 449 days, 0:00:00 |
| CQG/MNQU22 | 1m | 45 | 134,422 | 2021-11-08 20:59:00 | 2022-09-14 03:59:00 | 309 days, 7:00:00 |
| CQG/MNQU22 | 5m | 11 | 34,020 | 2021-11-08 20:55:00 | 2022-09-14 03:55:00 | 309 days, 7:00:00 |
| CQG/MNQU22 | 30m | 3 | 6,850 | 2021-11-08 20:30:00 | 2022-09-14 03:30:00 | 309 days, 7:00:00 |
| CQG/MNQU22 | 1440m | 1 | 313 | 2021-06-17 04:00:00 | 2022-09-13 04:00:00 | 453 days, 0:00:00 |
| CQG/MNQU23 | 1m | 41 | 131,870 | 2022-12-05 19:31:00 | 2023-09-14 03:59:00 | 282 days, 8:28:00 |
| CQG/MNQU23 | 5m | 10 | 33,045 | 2022-12-05 19:30:00 | 2023-09-14 03:55:00 | 282 days, 8:25:00 |
| CQG/MNQU23 | 30m | 3 | 6,557 | 2022-12-05 19:30:00 | 2023-09-14 03:30:00 | 282 days, 8:00:00 |
| CQG/MNQU23 | 1440m | 1 | 314 | 2022-06-15 04:00:00 | 2023-09-12 22:00:00 | 454 days, 18:00:00 |
| CQG/MNQU24 | 1m | 49 | 143,652 | 2023-10-16 19:59:00 | 2024-09-19 03:59:00 | 338 days, 8:00:00 |
| CQG/MNQU24 | 5m | 12 | 36,601 | 2023-10-16 19:55:00 | 2024-09-19 03:55:00 | 338 days, 8:00:00 |
| CQG/MNQU24 | 30m | 3 | 7,409 | 2023-10-16 19:30:00 | 2024-09-19 03:30:00 | 338 days, 8:00:00 |
| CQG/MNQU24 | 1440m | 1 | 318 | 2023-06-13 22:00:00 | 2024-09-17 22:00:00 | 462 days, 0:00:00 |
| CQG/MNQU25 | 1m | 48 | 148,045 | 2024-10-21 01:25:00 | 2025-09-18 03:59:00 | 332 days, 2:34:00 |
| CQG/MNQU25 | 5m | 12 | 36,913 | 2024-10-21 01:25:00 | 2025-09-18 03:55:00 | 332 days, 2:30:00 |
| CQG/MNQU25 | 30m | 3 | 7,180 | 2024-10-21 01:00:00 | 2025-09-18 03:30:00 | 332 days, 2:30:00 |
| CQG/MNQU25 | 1440m | 1 | 319 | 2024-06-09 22:00:00 | 2025-09-16 22:00:00 | 464 days, 0:00:00 |
| CQG/MNQU26 | 1m | 48 | 149,779 | 2025-10-20 19:59:00 | 2026-09-17 03:59:00 | 331 days, 8:00:00 |
| CQG/MNQU26 | 5m | 12 | 37,123 | 2025-10-20 19:55:00 | 2026-09-17 03:55:00 | 331 days, 8:00:00 |
| CQG/MNQU26 | 30m | 3 | 7,265 | 2025-10-20 19:30:00 | 2026-09-17 03:30:00 | 331 days, 8:00:00 |
| CQG/MNQU26 | 1440m | 1 | 321 | 2025-06-08 22:00:00 | 2026-09-15 22:00:00 | 464 days, 0:00:00 |
| CQG/MNQZ20 | 1m | 44 | 114,458 | 2020-02-20 21:14:00 | 2020-12-17 04:59:00 | 300 days, 7:45:00 |
| CQG/MNQZ20 | 5m | 11 | 28,156 | 2020-02-20 21:10:00 | 2020-12-17 04:55:00 | 300 days, 7:45:00 |
| CQG/MNQZ20 | 30m | 2 | 6,005 | 2020-02-20 21:00:00 | 2020-12-17 04:30:00 | 300 days, 7:30:00 |
| CQG/MNQZ20 | 1440m | 2 | 315 | 2019-09-19 04:00:00 | 2020-12-16 05:00:00 | 454 days, 1:00:00 |
| CQG/MNQZ21 | 1m | 48 | 118,635 | 2021-01-11 19:21:00 | 2021-12-13 04:59:00 | 335 days, 9:38:00 |
| CQG/MNQZ21 | 5m | 12 | 30,548 | 2021-01-11 19:20:00 | 2021-12-13 04:55:00 | 335 days, 9:35:00 |
| CQG/MNQZ21 | 30m | 2 | 6,499 | 2021-01-11 19:00:00 | 2021-12-13 04:30:00 | 335 days, 9:30:00 |
| CQG/MNQZ21 | 1440m | 1 | 313 | 2020-09-17 04:00:00 | 2021-12-10 05:00:00 | 449 days, 1:00:00 |
| CQG/MNQZ22 | 1440m | 1 | 307 | 2021-09-16 04:00:00 | 2022-12-02 05:00:00 | 442 days, 1:00:00 |
| CQG/MNQZ23 | 1m | 46 | 138,466 | 2023-01-30 09:31:00 | 2023-12-14 04:59:00 | 317 days, 19:28:00 |
| CQG/MNQZ23 | 5m | 12 | 34,823 | 2023-01-30 09:30:00 | 2023-12-14 04:55:00 | 317 days, 19:25:00 |
| CQG/MNQZ23 | 30m | 2 | 7,019 | 2023-01-30 09:30:00 | 2023-12-14 04:30:00 | 317 days, 19:00:00 |
| CQG/MNQZ23 | 1440m | 1 | 322 | 2022-09-06 04:00:00 | 2023-12-12 23:00:00 | 462 days, 19:00:00 |
| CQG/MNQZ24 | 1m | 49 | 151,149 | 2024-01-16 07:28:00 | 2024-12-19 04:59:00 | 337 days, 21:31:00 |
| CQG/MNQZ24 | 5m | 12 | 37,741 | 2024-01-16 07:25:00 | 2024-12-19 04:55:00 | 337 days, 21:30:00 |
| CQG/MNQZ24 | 30m | 2 | 7,605 | 2024-01-16 07:00:00 | 2024-12-19 04:30:00 | 337 days, 21:30:00 |
| CQG/MNQZ24 | 1440m | 1 | 326 | 2023-09-04 22:00:00 | 2024-12-17 23:00:00 | 470 days, 1:00:00 |
| CQG/MNQZ25 | 1m | 48 | 138,503 | 2025-01-21 20:59:00 | 2025-12-18 04:59:00 | 330 days, 8:00:00 |
| CQG/MNQZ25 | 5m | 12 | 35,846 | 2025-01-21 20:55:00 | 2025-12-18 04:55:00 | 330 days, 8:00:00 |
| CQG/MNQZ25 | 30m | 2 | 7,482 | 2025-01-21 20:30:00 | 2025-12-18 04:30:00 | 330 days, 8:00:00 |
| CQG/MNQZ25 | 1440m | 1 | 321 | 2024-09-08 22:00:00 | 2025-12-16 23:00:00 | 464 days, 1:00:00 |
| CQG/MNQZ26 | 1440m | 1 | 263 | 2025-09-07 22:00:00 | 2026-09-21 22:00:00 | 379 days, 0:00:00 |
| RITHMIC/ESZ6.CME | 1m | 36 | 34,853 | 2026-01-20 14:31:00 | 2026-09-23 18:42:00 | 246 days, 4:11:00 |
| RITHMIC/ESZ6.CME | 1440m | 1 | 883 | 2023-03-20 22:00:00 | 2026-09-21 22:00:00 | 1281 days, 0:00:00 |
| RITHMIC/MESZ6.CME | 1m | 36 | 49,865 | 2026-01-19 03:34:00 | 2026-09-23 18:42:00 | 247 days, 15:08:00 |
| RITHMIC/MNQZ6.CME | 1m | 37 | 76,051 | 2026-01-19 10:03:00 | 2026-09-29 17:35:00 | 253 days, 7:32:00 |
| RITHMIC/MNQZ6.CME | 1440m | 1 | 267 | 2025-09-07 22:00:00 | 2026-09-27 22:00:00 | 385 days, 0:00:00 |
| RITHMIC/NQZ6.CME | 1m | 36 | 37,348 | 2026-01-20 20:59:00 | 2026-09-23 18:42:00 | 245 days, 21:43:00 |
| RITHMIC/NQZ6.CME | 1440m | 1 | 882 | 2023-03-20 22:00:00 | 2026-09-21 22:00:00 | 1281 days, 0:00:00 |

**Bar totals:** 1m: 1507 files / 4,034,842 bars, 5m: 340 files / 955,048 bars, 30m: 74 files / 190,751 bars, 1440m: 60 files / 28,967 bars

## MNQ tick-data coverage (what the user trades)

| source/contract | ticks | distinct UTC days | first (UTC) | last (UTC) |
|---|---:|---:|---|---|
| CQG/MNQU26 | 6,677,954 | 113 | 2026-03-30 04:00:00 | 2026-09-18 05:59:59 |
| RITHMIC/MNQZ6.CME | 5,531,151 | 104 | 2026-04-01 11:00:00 | 2026-09-29 21:00:00 |

Combined MNQ days with any tick block: **121**. Hourly blocks per day (a full MNQ session is ~23 blocks):

| day (UTC) | blocks | day (UTC) | blocks |
|---|---:|---|---:|
| 2026-03-30 | 1 | 2026-06-29 | 2 |
| 2026-03-31 | 1 | 2026-06-30 | 2 |
| 2026-04-01 | 2 | 2026-07-01 | 2 |
| 2026-04-02 | 2 | 2026-07-02 | 2 |
| 2026-04-03 | 1 | 2026-07-03 | 2 |
| 2026-04-06 | 1 | 2026-07-06 | 2 |
| 2026-04-08 | 3 | 2026-07-07 | 2 |
| 2026-04-09 | 2 | 2026-07-09 | 4 |
| 2026-04-10 | 1 | 2026-07-10 | 2 |
| 2026-04-13 | 1 | 2026-07-13 | 4 |
| 2026-04-14 | 2 | 2026-07-14 | 2 |
| 2026-04-16 | 2 | 2026-07-15 | 2 |
| 2026-04-17 | 2 | 2026-07-16 | 2 |
| 2026-04-20 | 1 | 2026-07-17 | 2 |
| 2026-04-21 | 2 | 2026-07-20 | 4 |
| 2026-04-22 | 2 | 2026-07-21 | 2 |
| 2026-04-23 | 2 | 2026-07-22 | 2 |
| 2026-04-24 | 2 | 2026-07-23 | 2 |
| 2026-04-27 | 1 | 2026-07-24 | 2 |
| 2026-04-28 | 2 | 2026-07-27 | 4 |
| 2026-04-29 | 1 | 2026-07-28 | 2 |
| 2026-04-30 | 2 | 2026-07-29 | 2 |
| 2026-05-01 | 1 | 2026-07-30 | 2 |
| 2026-05-04 | 2 | 2026-07-31 | 2 |
| 2026-05-05 | 2 | 2026-08-03 | 1 |
| 2026-05-06 | 2 | 2026-08-04 | 2 |
| 2026-05-07 | 1 | 2026-08-05 | 2 |
| 2026-05-08 | 1 | 2026-08-06 | 2 |
| 2026-05-11 | 1 | 2026-08-07 | 2 |
| 2026-05-12 | 2 | 2026-08-11 | 4 |
| 2026-05-13 | 2 | 2026-08-12 | 2 |
| 2026-05-14 | 2 | 2026-08-13 | 2 |
| 2026-05-15 | 2 | 2026-08-14 | 2 |
| 2026-05-18 | 2 | 2026-08-18 | 2 |
| 2026-05-20 | 3 | 2026-08-19 | 2 |
| 2026-05-21 | 2 | 2026-08-20 | 2 |
| 2026-05-22 | 1 | 2026-08-21 | 2 |
| 2026-05-25 | 2 | 2026-08-24 | 4 |
| 2026-05-26 | 2 | 2026-08-25 | 2 |
| 2026-05-27 | 2 | 2026-08-27 | 4 |
| 2026-05-28 | 2 | 2026-08-28 | 2 |
| 2026-05-29 | 2 | 2026-09-01 | 4 |
| 2026-06-02 | 4 | 2026-09-04 | 4 |
| 2026-06-03 | 2 | 2026-09-07 | 2 |
| 2026-06-04 | 2 | 2026-09-08 | 2 |
| 2026-06-05 | 2 | 2026-09-09 | 2 |
| 2026-06-08 | 2 | 2026-09-11 | 4 |
| 2026-06-09 | 2 | 2026-09-14 | 2 |
| 2026-06-10 | 2 | 2026-09-15 | 4 |
| 2026-06-11 | 2 | 2026-09-16 | 2 |
| 2026-06-12 | 2 | 2026-09-17 | 2 |
| 2026-06-15 | 2 | 2026-09-18 | 2 |
| 2026-06-16 | 2 | 2026-09-21 | 2 |
| 2026-06-17 | 2 | 2026-09-22 | 1 |
| 2026-06-18 | 2 | 2026-09-23 | 1 |
| 2026-06-19 | 2 | 2026-09-24 | 1 |
| 2026-06-22 | 2 | 2026-09-25 | 1 |
| 2026-06-23 | 2 | 2026-09-27 | 3 |
| 2026-06-24 | 2 | 2026-09-28 | 25 |
| 2026-06-25 | 2 | 2026-09-29 | 21 |
| 2026-06-26 | 2 |  |  |

Days with a near-complete session (>=15 hourly blocks): **2** -> ['2026-09-28', '2026-09-29']

## Live-capture status (RITHMIC newest MNQ block)

```json
{
  "instrument": "MNQZ6.CME",
  "block": "1790712000000.tick_data",
  "count_t0": 25968,
  "count_t1": 25968,
  "last_ts_t0": "2026-09-29 20:59:58",
  "last_ts_t1": "2026-09-29 20:59:58",
  "changed_over_10.0s": false,
  "file_mtime_age_s": 208.4
}
```