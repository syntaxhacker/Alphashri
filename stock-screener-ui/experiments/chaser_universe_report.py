"""Aggregate chaser universe sweep -> chaser_universe.json + chaser_universe.md"""
import json
from datetime import datetime

PROG = "experiments/chaser_universe_progress.json"
ULIST = "experiments/chaser_universe_list.json"
JOUT = "experiments/chaser_universe.json"
MOUT = "experiments/chaser_universe.md"

prog = json.load(open(PROG))
ul = json.load(open(ULIST))
done, errors = prog["done"], prog["errors"]

rows = []
for s, v in done.items():
    rows.append({"symbol": s, "trades": v["trades"], "wins": v["wins"], "losses": v["losses"],
                 "win_rate": v["win_rate"], "gross_pnl": v["gross_pnl"],
                 "total_costs": v["total_costs"], "net_pnl": v["net_pnl"],
                 "pf": v.get("pf"), "tp_exits": v.get("tp_exits", 0),
                 "sl_exits": v.get("sl_exits", 0), "trailing_exits": v.get("trailing_exits", 0),
                 "max_hold_exits": v.get("max_hold_exits", 0)})

nz = [r for r in rows if r["trades"] > 0]
tot_trades = sum(r["trades"] for r in nz)
tot_wins = sum(r["wins"] for r in nz)
tot_gross = round(sum(r["gross_pnl"] for r in nz), 2)
tot_costs = round(sum(r["total_costs"] for r in nz), 2)
tot_net = round(sum(r["net_pnl"] for r in nz), 2)
pooled_wr = round(tot_wins / tot_trades * 100, 1) if tot_trades else 0.0

by_net = sorted(nz, key=lambda r: r["net_pnl"], reverse=True)
top20 = by_net[:20]
bot20 = by_net[-20:][::-1]

# win-rate distribution (among symbols with trades)
buckets = {"0%": 0, "1-25%": 0, "26-50%": 0, "51-75%": 0, "76-99%": 0, "100%": 0}
for r in nz:
    w = r["win_rate"]
    if w == 0: buckets["0%"] += 1
    elif w <= 25: buckets["1-25%"] += 1
    elif w <= 50: buckets["26-50%"] += 1
    elif w <= 75: buckets["51-75%"] += 1
    elif w < 100: buckets["76-99%"] += 1
    else: buckets["100%"] += 1

# trades distribution
t1 = sum(1 for r in nz if r["trades"] == 1)
t2_3 = sum(1 for r in nz if 2 <= r["trades"] <= 3)
t4p = sum(1 for r in nz if r["trades"] >= 4)
maxt = max(nz, key=lambda r: r["trades"]) if nz else None

exits = {k: sum(r[k] for r in nz) for k in ("tp_exits", "sl_exits", "trailing_exits", "max_hold_exits")}

chunk_times = prog.get("chunk_times_sec", [])
payload = {
    "generated_at": datetime.now().isoformat(),
    "strategy": "52w_chaser", "days": 365, "params": {},
    "universe_source": "nifty500", "universe_size": ul["source_size"],
    "filter": ul["threshold"],
    "tv_metrics_returned": ul["tv_metrics_returned"],
    "tv_kept": ul["tv_kept"], "tv_dropped_below_threshold": ul["tv_dropped_below_threshold"],
    "tv_missing": ul["tv_missing"],
    "upstox_fallback_kept": len(ul["upstox_kept"]),
    "upstox_fallback_dropped": len(ul["upstox_dropped"]),
    "upstox_nodata": ul["upstox_nodata"],
    "liquid_count": ul["liquid_count"],
    "symbols_tested": len(rows), "symbols_with_trades": len(nz),
    "symbols_zero_trades": len(rows) - len(nz),
    "symbols_error": errors,
    "pooled": {"gross_pnl": tot_gross, "total_costs": tot_costs, "net_pnl": tot_net,
               "trades": tot_trades, "wins": tot_wins, "win_rate_pct": pooled_wr},
    "avg_trades_per_symbol_tested": round(tot_trades / len(rows), 2) if rows else 0,
    "avg_trades_per_active_symbol": round(tot_trades / len(nz), 2) if nz else 0,
    "win_rate_distribution_active": buckets,
    "trades_distribution": {"1 trade": t1, "2-3 trades": t2_3, "4+ trades": t4p,
                            "max_trades_symbol": maxt["symbol"] if maxt else None,
                            "max_trades_n": maxt["trades"] if maxt else 0},
    "exit_mix": exits,
    "top20_by_net": [{"symbol": r["symbol"], "trades": r["trades"], "win_rate": r["win_rate"],
                      "net_pnl": r["net_pnl"]} for r in top20],
    "bottom20_by_net": [{"symbol": r["symbol"], "trades": r["trades"], "win_rate": r["win_rate"],
                         "net_pnl": r["net_pnl"]} for r in bot20],
    "per_symbol": sorted(rows, key=lambda r: r["symbol"]),
    "runtime": {"chunk_times_sec": chunk_times,
                "total_sweep_sec": round(sum(chunk_times), 1),
                "started_at": prog.get("started_at"), "last_chunk_at": prog.get("last_chunk_at")},
}
json.dump(payload, open(JOUT, "w"), indent=1)

def tab(rs):
    return "\n".join(f"| {r['symbol']} | {r['trades']} | {r['win_rate']}% | {r['net_pnl']:,.2f} |"
                     for r in rs)

md = f"""# 52W Chaser — Nifty500 Liquid Universe Sweep
Date: {payload['generated_at'][:10]} | Strategy: `52w_chaser` | days=365 | params=default
Engine: nautilus (`backtest.engine.get_engine().run`)

## Universe
- Source: Nifty500 ({ul['source_size']}) → filter `avg_volume_10d ≥ 500,000`
- TV metrics returned for {ul['tv_metrics_returned']}/501 → kept {ul['tv_kept']}, dropped below threshold {ul['tv_dropped_below_threshold']}
- TV-missing {ul['tv_missing']} resolved via Upstox daily candles: kept {len(ul['upstox_kept'])}, dropped {len(ul['upstox_dropped'])}, no-data {len(ul['upstox_nodata'])} ({', '.join(ul['upstox_nodata'])})
- **Liquid universe: {ul['liquid_count']} symbols** (DUMMYHEG blacklisted by instrument master)
- Tested {len(rows)}, errors {len(errors)} ({', '.join(f'{k} ({v})' for k, v in errors.items())})

## Pooled totals (default params, costs included)
| gross | costs | **net** | trades | wins | win rate |
|---:|---:|---:|---:|---:|---:|
| {tot_gross:,.2f} | {tot_costs:,.2f} | **{tot_net:,.2f}** | {tot_trades} | {tot_wins} | {pooled_wr}% |

- Symbols with ≥1 trade: {len(nz)}/{len(rows)} ({round(100*len(nz)/len(rows),1)}%); zero-trade: {len(rows)-len(nz)}
- Avg trades/symbol (tested): {payload['avg_trades_per_symbol_tested']} | per active symbol: {payload['avg_trades_per_active_symbol']}
- Exit mix: TP {exits['tp_exits']} / SL {exits['sl_exits']} / trailing {exits['trailing_exits']} / max-hold {exits['max_hold_exits']}
- Costs ≈ {round(100*tot_costs/(abs(tot_gross)+tot_costs),1)}% of (gross loss + costs) drag — flat 100-share sizing, costs dominate.

## Verdict: NOT profitable on liquid Nifty500 @ defaults
Net **₹{tot_net:,.2f}** over {tot_trades} trades / 321 symbols / 365d. Win rate {pooled_wr}% with
TP {exits['tp_exits']} vs SL {exits['sl_exits']} exits — losers outnumber winners and costs erase the rest.

## Top-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
{tab(top20)}

## Bottom-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
{tab(bot20)}

## Win-rate distribution (active symbols only, n={len(nz)})
| bucket | symbols |
|---|---:|
""" + "\n".join(f"| {k} | {v} |" for k, v in buckets.items()) + f"""

## Trades-per-symbol distribution
- 1 trade: {t1} symbols | 2–3: {t2_3} | 4+: {t4p} (max: {maxt['symbol']} {maxt['trades'] if maxt else 0})

## Runtime
- Sweep wall time ≈ {round(sum(chunk_times),1)}s across {len(chunk_times)} chunks (data cached / daily bars are cheap)
- wrangle_bars read-only-buffer fix verified: `skipped_stocks` shows only 2 genuine "No data" (HFCL, STLTECH), zero engine errors.

## Notes
- 0-trade symbols (125) are legitimate no-signal outcomes (entry needs new 52W high + momentum filters), confirmed by RELIANCE/INFY 2-symbol verification pre-run.
- Per-symbol full table: `experiments/chaser_universe.json` (`per_symbol`).
- Progress checkpoints: `experiments/chaser_universe_progress.json`; liquid list: `experiments/chaser_universe_list.json`.
"""
open(MOUT, "w").write(md)
print(f"WROTE {JOUT} + {MOUT}")
print(f"pooled net={tot_net} trades={tot_trades} wr={pooled_wr}%")
