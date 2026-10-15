# FYERS v3 Gotchas

These are observed failure modes, not API promises. Paths refer to the
installed `fyers-apiv3==3.1.17` unless marked otherwise.

## 1. The data socket deletes OI and 52-week fields

`map.json` includes `OI`, `Yhigh`, and `Ylow` in the incoming full equity
quote (`scrips`) field map, but `data_ws.py` removes all three immediately
before invoking `On_message`. A callback therefore cannot see values that
were on the wire.
[SDK map](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/map.json#L2-L26) ·
[SDK mutation](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L903-L987)

**Impact:** do not diagnose a provider outage when `OI`, `Yhigh`, or `Ylow` is
missing from `FyersDataSocket` output. `tbt_ws.py` does not perform this pop,
but depth-mode TBT packets may not populate the corresponding quote fields;
use raw protobuf presence checks or a separate quote/REST source. [SDK
comparison](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L356-L374)

## 2. TBT is a process-wide singleton; callback symbol is `value.ticker`

`FyersTbtSocket.__new__` caches `_instance`. A second construction returns
the first object and then runs `__init__` again (overwriting `onDepthUpdate`)
and can merge stale channel/book state. **Use one TBT socket per process,
period.** [SDK: `tbt_ws.py:150-214`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L150-L214)

`DataStore.updateDepth` iterates `packet.feeds` and calls the callback with
`value.ticker`, not the map key or the symbol you originally subscribed. Route
and validate using that returned ticker. [SDK:
`tbt_ws.py:132-147`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L132-L147) ·
[local mismatch regression](../../tests/test_orderflow_adapter_fyers.py#L376-L392)

The data and order socket classes also implement `_instance`/`__new__`
singletons; one instance of each per process is the safe model. [SDK:
`data_ws.py:129-137`, `order_ws.py:13-20`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L129-L137)

## 3. TBT depth is not a trade-print feed

The installed `SubscriptionModes` enum exposes only `DEPTH`; the TBT parser
calls `updateDepth`, not a trade handler. The public Fyers community request
also reports that individual executions are absent and that LTQ/VTT are
aggregated. **No true time-and-sales or aggressor-side stream is available
from this TBT mode.** [SDK:
`tbt_ws.py:33-35,356-374`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L33-L35) ·
[Community feature request](https://fyers.in/community/feedback-feature-requests-it03436p/post/feature-request-add-individual-trade-data-stream-to-fyers-tbt-websocket-mx1bPibC03GCmTk)

A cumulative volume delta can estimate aggregate flow only; it cannot recover
each fill, its aggressor, or exact execution timestamp. The local bridge uses
volume deltas for Upstox and explicitly documents that limitation. [Local
`orderflow_stream.py:18-22`](../../api/orderflow_stream.py#L18-L22)

## 4. Protobuf field existence is not field population

The schema has quote, extended-quote, daily-quote, OHLCV and symbol-detail
sub-messages, but the live TBT **depth** capture observed `quote`, `eq`, and
`dq` unpopulated: OI was 0 and no `yh`/`yl` arrived. Do not turn default
protobuf values into market facts. [Schema](https://public.fyers.in/tbtproto/1.0.0/msg.proto) ·
[local raw-probe implementation](../../scripts/orderflow_probe_feed.py#L29-L92)

`MarketLevel.num` (the raw feed's per-level count) was present in the raw
live capture, even when quote fields were absent. The installed SDK's
`Depth` object does not copy `num`; it only copies `nord` into
`bidordn`/`askordn`. Raw consumers must read `num` from `MarketLevel`;
SDK-callback consumers need a separate preservation layer.
[SDK: `tbt_ws.py:60-93`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L60-L93)

`MarketFeed.symdetail.ticksize` was present in the raw probe in some live
captures, while normalized TBT journal records from the local capture did not
retain it. **UNCERTAIN whether every packet/session populates ticksize:** use
`HasField` and a non-empty check per packet, never a permanent default. [Local
journal sample](../../experiments/data/orderflow_journal/fyers_tbt_ICICIBANK_2026-09-23.jsonl#L1) ·
[probe script](../../scripts/orderflow_probe_feed.py#L85-L89)

## 5. A TBT 403 handshake can leak Cloudflare cookies

The local TBT log shows `403 Forbidden` handshakes and the raw response can
contain `__cf_bm`, `_cfuvid`, and `cf-ray`. The cookie values are credential-
adjacent: **never log, return, or show them**. The repository's transport
redaction filter and tests exist specifically because `websockets` emits the
raw response before adapter error handling. [Local evidence (values
intentionally omitted)](../../fyersTBTSocket.log#L70-L84) ·
[`orderflow_logging.py`](../../api/orderflow_logging.py#L1-L49) ·
[`test_orderflow_log_redaction.py`](../../tests/test_orderflow_log_redaction.py#L1-L76)

A 403 in this setup commonly follows a stale token; the data socket separately
reports `Token is expired` as code `-99`. Treat 401/403/token-expired as
re-authentication, not as a retryable market-data condition. [SDK:
`data_ws.py:263-295`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L263-L295)

## 6. Combined tokens fail when passed to `FyersModel`

`FyersModel(client_id=APP_ID, token=ACCESS_TOKEN)` builds the REST header
itself. Passing the socket-style `APP_ID:ACCESS_TOKEN` as `token` duplicates
the app id; the observed error is code `-15`, `Please provide valid token`.
Split the value first, then pass the two fields separately. [SDK:
`fyersModel.py:698-719`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L698-L719) ·
[local implementation](../../api/fyers_options.py#L57-L75)

## 7. `setQueueProcessInterval` is documented but absent in this install

The official Fyers skill says `setQueueProcessInterval(ms)` accepts 1–2000
ms, but the installed `3.1.17` source has no such method on the data or TBT
socket. Do not call it unguarded; check `hasattr` or pin/inspect the SDK
version first. [Official WebSocket reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/websocket.md) ·
[installed data socket](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py)

## 8. The option-chain wire key is `strikecount`

The SDK docstring, official reference, and FYERS support example all use
`strikecount` (no underscore), max 50. `strike_count` is not the verified
FYERS query spelling. [SDK](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L1295-L1309) ·
[FYERS support example](https://fyers.in/community/t/option-chain-update-frequqency/21050/7)

## 9. Raw TBT prices are scaled; SDK depth omits one schema field

The installed SDK divides `MarketLevel.price.value` by 100 when constructing
`Depth`. A raw protobuf consumer must apply the same scale, and must read
`num` itself because the SDK callback does not expose it. [SDK:
`tbt_ws.py:60-93`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/tbt_ws.py#L60-L93)

## 10. Symbol and endpoint mismatches fail silently or noisily

Use `NSE:SBIN-EQ` for equity and `NSE:NIFTY50-INDEX` for indices; the SDK
converts symbols through `/data/symbol-token`. Index depth is explicitly
reported as unsupported. The TBT endpoint is separate from the data socket;
order updates are a third URL. [SDK:
`data_ws.py:19-122`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L19-L122) ·
[local adapter map](../../api/orderflow_adapters/fyers.py#L13-L16)
