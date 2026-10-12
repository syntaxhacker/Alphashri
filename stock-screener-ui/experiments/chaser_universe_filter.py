"""Build liquid universe for 52W Chaser sweep: Nifty500 -> avg vol10d >= 500k.

TV first (fetch_tv_volume_metrics), Upstox daily candles for TV-missing symbols.
Output: experiments/chaser_universe_list.json
"""
import json
import time
from datetime import datetime, timedelta

OUT = "experiments/chaser_universe_list.json"

def main():
    from chart_patterns.universes import get_universe
    from chart_patterns.tv_prefilter import fetch_tv_volume_metrics

    uni = get_universe("nifty500")
    print(f"nifty500 size: {len(uni)}", flush=True)

    m = fetch_tv_volume_metrics(uni)
    print(f"TV metrics returned: {len(m)}", flush=True)

    liquid, tv_kept, tv_dropped = [], 0, 0
    missing = []
    for s in uni:
        su = s.upper()
        if su in m and "avg_volume_10d" in m[su]:
            try:
                v = float(m[su]["avg_volume_10d"])
            except (TypeError, ValueError):
                v = 0
            if v >= 500_000:
                liquid.append(su)
                tv_kept += 1
            else:
                tv_dropped += 1
        else:
            missing.append(su)
    print(f"TV: kept={tv_kept} dropped_below_500k={tv_dropped} missing={len(missing)}", flush=True)

    # Resolve TV-missing via Upstox daily candles (last 20 sessions -> mean of last 10 vols)
    up_kept, up_dropped, up_nodata = [], [], []
    if missing:
        from backtest.utils import get_upstox_client_from_db
        api, err = get_upstox_client_from_db()
        if err or not api:
            print(f"UPSTOX CLIENT FAILED: {err}; marking {len(missing)} as unresolved", flush=True)
            up_nodata = list(missing)
        else:
            today = datetime.now().strftime("%Y-%m-%d")
            frm = (datetime.now() - timedelta(days=40)).strftime("%Y-%m-%d")
            for i, s in enumerate(missing):
                try:
                    df = api.fetch_historical_data_v3(
                        symbol=s, unit="days", interval=1, to_date=today, from_date=frm
                    )
                except Exception as e:
                    print(f"  {s}: fetch error {e}", flush=True)
                    up_nodata.append(s)
                    continue
                try:
                    vols = df["volume"].astype(float).tail(10) if df is not None and not df.empty else None
                    avg = float(vols.mean()) if vols is not None and len(vols) else 0.0
                except Exception:
                    avg = 0.0
                if avg >= 500_000:
                    liquid.append(s)
                    up_kept.append(s)
                elif avg > 0:
                    up_dropped.append(s)
                else:
                    up_nodata.append(s)
                if (i + 1) % 25 == 0:
                    print(f"  upstox {i+1}/{len(missing)} ...", flush=True)
                time.sleep(0.2)
    print(f"Upstox fallback: kept={len(up_kept)} dropped={len(up_dropped)} nodata={len(up_nodata)}", flush=True)
    if up_nodata:
        print("NODATA: " + ",".join(up_nodata), flush=True)

    liquid = sorted(set(liquid))
    payload = {
        "created_at": datetime.now().isoformat(),
        "source_universe": "nifty500",
        "source_size": len(uni),
        "threshold": "avg_volume_10d >= 500000",
        "tv_metrics_returned": len(m),
        "tv_kept": tv_kept,
        "tv_dropped_below_threshold": tv_dropped,
        "tv_missing": len(missing),
        "upstox_kept": up_kept,
        "upstox_dropped": up_dropped,
        "upstox_nodata": up_nodata,
        "liquid_symbols": liquid,
        "liquid_count": len(liquid),
    }
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=1)
    print(f"WROTE {OUT}: {len(liquid)} liquid symbols", flush=True)

if __name__ == "__main__":
    main()
