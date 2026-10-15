#!/usr/bin/env python3
"""Aggregate scored outcomes into `edge_stats` buckets.

Reads every row in `edge_store.outcomes`, joins the alert metadata from
`data/alerts.db`, and writes one row per `(scope, bucket, horizon)`:

    kind      flow | unusual | darkpool | oi
    sweep     yes | no
    premium   250k-500k | 500k-1M | 1M-5M | 5M+
    asset     stock | etf | index | other
    side      bullish | bearish
    combo     e.g. flow+sweep+1M-5M
    ticker    per-name

Independence / dedupe
---------------------
Raw outcomes are NOT independent: a single macro print fans out into hundreds of
option contracts on the SAME ticker at the SAME instant, each scored against the
identical underlying bars (identical `ret`). Counting them all inflates `n` and
the t-stat. We therefore collapse each bucket to **independent observations**,
one per `(ticker, entry minute, dir)`, taking the mean `ret`/`excess` of the
group. Every row reports both:

* `n_raw` — raw scored outcomes (what was in `outcomes`)
* `n_ind` — independent observations after dedupe

A bucket is flagged `low_n = 1` unless `n_ind >= 20 AND distinct_tickers >= 5
AND distinct_sessions >= 2`. Ranked views should ignore `low_n` buckets.

Units
-----
All aggregate figures are **fractions** (0..1), not percent: `win_rate` is the
share of independent observations with `ret > 0`, and `avg_ret` / `avg_excess`
are means divided by 100. Per-outcome fields (players `avg_pnl_pct`/`pnl_pct`,
whales `move_pct`) remain percent. See `scripts/README.md`.

COST NOTE: `avg_ret`/`avg_excess` are *gross* (no commissions/slippage). Every
point of round-trip cost eats directly into them.

CLI: python scripts/edge_stats.py
"""
from __future__ import annotations

import json
import math
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import edge_store  # noqa: E402

SCOPES = ("kind", "sweep", "premium", "asset", "side", "combo", "ticker")

# Independence gate for a "ranked" (non-low_n) bucket.
IND_MIN_N = 20
IND_MIN_TICKERS = 5
IND_MIN_SESSIONS = 2


def _f(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def premium_bucket(p) -> str | None:
    p = _f(p)
    if p is None:
        return None
    if p >= 5_000_000:
        return "5M+"
    if p >= 1_000_000:
        return "1M-5M"
    if p >= 500_000:
        return "500k-1M"
    if p >= 250_000:
        return "250k-500k"
    return None


def _meta_for(ids) -> dict:
    """Map alert_id -> {kind, ticker, asset_class, sweep, premium, event_ts}."""
    if not ids:
        return {}
    try:
        import alert_store  # noqa: PLC0415

        db = alert_store.db_path()
    except Exception:  # noqa: BLE001
        return {}
    out: dict = {}
    ids = list(ids)
    for i in range(0, len(ids), 400):
        chunk = ids[i:i + 400]
        ph = ",".join(["?"] * len(chunk))
        conn = None
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"SELECT id,kind,ticker,asset_class,sweep,premium,event_ts "
                f"FROM alerts WHERE id IN ({ph})",
                chunk,
            ).fetchall()
            for r in rows:
                out[r["id"]] = dict(r)
        except Exception:  # noqa: BLE001
            pass
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:  # noqa: BLE001
                pass
    return out


def _buckets(meta: dict, dir_: int) -> dict:
    """`scope -> bucket` for one outcome (may omit scopes with no bucket)."""
    b = {}
    kind = str(meta.get("kind") or "").strip()
    if kind:
        b["kind"] = kind
    sweep = "yes" if int(_f(meta.get("sweep")) or 0) else "no"
    b["sweep"] = sweep
    pbin = premium_bucket(meta.get("premium"))
    if pbin:
        b["premium"] = pbin
    asset = str(meta.get("asset_class") or "").strip().lower()
    if asset:
        b["asset"] = asset
    if dir_ > 0:
        b["side"] = "bullish"
    elif dir_ < 0:
        b["side"] = "bearish"
    if kind and pbin:
        b["combo"] = f"{kind}+{sweep}+{pbin}"
    ticker = str(meta.get("ticker") or "").upper().strip()
    if ticker:
        b["ticker"] = ticker
    return b


def _aggregate(scope: str, bucket: str, horizon: str, records: list, now: str) -> dict:
    """Collapse a bucket's raw outcomes into independent observations."""
    groups: dict = {}
    for r in records:
        groups.setdefault(r["key"], []).append(r)

    n_raw = len(records)
    n_ind = len(groups)
    ind_rets: list = []
    ind_excs: list = []
    tickers: set = set()
    sessions: set = set()
    for key, grp in groups.items():
        tickers.add(key[0])
        sessions.add(grp[0]["session"])
        ind_rets.append(sum(g["ret"] for g in grp) / len(grp))
        ex = [g["exc"] for g in grp if g["exc"] is not None]
        if ex:
            ind_excs.append(sum(ex) / len(ex))

    win_rate = None
    avg_ret = None
    if n_ind:
        wins = sum(1 for x in ind_rets if x > 0)
        win_rate = round(wins / n_ind, 4)
        avg_ret = round((sum(ind_rets) / n_ind) / 100.0, 6)

    avg_excess = None
    tstat = None
    if ind_excs:
        mean = sum(ind_excs) / len(ind_excs)
        avg_excess = round(mean / 100.0, 6)
        if len(ind_excs) >= 2:
            var = sum((x - mean) ** 2 for x in ind_excs) / len(ind_excs)
            if var > 0:
                sd = math.sqrt(var)
                tstat = round(mean / (sd / math.sqrt(len(ind_excs))), 3)

    ranked = (
        n_ind >= IND_MIN_N
        and len(tickers) >= IND_MIN_TICKERS
        and len(sessions) >= IND_MIN_SESSIONS
    )
    return {
        "scope": scope,
        "bucket": bucket,
        "horizon": horizon,
        "n_raw": n_raw,
        "n_ind": n_ind,
        "distinct_tickers": len(tickers),
        "distinct_sessions": len(sessions),
        "win_rate": win_rate,
        "avg_ret": avg_ret,
        "avg_excess": avg_excess,
        "tstat": tstat,
        "low_n": 0 if ranked else 1,
        "updated_at": now,
    }


def build_rows() -> list:
    """Compute all aggregate rows in memory (no DB writes)."""
    outcomes = edge_store.get_outcomes()
    if not outcomes:
        return []
    meta = _meta_for({o["alert_id"] for o in outcomes if o.get("alert_id")})

    records = []
    for o in outcomes:
        m = meta.get(str(o.get("alert_id")))
        if not m:
            continue
        try:
            dir_ = int(o.get("dir"))
        except (TypeError, ValueError):
            continue
        ret = _f(o.get("ret"))
        if ret is None:
            continue
        ts = str(o.get("entry_ts") or m.get("event_ts") or "")
        ticker = str(m.get("ticker") or "").upper().strip()
        records.append(
            {
                "buckets": _buckets(m, dir_),
                "h": str(o.get("horizon")),
                "ret": ret,
                "exc": _f(o.get("excess")),
                "key": (ticker, ts[:16], dir_),
                "session": ts[:10],
            }
        )

    acc: dict = {}
    for r in records:
        for scope, bucket in r["buckets"].items():
            acc.setdefault(scope, {}).setdefault(bucket, {}).setdefault(r["h"], []).append(r)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = []
    for scope, buckets in acc.items():
        for bucket, horizons in buckets.items():
            for h, recs in horizons.items():
                rows.append(_aggregate(scope, bucket, h, recs, now))
    return rows


def refresh() -> dict:
    """Recompute and persist `edge_stats` from the deduped view. Never raises."""
    counts = {"rows": 0, "cleared": 0}
    try:
        edge_store.init()
        rows = build_rows()
        counts["cleared"] = edge_store.clear_stats()
        counts["rows"] = edge_store.save_stats(rows)
    except Exception as exc:  # noqa: BLE001
        counts["error"] = repr(exc)[:200]
    return counts


def sample() -> dict:
    """`{alerts, resolved, from, to}` for the edge header. Never raises."""
    alerts = 0
    lo = hi = None
    try:
        import alert_store  # noqa: PLC0415

        conn = sqlite3.connect(f"file:{alert_store.db_path()}?mode=ro", uri=True, timeout=5)
        try:
            row = conn.execute("SELECT COUNT(*), MIN(event_ts), MAX(event_ts) FROM alerts").fetchone()
            alerts, lo, hi = (row[0] or 0), row[1], row[2]
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        pass
    resolved = edge_store.outcome_counts()
    return {
        "alerts": alerts,
        "resolved": resolved["alerts"],
        "outcomes": resolved["total"],
        "horizons": resolved["horizons"],
        "from": lo,
        "to": hi,
    }


def main() -> None:
    counts = refresh()
    print(json.dumps({"counts": counts, "sample": sample()}, indent=2))


if __name__ == "__main__":
    main()
