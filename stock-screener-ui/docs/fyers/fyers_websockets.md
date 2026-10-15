# FYERS v3 WebSockets

**SDK under test:** `fyers-apiv3==3.1.17` in
`stock-screener-ui/.venv/lib/python3.12/site-packages/fyers_apiv3/`.
The official reference is the [Fyers WebSocket reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/websocket.md).

## Choose a feed

| Need | Feed | Payload |
|---|---|---|
| LTP/quote/strategy | Data socket, `SymbolUpdate` | JSON-like SDK dict |
| Low bandwidth LTP | Data socket, `litemode=True` | LTP-only payload |
| Five-level book | Data socket, `DepthUpdate` | Five bid/ask levels |
| 50-level book | TBT/Versova | Protobuf `SocketMessage` |
| Order/trade/position updates | Order socket | JSON messages |

All three sockets authenticate with the **combined** value
`APP_ID:ACCESS_TOKEN`; the data socket's SDK URL is
`wss://socket.fyers.in/hsm/v1-5/prod` (the support article still shows an
older `/socket/v2/data/` URL, so do not hard-code that legacy URL with this
SDK). [SDK: `data_ws.py:129-175`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L129-L175) ·
[Support article](https://support.fyers.in/portal/en/kb/fyers-api-integrations/fyers-api/api-v3/data-websocket)

## Data socket (`data_ws.FyersDataSocket`)

```python
from fyers_apiv3.FyersWebsocket import data_ws

ws = data_ws.FyersDataSocket(
    access_token=f"{APP_ID}:{ACCESS_TOKEN}",
    log_path="", litemode=False, write_to_file=False, reconnect=True,
    on_connect=lambda: (
        ws.subscribe(
            symbols=["NSE:SBIN-EQ", "NSE:NIFTY50-INDEX"],
            data_type="SymbolUpdate", channel=11,
        ),
        ws.keep_running(),
    ),
    on_message=print, on_error=print, on_close=print,
)
ws.connect()
```

Use a separate subscription for `data_type="DepthUpdate"`; the installed SDK
accepts `channel` (default `11`). `unsubscribe()` takes the same
`symbols`/`data_type`/`channel` shape. [SDK:
`data_ws.py:1731-1810`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L1731-L1810)

### Data modes and messages

- `SymbolUpdate`: `ltp`, `prev_close_price`, `open_price`, `high_price`,
  `low_price`, `ch`, `chp`, `vol_traded_today`, `last_traded_time`,
  `exch_feed_time`, `bid_price`, `ask_price`, `bid_size`, `ask_size`,
  `last_traded_qty`, `tot_buy_qty`, `tot_sell_qty`, `avg_trade_price`.
- `DepthUpdate`: `bid_price1..5`, `ask_price1..5`, `bid_size1..5`,
  `ask_size1..5`, `bid_order1..5`, `ask_order1..5`.
- `litemode=True` is intended for LTP-only delivery; the SDK's lite mapper is
  `ltp`, `symbol`, `type` (`sf`). [SDK:
  `map.json:2-71`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/map.json#L2-L71)
- Message `type` values include `cn` (connect), `sub`, `if` (index),
  `dp` (depth), and `sf` (equity/option quote). [SDK:
  `defines.py:31-37`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/defines.py#L31-L37)

The official skill says **5000 symbols per connection**; the current support
article describes **5000 unique symbols per API key** (the SDK enforces the
ceiling on its per-connection state). Older support pages quote smaller
historical limits ([old 200-symbol page](https://support.fyers.in/portal/en/kb/articles/what-is-the-maximum-number-of-symbols-i-can-subscribe-to-in-the-data-websocket-20-11-2023)).
Treat 5000 as the documented ceiling and verify the entitlement. The SDK
itself rejects over-5000 symbol state. [Current support
limit](https://support.fyers.in/portal/en/kb/articles/is-there-a-limit-to-the-number-of-symbols-i-can-track-using-the-data-websocket-in-api-v3) ·
[SDK check](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L1313-L1325)

The official reference mentions `setQueueProcessInterval(ms)` with a 1–2000 ms
range, but **that method is absent from installed `3.1.17`**. Treat it as
version-specific and guard it:

```python
if hasattr(ws, "setQueueProcessInterval"):
    ws.setQueueProcessInterval(5)
```

[Official reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/websocket.md) ·
[Installed source scan](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py)

## TBT/Versova socket (50-level protobuf)

Bootstrap URL: `https://api-t1.fyers.in/indus/home/tbtws`; fallback WebSocket
URL: `wss://rtsocket-api.fyers.in/versova`. The feed is documented for NFO
and NSE equity, with **3 connections per app/user, 5 symbols per connection,
and channels 1–50**. The first message is a snapshot; later messages are
updates/diffs. [Official TBT
reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/websocket.md)

```python
from fyers_apiv3.FyersWebsocket.tbt_ws import (
    FyersTbtSocket, SubscriptionModes,
)

def on_open():
    tbt.subscribe(
        symbol_tickers={"NSE:SBIN-EQ"},
        channelNo="1",
        mode=SubscriptionModes.DEPTH,
    )
    # Required: the subscribe alone does not resume the channel.
    tbt.switchChannel(resume_channels={"1"}, pause_channels=set())
    tbt.keep_running()

tbt = FyersTbtSocket(
    access_token=f"{APP_ID}:{ACCESS_TOKEN}",
    on_open=on_open,
    on_depth_update=lambda ticker, depth: print(ticker, depth),
    on_error=print,
)
tbt.connect()
```

The installed SDK emits these JSON control frames (sets are converted to
lists): [SDK: `tbt_ws.py:235-317`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L235-L317)

```json
{"type":1,"data":{"subs":1,"symbols":["NSE:SBIN-EQ"],"mode":"depth","channel":"1"}}
{"type":2,"data":{"resumeChannels":["1"],"pauseChannels":[]}}
```

For unsubscribe use `subs:-1`. `on_depth_update(ticker, depth)` is called
with `ticker = value.ticker`; the callback receives the SDK `Depth` object,
not the raw `MarketFeed`. [SDK:
`tbt_ws.py:132-147,319-334`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L132-L147)

### `MarketFeed` schema map

[Official protobuf schema](https://public.fyers.in/tbtproto/1.0.0/msg.proto) ·
[installed descriptor introspection](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/msg_pb2.py)
(`stock-screener-ui/.venv/bin/python -c "from fyers_apiv3.FyersWebsocket import msg_pb2 as m; print([(n,[f.name for f in x.fields]) for n,x in m.DESCRIPTOR.message_types_by_name.items()])"`)

| Message | Fields |
|---|---|
| `MarketFeed` | `quote`, `eq`, `dq`, `ohlcv`, `depth`, `feed_time`, `send_time`, `token`, `sequence_no`, `snapshot`, `ticker`, `symdetail` |
| `Quote` | `ltp`, `ltt`, `ltq`, `vtt`, `vtt_diff`, `oi`, `ltpc` |
| `ExtendedQuote` | `atp`, `cp`, `lc`, `uc`, `yh`, `yl`, `poi`, `oich`, `pc` |
| `DailyQuote` | `do`, `dh`, `dl`, `dc`, `dhoi`, `dloi` |
| `OHLCV` | `open`, `high`, `low`, `close`, `volume`, `epoch` |
| `Depth` | `tbq`, `tsq`, `asks`, `bids`; each `MarketLevel` is `price`, `qty`, `nord`, `num` |
| `SymDetail` | `ticksize` |
| `SocketMessage` | `type`, `feeds` (`map<string, MarketFeed>`), `snapshot`, `msg`, `error` |

Semantics: `Quote` is LTP/last-trade time and quantity/day volume/OI/change;
`ExtendedQuote` is average/close, circuits, yearly high/low, prior OI and
prior close; `DailyQuote` is day OHLC plus day OI low/high; `OHLCV` is one
candle and epoch; `Depth` is total buy/sell quantity plus bid/ask
`MarketLevel`s; `SymDetail` is tick size. `SocketMessage.type` is the
`ping/quote/extended_quote/daily_quote/market_level/ohlcv/depth/all/response`
enum. The other `MarketFeed` members are feed/send timestamps, token,
sequence, snapshot flag, and ticker. [Official schema](https://public.fyers.in/tbtproto/1.0.0/msg.proto)

The schema permits more than a depth-only packet actually carries; see
[gotchas](fyers_gotchas.md) before reading default-valued fields as data. The
installed TBT `Depth` object scales wire prices by `/100` and maps `nord` to
`bidordn`/`askordn`; it does not copy `num` into that object. [SDK:
`tbt_ws.py:60-93`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L60-L93)

## Order socket

URL: `wss://socket.fyers.in/trade/v3`; header is
`authorization: APP_ID:ACCESS_TOKEN`. [SDK:
`order_ws.py:394-415`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/order_ws.py#L394-L415)

```python
from fyers_apiv3.FyersWebsocket import order_ws

def on_open():
    orders.subscribe(data_type="OnOrders,OnTrades,OnPositions")
    orders.keep_running()

orders = order_ws.FyersOrderSocket(
    access_token=f"{APP_ID}:{ACCESS_TOKEN}",
    on_connect=on_open,
    on_orders=print, on_trades=print,
    on_positions=print, on_general=print,
)
orders.connect()
```

`OnGeneral` expands to `edis`, `pricealerts`, and `login`. The raw frames are:

```json
{"T":"SUB_ORD","SLIST":["orders","trades","positions","edis","pricealerts","login"],"SUB_T":1}
{"T":"SUB_ORD","SLIST":["orders","trades","positions","edis","pricealerts","login"],"SUB_T":-1}
```

`SUB_T=1` subscribes and `-1` unsubscribes. The SDK sends the string
`"ping"` every 10 seconds; a raw client must do the same. The official
reference records success as code `1605`; 403 means bad token and 404 means
wrong URL. [SDK: `order_ws.py:104-109,341-356,467-510`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/order_ws.py#L104-L109)
[Official WebSocket reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/websocket.md)
