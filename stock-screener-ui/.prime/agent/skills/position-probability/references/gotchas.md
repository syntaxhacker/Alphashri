# Gotchas — things that silently corrupt the numbers

Every item here cost time during the IRFC / POWERGRID runs (Nov-2026).

## Upstox

1. **The daily endpoint omits the current session.** `fetch_historical_data_v3`
   returns up to the previous close. Always append today from
   `fetch_intraday_data_v3(symbol, "1")` or the RSI, drawdown and volume ratio are
   one session stale.
2. **The daily series contains the Diwali-muhurat session** (e.g. Sunday 8-Nov-2026),
   which Yahoo/most feeds omit. It is a real session — do not "clean" it out, but do
   not expect the session count to match another vendor's.
3. **Index ids are not symbols.** `NIFTY`, `MIDCPNIFTY`, `BANKNIFTY` etc. resolve
   through `chart_patterns/indices.py::INDEX_KEYS`; passing a wrong id returns
   "symbol not found" and (worse) silently blacks the symbol in the instrument cache.
4. **`upstox_trader` and the root `config.py` live one level above the repo root.**
   Add both the repo root and its parent to `sys.path` or the import fails.
5. `pd.concat` on two tz-aware series warns under pandas 4 — pass `sort=True`.

## Option chains (local API)

6. **`summary.expected_move` is a 0.61×straddle convention, not a 1σ move.** For
   NIFTY on 23-Nov-2026 it printed ±368 points while the ATM straddle implied
   ±755. Reading it as 1σ understates the market's implied range by ~half. The
   script computes 1σ from the straddle instead.
7. **ATM IV in the chain summary (16.1%) does not square with the straddle-implied
   vol (13.8%)** — the per-strike IVs are computed on wide bid/ask quotes with some
   stale prints (e.g. 35% IV on a strike whose neighbours are ~17%). Prefer the
   straddle.
8. **No stock options.** IRFC, POWERGRID, HAL etc. have no listed chain, so the
   market-implied view for a single name is the index view mapped through betas.
   Only NIFTY / BANKNIFTY / MIDCPNIFTY / SENSEX chains exist on the local API.
9. **Max pain is not a forecast** — it is where open interest is balanced. Report
   it as positioning, not as a target.
10. Mint the token with the QA login; a copied token literal from a previous run is
    rejected as invalid.

## Statistics

11. **Episodes vs pooled days.** Overlapping forward-return windows count one rally
    many times. Always report both: `n_ep` (entries `H` sessions apart) is the
    honest sample, `n_pool` is the flattering one. A "P(up) = 57%" from 14 episodes
    and the same number from 73 overlapping days are not the same claim.
12. **A centred 21-session RSI peak needs one future session**, so the newest row
    is always NaN in the decay table — the "sessions since peak" for today is
    approximate. If RSI is still rising, the exhaustion clock has not started.
13. **Drawdown episodes double-count a slide.** A 33% slide prints a trough for
    every 30% leg. Merge troughs within 60 sessions and keep the deepest.
14. **The conditional split that matters is above vs below the 200-DMA.** Momentum
    above the 200-DMA and momentum below it behave differently enough to flip a
    verdict; pooling them is what made the first IRFC answer misleading.
15. **Sample-window choice changes the conclusion.** IRFC momentum episodes from
    2021 include the 2022–24 melt-up (mean +8.9%); the 2023–26 window alone gives
    ~−2%. Always state the window, and prefer the full listed history.
16. **Units**: `d200`/`rsi`/`ret10` are fractions or points; `pct()` in the report
    multiplies by 100 — mixing them is the easiest way to publish a wrong number.

## Market context (Nov-2026)

17. The NSE monthly expiry now falls on a **Tuesday**, and weekly expiries on
    Thursday. If your target date is an expiry, the pin (max pain) matters more
    than usual.
18. **RBI repo 5.50%** (hiked 7-Oct-2026). Risk-neutral drift = repo − dividend
    yield; for a 2.7% yield name that is ~2.8% annual.
