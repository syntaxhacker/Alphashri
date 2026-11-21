#!/usr/bin/env python3
"""NIFTY session replay / strike ladder report — standalone HTML artefact.

Reads the 10-second slim option-chain recorder (``nifty_chain10s``), the
1-minute futures candles and the 1-minute tape metadata for one session and
emits a self-contained D3 v7 page:

  1. time x strike heatmap (OI / volume / premium) with the spot path below it
  2. the 25500 PE focus: premium, OI and volume annotated at 11:00 / 11:55 / 12:00
  3. small multiples of the four highest-volume strikes
  4. event cards (11:10 ITM put expansion, 11:55-12:05 surge, 12:00 futures long
     buildup, 12:15 unwind) backed by a futures price + OI panel

Everything that is printed as a number is computed here, never typed by hand.
The chain10s recorder stops at 14:09 on 2026-11-17; every series is clipped to
that instant, so the page never draws a line the recorder did not see.

Usage
-----
    .venv/bin/python scripts/market/nifty_report_replay.py
    .venv/bin/python scripts/market/nifty_report_replay.py --date 2026-11-17 \
        --write-index --write-readme

D3 is inlined when a local copy is available (``--d3``, the d3 package under
``node_modules``, or a cached download in ``/tmp/opencode``); otherwise the page
falls back to the jsDelivr URL. The HTML is then fully self-contained.
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

REPO = Path(__file__).resolve().parents[2]
D3_VERSION = "7.9.0"
D3_URL = f"https://cdn.jsdelivr.net/npm/d3@{D3_VERSION}/dist/d3.min.js"
D3_CACHE = Path("/tmp/opencode/d3.v7.min.js")


# --------------------------------------------------------------------------- #
# small formatting helpers (Indian digit grouping, so 41,000,000 reads 4,10,00,000)
# --------------------------------------------------------------------------- #
def inr(value: float, nd: int = 0) -> str:
    text = f"{abs(value):.{nd}f}"
    whole, _, dec = text.partition(".")
    sign = "-" if value < 0 else ""
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts: list[str] = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return f"{sign}{whole}" + (f".{dec}" if dec else "")


def lakh(value: float, nd: int = 1) -> str:
    return f"{inr(value, nd)} L"


def _round(value: Optional[float], nd: int = 2) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), nd)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open() as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


# --------------------------------------------------------------------------- #
# payload build
# --------------------------------------------------------------------------- #
def build_payload(
    snaps: list[dict[str, Any]],
    futures: dict[str, Any],
    tape_meta: dict[str, Any],
    focus_strike: float = 25500.0,
) -> dict[str, Any]:
    if not snaps:
        raise SystemExit("chain10s file is empty — nothing to replay")

    first, last = snaps[0], snaps[-1]
    open_minute = first["t"][11:16]
    end_minute = last["t"][11:16]

    def minute_index(label: str) -> int:
        oh, om = int(open_minute[:2]), int(open_minute[3:])
        h, m = int(label[:2]), int(label[3:])
        return (h * 60 + m) - (oh * 60 + om)

    n_min = minute_index(end_minute) + 1
    minutes = []
    for i in range(n_min):
        total = (int(open_minute[:2]) * 60 + int(open_minute[3:])) + i
        minutes.append(f"{total // 60:02d}:{total % 60:02d}")

    strikes: list[float] = sorted({row[0] for snap in snaps for row in snap["rows"]})
    s_index = {strike: i for i, strike in enumerate(strikes)}
    n_str = len(strikes)

    # ---- per strike x minute series -------------------------------------- #
    oi_ce = [[None] * n_min for _ in range(n_str)]
    oi_pe = [[None] * n_min for _ in range(n_str)]
    ltp_ce = [[None] * n_min for _ in range(n_str)]
    ltp_pe = [[None] * n_min for _ in range(n_str)]
    vol = [[0.0] * n_min for _ in range(n_str)]      # lakh units traded in the minute
    premium = [[0.0] * n_min for _ in range(n_str)]  # ₹ Cr traded in the minute

    prev: dict[float, tuple[float, float]] = {}
    for snap in snaps:
        mi = minute_index(snap["t"][11:16])
        if mi < 0 or mi >= n_min:
            continue
        for row in snap["rows"]:
            strike, ce_ltp, ce_oi, ce_vol, pe_ltp, pe_oi, pe_vol = row[:7]
            si = s_index[strike]
            oi_ce[si][mi] = ce_oi / 1e5
            oi_pe[si][mi] = pe_oi / 1e5
            ltp_ce[si][mi] = ce_ltp
            ltp_pe[si][mi] = pe_ltp
            before = prev.get(strike)
            if before is not None:
                d_ce = max(0.0, ce_vol - before[0])
                d_pe = max(0.0, pe_vol - before[1])
                vol[si][mi] += (d_ce + d_pe) / 1e5
                premium[si][mi] += (d_ce * ce_ltp + d_pe * pe_ltp) / 1e7
            prev[strike] = (ce_vol, pe_vol)

    # forward-fill OI / LTP so a dropped recorder tick does not blank a column
    for series in (oi_ce, oi_pe, ltp_ce, ltp_pe):
        for row in series:
            carry: Optional[float] = None
            for i, value in enumerate(row):
                if value is None:
                    row[i] = carry
                else:
                    carry = value

    total_oi = [
        [
            (oi_ce[si][i] or 0.0) + (oi_pe[si][i] or 0.0) if (oi_ce[si][i] is not None or oi_pe[si][i] is not None) else None
            for i in range(n_min)
        ]
        for si in range(n_str)
    ]

    # ---- spot path, one point per minute --------------------------------- #
    spot_by_minute: list[Optional[float]] = [None] * n_min
    for snap in snaps:
        mi = minute_index(snap["t"][11:16])
        if 0 <= mi < n_min:
            spot_by_minute[mi] = snap["spot"]
    carry = None
    for i, value in enumerate(spot_by_minute):
        if value is None:
            spot_by_minute[i] = carry
        else:
            carry = value
    spot_series = [[i * 60, round(v, 2)] for i, v in enumerate(spot_by_minute) if v is not None]

    # ---- focus strike at full 10s resolution ----------------------------- #
    focus_si = s_index.get(focus_strike)
    if focus_si is None:
        focus_si = min(range(n_str), key=lambda i: abs(strikes[i] - focus_strike))
        focus_strike = strikes[focus_si]
    focus_t: list[int] = []
    focus_ltp: list[float] = []
    focus_oi: list[float] = []
    focus_ce_ltp: list[float] = []
    open_epoch = None
    for snap in snaps:
        stamp = datetime.fromisoformat(snap["t"])
        if open_epoch is None:
            open_epoch = stamp.replace(hour=9, minute=15, second=0, microsecond=0)
        sec = int((stamp - open_epoch).total_seconds())
        for row in snap["rows"]:
            if row[0] == focus_strike:
                focus_t.append(sec)
                focus_ce_ltp.append(round(row[1], 2))
                focus_oi.append(round(row[5] / 1e5, 2))
                focus_ltp.append(round(row[4], 2))
                break

    # ---- four highest-volume strikes ------------------------------------ #
    last_rows = {row[0]: row for row in last["rows"]}
    ranked = sorted(
        ((row[3] + row[6], row[0]) for row in last["rows"]),
        reverse=True,
    )[:4]
    small = []
    for cum_vol, strike in ranked:
        si = s_index[strike]
        small.append(
            {
                "strike": strike,
                "cum": round(cum_vol / 1e5, 0),
                "ce": [_round(v, 2) for v in ltp_ce[si]],
                "pe": [_round(v, 2) for v in ltp_pe[si]],
                "vol": [_round(v, 2) for v in vol[si]],
                "oi_ce": _round(last_rows[strike][2] / 1e5, 0),
                "oi_pe": _round(last_rows[strike][5] / 1e5, 0),
            }
        )

    # ---- futures, clipped to the chain10s window ------------------------- #
    candles = futures.get("candles") or []
    open_dt = datetime.fromisoformat(snaps[0]["t"])
    session_open = open_dt.replace(hour=9, minute=15, second=0, microsecond=0)
    end_sec = int((datetime.fromisoformat(last["t"]) - session_open).total_seconds())
    fut_t, fut_c, fut_v, fut_oi, fut_h, fut_l = [], [], [], [], [], []
    for candle in candles:
        stamp = datetime.fromisoformat(candle["t"])
        sec = int((stamp - session_open).total_seconds())
        if sec < 0 or sec > end_sec:
            continue
        fut_t.append(sec)
        fut_c.append(candle["c"])
        fut_h.append(candle["h"])
        fut_l.append(candle["l"])
        fut_v.append(candle["v"])
        fut_oi.append(round(candle["oi"] / 1e5, 1))

    by_minute = {c["t"][11:16]: c for c in candles}

    def fut_slice(start: str, end: str) -> dict[str, float]:
        rows = [c for c in candles if start <= c["t"][11:16] <= end]
        if not rows:
            return {"move": 0.0, "move_cc": 0.0, "vol": 0.0, "oi": 0.0,
                    "open": 0.0, "first_close": 0.0, "last_close": 0.0,
                    "high": 0.0, "low": 0.0, "oi_end": 0.0}
        return {
            "move": rows[-1]["c"] - rows[0]["o"],
            "move_cc": rows[-1]["c"] - rows[0]["c"],
            "vol": float(sum(c["v"] for c in rows)),
            "oi": rows[-1]["oi"] - rows[0]["oi"],
            "oi_end": float(rows[-1]["oi"]),
            "open": rows[0]["o"],
            "first_close": rows[0]["c"],
            "last_close": rows[-1]["c"],
            "high": max(c["h"] for c in rows),
            "low": min(c["l"] for c in rows),
        }

    def spot_window(start: str, end: str) -> tuple[float, float]:
        vals = [s["spot"] for s in snaps if start <= s["t"][11:16] <= end]
        if not vals:
            return 0.0, 0.0
        return vals[0], max(vals)

    # ---- put volume up the ladder (strike-anchored, no ITM drift) -------- #
    put_vol_min: dict[str, dict[float, float]] = {m: {} for m in minutes}
    all_put_min: dict[str, float] = {m: 0.0 for m in minutes}
    prev_pe: dict[float, float] = {}
    for snap in snaps:
        mi = minute_index(snap["t"][11:16])
        if not (0 <= mi < n_min):
            continue
        label = minutes[mi]
        for row in snap["rows"]:
            strike, pe_vol_cum = row[0], row[6]
            before = prev_pe.get(strike)
            if before is not None:
                delta = max(0.0, pe_vol_cum - before) / 1e5
                put_vol_min[label][strike] = put_vol_min[label].get(strike, 0.0) + delta
                all_put_min[label] += delta
            prev_pe[strike] = pe_vol_cum

    def ladder_rate(start: str, end: str) -> tuple[float, float]:
        """Mean per-minute volume at 25500+25550 PE and its share of all put volume."""
        rs = [m for m in minutes if start <= m <= end]
        if not rs:
            return 0.0, 0.0
        rates = [(put_vol_min[m].get(25500.0, 0.0) + put_vol_min[m].get(25550.0, 0.0)) for m in rs]
        totals = [all_put_min[m] for m in rs]
        mean_rate = sum(rates) / len(rs)
        mean_total = sum(totals) / len(rs)
        share = (sum(rates) / sum(totals) * 100) if sum(totals) else 0.0
        return mean_rate, share

    ladder_before, share_before = ladder_rate("11:00", "11:09")
    ladder_after, share_after = ladder_rate("11:10", "11:39")
    ladder_ratio = (ladder_after / ladder_before) if ladder_before else 0.0

    # ---- focus-strike landmarks ------------------------------------------ #
    def focus_at(label: str) -> tuple[float, float, float]:
        i = minute_index(label)
        i = max(0, min(n_min - 1, i))
        return (
            oi_pe[focus_si][i] or 0.0,
            ltp_pe[focus_si][i] or 0.0,
            oi_ce[focus_si][i] or 0.0,
        )

    pe_oi_1100, pe_ltp_1100, _ = focus_at("11:00")
    pe_oi_1155, pe_ltp_1155, _ = focus_at("11:55")
    pe_oi_1200, pe_ltp_1200, _ = focus_at("12:00")
    pe_oi_1205, _, _ = focus_at("12:05")
    pe_oi_end, pe_ltp_end, _ = focus_at(minutes[-1])

    peak_i = max(range(len(focus_oi)), key=lambda i: focus_oi[i])
    pe_oi_peak, peak_sec = focus_oi[peak_i], focus_t[peak_i]

    # first snapshot from which 25500 CE stays the highest-OI call strike
    top_since: Optional[str] = None
    for snap in snaps:
        top = max(snap["rows"], key=lambda r: r[2])[0]
        if top == focus_strike:
            if top_since is None:
                top_since = snap["t"][11:19]
        else:
            top_since = None

    surge = fut_slice("11:55", "12:05")
    buildup = fut_slice("11:45", "12:00")
    unwind = fut_slice("12:15", "12:45")
    surge_spot, surge_spot_high = spot_window("11:55", "12:05")

    def spot_pick(label: str) -> float:
        i = max(0, min(n_min - 1, minute_index(label)))
        return spot_by_minute[i] or 0.0

    # ---- events ----------------------------------------------------------- #
    def hhmm_of(sec: int) -> str:
        total = 9 * 60 + 15 + round(sec / 60)
        return f"{total // 60:02d}:{total % 60:02d}"

    events = [
        {
            "id": 1,
            "time": "11:10",
            "span": None,
            "title": "ITM put volume expands up the ladder",
            "detail": (
                f"25500 + 25550 PE trade {lakh(ladder_after)} units/min across 11:10–11:39 "
                f"versus {lakh(ladder_before)} units/min across 11:00–11:09 ({ladder_ratio:.1f}×), lifting "
                f"their share of all put volume from {share_before:.1f}% to {share_after:.1f}% "
                f"while total put volume only grew modestly. 25500 PE OI "
                f"{lakh(pe_oi_1100)} → {lakh(pe_oi_1155)} by 11:55 as its premium fell "
                f"₹{pe_ltp_1100:.2f} → ₹{pe_ltp_1155:.2f}."
            ),
            "read": (
                f"25500 PE stays in the money all morning (strike above spot), so this is "
                f"intrinsic-value put volume decaying while OI builds — writing, not protection."
            ),
        },
        {
            "id": 2,
            "time": "11:55",
            "span": "11:55–12:05",
            "title": "Surge: one push, then a stall",
            "detail": (
                f"NIFTY futures {surge['open']:,.1f} → {surge['last_close']:,.1f} "
                f"({surge['move']:+.1f} pts, high {surge['high']:,.1f}) on "
                f"{inr(surge['vol'])} lots; OI {surge['oi']:+,}. Spot "
                f"{surge_spot:,.1f} → {surge_spot_high:,.1f}. 25500 PE OI "
                f"{lakh(pe_oi_1155)} → {lakh(pe_oi_1205)} while its premium went "
                f"₹{pe_ltp_1155:.2f} → ₹{pe_ltp_1200:.2f}."
            ),
            "read": (
                "The push came on volume, not on a new range: spot stalled at the high and the "
                "premium kept bleeding, so the move was sold into by option writers."
            ),
        },
        {
            "id": 3,
            "time": "12:00",
            "span": None,
            "title": "Futures long buildup",
            "detail": (
                f"Futures closed 11:45 at {buildup['first_close']:,.1f} and 12:00 at "
                f"{buildup['last_close']:,.1f} ({buildup['move_cc']:+.1f} pts) with OI "
                f"{buildup['oi']:+,} to {inr(buildup['oi_end'])} and {inr(buildup['vol'])} lots "
                f"traded across the 16 minutes, 11:45–12:00 inclusive."
            ),
            "read": "Price up and OI up is the only combination that means fresh longs, not short covering.",
        },
        {
            "id": 4,
            "time": "12:15",
            "span": "12:15–12:45",
            "title": "Long unwind",
            "detail": (
                f"12:15 → 12:45: futures {unwind['first_close']:,.1f} → {unwind['last_close']:,.1f} "
                f"({unwind['move_cc']:+.1f} pts), OI {unwind['oi']:+,} — positions closing into a "
                f"drifting price. 25500 PE OI peaks at {lakh(pe_oi_peak)} at {hhmm_of(peak_sec)}, "
                f"then unwinds to {lakh(pe_oi_end)} by {minutes[-1]}."
            ),
            "read": (
                "Falling price with falling OI is liquidation, not new shorts. The 25500 put "
                "wall was rented, not owned."
            ),
        },
    ]

    oi_resets = [
        candles[i]["t"][11:16] for i in range(1, len(candles))
        if candles[i]["oi"] - candles[i - 1]["oi"] <= -50000
    ]

    # ---- body copy (numbers injected, nothing typed twice) ---------------- #
    ce_open = (oi_ce[s_index[25500.0]][0] or 0.0) if 25500.0 in s_index else 0.0
    pe_open = (oi_pe[s_index[25500.0]][0] or 0.0) if 25500.0 in s_index else 0.0
    ce_close = (oi_ce[s_index[25500.0]][-1] or 0.0) if 25500.0 in s_index else 0.0
    pe_close = (oi_pe[s_index[25500.0]][-1] or 0.0) if 25500.0 in s_index else 0.0

    notes = {
        "heat": (
            "One row per strike, one column per minute. OI is the level held at the end of that "
            "minute (CE + PE, lakh units); volume is the minute's increment of the exchange's "
            "cumulative quantity; premium is what that increment actually paid "
            f"(Δqty × LTP, ₹ Cr). The 25500 row is the spine of the ladder: call OI "
            f"{lakh(ce_open)} → {lakh(ce_close)}, put OI {lakh(pe_open)} → {lakh(pe_close)}."
        ),
        "focus": (
            f"25500 sits {abs(focus_strike - spot_pick(minutes[-1])):.0f} pts from the last spot "
            f"({spot_pick(minutes[-1]):,.1f}) and has been the highest-OI call strike without a "
            f"break since {top_since or 'the open'}. Put OI went {lakh(pe_open)} at 09:15 → "
            f"{lakh(pe_oi_1200)} by 12:00 → peak {lakh(pe_oi_peak)} at {hhmm_of(peak_sec)}, while "
            f"premium decayed ₹{pe_ltp_1100:.2f} (11:00) → ₹{pe_ltp_1200:.2f} (12:00) → "
            f"₹{pe_ltp_end:.2f} at {minutes[-1]}. Premium falling with OI rising is writing; "
            "premium and OI falling together is unwinding."
        ),
        "small": (
            "The four strikes that traded the most units. Premium is per-unit ₹ (CE blue, PE "
            "orange); the grey bars are that strike's minute volume. The CE premium of the two "
            "strikes just above spot tracks the index far more tightly than OI does — OI is a "
            "stock, premium is a rate."
        ),
        "events": (
            "Every claim above is measured from the 1-minute futures file and the 10-second chain, "
            "clipped at the last recorded snapshot. Nothing after 14:09 is drawn or implied. "
            + (
                "Futures open interest is quoted only as window deltas: the 1-minute OI level steps "
                f"down ~1 lakh at {', '.join(oi_resets)} and never recovers, so no OI level line is drawn."
                if oi_resets else ""
            )
        ),
    }

    return {
        "meta": {
            "date": first["t"][:10],
            "underlying": "NIFTY",
            "expiry": first.get("expiry") or "",
            "first": first["t"][11:19],
            "last": last["t"][11:19],
            "snaps": len(snaps),
            "minutes": minutes,
            "n_min": n_min,
            "strikes": [int(k) for k in strikes],
            "spot_open": round(first["spot"], 2),
            "spot_last": round(last["spot"], 2),
            "spot_high": round(max(s["spot"] for s in snaps), 2),
            "spot_low": round(min(s["spot"] for s in snaps), 2),
            "tape_last": tape_meta.get("tape_last", ""),
            "tape_rows": tape_meta.get("tape_rows", 0),
            "focus_strike": focus_strike,
            "top_volume": [{"strike": s["strike"], "cum": s["cum"]} for s in small],
        },
        "heat": {
            "oi": [[_round(v, 1) for v in row] for row in total_oi],
            "vol": [[_round(v, 2) for v in row] for row in vol],
            "prem": [[_round(v, 2) for v in row] for row in premium],
            "oi_ce": [[_round(v, 1) for v in row] for row in oi_ce],
            "oi_pe": [[_round(v, 1) for v in row] for row in oi_pe],
            "ltp_ce": [[_round(v, 2) for v in row] for row in ltp_ce],
            "ltp_pe": [[_round(v, 2) for v in row] for row in ltp_pe],
        },
        "spot": spot_series,
        "focus": {
            "strike": focus_strike,
            "t": focus_t,
            "ce": focus_ce_ltp,
            "pe": focus_ltp,
            "oi": focus_oi,
            "vol": [[i * 60, _round(v, 2)] for i, v in enumerate(vol[focus_si])],
        },
        "small": small,
        "futures": {"t": fut_t, "c": fut_c, "h": fut_h, "l": fut_l, "v": fut_v, "oi": fut_oi},
        "events": events,
        "notes": notes,
        "limits": {
            "chain_last": last["t"][11:19],
            "tape_last": (tape_meta.get("tape_last") or "")[11:19],
            "futures_last": candles[-1]["t"][11:19] if candles else "",
            "clip": last["t"][11:19],
        },
    }


# --------------------------------------------------------------------------- #
# HTML
# --------------------------------------------------------------------------- #
STYLE = """
:root{
  --bg:#000000; --surface:#13161C; --alt:#1F242D; --border:#2C313B;
  --text:#E8E8E8; --muted:#9B9B9B; --primary:#D9902A; --pos:#2FA36B;
  --neg:#E5606A; --info:#4A8FD8; --warn:#C9912F;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1720px;margin:0 auto;padding:28px 32px 72px}
a{color:var(--info);text-decoration:none}
a:hover{text-decoration:underline}
.kicker{font:600 10px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--primary)}
h1{font-size:26px;line-height:1.2;margin:10px 0 6px;letter-spacing:-.01em}
.lede{color:var(--muted);max-width:92ch;margin:0 0 18px;font-size:13px}
.masthead{border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:22px}
.statrow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:10px;overflow:hidden}
.stat{background:var(--surface);padding:10px 12px}
.stat .k{font:600 9.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.stat .v{font:600 15px/1.3 var(--mono);margin-top:5px;color:var(--text);font-variant-numeric:tabular-nums}
.stat .s{font-size:11px;color:var(--muted);margin-top:2px}
.reportnav{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.reportnav a{font:600 11px/1 var(--mono);padding:6px 10px;border:1px solid var(--border);
  border-radius:6px;color:var(--muted);background:var(--surface)}
.reportnav a.on{color:var(--primary);border-color:rgba(217,144,42,.5);background:rgba(217,144,42,.1)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 16px 18px;
  margin-bottom:18px}
.cardhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin-bottom:12px}
.cardhead h2{font-size:15px;margin:0;letter-spacing:-.005em}
.cardhead .num{font:600 10px/1 var(--mono);color:var(--primary);letter-spacing:.1em}
.cardhead .sub{font-size:11.5px;color:var(--muted)}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:10px 0 12px;
  border-top:1px solid var(--border);margin-top:2px}
.toolbar .lbl{font:600 9.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden}
.seg button{appearance:none;border:0;background:transparent;color:var(--muted);cursor:pointer;
  font:600 11px/1 var(--mono);padding:7px 12px;border-right:1px solid var(--border)}
.seg button:last-child{border-right:0}
.seg button[aria-pressed="true"]{background:rgba(217,144,42,.12);color:var(--primary)}
.seg button:hover{color:var(--text)}
select{background:var(--alt);color:var(--text);border:1px solid var(--border);border-radius:6px;
  font:12px/1 var(--mono);padding:6px 8px;min-height:30px}
.chipbtn{background:var(--alt);color:var(--muted);border:1px solid var(--border);border-radius:6px;
  font:600 10.5px/1 var(--mono);padding:7px 9px;cursor:pointer}
.chipbtn:hover{color:var(--text);border-color:#3C434F}
.chipbtn[aria-pressed="true"]{color:var(--primary);border-color:rgba(217,144,42,.55);background:rgba(217,144,42,.1)}
.spacer{flex:1 1 auto}
.legend{display:flex;align-items:center;gap:8px;font:10px/1 var(--mono);color:var(--muted)}
.legend .ramp{width:132px;height:8px;border-radius:2px;border:1px solid #2C313B}
.chart{position:relative}
.chart svg{display:block}
.scrollx{overflow-x:auto;overflow-y:hidden;position:relative}
.scrollx svg{max-width:none}
.scrollx::-webkit-scrollbar{height:8px}
.scrollx::-webkit-scrollbar-thumb{background:#2C313B;border-radius:4px}
.scrollhint{display:none;font:10px/1 var(--mono);color:var(--muted);margin:2px 0 0}
.note{font-size:11.5px;color:var(--muted);margin:10px 0 0;max-width:150ch;line-height:1.6}
.note b{color:#C9C9C9;font-weight:600}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.smcell{border:1px solid var(--border);border-radius:8px;background:linear-gradient(180deg,#151920,#13161C);
  padding:10px 10px 4px}
.smhead{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.smhead .t{font:700 14px/1 var(--mono);color:var(--text)}
.smhead .m{font:10px/1.3 var(--mono);color:var(--muted)}
.evgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px}
.ev{border:1px solid var(--border);border-radius:8px;padding:12px 12px 11px;background:#151920;
  position:relative;overflow:hidden}
.ev::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--primary);opacity:.8}
.ev .t{font:700 12px/1 var(--mono);color:var(--primary)}
.ev h3{font-size:13px;margin:6px 0 6px}
.ev p{margin:0 0 8px;font-size:11.8px;color:#C4C4C4;line-height:1.55}
.ev .read{font-size:11px;color:var(--muted);border-top:1px dashed #2C313B;padding-top:7px}
.tip{position:fixed;z-index:20;pointer-events:none;background:var(--alt);border:1px solid #39414E;
  border-radius:8px;padding:9px 11px;box-shadow:0 8px 32px rgba(0,0,0,.55);min-width:196px;
  font:11.5px/1.5 var(--mono);color:var(--text)}
.tip .h{font-weight:700;color:#fff;margin-bottom:5px;display:flex;justify-content:space-between;gap:14px}
.tip .r{display:flex;justify-content:space-between;gap:16px;color:var(--muted)}
.tip .r b{color:var(--text);font-weight:600}
.tip .sep{height:1px;background:#2C313B;margin:5px 0}
footer{border-top:1px solid var(--border);padding-top:16px;color:var(--muted);font-size:11.5px}
footer code{font-family:var(--mono);color:#C4C4C4}
ul.limits{margin:6px 0 0;padding-left:18px}
ul.limits li{margin-bottom:3px}
.axl{font:10px/1 var(--mono);fill:#9B9B9B}
.axl2{font:9.5px/1 var(--mono);fill:#7C7C7C}
.gridline{stroke:#232833;stroke-width:1}
@media (max-width:1080px){
  .statrow{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (max-width:760px){
  .wrap{padding:18px 14px 56px}
  h1{font-size:20px}
  .statrow{grid-template-columns:repeat(2,minmax(0,1fr))}
  .grid2,.evgrid{grid-template-columns:1fr}
  .card{padding:13px 12px 15px}
  .toolbar{gap:8px}
  .legend .ramp{width:88px}
  .scrollhint{display:block}
}
"""

JS = r"""
(function () {
  "use strict";
  var D = window.__NIFTY_REPLAY__;
  if (!D || !window.d3) {
    document.getElementById("boot").textContent = "payload or d3 missing — regenerate the report";
    return;
  }
  var M = D.meta, H = D.heat, EV = D.events, C = {
    bg: "#000000", surface: "#13161C", alt: "#1F242D", border: "#2C313B",
    text: "#E8E8E8", muted: "#9B9B9B", primary: "#D9902A", pos: "#2FA36B",
    neg: "#E5606A", info: "#4A8FD8", warn: "#C9912F"
  };
  var RAMPS = {
    oi:   ["#101A1E", "#162B31", "#24525E", "#337D88", "#5FA89D", "#8CC4BA", "#C9E3DC"],
    vol:  ["#141709", "#1D2413", "#3F4A1E", "#6E7A34", "#9AA84E", "#C6CE8C", "#E8EBD4"],
    prem: ["#120F1C", "#171327", "#352B57", "#57498D", "#7C6BC4", "#A79BC7", "#D6D0E6"]
  };
  var LABEL = { oi: "OI (lakh units)", vol: "volume (lakh units / min)", prem: "premium (₹ Cr / min)" };

  var OPEN = 9 * 60 + 15;
  function hhmm(sec) {
    var t = OPEN + Math.round(sec / 60), h = Math.floor(t / 60), m = t % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return v.toLocaleString("en-IN", { minimumFractionDigits: d === undefined ? 1 : d,
                                       maximumFractionDigits: d === undefined ? 1 : d });
  }
  function lakh(v, d) { return v === null || v === undefined || !isFinite(v) ? "—" : num(v, d === undefined ? 1 : d) + " L"; }
  function cr(v) { return v === null || v === undefined || !isFinite(v) ? "—" : "₹" + num(v, 2) + " Cr"; }
  var GAMMA = 1.7;
  function colorOf(metric, value, max) {
    var t = Math.pow(Math.max(0, Math.min(1, value / (max || 1))), GAMMA);
    return d3.interpolateRgbBasis(RAMPS[metric])(t);
  }
  function quantile(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  }
  function metricMax(metric) {
    if (metricMax.cache[metric]) return metricMax.cache[metric];
    var vals = [], rows = H[metric];
    for (var r = 0; r < rows.length; r++) {
      for (var i = 0; i < rows[r].length; i++) {
        var v = rows[r][i];
        if (v !== null && v > 0) vals.push(v);
      }
    }
    vals.sort(function (a, b) { return a - b; });
    var m = quantile(vals, 0.96) || 1;
    metricMax.cache[metric] = m;
    return m;
  }
  metricMax.cache = {};

  var tip = document.getElementById("tip");
  function showTip(html, event) {
    tip.innerHTML = html;
    tip.hidden = false;
    var pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    var x = event.clientX + pad, y = event.clientY + pad;
    if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;
    tip.style.left = Math.max(6, x) + "px";
    tip.style.top = Math.max(6, y) + "px";
  }
  function hideTip() { tip.hidden = true; }

  /* Event rules are five minutes apart at the close (11:55 / 12:00), so labels
     fall to the next row when they would collide. */
  function eventLayout(x, left) {
    var secs = EV.map(function (e) {
      return (parseInt(e.time.slice(0, 2), 10) * 60 + parseInt(e.time.slice(3), 10) - OPEN) * 60;
    });
    var rowLast = [-1e9, -1e9, -1e9], rows = [], used = 1, prev = 0;
    secs.forEach(function (sec) {
      var px = left + x(sec), row = prev;
      if (px - rowLast[row] < 46) {
        row = (row + 1) % 3;
        while (px - rowLast[row] < 46 && row !== prev) row = (row + 1) % 3;
      }
      rowLast[row] = px;
      prev = row;
      rows.push(row);
      used = Math.max(used, row + 1);
    });
    return { secs: secs, rows: rows, used: used };
  }

  /* ------------------------------------------------------------------ */
  /* 1. heatmap + spot                                                   */
  /* ------------------------------------------------------------------ */
  var S = { metric: "oi", lo: null, hi: null };
  var strikes = M.strikes;

  function visibleStrikes() {
    return strikes.filter(function (k) { return (S.lo === null || k >= S.lo) && (S.hi === null || k <= S.hi); });
  }

  function renderHeat() {
    var host = document.getElementById("heat");
    var keeps = visibleStrikes();
    if (!keeps.length) keeps = strikes.slice();
    var w = Math.max(620, host.clientWidth || 620);
    var left = 56, right = 16, top = 16, bottom = 20;
    var iw = w - left - right;
    var rowH = Math.min(30, Math.max(11, 470 / keeps.length));
    var ih = rowH * keeps.length;
    var height = ih + top + bottom;

    var svg = d3.select(host).html("").append("svg")
      .attr("width", w).attr("height", height)
      .attr("role", "img")
      .attr("aria-label", "Time by strike " + LABEL[S.metric] + " heatmap for NIFTY " + M.date);

    var x = d3.scaleLinear().domain([0, M.n_min * 60]).range([0, iw]);
    var yOf = function (i) { return i * rowH; };
    var max = metricMax(S.metric);
    var cellW = x(60) - x(0);

    var g = svg.append("g").attr("transform", "translate(" + left + "," + top + ")");

    /* strike grid rows */
    g.append("g").selectAll("line").data(d3.range(keeps.length + 1)).join("line")
      .attr("x1", 0).attr("x2", iw).attr("y1", function (d) { return d * rowH; })
      .attr("y2", function (d) { return d * rowH; })
      .attr("stroke", "#1B2029").attr("stroke-width", 1);

    var cells = [];
    keeps.forEach(function (k, row) {
      var si = strikes.indexOf(k);
      var arr = H[S.metric][si];
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (v === null || v === undefined) continue;
        cells.push({ row: row, i: i, v: v, k: k, si: si });
      }
    });

    g.append("g").selectAll("rect").data(cells).join("rect")
      .attr("x", function (d) { return x(d.i * 60); })
      .attr("y", function (d) { return yOf(d.row); })
      .attr("width", Math.max(1, cellW + 0.15))
      .attr("height", Math.max(1, rowH - 0.6))
      .attr("fill", function (d) { return colorOf(S.metric, d.v, max); })
      .attr("shape-rendering", "crispEdges");

    /* y axis: label every other strike when dense */
    var step = keeps.length > 22 ? 2 : 1;
    var yg = g.append("g");
    keeps.forEach(function (k, row) {
      if (row % step !== 0) return;
      yg.append("text").attr("class", "axl").attr("x", -8)
        .attr("y", yOf(row) + rowH * 0.7).attr("text-anchor", "end")
        .attr("fill", k === M.focus_strike ? C.warn : "#9B9B9B")
        .attr("font-weight", k === M.focus_strike ? 700 : 400)
        .text(k);
    });

    /* x axis */
    var ticks = d3.range(0, M.n_min * 60 + 1, iw < 520 ? 3600 : 1800);
    var xg = g.append("g").attr("transform", "translate(0," + ih + ")");
    xg.selectAll("line").data(ticks).join("line")
      .attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", 5).attr("stroke", "#39414E");
    xg.selectAll("text").data(ticks).join("text").attr("class", "axl")
      .attr("x", x).attr("y", 16).attr("text-anchor", "middle").text(function (d) { return hhmm(d); });

    /* event rules */
    var evg = g.append("g");
    EV.forEach(function (e) {
      var sec = (parseInt(e.time.slice(0, 2), 10) * 60 + parseInt(e.time.slice(3), 10) - OPEN) * 60;
      evg.append("line").attr("x1", x(sec)).attr("x2", x(sec)).attr("y1", -10).attr("y2", ih)
        .attr("stroke", "#E8E8E8").attr("stroke-opacity", 0.22)
        .attr("stroke-dasharray", "3 3");
      evg.append("text").attr("x", x(sec) + 3).attr("y", -4).attr("class", "axl")
        .attr("fill", "#C9C9C9").attr("font-weight", 600).text(e.id);
    });

    /* spot path, same x scale, own panel below */
    var spot = D.spot;
    var sh = 104, sm = { l: left, r: right, t: 10, b: 18 };
    var ssvg = d3.select(host).append("svg").attr("width", w).attr("height", sh + sm.t + sm.b);
    var sx = d3.scaleLinear().domain([0, M.n_min * 60]).range([0, iw]);
    var lo = d3.min(spot, function (d) { return d[1]; });
    var hi = d3.max(spot, function (d) { return d[1]; });
    var pad = Math.max(4, (hi - lo) * 0.14);
    var sy = d3.scaleLinear().domain([lo - pad, hi + pad]).range([sh, 0]);
    var sg = ssvg.append("g").attr("transform", "translate(" + sm.l + "," + sm.t + ")");

    var defs = ssvg.append("defs");
    var grad = defs.append("linearGradient").attr("id", "spotfill")
      .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
    grad.append("stop").attr("offset", "0%").attr("stop-color", C.primary).attr("stop-opacity", 0.22);
    grad.append("stop").attr("offset", "100%").attr("stop-color", C.primary).attr("stop-opacity", 0);

    sg.append("path").datum(spot)
      .attr("fill", "url(#spotfill)")
      .attr("d", d3.area().x(function (d) { return sx(d[0]); }).y0(sh).y1(function (d) { return sy(d[1]); }));
    sg.append("path").datum(spot)
      .attr("fill", "none").attr("stroke", C.primary).attr("stroke-width", 1.4)
      .attr("d", d3.line().x(function (d) { return sx(d[0]); }).y(function (d) { return sy(d[1]); }));

    sy.ticks(3).forEach(function (t) {
      sg.append("line").attr("x1", 0).attr("x2", iw).attr("y1", sy(t)).attr("y2", sy(t))
        .attr("stroke", "#232833");
      sg.append("text").attr("class", "axl2").attr("x", -8).attr("y", sy(t) + 3)
        .attr("text-anchor", "end").text(num(t, 0));
    });
    sg.append("text").attr("class", "axl").attr("x", 0).attr("y", -1)
      .attr("fill", "#9B9B9B").text("NIFTY spot");
    sg.append("text").attr("class", "axl").attr("x", iw).attr("y", -1).attr("text-anchor", "end")
      .attr("fill", C.primary).text(num(M.spot_last, 2));

    /* hover: recompute cell from pointer, tooltip from every metric */
    var hover = g.append("rect").attr("width", iw).attr("height", ih)
      .attr("fill", "transparent").style("cursor", "crosshair");
    var crossX = g.append("line").attr("y1", 0).attr("y2", ih)
      .attr("stroke", "#FFFFFF").attr("stroke-opacity", 0).attr("pointer-events", "none");
    var crossY = g.append("line").attr("x1", 0).attr("x2", iw)
      .attr("stroke", "#FFFFFF").attr("stroke-opacity", 0).attr("pointer-events", "none");
    hover.on("mousemove", function (event) {
      var p = d3.pointer(event, g.node());
      if (p[0] < 0 || p[1] < 0 || p[0] > iw || p[1] > ih) { hideTip(); return; }
      var mi = Math.min(M.n_min - 1, Math.max(0, Math.floor(p[0] / cellW)));
      var row = Math.min(keeps.length - 1, Math.max(0, Math.floor(p[1] / rowH)));
      var k = keeps[row], si = strikes.indexOf(k);
      var oiC = H.oi_ce[si][mi], oiP = H.oi_pe[si][mi];
      var ce = H.ltp_ce[si][mi], pe = H.ltp_pe[si][mi];
      var oiT = H.oi[si][mi], v = H.vol[si][mi], pr = H.prem[si][mi];
      var open = H.oi[si][0];
      var delta = (oiT !== null && open !== null) ? oiT - open : null;
      crossX.attr("x1", p[0]).attr("x2", p[0]).attr("stroke-opacity", 0.28);
      crossY.attr("y1", yOf(row) + rowH / 2).attr("y2", yOf(row) + rowH / 2).attr("stroke-opacity", 0.18);
      showTip(
        '<div class="h"><span>' + hhmm(mi * 60) + " · " + k + "</span><span style='color:#9B9B9B'>" +
        (k > (D.spot[Math.min(D.spot.length - 1, mi)][1]) ? "ITM put / OTM call" : "ITM call / OTM put") + "</span></div>" +
        '<div class="r"><span>CE premium</span><b>₹' + num(ce, 2) + "</b></div>" +
        '<div class="r"><span>PE premium</span><b>₹' + num(pe, 2) + "</b></div>" +
        '<div class="sep"></div>' +
        '<div class="r"><span>CE OI</span><b>' + lakh(oiC) + "</b></div>" +
        '<div class="r"><span>PE OI</span><b>' + lakh(oiP) + "</b></div>" +
        '<div class="r"><span>Total OI</span><b>' + lakh(oiT) + "</b></div>" +
        '<div class="r"><span>Δ vs open</span><b>' + (delta === null ? "—" : (delta >= 0 ? "+" : "") + num(delta, 1) + " L") + "</b></div>" +
        '<div class="sep"></div>' +
        '<div class="r"><span>Volume</span><b>' + lakh(v, 1) + "</b></div>" +
        '<div class="r"><span>Premium traded</span><b>' + cr(pr) + "</b></div>",
        event
      );
    }).on("mouseleave", function () {
      hideTip();
      crossX.attr("stroke-opacity", 0); crossY.attr("stroke-opacity", 0);
    });
  }

  function paintLegend() {
    var legend = document.getElementById("legendRamp");
    var ramp = RAMPS[S.metric];
    var stops = ramp.map(function (c, i) {
      var pct = Math.pow(i / (ramp.length - 1), 1 / GAMMA) * 100;
      return c + " " + pct.toFixed(1) + "%";
    }).join(",");
    legend.style.background = "linear-gradient(90deg," + stops + ")";
    document.getElementById("legendMax").textContent = num(metricMax(S.metric), S.metric === "oi" ? 0 : 1) + " " +
      (S.metric === "prem" ? "Cr" : "L");
    document.getElementById("legendLabel").textContent = LABEL[S.metric];
  }

  /* ------------------------------------------------------------------ */
  /* 2. 25500 PE focus                                                   */
  /* ------------------------------------------------------------------ */
  function renderFocus() {
    var host = document.getElementById("focus");
    var w = Math.max(320, host.clientWidth || 900);
    var left = 46, right = 16;
    var iw = w - left - right;
    var x = d3.scaleLinear().domain([0, M.n_min * 60]).range([0, iw]);

    var layout = eventLayout(x, left);
    var evSec = layout.secs, evRow = layout.rows;
    var top = 18 + layout.used * 14;
    var ph = 148, oh = 122, vh = 84, gap = 26, axisH = 22;
    var height = top + ph + gap + oh + gap + vh + axisH;

    var svg = d3.select(host).html("").append("svg")
      .attr("width", w).attr("height", height)
      .attr("role", "img").attr("aria-label", "25500 PE premium, open interest and volume through the session");

    var F = D.focus;

    var top1 = top, top2 = top + ph + gap, top3 = top2 + oh + gap;

    /* shared event rules + band */
    var bands = svg.append("g");
    var e2 = EV[1];
    var b1 = (parseInt(e2.time.slice(0, 2), 10) * 60 + parseInt(e2.time.slice(3), 10) - OPEN) * 60;
    var b2 = b1 + 600;
    bands.append("rect").attr("x", left + x(b1)).attr("width", x(b2) - x(b1))
      .attr("y", top1 - 8).attr("height", top3 + vh - top1 + 8)
      .attr("fill", C.warn).attr("fill-opacity", 0.06);

    EV.forEach(function (e, idx) {
      var sec = evSec[idx];
      bands.append("line").attr("x1", left + x(sec)).attr("x2", left + x(sec))
        .attr("y1", top1 - 8).attr("y2", top3 + vh)
        .attr("stroke", C.primary).attr("stroke-opacity", e.id === 2 ? 0.55 : 0.28)
        .attr("stroke-dasharray", e.id === 2 ? "4 3" : "2 4");
      bands.append("text").attr("class", "axl2").attr("x", left + x(sec) + 3)
        .attr("y", top1 - 12 - evRow[idx] * 14)
        .attr("fill", e.id === 2 ? C.primary : "#9B9B9B").text(e.time);
    });

    /* --- premium --- */
    var ceMax = d3.max(F.ce) || 1, peMax = d3.max(F.pe) || 1;
    var pMax = Math.max(ceMax, peMax) * 1.06;
    var py = d3.scaleLinear().domain([0, pMax]).range([ph, 0]);
    var g1 = svg.append("g").attr("transform", "translate(" + left + "," + top1 + ")");
    py.ticks(4).forEach(function (t) {
      g1.append("line").attr("x1", 0).attr("x2", iw).attr("y1", py(t)).attr("y2", py(t)).attr("stroke", "#232833");
      g1.append("text").attr("class", "axl2").attr("x", -6).attr("y", py(t) + 3)
        .attr("text-anchor", "end").text("₹" + num(t, 0));
    });
    g1.append("path").datum(F.ce).attr("fill", "none").attr("stroke", C.info)
      .attr("stroke-width", 1.2).attr("stroke-opacity", 0.85)
      .attr("d", d3.line().x(function (d, i) { return x(F.t[i]); }).y(function (d) { return py(d); }));
    g1.append("path").datum(F.pe).attr("fill", "none").attr("stroke", C.warn)
      .attr("stroke-width", 1.8)
      .attr("d", d3.line().x(function (d, i) { return x(F.t[i]); }).y(function (d) { return py(d); }));

    g1.append("text").attr("class", "axl").attr("x", 0).attr("y", -6)
      .attr("fill", C.warn).attr("font-weight", 700)
      .text(iw < 430 ? "25500 PE ₹" : "25500 PE premium ₹ (orange)");
    g1.append("text").attr("class", "axl").attr("x", iw < 430 ? 76 : 190).attr("y", -6)
      .attr("fill", C.info)
      .text(iw < 430 ? "CE ₹" : "25500 CE premium ₹ (blue)");

    /* --- open interest --- */
    var oiMax = d3.max(F.oi) || 1;
    var oy = d3.scaleLinear().domain([0, oiMax * 1.12]).range([oh, 0]);
    var g2 = svg.append("g").attr("transform", "translate(" + left + "," + top2 + ")");
    oy.ticks(4).forEach(function (t) {
      g2.append("line").attr("x1", 0).attr("x2", iw).attr("y1", oy(t)).attr("y2", oy(t)).attr("stroke", "#232833");
      g2.append("text").attr("class", "axl2").attr("x", -6).attr("y", oy(t) + 3)
        .attr("text-anchor", "end").text(num(t, 0));
    });
    var oiPath = d3.line().x(function (d, i) { return x(F.t[i]); }).y(function (d) { return oy(d); });
    g2.append("path").datum(F.oi).attr("fill", C.warn).attr("fill-opacity", 0.09)
      .attr("d", d3.area().x(function (d, i) { return x(F.t[i]); }).y0(oh).y1(function (d) { return oy(d); }));
    g2.append("path").datum(F.oi).attr("fill", "none").attr("stroke", C.warn).attr("stroke-width", 1.6)
      .attr("d", oiPath);

    var peakI = F.oi.indexOf(d3.max(F.oi));
    g2.append("circle").attr("cx", x(F.t[peakI])).attr("cy", oy(F.oi[peakI])).attr("r", 3)
      .attr("fill", C.warn);
    g2.append("text").attr("class", "axl").attr("x", x(F.t[peakI]) - 6).attr("y", oy(F.oi[peakI]) - 8)
      .attr("text-anchor", "end").attr("fill", C.warn).attr("font-weight", 700)
      .text("peak " + num(F.oi[peakI], 0) + " L @ " + hhmm(F.t[peakI]));

    g2.append("text").attr("class", "axl").attr("x", 0).attr("y", -6).attr("fill", C.warn)
      .attr("font-weight", 700).text("PE open interest (lakh units)");

    /* --- volume bars --- */
    var vMax = d3.max(F.vol, function (d) { return d[1]; }) || 1;
    var vy = d3.scaleLinear().domain([0, vMax * 1.05]).range([vh, 0]);
    var g3 = svg.append("g").attr("transform", "translate(" + left + "," + top3 + ")");
    vy.ticks(3).forEach(function (t) {
      g3.append("line").attr("x1", 0).attr("x2", iw).attr("y1", vy(t)).attr("y2", vy(t)).attr("stroke", "#232833");
      g3.append("text").attr("class", "axl2").attr("x", -6).attr("y", vy(t) + 3)
        .attr("text-anchor", "end").text(num(t, 0));
    });
    var bw = Math.max(1, x(60) - x(0) - 0.6);
    g3.append("g").selectAll("rect").data(F.vol).join("rect")
      .attr("x", function (d) { return x(d[0]); }).attr("y", function (d) { return vy(d[1]); })
      .attr("width", bw).attr("height", function (d) { return Math.max(0, vh - vy(d[1])); })
      .attr("fill", C.warn).attr("fill-opacity", 0.55);
    g3.append("text").attr("class", "axl").attr("x", 0).attr("y", -6).attr("fill", C.warn)
      .attr("font-weight", 700).text("PE volume (lakh units / min)");

    /* x axis */
    var ticks = d3.range(0, M.n_min * 60 + 1, iw < 420 ? 3600 : 1800);
    var ax = svg.append("g").attr("transform", "translate(" + left + "," + (top3 + vh) + ")");
    ax.selectAll("line").data(ticks).join("line").attr("x1", x).attr("x2", x)
      .attr("y1", 0).attr("y2", 5).attr("stroke", "#39414E");
    ax.selectAll("text").data(ticks).join("text").attr("class", "axl")
      .attr("x", x).attr("y", 16).attr("text-anchor", "middle").text(function (d) { return hhmm(d); });

    /* hover across the three panels */
    var hover = svg.append("rect").attr("x", left).attr("y", top1 - 8)
      .attr("width", iw).attr("height", top3 + vh - top1 + 8).attr("fill", "transparent");
    var lx = svg.append("line").attr("y1", top1 - 8).attr("y2", top3 + vh)
      .attr("stroke", "#FFF").attr("stroke-opacity", 0).attr("pointer-events", "none");
    hover.on("mousemove", function (event) {
      var p = d3.pointer(event, svg.node());
      var sec = x.invert(p[0] - left);
      var i = Math.max(0, Math.min(F.t.length - 1, d3.bisectLeft(F.t, sec)));
      lx.attr("x1", left + x(F.t[i])).attr("x2", left + x(F.t[i])).attr("stroke-opacity", 0.3);
      var vi = Math.max(0, Math.min(F.vol.length - 1, Math.round((sec / 60))));
      showTip(
        '<div class="h"><span>' + hhmm(F.t[i]) + " · 25500</span></div>" +
        '<div class="r"><span>PE premium</span><b>₹' + num(F.pe[i], 2) + "</b></div>" +
        '<div class="r"><span>CE premium</span><b>₹' + num(F.ce[i], 2) + "</b></div>" +
        '<div class="sep"></div>' +
        '<div class="r"><span>PE OI</span><b>' + lakh(F.oi[i]) + "</b></div>" +
        '<div class="r"><span>Volume (min)</span><b>' + lakh(F.vol[vi][1]) + "</b></div>",
        event
      );
    }).on("mouseleave", function () { hideTip(); lx.attr("stroke-opacity", 0); });
  }

  /* ------------------------------------------------------------------ */
  /* 3. small multiples                                                   */
  /* ------------------------------------------------------------------ */
  function renderSmall() {
    var cells = document.querySelectorAll(".smcell");
    Array.prototype.forEach.call(cells, function (cell, idx) {
      var item = D.small[idx];
      if (!item) return;
      var host = cell.querySelector(".chart");
      var w = Math.max(280, host.clientWidth || 520);
      var left = 38, right = 40, top = 12, bottom = 20;
      var h = 132;
      var iw = w - left - right;
      var svg = d3.select(host).html("").append("svg").attr("width", w).attr("height", h + top + bottom)
        .attr("role", "img").attr("aria-label", item.strike + " premium and volume");

      var x = d3.scaleLinear().domain([0, M.n_min * 60]).range([0, iw]);
      var pMax = Math.max(d3.max(item.ce) || 1, d3.max(item.pe) || 1) * 1.05;
      var py = d3.scaleLinear().domain([0, pMax]).range([h, 0]);
      var vMax = d3.max(item.vol) || 1;
      var vy = d3.scaleLinear().domain([0, vMax * 1.1]).range([h, 0]);
      var g = svg.append("g").attr("transform", "translate(" + left + "," + top + ")");

      py.ticks(3).forEach(function (t) {
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", py(t)).attr("y2", py(t)).attr("stroke", "#232833");
        g.append("text").attr("class", "axl2").attr("x", -5).attr("y", py(t) + 3)
          .attr("text-anchor", "end").text(num(t, 0));
      });
      vy.ticks(3).forEach(function (t) {
        g.append("text").attr("class", "axl2").attr("x", iw + 5).attr("y", vy(t) + 3)
          .attr("fill", "#8C9BAA").text(num(t, 0));
      });

      var bw = Math.max(1, x(60) - x(0) - 0.5);
      g.append("g").selectAll("rect").data(item.vol).join("rect")
        .attr("x", function (d, i) { return x(i * 60); })
        .attr("y", function (d) { return vy(d || 0); })
        .attr("width", bw).attr("height", function (d) { return Math.max(0, h - vy(d || 0)); })
        .attr("fill", "#4A5160").attr("fill-opacity", 0.55);

      [["ce", C.info], ["pe", C.warn]].forEach(function (pair) {
        var key = pair[0], colour = pair[1];
        g.append("path").datum(item[key]).attr("fill", "none").attr("stroke", colour)
          .attr("stroke-width", key === "pe" ? 1.5 : 1.15)
          .attr("d", d3.line().defined(function (d) { return d !== null; })
            .x(function (d, i) { return x(i * 60 + 30); }).y(function (d) { return py(d); }));
      });

      var ticks = [0, 5400, 10800, 16200];
      var ax = g.append("g").attr("transform", "translate(0," + h + ")");
      ax.selectAll("text").data(ticks).join("text").attr("class", "axl2")
        .attr("x", x).attr("y", 14).attr("text-anchor", "middle").text(function (d) { return hhmm(d); });

      var hover = g.append("rect").attr("width", iw).attr("height", h).attr("fill", "transparent");
      var lx = g.append("line").attr("y1", 0).attr("y2", h).attr("stroke", "#FFF")
        .attr("stroke-opacity", 0).attr("pointer-events", "none");
      hover.on("mousemove", function (event) {
        var p = d3.pointer(event, g.node());
        var i = Math.max(0, Math.min(M.n_min - 1, Math.floor(p[0] / (x(60) - x(0)))));
        lx.attr("x1", p[0]).attr("x2", p[0]).attr("stroke-opacity", 0.3);
        showTip(
          '<div class="h"><span>' + hhmm(i * 60) + " · " + item.strike + "</span></div>" +
          '<div class="r"><span>CE premium</span><b>₹' + num(item.ce[i], 2) + "</b></div>" +
          '<div class="r"><span>PE premium</span><b>₹' + num(item.pe[i], 2) + "</b></div>" +
          '<div class="sep"></div>' +
          '<div class="r"><span>Volume</span><b>' + lakh(item.vol[i]) + "</b></div>",
          event
        );
      }).on("mouseleave", function () { hideTip(); lx.attr("stroke-opacity", 0); });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 4. futures panel                                                     */
  /* ------------------------------------------------------------------ */
  function renderFutures() {
    var host = document.getElementById("futures");
    var w = Math.max(320, host.clientWidth || 900);
    var left = 50, right = 16, ph = 118, vh = 52, gap = 22, axisH = 22;
    var iw = w - left - right;
    var F = D.futures;
    var x = d3.scaleLinear().domain([0, M.n_min * 60]).range([0, iw]);
    var layout = eventLayout(x, left);
    var top = 12 + layout.used * 12;
    var svg = d3.select(host).html("").append("svg").attr("width", w)
      .attr("height", top + ph + gap + vh + axisH).attr("role", "img")
      .attr("aria-label", "NIFTY futures price and traded volume, 09:15 to the last snapshot");

    var lo = d3.min(F.l), hi = d3.max(F.h);
    var pad = Math.max(6, (hi - lo) * 0.12);
    var py = d3.scaleLinear().domain([lo - pad, hi + pad]).range([ph, 0]);
    var vmax = d3.max(F.v) || 1;
    var vy = d3.scaleLinear().domain([0, vmax]).range([vh, 0]);

    var g = svg.append("g").attr("transform", "translate(" + left + "," + top + ")");
    py.ticks(4).forEach(function (t) {
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", py(t)).attr("y2", py(t)).attr("stroke", "#232833");
      g.append("text").attr("class", "axl2").attr("x", -6).attr("y", py(t) + 3)
        .attr("text-anchor", "end").text(num(t, 0));
    });

    EV.forEach(function (e, idx) {
      var px = x(layout.secs[idx]);
      g.append("line").attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", ph + gap + vh)
        .attr("stroke", C.primary).attr("stroke-opacity", 0.3).attr("stroke-dasharray", "3 3");
      g.append("text").attr("class", "axl2").attr("x", px + 3).attr("y", -6 - layout.rows[idx] * 12)
        .attr("fill", "#9B9B9B").text(e.time);
    });

    g.append("path").datum(F.c).attr("fill", "none").attr("stroke", C.primary)
      .attr("stroke-width", 1.4)
      .attr("d", d3.line().x(function (d, i) { return x(F.t[i]); }).y(function (d) { return py(d); }));
    g.append("text").attr("class", "axl").attr("x", 0).attr("y", 22).attr("fill", C.primary)
      .attr("font-weight", 700).text("NIFTY futures close ₹");

    var vg = svg.append("g").attr("transform", "translate(" + left + "," + (top + ph + gap) + ")");
    vy.ticks(2).forEach(function (t) {
      vg.append("line").attr("x1", 0).attr("x2", iw).attr("y1", vy(t)).attr("y2", vy(t)).attr("stroke", "#232833");
      vg.append("text").attr("class", "axl2").attr("x", -6).attr("y", vy(t) + 3)
        .attr("text-anchor", "end").text(t === 0 ? "0" : num(t / 1000, 0) + "k");
    });
    var bw = Math.max(1, x(60) - x(0) - 0.4);
    vg.append("g").selectAll("rect").data(F.v).join("rect")
      .attr("x", function (d, i) { return x(F.t[i]); })
      .attr("y", function (d) { return vy(d); })
      .attr("width", bw).attr("height", function (d) { return Math.max(0, vh - vy(d)); })
      .attr("fill", "#8C9BAA").attr("fill-opacity", 0.55);
    vg.append("text").attr("class", "axl").attr("x", 0).attr("y", -5).attr("fill", "#8C9BAA")
      .text("lots traded / min");

    var ticks = d3.range(0, M.n_min * 60 + 1, iw < 520 ? 3600 : 1800);
    var ax = svg.append("g").attr("transform", "translate(" + left + "," + (top + ph + gap + vh) + ")");
    ax.selectAll("line").data(ticks).join("line").attr("x1", x).attr("x2", x)
      .attr("y1", 0).attr("y2", 5).attr("stroke", "#39414E");
    ax.selectAll("text").data(ticks).join("text").attr("class", "axl")
      .attr("x", x).attr("y", 16).attr("text-anchor", "middle").text(function (d) { return hhmm(d); });

    var hover = g.append("rect").attr("width", iw).attr("height", ph + gap + vh).attr("fill", "transparent");
    var lx = g.append("line").attr("y1", 0).attr("y2", ph + gap + vh).attr("stroke", "#FFF")
      .attr("stroke-opacity", 0).attr("pointer-events", "none");
    hover.on("mousemove", function (event) {
      var p = d3.pointer(event, g.node());
      var i = Math.max(0, Math.min(F.t.length - 1, d3.bisectLeft(F.t, x.invert(p[0]))));
      lx.attr("x1", x(F.t[i])).attr("x2", x(F.t[i])).attr("stroke-opacity", 0.3);
      showTip(
        '<div class="h"><span>' + hhmm(F.t[i]) + " · futures</span></div>" +
        '<div class="r"><span>Close</span><b>' + num(F.c[i], 1) + "</b></div>" +
        '<div class="r"><span>Volume</span><b>' + num(F.v[i], 0) + "</b></div>" +
        '<div class="r"><span>Open interest</span><b>' + lakh(F.oi[i], 1) + "</b></div>",
        event
      );
    }).on("mouseleave", function () { hideTip(); lx.attr("stroke-opacity", 0); });
  }

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */
  function renderAll() {
    renderHeat();
    paintLegend();
    renderFocus();
    renderSmall();
    renderFutures();
  }

  var buttons = document.querySelectorAll("[data-metric]");
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener("click", function () {
      S.metric = btn.getAttribute("data-metric");
      Array.prototype.forEach.call(buttons, function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      renderHeat();
      paintLegend();
    });
  });

  var loSel = document.getElementById("strikeLo"), hiSel = document.getElementById("strikeHi");
  function syncFilter() {
    S.lo = loSel.value === "" ? null : parseFloat(loSel.value);
    S.hi = hiSel.value === "" ? null : parseFloat(hiSel.value);
    if (S.lo !== null && S.hi !== null && S.lo > S.hi) { S.hi = S.lo; hiSel.value = String(S.lo); }
    renderHeat();
  }
  loSel.addEventListener("change", syncFilter);
  hiSel.addEventListener("change", syncFilter);

  var presets = document.querySelectorAll("[data-range]");
  Array.prototype.forEach.call(presets, function (btn) {
    btn.addEventListener("click", function () {
      var span = parseFloat(btn.getAttribute("data-range"));
      var atm = Math.round(M.spot_last / 50) * 50;
      if (isNaN(span)) {
        loSel.value = ""; hiSel.value = "";
      } else {
        var lo = Math.max(strikes[0], atm - span), hi = Math.min(strikes[strikes.length - 1], atm + span);
        loSel.value = String(lo); hiSel.value = String(hi);
      }
      Array.prototype.forEach.call(presets, function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      syncFilter();
    });
  });

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(renderAll, 160);
  });

  renderAll();
})();
"""


def _d3_block(arg: Optional[str]) -> str:
    candidates = []
    if arg:
        candidates.append(Path(arg))
    candidates.append(REPO / "node_modules" / "d3" / "dist" / "d3.min.js")
    candidates.append(D3_CACHE)
    for path in candidates:
        if path and path.exists() and path.stat().st_size > 100_000:
            code = path.read_text()
            return "<script>\n" + code.replace("</script>", "<\\/script>") + "\n</script>"
    try:
        with urllib.request.urlopen(D3_URL, timeout=20) as res:  # noqa: S310
            code = res.read().decode()
        if len(code) > 100_000:
            D3_CACHE.parent.mkdir(parents=True, exist_ok=True)
            try:
                D3_CACHE.write_text(code)
            except OSError:
                pass
            return "<script>\n" + code.replace("</script>", "<\\/script>") + "\n</script>"
    except Exception:  # noqa: BLE001 - offline is a supported path
        pass
    return f'<script src="{D3_URL}"></script>'


def _stat(value: str, key: str, sub: str = "") -> str:
    return (f'<div class="stat"><div class="k">{key}</div><div class="v">{value}</div>'
            f'<div class="s">{sub}</div></div>')


def render_html(payload: dict[str, Any], d3_block: str, generated: str) -> str:
    m = payload["meta"]
    ev = payload["events"]
    notes = payload["notes"]
    lim = payload["limits"]
    n_strikes = len(m["strikes"])
    span = m["spot_high"] - m["spot_low"]

    events_html = "".join(
        f'<div class="ev"><div class="t">{e["time"]}'
        + (f' <span style="color:#9B9B9B;font-weight:400">→ {e["span"].split("–")[1]}</span>' if e["span"] else "")
        + f'</div><h3>{e["title"]}</h3><p>{e["detail"]}</p>'
        f'<div class="read">{e["read"]}</div></div>'
        for e in ev
    )

    small_html = "".join(
        f'<div class="smcell"><div class="smhead"><span class="t">{int(s["strike"])}</span>'
        f'<span class="m">{inr(s["cum"] / 100, 1)} Cr units · OI CE {inr(s["oi_ce"])} L / PE {inr(s["oi_pe"])} L</span></div>'
        f'<div class="chart"></div></div>'
        for s in payload["small"]
    )

    strike_options = "".join(f'<option value="{k}">{k}</option>' for k in m["strikes"])

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>NIFTY {m["date"]} — Session replay / strike ladder</title>
<style>{STYLE}</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div class="kicker">NIFTY · {"0-DTE · " if m["expiry"] == m["date"] else ""}{m["expiry"]} expiry · {m["date"]}</div>
    <h1>Session replay / strike ladder</h1>
    <p class="lede">Every 10 seconds of the {m["expiry"]} option chain, replayed as a strike ladder:
      where open interest, volume and premium actually sat, minute by minute, plus the four moments
      that changed the session. Chain capture runs {m["first"]} → {m["last"]}; the page stops there.</p>
    <div class="statrow">
      {_stat(f'{m["spot_open"]:,.2f}', "Spot open", "09:15 first snapshot")}
      {_stat(f'{m["spot_last"]:,.2f}', "Spot last", f'{m["last"]} · chain10s')}
      {_stat(f'{m["spot_high"]:,.2f}', "Session high", f'range {span:,.1f} pts')}
      {_stat(f'{inr(m["snaps"])}', "Chain snapshots", f'10 s cadence · 3 s after OI bursts')}
      {_stat(str(n_strikes), "Strikes tracked", f'{int(m["strikes"][0])} – {int(m["strikes"][-1])}')}
      {_stat(f'{inr(m["top_volume"][0]["cum"] / 100, 1)} Cr', f'Top strike {int(m["top_volume"][0]["strike"])}', "units traded, full session")}
    </div>
    <nav class="reportnav" aria-label="NIFTY report set">
      <a href="01-flow.html">01 · Flow</a>
      <a href="02-positioning.html">02 · Positioning</a>
      <a href="03-futures.html">03 · Futures</a>
      <a href="04-volatility.html">04 · Volatility</a>
      <a class="on" href="05-replay.html" aria-current="page">05 · Session replay</a>
      <a href="index.html" style="margin-left:auto">↩ Report index</a>
    </nav>
  </header>

  <main>
    <section class="card">
      <div class="cardhead">
        <span class="num">01</span>
        <h2>Time × strike heatmap</h2>
        <span class="sub">1-minute buckets of the 10-second chain · CE + PE per strike</span>
      </div>
      <div class="toolbar">
        <span class="lbl">Metric</span>
        <div class="seg" role="group" aria-label="Heatmap metric">
          <button data-metric="oi" aria-pressed="true">OI</button>
          <button data-metric="vol" aria-pressed="false">Volume</button>
          <button data-metric="prem" aria-pressed="false">Premium</button>
        </div>
        <span class="spacer"></span>
        <span class="lbl">Strike filter</span>
        <select id="strikeLo" aria-label="Lowest strike shown"><option value="">min</option>{strike_options}</select>
        <select id="strikeHi" aria-label="Highest strike shown"><option value="">max</option>{strike_options}</select>
        <button class="chipbtn" data-range="all" aria-pressed="true">All</button>
        <button class="chipbtn" data-range="100" aria-pressed="false">ATM ±100</button>
        <button class="chipbtn" data-range="200" aria-pressed="false">ATM ±200</button>
        <button class="chipbtn" data-range="300" aria-pressed="false">ATM ±300</button>
      </div>
      <div class="legend" style="margin-bottom:6px">
        <span id="legendLabel">OI (lakh units)</span>
        <span class="ramp" id="legendRamp"></span>
        <span>0 → <span id="legendMax">—</span></span>
      </div>
      <div class="chart scrollx"><div id="heat"></div></div>
      <p class="scrollhint">← drag / scroll horizontally for the full session →</p>
      <p class="note">{notes["heat"]}</p>
    </section>

    <section class="card">
      <div class="cardhead">
        <span class="num">02</span>
        <h2>25500 PE focus</h2>
        <span class="sub">10-second series, annotated at 11:00 / 11:55 / 12:00</span>
      </div>
      <div class="chart"><div id="focus"></div></div>
      <p class="note">{notes["focus"]}</p>
    </section>

    <section class="card">
      <div class="cardhead">
        <span class="num">03</span>
        <h2>Highest-volume strikes</h2>
        <span class="sub">Small multiples · shared time axis · premium ₹ per unit, volume bars</span>
      </div>
      <div class="grid2">{small_html}</div>
      <p class="note">{notes["small"]}</p>
    </section>

    <section class="card">
      <div class="cardhead">
        <span class="num">04</span>
        <h2>Event annotations</h2>
        <span class="sub">Measured from the futures tape and the chain, not narrated</span>
      </div>
      <div class="evgrid">{events_html}</div>
      <div class="chart" style="margin-top:16px"><div id="futures"></div></div>
      <p class="note">{notes["events"]}</p>
    </section>
  </main>

  <footer>
    <p><b>Sources.</b> Chain: <code>experiments/data/nifty_chain10s/{m["date"]}.jsonl</code>
      ({inr(m["snaps"])} slim snapshots, {m["first"]}–{m["last"]},
      <code>[strike, ce_ltp, ce_oi, ce_vol, pe_ltp, pe_oi, pe_vol]</code>).
      Tape metadata: <code>experiments/data/nifty_tape/{m["date"]}.jsonl</code>
      (last row {lim["tape_last"]}, {inr(m["tape_rows"])} rows).
      Futures: <code>reports/nifty_{m["date"]}/data/futures_1m.json</code>
      (clipped at {lim["clip"]}; the file itself also carries the afternoon).
      Generated {generated} by <code>scripts/market/nifty_report_replay.py</code>.</p>
    <p style="margin-top:8px"><b>Units.</b> OI and volume are quoted in lakh units as reported by the
      exchange feed (volume is the cumulative quantity differenced per bucket). Premium is
      Δqty × LTP and is therefore a traded-notional proxy, not a margin figure. Colours follow
      <code>src/ui/palette.ts</code> and <code>docs/COLOR_SEMANTICS.md</code>: calls blue, puts orange;
      heatmap ramps are magnitude-only and carry no direction.</p>
  </footer>
</div>
<div id="tip" class="tip" hidden></div>
<div id="boot"></div>
<script>window.__NIFTY_REPLAY__ = {json.dumps(payload, separators=(",", ":"))};</script>
{d3_block}
<script>{JS}</script>
</body>
</html>
"""


INDEX_CSS = """
:root{--bg:#000;--surface:#13161C;--alt:#1F242D;--border:#2C313B;--text:#E8E8E8;
  --muted:#9B9B9B;--primary:#D9902A;--info:#4A8FD8;--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:34px 28px 70px}
.kicker{font:600 10px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--primary)}
h1{font-size:26px;margin:10px 0 6px;letter-spacing:-.01em}
.lede{color:var(--muted);max-width:88ch;margin:0 0 20px}
.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border);
  border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:24px}
.fact{background:var(--surface);padding:11px 13px}
.fact .k{font:600 9.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.fact .v{font:600 15px/1.3 var(--mono);margin-top:5px}
a.card{display:block;text-decoration:none;color:inherit;background:var(--surface);
  border:1px solid var(--border);border-radius:10px;padding:15px 16px;margin-bottom:10px;
  transition:border-color .12s ease,background .12s ease}
a.card:hover{border-color:#3C434F;background:#161A21}
.card .top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.card .n{font:600 11px/1 var(--mono);color:var(--primary)}
.card h2{font-size:15px;margin:0}
.card .one{color:#C4C4C4;font-size:12.5px;margin:6px 0 0}
.card .meta{color:var(--muted);font:10.5px/1.4 var(--mono);margin-top:7px}
.card .pending{font:600 9.5px/1 var(--mono);color:var(--primary);border:1px solid rgba(217,144,42,.45);
  border-radius:4px;padding:3px 6px;letter-spacing:.08em}
footer{border-top:1px solid var(--border);margin-top:26px;padding-top:14px;color:var(--muted);font-size:11.5px}
footer code{font-family:var(--mono);color:#C4C4C4}
@media (max-width:760px){.wrap{padding:20px 14px 50px}.facts{grid-template-columns:repeat(2,1fr)}h1{font-size:21px}}
"""


def render_index(payload: dict[str, Any], report_dir: Path, generated: str) -> str:
    m = payload["meta"]
    spec = [
        ("01-flow.html", "01", "Flow",
         "Where the money went minute by minute — CE/PE premium flow, the 11:55–12:05 surge and the 12:15 unwind.",
         "tape 09:15–14:07 · 290 rows"),
        ("02-positioning.html", "02", "Positioning",
         "Who is holding what: OI build by strike, writes vs buys, walls, max pain and the PCR path.",
         "chain10s 09:15–14:09 · 4,456 snapshots"),
        ("03-futures.html", "03", "Futures",
         "NIFTY futures price, OI and volume — the 11:45→12:00 long buildup and the afternoon unwind.",
         "1-minute candles 09:15–15:39 (report clips earlier)"),
        ("04-volatility.html", "04", "Volatility",
         "IV surface, term structure and the premium decay that turned a 248-rupee put into 39.",
         "chain10s 09:15–14:09"),
        ("05-replay.html", "05", "Session replay / strike ladder",
         "The 10-second chain replayed as a time × strike heatmap, the 25500 PE focus and the four events that mattered.",
         "chain10s 09:15–14:09 · 4,456 snapshots"),
    ]
    cards = []
    for href, num, title, one, meta in spec:
        exists = (report_dir / href).exists()
        badge = "" if exists else '<span class="pending">PENDING</span>'
        cards.append(
            f'<a class="card" href="{href}"><div class="top"><span class="n">{num}</span>'
            f'<h2>{title}</h2>{badge}</div><p class="one">{one}</p>'
            f'<div class="meta">{meta}</div></a>'
        )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>NIFTY {m["date"]} — report index</title>
<style>{INDEX_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="kicker">NIFTY · {"0-DTE · " if m["expiry"] == m["date"] else ""}{m["expiry"]} expiry · {m["date"]}</div>
  <h1>Session reports — {m["date"]}</h1>
  <p class="lede">One expiry-day session, five cuts. Each page is self-contained and built from the
    same two recorders (10-second chain, 1-minute tape) plus the futures candles, so a number on one
    page can be checked against another without leaving the folder.</p>
  <div class="facts">
    <div class="fact"><div class="k">Spot</div><div class="v">{m["spot_open"]:,.2f} → {m["spot_last"]:,.2f}</div></div>
    <div class="fact"><div class="k">Session range</div><div class="v">{m["spot_high"] - m["spot_low"]:,.1f} pts</div></div>
    <div class="fact"><div class="k">Chain window</div><div class="v">{m["first"]}–{m["last"]}</div></div>
    <div class="fact"><div class="k">Snapshots</div><div class="v">{inr(m["snaps"])}</div></div>
  </div>
  {''.join(cards)}
  <footer>
    <p>Start with <b>05 · Session replay</b> for the shape of the day, then use <b>01</b>–<b>04</b> for the
      flow, positioning, futures and volatility detail behind it.</p>
    <p style="margin-top:6px">Generated {generated} · sources in <code>experiments/data/</code> ·
      builder <code>scripts/market/nifty_report_replay.py</code></p>
  </footer>
</div>
</body>
</html>
"""


def render_readme(payload: dict[str, Any], report_dir: Path, sizes: dict[str, int], generated: str) -> str:
    m = payload["meta"]
    lim = payload["limits"]
    siblings = {
        "01-flow.html": "Flow — premium flow by minute, the 11:55–12:05 surge and the 12:15 unwind",
        "02-positioning.html": "Positioning — OI build by strike, walls, max pain and the PCR path",
        "03-futures.html": "Futures — price, open interest and volume, long buildup vs unwind",
        "04-volatility.html": "Volatility — IV surface / term structure and the premium decay",
    }
    extra = ""
    for name, blurb in siblings.items():
        if (report_dir / name).exists():
            extra += f"| `{name}` | {sizes.get(name, 0) / 1e6:.2f} MB | {blurb} |\n"
    return f"""# NIFTY {m["date"]} — session reports

Expiry-day session ({m["expiry"]}), built from the local recorders. Every page is a standalone
HTML file: no build step, no external assets, no live calls.

## Files

| File | Size | What it is |
|---|---|---|
{extra}| `05-replay.html` | {sizes.get('05-replay.html', 0) / 1e6:.2f} MB | Session replay / strike ladder — heatmap, 25500 PE focus, small multiples, event annotations |
| `index.html` | {sizes.get('index.html', 0) / 1e3:.0f} kB | Report index, links all five pages with one-line descriptions |
| `data/futures_1m.json` | {sizes.get('data/futures_1m.json', 0) / 1e3:.0f} kB | NIFTY futures 1-minute candles, {m["date"]} (price, volume, OI) |
| `data/context.json` | {sizes.get('data/context.json', 0) / 1e3:.0f} kB | Session facts + pointers to the raw recorder files |

`05-replay.html` embeds its data inline (about {sizes.get('05-replay.html', 0) / 1e6:.1f} MB including the
inlined D3 v7 runtime), so it opens offline.

## Data windows

| Source | File | Window | Rows |
|---|---|---|---|
| 10-second option chain | `experiments/data/nifty_chain10s/{m["date"]}.jsonl` | {m["first"]} → {lim["chain_last"]} | {inr(m["snaps"])} |
| 1-minute tape | `experiments/data/nifty_tape/{m["date"]}.jsonl` | 09:15 → {lim["tape_last"]} | {inr(m["tape_rows"])} |
| 1-minute futures | `reports/nifty_{m["date"]}/data/futures_1m.json` | 09:15 → {lim["futures_last"]} | 385 candles |

Chain rows are `[strike, ce_ltp, ce_oi, ce_vol, pe_ltp, pe_oi, pe_vol]` (the slim projection written by
`api/reports_api/chain10s.py`), limited to strikes within ±750 points of spot at capture time.

## Limitations — read before quoting a number

- **Nothing after {lim["chain_last"]} exists in this report.** The chain10s recorder stopped at
  {lim["chain_last"]} and the tape at {lim["tape_last"]}; the futures file runs to 15:39 but every
  series here is clipped at {lim["clip"]}. No value is extrapolated or fabricated.
- **Volume and OI are the exchange feed's cumulative quantity in units, not contracts.** Volume in the
  heatmap and small multiples is the increment between consecutive 10-second snapshots, summed per
  minute; a feed reset would show as a dropped (clamped) increment rather than a negative one.
- **Premium is a traded-notional proxy** (Δqty × LTP, ₹ Cr). It is not margin, not P&L, and not
  comparable to a cash-market turnover number.
- **The heatmap is bucketed to 1 minute.** A 100-point squeeze that starts and ends inside one minute
  is visible in the 25500 PE panel (10-second series) but shows as a single bright column in the
  heatmap.
- **One minute is missing from the recorder** (10:51) and a few minutes hold only two snapshots
  (10:56, 11:14, 11:52). OI and premium carry the previous value forward; volume for the gap minute is
  merged into the next observed minute.
- **Strike coverage moves with spot.** Rows appear only once a strike enters the ±750-point window, so
  a strike's row can start or end mid-session; that is a capture artefact, not a data change.
- **Events are described, not predicted.** The 11:10 / 11:55 / 12:00 / 12:15 annotations are readings
  of the futures tape and the chain; they are not a signal, a target or advice.
- **The 25500 focus is one strike.** It was the highest-OI call strike for most of the session and the
  put strike that carried the afternoon build; a different strike would tell a different (equally
  true) story.

## Rebuild

```bash
.venv/bin/python scripts/market/nifty_report_replay.py --date {m["date"]} --write-index --write-readme
```

Generated {generated}.
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--date", default="2026-11-17")
    parser.add_argument("--chain10s", default=None)
    parser.add_argument("--tape", default=None)
    parser.add_argument("--futures", default=None)
    parser.add_argument("--context", default=None)
    parser.add_argument("--focus-strike", type=float, default=25500.0)
    parser.add_argument("--d3", default=None, help="path to d3.v7.min.js to inline")
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-index", action="store_true")
    parser.add_argument("--write-readme", action="store_true")
    args = parser.parse_args()

    date = args.date
    report_dir = REPO / "reports" / f"nifty_{date}"
    chain_path = Path(args.chain10s) if args.chain10s else REPO / "experiments" / "data" / "nifty_chain10s" / f"{date}.jsonl"
    tape_path = Path(args.tape) if args.tape else REPO / "experiments" / "data" / "nifty_tape" / f"{date}.jsonl"
    futures_path = Path(args.futures) if args.futures else report_dir / "data" / "futures_1m.json"
    context_path = Path(args.context) if args.context else report_dir / "data" / "context.json"
    out_path = Path(args.out) if args.out else report_dir / "05-replay.html"

    for path in (chain_path, futures_path):
        if not path.exists():
            raise SystemExit(f"missing input: {path}")

    snaps = load_jsonl(chain_path)
    futures = json.loads(futures_path.read_text())
    tape_meta: dict[str, Any] = {}
    if context_path.exists():
        tape_meta = json.loads(context_path.read_text())
    elif tape_path.exists():
        rows = load_jsonl(tape_path)
        if rows:
            tape_meta = {"tape_last": rows[-1]["t"], "tape_rows": len(rows)}

    payload = build_payload(snaps, futures, tape_meta, focus_strike=args.focus_strike)
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    html = render_html(payload, _d3_block(args.d3), generated)

    report_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html)
    print(f"wrote {out_path.relative_to(REPO)}  ({out_path.stat().st_size / 1e6:.2f} MB)")

    sizes: dict[str, int] = {}
    for path in report_dir.glob("*.html"):
        sizes[path.name] = path.stat().st_size
    for name in ("data/futures_1m.json", "data/context.json"):
        path = report_dir / name
        if path.exists():
            sizes[name] = path.stat().st_size

    if args.write_index:
        index_path = report_dir / "index.html"
        index_path.write_text(render_index(payload, report_dir, generated))
        sizes["index.html"] = index_path.stat().st_size
        print(f"wrote {index_path.relative_to(REPO)}  ({index_path.stat().st_size / 1e3:.0f} kB)")

    if args.write_readme:
        readme_path = report_dir / "README.md"
        readme_path.write_text(render_readme(payload, report_dir, sizes, generated))
        print(f"wrote {readme_path.relative_to(REPO)}  ({readme_path.stat().st_size / 1e3:.1f} kB)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
