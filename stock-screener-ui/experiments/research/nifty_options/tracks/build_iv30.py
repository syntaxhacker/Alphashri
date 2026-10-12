"""Build the 30-min intraday IV surface from real premiums (one-off, cached)."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pandas as pd
import fyers_data as fd
import mispricing

OUT = fd.CACHE_DIR / "iv_surface_30m.parquet"

if __name__ == "__main__":
    t0 = time.time()
    surf = mispricing.build_surface("30")
    surf.to_parquet(OUT, index=False)
    print(f"rows={len(surf)} dates={surf['date'].nunique()} "
          f"buckets={surf['ts'].dt.strftime('%H:%M').nunique()} "
          f"elapsed={time.time()-t0:.0f}s -> {OUT}")
