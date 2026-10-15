"""Probe 2: is *deep* historical option data available, or only currently-listed contracts?"""
import sys
from datetime import date, timedelta, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd

c = fd.FyersData(min_interval=0.5, verbose=False)
IST = timezone(timedelta(hours=5, minutes=30))


def raw(sym, frm, to, res="D"):
    resp = c._get("history", c._fyers.history, data={
        "symbol": sym, "resolution": res, "date_format": "1",
        "range_from": frm, "range_to": to, "cont_flag": "1"})
    n = len(resp.get("candles") or []) if isinstance(resp, dict) else 0
    return n, resp.get("code") if isinstance(resp, dict) else "?", (resp.get("message") or "")[:40] if isinstance(resp, dict) else ""


print("== A. old expiry symbols, several format guesses (expiry 2025-06-24, 25000CE) ==")
for sym in ["NSE:NIFTY2562425000CE", "NSE:NIFTY25JUN25000CE", "NSE:NIFTY25JUN24 25000CE",
            "NSE:NIFTY2562425000CE", "NSE:NIFTY25J2425000CE"]:
    print("  ", sym, raw(sym, "2025-06-01", "2025-06-30"))

print("\n== B. 2024/2023 monthly ==")
for sym in ["NSE:NIFTY24SEP25000CE", "NSE:NIFTY24OCT25000CE", "NSE:NIFTY23SEP20000CE"]:
    print("  ", sym, raw(sym, "2010-01-01", "2012-01-01"))

print("\n== C. currently-listed contracts: full available 1-min history ==")
for d, strike in [(date(2026, 9, 29), 23000), (date(2026, 10, 27), 23000), (date(2026, 12, 29), 24000)]:
    sym = fd.nifty_monthly_symbol(d, strike, "CE")
    rows = c.history(sym, "1", "2026-06-01", "2026-09-26")
    if rows:
        a = datetime.fromtimestamp(rows[0][0], IST)
        b = datetime.fromtimestamp(rows[-1][0], IST)
        print(f"  {sym:26s} n={len(rows):6d}  {a:%Y-%m-%d} .. {b:%Y-%m-%d}")
    else:
        print(f"  {sym:26s} n=0")

print("\n== D. futures symbol ==")
r = c.quotes(["NSE:NIFTY50-INDEX"])
for sym in ["NSE:NIFTY26SEP-FUT", "NSE:NIFTY26SEPFUT", "NSE:NIFTY26O-FUT", "NSE:NIFTY26SEP25-FUT"]:
    print("  ", sym, raw(sym, "2026-09-01", "2026-09-30"))
print("\n== E. daily IV/greeks? chain for 3 expiries ==")
for exp in ["1790676600", "1793095800"]:
    ch = c.option_chain(strikecount=1, expiry=exp, greeks=True)
    if ch:
        legs = [r for r in ch.get("optionsChain", []) if r.get("option_type")]
        print("  expiry", exp, "legs", len(legs), "sample iv",
              (legs[0].get("greeks") or {}).get("iv") if legs else None)
print("\ntotal calls:", c.calls)
