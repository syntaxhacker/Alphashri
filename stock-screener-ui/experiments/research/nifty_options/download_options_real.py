"""Download the real NIFTY option dataset used by the actual-premium study.

FYERS only serves currently-listed contracts, so the real-data window is
~2026-06-01 .. today. We grab a dense strike ladder for the four listed
monthlies (longest history) plus the two front weeklies.

Output: one parquet per contract in the shared cache, plus a manifest.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402

TODAY = date(2026, 9, 26)
STRIKES = list(range(22000, 25601, 50))
# (expiry, weekly?)
EXPIRIES = [
    (date(2026, 9, 29), False),
    (date(2026, 10, 6), True),
    (date(2026, 10, 13), True),
    (date(2026, 10, 27), False),
    (date(2026, 11, 23), False),
    (date(2026, 12, 29), False),
]


def main():
    min_interval = float(sys.argv[1]) if len(sys.argv) > 1 else 0.7
    client = fd.FyersData(min_interval=min_interval)
    manifest = {"generated": datetime.now().isoformat(), "today": TODAY.isoformat(),
                "contracts": []}
    total = len(EXPIRIES) * len(STRIKES) * 2
    done = 0
    t0 = time.time()
    for exp, weekly in EXPIRIES:
        frm = (exp - timedelta(days=140)).isoformat()
        for k in STRIKES:
            for opt in ("CE", "PE"):
                sym = fd.nifty_symbol(exp, k, opt, weekly=weekly)
                df = fd.fetch_candles_cached(client, sym, "1", frm, TODAY.isoformat(),
                                             oi=True)
                done += 1
                if len(df):
                    manifest["contracts"].append({
                        "symbol": sym, "expiry": exp.isoformat(), "weekly": weekly,
                        "strike": k, "opt": opt, "rows": len(df),
                        "first": str(df["ts"].min()), "last": str(df["ts"].max()),
                        "volume_sum": float(df["volume"].sum()),
                    })
                if done % 50 == 0:
                    el = time.time() - t0
                    print(f"[{datetime.now():%H:%M:%S}] {done}/{total} "
                          f"rows_ok={len(manifest['contracts'])} calls={client.calls} "
                          f"elapsed={el:.0f}s", flush=True)
    out = fd.CACHE_DIR / "option_manifest.json"
    out.write_text(json.dumps(manifest, indent=2))
    print(f"DONE {done} contracts, {len(manifest['contracts'])} with data, "
          f"calls={client.calls}, elapsed={time.time()-t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
