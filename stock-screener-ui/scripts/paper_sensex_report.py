#!/usr/bin/env python3
"""Generate a self-contained HTML backtest viewer for SENSEX strategies.

Reads the hourly sweep trade CSV (all 48 configs x dates x trades) and emits a
single HTML file with:
  - config selector (dropdown)
  - summary card (median/mean day P&L, % profitable days, net, max DD, trades)
  - per-day totals table for the last N trading days
  - per-trade table (time, side, strike, entry, premium, signal, reason, P&L)

Usage:
  python3 scripts/paper_sensex_report.py [--csv experiments/data/hourly_sweep_trades_2026-08-05.csv]
                                         [--days 7] [--config notrend-t600-sl200-on]
                                         [--out experiments/data/sensex_backtest_report.html]
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA = ROOT / "experiments" / "data"


def load_trades(csv_path: Path) -> list:
    rows = []
    with open(csv_path) as f:
        for r in csv.DictReader(f):
            rows.append({
                "config": r["config"], "date": r["date"], "time": r["time"],
                "side": r["side"], "strike": float(r["strike"]),
                "entry": float(r["entry"]), "premium": float(r["premium"]),
                "signal": r["signal"], "reason": r["reason"], "pnl": float(r["pnl"]),
            })
    return rows


def per_config_metrics(trades: list) -> dict:
    """Aggregate trades per config -> summary metrics + per-day + trade list."""
    by_cfg = {}
    for t in trades:
        by_cfg.setdefault(t["config"], []).append(t)

    out = {}
    for cfg, ts in by_cfg.items():
        ts.sort(key=lambda t: (t["date"], t["time"]))
        per_day = {}
        for t in ts:
            per_day.setdefault(t["date"], []).append(t)
        day_nets = {d: round(sum(x["pnl"] for x in xs), 2) for d, xs in per_day.items()}
        nets = list(day_nets.values())
        wins = [t for t in ts if t["pnl"] > 0]
        losses = [t for t in ts if t["pnl"] <= 0]
        total = round(sum(t["pnl"] for t in ts), 2)
        # max drawdown from cumulative trade P&L
        cum, peak, mdd = 0.0, 0.0, 0.0
        for t in ts:
            cum += t["pnl"]
            peak = max(peak, cum)
            mdd = min(mdd, cum - peak)
        out[cfg] = {
            "config": cfg,
            "total_trades": len(ts), "wins": len(wins), "losses": len(losses),
            "win_rate": round(len(wins) / len(ts) * 100, 1) if ts else 0,
            "total_net": total,
            "median_day": round(statistics.median(nets), 2) if nets else 0,
            "mean_day": round(statistics.mean(nets), 2) if nets else 0,
            "pct_profitable_days": round(sum(1 for n in nets if n > 0) / len(nets) * 100, 1) if nets else 0,
            "max_dd": round(mdd, 2),
            "days": sorted(per_day.keys()),
            "day_nets": {d: day_nets[d] for d in sorted(per_day.keys())},
            "trades": ts,
        }
    return out


def render(cfg_name: str, data: dict, days_shown: int) -> str:
    m = data[cfg_name]
    all_days = m["days"]
    shown_days = all_days[-days_shown:]

    # summary row
    def fmt(x): return f"{x:,.0f}"

    # build per-day rows
    day_rows = []
    for d in shown_days:
        net = m["day_nets"].get(d, 0)
        dtrades = [t for t in m["trades"] if t["date"] == d]
        dw = sum(1 for t in dtrades if t["pnl"] > 0)
        dl = sum(1 for t in dtrades if t["pnl"] <= 0)
        gw = sum(t["pnl"] for t in dtrades if t["pnl"] > 0)
        gl = abs(sum(t["pnl"] for t in dtrades if t["pnl"] <= 0))
        pf = round(gw / gl, 2) if gl > 0 else (99.99 if gw > 0 else 0)
        cls = "day-prof" if net > 0 else ("day-loss" if net < 0 else "day-flat")
        day_rows.append(f"<tr class='{cls}'><td>{html.escape(d)}</td><td>{len(dtrades)}</td>"
                        f"<td>{dw}</td><td>{dl}</td><td class='{'pos' if net>=0 else 'neg'}'>{net:+,.0f}</td>"
                        f"<td>{pf:.2f}</td><td>{net/dw if dw else 0:,.0f}</td></tr>")

    # trade rows (only shown days)
    trade_rows = []
    for t in m["trades"]:
        if t["date"] not in set(shown_days):
            continue
        cls = "pos" if t["pnl"] >= 0 else "neg"
        trade_rows.append(f"<tr><td>{html.escape(t['date'][5:])}</td><td>{html.escape(t['time'])}</td>"
                          f"<td>{t['side']}</td><td>{t['strike']:,.0f}</td><td>{t['entry']:,.0f}</td>"
                          f"<td>{t['premium']:.2f}</td><td>{html.escape(t['signal'])}</td>"
                          f"<td>{html.escape(t['reason'])}</td><td class='{cls}'>{t['pnl']:+,.0f}</td></tr>")

    # config dropdown options
    opts = "".join(f"<option value='{html.escape(c)}' {'selected' if c==cfg_name else ''}>{html.escape(c)}</option>"
                   for c in sorted(data.keys()))

    day_rows_html = "\n".join(day_rows) if day_rows else "<tr><td colspan='7' class='dim'>no trades</td></tr>"
    trade_rows_html = "\n".join(trade_rows) if trade_rows else "<tr><td colspan='9' class='dim'>no trades in range</td></tr>"

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>SENSEX Strategy Backtest</title>
<style>
  body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:20px}}
  h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#888;font-size:13px;margin-bottom:16px}}
  .card{{background:#161a22;border:1px solid #262b36;border-radius:10px;padding:16px;margin-bottom:14px}}
  .row{{display:flex;gap:24px;flex-wrap:wrap}} .metric .v{{font-size:22px;font-weight:700}}
  .metric .l{{font-size:11px;color:#888;text-transform:uppercase}}
  .pos{{color:#34d399}} .neg{{color:#f87171}} .dim{{color:#6b7280}}
  select{{background:#1a1f29;color:#e6e6e6;border:1px solid #333a48;border-radius:6px;padding:6px 10px;font-size:14px}}
  table{{border-collapse:collapse;width:100%;font-size:13px}} th,td{{padding:6px 10px;text-align:right;border-bottom:1px solid #232835}}
  th{{color:#9ca3af;font-weight:600;font-size:11px;text-transform:uppercase}}
  td:nth-child(1),td:nth-child(7),td:nth-child(8){{text-align:left}}
  .day-prof td:first-child{{color:#34d399}} .day-loss td:first-child{{color:#f87171}} .day-flat td:first-child{{color:#9ca3af}}
  .wrap{{max-width:1100px;margin:0 auto}}
  .banner{{background:#2a2316;border:1px solid #5a4a1a;color:#fbbf24;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:14px}}
</style></head><body><div class="wrap">
<h1>SENSEX Strategy Backtest Viewer</h1>
<div class="sub">Source: hourly sweep trade log &middot; P&amp;L is net of option costs &middot; strategy: {html.escape(cfg_name)}</div>

<div class="card">
  <label>Config: </label><select id="cfg" onchange="location.search='?config='+this.value">{opts}</select>
</div>

<div class="banner">⚠ <b>Overfit warning:</b> these are <b>in-sample</b> backtest numbers. The "best of 48" config can
flip out-of-sample. Treat as directional evidence, not guaranteed returns. Prefer the OOS-stable
family (notrend + tight SL + trailing).</div>

<div class="card"><div class="row">
  <div class="metric"><div class="l">Median day P&amp;L</div><div class="v {'pos' if m['median_day']>=0 else 'neg'}">{fmt(m['median_day'])}</div></div>
  <div class="metric"><div class="l">Mean day P&amp;L</div><div class="v {'pos' if m['mean_day']>=0 else 'neg'}">{fmt(m['mean_day'])}</div></div>
  <div class="metric"><div class="l">% profitable days</div><div class="v">{m['pct_profitable_days']:.0f}%</div></div>
  <div class="metric"><div class="l">Total net</div><div class="v {'pos' if m['total_net']>=0 else 'neg'}">{fmt(m['total_net'])}</div></div>
  <div class="metric"><div class="l">Max drawdown</div><div class="v neg">{fmt(m['max_dd'])}</div></div>
  <div class="metric"><div class="l">Trades (W/L)</div><div class="v">{m['total_trades']} <span class='dim'>({m['wins']}W/{m['losses']}L {m['win_rate']:.0f}%)</span></div></div>
</div></div>

<div class="card"><h3 style="margin:0 0 10px;font-size:14px">Per-day totals — last {len(shown_days)} trading days</h3>
<table><thead><tr><th>Date</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Net</th><th>PF</th><th>Avg win</th></tr></thead>
<tbody>{day_rows_html}</tbody></table></div>

<div class="card"><h3 style="margin:0 0 10px;font-size:14px">Trades — last {len(shown_days)} trading days ({len(trade_rows)} shown)</h3>
<table><thead><tr><th>Date</th><th>Time</th><th>Side</th><th>Strike</th><th>Entry</th><th>Premium</th><th>Signal</th><th>Exit</th><th>P&amp;L</th></tr></thead>
<tbody>{trade_rows_html}</tbody></table></div>

</div></body></html>
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=str(DATA / "hourly_sweep_trades_2026-08-05.csv"))
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--config", default="notrend-t600-sl200-on")
    parser.add_argument("--out", default=str(DATA / "sensex_backtest_report.html"))
    args = parser.parse_args()

    trades = load_trades(Path(args.csv))
    data = per_config_metrics(trades)
    cfg = args.config if args.config in data else sorted(data.keys())[0]
    html_out = render(cfg, data, args.days)
    out_path = Path(args.out)
    out_path.write_text(html_out)
    print(f"wrote {out_path} ({len(html_out)//1024}KB) configs={len(data)} days_shown={args.days} config={cfg}")


if __name__ == "__main__":
    main()
