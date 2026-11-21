#!/usr/bin/env python3
"""Build the IRFC 23 Nov 90 CE research page (futures, basis, chain, trade).

Frozen output (own files only):
  reports/irfc_2026-11-09_90ce/research.html
  reports/irfc_2026-11-09_90ce/data_research.json

The trade.html / data.json pair in the same folder is a separate report and is
not touched here.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
OUT = ROOT / "reports" / "irfc_2026-11-09_90ce"
OUT.mkdir(parents=True, exist_ok=True)

FUT_KEY = "NSE_FO|61614"          # IRFC FUT 23 NOV 26, lot 5425
CE_KEY = "NSE_FO|106407"          # IRFC 23 NOV 90 CE
EQ_KEY = "NSE_EQ|INE053F01010"
EXPIRY = date(2026, 11, 23)
TRADE_DATE = "2026-11-09"
QTY = 5425
ENTRY = 0.47
EXIT = 0.72
ENTRY_T = "14:47"
EXIT_T = "15:10"
RISK_FREE = 0.065
IST = timezone(timedelta(hours=5, minutes=30))
TOKEN: str | None = None


def auth() -> dict[str, str]:
    global TOKEN
    if TOKEN is None:
        from api.options import get_upstox_token

        TOKEN = get_upstox_token()
    return {"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}


def candles(key: str, day: str | None = None) -> list[list]:
    if day:
        path = f"/v3/historical-candle/{quote(key, safe='')}/minutes/1/{day}/{day}"
    else:
        path = f"/v3/historical-candle/intraday/{quote(key, safe='')}/minutes/1"
    r = requests.get("https://api.upstox.com" + path, headers=auth(), timeout=25)
    r.raise_for_status()
    body = r.json()
    rows = (body.get("data") or {}).get("candles") or []
    return sorted(rows, key=lambda row: row[0])


def tstamp(iso: str) -> str:
    return iso[11:16]


def series(rows: list[list], fields: list[str]) -> list[list]:
    """fields: c=close, o=open, h=high, l=low, oi, v."""
    out = []
    pick = {"o": 1, "h": 2, "l": 3, "c": 4, "v": 5, "oi": 6}
    for row in rows:
        out.append([tstamp(row[0])] + [row[pick[f]] for f in fields])
    return out


def by_time(rows: list[list]) -> dict[str, list]:
    return {tstamp(row[0]): row for row in rows}


def chain(expiry: str) -> tuple[float, list[dict]]:
    r = requests.get(
        "https://api.upstox.com/v2/option/chain",
        headers=auth(),
        params={"instrument_key": EQ_KEY, "expiry_date": expiry},
        timeout=25,
    )
    r.raise_for_status()
    rows = (r.json().get("data") or [])
    spot = float(rows[0].get("underlying_spot_price") or 0) if rows else 0.0
    out = []
    for row in rows:
        ce = row.get("call_options") or {}
        md = ce.get("market_data") or {}
        g = ce.get("option_greeks") or {}
        out.append(
            {
                "strike": float(row.get("strike_price") or 0),
                "ltp": float(md.get("ltp") or 0),
                "close": float(md.get("close_price") or 0),
                "oi": float(md.get("oi") or 0),
                "prev_oi": float(md.get("prev_oi") or 0),
                "volume": float(md.get("volume") or 0),
                "bid": float(md.get("bid_price") or 0),
                "ask": float(md.get("ask_price") or 0),
                "iv": float(g.get("iv") or 0),
                "delta": float(g.get("delta") or 0),
                "gamma": float(g.get("gamma") or 0),
                "theta": float(g.get("theta") or 0),
            }
        )
    return spot, sorted(out, key=lambda x: x["strike"])


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _bs(S: float, K: float, T: float, r: float, v: float) -> tuple[float, float]:
    if T <= 0 or v <= 0:
        return max(S - K, 0.0), (1.0 if S > K else 0.0)
    d1 = (math.log(S / K) + (r + 0.5 * v * v) * T) / (v * math.sqrt(T))
    d2 = d1 - v * math.sqrt(T)
    return S * _ncdf(d1) - K * math.exp(-r * T) * _ncdf(d2), _ncdf(d1)


def implied(S: float, K: float, T: float, px: float) -> tuple[float, float]:
    lo, hi = 1e-4, 5.0
    for _ in range(160):
        mid = (lo + hi) / 2.0
        if _bs(S, K, T, RISK_FREE, mid)[0] > px:
            hi = mid
        else:
            lo = mid
    v = (lo + hi) / 2.0
    return v, _bs(S, K, T, RISK_FREE, v)[1]


def trading_sessions(start: date, end: date) -> int:
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def main() -> None:
    now = datetime.now(IST)
    f9 = candles(FUT_KEY, TRADE_DATE)
    e9 = candles(EQ_KEY, TRADE_DATE)
    c9 = candles(CE_KEY, TRADE_DATE)
    f18 = candles(FUT_KEY)
    e18 = candles(EQ_KEY)
    c18 = candles(CE_KEY)
    spot_now, chain_rows = chain(EXPIRY.isoformat())

    if not all((f9, e9, c9, f18, e18, c18, chain_rows)):
        raise SystemExit("missing Upstox data — refusing to write a partial report")

    fm9, em9, cm9 = by_time(f9), by_time(e9), by_time(c9)
    for t in (ENTRY_T, EXIT_T):
        if t not in fm9 or t not in em9 or t not in cm9:
            raise SystemExit(f"trade minute {t} missing from the 09 Nov tape")

    entry_fut, entry_spot = fm9[ENTRY_T][4], em9[ENTRY_T][4]
    exit_fut, exit_spot = fm9[EXIT_T][4], em9[EXIT_T][4]
    entry_ce, exit_ce = cm9[ENTRY_T], cm9[EXIT_T]
    if abs(entry_ce[4] - ENTRY) > 0.011 or abs(exit_ce[1] - EXIT) > 0.011:
        raise SystemExit(
            f"trade prints do not match the tape: entry {entry_ce[4]} exit open {exit_ce[1]}"
        )

    # 09 Nov futures / option day stats
    f_close = f9[-1][4]
    f_open = f9[0][1]
    oi9 = [r[6] for r in f9]
    oi_max_row = max(f9, key=lambda r: r[6])
    oi_min_row = min(f9, key=lambda r: r[6])
    ce_high = max(c9, key=lambda r: r[2])
    ce_low = min(c9, key=lambda r: r[3])

    # Basis on minutes where both legs printed. Equity stops at 15:29, futures at 15:39.
    basis9 = [
        [tstamp(r[0]), round(r[4] - em9[tstamp(r[0])][4], 2)]
        for r in f9
        if tstamp(r[0]) in em9
    ]
    basis9_vals = [b for _, b in basis9]
    basis9_entry = round(entry_fut - entry_spot, 2)
    basis9_exit = round(exit_fut - exit_spot, 2)

    # 18 Nov intraday
    f18_last = f18[-1]
    e18_last = e18[-1]
    c18_last = c18[-1]
    oi18 = [r[6] for r in f18]
    basis18 = [
        [tstamp(r[0]), round(r[4] - by_time(e18)[tstamp(r[0])][4], 2)]
        for r in f18
        if tstamp(r[0]) in by_time(e18)
    ]

    now_ce = next((x for x in chain_rows if x["strike"] == 90.0), None)
    if now_ce is None:
        raise SystemExit("90 CE missing from the current chain")

    total_ce_oi = sum(x["oi"] for x in chain_rows)
    ranked = sorted(chain_rows, key=lambda x: x["oi"], reverse=True)
    rank90 = next(i for i, x in enumerate(ranked, 1) if x["strike"] == 90.0)
    next_row = ranked[1] if len(ranked) > 1 else ranked[0]
    next_oi = next_row["oi"]

    dte_cal = (EXPIRY - now.date()).days
    dte_sessions = trading_sessions(now.date(), EXPIRY)
    t_entry = (EXPIRY - date.fromisoformat(TRADE_DATE)).days / 365.0
    iv_entry, delta_entry = implied(entry_spot, 90.0, t_entry, ENTRY)
    iv_exit, delta_exit = implied(exit_spot, 90.0, t_entry, EXIT)
    spot_move = exit_spot - entry_spot
    delta_pnl = delta_entry * spot_move
    residual = (EXIT - ENTRY) - delta_pnl

    gross = QTY * (EXIT - ENTRY)
    entry_value = QTY * ENTRY
    exit_value = QTY * EXIT
    current_value = QTY * now_ce["ltp"]
    pnl_from_entry = current_value - entry_value
    pnl_from_exit = current_value - exit_value

    chain_view = [
        {
            "strike": int(x["strike"]) if x["strike"].is_integer() else x["strike"],
            "ltp": x["ltp"],
            "oi": int(x["oi"]),
            "doi": int(x["oi"] - x["prev_oi"]),
            "volume": int(x["volume"]),
            "iv": x["iv"],
            "delta": x["delta"],
        }
        for x in chain_rows
        if 70 <= x["strike"] <= 100
    ]

    data = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generated_ist": now.isoformat(timespec="seconds"),
        "contract": {
            "symbol": "IRFC",
            "future_key": FUT_KEY,
            "future_name": "IRFC FUT 23 NOV 26",
            "lot": QTY,
            "expiry": EXPIRY.isoformat(),
            "equity_key": EQ_KEY,
            "ce_key": CE_KEY,
            "strike": 90,
        },
        "trade": {
            "entry_time": ENTRY_T,
            "exit_time": EXIT_T,
            "minutes": 23,
            "qty": QTY,
            "entry": ENTRY,
            "exit": EXIT,
            "entry_value": entry_value,
            "exit_value": exit_value,
            "gross_pnl": gross,
            "return_pct": (EXIT / ENTRY - 1.0) * 100.0,
            "entry_spot": entry_spot,
            "exit_spot": exit_spot,
            "entry_fut": entry_fut,
            "exit_fut": exit_fut,
            "entry_basis": basis9_entry,
            "exit_basis": basis9_exit,
            "spot_move": spot_move,
            "spot_move_pct": (exit_spot / entry_spot - 1.0) * 100.0,
            "fut_move_pct": (exit_fut / entry_fut - 1.0) * 100.0,
            "entry_oi": int(entry_ce[6]),
            "exit_oi": int(exit_ce[6]),
            "entry_volume": int(entry_ce[5]),
            "exit_volume": int(exit_ce[5]),
            "exit_high": exit_ce[2],
            "exit_close": exit_ce[4],
            "ce_day_gain": c9[-1][4] - c9[0][4],
            "trade_share_of_day": (EXIT - ENTRY) / (c9[-1][4] - c9[0][4]) * 100.0,
            "strike_distance_at_exit": 90.0 - exit_spot,
        },
        "day09": {
            "fut_open": f_open,
            "fut_close": f_close,
            "fut_high": max(r[2] for r in f9),
            "fut_low": min(r[3] for r in f9),
            "fut_chg_pct": (f_close / f_open - 1.0) * 100.0,
            "fut_volume": int(sum(r[5] for r in f9)),
            "oi_start": int(f9[0][6]),
            "oi_end": int(f9[-1][6]),
            "oi_chg": int(f9[-1][6] - f9[0][6]),
            "oi_chg_pct": (f9[-1][6] / f9[0][6] - 1.0) * 100.0,
            "oi_max": int(max(oi9)),
            "oi_max_t": tstamp(oi_max_row[0]),
            "oi_min": int(min(oi9)),
            "oi_min_t": tstamp(oi_min_row[0]),
            "oi_1500": int(fm9["15:00"][6]),
            "spot_low": min(r[3] for r in e9),
            "spot_high": max(r[2] for r in e9),
            "ce_open": c9[0][4],
            "ce_close": c9[-1][4],
            "ce_high": ce_high[2],
            "ce_high_t": tstamp(ce_high[0]),
            "ce_low": ce_low[3],
            "ce_low_t": tstamp(ce_low[0]),
            "ce_volume": int(sum(r[5] for r in c9)),
        },
        "basis09": {
            "rows": basis9,
            "mean": sum(basis9_vals) / len(basis9_vals),
            "min": min(basis9_vals),
            "max": max(basis9_vals),
            "entry": basis9_entry,
            "exit": basis9_exit,
        },
        "now18": {
            "stamp": now.strftime("%H:%M"),
            "last_bar": tstamp(f18_last[0]),
            "last_ce_bar": tstamp(c18_last[0]),
            "spot": spot_now,
            "fut": f18_last[4],
            "basis": round(f18_last[4] - spot_now, 2),
            "equity_last": e18_last[4],
            "fut_open": f18[0][4],
            "fut_high": max(r[2] for r in f18),
            "fut_low": min(r[3] for r in f18),
            "fut_chg_pct": (f18_last[4] / f18[0][4] - 1.0) * 100.0,
            "spot_open": e18[0][4],
            "spot_chg_pct": (e18_last[4] / e18[0][4] - 1.0) * 100.0,
            "oi_start": int(f18[0][6]),
            "oi_end": int(f18_last[6]),
            "oi_chg": int(f18_last[6] - f18[0][6]),
            "oi_chg_pct": (f18_last[6] / f18[0][6] - 1.0) * 100.0,
            "oi_max": int(max(oi18)),
            "oi_min": int(min(oi18)),
            "ce_open": c18[0][4],
            "ce_last": c18_last[4],
        },
        "quote": {
            **now_ce,
            "spot": spot_now,
            "oi_chg": int(now_ce["oi"] - now_ce["prev_oi"]),
            "oi_chg_pct": (
                (now_ce["oi"] / now_ce["prev_oi"] - 1.0) * 100.0
                if now_ce["prev_oi"]
                else 0.0
            ),
        },
        "model": {
            "iv_entry": iv_entry * 100.0,
            "delta_entry": delta_entry,
            "iv_exit": iv_exit * 100.0,
            "delta_exit": delta_exit,
            "delta_pnl": delta_pnl,
            "residual_pnl": residual,
            "delta_cash": delta_pnl * QTY,
            "residual_cash": residual * QTY,
            "risk_free": RISK_FREE,
        },
        "pnl": {
            "current_value": current_value,
            "from_entry": pnl_from_entry,
            "from_entry_pct": (now_ce["ltp"] / ENTRY - 1.0) * 100.0,
            "from_exit": pnl_from_exit,
            "from_exit_pct": (now_ce["ltp"] / EXIT - 1.0) * 100.0,
            "breakeven": 90.0 + ENTRY,
            "breakeven_now": 90.0 + now_ce["ltp"],
        },
        "expiry": {
            "date": EXPIRY.isoformat(),
            "days_calendar": dte_cal,
            "sessions": dte_sessions,
        },
        "chain": {
            "spot": spot_now,
            "expiry": EXPIRY.isoformat(),
            "rows": chain_view,
            "total_ce_oi": int(total_ce_oi),
            "share90": (now_ce["oi"] / total_ce_oi * 100.0) if total_ce_oi else 0.0,
            "rank90": rank90,
            "next_oi": int(next_oi),
            "next_strike": int(next_row["strike"]),
            "multiple_vs_next": (now_ce["oi"] / next_oi) if next_oi else 0.0,
            "count": len(chain_rows),
        },
        "series": {
            "f9": series(f9, ["c", "oi", "v"]),
            "e9": series(e9, ["c"]),
            "c9": series(c9, ["c", "oi", "v"]),
            "f18": series(f18, ["c", "oi", "v"]),
            "e18": series(e18, ["c"]),
            "c18": series(c18, ["c", "oi", "v"]),
            "basis18": basis18,
        },
        "counts": {
            "f9": len(f9),
            "e9": len(e9),
            "c9": len(c9),
            "f18": len(f18),
            "e18": len(e18),
            "c18": len(c18),
            "chain": len(chain_rows),
        },
    }

    # Hard checks: the page must not silently drift from the tape.
    assert abs(gross - 1356.25) < 1e-6, gross
    assert len(f9) == 385, len(f9)
    assert data["day09"]["oi_start"] == 84044100, data["day09"]["oi_start"]
    assert data["day09"]["oi_end"] == 84000700, data["day09"]["oi_end"]
    assert data["chain"]["rank90"] == 1, data["chain"]["rank90"]
    assert abs(pnl_from_entry - (current_value - entry_value)) < 1e-9

    (OUT / "data_research.json").write_text(
        json.dumps(data, separators=(",", ":")), encoding="utf-8"
    )
    html = HTML.replace("__DATA__", json.dumps(data, separators=(",", ":")))
    (OUT / "research.html").write_text(html, encoding="utf-8")

    print(f"wrote {OUT / 'research.html'} ({len(html.encode('utf-8')):,} bytes)")
    print(
        f"09 Nov bars f/e/ce {len(f9)}/{len(e9)}/{len(c9)}; "
        f"trade {QTY} x {ENTRY}->{EXIT} = {gross:,.2f} ({data['trade']['return_pct']:.2f}%)"
    )
    print(
        f"entry {ENTRY_T} spot {entry_spot:.2f} fut {entry_fut:.2f} ce {entry_ce[4]:.2f}; "
        f"exit {EXIT_T} spot {exit_spot:.2f} fut {exit_fut:.2f} ce {EXIT:.2f}"
    )
    print(
        f"now {now.strftime('%H:%M')} spot {spot_now:.2f} fut {f18_last[4]:.2f} "
        f"ce {now_ce['ltp']:.2f} oi {now_ce['oi']:,.0f} iv {now_ce['iv']:.2f} "
        f"delta {now_ce['delta']:.4f}"
    )
    print(
        f"model entry iv {iv_entry*100:.2f}% delta {delta_entry:.3f}; "
        f"hold {pnl_from_entry:,.2f} ({data['pnl']['from_entry_pct']:.2f}%)"
    )


HTML = r'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>IRFC 90 CE — research · 09 Nov 2026</title>
<script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"></script>
<style>
:root{--bg:#000;--panel:#13161C;--alt:#1F242D;--border:#2C313B;--text:#E9EDF3;--muted:#9AA4B2;--amber:#E0A040;--pos:#3DDC84;--neg:#FF6B6B;--blue:#5B9BE0;--violet:#A78BFA}
*{box-sizing:border-box}
html,body{max-width:100%}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1520px;margin:0 auto;padding:28px 24px 56px}
.kicker{font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.17em;color:var(--amber);text-transform:uppercase}
h1{font-size:clamp(20px,2.2vw,27px);line-height:1.22;margin:10px 0 8px;letter-spacing:-.01em}
h2{font-size:14px;line-height:1.3;margin:0 0 4px;letter-spacing:.01em}
h3{font-size:11px;margin:14px 0 6px;color:var(--amber);font:700 10px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase}
p{margin:0 0 9px}.sub{color:var(--muted);max-width:96ch;margin:0 0 14px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 18px}
.chip{border:1px solid var(--border);background:var(--panel);border-radius:4px;padding:4px 8px;font:600 10px/1.2 ui-monospace,Menlo,monospace;color:#C7D0DC;white-space:nowrap}
.chip b{color:var(--text);font-weight:700}.chip.amber{border-color:#5A4320;color:var(--amber)}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:10px;margin-top:10px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 15px;min-width:0}
.kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:12px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:10px 11px;min-width:0}
.k{font:700 9px/1.2 ui-monospace,Menlo,monospace;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v{font:700 18px/1.2 ui-monospace,Menlo,monospace;margin-top:5px;white-space:nowrap}
.v small{font:500 10px/1 ui-monospace,Menlo,monospace;color:var(--muted);margin-left:3px}
.s{font-size:10px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.span3{grid-column:span 3}.span4{grid-column:span 4}.span5{grid-column:span 5}.span6{grid-column:span 6}.span7{grid-column:span 7}.span8{grid-column:span 8}.span12{grid-column:span 12}
.sec{margin-top:26px}
.sec-head{display:flex;align-items:baseline;gap:9px;border-bottom:1px solid var(--border);padding-bottom:7px;margin-bottom:2px}
.num{font:700 10px/1 ui-monospace,Menlo,monospace;color:var(--bg);background:var(--amber);border-radius:3px;padding:3px 5px}
.sec-head .hint{margin-left:auto;color:var(--muted);font:500 10px/1 ui-monospace,Menlo,monospace}
.chart{width:100%;height:320px;min-width:0}.chart.tall{height:360px}.chart.short{height:270px}.chart.x3d{height:420px}
.note{color:var(--muted);font-size:10.5px;line-height:1.5;margin:7px 0 0}
.tw{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
th,td{padding:6px 7px;border-bottom:1px solid #232832;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{color:var(--muted);font-weight:600;font-size:9px;letter-spacing:.07em;text-transform:uppercase}
tbody tr:last-child td{border-bottom:0}
tr.hot td{background:#2A2113;color:#FFE2B0}
tr.hot td:first-child{border-left:2px solid var(--amber)}
.pos{color:var(--pos)}.neg{color:var(--neg)}.amber{color:var(--amber)}.muted{color:var(--muted)}
.big{font:700 18px/1.2 ui-monospace,Menlo,monospace}
.bullets{margin:6px 0 0;padding-left:16px;color:#CFD6E0;font-size:12px}
.bullets li{margin:5px 0}.bullets li::marker{color:#5C6675}
.bullets b{color:var(--text)}
.callout{border-left:2px solid var(--amber);background:#17140E;padding:9px 12px;border-radius:0 5px 5px 0;color:#DDD4C4;font-size:11.5px;margin:10px 0 0}
.callout.blue{border-left-color:var(--blue);background:#0F141C;color:#C9D6E6}
.callout.red{border-left-color:var(--neg);background:#1A1012;color:#E8CFD0}
.legendline{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 0;font:500 10px/1.2 ui-monospace,Menlo,monospace;color:var(--muted)}
.legendline i{display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:4px}
.statrow{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}
.stat{background:var(--alt);border:1px solid var(--border);border-radius:5px;padding:8px 9px;min-width:0}
.stat .k{font-size:9px}.stat .v{font-size:14px;margin-top:3px}
footer{border-top:1px solid var(--border);margin-top:23px;padding-top:12px;color:var(--muted);font-size:10.5px}
footer code{color:#C7D0DC;background:var(--alt);border:1px solid var(--border);border-radius:3px;padding:1px 4px;font-size:10px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
@media(max-width:1100px){
 .kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
 .span3,.span4,.span5,.span7,.span8{grid-column:span 6}
}
@media(max-width:720px){
 .wrap{padding:18px 12px 40px}
 .grid{gap:8px}
 .card{padding:12px}
 .kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
 .span3,.span4,.span5,.span6,.span7,.span8,.span12{grid-column:span 12}
 .chart{height:280px}.chart.tall{height:300px}.chart.short{height:250px}.chart.x3d{height:340px}
 .v{font-size:16px}
 h1{font-size:20px}
 .sec-head .hint{display:none}
 table{font-size:11px}th,td{padding:5px 6px}
 #irfc-anatomy{font-size:10px}
 #irfc-anatomy th,#irfc-anatomy td{padding:5px 3px}
 .statrow{grid-template-columns:1fr 1fr}
}
</style></head>
<body><div class="wrap">

<div class="kicker">IRFC · NSE F&amp;O · 23 Nov 2026 expiry · research note</div>
<h1>IRFC 90 CE — a 23-minute convexity trade, read against the chain</h1>
<p class="sub">On 09 Nov a 5,425-lot 90 CE went ₹0.47 → ₹0.72 while IRFC rose 1.20 points. Nine days later the same contract is <b id="irfc-sub-ce">—</b>. This page separates what the tape proves from what the chain only suggests.</p>
<div class="meta">
  <span class="chip">frozen <b id="irfc-stamp">—</b> IST</span>
  <span class="chip">spot <b id="irfc-chip-spot">—</b></span>
  <span class="chip">futures <b id="irfc-chip-fut">—</b></span>
  <span class="chip">basis <b id="irfc-chip-basis">—</b></span>
  <span class="chip amber">90 CE <b id="irfc-chip-ce">—</b></span>
  <span class="chip">expiry <b>23 Nov 2026</b></span>
</div>

<div class="kpis" id="irfc-kpis"></div>

<!-- 1 -->
<div class="sec">
  <div class="sec-head"><span class="num">01</span><h2>Overview — what was traded, and what it is worth now</h2><span class="hint">all prices ₹ · gross of costs</span></div>
  <div class="grid">
    <div class="card span7">
      <h3>The trade in one paragraph</h3>
      <p>IRFC's 23 Nov <b>90 CE</b> was bought at <b>14:47</b> on 09 Nov for <b>₹0.47</b> and sold 23 minutes later at <b>₹0.72</b> — <b class="pos">+53.2%</b>, <b class="pos">₹1,356 gross</b> on 5,425 units. The underlying did less work than the option: spot <b>82.68 → 83.88</b> (+1.20, +1.45%) and the future <b>83.00 → 84.15</b>.</p>
      <p>The contract never held intrinsic value. At exit, spot was <b>6.12 points below the strike</b>; the entire ₹0.72 was time value. The gain was convexity plus a late-session demand bid — not a move through ₹90.</p>
      <p>Nine days later, with <b>5 calendar days / 3 sessions</b> left, the same contract prints <b id="irfc-now-ce">—</b>. Holding from entry would now be <b class="neg" id="irfc-overview-hold">—</b>; holding instead of exiting would have given back <b class="neg" id="irfc-overview-giveback">—</b> of realised proceeds.</p>
      <div class="callout">The trade was a convexity bet that paid. The residual position is a decay bet that did not. Those are different decisions and should not be judged by the same P&amp;L.</div>
    </div>
    <div class="card span5">
      <h3>Snapshot — entry, exit, now</h3>
      <div class="tw"><table id="irfc-snapshot"></table></div>
      <p class="note">Basis = future − spot. The “now” pair uses the futures last completed bar and the chain’s underlying spot, which can be a minute apart. The 09 Nov series uses same-minute prints only.</p>
      <div class="statrow" id="irfc-overview-stats"></div>
    </div>
  </div>
</div>

<!-- 2 -->
<div class="sec">
  <div class="sec-head"><span class="num">02</span><h2>Futures &amp; basis — the last leg was covering, not new length</h2><span class="hint">09 Nov 1m · 18 Nov intraday</span></div>
  <div class="grid">
    <div class="card span12">
      <h3>09 Nov — futures close vs open interest (dual axis)</h3>
      <div id="irfc-fut9" class="chart tall"></div>
      <p class="note">Futures <b id="irfc-fut9-line">—</b>. Open interest <b id="irfc-oi9-line">—</b>. OI built into the afternoon (peak <b id="irfc-oimax">—</b> at <b id="irfc-oimaxt">—</b>), then fell from <b id="irfc-oi1500">—</b> at 15:00 to <b id="irfc-oiend">—</b> at 15:39 while price kept rising: the close was short covering, not fresh longs. Entry and exit minutes are marked.</p>
    </div>
    <div class="card span6">
      <h3>Basis — future minus spot</h3>
      <div id="irfc-basis9" class="chart"></div>
      <p class="note">Positive basis is normal carry into expiry. The 09 Nov mean was <b id="irfc-basis-mean">—</b>, range <b id="irfc-basis-range">—</b>. Equity prints stop at 15:29 while the future trades to 15:39, so the tail has no basis observation.</p>
    </div>
    <div class="card span6">
      <h3>What the basis says</h3>
      <ul class="bullets">
        <li><b>Entry/exit:</b> basis <b id="irfc-basis-entry">—</b> at 14:47 and <b id="irfc-basis-exit">—</b> at 15:10. The future led spot by roughly a quarter-rupee through the trade.</li>
        <li><b>Convergence:</b> 09 Nov (14 days out) averaged <b id="irfc-basis-mean2">—</b>; 18 Nov (5 days out) averages <b id="irfc-basis18-mean">—</b>. That is carry rolling off, not a directional signal.</li>
        <li><b>No stress marker:</b> the basis never went persistently negative and never blew out. A squeeze would have shown futures at a large premium or a violent flip; neither happened.</li>
        <li><b>Clock caveat:</b> basis is only computed on minutes where both legs printed. It is an intraday proxy, not a cost-of-carry model.</li>
      </ul>
      <div class="statrow" id="irfc-basis-stats"></div>
    </div>
    <div class="card span6">
      <h3>18 Nov — current futures path</h3>
      <div id="irfc-fut18" class="chart"></div>
      <p class="note">Close and OI on the left/right axes; spot is the dotted line. The session so far: futures <b id="irfc-f18-chg">—</b>, OI <b id="irfc-f18-oi">—</b>.</p>
    </div>
    <div class="card span6">
      <h3>Interpretation — price down, OI down</h3>
      <p>Futures fell from <b id="irfc-f18-open">—</b> to <b id="irfc-f18-last">—</b> while open interest dropped from <b id="irfc-f18-oistart">—</b> to <b id="irfc-f18-oiend">—</b> (<b id="irfc-f18-oichg">—</b>).</p>
      <p>Price down with OI down is <b>long liquidation</b>: existing longs are leaving, not new shorts being added. If fresh shorts were driving it, OI would rise with price falling. This matters for the 90 CE because a covering-led decline is usually less persistent than a new-short trend.</p>
      <p>The options chain tells a different story: 90 CE OI is still <b id="irfc-quote-oi">—</b>, the largest call position in the expiry (rank <b id="irfc-rank">—</b>). Futures length is leaving; the far-OTM call wall is not.</p>
      <div class="callout blue">Inference from price + OI, not participant data. NSE does not publish client-level long/short in the Upstox feed used here.</div>
    </div>
  </div>
</div>

<!-- 3 -->
<div class="sec">
  <div class="sec-head"><span class="num">03</span><h2>Option chain — one strike holds a quarter of the call OI</h2><span class="hint">23 Nov expiry · chain snapshot <span id="irfc-chain-stamp">—</span> IST</span></div>
  <div class="grid">
    <div class="card span7">
      <h3>Strikes 70–100 — premium bars, OI line</h3>
      <div id="irfc-chain" class="chart tall"></div>
      <p class="note">LTP on the left axis, call OI on the right. 90 CE is highlighted. Illiquid strikes can print stale or zero LTP — the table keeps them so the gaps are visible instead of hidden.</p>
    </div>
    <div class="card span5">
      <h3>90 CE in the chain</h3>
      <div class="statrow" id="irfc-chain-stats"></div>
      <ul class="bullets">
        <li><b>Largest call:</b> 90 CE holds <b id="irfc-share">—</b> of all call OI in this expiry, <b id="irfc-multiple">—</b> the second-largest strike (<b id="irfc-next-strike">—</b> CE).</li>
        <li><b>Still being added:</b> OI is <b id="irfc-doi">—</b> versus the prior session even as premium decays. It was <b id="irfc-oi-then">—</b> at the 09 Nov exit and is <b id="irfc-oi-now">—</b> now (<b id="irfc-oi-since">—</b>) with spot <b id="irfc-spot-drop">—</b> lower. The wall grew as the strike went further out of the money — consistent with writers, not hedging demand.</li>
        <li><b>Priced as a lottery ticket:</b> ₹<b id="irfc-ltp-chain">—</b> with spot at <b id="irfc-spot-chain">—</b> is <b id="irfc-dist-chain">—</b> (<b id="irfc-dist-chain-pct">—</b>) out of the money and <b id="irfc-dte-chain">—</b> days from expiry. The chain’s IV is <b id="irfc-iv">—</b>, delta <b id="irfc-delta">—</b>.</li>
      </ul>
      <p class="note">A large OI strike is a positioning fact, not a forecast. It can act as a magnet, a wall, or simply a hedge leg — the chain alone cannot distinguish them.</p>
    </div>
    <div class="card span7">
      <h3>90 CE premium — 09 Nov vs 18 Nov</h3>
      <div id="irfc-prem" class="chart"></div>
      <p class="note">Same contract, same expiry, different day; x-axis is time of day. On 09 Nov the premium opened ₹0.18, printed a ₹0.16 low, then ran to ₹0.76. On 18 Nov it opened ₹0.13 and has bled to <b id="irfc-prem-now">—</b>.</p>
    </div>
    <div class="card span5">
      <h3>Chain snapshot — 23 Nov calls</h3>
      <div class="tw" style="max-height:392px;overflow-y:auto"><table id="irfc-chain-table"></table></div>
      <p class="note">Δ is the chain delta; IV is the vendor’s annualised implied vol. Rows with zero OI and zero LTP are untraded, not cheap. IV above 100% is a vendor artefact on illiquid deep-ITM strikes.</p>
    </div>
  </div>
</div>

<!-- 4 -->
<div class="sec">
  <div class="sec-head"><span class="num">04</span><h2>Trade anatomy — why 23 minutes paid 53%</h2><span class="hint">14:47 → 15:10 · 09 Nov 2026</span></div>
  <div class="grid">
    <div class="card span7">
      <h3>14:35–15:25 — the actual squeeze</h3>
      <div id="irfc-zoom" class="chart"></div>
      <p class="note">Premium on the right, spot on the left; markers are the fills. The premium went ₹0.56 at 15:00 to ₹0.72 at the 15:10 exit (+29%) while spot added 0.80 — that is the convex part.</p>
    </div>
    <div class="card span5">
      <h3>Ticket anatomy</h3>
      <div class="tw"><table id="irfc-anatomy"></table></div>
      <p class="note">Model-implied: entry <b id="irfc-iv-entry">—</b> IV / <b id="irfc-mdl-delta-entry">—</b> Δ; exit <b id="irfc-iv-exit">—</b> / <b id="irfc-mdl-delta-exit">—</b> Δ. Solved from the traded premium at the entry/exit spot, not recorded greeks. Assumes 6.5% carry and 14 calendar days to expiry at entry.</p>
      <div class="statrow" id="irfc-anatomy-stats"></div>
    </div>
    <div class="card span5">
      <h3>Why it worked</h3>
      <ul class="bullets">
        <li><b>Spot did the trigger:</b> +1.20 points (+1.45%) in 23 minutes, with the future confirming (1.15 points).</li>
        <li><b>Convexity did the rest:</b> model delta at entry was only <b id="irfc-delta-entry">—</b>, so delta explains roughly <b id="irfc-delta-cash">—</b> of the <b id="irfc-gross">—</b> gross gain. The residual is gamma, a richer vol mark and demand.</li>
        <li><b>Flow confirmed it:</b> 90 CE volume at the exit minute was <b id="irfc-exit-vol">—</b> versus <b id="irfc-entry-vol">—</b> at entry; OI rose <b id="irfc-oi-step">—</b>.</li>
        <li><b>It stayed OTM:</b> ₹83.88 versus a ₹90 strike. No intrinsic value was ever involved, so the exit had to be driven by price/vol, not by exercise.</li>
        <li><b>Exit discipline:</b> the 15:10 bar printed a ₹0.76 high, then faded to ₹0.61 by 15:30. Selling into the volume spike captured the convex move before decay resumed.</li>
      </ul>
    </div>
    <div class="card span7">
      <h3>P&amp;L decomposition — model, not attribution</h3>
      <div id="irfc-decomp" class="chart short"></div>
      <p class="note">Delta component = model delta × spot move. Residual = actual premium change − delta component. This is a diagnostic, not a trade record: the model cannot separate gamma from IV without historical greeks.</p>
    </div>
    <div class="card span7">
      <h3>The day in three dimensions — time × spot × premium</h3>
      <div id="irfc-3d" class="chart x3d"></div>
      <p class="note">Each vertex is a 1-minute close; the grey drop-lines are guides down to zero premium. The path ends at 15:29, where the equity feed stops.</p>
    </div>
    <div class="card span5">
      <h3>What the 3D adds</h3>
      <div class="statrow" id="irfc-3d-stats"></div>
      <ul class="bullets">
        <li><b>Two causes, one surface:</b> spot is the horizontal driver, premium is the vertical response. The path is nearly flat while spot sits below ~82.5, then bends upward as spot pushes into the 83s.</li>
        <li><b>The last hour is the trade:</b> premium was <b id="irfc-p-1445">—</b> at 14:45 and <b id="irfc-p-exit">—</b> at the exit; the 23-minute trade captured <b id="irfc-share-day">—</b> of the day’s net premium gain. The morning had spot movement with little premium response.</li>
        <li><b>Why not just 2D:</b> a premium chart shows the result; this view separates the underlying move from the repricing. The vertical gap between the path and the floor is time value, and it is the part that decays.</li>
      </ul>
      <p class="note">Spot range <b id="irfc-spotrange">—</b>; premium range <b id="irfc-premrange">—</b>; last premium print <b id="irfc-plast">—</b>.</p>
    </div>
  </div>
</div>

<!-- 5 -->
<div class="sec">
  <div class="sec-head"><span class="num">05</span><h2>Current status — hold, exit, or expiry</h2><span class="hint">chain snapshot <span id="irfc-now-stamp">—</span> IST</span></div>
  <div class="grid">
    <div class="card span5">
      <h3>Realised vs marked</h3>
      <div class="tw"><table id="irfc-hold"></table></div>
      <div class="callout red">The exit was worth <b id="irfc-exit-value">—</b> in hand. The same position is marked at <b id="irfc-current-value">—</b> — a <b id="irfc-gap">—</b> change versus the exit, before costs.</div>
    </div>
    <div class="card span7">
      <h3>Expiry payoff — long 90 CE from ₹0.47</h3>
      <div id="irfc-payoff" class="chart"></div>
      <p class="note">Intrinsic value at expiry only. Breakeven is <b>₹90.47</b>; the current premium implies a <b id="irfc-be-now">—</b> breakeven from here. The line ignores costs and the possibility of exiting before expiry.</p>
    </div>
    <div class="card span6">
      <h3>Expiry scenarios — 23 Nov</h3>
      <div class="tw"><table id="irfc-scenarios"></table></div>
      <p class="note">P&amp;L is gross, versus the ₹0.47 entry. The “move needed” column is measured from the current spot.</p>
    </div>
    <div class="card span6">
      <h3>Delta and decay caveat</h3>
      <ul class="bullets">
        <li><b>Delta is tiny:</b> <b id="irfc-delta-now">—</b>. A ₹1 spot move is worth about <b id="irfc-delta-rupee">—</b> per unit (<b id="irfc-delta-lot">—</b> per lot) before theta.</li>
        <li><b>Theta dominates:</b> <b id="irfc-theta">—</b> per day per unit (<b id="irfc-theta-lot">—</b> per lot). At a <b id="irfc-prem-c1">—</b> premium, one day of decay is a large share of the mark.</li>
        <li><b>Distance to strike:</b> spot must gain <b id="irfc-distance">—</b> (<b id="irfc-distance-pct">—</b>) just to reach ₹90; the original ₹0.47 entry needs a further ₹0.47 (breakeven ₹90.47).</li>
        <li><b>Liquidity:</b> bid/ask is <b id="irfc-spread">—</b>. A wide spread can consume a large fraction of a <b id="irfc-prem-c2">—</b> premium on exit.</li>
        <li><b>Vol is not a floor:</b> IV can fall further. A higher IV helps the mark, but with 5 days left, theta usually wins the race.</li>
      </ul>
    </div>
  </div>
</div>

<!-- 6 -->
<div class="sec">
  <div class="sec-head"><span class="num">06</span><h2>Data, windows, and what this cannot tell you</h2><span class="hint">reproducible, frozen</span></div>
  <div class="grid">
    <div class="card span7">
      <h3>Sources &amp; windows</h3>
      <ul class="bullets">
        <li><b>09 Nov futures:</b> Upstox V3 1-minute candles, <code>NSE_FO|61614</code> — <b id="irfc-c-f9">—</b> bars, 09:15–15:39.</li>
        <li><b>09 Nov spot:</b> <code>NSE_EQ|INE053F01010</code> — <b id="irfc-c-e9">—</b> bars, 09:15–15:29 (the equity feed stops earlier than the future).</li>
        <li><b>09 Nov 90 CE:</b> <code>NSE_FO|106407</code> — <b id="irfc-c-c9">—</b> bars. Entry/exit are the 14:47 close and the 15:10 open, matching ₹0.47/₹0.72.</li>
        <li><b>18 Nov:</b> intraday 1-minute futures/spot/CE through <b id="irfc-c-last">—</b>, plus one option-chain snapshot for the 23 Nov expiry.</li>
        <li><b>Continuity:</b> <code>61614</code> is the current IRFC future (23 Nov expiry, lot 5,425). Rolls would break the series; none occurred inside this window.</li>
      </ul>
      <div class="callout blue">Reproduce: <code>.venv/bin/python scripts/market/irfc_90ce_research.py</code>. The script re-fetches, re-checks the 385-bar count and the two fills, then rewrites both files.</div>
    </div>
    <div class="card span5">
      <h3>Limitations — read before quoting</h3>
      <ul class="bullets">
        <li><b>No historical option-chain snapshots.</b> There are no recorded IV/delta/OI snapshots for 09 Nov beyond the candle OI. Entry/exit greeks are model-implied.</li>
        <li><b>The current chain is one snapshot, not a time series.</b> It cannot show whether the 90 CE OI wall was built today or earlier.</li>
        <li><b>Clocks differ.</b> Futures and the chain are near-real-time; equity 1-minute data ends at 15:29. Basis after that is unobserved.</li>
        <li><b>No participant identity.</b> “Covering”, “writers”, “demand” are price/OI inferences. NSE participant-wise OI is not in this feed.</li>
        <li><b>Costs are excluded.</b> ₹1,356 is gross; brokerage, STT, exchange charges, GST and slippage reduce it. The 0.47/0.72 prints are taken as fills.</li>
        <li><b>Model assumptions:</b> Black–Scholes, 6.5% carry, no dividend, 14 days at entry. Real IV/delta can differ, especially for a deep-OTM strike.</li>
      </ul>
    </div>
  </div>
</div>

<footer>
  <p><b>IRFC 90 CE research</b> · 23 Nov 2026 expiry · generated <span id="irfc-foot-stamp">—</span> IST. Prices in ₹. Gross P&amp;L before costs. Not investment advice; a frozen research artifact, not a live feed.</p>
  <p>Files: <code>reports/irfc_2026-11-09_90ce/research.html</code> · <code>data_research.json</code> · generator <code>scripts/market/irfc_90ce_research.py</code>.</p>
</footer>
</div>

<script>
const D=__DATA__;
const $=id=>document.getElementById(id);
const nf=(v,d=2)=>Number(v).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
const clean=v=>Math.abs(Number(v))<1e-9?0:Number(v);
const sgn=v=>clean(v)<0?'−':'';
const sg=(v,d=2)=>(clean(v)>=0?'+':'−')+nf(Math.abs(clean(v)),d);
const pc=(v,d=2)=>(clean(v)>=0?'+':'−')+Math.abs(clean(v)).toFixed(d)+'%';
const cr=v=>sgn(v)+'₹'+nf(Math.abs(Math.round(clean(v))),0);
const M=v=>nf(v/1e6,2)+'M';
const ms=v=>Number(v).toFixed(2)+'M';
const P={bg:'#000',panel:'#13161C',alt:'#1F242D',grid:'#232A34',axis:'#3A424F',text:'#E9EDF3',muted:'#9AA4B2',amber:'#E0A040',pos:'#3DDC84',neg:'#FF6B6B',blue:'#5B9BE0',violet:'#A78BFA'};
const FONT='ui-monospace, SFMono-Regular, Menlo, monospace';
const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const hhmm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function timeTicks(n,step=60){const v=[],x=[];for(let m=555;m<=555+n;m+=step){v.push(m);x.push(hhmm(m))}return {tickvals:v,ticktext:x};}
const base=(opts={})=>Object.assign({
  paper_bgcolor:P.panel,plot_bgcolor:P.panel,
  font:{color:P.text,size:10,family:FONT},
  margin:{l:52,r:56,t:8,b:38},
  showlegend:true,legend:{orientation:'h',x:0,y:1.14,font:{size:9,color:P.muted}},
  hovermode:'x unified',hoverlabel:{bgcolor:P.alt,bordercolor:P.axis,font:{size:10,family:FONT}},
  xaxis:{gridcolor:P.grid,zerolinecolor:P.axis,tickfont:{size:9,color:P.muted},linecolor:P.axis},
  yaxis:{gridcolor:P.grid,zerolinecolor:P.axis,tickfont:{size:9,color:P.muted},linecolor:P.axis},
},opts);
const cfg={displayModeBar:false,responsive:true};
const axisTitle=t=>({text:t,font:{size:9,color:P.muted}});
const y2=(t)=>({overlaying:'y',side:'right',gridcolor:'transparent',zerolinecolor:P.axis,tickfont:{size:9,color:P.muted},linecolor:P.axis,title:axisTitle(t)});
const line=(x,y,name,color,extra={})=>Object.assign({x,y,type:'scatter',mode:'lines',name,line:{color,width:1.6},hovertemplate:name+': %{y:,.2f}<extra></extra>'},extra);
const mark=(x,y,name,color,symbol,size=10)=>[{x,y,type:'scatter',mode:'markers+text',text:name?[name]:[],textposition:'top center',textfont:{size:9,color},marker:{color,size,symbol,line:{color:P.panel,width:1}},name,showlegend:false,hovertemplate:name+': %{y:,.2f}<extra></extra>'}];

// header + kpis
$('irfc-stamp').textContent=D.generated_ist.slice(11,16);
$('irfc-chip-spot').textContent='₹'+nf(D.now18.spot);
$('irfc-chip-fut').textContent='₹'+nf(D.now18.fut);
$('irfc-chip-basis').textContent=sg(D.now18.basis);
$('irfc-chip-ce').textContent='₹'+nf(D.quote.ltp);
$('irfc-sub-ce').textContent='₹'+nf(D.quote.ltp);
$('irfc-now-ce').textContent='₹'+nf(D.quote.ltp);
$('irfc-overview-hold').textContent=cr(D.pnl.from_entry)+' ('+pc(D.pnl.from_entry_pct,1)+')';
$('irfc-overview-giveback').textContent=cr(Math.abs(D.pnl.from_exit));
$('irfc-prem-now').textContent='₹'+nf(D.quote.ltp);
$('irfc-be-now').textContent='₹'+nf(D.pnl.breakeven_now);
$('irfc-prem-c1').textContent='₹'+nf(D.quote.ltp);
$('irfc-prem-c2').textContent='₹'+nf(D.quote.ltp);
$('irfc-chain-stamp').textContent=D.now18.stamp;
$('irfc-now-stamp').textContent=D.now18.stamp;
$('irfc-foot-stamp').textContent=D.generated_ist.replace('T',' ').slice(0,16);

const kpi=(k,v,s,cls='')=>`<div class="kpi"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`;
$('irfc-kpis').innerHTML=[
 kpi('Spot','₹'+nf(D.now18.spot),'chain snapshot '.concat(D.now18.stamp),''),
 kpi('Future','₹'+nf(D.now18.fut),'basis '.concat(sg(D.now18.basis)),''),
 kpi('90 CE now','₹'+nf(D.quote.ltp),'Δ '.concat(D.quote.delta.toFixed(3),' · IV ',D.quote.iv.toFixed(1)),'neg'),
 kpi('Trade gross','₹'+nf(D.trade.gross_pnl,0),pc(D.trade.return_pct)+' · 23 min','pos'),
 kpi('If held',cr(D.pnl.from_entry),pc(D.pnl.from_entry_pct),'neg'),
 kpi('To expiry',D.expiry.days_calendar+'d',D.expiry.sessions+' sessions left','amber'),
].join('');

// 1 snapshot
const snap=[
 ['Spot',D.trade.entry_spot,D.trade.exit_spot,D.now18.spot],
 ['Future',D.trade.entry_fut,D.trade.exit_fut,D.now18.fut],
 ['Basis',D.trade.entry_basis,D.trade.exit_basis,D.now18.basis],
 ['90 CE',D.trade.entry,D.trade.exit,D.quote.ltp],
];
$('irfc-snapshot').innerHTML='<thead><tr><th>09 Nov</th><th>14:47</th><th>15:10</th><th>now</th></tr></thead><tbody>'+
 snap.map(([k,a,b,c])=>{const f=v=>k==='90 CE'?'₹'+nf(v,2):sg(v,2);return `<tr><td>${k}</td><td>${f(a)}</td><td>${f(b)}</td><td>${f(c)}</td></tr>`}).join('')+
 '</tbody>';
$('irfc-overview-stats').innerHTML=[
 ['Expiry',D.expiry.date+' · '+D.expiry.sessions+' sessions'],
 ['Contract','90 CE · lot 5,425'],
 ['Trade range','₹0.47 → ₹0.72'],
 ['Current mark','₹'+nf(D.quote.ltp)+' · OI '+M(D.quote.oi)],
].map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

// 2 futures 09
const f9=D.series.f9.map(r=>({t:r[0],c:r[1],oi:r[2],v:r[3]})), e9=D.series.e9;
const e9map=new Map(e9.map(r=>[r[0],r[1]]));
const x9=f9.map(r=>mins(r.t));
const entryX=mins(D.trade.entry_time), exitX=mins(D.trade.exit_time);
$('irfc-fut9-line').textContent='opened ₹'+nf(D.day09.fut_open)+' → closed ₹'+nf(D.day09.fut_close)+' ('+pc(D.day09.fut_chg_pct)+')';
$('irfc-oi9-line').textContent='ended '+M(D.day09.oi_start)+' → '+M(D.day09.oi_end)+' ('+pc(D.day09.oi_chg_pct)+') versus the open';
$('irfc-oi1500').textContent=M(D.day09.oi_1500);
$('irfc-oiend').textContent=M(D.day09.oi_end);
$('irfc-oimax').textContent=M(D.day09.oi_max);
$('irfc-oimaxt').textContent=D.day09.oi_max_t;
Plotly.newPlot('irfc-fut9',[
 line(x9,f9.map(r=>r.c),'future close',P.blue),
 line(x9,f9.map(r=>e9map.get(r.t)??null),'spot',P.muted,{line:{color:P.muted,width:1,dash:'dot'},hovertemplate:'spot: %{y:,.2f}<extra></extra>'}),
 Object.assign(line(x9,f9.map(r=>r.oi/1e6),'OI (M)',P.amber),{yaxis:'y2',line:{color:P.amber,width:1.4,dash:'dot'},hovertemplate:'OI: %{y:.2f}M<extra></extra>'}),
],base({xaxis:Object.assign({},base().xaxis,timeTicks(385,60)),yaxis:Object.assign({},base().yaxis,{title:axisTitle('₹')}),yaxis2:y2('OI (M)'),
 shapes:[{type:'line',x0:entryX,x1:entryX,y0:0,y1:1,yref:'paper',line:{color:P.pos,width:1,dash:'dash'}},{type:'line',x0:exitX,x1:exitX,y0:0,y1:1,yref:'paper',line:{color:P.amber,width:1,dash:'dash'}}],
 annotations:[{x:entryX,y:1,yref:'paper',text:'entry',showarrow:false,font:{size:9,color:P.pos},yshift:4},{x:exitX,y:1,yref:'paper',text:'exit',showarrow:false,font:{size:9,color:P.amber},yshift:4}]}),cfg);

// basis
const b9=D.basis09.rows.map(r=>[mins(r[0]),r[1]]);
$('irfc-basis-mean').textContent=sg(D.basis09.mean)+' pts';
$('irfc-basis-range').textContent=sg(D.basis09.min)+' to '+sg(D.basis09.max);
$('irfc-basis-entry').textContent=sg(D.basis09.entry);
$('irfc-basis-exit').textContent=sg(D.basis09.exit);
$('irfc-basis-mean2').textContent=sg(D.basis09.mean);
const b18=D.series.basis18.map(r=>[mins(r[0]),r[1]]);
$('irfc-basis18-mean').textContent=sg(b18.reduce((a,b)=>a+b[1],0)/(b18.length||1));
$('irfc-basis-stats').innerHTML=[
 ['09 Nov mean',sg(D.basis09.mean)+' pts'],
 ['09 Nov range',sg(D.basis09.min)+' / '+sg(D.basis09.max)],
 ['18 Nov mean',sg(b18.reduce((a,b)=>a+b[1],0)/(b18.length||1))],
 ['Observations',D.basis09.rows.length+' min'],
].map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
Plotly.newPlot('irfc-basis9',[
 line(b9.map(r=>r[0]),b9.map(r=>r[1]),'basis 09 Nov',P.blue),
 line(b18.map(r=>r[0]),b18.map(r=>r[1]),'basis 18 Nov',P.violet,{line:{color:P.violet,width:1.3,dash:'dot'}}),
],base({xaxis:Object.assign({},base().xaxis,timeTicks(385,90)),yaxis:Object.assign({},base().yaxis,{title:axisTitle('future − spot (₹)'),zeroline:true,zerolinecolor:P.axis}),
 shapes:[{type:'line',x0:555,x1:945,y0:0,y1:0,line:{color:P.axis,width:1}}]}),cfg);

// 18 Nov futures
const f18=D.series.f18.map(r=>({t:r[0],c:r[1],oi:r[2]})), e18map=new Map(D.series.e18.map(r=>[r[0],r[1]]));
const x18=f18.map(r=>mins(r.t));
$('irfc-f18-chg').textContent=pc(D.now18.fut_chg_pct);
$('irfc-f18-oi').textContent=pc(D.now18.oi_chg_pct)+' ('+M(D.now18.oi_chg)+')';
$('irfc-f18-open').textContent='₹'+nf(D.now18.fut_open);
$('irfc-f18-last').textContent='₹'+nf(D.now18.fut);
$('irfc-f18-oistart').textContent=M(D.now18.oi_start);
$('irfc-f18-oiend').textContent=M(D.now18.oi_end);
$('irfc-f18-oichg').textContent=M(D.now18.oi_chg)+' / '+pc(D.now18.oi_chg_pct);
Plotly.newPlot('irfc-fut18',[
 line(x18,f18.map(r=>r.c),'future',P.blue),
 line(x18,f18.map(r=>e18map.get(r.t)??null),'spot',P.muted,{line:{color:P.muted,width:1,dash:'dot'},hovertemplate:'spot: %{y:,.2f}<extra></extra>'}),
 Object.assign(line(x18,f18.map(r=>r.oi/1e6),'OI (M)',P.amber),{yaxis:'y2',line:{color:P.amber,width:1.3,dash:'dot'},hovertemplate:'OI: %{y:.2f}M<extra></extra>'}),
],base({xaxis:Object.assign({},base().xaxis,timeTicks(f18.length,30)),yaxis:Object.assign({},base().yaxis,{title:axisTitle('₹')}),yaxis2:y2('OI (M)')}),cfg);

// 3 chain
$('irfc-quote-oi').textContent=M(D.quote.oi);
$('irfc-rank').textContent='#'+D.chain.rank90;
$('irfc-share').textContent=nf(D.chain.share90,1)+'%';
$('irfc-multiple').textContent=nf(D.chain.multiple_vs_next,1)+'×';
$('irfc-next-strike').textContent=D.chain.next_strike;
$('irfc-doi').textContent=sg(D.quote.oi_chg/1e6,2)+'M ('+pc(D.quote.oi_chg_pct,1)+')';
$('irfc-oi-then').textContent=M(D.trade.exit_oi);
$('irfc-oi-now').textContent=M(D.quote.oi);
$('irfc-oi-since').textContent=sg((D.quote.oi-D.trade.exit_oi)/1e6,2)+'M';
$('irfc-spot-drop').textContent=nf(D.trade.exit_spot-D.chain.spot,2)+' pts';
$('irfc-spot-chain').textContent='₹'+nf(D.chain.spot);
$('irfc-iv').textContent=nf(D.quote.iv,1)+'%';
$('irfc-delta').textContent=D.quote.delta.toFixed(3);
$('irfc-ltp-chain').textContent=nf(D.quote.ltp);
$('irfc-dte-chain').textContent=D.expiry.days_calendar;
$('irfc-dist-chain').textContent=nf(90-D.chain.spot,2)+' points';
$('irfc-dist-chain-pct').textContent=pc((90/D.chain.spot-1)*100,1);
const ch=D.chain.rows;
$('irfc-chain-stats').innerHTML=[
 ['LTP','₹'+nf(D.quote.ltp)],
 ['OI',M(D.quote.oi)],
 ['Volume',M(D.quote.volume)],
 ['IV / Δ',nf(D.quote.iv,1)+'% / '+D.quote.delta.toFixed(3)],
].map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
const hot=ch.map(r=>r.strike===90?P.amber:(r.ltp>0?P.blue:'#3A424F'));
Plotly.newPlot('irfc-chain',[
 {x:ch.map(r=>r.strike),y:ch.map(r=>r.ltp),type:'bar',name:'LTP (₹)',marker:{color:hot},hovertemplate:'%{x} CE: ₹%{y:.2f}<extra></extra>'},
 Object.assign(line(ch.map(r=>r.strike),ch.map(r=>r.oi/1e6),'OI (M)',P.muted),{yaxis:'y2',mode:'lines+markers',line:{color:P.muted,width:1,dash:'dot'},marker:{size:3},hovertemplate:'%{x} OI: %{y:.2f}M<extra></extra>'}),
 {x:[90],y:[D.quote.ltp],type:'scatter',mode:'markers+text',text:['90 CE'],textposition:'top center',textfont:{size:9,color:P.amber},marker:{color:P.amber,size:11,symbol:'diamond',line:{color:P.panel,width:1}},name:'90 CE',hovertemplate:'90 CE: ₹%{y:.2f}<extra></extra>'},
],base({xaxis:Object.assign({},base().xaxis,{title:axisTitle('strike'),dtick:4,tickfont:{size:9,color:P.muted}}),yaxis:Object.assign({},base().yaxis,{title:axisTitle('LTP (₹)')}),yaxis2:y2('OI (M)'),bargap:0.25}),cfg);

// chain table
$('irfc-chain-table').innerHTML='<thead><tr><th>Strike</th><th>LTP</th><th>OI</th><th>Vol</th><th>IV</th><th>Δ</th></tr></thead><tbody>'+
 ch.map(r=>{const dead=r.oi===0&&r.ltp===0;return `<tr class="${r.strike===90?'hot':''}"><td>${r.strike}</td><td>${r.ltp?nf(r.ltp,2):'—'}</td><td>${r.oi?(r.oi/1e6).toFixed(2):'—'}</td><td>${r.volume?(r.volume/1e6).toFixed(2):'—'}</td><td>${r.iv&&!dead?r.iv.toFixed(0):'—'}</td><td>${r.delta&&!dead?r.delta.toFixed(3):'—'}</td></tr>`}).join('')+
 '</tbody>';

// premium history
const c9=D.series.c9.map(r=>({t:r[0],c:r[1],oi:r[2]})), c18=D.series.c18.map(r=>({t:r[0],c:r[1]}));
$('irfc-prem').textContent='';
Plotly.newPlot('irfc-prem',[
 line(c9.map(r=>mins(r.t)),c9.map(r=>r.c),'09 Nov 90 CE',P.amber),
 line(c18.map(r=>mins(r.t)),c18.map(r=>r.c),'18 Nov 90 CE',P.neg),
 ...mark([entryX,exitX],[D.trade.entry,D.trade.exit],'','',P.pos,'diamond',9),
],base({xaxis:Object.assign({},base().xaxis,timeTicks(385,60)),yaxis:Object.assign({},base().yaxis,{title:axisTitle('premium ₹')})}),cfg);

// 4 zoom + anatomy
const z=c9.filter(r=>mins(r.t)>=mins('14:35')&&mins(r.t)<=mins('15:25'));
const zx=z.map(r=>mins(r.t));
$('irfc-zoom').textContent='';
Plotly.newPlot('irfc-zoom',[
 line(zx,z.map(r=>e9map.get(r.t)??null),'spot',P.blue),
 Object.assign(line(zx,z.map(r=>r.c),'90 CE',P.amber),{yaxis:'y2'}),
 ...mark([entryX],[D.trade.entry],'entry',P.pos,'diamond',10).map(t=>({...t,yaxis:'y2'})),
 ...mark([exitX],[D.trade.exit],'exit',P.amber,'diamond',10).map(t=>({...t,yaxis:'y2'})),
],base({xaxis:Object.assign({},base().xaxis,timeTicks(385,10)),yaxis:Object.assign({},base().yaxis,{title:axisTitle('spot ₹')}),yaxis2:y2('premium ₹')}),cfg);
$('irfc-delta-entry').textContent=D.model.delta_entry.toFixed(3);
$('irfc-iv-entry').textContent=nf(D.model.iv_entry,1)+'%';
$('irfc-mdl-delta-entry').textContent=D.model.delta_entry.toFixed(3);
$('irfc-iv-exit').textContent=nf(D.model.iv_exit,1)+'%';
$('irfc-mdl-delta-exit').textContent=D.model.delta_exit.toFixed(3);
$('irfc-anatomy-stats').innerHTML=[
 ['Elasticity',nf(D.trade.return_pct/D.trade.spot_move_pct,1)+'×'],
 ['OTM at exit',nf(D.trade.strike_distance_at_exit,2)+' pts'],
 ['Hold time','23 min'],
 ['Day capture',nf(D.trade.trade_share_of_day,0)+'%'],
].map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
$('irfc-delta-cash').textContent=cr(D.model.delta_cash);
$('irfc-gross').textContent=cr(D.trade.gross_pnl);
$('irfc-exit-vol').textContent=nf(D.trade.exit_volume,0);
$('irfc-entry-vol').textContent=nf(D.trade.entry_volume,0);
$('irfc-oi-step').textContent=M(D.trade.exit_oi-D.trade.entry_oi)+' ('+pc((D.trade.exit_oi/D.trade.entry_oi-1)*100,1)+')';
const anat=[
 ['Entry 14:47','₹'+nf(D.trade.entry),'₹'+nf(D.trade.entry_spot)+' / '+nf(D.trade.entry_fut),'₹'+nf(D.trade.entry_basis),'₹'+nf(D.trade.entry_value,0)],
 ['Exit 15:10','₹'+nf(D.trade.exit),'₹'+nf(D.trade.exit_spot)+' / '+nf(D.trade.exit_fut),'₹'+nf(D.trade.exit_basis),'₹'+nf(D.trade.exit_value,0)],
 ['Change','+₹0.25','+₹1.20 / +₹1.15','−₹0.05','+₹'+nf(D.trade.gross_pnl,0)],
];
$('irfc-anatomy').innerHTML='<thead><tr><th>Leg</th><th>CE</th><th>spot / fut</th><th>basis</th><th>value</th></tr></thead><tbody>'+
 anat.map((r,i)=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td class="${i===2?'pos':''}">${r[4]}</td></tr>`).join('')+'</tbody>';

Plotly.newPlot('irfc-decomp',[
 {x:['delta','gamma/IV/flow','total'],y:[D.model.delta_pnl,D.model.residual_pnl,D.trade.exit-D.trade.entry],type:'bar',marker:{color:[P.blue,P.violet,P.amber]},text:['₹'+nf(D.model.delta_pnl,2),'₹'+nf(D.model.residual_pnl,2),'₹0.25'],textposition:'outside',textfont:{size:9,color:P.text},hovertemplate:'%{x}: ₹%{y:.3f} per unit<extra></extra>'},
],base({showlegend:false,xaxis:Object.assign({},base().xaxis,{title:axisTitle('premium change per unit')}),yaxis:Object.assign({},base().yaxis,{title:axisTitle('₹ per unit'),range:[0,0.29]})}),cfg);

// 3D
const pts=[];const e9m=new Map(e9.map(r=>[r[0],r[1]]));
c9.forEach(r=>{const s=e9m.get(r.t);if(s)pts.push({x:mins(r.t),y:s,z:r.c,t:r.t})});
const fillPt=t=>{const p=pts.find(p=>p.t===t);return p?{x:[p.x],y:[p.y],z:[p.z]}:{x:[],y:[],z:[]}};
const ep=fillPt(D.trade.entry_time), xp=fillPt(D.trade.exit_time);
const curtain={x:[],y:[],z:[]};
for(let i=0;i<pts.length;i+=8){curtain.x.push(pts[i].x,pts[i].x,null);curtain.y.push(pts[i].y,pts[i].y,null);curtain.z.push(0,pts[i].z,null)}
Plotly.newPlot('irfc-3d',[
 {type:'scatter3d',mode:'lines',x:curtain.x,y:curtain.y,z:curtain.z,line:{color:'#4A5568',width:1},opacity:0.32,hoverinfo:'skip',showlegend:false},
 {type:'scatter3d',mode:'lines',x:pts.map(p=>p.x),y:pts.map(p=>p.y),z:pts.map(p=>p.z),line:{color:P.amber,width:4},name:'90 CE path',hovertemplate:'%{y:.2f} spot<br>₹%{z:.2f}<extra></extra>'},
 {type:'scatter3d',mode:'markers+text',x:ep.x,y:ep.y,z:ep.z,text:['entry'],textposition:'top center',textfont:{size:10,color:P.pos},marker:{color:P.pos,size:5,symbol:'diamond'},name:'entry',hovertemplate:'entry ₹'+D.trade.entry+'<extra></extra>'},
 {type:'scatter3d',mode:'markers+text',x:xp.x,y:xp.y,z:xp.z,text:['exit'],textposition:'top center',textfont:{size:10,color:P.amber},marker:{color:P.amber,size:5,symbol:'diamond'},name:'exit',hovertemplate:'exit ₹'+D.trade.exit+'<extra></extra>'},
],{paper_bgcolor:P.panel,plot_bgcolor:P.panel,font:{color:P.text,size:9,family:FONT},margin:{l:0,r:0,t:0,b:0},showlegend:false,
 scene:{xaxis:{title:'time',tickvals:[555,675,795,915],ticktext:['09:15','11:15','13:15','15:15'],gridcolor:P.grid,zerolinecolor:P.axis,tickfont:{size:8,color:P.muted},titlefont:{size:9,color:P.muted}},
 yaxis:{title:'spot ₹',gridcolor:P.grid,zerolinecolor:P.axis,tickfont:{size:8,color:P.muted},titlefont:{size:9,color:P.muted}},
 zaxis:{title:'premium ₹',gridcolor:P.grid,zerolinecolor:P.axis,tickfont:{size:8,color:P.muted},titlefont:{size:9,color:P.muted}},
 camera:{eye:{x:1.0,y:1.0,z:0.72}},aspectmode:'manual',aspectratio:{x:1.35,y:1,z:0.8}}},cfg);

const p1445=(c9.find(r=>r.t==='14:45')||{}).c;
$('irfc-p-1445').textContent='₹'+nf(p1445);
$('irfc-p-exit').textContent='₹'+nf(D.trade.exit);
$('irfc-share-day').textContent=nf(D.trade.trade_share_of_day,0)+'%';
$('irfc-spotrange').textContent='₹'+nf(D.day09.spot_low)+'–'+nf(D.day09.spot_high);
$('irfc-premrange').textContent='₹'+nf(D.day09.ce_low)+'–'+nf(D.day09.ce_high);
$('irfc-plast').textContent='₹'+nf(pts[pts.length-1].z)+' at '+pts[pts.length-1].t;
$('irfc-3d-stats').innerHTML=[
 ['Spot range','₹'+nf(D.day09.spot_low)+'–'+nf(D.day09.spot_high)],
 ['Premium range','₹'+nf(D.day09.ce_low)+'–'+nf(D.day09.ce_high)],
 ['Path ends',pts[pts.length-1].t],
 ['Trade window','23 min'],
].map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

// 5 hold + payoff + scenarios
$('irfc-exit-value').textContent=cr(D.trade.exit_value);
$('irfc-current-value').textContent=cr(D.pnl.current_value);
$('irfc-gap').textContent=cr(D.pnl.from_exit);
const hold=[
 ['Exit value (₹0.72)',cr(D.trade.exit_value),''],
 ['Current value (₹'+nf(D.quote.ltp)+')',cr(D.pnl.current_value),''],
 ['Realised gross',cr(D.trade.gross_pnl),'pos'],
 ['Held from entry',cr(D.pnl.from_entry)+' ('+pc(D.pnl.from_entry_pct,1)+')','neg'],
 ['Held vs exit',cr(D.pnl.from_exit)+' ('+pc(D.pnl.from_exit_pct,1)+')','neg'],
 ['Breakeven (entry)','₹'+nf(D.pnl.breakeven),''],
 ['Breakeven (now)','₹'+nf(D.pnl.breakeven_now),''],
];
$('irfc-hold').innerHTML='<thead><tr><th>Item</th><th>Value</th></tr></thead><tbody>'+
 hold.map(([k,v,c])=>`<tr><td>${k}</td><td class="${c}">${v}</td></tr>`).join('')+'</tbody>';

const spots=[];for(let s=78;s<=96;s+=1)spots.push(s);
Plotly.newPlot('irfc-payoff',[
 line(spots,spots.map(s=>Math.max(s-90,0)-D.trade.entry),'P&L from ₹0.47',P.amber),
 {x:[78,90],y:[-D.trade.entry,-D.trade.entry],type:'scatter',mode:'lines',line:{color:P.neg,width:1,dash:'dot'},name:'max loss',showlegend:false,hovertemplate:'max loss ₹'+nf(-D.trade.entry)+'<extra></extra>'},
 {x:[D.chain.spot],y:[Math.max(D.chain.spot-90,0)-D.trade.entry],type:'scatter',mode:'markers+text',text:['spot '+nf(D.chain.spot)],textposition:'top center',textfont:{size:9,color:P.blue},marker:{color:P.blue,size:7},name:'spot',hovertemplate:'spot ₹%{x:.2f}<extra></extra>'},
],base({showlegend:false,xaxis:Object.assign({},base().xaxis,{title:axisTitle('spot at expiry ₹')}),yaxis:Object.assign({},base().yaxis,{title:axisTitle('P&L per unit ₹'),zeroline:true,zerolinecolor:P.axis,range:[-1,6.6]}),
 shapes:[{type:'line',x0:78,x1:96,y0:0,y1:0,line:{color:P.axis,width:1}},
         {type:'line',x0:D.pnl.breakeven,x1:D.pnl.breakeven,y0:0,y1:1,yref:'paper',line:{color:P.muted,width:1,dash:'dot'}}],
 annotations:[{x:79.2,y:-D.trade.entry,text:'max loss −₹0.47',showarrow:false,font:{size:9,color:P.neg},xanchor:'left',yshift:-9},
              {x:D.pnl.breakeven,y:1,yref:'paper',text:'BE 90.47',showarrow:false,font:{size:9,color:P.muted},yshift:4}]}),cfg);

const sc=[84,86,88,90,90.47,92,94];
$('irfc-scenarios').innerHTML='<thead><tr><th>Spot</th><th>Intrinsic</th><th>P&amp;L</th><th>Move needed</th></tr></thead><tbody>'+
 sc.map(s=>{const intr=Math.max(s-90,0),pnl=(intr-D.trade.entry)*D.trade.qty;return `<tr class="${Math.abs(s-90.47)<0.01?'hot':''}"><td>₹${s.toFixed(2)}</td><td>₹${intr.toFixed(2)}</td><td class="${pnl>=0?'pos':'neg'}">${cr(pnl)}</td><td>${s>=D.chain.spot?pc((s/D.chain.spot-1)*100,1):'—'}</td></tr>`}).join('')+'</tbody>';

$('irfc-delta-now').textContent=D.quote.delta.toFixed(3);
$('irfc-delta-rupee').textContent='₹'+nf(D.quote.delta,3);
$('irfc-delta-lot').textContent=cr(D.quote.delta*D.trade.qty);
$('irfc-theta').textContent=sgn(D.quote.theta)+'₹'+nf(Math.abs(D.quote.theta),3);
$('irfc-theta-lot').textContent=cr(D.quote.theta*D.trade.qty);
$('irfc-distance').textContent=nf(90-D.chain.spot,2)+' pts';
$('irfc-distance-pct').textContent=pc((90/D.chain.spot-1)*100,1);
$('irfc-spread').textContent='₹'+nf(D.quote.bid,2)+' / ₹'+nf(D.quote.ask,2);

// 6 counts
$('irfc-c-f9').textContent=D.counts.f9;
$('irfc-c-e9').textContent=D.counts.e9;
$('irfc-c-c9').textContent=D.counts.c9;
$('irfc-c-last').textContent=D.now18.last_bar;
</script>
</body></html>'''


if __name__ == "__main__":
    main()
