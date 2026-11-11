# OPTIONS_PAPER.md — Options paper-trading playbook

A **self-contained, DB-backed paper-trading account for intraday option trading**
on NIFTY and a few liquid stock options, plus the daily loop that turns each
session into a learning note. It is deliberately separate from the equity bot
runner in `trading/` — that runner has no concept of an option contract, and this
must never destabilise it.

> **One-line summary:** every day, replay the session's *real recorded prices*
> through six strategies under a strict no-lookahead rule, book the trades into
> the `trades` table, and write an EOD note. Nothing is recalled; every number
> is computed from the tape and the charge schedule below.

---

## 1. The account (already created)

| | |
|---|---|
| Email | `options-paper@alphashri.local` |
| Password | `optpaper123` |
| Capital | **₹25,00,000** |
| User id | 24 |
| Bots | 6 — one per strategy (`OPT Paper - <strategy>`) |
| Strategies | 6 (`OPTPAPER <strategy>`) |
| Trades so far | 0 (clean start) |

Created **insert-only** by `scripts/setup_options_paper.py`. It never updates or
deletes any existing user, bot, strategy, position or trade. A DB backup is
written first (`backups/db/…`).

Log in through the normal app, or:

```bash
TOKEN=$(curl -s -X POST http://localhost:8765/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"options-paper@alphashri.local","password":"optpaper123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
curl -H "Authorization: Bearer $TOKEN" http://localhost:8765/api/paper/trades
```

Completed trades carry `source="options_paper"` and a `bot_id` per strategy, so
they show up in the existing trade-history UI and can be filtered.

---

## 2. The real-world facts this trades on

All of the following is either read from this repo's own live broker master or
fetched from the broker's published charge page. **Nothing is recalled.**

### 2.1 Lot sizes

Source: `db/alphashri.db` → `instruments` (the Upstox instrument master synced
into this repo, rows created **2026-05-23**).

| Underlying | Lot | | Underlying | Lot |
|---|---|---|---|---|
| **NIFTY** | **65** | | RELIANCE | 500 |
| BANKNIFTY | 30 | | HDFCBANK | 550 |
| FINNIFTY | 60 | | ICICIBANK | 700 |
| MIDCPNIFTY | 120 | | INFY | 400 |
| SENSEX (BSE) | 20 | | TCS | 175 |
| | | | ITC | 1600 |
| | | | LT | 175 |
| | | | KOTAKBANK | 2000 |

> ⚠ **NIFTY = 65 vs 75.** The broker master says **65**, and `api/options.py`
> independently records that *23 consecutive real exchange prints were exact
> multiples of 65*. The options **research** engine
> (`reports/OPTIONS_REAL_5Y/opteng.py`) instead used `LOT=75`. This sandbox
> defaults to the broker master (**65**); switch with:
> `spec.DEFAULT_LOT_POLICY = "report"`. The discrepancy is disclosed, not hidden.

### 2.2 Expiry

Observed from the repo's own contract data:

* NIFTY weekly options expire on **Tuesday** (the 2026-10-13 tape's expiry was
  2026-10-13, a Tuesday; the Sep monthly was 2026-09-29, also a Tuesday).
* When the Tuesday is a holiday, expiry **shifts to the previous trading day**.
  **Tue 2026-10-20 is a holiday → the nearest weekly expires Mon 2026-10-19.**
* Consequence: **Monday 19 Oct 2026 is a 0-DTE expiry day.** Gamma is extreme;
  treat it as a special regime, not a normal day.

`2026-10-19` is confirmed a trading day by `trading.calendar.is_trading_day`.

### 2.3 Charges (Upstox, in force 2026)

Source: Upstox "Brokerage charges" page (fetched 2026-10-18); cross-checked
against Zerodha's published options schedule. Rates are the ones effective
**1 Apr 2026** (STT) and **1 Mar 2026** (NSE transaction charge).

| Charge | Rate | Applies to |
|---|---|---|
| Brokerage | **₹20 / executed order** (flat) | both sides |
| STT | **0.15%** of premium | **sell** side only |
| NSE transaction | **0.03553%** of premium | both sides |
| SEBI turnover | ₹10 / crore (0.0001%) | both sides |
| Stamp duty | 0.003% of premium | **buy** side only |
| IPFT | ₹0.50 / lakh of premium * | both sides |
| GST | 18% | on brokerage + txn + SEBI + IPFT |

\* Upstox's own summary table says ₹0.01/crore while its IPFT explainer says
₹0.50/lakh for options. We use the **larger** figure (conservative). Either way
it is negligible (<₹1 per lot).

Implemented in `options_paper/costs.py::option_round_trip_cost`. A flat ₹20
order is huge relative to a small premium, so **costs are the first thing any
buy signal must clear.**

### 2.4 Margin & sessions

* Buying options needs **no margin** — pay the full premium.
* Naked short options need **SPAN + exposure**. `sell_margin_estimate()` models
  ~13% of notional with a ₹6,000/lot floor. The real number comes from the
  broker's margin API; this is only a gate.
* Sessions (from `trading/utils.py`): open **09:15**, continuous close **15:15**,
  global force-exit **15:10**, session close **15:30** IST.

---

## 3. The strategies

One bot each, one position at a time. Default **1 lot** so strategies are
compared on the same risk unit.

| # | Name | Underlying | Rule | Direction |
|---|---|---|---|---|
| 1 | `nifty_momentum` | NIFTY | Opening-range (15 min) breakout ± 0.05% → buy ATM | long premium |
| 2 | `stock_momentum` | RELIANCE/HDFCBANK/ICICIBANK/INFY/TCS | Same breakout rule on a stock | long premium |
| 3 | `nifty_vrp` | NIFTY | Sell the ATM straddle (control / the seller benchmark) | short premium |
| 4 | `nifty_gap` | NIFTY | Gap ≥0.30% vs prior close → gap-and-go (default) or fade | long premium |
| 5 | `nifty_wall_bounce` | NIFTY | Spot within 0.15% of a heavy OI wall → bounce/reject | long premium |
| 6 | `nifty_iv_delta` | NIFTY | **IV + greeks**: go with 15-min momentum **only when ATM IV is at/below its own 60-min median**, and buy the strike whose **|delta| ≈ 0.40** (slightly OTM) instead of the ATM. Exits on premium stop/target, a **vol-expansion** exit (ATM IV +2 points), time, or EOD | long premium |

> **`nifty_rsi_reversion` was removed.** It traded RSI extremity with no
> vol/moneyness discipline, re-entered with no cooldown, and bled costs. Its
> journal rows and DB bot still exist (this account is insert-only) but it is no
> longer in the registry and will not trade.

**Why delta-selected moneyness.** The ATM carries the most premium and the most
theta per unit. A ~0.40-delta strike is cheaper per unit and gives more gamma per
rupee, so a given index move produces a larger *percentage* premium move — at the
cost of a lower hit rate. `nifty_iv_delta` also refuses to buy when IV is rich
versus its own recent median, because rich vol is a headwind the move must
overcome.

**Honest status:** with the default 0.12% momentum threshold (≈1σ of a 15-minute
NIFTY move) it still lost on both available weeks (−₹1,076 on 2026-08-17,
−₹348 on 2026-09-21). The IV filter and delta selection demonstrably work (mean
|delta| error 0.001), but the directional premise has no demonstrated edge. A
threshold sweep (0.02/0.05/0.12/0.25%) reduced the bleed monotonically without
creating profit — that is *in-sample exploration*, not evidence.

Shared defaults: stop **30%** of entry premium, target **60%**, time-stop
**60 min**, flat at **15:10**. Every one is a constructor argument — see
`options_paper/strategies.py`.

### The honesty contract (do not weaken)

1. A signal is computed on the **close of a completed minute** and filled at the
   **next** minute's recorded premium.
2. **No target on the fill bar** (and no discretionary `exit_hook`) — only a
   stop may fire there.
3. **Stop before target** on every bar.
4. **No overnight carry** — everything flattens at 15:10.
5. If a run is truncated (`--asof`), the still-open position is labelled
   **`MTM`**, never `EOD`, and is **not** booked to the DB.
6. A leg with no price is **not tradeable** — the engine refuses to open at a
   zero premium (guards expiry-day dead legs).

These are enforced in `strategies.py::Strategy.run` and covered by tests
(`tests/test_options_paper.py`).

---

## 4. The daily playbook

### Morning (before 09:15)

```bash
./start.sh                     # starts the API, which records the NIFTY tape
```
The tape collector (`api/reports_api/nifty.py::start_nifty_tape_task`) writes
`experiments/data/nifty_tape/<date>.jsonl` **once a minute during market hours**.
That file *is* tomorrow's price source.

Stock options additionally need live broker data → **reconnect Upstox in
Settings** (Upstox tokens expire daily). NIFTY strategies do not need it.

### After the close (15:30+)

```bash
source .venv/bin/activate

# replay the day: signals → next-minute fills → trades
python -m options_paper.runner run --date 2026-10-19

# daily learning note
python -m options_paper.runner eod --date 2026-10-19

# running account P&L
python -m options_paper.runner account
```

Useful flags: `--strategies nifty_vrp,nifty_gap`, `--lots 2`,
`--dry-run` (journal only, no DB), `--asof 12:30` (intraday preview).

### Files produced

```
options_paper/journal/<date>.jsonl                 append-only trade journal
reports/OPTIONS_PAPER_DAILY/<date>/eod.md          the learning note
reports/OPTIONS_PAPER_DAILY/<date>/summary.json    machine-readable roll-up
reports/OPTIONS_PAPER_DAILY/<date>/trades.csv      one row per trade
reports/OPTIONS_PAPER_DAILY/<date>/equity.png      cumulative net-P&L curve
```

`reports/**` is never deleted — regenerate in place.

---

## 5. What "learn every day" means

A single day is **a data point, not evidence**. A strategy is only promotable
when it clears the programme's existing gate:

* **n ≥ 30** trades, **and**
* positive in **all three** regime buckets (2020-21 / 2022-23 / 2024-25 for
  history; forward months for live), **and**
* **still positive at 3× costs.**

Until then the EOD note is descriptive only. The note already flags `n<30` and
prints the cost drag so a "win" that is really noise gets caught.

Sanity baseline: the options research programme (5 years of real bhavcopy + the
2026 tape) found **no confirmed buyer edge anywhere**; the only surviving
positive was the **seller's** side, and it was put-side, ≤90-DTE and ~61%
decayed by 2024-25. Expect the buyer strategies to lose to costs. That is the
prior — beat it or discard the idea.

---

## 6. Verified before hand-off

* `python -m pytest tests/test_options_paper.py -q` → **23 passed** (honesty
  contract, cost model, spec, and the DB path on an in-memory engine).
* Replay of the real **2026-10-16** tape (the last completed session):
  **9 trades, net ₹-1,625 (-24.99 pts)** — gross ₹-998, costs ₹627
  (**62.8% cost drag**). Per strategy:

  | strategy | n | net ₹ | points |
  |---|---|---|---|
  | `nifty_vrp` (seller) | 1 | +3,060 | +47.08 |
  | `nifty_momentum` | 1 | +600 | +9.23 |
  | `nifty_rsi_reversion` | 3 | -831 | -12.78 |
  | `nifty_wall_bounce` | 4 | -4,454 | -68.53 |
  | `nifty_gap` | 0 | — | gap 0.20% < 0.30% threshold |

  i.e. **the buyer legs lost, the seller leg made money** — exactly the prior.
  This is a validation run; it is in `options_paper/journal/` but **not** booked
  to the DB, so the account starts clean on Monday.

* Multi-day recheck (all no-lookahead, journal only): 2026-10-14 → 10 trades,
  net ₹-1,537; 2026-10-15 → 8 trades, net **+₹132**; 2026-10-16 → 9 trades,
  net ₹-1,625. Day-to-day sign flips — a reminder that one session is not
  evidence.

* Account creation, login (bcrypt) and trade de-duplication all exercised.

---

## 7. File map

```
options_paper/
  spec.py         lots, charges, sessions, symbol format     (all sourced)
  costs.py        option round-trip cost + break-even + margin
  tape.py         tape loader / prev-close / live Upstox quote
  strategies.py   RSI + 6 strategies + the no-lookahead engine
  greeks.py       Black-76 greeks + parity forward + P&L attribution
  panel.py        minute ATM CE/PE feed from the recorded option panel
  sim.py          week replay + the self-contained HTML screen
  screen_template.html   the screen (inline SVG, no CDN)
  book.py         DB account + insert-only trade recording + journal
  runner.py       CLI: setup | run | eod | sim | account | dates
  eod.py          daily learning note (md + csv + json + png)
  journal/        append-only per-day trade logs
scripts/setup_options_paper.py    one-shot account creation
tests/test_options_paper.py       23 tests (engine + costs)
tests/test_options_paper_sim.py   18 tests (greeks + panel + sim)
reports/OPTIONS_PAPER_DAILY/      daily notes
reports/OPTIONS_PAPER_SIM/<week>/ week replay screen (index.html + screen_data.json)
```

## 7b. Greeks and the week-replay screen

The v1 engine priced only the premium. Two layers were added so a P&L number is
interpretable rather than just positive or negative.

**Greeks (`greeks.py`).** Black-76 on the **parity-implied forward**
(`F = K + (C-P)e^{rT}`, an observed number, not `S e^{rT}`); implied vol by
bisection; delta/gamma/theta/vega by central differences. `r` is a flat 6.5%,
`T` is calendar time floored at 15 minutes. `attribute()` then splits a premium
move into delta + gamma + theta + vega and reports the **residual** — the part
the greeks do *not* explain. The residual is shown, never hidden.

**Minute feed (`panel.py`).** The live tape only exists for a few days, so the
panel joins the repo's recorded 1-minute option contracts (669 files, 2026-05 →
2026-09) with the 1-minute NIFTY index into the same `Tick` the strategies
already consume. Every premium is a real print; a minute without one is dropped,
never interpolated. (The panel's `oi` column is empty, so OI walls / PCR / dealer
gamma are unavailable and `nifty_wall_bounce` cannot signal there.)

**Where the data actually comes from (verified, not assumed).**
* *1-minute option prices (2026-05 → 09)* — **FYERS broker API**
  (`fyers_apiv3.fyersModel.history`), fetched 2026-09-26 by
  `experiments/research/nifty_options/download_options_real.py`: four listed
  monthlies + two front weeklies, strikes 22,000–25,600, 1-minute OHLCV. All 669
  contracts have **non-zero traded volume** — these are real trades, not a
  synthetic series. The fetch used `oi=False`, which is why open interest is
  empty (a fetch choice, not fictional data).
* *1-minute NIFTY index* — `NSE_NIFTY50-INDEX__1.parquet`, 2017-07 → 2026-09.
* *Live tape* — the repo's own recorder (`api/reports_api/nifty.py`), per minute,
  four sessions in 2026-10.
* *5-year history* — **NSE F&O bhavcopy** (via the
  `nse-options-last-5-years` mirror of NSE's daily files),
  `nse_bhavcopy/nifty_opt_eod.parquet`: 2020-04-13 → 2025-04-30, 2,419,767 rows,
  per-contract open/high/low/close + official settle + OI. **Daily bars only —
  there are no intraday option prices for 2020–2025 in this repo**, so a
  minute-level replay for those years is impossible. A daily-bar week sim is
  possible and is the natural next add.

**Per-trade "why" visuals.** The screen now also draws, for every trade, the
**real 1-minute NIFTY candlesticks** around the entry/exit with IN/OUT markers
and the strike line, the **option's own premium path**, and an **MAE/MFE
excursion** row (worst→best premium move while held, with the stop/target and
the actual exit). The entry and exit reasons are printed from the engine's own
`reason` / `exit_reason` fields — nothing is narrated after the fact.

**Week replay (`sim.py`).** Picks a week from the priced sessions (random, or
`--week`), runs every strategy through the same no-lookahead engine, attaches
greeks + attribution to each trade, and writes one self-contained HTML screen:

```bash
# a reproducible random week (near-expiry contracts only)
python -m options_paper.runner sim --seed 1977

# intraday NAKED BUYING only: one long leg, no hedge, no overnight
python -m options_paper.runner sim --week 2026-09-21 --naked-only

# a specific week (any date in it), no DTE filter
python -m options_paper.runner sim --week 2026-08-17 --max-dte 0
```

Output → `reports/OPTIONS_PAPER_SIM/<first>_<last>/index.html` (open in a
browser; offline, no network) plus `screen_data.json`. The screen shows KPIs, a
daily table, per-strategy P&L, the **expiry payoff diagram** (structure, gross of
costs — the engine exits intraday), the intraday equity curve, the greeks, the
P&L attribution, a sortable trades table and the caveats.

**Scoped to intraday naked buying.** `--naked-only` restricts the replay to
single-leg long premium (no hedge, no overnight) and drops the short-straddle
seller. On the two available weeks:

| Week (DTE) | Trades | Gross | Costs | Net | Cost drag |
|---|---|---|---|---|---|
| 2026-08-17 (43) | 14 | +₹1,973 | ₹1,247 | **+₹726** | 63% |
| 2026-09-21 (8) | 21 | −₹526 | ₹1,297 | **−₹1,824** | 246% |

Across both weeks the naked buyer is **−₹1,098 on 35 trades**. Per strategy over
both weeks: `nifty_gap` +₹1,679 (2 trades — far too few to mean anything),
`nifty_momentum` −₹1,353, `nifty_iv_delta` −₹1,424. Costs are 60–100%+ of gross,
so the buyer is fighting the charge schedule, not just the market.

This is a demonstration on two weeks, not a backtest of an edge. It lines up
with the research verdict (the buyer has no confirmed edge; the surviving
positive is the seller's side).

**Straddle at the open (`nifty_open_straddle`).** Buy the ATM straddle on the
first tradeable bar and hold the session (stop/target on the combined premium,
else EOD). It is the cleanest test of "will NIFTY move enough to pay for both
legs and two round trips". `side="SHORT"` flips it into the seller control.

| Week | Straddle ₹ | Day range | LONG net | SHORT net |
|---|---|---|---|---|
| 2026-08-17 (40–43 DTE) | 625–730 | 57–129 | **−₹5,429** (0/5) | **+₹3,443** |
| 2026-09-21 (4–8 DTE) | 223–309 | 110–222 | **−₹776** (1/5) | **−₹1,778** |

Reading it: at **40 DTE the straddle is priced for ~40 days while you hold one**,
so a 57–129 point day never covers a ₹700 premium — the long loses every day and
the short collects. Near expiry (4–8 DTE) the straddle is ~₹250 and the day range
is comparable, so it becomes a coin flip decided by a single day (09-24: range
222 vs premium 223 → +₹3,170 for the long; the same day hit the short's stop for
−₹4,652). That is the variance-risk-premium in miniature, not an edge: the
straddle is simply *fairly priced*, so the buyer pays costs and the seller
carries tail risk.

Every trade card also draws its own **expiry payoff** (structure, gross of costs)
alongside the 1-minute NIFTY candles and the contract's premium path.

## 8. Known limitations (disclosed, not hidden)

* **ATM only.** Strategies price the ATM CE/PE from the tape. OTM strike
  selection needs the 1-minute contract panel or a live chain.
* **Stock options need live data.** The NIFTY tape does not cover equities, so
  `stock_momentum` is skipped unless a live chain is wired in.
* **Sizing is 1 lot by default.** Not risk-scaled to volatility.
* **The tape is the fill.** We fill at the recorded ATM LTP — no slippage model
  beyond the cost schedule. That is optimistic for size.
* **0-DTE days** (like Mon 2026-10-19) are a distinct regime; the engine treats
  them like any other day.
* **Tape format drifted.** The 2026-10-13 tape predates the `atm_ce_ltp` /
  `atm_pe_ltp` fields and cannot be priced; the runner says so explicitly
  (`run --date 2026-10-13`). Priced days available now: 2026-10-14/15/16.
* **Intraday option prints are 2026-only.** The minute-level option panel spans
  2026-05 → 2026-09, so a *minute* replay can only come from there. The 5-year
  history is the *daily* bhavcopy (`nse_bhavcopy/nifty_opt_eod.parquet`,
  2020-04 → 2025-04) — it supports a daily-bar session sim, not a minute one.
* **Greeks are model output.** Black-76 with a flat 6.5% rate and calendar time;
  on 0-DTE the ATM greeks are extreme by construction.

## 9. Extending

* **Add a strategy:** subclass `Strategy`, implement `entry_signal` (+ optional
  `prepare` / `exit_hook`), register it in `REGISTRY` and `STRATEGY_LABELS`,
  add its `STRATEGY_TYPES` entry in `book.py`, re-run
  `python scripts/setup_options_paper.py`.
* **Change parameters:** pass kwargs at build time in `runner.py`, or edit the
  defaults in `strategies.py`. Keep the honesty contract intact.
* **Change lots/charges:** `options_paper/spec.py` is the single source.
