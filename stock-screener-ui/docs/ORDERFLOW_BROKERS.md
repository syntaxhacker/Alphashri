# Order-Flow Broker Adapters

Every broker adapter implements the same contract (`api/orderflow_adapters/base.py`)
and emits the same normalized tick shape, so the journal, signal engine, recorder,
and UI are broker-agnostic. Adapters self-register via `@register_adapter` and are
imported from `api/orderflow_adapters/__init__.py`.

## Broker matrix

| Broker | Adapter (`name`) | Depth | Order counts | Symbols / conn | Connections | Transport |
|---|---|---|---|---|---|---|
| Upstox | `upstox` | 5 levels | no | 2000 | 5 | Market Data Feed V3, `full` mode |
| Fyers | `fyers` | 5 levels | **yes** | 5000 | 3 | `fyers_apiv3` data socket, `DepthUpdate` |
| Fyers TBT | `fyers_tbt` | **50 levels** | yes | 5 | 3 | `wss://rtsocket-api.fyers.in/versova`, protobuf, channels 1-50, NFO + NSE equity |
| Dhan | *(future)* | 200 levels | yes | TBD | TBD | Dhan market feed (planned) |

### Notes and limits

- **Upstox** — wraps the existing V3 streamer (`api/orderflow_stream._normalize_tick`).
  Quotes carry quantity only, so `has_order_counts` is `False`.
- **Fyers** — 5-level `DepthUpdate` (`type: "dp"`) includes per-level
  `bid_order{i}` / `ask_order{i}`. `SymbolUpdate` (`type: "sf"`) quotes have no
  book depth; the adapter falls back to the single best `bid_*` / `ask_*` level.
  The data socket allows **5000 symbols per connection, 3 connections**.
  `last_traded_time` is epoch **seconds**; it is normalized to epoch **milliseconds**.
  Access token format is `"<APP_ID>:<ACCESS_TOKEN>"`.
  Symbols are `"NSE:SBIN-EQ"`; indices are `"NSE:NIFTY50-INDEX"`.
- **Fyers TBT** — the 50-level feed, implemented by `FyersTbtAdapter`. It uses the
  separate protobuf endpoint (`wss://rtsocket-api.fyers.in/versova`), 3
  connections/user, **5 symbols/connection**, channels 1-50 via `switchChannel(...)`.
  The TBT socket carries **depth only** (no LTP/volume/VWAP), so the adapter also
  subscribes the data socket's `SymbolUpdate` quotes and **merges** them per symbol
  into one normalized tick. Verified live: `bidprice/bidqty/bidordn`,
  `askprice/askqty/askordn` are 50-element arrays; `tbq`/`tsq` come from TBT.
  The SDK callback is `on_depth_update(symbol: str, depth: Depth)`.
  Requirements: TBT is limited to NSE equity + NFO, and the token must be
  re-authenticated daily (Fyers tokens expire ~6 AM).
- **Dhan** — planned; 200-level depth, not yet implemented.

## How to add a broker adapter

1. **Subclass the contract.** Create `api/orderflow_adapters/<broker>.py` and
   implement `class <Broker>Adapter(OrderFlowAdapter)` with `name`,
   `depth_levels`, `max_symbols_per_connection`, `max_connections`,
   `has_order_counts`, plus `normalize(raw) -> [(broker_symbol, tick_data)]`.
2. **Reuse `make_depth`.** Build each side as `[{price, quantity, orders}]` and
   pass it through `make_depth` so zero/empty levels are dropped consistently.
   Map day/quote fields to the normalized tick shape documented in `base.py`;
   never raise on unknown or non-market messages — return `[]`.
3. **Import the SDK lazily.** Do the broker SDK import inside `connect()` (or a
   default `socket_factory`) so the module imports and registers even when the
   SDK is absent. Make `socket_factory` injectable for tests.
4. **Register and test.** Decorate with `@register_adapter`, make sure
   `api/orderflow_adapters/__init__.py` imports the module, and add
   `tests/test_orderflow_adapter_<broker>.py` covering the registry,
   `capabilities()`, depth/quote normalization, symbol mapping, and
   `connect()` via a fake socket (no network).

## One connection per broker (the adapter hub)

Symbol mapping lives in a single module, `api/orderflow_symbols.py` — every
adapter resolves app <-> broker symbols through it, both directions
(`to_broker_symbol` / `from_broker_symbol`). The reverse direction is what routes
ticks to subscribers; dropping it is how one instrument's price gets attributed
to another.

Connection ownership lives in `api/orderflow_adapter_hub.py`. There is exactly
**one adapter instance and one connection per broker per process**; extra
subscribers grow that connection via `OrderFlowAdapter.subscribe_symbol()` and
ticks are fanned out by app symbol. The bridge (`_AdapterOrderFlowStream`) goes
through the hub, so opening a second browser tab never opens a second socket.

This is not an optimisation — it is a correctness requirement:

> The Fyers SDK shares socket/callback state at module scope. Two adapters in one
> process cross-deliver each other's payloads, producing ticks whose
> `ltp`/`volume`/`cp` belong to a *different* instrument than the 50-level depth.
> Observed live: RAYMOND's book (top 989.4/989.9, `vwap` 981.5) paired with
> RELIANCE's `ltp` 1250.3 / `vol` 7143314, which the UI rendered as
> `Day +25.46%` and a `-13,275,788` CVD.

Verified server-side with two concurrent bridge subscriptions (RAYMOND +
RELIANCE): the API worker held exactly **2** Fyers sockets (1 TBT + 1 quote), and
each symbol reported only its own `cp` (995.95 vs 1235.3), monotonic volume, and
a CVD under 0.1% of day volume. The headless recorder stays a **separate
process** for the same reason.

If an adapter cannot add symbols in place, the hub fails loudly rather than
opening a second connection.
