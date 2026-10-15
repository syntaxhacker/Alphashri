"""Aggregate experiments/target_universe_progress.json -> target_universe.json + .md."""
import json
import os
import sys
from datetime import datetime, timezone, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
PROGRESS_FILE = os.path.join(BASE, "target_universe_progress.json")
SYMBOLS_FILE = os.path.join(BASE, "target_universe_symbols.json")
RESULT_FILE = os.path.join(BASE, "target_universe.json")
MD_FILE = os.path.join(BASE, "target_universe.md")
IST = timezone(timedelta(hours=5, minutes=30))


def main():
    progress = json.load(open(PROGRESS_FILE))
    sym_meta = json.load(open(SYMBOLS_FILE)) if os.path.exists(SYMBOLS_FILE) else {}
    rows = list(progress.values())
    ok = [r for r in rows if r.get("ok")]
    failed = [r for r in rows if not r.get("ok")]
    traded = [r for r in ok if r.get("trades", 0) > 0]
    zero = [r for r in ok if r.get("trades", 0) == 0]

    total_trades = sum(r.get("trades", 0) for r in ok)
    total_wins = sum(r.get("wins", 0) for r in ok)
    total_losses = sum(r.get("losses", 0) for r in ok)
    total_net = round(sum(r.get("net", 0) for r in ok), 2)
    total_gross = round(sum(r.get("gross", 0) for r in ok), 2)
    total_costs = round(sum(r.get("costs", 0) for r in ok), 2)
    pooled_win_rate = round(total_wins / total_trades * 100, 2) if total_trades else 0
    gross_profits = sum(r["net"] for r in ok if r.get("net", 0) > 0)
    gross_losses = abs(sum(r["net"] for r in ok if r.get("net", 0) < 0))
    pf = round(gross_profits / gross_losses, 2) if gross_losses else (float("inf") if gross_profits > 0 else 0)
    profitable_syms = sum(1 for r in traded if r.get("net", 0) > 0)
    losing_syms = sum(1 for r in traded if r.get("net", 0) < 0)
    win_rates = sorted(r.get("win_rate", 0) for r in traded)

    def pct(q):
        if not win_rates:
            return 0
        i = min(len(win_rates) - 1, int(q * len(win_rates)))
        return win_rates[i]

    by_net = sorted(traded, key=lambda r: r.get("net", 0), reverse=True)
    top20 = [{"symbol": r["symbol"], "trades": r["trades"], "win_rate": r["win_rate"],
              "net": r["net"], "pf": r.get("pf")} for r in by_net[:20]]
    bot20 = [{"symbol": r["symbol"], "trades": r["trades"], "win_rate": r["win_rate"],
              "net": r["net"], "pf": r.get("pf")} for r in by_net[-20:][::-1]]
    per_symbol = [{"symbol": r["symbol"], "trades": r.get("trades", 0),
                   "wins": r.get("wins", 0), "losses": r.get("losses", 0),
                   "win_rate": r.get("win_rate", 0), "net": r.get("net", 0),
                   "gross": r.get("gross", 0), "costs": r.get("costs", 0),
                   "pf": r.get("pf", 0)} for r in sorted(ok, key=lambda r: r["symbol"])]

    out = {
        "strategy": "52w_target",
        "params": {"entry_threshold_pct": 2.0, "stop_loss_pct": 2.0, "trailing_stop_pct": 2.0},
        "days": 365,
        "generated_at_ist": datetime.now(IST).strftime("%Y-%m-%d %H:%M IST"),
        "universe": {"method": sym_meta.get("method"), "from_nifty500": sym_meta.get("from_nifty500"),
                     "size": len(sym_meta.get("symbols", [])) if sym_meta else len(rows),
                     "low_vol_excluded": sym_meta.get("low_vol"), "no_tv_data": sym_meta.get("no_data")},
        "coverage": {"symbols_done": len(rows), "ok": len(ok), "failed": len(failed),
                     "with_trades": len(traded), "zero_trade": len(zero),
                     "failures": [{"symbol": r["symbol"], "error": r.get("error")} for r in failed]},
        "pooled": {"symbols_traded": len(traded), "trades": total_trades,
                   "wins": total_wins, "losses": total_losses,
                   "win_rate_pct": pooled_win_rate, "gross_pnl": total_gross,
                   "costs": total_costs, "net_pnl": total_net, "profit_factor": pf,
                   "profitable_symbols": profitable_syms, "losing_symbols": losing_syms,
                   "avg_trades_per_symbol": round(total_trades / len(traded), 2) if traded else 0,
                   "avg_net_per_symbol": round(total_net / len(traded), 2) if traded else 0,
                   "avg_net_per_trade": round(total_net / total_trades, 2) if total_trades else 0},
        "win_rate_distribution": {"min": min(win_rates) if win_rates else 0,
                                  "p25": pct(0.25), "median": pct(0.5),
                                  "p75": pct(0.75), "max": max(win_rates) if win_rates else 0},
        "top20_by_net": top20,
        "bottom20_by_net": bot20,
        "per_symbol": per_symbol,
    }
    json.dump(out, open(RESULT_FILE, "w"), indent=1)

    L = []
    L.append("# 52W Target — Liquid-Universe Study (365d)")
    L.append("")
    L.append(f"Generated: {out['generated_at_ist']} | Params: entry_within_2%_under_high, SL 2%, trail 2%")
    L.append(f"Universe: Nifty500 ({sym_meta.get('from_nifty500')}) -> TV 10d avg vol >= 500k "
             f"= **{len(sym_meta.get('symbols', []))}** symbols "
             f"({sym_meta.get('low_vol')} low-vol excluded, {sym_meta.get('no_data')} no TV data).")
    L.append(f"Coverage: {len(rows)} done, {len(ok)} ok, {len(failed)} failed, "
             f"{len(traded)} with trades, {len(zero)} zero-trade.")
    L.append("")
    L.append("## Pooled totals")
    L.append("")
    L.append(f"- Symbols traded: {len(traded)} | Trades: {total_trades} "
             f"(avg {out['pooled']['avg_trades_per_symbol']}/symbol)")
    L.append(f"- Wins: {total_wins} / Losses: {total_losses} | Pooled win rate: **{pooled_win_rate}%**")
    L.append(f"- Gross: {total_gross} | Costs: {total_costs} | **Net: {total_net}** | PF: {pf}")
    L.append(f"- Profitable symbols: {profitable_syms} | Losing: {losing_syms} | "
             f"Avg net/symbol: {out['pooled']['avg_net_per_symbol']} | Avg net/trade: {out['pooled']['avg_net_per_trade']}")
    L.append(f"- Win-rate distribution (per traded symbol): min {out['win_rate_distribution']['min']} / "
             f"p25 {pct(0.25)} / median {pct(0.5)} / p75 {pct(0.75)} / max {out['win_rate_distribution']['max']}")
    if failed:
        L.append(f"- Failures ({len(failed)}): " + ", ".join(f"{r['symbol']} ({r.get('error','')[:60]})" for r in failed[:20]))
    L.append("")
    L.append("## Top 20 by net")
    L.append("")
    L.append("| # | Symbol | Trades | Win% | Net | PF |")
    L.append("|---|--------|--------|------|-----|----|")
    for i, r in enumerate(top20, 1):
        L.append(f"| {i} | {r['symbol']} | {r['trades']} | {r['win_rate']} | {r['net']} | {r['pf']} |")
    L.append("")
    L.append("## Bottom 20 by net")
    L.append("")
    L.append("| # | Symbol | Trades | Win% | Net | PF |")
    L.append("|---|--------|--------|------|-----|----|")
    for i, r in enumerate(bot20, 1):
        L.append(f"| {i} | {r['symbol']} | {r['trades']} | {r['win_rate']} | {r['net']} | {r['pf']} |")
    L.append("")
    L.append("## Per-symbol (all)")
    L.append("")
    L.append("| Symbol | Trades | W | L | Win% | Net | Gross | Costs | PF |")
    L.append("|--------|--------|---|---|------|-----|-------|-------|----|")
    for r in per_symbol:
        L.append(f"| {r['symbol']} | {r['trades']} | {r['wins']} | {r['losses']} | "
                 f"{r['win_rate']} | {r['net']} | {r['gross']} | {r['costs']} | {r['pf']} |")
    open(MD_FILE, "w").write("\n".join(L) + "\n")
    print(f"wrote {RESULT_FILE} + {MD_FILE}: {len(rows)} symbols, "
          f"{total_trades} trades, net {total_net}, win% {pooled_win_rate}")


if __name__ == "__main__":
    sys.exit(main())
