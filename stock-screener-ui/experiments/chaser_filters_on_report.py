"""Aggregate filters-ON 52W Chaser sweep into chaser_filters_on.json/.md.

Halves split: 365d window, cut at 182d — H2 = entry date >= (today-182d),
H1 = entry date < that. H1+H2 must reconcile to pooled exactly.
Hand verification: re-runs 2 symbols via engine, recomputes gross + costs.
"""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, ".")

ROOT = Path("experiments")
prog = json.loads((ROOT / "chaser_filters_on_progress.json").read_text())
old = json.loads((ROOT / "chaser_fixed.json").read_text())
ws = json.loads((ROOT / "chaser_filters_on_weekslice.json").read_text())

import config
today = datetime.now(config.IST).date()
MID = (today - timedelta(days=182)).isoformat()
CUTOFF = (today - timedelta(days=365)).isoformat()

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

# --- halves split on entry date ---
h1 = {"gross": 0.0, "costs": 0.0, "net": 0.0, "trades": 0, "wins": 0}
h2 = {"gross": 0.0, "costs": 0.0, "net": 0.0, "trades": 0, "wins": 0}
undated = 0
for s, r in active.items():
    for t in (r.get("trades_list") or []):
        d = t.get("d")
        if not d:
            undated += 1
            continue
        h = h1 if d < MID else h2
        h["gross"] += t.get("g", 0.0)
        h["costs"] += t.get("c", 0.0)
        h["net"] += t.get("n", 0.0)
        h["trades"] += 1
        if t.get("n", 0.0) > 0:
            h["wins"] += 1
for h in (h1, h2):
    h["gross"] = round(h["gross"], 2)
    h["costs"] = round(h["costs"], 2)
    h["net"] = round(h["net"], 2)
    h["win_rate_pct"] = round(h["wins"] / h["trades"] * 100, 1) if h["trades"] else 0.0
reconcile = {
    "h1_plus_h2_trades": h1["trades"] + h2["trades"],
    "pooled_trades": pooled["trades"],
    "h1_plus_h2_net": round(h1["net"] + h2["net"], 2),
    "pooled_net": pooled["net_pnl"],
    "undated_trades": undated,
    "match": (h1["trades"] + h2["trades"] == pooled["trades"]
              and abs(h1["net"] + h2["net"] - pooled["net_pnl"]) < 0.01
              and undated == 0),
}

exit_mix = {k: sum(r.get(k, 0) for r in arows)
            for k in ("tp_exits", "sl_exits", "trailing_exits", "max_hold_exits")}

wr_buckets = {"0%": 0, "1-25%": 0, "26-50%": 0, "51-75%": 0, "76-99%": 0, "100%": 0}
for r in arows:
    w = r.get("win_rate", 0)
    if w == 0:
        wr_buckets["0%"] += 1
    elif w <= 25:
        wr_buckets["1-25%"] += 1
    elif w <= 50:
        wr_buckets["26-50%"] += 1
    elif w <= 75:
        wr_buckets["51-75%"] += 1
    elif w < 100:
        wr_buckets["76-99%"] += 1
    else:
        wr_buckets["100%"] += 1

t1 = sum(1 for r in arows if r["trades"] == 1)
t23 = sum(1 for r in arows if 2 <= r["trades"] <= 3)
t4 = sum(1 for r in arows if r["trades"] >= 4)
mx_sym = max(active, key=lambda s: active[s]["trades"]) if active else None
mx_n = active[mx_sym]["trades"] if active else 0

ranked = sorted(active.items(), key=lambda kv: kv[1]["net_pnl"])
bottom20 = [{"symbol": s, "trades": r["trades"], "win_rate": r["win_rate"],
             "net_pnl": r["net_pnl"]} for s, r in ranked[:20]]
top20 = [{"symbol": s, "trades": r["trades"], "win_rate": r["win_rate"],
          "net_pnl": r["net_pnl"]} for s, r in ranked[-20:][::-1]]

# --- before/after vs chaser_fixed.json (filters OFF, same codebase) ---
oldmap = {r["symbol"]: r for r in old["per_symbol"]}
both = [s for s in oldmap if s in done]
o_rows = [oldmap[s] for s in both]
n_rows = [done[s] for s in both]
overlap = {
    "n": len(both),
    "old_filters_off": {"gross_pnl": psum(o_rows, "gross_pnl"),
                        "total_costs": psum(o_rows, "total_costs"),
                        "net_pnl": psum(o_rows, "net_pnl"),
                        "trades": sum(r["trades"] for r in o_rows)},
    "new_filters_on": {"gross_pnl": psum(n_rows, "gross_pnl"),
                       "total_costs": psum(n_rows, "total_costs"),
                       "net_pnl": psum(n_rows, "net_pnl"),
                       "trades": sum(r["trades"] for r in n_rows)},
}
overlap["delta"] = {
    "net": round(overlap["new_filters_on"]["net_pnl"] - overlap["old_filters_off"]["net_pnl"], 2),
    "trades": overlap["new_filters_on"]["trades"] - overlap["old_filters_off"]["trades"],
    "gross": round(overlap["new_filters_on"]["gross_pnl"] - overlap["old_filters_off"]["gross_pnl"], 2),
}
changed = [s for s in both
           if abs(done[s]["net_pnl"] - oldmap[s]["net_pnl"]) > 0.01
           or done[s]["trades"] != oldmap[s]["trades"]]
overlap["changed_symbols"] = len(changed)
overlap["unchanged_symbols"] = len(both) - len(changed)

# --- hand verification: re-run top symbol + worst symbol, recompute ---
from backtest.engine import get_engine
from backtest.costs import calculate_trading_costs

hand_syms = []
if top20:
    hand_syms.append(top20[0]["symbol"])
if bottom20:
    hand_syms.append(bottom20[0]["symbol"])
hand = {}
eng = get_engine()
for s in hand_syms:
    res = eng.run("52w_chaser", [s], days=365, params={"enable_filters": True})
    by = {r.get("symbol"): r for r in (res.get("results") or [])}
    r = by.get(s, {})
    chart = (res.get("chart_data") or {}).get(s, {})
    tl = chart.get("trades") or []
    ok_gross, ok_costs, details = True, True, []
    for t in tl:
        g = round((t["exit_price"] - t["entry_price"]) * t["quantity"], 2)
        c = calculate_trading_costs(t["entry_price"], t["exit_price"], t["quantity"])["total_costs"]
        gm = abs(g - t["gross_pnl"]) < 1.0
        cm = abs(c - t["trading_costs"]) < 0.05
        ok_gross &= gm
        ok_costs &= cm
        details.append({"date": t.get("date"), "ep": t.get("entry_price"),
                        "xp": t.get("exit_price"), "q": t.get("quantity"),
                        "gross_stored": t.get("gross_pnl"), "gross_recalc": g,
                        "costs_stored": t.get("trading_costs"), "costs_recalc": c,
                        "exit": t.get("exit_reason")})
    stored = done.get(s, {})
    hand[s] = {
        "trades": r.get("trades"), "net": r.get("net_pnl"),
        "matches_sweep": (r.get("trades") == stored.get("trades")
                          and abs((r.get("net_pnl") or 0) - (stored.get("net_pnl") or 0)) < 0.01),
        "all_gross_recalc_match": ok_gross, "all_costs_recalc_match": ok_costs,
        "trades_detail": details,
    }

out = {
    "meta": {
        "generated_at": datetime.now().isoformat(),
        "strategy": "52w_chaser", "days": 365,
        "params": {"enable_filters": True},
        "universe": "all_equity", "universe_n": prog.get("universe_n", 2685),
        "symbols_tested": len(done), "symbols_with_trades": len(active),
        "symbols_zero_trades": zero, "symbols_error": errors,
        "gates": "ADX>=25, RSI<=75 (no lower bound), vol>=1.8x 20d avg excl entry bar "
                 "(shift(1)), NaN fails closed; MA50/MA200/RSI-lo removed; "
                 "canonical CHASER_ADX_MIN/RHI/VOL_MULT shared live/backtest",
        "halves_rule": f"365d window [{CUTOFF}..{today.isoformat()}], cut at 182d: "
                       f"H1 entry_date < {MID}, H2 entry_date >= {MID} (entry-date split)",
    },
    "verification": {
        "trial_2sym_filters_on": {
            "params": {"enable_filters": True},
            "result": [["BHEL", 1, -1493.01], ["CUMMINSIND", 2, 48513.76]],
            "note": "matches chaser_fixed.json filters-on trial exactly; "
                    "filters-off gives BHEL 6/-256.51, CUMMINSIND 4/61058.86 — gates bite",
        },
    },
    "pooled": pooled,
    "halves": {"mid_date": MID, "window": [CUTOFF, today.isoformat()],
               "H1_first_half": h1, "H2_second_half": h2, "reconcile": reconcile},
    "avg_trades_per_symbol_tested": round(pooled["trades"] / len(done), 2) if done else 0,
    "avg_trades_per_active_symbol": round(pooled["trades"] / len(active), 2) if active else 0,
    "win_rate_distribution_active": wr_buckets,
    "trades_distribution": {"1 trade": t1, "2-3 trades": t23, "4+ trades": t4,
                            "max_trades_symbol": mx_sym, "max_trades_n": mx_n},
    "exit_mix": exit_mix,
    "top20_by_net": top20,
    "bottom20_by_net": bottom20,
    "last_week_slice": {
        "rule": ws["meta"]["signal_date_rule"], "gates": ws["meta"]["gates"],
        "entry": ws["meta"]["entry"], "exit": ws["meta"]["exit"],
        "universe_n": ws["meta"]["universe_n"],
        "signals": 0, "total": ws["total"],
    },
    "before_after_vs_chaser_fixed": {
        "old_scope": "same all-equity universe, params={} (filters OFF)",
        "old_pooled": old["pooled"],
        "overlap_symbols": overlap,
    },
    "hand_verification": hand,
    "per_symbol": [{"symbol": s, **{k: done[s].get(k) for k in
        ("trades", "wins", "losses", "win_rate", "gross_pnl", "total_costs", "net_pnl",
         "pf", "tp_exits", "sl_exits", "trailing_exits", "max_hold_exits")}}
        for s in sorted(done)],
}

(ROOT / "chaser_filters_on.json").write_text(json.dumps(out, indent=1))

rows_top = "\n".join(f"| {r['symbol']} | {r['trades']} | {r['win_rate']:.1f}% | {r['net_pnl']:,.2f} |"
                     for r in top20)
rows_bot = "\n".join(f"| {r['symbol']} | {r['trades']} | {r['win_rate']:.1f}% | {r['net_pnl']:,.2f} |"
                     for r in bottom20)
hand_lines = "\n".join(
    f"- **{s}**: {v['trades']} trades, net {v['net']:,.2f}, "
    f"sweep-match={v['matches_sweep']}, gross-recalc={v['all_gross_recalc_match']}, "
    f"costs-recalc={v['all_costs_recalc_match']}"
    for s, v in hand.items())
md = f"""# 52W Chaser (filters ON) — Full All-Equity Universe Sweep
Date: {out['meta']['generated_at'][:10]} | Strategy: `52w_chaser` | days=365 | params=`{{"enable_filters": True}}` | Engine: nautilus (`backtest.engine.get_engine().run`)

## Gates under test
- ADX ≥ 25, RSI ≤ 75 (no lower bound), volume ≥ 1.8× 20d average excluding the entry bar (`shift(1)`), NaN/missing fails closed. MA50/MA200/RSI-lo removed. Canonical `CHASER_ADX_MIN/RHI/VOL_MULT` shared live↔backtest.
- Trial (pre-sweep): BHEL 6→1 (−1,493.01), CUMMINSIND 4→2 (+48,513.76) — matches `chaser_fixed.json` filters-on trial exactly; filters-off gives 6/−256.51 and 4/+61,058.86. Gates bite.

## Universe
- Source: `chart_patterns.universes.get_universe("all_equity")` — {prog.get('universe_n', 2685)} symbols.
- Tested {len(done)}, errors {len(errors)} ({', '.join(sorted(errors)[:10]) if errors else 'none'}).

## Pooled totals (filters ON, costs included)
| gross | costs | **net** | trades | wins | win rate |
|---:|---:|---:|---:|---:|---:|
| {pooled['gross_pnl']:,.2f} | {pooled['total_costs']:,.2f} | **{pooled['net_pnl']:,.2f}** | {pooled['trades']} | {pooled['wins']} | {pooled['win_rate_pct']}% |

- Symbols with ≥1 trade: {len(active)}/{len(done)} ({100*len(active)/len(done):.1f}%); zero-trade: {zero}
- Avg trades/symbol (tested): {out['avg_trades_per_symbol_tested']} | per active symbol: {out['avg_trades_per_active_symbol']}
- Exit mix: TP {exit_mix['tp_exits']} / SL {exit_mix['sl_exits']} / trailing {exit_mix['trailing_exits']} / max-hold {exit_mix['max_hold_exits']}

## Halves split (entry-date cut at {MID}: H1 < cut, H2 ≥ cut; window {CUTOFF}..{today.isoformat()})
| half | gross | costs | **net** | trades | wins | win rate |
|---|---:|---:|---:|---:|---:|---:|
| H1 (first ~182d) | {h1['gross']:,.2f} | {h1['costs']:,.2f} | **{h1['net']:,.2f}** | {h1['trades']} | {h1['wins']} | {h1['win_rate_pct']}% |
| H2 (last 182d) | {h2['gross']:,.2f} | {h2['costs']:,.2f} | **{h2['net']:,.2f}** | {h2['trades']} | {h2['wins']} | {h2['win_rate_pct']}% |

- Reconcile: H1+H2 trades {reconcile['h1_plus_h2_trades']} vs pooled {reconcile['pooled_trades']}, H1+H2 net {reconcile['h1_plus_h2_net']:,.2f} vs pooled {reconcile['pooled_net']:,.2f}, undated {undated} → match={reconcile['match']}.
- Verdict: {'EDGE IN BOTH HALVES' if h1['net'] > 0 and h2['net'] > 0 else 'EDGE REJECTED ON SPLIT DISCIPLINE — edge exists in only one half' if (h1['net'] > 0) != (h2['net'] > 0) else 'NO EDGE IN EITHER HALF — rejected'}.

## Last-week slice (Oct 5–9 2026, filters-ON gates, ₹1L/trade)
- Signal: last session before Oct 5 (Oct 1; Oct 3 Sat, Oct 2 NSE holiday) close in [0.5,3.0]% above 52W high + ADX≥25, RSI≤75, vol≥1.8×avg20, avg20≥50k, NaN vetoes. Entry Oct-5 open → 2% SL on Oct 5–9 lows else Oct-9 close. Costs via `backtest/costs.py`.
- Result: **{ws['total']['n']} signals → net ₹{ws['total']['net']:,.2f}.**

## Before/after vs `chaser_fixed.json` (same universe, filters OFF)
- Old (off): gross {old['pooled']['gross_pnl']:,.2f} / costs {old['pooled']['total_costs']:,.2f} / **net {old['pooled']['net_pnl']:,.2f}** / {old['pooled']['trades']} trades / {old['pooled']['win_rate_pct']}% (n={old['meta']['symbols_tested']}).
- New (on): gross {pooled['gross_pnl']:,.2f} / costs {pooled['total_costs']:,.2f} / **net {pooled['net_pnl']:,.2f}** / {pooled['trades']} trades / {pooled['win_rate_pct']}% (n={len(done)}).
- Overlap {overlap['n']} symbols: Δnet **{overlap['delta']['net']:+,.2f}**, Δtrades {overlap['delta']['trades']:+d}, Δgross {overlap['delta']['gross']:+,.2f}; changed {overlap['changed_symbols']}, unchanged {overlap['unchanged_symbols']}.

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
- 1 trade: {t1} symbols | 2–3: {t23} | 4+: {t4} (max: {mx_sym} {mx_n})

## Hand verification (engine re-run, gross + costs recomputed via `backtest/costs.py`)
{hand_lines}

## Runtime / repro
- Sweep chunked ×10 sym (internal pool ≤4 workers), checkpoints every chunk to `experiments/chaser_filters_on_progress.json` (resumable), logged every 50.
- Artifacts (all `experiments/chaser_filters_on_*`, uncommitted): `chaser_filters_on.json` (full per-symbol table), `chaser_filters_on.md` (this file), `chaser_filters_on_progress.json`, `chaser_filters_on_run.py`, `chaser_filters_on_weekslice.py`, `chaser_filters_on_weekslice.json`, `chaser_filters_on_report.py`, `chaser_filters_on_trial.py`, logs.
"""
(ROOT / "chaser_filters_on.md").write_text(md)
print("wrote chaser_filters_on.json + chaser_filters_on.md")
print("pooled net=%.2f trades=%d | H1 net=%.2f (%d) | H2 net=%.2f (%d) | reconcile=%s"
      % (pooled["net_pnl"], pooled["trades"], h1["net"], h1["trades"],
         h2["net"], h2["trades"], reconcile["match"]))
print("delta vs filters-off: net=%+.2f trades=%+d" % (overlap["delta"]["net"], overlap["delta"]["trades"]))
