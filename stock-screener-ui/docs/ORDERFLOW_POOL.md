# Order Flow — Upstox Connection Pool

Reference for `api/orderflow_pool.py`. Kept intentionally small; it is the
future-ready foundation for multiplexing many instrument subscriptions onto the
few WebSocket connections Upstox allows.

## Why

```
full mode: up to 2000 instrument keys PER connection
Upstox Plus: 5 connections  ->  up to ~10,000 key-subscriptions
```

## Today (one connection per subscriber)

```
 subscriber A (RELIANCE) ─▶ slot#A ─▶ Upstox conn 1 [RELIANCE]
 subscriber B (TCS)      ─▶ slot#B ─▶ Upstox conn 2 [TCS]
 subscriber C (INFY)     ─▶ slot#C ─▶ Upstox conn 3 [INFY]
 subscriber D (...)      ─▶  ✗ limit reached (403)
```

## Pooled (many keys per connection)

```
 subscriber A (RELIANCE) ─┐
 subscriber B (TCS)      ─┼─▶  ┌── POOL ──────────────────────┐
 subscriber C (INFY)     ─┤    │ conn 1 [RELIANCE, TCS, ...]  │──▶ Upstox 1
 subscriber D (ITC)      ─┤    │ conn 2 [INFY, ITC, ...]      │──▶ Upstox 2
 subscriber E (NIFTY CE) ─┘    │ conn 3 [NIFTY CE, ...]       │──▶ Upstox 3
                               └──────────────────────────────┘
                                still only N Upstox connections
```

## Routing

```
 Upstox feeds: { "NSE_EQ|RELIANCE": {...}, "NFO|56980": {...} }
                          │
                          ▼
                 key  ->  subscribers           (one key, one wire subscription)
                 RELIANCE -> { A, E }           (shared: 2 viewers, 0 extra cost)
                 NFO|56980 -> { C }
                          │
                          ▼
                 fan a copy of the tick to each subscriber
```

## Usage

```python
from api.orderflow_pool import UpstoxFeedPool

pool = UpstoxFeedPool(
    token_provider=get_upstox_token,     # Callable[[], str | None]
    max_connections=5,                   # Upstox Plus
    max_keys_per_connection=2000,        # full mode
)

def on_tick(instrument_key, feed):       # feed is one entry from `feeds`
    ...                                  # normalize / push to the client

pool.subscribe("NSE_EQ|INE002A01018", on_tick)
...
pool.unsubscribe("NSE_EQ|INE002A01018", on_tick)
pool.close()
```

`subscribe` de-duplicates by key (a second viewer of the same symbol costs
nothing extra) and raises `PoolFullError` only when every connection is full.

## Testing

`api/orderflow_pool.py` takes an injectable `slot_factory`, so the whole pool is
tested without a network connection — see `tests/test_orderflow_pool.py`
(slot assignment, reuse, capacity, pool-full, dedupe, routing fan-out,
unsubscribe cleanup, lifecycle).

## Not wired yet

The live bridge (`api/orderflow_stream.py`) still opens **one Upstox connection
per subscribing tab** (`ORDERFLOW_MAX_CONNECTIONS`, default 5). That already
covers the common case of a few tabs. Wiring the pool in is a contained change
(per-tab WS becomes a thin client of the pool) and should be done when the
market is open so it can be verified live.
