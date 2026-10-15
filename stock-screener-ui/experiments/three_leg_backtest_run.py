"""Three-leg system backtest with full ablation (10 weeks ending 2026-10-09).

Legs: L1 screen only -> L2 screen+catalyst -> L3 screen+catalyst+regime.
Writes ONLY experiments/three_leg_backtest.json and .md. Reads candle cache +
read-only DB (news) + Yahoo Nifty (cached CSV). Never touches db/alphashri.db.
"""
import json
import os
import pickle
import sqlite3
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd

from backtest.costs import calculate_trading_costs
from chart_patterns.detectors.consolidation import detect_consolidation
from chart_patterns.universes import get_universe
from chart_patterns.watch import _near52w_row

EXP = os.path.dirname(__file__)
CACHE_1D = os.path.join(EXP, "data", "pattern_cache", "candles", "1D")
OUT_JSON = os.path.join(EXP, "three_leg_backtest.json")
OUT_MD = os.path.join(EXP, "three_leg_backtest.md")
NIFTY_CSV = os.path.join(EXP, "three_leg_nifty.csv")
DB = os.path.join(os.path.dirname(EXP), "db", "alphashri.db")

NOTIONAL = 100_000.0
SLIP_BPS = 0.0005  # 5 bps per side

WEEK_ENDS = ["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28",
             "2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25",
             "2026-10-02", "2026-10-09"]


def fetch_nifty():
    if os.path.exists(NIFTY_CSV):
        df = pd.read_csv(NIFTY_CSV, parse_dates=["date"])
        if str(df["date"].max().date()) >= "2026-10-09":
            return df
    p1 = int(datetime(2026, 6, 1).timestamp())
    p2 = int(datetime(2026, 10, 12).timestamp())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI"
           f"?interval=1d&period1={p1}&period2={p2}")
    last_err = None
    for i in range(4):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"})
            d = json.load(urllib.request.urlopen(req, timeout=25))
            res = d["chart"]["result"][0]
            ts, q = res["timestamp"], res["indicators"]["quote"][0]
            rows = []
            for t, o, h, l, c in zip(ts, q["open"], q["high"], q["low"], q["close"]):
                if c is None:
                    continue
                dt = datetime.fromtimestamp(t, tz=pd.Timestamp.utcnow().tz).date() \
                    if False else datetime.utcfromtimestamp(t).date()
                rows.append({"date": str(dt), "open": o, "high": h,
                             "low": l, "close": c})
            df = pd.DataFrame(rows)
            df.to_csv(NIFTY_CSV, index=False)
            return pd.read_csv(NIFTY_CSV, parse_dates=["date"])
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(4)
    raise RuntimeError(f"nifty fetch failed: {last_err}")


def load_frame(sym):
    for name in (f"{sym}.v3.pkl", f"{sym}.2026-10-09.v3.pkl",
                 f"{sym}.2026-10-06.v3.pkl", f"{sym}.v2.pkl"):
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                df = pickle.load(open(p, "rb"))
                if df is not None and not df.empty:
                    return df
            except Exception:  # noqa: BLE001
                pass
    return None


def ist_dates(df):
    try:
        return df.index.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return pd.Series([""] * len(df), index=df.index)


def atr14_wilder(setup):
    h = setup["high"].astype(float)
    l = setup["low"].astype(float)
    c = setup["close"].astype(float)
    tr = pd.concat([h - l, (h - c.shift()).abs(),
                    (l - c.shift()).abs()], axis=1).max(axis=1)
    v = tr.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
    return float(v) if np.isfinite(v) else None


def extract_box(hits):
    if not hits:
        return None
    h0 = hits[0]

    def _g(name, default=None):
        try:
            if isinstance(h0, dict):
                return h0.get(name, default)
            return getattr(h0, name, default)
        except Exception:  # noqa: BLE001
            return default

    try:
        tl = _g("trendlines") or []
        lo_px = None
        try:
            if len(tl) >= 2 and tl[1]:
                lo_px = float(tl[1][0].get("price"))
        except Exception:  # noqa: BLE001
            lo_px = None
        if lo_px is None:
            lo_px = float(_g("breakout_level")) * (
                1 - float(_g("range_pct", 0) or 0) / 100)
        return {"high": float(_g("breakout_level")),
                "low": lo_px,
                "base_days": int(_g("base_days", 0) or 0),
                "range_pct": float(_g("range_pct", 0) or 0)}
    except Exception:  # noqa: BLE001
        return None


def screen_symbol(sym, df, setup_end):
    """Setup-only screening. Returns dict with flags or skip reason."""
    dates = ist_dates(df)
    setup = df[dates <= setup_end]
    if len(setup) < 60:
        return {"skip": f"setup-bars-{len(setup)}"}
    ref_close = float(setup["close"].iloc[-1])
    try:
        box = extract_box(detect_consolidation(setup))
    except Exception:  # noqa: BLE001
        box = None
    try:
        acc = _near52w_row(sym, setup)
    except Exception:  # noqa: BLE001
        acc = None
    if not acc:
        return {"skip": "no-accum-row", "box": box}
    c = setup["close"].astype(float)
    ema20 = float(c.ewm(span=20, adjust=False).mean().iloc[-1]) if len(c) >= 20 else None
    ema_ratio = (ref_close / ema20) if ema20 else None
    hi20 = float(setup["high"].tail(20).max())
    dist_box = ((box["high"] - ref_close) / ref_close * 100) if box else None
    dist_20d = (hi20 - ref_close) / ref_close * 100 if hi20 else None
    win60 = setup.tail(60)
    hi60, lo60 = float(win60["high"].max()), float(win60["low"].min())
    mp60 = float(win60["close"].mean())
    range60 = (hi60 - lo60) / mp60 * 100 if mp60 > 0 else None
    obv = acc.get("obv_slope")
    updown = acc.get("updown")
    volr = acc.get("vol_ratio")
    cg = acc.get("close_gap")
    ema_ok = ema_ratio is not None and ema_ratio >= 0.98
    rules = set()
    if (box and box["base_days"] >= 30 and box["range_pct"] <= 12
            and dist_box is not None and dist_box <= 6 and ema_ok
            and (obv is not None and (obv > 0 or (updown or 0) > 1.2))):
        rules.add("A")
    if (cg is not None and cg <= 8 and obv is not None and obv > 0
            and ((updown or 0) >= 1.5 or (volr or 0) >= 1.2) and ema_ok):
        rules.add("B")
    if (box is None and range60 is not None and range60 <= 18
            and dist_20d is not None and dist_20d <= 4
            and (volr or 0) >= 1.0 and ema_ok
            and obv is not None and obv > 0):
        rules.add("C")
    return {"box": box, "rules": sorted(rules),
            "ref_close": round(ref_close, 2),
            "level": round(box["high"], 2) if box else round(hi20, 2),
            "level_kind": ("box" if box else "hi20"),
            "atr": atr14_wilder(setup),
            "close_gap": cg, "obv": obv, "updown": updown, "vol_ratio": volr}


def load_mentions():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT m.symbol_code, m.trading_symbol, substr(a.published_at,1,10) d "
        "FROM news_symbol_mentions m JOIN news_articles a ON a.id=m.article_id "
        "WHERE a.published_at IS NOT NULL").fetchall()
    con.close()
    by_sym = {}
    for code, tsym, d in rows:
        for key in {code, tsym}:
            if key:
                by_sym.setdefault(key, []).append(d)
    for v in by_sym.values():
        v.sort()
    return by_sym


def catalyst_score(by_sym, sym, sessions, setup_date, n=5):
    """# mentions with article date within ±n trading sessions of setup."""
    dates = by_sym.get(sym, [])
    if not dates:
        return 0
    sdates = sorted(sessions)
    try:
        i = sdates.index(setup_date)
    except ValueError:
        return 0
    lo, hi = sdates[max(0, i - n)], sdates[min(len(sdates) - 1, i + n)]
    return sum(1 for d in dates if lo <= d <= hi)


def simulate(scr, week_bars):
    """Returns trade dict or skip reason. week_bars: list of dicts Mon..Fri."""
    level = scr["level"]
    ref_close = scr["ref_close"]
    if ref_close > level:
        return {"skip": "extended"}
    if not week_bars:
        return {"skip": "no-week-bars"}
    mon = week_bars[0]
    if mon["open"] is not None and mon["open"] > ref_close * 1.03:
        return {"skip": "monday-gap"}
    brk_idx = None
    for i, b in enumerate(week_bars):
        if b["high"] is not None and b["high"] > level:
            brk_idx = i
            break
    if brk_idx is None:
        return {"skip": "no-break"}
    if brk_idx + 1 >= len(week_bars):
        return {"skip": "break-friday-no-next-bar"}
    entry = week_bars[brk_idx + 1]["open"]
    if entry is None or entry <= 0:
        return {"skip": "no-entry-open"}
    atr = scr["atr"]
    if atr is None or atr <= 0:
        return {"skip": "no-atr"}
    box = scr["box"]
    if box and entry > box["low"]:
        risk = min(entry - box["low"], atr)
    else:
        risk = atr
    if risk <= 0:
        return {"skip": "no-risk"}
    sl = entry - risk
    tgt = entry + 2 * risk
    qty = int(NOTIONAL // entry)
    if qty <= 0:
        return {"skip": "qty-zero"}
    exit_px, why = None, None
    for b in week_bars[brk_idx + 1:]:
        hit_sl = b["low"] is not None and b["low"] <= sl
        hit_tg = b["high"] is not None and b["high"] >= tgt
        if hit_sl and hit_tg:
            exit_px, why = sl, "SL-same-bar"
            break
        if hit_sl:
            exit_px, why = sl, "SL"
            break
        if hit_tg:
            exit_px, why = tgt, "TARGET"
            break
    if exit_px is None:
        exit_px, why = week_bars[-1]["close"], "TIME-Friday"
    gross = (exit_px - entry) * qty
    costs = calculate_trading_costs(entry, exit_px, qty)["total_costs"]
    e_s = entry * (1 + SLIP_BPS)
    x_s = exit_px * (1 - SLIP_BPS)
    gross_s = (x_s - e_s) * qty
    costs_s = calculate_trading_costs(e_s, x_s, qty)["total_costs"]
    return {"entry": round(entry, 2), "exit": round(exit_px, 2),
            "qty": qty, "sl": round(sl, 2), "tgt": round(tgt, 2),
            "why": why, "gross": round(gross, 2), "costs": costs,
            "net": round(gross - costs, 2),
            "gross_slip": round(gross_s, 2), "costs_slip": costs_s,
            "net_slip": round(gross_s - costs_s, 2),
            "entry_day": week_bars[brk_idx + 1]["date"],
            "break_day": week_bars[brk_idx]["date"]}


def metrics(trades):
    n = len(trades)
    if n == 0:
        return {"trades": 0, "wins": 0, "win_pct": None, "gross": 0.0,
                "costs": 0.0, "net": 0.0, "net_slip": 0.0, "pf": None,
                "expectancy": None, "maxDD": 0.0}
    nets = [t["net"] for t in trades]
    gp = sum(t["gross"] for t in trades if t["gross"] > 0)
    gl = -sum(t["gross"] for t in trades if t["gross"] < 0)
    eq, peak, mdd = 0.0, 0.0, 0.0
    for v in nets:
        eq += v
        peak = max(peak, eq)
        mdd = max(mdd, peak - eq)
    return {"trades": n, "wins": sum(1 for t in trades if t["net"] > 0),
            "win_pct": round(100 * sum(1 for t in trades if t["net"] > 0) / n, 1),
            "gross": round(sum(t["gross"] for t in trades), 2),
            "costs": round(sum(t["costs"] for t in trades), 2),
            "net": round(sum(nets), 2),
            "net_slip": round(sum(t["net_slip"] for t in trades), 2),
            "pf": round(gp / gl, 2) if gl > 0 else None,
            "expectancy": round(sum(nets) / n, 2),
            "maxDD": round(mdd, 2)}


def main():
    nifty = fetch_nifty()
    nifty["date"] = pd.to_datetime(nifty["date"]).dt.strftime("%Y-%m-%d")
    nifty["dma20"] = nifty["close"].rolling(20).mean()
    nifty = nifty.set_index("date")
    sessions = sorted(nifty.index.tolist())
    by_sym = load_mentions()
    uni = get_universe("nifty500")
    print(f"universe={len(uni)} nifty_bars={len(nifty)}", flush=True)

    frames = {}
    for s in uni:
        df = load_frame(s)
        if df is not None:
            frames[s] = df
    print(f"cached={len(frames)}", flush=True)

    weeks = []
    for wend in WEEK_ENDS:
        fri = date.fromisoformat(wend)
        mon = fri - timedelta(days=4)
        wdays = [(mon + timedelta(days=i)).isoformat() for i in range(5)]
        # setup date: latest session strictly before Monday with broad coverage
        cands = [d for d in sessions if d < wdays[0]]
        setup_date = cands[-1] if cands else None
        # regime as of setup close
        nclose = float(nifty.loc[setup_date, "close"])
        dma = float(nifty.loc[setup_date, "dma20"])
        prev = [d for d in sessions if d < setup_date][-5:]
        prev_close = float(nifty.loc[prev[0], "close"]) if len(prev) == 5 else None
        wk_chg = (nclose / prev_close - 1) * 100 if prev_close else None
        regime_ok = bool(wk_chg is not None and wk_chg > -1.0
                         and dma == dma and nclose > dma)
        weeks.append({"week_end": wend, "mon_fri": wdays,
                      "setup_date": setup_date,
                      "nifty_close": round(nclose, 1), "nifty_dma20": round(dma, 1),
                      "nifty_wk_chg": round(wk_chg, 2) if wk_chg is not None else None,
                      "regime_long_ok": regime_ok})
    print(json.dumps(
        [{"w": w["week_end"], "setup": w["setup_date"],
          "chg": w["nifty_wk_chg"], "reg": w["regime_long_ok"]} for w in weeks]),
        flush=True)

    all_weeks = []
    pooled = {"L1": [], "L2": [], "L3": []}
    killed = []  # L1 trades killed by catalyst
    for w in weeks:
        setup_date, wdays = w["setup_date"], w["mon_fri"]
        wrec = dict(w)
        leg_trades = {"L1": [], "L2": [], "L3": []}
        n_screen = 0
        for sym, df in frames.items():
            scr = screen_symbol(sym, df, setup_date)
            if scr.get("skip") or not scr.get("rules"):
                continue
            n_screen += 1
            dates = ist_dates(df)
            sub = df[dates.isin(wdays)]
            wb = []
            subdates = ist_dates(sub)
            for d in wdays:
                bars = sub[subdates == d] if len(sub) else sub.iloc[0:0]
                if len(bars) == 0:
                    continue
                b = bars.iloc[-1]
                o = bars.iloc[0]["open"] if len(bars) else b["open"]
                wb.append({"date": d, "open": float(o), "high": float(b["high"]),
                           "low": float(b["low"]), "close": float(b["close"])})
            score = catalyst_score(by_sym, sym, sessions, setup_date)
            tr = simulate(scr, wb)
            if tr.get("skip"):
                continue
            tr.update({"symbol": sym, "rules": scr["rules"],
                       "setup": setup_date, "week": w["week_end"],
                       "catalyst": score})
            leg_trades["L1"].append(tr)
            if score >= 1:
                leg_trades["L2"].append(tr)
            else:
                killed.append(tr)
            if score >= 1 and w["regime_long_ok"]:
                leg_trades["L3"].append(tr)
        wrec["n_screen_signals"] = n_screen
        wrec["legs"] = {k: {"trades": v, "m": metrics(v)}
                        for k, v in leg_trades.items()}
        all_weeks.append(wrec)
        for k in pooled:
            pooled[k].extend(leg_trades[k])
        print(f'{w["week_end"]}: screen={n_screen} '
              + " ".join(f'{k}={len(v)}' for k, v in leg_trades.items()),
              flush=True)

    out = {"meta": {
        "notional": NOTIONAL, "slip_bps_per_side": SLIP_BPS * 1e4,
        "rules": "A/B/C per missed_breakouts_week42.md s4; entry=first high>level, next-bar open; "
                 "Mon open>setup*1.03 skip; SL=min(entry-boxlow,ATR14) else ATR14; tgt=2R; "
                 "same-bar SL+TG=SL; exit Fri close; costs=calculate_trading_costs every trade",
        "catalyst": "count(news_symbol_mentions join articles, trading_symbol OR symbol_code) "
                    "with article date within +-5 Nifty sessions of setup; pass>=1",
        "regime": "Nifty wk_chg (setup vs 5 sessions prior) > -1% AND setup close > 20DMA; "
                  "skip whole week if false",
        "assumptions": [
            "published_at date part treated as IST calendar date",
            "catalyst window is symmetric +-5 sessions (peeks into outcome week; live use prior-5 only)",
            "SL filled exactly at level, target exactly at level; same-bar conflict = SL (conservative)",
            "qty=floor(1L/entry) at quoted prices; slippage 5bps/side via price adjust + recomputed costs",
            "no-box SL = 1xATR14 below entry; box SL uses quoted entry (not setup close)",
            "per-week maxDD = peak-to-trough of cumulative net within week (order = week_end, symbol)",
        ]},
        "weeks": all_weeks,
        "pooled": {k: {"trades": v, "m": metrics(v)} for k, v in pooled.items()},
        "killed_by_catalyst": {"trades": killed, "m": metrics(killed)},
        "regime_skipped_weeks": [w["week_end"] for w in all_weeks
                                 if not w["regime_long_ok"]]}
    json.dump(out, open(OUT_JSON, "w"), indent=1)
    print("wrote", OUT_JSON, len(pooled["L1"]), len(pooled["L2"]), len(pooled["L3"]))


if __name__ == "__main__":
    main()
