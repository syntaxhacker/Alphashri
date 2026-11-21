#!/usr/bin/env python3
"""Build the NIFTY volatility / skew / GEX report for a recorded session.

The report compares two snapshots (default 12:00 and the last recorded report)
and never reads past the last snapshot.  It is a report artifact only: no API,
no DB and no live quotes.

Usage:
    .venv/bin/python scripts/market/nifty_report_volatility.py
    .venv/bin/python scripts/market/nifty_report_volatility.py --date 2026-11-17 \
        --t1 12:00 --out reports/nifty_2026-11-17/04-volatility.html
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATE = "2026-11-17"
DEFAULT_T1 = "12:00"


# ---------------------------------------------------------------------------
# loading / small helpers
# ---------------------------------------------------------------------------


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open() as fh:
        return [json.loads(line) for line in fh if line.strip()]


def read_json(path: Path) -> dict[str, Any]:
    with path.open() as fh:
        return json.load(fh)


def rnd(value: float | None, nd: int = 2) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, nd)


def pct(a: float, b: float) -> float:
    if not a:
        return 0.0
    return (b / a - 1.0) * 100.0


def pick_snapshot(rows: list[dict[str, Any]], hhmm: str) -> dict[str, Any]:
    matches = [row for row in rows if row["t"][11:16] == hhmm]
    if not matches:
        raise SystemExit(f"no snapshot at {hhmm}")
    return matches[0]


def hhmm(ts: str) -> str:
    return ts[11:16]


def money(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:,.0f}"


def price(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:,.1f}"


def signed(value: float | None, nd: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value:+,.{nd}f}"


def clean_iv(value: Any) -> float | None:
    """IVs of 0/None are missing quotes; >80 is a deep-ITM artefact in 0DTE."""
    if value is None:
        return None
    try:
        iv = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(iv) or iv <= 0 or iv >= 80:
        return None
    return iv


def snapshot_view(row: dict[str, Any], window: int) -> dict[str, Any]:
    report = row["report"]
    spot = float(report["spot"])
    surface = report.get("iv_surface") or {}
    atm = surface.get("atm") or {}
    skew = surface.get("skew") or {}
    control = report.get("control") or {}
    regime = report.get("regime") or {}
    gex = report.get("gex") or {}

    points = []
    for point in surface.get("points") or []:
        strike = point.get("strike")
        if strike is None or abs(float(strike) - spot) > window:
            continue
        points.append(
            {
                "strike": float(strike),
                "ce_iv": rnd(clean_iv(point.get("ce_iv"))),
                "pe_iv": rnd(clean_iv(point.get("pe_iv"))),
                "ce_delta": rnd(point.get("ce_delta"), 4),
                "pe_delta": rnd(point.get("pe_delta"), 4),
            }
        )
    points.sort(key=lambda p: p["strike"])

    return {
        "t": row["t"],
        "time": hhmm(row["t"]),
        "spot": rnd(spot, 2),
        "expiry": report.get("expiry"),
        "pcr_oi": rnd(report.get("pcr_oi")),
        "pcr_vol": rnd(report.get("pcr_vol")),
        "max_pain": rnd(report.get("max_pain"), 1),
        "atm": {
            "strike": rnd(atm.get("strike"), 1),
            "ce_iv": rnd(atm.get("ce_iv")),
            "pe_iv": rnd(atm.get("pe_iv")),
            "avg_iv": rnd(atm.get("avg_iv")),
        },
        "skew": {
            "strike_ce25": rnd(skew.get("strike_ce25"), 1),
            "ce_25d_iv": rnd(skew.get("ce_25d_iv")),
            "strike_pe25": rnd(skew.get("strike_pe25"), 1),
            "pe_25d_iv": rnd(skew.get("pe_25d_iv")),
            "skew_25d": rnd(skew.get("skew_25d")),
        },
        "control": {
            "verdict": control.get("verdict"),
            "flow_bias": rnd(control.get("flow_bias")),
            "atm_ce_iv": rnd(control.get("atm_ce_iv")),
            "atm_pe_iv": rnd(control.get("atm_pe_iv")),
            "put_skew": rnd(control.get("put_skew")),
            "skew": rnd(control.get("skew")),
            "gex_regime": control.get("gex_regime"),
        },
        "regime": {
            "verdict": regime.get("verdict"),
            "rv": rnd(regime.get("rv")),
            "iv": rnd(regime.get("iv")),
            "rv_iv_ratio": rnd(regime.get("rv_iv_ratio"), 3),
            "straddle_open": rnd(regime.get("straddle_open")),
            "straddle_now": rnd(regime.get("straddle_now")),
            "straddle_pct": rnd(regime.get("straddle_pct")),
            "range_pts": rnd(regime.get("range_pts"), 1),
        },
        "vix": {
            "ltp": rnd((report.get("vix") or {}).get("ltp")),
            "prev_close": rnd((report.get("vix") or {}).get("prev_close")),
            "change_pct": rnd((report.get("vix") or {}).get("change_pct")),
        },
        "gex": {
            "net_total": rnd(gex.get("net_total")),
            "regime": gex.get("regime"),
            "zero_cross": rnd(gex.get("zero_cross"), 1),
            "top_positive": gex.get("top_positive") or [],
            "top_negative": gex.get("top_negative") or [],
            "levels": gex.get("levels") or {},
            "degraded": bool(gex.get("degraded")),
            "strikes": [
                {
                    "strike": rnd(g.get("strike"), 1),
                    "call_gex": rnd(g.get("call_gex")),
                    "put_gex": rnd(g.get("put_gex")),
                    "net_gex": rnd(g.get("net_gex")),
                }
                for g in (gex.get("strikes") or [])
                if abs(float(g.get("strike", 0)) - spot) <= 300
                and abs(float(g.get("net_gex") or 0)) > 0.0001
            ],
        },
        "walls": {
            "calls": [
                {
                    "strike": rnd(w.get("strike"), 1),
                    "oi": int(w.get("oi") or 0),
                    "distance": rnd(w.get("distance")),
                }
                for w in ((report.get("walls") or {}).get("calls") or [])
            ],
            "puts": [
                {
                    "strike": rnd(w.get("strike"), 1),
                    "oi": int(w.get("oi") or 0),
                    "distance": rnd(w.get("distance")),
                }
                for w in ((report.get("walls") or {}).get("puts") or [])
            ],
        },
        "points": points,
        "coverage": surface.get("coverage") or {},
        "degraded": bool(surface.get("degraded")),
    }


# ---------------------------------------------------------------------------
# payload
# ---------------------------------------------------------------------------


def build_payload(date: str, t1_label: str, window: int) -> dict[str, Any]:
    snapshots = read_jsonl(ROOT / "experiments/data/nifty_snapshots" / f"{date}.jsonl")
    tape = read_jsonl(ROOT / "experiments/data/nifty_tape" / f"{date}.jsonl")
    out_dir = ROOT / "reports" / f"nifty_{date}"
    context = read_json(out_dir / "data/context.json")
    if context.get("snapshots_rows") not in (None, len(snapshots)):
        raise SystemExit(
            f"context says {context['snapshots_rows']} snapshots, file has {len(snapshots)}"
        )

    first = snapshots[0]
    last = snapshots[-1]
    one = pick_snapshot(snapshots, t1_label)
    two = last
    v1 = snapshot_view(one, window)
    v2 = snapshot_view(two, window)

    cutoff = v2["t"]
    tape_cut = [row for row in tape if row["t"] <= cutoff]
    if not tape_cut:
        raise SystemExit("tape does not overlap the snapshot window")
    spot_tape = [float(row["spot"]) for row in tape_cut if row.get("spot")]
    high = max(spot_tape)
    low = min(spot_tape)
    high_t = next(hhmm(r["t"]) for r in tape_cut if float(r["spot"]) == high)
    low_t = next(hhmm(r["t"]) for r in tape_cut if float(r["spot"]) == low)

    # IV / RV series: the RV warm-up makes the first 30 minutes unusable, and it
    # is not a real variance-premium reading.  Start at the first post-warm-up bar.
    series = []
    for row in snapshots:
        report = row["report"]
        reg = report.get("regime") or {}
        atm = (report.get("iv_surface") or {}).get("atm") or {}
        if reg.get("warmup"):
            continue
        iv = atm.get("avg_iv")
        if iv is None:
            continue
        series.append(
            {
                "ts": row["t"],
                "time": hhmm(row["t"]),
                "spot": rnd(report.get("spot"), 2),
                "atm_iv": rnd(iv),
                "ce_iv": rnd(atm.get("ce_iv")),
                "pe_iv": rnd(atm.get("pe_iv")),
                "rv": rnd(reg.get("rv")),
                "ratio": rnd(reg.get("rv_iv_ratio"), 3),
            }
        )

    # Futures context is clipped to the last snapshot even though the 1-minute
    # file continues to 15:39.  Two clean windows: the long build into 12:00 and
    # the unwind from 12:15 (the 12:00-12:15 leg is a rollover, not a read).
    fut_path = out_dir / "data/futures_1m.json"
    futures = []
    if fut_path.exists():
        candles = [
            c for c in read_json(fut_path).get("candles", []) if c["t"] <= cutoff
        ]
        by_time = {hhmm(c["t"]): c for c in candles}

        def fut_window(label: str, start: str, end: str) -> dict[str, Any] | None:
            a = by_time.get(start)
            b = by_time.get(end)
            if not a or not b:
                return None
            volume = sum(
                c.get("v") or 0
                for c in candles
                if start < hhmm(c["t"]) <= end
            )
            dp = float(b["c"]) - float(a["c"])
            doi = int(b.get("oi") or 0) - int(a.get("oi") or 0)
            if dp > 0 and doi > 0:
                read = "long buildup"
            elif dp < 0 and doi < 0:
                read = "long unwinding"
            elif dp < 0 and doi > 0:
                read = "short buildup"
            elif dp > 0 and doi < 0:
                read = "short covering"
            else:
                read = "flat / mixed"
            return {
                "label": label,
                "from": start,
                "to": end,
                "from_close": rnd(float(a["c"]), 1),
                "to_close": rnd(float(b["c"]), 1),
                "d_price": rnd(dp, 1),
                "d_oi": doi,
                "volume": int(volume),
                "read": read,
            }

        futures = [
            w
            for w in (
                fut_window("Long buildup into 12:00", "11:45", "12:00"),
                fut_window("Long unwind after 12:15", "12:15", v2["time"]),
            )
            if w
        ]

    # Wall / max-pain rows for the lollipop.  The 14:07 levels are the rows; the
    # 12:00 dot is the same strike's distance from the 12:00 spot.
    def wall_oi(snap: dict[str, Any], strike: float, side: str) -> int | None:
        for w in snap["walls"][side]:
            if w["strike"] == strike:
                return w["oi"]
        return None

    level_rows = [
        {
            "id": "mp",
            "kind": "maxpain",
            "label": "Max pain",
            "strike": v2["max_pain"],
            "d1": rnd(v1["max_pain"] - v1["spot"], 1),
            "d2": rnd(v2["max_pain"] - v2["spot"], 1),
            "oi1": None,
            "oi2": None,
        }
    ]
    for i, w in enumerate(v2["walls"]["calls"], start=1):
        level_rows.append(
            {
                "id": f"call-{i}",
                "kind": "call",
                "label": f"Call #{i}",
                "strike": w["strike"],
                "d1": rnd(w["strike"] - v1["spot"], 1),
                "d2": rnd(w["strike"] - v2["spot"], 1),
                "oi1": wall_oi(v1, w["strike"], "calls"),
                "oi2": w["oi"],
            }
        )
    for i, w in enumerate(v2["walls"]["puts"], start=1):
        level_rows.append(
            {
                "id": f"put-{i}",
                "kind": "put",
                "label": f"Put #{i}",
                "strike": w["strike"],
                "d1": rnd(w["strike"] - v1["spot"], 1),
                "d2": rnd(w["strike"] - v2["spot"], 1),
                "oi1": wall_oi(v1, w["strike"], "puts"),
                "oi2": w["oi"],
            }
        )

    d_spot = v2["spot"] - v1["spot"]
    d_atm = v2["atm"]["avg_iv"] - v1["atm"]["avg_iv"]
    d_ce = v2["atm"]["ce_iv"] - v1["atm"]["ce_iv"]
    d_pe = v2["atm"]["pe_iv"] - v1["atm"]["pe_iv"]
    d_skew = v2["skew"]["skew_25d"] - v1["skew"]["skew_25d"]
    d_put_skew = v2["control"]["put_skew"] - v1["control"]["put_skew"]
    d_gex = v2["gex"]["net_total"] - v1["gex"]["net_total"]
    d_rv = v2["regime"]["rv"] - v1["regime"]["rv"]
    d_ratio = v2["regime"]["rv_iv_ratio"] - v1["regime"]["rv_iv_ratio"]
    d_vix = v2["vix"]["ltp"] - v1["vix"]["ltp"]
    cw1 = next((w for w in v1["walls"]["calls"] if w["strike"] == v2["walls"]["calls"][0]["strike"]), None)
    cw2 = v2["walls"]["calls"][0]
    pw1 = v1["walls"]["puts"][0]
    pw2 = v2["walls"]["puts"][0]

    regimes = sorted({(row["report"].get("gex") or {}).get("regime") for row in snapshots})
    label_note = (
        f"gex.regime read {regimes[0]!r} in all {len(snapshots)} snapshots while "
        "net GEX changed sign; the measured net sign is used instead of the label."
        if len(regimes) == 1
        else "gex.regime changed during the session; both the label and net GEX are shown."
    )

    bullets = [
        {
            "lead": "Spot slipped from the 12:00 level.",
            "body": (
                f"{price(v1['spot'])} → {price(v2['spot'])} "
                f"({signed(d_spot)} pts, {pct(v1['spot'], v2['spot']):+.2f}%). "
                f"Intraday high {price(high)} at {high_t}, low {price(low)} at {low_t}. "
                f"The ATM strike rolled {money(v1['atm']['strike'])} → {money(v2['atm']['strike'])} "
                f"as spot moved to {price(v2['spot'])} — the nearest-strike ATM shifted "
                "from 25,500 to 25,450."
            ),
        },
        {
            "lead": "ATM vol was bid, and the call wing led.",
            "body": (
                f"ATM average IV {v1['atm']['avg_iv']:.2f} → {v2['atm']['avg_iv']:.2f} "
                f"({d_atm:+.2f} vol pts); CE {v1['atm']['ce_iv']:.2f} → {v2['atm']['ce_iv']:.2f} "
                f"({d_ce:+.2f}), PE {v1['atm']['pe_iv']:.2f} → {v2['atm']['pe_iv']:.2f} "
                f"({d_pe:+.2f}). 25Δ skew {v1['skew']['skew_25d']:+.2f} → "
                f"{v2['skew']['skew_25d']:+.2f} ({d_skew:+.2f}); the control panel's P−C skew "
                f"went {v1['control']['put_skew']:+.2f} → {v2['control']['put_skew']:+.2f} "
                f"({d_put_skew:+.2f}) — calls are richer by "
                f"{abs(v2['control']['put_skew']):.2f} vol pts."
            ),
        },
        {
            "lead": "The variance premium widened.",
            "body": (
                f"Realised vol {v1['regime']['rv']:.2f} → {v2['regime']['rv']:.2f} "
                f"({d_rv:+.2f}) while IV rose, so IV/RV went "
                f"{v1['regime']['rv_iv_ratio']:.3f} → {v2['regime']['rv_iv_ratio']:.3f} "
                f"({d_ratio:+.3f}). India VIX was flat at {v1['vix']['ltp']:.2f} → "
                f"{v2['vix']['ltp']:.2f} ({d_vix:+.2f}, {pct(v1['vix']['ltp'], v2['vix']['ltp']):+.2f}%), "
                "so this is a NIFTY 0DTE re-price, not a broad index-vol bid."
            ),
        },
        {
            "lead": "Net GEX flipped from negative to positive.",
            "body": (
                f"Net GEX {v1['gex']['net_total']:+.1f} → {v2['gex']['net_total']:+.1f} "
                f"({d_gex:+.1f} provider units); the reported zero cross moved from "
                f"{'none' if v1['gex']['zero_cross'] is None else money(v1['gex']['zero_cross'])} "
                f"to {money(v2['gex']['zero_cross'])}. Largest positive node "
                f"{money(v2['gex']['top_positive'][0]['strike'])} "
                f"({v2['gex']['top_positive'][0]['net_gex']:+.1f}), largest negative "
                f"{money(v2['gex']['top_negative'][0]['strike'])} "
                f"({v2['gex']['top_negative'][0]['net_gex']:+.1f})."
            ),
        },
        {
            "lead": "Walls migrated toward spot; max pain did not move.",
            "body": (
                f"Max pain held at {money(v1['max_pain'])} → {money(v2['max_pain'])}. "
                f"The 25,500 call wall's OI grew from {money(cw1['oi'] if cw1 else None)} to "
                f"{money(cw2['oi'])} and its distance went {signed(cw1['distance'] if cw1 else None)} "
                f"→ {signed(cw2['distance'])} pts. The top put wall moved "
                f"{money(pw1['strike'])} → {money(pw2['strike'])}. "
                f"Note that the #2 call-OI strike at {money(v2['walls']['calls'][1]['strike'])} "
                f"sits {signed(v2['walls']['calls'][1]['distance'])} pts below spot — an OI "
                "concentration, not resistance."
            ),
        },
    ]
    if futures:
        f1 = futures[0]
        f2 = futures[1] if len(futures) > 1 else None
        body = (
            f"11:45→12:00 futures {f1['d_price']:+.1f} pts with OI {f1['d_oi']:+,} and "
            f"{f1['volume']:,} lots traded ({f1['read']}). "
        )
        if f2:
            body += (
                f"12:15→{f2['to']} futures {f2['d_price']:+.1f} pts with OI "
                f"{f2['d_oi']:+,} and {f2['volume']:,} lots ({f2['read']}). "
            )
        body += (
            "Call IV was higher at the end of the unwind than at its start, so the option bid "
            "is not explained by the long buildup alone. Read the two as same-session, "
            "correlated flows — not causation."
        )
        bullets.append({"lead": "Futures context — correlation, not causation.", "body": body})

    caveats = [
        (
            "0DTE expiry. The chain expires on 2026-11-17, so these IVs are near-expiry "
            "and strike-sensitive. The ATM strike changed between snapshots; read the whole "
            "smile, not only the ATM label."
        ),
        (
            f"Snapshot, not live. The last report is {v2['t']}. The futures file contains "
            f"candles to 15:39, but every number here is clipped at {v2['time']} IST."
        ),
        f"GEX label. {label_note}",
        (
            f"IV coverage. At {v2['time']} only {v2['coverage'].get('with_ce_iv', 0)} CE and "
            f"{v2['coverage'].get('with_pe_iv', 0)} PE rows out of "
            f"{v2['coverage'].get('rows', 0)} carried an IV ({v1['coverage'].get('with_ce_iv', 0)}/"
            f"{v1['coverage'].get('with_pe_iv', 0)} at {v1['time']}). Missing wing quotes are "
            "left as gaps; nothing is interpolated."
        ),
        (
            "GEX units. The payload does not name the unit for net GEX. Values are shown in "
            "provider units and used for sign and relative size only."
        ),
        (
            "Straddle. straddle_open resets when the ATM strike rolls (101.15 → 94.0 during "
            "the session). The -1.06% at 14:07 is against the post-roll 94.0 reference, not "
            "the 09:15 open."
        ),
        (
            "Correlation only. Option flow, futures OI and price are same-session observations. "
            "No causal claim is made about which drove which."
        ),
    ]

    payload = {
        "meta": {
            "date": date,
            "underlying": "NIFTY",
            "expiry": v2["expiry"],
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "snapshots": len(snapshots),
            "snapshot_first": first["t"],
            "snapshot_last": last["t"],
            "comparison": {"t1": v1["t"], "t2": v2["t"]},
            "window_pts": window,
            "tape_rows": len(tape_cut),
            "futures_clipped_at": v2["t"],
            "context_tape_last": context.get("tape_last"),
            "context_chain10s_last": context.get("chain10s_last"),
            "source_files": [
                f"experiments/data/nifty_snapshots/{date}.jsonl",
                f"experiments/data/nifty_tape/{date}.jsonl",
                f"reports/nifty_{date}/data/futures_1m.json",
                f"reports/nifty_{date}/data/context.json",
            ],
            "note": "Frozen snapshot comparison; no live data after the last snapshot.",
        },
        "kpis": {
            "spot": {"t1": v1["spot"], "t2": v2["spot"], "change": rnd(d_spot, 1), "pct": rnd(pct(v1["spot"], v2["spot"]), 3)},
            "atm_iv": {"t1": v1["atm"]["avg_iv"], "t2": v2["atm"]["avg_iv"], "change": rnd(d_atm, 2)},
            "skew_25d": {"t1": v1["skew"]["skew_25d"], "t2": v2["skew"]["skew_25d"], "change": rnd(d_skew, 2)},
            "net_gex": {"t1": v1["gex"]["net_total"], "t2": v2["gex"]["net_total"], "change": rnd(d_gex, 1)},
            "max_pain": {"t1": v1["max_pain"], "t2": v2["max_pain"]},
            "pcr_oi": {"t1": v1["pcr_oi"], "t2": v2["pcr_oi"], "change": rnd(v2["pcr_oi"] - v1["pcr_oi"], 2)},
        },
        "smile": {
            "window": window,
            "t1": {
                "label": v1["time"],
                "spot": v1["spot"],
                "atm_strike": v1["atm"]["strike"],
                "points": v1["points"],
            },
            "t2": {
                "label": v2["time"],
                "spot": v2["spot"],
                "atm_strike": v2["atm"]["strike"],
                "points": v2["points"],
            },
        },
        "gex": {
            "t1": v1["gex"] | {"label": v1["time"], "spot": v1["spot"], "walls": v1["walls"]},
            "t2": v2["gex"] | {"label": v2["time"], "spot": v2["spot"], "walls": v2["walls"]},
            "label_note": label_note,
        },
        "levels": {
            "t1": {"spot": v1["spot"], "max_pain": v1["max_pain"], "calls": v1["walls"]["calls"], "puts": v1["walls"]["puts"]},
            "t2": {"spot": v2["spot"], "max_pain": v2["max_pain"], "calls": v2["walls"]["calls"], "puts": v2["walls"]["puts"]},
            "rows": level_rows,
        },
        "vol_context": {
            "series": series,
            "series_start": series[0]["time"] if series else None,
            "straddle": {
                "open": v2["regime"]["straddle_open"],
                "t1": v1["regime"]["straddle_now"],
                "t2": v2["regime"]["straddle_now"],
                "change_pct": v2["regime"]["straddle_pct"],
                "atm_strike_t1": v1["atm"]["strike"],
                "atm_strike_t2": v2["atm"]["strike"],
            },
            "vix": {"t1": v1["vix"]["ltp"], "t2": v2["vix"]["ltp"]},
            "rv_iv_ratio": {"t1": v1["regime"]["rv_iv_ratio"], "t2": v2["regime"]["rv_iv_ratio"]},
        },
        "futures": futures,
        "summary": {"bullets": bullets, "caveats": caveats},
        "session": {"high": high, "high_t": high_t, "low": low, "low_t": low_t},
    }
    return payload


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NIFTY volatility / skew / GEX — __DATE_ISO__</title>
<style>
  :root{
    --bg:#000000; --surface:#13161C; --raised:#1F242D; --border:#2C313B;
    --text:#E8E8E8; --muted:#9B9B9B; --amber:#D9902A;
    --ce:#4F8BFF; --pe:#FF8A3D; --pos:#2FA36B; --neg:#E5606A;
    --info:#4A8FD8; --warn:#C9912F;
    --mono:ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  *{box-sizing:border-box}
  html,body{background:var(--bg)}
  body{
    margin:0; color:var(--text); font:13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:1600px;margin:0 auto;padding:24px clamp(12px,2.5vw,32px) 56px}
  header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
  h1{font-size:clamp(22px,2.4vw,30px);line-height:1.15;margin:0 0 6px;letter-spacing:-.02em}
  h1 .thin{color:var(--muted);font-weight:400}
  .sub{color:var(--muted);font-size:12px;max-width:900px}
  .sub b{color:var(--text);font-weight:600}
  .frozen{
    display:inline-flex;align-items:center;gap:8px;border:1px solid var(--amber);
    color:var(--amber);border-radius:999px;padding:6px 11px;font:600 10px/1 var(--mono);
    letter-spacing:.08em;text-transform:uppercase;white-space:nowrap
  }
  .dot{width:6px;height:6px;border-radius:50%;background:var(--amber);display:inline-block}
  .kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin:0 0 22px}
  .kpi{background:var(--surface);padding:11px 13px;min-width:0}
  .kpi .label{color:var(--muted);font:600 9px/1.2 var(--mono);letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kpi .value{font:600 19px/1.25 var(--mono);margin-top:5px;white-space:nowrap}
  .kpi .delta{font:11px/1.3 var(--mono);margin-top:2px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .up{color:var(--pos)} .down{color:var(--neg)} .flat{color:var(--muted)}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;min-width:0}
  .panel-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:2px}
  .panel h2{font-size:14px;line-height:1.3;margin:0;letter-spacing:-.01em}
  .panel h2 .n{color:var(--amber);font:600 11px/1 var(--mono);margin-right:7px}
  .panel .hint{color:var(--muted);font-size:11px;line-height:1.5}
  .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
  .chart{width:100%;min-width:0}
  .chart-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:10px 0 0;color:var(--muted);font:600 10px/1.3 var(--mono);letter-spacing:.05em;text-transform:uppercase}
  .chart-head .tot{color:var(--text);letter-spacing:0;text-transform:none}
  svg{display:block;width:100%;height:auto;overflow:visible}
  .axis text{fill:var(--muted);font:10px var(--mono)}
  .axis path,.axis line{stroke:var(--border)}
  .grid line{stroke:#15181C;shape-rendering:crispEdges}
  .grid path{display:none}
  .legend{display:flex;flex-wrap:wrap;gap:12px;color:var(--muted);font:10px var(--mono);margin:8px 0 0}
  .legend span{display:inline-flex;align-items:center;gap:5px}
  .sw{width:14px;height:3px;border-radius:2px;display:inline-block}
  .sw.dash{height:0;border-top:2px dashed currentColor;background:none}
  .caption{color:var(--muted);font-size:11px;line-height:1.55;margin-top:8px}
  .caption b{color:var(--text);font-weight:600}
  .stat-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-top:12px}
  .stat{background:var(--raised);padding:10px 12px;min-width:0}
  .stat .label{color:var(--muted);font:600 9px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase}
  .stat .value{font:600 15px/1.4 var(--mono);margin-top:3px}
  .stat .note{color:var(--muted);font-size:10px;line-height:1.4;margin-top:2px}
  .summary ul{margin:6px 0 0;padding-left:18px}
  .summary li{margin:0 0 11px;line-height:1.6}
  .summary li strong{color:var(--text);font-weight:600}
  .summary li:last-child{margin-bottom:0}
  .caveats{margin:0;padding-left:18px;color:var(--muted);font-size:11.5px;line-height:1.6}
  .caveats li{margin:0 0 7px}
  .caveats b{color:var(--text);font-weight:600}
  footer{color:var(--muted);font-size:10.5px;line-height:1.6;border-top:1px solid var(--border);padding-top:14px;margin-top:6px}
  footer code{color:var(--text);font-family:var(--mono);font-size:10px}
  #tip{
    position:fixed;left:0;top:0;pointer-events:none;z-index:50;opacity:0;
    background:var(--raised);border:1px solid var(--border);color:var(--text);
    padding:8px 10px;border-radius:6px;font:11px/1.5 var(--mono);
    box-shadow:0 8px 24px rgba(0,0,0,.55);transition:opacity .08s;max-width:280px
  }
  #tip b{font-weight:600}
  #tip .muted{color:var(--muted)}
  .noscript{border:1px solid var(--amber);color:var(--amber);padding:12px;border-radius:6px;margin:12px 0}
  @media (max-width:1100px){
    .kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
    .grid2{grid-template-columns:1fr}
  }
  @media (max-width:560px){
    body{font-size:12px}
    .wrap{padding:16px 10px 40px}
    .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
    .kpi .value{font-size:17px}
    .panel{padding:12px;border-radius:8px;margin-bottom:12px}
    .stat-row{grid-template-columns:1fr}
    h1{font-size:22px}
    .frozen{font-size:9px;padding:5px 9px}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>NIFTY <span class="thin">volatility / skew / GEX</span></h1>
      <div class="sub">
        <b>__DATE_LABEL__</b> · 0DTE expiry · two frozen chain snapshots:
        <b>12:00</b> and <b>14:07 IST</b>. Spot path from the recorded tape; futures context
        clipped at the last snapshot.
      </div>
    </div>
    <div class="frozen"><span class="dot"></span>Frozen 14:07 IST · not live</div>
  </header>

  <div class="kpis" id="kpis" aria-label="Key metrics"></div>

  <section class="panel">
    <div class="panel-head">
      <h2><span class="n">01</span>IV smile / skew around spot</h2>
      <div class="hint">CE and PE implied vol by strike · ±200 pts window · amber band = ATM strike</div>
    </div>
    <div class="grid2" id="smile-grid"></div>
    <div class="legend">
      <span style="color:var(--ce)"><i class="sw" style="background:var(--ce)"></i>CE IV</span>
      <span style="color:var(--pe)"><i class="sw" style="background:var(--pe)"></i>PE IV</span>
      <span style="color:var(--amber)"><i class="sw dash"></i>ATM strike</span>
      <span style="color:var(--info)"><i class="sw dash"></i>spot</span>
    </div>
    <div class="caption" id="smile-caption"></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2><span class="n">02</span>Dealer gamma profile (net GEX)</h2>
      <div class="hint">Horizontal bars by strike · positive = dealer long gamma · negative = short gamma · spot, flip and walls marked</div>
    </div>
    <div class="grid2" id="gex-grid"></div>
    <div class="legend">
      <span style="color:var(--pos)"><i class="sw" style="background:var(--pos)"></i>net long gamma</span>
      <span style="color:var(--neg)"><i class="sw" style="background:var(--neg)"></i>net short gamma</span>
      <span style="color:var(--amber)"><i class="sw dash"></i>zero cross / flip</span>
      <span style="color:var(--info)"><i class="sw dash"></i>spot</span>
      <span style="color:var(--neg)"><i class="sw" style="background:var(--neg);opacity:.5"></i>call wall</span>
      <span style="color:var(--pos)"><i class="sw" style="background:var(--pos);opacity:.5"></i>put wall</span>
    </div>
    <div class="caption" id="gex-caption"></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2><span class="n">03</span>Wall and max-pain distance from spot</h2>
      <div class="hint">Rows are the 14:07 reported levels · filled dot = 14:07 · hollow dot = same strike at 12:00 · zero = spot</div>
    </div>
    <div class="chart" id="levels-chart"></div>
    <div class="caption" id="levels-caption"></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2><span class="n">04</span>IV versus realised vol, and the straddle</h2>
      <div class="hint">ATM average IV against same-window realised vol · shaded area = variance premium · separate stat cards for the straddle and VIX</div>
    </div>
    <div class="chart" id="vol-chart"></div>
    <div class="stat-row" id="vol-stats"></div>
    <div class="caption" id="vol-caption"></div>
  </section>

  <section class="panel summary">
    <div class="panel-head"><h2><span class="n">05</span>What changed, 12:00 → 14:07</h2></div>
    <ul id="summary-list"></ul>
  </section>

  <section class="panel">
    <div class="panel-head"><h2><span class="n">06</span>Data caveats</h2></div>
    <ul class="caveats" id="caveat-list"></ul>
  </section>

  <footer id="footer"></footer>
</div>
<div id="tip" role="tooltip"></div>
<noscript><div class="wrap"><div class="noscript">This report needs JavaScript for the D3 charts. The underlying numbers are in <code>data/volatility.json</code>.</div></div></noscript>

<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script>
const DATA = __VOL_DATA__;

(function () {
  "use strict";

  const C = {
    bg: "#000000", surface: "#13161C", raised: "#1F242D", border: "#2C313B",
    text: "#E8E8E8", muted: "#9B9B9B", amber: "#D9902A",
    ce: "#4F8BFF", pe: "#FF8A3D", pos: "#2FA36B", neg: "#E5606A",
    info: "#4A8FD8", warn: "#C9912F"
  };
  const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
  const fmtInt = d3.format(",");
  const fmtSpot = d3.format(",.1f");
  const fmt1 = d3.format(",.1f");
  const fmt2 = d3.format(",.2f");
  const fmtPct = d3.format("+.2f");
  const tip = document.getElementById("tip");

  function placeTip(event) {
    const pad = 14;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    const box = tip.getBoundingClientRect();
    if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - pad;
    if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - pad;
    tip.style.left = Math.max(4, x) + "px";
    tip.style.top = Math.max(4, y) + "px";
  }
  function showTip(event, html) {
    tip.innerHTML = html;
    tip.style.opacity = "1";
    placeTip(event);
  }
  function hideTip() { tip.style.opacity = "0"; }

  function responsive(el, draw) {
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = Math.max(300, el.clientWidth || 300);
        el.innerHTML = "";
        draw(width);
      });
    };
    if (window.ResizeObserver) new ResizeObserver(run).observe(el);
    run();
  }

  function axisStyle(g) {
    g.selectAll(".domain").attr("stroke", C.border);
    g.selectAll(".tick line").attr("stroke", C.border);
    g.selectAll(".tick text").attr("fill", C.muted).style("font", "10px " + mono);
  }

  // ---------------------------------------------------------------- header KPIs
  function renderKpis() {
    const k = DATA.kpis;
    const cells = [
      {
        label: "Spot", value: fmtSpot(k.spot.t2),
        delta: `${fmt1(k.spot.change)} pts (${fmtPct(k.spot.pct)}%)`,
        cls: k.spot.change >= 0 ? "up" : "down"
      },
      {
        label: "ATM avg IV", value: fmt2(k.atm_iv.t2) + "%",
        delta: `${fmtPct(k.atm_iv.change)} vol pts`,
        cls: k.atm_iv.change >= 0 ? "up" : "down"
      },
      {
        label: "25Δ skew (CE−PE)", value: fmtPct(k.skew_25d.t2),
        delta: `${fmtPct(k.skew_25d.change)} vs 12:00`,
        cls: k.skew_25d.t2 >= 0 ? "up" : "down"
      },
      {
        label: "Net GEX", value: fmt1(k.net_gex.t2),
        delta: `${fmt1(k.net_gex.change)} vs 12:00`,
        cls: k.net_gex.t2 >= 0 ? "up" : "down"
      },
      {
        label: "Max pain", value: fmtInt(k.max_pain.t2),
        delta: k.max_pain.t1 === k.max_pain.t2 ? "unchanged" : `${fmtInt(k.max_pain.t2 - k.max_pain.t1)} pts`,
        cls: "flat"
      },
      {
        label: "PCR (OI)", value: fmt2(k.pcr_oi.t2),
        delta: `${fmt2(k.pcr_oi.change)} vs 12:00`,
        cls: k.pcr_oi.change >= 0 ? "up" : "down"
      }
    ];
    const root = d3.select("#kpis");
    root.selectAll("*").remove();
    cells.forEach(c => {
      const el = root.append("div").attr("class", "kpi");
      el.append("div").attr("class", "label").text(c.label);
      el.append("div").attr("class", "value").text(c.value);
      el.append("div").attr("class", "delta " + c.cls).text(c.delta);
    });
  }

  // ---------------------------------------------------------------- 01 smile
  function drawSmile(host, key) {
    const snap = DATA.smile[key];
    const all = DATA.smile.t1.points.concat(DATA.smile.t2.points);
    const strikes = all.map(p => p.strike);
    const ivs = all.flatMap(p => [p.ce_iv, p.pe_iv]).filter(v => v != null);
    const xMin = d3.min(strikes) - 25;
    const xMax = d3.max(strikes) + 25;
    const yMin = Math.max(0, Math.floor(d3.min(ivs) / 5) * 5);
    const yMax = Math.ceil(d3.max(ivs) / 5) * 5;

    responsive(host, W => {
      const H = W < 520 ? 250 : 300;
      const m = { top: 26, right: 16, bottom: 38, left: 42 };
      const innerW = W - m.left - m.right;
      const innerH = H - m.top - m.bottom;
      const x = d3.scaleLinear().domain([xMin, xMax]).range([m.left, m.left + innerW]);
      const y = d3.scaleLinear().domain([yMin, yMax]).range([m.top + innerH, m.top]);

      const svg = d3.select(host).append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("role", "img")
        .attr("aria-label", `IV smile at ${snap.label}, spot ${snap.spot}`);
      const g = svg.append("g");

      const yTicks = d3.range(yMin, yMax + 1, 5);
      g.append("g").attr("class", "grid")
        .selectAll("line").data(yTicks).join("line")
        .attr("x1", m.left).attr("x2", m.left + innerW)
        .attr("y1", d => y(d)).attr("y2", d => y(d));

      const xTicks = d3.range(Math.ceil(xMin / 50) * 50, xMax + 1, 50);
      g.append("g").attr("class", "axis")
        .attr("transform", `translate(0,${m.top + innerH})`)
        .call(d3.axisBottom(x).tickValues(xTicks).tickFormat(d3.format("d")).tickSizeOuter(0))
        .call(axisStyle);
      g.append("g").attr("class", "axis")
        .attr("transform", `translate(${m.left},0)`)
        .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(d => d + "%").tickSizeOuter(0))
        .call(axisStyle);

      g.append("text").attr("x", m.left).attr("y", 13).attr("fill", C.muted)
        .style("font", "10px " + mono).text("IV");
      g.append("text").attr("x", m.left + innerW).attr("y", H - 5)
        .attr("text-anchor", "end").attr("fill", C.muted)
        .style("font", "10px " + mono).text("strike");

      const ceLine = d3.line().defined(d => d.ce_iv != null)
        .x(d => x(d.strike)).y(d => y(d.ce_iv));
      const peLine = d3.line().defined(d => d.pe_iv != null)
        .x(d => x(d.strike)).y(d => y(d.pe_iv));

      g.append("path").datum(snap.points).attr("fill", "none")
        .attr("stroke", C.ce).attr("stroke-width", 2).attr("d", ceLine);
      g.append("path").datum(snap.points).attr("fill", "none")
        .attr("stroke", C.pe).attr("stroke-width", 2).attr("d", peLine);

      g.selectAll(".ce-dot").data(snap.points.filter(d => d.ce_iv != null)).join("circle")
        .attr("cx", d => x(d.strike)).attr("cy", d => y(d.ce_iv)).attr("r", 2.6)
        .attr("fill", C.ce).attr("stroke", C.bg).attr("stroke-width", 1);
      g.selectAll(".pe-dot").data(snap.points.filter(d => d.pe_iv != null)).join("circle")
        .attr("cx", d => x(d.strike)).attr("cy", d => y(d.pe_iv)).attr("r", 2.6)
        .attr("fill", C.pe).attr("stroke", C.bg).attr("stroke-width", 1);

      // ATM band + labels.  Spot and ATM can be only a few points apart, so the
      // two labels sit at opposite ends of the plot.
      const atm = snap.atm_strike;
      g.append("rect").attr("x", x(atm) - 4).attr("width", 8)
        .attr("y", m.top).attr("height", innerH)
        .attr("fill", C.amber).attr("opacity", .08);
      g.append("line").attr("x1", x(atm)).attr("x2", x(atm))
        .attr("y1", m.top).attr("y2", m.top + innerH)
        .attr("stroke", C.amber).attr("stroke-width", 1.2).attr("stroke-dasharray", "4 3");
      g.append("text").attr("x", x(atm)).attr("y", 14).attr("text-anchor", "middle")
        .attr("fill", C.amber).style("font", "600 9px " + mono)
        .text("ATM " + fmtInt(atm));
      g.append("line").attr("x1", x(snap.spot)).attr("x2", x(snap.spot))
        .attr("y1", m.top).attr("y2", m.top + innerH)
        .attr("stroke", C.info).attr("stroke-width", 1.2).attr("stroke-dasharray", "2 3");
      g.append("text").attr("x", x(snap.spot)).attr("y", H - 6).attr("text-anchor", "middle")
        .attr("fill", C.info).style("font", "9px " + mono)
        .text("spot " + fmtSpot(snap.spot));

      const focus = g.append("g").style("display", "none");
      const focusLine = focus.append("line")
        .attr("y1", m.top).attr("y2", m.top + innerH)
        .attr("stroke", C.text).attr("stroke-width", 1).attr("stroke-dasharray", "2 3").attr("opacity", .55);
      const focusCe = focus.append("circle").attr("r", 4).attr("fill", C.ce).attr("stroke", C.bg);
      const focusPe = focus.append("circle").attr("r", 4).attr("fill", C.pe).attr("stroke", C.bg);

      const bis = d3.bisector(d => d.strike).center;
      svg.append("rect")
        .attr("x", m.left).attr("y", m.top)
        .attr("width", innerW).attr("height", innerH)
        .attr("fill", "transparent")
        .on("mousemove", function (event) {
          const px = d3.pointer(event, svg.node())[0];
          const strike = x.invert(px);
          const i = bis(snap.points, strike);
          const p = snap.points[i];
          if (!p) return;
          focus.style("display", null);
          focusLine.attr("x1", x(p.strike)).attr("x2", x(p.strike));
          focusCe.attr("cx", x(p.strike)).attr("cy", p.ce_iv == null ? -20 : y(p.ce_iv))
            .style("display", p.ce_iv == null ? "none" : null);
          focusPe.attr("cx", x(p.strike)).attr("cy", p.pe_iv == null ? -20 : y(p.pe_iv))
            .style("display", p.pe_iv == null ? "none" : null);
          const ce = p.ce_iv == null ? "—" : fmt2(p.ce_iv) + "%";
          const pe = p.pe_iv == null ? "—" : fmt2(p.pe_iv) + "%";
          showTip(event,
            `<b>${fmtInt(p.strike)}</b> <span class="muted">(${fmt1(p.strike - snap.spot)} pts)</span><br>` +
            `CE IV ${ce} · Δ ${p.ce_delta == null ? "—" : p.ce_delta.toFixed(2)}<br>` +
            `PE IV ${pe} · Δ ${p.pe_delta == null ? "—" : p.pe_delta.toFixed(2)}`);
        })
        .on("mouseleave", () => { focus.style("display", "none"); hideTip(); });
    });
  }

  function renderSmile() {
    const grid = d3.select("#smile-grid");
    grid.selectAll("*").remove();
    [["t1", DATA.smile.t1.label], ["t2", DATA.smile.t2.label + " (last)"]].forEach(([key, label]) => {
      const card = grid.append("div");
      const head = card.append("div").attr("class", "chart-head");
      head.append("span").text(label);
      const s = DATA.smile[key];
      head.append("span").attr("class", "tot")
        .text(`spot ${fmtSpot(s.spot)} · ATM ${fmtInt(s.atm_strike)}`);
      const host = card.append("div").attr("class", "chart").node();
      drawSmile(host, key);
    });
    const s1 = DATA.smile.t1, s2 = DATA.smile.t2;
    const p = DATA.smile.window;
    d3.select("#smile-caption").html(
      `Window is <b>±${p} pts</b> around each spot; points outside it are omitted, and missing wing quotes are gaps. ` +
      `At <b>${s1.label}</b> the ATM strike was <b>${fmtInt(s1.atm_strike)}</b> with spot ${fmtSpot(s1.spot)}; ` +
      `at <b>${s2.label}</b> it was <b>${fmtInt(s2.atm_strike)}</b> with spot ${fmtSpot(s2.spot)}. ` +
      `The ATM label moved, so compare the shape of both curves rather than one point.`
    );
  }

  // ---------------------------------------------------------------- 02 GEX
  function drawGex(host, key) {
    const snap = DATA.gex[key];
    const other = key === "t1" ? DATA.gex.t2 : DATA.gex.t1;
    const maxAbs = Math.max(
      1,
      d3.max(snap.strikes.concat(other.strikes), d => Math.abs(d.net_gex || 0))
    );
    const strikeVals = snap.strikes.map(d => d.strike);
    const yMin = d3.min(strikeVals) - 25;
    const yMax = d3.max(strikeVals) + 25;

    responsive(host, W => {
      const H = W < 520 ? 300 : 320;
      const m = { top: 18, right: W < 520 ? 10 : 54, bottom: 38, left: 46 };
      const innerW = W - m.left - m.right;
      const innerH = H - m.top - m.bottom;
      const x = d3.scaleLinear().domain([-maxAbs * 1.08, maxAbs * 1.08])
        .range([m.left, m.left + innerW]);
      const y = d3.scaleLinear().domain([yMin, yMax]).range([m.top + innerH, m.top]);
      const rowH = innerH / snap.strikes.length;
      const barH = Math.max(6, Math.min(16, rowH * 0.64));

      const svg = d3.select(host).append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("role", "img")
        .attr("aria-label", `Net GEX by strike at ${snap.label}`);
      const g = svg.append("g");

      const xTicks = x.ticks(5);
      g.append("g").attr("class", "grid")
        .selectAll("line").data(xTicks).join("line")
        .attr("y1", m.top).attr("y2", m.top + innerH)
        .attr("x1", d => x(d)).attr("x2", d => x(d));

      g.append("line").attr("x1", x(0)).attr("x2", x(0))
        .attr("y1", m.top).attr("y2", m.top + innerH)
        .attr("stroke", C.border).attr("stroke-width", 1.2);

      const bars = g.selectAll(".bar").data(snap.strikes).join("g");
      bars.append("rect")
        .attr("x", d => Math.min(x(0), x(d.net_gex)))
        .attr("y", d => y(d.strike) - barH / 2)
        .attr("width", d => Math.max(1, Math.abs(x(d.net_gex) - x(0))))
        .attr("height", barH).attr("rx", 2)
        .attr("fill", d => d.net_gex >= 0 ? C.pos : C.neg)
        .attr("opacity", .82)
        .style("cursor", "crosshair")
        .on("mousemove", (event, d) => {
          showTip(event,
            `<b>${fmtInt(d.strike)}</b> <span class="muted">(${fmt1(d.strike - snap.spot)} pts)</span><br>` +
            `net GEX <b>${fmt1(d.net_gex)}</b><br>` +
            `call ${fmt1(d.call_gex)} · put ${fmt1(d.put_gex)}`);
        })
        .on("mouseleave", hideTip);

      g.append("g").attr("class", "axis")
        .attr("transform", `translate(0,${m.top + innerH})`)
        .call(d3.axisBottom(x).tickValues(xTicks).tickFormat(d3.format(",.0f")).tickSizeOuter(0))
        .call(axisStyle);
      g.append("g").attr("class", "axis")
        .attr("transform", `translate(${m.left},0)`)
        .call(d3.axisLeft(y).tickValues(snap.strikes.map(d => d.strike)).tickFormat(d3.format("d")).tickSizeOuter(0))
        .call(axisStyle);

      g.append("text").attr("x", m.left + innerW).attr("y", H - 5)
        .attr("text-anchor", "end").attr("fill", C.muted)
        .style("font", "10px " + mono).text("net GEX (provider units)");

      // spot line
      g.append("line").attr("x1", m.left).attr("x2", m.left + innerW)
        .attr("y1", y(snap.spot)).attr("y2", y(snap.spot))
        .attr("stroke", C.info).attr("stroke-width", 1.2).attr("stroke-dasharray", "2 3");
      g.append("rect").attr("x", m.left + 1).attr("y", y(snap.spot) - 13)
        .attr("width", 80).attr("height", 13).attr("rx", 2)
        .attr("fill", C.surface).attr("opacity", .9).attr("pointer-events", "none");
      g.append("text").attr("x", m.left + 4).attr("y", y(snap.spot) - 4)
        .attr("fill", C.info).attr("pointer-events", "none").style("font", "600 9px " + mono)
        .text("spot " + fmtSpot(snap.spot));

      // flip / zero cross
      if (snap.zero_cross != null) {
        g.append("line").attr("x1", m.left).attr("x2", m.left + innerW)
          .attr("y1", y(snap.zero_cross)).attr("y2", y(snap.zero_cross))
          .attr("stroke", C.amber).attr("stroke-width", 1.1).attr("stroke-dasharray", "4 3");
        g.append("rect").attr("x", m.left + innerW - 64).attr("y", y(snap.zero_cross) - 13)
          .attr("width", 64).attr("height", 13).attr("rx", 2)
          .attr("fill", C.surface).attr("opacity", .9).attr("pointer-events", "none");
        g.append("text").attr("x", m.left + innerW).attr("y", y(snap.zero_cross) - 4)
          .attr("text-anchor", "end").attr("fill", C.amber).attr("pointer-events", "none")
          .style("font", "600 9px " + mono).text("flip " + fmtInt(snap.zero_cross));
      }

      // Top call and top put OI only: annotating all six walls collides with the
      // flip label when a third wall sits on the zero-cross strike.
      const walls = [
        ...snap.walls.calls.slice(0, 1).map(w => ({ ...w, color: C.neg, tag: "CW" })),
        ...snap.walls.puts.slice(0, 1).map(w => ({ ...w, color: C.pos, tag: "PW" }))
      ];
      walls.forEach(w => {
        g.append("line").attr("x1", m.left).attr("x2", m.left + innerW)
          .attr("y1", y(w.strike)).attr("y2", y(w.strike))
          .attr("stroke", w.color).attr("stroke-width", 1).attr("stroke-dasharray", "1 3").attr("opacity", .7);
        if (W >= 520) {
          g.append("text").attr("x", m.left + innerW).attr("y", y(w.strike) + 3)
            .attr("fill", w.color).style("font", "9px " + mono)
            .text(`${w.tag} ${fmtInt(w.strike)}`);
        }
      });
    });
  }

  function renderGex() {
    const grid = d3.select("#gex-grid");
    grid.selectAll("*").remove();
    [["t1", DATA.gex.t1.label], ["t2", DATA.gex.t2.label + " (last)"]].forEach(([key]) => {
      const s = DATA.gex[key];
      const card = grid.append("div");
      const head = card.append("div").attr("class", "chart-head");
      head.append("span").text(s.label);
      head.append("span").attr("class", "tot")
        .text(`net ${fmt1(s.net_total)} · label ${s.regime || "—"}`);
      const host = card.append("div").attr("class", "chart").node();
      drawGex(host, key);
    });
    d3.select("#gex-caption").html(
      `Net GEX went <b>${fmt1(DATA.gex.t1.net_total)}</b> → <b>${fmt1(DATA.gex.t2.net_total)}</b> ` +
      `(provider units). The 14:07 zero cross is <b>${DATA.gex.t2.zero_cross == null ? "not reported" : fmtInt(DATA.gex.t2.zero_cross)}</b>; ` +
      `the 12:00 panel reports <b>${DATA.gex.t1.zero_cross == null ? "none" : fmtInt(DATA.gex.t1.zero_cross)}</b>. ` +
      `Top walls at 14:07: call <b>${fmtInt(DATA.gex.t2.walls.calls[0].strike)}</b> ` +
      `(${fmtInt(DATA.gex.t2.walls.calls[0].oi)} OI) and put ` +
      `<b>${fmtInt(DATA.gex.t2.walls.puts[0].strike)}</b> (${fmtInt(DATA.gex.t2.walls.puts[0].oi)} OI). ` +
      `The provider's <code>gex.regime</code> string is shown verbatim — it read “short” all session, so the sign of net GEX is the usable read.`
    );
  }

  // ---------------------------------------------------------------- 03 levels
  function drawLevels(host) {
    const rows = DATA.levels.rows;
    const values = rows.flatMap(d => [d.d1, d.d2]).filter(v => v != null);
    const xMin = Math.floor((d3.min(values) - 15) / 10) * 10;
    const xMax = Math.ceil((d3.max(values) + 15) / 10) * 10;

    responsive(host, W => {
      const H = W < 520 ? 270 : 300;
      const m = { top: 20, right: W < 520 ? 12 : 90, bottom: 38, left: 92 };
      const innerW = W - m.left - m.right;
      const innerH = H - m.top - m.bottom;
      const x = d3.scaleLinear().domain([xMin, xMax]).range([m.left, m.left + innerW]);
      const y = d3.scaleBand().domain(rows.map(d => d.id)).range([m.top, m.top + innerH]).padding(.34);

      const color = d => d.kind === "call" ? C.neg : d.kind === "put" ? C.pos : C.amber;

      const svg = d3.select(host).append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("role", "img")
        .attr("aria-label", "Wall and max pain distance from spot");
      const g = svg.append("g");

      const xTicks = x.ticks(6);
      g.append("g").attr("class", "grid")
        .selectAll("line").data(xTicks).join("line")
        .attr("y1", m.top).attr("y2", m.top + innerH)
        .attr("x1", d => x(d)).attr("x2", d => x(d));

      g.append("line").attr("x1", x(0)).attr("x2", x(0))
        .attr("y1", m.top).attr("y2", m.top + innerH)
        .attr("stroke", C.info).attr("stroke-width", 1.3).attr("stroke-dasharray", "3 3");
      g.append("text").attr("x", x(0)).attr("y", m.top - 6).attr("text-anchor", "middle")
        .attr("fill", C.info).style("font", "600 9px " + mono).text("spot");

      const r = Math.min(6, Math.max(4, y.bandwidth() * 0.22));
      rows.forEach(d => {
        const yy = y(d.id) + y.bandwidth() / 2;
        const col = color(d);
        g.append("line").attr("x1", x(d.d1)).attr("x2", x(d.d2))
          .attr("y1", yy).attr("y2", yy).attr("stroke", col)
          .attr("stroke-width", 2).attr("opacity", .55);
        g.append("circle").attr("cx", x(d.d1)).attr("cy", yy).attr("r", r)
          .attr("fill", C.surface).attr("stroke", col).attr("stroke-width", 1.6);
        g.append("circle").attr("cx", x(d.d2)).attr("cy", yy).attr("r", r)
          .attr("fill", col).attr("stroke", C.bg).attr("stroke-width", 1);

        g.append("text").attr("x", m.left - 10).attr("y", yy - 2)
          .attr("text-anchor", "end").attr("fill", C.text)
          .style("font", "600 10px " + mono).text(d.label);
        g.append("text").attr("x", m.left - 10).attr("y", yy + 11)
          .attr("text-anchor", "end").attr("fill", C.muted)
          .style("font", "9px " + mono).text(fmtInt(d.strike));

        if (W >= 620) {
          g.append("text").attr("x", x(d.d2) + (d.d2 >= 0 ? 8 : -8)).attr("y", yy + 3)
            .attr("text-anchor", d.d2 >= 0 ? "start" : "end")
            .attr("fill", col).style("font", "600 10px " + mono)
            .text(fmt1(d.d2) + " pts");
        }
      });

      g.append("line").attr("x1", m.left).attr("x2", m.left + innerW)
        .attr("y1", m.top + innerH).attr("y2", m.top + innerH)
        .attr("stroke", C.border);
      g.append("g").attr("class", "axis")
        .attr("transform", `translate(0,${m.top + innerH})`)
        .call(d3.axisBottom(x).tickValues(xTicks).tickFormat(d3.format("+,.0f")).tickSizeOuter(0))
        .call(axisStyle);
      g.append("text").attr("x", m.left + innerW).attr("y", H - 5)
        .attr("text-anchor", "end").attr("fill", C.muted)
        .style("font", "10px " + mono).text("pts from spot");

      const hover = g.selectAll(".hit").data(rows).join("rect")
        .attr("class", "hit")
        .attr("x", m.left).attr("y", d => y(d.id))
        .attr("width", innerW).attr("height", y.bandwidth())
        .attr("fill", "transparent").style("cursor", "crosshair");
      hover.on("mousemove", (event, d) => {
        const oi = d.oi2 == null ? "—" : fmtInt(d.oi2);
        showTip(event,
          `<b>${d.label} · ${fmtInt(d.strike)}</b><br>` +
          `12:00: ${fmt1(d.d1)} pts<br>` +
          `14:07: <b>${fmt1(d.d2)} pts</b><br>` +
          `14:07 OI: ${oi}`);
      }).on("mouseleave", hideTip);
    });
  }

  function renderLevels() {
    drawLevels(document.getElementById("levels-chart"));
    const r = DATA.levels.rows;
    const mp = r.find(d => d.kind === "maxpain");
    const c2 = DATA.levels.t2.calls[1];
    d3.select("#levels-caption").html(
      `Max pain held at <b>${fmtInt(mp.strike)}</b> (${fmt1(mp.d1)} → ${fmt1(mp.d2)} pts from spot). ` +
      `The top call-OI strike is <b>${fmtInt(c2.strike)}</b>, ${fmt1(c2.distance)} pts from spot; ` +
      `the top put-OI strike is <b>${fmtInt(DATA.levels.t2.puts[0].strike)}</b>, ` +
      `${fmt1(DATA.levels.t2.puts[0].distance)} pts from spot. ` +
      `Distance is strike minus the spot at that time, so a level that does not move still changes distance when spot moves.`
    );
  }

  // ---------------------------------------------------------------- 04 IV vs RV
  function drawVol(host) {
    const series = DATA.vol_context.series;
    const parse = d3.isoParse;
    const rows = series.map(d => ({ ...d, date: parse(d.ts) }));
    const t0 = rows[0].date;
    const t1 = rows[rows.length - 1].date;

    responsive(host, W => {
      const H = W < 520 ? 250 : 320;
      const m = { top: 26, right: 16, bottom: 38, left: 44 };
      const innerW = W - m.left - m.right;
      const innerH = H - m.top - m.bottom;
      const x = d3.scaleTime().domain([t0, t1]).range([m.left, m.left + innerW]);
      const y = d3.scaleLinear().domain([0, 30]).range([m.top + innerH, m.top]);

      const svg = d3.select(host).append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("role", "img")
        .attr("aria-label", "ATM implied volatility versus realised volatility over the session");
      const g = svg.append("g");

      const yTicks = d3.range(0, 31, 5);
      g.append("g").attr("class", "grid")
        .selectAll("line").data(yTicks).join("line")
        .attr("x1", m.left).attr("x2", m.left + innerW)
        .attr("y1", d => y(d)).attr("y2", d => y(d));

      const area = d3.area()
        .defined(d => d.rv != null && d.atm_iv != null)
        .x(d => x(d.date)).y0(d => y(d.rv)).y1(d => y(d.atm_iv));
      g.append("path").datum(rows).attr("fill", C.info).attr("opacity", .12).attr("d", area);

      const ivLine = d3.line().defined(d => d.atm_iv != null)
        .x(d => x(d.date)).y(d => y(d.atm_iv));
      const rvLine = d3.line().defined(d => d.rv != null)
        .x(d => x(d.date)).y(d => y(d.rv));
      g.append("path").datum(rows).attr("fill", "none")
        .attr("stroke", C.info).attr("stroke-width", 2).attr("d", ivLine);
      g.append("path").datum(rows).attr("fill", "none")
        .attr("stroke", C.warn).attr("stroke-width", 1.7).attr("stroke-dasharray", "5 4").attr("d", rvLine);

      const hourStep = W < 520 ? 2 : 1;
      g.append("g").attr("class", "axis")
        .attr("transform", `translate(0,${m.top + innerH})`)
        .call(d3.axisBottom(x).ticks(d3.timeHour.every(hourStep)).tickFormat(d3.timeFormat("%H:%M")).tickSizeOuter(0))
        .call(axisStyle);
      g.append("g").attr("class", "axis")
        .attr("transform", `translate(${m.left},0)`)
        .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(d => d + "%").tickSizeOuter(0))
        .call(axisStyle);

      g.append("text").attr("x", m.left).attr("y", 13).attr("fill", C.muted)
        .style("font", "10px " + mono).text("vol points");

      // key-time markers
      [["t1", DATA.meta.comparison.t1], ["t2", DATA.meta.comparison.t2]].forEach(([key, ts]) => {
        const dt = parse(ts);
        g.append("line").attr("x1", x(dt)).attr("x2", x(dt))
          .attr("y1", m.top).attr("y2", m.top + innerH)
          .attr("stroke", key === "t2" ? C.amber : C.muted)
          .attr("stroke-width", key === "t2" ? 1.4 : 1)
          .attr("stroke-dasharray", "3 3").attr("opacity", key === "t2" ? .9 : .55);
        const row = series.find(d => d.ts === ts) || series[series.length - 1];
        g.append("circle").attr("cx", x(dt)).attr("cy", y(row.atm_iv)).attr("r", 3.4)
          .attr("fill", C.info).attr("stroke", C.bg).attr("stroke-width", 1.5);
      });
      g.append("text").attr("x", x(parse(DATA.meta.comparison.t2)) - 5).attr("y", m.top - 7)
        .attr("text-anchor", "end").attr("fill", C.amber)
        .style("font", "600 9px " + mono).text("14:07");
      g.append("text").attr("x", x(parse(DATA.meta.comparison.t1)) - 5).attr("y", m.top - 7)
        .attr("text-anchor", "end").attr("fill", C.muted)
        .style("font", "9px " + mono).text("12:00");

      const bis = d3.bisector(d => d.date).center;
      const focus = g.append("g").style("display", "none");
      const fl = focus.append("line").attr("y1", m.top).attr("y2", m.top + innerH)
        .attr("stroke", C.text).attr("stroke-width", 1).attr("stroke-dasharray", "2 3").attr("opacity", .55);
      const fi = focus.append("circle").attr("r", 3.6).attr("fill", C.info).attr("stroke", C.bg);
      const fr = focus.append("circle").attr("r", 3.6).attr("fill", C.warn).attr("stroke", C.bg);

      svg.append("rect").attr("x", m.left).attr("y", m.top)
        .attr("width", innerW).attr("height", innerH)
        .attr("fill", "transparent")
        .on("mousemove", function (event) {
          const px = d3.pointer(event, svg.node())[0];
          const i = bis(rows, x.invert(px));
          const d = rows[i];
          if (!d) return;
          focus.style("display", null);
          fl.attr("x1", x(d.date)).attr("x2", x(d.date));
          fi.attr("cx", x(d.date)).attr("cy", y(d.atm_iv));
          fr.attr("cx", x(d.date)).attr("cy", d.rv == null ? -20 : y(d.rv))
            .style("display", d.rv == null ? "none" : null);
          showTip(event,
            `<b>${d.time}</b><br>` +
            `ATM IV <b>${fmt2(d.atm_iv)}%</b><br>` +
            `RV ${d.rv == null ? "—" : fmt2(d.rv) + "%"}<br>` +
            `IV/RV ${d.ratio == null ? "—" : d.ratio.toFixed(3)}<br>` +
            `<span class="muted">spot ${fmtSpot(d.spot)}</span>`);
        })
        .on("mouseleave", () => { focus.style("display", "none"); hideTip(); });
    });
  }

  function renderVol() {
    drawVol(document.getElementById("vol-chart"));
    const vc = DATA.vol_context;
    const s = vc.straddle;
    const stats = [
      {
        label: "ATM straddle",
        value: `${fmt2(s.t1)} → ${fmt2(s.t2)}`,
        note: `${fmtPct(s.change_pct)}% vs post-roll open · ATM ${fmtInt(s.atm_strike_t1)} → ${fmtInt(s.atm_strike_t2)}`
      },
      {
        label: "India VIX",
        value: `${fmt2(vc.vix.t1)} → ${fmt2(vc.vix.t2)}`,
        note: `${fmtPct(vc.vix.t2 - vc.vix.t1)} pts · flat, unlike NIFTY 0DTE IV`
      },
      {
        label: "IV / RV",
        value: `${vc.rv_iv_ratio.t1.toFixed(3)} → ${vc.rv_iv_ratio.t2.toFixed(3)}`,
        note: "lower ratio = wider variance premium"
      }
    ];
    const root = d3.select("#vol-stats");
    root.selectAll("*").remove();
    stats.forEach(st => {
      const el = root.append("div").attr("class", "stat");
      el.append("div").attr("class", "label").text(st.label);
      el.append("div").attr("class", "value").text(st.value);
      el.append("div").attr("class", "note").text(st.note);
    });
    d3.select("#vol-caption").html(
      `The series starts at <b>${vc.series_start}</b>, after the RV warm-up; earlier bars are excluded rather than plotted as a false ratio. ` +
      `The shaded gap is IV minus RV, not a forecast. The straddle is re-struck when the ATM strike rolls, ` +
      `so its percentage is only comparable against the post-roll reference.`
    );
  }

  // ---------------------------------------------------------------- text
  function renderText() {
    const list = d3.select("#summary-list");
    DATA.summary.bullets.forEach(b => {
      list.append("li").html(`<strong>${b.lead}</strong> ${b.body}`);
    });
    const cav = d3.select("#caveat-list");
    DATA.summary.caveats.forEach(c => cav.append("li").html(c));

    const m = DATA.meta;
    d3.select("#footer").html(
      `Source: <code>${m.source_files[0]}</code> (${m.snapshots} snapshots), ` +
      `<code>${m.source_files[1]}</code> (${m.tape_rows} rows), ` +
      `<code>futures_1m.json</code> clipped at ${m.comparison.t2.slice(11, 16)} IST. ` +
      `Comparison: ${m.comparison.t1.slice(11, 16)} vs ${m.comparison.t2.slice(11, 16)} IST. ` +
      `The last record is ${m.snapshot_last}; this page is a frozen report, not a live quote. ` +
      `Colors follow <code>src/ui/palette.ts</code>. Chart library: D3 v7 (CDN).`
    );
  }

  renderKpis();
  renderSmile();
  renderGex();
  renderLevels();
  renderVol();
  renderText();
})();
</script>
</body>
</html>
"""


def write_report(payload: dict[str, Any], html_path: Path, json_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    html = HTML_TEMPLATE.replace("__VOL_DATA__", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    date_label = datetime.strptime(payload["meta"]["date"], "%Y-%m-%d").strftime("%d %b %Y")
    html = html.replace("__DATE_LABEL__", date_label).replace("__DATE_ISO__", payload["meta"]["date"])
    html_path.write_text(html)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=DEFAULT_DATE)
    parser.add_argument("--t1", default=DEFAULT_T1)
    parser.add_argument("--window", type=int, default=200, help="smile window in points")
    parser.add_argument(
        "--out",
        default=None,
        help="HTML output (default reports/nifty_<date>/04-volatility.html)",
    )
    args = parser.parse_args()

    html_path = Path(args.out) if args.out else ROOT / "reports" / f"nifty_{args.date}" / "04-volatility.html"
    json_path = html_path.parent / "data" / "volatility.json"

    payload = build_payload(args.date, args.t1, args.window)
    write_report(payload, html_path, json_path)
    print(f"wrote {json_path.relative_to(ROOT)}")
    print(f"wrote {html_path.relative_to(ROOT)} ({html_path.stat().st_size:,} bytes)")
    print(
        f"comparison {payload['meta']['comparison']['t1']} -> "
        f"{payload['meta']['comparison']['t2']}; "
        f"spot {payload['kpis']['spot']['t1']} -> {payload['kpis']['spot']['t2']}"
    )


if __name__ == "__main__":
    main()
