# Order Flow — VWAP Calculation & Upstox Connection Limits

Reference for the Order Flow tab (`/orderflow`) and its WebSocket bridge
(`api/orderflow_stream.py`).

---

## 1. What VWAP is

VWAP (Volume-Weighted Average Price) is the average traded price over a session,
weighted by traded volume:

```
VWAP = Σ(price_i × volume_i) / Σ(volume_i)
```

It is a **whole-session** average: it starts at the open and is dominated by
where most volume traded, so it moves slowly and **lags large late-session
moves** by design. This is the same VWAP TradingView and bookmap-style tools
draw.

### Using typical price

When reconstructing VWAP from candles (no tick data), each bar's "price" is its
typical price:

```
typical = (high + low + close) / 3
VWAP    = Σ(typical_i × volume_i) / Σ(volume_i)
```

---

## 2. How the Order Flow tab computes it

The chart does **not** estimate VWAP from received ticks. It uses the exchange's
own value, which is exact:

* Upstox `full` mode ships **`atp`** — *Average Traded Price* — in every tick
  (`marketFF.atp`). By definition `atp = turnover / volume = VWAP`.
* The bridge maps it to `data.vwap`:
  `api/orderflow_stream.py` → `_normalize_tick()` → `"vwap": _num(mff.get("atp"))`.
* The visualizer uses it directly, and only falls back to a since-connect
  average if `atp` is absent/zero:

  ```js
  const sessionVwap = (data.vwap && data.vwap > 0) ? data.vwap : null;
  const vwap = sessionVwap != null
    ? sessionVwap
    : (liveVwapDen > 0 ? liveVwapNum / liveVwapDen : currentLtp);
  ```

Because it comes from the exchange, it is the **true session VWAP from the
open** — not "since you connected".

---

## 3. Verification

Cross-checked against independently fetched 1-minute candles for RAYMOND
(NSE, 2026-09-15):

| Source | Value |
|---|---|
| Upstox `atp` (shown on chart) | 1069.46 |
| VWAP from 1-min typical-price × volume | 1069.35 |
| Difference | 0.11 (0.01%) |

The two agree to rounding, confirming `atp` is a faithful session VWAP.

### Why VWAP can sit far from the last price

Same example: RAYMOND opened ~1015, hit a high of **1122**, then sold off to
~991. Most of its ~22.7M shares traded near 1100+, so the session average
(~1069) ended up ~8% above the last price. That is expected behaviour, not a
data error.

---

## 4. Upstox connection & subscription limits

From the Upstox Market Data Feed V3 docs:

| Limit | Standard | Upstox Plus |
|---|---|---|
| **WebSocket connections / user** | **2** | **5** |
| Subscriptions `ltpc` | 5000 keys | 5000 keys |
| Subscriptions `full` | 2000 keys | 2000 keys |
| Subscriptions `option_greeks` | 3000 keys | 3000 keys |
| Subscriptions `full_d30` | — | 50 keys |
| Combined cap (multi-category) | 2000 / 1500 keys | 2000 / 1500 keys |

### How the bridge maps to connections

* Each browser tab that subscribes through `/ws/orderflow` opens **one** Upstox
  `MarketDataStreamerV3` connection (`full` mode, 5-level depth).
* So concurrent Order Flow tabs ≈ concurrent Upstox connections. On the
  standard plan that is **2 tabs**; on Plus, **5**.
* `ORDERFLOW_MAX_CONNECTIONS` (default `5`) caps how many Upstox connections the
  bridge will open at once. Requests beyond the cap get a friendly
  `subscribe` error instead of a raw Upstox `403`, and are not opened.
* If Upstox itself returns `403 Forbidden` on connect, it is almost always the
  per-user connection limit — close another Order Flow tab (or upgrade the
  plan) and reconnect.

> Tokens expire **daily around 03:30 IST** and are unrelated to market hours.
> Market close does not invalidate an access token.

---

## 5. Session journal & reload

Ticks are journaled per symbol/day (`api/orderflow_journal.py`). On subscribe the
bridge replays the last 600s / 3000 ticks (plus the last 20 signals) as a
`{type:"history"}` message, so a reloaded chart rebuilds its bars, depth,
trades, CVD, VWAP and signal markers. `warm_start()` also replays the journal
into a fresh `OrderFlowSignalEngine` so session CVD survives reconnects.
