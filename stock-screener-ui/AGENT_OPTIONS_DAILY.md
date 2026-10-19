# AGENT_OPTIONS_DAILY.md — runbook for the agent options desk

Everything the agent needs to run an **intraday NIFTY options paper session**
(a mix of buying and selling), review it, and feed the weekly/monthly learning.
Written after the first live session (2026-10-19). Pair with `OPTIONS_PAPER.md`
(account/strategy background) and `reports/OPTIONS_PAPER_SIM/agent_ledger.md`
(the append-only learning ledger).

---

## 1. What we own (scripts & modules)

| Path | What it is | Notes |
|---|---|---|
| `scripts/agent_options_check.py` | **the one-minute checker** — spot, ATM greeks **and their 5-min change**, GEX/positioning/regime, TWAP proxy, expansion gauge, room, SETUP flag, full strike scan (5-min movers + most active), OI walls, P&L | read-only, 0.3 s, `--date YYYY-MM-DD` |
| `options_paper/manual.py` | **my discretionary book**: `enter` (LONG/SHORT, `--tag`), `status`, `exit`, `trigger` | open positions live in `options_paper/journal/agent_positions.json` |
| `options_paper/live.py` | the **continuous loop**: replays the tape every 60 s, books closed coded trades, prints the heartbeat, **auto-manages my positions** (stop/target) | `AGENT_STRATEGIES` = momentum, gap, iv_delta, open_straddle, spot_scalp |
| `scripts/watch_agent_options.sh` | watchdog: restarts the loop if it dies | runs until 15:31 |
| `options_paper/strategies.py` | the engine + strategies (incl. `NiftySpotScalp`, `NiftyIVDelta`, `NiftyOpenStraddle`) | honesty contract: signal on bar close, fill next bar, no target on the fill bar |
| `options_paper/greeks.py` | Black-76 greeks / IV inversion / P&L attribution | used by the panel + sim |
| `options_paper/panel.py` | builds a minute ATM feed from the recorded 1-min option panel | used by `sim` |
| `options_paper/book.py` | DB writes (insert-only), agent identity, journals | `AGENT_TRADE_TAG = agent_intraday` |
| `options_paper/sim.py` + `screen_template.html` | week replay + the HTML screen | `runner sim --naked-only` |
| `options_paper/runner.py` | CLI: `setup │ run │ eod │ sim │ account │ dates` | |
| `reports/OPTIONS_PAPER_SIM/agent_ledger.md` | **the learning ledger** (append one row per day) | weekly/monthly roll-up lives here |

Data we read (never edit by hand):

| Path | Content |
|---|---|
| `experiments/data/nifty_tape/<date>.jsonl` | **light tape**, 1 row/min: spot, ATM CE/PE LTP+IV, `chain{strike:[ce_ltp,pe_ltp,ce_oi,pe_oi,ce_vol,pe_vol]}`, PCR, max-pain, walls, net GEX, flip |
| `experiments/data/nifty_snapshots/<date>.jsonl` | **full record**, 1 row/min: every derived block (gex, positioning, control, regime, structure, strength, vix, pivots, walls) + `strikes[]` with **delta, gamma, theta, vega, iv, pop**, OI, volume, bid/ask |
| `options_paper/journal/agent_positions.json` | my open positions + triggers |
| `options_paper/journal/<date>.jsonl` | append-only audit log of booked trades |

Providers: **the Nifty report is Upstox only** (`api/options.py: UPSTOX_BASE`, no Fyers in the path).
Fyers is used only to download historical 1-min option candles for research
(`experiments/research/nifty_options/`); its `oi` flag must be `True`.

---

## 2. Session times (IST) — non-negotiable

| Time | Event |
|---|---|
| 09:15 | open |
| **15:10** | **FORCE_EXIT / DEFAULT_EOD_EXIT — be FLAT** |
| **15:15** | **continuous trading ends** |
| 15:15–15:30 | **Closing Auction Session (CAS)** — do not hold into it |
| 15:30 | session close |

The engine stops scanning at 15:10. Any straddle/option must be closed **before 15:10**.

---

## 3. Daily runbook

### Before the open
1. `./start.sh start` (use `restart > /tmp/opencode/r.log 2>&1` if already running — **never pipe `start.sh`**, it hangs).
2. **Broker token** — open `http://localhost:8765/api/brokers/upstox/auth` (Upstox tokens expire daily). Without it the tape cannot record and everything downstream is blind.
3. Verify recording: `curl -s localhost:8765/api/reports/nifty/tape/status` → `last_skip` must not be `chain-failed`.
4. Verify equity bots are off: `.env` has `EQUITY_BOTS_DISABLED=1`.
5. Start the loop + watchdog:
   ```bash
   setsid nohup bash scripts/watch_agent_options.sh > /dev/null 2>&1 < /dev/null &
   ```

### During the session — every 20–60 s
```bash
python scripts/agent_options_check.py
```
- **20 s** when price is at a level or the gauge says EXPANDING; **60 s** when quiet.
- Read the **SETUP** line, the **greeks Δ5m** line and the **movers** line, then decide.
- Trade with `options_paper.manual` (see §5).

### End of day (after 15:30)
1. `python -m options_paper.runner eod --date <date>`
2. Append one row to `reports/OPTIONS_PAPER_SIM/agent_ledger.md` (day table + what worked/failed).
3. Aggregate the week/month from the ledger.

---

## 4. Decision rules (learned the hard way on 2026-10-19)

**Regime first — it decides whether you buy or sell:**
- **TREND** — expansion ≥1.5×, |5-min move| ≥20 pts, price outside the avg band → **BUY** ATM *with* the trend, entering at the **start** of the move.
- **RANGE / PIN** — expansion ≤1.0×, price near max-pain, `regime = range_sell_premium`, RV << IV → **SELL** premium (ATM straddle / the rejected side). This is where the money was: +₹2,736 on one straddle.
- **Otherwise → WAIT.** No trade in the dead zone between the walls.

**Hard rules**
1. **Never OTM on 0-DTE** — ATM only. The 22,850 PE lost to pure theta.
2. **Never enter after a >40 pt / 10-min move.** Chasing cost −₹2,023 in one day.
3. **Structural stop** — exit when spot goes back through the avg line / range edge. Tight premium-% stops get wicked (0-DTE gamma).
4. **Trailing stop on every winner** (25% off the peak). A +₹2.3k open P&L round-tripped without one.
5. **Don't fight a proven cap.** 22,900 rejected 3× → a CE there was −₹221.
6. **Cut before 15:10.**
7. **VWAP is not available** (index feed has no volume) → use the **30-min TWAP** printed by the checker.
8. One open position at a time unless deliberately scaling a *winning* range-sell.

**Sizing:** 1 lot default; scale only a working range-sell (short straddle margin ≈ ₹1.9 L/lot on NIFTY at 23k).

---

## 5. Command cheat-sheet

```bash
# check
python scripts/agent_options_check.py [--date YYYY-MM-DD]

# buy (trend)
python -m options_paper.manual enter --opt CE --strike 23000 --premium 45.5 \
  --direction LONG --stop 34 --target 73 --tag trend-buy --reason "reclaim 23000 + expanding"

# sell (range)
python -m options_paper.manual enter --opt STRADDLE --strike 22850 --premium 74.2 \
  --direction SHORT --lots 2 --stop 96 --target 44 --tag range-sell --reason "pin at max pain"

python -m options_paper.manual status
python -m options_paper.manual exit --premium 52.5 --reason "cut before CAS"

# account / week replay
python -m options_paper.runner account
python -m options_paper.runner sim --week 2026-09-21 --naked-only
```

The loop auto-exits any ledger position at its **stop/target** — `enter` is enough;
`exit` is only for judgement calls.

---

## 6. Known issues / gotchas

- **Tape starts only once the broker token is set.** On 2026-10-19 the tape began at 10:33 — the morning is gone. Set the token **before 09:15**.
- **The recorder/HTTP can hang** for 2–5 min (the snapshot is 25 MB and the per-minute work can block the loop). The checker fails fast if the tape is >5 min stale; restart the API and continue.
- **Code artifact (resolved 2026-10-20):** a short straddle was once mis-marked as
  a long by old loop code (it read only the PE leg) and force-closed for −₹3,059
  (trade id **3129**). Fixed in code, and the bogus row has been **deleted from
  the DB** (a backup was taken first). Raw `sum(net_pnl)` now reconciles.
- **`get_bot_by_uuid`**: `/api/bots/<uuid>/trades` is the only UI place agent trades show (Bots → *Agent - Options Intraday*).
- **Paper only.** `live_trading = 0` everywhere; nothing here routes real orders.

---

## 7. Learning loop

`reports/OPTIONS_PAPER_SIM/agent_ledger.md` is append-only:

| date | regime | net | best | worst | note |
|---|---|---|---|---|---|
| 2026-10-19 | range / sell-premium (0-DTE) | **+5,386** | short straddle +2,736 | PE chases −2,023 | buying lost, selling won |

**Weekly:** sum the days, split by `tag` (trend-buy vs range-sell) and by coded strategy → ask which regime paid.
**Monthly:** the same roll-up over weeks; retire tags/strategies that stay negative after ≥20 trades.
