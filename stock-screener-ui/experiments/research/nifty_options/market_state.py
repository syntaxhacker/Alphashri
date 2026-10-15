"""Current-market state: regime, levels, OI/IV structure, candidate setups.

Read-only. Uses cached spot history + one live FYERS option-chain snapshot.
Only surfaces trade candidates from strategies that survived out-of-sample
validation (see ``sweep.py`` / ``RESEARCH_LOG.jsonl``).
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402


def ema(s, span):
    return s.ewm(span=span, adjust=False).mean()


def atr(df, n=14):
    h, l, c = df["high"], df["low"], df["close"]
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean()


def adx(df, n=14):
    h, l, c = df["high"], df["low"], df["close"]
    up = h.diff()
    dn = -l.diff()
    plus = np.where((up > dn) & (up > 0), up, 0.0)
    minus = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr_ = tr.rolling(n).mean()
    pdi = 100 * pd.Series(plus, index=df.index).rolling(n).mean() / atr_.replace(0, np.nan)
    mdi = 100 * pd.Series(minus, index=df.index).rolling(n).mean() / atr_.replace(0, np.nan)
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.rolling(n).mean(), pdi, mdi


def load_daily():
    d = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__D.parquet").set_index("ts").sort_index()
    return d


def classify_regime(daily: pd.DataFrame, vix: pd.Series) -> dict:
    c = daily["close"]
    e20, e50 = ema(c, 20), ema(c, 50)
    slope20 = (e20 - e20.shift(10)) / e20.shift(10)
    a, pdi, mdi = adx(daily)
    atrp = (atr(daily) / c)
    vix_pct = float((vix.dropna() < vix.dropna().iloc[-1]).mean())
    atrp_pct = float((atrp.dropna() < atrp.dropna().iloc[-1]).mean())
    last = -1
    trend_up = bool(c.iloc[last] > e50.iloc[last] and e20.iloc[last] > e50.iloc[last])
    trend_dn = bool(c.iloc[last] < e50.iloc[last] and e20.iloc[last] < e50.iloc[last])
    adx_now = float(a.iloc[last]) if a.notna().iloc[last] else float("nan")
    if math_isnan(adx_now):
        regime = "Uncertain"
    elif trend_up and adx_now >= 20:
        regime = "Bullish"
    elif trend_dn and adx_now >= 20:
        regime = "Bearish"
    elif adx_now < 20:
        regime = "Range"
    else:
        regime = "Uncertain"
    vol_regime = ("High" if atrp_pct > 0.66 else "Low" if atrp_pct < 0.33 else "Normal")
    return {
        "regime": regime, "adx_daily": adx_now,
        "ema20_slope_10d": float(slope20.iloc[last]),
        "atr_pct": float(atrp.iloc[last]), "atr_pct_percentile": atrp_pct,
        "vix": float(vix.dropna().iloc[-1]), "vix_percentile": vix_pct,
        "vol_regime": vol_regime,
    }


def math_isnan(x):
    return x != x


def key_levels(intraday: pd.DataFrame, daily: pd.DataFrame) -> dict:
    last_day = daily.index[-1].date()
    prev = daily.iloc[:-1]
    lw = daily.tail(5).iloc[:-1] if len(daily) > 5 else prev
    today = intraday[intraday.index.date == last_day] if len(intraday) else pd.DataFrame()
    out = {
        "as_of": str(daily.index[-1]),
        "prev_day_high": float(prev["high"].iloc[-1]),
        "prev_day_low": float(prev["low"].iloc[-1]),
        "prev_day_close": float(prev["close"].iloc[-1]),
        "prev_week_high": float(lw["high"].max()),
        "prev_week_low": float(lw["low"].min()),
    }
    if len(today):
        tp = (today["high"] + today["low"] + today["close"]) / 3
        out["session_vwap"] = float((tp * today["volume"]).sum() / max(today["volume"].sum(), 1))
        out["session_open"] = float(today["open"].iloc[0])
        first15 = today[today.index.time <= datetime.strptime("09:30", "%H:%M").time()]
        if len(first15):
            out["opening_range_15m"] = [float(first15["low"].min()), float(first15["high"].max())]
    return out


def oi_structure(chain: dict, spot: float) -> dict:
    legs = [r for r in chain.get("optionsChain", []) if r.get("option_type") in ("CE", "PE")]
    if not legs:
        return {}
    ce = [r for r in legs if r["option_type"] == "CE"]
    pe = [r for r in legs if r["option_type"] == "PE"]
    call_oi = sum(r.get("oi") or 0 for r in ce)
    put_oi = sum(r.get("oi") or 0 for r in pe)
    top_ce = sorted(ce, key=lambda r: r.get("oi") or 0, reverse=True)[:3]
    top_pe = sorted(pe, key=lambda r: r.get("oi") or 0, reverse=True)[:3]
    strikes = sorted({r["strike_price"] for r in legs})
    # max pain: strike minimising total writer payout
    def payout(k):
        tot = 0.0
        for r in legs:
            oi = r.get("oi") or 0
            if r["option_type"] == "CE":
                tot += max(0.0, k - r["strike_price"]) * oi
            else:
                tot += max(0.0, r["strike_price"] - k) * oi
        return tot
    max_pain = min(strikes, key=payout) if strikes else None
    return {
        "pcr_oi": round(put_oi / call_oi, 3) if call_oi else None,
        "call_oi": call_oi, "put_oi": put_oi,
        "max_pain": max_pain,
        "top_call_oi_strikes": [(r["strike_price"], r.get("oi"), r.get("oich")) for r in top_ce],
        "top_put_oi_strikes": [(r["strike_price"], r.get("oi"), r.get("oich")) for r in top_pe],
    }


def iv_structure(client) -> dict:
    ch0 = client.option_chain(strikecount=10, greeks=True)
    if not ch0:
        return {}
    expiries = ch0.get("expiryData", [])[:3]
    out = {"nearest_atm_iv": None, "term": [], "skew": None}
    spot_row = next((r for r in ch0["optionsChain"] if r.get("option_type") == ""), None)
    spot = spot_row["ltp"] if spot_row else None
    for e in expiries:
        ch = ch0 if e is expiries[0] else client.option_chain(strikecount=10, expiry=e["expiry"], greeks=True)
        legs = [r for r in (ch or {}).get("optionsChain", []) if r.get("option_type") in ("CE", "PE") and r.get("greeks")]
        if not legs:
            continue
        atm = min(legs, key=lambda r: abs(r["strike_price"] - (spot or 0)))
        out["term"].append({"expiry": e["date"], "atm_iv": atm["greeks"].get("iv")})
        if e is expiries[0]:
            out["nearest_atm_iv"] = atm["greeks"].get("iv")
            wings = [r for r in legs if r["strike_price"] <= (spot or 0) - 150 and r["option_type"] == "PE"]
            calls = [r for r in legs if r["strike_price"] >= (spot or 0) + 150 and r["option_type"] == "CE"]
            if wings and calls:
                out["skew"] = round((wings[0]["greeks"]["iv"] - calls[0]["greeks"]["iv"]), 2)
    return out


def main():
    client = fd.FyersData(min_interval=0.6, verbose=False)
    daily = load_daily()
    intra = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    vix = pd.read_parquet(fd.CANDLE_DIR / "NSE_INDIAVIX-INDEX__D.parquet").set_index("ts")["close"]
    chain = client.option_chain(strikecount=25, greeks=True)
    spot_row = next((r for r in (chain or {}).get("optionsChain", []) if r.get("option_type") == ""), {})
    spot = spot_row.get("ltp") or float(daily["close"].iloc[-1])
    report = {
        "spot": spot,
        "regime": classify_regime(daily, vix),
        "levels": key_levels(intra, daily),
        "oi": oi_structure(chain or {}, spot),
        "iv": iv_structure(client),
        "expiries": [e["date"] for e in (chain or {}).get("expiryData", [])][:6],
    }
    out = fd.CACHE_DIR / "market_state.json"
    out.write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
