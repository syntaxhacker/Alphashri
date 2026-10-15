import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui')
sys.path.insert(0, str(ROOT))
from scripts.smc_tick_eval import fetch_ticks

start = date(2026, 3, 2)
end = date(2026, 4, 30)
d = start
while d <= end:
    if d.weekday() < 5:
        day = d.isoformat()
        try:
            ticks = fetch_ticks(day)
            print(day, len(ticks), flush=True)
        except Exception as exc:
            print(day, 'ERROR', repr(exc), flush=True)
    d += timedelta(days=1)
