import json
import os
import statistics as st

from scripts.smc_tick_eval import fetch_ticks

_BASIS_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nq_basis.json")


def _load_basis_cache():
    try:
        with open(_BASIS_CACHE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_basis_cache(cache):
    try:
        with open(_BASIS_CACHE, "w") as f:
            json.dump(cache, f)
    except Exception:
        pass


def _coarse_basis(date, ticks, interval, min_n):
    try:
        import yfinance as yf
        import pandas as pd
        df = yf.download("NQ=F", start=date,
                         end=(pd.to_datetime(date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                         interval=interval, progress=False, auto_adjust=True)
        if hasattr(df.columns, "levels") and df.columns.nlevels > 1:
            df.columns = df.columns.droplevel(1)
        span = 3600 if interval == "1h" else 86400
        ref = {}
        for t in ticks:
            k = int(t["timestamp"] // 1000 // span) * span
            ref[k] = (t["bidPrice"] + t["askPrice"]) / 2.0
        diffs = []
        for ts, row in df.iterrows():
            k = int(ts.timestamp() // span) * span
            if k in ref and abs(float(row["Close"]) - ref[k]) < 800:
                diffs.append(float(row["Close"]) - ref[k])
        if len(diffs) >= min_n:
            return st.median(diffs), interval
    except Exception:
        pass
    return None, "none"


def fetch_nq_ticks(date: str):
    ticks = fetch_ticks(date)
    try:
        import yfinance as yf
        import pandas as pd
        end = (pd.to_datetime(date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        df = yf.download("NQ=F", start=date, end=end, interval="1m", progress=False, auto_adjust=True)
        if hasattr(df.columns, "levels") and df.columns.nlevels > 1:
            df.columns = df.columns.droplevel(1)
        nq = {}
        for ts, row in df.iterrows():
            try:
                nq[int(ts.timestamp())] = float(row["Close"])
            except Exception:
                continue
    except Exception:
        nq = {}
    cash = {}
    for t in ticks:
        m = int(t["timestamp"] // 1000 // 60) * 60
        cash[m] = (t["bidPrice"] + t["askPrice"]) / 2.0
    diffs = [nq[m] - c for m, c in cash.items() if m in nq and abs(nq[m] - c) < 500]
    cache = _load_basis_cache()
    if len(diffs) >= 60:
        med, method = st.median(diffs), "1m"
        cache[date] = {"med": med, "method": method}
        _save_basis_cache(cache)
    elif date in cache and cache[date].get("method") in ("1m", "1h"):
        med, method = cache[date]["med"], "cache"
    else:
        med, method = _coarse_basis(date, ticks, "1h", 12)
        if method == "none":
            med, method = 0.0, "none"
        else:
            cache[date] = {"med": med, "method": method}
            _save_basis_cache(cache)
    out = [{**t, "bidPrice": t["bidPrice"] + med, "askPrice": t["askPrice"] + med} for t in ticks]
    stats = {"median": round(med, 2), "method": method,
             "stdev": round(st.stdev(diffs), 2) if len(diffs) > 1 else 0.0,
             "n": len(diffs), "ticks": len(out)}
    return out, stats
