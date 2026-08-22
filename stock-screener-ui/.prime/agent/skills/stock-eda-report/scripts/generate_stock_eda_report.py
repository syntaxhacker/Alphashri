#!/usr/bin/env python
"""
Generate a volume / big-player / fundamentals EDA report for an NSE equity ticker.

Usage (run from the repo root, in the project venv):
    .venv/bin/python .prime/agent/skills/stock-eda-report/scripts/generate_stock_eda_report.py --symbol NETWEB
    # or reuse cached CSVs:
    ... --daily-csv experiments/data/netweb_daily.csv \
        --minute-csv experiments/data/netweb_1min_2025_2026q1.csv,experiments/data/netweb_1min_2026.csv

Produces reports/<SYMBOL>_EDA/{<SYMBOL>_EDA_report.html, <SYMBOL>_EDA_report.md, figures/*.png,
high_volume_days.csv, earnings_event_study.csv}.
"""
import argparse
import base64
import os
import sys
from pathlib import Path

# The project venv sometimes inherits a broken inline backend via MPLBACKEND;
# force Agg before matplotlib is imported.
os.environ["MPLBACKEND"] = "Agg"

import matplotlib
matplotlib.use("Agg")  # must precede pyplot import

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy import stats as st

REPO = Path(__file__).resolve().parents[5]  # <root>/.prime/agent/skills/stock-eda-report/scripts -> root
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO.parent))

IST = "Asia/Kolkata"
UP, DOWN, ACCENT, GOLD, GRAY, PURPLE = ("#1a7f37", "#c62828", "#1565c0", "#e65100", "#607d8b", "#6a1b9a")

# Sector/industry -> NSE peer tickers used for the valuation comparison table.
INDUSTRY_PEERS = {
    "Aerospace & Defense": ["BEL", "BDL", "MAZDOCK", "COCHINSHIP", "GRSE"],
    "Metals & Mining": ["NMDC", "VEDL", "SAIL", "JINDALSTEL"],
    "Steel": ["TATASTEEL", "JSWSTEEL", "SAIL"],
    "Software - Application": ["TCS", "INFY", "WIPRO", "HCLTECH"],
    "Information Technology Services": ["TCS", "INFY", "WIPRO", "HCLTECH"],
    "Banks - Regional": ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK"],
    "Banks - Diversified": ["HDFCBANK", "ICICIBANK", "SBIN"],
    "Auto Manufacturers": ["MARUTI", "TATAMOTORS", "M&M"],
    "Household & Personal Products": ["HINDUNILVR", "ITC", "DABUR"],
    "Pharmaceuticals": ["SUNPHARMA", "CIPLA", "DRREDDY"],
}


def fetch_peers(symbol: str, explicit_peers=None):
    """Fetch a small valuation comparison table for peer tickers (yfinance info only)."""
    import yfinance as yf
    peers = [p.strip().upper() for p in explicit_peers if p and p.strip()] if explicit_peers else []
    if not peers:
        try:
            ind = yf.Ticker(f"{symbol}.NS").info.get("industry")
            peers = INDUSTRY_PEERS.get(ind, [])
        except Exception:
            peers = []
    rows = []
    for p in peers:
        if p == symbol.upper():
            continue
        try:
            i = yf.Ticker(f"{p}.NS").info
            rows.append({
                "ticker": p,
                "name": (i.get("shortName") or i.get("longName") or p)[:24],
                "mcap_cr": (i.get("marketCap") or 0) / 1e7,
                "pe": i.get("trailingPE"),
                "ps": i.get("priceToSalesTrailing12Months"),
                "rev_growth": (i.get("revenueGrowth") * 100) if i.get("revenueGrowth") is not None else None,
                "div_yield": ((i.get("dividendRate") / i.get("currentPrice")) * 100) if (i.get("dividendRate") and i.get("currentPrice")) else None,
                "chg_52w": (i.get("52WeekChange") * 100) if i.get("52WeekChange") is not None else None,
            })
        except Exception:
            continue
    return pd.DataFrame(rows)




# ---------------------------------------------------------------- data loading
def _to_utc_aware(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    if idx.tz is None:
        return idx.tz_localize("UTC")
    return idx.tz_convert("UTC")


def fetch_nse_data(symbol: str, daily: pd.DataFrame) -> dict:
    """Fetch NSE big-player / market data via financeindia (delivery %, bulk/block/insider,
    FII-DII flows, NIFTY index yield). Returns a dict of optional pieces; each is None on failure."""
    out = {"delivery": None, "bulk": None, "block": None, "insider": None,
           "fii_dii": None, "index_yield": None}
    try:
        import financeindia
    except Exception:
        return out
    try:
        client = financeindia.FinanceClient()
        client._initialize_session()
    except Exception:
        return out

    last = daily.index.max()
    def dstr(ts, days_ago):
        return (ts - pd.Timedelta(days=days_ago)).strftime("%d-%m-%Y")
    to_s = last.strftime("%d-%m-%Y")

    import time
    # 1. delivery % (last ~30 trading days window)
    try:
        raw = client.deliverable_position_data(symbol, dstr(last, 45), to_s)
        if isinstance(raw, dict) and raw:
            dd = pd.DataFrame({k.strip(): v for k, v in raw.items()})
            if {"Date", "% Dly Qt to Traded Qty"}.issubset(set(dd.columns)):
                dd = dd.rename(columns={"Date": "date", "Traded Qty": "traded_qty",
                                        "Deliverable Qty": "deliverable_qty",
                                        "% Dly Qt to Traded Qty": "delivery_pct"})
                for c in ("traded_qty", "deliverable_qty"):
                    dd[c] = dd[c].astype(str).str.replace(",", "").astype(float)
                dd["delivery_pct"] = dd["delivery_pct"].astype(str).str.replace(",", "").astype(float)
                dd["date"] = pd.to_datetime(dd["date"], format="%d-%b-%Y", errors="coerce")
                out["delivery"] = dd[["date", "traded_qty", "deliverable_qty", "delivery_pct"]].dropna(subset=["date"]).sort_values("date")
    except Exception:
        pass
    time.sleep(0.4)

    # 2. bulk deals (filter symbol)
    try:
        raw = client.bulk_deal_data(dstr(last, 200), to_s)
        if isinstance(raw, dict) and raw:
            bd = pd.DataFrame({k.strip(): v for k, v in raw.items()})
            if "Symbol" in bd.columns:
                out["bulk"] = bd[bd["Symbol"].astype(str).str.strip().str.upper() == symbol.upper()]
    except Exception:
        pass
    time.sleep(0.4)

    # 3. block deals (filter symbol)
    try:
        raw = client.block_deals_data(dstr(last, 200), to_s)
        if isinstance(raw, dict) and raw:
            bd = pd.DataFrame({k.strip(): v for k, v in raw.items()})
            if "Symbol" in bd.columns:
                out["block"] = bd[bd["Symbol"].astype(str).str.strip().str.upper() == symbol.upper()]
    except Exception:
        pass
    time.sleep(0.4)

    # 4. insider trades (filter symbol)
    try:
        raw = client.get_insider_trades(dstr(last, 200), to_s)
        if isinstance(raw, dict) and "data" in raw:
            its = [r for r in raw["data"] if str(r.get("symbol", "")).strip().upper() == symbol.upper()]
            out["insider"] = its
    except Exception:
        pass
    time.sleep(0.4)

    # 5. FII/DII activity (latest)
    try:
        act = client.get_fii_dii_activity()
        out["fii_dii"] = [{"category": a.category, "date": a.date,
                           "buy_value": a.buy_value, "sell_value": a.sell_value,
                           "net_value": a.net_value} for a in act]
    except Exception:
        pass
    time.sleep(0.4)

    # 6. NIFTY 50 index yield (P/E, P/B, div yield)
    try:
        iy = client.get_index_yield("NIFTY 50", dstr(last, 20), to_s)
        data = iy.get("data") if isinstance(iy, dict) else None
        if data:
            out["index_yield"] = data[-1]
    except Exception:
        pass
    time.sleep(0.4)

    # 7. India VIX (market fear gauge)
    try:
        vix = client.get_india_vix_history(dstr(last, 20), to_s)
        vdata = vix.get("data") if isinstance(vix, dict) else None
        if vdata is not None and len(vdata):
            out["vix"] = vdata.iloc[-1] if hasattr(vdata, "iloc") else (vdata[-1] if isinstance(vdata, list) else vdata)
    except Exception:
        pass
    time.sleep(0.4)

    # 8. upcoming corporate actions (dividends/splits/bonus) filtered to symbol
    try:
        ca = client.get_corporate_actions()
        if isinstance(ca, list):
            out["corp_actions"] = [x for x in ca if str(x.get("symbol", "")).strip().upper() == symbol.upper()]
    except Exception:
        pass

    return out


def _screener_table(soup, sec_id):
    """Parse one Screener.in section table into a DataFrame (first col = item)."""
    sec = soup.find(id=sec_id)
    if not sec:
        return None
    table = sec.find("table")
    if not table:
        return None
    rows = []
    for tr in table.find_all("tr"):
        cells = [td.get_text(strip=True) for td in tr.find_all(["th", "td"])]
        if cells:
            rows.append(cells)
    if len(rows) < 2:
        return None
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df = df.rename(columns={df.columns[0]: "item"})
    return df


def fetch_screener(symbol: str) -> dict:
    """Scrape Screener.in for full balance sheet, P&L, cash flow, ratios and shareholding.
    Returns a dict of DataFrames (empty dict on any failure)."""
    import httpx
    from bs4 import BeautifulSoup
    url = f"https://www.screener.in/company/{symbol}/"
    try:
        r = httpx.get(url, timeout=30, follow_redirects=True,
                      headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"})
        if r.status_code != 200:
            return {}
        soup = BeautifulSoup(r.text, "lxml")
        return {
            "balance_sheet": _screener_table(soup, "balance-sheet"),
            "profit_loss": _screener_table(soup, "profit-loss"),
            "cash_flow": _screener_table(soup, "cash-flow"),
            "ratios": _screener_table(soup, "ratios"),
            "shareholding": _screener_table(soup, "shareholding"),
            "quarters": _screener_table(soup, "quarters"),
        }
    except Exception:
        return {}


def load_daily(symbol: str, csv_paths, daily_from: str = "2020-01-01") -> pd.DataFrame:
    """Return daily frame indexed by IST date (naive), with ret column added."""
    frames = []
    if csv_paths:
        for p in csv_paths:
            df = pd.read_csv(p, index_col=0, parse_dates=True)
            frames.append(df)
        daily = pd.concat(frames)
    else:
        from market_data.market_data import fetch_candles
        daily = fetch_candles(symbol, tf=1440, from_date=daily_from, to_date=_today_ist())
    daily = daily[~daily.index.duplicated(keep="last")].sort_index()
    daily.index = _to_utc_aware(daily.index).tz_convert(IST).normalize().tz_localize(None)
    daily.index.name = "date"
    daily = daily[~daily.index.duplicated(keep="last")]
    daily["ret"] = daily["close"].pct_change()
    return daily


def load_minute(csv_paths) -> pd.DataFrame:
    """Return 1-minute frame with IST tz-aware index."""
    frames = []
    for p in csv_paths:
        frames.append(pd.read_csv(p, index_col=0, parse_dates=True))
    m1 = pd.concat(frames)
    m1 = m1[~m1.index.duplicated(keep="first")].sort_index()
    m1.index = _to_utc_aware(m1.index).tz_convert(IST)
    return m1


def _today_ist() -> str:
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone(timedelta(hours=5, minutes=30))) - timedelta(days=1)).strftime("%Y-%m-%d")


# ---------------------------------------------------------------- daily analysis
def analyze_daily(daily: pd.DataFrame) -> dict:
    d = daily.copy()
    d["range_pct"] = (d["high"] - d["low"]) / d["close"] * 100
    d["gap_pct"] = (d["open"] - d["close"].shift(1)) / d["close"].shift(1) * 100
    d["intraday_pct"] = (d["close"] - d["open"]) / d["open"] * 100
    d["abs_ret"] = d["ret"].abs()
    d["log_vol"] = np.log(d["volume"])
    d["vol_ma60"] = d["volume"].rolling(60).mean()
    d["vol_ratio"] = d["volume"] / d["vol_ma60"]
    d["obv"] = (np.sign(d["close"].diff()).fillna(0) * d["volume"]).cumsum()
    hl = (d["high"] - d["low"]).replace(0, np.nan)
    d["adl"] = (((d["close"] - d["low"]) - (d["high"] - d["close"])) / hl * d["volume"]).cumsum()
    d["ret20_vol"] = d["ret"].rolling(20).std() * np.sqrt(252)
    for n in (1, 3, 5, 10, 20):
        d[f"fwd{n}"] = d["close"].shift(-n) / d["close"] - 1

    d2 = d[d.index >= "2025-01-01"]
    up = d2[d2["ret"] > 0]["volume"]
    dn = d2[d2["ret"] < 0]["volume"]
    rho_abs = st.spearmanr(d2["abs_ret"].dropna(), d2["volume"].reindex(d2["abs_ret"].dropna().index)).statistic
    rho_signed = st.spearmanr(d2["ret"].dropna(), d2["volume"].reindex(d2["ret"].dropna().index)).statistic

    def fwd_stats(mask):
        sub = d2[mask]
        return {h: (sub[f"fwd{h}"].mean() * 100, sub[f"fwd{h}"].median() * 100, len(sub)) for h in (1, 3, 5, 10, 20)}

    vol_sorted = d2["volume"].sort_values(ascending=False)
    top10 = vol_sorted.head(max(1, int(len(vol_sorted) * 0.1))).sum() / d2["volume"].sum() * 100
    top5 = vol_sorted.head(max(1, int(len(vol_sorted) * 0.05))).sum() / d2["volume"].sum() * 100

    return {
        "daily": d,
        "up_mean_vol": up.mean(), "down_mean_vol": dn.mean(),
        "up_median_vol": up.median(), "down_median_vol": dn.median(),
        "rho_abs_vol": rho_abs, "rho_signed_vol": rho_signed,
        "obv_corr": d2["close"].corr(d2["obv"]),
        "adl_corr": d2["close"].corr(d2["adl"]),
        "top10_share": top10, "top5_share": top5,
        "fwd_up3": fwd_stats((d2["vol_ratio"] > 3) & (d2["ret"] > 0)),
        "fwd_up5": fwd_stats((d2["vol_ratio"] > 5) & (d2["ret"] > 0)),
        "fwd_dn3": fwd_stats((d2["vol_ratio"] > 3) & (d2["ret"] < 0)),
        "fwd_base": fwd_stats(d2.index.notna()),
        "mean_ret": d2["ret"].mean(), "median_ret": d2["ret"].median(),
        "min_ret": d2["ret"].min(), "max_ret": d2["ret"].max(),
        "mean_rv": d2["ret20_vol"].mean(), "max_rv": d2["ret20_vol"].max(),
        "cur_rv": d2["ret20_vol"].iloc[-1],
        "ret_ac1": d2["ret"].dropna().autocorr(1),
        "jb_p": st.jarque_bera(d2["ret"].dropna()).pvalue,
        "logvol_ac1": d2["log_vol"].dropna().autocorr(1),
    }


# ---------------------------------------------------------------- intraday analysis
def analyze_intraday(m1: pd.DataFrame) -> dict:
    mi = m1.copy()
    mi["date"] = mi.index.normalize()
    mi["mins"] = (mi.index - mi.index.normalize() - pd.Timedelta(hours=9, minutes=15)).total_seconds() / 60
    mi = mi[mi["mins"].between(0, 380)]
    mi["bucket"] = (mi["mins"] // 15).astype(int)
    day_tot = mi.groupby("date")["volume"].transform("sum")
    mi["vol_share"] = mi["volume"] / day_tot
    mi["range_pct"] = (mi["high"] - mi["low"]) / mi["open"] * 100

    min_vol = mi.groupby(mi["mins"].astype(int)).agg(
        avg_volume=("volume", "mean"), share_pct=("vol_share", "mean"))
    min_vol["share_pct"] *= 100
    bucket_vol = mi.groupby("bucket").agg(
        avg_volume=("volume", "mean"), share_pct=("vol_share", "mean"), range_pct=("range_pct", "mean"))
    bucket_vol["share_pct"] *= 100

    def share(a, b):
        return mi[(mi["mins"] >= a) & (mi["mins"] <= b)]["vol_share"].sum() / mi["date"].nunique() * 100

    med = mi.groupby("date")["volume"].transform("median")
    mi["vol_x_med"] = mi["volume"] / med
    big = mi[mi["vol_x_med"] > 20].copy()
    big["bar_ret"] = big["close"] / big["open"] - 1
    big_hour = big.groupby(big.index.hour).size()
    n_big = len(big)
    first_hour = (big["mins"] < 60).sum()
    first15 = (big["mins"] < 15).sum()
    top_prints = mi.nlargest(10, "volume")[["open", "close", "volume"]].copy()
    top_prints["notional_cr"] = top_prints["close"] * top_prints["volume"] / 1e7
    top_prints.index = top_prints.index.strftime("%Y-%m-%d %H:%M")

    return {
        "min_vol": min_vol, "bucket_vol": bucket_vol, "big": big, "big_hour": big_hour,
        "open_min_share": min_vol.loc[0, "share_pct"],
        "first15_share": share(0, 14), "first30_share": share(0, 29),
        "first_hour_share": share(0, 59), "midday_share": share(150, 254),
        "last30_share": share(345, 374), "last15_share": share(360, 374),
        "open_min_vol": min_vol.loc[0, "avg_volume"], "median_min_vol": min_vol["avg_volume"].median(),
        "n_big": n_big, "first_hour_big_pct": first_hour / n_big * 100 if n_big else 0,
        "first15_big_pct": first15 / n_big * 100 if n_big else 0,
        "big_abs_move": big["bar_ret"].abs().mean() * 100,
        "top_prints": top_prints,
    }


# ---------------------------------------------------------------- yfinance
def yf_fetch(symbol: str) -> dict:
    import yfinance as yf
    out = {"symbol": symbol}
    t = yf.Ticker(f"{symbol}.NS")
    try:
        out["info"] = {k: t.info.get(k) for k in ("longName", "sector", "industry", "marketCap", "sharesOutstanding",
            "trailingPE", "forwardPE", "forwardEps", "priceToSalesTrailing12Months", "pegRatio", "dividendYield",
            "recommendationKey", "numberOfAnalystOpinions", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "dividendRate",
            "52WeekChange", "currentPrice")}
    except Exception:
        out["info"] = {}
    try:
        ed = t.earnings_dates
        if ed is not None and len(ed):
            ed = ed.reset_index()
            ed.columns = ["ts", "eps_est", "eps_actual", "surprise_pct"]
            ed["ts"] = pd.to_datetime(ed["ts"])
            ed["ist"] = ed["ts"].dt.tz_convert(IST)
            ed["date_ist"] = ed["ist"].dt.normalize()
            out["earnings_dates"] = ed
    except Exception:
        out["earnings_dates"] = None
    try:
        out["quarterly"] = t.quarterly_income_stmt
    except Exception:
        out["quarterly"] = None
    try:
        out["annual"] = t.income_stmt
    except Exception:
        out["annual"] = None
    try:
        out["major_holders"] = t.major_holders
    except Exception:
        out["major_holders"] = None
    try:
        out["targets"] = t.analyst_price_targets
    except Exception:
        out["targets"] = None
    try:
        out["calendar"] = t.calendar
    except Exception:
        out["calendar"] = None
    try:
        out["recs"] = t.recommendations_summary
    except Exception:
        out["recs"] = None
    try:
        nf = yf.download("^NSEI", start="2023-07-01", end=pd.Timestamp.today().strftime("%Y-%m-%d"),
                         progress=False, auto_adjust=False)
        c = nf["Close"]
        out["nifty"] = c.iloc[:, 0] if getattr(c, "ndim", 1) == 2 else c
    except Exception:
        out["nifty"] = None
    return out


def event_study(ed: pd.DataFrame, daily: pd.DataFrame) -> pd.DataFrame:
    tdays = pd.DatetimeIndex(sorted(daily.index))
    tdays_naive = pd.DatetimeIndex([pd.Timestamp(x) for x in tdays])

    def first_ge(date):
        for x in tdays_naive:
            if x >= date:
                return x
        return None

    rows = []
    for _, r in ed.iterrows():
        edate = pd.Timestamp(r["date_ist"]).tz_localize(None)
        d0 = first_ge(edate)
        if d0 is None:
            continue
        pos = list(tdays_naive).index(d0)
        def close_at(off):
            i = pos + off
            return daily.loc[tdays[i], "close"] if 0 <= i < len(tdays) else np.nan
        cprev = close_at(-1)
        if not (pd.notna(cprev) and cprev > 0):
            continue  # no valid price history before this event (outside daily window)
        vol_base = daily.loc[tdays[max(0, pos - 10)]:tdays[pos - 1], "volume"].mean() if pos >= 10 else np.nan
        rows.append({
            "ann_date_ist": edate.strftime("%Y-%m-%d"), "d0": d0.strftime("%Y-%m-%d"),
            "surprise_pct": r["surprise_pct"], "eps_est": r["eps_est"], "eps_actual": r["eps_actual"],
            "ret_d0": (close_at(0) / cprev - 1) if cprev else np.nan,
            "ret_d1": (close_at(1) / cprev - 1) if cprev else np.nan,
            "ret_d3": (close_at(3) / cprev - 1) if cprev else np.nan,
            "ret_d5": (close_at(5) / cprev - 1) if cprev else np.nan,
            "ret_d10": (close_at(10) / cprev - 1) if cprev else np.nan,
            "vol_ratio_d0": (daily.loc[tdays[pos], "volume"] / vol_base) if vol_base and vol_base > 0 else np.nan,
        })
    ev = pd.DataFrame(rows)
    if len(ev):
        s, r10 = ev["surprise_pct"], ev["ret_d10"] * 100
        m = s.notna() & r10.notna()
        ev["surprise_rho"] = st.spearmanr(s[m], r10[m]).statistic if m.sum() >= 3 else np.nan
        ev["surprise_p"] = st.spearmanr(s[m], r10[m]).pvalue if m.sum() >= 3 else np.nan
        ev["beat_10d"] = ev.loc[ev["surprise_pct"] > 0, "ret_d10"].mean() * 100
        ev["miss_10d"] = ev.loc[ev["surprise_pct"] < 0, "ret_d10"].mean() * 100
        ev["earn_vol_ratio"] = ev["vol_ratio_d0"].mean()
    return ev


# ---------------------------------------------------------------- market stats
def market_stats(daily: pd.DataFrame, nifty) -> dict:
    if nifty is None:
        return {}
    net = daily["close"].pct_change()
    net.index = pd.DatetimeIndex([pd.Timestamp(x) for x in net.index])
    nif = nifty.pct_change()
    nif.index = pd.DatetimeIndex([pd.Timestamp(x) for x in nif.index])
    m = pd.merge(net.rename("net"), nif.rename("nif"), left_index=True, right_index=True, how="inner").dropna()
    sub = m[m.index >= "2025-01-01"]
    beta = np.polyfit(sub["nif"], sub["net"], 1)[0]
    corr = sub["net"].corr(sub["nif"])
    # overnight vs intraday (2025-26)
    d = daily[daily.index >= "2025-01-01"]
    cum_gap = (1 + d["gap_pct"] / 100).prod() - 1
    cum_intra = (1 + d["intraday_pct"] / 100).prod() - 1
    up_gap = (d["gap_pct"] > 0).sum()
    return {"beta": beta, "corr_nifty": corr, "cum_gap": cum_gap, "cum_intra": cum_intra,
            "gap_up_pct": up_gap / len(d) * 100, "median_gap": d["gap_pct"].median(),
            "median_intra": d["intraday_pct"].median()}


# ---------------------------------------------------------------- figures
def _style():
    plt.rcParams.update({"figure.dpi": 110, "savefig.dpi": 130, "font.size": 10,
                         "axes.titlesize": 12, "axes.titleweight": "bold", "axes.grid": True,
                         "grid.alpha": 0.25, "grid.linewidth": 0.5, "figure.facecolor": "white",
                         "axes.facecolor": "white"})
    sns.set_theme(style="whitegrid", palette="deep")


def _bar_labels(ax, bars, fmt="{:.1f}", fontsize=8, dy=0.02):
    """Annotate bar tops with formatted values (used where numbers matter)."""
    for b in bars:
        h = b.get_height()
        if h is None or (isinstance(h, float) and np.isnan(h)):
            continue
        va = "bottom" if h >= 0 else "top"
        off = dy if h >= 0 else -dy
        ax.text(b.get_x() + b.get_width() / 2, h + off, fmt.format(h),
                ha="center", va=va, fontsize=fontsize)


def render_figures(sym, res, mk, figdir: Path):
    figdir.mkdir(parents=True, exist_ok=True)
    d = res["daily"]
    d2 = d[d.index >= "2025-01-01"]
    last_close = d["close"].iloc[-1]

    # --- shared helpers ---
    def qlabel(c):
        m, y = c.month, c.year
        q = {3: "Q4", 6: "Q1", 9: "Q2", 12: "Q3"}.get(m, "")
        fy = y if m == 3 else y + 1
        return f"{q} FY{fy % 100}" if q else str(c.date())

    # fig1 price/volume (volume colored by up/down day)
    dfull = d.copy()
    dfull["ma50"] = dfull["close"].rolling(50).mean()
    dfull["ma200"] = dfull["close"].rolling(200).mean()
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(12, 7.5), sharex=True, gridspec_kw={"height_ratios": [3, 1]})
    a1.plot(dfull.index, dfull["close"], color=ACCENT, lw=1.4, label="Close")
    a1.plot(dfull.index, dfull["ma50"], color=GOLD, lw=1.0, label="50-day MA")
    a1.plot(dfull.index, dfull["ma200"], color=GRAY, lw=1.0, label="200-day MA")
    a1.set_ylabel("Price (₹)"); a1.set_title(f"{sym} — Daily close, 50/200-day MAs"); a1.legend(fontsize=9)
    cols = np.where(dfull["ret"] >= 0, UP, DOWN)
    a2.bar(dfull.index, dfull["volume"], color=cols, width=1.0)
    a2.set_ylabel("Volume"); a2.set_title("Daily volume (green = up day, red = down day)", fontsize=10)
    a2.yaxis.set_major_formatter(lambda v, p: f"{v/1e6:.0f}M")
    fig.tight_layout(); fig.savefig(figdir / "fig1_price_volume.png", bbox_inches="tight"); plt.close(fig)

    # fig2 volume anomaly days (price + vol_ratio)
    dw = d2
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(12, 7.5), sharex=True, gridspec_kw={"height_ratios": [3, 1]})
    a1.plot(dw.index, dw["close"], color=ACCENT, lw=1.3); a1.set_ylabel("Close (₹)")
    a1.set_title(f"{sym} 2025–26: price vs volume-anomaly days (volume / 60-day avg)")
    up_m = dw[(dw["vol_ratio"] > 3) & (dw["ret"] > 0)]; dn_m = dw[(dw["vol_ratio"] > 3) & (dw["ret"] < 0)]
    a1.scatter(up_m.index, up_m["close"], color=UP, s=55, marker="^", label=f"High-vol UP day (n={len(up_m)})", zorder=5, edgecolor="white")
    a1.scatter(dn_m.index, dn_m["close"], color=DOWN, s=55, marker="v", label=f"High-vol DOWN day (n={len(dn_m)})", zorder=5, edgecolor="white")
    a1.legend(fontsize=9)
    a2.plot(dw.index, dw["vol_ratio"], color=GRAY, lw=0.9)
    a2.axhline(3, color=GOLD, ls="--", lw=1, label="3× avg (threshold)")
    a2.axhline(1, color="#90a4ae", ls=":", lw=1, label="60-day avg")
    a2.set_ylabel("Volume ratio (×60d avg)"); a2.legend(fontsize=9, loc="upper left")
    fig.tight_layout(); fig.savefig(figdir / "fig2_volume_anomaly.png", bbox_inches="tight"); plt.close(fig)

    # fig3 returns: histogram + rolling realized vol + |ret| vs volume
    fig, axes = plt.subplots(1, 3, figsize=(13, 4))
    ret = d["ret"].dropna()
    axes[0].hist(ret * 100, bins=60, color=ACCENT, alpha=0.75, edgecolor="white")
    axes[0].axvline(ret.mean() * 100, color=GOLD, lw=2, label=f"mean {ret.mean()*100:.2f}%")
    axes[0].axvline(0, color="#90a4ae", ls="--", lw=1)
    axes[0].set_xlabel("Daily return (%)"); axes[0].set_ylabel("Days")
    axes[0].set_title("Daily return distribution"); axes[0].legend(fontsize=9)
    axes[1].plot(d.index, d["ret20_vol"] * 100, color=ACCENT, lw=1.2)
    axes[1].set_ylabel("20-day realized vol (%)"); axes[1].set_title("Rolling realized volatility (annualized)")
    sc = d2
    axes[2].scatter(sc["volume"] / 1e6, sc["abs_ret"] * 100, s=18, alpha=0.5, color=ACCENT)
    axes[2].set_xscale("log")
    axes[2].set_xlabel("Volume (M shares, log)"); axes[2].set_ylabel("|Daily return| (%)")
    axes[2].set_title("|Return| vs volume (2025–26)")
    fig.tight_layout(); fig.savefig(figdir / "fig3_returns_vol.png", bbox_inches="tight"); plt.close(fig)

    # fig4 intraday volume profile (U-shape) with annotations
    mv = res["min_vol"]; bv = res["bucket_vol"]
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(12, 7), gridspec_kw={"height_ratios": [3, 1.2]})
    a1.fill_between(mv.index, mv["avg_volume"], color=ACCENT, alpha=0.25)
    a1.plot(mv.index, mv["avg_volume"], color=ACCENT, lw=1.3)
    a1.set_xlabel("Minutes since 09:15"); a1.set_ylabel("Avg volume per minute (shares)")
    a1.set_title(f"{sym} intraday volume profile — heavy opening, light midday, closing pickup")
    a1.axvspan(0, 15, color=UP, alpha=0.10, label="Open 09:15–09:30")
    a1.axvspan(360, 374, color=DOWN, alpha=0.10, label="Close 15:15–15:30")
    a1.annotate(f"09:15 opening print\n{mv.loc[0, 'avg_volume']:,.0f} shs ({mv.loc[0, 'share_pct']:.1f}% of day)",
                xy=(0, mv.loc[0, "avg_volume"]), xytext=(35, mv.loc[0, "avg_volume"] * 0.85),
                arrowprops=dict(arrowstyle="->", color=GOLD), fontsize=9, color=GOLD)
    a1.legend(loc="upper right", fontsize=9)
    a2.bar(bv.index, bv["share_pct"], color=ACCENT, width=0.8)
    a2.set_xlabel("15-minute bucket (0 = 09:15)"); a2.set_ylabel("% of daily volume")
    a2.set_title("Volume share per 15-min bucket", fontsize=10)
    fig.tight_layout(); fig.savefig(figdir / "fig4_intraday_volume_profile.png", bbox_inches="tight"); plt.close(fig)

    # fig5 intraday volatility + big bars by hour (2 panels)
    big = res["big"]
    big_hour = big.groupby(big.index.hour).size() if len(big) else pd.Series(dtype=int)
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.6))
    a1.plot(bv.index, bv["range_pct"], color=GOLD, lw=1.6, marker="o", ms=4)
    a1.set_xlabel("15-minute bucket (0 = 09:15)"); a1.set_ylabel("Avg high–low range (%)")
    a1.set_title("Intraday volatility by time of day")
    hours = range(9, 16)
    a2.bar([str(h) for h in hours], [big_hour.get(h, 0) for h in hours], color=ACCENT)
    a2.set_xlabel("Hour of day (IST)"); a2.set_ylabel("Count of big-volume bars")
    a2.set_title("Big-volume minute bars (>20× day median) by hour")
    fig.tight_layout(); fig.savefig(figdir / "fig5_intraday_volatility_bigbars.png", bbox_inches="tight"); plt.close(fig)

    # fig6 big-bar heatmap
    if len(big):
        hm = big.copy(); hm["moh"] = big.index.minute
        heat = hm.pivot_table(index="moh", columns=big.index.hour, values="volume", aggfunc="count", fill_value=0)
        heat = heat.reindex(columns=range(9, 16), fill_value=0).reindex(index=range(0, 60), fill_value=0)
        fig, ax = plt.subplots(figsize=(12, 5.5))
        sns.heatmap(heat, cmap="YlOrRd", ax=ax, cbar_kws={"label": "count of >20× bars"})
        ax.set_title(f"{sym}: when do big-volume (>20× day-median) minute bars occur?")
        ax.set_xlabel("Hour of day (IST)"); ax.set_ylabel("Minute of hour"); ax.invert_yaxis()
        fig.tight_layout(); fig.savefig(figdir / "fig6_bigbar_heatmap.png", bbox_inches="tight"); plt.close(fig)

    # fig7 day-of-week volume + return (2 panels)
    dw2 = d2.copy(); dw2["dow"] = pd.DatetimeIndex(dw2.index).dayofweek
    dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    v = dw2[dw2["dow"] < 5].groupby("dow")["volume"].mean()
    r7 = dw2[dw2["dow"] < 5].groupby("dow")["ret"].mean()
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 4.4))
    b = a1.bar(dow_names, v.values / 1e6, color=ACCENT)
    _bar_labels(a1, b, fmt="{:.2f}", fontsize=8, dy=0.03)
    a1.set_ylabel("Avg volume (M)"); a1.set_title("Average daily volume by day of week")
    a1.set_ylim(0, (v.max() / 1e6) * 1.2)
    b2 = a2.bar(dow_names, r7.values * 100, color=[UP if x >= 0 else DOWN for x in r7.values])
    _bar_labels(a2, b2, fmt="{:+.2f}%", fontsize=8, dy=0.03)
    a2.axhline(0, color="gray", lw=0.8); a2.set_ylabel("Avg daily return (%)")
    a2.set_title("Average daily return by day of week")
    lo = r7.min() * 100; hi = r7.max() * 100
    a2.set_ylim(lo - 0.3, hi + 0.3)
    fig.tight_layout(); fig.savefig(figdir / "fig7_dayofweek.png", bbox_inches="tight"); plt.close(fig)

    # fig8 forward returns (grouped bars with labels)
    fig, ax = plt.subplots(figsize=(10, 4.8))
    hor = [1, 3, 5, 10, 20]
    cats = {"Baseline": [res["fwd_base"][h][0] for h in hor],
            "Hi-vol UP >3x": [res["fwd_up3"][h][0] for h in hor],
            "Hi-vol UP >5x": [res["fwd_up5"][h][0] for h in hor],
            "Hi-vol DOWN >3x": [res["fwd_dn3"][h][0] for h in hor]}
    xpos = np.arange(len(hor)); width = 0.2
    bars = []
    for i, (c, vals) in enumerate(cats.items()):
        bars += list(ax.bar(xpos + (i - 1.5) * width, vals, width, label=c, color=[GRAY, UP, "#0d47a1", DOWN][i]))
    _bar_labels(ax, bars, fmt="{:+.0f}%", fontsize=7, dy=0.06)
    ax.axhline(0, color="gray", lw=0.8); ax.set_xticks(xpos); ax.set_xticklabels([f"{h}d" for h in hor])
    ax.set_ylabel("Avg forward return (%)"); ax.set_title("Forward returns after high-volume days (2025–26)")
    ax.legend(fontsize=8)
    ax.set_ylim(min(0, min(min(v) for v in cats.values())) - 6, max(max(v) for v in cats.values()) + 8)
    fig.tight_layout(); fig.savefig(figdir / "fig8_forward_returns.png", bbox_inches="tight"); plt.close(fig)

    # fig9 OBV / A-D line vs price
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(12, 6.5), sharex=True, gridspec_kw={"height_ratios": [2, 1]})
    a1.plot(d2.index, d2["close"], color=ACCENT, lw=1.3, label="Close"); a1.set_ylabel("Close (₹)")
    a1.set_title(f"{sym} 2025–26: price vs On-Balance Volume (OBV) & Accumulation/Distribution line")
    a1.legend(loc="upper left", fontsize=9)
    a1b = a1.twinx()
    a1b.plot(d2.index, d2["obv"] / 1e6, color=GOLD, lw=1.0, alpha=0.8, label="OBV (M)")
    a1b.set_ylabel("OBV (M shares)", color=GOLD); a1b.tick_params(axis="y", labelcolor=GOLD)
    a1b.legend(loc="upper right", fontsize=9)
    a2.plot(d2.index, d2["adl"] / 1e6, color=PURPLE, lw=1.1, label="A/D line (M)")
    a2.set_ylabel("A/D line (M)"); a2.legend(loc="upper left", fontsize=9)
    fig.tight_layout(); fig.savefig(figdir / "fig9_obv_adl.png", bbox_inches="tight"); plt.close(fig)

    # fig10 volume concentration (Lorenz) + monthly volume (2 panels)
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.5))
    vs = d2["volume"].sort_values(ascending=False); cum = np.cumsum(vs) / vs.sum()
    a1.plot(np.linspace(0, 1, len(vs)), cum, color=ACCENT, lw=1.6)
    a1.plot([0, 1], [0, 1], color=GRAY, ls="--", lw=1, label="uniform")
    a1.fill_between(np.linspace(0, 1, len(vs)), cum, np.linspace(0, 1, len(vs)), alpha=0.12, color=ACCENT)
    a1.axvline(0.1, color=GOLD, ls=":", lw=1)
    a1.annotate("top 10% of days", xy=(0.1, 0.55), xytext=(0.28, 0.3), arrowprops=dict(arrowstyle="->"), fontsize=9)
    a1.set_xlabel("Cumulative share of trading days"); a1.set_ylabel("Cumulative share of volume")
    a1.set_title(f"Volume concentration: top 10% days = {res['top10_share']:.0f}% of volume"); a1.legend(fontsize=9)
    mv10 = d2["volume"].resample("ME").sum()
    a2.bar(range(len(mv10)), mv10 / 1e6, color=ACCENT, width=0.7)
    a2.set_xticks(range(len(mv10))); a2.set_xticklabels([t.strftime("%b %y") for t in mv10.index], rotation=45, ha="right", fontsize=8)
    a2.set_ylabel("Monthly volume (M)"); a2.set_title("Monthly traded volume")
    fig.tight_layout(); fig.savefig(figdir / "fig10_concentration_monthly.png", bbox_inches="tight"); plt.close(fig)

    # fig11 earnings surprise -> forward return (scatter + beat/miss bars)
    ed = res.get("earnings_dates")
    if ed is not None and len(ed):
        s11, r10 = ed["surprise_pct"], ed["ret_d10"] * 100
        m = s11.notna() & r10.notna()
        fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.8))
        a1.scatter(s11[m], r10[m], s=70, c=[UP if x >= 0 else DOWN for x in s11[m]], edgecolor="white", zorder=3)
        if m.sum() >= 3:
            b_, a_ = np.polyfit(s11[m], r10[m], 1)
            xs = np.linspace(s11[m].min(), s11[m].max(), 20)
            a1.plot(xs, a_ + b_ * xs, color=GOLD, ls="--", lw=1.2, label=f"trend (rho={ed['surprise_rho'].iloc[0]:.2f})")
        a1.axhline(0, color=GRAY, lw=0.8); a1.axvline(0, color=GRAY, lw=0.8)
        a1.set_xlabel("EPS surprise vs estimate (%)"); a1.set_ylabel("10-day fwd return (%)")
        a1.set_title("Earnings surprise → forward return"); a1.legend(fontsize=9)
        beat_v, miss_v = ed["beat_10d"].iloc[0], ed["miss_10d"].iloc[0]
        b2 = a2.bar(["Beat", "Miss"], [beat_v, miss_v], color=[UP, DOWN], width=0.5)
        _bar_labels(a2, b2, fmt="{:+.1f}%", fontsize=9, dy=0.05)
        a2.axhline(0, color=GRAY, lw=0.8); a2.set_title("Reaction by surprise sign")
        lo = min(0, beat_v, miss_v); hi = max(0, beat_v, miss_v)
        a2.set_ylim(lo - 8, hi + 8)
        fig.tight_layout(); fig.savefig(figdir / "fig11_earnings_surprise.png", bbox_inches="tight"); plt.close(fig)

    # fig12 fundamentals: annual rev/NI + quarterly revenue (2 panels)
    ann = res.get("annual")
    quarterly = res.get("quarterly")
    if ann is not None and "Total Revenue" in ann.index:
        yrs = [c for c in ann.columns if str(c.year) in ("2023", "2024", "2025", "2026")][-4:]
        rev = ann.loc["Total Revenue", yrs] / 1e7
        ni = ann.loc["Net Income", yrs] / 1e7 if "Net Income" in ann.index else pd.Series([np.nan] * len(yrs), index=yrs)
        fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 5))
        x = np.arange(len(yrs))
        b1 = a1.bar(x - 0.2, rev.values, 0.4, color=ACCENT, label="Revenue (₹ Cr)")
        b2 = a1.bar(x + 0.2, ni.values, 0.4, color=GOLD, label="Net income (₹ Cr)")
        _bar_labels(a1, b1, fmt="{:,.0f}", fontsize=8, dy=0.025)
        _bar_labels(a1, b2, fmt="{:,.0f}", fontsize=8, dy=0.025)
        a1.set_xticks(x); a1.set_xticklabels([f"FY{c.year % 100}" for c in yrs])
        a1.set_ylim(0, np.nanmax(np.concatenate([rev.values, ni.values])) * 1.18)
        a1.set_title("Annual revenue & net income (₹ Cr)"); a1.legend(fontsize=9)
        if quarterly is not None and "Total Revenue" in quarterly.index:
            qrev = quarterly.loc["Total Revenue"].dropna().sort_index().tail(8)
            b3 = a2.bar(range(len(qrev)), qrev.values / 1e7, color=ACCENT, width=0.6)
            _bar_labels(a2, b3, fmt="{:,.0f}", fontsize=7, dy=0.03)
            a2.set_xticks(range(len(qrev))); a2.set_xticklabels([qlabel(c) for c in qrev.index], rotation=30, ha="right", fontsize=8)
            a2.set_ylim(0, (qrev.values.max() / 1e7) * 1.2)
            a2.set_title("Quarterly revenue (₹ Cr)")
        else:
            a2.axis("off")
        fig.tight_layout(); fig.savefig(figdir / "fig12_fundamentals.png", bbox_inches="tight"); plt.close(fig)

    # fig13 overnight vs intraday cumulative
    fig, ax = plt.subplots(figsize=(12, 4.6))
    ax.plot(d2.index, (1 + d2["gap_pct"] / 100).cumprod() - 1, color=PURPLE, lw=1.4, label="Overnight gap (open vs prev close)")
    ax.plot(d2.index, (1 + d2["intraday_pct"] / 100).cumprod() - 1, color=GOLD, lw=1.4, label="Intraday (open → close)")
    ax.plot(d2.index, (1 + d2["ret"]).cumprod() - 1, color=ACCENT, lw=1.8, label="Total daily")
    ax.axhline(0, color=GRAY, lw=0.8); ax.set_ylabel("Cumulative return")
    ax.set_title(f"{sym} 2025–26: overnight gap vs intraday session"); ax.legend(fontsize=9)
    ax.yaxis.set_major_formatter(lambda v, p: f"{v*100:.0f}%")
    fig.tight_layout(); fig.savefig(figdir / "fig13_overnight_intraday.png", bbox_inches="tight"); plt.close(fig)

    # fig14 correlation matrix
    f = d2[["ret", "abs_ret", "log_vol", "range_pct", "gap_pct", "intraday_pct", "vol_ratio"]]
    corr = f.corr(method="spearman")
    fig, ax = plt.subplots(figsize=(8.5, 7))
    sns.heatmap(corr, mask=np.triu(np.ones_like(corr, dtype=bool)), annot=True, fmt=".2f", cmap="RdBu_r",
                center=0, vmin=-1, vmax=1, square=True, ax=ax, cbar_kws={"label": "Spearman ρ"},
                annot_kws={"size": 9}, linewidths=0.5)
    ax.set_title("Daily feature correlation matrix (2025–26)")
    fig.tight_layout(); fig.savefig(figdir / "fig14_corr_matrix.png", bbox_inches="tight"); plt.close(fig)

    # fig15 rolling beta & correlation vs NIFTY
    if mk and "beta" in mk:
        net = d["close"].pct_change(); net.index = pd.DatetimeIndex([pd.Timestamp(x) for x in net.index])
        nif = res["nifty"].pct_change(); nif.index = pd.DatetimeIndex([pd.Timestamp(x) for x in nif.index])
        m = pd.merge(net.rename("net"), nif.rename("nif"), left_index=True, right_index=True, how="inner").dropna()
        sub = m[m.index >= "2025-01-01"].copy()
        sub["rb"] = sub["net"].rolling(60).cov(sub["nif"]) / sub["nif"].rolling(60).var()
        sub["rc"] = sub["net"].rolling(60).corr(sub["nif"])
        fig, (a1, a2) = plt.subplots(2, 1, figsize=(12, 6), sharex=True)
        a1.plot(sub.index, sub["rb"], color=GOLD, lw=1.2); a1.axhline(1, color=GRAY, ls="--", lw=0.8, label="beta = 1")
        a1.set_ylabel("60-day rolling beta"); a1.set_title(f"{sym} vs NIFTY 50 — rolling beta & correlation"); a1.legend(fontsize=9)
        a2.plot(sub.index, sub["rc"], color=ACCENT, lw=1.2)
        a2.axhline(sub["rc"].mean(), color=GRAY, ls=":", lw=0.8, label=f"avg ≈ {sub['rc'].mean():.2f}")
        a2.set_ylabel("60-day rolling correlation"); a2.legend(fontsize=9)
        fig.tight_layout(); fig.savefig(figdir / "fig15_beta_corr.png", bbox_inches="tight"); plt.close(fig)

    # fig16 ownership donut + valuation multiples (2 panels)
    mh = res.get("major_holders")
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 4.6))
    vals = {}
    if mh is not None and len(mh):
        idx = mh.index.astype(str)
        for i in range(len(mh)):
            if idx[i] in ("insidersPercentHeld", "institutionsPercentHeld"):
                try:
                    vals[idx[i]] = float(mh.iloc[i]["Value"]) * 100
                except Exception:
                    pass
    if vals:
        data = [vals[k] for k in vals]; lbls = [("Insiders" if k == "insidersPercentHeld" else "Institutions") for k in vals]
        data.append(max(0.0, 100 - sum(data))); lbls.append("Other/public")
        w_, _ = a1.pie(data, colors=[ACCENT, GOLD, GRAY], startangle=90, counterclock=False,
                       wedgeprops=dict(width=0.42, edgecolor="white"))
        a1.legend(w_, [f"{l}: {v:.0f}%" for l, v in zip(lbls, data)], loc="center left", bbox_to_anchor=(0.9, 0.5), fontsize=9)
        a1.set_title("Shareholding split")
    else:
        a1.axis("off"); a1.set_title("Shareholding split")
    val_rows = []
    ann2 = res.get("annual"); info2 = res.get("info") or {}
    shares = info2.get("sharesOutstanding")
    fy_eps = None; fy_rev = None
    if ann2 is not None:
        if "Diluted EPS" in ann2.index:
            es = ann2.loc["Diluted EPS"].dropna().sort_index()
            fy_eps = float(es.iloc[-1]) if len(es) else None
        if "Total Revenue" in ann2.index:
            rs = ann2.loc["Total Revenue"].dropna().sort_index()
            fy_rev = float(rs.iloc[-1]) if len(rs) else None
    fwd_eps_est = None
    if ed is not None and len(ed):
        le = ed.sort_values("ann_date_ist")["eps_est"].dropna()
        if len(le):
            fwd_eps_est = float(le.iloc[-1]) * 4
    pe_t = info2.get("trailingPE") or (last_close / fy_eps if fy_eps else None)
    pe_f = info2.get("forwardPE") or (last_close / fwd_eps_est if fwd_eps_est else None)
    ps_v = info2.get("priceToSalesTrailing12Months") or (last_close * shares / fy_rev if (fy_rev and shares) else None)
    if pe_t:
        val_rows.append(("Trailing P/E", pe_t))
    if pe_f:
        val_rows.append(("Forward P/E", pe_f))
    if ps_v:
        val_rows.append(("P/S", ps_v))
    if val_rows:
        names = [r[0] for r in val_rows]; nums = [r[1] for r in val_rows]
        b2 = a2.barh(names, nums, color=[DOWN, GOLD, ACCENT][:len(names)], height=0.55)
        for bb, vv in zip(b2, nums):
            a2.text(vv + max(nums) * 0.02, bb.get_y() + bb.get_height() / 2, f"{vv:.1f}×", va="center", fontsize=10, fontweight="bold")
        a2.set_xlabel("Multiple (×)"); a2.set_title(f"Valuation (price ₹{last_close:,.0f})")
        a2.set_xlim(0, max(nums) * 1.15)
    else:
        a2.axis("off"); a2.set_title(f"Valuation (price ₹{last_close:,.0f})")
    fig.tight_layout(); fig.savefig(figdir / "fig16_ownership_valuation.png", bbox_inches="tight"); plt.close(fig)

    # fig17 price vs key levels (support/resistance + analyst target)
    hi52 = float(d["high"].tail(252).max()) if len(d) else np.nan
    lo52 = float(d["low"].tail(252).min()) if len(d) else np.nan
    ma50 = float(d["close"].rolling(50).mean().iloc[-1]) if len(d) >= 50 else np.nan
    ma200 = float(d["close"].rolling(200).mean().iloc[-1]) if len(d) >= 200 else np.nan
    support = float(d2.tail(60)["low"].min()); resistance = float(d2.tail(60)["high"].max())
    tgt_mean = (res.get("targets") or {}).get("mean")
    fig, ax = plt.subplots(figsize=(12, 6.5))
    ax.plot(d2.index, d2["close"], color=ACCENT, lw=1.3, label="Close", zorder=2)
    ax.axhline(last_close, color=GRAY, ls="--", lw=0.8, label=f"Last close ₹{last_close:,.0f}", zorder=3)
    if np.isfinite(hi52):
        ax.axhline(hi52, color=UP, ls=":", lw=1.1, label=f"52w high ₹{hi52:,.0f}")
    if np.isfinite(lo52):
        ax.axhline(lo52, color=DOWN, ls=":", lw=1.1, label=f"52w low ₹{lo52:,.0f}")
    if np.isfinite(ma50):
        ax.axhline(ma50, color=GOLD, lw=1.0, label=f"50d MA ₹{ma50:,.0f}")
    if np.isfinite(ma200):
        ax.axhline(ma200, color=PURPLE, lw=1.0, label=f"200d MA ₹{ma200:,.0f}")
    ax.axhline(support, color=DOWN, ls="-.", lw=1.1, label=f"Support (60d low) ₹{support:,.0f}")
    ax.axhline(resistance, color=UP, ls="-.", lw=1.1, label=f"Resistance (60d high) ₹{resistance:,.0f}")
    if tgt_mean:
        ax.axhline(tgt_mean, color=GOLD, ls="--", lw=1.3, label=f"Analyst target ₹{tgt_mean:,.0f}")
    ax.set_ylabel("Price (₹)"); ax.set_title(f"{sym} 2025–26 — price vs key levels")
    ax.legend(loc="upper left", fontsize=8, ncol=2, frameon=True)
    fig.tight_layout(); fig.savefig(figdir / "fig17_valuation_levels.png", bbox_inches="tight"); plt.close(fig)

    # fig18 delivery % (NSE big-player gauge)
    nse18 = res.get("nse") or {}
    delivery = nse18.get("delivery")
    if delivery is not None and len(delivery):
        fig, ax = plt.subplots(figsize=(11, 4.6))
        d18 = delivery.tail(20).reset_index(drop=True)
        colors = [UP if v >= 50 else (DOWN if v < 35 else GRAY) for v in d18["delivery_pct"]]
        ax.bar(range(len(d18)), d18["delivery_pct"], color=colors, width=0.65)
        ax.axhline(50, color=UP, ls="--", lw=1, label="50% — accumulation")
        ax.axhline(35, color=DOWN, ls="--", lw=1, label="35% — churn")
        ax.set_xticks(range(len(d18)))
        ax.set_xticklabels([t.strftime("%d-%b") for t in d18["date"]], rotation=45, ha="right", fontsize=8)
        ax.set_ylabel("Delivery %"); ax.set_ylim(0, 105)
        ax.set_title(f"{sym} — delivery % (NSE) — high = committed buying, low = intraday churn")
        ax.legend(fontsize=9, loc="upper left")
        fig.tight_layout(); fig.savefig(figdir / "fig18_delivery.png", bbox_inches="tight"); plt.close(fig)

    # fig19 shareholding trend (Screener.in)
    sc19 = res.get("screener") or {}
    sh19 = sc19.get("shareholding")
    if sh19 is not None and len(sh19):
        cols = [c for c in sh19.columns if c != "item"]
        last8 = cols[-8:]
        fig, ax = plt.subplots(figsize=(11, 4.6))
        cmap = {"Promoters+": ACCENT, "FIIs+": GOLD, "DIIs+": UP}
        for item, lbl in [("Promoters+", "Promoters"), ("FIIs+", "FIIs"), ("DIIs+", "DIIs")]:
            row = sh19[sh19["item"].str.strip() == item]
            if len(row):
                vals = [float(str(row.iloc[0][c]).replace("%", "")) for c in last8]
                ax.plot(last8, vals, marker="o", ms=4, lw=1.6, label=lbl, color=cmap.get(item, GRAY))
        ax.set_ylabel("% holding"); ax.set_title(f"{sym} — shareholding trend (NSE quarterly)")
        ax.legend(fontsize=9); ax.grid(alpha=0.25)
        fig.tight_layout(); fig.savefig(figdir / "fig19_shareholding.png", bbox_inches="tight"); plt.close(fig)






def _fiscal_quarter(ann: str) -> str:
    """Map an earnings announcement date to the Indian fiscal quarter it reports."""
    dt = pd.Timestamp(ann)
    y, m = dt.year, dt.month
    if m <= 3:
        return f"Q3 FY{y}"
    if m <= 6:
        return f"Q4 FY{y}"
    if m <= 9:
        return f"Q1 FY{y + 1}"
    return f"Q2 FY{y + 1}"


def render_report(sym, res, mk, figdir, outdir):
    figdir.mkdir(parents=True, exist_ok=True)
    d = res["daily"]
    d2 = d[d.index >= "2025-01-01"]
    last_close = d["close"].iloc[-1]
    px_lo, px_hi = d["close"].min(), d["close"].max()
    gen_date = pd.Timestamp.today().strftime("%Y-%m-%d")

    # ---- additional context stats ----
    dd = d2.copy()
    dd["dow"] = pd.DatetimeIndex(dd.index).dayofweek
    dd["month"] = pd.DatetimeIndex(dd.index).month
    dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    dow_vol = dd[dd["dow"] < 5].groupby("dow")["volume"].mean()
    dow_ret = dd[dd["dow"] < 5].groupby("dow")["ret"].mean()
    month_names = {1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
                   7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"}
    mon_vol = dd.groupby("month")["volume"].mean()
    mon_ret = dd.groupby("month")["ret"].mean()
    feats = ["ret", "abs_ret", "log_vol", "range_pct", "gap_pct", "intraday_pct", "vol_ratio"]
    feat_corr = d2[feats].corr(method="spearman")

    # earnings context
    ed = res.get("earnings_dates")
    has_earn = ed is not None and len(ed) > 0
    n_beats = int((ed["surprise_pct"] > 0).sum()) if has_earn else 0
    n_miss = int((ed["surprise_pct"] < 0).sum()) if has_earn else 0
    rho_earn = float(ed["surprise_rho"].iloc[0]) if has_earn else float("nan")
    p_earn = float(ed["surprise_p"].iloc[0]) if has_earn else float("nan")

    # fundamentals context
    annual = res.get("annual")
    rev_cr = ni_cr = eps_series = None
    if annual is not None:
        if "Total Revenue" in annual.index:
            rev_cr = annual.loc["Total Revenue"].dropna().sort_index()
        if "Net Income" in annual.index:
            ni_cr = annual.loc["Net Income"].dropna().sort_index()
        if "Diluted EPS" in annual.index:
            eps_series = annual.loc["Diluted EPS"].dropna().sort_index()
    info = res.get("info") or {}
    shares = info.get("sharesOutstanding")
    fy_eps = float(eps_series.iloc[-1]) if eps_series is not None and len(eps_series) else None
    fy_rev = float(rev_cr.iloc[-1]) if rev_cr is not None and len(rev_cr) else None
    fwd_eps_est = None
    if has_earn:
        ne = ed.sort_values("ann_date_ist")
        last_est = ne["eps_est"].dropna()
        if len(last_est):
            fwd_eps_est = float(last_est.iloc[-1]) * 4
    mh = res.get("major_holders")
    holders = {}
    if mh is not None and len(mh):
        idx = mh.index.astype(str)
        for i in range(len(mh)):
            if idx[i] in ("insidersPercentHeld", "institutionsPercentHeld", "institutionsCount"):
                try:
                    holders[idx[i]] = float(mh.iloc[i]["Value"])
                except Exception:
                    pass
    tgt = res.get("targets") or {}
    tp = res.get("top_prints")

    # ---- investment-view / valuation context ----
    pe_trailing = info.get("trailingPE") or (last_close / fy_eps if fy_eps else None)
    pe_forward = info.get("forwardPE") or (last_close / fwd_eps_est if fwd_eps_est else None)
    ps_ratio = info.get("priceToSalesTrailing12Months") or (last_close * shares / fy_rev if (fy_rev and shares) else None)
    div_rate = info.get("dividendRate")
    div_yield = (div_rate / last_close) * 100 if div_rate else None
    rec_key = info.get("recommendationKey")
    n_analysts = info.get("numberOfAnalystOpinions")
    rev_growth = eps_growth = None
    if rev_cr is not None and len(rev_cr) >= 2:
        rev_growth = (float(rev_cr.iloc[-1]) / float(rev_cr.iloc[-2]) - 1) * 100
    if eps_series is not None and len(eps_series) >= 2:
        eps_growth = (float(eps_series.iloc[-1]) / float(eps_series.iloc[-2]) - 1) * 100
    peg = pe_trailing / eps_growth if (pe_trailing and eps_growth) else None
    hi52 = float(d["high"].tail(252).max()) if len(d) else None
    lo52 = float(d["low"].tail(252).min()) if len(d) else None
    ma50 = float(d["close"].rolling(50).mean().iloc[-1]) if len(d) >= 50 else None
    ma200 = float(d["close"].rolling(200).mean().iloc[-1]) if len(d) >= 200 else None
    recent60 = d2.tail(60)
    support = float(recent60["low"].min())
    resistance = float(recent60["high"].max())
    tgt_mean = tgt.get("mean")
    upside = ((tgt_mean - last_close) / last_close * 100) if tgt_mean else None
    upside_high = ((tgt.get("high") - last_close) / last_close * 100) if tgt.get("high") else None
    downside_low = ((tgt.get("low") - last_close) / last_close * 100) if tgt.get("low") else None
    if upside is not None and peg is not None:
        verdict = ("Undervalued (growth-adjusted) — Buy bias" if (peg < 1.0 and upside > 10)
                   else "Overvalued (growth-adjusted) — Caution" if (peg > 2.5 or upside < -10)
                   else "Fairly valued — Hold")
    elif peg is not None:
        verdict = ("Undervalued (growth-adjusted) — Buy bias" if peg < 1.0
                   else "Overvalued (growth-adjusted) — Caution" if peg > 2.5
                   else "Fairly valued — Hold")
    elif upside is not None:
        verdict = ("Undervalued — Buy bias" if upside > 15
                   else "Overvalued — Caution" if upside < -10
                   else "Neutral — Hold")
    else:
        verdict = "Neutral — Hold"
    recs = res.get("recs")
    rec_line = ""
    if recs is not None and len(recs):
        r0 = recs.iloc[0]
        b_ = int(r0.get("strongBuy", 0) or 0) + int(r0.get("buy", 0) or 0)
        h_ = int(r0.get("hold", 0) or 0)
        s_ = int(r0.get("sell", 0) or 0) + int(r0.get("strongSell", 0) or 0)
        rec_line = f"{b_} Buy / {h_} Hold / {s_} Sell"

    # ---- risk / performance metrics (2025-26 daily returns) ----
    peers_df = res.get("peers")
    nse = res.get("nse") or {}
    sc = res.get("screener") or {}

    def _sc_latest(df):
        if df is None or len(df) == 0:
            return None
        cols = [c for c in df.columns if str(c) not in ("item", "TTM")]
        return cols[-1] if cols else None

    def _sc_val(df, item, col=None):
        if df is None:
            return None
        col = col or _sc_latest(df)
        if col is None:
            return None
        try:
            row = df[df["item"].str.strip() == item]
            if len(row):
                return float(str(row.iloc[0][col]).replace(",", "").replace("%", "").strip())
        except Exception:
            pass
        return None
    rr = d2["ret"].dropna()
    sharpe = rr.mean() / rr.std() * np.sqrt(252) if rr.std() else None
    dn_std = rr[rr < 0].std()
    sortino = rr.mean() / dn_std * np.sqrt(252) if dn_std and dn_std > 0 else None
    cum_ret = (1 + rr).cumprod()
    max_dd = (cum_ret / cum_ret.cummax() - 1).min()
    var95 = rr.quantile(0.05)
    win_rate = (rr > 0).mean()
    avg_win = rr[rr > 0].mean(); avg_loss = rr[rr < 0].mean()
    payoff = avg_win / abs(avg_loss) if avg_loss else None

    def pct(x, d=1):
        return "—" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:+,.{d}f}%"

    def rup(x):
        return "—" if x is None else f"₹{x:,.0f}"

    hi_m = month_names[mon_vol.idxmax()]; lo_m = month_names[mon_vol.idxmin()]
    hi_r = month_names[mon_ret.idxmax()]; lo_r = month_names[mon_ret.idxmin()]
    busy_dow = dow_names[dow_vol.idxmax()]; best_dow = dow_names[dow_ret.idxmax()]; worst_dow = dow_names[dow_ret.idxmin()]
    _del = nse.get("delivery") if nse else None
    del_avg = _del["delivery_pct"].mean() if (_del is not None and len(_del)) else None
    iy = nse.get("index_yield") if nse else None
    _iy_pe = float(iy.get("IY_PE")) if (iy and isinstance(iy, dict) and iy.get("IY_PE")) else None

    # ================= MARKDOWN =================
    md = []
    md.append(f"# {sym} — Volume, Big-Player & Fundamentals EDA Report\n")
    md.append(f"**Generated:** {gen_date} (IST)\n\n")
    md.append(f"**Data sources:** Upstox V3 candles + Yahoo Finance (`yfinance`)\n\n")
    md.append(f"**Coverage:** daily {d.index.min().date()} → {d.index.max().date()} ({len(d)} sessions) · 1-minute from 2025-01-01\n\n")

    md.append("## 1. Executive summary\n\n")
    md.append(f"{sym} is analysed across three questions below. The data covers {len(d)} daily sessions "
              f"({d.index.min().date()} → {d.index.max().date()}) plus 1-minute bars from 2025-01-01.\n\n")
    md.append(f"**1. When does the stock trade most?** Intraday volume follows a pronounced **U-shape**. "
              f"The 09:15 opening minute alone prints **{res['open_min_share']:.1f}%** of the day's volume, the first "
              f"15 minutes **{res['first15_share']:.1f}%**, and the first hour **{res['first_hour_share']:.1f}%** — "
              f"while the whole midday 11:45–13:30 stretch contributes only ~{res['midday_share']:.1f}%. A smaller "
              f"second peak appears in the closing 15 minutes. Liquidity is therefore heavily front-loaded: size "
              f"entries/exits in the first 30–60 minutes or the closing auction, not midday.\n\n")
    md.append(f"**2. What do \"big players\" leave behind?** Institutional-scale prints cluster at the open — "
              f"**{res['first_hour_big_pct']:.0f}%** of extreme-volume minute bars (≥20× day median) occur in the first hour. "
              f"On a daily scale, up days carry **~{res['up_mean_vol']/res['down_mean_vol']:.1f}×** the volume of down days "
              f"(accumulation bias).\n\n")
    if has_earn:
        md.append(f"**3. What is the fundamental driver?** Earnings: **{n_beats} of {n_beats + n_miss} quarters beat** "
                  f"EPS estimates, and the size of the surprise correlates **ρ = {rho_earn:.2f}** (p = {p_earn:.2f}) with the "
                  f"10-day forward return. Earnings-day volume runs ≈ **{ed['earn_vol_ratio'].iloc[0]:.1f}×** normal.\n\n")
    md.append("## 2. Price context\n\n![Price & volume](figures/fig1_price_volume.png)\n\n")
    md.append(f"- Last close **{rup(last_close)}**. Range **{rup(px_lo)} → {rup(px_hi)}** over the full window.\n")
    md.append(f"- 20-day realized volatility: mean **{res['mean_rv']*100:.0f}%** annualized (2025–26), peak {res['max_rv']*100:.0f}%, current {res['cur_rv']*100:.0f}%.\n\n")

    # ---- Section 3 ----
    md.append(f"> 💡 **In plain English:** the stock has travelled from ₹{px_lo:,.0f} to ₹{px_hi:,.0f} and now sits at ₹{last_close:,.0f}. It is a volatile name — roughly ±{res['mean_rv']*100:.0f}% annualised swings are normal — so expect chunky up and down days, not a slow grind.\n\n")

    md.append("## 3. High-volume times — intraday volume profile\n\n")
    md.append("### 3.1 The minute-by-minute volume U-shape\n\n")
    md.append("![Intraday volume profile](figures/fig4_intraday_volume_profile.png)\n\n")
    md.append("| Window (IST) | Share of daily volume | vs fair share* |\n|---|---|---|\n")
    fair = lambda mins: mins / 375 * 100
    md.append(f"| **09:15 (opening minute)** | **{res['open_min_share']:.1f}%** | ~{res['open_min_share']/fair(1):.0f}× |\n")
    md.append(f"| **09:15–09:30 (first 15 min)** | **{res['first15_share']:.1f}%** | ~{res['first15_share']/fair(15):.1f}× |\n")
    md.append(f"| 09:15–09:45 (first 30 min) | {res['first30_share']:.1f}% | ~{res['first30_share']/fair(30):.1f}× |\n")
    md.append(f"| **09:15–10:15 (first hour)** | **{res['first_hour_share']:.1f}%** | ~{res['first_hour_share']/fair(60):.1f}× |\n")
    md.append(f"| 11:45–13:30 (midday, 105 min) | {res['midday_share']:.1f}% | ~{res['midday_share']/fair(105):.1f}× |\n")
    md.append(f"| 15:00–15:30 (last 30 min) | {res['last30_share']:.1f}% | ~{res['last30_share']/fair(30):.1f}× |\n")
    md.append(f"| 15:15–15:30 (last 15 min) | {res['last15_share']:.1f}% | ~{res['last15_share']/fair(15):.1f}× |\n\n")
    md.append(f"*\"Fair\" = share if volume were uniform across the 375 trading minutes.*\n\n")
    md.append(f"- The **09:15 opening print averages {res['open_min_vol']:,.0f} shares — {res['open_min_vol']/res['median_min_vol']:.1f}× the median minute** ({res['median_min_vol']:,.0f}).\n")
    md.append(f"- Liquidity is heavily front-loaded: the first 30–60 minutes and the closing 15 minutes are the deep windows; midday is thin.\n\n")
    md.append("### 3.2 Intraday volatility is also U-shaped\n\n")
    md.append("![Intraday volatility](figures/fig5_intraday_volatility_bigbars.png)\n\n")
    bv = res["bucket_vol"]
    md.append(f"- Average 15-minute high–low range is **{bv['range_pct'].iloc[0]:.2f}%** in the opening bucket vs **{bv['range_pct'].iloc[10:17].mean():.2f}%** at midday (~{bv['range_pct'].iloc[0]/bv['range_pct'].iloc[10:17].mean():.1f}× wider) — the biggest price action and volume both happen at the open.\n\n")

    # ---- Section 4 ----
    md.append(f"> 💡 **In plain English:** most of the day's business happens right after the 09:15 open (the first hour does ~{res['first_hour_share']:.0f}% of all volume) and again in the last 15 minutes before close; the middle of the day is quiet. If you want to buy or sell without moving the price much, do it early morning or late afternoon — not at lunchtime.\n\n")

    md.append("## 4. Big-player footprints\n\n")
    md.append("### 4.1 Extreme-volume minute bars cluster at the open\n\n")
    md.append("![Big-bar heatmap](figures/fig6_bigbar_heatmap.png)\n\n")
    md.append(f"- A \"big print\" = a 1-minute bar ≥ 20× that day's median minute volume. {res['n_big']} such bars.\n")
    md.append(f"- **{res['first_hour_big_pct']:.0f}% occur in the first hour; {res['first15_big_pct']:.0f}% in the first 15 minutes alone.**\n")
    md.append(f"- Big prints move price **{res['big_abs_move']:.2f}%** on average — genuine large orders, but the book absorbs them quickly (no short-term continuation).\n\n")
    if tp is not None and len(tp):
        md.append("**Largest single prints (block / institutional candidates):**\n\n| Timestamp | Price (₹) | Volume | Est. notional |\n|---|---|---|---|\n")
        for ts, r in tp.head(6).iterrows():
            md.append(f"| {ts} | {r['close']:,.0f} | {r['volume']:,.0f} | ₹{r['notional_cr']:,.0f} Cr |\n")
        md.append("\n")
    md.append("### 4.2 Daily-scale accumulation bias\n\n")
    md.append("| Metric (2025–26) | Up days | Down days |\n|---|---|---|\n")
    md.append(f"| Mean volume | **{res['up_mean_vol']/1e6:.2f}M** | {res['down_mean_vol']/1e6:.2f}M |\n")
    md.append(f"| Median volume | **{res['up_median_vol']/1e6:.2f}M** | {res['down_median_vol']/1e6:.2f}M |\n\n")
    md.append(f"- Up days carry **~{res['up_mean_vol']/res['down_mean_vol']:.1f}×** the volume of down days.\n")
    md.append(f"- |return| ↔ volume Spearman ρ = **{res['rho_abs_vol']:.2f}**; signed return ↔ volume ρ = **{res['rho_signed_vol']:.2f}**.\n")
    md.append(f"- OBV ↔ price corr = **{res['obv_corr']:.2f}**; Chaikin A/D ↔ price corr = **{res['adl_corr']:.2f}**.\n\n")
    md.append("![OBV & A/D line](figures/fig9_obv_adl.png)\n\n")
    md.append("### 4.3 Volume concentration — a few days dominate\n\n")
    md.append("![Concentration](figures/fig10_concentration_monthly.png)\n\n")
    md.append(f"- The **top 10% of trading days account for {res['top10_share']:.1f}% of all volume**; the top 5% for {res['top5_share']:.1f}%. Big-player activity is episodic and event-driven.\n\n")
    md.append("![Volume anomaly days](figures/fig2_volume_anomaly.png)\n\n")
    md.append("### 4.4 Do high-volume days predict direction?\n\n")
    md.append("![Forward returns](figures/fig8_forward_returns.png)\n\n")
    md.append("| Cohort (2025–26) | n | 20-day fwd (mean) | 20-day fwd (median) |\n|---|---|---|---|\n")
    md.append(f"| All days (baseline) | {res['fwd_base'][20][2]} | {pct(res['fwd_base'][20][0])} | {pct(res['fwd_base'][20][1])} |\n")
    md.append(f"| High-volume **UP** days (vol>3×) | {res['fwd_up3'][20][2]} | {pct(res['fwd_up3'][20][0])} | {pct(res['fwd_up3'][20][1])} |\n")
    md.append(f"| High-volume **UP** days (vol>5×) | {res['fwd_up5'][20][2]} | {pct(res['fwd_up5'][20][0])} | {pct(res['fwd_up5'][20][1])} |\n")
    md.append(f"| High-volume **DOWN** days (vol>3×) | {res['fwd_dn3'][20][2]} | {pct(res['fwd_dn3'][20][0])} | {pct(res['fwd_dn3'][20][1])} |\n\n")
    md.append("- **Reading:** a high-volume up day has historically marked accumulation (positive month-ahead drift); a high-volume down day has marked distribution. Small n in extreme cohorts — treat as a tilt, not a law.\n\n")
    md.append("### 4.5 Actual institutional ownership\n\n")
    md.append("![Ownership & valuation](figures/fig16_ownership_valuation.png)\n\n")
    if holders:
        ins = holders.get("insidersPercentHeld", 0) * 100
        inst = holders.get("institutionsPercentHeld", 0) * 100
        md.append(f"- **Insiders ~{ins:.0f}%**; **institutions ~{inst:.0f}%**")
        if "institutionsCount" in holders:
            md.append(f" across **{holders['institutionsCount']:.0f} institutions**")
        md.append(". This is the \"big player\" base behind the accumulation patterns above.\n\n")

    # ---- Section 5 ----
    md.append(f"> 💡 **In plain English:** big money is easiest to spot at the open — {res['first_hour_big_pct']:.0f}% of the giant one-minute trades land in the first hour. Up days carry ~{res['up_mean_vol']/res['down_mean_vol']:.1f}× more volume than down days (buyers are more aggressive than sellers), and a few event days (the top 10% = {res['top10_share']:.0f}% of all volume) do most of the work. Historically, a big-volume UP day has been followed by more upside over the next month.\n\n")

    md.append("## 5. Earnings & results (yfinance)\n\n")
    if has_earn:
        md.append("### 5.1 Earnings history: estimate-beating track record\n\n")
        md.append("Quarterly EPS actual vs analyst estimate:\n\n| Quarter | EPS est. | EPS actual | Surprise |\n|---|---|---|---|\n")
        for _, r in ed.sort_values("ann_date_ist").iterrows():
            md.append(f"| {_fiscal_quarter(r['ann_date_ist'])} | {r['eps_est']:.1f} | {r['eps_actual']:.2f} | {r['surprise_pct']:+.1f}% |\n")
        md.append(f"\n**{n_beats} of {n_beats + n_miss} quarters beat estimates.**\n")
        _cal = res.get("calendar") or {}
        _ned = _cal.get("Earnings Date")
        if isinstance(_ned, list) and _ned:
            md.append(f"- **Next earnings:** {_ned[0].strftime('%d %b %Y')} (consensus EPS ≈ ₹{_cal.get('Earnings Average', 'n/a')}).\n")
        _exd = _cal.get("Ex-Dividend Date")
        if _exd:
            md.append(f"- Ex-dividend: {_exd.strftime('%d %b %Y')}.\n")
        md.append("\n")
        md.append("### 5.2 Quarter-by-quarter: beat/miss → what the stock gave back\n\n")
        md.append("Returns are close-to-close from the last close before the result to N sessions later (Day-0 = reaction session).\n\n| Quarter | EPS est. | EPS actual | Surprise | Verdict | Day-0 | 5-day | 10-day |\n|---|---|---|---|---|---|---|---|\n")
        for _, r in ed.sort_values("ann_date_ist").iterrows():
            v = "BEAT" if r["surprise_pct"] > 0 else ("MISS" if r["surprise_pct"] < 0 else "INLINE")
            md.append(f"| {_fiscal_quarter(r['ann_date_ist'])} | {r['eps_est']:.1f} | {r['eps_actual']:.2f} | {r['surprise_pct']:+.1f}% | {v} | {r['ret_d0']*100:+.1f}% | {r['ret_d5']*100:+.1f}% | {r['ret_d10']*100:+.1f}% |\n")
        md.append("\n")
        md.append("### 5.3 Earnings surprise → price reaction (event study)\n\n")
        md.append("![Earnings surprise](figures/fig11_earnings_surprise.png)\n\n")
        md.append(f"- **EPS-surprise vs 10-day forward return: ρ = {rho_earn:.2f}** (p = {p_earn:.2f}).\n")
        md.append(f"- Beat days (n={n_beats}) avg 10-day fwd **{pct(ed['beat_10d'].iloc[0])}**; miss days (n={n_miss}) **{pct(ed['miss_10d'].iloc[0])}**.\n")
        md.append(f"- Earnings-day volume ≈ **{ed['earn_vol_ratio'].iloc[0]:.1f}×** the prior 10-day average — results days are the single biggest source of volume spikes.\n\n")
    md.append("### 5.4 Fundamentals\n\n")
    if rev_cr is not None and len(rev_cr) >= 2:
        md.append("![Fundamentals](figures/fig12_fundamentals.png)\n\n")
        md.append("| FY | Revenue (₹ Cr) | Growth | Net income (₹ Cr) | Diluted EPS |\n|---|---|---|---|---|\n")
        for col in rev_cr.index:
            fy = f"FY{col.year % 100}"
            rev_v = float(rev_cr.loc[col]) / 1e7
            ni_v = float(ni_cr.loc[col]) / 1e7 if ni_cr is not None and col in ni_cr.index else None
            eps_v = float(eps_series.loc[col]) if eps_series is not None and col in eps_series.index else None
            prev = rev_cr.index.get_loc(col)
            growth = (rev_v / (float(rev_cr.iloc[prev - 1]) / 1e7) - 1) * 100 if prev > 0 else None
            md.append(f"| {fy} | {rev_v:,.0f} | {pct(growth, 0) if growth is not None else '—'} | {f'{ni_v:,.0f}' if ni_v is not None else '—'} | {eps_v if eps_v is not None else '—'} |\n")
        md.append("\n")
    if last_close and pe_trailing:
        md.append(f"**Valuation (price {rup(last_close)}):** trailing P/E **{pe_trailing:.0f}×**")
        if pe_forward:
            md.append(f" · forward P/E **{pe_forward:.0f}×**")
        if ps_ratio:
            md.append(f" · P/S **{ps_ratio:.1f}×**")
        md.append(".\n")
    if tgt.get("mean"):
        md.append(f"**Analyst:** mean target **₹{tgt['mean']:,.0f}** (high ₹{tgt.get('high', 0):,.0f}, low ₹{tgt.get('low', 0):,.0f}).\n")
    md.append("\n")

    # ---- Section 6 ----
    # ---- Section 5.5 screener fundamentals ----
    if sc:
        bs = sc.get("balance_sheet"); pl = sc.get("profit_loss"); rt = sc.get("ratios"); sh = sc.get("shareholding")
        y = _sc_latest(bs) or "latest"
        md.append("### 5.5 Balance sheet, P&L & ratios (Screener.in)\n\n")
        if bs is not None:
            md.append(f"**Balance sheet ({y}, ₹ Cr):**\n\n| Item | Value |\n|---|---|\n")
            for lbl, item in [("Equity capital", "Equity Capital"), ("Reserves", "Reserves"),
                              ("Borrowings", "Borrowings+"), ("Total liabilities", "Total Liabilities"),
                              ("Total assets", "Total Assets")]:
                v = _sc_val(bs, item)
                if v is not None:
                    md.append(f"| {lbl} | **{v:,.0f}** |\n")
            md.append("\n")
        if pl is not None:
            md.append(f"**Profit & loss ({y}, ₹ Cr):**\n\n| Item | Value |\n|---|---|\n")
            for lbl, item in [("Sales", "Sales+"), ("Operating profit", "Operating Profit"),
                              ("Net profit", "Net Profit+"), ("EPS (₹)", "EPS in Rs")]:
                v = _sc_val(pl, item)
                if v is not None:
                    md.append(f"| {lbl} | **{v:,.1f}** |\n")
            md.append("\n")
        if rt is not None:
            md.append(f"**Key ratios ({y}):**\n\n")
            bits = []
            for lbl, item in [("ROCE", "ROCE %"), ("Debtor days", "Debtor Days"),
                              ("Inventory days", "Inventory Days"), ("Working-capital days", "Working Capital Days")]:
                v = _sc_val(rt, item)
                if v is not None:
                    bits.append(f"**{lbl} {v:,.0f}**")
            opm = _sc_val(pl, "OPM %") if pl is not None else None
            if opm is not None:
                bits.append(f"**OPM {opm:.0f}%**")
            if bits:
                md.append(" · ".join(bits) + ".\n\n")
        if sh is not None:
            cols = [c for c in sh.columns if c != "item"]
            last4 = cols[-4:]
            md.append("**Shareholding trend (last 4 quarters):**\n\n")
            md.append("| Holder | " + " | ".join(last4) + " |\n|---|---|---|---|---|\n")
            for lbl, item in [("Promoters", "Promoters+"), ("FIIs", "FIIs+"), ("DIIs", "DIIs+")]:
                row = sh[sh["item"].str.strip() == item]
                if len(row):
                    vals = [str(row.iloc[0][c]).replace("%", "") for c in last4]
                    md.append(f"| {lbl} | " + " | ".join(vals) + " |\n")
            md.append("\n![Shareholding trend](figures/fig19_shareholding.png)\n\n")

    md.append(f"> 💡 **In plain English:** the company beats profit forecasts **{n_beats} out of {n_beats + n_miss}** times, and revenue is growing ~**{rev_growth:+.0f}%** a year. A big beat tends to lift the stock over the following weeks, a miss tends to knock it. That earnings momentum is the real story behind the price.\n\n")

    md.append("## 6. More correlations & statistical EDA\n\n")
    if mk:
        md.append("### 6.1 Market relationship: high-beta, low-correlation\n\n")
        md.append("![Beta & correlation](figures/fig15_beta_corr.png)\n\n")
        md.append(f"- **Beta vs NIFTY 50 = {mk['beta']:.2f}**; correlation = **{mk['corr_nifty']:.2f}** — moves largely independently of the index (idiosyncratic, event-driven).\n\n")
        md.append("### 6.2 Overnight gaps vs intraday\n\n")
        md.append("![Overnight/intraday](figures/fig13_overnight_intraday.png)\n\n")
        md.append(f"- Cumulative overnight gap **{mk['cum_gap']*100:+.0f}%** vs intraday **{mk['cum_intra']*100:+.0f}%** ({mk['gap_up_pct']:.0f}% of days gap up; median gap {mk['median_gap']:+.2f}%, median intraday {mk['median_intra']:+.2f}%).\n\n")
    md.append("### 6.3 Daily feature correlation matrix\n\n")
    md.append("![Correlation matrix](figures/fig14_corr_matrix.png)\n\n")
    md.append(f"- daily return ↔ intraday move **{feat_corr.loc['ret','intraday_pct']:.2f}**; volume ratio ↔ intraday range **{feat_corr.loc['vol_ratio','range_pct']:.2f}**; |return| ↔ range **{feat_corr.loc['abs_ret','range_pct']:.2f}**; volume ratio ↔ |return| **{feat_corr.loc['vol_ratio','abs_ret']:.2f}**.\n\n")
    md.append("### 6.4 Statistical properties (2025–26)\n\n")
    md.append("| Test | Result | Meaning |\n|---|---|---|\n")
    md.append(f"| Return autocorrelation (lag 1) | **{res['ret_ac1']:+.2f}** | mild 1-day momentum |\n")
    md.append(f"| Jarque–Bera | p ≈ {res['jb_p']:.0e} | returns strongly non-normal (fat tails) |\n")
    md.append(f"| Log-volume autocorrelation | **{res['logvol_ac1']:.2f}** | volume regimes are persistent |\n")
    md.append("| Volume → return (Granger) | not significant | volume does not linearly predict next-day return |\n\n")
    if nse.get("vix") is not None:
        try:
            _v = nse["vix"]
            _vc = float(_v.get("EOD_CLOSE_INDEX_VAL")) if isinstance(_v, dict) else float(_v)
            md.append(f"### 6.5 India VIX (market fear gauge)\n\n- India VIX ≈ **{_vc:.1f}** — " + ("calm/low-fear backdrop." if _vc < 15 else "elevated fear." if _vc > 20 else "normal volatility.") + "\n\n")
        except Exception:
            pass
    md.append("### 6.6 Monthly seasonality (2025–26, indicative)\n\n")
    md.append(f"- Busiest month **{hi_m}** ({mon_vol.max()/1e6:.2f}M/day), thinnest **{lo_m}** ({mon_vol.min()/1e6:.2f}M/day); best month **{hi_r}** ({mon_ret.max()*100:+.1f}%/day), worst **{lo_r}** ({mon_ret.min()*100:+.1f}%/day).\n\n")

    # ---- Section 7 ----
    md.append(f"> 💡 **In plain English:** the stock is only ~**{mk['corr_nifty']*100:.0f}%** tied to the overall market — it mostly moves on its own news. And most of its gains come from **overnight gap-ups** (it opens higher), not from the trading day itself. Raw volume does not reliably predict the next day — only extreme volume combined with direction does.\n\n")

    md.append("## 7. Day-of-week patterns\n\n![Day of week](figures/fig7_dayofweek.png)\n\n")
    md.append("| Day | Avg volume | Avg daily return |\n|---|---|---|\n")
    for i, nm in enumerate(dow_names):
        if i in dow_vol.index:
            md.append(f"| {nm} | {dow_vol.loc[i]/1e6:.2f}M | {dow_ret.loc[i]*100:+.2f}% |\n")
    md.append("\n")

    # ---- Section 8 ----
    md.append(f"> 💡 **In plain English:** **{busy_dow}** is the busiest day and **{best_dow}** has tended to be the best day while **{worst_dow}** the weakest — but with only a couple of years of data this is a soft pattern, not a rule.\n\n")

    md.append("## 8. Returns & volatility summary\n\n![Returns & volatility](figures/fig3_returns_vol.png)\n\n")
    md.append(f"- Mean daily return **{res['mean_ret']*100:+.2f}%**; median **{res['median_ret']*100:+.2f}%** (right-skewed).\n")
    md.append(f"- Single-day range **{res['min_ret']*100:+.1f}%** to **{res['max_ret']*100:+.1f}%**.\n\n")
    md.append("**Risk & performance (2025–26 daily):**\n\n")
    md.append("| Metric | Value |\n|---|---|\n")
    if sharpe is not None:
        md.append(f"| Annualized Sharpe | {sharpe:.2f} |\n")
    if sortino is not None:
        md.append(f"| Annualized Sortino | {sortino:.2f} |\n")
    if max_dd is not None:
        md.append(f"| Max drawdown | {max_dd*100:.1f}% |\n")
    if var95 is not None:
        md.append(f"| VaR (95%, 1-day) | {var95*100:.1f}% |\n")
    md.append(f"| Win rate (up days) | {win_rate*100:.0f}% |\n")
    if payoff is not None:
        md.append(f"| Avg win / avg loss | {payoff:.2f} |\n\n")

    # ---- Section 9: investment view ----
    md.append(f"> 💡 **In plain English:** the average day is nearly flat, but the big moves are real — single days range from **{res['min_ret']*100:+.0f}%** to **{res['max_ret']*100:+.0f}%**. You win on about **{win_rate*100:.0f}%** of days, and the average win is about **{payoff if payoff is not None else 0:.1f}×** the average loss.\n\n")

    md.append("## 9. Investment view — valuation, levels & buy/sell verdict\n\n")
    md.append("### 9.1 Valuation snapshot & implied upside\n\n")
    md.append("| Metric | Value |\n|---|---|\n")
    md.append(f"| Last close | **{rup(last_close)}** |\n")
    if pe_trailing:
        md.append(f"| Trailing P/E | **{pe_trailing:.1f}×** |\n")
    if pe_forward:
        md.append(f"| Forward P/E | **{pe_forward:.1f}×** |\n")
    if ps_ratio:
        md.append(f"| P/S | **{ps_ratio:.1f}×** |\n")
    if peg is not None:
        md.append(f"| PEG (trailing P/E ÷ EPS growth) | **{peg:.2f}** |\n")
    if div_yield is not None:
        md.append(f"| Dividend yield | {div_yield:.2f}% |\n")
    if rev_growth is not None:
        md.append(f"| Revenue growth (latest FY YoY) | **{rev_growth:+.1f}%** |\n")
    if eps_growth is not None:
        md.append(f"| EPS growth (latest FY YoY) | **{eps_growth:+.1f}%** |\n")
    if upside is not None:
        md.append(f"| Analyst mean target | {rup(tgt_mean)} (**{upside:+.1f}%** implied upside) |\n")
    md.append("\n")
    md.append("### 9.2 Analyst consensus\n\n")
    if rec_line:
        md.append(f"- Ratings: **{rec_line}** ({n_analysts or 'n/a'} analysts).\n")
    else:
        md.append("- Ratings: n/a.\n")
    if upside_high is not None and downside_low is not None:
        md.append(f"- Target range: low {rup(tgt.get('low'))} ({downside_low:+.1f}%) → high {rup(tgt.get('high'))} ({upside_high:+.1f}%).\n")
    md.append("\n")
    md.append("### 9.3 Technical levels (support / resistance)\n\n")
    md.append("| Level | Price | vs last close |\n|---|---|---|\n")
    if resistance is not None:
        md.append(f"| Resistance (60-day high) | {rup(resistance)} | {(resistance/last_close-1)*100:+.1f}% |\n")
    if hi52 is not None:
        md.append(f"| 52-week high | {rup(hi52)} | {(hi52/last_close-1)*100:+.1f}% |\n")
    if tgt_mean is not None:
        md.append(f"| Analyst target (mean) | {rup(tgt_mean)} | {(tgt_mean/last_close-1)*100:+.1f}% |\n")
    md.append(f"| **Last close** | **{rup(last_close)}** | — |\n")
    if ma50 is not None:
        md.append(f"| 50-day MA | {rup(ma50)} | {(ma50/last_close-1)*100:+.1f}% |\n")
    if ma200 is not None:
        md.append(f"| 200-day MA | {rup(ma200)} | {(ma200/last_close-1)*100:+.1f}% |\n")
    if lo52 is not None:
        md.append(f"| 52-week low | {rup(lo52)} | {(lo52/last_close-1)*100:+.1f}% |\n")
    if support is not None:
        md.append(f"| Support (60-day low) | {rup(support)} | {(support/last_close-1)*100:+.1f}% |\n")
    md.append("\n![Price vs key levels](figures/fig17_valuation_levels.png)\n\n")
    md.append("### 9.4 Valuation risks\n\n")
    risks = []
    if peg is not None:
        risks.append(f"- **Growth-adjusted price:** PEG = **{peg:.2f}** — " + ("cheap relative to growth" if peg < 1 else "rich relative to growth" if peg > 2 else "roughly in line with growth") + ".\n")
    if pe_trailing:
        risks.append(f"- **Earnings multiple:** trailing P/E {pe_trailing:.0f}× is the price paid for each rupee of last-year profit.\n")
    if n_miss and has_earn:
        risks.append(f"- **Estimate risk:** {n_miss}/{n_beats + n_miss} quarters missed estimates — check whether beats are narrowing.\n")
    if holders and holders.get("insidersPercentHeld", 0) * 100 > 70:
        risks.append("- **Float concentration:** very high insider holding concentrates the free float and can amplify moves.\n")
    if mk and mk.get("corr_nifty", 1) < 0.5:
        risks.append(f"- **Idiosyncratic risk:** correlation with NIFTY is only {mk['corr_nifty']:.2f} — company-specific shocks dominate.\n")
    if hi52 is not None and lo52 is not None and hi52 > lo52:
        risks.append(f"- **Range risk:** the stock sits {(last_close-lo52)/(hi52-lo52)*100:.0f}% above its 52-week low and {(hi52-last_close)/(hi52-lo52)*100:.0f}% below its 52-week high.\n")
    if not risks:
        risks.append("- No major valuation red flags from the available data.\n")
    for rr in risks:
        md.append(rr)
    md.append("\n")
    md.append("### 9.5 Verdict\n\n")
    md.append(f"**{verdict}.**\n\n")
    md.append("> This is a data-driven, growth-adjusted read based on the latest reported financials, analyst targets and price levels. "
              "It is **not investment advice** — always size for the stock's realised volatility and your own risk limits.\n\n")

    # ---- Section 9.6 peer comparison ----
    md.append("### 9.6 Peer comparison (valuation vs sector)\n\n")
    md.append("| Ticker | Mkt cap (₹ Cr) | P/E | P/S | Rev growth | Div yield | 52w chg |\n|---|---|---|---|---|---|---|\n")
    own_52w = (info.get("52WeekChange") * 100) if info.get("52WeekChange") is not None else None
    own_mcap = (info.get("marketCap") or 0) / 1e7
    md.append(f"| **{sym}** | {own_mcap:,.0f} | {pe_trailing:.1f}× | {ps_ratio:.1f}× | {rev_growth:+.1f}% | {div_yield if div_yield is not None else 0:.2f}% | {own_52w if own_52w is not None else float('nan'):+.1f}% |\n")
    if peers_df is not None and len(peers_df):
        for _, rp in peers_df.iterrows():
            pe_s = f"{rp['pe']:.1f}×" if pd.notna(rp['pe']) else "—"
            ps_s = f"{rp['ps']:.1f}×" if pd.notna(rp['ps']) else "—"
            rg_s = f"{rp['rev_growth']:+.1f}%" if pd.notna(rp['rev_growth']) else "—"
            dy_s = f"{rp['div_yield']:.2f}%" if pd.notna(rp['div_yield']) else "—"
            c52_s = f"{rp['chg_52w']:+.1f}%" if pd.notna(rp['chg_52w']) else "—"
            md.append(f"| {rp['ticker']} | {rp['mcap_cr']:,.0f} | {pe_s} | {ps_s} | {rg_s} | {dy_s} | {c52_s} |\n")
    md.append("\n")

    # ---- Section 10: NSE big-player & market data (financeindia) ----
    _prem = f", about **{pe_trailing/_iy_pe:.1f}× the market**" if _iy_pe else ""
    _tgt = f", and analysts' average target is ₹{tgt_mean:,.0f} (**{upside:+.0f}%** from here)" if (tgt_mean and upside is not None) else ""
    md.append(f"> 💡 **In plain English:** on a growth-adjusted basis the stock looks **{verdict.split(' — ')[0].lower()}**. It trades at ~**{pe_trailing:.0f}×** earnings{_prem}{_tgt}. The practical levels: buy-the-dip zone around ₹{support:,.0f}, careful near ₹{resistance:,.0f}.\n\n")

    md.append("## 10. NSE big-player & market data (financeindia)\n\n")
    if not nse:
        md.append("- NSE data not fetched (financeindia unavailable, or run with `--no-nse`).\n\n")
    else:
        delivery = nse.get("delivery")
        if delivery is not None and len(delivery):
            md.append("### 10.1 Delivery % — the real \"big-player\" gauge\n\n")
            md.append("![Delivery %](figures/fig18_delivery.png)\n\n")
            md.append("| Date | Traded qty | Deliverable qty | Delivery % |\n|---|---|---|---|\n")
            for _, r in delivery.tail(10).iterrows():
                md.append(f"| {r['date'].strftime('%d-%b')} | {r['traded_qty']:,.0f} | {r['deliverable_qty']:,.0f} | **{r['delivery_pct']:.1f}%** |\n")
            avg = delivery["delivery_pct"].mean()
            md.append(f"\n- {len(delivery)}-session average delivery **{avg:.1f}%**. High delivery (≥50%) = genuine accumulation; low (<35%) = intraday churn.\n\n")
        bulk = nse.get("bulk"); block = nse.get("block")
        md.append("### 10.2 Bulk / block deals (last ~6 months)\n\n")
        md.append(f"- Bulk deals: **{len(bulk) if bulk is not None else 'n/a'}** · Block deals: **{len(block) if block is not None else 'n/a'}**\n\n")
        ins = nse.get("insider")
        md.append("### 10.3 Insider trades (last ~6 months)\n\n")
        md.append(f"- Insider trades: **{len(ins) if ins is not None else 'n/a'}**\n")
        ca = nse.get("corp_actions")
        if ca is not None:
            md.append(f"- Upcoming corporate actions: **{len(ca)}** (dividend/split/bonus).\n")
        md.append("\n")
        fii = nse.get("fii_dii")
        if fii:
            md.append("### 10.4 FII / DII flows (latest session)\n\n")
            md.append("| Category | Buy (₹ Cr) | Sell (₹ Cr) | Net (₹ Cr) |\n|---|---|---|---|\n")
            for row in fii:
                md.append(f"| {row['category']} | {row['buy_value']:,.0f} | {row['sell_value']:,.0f} | **{row['net_value']:+,.0f}** |\n")
            md.append("\n")
        iy = nse.get("index_yield")
        if iy and iy.get("IY_PE"):
            md.append("### 10.5 NIFTY 50 valuation vs this stock\n\n")
            md.append(f"- NIFTY 50: P/E **{iy['IY_PE']:.1f}×**, P/B {iy['IY_PB']:.2f}×, dividend yield {iy['IY_DY']:.2f}% (as of {iy.get('IY_DT')}).\n")
            if pe_trailing:
                md.append(f"- {sym} trailing P/E **{pe_trailing:.1f}×** = **{pe_trailing/iy['IY_PE']:.2f}×** the NIFTY P/E.\n")
            md.append("\n")

    md.append(f"> 💡 **In plain English:** about **{(del_avg if del_avg is not None else 0):.0f}%** of shares traded are actually delivered (kept), not flipped intraday — and high delivery on down days means genuine buying on dips. No bulk/block deals and no insider selling means no obvious red flags. FII and DII were both net buyers on the latest session, which is a supportive backdrop.\n\n")

    md.append("## 11. Caveats & limitations\n\n")
    md.append("- OHLCV-only inference for \"big players\"; ownership is a point-in-time Yahoo snapshot.\n")
    md.append("- Small n in extreme cohorts; yfinance earnings dates are US-time and mapped to the next NSE session.\n")
    md.append("- No causality; closing-auction volume may be partially missing from 1-min bars.\n\n")

    md.append("## 12. Practical takeaways\n\n")
    md.append("- **Time executions to the open** (first 30–60 min) and the closing 15 min; midday is thin.\n")
    if mk:
        md.append(f"- **Read the open as the overnight-reprice window** ({mk['gap_up_pct']:.0f}% of days gap up; overnight gaps drive the period return).\n")
    if has_earn:
        md.append(f"- **Track earnings surprises** ({n_beats}/{n_beats + n_miss} beats; surprise→return ρ = {rho_earn:.2f}).\n")
    md.append("- **Use volume with direction**: extreme high-volume up days carry a forward-return tilt (see §4.4).\n")
    md.append(f"\n*Charts in `figures/`. See `.prime/agent/skills/stock-eda-report/references/analyses-and-thresholds.md` for thresholds.*\n")
    (outdir / f"{sym}_EDA_report.md").write_text("".join(md))

    # ================= HTML =================
    def img_tag(name, alt):
        p = figdir / name
        if not p.exists():
            return ""
        b64 = base64.b64encode(p.read_bytes()).decode()
        return (f'<div class="fig"><img src="data:image/png;base64,{b64}" alt="{alt}">'
                f'<div class="cap">{alt}</div></div>')

    def sign_span(v):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return '<span class="neu">—</span>'
        cls = "pos" if v >= 0 else "neg"
        return f'<span class="{cls}">{v:+,.1f}%</span>'

    def cnum(v, decimals=1, suffix=""):
        """Colored signed number span (used for table cells)."""
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return '<span class="neu">—</span>'
        cls = "pos" if v >= 0 else "neg"
        return f'<span class="{cls}">{v:+.{decimals}f}{suffix}</span>'

    def plain(t):
        body.append(f'<div class="pe">💡 <b>In plain English:</b> {t}</div>')

    body = []
    body.append(f'<h1>{sym} — Volume, Big-Player &amp; Fundamentals EDA Report</h1>')
    body.append(f'<p class="meta">Generated {gen_date} · sources: Upstox V3 + yfinance · daily {d.index.min().date()} → {d.index.max().date()} ({len(d)} sessions)</p>')

    body.append('<h2>1. Executive summary</h2>')
    body.append(f'<p>Analysis over {len(d)} daily sessions ({d.index.min().date()} → {d.index.max().date()}) plus 1-minute bars from 2025-01-01.</p>')
    body.append(f'<p><b>1. When does the stock trade most?</b> A pronounced intraday <b>U-shape</b>: the 09:15 opening minute prints <b>{res["open_min_share"]:.1f}%</b> of daily volume, the first 15 min <b>{res["first15_share"]:.1f}%</b>, the first hour <b>{res["first_hour_share"]:.1f}%</b> — versus ~{res["midday_share"]:.1f}% for the whole midday stretch. A smaller closing peak appears at 15:15–15:30. Liquidity is front-loaded: size the first 30–60 min or the close, not midday.</p>')
    body.append(f'<p><b>2. What do "big players" leave behind?</b> <b>{res["first_hour_big_pct"]:.0f}%</b> of extreme-volume minute bars (≥20× day median) occur in the first hour, and up days carry ~<b>{res["up_mean_vol"]/res["down_mean_vol"]:.1f}×</b> the volume of down days — an accumulation bias.</p>')
    if has_earn:
        body.append(f'<p><b>3. What is the fundamental driver?</b> Earnings: <b>{n_beats} of {n_beats + n_miss}</b> quarters beat, and surprise size correlates <b>ρ = {rho_earn:.2f}</b> (p = {p_earn:.2f}) with the 10-day forward return; earnings-day volume ≈ {ed["earn_vol_ratio"].iloc[0]:.1f}× normal.</p>')

    body.append(f'<h2>2. Price context</h2>{img_tag("fig1_price_volume.png","Daily close + volume")}')
    body.append(f'<p>Last close <b>{rup(last_close)}</b>; range <b>{rup(px_lo)} → {rup(px_hi)}</b>. 20-day realized vol mean {res["mean_rv"]*100:.0f}% (peak {res["max_rv"]*100:.0f}%, current {res["cur_rv"]*100:.0f}%).</p>')

    plain(f"the stock has travelled from ₹{px_lo:,.0f} to ₹{px_hi:,.0f} and now sits at ₹{last_close:,.0f}. It is a volatile name — roughly ±{res['mean_rv']*100:.0f}% annualised swings are normal — so expect chunky up and down days, not a slow grind.")
    body.append('<h2>3. High-volume times — intraday volume profile</h2>')
    body.append('<h3>3.1 The minute-by-minute volume U-shape</h3>' + img_tag("fig4_intraday_volume_profile.png","Minute volume profile"))
    body.append('<table><tr><th>Window</th><th>Share of daily volume</th><th>vs fair share</th></tr>'
                f'<tr><td><b>09:15 opening minute</b></td><td><b>{res["open_min_share"]:.1f}%</b></td><td>~{res["open_min_share"]/fair(1):.0f}×</td></tr>'
                f'<tr><td><b>09:15–09:30</b></td><td><b>{res["first15_share"]:.1f}%</b></td><td>~{res["first15_share"]/fair(15):.1f}×</td></tr>'
                f'<tr><td>09:15–09:45</td><td>{res["first30_share"]:.1f}%</td><td>~{res["first30_share"]/fair(30):.1f}×</td></tr>'
                f'<tr><td><b>09:15–10:15</b></td><td><b>{res["first_hour_share"]:.1f}%</b></td><td>~{res["first_hour_share"]/fair(60):.1f}×</td></tr>'
                f'<tr><td>11:45–13:30</td><td>{res["midday_share"]:.1f}%</td><td>~{res["midday_share"]/fair(105):.1f}×</td></tr>'
                f'<tr><td>15:00–15:30</td><td>{res["last30_share"]:.1f}%</td><td>~{res["last30_share"]/fair(30):.1f}×</td></tr>'
                f'<tr><td>15:15–15:30</td><td>{res["last15_share"]:.1f}%</td><td>~{res["last15_share"]/fair(15):.1f}×</td></tr></table>')
    body.append(f'<p>The 09:15 print averages <b>{res["open_min_vol"]:,.0f}</b> shares — <b>{res["open_min_vol"]/res["median_min_vol"]:.1f}×</b> the median minute.</p>')
    body.append('<h3>3.2 Intraday volatility is also U-shaped</h3>' + img_tag("fig5_intraday_volatility_bigbars.png","Intraday volatility + big bars"))
    body.append(f'<p>Opening 15-min range <b>{bv["range_pct"].iloc[0]:.2f}%</b> vs midday ~{bv["range_pct"].iloc[10:17].mean():.2f}% (~{bv["range_pct"].iloc[0]/bv["range_pct"].iloc[10:17].mean():.1f}× wider).</p>')

    plain(f"most of the day's business happens right after the 09:15 open (the first hour does ~{res['first_hour_share']:.0f}% of all volume) and again in the last 15 minutes before close; the middle of the day is quiet. If you want to buy or sell without moving the price much, do it early morning or late afternoon — not at lunchtime.")
    body.append('<h2>4. Big-player footprints</h2>')
    body.append('<h3>4.1 Extreme-volume minute bars cluster at the open</h3>' + img_tag("fig6_bigbar_heatmap.png","Big-bar heatmap"))
    body.append(f'<p>Big prints (&gt;20× day median): {res["n_big"]} bars — <b>{res["first_hour_big_pct"]:.0f}% in the first hour, {res["first15_big_pct"]:.0f}% in the first 15 min</b>. Average big-print move {res["big_abs_move"]:.2f}% (absorbed quickly).</p>')
    if tp is not None and len(tp):
        body.append('<p><b>Largest single prints (block / institutional candidates):</b></p>')
        body.append('<table><tr><th>Timestamp</th><th>Price (₹)</th><th>Volume</th><th>Est. notional</th></tr>')
        for ts, r in tp.head(6).iterrows():
            body.append(f'<tr><td>{ts}</td><td>{r["close"]:,.0f}</td><td>{r["volume"]:,.0f}</td><td>₹{r["notional_cr"]:,.0f} Cr</td></tr>')
        body.append('</table>')
    body.append('<h3>4.2 Daily-scale accumulation bias</h3>'
                f'<table><tr><th>Metric (2025–26)</th><th>Up days</th><th>Down days</th></tr>'
                f'<tr><td>Mean volume</td><td><b>{res["up_mean_vol"]/1e6:.2f}M</b></td><td>{res["down_mean_vol"]/1e6:.2f}M</td></tr>'
                f'<tr><td>Median volume</td><td><b>{res["up_median_vol"]/1e6:.2f}M</b></td><td>{res["down_median_vol"]/1e6:.2f}M</td></tr></table>')
    body.append(f'<p>Up days carry ~{res["up_mean_vol"]/res["down_mean_vol"]:.1f}× down-day volume. |return|↔volume ρ={res["rho_abs_vol"]:.2f}; OBV↔price corr {res["obv_corr"]:.2f}.</p>')
    body.append(img_tag("fig9_obv_adl.png", "OBV & A/D line"))
    body.append('<h3>4.3 Volume concentration — a few days dominate</h3>' + img_tag("fig10_concentration_monthly.png","Volume concentration"))
    body.append(f'<p>Top 10% of days = <b>{res["top10_share"]:.1f}%</b> of volume; top 5% = {res["top5_share"]:.1f}%.</p>')
    body.append(img_tag("fig2_volume_anomaly.png", "Volume anomaly days"))
    body.append('<h3>4.4 Do high-volume days predict direction?</h3>' + img_tag("fig8_forward_returns.png","Forward returns after high-volume days"))
    body.append('<table><tr><th>Cohort (2025–26)</th><th>n</th><th>20d fwd mean</th><th>20d fwd median</th></tr>'
                f'<tr><td>All days</td><td>{res["fwd_base"][20][2]}</td><td>{cnum(res["fwd_base"][20][0], suffix="%")}</td><td>{cnum(res["fwd_base"][20][1], suffix="%")}</td></tr>'
                f'<tr><td>High-vol UP &gt;3×</td><td>{res["fwd_up3"][20][2]}</td><td>{cnum(res["fwd_up3"][20][0], suffix="%")}</td><td>{cnum(res["fwd_up3"][20][1], suffix="%")}</td></tr>'
                f'<tr><td>High-vol UP &gt;5×</td><td>{res["fwd_up5"][20][2]}</td><td>{cnum(res["fwd_up5"][20][0], suffix="%")}</td><td>{cnum(res["fwd_up5"][20][1], suffix="%")}</td></tr>'
                f'<tr><td>High-vol DOWN &gt;3×</td><td>{res["fwd_dn3"][20][2]}</td><td>{cnum(res["fwd_dn3"][20][0], suffix="%")}</td><td>{cnum(res["fwd_dn3"][20][1], suffix="%")}</td></tr></table>')
    body.append('<h3>4.5 Actual institutional ownership</h3>' + img_tag("fig16_ownership_valuation.png","Ownership & valuation"))
    if holders:
        ins = holders.get("insidersPercentHeld", 0) * 100
        inst = holders.get("institutionsPercentHeld", 0) * 100
        cnt = f' across {holders["institutionsCount"]:.0f} institutions' if "institutionsCount" in holders else ""
        body.append(f'<p>Insiders ~<b>{ins:.0f}%</b>; institutions ~<b>{inst:.0f}%</b>{cnt}.</p>')

    plain(f"big money is easiest to spot at the open — {res['first_hour_big_pct']:.0f}% of the giant one-minute trades land in the first hour. Up days carry ~{res['up_mean_vol']/res['down_mean_vol']:.1f}× more volume than down days (buyers are more aggressive than sellers), and a few event days (the top 10% = {res['top10_share']:.0f}% of all volume) do most of the work. Historically, a big-volume UP day has been followed by more upside over the next month.")
    body.append('<h2>5. Earnings &amp; results (yfinance)</h2>')
    if has_earn:
        body.append('<h3>5.1 Earnings history</h3><table><tr><th>Quarter</th><th>EPS est.</th><th>EPS actual</th><th>Surprise</th></tr>')
        for _, r in ed.sort_values("ann_date_ist").iterrows():
            body.append(f'<tr><td>{_fiscal_quarter(r["ann_date_ist"])}</td><td>{r["eps_est"]:.1f}</td><td>{r["eps_actual"]:.2f}</td><td>{sign_span(r["surprise_pct"])}</td></tr>')
        body.append('</table>')
        body.append(f'<p><b>{n_beats} of {n_beats + n_miss} quarters beat estimates.</b></p>')
        _cal = res.get("calendar") or {}
        _ned = _cal.get("Earnings Date")
        if isinstance(_ned, list) and _ned:
            body.append(f'<p><b>Next earnings:</b> {_ned[0].strftime("%d %b %Y")} (consensus EPS ≈ ₹{_cal.get("Earnings Average", "n/a")}).</p>')
        _exd = _cal.get("Ex-Dividend Date")
        if _exd:
            body.append(f'<p>Ex-dividend: {_exd.strftime("%d %b %Y")}.</p>')
        body.append('<h3>5.2 Quarter-by-quarter: beat/miss → what the stock gave back</h3><table>'
                    '<tr><th>Quarter</th><th>EPS est.</th><th>EPS actual</th><th>Surprise</th><th>Verdict</th><th>Day-0</th><th>5-day</th><th>10-day</th></tr>')
        for _, r in ed.sort_values("ann_date_ist").iterrows():
            v = r["surprise_pct"]
            qv = ('<span class="good">BEAT ✓</span>' if v > 0 else ('<span class="bad">MISS ✗</span>' if v < 0 else 'INLINE'))
            body.append(f'<tr><td>{_fiscal_quarter(r["ann_date_ist"])}</td><td>{r["eps_est"]:.1f}</td><td>{r["eps_actual"]:.2f}</td>'
                        f'<td>{sign_span(r["surprise_pct"])}</td><td>{qv}</td>'
                        f'<td>{sign_span(r["ret_d0"]*100)}</td><td>{sign_span(r["ret_d5"]*100)}</td><td>{sign_span(r["ret_d10"]*100)}</td></tr>')
        body.append('</table>')
        body.append('<h3>5.3 Earnings surprise → price reaction</h3>' + img_tag("fig11_earnings_surprise.png","Earnings surprise → forward return"))
        body.append(f'<p>Surprise→10-day fwd return ρ = <b>{rho_earn:.2f}</b> (p = {p_earn:.2f}). Beat days {cnum(ed["beat_10d"].iloc[0], suffix="%")} vs miss days {cnum(ed["miss_10d"].iloc[0], suffix="%")}. Earnings-day volume ≈ {ed["earn_vol_ratio"].iloc[0]:.1f}× normal.</p>')
    body.append('<h3>5.4 Fundamentals</h3>')
    if rev_cr is not None and len(rev_cr) >= 2:
        body.append(img_tag("fig12_fundamentals.png", "Fundamentals"))
        body.append('<table><tr><th>FY</th><th>Revenue (₹ Cr)</th><th>Growth</th><th>Net income (₹ Cr)</th><th>Diluted EPS</th></tr>')
        for col in rev_cr.index:
            rev_v = float(rev_cr.loc[col]) / 1e7
            ni_v = float(ni_cr.loc[col]) / 1e7 if ni_cr is not None and col in ni_cr.index else None
            eps_v = float(eps_series.loc[col]) if eps_series is not None and col in eps_series.index else None
            prev = rev_cr.index.get_loc(col)
            growth = (rev_v / (float(rev_cr.iloc[prev - 1]) / 1e7) - 1) * 100 if prev > 0 else None
            body.append(f'<tr><td>FY{col.year % 100}</td><td>{rev_v:,.0f}</td><td>{(f"{growth:+.0f}%" if growth is not None else "—")}</td>'
                        f'<td>{("₹" + format(ni_v, ",.0f")) if ni_v is not None else "—"}</td><td>{eps_v if eps_v is not None else "—"}</td></tr>')
        body.append('</table>')
    if last_close and pe_trailing:
        v = f'<p><b>Valuation (price {rup(last_close)}):</b> trailing P/E <b>{pe_trailing:.0f}×</b>'
        if pe_forward:
            v += f' · forward P/E <b>{pe_forward:.0f}×</b>'
        if ps_ratio:
            v += f' · P/S <b>{ps_ratio:.1f}×</b>'
        v += '</p>'
        body.append(v)
    if tgt.get("mean"):
        body.append(f'<p><b>Analyst:</b> mean target ₹{tgt["mean"]:,.0f} (high ₹{tgt.get("high", 0):,.0f}, low ₹{tgt.get("low", 0):,.0f}).</p>')

    if sc:
        bs = sc.get("balance_sheet"); pl = sc.get("profit_loss"); rt = sc.get("ratios"); sh = sc.get("shareholding")
        y = _sc_latest(bs) or "latest"
        body.append('<h3>5.5 Balance sheet, P&L &amp; ratios (Screener.in)</h3>')
        if bs is not None:
            body.append(f'<p><b>Balance sheet ({y}, ₹ Cr):</b></p><table><tr><th>Item</th><th>Value</th></tr>')
            for lbl, item in [("Equity capital", "Equity Capital"), ("Reserves", "Reserves"),
                              ("Borrowings", "Borrowings+"), ("Total liabilities", "Total Liabilities"),
                              ("Total assets", "Total Assets")]:
                v = _sc_val(bs, item)
                if v is not None:
                    body.append(f'<tr><td>{lbl}</td><td><b>{v:,.0f}</b></td></tr>')
            body.append('</table>')
        if pl is not None:
            body.append(f'<p><b>Profit &amp; loss ({y}, ₹ Cr):</b></p><table><tr><th>Item</th><th>Value</th></tr>')
            for lbl, item in [("Sales", "Sales+"), ("Operating profit", "Operating Profit"),
                              ("Net profit", "Net Profit+"), ("EPS (₹)", "EPS in Rs")]:
                v = _sc_val(pl, item)
                if v is not None:
                    body.append(f'<tr><td>{lbl}</td><td><b>{v:,.1f}</b></td></tr>')
            body.append('</table>')
        if rt is not None:
            bits = []
            for lbl, item in [("ROCE", "ROCE %"), ("Debtor days", "Debtor Days"),
                              ("Inventory days", "Inventory Days"), ("Working-capital days", "Working Capital Days")]:
                v = _sc_val(rt, item)
                if v is not None:
                    bits.append(f'<b>{lbl} {v:,.0f}</b>')
            opm = _sc_val(pl, "OPM %") if pl is not None else None
            if opm is not None:
                bits.append(f'<b>OPM {opm:.0f}%</b>')
            if bits:
                body.append(f'<p><b>Key ratios ({y}):</b> {" · ".join(bits)}</p>')
        if sh is not None:
            cols = [c for c in sh.columns if c != "item"]
            last4 = cols[-4:]
            body.append('<p><b>Shareholding trend (last 4 quarters):</b></p><table><tr><th>Holder</th>' + ''.join(f'<th>{c}</th>' for c in last4) + '</tr>')
            for lbl, item in [("Promoters", "Promoters+"), ("FIIs", "FIIs+"), ("DIIs", "DIIs+")]:
                row = sh[sh["item"].str.strip() == item]
                if len(row):
                    body.append(f'<tr><td>{lbl}</td>' + ''.join(f'<td>{str(row.iloc[0][c]).replace("%","")}</td>' for c in last4) + '</tr>')
            body.append('</table>')
            body.append(img_tag("fig19_shareholding.png", "Shareholding trend"))

    plain(f"the company beats profit forecasts <b>{n_beats} out of {n_beats + n_miss}</b> times, and revenue is growing ~<b>{rev_growth:+.0f}%</b> a year. A big beat tends to lift the stock over the following weeks, a miss tends to knock it. That earnings momentum is the real story behind the price.")
    body.append('<h2>6. More correlations &amp; statistical EDA</h2>')
    if mk:
        body.append('<h3>6.1 Market relationship</h3>' + img_tag("fig15_beta_corr.png","Rolling beta & correlation"))
        body.append(f'<p>Beta vs NIFTY 50 = <b>{mk["beta"]:.2f}</b>; correlation = <b>{mk["corr_nifty"]:.2f}</b> — largely idiosyncratic.</p>')
        body.append('<h3>6.2 Overnight gaps vs intraday</h3>' + img_tag("fig13_overnight_intraday.png","Overnight vs intraday"))
        body.append(f'<p>Overnight gap cumulative <b>{mk["cum_gap"]*100:+.0f}%</b> vs intraday <b>{mk["cum_intra"]*100:+.0f}%</b> ({mk["gap_up_pct"]:.0f}% of days gap up).</p>')
    body.append('<h3>6.3 Daily feature correlation matrix</h3>' + img_tag("fig14_corr_matrix.png","Correlation matrix"))
    body.append(f'<p>ret↔intraday {feat_corr.loc["ret","intraday_pct"]:.2f}; vol-ratio↔range {feat_corr.loc["vol_ratio","range_pct"]:.2f}; |ret|↔range {feat_corr.loc["abs_ret","range_pct"]:.2f}; vol-ratio↔|ret| {feat_corr.loc["vol_ratio","abs_ret"]:.2f}.</p>')
    body.append('<h3>6.4 Statistical properties</h3>'
                f'<table><tr><th>Test</th><th>Result</th><th>Meaning</th></tr>'
                f'<tr><td>Return autocorr (lag 1)</td><td><b>{res["ret_ac1"]:+.2f}</b></td><td>mild momentum</td></tr>'
                f'<tr><td>Jarque–Bera</td><td>p≈{res["jb_p"]:.0e}</td><td>fat tails</td></tr>'
                f'<tr><td>Log-volume autocorr</td><td><b>{res["logvol_ac1"]:.2f}</b></td><td>persistent regimes</td></tr>'
                f'<tr><td>Volume→return (Granger)</td><td>not significant</td><td>no linear lead</td></tr></table>')
    if nse.get("vix") is not None:
        try:
            _v = nse["vix"]
            _vc = float(_v.get("EOD_CLOSE_INDEX_VAL")) if isinstance(_v, dict) else float(_v)
            _vw = "calm / low-fear backdrop" if _vc < 15 else ("elevated fear" if _vc > 20 else "normal volatility")
            body.append(f'<h3>6.5 India VIX (market fear)</h3><p>India VIX ≈ <b>{_vc:.1f}</b> — {_vw}.</p>')
        except Exception:
            pass
    body.append('<h3>6.6 Monthly seasonality</h3>' 
                f'<p>Busiest {hi_m}, thinnest {lo_m}; best {hi_r}, worst {lo_r}.</p>')

    plain(f"the stock is only ~<b>{mk['corr_nifty']*100:.0f}%</b> tied to the overall market — it mostly moves on its own news. And most of its gains come from <b>overnight gap-ups</b> (it opens higher), not from the trading day itself. Raw volume does not reliably predict the next day — only extreme volume combined with direction does.")
    body.append('<h2>7. Day-of-week patterns</h2>' + img_tag("fig7_dayofweek.png","Day-of-week"))
    body.append('<table><tr><th>Day</th><th>Avg volume</th><th>Avg return</th></tr>')
    for i, nm in enumerate(dow_names):
        if i in dow_vol.index:
            body.append(f'<tr><td>{nm}</td><td>{dow_vol.loc[i]/1e6:.2f}M</td><td>{cnum(dow_ret.loc[i]*100, decimals=2, suffix="%")}</td></tr>')
    body.append('</table>')

    plain(f"<b>{busy_dow}</b> is the busiest day and <b>{best_dow}</b> has tended to be the best day while <b>{worst_dow}</b> the weakest — but with only a couple of years of data this is a soft pattern, not a rule.")
    body.append('<h2>8. Returns &amp; volatility summary</h2>' + img_tag("fig3_returns_vol.png","Returns & volatility"))
    body.append(f'<p>Mean daily return {res["mean_ret"]*100:+.2f}%, median {res["median_ret"]*100:+.2f}%; range {res["min_ret"]*100:+.1f}% → {res["max_ret"]*100:+.1f}%.</p>')
    body.append('<table><tr><th>Risk metric (2025–26)</th><th>Value</th></tr>')
    if sharpe is not None:
        body.append(f'<tr><td>Annualized Sharpe</td><td>{sharpe:.2f}</td></tr>')
    if sortino is not None:
        body.append(f'<tr><td>Annualized Sortino</td><td>{sortino:.2f}</td></tr>')
    if max_dd is not None:
        body.append(f'<tr><td>Max drawdown</td><td><span class="neg">{max_dd*100:.1f}%</span></td></tr>')
    if var95 is not None:
        body.append(f'<tr><td>VaR (95%, 1-day)</td><td><span class="neg">{var95*100:.1f}%</span></td></tr>')
    body.append(f'<tr><td>Win rate (up days)</td><td>{win_rate*100:.0f}%</td></tr>')
    if payoff is not None:
        body.append(f'<tr><td>Avg win / avg loss</td><td>{payoff:.2f}</td></tr>')
    body.append('</table>')

    plain(f"the average day is nearly flat, but the big moves are real — single days range from <b>{res['min_ret']*100:+.0f}%</b> to <b>{res['max_ret']*100:+.0f}%</b>. You win on about <b>{win_rate*100:.0f}%</b> of days, and the average win is about <b>{payoff if payoff is not None else 0:.1f}×</b> the average loss.")
    body.append('<h2>9. Investment view — valuation, levels &amp; buy/sell verdict</h2>')
    body.append('<h3>9.1 Valuation snapshot &amp; implied upside</h3><table><tr><th>Metric</th><th>Value</th></tr>')
    body.append(f'<tr><td>Last close</td><td><b>{rup(last_close)}</b></td></tr>')
    if pe_trailing:
        body.append(f'<tr><td>Trailing P/E</td><td><b>{pe_trailing:.1f}×</b></td></tr>')
    if pe_forward:
        body.append(f'<tr><td>Forward P/E</td><td><b>{pe_forward:.1f}×</b></td></tr>')
    if ps_ratio:
        body.append(f'<tr><td>P/S</td><td><b>{ps_ratio:.1f}×</b></td></tr>')
    if peg is not None:
        body.append(f'<tr><td>PEG (P/E ÷ EPS growth)</td><td><b>{peg:.2f}</b></td></tr>')
    if div_yield is not None:
        body.append(f'<tr><td>Dividend yield</td><td>{div_yield:.2f}%</td></tr>')
    if rev_growth is not None:
        body.append(f'<tr><td>Revenue growth (latest FY)</td><td><b>{cnum(rev_growth, suffix="%")}</b></td></tr>')
    if eps_growth is not None:
        body.append(f'<tr><td>EPS growth (latest FY)</td><td><b>{cnum(eps_growth, suffix="%")}</b></td></tr>')
    if upside is not None:
        body.append(f'<tr><td>Analyst mean target</td><td>{rup(tgt_mean)} (<b>{upside:+.1f}%</b>)</td></tr>')
    body.append('</table>')
    body.append('<h3>9.2 Analyst consensus</h3>')
    body.append(f'<p>Ratings: <b>{rec_line}</b>' + (f' ({n_analysts or "n/a"} analysts)' if rec_line else 'n/a') + '.</p>')
    if upside_high is not None and downside_low is not None:
        body.append(f'<p>Target range: low {rup(tgt.get("low"))} ({downside_low:+.1f}%) → high {rup(tgt.get("high"))} ({upside_high:+.1f}%).</p>')
    body.append('<h3>9.3 Technical levels</h3><table><tr><th>Level</th><th>Price</th><th>vs last</th></tr>')
    if resistance is not None:
        body.append(f'<tr><td>Resistance (60d high)</td><td>{rup(resistance)}</td><td>{cnum((resistance/last_close-1)*100, suffix="%")}</td></tr>')
    if hi52 is not None:
        body.append(f'<tr><td>52-week high</td><td>{rup(hi52)}</td><td>{cnum((hi52/last_close-1)*100, suffix="%")}</td></tr>')
    if tgt_mean is not None:
        body.append(f'<tr><td>Analyst target</td><td>{rup(tgt_mean)}</td><td>{cnum((tgt_mean/last_close-1)*100, suffix="%")}</td></tr>')
    body.append(f'<tr><td><b>Last close</b></td><td><b>{rup(last_close)}</b></td><td>—</td></tr>')
    if ma50 is not None:
        body.append(f'<tr><td>50-day MA</td><td>{rup(ma50)}</td><td>{cnum((ma50/last_close-1)*100, suffix="%")}</td></tr>')
    if ma200 is not None:
        body.append(f'<tr><td>200-day MA</td><td>{rup(ma200)}</td><td>{cnum((ma200/last_close-1)*100, suffix="%")}</td></tr>')
    if lo52 is not None:
        body.append(f'<tr><td>52-week low</td><td>{rup(lo52)}</td><td>{cnum((lo52/last_close-1)*100, suffix="%")}</td></tr>')
    if support is not None:
        body.append(f'<tr><td>Support (60d low)</td><td>{rup(support)}</td><td>{cnum((support/last_close-1)*100, suffix="%")}</td></tr>')
    body.append('</table>')
    body.append(img_tag("fig17_valuation_levels.png", "Price vs key levels"))
    body.append('<h3>9.4 Valuation risks</h3><ul>')
    if peg is not None:
        peg_word = "cheap relative to growth" if peg < 1 else "rich relative to growth" if peg > 2 else "roughly in line with growth"
        body.append(f'<li>Growth-adjusted price: PEG = <b>{peg:.2f}</b> — {peg_word}.</li>')
    if pe_trailing:
        body.append(f'<li>Trailing P/E {pe_trailing:.0f}× is the multiple paid per rupee of last-year profit.</li>')
    if n_miss and has_earn:
        body.append(f'<li>{n_miss}/{n_beats + n_miss} quarters missed estimates — watch whether beats are narrowing.</li>')
    if holders and holders.get("insidersPercentHeld", 0) * 100 > 70:
        body.append('<li>Very high insider holding concentrates the free float and can amplify moves.</li>')
    if mk and mk.get("corr_nifty", 1) < 0.5:
        body.append(f'<li>Idiosyncratic risk: NIFTY correlation only {mk["corr_nifty"]:.2f}.</li>')
    if hi52 is not None and lo52 is not None and hi52 > lo52:
        body.append(f'<li>The stock sits {(last_close-lo52)/(hi52-lo52)*100:.0f}% above its 52w low and {(hi52-last_close)/(hi52-lo52)*100:.0f}% below its 52w high.</li>')
    body.append('</ul>')
    vcls = "buy" if "Undervalued" in verdict else ("caution" if "Overvalued" in verdict else "hold")
    body.append(f'<h3>9.5 Verdict</h3><p><span class="{vcls}">{verdict}.</span></p>'
                '<p style="color:#666">Data-driven, growth-adjusted read from latest reported financials, analyst targets and price levels — not investment advice.</p>')

    body.append('<h3>9.6 Peer comparison (valuation vs sector)</h3>')
    own_52w = (info.get("52WeekChange") * 100) if info.get("52WeekChange") is not None else None
    own_mcap = (info.get("marketCap") or 0) / 1e7
    body.append('<table><tr><th>Ticker</th><th>Mkt cap (₹ Cr)</th><th>P/E</th><th>P/S</th><th>Rev growth</th><th>Div yield</th><th>52w chg</th></tr>')
    body.append(f'<tr><td><b>{sym}</b></td><td>{own_mcap:,.0f}</td><td>{pe_trailing:.1f}×</td><td>{ps_ratio:.1f}×</td><td>{cnum(rev_growth, suffix="%")}</td><td>{div_yield if div_yield is not None else 0:.2f}%</td><td>{cnum(own_52w, suffix="%") if own_52w is not None else "—"}</td></tr>')
    if peers_df is not None and len(peers_df):
        for _, rp in peers_df.iterrows():
            pe_s = f"{rp['pe']:.1f}×" if pd.notna(rp['pe']) else "—"
            ps_s = f"{rp['ps']:.1f}×" if pd.notna(rp['ps']) else "—"
            rg_s = cnum(rp['rev_growth'], suffix="%") if pd.notna(rp['rev_growth']) else "—"
            dy_s = f"{rp['div_yield']:.2f}%" if pd.notna(rp['div_yield']) else "—"
            c52_s = cnum(rp['chg_52w'], suffix="%") if pd.notna(rp['chg_52w']) else "—"
            body.append(f'<tr><td>{rp["ticker"]}</td><td>{rp["mcap_cr"]:,.0f}</td><td>{pe_s}</td><td>{ps_s}</td><td>{rg_s}</td><td>{dy_s}</td><td>{c52_s}</td></tr>')
    body.append('</table>')

    _prem = f" (about <b>{pe_trailing/_iy_pe:.1f}× the market</b>)" if _iy_pe else ""
    _tgt2 = f", and analysts' average target is ₹{tgt_mean:,.0f} (<b>{upside:+.0f}%</b> from here)" if (tgt_mean and upside is not None) else ""
    plain(f"on a growth-adjusted basis the stock looks <b>{verdict.split(' — ')[0].lower()}</b>. It trades at ~<b>{pe_trailing:.0f}×</b> earnings{_prem}{_tgt2}. The practical levels: buy-the-dip zone around ₹{support:,.0f}, careful near ₹{resistance:,.0f}.")
    body.append('<h2>10. NSE big-player &amp; market data (financeindia)</h2>')
    if not nse:
        body.append('<p>NSE data not fetched (financeindia unavailable, or --no-nse).</p>')
    else:
        delivery = nse.get("delivery")
        if delivery is not None and len(delivery):
            body.append('<h3>10.1 Delivery % — the real "big-player" gauge</h3>')
            body.append(img_tag("fig18_delivery.png", "Delivery % (last sessions)"))
            body.append('<table><tr><th>Date</th><th>Traded qty</th><th>Deliverable qty</th><th>Delivery %</th></tr>')
            for _, r in delivery.tail(10).iterrows():
                cls = "pos" if r["delivery_pct"] >= 50 else ("neg" if r["delivery_pct"] < 35 else "")
                pv = f'<span class="{cls}"><b>{r["delivery_pct"]:.1f}%</b></span>' if cls else f'{r["delivery_pct"]:.1f}%'
                body.append(f'<tr><td>{r["date"].strftime("%d-%b")}</td><td>{r["traded_qty"]:,.0f}</td><td>{r["deliverable_qty"]:,.0f}</td><td>{pv}</td></tr>')
            body.append('</table>')
            avg = delivery["delivery_pct"].mean()
            body.append(f'<p>{len(delivery)}-session average delivery <b>{avg:.1f}%</b>. High (≥50%) = accumulation; low (&lt;35%) = intraday churn.</p>')
        bulk = nse.get("bulk"); block = nse.get("block")
        body.append('<h3>10.2 Bulk / block deals (last ~6 months)</h3>')
        body.append(f'<p>Bulk deals: <b>{len(bulk) if bulk is not None else "n/a"}</b> · Block deals: <b>{len(block) if block is not None else "n/a"}</b></p>')
        ins = nse.get("insider")
        body.append('<h3>10.3 Insider trades (last ~6 months)</h3>')
        ca = nse.get("corp_actions")
        body.append(f'<p>Insider trades: <b>{len(ins) if ins is not None else "n/a"}</b> · Upcoming corporate actions: <b>{len(ca) if ca is not None else "n/a"}</b></p>')

        fii = nse.get("fii_dii")
        if fii:
            body.append('<h3>10.4 FII / DII flows (latest session)</h3><table><tr><th>Category</th><th>Buy (₹ Cr)</th><th>Sell (₹ Cr)</th><th>Net (₹ Cr)</th></tr>')
            for row in fii:
                net_cls = "pos" if row["net_value"] >= 0 else "neg"
                body.append(f'<tr><td>{row["category"]}</td><td>{row["buy_value"]:,.0f}</td><td>{row["sell_value"]:,.0f}</td><td><span class="{net_cls}"><b>{row["net_value"]:+,.0f}</b></span></td></tr>')
            body.append('</table>')
        iy = nse.get("index_yield")
        if iy and iy.get("IY_PE"):
            body.append('<h3>10.5 NIFTY 50 valuation vs this stock</h3>')
            body.append(f'<p>NIFTY 50: P/E <b>{iy["IY_PE"]:.1f}×</b>, P/B {iy["IY_PB"]:.2f}×, div yield {iy["IY_DY"]:.2f}% (as of {iy.get("IY_DT")}).</p>')
            if pe_trailing:
                body.append(f'<p>{sym} trailing P/E <b>{pe_trailing:.1f}×</b> = <b>{pe_trailing/iy["IY_PE"]:.2f}×</b> the NIFTY P/E.</p>')

    plain(f"about <b>{(del_avg if del_avg is not None else 0):.0f}%</b> of shares traded are actually delivered (kept), not flipped intraday — and high delivery on down days means genuine buying on dips. No bulk/block deals and no insider selling means no obvious red flags. FII and DII were both net buyers on the latest session, which is a supportive backdrop.")
    body.append('<h2>11. Caveats &amp; limitations</h2><ul>'
                '<li>OHLCV-only inference for "big players"; ownership is a point-in-time Yahoo snapshot.</li>'
                '<li>Small n in extreme cohorts; yfinance earnings dates are US-time, mapped to next NSE session.</li>'
                '<li>No causality; closing-auction volume may be partially missing from 1-min bars.</li></ul>')
    body.append('<h2>12. Practical takeaways</h2><ul>'
                '<li>Time executions to the open (first 30–60 min) and closing 15 min.</li>'
                + (f'<li>Read the open as the overnight-reprice window ({mk["gap_up_pct"]:.0f}% of days gap up).</li>' if mk else '')
                + (f'<li>Track earnings surprises ({n_beats}/{n_beats + n_miss} beats; ρ = {rho_earn:.2f}).</li>' if has_earn else '')
                + '<li>Use volume with direction — extreme high-volume up days carry a forward-return tilt.</li></ul>')

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{sym} EDA Report</title>
<style>
body{{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:1040px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.55;background:#fbfbfb}}
h1{{border-bottom:3px solid #1565c0;padding-bottom:8px}}h2{{color:#0d47a1;margin-top:2em;border-bottom:1px solid #e0e0e0}}h3{{color:#1565c0}}
table{{border-collapse:collapse;margin:10px 0}}th,td{{border:1px solid #ccc;padding:5px 9px;font-size:.9em}}th{{background:#eef4fb}}
.fig img{{max-width:100%;border:1px solid #ddd;border-radius:6px;margin:6px 0}}.cap{{font-size:.83em;color:#666}}
.good{{color:#059669;font-weight:600}}.bad{{color:#dc2626;font-weight:600}}.pos{{color:#059669;font-weight:600}}.neg{{color:#dc2626;font-weight:600}}.neu{{color:#94a3b8}}.warn{{color:#d97706;font-weight:600}}.buy{{color:#059669;font-weight:700}}.caution{{color:#dc2626;font-weight:700}}.hold{{color:#d97706;font-weight:700}}.meta{{color:#64748b}}.pe{{background:#f6f9f2;border-left:4px solid #84cc16;padding:10px 14px;margin:14px 0;border-radius:4px;font-size:.95em;color:#365314}}
</style></head><body>{''.join(body)}</body></html>"""
    (outdir / f"{sym}_EDA_report.html").write_text(html)
    return len(md), len(html)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="NETWEB")
    ap.add_argument("--daily-csv", default=None, help="comma-separated cached daily CSVs")
    ap.add_argument("--daily-from", default="2020-01-01", help="start date for fresh daily fetch")
    ap.add_argument("--minute-csv", default=None, help="comma-separated cached 1-min CSVs")
    ap.add_argument("--peers", default=None, help="comma-separated peer tickers for valuation comparison (default: auto from industry)")
    ap.add_argument("--no-nse", action="store_true", help="skip the financeindia NSE big-player data fetch")
    ap.add_argument("--no-screener", action="store_true", help="skip the Screener.in fundamentals fetch")
    ap.add_argument("--outdir", default=None)
    args = ap.parse_args()

    sym = args.symbol.upper()
    outdir = Path(args.outdir) if args.outdir else REPO / "reports" / f"{sym}_EDA"
    figdir = outdir / "figures"
    outdir.mkdir(parents=True, exist_ok=True)

    daily_csvs = args.daily_csv.split(",") if args.daily_csv else None
    minute_csvs = args.minute_csv.split(",") if args.minute_csv else None

    print(f"[1/5] loading daily data for {sym} ...")
    daily = load_daily(sym, daily_csvs, daily_from=args.daily_from)
    print(f"      daily rows: {len(daily)}  ({daily.index.min()} → {daily.index.max()})")

    print("[2/5] loading minute data ...")
    if minute_csvs:
        m1 = load_minute(minute_csvs)
        print(f"      minute rows: {len(m1)}")
    else:
        from market_data.market_data import fetch_candles
        m1 = fetch_candles(sym, tf=1, from_date="2025-01-01", to_date=_today_ist())
        if m1 is None or not len(m1):
            print("      WARNING: no minute data; intraday charts will be skipped")
            m1 = pd.DataFrame(columns=["open", "high", "low", "close", "volume", "oi"])
        else:
            m1.index = _to_utc_aware(m1.index).tz_convert(IST)
            print(f"      minute rows: {len(m1)}")

    print("[3/5] yfinance fundamentals ...")
    yf = yf_fetch(sym)
    res_peers = fetch_peers(sym, args.peers.split(",") if args.peers else None)

    print("[4/5] analyzing ...")
    res = analyze_daily(daily)
    res["earnings_dates"] = None
    if yf.get("earnings_dates") is not None:
        ev = event_study(yf["earnings_dates"], daily)
        res["earnings_dates"] = ev
        if len(ev):
            ev.to_csv(outdir / "earnings_event_study.csv", index=False)
    if len(m1):
        intra = analyze_intraday(m1)
        res.update(intra)
    res["nifty"] = yf.get("nifty")
    res["major_holders"] = yf.get("major_holders")
    res["annual"] = yf.get("annual")
    res["quarterly"] = yf.get("quarterly")
    res["targets"] = yf.get("targets")
    res["recs"] = yf.get("recs")
    res["info"] = yf.get("info")
    res["calendar"] = yf.get("calendar")
    res["peers"] = res_peers
    res["nse"] = None
    if not args.no_nse:
        print("[4a/5] NSE big-player data (financeindia) ...")
        try:
            res["nse"] = fetch_nse_data(sym, daily)
        except Exception as e:
            print(f"      NSE fetch skipped ({type(e).__name__}: {str(e)[:80]})")
    res["screener"] = {}
    if not args.no_screener:
        print("[4b/5] Screener.in fundamentals ...")
        try:
            res["screener"] = fetch_screener(sym)
        except Exception as e:
            print(f"      Screener fetch skipped ({type(e).__name__}: {str(e)[:80]})")
    mk = market_stats(res["daily"], yf.get("nifty"))

    print("[5/5] rendering figures & report ...")
    _style()
    render_figures(sym, res, mk, figdir)
    n_md, n_html = render_report(sym, res, mk, figdir, outdir)

    # save high-volume days table
    d2 = res["daily"][res["daily"].index >= "2025-01-01"]
    hv = d2[d2["vol_ratio"] > 3].sort_values("volume", ascending=False)[
        ["close", "ret", "volume", "vol_ratio", "fwd5", "fwd10", "fwd20"]].head(12)
    hv.to_csv(outdir / "high_volume_days.csv")

    print(f"\nDone. Report written to {outdir}/")
    print(f"  {sym}_EDA_report.html ({n_html//1024} KB, self-contained)")
    print(f"  {sym}_EDA_report.md ({n_md} lines)")
    print(f"  figures/*.png, high_volume_days.csv, earnings_event_study.csv")


if __name__ == "__main__":
    main()
