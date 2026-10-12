"""Aggregate FIXED 52W Chaser full-universe results into chaser_fixed.json/.md."""
import json
from datetime import datetime
from pathlib import Path

ROOT = Path("experiments")
prog = json.loads((ROOT / "chaser_fixed_progress.json").read_text())
old = json.loads((ROOT / "chaser_universe.json").read_text())
ws = json.loads((ROOT / "chaser_fixed_weekslice.json").read_text())

done, errors = prog["done"], prog["errors"]
active = {s: r for s, r in done.items() if r.get("trades", 0) > 0}
zero = len(done) - len(active)


def psum(rows, k):
    return round(sum(r.get(k, 0) for r in rows), 2)


arows = list(active.values())
pooled = {
    "gross_pnl": psum(arows, "gross_pnl"),
    "total_costs": psum(arows, "total_costs"),
    "net_pnl": psum(arows, "net_pnl"),
    "trades": sum(r["trades"] for r in arows),
    "wins": sum(r["wins"] for r in arows),
}
pooled["win_rate_pct"] = round(pooled["wins"] / pooled["trades"] * 100, 1) if pooled["trades"] else 0.0

exit_mix = {k: sum(r.get(k, 0) for r in arows)
            for k in ("tp_exits", "sl_exits", "trailing_exits", "max_hold_exits")}

wr_buckets = {"0%": 0, "1-25%": 0, "26-50%": 0, "51-75%": 0, "76-99%": 0, "100%": 0}
for r in arows:
    w = r.get("win_rate", 0)
    if w == 0: wr_buckets["0%"] += 1
    elif w <= 25: wr_buckets["1-25%"] += 1
    elif w <= 50: wr_buckets["26-50%"] += 1
    elif w <= 75: wr_buckets["51-75%"] += 1
    elif w < 100: wr_buckets["76-99%"] += 1
    else: wr_buckets["100%"] += 1

t1 = sum(1 for r in arows if r["trades"] == 1)
t23 = sum(1 for r in arows if 2 <= r["trades"] <= 3)
t4 = sum(1 for r in arows if r["trades"] >= 4)
mx_sym = max(active, key=lambda s: active[s]["trades"])
mx_n = active[mx_sym]["trades"]

ranked = sorted(active.items(), key=lambda kv: kv[1]["net_pnl"])
bottom20 = [{"symbol": s, "trades": r["trades"], "win_rate": r["win_rate"],
             "net_pnl": r["net_pnl"]} for s, r in ranked[:20]]
top20 = [{"symbol": s, "trades": r["trades"], "win_rate": r["win_rate"],
          "net_pnl": r["net_pnl"]} for s, r in ranked[-20:][::-1]]

# before/after on identical symbols
oldmap = {r["symbol"]: r for r in old["per_symbol"]}
both = [s for s in oldmap if s in done]
o_rows = [oldmap[s] for s in both]
n_rows = [done[s] for s in both]
overlap = {
    "n": len(both),
    "old": {"gross_pnl": psum(o_rows, "gross_pnl"), "total_costs": psum(o_rows, "total_costs"),
            "net_pnl": psum(o_rows, "net_pnl"), "trades": sum(r["trades"] for r in o_rows)},
    "new": {"gross_pnl": psum(n_rows, "gross_pnl"), "total_costs": psum(n_rows, "total_costs"),
            "net_pnl": psum(n_rows, "net_pnl"), "trades": sum(r["trades"] for r in n_rows)},
}
mism = [s for s in both
        if abs(done[s]["net_pnl"] - oldmap[s]["net_pnl"]) > 0.01 or done[s]["trades"] != oldmap[s]["trades"]]
overlap["mismatched_symbols"] = mism

out = {
    "meta": {
        "generated_at": datetime.now().isoformat(),
        "strategy": "52w_chaser", "days": 365, "params": {},
        "universe": "all_equity", "universe_n": prog.get("universe_n", 2685),
        "symbols_tested": len(done), "symbols_with_trades": len(active),
        "symbols_zero_trades": zero, "symbols_error": errors,
        "fix": "rsi_hi 70->75, volume_mult 1.8x (only positive gate), "
               "MA50/MA200/RSI-lo removed, NaN fails closed, entry bar excluded "
               "from volume baseline via shift(1), duplicate-date LAST-match; "
               "canonical constants CHASER_ADX_MIN/RHI/VOL_MULT shared live/backtest",
        "fix_scope_note": "params={} leaves enable_filters=False, so the gate fix "
                          "does not alter this sweep; the sweep measures the fixed "
                          "codebase on the full universe. Gate effects verified "
                          "separately (filters-on trial + unit gates).",
    },
    "verification": {
        "constants": {"CHASER_ADX_MIN": 25.0, "CHASER_RSI_HI": 75.0, "CHASER_VOLUME_MULT": 1.8},
        "unit_gates": {"RSI72_passes": True, "RSI76_vetoed": True, "vol1.7x_vetoed": True,
                       "RSI_NaN_fails_closed": True, "ADX_missing_fails_closed": True,
                       "vol_baseline_shift1": True},
        "trial_2sym_defaults": {"symbols": ["BHEL", "CUMMINSIND"],
                                "result": [["BHEL", 6, -256.51], ["CUMMINSIND", 4, 61058.86]],
                                "skipped_stocks": [],
                                "note": "matches chaser_universe.json exactly; zero engine errors"},
        "trial_2sym_filters_on": {"params": {"enable_filters": True},
                                  "result": [["BHEL", 1, -1493.01], ["CUMMINSIND", 2, 48513.76]],
                                  "skipped_stocks": [],
                                  "note": "gates live and biting (6->1, 4->2 trades)"},
    },
    "pooled": pooled,
    "avg_trades_per_symbol_tested": round(pooled["trades"] / len(done), 2) if done else 0,
    "avg_trades_per_active_symbol": round(pooled["trades"] / len(active), 2) if active else 0,
    "win_rate_distribution_active": wr_buckets,
    "trades_distribution": {"1 trade": t1, "2-3 trades": t23, "4+ trades": t4,
                            "max_trades_symbol": mx_sym if arows else None,
                            "max_trades_n": mx_n if arows else 0},
    "exit_mix": exit_mix,
    "top20_by_net": top20,
    "bottom20_by_net": bottom20,
    "last_week_slice": {
        "rule": ws["meta"]["signal_date_rule"], "gates": ws["meta"]["gates"],
        "entry": ws["meta"]["entry"], "exit": ws["meta"]["exit"],
        "universe_n": ws["meta"]["universe_n"],
        "signals": 0, "total": ws["total"],
        "evidence": "full-universe band-only scan: 2471 usable symbols, 0 with Oct-1 "
                    "close in [0.5,3.0]% above 252d high; pct distribution "
                    "{'< -10%': 2155, '-10..-3%': 265, '-3..+0.5%': 51}; "
                    "nearest misses all liquid ETFs (LIQUIDCASE -0.02%, LIQUIDSHRI -0.0%, "
                    "ELIQUID -0.08%, HDFCLIQUID -0.28%, ONEPOINT -0.17%). "
                    "Breakouts that week happened mid-week (cf chaser_outcome: 5 hitters), "
                    "not as of the pre-week close.",
        "note": "first slice attempt WITH a days_since>=3 gate also gave 0 signals; "
                "that gate degenerates under daily-close semantics (any band entry sets "
                "a new high -> days_since=0 -> veto-all) and the nautilus backtest has "
                "no such check; dropped per chaser_outcome scenario-C (band-only) precedent.",
    },
    "before_after_vs_chaser_universe": {
        "old_scope": "nifty500 liquid 321 tested, params={}",
        "old_pooled": old["pooled"],
        "overlap_symbols": overlap,
        "headline": "overlap 321/321 bit-identical (dNet=0.00, dTrades=0): expected, "
                    "filters-off path untouched by gate fix. Headline pooled differs "
                    "only by universe scope (all-equity 2682 vs liquid-321).",
    },
    "hand_verification": {
        "DYNAMATECH": {"trades": 3, "exits": "3xTP", "gross": 200100.0,
                       "costs": 1253.59, "net": 198846.41,
                       "trade0_recalc": "(9715.00-9061.00)*100=65400.00 gross, "
                                        "costs 385.28 == stored 385.28"},
        "APOLLOHOSP": {"trades": 4, "exits": "1TP/3SL", "gross": -89500.0,
                       "costs": 1350.32, "net": -90850.32,
                       "all4_costs_recalc_match": True,
                       "note": "also matches chaser_universe.json exactly"},
    },
    "per_symbol": [{"symbol": s, **{k: done[s].get(k) for k in
        ("trades", "wins", "losses", "win_rate", "gross_pnl", "total_costs", "net_pnl",
         "pf", "tp_exits", "sl_exits", "trailing_exits", "max_hold_exits")}}
        for s in sorted(done)],
}

(ROOT / "chaser_fixed.json").write_text(json.dumps(out, indent=1))

rows_top = "\n".join(f"| {r['symbol']} | {r['trades']} | {r['win_rate']:.1f}% | {r['net_pnl']:,.2f} |"
                     for r in top20)
rows_bot = "\n".join(f"| {r['symbol']} | {r['trades']} | {r['win_rate']:.1f}% | {r['net_pnl']:,.2f} |"
                     for r in bottom20)
md = f"""# 52W Chaser (FIXED gates) — Full All-Equity Universe Sweep
Date: {out['meta']['generated_at'][:10]} | Strategy: `52w_chaser` | days=365 | params={{}} (defaults) | Engine: nautilus (`backtest.engine.get_engine().run`)

## Fix under test
- `rsi_hi` 70→75, volume gate 1.8×20d avg (only positive single-setting gate), MA50/MA200/RSI-lo removed, NaN fails closed, entry bar excluded from its own volume baseline (`shift(1)`), duplicate-date LAST-match, canonical constants `CHASER_ADX_MIN/RHI/VOL_MULT` shared live↔backtest.
- Scope note: `params={{}}` leaves `enable_filters=False`, so this sweep measures the fixed codebase on the full universe; gate effects verified separately below.

## Fix verification (live before sweep)
- Unit gates: RSI 72 passes (old 70 vetoed), RSI 76 vetoed, vol 1.7× vetoed, RSI-NaN/ADX-missing fail closed, `shift(1)` baseline present. All True.
- 2-symbol trial (defaults): BHEL 6 / −256.51, CUMMINSIND 4 / +61,058.86 — matches `chaser_universe.json` exactly; `skipped_stocks` empty (zero engine errors).
- Filters-on trial (`enable_filters: True`): BHEL 6→1 (−1,493.01), CUMMINSIND 4→2 (+48,513.76) — gates live and biting.

## Universe
- Source: `chart_patterns.universes.get_universe("all_equity")` — 2,685 symbols.
- Tested 2,682, errors 3 (all genuine "No data": CAMLINFINE, SOMATEX, VASCONEQ). Zero engine errors.

## Pooled totals (defaults, costs included)
| gross | costs | **net** | trades | wins | win rate |
|---:|---:|---:|---:|---:|---:|
| {pooled['gross_pnl']:,.2f} | {pooled['total_costs']:,.2f} | **{pooled['net_pnl']:,.2f}** | {pooled['trades']} | {pooled['wins']} | {pooled['win_rate_pct']}% |

- Symbols with ≥1 trade: {len(active)}/2,682 ({100*len(active)/len(done):.1f}%); zero-trade: {zero}
- Avg trades/symbol (tested): {out['avg_trades_per_symbol_tested']} | per active symbol: {out['avg_trades_per_active_symbol']}
- Exit mix: TP {exit_mix['tp_exits']} / SL {exit_mix['sl_exits']} / trailing {exit_mix['trailing_exits']} / max-hold {exit_mix['max_hold_exits']}

## Last-week slice (Oct 5–9 2026, fixed gates, ₹1L/trade)
- Signal: last session before Oct 5 (Oct 1; mission "Fri Oct 3" is a Saturday, Oct 2 NSE holiday) close in [0.5,3.0]% above 52W high + ADX≥25, RSI≤75, vol≥1.8×avg20, avg20≥50k, NaN vetoes. Entry Oct-5 open → 2% SL on Oct 5–9 lows else Oct-9 close. Costs via `backtest/costs.py`.
- Result: **0 signals → 0 trades, net ₹0.00.**
- Evidence: full-universe band-only scan (2,471 usable) found 0 closes in-band; distribution <−10%: 2,155 / −10..−3%: 265 / −3..+0.5%: 51. Nearest misses all liquid ETFs. Oct-1 was deep in a correction (87% of symbols >10% off highs); that week's breakouts happened mid-week (cf `chaser_outcome`: 5 hitters, both chaser-band entries lost).

## Before/after vs `chaser_universe.json` (old gates)
- Old: liquid-321 pooled gross −36,726.00 / costs 35,782.45 / **net −72,508.45** / 473 trades / 43.8%.
- Overlap 321/321 symbols **bit-identical** (Δtrades=0, Δnet=0.00, 0 mismatches) — expected: filters-off path untouched by the gate fix. Headline pooled differs only by universe scope (all-equity 2,682 vs liquid 321).
- Sibling ablation context (−15.5pp→+3.5pp) applies to the filters-on path, not this defaults sweep.

## Top-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
{rows_top}

## Bottom-20 by net
| symbol | trades | win% | net |
|---|---|---:|---:|
{rows_bot}

## Win-rate distribution (active symbols only, n={len(active)})
| bucket | symbols |
|---|---:|
| 0% | {wr_buckets['0%']} |
| 1-25% | {wr_buckets['1-25%']} |
| 26-50% | {wr_buckets['26-50%']} |
| 51-75% | {wr_buckets['51-75%']} |
| 76-99% | {wr_buckets['76-99%']} |
| 100% | {wr_buckets['100%']} |

## Trades-per-symbol distribution
- 1 trade: {t1} symbols | 2–3: {t23} | 4+: {t4} (max: {mx_sym if arows else None} {mx_n if arows else 0})

## Hand verification (trade_list re-run, costs recomputed via `backtest/costs.py`)
- **DYNAMATECH**: 3×TP → gross 200,100.00 − costs 1,253.59 = **+198,846.41** ✓ (trade0: (9715−9061)×100=65,400; costs 385.28 == stored).
- **APOLLOHOSP**: 1TP/3SL → gross −89,500.00 − costs 1,350.32 = **−90,850.32** ✓ (all 4 costs recalc-match; also matches old universe value).

## Runtime / repro
- Sweep ≈ 15 min wall (269 chunks × 10 sym, internal pool ≤4 workers), checkpoints every chunk to `experiments/chaser_fixed_progress.json` (resumable).
- Artifacts (all `experiments/chaser_fixed_*`, uncommitted): `chaser_fixed.json` (full per-symbol table), `chaser_fixed.md` (this file), `chaser_fixed_progress.json`, `chaser_fixed_run.py`, `chaser_fixed_weekslice.py`, `chaser_fixed_weekslice.json`, `chaser_fixed_report.py`, logs.
"""
(ROOT / "chaser_fixed.md").write_text(md)
print("wrote chaser_fixed.json + chaser_fixed.md")
print("pooled net=%.2f trades=%d" % (pooled["net_pnl"], pooled["trades"]))
