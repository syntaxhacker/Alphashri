"""Three-leg trading-system study dataset (experiment code, NOT prod).

Legs per symbol x week W (setup = Friday close of W-1, outcome = week W):
  1. SCREEN: post-mortem v2 screen (see META screen_v2) on bars with
     IST session date <= setup session. Reuses
     chart_patterns.detectors.consolidation.detect_consolidation and
     chart_patterns.watch._near52w_row (imported, not copied).
  2. CATALYST: read-only SQLite news_symbol_mentions join news_articles:
     mentions in the 5 trading sessions strictly before the setup session,
     + firm-specific keyword flag on the headline.
  3. REGIME: Nifty 50 setup-session state (yfinance ^NSEI, local CSV cache;
     ^INDIAVIX best-effort, null when unavailable).
Outcome: break of the setup box/20d-high during W, MFE, week return,
break-day volume ratio.

Rerunnable + resumable: per-week rows cached under
experiments/three_leg_cache/three_leg_week_{n}.json; completed weeks are
skipped unless --force. Writes ONLY experiments/three_leg_dataset.json +
experiments/three_leg_cache/. Reads candles ONLY from the local 1D pattern
cache (no network for equities) and the DB in read-only mode.

Usage:
  python experiments/three_leg_dataset_run.py [--force] [--weeks 9,10]
      [--symbols RELIANCE,INFY] [--limit 20]
"""

import argparse
import json
import os
import pickle
import sqlite3
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_1D = os.path.join(HERE, "data", "pattern_cache", "candles", "1D")
OUT_DIR = os.path.join(HERE, "three_leg_cache")
OUT_JSON = os.path.join(HERE, "three_leg_dataset.json")
DB_PATH = os.path.join(HERE, "..", "db", "alphashri.db")

from chart_patterns.detectors.consolidation import detect_consolidation  # noqa: E402
from chart_patterns.universes import get_universe  # noqa: E402
from chart_patterns.watch import _near52w_row  # noqa: E402

# ---------------------------------------------------------------------------
# Weeks: 10 completed outcome weeks ending Fri 2026-10-09.
# Calendar rule: Mon-Fri sessions minus NSE 2026 trading holidays
# (trading/holidays_seed.py TRADING_HOLIDAYS_2026: 2026-09-14 Ganesh
# Chaturthi, 2026-10-02 Gandhi Jayanti fall in this window).
# trading.calendar.is_trading_day was tried but its DB-backed
# is_trading_holiday() returns False for both holidays in this env (empty
# market_holidays table), so the seed list + weekday logic is authoritative
# here; discrepancies vs trading.calendar are logged, not fatal.
# ---------------------------------------------------------------------------
try:
    from trading.holidays_seed import TRADING_HOLIDAYS_2026 as _SEED_HOLIDAYS

    _HOLIDAYS = {d for d, _ in _SEED_HOLIDAYS}
except Exception:
    _HOLIDAYS = {date(2026, 9, 14), date(2026, 10, 2)}


def _is_session(d: date) -> bool:
    return d.weekday() < 5 and d not in _HOLIDAYS


def _sessions(lo: str, hi: str) -> list:
    out, d = [], date.fromisoformat(lo)
    end = date.fromisoformat(hi)
    while d <= end:
        if _is_session(d):
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def build_weeks() -> list:
    """Derive the 10 outcome weeks + setup sessions programmatically."""
    try:
        from trading.calendar import is_trading_day as _cal_day

        for d in sorted(_HOLIDAYS):
            if _cal_day(d):
                print(f"  note: trading.calendar disagrees on holiday {d} (DB empty?)")
    except Exception as exc:
        print(f"  note: trading.calendar unusable ({exc}); seed+weekday logic used")
    fridays = []
    d = date(2026, 7, 31)
    while d <= date(2026, 10, 9):
        if d.weekday() == 4:  # Friday
            fridays.append(d)
        d += timedelta(days=1)
    # 10 outcome weeks: W1..W9 end on their Friday; W10 ends Fri 2026-10-09.
    # Setup session = last session on/before the prior Friday (Oct-2 setup
    # Friday is a holiday -> effective setup Thu 2026-10-01).
    outcome_starts = [date(2026, 8, 3) + timedelta(weeks=i) for i in range(10)]
    weeks = []
    for i, mon in enumerate(outcome_starts):
        fri = mon + timedelta(days=4)
        days = _sessions(mon.isoformat(), fri.isoformat())
        if i == 0:
            setup_fri = date(2026, 7, 31)
        else:
            setup_fri = outcome_starts[i - 1] + timedelta(days=4)
        setup_sessions = _sessions(
            (setup_fri - timedelta(days=7)).isoformat(), setup_fri.isoformat()
        )
        setup_session = setup_sessions[-1]
        before = [s for s in _sessions("2026-07-01", setup_session)
                  if s < setup_session][-5:]
        weeks.append({
            "n": i + 1,
            "outcome": days,
            "outcome_friday": fri.isoformat(),
            "setup_friday": setup_fri.isoformat(),
            "setup_session": setup_session,  # last tradeable session <= setup Friday
            "catalyst_sessions": before,     # 5 sessions strictly before setup
        })
    return weeks


WEEKS = build_weeks()

SCREEN_V2 = ("A: box & base>=30d & range<=12% & dist_box<=6% & ema20x>=0.98 & "
             "(obv>0|ud>1.2); B: close_gap<=8% & obv>0 & (ud>=1.5|vr>=1.2) & "
             "ema20x>=0.98; C: no box & range60<=18% & dist_20d<=4% & vr>=1.0 "
             "(mission-literal; ema20x/obv recorded for the stricter variant)")

FIRM_KEYWORDS = ("result", "update", "guidance", "order", "upgrade",
                 "qip", "contract", "stake")

_frame_cache: dict = {}


def load_frame(sym: str):
    if sym in _frame_cache:
        return _frame_cache[sym]
    for name in (f"{sym}.v3.pkl", f"{sym}.v2.pkl"):
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                df = pickle.load(open(p, "rb"))
                if df is not None and not df.empty:
                    _frame_cache[sym] = (df, name)
                    return df, name
            except Exception:
                pass
    # dated variants (older snapshots; must still cover the week)
    cands = sorted((f for f in os.listdir(CACHE_1D)
                    if f.startswith(sym + ".") and f.endswith(".pkl")
                    and ".lb" not in f and ".meta" not in f),
                   reverse=True)
    for name in cands:
        try:
            df = pickle.load(open(os.path.join(CACHE_1D, name), "rb"))
            if df is not None and not df.empty:
                _frame_cache[sym] = (df, name)
                return df, name
        except Exception:
            pass
    _frame_cache[sym] = (None, None)
    return None, None


def ist_dates(df) -> pd.Series:
    try:
        return df.index.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")
    except Exception:
        return pd.Series([""] * len(df), index=df.index)


def trailing_range(setup, w):
    try:
        win = setup.tail(w)
        if len(win) < 20:
            return None, None
        hi = float(win["high"].max())
        lo = float(win["low"].min())
        mp = float(win["close"].mean())
        if not mp > 0:
            return None, None
        return (round((hi - lo) / mp * 100, 2),
                round((float(win["close"].iloc[-1]) - float(win["close"].iloc[0]))
                      / mp * 100, 2))
    except Exception:
        return None, None


def screen_symbol(df, setup_end: str) -> dict | None:
    """Screen leg on bars with IST date <= setup_end. None if unusable."""
    dates = ist_dates(df)
    setup = df[dates <= setup_end]
    if len(setup) < 60:
        return None
    ref_close = float(setup["close"].iloc[-1])
    try:
        hits = detect_consolidation(setup)
    except Exception:
        hits = []
    box = None
    if hits:
        h0 = hits[0]

        def _g(name, default=None):
            try:
                return h0.get(name, default) if isinstance(h0, dict) \
                    else getattr(h0, name, default)
            except Exception:
                return default

        try:
            tl = _g("trendlines") or []
            lo_px = None
            try:
                if len(tl) >= 2 and tl[1]:
                    lo_px = float(tl[1][0].get("price"))
            except Exception:
                lo_px = None
            if lo_px is None:
                lo_px = float(_g("breakout_level")) * (
                    1 - float(_g("range_pct", 0) or 0) / 100)
            box = {"high": round(float(_g("breakout_level")), 2),
                   "low": round(lo_px, 2),
                   "base_days": int(_g("base_days", 0) or 0),
                   "range_pct": round(float(_g("range_pct", 0) or 0), 2)}
        except Exception:
            box = None
    try:
        acc = _near52w_row("SYM", setup)
    except Exception:
        acc = None
    gauges = None
    if acc:
        gauges = {k: (round(v, 3) if isinstance(v, float) else v)
                  for k, v in acc.items()
                  if k in ("trigger_level", "high_gap", "close_gap",
                           "obv_slope", "updown", "vol_ratio", "touched")}
    try:
        c = setup["close"].astype(float)
        ema20 = float(c.ewm(span=20, adjust=False).mean().iloc[-1])
    except Exception:
        ema20 = None
    try:
        hi20 = float(setup["high"].tail(20).max())
        av20 = float(setup["volume"].tail(20).mean())
    except Exception:
        hi20, av20 = None, None
    ema20x = round(ref_close / ema20, 4) if ema20 else None
    dist_box = round((box["high"] - ref_close) / ref_close * 100, 2) \
        if box else None
    dist_20d = round((hi20 - ref_close) / ref_close * 100, 2) if hi20 else None
    r60, _d60 = trailing_range(setup, 60)
    obv = gauges["obv_slope"] if gauges else None
    ud = gauges["updown"] if gauges else None
    vr = gauges["vol_ratio"] if gauges else None
    cg = gauges["close_gap"] if gauges else None

    leg_a = bool(box and box["base_days"] >= 30 and box["range_pct"] <= 12.0
                 and dist_box is not None and dist_box <= 6.0
                 and ema20x is not None and ema20x >= 0.98
                 and obv is not None and ud is not None
                 and (obv > 0 or ud > 1.2))
    leg_b = bool(cg is not None and cg <= 8.0
                 and obv is not None and obv > 0
                 and ((ud is not None and ud >= 1.5)
                      or (vr is not None and vr >= 1.2))
                 and ema20x is not None and ema20x >= 0.98)
    leg_c = bool(box is None and r60 is not None and r60 <= 18.0
                 and dist_20d is not None and dist_20d <= 4.0
                 and vr is not None and vr >= 1.0)
    return {"ref_close": round(ref_close, 2), "box": box, "gauges": gauges,
            "ema20": round(ema20, 2) if ema20 else None, "ema20x": ema20x,
            "hi20": round(hi20, 2) if hi20 else None,
            "avgvol20": round(av20) if av20 else None,
            "dist_box_pct": dist_box, "dist_20d_pct": dist_20d,
            "range60_pct": r60, "leg_a": leg_a, "leg_b": leg_b,
            "leg_c": leg_c, "screened": bool(leg_a or leg_b or leg_c)}


def outcome(df, scr: dict, week_days: list) -> dict:
    dates = ist_dates(df)
    week = df[dates.isin(week_days)]
    wk = []
    for d in week_days:
        bars = week[ist_dates(week) == d]
        if len(bars) == 0:
            continue
        b = bars.iloc[-1]
        wk.append({"date": d, "close": float(b["close"]),
                   "high": float(b["high"]), "vol": float(b["volume"])})
    ref_close = scr["ref_close"]
    ref_level = scr["box"]["high"] if scr["box"] else scr["hi20"]
    ref_kind = "box" if scr["box"] else "hi20"
    already_above = bool(ref_level and ref_close > ref_level)
    first_break = None
    if not already_above:
        for b in wk:
            if ref_level and b["close"] > ref_level:
                first_break = b["date"]
                break
    maxhi = max((b["high"] for b in wk), default=None)
    mfe = round((maxhi - ref_close) / ref_close * 100, 2) if maxhi else None
    fri = wk[-1]["close"] if wk else None
    wkret = round((fri - ref_close) / ref_close * 100, 2) if fri else None
    brvol = None
    if first_break:
        for b in wk:
            if b["date"] == first_break and scr["avgvol20"]:
                brvol = round(b["vol"] / scr["avgvol20"], 2)
                break
    broke = first_break is not None
    cls = ("extended" if already_above else
           "no_break" if not broke else
           "broke_monday" if first_break == week_days[0] else "broke_midweek")
    return {"ref_level": round(ref_level, 2) if ref_level else None,
            "ref_kind": ref_kind, "already_above": already_above,
            "week_days": [b["date"] for b in wk], "first_break": first_break,
            "class": cls, "mfe_pct": mfe, "week_ret_pct": wkret,
            "break_volx": brvol}


# ---------------------------------------------------------------------------
# Catalyst leg (read-only DB)
# ---------------------------------------------------------------------------
def load_catalyst_index() -> dict:
    """{(SYM, date): [headlines]} for the study window. Read-only open."""
    uri = f"file:{os.path.abspath(DB_PATH)}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    try:
        q = ("SELECT UPPER(COALESCE(NULLIF(m.trading_symbol,''), m.symbol_code)), "
             "substr(a.published_at,1,10), a.headline "
                 "FROM news_symbol_mentions m JOIN news_articles a "
                 "ON a.id = m.article_id "
                 "WHERE a.published_at >= '2026-07-20' "
                 "AND a.published_at < '2026-10-10'")
        idx: dict = {}
        for sym, d, hl in con.execute(q):
            if not sym or not d:
                continue
            idx.setdefault((sym, d), []).append(hl or "")
        return idx
    finally:
        con.close()


def catalyst(sym: str, sessions: list, idx: dict) -> dict:
    headlines = []
    for s in sessions:
        headlines.extend(idx.get((sym, s), []))
    firm = any(any(k in (h or "").lower() for k in FIRM_KEYWORDS)
               for h in headlines)
    score = 2 if firm else (1 if headlines else 0)
    return {"sessions": sessions, "mentions": len(headlines),
            "firm_kw": bool(firm), "catalyst_score": score}


# ---------------------------------------------------------------------------
# Regime leg (yfinance ^NSEI / ^INDIAVIX, CSV-cached)
# ---------------------------------------------------------------------------
def index_frame(ticker: str, start="2026-05-01", end="2026-10-12") -> pd.DataFrame:
    path = os.path.join(OUT_DIR, ticker.strip("^").lower() + "_1d.csv")
    if os.path.exists(path):
        try:
            df = pd.read_csv(path, parse_dates=["Date"])
            df["Date"] = pd.to_datetime(df["Date"]).dt.date
            if len(df) > 40:
                return df
        except Exception:
            pass
    import yfinance as yf

    df = yf.download(ticker, start=start, end=end, progress=False,
                     auto_adjust=False)
    if df is None or df.empty:
        raise RuntimeError(f"yfinance empty for {ticker}")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.reset_index()
    flat = pd.DataFrame({"Date": pd.to_datetime(df["Date"]).dt.date,
                         "close": pd.to_numeric(df["Close"], errors="coerce")})
    flat = flat.dropna().sort_values("Date")
    os.makedirs(OUT_DIR, exist_ok=True)
    flat.assign(Date=pd.to_datetime(flat["Date"]).dt.strftime("%Y-%m-%d")) \
        .to_csv(path, index=False)
    return flat


def regime(week: dict, nifty: pd.DataFrame, vix: pd.DataFrame | None) -> dict:
    setup = week["setup_session"]
    px = nifty[nifty["Date"] <= date.fromisoformat(setup)].copy()
    close = float(px["close"].iloc[-1])
    dma20 = float(px["close"].tail(20).mean())
    dma50 = float(px["close"].tail(50).mean()) if len(px) >= 50 else None
    prev_fri = (date.fromisoformat(week["setup_friday"]) - timedelta(days=7)) \
        .isoformat()
    prev = nifty[nifty["Date"] <= date.fromisoformat(prev_fri)]
    prev_close = float(prev["close"].iloc[-1]) if len(prev) else None
    wchg = round((close / prev_close - 1) * 100, 2) if prev_close else None
    vix_px = None
    if vix is not None:
        vv = vix[vix["Date"] <= date.fromisoformat(setup)]
        if len(vv):
            vix_px = round(float(vv["close"].iloc[-1]), 2)
    ok = bool(wchg is not None and wchg > -1.0 and close > dma20)
    return {"index": "^NSEI", "setup_close": round(close, 2),
            "prev_friday_close": round(prev_close, 2) if prev_close else None,
            "weekly_change_pct": wchg, "dma20": round(dma20, 2),
            "dma50": round(dma50, 2) if dma50 else None,
            "above_dma20": bool(close > dma20),
            "above_dma50": bool(dma50 and close > dma50),
            "vix": vix_px, "regime_long_ok": ok}


def week_cache_path(n: int) -> str:
    return os.path.join(OUT_DIR, f"three_leg_week_{n}.json")


def run_week(week: dict, universe: list, cat_idx: dict, nifty, vix,
             symbols=None, limit=None) -> list:
    rows = []
    syms = [s for s in universe if symbols is None or s in symbols]
    if limit:
        syms = syms[:limit]
    reg = regime(week, nifty, vix)
    for sym in syms:
        df, src = load_frame(sym)
        if df is None:
            rows.append({"symbol": sym, "week": week["n"], "skip": "no-cache"})
            continue
        scr = screen_symbol(df, week["setup_session"])
        if scr is None:
            rows.append({"symbol": sym, "week": week["n"],
                         "skip": "setup-bars<60"})
            continue
        out = outcome(df, scr, week["outcome"])
        cat = catalyst(sym, week["catalyst_sessions"], cat_idx)
        rows.append({"symbol": sym, "week": week["n"],
                     "setup_session": week["setup_session"],
                     "cache": src, "screen": scr, "catalyst": cat,
                     "regime": reg, "outcome": out})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--weeks", default="")
    ap.add_argument("--symbols", default="")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    want_weeks = {int(x) for x in args.weeks.split(",") if x.strip()} \
        or {w["n"] for w in WEEKS}
    symbols = {s.strip().upper() for s in args.symbols.split(",")
               if s.strip()} or None

    universe = get_universe("nifty500")
    print(f"universe nifty500 n={len(universe)}", flush=True)
    for w in WEEKS:
        print(f"W{w['n']}: setup_session={w['setup_session']} "
              f"(setup_friday={w['setup_friday']}) outcome={w['outcome']} "
              f"catalyst={w['catalyst_sessions']}", flush=True)

    print("loading catalyst index (ro)...", flush=True)
    cat_idx = load_catalyst_index()
    print(f"  keys={len(cat_idx)}", flush=True)
    print("loading index frames...", flush=True)
    nifty = index_frame("^NSEI")
    try:
        vix = index_frame("^INDIAVIX")
    except Exception as exc:
        print(f"  VIX unavailable ({exc}); vix=null", flush=True)
        vix = None

    all_rows = []
    for w in WEEKS:
        if w["n"] not in want_weeks:
            if os.path.exists(week_cache_path(w["n"])):
                all_rows.extend(json.load(open(week_cache_path(w["n"]))))
            continue
        if os.path.exists(week_cache_path(w["n"])) and not args.force \
                and symbols is None and not args.limit:
            print(f"W{w['n']}: cached, skipping", flush=True)
            all_rows.extend(json.load(open(week_cache_path(w["n"]))))
            continue
        print(f"W{w['n']}: screening...", flush=True)
        rows = run_week(w, universe, cat_idx, nifty, vix,
                        symbols=symbols, limit=args.limit or None)
        if symbols is None and not args.limit:
            json.dump(rows, open(week_cache_path(w["n"]), "w"))
            print(f"  wrote {week_cache_path(w['n'])} n={len(rows)}",
                  flush=True)
        all_rows.extend(rows)

    if symbols is None and not args.limit:
        payload = {
            "meta": {
                "weeks": WEEKS,
                "universe": "nifty500",
                "screen_v2": SCREEN_V2,
                "firm_keywords": list(FIRM_KEYWORDS),
                "catalyst_rule": "mentions in 5 sessions strictly before "
                                 "setup_session; score 0=none,1=mention,"
                                 "2=firm keyword in headline",
                "regime_rule": "regime_long_ok = weekly_change_pct > -1.0 "
                               "AND setup_close > dma20 (Nifty ^NSEI; "
                               "weekly_change vs prior-Friday close)",
                "outcome_rule": "break = first outcome-day close > "
                                "setup box high (or 20d high if no box); "
                                "MFE = max outcome high vs setup close; "
                                "week_ret = last outcome close vs setup close",
                "calendar_note": "sessions = Mon-Fri minus NSE 2026 trading "
                                 "holidays (seed list; Sep-14, Oct-2). "
                                 "trading.calendar DB-backed check disagrees "
                                 "in this env (empty market_holidays).",
                "lookahead_note": "screen uses ONLY bars with IST date <= "
                                  "setup_session; frames sliced per week.",
            },
            "rows": all_rows,
        }
        json.dump(payload, open(OUT_JSON, "w"))
        n_scr = sum(1 for r in all_rows if r.get("screen", {}).get("screened"))
        print(f"wrote {OUT_JSON} rows={len(all_rows)} screened={n_scr}",
              flush=True)


if __name__ == "__main__":
    main()
