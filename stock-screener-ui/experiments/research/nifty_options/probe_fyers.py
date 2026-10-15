"""Probe FYERS data availability for NIFTY options research.

Answers, empirically and with throttling (each call bounded to a small window):
  1. Does the weekly symbol convention hold for past expiries?
  2. How far back does NIFTY option history actually go?
  3. What rate does the /history feed tolerate?
  4. Do option-chain + futures history work?
"""
import sys, time
from datetime import date, timedelta, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402

c = fd.FyersData(min_interval=0.5, verbose=False)


def probe(sym, expiry, res="D"):
    """Fetch a tight window around a contract's expiry."""
    frm = (expiry - timedelta(days=10)).isoformat()
    to = (expiry + timedelta(days=2)).isoformat()
    rows = c.history(sym, res, frm, to)
    return len(rows), (datetime.utcfromtimestamp(rows[0][0]) if rows else None), \
        (datetime.utcfromtimestamp(rows[-1][0]) if rows else None)


print("== 1. weekly vs monthly symbol format, Sep-Oct 2026 ==")
for d in [date(2026, 9, 22), date(2026, 9, 29), date(2026, 10, 6), date(2026, 8, 25)]:
    for weekly in (True, False):
        sym = fd.nifty_symbol(d, 23000, "CE", weekly=weekly)
        n, a, b = probe(sym, d)
        kind = "weekly" if weekly else "monthly"
        rng = f"{a:%Y-%m-%d}..{b:%Y-%m-%d}" if a else "-"
        print(f"  {d} {kind:7s} {sym:26s} n={n:4d} {rng}")

print("\n== 2. how far back does option history go? (weekly symbols) ==")
for d in [date(2026, 7, 14), date(2026, 4, 14), date(2026, 1, 13), date(2025, 10, 14),
          date(2025, 7, 15), date(2025, 1, 14), date(2024, 10, 15), date(2024, 1, 16),
          date(2023, 1, 17), date(2022, 1, 18)]:
    sym = fd.nifty_weekly_symbol(d, 22000, "CE")
    n, a, b = probe(sym, d)
    rng = f"{a:%Y-%m-%d}..{b:%Y-%m-%d}" if a else "-"
    print(f"  {sym:26s} n={n:4d} {rng}")

print("\n== 3. rate limit: 15 calls, 30-day daily windows ==")
t0 = time.time()
for i in range(15):
    c.history(fd.NIFTY_SPOT, "D", "2026-01-01", "2026-01-30")
print(f"  15 calls in {time.time()-t0:.1f}s | total={c.calls} throttled={c.throttled}")

print("\n== 4. futures + option chain ==")
for sym in ["NSE:NIFTY26SEP26-FUT", "NSE:NIFTY26SEP-FUT", "NSE:NIFTY2610-FUT"]:
    rows = c.history(sym, "D", "2026-09-01", "2026-09-30")
    print(f"  {sym:26s} n={len(rows)}")
ch = c.option_chain(strikecount=2, greeks=True)
print("  chain ok:", bool(ch), "expiries:", [e["date"] for e in (ch or {}).get("expiryData", [])][:4])
print(f"\ntotal FYERS calls: {c.calls}")
