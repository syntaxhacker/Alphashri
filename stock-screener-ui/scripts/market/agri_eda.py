#!/usr/bin/env python3
"""
Agri-commodity price EDA — India mandi (APMC) prices.

DATA SOURCE (current-day only, free, no key registration needed for the sample key):
  https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070
  "Current Daily Price of Various Commodities from Various Markets (Mandi)"
  - Fields: state, district, market, commodity, variety, grade, arrival_date,
            min_price, max_price, modal_price
  - Granularity: daily. IMPORTANT: this endpoint serves CURRENT/ latest prices
    (all ~12,556 records are for the latest date). It does NOT expose a
    6-month historical time series.

6-MONTH HISTORY — where to get it (not programmatic here):
  • agmarknet.gov.in reports → "Price & Arrival" weekly/monthly analysis
    (JS-rendered, may need manual Excel download per commodity/state)
  • data.gov.in bulk/Kaggle "Daily Wholesale Commodity Prices – India Mandis"
    (history 2013–May 2025; CSV download; may need Kaggle auth)
  • eNAM (enam.gov.in) auction prices

This script therefore does TWO things:
  1) Pulls TODAY's snapshot for rice/dals/pulses (live API)  → prints a table
  2) Provides `run_eda(csv_path)` — a full EDA over a historical CSV you supply
     (columns: state, district, market, commodity, variety, grade, arrival_date,
      min_price, max_price, modal_price). Produces stats + plots.

Usage:
  .venv/bin/python scripts/market/agri_eda.py            # today's snapshot only
  .venv/bin/python scripts/market/agri_eda.py --eda path/to/mandi_prices.csv   # full EDA
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import statistics
from datetime import datetime, timedelta
from pathlib import Path

import requests

API_KEY = os.getenv("DATA_GOV_IN_API_KEY", "")
RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
API_URL = f"https://api.data.gov.in/resource/{RESOURCE_ID}"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)", "Accept": "application/json"}

# Key Indian agri commodities to track (rice + dals/pulses + staples)
COMMODITIES = [
    "Rice", "Paddy(Common)", "Arhar(Tur)", "Moong", "Urad", "Chana",
    "Masoor", "Wheat", "Soyabean", "Bajra", "Maize", "Onion", "Potato", "Tomato",
]

# fallback names if the exact commodity string returns nothing
ALIASES = {
    "Arhar(Tur)": ["Arhar", "Tur"],
    "Paddy(Common)": ["Paddy"],
}


def _get(params, tries=4):
    for t in range(tries):
        try:
            r = requests.get(API_URL, params=params, headers=HEADERS, timeout=60)
            if r.status_code == 200:
                return r
            if r.status_code in (429, 502, 503, 504):
                time.sleep(2 * (t + 1))
                continue
            return r
        except Exception:
            time.sleep(2 * (t + 1))
    return None


def fetch_today(commodity: str, date_str: str):
    """Return list of records for one commodity on a given date (DD/MM/YYYY)."""
    names = [commodity] + ALIASES.get(commodity, [])
    for name in names:
        r = _get({
            "api-key": API_KEY, "format": "json", "limit": 2000,
            "filters[commodity]": name, "filters[arrival_date]": date_str,
        })
        if r:
            recs = r.json().get("records", [])
            if recs:
                return recs
    return []


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def summarize(records):
    mods = [_to_float(x.get("modal_price")) for x in records]
    mods = [m for m in mods if m is not None]
    mins = [_to_float(x.get("min_price")) for x in records]
    mins = [m for m in mins if m is not None]
    maxs = [_to_float(x.get("max_price")) for x in records]
    maxs = [m for m in maxs if m is not None]
    if not mods:
        return None
    return {
        "n_markets": len(records),
        "min": min(mins) if mins else None,
        "max": max(maxs) if maxs else None,
        "modal_max": max(mods),
        "avg_modal": statistics.mean(mods),
        "median_modal": statistics.median(mods),
        "date": records[0].get("arrival_date") if records else None,
    }


def todays_snapshot():
    today = datetime.now().strftime("%d/%m/%Y")
    print(f"AGRI MANDI SNAPSHOT — {today}  (source: data.gov.in Agmarknet API)\n")
    print(f"{'Commodity':<16}{'Markets':>8}{'Min':>8}{'Max':>8}{'PeakModal':>9}{'AvgModal':>9}{'MedModal':>9}{'Date':>12}")
    print("-" * 80)
    any_data = False
    for c in COMMODITIES:
        recs = fetch_today(c, today)
        if not recs:
            print(f"{c:<16}{0:>8}{'-':>8}{'-':>8}{'-':>9}{'-':>9}{'-':>9}{today:>12}")
            continue
        s = summarize(recs)
        any_data = True
        print(f"{c:<16}{s['n_markets']:>8}{s['min']:>8.0f}{s['max']:>8.0f}"
              f"{s['modal_max']:>9.0f}{s['avg_modal']:>9.0f}{s['median_modal']:>9.0f}{today:>12}")
    print("-" * 80)
    if not any_data:
        print("No live records returned (API may be rate-limited). Try again shortly.")
    return any_data


# ---------------------------------------------------------------------------
# Full EDA over a historical CSV you supply (6-month time series)
# ---------------------------------------------------------------------------
def run_eda(csv_path: str, outdir: str = "reports/agri_eda"):
    import pandas as pd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(csv_path)
    # Normalize expected columns
    colmap = {c.lower().strip(): c for c in df.columns}
    def pick(*names):
        for n in names:
            if n in colmap:
                return colmap[n]
        return None

    date_col = pick("arrival_date")
    com_col = pick("commodity")
    state_col = pick("state")
    market_col = pick("market")
    modal_col = pick("modal_price", "modal x0020 price")
    min_col = pick("min_price", "min x0020 price")
    max_col = pick("max_price", "max x0020 price")

    if not all([date_col, com_col, modal_col]):
        raise ValueError("CSV must contain arrival_date, commodity, and modal_price columns")

    df = df.dropna(subset=[date_col, com_col, modal_col]).copy()
    df[modal_col] = pd.to_numeric(df[modal_col], errors="coerce")
    df = df.dropna(subset=[modal_col])
    # Parse dates (agmarknet uses DD/MM/YYYY)
    df["_date"] = pd.to_datetime(df[date_col], format="%d/%m/%Y", errors="coerce")
    df = df.dropna(subset=["_date"])
    df["_ym"] = df["_date"].dt.to_period("M")
    df["_commodity"] = df[com_col].astype(str).str.strip()

    lines = []
    def w(s=""): lines.append(s)

    w("=" * 72)
    w("AGRI-COMMODITY PRICE EDA — 6-MONTH MANDI TIME SERIES")
    w("=" * 72)
    w(f"Source file : {csv_path}")
    w(f"Records     : {len(df):,}")
    w(f"Date range  : {df['_date'].min().date()} → {df['_date'].max().date()}")
    w(f"Commodities : {df['_commodity'].nunique()}")
    w(f"Markets     : {df[market_col].nunique() if market_col else 'n/a'}")
    w(f"States      : {df[state_col].nunique() if state_col else 'n/a'}")
    w("")

    # 1) Overall modal-price stats per commodity
    w("-" * 72)
    w("1) MODAL PRICE SUMMARY PER COMMODITY (₹/quintal)")
    w("-" * 72)
    g = df.groupby("_commodity")[modal_col]
    summ = g.agg(["count", "min", "max", "mean", "median", "std"]).round(2)
    summ.columns = ["markets", "min", "max", "mean", "median", "std"]
    summ = summ.sort_values("mean", ascending=False)
    w(summ.to_string())
    w("")

    # 2) Monthly trend (mean modal price) per commodity — last 6 months
    w("-" * 72)
    w("2) MONTHLY MEAN MODAL PRICE (₹/q) — pivot (rows=commodity, cols=month)")
    w("-" * 72)
    pivot = (
        df.groupby(["_commodity", "_ym"])[modal_col]
        .mean()
        .unstack(fill_value=0)
        .round(2)
    )
    # keep last 6 month columns
    cols = [c for c in pivot.columns]
    pivot = pivot[cols[-6:]] if len(cols) >= 6 else pivot
    w(pivot.to_string())
    w("")

    # 3) Volatility (std / mean) per commodity
    w("-" * 72)
    w("3) PRICE VOLATILITY (std/mean, %) — higher = more volatile")
    w("-" * 72)
    vol = (summ["std"] / summ["mean"] * 100).round(2).sort_values(ascending=False)
    w(vol.to_string())
    w("")

    # 4) State-wise average modal price (top states)
    if state_col:
        w("-" * 72)
        w("4) STATE-WISE AVG MODAL PRICE (₹/q), top 12 states")
        w("-" * 72)
        st = df.groupby(state_col)[modal_col].mean().round(2).sort_values(ascending=False)
        w(st.head(12).to_string())
        w("")

    # 5) Min/max dispersion: (max-min)/mean per commodity
    w("-" * 72)
    w("5) INTRA-COMMODITY PRICE DISPERSION (max-min)/mean %")
    w("-" * 72)
    disp = ((summ["max"] - summ["min"]) / summ["mean"] * 100).round(2).sort_values(ascending=False)
    w(disp.to_string())
    w("")

    # 6) Recent trend: last month vs previous month mean per commodity
    w("-" * 72)
    w("6) MONTH-OVER-MONTH CHANGE (latest month vs prior month)")
    w("-" * 72)
    months = sorted(df["_ym"].unique())
    if len(months) >= 2:
        cur, prev = months[-1], months[-2]
        mcur = df[df["_ym"] == cur].groupby("_commodity")[modal_col].mean()
        mprev = df[df["_ym"] == prev].groupby("_commodity")[modal_col].mean()
        mom = ((mcur - mprev) / mprev * 100).round(2).sort_values(ascending=False)
        w(f"Latest month: {cur}  |  Prior month: {prev}")
        w(mom.to_string())
    w("")

    report_text = "\n".join(lines)
    report_path = out / "eda_report.txt"
    report_path.write_text(report_text, encoding="utf-8")
    print(report_text)
    print(f"\nSaved text report → {report_path}")

    # Plots
    try:
        # Price trend lines (top 6 commodities by mean price)
        top6 = summ.sort_values("mean", ascending=False).head(6).index.tolist()
        fig, axes = plt.subplots(2, 3, figsize=(15, 8))
        axes = axes.ravel()
        for i, com in enumerate(top6):
            sub = df[df["_commodity"] == com]
            monthly = sub.groupby("_date")[modal_col].mean()
            axes[i].plot(monthly.index, monthly.values, marker="o", lw=1.5)
            axes[i].set_title(com)
            axes[i].set_xlabel("Date")
            axes[i].set_ylabel("Avg Modal ₹/q")
            axes[i].tick_params(axis="x", rotation=30)
            axes[i].grid(alpha=0.3)
        for j in range(len(top6), len(axes)):
            axes[j].axis("off")
        fig.suptitle("Modal Price Trend — Top 6 Commodities", fontsize=13)
        fig.tight_layout(rect=[0, 0.03, 1, 0.95])
        p1 = out / "price_trends.png"
        fig.savefig(p1, dpi=120)
        plt.close(fig)
        print(f"Saved plot → {p1}")

        # Volatility bar chart
        fig2, ax2 = plt.subplots(figsize=(10, 5))
        vol_sorted = vol.sort_values()
        ax2.barh(vol_sorted.index, vol_sorted.values, color="#2563EB")
        ax2.set_xlabel("Volatility (std/mean %)")
        ax2.set_title("Commodity Price Volatility")
        ax2.grid(axis="x", alpha=0.3)
        fig2.tight_layout()
        p2 = out / "volatility.png"
        fig2.savefig(p2, dpi=120)
        plt.close(fig2)
        print(f"Saved plot → {p2}")
    except Exception as e:
        print(f"(plotting skipped: {e})")

    print(f"\nAll EDA outputs in: {out.resolve()}")
    return report_path


def main():
    ap = argparse.ArgumentParser(description="India agri-commodity mandi price EDA")
    ap.add_argument("--eda", metavar="CSV_PATH", help="Run full EDA on a historical mandi-price CSV")
    ap.add_argument("--outdir", default="reports/agri_eda", help="Output dir for EDA artifacts")
    args = ap.parse_args()

    if args.eda:
        run_eda(args.eda, args.outdir)
    else:
        if not API_KEY:
            print("ERROR: DATA_GOV_IN_API_KEY environment variable is not set.", file=sys.stderr)
            print("Export it before running, e.g.:  export DATA_GOV_IN_API_KEY=...", file=sys.stderr)
            sys.exit(1)
        todays_snapshot()


if __name__ == "__main__":
    main()
