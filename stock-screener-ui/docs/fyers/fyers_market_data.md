# FYERS v3 REST Market Data

**Base host:** `https://api-t1.fyers.in/data`  
**Header:** `Authorization: <APP_ID>:<ACCESS_TOKEN>` (no `Bearer`)  
**SDK:** `fyers-apiv3==3.1.17`; `FyersModel.history()`, `quotes()`,
`depth()` and `optionchain()` all select this data host with `data_flag=True`.
[SDK: `fyersModel.py:15-20,1219-1317`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L1219-L1317)

The official machine-readable reference is
[market-data.md](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md).
Use native symbols: equity `NSE:SBIN-EQ`; index
`NSE:NIFTY50-INDEX`/`NSE:NIFTYBANK-INDEX`.

## Historical candles — `GET /data/history`

```python
data = {
    "symbol": "NSE:SBIN-EQ",
    "resolution": "5",
    "date_format": "1",       # 0=epoch seconds, 1=yyyy-mm-dd
    "range_from": "2024-01-01",
    "range_to": "2024-01-31",
    "cont_flag": "1",         # continuous futures where supported
    "oi_flag": "1",           # append Open Interest to every candle
}
resp = fyers.history(data=data)
```

| Parameter | Meaning |
|---|---|
| `symbol` | Fyers symbol, e.g. `NSE:SBIN-EQ` |
| `resolution` | See values below |
| `date_format` | `0` epoch, `1` `yyyy-mm-dd` |
| `range_from`, `range_to` | Start/end in the selected date format |
| `cont_flag` | `1` requests continuous futures data |
| `oi_flag` | `1` appends OI to each candle |

**Resolutions:** seconds `5S`, `10S`, `15S`, `30S`, `45S`; minutes `1`, `2`,
`3`, `5`, `10`, `15`, `20`, `30`, `60`, `120`, `240`; daily `D`/`1D`; weekly
`1W`; monthly `1M`. The SDK docstring lists the core minute/day values; the
official reference supplies the seconds and week/month values. [SDK:
`fyersModel.py:1219-1233`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L1219-L1233)
[Official reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md)

**Range caps:** minute resolutions are 100 days per request and history starts
3 Jul 2017; day/week/month are 366 days per request; seconds are limited to
the last 30 trading days. Chunk larger ranges and concatenate. These limits
are stated by the official reference, not enforced by the SDK wrapper.
[Official reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md)

Successful candle rows are positional:

```text
[epoch, open, high, low, close, volume]
[epoch, open, high, low, close, volume, open_interest]  # oi_flag=1
```

The response is `{"s":"ok","candles":[...]}`. Always inspect `s`/`code` and
handle an error response; the SDK returns parsed JSON rather than raising for
HTTP errors. [SDK: `fyersModel.py:139-194`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L139-L194)

## Quotes — `GET /data/quotes`

```python
resp = fyers.quotes(data={"symbols": "NSE:SBIN-EQ,NSE:TCS-EQ"})
```

`symbols` is comma-separated and the SDK documents a hard maximum of **50**.
The response is `d[]`; each row has `n` (symbol) and `v` (values), commonly
`lp`, `ch`, `chp`, `open_price`, `high_price`, `low_price`,
`prev_close_price`, `volume`, `bid`, `ask`, `atp`, `spread`, `tt`, `fyToken`.
Use a quote as a snapshot; use the data socket for live updates. [SDK:
`fyersModel.py:1249-1270`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L1249-L1270)
[Official reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md)

FYERS support states that the quotes API does **not** provide OI; do not wait
for `oi` in `v`. [Support: OI in Quotes](https://support.fyers.in/portal/en/kb/articles/is-open-interest-oi-data-available-in-the-quotes-api-of-fyers)

## Market depth — `GET /data/depth`

```python
resp = fyers.depth(data={"symbol": "NSE:SBIN-EQ", "ohlcv_flag": "1"})
```

`symbol` is one symbol; `ohlcv_flag=1` adds OHLCV. The response is keyed by
symbol and contains `bids[]`/`asks[]`, normally five levels each:

```json
{
  "d": {"NSE:SBIN-EQ": {
    "bids": [{"price": 799.5, "volume": 100, "ord": 1}],
    "asks": [{"price": 800.5, "volume": 200, "ord": 2}],
    "totalbuyqty": 40000, "totalsellqty": 51000,
    "ltp": 800.0, "v": 1234567, "atp": 799.8,
    "oi": 0, "oiflag": true, "pdoi": 0, "oipercent": 0,
    "lower_ckt": 0, "upper_ckt": 0
  }}
}
```

The support article confirms quantities, OHLCV, and bid/ask data; the official
reference documents the five-level shape and circuit/total fields. OI fields
can be present but zero/unsupported for some option symbols, so check
`oiflag`/support behavior rather than treating `0` as a valid reading. [SDK:
`fyersModel.py:1272-1292`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L1272-L1292)
[Market Depth support](https://support.fyers.in/portal/en/kb/articles/how-do-i-use-the-market-depth-api-to-get-market-depth-data-for-a-specific-symbol) ·
[Official reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md)

## Option chain — `GET /data/options-chain-v3`

**Wire spelling matters:** the installed SDK and FYERS support use
`strikecount` (no underscore), not `strike_count`. `strike_count` is a
conceptual name; sending it as the query key is **UNCERTAIN/likely ignored**.
[SDK: `fyersModel.py:1295-1317`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L1295-L1317)
[FYERS community parameter example](https://fyers.in/community/t/option-chain-update-frequqency/21050/7)

```python
resp = fyers.optionchain(data={
    "symbol": "NSE:NIFTY50-INDEX",  # underlying, not a CE/PE contract
    "strikecount": 5,                # max 50; N strikes each side of ATM
    "timestamp": "1774346400",       # optional expiry epoch string
    "greeks": "1",
})
```

| Parameter | Meaning |
|---|---|
| `symbol` | Underlying (`-INDEX` for index options, `-EQ` for equity) |
| `strikecount` | ATM ± N strikes; official reference default is 1, max 50 |
| `timestamp` | Expiry epoch from `data.expiryData[].expiry`; omit for nearest expiry |
| `greeks` | `"1"` requests per-leg `delta`, `gamma`, `theta`, `vega`, `iv` |

[Official option-chain reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md) ·
[SDK option-chain docstring](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L1295-L1309)

### Response map

```text
data.callOi                         total call OI
data.putOi                          total put OI
data.expiryData[]                   {date: "DD-MM-YYYY", expiry: "<epoch>",
                                    expiry_flag: "W"|"M"}
data.indiavixData                   {ltp, ltpch, ltpchp, symbol, fyToken}
data.optionsChain[]                 spot row + one row per CE/PE leg
  spot row                          option_type="", strike_price=-1,
                                    ltp/ltpch/ltpchp/fp/fpch
  option leg                        symbol, fyToken, option_type="CE"|"PE",
                                    strike_price, ltp, ltpch, ltpchp, bid, ask,
                                    oi, oich, oichp, prev_oi, volume
  leg.greeks                        delta, gamma, theta, vega, iv when requested
```

`expiryData[].expiry` is the value to send as `timestamp`; the display `date`
is not the request parameter. The underlying spot row and `indiavixData` do
not have an option Greeks block. [Official reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md)

`strikecount=N` selects N strikes on each side of ATM. Classify the returned
strikes client-side: for a call, `K < spot` is ITM; for a put, `K > spot` is
ITM; the nearest strike is ATM (reverse the sides for OTM). The API response
does not guarantee an explicit `itm/atm/otm` label. [Response fields and
strike-count semantics: official reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md)

## Market status (small but useful)

`GET /data/marketStatus` returns `marketStatus[]` with exchange, segment,
`market_type`, and `status` such as `OPEN`, `CLOSE`, `PREOPEN`, or
`POSTCLOSE_START`. Check it before treating a feed as tradable. [Official
reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/market-data.md)
