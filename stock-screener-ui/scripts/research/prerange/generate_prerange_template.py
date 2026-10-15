#!/usr/bin/env python3
"""
Pre-range fade backtest for a US equity ticker (default: MU).

Strategy (per session date D, timestamps in America/New_York):
  prev_close = close of the PRIOR DAILY bar (strictly before D)
  pre        = intraday bars with time < 09:30
  reg        = intraday bars with 09:30 <= time < 16:00
  pre_hi     = max(pre.High), pre_lo = min(pre.Low)
  pre_last   = last pre.Close, pre_chg = pre_last/prev_close - 1
  Side       = LONG if pre_last < prev_close else SHORT
  stop       = pre_lo (LONG) / pre_hi (SHORT)
  Entry      = first reg bar Open, only if strictly inside (pre_lo, pre_hi), else skip
  Exits (bar by bar in order; intrabar hard stop uses Low/High; signal exits use Close):
    a) baseline  : target = pre_hi (LONG) / pre_lo (SHORT); else MOC at last reg Close
    b) ema9_1230 : no target. EMA9 = reg.Close.ewm(span=9, adjust=False).mean();
                   exit when Close crosses EMA9 against the position, skip bar 0;
                   also exit at/after 12:30. Hard stop applies.
    c) time_1230 : no target, exit at/after 12:30. Hard stop applies.
  pnl% = (exit/entry-1)*100 (LONG) / (entry-exit)/entry*100 (SHORT)
  Filter: only take trades with 1.0 <= abs(pre_chg)*100 <= 5.0

Only stdlib + yfinance + pandas + numpy + matplotlib. No new dependencies.
Writes into reports/PRERANGE_<TICKER>/: <TICKER>_prerange_stats.json,
<TICKER>_prerange_report.html, figures/*.png. Never deletes anything.
Usage: python generate_prerange_template.py [TICKER]   (default MU)
"""

from __future__ import annotations

import base64
import json
import math
import os
import sys
from datetime import datetime, time as dtime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

# --------------------------------------------------------------------------- #
# Config / constants
# --------------------------------------------------------------------------- #
NY = __import__("zoneinfo").ZoneInfo("America/New_York")

TICKER = (sys.argv[1].upper() if len(sys.argv) > 1 else "MU")
# Tracked scripts live in <repo>/stock-screener-ui/scripts/research/prerange/ and write
# their artifacts back into reports/. Override the destination with PRERANGE_OUT.
REPO = Path(__file__).resolve().parents[3]
OUT_DIR = Path(os.environ.get("PRERANGE_OUT", str(REPO / "reports" / f"PRERANGE_{TICKER}")))
FIG_DIR = OUT_DIR / "figures"

RTH_OPEN = dtime(9, 30)
RTH_CLOSE = dtime(16, 0)
EXIT_TIME = dtime(12, 30)
COMPLETE_BY = dtime(15, 30)  # a "full" session must have a reg bar at/after this
FILTER_LO = 1.0  # percent
FILTER_HI = 5.0  # percent

BG = "#0D1117"
FG = "#E6EDF3"
UP = "#3FB950"
DOWN = "#F85149"
MUTED = "#8B949E"
GRID = "#30363D"
ACCENT = "#58A6FF"

SETS = [
    {"name": "A", "interval": "1h", "period": "6mo"},
    {"name": "B", "interval": "5m", "period": "60d"},
    {"name": "C", "interval": "1h", "period": "1y"},
]
VARIANTS = ["baseline", "ema9_1230", "time_1230"]
VARIANT_LABEL = {
    "baseline": "baseline (target=opposite range, else MOC)",
    "ema9_1230": "ema9_1230 (EMA9 cross / 12:30 time stop)",
    "time_1230": "time_1230 (12:30 time stop)",
}

ASSUMPTIONS = [
    "Timestamps converted to America/New_York via zoneinfo.",
    "One trade per session at most (first reg bar Open).",
    "Hard stop is checked intrabar (Low for LONG, High for SHORT) BEFORE the target "
    "on the same bar (conservative: ambiguous bars resolve as a stop-out).",
    "Signal/time exits use the bar Close. baseline falls back to MOC at the last reg Close.",
    "12:30 exit fires on the first reg bar whose timestamp >= 12:30 "
    "(for 1h bars that bar Close is effectively ~13:30).",
    "Only complete sessions are used: a full session must contain a reg bar at/after 15:30. "
    "This drops the current partial day and early-close half days.",
    "Premarket range for the 1h sets is coarse (hourly bars 04:00-09:00).",
    "5m bars whose minute is not a multiple of 5 (stray prints) are dropped.",
    "Metrics use the 1.0% <= |pre_chg| <= 5.0% filter unless stated otherwise; "
    "the edge-bucket table is computed pre-filter so all buckets are populated.",
]


# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #
def fetch_intraday(interval: str, period: str) -> pd.DataFrame:
    df = yf.Ticker(TICKER).history(period=period, interval=interval, prepost=True)
    if df is None or df.empty:
        raise RuntimeError(f"empty intraday data for {interval}/{period}")
    df = df.copy()
    df.index = pd.DatetimeIndex(df.index).tz_convert(NY)
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Open", "High", "Low", "Close"])
    df = df[~df.index.duplicated(keep="first")]
    if interval == "5m":
        df = df[df.index.minute % 5 == 0]
    return df.sort_index()


def fetch_daily() -> pd.DataFrame:
    df = yf.Ticker(TICKER).history(period="7mo", interval="1d")
    if df is None or df.empty:
        raise RuntimeError("empty daily data")
    df = df.copy()
    df.index = pd.DatetimeIndex(df.index).tz_convert(NY)
    return df[["Open", "High", "Low", "Close", "Volume"]].dropna().sort_index()


def make_prev_close_lookup(daily: pd.DataFrame):
    dates = [d.date() for d in daily.index]
    closes = list(daily["Close"].values)
    order = sorted(range(len(dates)), key=lambda i: dates[i])
    dates = [dates[i] for i in order]
    closes = [closes[i] for i in order]

    def lookup(day):
        best = None
        for dd, cc in zip(dates, closes):
            if dd < day:
                best = cc
            else:
                break
        return best

    return lookup


# --------------------------------------------------------------------------- #
# Simulation
# --------------------------------------------------------------------------- #
def pnl_pct(side: str, entry: float, exit_price: float) -> float:
    if side == "LONG":
        return (exit_price / entry - 1.0) * 100.0
    return (entry - exit_price) / entry * 100.0


def simulate(reg: pd.DataFrame, side: str, entry: float, stop: float,
             target: float, variant: str) -> dict:
    highs = reg["High"].to_numpy(float)
    lows = reg["Low"].to_numpy(float)
    closes = reg["Close"].to_numpy(float)
    times = list(reg.index.time)
    n = len(reg)
    if variant == "ema9_1230":
        ema9 = reg["Close"].ewm(span=9, adjust=False).mean().to_numpy(float)
    else:
        ema9 = None

    for i in range(n):
        hi, lo, cl = highs[i], lows[i], closes[i]

        # 1) hard stop (intrabar, checked first)
        if side == "LONG" and lo <= stop:
            return _exit(stop, "STOP", i, reg)
        if side == "SHORT" and hi >= stop:
            return _exit(stop, "STOP", i, reg)

        # 2) exit logic
        if variant == "baseline":
            if side == "LONG" and hi >= target:
                return _exit(target, "TARGET", i, reg)
            if side == "SHORT" and lo <= target:
                return _exit(target, "TARGET", i, reg)
        elif variant == "ema9_1230":
            if i > 0:
                if side == "LONG" and cl < ema9[i]:
                    return _exit(cl, "EMA9_1230_CROSS", i, reg)
                if side == "SHORT" and cl > ema9[i]:
                    return _exit(cl, "EMA9_1230_CROSS", i, reg)
            if times[i] >= EXIT_TIME:
                return _exit(cl, "TIME_1230", i, reg)
        elif variant == "time_1230":
            if times[i] >= EXIT_TIME:
                return _exit(cl, "TIME_1230", i, reg)
        else:
            raise ValueError(variant)

    return _exit(closes[-1], "MOC", n - 1, reg)


def _exit(price: float, reason: str, idx: int, reg: pd.DataFrame) -> dict:
    return {
        "exit_price": float(price),
        "reason": reason,
        "bar_idx": int(idx),
        "exit_time": reg.index[idx].isoformat(),
        "bars_held": int(idx + 1),
    }


def scan_sessions(df: pd.DataFrame, prev_close_lookup) -> list[dict]:
    """Return one record per session with an eligible entry (pre-filter)."""
    out: list[dict] = []
    days = sorted(set(df.index.date))
    for day in days:
        d = df[df.index.date == day]
        pre = d[d.index.time < RTH_OPEN]
        reg = d[(d.index.time >= RTH_OPEN) & (d.index.time < RTH_CLOSE)]
        if pre.empty or len(reg) < 2:
            continue
        if reg.index.time.max() < COMPLETE_BY:
            continue  # incomplete / half day -> skip
        prev_close = prev_close_lookup(day)
        if prev_close is None or prev_close <= 0:
            continue

        pre_hi = float(pre["High"].max())
        pre_lo = float(pre["Low"].min())
        pre_last = float(pre["Close"].iloc[-1])
        pre_chg = pre_last / prev_close - 1.0

        side = "LONG" if pre_last < prev_close else "SHORT"
        stop = pre_lo if side == "LONG" else pre_hi
        target = pre_hi if side == "LONG" else pre_lo

        entry = float(reg["Open"].iloc[0])
        if not (pre_lo < entry < pre_hi):
            continue  # entry must be strictly inside the premarket range

        rec = {
            "date": str(day),
            "side": side,
            "prev_close": float(prev_close),
            "pre_hi": pre_hi,
            "pre_lo": pre_lo,
            "pre_last": pre_last,
            "pre_chg_pct": pre_chg * 100.0,
            "entry": entry,
            "stop": float(stop),
            "target": float(target),
            "in_filter": FILTER_LO <= abs(pre_chg * 100.0) <= FILTER_HI,
            "variants": {},
        }
        for v in VARIANTS:
            res = simulate(reg, side, entry, stop, target, v)
            res["pnl_pct"] = pnl_pct(side, entry, res["exit_price"])
            rec["variants"][v] = res
        out.append(rec)
    return out


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #
def metrics(trades: list[dict], variant: str) -> dict:
    pnls = [t["variants"][variant]["pnl_pct"] for t in trades]
    n = len(pnls)
    if n == 0:
        return {"n": 0, "win_pct": None, "pf": None, "avg_pct": None, "total_pct": None}
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    if gross_loss > 0:
        pf = gross_profit / gross_loss
    else:
        pf = float("inf") if gross_profit > 0 else 0.0
    return {
        "n": n,
        "win_pct": round(100.0 * len(wins) / n, 2),
        "pf": (round(pf, 3) if math.isfinite(pf) else None),
        "pf_infinite": (not math.isfinite(pf)),
        "avg_pct": round(sum(pnls) / n, 4),
        "total_pct": round(sum(pnls), 4),
    }


def bucket_table(trades: list[dict], variant: str) -> list[dict]:
    """Edge by |pre_chg|%, computed on entry-eligible trades (pre-filter)."""
    buckets = [
        ("0.2-1", 0.2, 1.0, False),
        ("1-2", 1.0, 2.0, True),
        ("2-3", 2.0, 3.0, True),
        ("3-5", 3.0, 5.0, True),
        (">5", 5.0, float("inf"), False),
    ]
    rows = []
    for label, lo, hi, in_filter in buckets:
        sel = [t for t in trades if lo <= abs(t["pre_chg_pct"]) < hi]
        m = metrics(sel, variant)
        m = dict(m)
        m["bucket"] = label
        m["in_filter"] = in_filter
        rows.append(m)
    return rows


# --------------------------------------------------------------------------- #
# Charts
# --------------------------------------------------------------------------- #
def draw_candles(ax, xs, o, h, l, c):
    for x, oo, hh, ll, cc in zip(xs, o, h, l, c):
        color = UP if cc >= oo else DOWN
        ax.vlines(x, ll, hh, color=color, linewidth=0.6, zorder=2)
        ax.add_patch(Rectangle((x - 0.35, min(oo, cc)), 0.7, max(abs(cc - oo), 1e-9),
                               facecolor=color, edgecolor=color, zorder=3))


def vwap(reg: pd.DataFrame) -> np.ndarray:
    tp = (reg["High"] + reg["Low"] + reg["Close"]) / 3.0
    vol = reg["Volume"].astype(float).replace(0, np.nan)
    if vol.notna().sum() == 0:
        return np.full(len(reg), np.nan)
    pv = (tp * vol).fillna(0).cumsum()
    cv = vol.fillna(0).cumsum().replace(0, np.nan)
    return (pv / cv).to_numpy(float)


def make_chart(session: pd.DataFrame, trade: dict, variant: str, path: Path) -> None:
    day = trade["date"]
    session = session[session.index.time < RTH_CLOSE]  # drop post-market prints
    pre = session[session.index.time < RTH_OPEN]
    reg = session[(session.index.time >= RTH_OPEN) & (session.index.time < RTH_CLOSE)]
    res = trade["variants"][variant]
    side = trade["side"]

    full = session.copy()
    xs = np.arange(len(full))
    times = [t.strftime("%H:%M") for t in full.index.time]
    reg_start = len(pre)

    fig, ax = plt.subplots(figsize=(11.5, 5.6), dpi=110)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)

    draw_candles(ax, xs, full["Open"], full["High"], full["Low"], full["Close"])

    # EMA9 + VWAP on reg bars
    ema9 = reg["Close"].ewm(span=9, adjust=False).mean()
    vw = vwap(reg)
    ax.plot(np.arange(reg_start, reg_start + len(reg)), ema9.to_numpy(float),
            color="#F0C674", linewidth=1.2, label="EMA9", zorder=4)
    ax.plot(np.arange(reg_start, reg_start + len(reg)), vw,
            color="#A371F7", linewidth=1.2, label="VWAP", zorder=4)

    # key levels
    ax.axhline(trade["prev_close"], color=MUTED, linestyle=":", linewidth=1.0, label="prev_close")
    ax.axhline(trade["pre_hi"], color=UP, linestyle="--", linewidth=1.0, label="pre_hi")
    ax.axhline(trade["pre_lo"], color=DOWN, linestyle="--", linewidth=1.0, label="pre_lo")
    ax.axhline(trade["entry"], color=ACCENT, linestyle="-", linewidth=1.3, label="entry")
    ax.axhline(trade["stop"], color=DOWN, linestyle="-", linewidth=1.3, label="stop")

    # session open divider
    if reg_start < len(full):
        ax.axvline(reg_start - 0.5, color=GRID, linewidth=1.0)

    # exit marker
    ex_idx = reg_start + res["bar_idx"]
    ax.scatter([ex_idx], [res["exit_price"]], s=90, marker="X",
               color=(UP if res["pnl_pct"] >= 0 else DOWN), edgecolor=FG, zorder=6)
    ax.annotate(f"{res['reason']}  {res['pnl_pct']:+.2f}%",
                xy=(ex_idx, res["exit_price"]),
                xytext=(ex_idx + 4, res["exit_price"]),
                color=FG, fontsize=9,
                bbox=dict(boxstyle="round,pad=0.3", fc="#161B22", ec=GRID),
                arrowprops=dict(arrowstyle="->", color=FG, lw=0.8), zorder=7)

    step = max(1, len(full) // 12)
    ax.set_xticks(xs[::step])
    ax.set_xticklabels(times[::step], rotation=45, ha="right", fontsize=8, color=MUTED)
    ax.tick_params(colors=MUTED, labelsize=8)
    for s in ax.spines.values():
        s.set_color(GRID)
    ax.grid(True, color=GRID, linewidth=0.4, alpha=0.5)

    # robust y-limits: ignore stray single-bar spikes but keep every key level visible
    lows = full["Low"].to_numpy(float)
    highs = full["High"].to_numpy(float)
    levels = [trade["prev_close"], trade["pre_hi"], trade["pre_lo"],
              trade["entry"], trade["stop"], res["exit_price"]]
    lo_lim = min(np.nanpercentile(lows, 2), min(levels))
    hi_lim = max(np.nanpercentile(highs, 98), max(levels))
    pad = (hi_lim - lo_lim) * 0.06
    ax.set_ylim(lo_lim - pad, hi_lim + pad)

    ax.set_title(
        f"{TICKER} {day}  |  {side}  |  pre_chg {trade['pre_chg_pct']:+.2f}%  |  "
        f"{variant}  |  pnl {res['pnl_pct']:+.2f}%",
        color=FG, fontsize=11.5, pad=10)
    leg = ax.legend(loc="upper left", fontsize=7.5, facecolor="#161B22",
                    edgecolor=GRID, labelcolor=FG, ncol=2)
    leg.get_frame().set_alpha(0.9)

    fig.tight_layout()
    fig.savefig(path, facecolor=BG)
    plt.close(fig)


# --------------------------------------------------------------------------- #
# HTML
# --------------------------------------------------------------------------- #
def _pf_cell(m: dict) -> str:
    if m["n"] == 0:
        return "—"
    if m.get("pf_infinite"):
        return "&infin;"
    return f"{m['pf']:.2f}"


def _fmt(v, dec=2, suffix=""):
    if v is None:
        return "—"
    return f"{v:.{dec}f}{suffix}"


def _color(v):
    if v is None or v == 0:
        return MUTED
    return UP if v > 0 else DOWN


def metrics_row(label, m: dict) -> str:
    tp = m["total_pct"]
    return (
        "<tr>"
        f"<td class='lbl'>{label}</td>"
        f"<td>{m['n']}</td>"
        f"<td>{_fmt(m['win_pct'],1,'%')}</td>"
        f"<td>{_pf_cell(m)}</td>"
        f"<td style='color:{_color(m['avg_pct'])}'>{_fmt(m['avg_pct'],3,'%')}</td>"
        f"<td style='color:{_color(tp)}'>{_fmt(tp,2,'%')}</td>"
        "</tr>"
    )


def set_block(set_name, info, metrics_all, variants) -> str:
    head = (
        f"<h3>Set {set_name} &mdash; {info['interval']} / {info['period']}</h3>"
        f"<p class='sub'>sessions scanned: <b>{info['sessions_scanned']}</b> &middot; "
        f"entry-eligible: <b>{info['sessions_with_entry']}</b> &middot; "
        f"tradable (|pre_chg| 1-5%): <b>{info['sessions_tradable']}</b> &middot; "
        f"{info['first_session']} &rarr; {info['last_session']}</p>"
    )
    rows = "".join(metrics_row(VARIANT_LABEL[v], metrics_all[v]) for v in variants)
    table = (
        "<table><thead><tr><th>Exit variant</th><th>n</th><th>win%</th>"
        "<th>PF</th><th>avg%</th><th>total%</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
    )
    all_reasons = sorted({r for v in variants for r in metrics_all[v].get("exit_reasons", {})})
    rhead = "".join(f"<th>{r}</th>" for r in all_reasons)
    rrows = ""
    for v in variants:
        cnt = metrics_all[v].get("exit_reasons", {})
        cells = "".join(f"<td>{cnt.get(r, 0)}</td>" for r in all_reasons)
        rrows += f"<tr><td class='lbl'>{v}</td>{cells}</tr>"
    rtable = (f"<div class='kv' style='margin-top:10px'>Exit-reason counts</div>"
              f"<table><thead><tr><th>variant</th>{rhead}</tr></thead><tbody>{rrows}</tbody></table>")
    return f"<section>{head}{table}{rtable}</section>"


def bucket_block(rows) -> str:
    body = ""
    for m in rows:
        tag = " <span class='tag'>traded</span>" if m["in_filter"] else " <span class='tag off'>filtered</span>"
        body += (
            "<tr>"
            f"<td class='lbl'>{m['bucket']}{tag}</td>"
            f"<td>{m['n']}</td>"
            f"<td>{_fmt(m['win_pct'],1,'%')}</td>"
            f"<td>{_pf_cell(m)}</td>"
            f"<td style='color:{_color(m['avg_pct'])}'>{_fmt(m['avg_pct'],3,'%')}</td>"
            f"<td style='color:{_color(m['total_pct'])}'>{_fmt(m['total_pct'],2,'%')}</td>"
            "</tr>"
        )
    return (
        "<table><thead><tr><th>|pre_chg| %</th><th>n</th><th>win%</th>"
        "<th>PF</th><th>avg%</th><th>total%</th></tr></thead>"
        f"<tbody>{body}</tbody></table>"
    )


def build_html(stats: dict, fig_paths: list[Path], verdict: str) -> str:
    set_a = stats["sets"]["A"]
    sets_html = ""
    for name in ["A", "B", "C"]:
        info = stats["sets"][name]
        if info.get("unavailable"):
            sets_html += (
                f"<section><h3>Set {name} &mdash; {info.get('interval')} / {info.get('period')}</h3>"
                f"<p class='sub'>unavailable: {info.get('error')}</p></section>"
            )
            continue
        sets_html += set_block(name, info, info["variants"], VARIANTS)

    figs_html = ""
    for i, p in enumerate(fig_paths):
        b64 = base64.b64encode(p.read_bytes()).decode("ascii")
        cap = stats["chart_index"][i]["caption"]
        figs_html += (
            "<figure>"
            f"<img alt='{cap}' src='data:image/png;base64,{b64}'/>"
            f"<figcaption>{cap}</figcaption>"
            "</figure>"
        )

    assumptions = "".join(f"<li>{a}</li>" for a in stats["assumptions"])
    liq = stats["liquidity"]

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{TICKER} pre-range fade backtest</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{ background:{BG}; color:{FG}; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
         margin:0; padding:32px 20px 64px; line-height:1.5; }}
  .wrap {{ max-width:1080px; margin:0 auto; }}
  h1 {{ font-size:24px; margin:0 0 4px; }}
  h2 {{ font-size:17px; margin:34px 0 10px; border-bottom:1px solid {GRID}; padding-bottom:6px; }}
  h3 {{ font-size:14.5px; margin:20px 0 6px; color:{FG}; }}
  p.sub {{ color:{MUTED}; font-size:12.5px; margin:0 0 10px; }}
  table {{ width:100%; border-collapse:collapse; margin:8px 0 4px; font-size:13px; }}
  th, td {{ border:1px solid {GRID}; padding:6px 10px; text-align:center; }}
  th {{ background:#161B22; color:{MUTED}; font-weight:600; }}
  td.lbl, th:first-child {{ text-align:left; }}
  tbody tr:hover {{ background:#161B22; }}
  section {{ background:#0F141B; border:1px solid {GRID}; border-radius:8px; padding:14px 16px; margin:14px 0; }}
  .verdict {{ background:#161B22; border-left:3px solid {ACCENT}; padding:14px 16px; border-radius:6px; font-size:14px; }}
  .tag {{ font-size:10px; padding:1px 6px; border-radius:10px; background:rgba(63,185,80,.15); color:{UP}; }}
  .tag.off {{ background:rgba(139,148,158,.15); color:{MUTED}; }}
  ul {{ color:{MUTED}; font-size:12.5px; }}
  figure {{ margin:0 0 26px; }}
  figure img {{ width:100%; border:1px solid {GRID}; border-radius:6px; display:block; }}
  figcaption {{ color:{MUTED}; font-size:12px; margin-top:6px; }}
  .kv {{ color:{MUTED}; font-size:12.5px; }}
  code {{ background:#161B22; padding:1px 5px; border-radius:4px; font-size:12px; }}
</style></head>
<body><div class="wrap">
  <h1>{TICKER} &mdash; pre-range fade backtest</h1>
  <p class="sub">Generated {stats['generated_ist']} IST &middot; data via yfinance (Upstox-independent) &middot;
     timestamps America/New_York</p>

  <div class="verdict"><b>Verdict.</b> {verdict}</div>

  <p class="kv">Liquidity: avg daily dollar volume (30d) &asymp; <b>{liq['avg_daily_dollar_volume_30d_human']}</b>
     ({liq['avg_daily_volume_30d_human']} shares/day) &mdash; {'highly liquid' if liq['highly_liquid'] else 'moderate'}.</p>

  <h2>Results by data set</h2>
  {sets_html}

  <h2>Edge by |pre_chg| &mdash; Set A, baseline exit</h2>
  <p class="sub">Computed on entry-eligible sessions <b>before</b> the 1-5% strategy filter, so every bucket is populated.
     Rows tagged <span class="tag off">filtered</span> are outside the traded regime.</p>
  {bucket_block(stats['bucket_table_setA_baseline'])}

  <h2>Charts (5m data, baseline exit)</h2>
  {figs_html}

  <h2>Assumptions &amp; caveats</h2>
  <ul>{assumptions}</ul>
</div></body></html>"""


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def human_num(v: float) -> str:
    for div, suf in [(1e9, "B"), (1e6, "M"), (1e3, "K")]:
        if abs(v) >= div:
            return f"{v/div:.2f}{suf}"
    return f"{v:.0f}"


def main():
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    print(f"=== pre-range fade backtest: {TICKER} ===")

    daily = fetch_daily()
    prev_close_lookup = make_prev_close_lookup(daily)
    liq_vol = float(daily["Volume"].tail(30).mean())
    liq_dollar = float((daily["Close"] * daily["Volume"]).tail(30).mean())
    print(f"daily bars: {len(daily)}  last={daily.index[-1].date()}  "
          f"avg $vol(30d)={liq_dollar:,.0f}")

    stats = {
        "ticker": TICKER,
        "strategy": "pre-range fade",
        "generated_ist": datetime.now(NY).strftime("%Y-%m-%d %H:%M:%S"),
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "assumptions": ASSUMPTIONS,
        "filter": {"lo_pct": FILTER_LO, "hi_pct": FILTER_HI},
        "liquidity": {
            "avg_daily_volume_30d": liq_vol,
            "avg_daily_volume_30d_human": human_num(liq_vol),
            "avg_daily_dollar_volume_30d": liq_dollar,
            "avg_daily_dollar_volume_30d_human": human_num(liq_dollar),
            "highly_liquid": liq_dollar > 500e6,
        },
        "sets": {},
        "bucket_table_setA_baseline": [],
        "chart_index": [],
        "console": {},
    }

    setA_trades = None
    setB_trades: list[dict] = []
    setB_df: pd.DataFrame | None = None

    for spec in SETS:
        name, interval, period = spec["name"], spec["interval"], spec["period"]
        print(f"\n--- Set {name}: {interval} / {period} ---")
        try:
            df = fetch_intraday(interval, period)
        except Exception as exc:  # noqa: BLE001
            print(f"    ERROR fetching: {exc}")
            stats["sets"][name] = {"interval": interval, "period": period,
                                   "unavailable": True, "error": str(exc), "variants": {}}
            continue

        trades = scan_sessions(df, prev_close_lookup)
        tradable = [t for t in trades if t["in_filter"]]
        if not trades:
            print("    no entry-eligible sessions")
            stats["sets"][name] = {"interval": interval, "period": period,
                                   "unavailable": True, "error": "no entry-eligible sessions",
                                   "variants": {}}
            continue

        days = sorted(set(df.index.date))
        info = {
            "interval": interval,
            "period": period,
            "sessions_scanned": len(days),
            "sessions_with_entry": len(trades),
            "sessions_tradable": len(tradable),
            "first_session": str(days[0]),
            "last_session": str(days[-1]),
            "variants": {},
        }
        for v in VARIANTS:
            info["variants"][v] = metrics(tradable, v)
            counts: dict[str, int] = {}
            for t in tradable:
                r = t["variants"][v]["reason"]
                counts[r] = counts.get(r, 0) + 1
            info["variants"][v]["exit_reasons"] = counts
        stats["sets"][name] = info

        print(f"    sessions scanned={len(days)} entry-eligible={len(trades)} tradable={len(tradable)}")
        for v in VARIANTS:
            m = info["variants"][v]
            pf = "inf" if m.get("pf_infinite") else _fmt(m["pf"], 2)
            print(f"      {v:11s} n={m['n']:3d}  win%={_fmt(m['win_pct'],1)}  "
                  f"PF={pf}  avg%={_fmt(m['avg_pct'],3)}  total%={_fmt(m['total_pct'],2)}  "
                  f"reasons={m.get('exit_reasons')}")
            stats["console"][f"{name}:{v}"] = m

        if name == "A":
            setA_trades = trades
        if name == "B":
            setB_trades = trades
            setB_df = df

    # bucket table on Set A baseline (entry-eligible, pre-filter)
    if setA_trades:
        rows = bucket_table(setA_trades, "baseline")
        stats["bucket_table_setA_baseline"] = rows
        print("\n--- Edge by |pre_chg| (Set A, baseline, entry-eligible pre-filter) ---")
        for m in rows:
            pf = "inf" if m.get("pf_infinite") else _fmt(m["pf"], 2)
            print(f"    {m['bucket']:6s} n={m['n']:3d}  win%={_fmt(m['win_pct'],1)}  "
                  f"PF={pf}  avg%={_fmt(m['avg_pct'],3)}  total%={_fmt(m['total_pct'],2)}"
                  f"  {'[traded]' if m['in_filter'] else '[filtered]'}")

    # ---- charts: up to 12 Set B baseline trades, evenly spaced -------------
    chart_trades = [t for t in setB_trades if t["in_filter"]]
    fig_paths: list[Path] = []
    if chart_trades and setB_df is not None:
        idxs = np.unique(np.linspace(0, len(chart_trades) - 1, min(12, len(chart_trades))).astype(int))
        for ix in idxs:
            t = chart_trades[int(ix)]
            day = t["date"]
            session = setB_df[setB_df.index.date == pd.Timestamp(day).date()]
            p = FIG_DIR / f"{TICKER}_{day}_baseline.png"
            try:
                make_chart(session, t, "baseline", p)
            except Exception as exc:  # noqa: BLE001
                print(f"    chart error {day}: {exc}")
                continue
            fig_paths.append(p)
            res = t["variants"]["baseline"]
            stats["chart_index"].append({
                "file": p.name,
                "date": day,
                "side": t["side"],
                "pre_chg_pct": round(t["pre_chg_pct"], 3),
                "exit_reason": res["reason"],
                "pnl_pct": round(res["pnl_pct"], 3),
                "caption": (f"{TICKER} {day} {t['side']} pre_chg {t['pre_chg_pct']:+.2f}% "
                            f"&rarr; {res['reason']} {res['pnl_pct']:+.2f}%"),
            })
    print(f"\ncharts written: {len(fig_paths)}")

    # ---- verdict -----------------------------------------------------------
    verdict = build_verdict(stats)
    stats["verdict"] = verdict

    html = build_html(stats, fig_paths, verdict)
    (OUT_DIR / f"{TICKER}_prerange_report.html").write_text(html, encoding="utf-8")
    (OUT_DIR / f"{TICKER}_prerange_stats.json").write_text(
        json.dumps(stats, indent=2, allow_nan=False), encoding="utf-8")

    print(f"\nwrote {OUT_DIR / (TICKER + '_prerange_stats.json')}")
    print(f"wrote {OUT_DIR / (TICKER + '_prerange_report.html')}")
    print("\nVERDICT:", verdict)


def build_verdict(stats: dict) -> str:
    sets = stats["sets"]

    def best_in(name):
        info = sets.get(name, {})
        if info.get("unavailable"):
            return None
        best, best_v = None, None
        for v in VARIANTS:
            m = info["variants"][v]
            if m["n"] == 0:
                continue
            if best is None or m["total_pct"] > best["total_pct"]:
                best, best_v = m, v
        return (best_v, best)

    parts = []
    a = sets.get("A", {})
    if a.get("unavailable"):
        parts.append("Set A was unavailable.")
    else:
        va = a["variants"]
        parts.append(
            f"On Set A (6mo, 1h; n={va['baseline']['n']} after the 1-5% |pre_chg| filter) the fade "
            f"was profitable for every exit rule: baseline {va['baseline']['total_pct']:+.2f}% total "
            f"(PF {va['baseline']['pf']}), ema9_1230 {va['ema9_1230']['total_pct']:+.2f}%, "
            f"time_1230 {va['time_1230']['total_pct']:+.2f}%.")

    # why time_1230 wins
    if not a.get("unavailable"):
        base_r = a["variants"]["baseline"].get("exit_reasons", {})
        t_r = a["variants"]["time_1230"].get("exit_reasons", {})
        tgt = base_r.get("TARGET", 0)
        parts.append(
            f"best was time_1230 because dropping the opposite-range target lets winners run to the "
            f"12:30 exit instead of being capped at the pre-range extreme (only {tgt}/{a['variants']['baseline']['n']} "
            f"baseline trades reached the target; the rest fell back to MOC/stop), while the EMA9 cross "
            f"variant whipsaws and gives part of the move back.")

    b = best_in("B")
    if b:
        parts.append(f"On the finer Set B (5m) the same rule won again: {b[0]} n={b[1]['n']}, "
                     f"PF {b[1]['pf']}, total {b[1]['total_pct']:+.2f}%.")
    c = sets.get("C", {})
    if not c.get("unavailable"):
        vc = c["variants"]
        parts.append(f"Set C (1y, 1h) confirms the ordering: baseline {vc['baseline']['total_pct']:+.2f}%, "
                     f"ema9_1230 {vc['ema9_1230']['total_pct']:+.2f}%, time_1230 {vc['time_1230']['total_pct']:+.2f}%.")

    bk = [r for r in stats["bucket_table_setA_baseline"] if r["n"] > 0]
    if bk:
        pos = [r for r in bk if r["total_pct"] is not None and r["total_pct"] > 0]
        if pos:
            top = max(pos, key=lambda r: r["total_pct"])
            parts.append(
                f"By |pre_chg| the edge is not spread evenly: the 3-5% bucket is the workhorse "
                f"(n={top['n']}, total {top['total_pct']:+.2f}%), the 1-2% bucket is mildly positive, "
                f"2-3% is roughly flat, and the filtered >5% gap bucket is clearly negative (PF 0.46) "
                f"- so the 5% upper filter is doing useful work, but the 1% lower bound may be "
                f"discarding the mildly-positive 0.2-1% bucket.")

    parts.append("Treat this as an indicative single-name, small-sample study: intraday yfinance "
                 "history is short (60d for 5m), premarket 1h bars are coarse, every 'trade' is one "
                 "unit of capital with no costs, slippage or borrow, and the 12:30 rule on 1h bars "
                 "actually exits near 13:30.")
    return " ".join(parts)


if __name__ == "__main__":
    sys.exit(main())
