# TradingView library usage — verified field contract

Verified 2026-11-24 against `https://scanner.tradingview.com/{market}/scan` via our own
`api.tv.scan_raw` (100-row probe per market, `india` + `america`). This is a measured
field contract for the public `tradingview_screener` Python library — not a guess and
not a description of the popup screener's internal payload. Source probes and the
translation history live in [`MARKET_SECTIONS_PLAN.md`](./MARKET_SECTIONS_PLAN.md).

## 1. Call shape

```python
count, df = (
    Query()
    .set_markets(market)          # "india" | "america" | "global" (explicit country list)
    .select(*fields)              # flat field names only, see §2
    .where(Column("average_volume_10d_calc") > 100_000, Column("close") > 10)
    .limit(n)
    .get_scanner_data()
)
```

- `get_scanner_data()` returns `(count, df)` — total match count plus the requested
  page of rows. The same call shape is used in `api/sections/service.py`.
- `ticker` is **auto-added** to the frame; do not select it explicitly.
- `Column` is **name-only** (`column.py:49-56`): `Column("close") > 10`. It has no
  `params`, so a structured `{"id": ..., "params": ...}` column cannot be expressed.

## 2. Flat field catalogue (exact names, verified)

Intraday groups are spelled out; `change|1|5|15|30|60` means the five separate fields
`change|1`, `change|5`, `change|15`, `change|30`, `change|60`, and likewise for the
other slash groups.

| Group | Exact field names |
|---|---|
| Price / change | `close`, `change` (day %), `change_abs`, `change|1`, `change|5`, `change|15`, `change|30`, `change|60` |
| Volume | `volume`, `volume_change|5`, `volume_change|15`, `relative_volume_10d_calc`, `average_volume_10d_calc` |
| 52-week | `price_52_week_high`, `price_52_week_low` |
| Moving averages | `EMA20`, `EMA50`, `SMA20`, `SMA50`, `SMA200` |
| Indicators | `VWAP`, `RSI`, `ADX`, `ATR`, `Volatility.D`, `Volatility.W` |
| Performance | `Perf.W` |
| Metadata | `market_cap_basic`, `type`, `exchange`, `update_mode`, `description` |

`change|N` is the percentage move over **N minutes** and is distinct from calendar
returns (`Perf.W`); see `api/tv/columns.py:120-129` (`INTRADAY_CHANGE_FIELDS`).

## 3. Popup payload → library fields (no structured params)

The popup screener emits structured columns such as
`{"id":"Change","params":{"resolution":"TimeResolution30"}}`. **Neither the public
`/scan` endpoint nor `tradingview_screener.Column` accepts that shape here** — the
structured body returns `400 json parse error`. Translate every UI concept to the
library's flat name before selecting it:

| Popup payload column | Library `select()` field | Meaning |
|---|---|---|
| `TickerUniversal` | `ticker` (auto), `name` | symbol |
| `Price` | `close` | last price |
| `Change` `TimeResolutionN` | `change|N` | N-minute % move |
| `ChangeAbs` `TimeResolution1D` | `change_abs` | day absolute change |
| `VolumeChange` `TimeResolution5` | `volume_change|5` | 5-minute volume change % |
| `Volatility` `Interval1W` | `Volatility.W` | weekly volatility |
| `Performance` `Interval1W` | `Perf.W` | weekly performance |
| `RelativeVolume` `TimeResolution1D` | `relative_volume_10d_calc` | relative volume (10d) |
| `AverageVolume` `Interval10D` | `average_volume_10d_calc` | 10-day average volume |
| `MarketCap` | `market_cap_basic` | market cap |

## 4. Fields that do not exist

These were probed and returned `None` (under `ignore_unknown_fields=False`) — never
select them and never manufacture a value for them:

`change_1m`, `change_5m`, `Perf.1D`, `relative_volume_5d_calc`,
`relative_volume_1d_calc`, `PriceToVWAP`.

## 5. Invariants

1. **Exactly one TV request per market per cache window.** Cache the scored frame per
   market, not per filter combination; never push user filters to the network.
2. **User filters are applied in Python** after the single fetch, against the union of
   fields the active sections need.
3. **Select `update_mode` and exclude `delayed_*` from live sections.** The probe
   returned `update_mode = delayed_streaming_900` for all rows in this environment;
   delayed rows get a visible delay badge and cannot feed "next minute" sections.
4. **India: BSE duplicate rows → prefer NSE.** The same company appears on both
   exchanges with different tickers; keep the NSE listing.
5. **America: require `type == "stock"` and `exchange` in {NASDAQ, NYSE, AMEX}.**
   The `america` scan otherwise includes OTC and foreign listings.

## 6. Measured coverage (100-row probe, India + America)

Every field listed in §2 was **100% non-null** in both markets, with one exception:
`relative_volume_10d_calc` and `average_volume_10d_calc` were non-null in **99/100**
America rows. There is no net-cash / EV / analyst-target column in this field set —
do not imply one exists.
