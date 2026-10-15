#!/usr/bin/env python3
"""Discover response shapes for every accessible per-ticker endpoint.

Writes docs/symbol_schema.json: for each endpoint, the field names of the first
row (or dict keys), row count, and a small sample. Used to build the symbol view.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
TICKER = "NVDA"


def call(c: UWClient, path: str, params: dict):
    for attempt in range(3):
        try:
            r = c.get(path, timeout=25, **params)
            if r.status_code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            return r
        except Exception:  # noqa: BLE001
            time.sleep(1.0)
    return None


def main() -> None:
    eps = json.loads((ROOT / "docs" / "endpoints.json").read_text())["endpoints"]
    probe = {r["path"]: r for r in json.loads((ROOT / "docs" / "probe_results.json").read_text())["results"]}
    per_ticker = [e for e in eps if "{ticker}" in e["path"] and probe.get(e["path"], {}).get("status") == 200]
    c = UWClient()

    # nearest expiry for greeks/skew
    exp = ""
    try:
        eb = c.get(f"/api/stock/{TICKER}/expiry-breakdown", timeout=20).json().get("data") or []
        if eb:
            exp = str(eb[0].get("expires") or eb[0].get("expiry") or eb[0].get("date") or "")[:10]
    except Exception:  # noqa: BLE001
        pass
    print("nearest expiry:", exp)

    def substitute(p: str) -> str:
        return (
            p.replace("{ticker}", TICKER)
            .replace("{candle_size}", "1d")
            .replace("{function}", "rsi")
            .replace("{expiry}", exp)
        )

    def query(e):
        q = {}
        for name in e["required_query"]:
            if name == "expiry":
                q[name] = exp
            elif name == "expirations[]":
                q[name] = exp
            elif name == "delta":
                q[name] = "25"
            elif name == "stance":
                q[name] = "directional"
            else:
                q[name] = "1"
        return q

    def shape(e):
        path = substitute(e["path"])
        r = call(c, path, query(e))
        rec = {"path": e["path"], "tag": e["tags"][0] if e["tags"] else "", "probed": path}
        if r is None:
            rec["status"] = -1
            return rec
        rec["status"] = r.status_code
        if r.status_code != 200:
            rec["sample"] = r.text[:150]
            return rec
        try:
            j = r.json()
        except Exception:  # noqa: BLE001
            rec["note"] = "non-json"
            return rec
        if isinstance(j, list):
            rec["kind"] = "list-root"
            rec["rows"] = len(j)
            if j and isinstance(j[0], dict):
                rec["keys"] = list(j[0].keys())[:40]
                rec["sample"] = json.dumps(j[0])[:300]
            return rec
        data = j.get("data")
        if isinstance(data, dict):
            inner = data.get("data")
            rec["kind"] = "object"
            rec["keys"] = list(data.keys())[:40]
            rec["sample"] = json.dumps(data)[:300]
            if isinstance(inner, list) and inner:
                rec["rows"] = len(inner)
        elif isinstance(data, list):
            rec["kind"] = "list"
            rec["rows"] = len(data)
            if data and isinstance(data[0], dict):
                rec["keys"] = list(data[0].keys())[:40]
                rec["sample"] = json.dumps(data[0])[:300]
            elif data:
                rec["sample"] = json.dumps(data[:5])[:200]
        else:
            rec["kind"] = "empty"
            rec["keys"] = list(j.keys())[:20]
        return rec

    out = []
    with cf.ThreadPoolExecutor(max_workers=3) as pool:
        for rec in pool.map(shape, per_ticker):
            out.append(rec)
    out.sort(key=lambda r: (r["tag"], r["path"]))
    (ROOT / "docs" / "symbol_schema.json").write_text(json.dumps(out, indent=2))
    print(f"wrote symbol_schema.json ({len(out)} endpoints, {sum(1 for r in out if r.get('status')==200)} ok)")

    # ticker universe
    for path in ("/api/stock-directory/ticker-exchanges", "/api/screener/stocks"):
        r = call(c, path, {"limit": 3})
        if r and r.status_code == 200:
            j = r.json()
            data = j.get("data")
            print(f"{path}: kind={'dict' if isinstance(data,dict) else 'list'} rows={len(data) if isinstance(data,list) else 'n/a'}")
            if isinstance(data, dict):
                print("   keys:", list(data.keys())[:10])
                for k, v in data.items():
                    if isinstance(v, list) and v:
                        print(f"   {k}[0]:", json.dumps(v[0])[:160])
            elif data:
                print("   row0:", json.dumps(data[0])[:200])
    print("usage:", c.usage())


if __name__ == "__main__":
    main()
