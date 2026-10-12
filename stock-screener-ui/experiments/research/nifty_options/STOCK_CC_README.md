# Stock covered-call retro + FYERS data plumbing

## 1. Refresh the FYERS token (do this first)

The stored token expires daily at **06:00 IST**, and the settings page currently lies
(fixed in `api/brokers.py`) — check with:

```bash
.venv/bin/python experiments/research/nifty_options/fyers_stock_options.py preflight
# PREFLIGHT OK: FYERS token valid (NIFTY=...)
# or PREFLIGHT FAIL: token rejected (expired?)
```

Three ways to give a fresh token:

1. **In the app:** Settings → Connect FYERS (OAuth). It saves to `broker_connections`.
2. **Direct OAuth URL:** open `http://localhost:8765/api/brokers/fyers/auth`, log in;
   the callback stores it.
3. **Paste it:** set `FYERS_ACCESS_TOKEN` (either the bare token or `APP_ID:TOKEN`) in
   `.env`, or export it inline. `fyers_data.resolve_token()` accepts both forms and falls
   back DB → env.

## 2. Run the covered-call retro

```bash
# model premiums (no token needed) — spot from yfinance
.venv/bin/python experiments/research/nifty_options/stock_cc_retro.py \
    --symbols RELIANCE TMPV --entry 2026-09-21 --exit 2026-09-24

# with token: real FYERS spot + real premium (listed contracts)
.venv/bin/python experiments/research/nifty_options/stock_cc_retro.py \
    --symbols RELIANCE TMPV --entry 2026-09-21 --exit 2026-09-24 --fyers
```

Notes
- NSE stock F&O is **monthly-only** (last Tuesday); the script picks that expiry automatically.
- Expired contracts are **not** served by FYERS, so a *retro* keeps a modelled premium even
  with `--fyers`; only **forward** windows can use a real premium. The output labels each row
  `MODEL` vs `FYERS`.
- `TATAMOTORS` was demerged in 2025 → the passenger-vehicle entity is **TMPV** (commercial is
  TMLCV, no Yahoo data). The universe map in the script aliases `TATAMOTORS → TMPV`.

## 3. Fetch/cache FYERS stock data

```bash
.venv/bin/python experiments/research/nifty_options/fyers_stock_options.py preflight
.venv/bin/python experiments/research/nifty_options/fyers_stock_options.py spot RELIANCE TMPV
.venv/bin/python experiments/research/nifty_options/fyers_stock_options.py chain RELIANCE
.venv/bin/python experiments/research/nifty_options/fyers_stock_options.py premiums RELIANCE \
    --expiry 2026-10-29 --strikes 1240,1260
```
Cache: `experiments/data/nifty_options/stock_fyers/`.

## 4. Forward data collection (the actual blocker)

To convert the NIFTY + stock studies from `defer` to accept/reject we need **real premiums
that settle at expiry**. Schedule the chain snapshot + OI daily during market hours, e.g.:

```bash
*/15 9-15 * * 1-5  cd <repo> && .venv/bin/python experiments/research/nifty_options/fyers_stock_options.py chain RELIANCE TMPV >> logs/stock_chain.log 2>&1
```

After 6–8 weekly cycles (NIFTY) / 2–3 monthly cycles (stocks), re-run
`tracks/structures_catalog.py` and `tracks/stock_covered_calls.py` unchanged.

## 5. FYERS historical options — verified answer (2026-09-27)

FYERS does **not** serve expired option contracts. Confirmed both ways:
- Empirically: `NSE:TMPV26SEP290CE` (listed) → `200`, N rows; `NSE:TMPV26AUG290CE` /
  `NSE:TMPV26JUL290CE` (expired) → `-300 Invalid symbol provided`.
- FYERS support (public): *"History API currently works only with active contracts.
  Expired contract data isn't available right now."* and *"for F&O, you can only access
  data for active contracts."*

So the only FYERS-compatible path to deep option history is **forward collection**.
For *retrospective* expired-option data you need another source — **Dhan API** exposes
expired options (last ~5 years); broker-neutral vendors (Intrinio, IVolatility, etc.)
also sell it. FYERS is fine for: live chains, listed-contract history (from listing date),
spot/VIX (25y daily / 5y intraday for equity), and forward capture.

Historical depth available for *listed* contracts: TMPV Sep-29 CE from ~2026-08-05,
RELIANCE Sep-29 from ~2026-08-05 (data starts at listing).
