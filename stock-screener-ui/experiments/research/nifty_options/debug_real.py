"""Debug the real-premium replay: inspect a handful of trades and marks."""
import sys
from pathlib import Path
from datetime import date

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runner as R
import numpy as np
from engine import EngineConfig, ExpiryResolver, RealOptionSource, replay, build_legdicts
from strategies import orb_breakout, credit_spread_intraday
from costs import ExecutionModel
import json

source = RealOptionSource()
man = json.loads((R.fd.CACHE_DIR / "option_manifest.json").read_text())
by_exp = {date.fromisoformat(c["expiry"]): c["weekly"] for c in man["contracts"]}
resolver = ExpiryResolver(list(by_exp.keys()), by_exp)
spot = R.load_spot("5")
meta = R.load_daily_meta()
cfg = EngineConfig(capital=300_000, risk_pct=0.01, stop_pct=0.35, target_pct=0.60,
                   execution=ExecutionModel(), lot=65)

trades = replay(lambda c, i: orb_breakout(c, i, stop_pct=0.35, target_pct=0.60),
                spot, source, resolver, cfg, date(2026, 7, 1), date(2026, 9, 25),
                require_data=True, day_meta=meta)
print(f"ORB real trades: {len(trades)}")
for t in trades[:12]:
    print(f"  {t.date} {t.legs[0]['symbol']} entry={t.entry_ts:%H:%M} exit={t.exit_ts:%H:%M} "
          f"entry_net={t.entry_net:.1f} exit_net={t.exit_net:.1f} lots={t.lots} "
          f"gross={t.gross_pnl:.0f} fees={t.fees:.0f} net={t.net_pnl:.0f} why={t.exit_reason}")

# Inspect the underlying option file for the first trade
if trades:
    sym = trades[0].legs[0]["symbol"]
    df = source._load(sym)
    print(f"\n{sym}: rows={0 if df is None else len(df)}")
    if df is not None and len(df):
        print("  first:", df.index[0], "last:", df.index[-1])
        print(df.head(3).to_string())
        print("  around entry:", df.loc[str(trades[0].entry_ts.date())].head(5).to_string() if str(trades[0].entry_ts.date()) in df.index.strftime('%Y-%m-%d').values else "n/a")
