"""Independent adversarial verification: pattern + MA/ADX/momentum profitability.

Protocol (frozen for ALL candidates, documented in pattern_verify_week42.md):
- Universe: static nifty500 constituents (501). Fetch failures / <60 bars -> skipped+counted.
- Timeframe 1D. Signal uses ONLY bars with IST session date <= signal date
  (signal dates: 2026-09-18, 2026-09-25, 2026-10-01 = last trading session
  before each test week; Oct 2 is a Gandhi Jayanti holiday).
- Entry: NEXT trading session OPEN + 5bps adverse slippage.
- Exits over the following week (Mon..Fri trading sessions only):
  per daily bar, if low<=SL -> stop (exit SL-5bps); elif high>=TP -> target
  (exit TP-5bps). Same-bar both touched -> STOP first (conservative).
  Still open Friday -> exit at close-5bps. Open<=SL at entry -> exit at open.
- Qty = floor(100000/entry), min 1. Costs via backtest/costs.py every trade.
- Long only.

Stages: fetch | signals | backtest | report. Intermediate JSON in experiments/.
Usage:
  .venv/bin/python experiments/verify_week42.py --stage fetch [--limit N]
  .venv/bin/python experiments/verify_week42.py --stage signals [--limit N]
  .venv/bin/python experiments/verify_week42.py --stage backtest
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

EXP = Path(__file__).resolve().parent
FRAMES_PKL = EXP / "verify_frames.pkl"
SIGNALS_JSON = EXP / "verify_signals.json"
TRADES_JSON = EXP / "verify_trades.json"

SIGNAL_DATES = ["2026-09-18", "2026-09-25", "2026-10-01"]
WEEKS = {
    "W-2": ("2026-09-18", "2026-09-21", "2026-09-25"),
    "W-1": ("2026-09-25", "2026-09-28", "2026-10-01"),
    "W0": ("2026-10-01", "2026-10-05", "2026-10-09"),
}
NOTIONAL = 100_000
SLIP = 0.0005  # 5 bps adverse on every fill

import pandas as pd  # noqa: E402


# ---------------------------------------------------------------- indicators
def _wilder(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(alpha=1.0 / n, min_periods=n, adjust=False).mean()


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    c, h, l, v = d["close"].astype(float), d["high"].astype(float), d["low"].astype(float), d["volume"].astype(float)
    pc = c.shift(1)
    tr = pd.concat([(h - l), (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    d["ATR"] = _wilder(tr, 14)
    d["EMA20"] = c.ewm(span=20, min_periods=20, adjust=False).mean()
    d["EMA50"] = c.ewm(span=50, min_periods=50, adjust=False).mean()
    up, dn = h.diff(), -l.diff()
    plus_dm = pd.Series(0.0, index=d.index)
    minus_dm = pd.Series(0.0, index=d.index)
    plus_dm[(up > dn) & (up > 0)] = up[(up > dn) & (up > 0)]
    minus_dm[(dn > up) & (dn > 0)] = dn[(dn > up) & (dn > 0)]
    str_ = _wilder(tr, 14)
    pdi = 100 * _wilder(plus_dm, 14) / str_
    mdi = 100 * _wilder(minus_dm, 14) / str_
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, float("nan"))
    d["ADX"] = _wilder(dx, 14)
    d["PDI"], d["MDI"] = pdi, mdi
    delta = c.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    rs = _wilder(gain, 14) / _wilder(loss, 14).replace(0, float("nan"))
    d["RSI"] = 100 - 100 / (1 + rs)
    d["HH20"] = c.shift(1).rolling(20).max()
    d["LL20"] = l.shift(1).rolling(20).min()
    d["VOL20"] = v.shift(1).rolling(20).mean()
    d["VOL5"] = v.shift(1).rolling(5).mean()
    return d


# ---------------------------------------------------------------- data
def ist_date_str(ts) -> str:
    t = pd.Timestamp(ts)
    if t.tz is None:
        t = t.tz_localize("UTC")
    return t.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")


def fetch_all(symbols: list[str], workers: int = 8) -> dict:
    from chart_patterns import candles

    out: dict[str, object] = {}
    lock = threading.Lock()

    def one(sym: str):
        try:
            df = candles.fetch_for_timeframe(sym, "1D")
        except Exception as e:
            return sym, ("error", str(e)[:120])
        if df is None or getattr(df, "empty", True):
            return sym, ("empty", "")
        try:
            keep = [c for c in ["open", "high", "low", "close", "volume"] if c in df.columns]
            df2 = df[keep].copy()
            df2["sess"] = [ist_date_str(t) for t in df2.index]
        except Exception as e:
            return sym, ("error", str(e)[:120])
        return sym, ("ok", df2)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(one, s): s for s in symbols}
        for i, f in enumerate(as_completed(futs)):
            sym, res = f.result()
            with lock:
                out[sym] = res
            if (i + 1) % 100 == 0:
                print(f"  fetch {i+1}/{len(symbols)}", flush=True)
    return out


def truncate(df: pd.DataFrame, signal_date: str) -> pd.DataFrame:
    return df[df["sess"] <= signal_date].drop(columns=["sess"])


def week_bars(df: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    m = (df["sess"] >= start) & (df["sess"] <= end)
    return df[m]


# ---------------------------------------------------------------- signals
def pattern_signals(sym: str, tdf: pd.DataFrame) -> list[dict]:
    from chart_patterns import engine as engine_mod

    try:
        hits = engine_mod.detect_patterns(tdf, "1D", sym) or []
    except Exception:
        return []
    out = []
    for h in hits:
        try:
            if isinstance(h, dict):
                d = dict(h)
            elif hasattr(h, "to_dict"):
                d = h.to_dict()
            else:
                import dataclasses
                d = dataclasses.asdict(h) if dataclasses.is_dataclass(h) else dict(h)
        except Exception:
            continue
        out.append(d)
    return out


def indicator_signals(sym: str, tdf: pd.DataFrame) -> dict[str, dict | None]:
    """Return {strategy_id: signal-dict or None} using closed-bar data only."""
    if len(tdf) < 60:
        return {}
    d = add_indicators(tdf)
    last = d.iloc[-1]
    sig: dict[str, dict | None] = {"I-EMA": None, "I-ADX": None, "I-ACC": None, "I-RSI": None}
    atr = float(last["ATR"])
    if not (math.isfinite(atr) and atr > 0):
        return sig
    close = float(last["close"])

    def base(extra: dict) -> dict:
        s = {"symbol": sym, "entry_ref": close, "atr": atr,
             "adx": f(last, "ADX"), "rsi": f(last, "RSI"),
             "ema20": f(last, "EMA20"), "ema50": f(last, "EMA50")}
        s.update(extra)
        return s

    # I-EMA: stack + 20d-high breakout
    if (math.isfinite(f(last, "EMA20")) and math.isfinite(f(last, "EMA50"))
            and close > f(last, "EMA20") > f(last, "EMA50")
            and math.isfinite(f(last, "HH20")) and close > f(last, "HH20")):
        sig["I-EMA"] = base({"sl": close - 1.0 * atr, "tp": close + 2.0 * atr,
                             "rank": (close - f(last, "EMA20")) / atr})
    # I-ADX: trend breakout
    if (math.isfinite(f(last, "ADX")) and f(last, "ADX") > 25
            and math.isfinite(f(last, "PDI")) and f(last, "PDI") > f(last, "MDI")
            and close > f(last, "EMA20")
            and math.isfinite(f(last, "HH20")) and close > f(last, "HH20")):
        sig["I-ADX"] = base({"sl": close - 1.0 * atr, "tp": close + 2.0 * atr,
                             "rank": float(f(last, "ADX"))})
    # I-ACC: quiet accumulation + volume stir, ADX-gated (not yet trending)
    try:
        w = tdf["close"].astype(float).iloc[-20:]
        hh, ll = float(w.max()), float(tdf["low"].astype(float).iloc[-20:].min())
        rng = (hh - ll) / ll * 100 if ll > 0 else 999
        pos = (close - ll) / (hh - ll) if hh > ll else 0
        vr = (f(last, "VOL5") / f(last, "VOL20")) if f(last, "VOL20") else 0
        if (rng < 8.0 and pos > 0.65 and math.isfinite(vr) and vr > 1.2
                and math.isfinite(f(last, "ADX")) and f(last, "ADX") < 25):
            risk = close - ll
            if risk > 0:
                sig["I-ACC"] = base({"sl": ll, "tp": close + 2.0 * risk, "rank": float(vr)})
    except Exception:
        pass
    # I-RSI: thrust through 55 within last 3 bars + above EMA20
    try:
        r = d["RSI"].iloc[-4:]
        if len(r.dropna()) == 4 and float(r.iloc[-1]) > 55 and float(r.iloc[:-1].min()) < 55 \
                and close > f(last, "EMA20"):
            sig["I-RSI"] = base({"sl": close - 1.0 * atr, "tp": close + 2.0 * atr,
                                 "rank": float(r.iloc[-1]) - 55})
    except Exception:
        pass
    return sig


def f(row, col: str) -> float:
    try:
        return float(row[col])
    except Exception:
        return float("nan")


# ---------------------------------------------------------------- backtest
def run_trade(entry_open: float, sl: float, tp: float, bars: pd.DataFrame) -> dict:
    """bars: week session bars incl. entry session. Entry at bars[0] open."""
    entry = entry_open * (1 + SLIP)
    qty = max(1, int(NOTIONAL // entry))
    if entry_open <= sl:
        return {"exit_px": entry_open, "exit_reason": "OPEN_BELOW_SL", "qty": qty,
                "entry_px": entry, "bars_held": 0}
    sl_x = sl * (1 - SLIP)
    tp_x = tp * (1 - SLIP)
    for i, (_, b) in enumerate(bars.iterrows()):
        lo, hi = float(b["low"]), float(b["high"])
        sl_hit = lo <= sl
        tp_hit = hi >= tp
        if sl_hit and tp_hit:
            return {"exit_px": sl_x, "exit_reason": "STOP", "qty": qty,
                    "entry_px": entry, "bars_held": i, "note": "same-bar-ambiguity-stop-first"}
        if sl_hit:
            return {"exit_px": sl_x, "exit_reason": "STOP", "qty": qty,
                    "entry_px": entry, "bars_held": i}
        if tp_hit:
            return {"exit_px": tp_x, "exit_reason": "TARGET", "qty": qty,
                    "entry_px": entry, "bars_held": i}
    last_close = float(bars.iloc[-1]["close"])
    return {"exit_px": last_close * (1 - SLIP), "exit_reason": "FRIDAY_CLOSE",
            "qty": qty, "entry_px": entry, "bars_held": len(bars) - 1}


def settle(entry_px: float, exit_px: float, qty: int) -> dict:
    from backtest.costs import calculate_trading_costs

    gross = (exit_px - entry_px) * qty
    costs = calculate_trading_costs(entry_px, exit_px, qty, "LONG")["total_costs"]
    return {"gross": round(gross, 2), "costs": costs, "net": round(gross - costs, 2)}


# ---------------------------------------------------------------- stages
def stage_fetch(limit: int) -> None:
    from chart_patterns.constituents import CONSTITUENTS

    syms = list(CONSTITUENTS["nifty500"])[:limit] if limit else list(CONSTITUENTS["nifty500"])
    print(f"fetching {len(syms)} symbols...")
    res = fetch_all(syms)
    ok = sum(1 for v in res.values() if v[0] == "ok")
    print(f"ok={ok} empty={sum(1 for v in res.values() if v[0]=='empty')} "
          f"error={sum(1 for v in res.values() if v[0]=='error')}")
    import pickle

    serial = {}
    for k, v in res.items():
        if v[0] == "ok":
            serial[k] = v[1].to_dict(orient="tight")
        else:
            serial[k] = v
    with open(FRAMES_PKL, "wb") as fh:
        pickle.dump(serial, fh)
    print("wrote", FRAMES_PKL)


def load_frames() -> dict:
    import pickle

    with open(FRAMES_PKL, "rb") as fh:
        serial = pickle.load(fh)
    out = {}
    for k, v in serial.items():
        if isinstance(v, tuple):
            out[k] = v
        else:
            out[k] = ("ok", pd.DataFrame.from_dict(v, orient="tight"))
    return out


def stage_signals(limit: int) -> None:
    frames = load_frames()
    syms = sorted(frames)[:limit] if limit else sorted(frames)
    all_sigs: dict[str, dict] = {}
    npat = 0
    for i, sym in enumerate(syms):
        st, df = frames[sym]
        if st != "ok":
            continue
        per: dict[str, dict] = {}
        for sd in SIGNAL_DATES:
            tdf = truncate(df, sd)
            if len(tdf) < 60:
                continue
            ph = pattern_signals(sym, tdf)
            ih = indicator_signals(sym, tdf)
            per[sd] = {"patterns": ph, "indicators": {k: v for k, v in ih.items() if v}}
            npat += len(ph)
        all_sigs[sym] = per
        if (i + 1) % 50 == 0:
            print(f"  signals {i+1}/{len(syms)} pattern_hits={npat}", flush=True)
    with open(SIGNALS_JSON, "w") as fh:
        json.dump(all_sigs, fh)
    print(f"symbols={len(all_sigs)} total_pattern_hits={npat}; wrote {SIGNALS_JSON}")


CANDIDATES = ["P-ALL", "P-CONT", "P-REV", "P-VOL", "P-CONS",
              "I-EMA", "I-ADX", "I-ACC", "I-RSI"]
CONT_IDS = {"bull_flag", "ascending_channel", "ascending_triangle", "pennant"}
REV_IDS = {"falling_wedge", "diamond_bottom", "triple_bottom", "double_bottom",
           "inverse_head_shoulders", "rounding_bottom", "cup_handle"}
CONS_IDS = {"consolidation", "rectangle"}


def pick(sym: str, per: dict, cid: str) -> dict | None:
    if cid.startswith("P-"):
        hits = [h for h in per["patterns"]
                if h.get("direction") == "bullish" and h.get("status") == "confirmed"]
        if cid == "P-CONT":
            hits = [h for h in hits if h.get("pattern_id") in CONT_IDS]
        elif cid == "P-REV":
            hits = [h for h in hits if h.get("pattern_id") in REV_IDS]
        elif cid == "P-VOL":
            hits = [h for h in hits if h.get("volume_confirmed")]
        elif cid == "P-CONS":
            hits = [h for h in per["patterns"]
                    if h.get("pattern_id") in CONS_IDS and h.get("status") == "confirmed"]
        if not hits:
            return None
        hits.sort(key=lambda h: h.get("confidence", 0), reverse=True)
        h = hits[0]
        sl, tp = float(h["stop"]), float(h["target"])
        if not (sl > 0 and tp > 0 and tp > sl):
            return None
        return {"sl": sl, "tp": tp, "rank": float(h.get("confidence", 0)),
                "pattern": h.get("pattern_id")}
    else:
        return per["indicators"].get(cid)


def stage_backtest() -> None:
    frames = load_frames()
    with open(SIGNALS_JSON) as fh:
        sigs = json.load(fh)
    trades: list[dict] = []
    for wk, (sd, ws, we) in WEEKS.items():
        for sym, per in sigs.items():
            if sd not in per:
                continue
            st, df = frames[sym]
            if st != "ok":
                continue
            wb = week_bars(df, ws, we)
            if len(wb) == 0:
                continue
            entry_open = float(wb.iloc[0]["open"])
            for cid in CANDIDATES:
                s = pick(sym, per[sd], cid)
                if not s:
                    continue
                t = run_trade(entry_open, float(s["sl"]), float(s["tp"]), wb)
                stl = settle(t["entry_px"], t["exit_px"], t["qty"])
                trades.append({
                    "week": wk, "signal_date": sd, "symbol": sym, "strategy": cid,
                    "pattern": s.get("pattern"), "rank": s.get("rank"),
                    "entry_px": round(t["entry_px"], 2), "exit_px": round(t["exit_px"], 2),
                    "qty": t["qty"], "exit_reason": t["exit_reason"],
                    "bars_held": t["bars_held"], **stl,
                })
    with open(TRADES_JSON, "w") as fh:
        json.dump(trades, fh)
    print(f"trades={len(trades)}; wrote {TRADES_JSON}")
    summ: dict[str, dict] = {}
    for cid in CANDIDATES:
        for wk in list(WEEKS) + ["ALL"]:
            ts = [t for t in trades if t["strategy"] == cid and (wk == "ALL" or t["week"] == wk)]
            if not ts:
                continue
            net = sum(t["net"] for t in ts)
            summ[f"{cid}/{wk}"] = {
                "n": len(ts), "net": round(net, 2),
                "mean": round(net / len(ts), 2),
                "winrate": round(sum(1 for t in ts if t["net"] > 0) / len(ts), 3),
            }
    for k, v in sorted(summ.items()):
        print(f"  {k}: {v}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=["fetch", "signals", "backtest"])
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    if a.stage == "fetch":
        stage_fetch(a.limit)
    elif a.stage == "signals":
        stage_signals(a.limit)
    else:
        stage_backtest()


if __name__ == "__main__":
    main()
