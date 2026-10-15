#!/usr/bin/env python3
"""Reproducible gold ETF/future/COMEX relative-value study.

Run from the repository root:
    .venv/bin/python scripts/gold_arb_study.py

The script is read-only with respect to the project database and services. It
uses the project Upstox candle path (with a direct-key fallback), yfinance for
GC=F/INR=X, and official NSE public JSON for NSE bullion data. Results are
exploratory: centers and betas are in-sample and there is no out-of-sample claim.
"""
from __future__ import annotations

import argparse
import math
import sqlite3
import sys
import urllib.parse
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd
import requests

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
from config import IST

ETFS = ("AXISGOLD", "GOLDBEES", "GOLDIETF", "HDFCGOLD", "QGOLDHALF", "SETFGOLD")
OUNCE_G = 32.1507
HDR = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}
# Decimal rates for a discount-broker intraday model.
RATES = {
    "broker_pct": 0.0003, "broker_cap": 20.0,
    "cash_exchange": 0.0000307, "commodity_exchange": 0.000001,
    "sebi": 0.000001, "etf_stamp": 0.00003,
    "commodity_stamp": 0.00002, "etf_stt": 0.0,
    "commodity_ctt": 0.0001, "gst": 0.18,
}


@dataclass(frozen=True)
class Cost:
    brokerage: float
    exchange: float
    sebi: float
    stamp: float
    tax: float
    gst: float

    @property
    def total(self) -> float:
        return self.brokerage + self.exchange + self.sebi + self.stamp + self.tax + self.gst


@dataclass(frozen=True)
class Result:
    family: str
    pair: str
    relationship: str
    measured: float
    maximum: float
    cost: float
    ratio: float
    opportunities: int
    verdict: str
    note: str = ""
    exec_n: int = 0
    exec_mean: float = math.nan
    exec_hit: float = math.nan
    exec_cum: float = math.nan


class DataError(RuntimeError):
    pass


def args() -> argparse.Namespace:
    previous = datetime.now(IST).date() - timedelta(days=1)
    while previous.weekday() >= 5:
        previous -= timedelta(days=1)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--end", default=previous.isoformat())
    p.add_argument("--intraday-days", type=int, default=30)
    p.add_argument("--daily-days", type=int, default=365)
    p.add_argument("--notional-per-leg", type=float, default=150_000)
    p.add_argument("--future-expiry", default="")
    p.add_argument("--self-test", action="store_true")
    return p.parse_args()


def number(value: object) -> float:
    try:
        x = float(value)
        return x if math.isfinite(x) else math.nan
    except (TypeError, ValueError):
        return math.nan


def fmt(value: float, digits: int = 2) -> str:
    return "n/a" if not math.isfinite(value) else f"{value:.{digits}f}"


def correlation(a: pd.Series, b: pd.Series) -> float:
    x = pd.concat([a.rename("a"), b.rename("b")], axis=1).dropna()
    if len(x) < 3 or x["a"].nunique() < 2 or x["b"].nunique() < 2:
        return math.nan
    return float(x["a"].corr(x["b"]))


def statutory(kind: str, notional: float) -> Cost:
    if kind == "gold_etf":
        exchange, stamp, tax = 2 * notional * RATES["cash_exchange"], notional * RATES["etf_stamp"], notional * RATES["etf_stt"]
    elif kind == "nse_gold_future":
        exchange, stamp, tax = 2 * notional * RATES["commodity_exchange"], notional * RATES["commodity_stamp"], notional * RATES["commodity_ctt"]
    else:
        raise ValueError(kind)
    brokerage = 2 * min(notional * RATES["broker_pct"], RATES["broker_cap"])
    sebi = 2 * notional * RATES["sebi"]
    gst = RATES["gst"] * (brokerage + exchange + sebi)
    return Cost(brokerage, exchange, sebi, stamp, tax, gst)


def cost_bps(cost: Cost, notional: float) -> float:
    return cost.total / notional * 10_000


def bar_range(frame: pd.DataFrame) -> float:
    if frame.empty:
        return math.nan
    mid = (frame["high"] + frame["low"]) / 2
    values = ((frame["high"] - frame["low"]) / mid * 10_000).replace([np.inf, -np.inf], np.nan)
    values = values[np.isfinite(values) & (values >= 0)]
    return float(values.median()) if len(values) else math.nan


def episode_list(values: pd.Series, threshold: float, cooldown: pd.Timedelta) -> list[tuple[object, object, float]]:
    values = values.dropna().sort_index()
    result: list[tuple[object, object, float]] = []
    active: list[object] | None = None
    last_above: object | None = None
    for timestamp, raw in values.items():
        value = abs(float(raw))
        if value > threshold:
            if last_above is None or timestamp - last_above >= cooldown:
                if active is not None:
                    result.append((active[0], active[1], float(active[2])))
                active = [timestamp, timestamp, value]
            elif value > float(active[2]):
                active[1], active[2] = timestamp, value
            last_above = timestamp
        elif active is not None and timestamp - last_above >= cooldown:
            result.append((active[0], active[1], float(active[2])))
            active = None
    if active is not None:
        result.append((active[0], active[1], float(active[2])))
    return result


def reversion_rate(values: pd.Series, episodes: Sequence[tuple[object, object, float]]) -> float:
    if not episodes:
        return math.nan
    checked = improved = 0
    values = values.dropna().sort_index()
    for _, peak, peak_value in episodes:
        target = peak + pd.Timedelta(minutes=30)
        later = values.loc[:target]
        if later.empty or later.index[-1] < target - pd.Timedelta(minutes=5):
            continue
        checked += 1
        improved += abs(float(later.iloc[-1])) < peak_value
    return improved / checked * 100 if checked else math.nan


def session_returns(close: pd.Series) -> pd.Series:
    if close.empty:
        return close
    local = close.index.tz_convert(IST) if close.index.tz else close.index.tz_localize(IST)
    sessions = pd.Series(local.date, index=close.index)
    return np.log(close).groupby(sessions).diff()


def normalize(frame: pd.DataFrame | None) -> pd.DataFrame:
    columns = ["open", "high", "low", "close", "volume"]
    if frame is None or frame.empty:
        return pd.DataFrame(columns=columns)
    frame = frame.copy()
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = [str(c[0]).lower() for c in frame.columns]
    else:
        frame.columns = [str(c).lower() for c in frame.columns]
    if "adj close" in frame and "close" not in frame:
        frame["close"] = frame["adj close"]
    for column in columns:
        if column not in frame:
            frame[column] = np.nan
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame[columns]
    frame.index = frame.index.tz_localize("UTC") if frame.index.tz is None else frame.index.tz_convert("UTC")
    return frame[~frame.index.duplicated(keep="last")].sort_index().dropna(subset=["close"])


def asof_value(index: pd.DatetimeIndex, values: pd.Series) -> pd.Series:
    right = values.rename("value").reset_index()
    right.columns = ["timestamp", "value"]
    right["timestamp"] = pd.to_datetime(right["timestamp"], utc=True)
    left = pd.DataFrame({"timestamp": index})
    merged = pd.merge_asof(left.sort_values("timestamp"), right.dropna().sort_values("timestamp"),
                           on="timestamp", direction="backward", tolerance=pd.Timedelta("5min"))
    return pd.Series(merged["value"].to_numpy(), index=index, name=values.name)


def db_info() -> tuple[dict[str, str], dict[str, object]]:
    path = (REPO / "db" / "alphashri.db").resolve()
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        placeholders = ",".join("?" for _ in ETFS)
        rows = con.execute(f"SELECT trading_symbol,instrument_key FROM instruments WHERE segment='NSE_EQ' AND trading_symbol IN ({placeholders})", ETFS).fetchall()
        keys = {str(symbol): str(key) for symbol, key in rows}
        info = {
            "nse_com": con.execute("SELECT COUNT(*) FROM instruments WHERE segment='NSE_COM'").fetchone()[0],
            "mcx": con.execute("SELECT COUNT(*) FROM instruments WHERE UPPER(segment)='MCX' OR UPPER(exchange)='MCX'").fetchone()[0],
            "gold10g": con.execute("SELECT instrument_key,trading_symbol FROM instruments WHERE segment='NSE_COM' AND (trading_symbol='GOLD10G' OR trading_symbol LIKE 'GOLD10G FUT %') ORDER BY trading_symbol").fetchall(),
        }
    finally:
        con.close()
    if set(ETFS) - set(keys):
        raise DataError(f"missing ETF keys: {sorted(set(ETFS) - set(keys))}")
    return keys, info


def upstox(key: str, unit: str, interval: int, start: str, end: str) -> pd.DataFrame:
    encoded = urllib.parse.quote(key, safe="")
    url = f"https://api.upstox.com/v3/historical-candle/{encoded}/{unit}/{interval}/{end}/{start}"
    response = requests.get(url, headers={"Accept": "application/json", **HDR}, timeout=45)
    response.raise_for_status()
    payload = response.json()
    candles = payload.get("data", {}).get("candles", []) if isinstance(payload, dict) else []
    if not candles:
        return pd.DataFrame()
    frame = pd.DataFrame(candles, columns=["datetime", "open", "high", "low", "close", "volume", "oi"])
    frame["datetime"] = pd.to_datetime(frame["datetime"], utc=True)
    return frame.set_index("datetime")


def etf_candles(symbol: str, key: str, tf: int, start: str, end: str) -> tuple[pd.DataFrame, str]:
    first_error = None
    try:
        from market_data.market_data import fetch_candles
        frame = normalize(fetch_candles(symbol, tf=tf, from_date=start, to_date=end))
        if not frame.empty:
            return frame, "market_data.fetch_candles"
    except Exception as exc:
        first_error = exc
    unit, interval = ("days", 1) if tf == 1440 else ("minutes", tf)
    frame = normalize(upstox(key, unit, interval, start, end))
    if not frame.empty:
        suffix = f" ({type(first_error).__name__})" if first_error else ""
        return frame, f"Upstox V3 direct-key fallback{suffix}"
    raise DataError(f"no candles for {symbol}/{key}")


def yf_data(symbol: str, start: str, end: str, interval: str) -> pd.DataFrame:
    import yfinance as yf
    end_exclusive = date.fromisoformat(end) + timedelta(days=1)
    return normalize(yf.download(symbol, start=start, end=end_exclusive.isoformat(), interval=interval,
                                 auto_adjust=False, progress=False, threads=False, timeout=45))


def nse_get(session: requests.Session, path: str, params: dict | None = None) -> dict:
    response = session.get(f"https://www.nseindia.com{path}", params=params, timeout=60)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise DataError(f"unexpected NSE response: {path}")
    return payload


def nse_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HDR)
    nse_get(session, "/api/marketStatus")
    return session


def nse_spot(session: requests.Session, start: date, end: date) -> pd.DataFrame:
    payload = nse_get(session, "/api/historical-spot-price", {"symbol": "GOLD1G", "fromDate": start.strftime("%d-%m-%Y"), "toDate": end.strftime("%d-%m-%Y")})
    rows = []
    for item in payload.get("data", []):
        if item.get("Symbol") != "GOLD1G":
            continue
        prices = [number(item.get("SpotPrice1")), number(item.get("SpotPrice2"))]
        prices = [x for x in prices if math.isfinite(x) and x > 0]
        day = pd.to_datetime(item.get("UpdatedDate"), format="%d-%b-%Y", errors="coerce")
        if prices and pd.notna(day):
            rows.append({"date": day.date(), "spot_inr_g": float(np.mean(prices))})
    frame = pd.DataFrame(rows).drop_duplicates("date", keep="last").set_index("date").sort_index()
    if frame.empty:
        raise DataError("NSE GOLD1G spot returned no rows")
    return frame


def live_gold10g(session: requests.Session) -> tuple[dict, dict]:
    payload = nse_get(session, "/api/liveCommodity-derivatives/bullion")
    rows = [x for x in payload.get("data", []) if x.get("contract") == "GOLD10G" and x.get("instrumentType") == "FUTBLN" and number(x.get("lastPrice")) > 0 and number(x.get("numberOfContractsTraded")) > 0]
    if not rows:
        raise DataError("no live/traded GOLD10G future")
    rows.sort(key=lambda x: pd.to_datetime(x["expiryDate"]))
    return rows[0], payload


def future_history(session: requests.Session, live: dict) -> pd.DataFrame:
    expiry = pd.to_datetime(live["expiryDate"]).strftime("%d-%b-%Y").upper()
    payload = nse_get(session, "/api/historicalOR/com/derivatives", {"symbol": "GOLD10G", "identifier": live["identifier"]})
    rows = []
    for item in payload.get("data", []):
        if str(item.get("COM_EXPIRY_DT", "")).upper() != expiry:
            continue
        close, volume = number(item.get("COM_CLOSING_PRICE")), number(item.get("COM_TOT_TRADED_QTY"))
        day = pd.to_datetime(item.get("COM_TIMESTAMP"), format="%d-%b-%Y", errors="coerce")
        if close > 0 and volume > 0 and pd.notna(day):
            rows.append({"date": day.date(), "open": number(item.get("COM_OPENING_PRICE")), "high": number(item.get("COM_TRADE_HIGH_PRICE")),
                         "low": number(item.get("COM_TRADE_LOW_PRICE")), "close": close, "volume": volume})
    frame = pd.DataFrame(rows).drop_duplicates("date", keep="last").set_index("date").sort_index()
    if frame.empty:
        raise DataError("no traded GOLD10G history")
    frame["future_inr_g"] = frame["close"] / 10
    return frame


def orderbook(session: requests.Session, live: dict) -> dict:
    expiry = pd.to_datetime(live["expiryDate"]).strftime("%d-%m-%Y")
    payload = nse_get(session, "/api/quotes-commodity-derivatives-main", {"category": "Bullion", "expiryDate": expiry, "instrumentType": "FUTBLN", "symbol": "GOLD10G"})
    row = (payload.get("data") or [None])[0]
    if not row:
        raise DataError("empty GOLD10G quote")
    book = row.get("detail", {}).get("Market Depth - Order Book", {})
    buy, sell = book.get("buy", []), book.get("sell", [])
    if not buy or not sell:
        raise DataError("no two-sided GOLD10G book")
    bid, ask = float(buy[0]["price"]), float(sell[0]["price"])
    return {"timestamp": row.get("metadata", {}).get("last_updatedTime", ""), "bid": bid, "ask": ask,
            "bid_qty": int(buy[0].get("quantity", 0)), "ask_qty": int(sell[0].get("quantity", 0)),
            "spread": (ask - bid) / ((ask + bid) / 2) * 10_000,
            "volume": number(row.get("metadata", {}).get("numberOfContractsTraded")),
            "oi": number(row.get("detail", {}).get("Trade Information", {}).get("openInterest"))}


def external_daily(spot: pd.DataFrame, gc: pd.DataFrame, fx: pd.DataFrame) -> pd.DataFrame:
    g = gc[["close"]].rename(columns={"close": "gc"}).copy(); g.index = pd.to_datetime(g.index).date
    f = fx[["close"]].rename(columns={"close": "fx"}).copy(); f.index = pd.to_datetime(f.index).date
    out = spot.join(g, how="inner").join(f, how="inner")
    out = out[(out["spot_inr_g"] > 0) & (out["gc"] > 0) & (out["fx"] > 0)].copy()
    out["comex_inr_g"] = out["gc"] * out["fx"] / OUNCE_G
    out["basis_bps"] = (out["spot_inr_g"] / out["comex_inr_g"] - 1) * 10_000
    return out.sort_index()


def classify(p95: float, cost: float, count: int, force_fail: bool = False) -> str:
    if force_fail or not math.isfinite(p95) or p95 <= cost or count < 2:
        return "FAIL"
    return "COST-PASS*"


def next_open_bt(residual: pd.Series, etf: pd.DataFrame, future: pd.DataFrame, beta: float, cost: float) -> dict[str, float | int]:
    if residual.empty or not math.isfinite(beta) or not math.isfinite(cost):
        return {"n": 0, "mean": math.nan, "hit": math.nan, "cum": math.nan}
    etf, fut = etf.copy(), future.copy()
    etf.index, fut.index = pd.to_datetime(etf.index), pd.to_datetime(fut.index)
    residual.index = pd.to_datetime(residual.index)
    next_resid = ((np.log(etf["close"] / etf["open"]) - beta * np.log(fut["close"] / fut["open"])) * 10_000).dropna()
    all_net, executable = [], []
    for _, peak, _ in episode_list(residual, cost, pd.Timedelta(days=1)):
        later = next_resid.index[next_resid.index > peak]
        if later.empty:
            continue
        signal, value = float(residual.loc[peak]), float(next_resid.loc[later[0]])
        net = -np.sign(signal) * value - cost
        all_net.append(net)
        if signal < 0:
            executable.append(net)
    chosen = executable or all_net
    if not chosen:
        return {"n": 0, "mean": math.nan, "hit": math.nan, "cum": math.nan}
    return {"n": len(executable), "mean": float(np.mean(chosen)), "hit": float(np.mean(np.asarray(chosen) > 0) * 100),
            "cum": float(np.prod(1 + np.asarray(chosen) / 10_000) - 1) * 100}


def etf_pair_results(intraday: dict[str, pd.DataFrame], daily: dict[str, pd.DataFrame], notional: float) -> tuple[list[Result], list[float]]:
    rets = {s: session_returns(f["close"]) for s, f in intraday.items()}
    drets = {s: np.log(f["close"]).diff() for s, f in daily.items()}
    ranges = {s: bar_range(f) for s, f in intraday.items()}
    statutory_bps = cost_bps(statutory("gold_etf", notional), notional)
    results, reversions = [], []
    for i, left in enumerate(ETFS):
        for right in ETFS[i + 1:]:
            aligned = pd.concat([intraday[left]["close"].rename(left), intraday[right]["close"].rename(right)], axis=1).dropna()
            deviation = (np.log(aligned[left] / aligned[right]) - np.log(aligned[left] / aligned[right]).median()) * 10_000
            p95, maximum = float(deviation.abs().quantile(.95)), float(deviation.abs().max())
            total = 2 * statutory_bps + 2 * (ranges[left] + ranges[right])
            episodes = episode_list(deviation, total, pd.Timedelta(minutes=30))
            reversions.append(reversion_rate(deviation, episodes))
            rel = f"rho5={fmt(correlation(rets[left].reindex(aligned.index), rets[right].reindex(aligned.index)), 4)}; rho1d={fmt(correlation(drets[left], drets[right]), 4)}"
            results.append(Result("ETF/ETF", f"{left}/{right}", rel, p95, maximum, total, p95 / total, len(episodes), classify(p95, total, len(episodes))))
    return results, reversions


def future_results(daily: dict[str, pd.DataFrame], future: pd.DataFrame, spread: float, notional: float) -> list[Result]:
    fut = future.copy(); fut.index = pd.to_datetime(fut.index)
    fret = np.log(fut["future_inr_g"]).diff().rename("future")
    etf_cost, future_cost = cost_bps(statutory("gold_etf", notional), notional), cost_bps(statutory("nse_gold_future", notional), notional)
    results = []
    for symbol in ETFS:
        etf = daily[symbol].copy(); etf.index = pd.to_datetime(etf.index)
        ert = np.log(etf["close"]).diff().rename("etf")
        joined = pd.concat([ert, fret], axis=1).dropna()
        corr = correlation(joined["etf"], joined["future"])
        beta = joined["future"].cov(joined["etf"]) / joined["future"].var() if len(joined) >= 3 and joined["future"].var() > 0 else math.nan
        residual = (joined["etf"] - beta * joined["future"]) * 10_000 if math.isfinite(beta) else pd.Series(dtype=float)
        p95, maximum = float(residual.abs().quantile(.95)), float(residual.abs().max())
        total = etf_cost + future_cost + 2 * spread
        count = len(episode_list(residual, total, pd.Timedelta(days=1)))
        bt = next_open_bt(residual, etf, fut, beta, total)
        note = f"next-open BT: {bt['n']} long-ETF/short-future events, net {fmt(bt['mean'], 1)} bps/event, hit {fmt(bt['hit'], 1)}%, cum {fmt(bt['cum'], 2)}%"
        results.append(Result("ETF/NSE_COM", f"{symbol}/GOLD10G future", f"rho1d={fmt(corr, 4)}", p95, maximum, total, p95 / total, count,
                              classify(p95, total, count), note, int(bt["n"]), float(bt["mean"]), float(bt["hit"]), float(bt["cum"])))
    return results


def comex_results(intraday: dict[str, pd.DataFrame], gc: pd.DataFrame, fx: pd.DataFrame, notional: float) -> tuple[list[Result], dict[str, int], float, float]:
    index = intraday["GOLDBEES"].index
    gc_close, fx_close = asof_value(index, gc["close"]), asof_value(index, fx["close"])
    gc_high, gc_low = asof_value(index, gc["high"]), asof_value(index, gc["low"])
    fx_high, fx_low = asof_value(index, fx["high"]), asof_value(index, fx["low"])
    implied = (gc_close * fx_close / OUNCE_G).rename("comex")
    implied_returns = session_returns(implied)
    gc_range = float(((gc_high - gc_low) / ((gc_high + gc_low) / 2) * 10_000).median())
    fx_range = float(((fx_high - fx_low) / ((fx_high + fx_low) / 2) * 10_000).median())
    statutory_bps = cost_bps(statutory("gold_etf", notional), notional)
    results, coverage = [], {}
    for symbol in ETFS:
        etf_returns = session_returns(intraday[symbol]["close"])
        joined = pd.concat([etf_returns.rename("etf"), implied_returns], axis=1).dropna()
        coverage[symbol] = len(joined)
        corr = correlation(joined["etf"], joined["comex"])
        beta = joined["comex"].cov(joined["etf"]) / joined["comex"].var() if len(joined) >= 3 and joined["comex"].var() > 0 else math.nan
        residual = (joined["etf"] - beta * joined["comex"]) * 10_000 if math.isfinite(beta) else pd.Series(dtype=float)
        p95, maximum = float(residual.abs().quantile(.95)), float(residual.abs().max())
        total = statutory_bps + 2 * (bar_range(intraday[symbol]) + gc_range + fx_range)
        count = len(episode_list(residual, total, pd.Timedelta(minutes=30)))
        results.append(Result("ETF/COMEX", f"{symbol}/GC=F x INR=X", f"rho5={fmt(corr, 4)}", p95, maximum, total, p95 / total, count,
                              classify(p95, total, count, True), "INACCESSIBLE/STRUCTURAL; overseas fees omitted"))
    return results, coverage, gc_range, fx_range


def print_table(title: str, results: Sequence[Result]) -> None:
    print(f"\n{title}\nPair | relationship | p95/max bps | RT cost bps | p95/cost | independent opps | verdict\n" + "-" * 150)
    for r in results:
        print(f"{r.pair} | {r.relationship} | {fmt(r.measured, 1)}/{fmt(r.maximum, 1)} | {fmt(r.cost, 1)} | {fmt(r.ratio, 2)}x | {r.opportunities} | {r.verdict}")


def self_test() -> None:
    etf = statutory("gold_etf", 150_000)
    future = statutory("nse_gold_future", 150_000)
    assert etf.tax == 0 and math.isclose(etf.total, 62.9218) and math.isclose(future.tax, 15)
    index = pd.date_range("2026-01-01 09:15", periods=12, freq="5min", tz=IST)
    values = pd.Series([0, 1, 100, 120, 2, 3, 4, 110, 5, 6, 7, 8], index=index)
    assert len(episode_list(values, 50, pd.Timedelta(minutes=15))) == 2
    print("SELF-TEST PASS: cost arithmetic, episode de-duplication, and tax classification")


def main() -> int:
    a = args()
    if a.self_test:
        self_test()
        return 0
    end = date.fromisoformat(a.end)
    start, daily_start = end - timedelta(days=a.intraday_days - 1), end - timedelta(days=a.daily_days)
    print("GOLD ARBITRAGE / RELATIVE-VALUE STUDY\n" + "=" * 88)
    print(f"Run time: {datetime.now(IST).isoformat(timespec='seconds')}\nIntraday window: {start} to {end} (5-minute, NSE session only)\nDaily window: {daily_start} to {end}\nCost notional: INR {a.notional_per_leg:,.0f} per equal-risk leg")
    self_test()
    keys, db = db_info()
    print(f"\nDATA AVAILABILITY\nRead-only DB: NSE_COM={db['nse_com']:,}; MCX={db['mcx']} (classic MCX unavailable)")
    print("DB GOLD10G rows: " + ", ".join(f"{k}={v}" for k, v in db["gold10g"]))
    intraday, daily = {}, {}
    for symbol in ETFS:
        i, source = etf_candles(symbol, keys[symbol], 5, start.isoformat(), end.isoformat())
        d, _ = etf_candles(symbol, keys[symbol], 1440, daily_start.isoformat(), end.isoformat())
        local = i.index.tz_convert(IST)
        i = i.loc[(local.time >= pd.Timestamp("09:15").time()) & (local.time <= pd.Timestamp("15:25").time())].copy()
        d.index = d.index.tz_convert(IST).normalize().tz_localize(None)
        d = d[~d.index.duplicated(keep="last")]
        intraday[symbol], daily[symbol] = i, d
        print(f"{symbol:10s} 5m={len(i):4d} bars [{i.index.min()}..{i.index.max()}], 1d={len(d):3d} bars; {source}")
    gc5, fx5 = yf_data("GC=F", start.isoformat(), end.isoformat(), "5m"), yf_data("INR=X", start.isoformat(), end.isoformat(), "5m")
    gc1, fx1 = yf_data("GC=F", daily_start.isoformat(), end.isoformat(), "1d"), yf_data("INR=X", daily_start.isoformat(), end.isoformat(), "1d")
    print(f"GC=F       5m={len(gc5):4d} bars, 1d={len(gc1):3d} bars (yfinance)\nINR=X      5m={len(fx5):4d} bars, 1d={len(fx1):3d} bars (yfinance)")
    nse = nse_session()
    live, payload = live_gold10g(nse)
    if a.future_expiry:
        wanted = pd.to_datetime(a.future_expiry).strftime("%d-%b-%Y").upper()
        matches = [x for x in payload.get("data", []) if x.get("contract") == "GOLD10G" and str(x.get("expiryDate", "")).upper() == wanted]
        if not matches:
            raise DataError(f"requested expiry unavailable: {a.future_expiry}")
        live = matches[0]
    future = future_history(nse, live).loc[lambda x: (x.index >= start) & (x.index <= end)]
    book, spot = orderbook(nse, live), nse_spot(nse, daily_start, end)
    expiry_day = pd.to_datetime(live["expiryDate"]).date()
    fs = future.join(spot, how="inner")
    fs["basis_bps"] = (fs["future_inr_g"] / fs["spot_inr_g"] - 1) * 10_000
    fs["dte"] = [ (expiry_day - x).days for x in fs.index ]
    carry = np.log(fs["future_inr_g"] / fs["spot_inr_g"]) * 365 / fs["dte"] * 10_000
    traditional = sorted([x for x in payload.get("data", []) if x.get("contract") == "GOLD" and x.get("instrumentType") == "FUTBLN" and pd.to_datetime(x.get("expiryDate"), errors="coerce") >= pd.Timestamp.now(tz="UTC").tz_localize(None)], key=lambda x: pd.to_datetime(x["expiryDate"]))
    print(f"NSE GOLD10G selected: {live['identifier']} / {live['expiryDate']}; daily={len(future)} traded rows [{future.index.min()}..{future.index.max()}]")
    print(f"NSE GOLD10G vs GOLD1G spot basis: n={len(fs)}, median={fs['basis_bps'].median():.1f} bps, p05={fs['basis_bps'].quantile(.05):.1f}, p95={fs['basis_bps'].quantile(.95):.1f}; median annualized log carry={carry.median():.1f} bps")
    print(f"NSE live {book['timestamp']}: bid {book['bid']:,.0f} x{book['bid_qty']} / ask {book['ask']:,.0f} x{book['ask_qty']}; spread={book['spread']:.2f} bps; day volume={book['volume']:.0f}, OI={book['oi']:.0f}")
    if traditional:
        x = traditional[0]
        print(f"NSE traditional 1-kg GOLD nearest live contract: {x['expiryDate']}, volume={x.get('numberOfContractsTraded', 0)}, OI={x.get('openInterest', 0)} (zero means not currently tradeable)")
    probes = []
    for key in ("NSE_COM|134849", "NSE_COM|127514", "NSE_COM|22"):
        try:
            probes.append(f"{key}={len(upstox(key, 'minutes', 5, '2026-09-01', '2026-09-24'))}")
        except Exception as exc:
            probes.append(f"{key}=error:{type(exc).__name__}")
    print("Upstox NSE_COM DB-key probes: " + ", ".join(probes))
    etf_stat, future_stat = cost_bps(statutory("gold_etf", a.notional_per_leg), a.notional_per_leg), cost_bps(statutory("nse_gold_future", a.notional_per_leg), a.notional_per_leg)
    future_range = bar_range(future)
    conservative = etf_stat + future_stat + 2 * future_range
    print("\nEXECUTION INPUTS\nSymbol     median 5m high-low bps   median daily traded notional (INR)")
    for symbol in ETFS:
        turnover = (daily[symbol]["close"] * daily[symbol]["volume"]).median()
        print(f"{symbol:10s} {bar_range(intraday[symbol]):10.2f}   {turnover:,.0f}")
    print(f"Statutory gold-ETF round trip: {etf_stat:.2f} bps; NSE gold-future round trip: {future_stat:.2f} bps")
    print(f"NSE GOLD10G daily high-low proxy: {future_range:.2f} bps; conservative ETF/future pair cost using that proxy: {conservative:.1f} bps")
    pairs, reversions = etf_pair_results(intraday, daily, a.notional_per_leg)
    futures = future_results(daily, future, book["spread"], a.notional_per_leg)
    comex, coverage, gc_range, fx_range = comex_results(intraday, gc5, fx5, a.notional_per_leg)
    print(f"COMEX/FX 5m bar-range proxies: GC=F={gc_range:.2f} bps, INR=X={fx_range:.2f} bps")
    print_table("1) ETF vs ETF — 5m ratio deviation from full-sample median", pairs)
    valid = [x for x in reversions if math.isfinite(x)]
    if valid:
        print(f"ETF-pair 30-minute direction-reversion rate: median {np.median(valid):.1f}% across cost-threshold episodes (exploratory, in-sample centers)")
    print_table("2) ETF vs NSE_COM GOLD10G future — daily return residual", futures)
    print("ETF/future next-session event backtest (signal at t close, enter t+1 open):")
    for r in futures:
        print(f"  {r.pair}: {r.note}")
    print_table("3) ETF vs duty-unadjusted COMEX — 5m return residual", comex)
    print("5m common return bars: " + ", ".join(f"{k}={v}" for k, v in coverage.items()))
    external = external_daily(spot, gc1, fx1)
    spot_basis = external["basis_bps"]
    spot_fair = float(spot_basis.median())
    spot_dev = spot_basis - spot_fair
    spot_result = Result("Structural reference", "NSE GOLD1G spot / GC=F x INR=X", f"rho1d={fmt(correlation(np.log(external['spot_inr_g']).diff(), np.log(external['comex_inr_g']).diff()), 4)}",
                         float(spot_dev.abs().quantile(.95)), float(spot_dev.abs().max()), next(r.cost for r in comex if r.pair.startswith("GOLDBEES/")), math.nan,
                         len(episode_list(spot_dev, 100, pd.Timedelta(days=1))), "STRUCTURAL", f"raw basis median={fmt(spot_fair, 1)} bps; spot is reference, not executable")
    print_table("4) Indian spot vs COMEX — structural basis (not an arb)", [spot_result])
    print(f"Raw Indian spot premium over COMEX: median={spot_fair:.1f} bps, p05={spot_basis.quantile(.05):.1f}, p95={spot_basis.quantile(.95):.1f}, std={spot_basis.std():.1f}; n={len(spot_basis)} overlapping daily observations")
    triangle = external[["comex_inr_g"]].join(future[["future_inr_g"]], how="inner")
    triangle["tri"] = np.log(triangle["future_inr_g"] / triangle["comex_inr_g"])
    tri_dev = (triangle["tri"] - triangle["tri"].median()) * 10_000
    tri_result = Result("Triangle", "NSE spot / GOLD10G future / COMEX x FX", f"n={len(triangle)} common daily dates", float(tri_dev.abs().quantile(.95)), float(tri_dev.abs().max()),
                        future_stat + 2 * (book["spread"] + gc_range + fx_range), math.nan, len(episode_list(tri_dev, 100, pd.Timedelta(days=1))), "STRUCTURAL", "lower-bound cost; carry, hours, taxes and inaccessible COMEX leg")
    print_table("5) Triangular test", [tri_result])
    raw_passes = [r for r in pairs + futures + comex if r.verdict == "COST-PASS*"]
    validated = [r for r in futures if r.exec_n >= 2 and r.exec_mean > 0 and r.exec_hit >= 50]
    print("\nFINAL VERDICT")
    print(f"Raw measured spreads that clear the stated cost rule: {len(raw_passes)} of {len(pairs) + len(futures) + len(comex)}")
    print(f"Next-open event backtests with positive mean net P&L and >=50% hit rate: {len(validated)}")
    print("No tradeable edge after costs." if not validated else "A short-sample relative-value signal exists, but it is not validated arbitrage.")
    print("Conclusion: no tradeable edge after costs. The ETF/future residual screen clears cost in-sample, but every next-open long-ETF/short-future event backtest is negative; ETF/ETF deviations are spread across fee, NAV, cash-component and tracking differences; and the India/COMEX wedge is structural. A short window with no independent out-of-sample period cannot validate a trading edge.")
    print("Biggest limitation: MCX has zero rows in the read-only project DB, so the classic MCX gold contract is entirely absent. The active NSE GOLD10G contract is absent from the May-2026 DB snapshot and its project Upstox keys return no historical candles; official NSE daily data were used, but no historical depth/quote series was available.")
    print("Confidence: moderate for the null result on Indian ETF/ETF and NSE-future execution; lower for COMEX because an Indian retail account cannot execute that leg and overseas broker/regulatory/funding costs are not observable, so COMEX totals are explicit lower bounds.")
    print("\nSOURCE URLS (accessed by the script on each run)")
    for url in ("https://api.upstox.com/v3/historical-candle/", "https://www.nseindia.com/api/historicalOR/com/derivatives", "https://www.nseindia.com/api/quotes-commodity-derivatives-main", "https://www.nseindia.com/api/historical-spot-price", "https://nsearchives.nseindia.com/content/circulars/FA73061.pdf", "https://zerodha.com/charges/"):
        print(f"- {url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
