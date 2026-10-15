#!/usr/bin/env python3
"""Generate docs/REPORT.md from probe_results.json + endpoints.json."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
probe = json.loads((ROOT / "docs" / "probe_results.json").read_text())
results = probe["results"]


def gate_of(r: dict) -> str | None:
    code = r.get("error_code")
    msg = (r.get("error_message") or r.get("sample") or "").lower()
    if code == "futures_access_required":
        return "Futures add-on"
    if code == "advanced_tier_required" or "api advanced subscription" in msg:
        return "Advanced+ tier"
    if code == "politics_scope_required":
        return "Politics scope"
    if code == "volatility_scope_required":
        return "Volatility scope"
    if "enterprise only" in msg:
        return "Enterprise only"
    if "premium endpoint" in msg:
        return "Premium add-on"
    if code == "missing_access":
        return "Route not permitted"
    if "missing access" in msg:
        return "Premium add-on"
    return None


accessible = [r for r in results if r.get("status") == 200]
gated = [r for r in results if gate_of(r)]
other = [r for r in results if r not in accessible and r not in gated and r.get("status") not in (200,)]

by_cat_ok: dict[str, list] = defaultdict(list)
by_cat_gate: dict[str, list] = defaultdict(list)
for r in results:
    by_cat_ok[r["tag"]].append(r)

lines: list[str] = []
A = lines.append

A("# Unusual Whales API — Access & Capability Report")
A("")
A(f"Generated from a live probe of all {len(results)} REST endpoints on **2026-09-25** (last data date `{probe['last_date']}`).")
A("")
A("## TL;DR")
A("")
A(f"- **{len(accessible)} of {len(results)} endpoints return data on the current token** (~{round(100*len(accessible)/len(results))}%).")
A(f"- **{len(gated)} endpoints are gated** by tier/scope/add-on.")
A("- Daily quota headers on this token: **40,000 requests/day**, no practical per-minute cap (burst-limited only).")
A("- Everything core to **options flow, dark pool, GEX/greeks, IV, market tide, congress, insider, shorts, earnings, ETFs, institutional, stock screeners** is **live**.")
A("- Gated: **Futures**, **Advanced+ fundamentals/macro/FX/crypto-history**, **politics/FEC**, **private markets**, **unusual congress trades**, **politician portfolios**, **stock ownership**, and **real-time WebSocket**.")
A("")

A("## Access by category")
A("")
A("| Category | Working | Total |")
A("|----------|--------:|------:|")
for tag in sorted(by_cat_ok):
    rows = by_cat_ok[tag]
    ok = sum(1 for r in rows if r.get("status") == 200)
    A(f"| {tag} | {ok} | {len(rows)} |")
A("")

A("## Gated endpoints (what to unlock and why)")
A("")
gate_counts = Counter(gate_of(r) for r in gated)
A("| Barrier | Endpoints | Representative routes |")
A("|---------|----------:|-----------------------|")
for gate, n in gate_counts.most_common():
    reps = [r["path"] for r in gated if gate_of(r) == gate][:4]
    A(f"| {gate} | {n} | {', '.join('`'+p+'`' for p in reps)} |")
A("")

A("### Full gated list")
A("")
for gate in sorted(gate_counts):
    A(f"**{gate}**")
    A("")
    for r in gated:
        if gate_of(r) == gate:
            A(f"- `GET {r['path']}`")
    A("")

A("## Working endpoints")
A("")
for tag in sorted(by_cat_ok):
    rows = [r for r in by_cat_ok[tag] if r.get("status") == 200]
    if not rows:
        continue
    A(f"### {tag}")
    A("")
    for r in sorted(rows, key=lambda x: x["path"]):
        req = f" — required: {', '.join(r['required_query'])}" if r["required_query"] else ""
        A(f"- `GET {r['path']}`{req}")
    A("")

A("## Notes & caveats")
A("")
A("- `/api/socket/*` returns `{\"data\": []}`: those are channel-documentation routes. **Real WebSocket streaming requires the Advanced plan** per the docs, so live streaming is not usable on this token even though the routes answer 200.")
A("- Many gated routes answer `422` with a `msg` saying *Missing access* instead of `403`. Classify by message/code, not status alone.")
A("- Parameterised routes need real IDs: `flow-alerts/{id}` needs a flow-alert UUID, `multi-leg/{id}/legs` a strategy UUID, `option-contract/{id}` an OCC option symbol, `predictions/market/{asset_id}` a Polymarket-style asset id.")
A("- `option-trades/full-tape/{date}` downloads a very large file; stream it, never load it whole.")
A("- Dates default to the last trading day. `x-request-id` is unique per call; freshness should be read from payload timestamps.")
A("")

out = ROOT / "docs" / "REPORT.md"
out.write_text("\n".join(lines))
print(f"wrote {out.relative_to(ROOT)} — {len(accessible)} working / {len(gated)} gated")
