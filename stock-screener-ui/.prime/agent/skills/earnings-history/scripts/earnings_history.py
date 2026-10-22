#!/usr/bin/env python3
"""
Earnings-history + earnings-play prep for an NSE stock.

Pulls:
  * Upstox V3 daily candles (price/volume tape) via market_data.fetch_candles
  * yfinance (TICKER.NS): earnings dates, EPS surprise, next-event consensus,
    quarterly P&L and valuation snapshot

Produces, in reports/earnings/<SYMBOL>/:
  * <SYM>_earnings_history.md   — human report (reaction table, stats, levels)
  * <SYM>_earnings_events.csv   — one row per earnings event
  * <SYM>_earnings_history.json — machine-readable summary

Usage (from the stock-screener-ui repo root):
  .venv/bin/python .prime/agent/skills/earnings-history/scripts/earnings_history.py --symbol MANKIND
  .venv/bin/python .prime/agent/skills/earnings-history/scripts/earnings_history.py --symbol MANKIND --next-date 2026-10-26
  .venv/bin/python .prime/agent/skills/earnings-history/scripts/earnings_history.py --symbol MANKIND --no-yf --print

Event-study convention (NSE): Indian results are normally released after market
close, so the "reaction" session is the first trading session *strictly after*
the announcement date (T+1). Weekends/holidays roll forward automatically.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

# --- repo root on sys.path so `market_data` imports resolve -----------------
ROOT = next(
    p for p in Path(__file__).resolve().parents if (p / "market_data" / "market_data.py").exists()
)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

with contextlib.redirect_stdout(io.StringIO()):
    from market_data.market_data import fetch_candles  # noqa: E402


# ---------------------------------------------------------------------------
# Small formatting helpers
# ---------------------------------------------------------------------------
def inr(x: float | None, digits: int = 0) -> str:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "—"
    return f"₹{x:,.{digits}f}"


def pct(x: float | None, digits: int = 2) -> str:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "—"
    return f"{x:+.{digits}f}%"


def cr(x: float | None) -> str:
    """Rupee value in crore (Indian convention)."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "—"
    return f"₹{x / 1e7:,.0f} cr"


def _tbl(headers: Iterable[str], rows: Iterable[Iterable[Any]]) -> str:
    head = "| " + " | ".join(headers) + " |"
    sep = "|" + "|".join(["---"] * len(list(headers))) + "|"
    body = "\n".join("| " + " | ".join(str(c) for c in r) + " |" for r in rows)
    return "\n".join([head, sep, body])


def fiscal_quarter(d: str | date | pd.Timestamp) -> str:
    """Indian fiscal quarter label for a calendar date (FY ends 31 March)."""
    ts = pd.Timestamp(d)
    m, y = ts.month, ts.year
    if m <= 3:
        return f"Q3 FY{y}"
    if m <= 6:
        return f"Q4 FY{y}"
    if m <= 9:
        return f"Q1 FY{y + 1}"
    return f"Q2 FY{y + 1}"


def _ist_date_index(df: pd.DataFrame) -> pd.DatetimeIndex:
    """Normalised, tz-naive date index in Asia/Kolkata."""
    idx = pd.DatetimeIndex(df.index)
    if idx.tz is not None:
        idx = idx.tz_convert("Asia/Kolkata").tz_localize(None)
    return pd.DatetimeIndex([pd.Timestamp(x).normalize() for x in idx])


# ---------------------------------------------------------------------------
# Indicators
# ---------------------------------------------------------------------------
def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    tr = pd.concat(
        [high - low, (high - close.shift()).abs(), (low - close.shift()).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def _adx(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14):
    up, dn = high.diff(), -low.diff()
    pdm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=high.index)
    ndm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=high.index)
    tr = pd.concat(
        [high - low, (high - close.shift()).abs(), (low - close.shift()).abs()],
        axis=1,
    ).max(axis=1)
    atr_ = tr.ewm(alpha=1 / n, adjust=False).mean()
    pdi = 100 * pdm.ewm(alpha=1 / n, adjust=False).mean() / atr_
    ndi = 100 * ndm.ewm(alpha=1 / n, adjust=False).mean() / atr_
    dx = 100 * (pdi - ndi).abs() / (pdi + ndi)
    return dx.ewm(alpha=1 / n, adjust=False).mean(), pdi, ndi


def compute_technicals(df: pd.DataFrame) -> dict[str, float]:
    """Snapshot of the indicators used for the event trade."""
    c, h, l, v = df["close"], df["high"], df["low"], df["volume"]
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    sig = macd.ewm(span=9, adjust=False).mean()
    ma20, ma50 = c.rolling(20).mean(), c.rolling(50).mean()
    ma100, ma200 = c.rolling(100).mean(), c.rolling(200).mean()
    adx, pdi, ndi = _adx(h, l, c)
    atr = _atr(h, l, c)
    sd = c.rolling(20).std()
    return {
        "close": float(c.iloc[-1]),
        "sma20": float(ma20.iloc[-1]),
        "sma50": float(ma50.iloc[-1]),
        "sma100": float(ma100.iloc[-1]),
        "sma200": float(ma200.iloc[-1]),
        "rsi14": float(_rsi(c).iloc[-1]),
        "macd": float(macd.iloc[-1]),
        "macd_signal": float(sig.iloc[-1]),
        "macd_hist": float((macd - sig).iloc[-1]),
        "adx14": float(adx.iloc[-1]),
        "plus_di": float(pdi.iloc[-1]),
        "minus_di": float(ndi.iloc[-1]),
        "atr14": float(atr.iloc[-1]),
        "atr_pct": float(atr.iloc[-1] / c.iloc[-1] * 100),
        "bb_upper": float((ma20 + 2 * sd).iloc[-1]),
        "bb_lower": float((ma20 - 2 * sd).iloc[-1]),
        "vol_x20": float(v.iloc[-1] / v.rolling(20).mean().iloc[-1]),
        "high_52w": float(h.tail(252).max()),
        "low_52w": float(l.tail(252).min()),
        "from_high_pct": float((c.iloc[-1] / h.tail(252).max() - 1) * 100),
        "rv20_ann_pct": float(c.pct_change().tail(20).std() * np.sqrt(252) * 100),
        "rv60_ann_pct": float(c.pct_change().tail(60).std() * np.sqrt(252) * 100),
    }


# ---------------------------------------------------------------------------
# Event study
# ---------------------------------------------------------------------------
def event_reactions(
    daily: pd.DataFrame,
    earnings: pd.DataFrame,
    lookback: int = 20,
    drift_windows: tuple[int, ...] = (5, 10),
) -> pd.DataFrame:
    """
    One row per earnings event.

    `earnings` must have columns: date, and optionally surprise_pct.
    Reaction = first session strictly after the announcement date (T+1).
    """
    df = daily.copy()
    df.index = _ist_date_index(df)
    df = df[~df.index.duplicated(keep="last")].sort_index()
    idx = df.index

    rows = []
    for _, e in earnings.iterrows():
        edate = pd.Timestamp(e["date"]).normalize()
        t1 = int(idx.searchsorted(edate, side="right"))
        if t1 <= 0 or t1 >= len(idx):
            continue
        prev = t1 - 1
        o, hi, lo, cl = (float(df[c].iloc[t1]) for c in ("open", "high", "low", "close"))
        prev_close = float(df["close"].iloc[prev])
        if prev_close <= 0:
            continue
        vol_base = float(df["volume"].iloc[max(0, prev - lookback + 1): prev + 1].mean())
        rng = hi - lo
        pre_base_i = max(0, prev - lookback)
        pre20 = (
            (float(df["close"].iloc[prev]) / float(df["close"].iloc[pre_base_i]) - 1) * 100
            if prev > pre_base_i and float(df["close"].iloc[pre_base_i]) > 0
            else np.nan
        )
        row = {
            "date": edate.date().isoformat(),
            "quarter": fiscal_quarter(edate),
            "reaction_date": idx[t1].date().isoformat(),
            "surprise_pct": float(e["surprise_pct"]) if "surprise_pct" in e and pd.notna(e["surprise_pct"]) else np.nan,
            "prev_close": prev_close,
            "open": o,
            "high": hi,
            "low": lo,
            "close": cl,
            "move_pct": (cl / prev_close - 1) * 100,
            "gap_pct": (o / prev_close - 1) * 100,
            "intraday_pct": (cl / o - 1) * 100,
            "close_loc": ((cl - lo) / rng) if rng > 0 else np.nan,
            "pre20_pct": pre20,
            "vol_x": float(df["volume"].iloc[t1]) / vol_base if vol_base > 0 else np.nan,
        }
        for w in drift_windows:
            j = t1 + w
            row[f"drift{w}_pct"] = (
                (float(df["close"].iloc[j]) / cl - 1) * 100 if j < len(idx) and cl > 0 else np.nan
            )
        rows.append(row)
    return pd.DataFrame(rows)


def summarize_events(events: pd.DataFrame) -> dict[str, Any]:
    """Beat/miss split + the 'beat-and-fade' rate that matters for event trades."""
    if events.empty:
        return {"n": 0}

    ev = events.copy()
    has_surprise = ev["surprise_pct"].notna().any()
    beats = ev[ev["surprise_pct"] > 0] if has_surprise else ev.iloc[0:0]
    misses = ev[ev["surprise_pct"] <= 0] if has_surprise else ev.iloc[0:0]
    abs_move = ev["move_pct"].abs()

    def _avg(frame: pd.DataFrame, col: str) -> float | None:
        if frame.empty or col not in frame:
            return None
        s = frame[col].dropna()
        return float(s.mean()) if len(s) else None

    return {
        "n": int(len(ev)),
        "beat_n": int(len(beats)),
        "miss_n": int(len(misses)),
        "beat_rate_pct": float(len(beats) / len(ev) * 100) if has_surprise and len(ev) else None,
        "avg_surprise_pct": float(ev["surprise_pct"].dropna().mean()) if has_surprise else None,
        "avg_move_pct": float(ev["move_pct"].mean()),
        "median_abs_move_pct": float(abs_move.median()),
        "p25_abs_move_pct": float(abs_move.quantile(0.25)),
        "p75_abs_move_pct": float(abs_move.quantile(0.75)),
        "max_up_pct": float(ev["move_pct"].max()),
        "max_down_pct": float(ev["move_pct"].min()),
        "avg_move_beats_pct": _avg(beats, "move_pct"),
        "avg_move_misses_pct": _avg(misses, "move_pct"),
        "beat_fade_rate_pct": (
            float((beats["move_pct"] < 0).mean() * 100) if len(beats) else None
        ),
        "avg_gap_pct": float(ev["gap_pct"].mean()),
        "avg_intraday_pct": float(ev["intraday_pct"].mean()),
        "avg_pre20_beats_pct": _avg(beats, "pre20_pct"),
        "avg_pre20_misses_pct": _avg(misses, "pre20_pct"),
        "avg_drift5_beats_pct": _avg(beats, "drift5_pct"),
        "avg_drift5_misses_pct": _avg(misses, "drift5_pct"),
        "avg_drift10_beats_pct": _avg(beats, "drift10_pct"),
        "avg_drift10_misses_pct": _avg(misses, "drift10_pct"),
    }


def expected_move_stats(events: pd.DataFrame, n: int = 8) -> dict[str, float]:
    """Absolute T+1 move distribution over the last `n` events."""
    if events.empty:
        return {}
    a = events["move_pct"].abs().tail(n)
    return {
        "n": int(len(a)),
        "mean_abs_pct": float(a.mean()),
        "median_abs_pct": float(a.median()),
        "p25_abs_pct": float(a.quantile(0.25)),
        "p75_abs_pct": float(a.quantile(0.75)),
        "max_abs_pct": float(a.max()),
    }


def scenario_levels(close: float, expected_pct: float, df: pd.DataFrame) -> dict[str, float]:
    """±1x/±2x expected move plus nearby 20/60-day swing levels."""
    df = df.copy()
    df.index = _ist_date_index(df)
    return {
        "up_1x": close * (1 + expected_pct / 100),
        "up_2x": close * (1 + 2 * expected_pct / 100),
        "down_1x": close * (1 - expected_pct / 100),
        "down_2x": close * (1 - 2 * expected_pct / 100),
        "support_1": float(df["low"].tail(20).min()),
        "support_2": float(df["low"].tail(60).min()),
        "resistance_1": float(df["high"].tail(20).max()),
        "resistance_2": float(df["high"].tail(60).max()),
    }


# ---------------------------------------------------------------------------
# Data plumbing
# ---------------------------------------------------------------------------
def fetch_daily(symbol: str, years: int = 3) -> pd.DataFrame:
    start = (pd.Timestamp.today() - pd.DateOffset(years=years)).date().isoformat()
    end = (pd.Timestamp.today() + pd.Timedelta(days=1)).date().isoformat()
    with contextlib.redirect_stdout(io.StringIO()):
        df = fetch_candles(symbol, 1440, start, end)
    if df is None or df.empty:
        raise SystemExit(f"No daily candles for {symbol} ({start} → {end}).")
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    df.index = _ist_date_index(df)
    return df[~df.index.duplicated(keep="last")].sort_index()


def _yf_earnings(symbol: str) -> tuple[pd.DataFrame, dict[str, Any], dict[str, Any]]:
    """Returns (events frame, calendar dict, info dict). Degrades gracefully."""
    import yfinance as yf

    t = yf.Ticker(f"{symbol}.NS")
    events = pd.DataFrame(columns=["date", "surprise_pct"])
    calendar: dict[str, Any] = {}
    info: dict[str, Any] = {}
    try:
        ed = t.get_earnings_dates(limit=20)
        if ed is not None and not ed.empty:
            idx = pd.DatetimeIndex(ed.index)
            if idx.tz is not None:
                idx = idx.tz_convert("Asia/Kolkata")
            events = pd.DataFrame(
                {
                    "date": [x.date() for x in idx],
                    "surprise_pct": ed["Surprise(%)"].to_numpy(dtype=float),
                }
            )
            events = events.dropna(subset=["surprise_pct"]).sort_values("date")
    except Exception as exc:  # noqa: BLE001 - yfinance is best-effort
        print(f"  ! earnings_dates unavailable: {exc}", file=sys.stderr)
    try:
        calendar = t.calendar or {}
    except Exception:  # noqa: BLE001
        pass
    try:
        info = t.info or {}
    except Exception:  # noqa: BLE001
        pass
    return events.reset_index(drop=True), calendar, info


def _next_event(calendar: dict[str, Any], events: pd.DataFrame, override: str | None) -> str | None:
    if override:
        return pd.Timestamp(override).date().isoformat()
    raw = calendar.get("Earnings Date") if calendar else None
    if raw:
        first = raw[0] if isinstance(raw, (list, tuple)) else raw
        try:
            d = pd.Timestamp(first).date()
            if d >= date.today():
                return d.isoformat()
        except Exception:  # noqa: BLE001
            pass
    future = [d for d in events["date"] if pd.Timestamp(d).date() >= date.today()] if not events.empty else []
    return future[0].isoformat() if future else None


def _consensus(calendar: dict[str, Any], info: dict[str, Any]) -> dict[str, Any]:
    eps = calendar.get("Earnings Average") if calendar else None
    rev = calendar.get("Revenue Average") if calendar else None
    return {
        "eps_avg": eps,
        "eps_low": calendar.get("Earnings Low") if calendar else None,
        "eps_high": calendar.get("Earnings High") if calendar else None,
        "revenue_avg": rev,
        "trailing_pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "market_cap": info.get("marketCap"),
        "roe": info.get("returnOnEquity"),
        "debt_to_equity": info.get("debtToEquity"),
        "target_mean": info.get("targetMeanPrice"),
        "target_high": info.get("targetHighPrice"),
        "target_low": info.get("targetLowPrice"),
        "recommendation": info.get("recommendationKey"),
        "analysts": info.get("numberOfAnalystOpinions"),
    }


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------
def render_markdown(
    symbol: str,
    asof: str,
    events: pd.DataFrame,
    stats: dict[str, Any],
    exp: dict[str, float],
    tech: dict[str, float],
    scen: dict[str, float],
    next_date: str | None,
    cons: dict[str, Any],
    date_source: str = "vendor estimate",
) -> str:
    close = tech["close"]
    lines: list[str] = []
    lines.append(f"# {symbol} — Earnings History & Event Playbook")
    lines.append("")
    lines.append(
        f"**As of:** {asof} · **Last close:** {inr(close)} · "
        f"**Next event:** {next_date or 'not announced'} · "
        f"**Market cap:** {cr(cons.get('market_cap'))}"
    )
    lines.append("")

    # -- next event -------------------------------------------------------
    lines.append("## 1. Next event")
    if next_date:
        lines.append("")
        lines.append(
            _tbl(
                ["Item", "Value"],
                [
                    ["Date", f"{next_date}  _(source: {date_source})_"],
                    ["Consensus EPS", f"₹{cons['eps_avg']:.2f}" if cons.get("eps_avg") else "—"],
                    [
                        "EPS range",
                        f"₹{cons['eps_low']:.2f} – ₹{cons['eps_high']:.2f}"
                        if cons.get("eps_low") and cons.get("eps_high")
                        else "—",
                    ],
                    ["Consensus revenue", cr(cons.get("revenue_avg"))],
                    ["TTM / forward P/E", f"{cons.get('trailing_pe') or float('nan'):.1f}x / {cons.get('forward_pe') or float('nan'):.1f}x"],
                    ["Analyst mean target", inr(cons.get("target_mean")) if cons.get("target_mean") else "—"],
                    ["Coverage", f"{cons.get('analysts') or '—'} analysts · {cons.get('recommendation') or '—'}"],
                ],
            )
        )
        if date_source != "override":
            lines.append("")
            lines.append(
                "> ⚠️ **Vendor date.** Confirm the board-meeting date/time on the BSE/NSE filing "
                "and re-run with `--next-date YYYY-MM-DD` once known."
            )
    else:
        lines.append("\nNo scheduled event found; pass `--next-date YYYY-MM-DD` if the board meeting is known.")
    lines.append("")

    # -- history table ----------------------------------------------------
    lines.append("## 2. Earnings reaction history")
    lines.append("")
    lines.append("Reaction = close-to-close move on the **first session after** the announcement (T+1, NSE convention).")
    lines.append("")
    if events.empty:
        lines.append("_No historical events with surprise data._")
    else:
        rows = []
        for _, e in events.tail(14).iloc[::-1].iterrows():
            rows.append(
                [
                    e["date"],
                    e["quarter"],
                    pct(e["surprise_pct"], 1) if pd.notna(e["surprise_pct"]) else "—",
                    inr(e["prev_close"]),
                    pct(e["gap_pct"]),
                    pct(e["move_pct"]),
                    f"{e['close_loc']:.2f}" if pd.notna(e["close_loc"]) else "—",
                    pct(e["pre20_pct"], 1) if pd.notna(e["pre20_pct"]) else "—",
                    pct(e["drift5_pct"], 1) if pd.notna(e.get("drift5_pct")) else "—",
                ]
            )
        lines.append(
            _tbl(
                ["Announced", "Quarter", "EPS surprise", "Prev close", "Gap", "T+1 move", "Close loc", "Pre-20d run-up", "T+5 drift"],
                rows,
            )
        )
    lines.append("")

    # -- stats ------------------------------------------------------------
    lines.append("## 3. What the history says")
    lines.append("")
    if stats.get("n"):
        s = stats
        rows = [
            ["Events with surprise data", f"{s['n']}"],
            ["Beat rate", f"{s['beat_rate_pct']:.0f}% ({s['beat_n']} beats / {s['miss_n']} misses)" if s.get("beat_rate_pct") is not None else "—"],
            ["Avg EPS surprise", pct(s.get("avg_surprise_pct"), 1) if s.get("avg_surprise_pct") is not None else "—"],
            ["Avg T+1 move (all)", pct(s["avg_move_pct"])],
            ["Avg T+1 move — beats", pct(s.get("avg_move_beats_pct")) if s.get("avg_move_beats_pct") is not None else "—"],
            ["Avg T+1 move — misses", pct(s.get("avg_move_misses_pct")) if s.get("avg_move_misses_pct") is not None else "—"],
            ["**Beat-and-fade rate**", f"{s['beat_fade_rate_pct']:.0f}% of beats closed lower" if s.get("beat_fade_rate_pct") is not None else "—"],
            ["Avg gap / intraday", f"{pct(s['avg_gap_pct'])} / {pct(s['avg_intraday_pct'])}"],
            ["Avg pre-20d run-up (beats)", pct(s.get("avg_pre20_beats_pct"), 1) if s.get("avg_pre20_beats_pct") is not None else "—"],
            ["Avg T+5 drift (beats)", pct(s.get("avg_drift5_beats_pct"), 1) if s.get("avg_drift5_beats_pct") is not None else "—"],
            ["Max up / max down", f"{pct(s['max_up_pct'])} / {pct(s['max_down_pct'])}"],
        ]
        lines.append(_tbl(["Metric", "Value"], rows))
        if (s.get("beat_fade_rate_pct") or 0) >= 50:
            lines.append("")
            lines.append(
                f"> ⚠️ **Beat-and-fade stock:** {s['beat_fade_rate_pct']:.0f}% of EPS beats still closed red on T+1. "
                "The market is selling the expectation, not the print — size the event accordingly."
            )
    else:
        lines.append("_Not enough events._")
    lines.append("")

    # -- expected move ----------------------------------------------------
    lines.append("## 4. Expected move")
    lines.append("")
    if exp:
        lines.append(
            _tbl(
                ["Basis", "Move"],
                [
                    [f"Mean |T+1| (last {exp['n']})", f"±{exp['mean_abs_pct']:.2f}%"],
                    ["Median |T+1|", f"±{exp['median_abs_pct']:.2f}%"],
                    ["Interquartile range", f"±{exp['p25_abs_pct']:.2f}% – ±{exp['p75_abs_pct']:.2f}%"],
                    ["Worst case in window", f"±{exp['max_abs_pct']:.2f}%"],
                    ["ATR(14)", f"±{tech['atr_pct']:.2f}%"],
                    ["20-day realised vol (ann.)", f"{tech['rv20_ann_pct']:.0f}%"],
                ],
            )
        )
        lines.append("")
        lines.append(f"**Working expected move used below: ±{exp['mean_abs_pct']:.2f}%.**")
    else:
        lines.append("_No event history; fall back to ATR._")
        lines.append("")
        lines.append(f"**Working expected move used below: ±{tech['atr_pct']:.2f}% (ATR).**")
    lines.append("")

    # -- technicals -------------------------------------------------------
    lines.append("## 5. Current technical setup")
    lines.append("")
    rows = [
        ["Close", inr(tech["close"])],
        ["SMA20 / 50 / 100 / 200", " / ".join(inr(tech[k]) for k in ("sma20", "sma50", "sma100", "sma200"))],
        ["RSI(14)", f"{tech['rsi14']:.1f}"],
        ["MACD / signal / hist", f"{tech['macd']:.1f} / {tech['macd_signal']:.1f} / {tech['macd_hist']:.1f}"],
        ["ADX / +DI / −DI", f"{tech['adx14']:.1f} / {tech['plus_di']:.1f} / {tech['minus_di']:.1f}"],
        ["Bollinger", f"{inr(tech['bb_lower'])} – {inr(tech['bb_upper'])}"],
        ["52-week range", f"{inr(tech['low_52w'])} – {inr(tech['high_52w'])} ({pct(tech['from_high_pct'], 1)} from high)"],
        ["Last volume vs 20d", f"{tech['vol_x20']:.2f}x"],
    ]
    lines.append(_tbl(["Indicator", "Value"], rows))
    lines.append("")

    # -- scenarios --------------------------------------------------------
    lines.append("## 6. Scenario map")
    lines.append("")
    levels = [
        ("Resistance 2 (60d high)", scen["resistance_2"], "full trend repair"),
        ("Resistance 1 (20d high)", scen["resistance_1"], "event breakout"),
        ("+2× expected", scen["up_2x"], "strong beat + guidance raise"),
        ("+1× expected", scen["up_1x"], "in-line beat"),
        ("Reference close", close, "pre-event"),
        ("Support 1 (20d low)", scen["support_1"], "first defence"),
        ("Support 2 (60d low)", scen["support_2"], "structural support"),
        ("−1× expected", scen["down_1x"], "miss / weak guide"),
        ("−2× expected", scen["down_2x"], "miss + cut"),
    ]
    lines.append(
        _tbl(
            ["Level", "Price", "Meaning"],
            [[name, inr(price), meaning] for name, price, meaning in sorted(levels, key=lambda x: -x[1])],
        )
    )
    lines.append("")

    # -- checklist --------------------------------------------------------
    lines.append("## 7. Pre-event checklist")
    lines.append("")
    for item in [
        "Confirm the **board-meeting date and time** from the BSE/NSE filing (not a data vendor).",
        "Write down **consensus EPS and revenue** before the print; note the tax rate and other-income base.",
        "Check **segment mix**: the high-margin engine vs the low-growth tail (see `references/earnings-play-checklist.md`).",
        "Check **cash conversion**: CFO/EBITDA, working-capital days, receivables/inventory build.",
        "Note **positioning**: FII/DII trend, futures OI, free float, pre-event 20-day run-up.",
        "Mark the **levels**: 20/50/200-DMA, 20/60-day swing high/low, ±1×/±2× expected move.",
        "Pre-commit **invalidation**: price level, thesis level (e.g. segment growth), and time stop (T+3/T+5).",
        "Size for the **gap**, not the intraday range — NSE event gaps routinely exceed ATR.",
    ]:
        lines.append(f"- [ ] {item}")
    lines.append("")
    lines.append("Full procedure: `references/earnings-play-checklist.md`.")
    lines.append("")

    # -- caveats ----------------------------------------------------------
    lines.append("## 8. Caveats")
    lines.append("")
    lines.append(
        "- yfinance timestamps are US-time and occasionally land on a weekend; the script maps every event to the **next NSE session** (T+1). Verify against the exchange filing if the reaction day matters.\n"
        "- `Surprise(%)` is yfinance's EPS surprise vs its own consensus; vendors disagree (a +1% beat can be a PAT miss below the line).\n"
        "- Expected move is backward-looking (last 8 events). It ignores the current option chain and event-specific positioning.\n"
        "- This is research tooling, not investment advice."
    )
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Earnings history + event playbook for an NSE stock")
    ap.add_argument("--symbol", required=True, help="NSE symbol without .NS (e.g. MANKIND)")
    ap.add_argument("--years", type=int, default=3, help="daily history to fetch (default 3)")
    ap.add_argument("--next-date", default=None, help="override next earnings date (YYYY-MM-DD)")
    ap.add_argument("--outdir", default=None, help="output dir (default reports/earnings/<SYMBOL>)")
    ap.add_argument("--no-yf", action="store_true", help="skip yfinance (technicals only)")
    ap.add_argument("--print", action="store_true", help="print markdown to stdout instead of writing")
    args = ap.parse_args(argv)

    symbol = args.symbol.upper()
    print(f"[1/4] daily candles: {symbol}", file=sys.stderr)
    daily = fetch_daily(symbol, args.years)

    earnings = pd.DataFrame(columns=["date", "surprise_pct"])
    calendar: dict[str, Any] = {}
    info: dict[str, Any] = {}
    if not args.no_yf:
        print("[2/4] yfinance: earnings dates + consensus", file=sys.stderr)
        earnings, calendar, info = _yf_earnings(symbol)
    else:
        print("[2/4] yfinance skipped", file=sys.stderr)

    print("[3/4] event study + technicals", file=sys.stderr)
    events = event_reactions(daily, earnings) if not earnings.empty else pd.DataFrame()
    stats = summarize_events(events)
    exp = expected_move_stats(events, n=8)
    tech = compute_technicals(daily)
    expected_pct = exp.get("mean_abs_pct", tech["atr_pct"])
    scen = scenario_levels(tech["close"], expected_pct, daily)
    next_date = _next_event(calendar, events, args.next_date)
    cons = _consensus(calendar, info)
    date_source = "override" if args.next_date else "vendor estimate"

    asof = daily.index[-1].date().isoformat()
    md = render_markdown(symbol, asof, events, stats, exp, tech, scen, next_date, cons, date_source)

    outdir = Path(args.outdir) if args.outdir else ROOT / "reports" / "earnings" / symbol
    if args.print:
        print(md)
        return 0

    outdir.mkdir(parents=True, exist_ok=True)
    print(f"[4/4] writing {outdir}", file=sys.stderr)
    (outdir / f"{symbol}_earnings_history.md").write_text(md, encoding="utf-8")
    if not events.empty:
        events.to_csv(outdir / f"{symbol}_earnings_events.csv", index=False)
    payload = {
        "symbol": symbol,
        "as_of": asof,
        "next_event": next_date,
        "consensus": cons,
        "summary": stats,
        "expected_move": exp,
        "technicals": tech,
        "scenarios": scen,
        "events": events.to_dict(orient="records") if not events.empty else [],
    }
    (outdir / f"{symbol}_earnings_history.json").write_text(
        json.dumps(payload, indent=2, default=str), encoding="utf-8"
    )
    print(f"done → {outdir / f'{symbol}_earnings_history.md'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
