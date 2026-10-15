#!/usr/bin/env python3
"""Probe every Unusual Whales REST endpoint and record entitlements.

Reads docs/endpoints.json (from parse_spec.py), substitutes path/query params
with sensible demo values, calls each endpoint once, and records the HTTP status
plus, for 403s, the machine-readable entitlement code. Uses ~237 requests out of
the 40k/day quota.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import time
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ENDPOINTS = ROOT / "docs" / "endpoints.json"
OUT = ROOT / "docs" / "probe_results.json"

TICKER = "NVDA"
LAST_DATE = "2026-09-24"
NEXT_EXPIRY = "2026-10-17"
FROM = "2026-08-01"


def discover(client: UWClient) -> dict:
    """Best-effort resolution of real IDs so parameterised routes work."""
    d = {
        "option_symbol": "NVDA260925C00225000",
        "flow_alert_id": "",
        "multi_leg_id": "",
        "politician_id": "1",
        "asset_id": "",
        "user_id": "",
        "npm_ticker": "1",
        "crypto_token": "",
        "futures_contract": "ES",
        "security_id": "1",
    }
    probes = [
        ("option_symbol", "/api/stock/NVDA/option-contracts", {"limit": 1}, ("option_symbol",)),
        ("flow_alert_id", "/api/option-trades/flow-alerts", {"limit": 1}, ("id",)),
        ("multi_leg_id", "/api/option-trades/multi-leg", {"limit": 1}, ("id",)),
        ("asset_id", "/api/predictions/unusual", {"limit": 1}, ("asset_id",)),
        ("crypto_token", "/api/crypto/list_tokens", {"limit": 1}, ("address",)),
    ]
    for key, path, params, selector in probes:
        try:
            resp = client.get(path, timeout=20, **params)
            if resp.status_code != 200:
                continue
            data = resp.json().get("data")
            # some endpoints nest: {"data": {"data": [...]}}
            if isinstance(data, dict):
                data = data.get("data")
            if not data:
                continue
            row = data[0]
            for field in selector:
                row = row.get(field) if isinstance(row, dict) else None
            if row is not None:
                d[key] = str(row)
        except Exception:  # noqa: BLE001 - discovery is best-effort
            continue
    return d


def subst(path: str, d: dict) -> str:
    p = path
    if "/api/option-contract/" in p:
        p = p.replace("{id}", d["option_symbol"])
    elif "/api/option-trades/flow-alerts/" in p:
        p = p.replace("{id}", d["flow_alert_id"])
    elif "/api/option-trades/multi-leg/" in p:
        p = p.replace("{id}", d["multi_leg_id"])
    elif "/api/institution/" in p:
        p = p.replace("{name}", "BlackRock")
    elif "/api/private-markets/investors/" in p:
        p = p.replace("{name}", "Sequoia")
    elif "/api/private-markets/companies/" in p:
        p = p.replace("{npm_ticker}", d["npm_ticker"])
    elif "/api/politician-portfolios/" in p:
        p = p.replace("{politician_id}", d["politician_id"])
    elif "/api/commodities/" in p:
        p = p.replace("{name}", "wti")
    elif "/api/crypto/token/" in p:
        p = p.replace("{token}", d["crypto_token"])
    elif "/api/futures/display_factors/" in p:
        p = p.replace("{security_id}", d["security_id"])
    elif "/api/futures/" in p and "{contract}" in p:
        p = p.replace("{contract}", d["futures_contract"])
    elif "/api/group-flow/" in p:
        p = p.replace("{flow_group}", "bank")
    elif p.endswith("/{sector}/sector-flow") or p.endswith("/{sector}/sector-tide") or p.endswith("/{sector}/tickers"):
        p = p.replace("{sector}", "Technology")
    elif "/api/seasonality/{month}/" in p:
        p = p.replace("{month}", "9")
    elif "/api/economy/" in p:
        p = p.replace("{indicator}", "gdp")
    elif "/api/predictions/market/" in p:
        p = p.replace("{asset_id}", d["asset_id"])
    elif "/api/predictions/user/" in p:
        p = p.replace("{user_id}", d["user_id"])
    elif "/api/crypto/{pair}/" in p:
        p = p.replace("{pair}", "BTC-USD")
    elif "/api/candle" in p:
        pass

    repl = {
        "{ticker}": TICKER,
        "{date}": LAST_DATE,
        "{expiry}": NEXT_EXPIRY,
        "{interval}": "1d",
        "{candle_size}": "1m",
        "{pair}": "BTC-USD",
        "{function}": "rsi",
        "{quarter}": "2025Q4",
        "{month}": "9",
    }
    for k, v in repl.items():
        p = p.replace(k, v)
    return p


def default_query(endpoint: dict, d: dict) -> dict:
    out = {}
    for q in endpoint["required_query"]:
        if q in ("expiry", "expirations[]"):
            out[q] = NEXT_EXPIRY
        elif q == "symbol":
            out[q] = d["option_symbol"]
        elif q == "symbols" or q == "tickers":
            out[q] = "NVDA,AAPL"
        elif q == "from":
            out[q] = FROM
        elif q == "to":
            out[q] = LAST_DATE
        elif q == "market":
            out[q] = "usd"
        elif q == "range":
            out[q] = "1m"
        elif q in ("calculations",):
            out[q] = "mean"
        elif q == "stance":
            out[q] = "directional"
        elif q in ("q", "query"):
            out[q] = "NVDA"
        elif q == "delta":
            out[q] = "25"
        elif q == "direction":
            out[q] = "long_vol"
        else:
            out[q] = "1"
    return out


def probe_one(client: UWClient, endpoint: dict, d: dict) -> dict:
    path = subst(endpoint["path"], d)
    params = default_query(endpoint, d)
    rec = {
        "tag": endpoint["tags"][0] if endpoint["tags"] else "untagged",
        "path": endpoint["path"],
        "probed_path": path,
        "summary": endpoint["summary"],
        "required_query": endpoint["required_query"],
    }
    last_exc = None
    for attempt in range(4):
        try:
            resp = client.get(path, stream=True, timeout=30, **params)
            if resp.status_code == 429:
                resp.close()
                time.sleep(1.5 * (attempt + 1))
                continue
            rec["status"] = resp.status_code
            body = b""
            for chunk in resp.iter_content(2048):
                body += chunk
                if len(body) >= 2048:
                    break
            resp.close()
            rec["bytes_sampled"] = len(body)
            rec["sample"] = body[:400].decode("utf-8", "replace")
            # Classify entitlement errors
            if resp.status_code in (401, 403):
                try:
                    j = json.loads(body.decode("utf-8", "replace"))
                    rec["error_code"] = j.get("code")
                    rec["error_reason"] = j.get("reason")
                    rec["error_message"] = (j.get("message") or "")[:200]
                except Exception:  # noqa: BLE001
                    pass
            elif resp.status_code == 200:
                try:
                    j = json.loads(body.decode("utf-8", "replace"))
                    data = j.get("data")
                    if isinstance(data, list):
                        rec["rows"] = len(data) if len(body) < 2048 else ">=?"
                    elif data is not None:
                        rec["rows"] = "object"
                    else:
                        rec["rows"] = "no-data-key"
                except Exception:  # noqa: BLE001
                    rec["rows"] = "unparsed"
            return rec
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            time.sleep(1.0 * (attempt + 1))
    rec["status"] = -1
    rec["error"] = f"{type(last_exc).__name__}: {last_exc}" if last_exc else "exhausted retries (429)"
    return rec


def main() -> None:
    spec = json.loads(ENDPOINTS.read_text())
    endpoints = [e for e in spec["endpoints"] if e["method"] == "GET"]
    client = UWClient()
    print(f"probing {len(endpoints)} GET endpoints...")
    d = discover(client)
    print("resolved ids:", json.dumps(d, indent=None))

    results = []
    with cf.ThreadPoolExecutor(max_workers=3) as pool:
        futs = {pool.submit(probe_one, client, e, d): e for e in endpoints}
        for i, fut in enumerate(cf.as_completed(futs), 1):
            results.append(fut.result())
            if i % 40 == 0:
                print(f"  {i}/{len(endpoints)}")

    results.sort(key=lambda r: (r["tag"], r["path"]))
    OUT.write_text(json.dumps({"last_date": LAST_DATE, "resolved": d, "results": results}, indent=2))

    # summary
    from collections import Counter

    status = Counter(r.get("status") for r in results)
    print("\nstatus codes:", dict(sorted(status.items(), key=lambda kv: str(kv[0]))))
    codes = Counter(r.get("error_code") for r in results if r.get("error_code"))
    print("403/401 entitlement codes:", dict(codes))
    ok = sum(1 for r in results if r.get("status") == 200)
    print(f"accessible: {ok}/{len(results)}")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
