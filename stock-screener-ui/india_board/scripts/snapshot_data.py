#!/usr/bin/env python3
"""Unusual Whales alpha snapshot — data builder (shared by CLI and dashboard)."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402


def _rows(client: UWClient, path: str, **params):
    try:
        resp = client.get(path, **params)
        if resp.status_code != 200:
            return []
        data = resp.json().get("data")
        if isinstance(data, dict):
            return [data]
        return data or []
    except Exception:  # noqa: BLE001
        return []


def _f(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _screen_rows(net_impact, unusual, oi_change, darkpool) -> list[dict]:
    """Cross-symbol whale screener — net premium plus flow / OI / dark-pool per ticker."""
    agg: dict[str, dict] = {}

    def bucket(ticker):
        return agg.setdefault(
            ticker,
            {"ticker": ticker, "net_premium": 0.0, "unusual_premium": 0.0, "oi_change": 0.0, "darkpool_premium": 0.0},
        )

    for r in net_impact:
        t = r.get("ticker")
        if t:
            bucket(t)["net_premium"] += _f(r.get("net_premium"))
    for r in unusual:
        t = r.get("ticker") or r.get("ticker_symbol") or r.get("underlying_symbol")
        if t:
            b = bucket(t)
            b["unusual_premium"] = max(b["unusual_premium"], _f(r.get("premium")))
    for r in oi_change:
        t = r.get("ticker") or r.get("underlying_symbol")
        if t:
            bucket(t)["oi_change"] += _f(r.get("oi_change"))
    for r in darkpool:
        t = r.get("ticker")
        if t:
            bucket(t)["darkpool_premium"] += _f(r.get("premium"))

    def score(r):
        return max(
            abs(r["net_premium"]),
            r["unusual_premium"],
            r["darkpool_premium"],
            abs(r["oi_change"]) * 1e6,
        )

    return sorted(agg.values(), key=score, reverse=True)[:30]


def build_snapshot(tickers: list[str] | None = None) -> dict:
    tickers = tickers or ["NVDA", "SPY", "TSLA"]
    c = UWClient()
    # fetch all independent market endpoints concurrently
    market_specs = [
        ("tide", "/api/market/market-tide", {"interval_5m": "false"}),
        ("net_impact", "/api/market/top-net-impact", {"limit": 12}),
        ("unusual", "/api/option-activity/unusual", {"limit": 15}),
        ("oi_change", "/api/market/oi-change", {"limit": 12}),
        ("darkpool", "/api/darkpool/recent", {"limit": 150}),
        ("congress", "/api/congress/recent-trades", {"limit": 200}),
        ("insider", "/api/insider/transactions", {"limit": 200}),
        ("vol_anom", "/api/volatility/anomaly/top", {"direction": "long_vol", "limit": 12}),
    ]

    def _fetch(spec):
        name, path, params = spec
        return name, _rows(c, path, **params)

    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        market = dict(pool.map(_fetch, market_specs))
    tide = market["tide"]
    net_impact = market["net_impact"]
    unusual = market["unusual"]
    oi_change = market["oi_change"]
    darkpool = market["darkpool"]
    congress = market["congress"]
    insider = market["insider"]
    vol_anom = market["vol_anom"]
    # fresh short interest comes from the stock screener (the dedicated
    # short_screener endpoint is stale) — reuse the cached opps rows, no new calls
    squeeze_fresh = []
    try:
        from opps_data import build_opps  # noqa: PLC0415

        for r in build_opps().get("rows") or []:
            if (r.get("short_int") or 0) > 0.01:
                squeeze_fresh.append(
                    {"symbol": r.get("ticker"), "si_float": r.get("short_int"), "days_to_cover": None, "day": r.get("one_day_perc")}
                )
        squeeze_fresh.sort(key=lambda r: _f(r.get("si_float")), reverse=True)
        squeeze_fresh = squeeze_fresh[:12]
    except Exception:  # noqa: BLE001
        squeeze_fresh = []
    def _gex(t):
        rows = _rows(c, f"/api/stock/{t}/gex-levels")
        if not rows:
            return None
        r = rows[0]
        return {
            "ticker": t,
            "call_wall": r.get("call_wall"),
            "put_wall": r.get("put_wall"),
            "gamma_flip": r.get("gamma_flip"),
            "gamma_magnet": r.get("gamma_magnet"),
        }

    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        gex = [g for g in pool.map(_gex, tickers) if g]

    # Index / proxy levels — SPX (ES underlying), NDX (NQ underlying) and the
    # tradable ETFs SPY/QQQ. The live futures feed is gated (Advanced tier), so
    # we surface the underlying gamma levels; ES/NQ track SPX/NDX closely.
    qqq_live = _f((_rows(c, "/api/stock/QQQ/stock-state") or [{}])[0].get("close"))
    qqq_daily = {r.get("date"): _f(r.get("close")) for r in _rows(c, "/api/stock/QQQ/ohlc/1d")}
    index_levels = []
    for t, alias in (("SPX", "ES"), ("NDX", "NQ"), ("SPY", ""), ("QQQ", "")):
        rows = _rows(c, f"/api/stock/{t}/gex-levels")
        if not rows:
            continue
        r = rows[0]
        mp = _rows(c, f"/api/stock/{t}/max-pain")
        spot = _f((_rows(c, f"/api/stock/{t}/stock-state") or [{}])[0].get("close"))
        if not spot:
            spot = _f(mp[0].get("close")) if mp else 0.0
        if not spot and qqq_live:  # NDX has no live quote — derive from QQQ ratio
            for d in _rows(c, f"/api/stock/{t}/ohlc/1d"):
                q = qqq_daily.get(d.get("date"))
                if q:
                    spot = qqq_live * (_f(d.get("close")) / q)
                    break
        index_levels.append(
            {
                "ticker": t,
                "alias": alias,
                "spot": round(spot, 2) if spot else None,
                "call_wall": r.get("call_wall"),
                "put_wall": r.get("put_wall"),
                "gamma_flip": r.get("gamma_flip"),
                "gamma_magnet": r.get("gamma_magnet"),
                "nearby_flips": (r.get("nearby_flips") or [])[:5],
                "max_pain": mp[0].get("max_pain") if mp else None,
                "max_pain_expiry": mp[0].get("expiry") if mp else None,
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "usage": c.usage(),
        "sections": {
            "market_tide": [
                {
                    "timestamp": r.get("timestamp"),
                    "net_call_premium": _f(r.get("net_call_premium")),
                    "net_put_premium": _f(r.get("net_put_premium")),
                    "net_volume": r.get("net_volume"),
                }
                for r in tide
            ],
            "net_impact": [
                {"ticker": r.get("ticker"), "net_premium": _f(r.get("net_premium"))} for r in net_impact
            ],
            "unusual": [
                {
                    "ticker": r.get("ticker_symbol") or r.get("underlying_symbol"),
                    "option_symbol": r.get("option_symbol"),
                    "option_type": r.get("option_type"),
                    "strike": r.get("strike"),
                    "expiry": r.get("expiry"),
                    "premium": _f(r.get("premium")),
                    "volume": r.get("volume"),
                    "sweep_volume": r.get("sweep_volume"),
                    "open_interest": r.get("open_interest"),
                    "last_fill": r.get("last_fill"),
                    "delta": r.get("delta"),
                }
                for r in unusual
            ],
            "oi_change": [
                {
                    "ticker": r.get("underlying_symbol"),
                    "option_symbol": r.get("option_symbol"),
                    "oi_change": _f(r.get("oi_change")),
                    "volume": r.get("volume"),
                }
                for r in oi_change
            ],
            "darkpool": [
                {
                    "ticker": r.get("ticker"),
                    "executed_at": r.get("executed_at"),
                    "size": r.get("size"),
                    "price": _f(r.get("price")),
                    "premium": _f(r.get("premium")),
                }
                for r in sorted(darkpool, key=lambda x: _f(x.get("premium")), reverse=True)[:12]
            ],
            "squeezes": [
                {
                    "symbol": r.get("symbol"),
                    "si_float": _f(r.get("si_float")),
                    "days_to_cover": _f(r.get("days_to_cover")),
                }
                for r in sorted(
                    [r for r in screenshot if r.get("days_to_cover")],
                    key=lambda x: _f(x.get("days_to_cover")),
                    reverse=True,
                )[:12]
            ],
            "squeeze_fresh": squeeze_fresh,
            "congress": [
                {
                    "transaction_date": r.get("transaction_date"),
                    "name": r.get("name"),
                    "ticker": r.get("ticker"),
                    "txn_type": r.get("txn_type"),
                }
                for r in congress
                if r.get("txn_type") in ("Buy", "Sell")
            ][:15],
            "insider": [
                {
                    "transaction_date": r.get("transaction_date"),
                    "ticker": r.get("ticker"),
                    "amount": _f(r.get("amount")),
                    "price": _f(r.get("price")),
                    "owner_name": r.get("owner_name"),
                }
                for r in insider[:15]
            ],
            "vol_anomaly": [
                {"ticker": r.get("ticker"), "score": _f(r.get("score"))} for r in vol_anom
            ],
            "gex": gex,
            "index_levels": index_levels,
            "screen": _screen_rows(net_impact, unusual, oi_change, darkpool),
        },
    }


if __name__ == "__main__":
    import json

    print(json.dumps(build_snapshot(), indent=2)[:2000])
