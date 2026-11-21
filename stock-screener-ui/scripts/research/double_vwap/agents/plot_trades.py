#!/usr/bin/env python
"""Build the self-contained double-VWAP trade review page and trades.json.

Every price shown comes from the engine's own signal builders / honest simulator.
The exit fill is reconstructed from the engine's net points and cross-checked
against its bar-by-bar fill logic; a trade that fails the check is rendered n/a.

Usage:
  .venv/bin/python scripts/research/double_vwap/agents/plot_trades.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date as _date

HERE = os.path.dirname(os.path.abspath(__file__))
DV = os.path.dirname(HERE)                       # scripts/research/double_vwap
ROOT = os.path.abspath(os.path.join(DV, "..", "..", ".."))
sys.path.insert(0, DV)

import strategy as S  # noqa: E402

OUTDIR = os.path.join(ROOT, "reports", "DOUBLE_VWAP", "trades")
COST = 1.1
RTH_OPEN, RTH_CLOSE = S.RTH_OPEN, S.RTH_CLOSE   # 09:30 / 16:00 ET

CFG = {
    "A": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                    stop_buf=30.0, target_a="rr1.75", sess_end=13 * 60),
    "B": S.base_cfg(range_src="on", legs="B", stop_src="range",
                    stop_buf=30.0, target_b="onvwap", sess_end=13 * 60),
}
LEG_DESC = {
    "A": "finalist · OR30 break → sig-ext stop · 1.75R target · no entries after 13:00",
    "B": "chart's 2nd leg · ON range break → NY-VWAP reclaim · ON-VWAP target · no entries after 13:00",
}
REASON_SHORT = {"stop": "SL", "stop_gap": "GAP", "target": "TP", "time": "EOD"}


def f(x, nd=4):
    """Native float, rounded for transport (keeps sub-cent precision)."""
    if x is None:
        return None
    v = float(x)
    return round(v, nd) if v == v else None


def hhmm(minute):
    m = int(minute)
    return f"{m // 60:02d}:{m % 60:02d}"


def bar_exit(d, side, stop, target, entry_idx):
    """Mirror of strategy.simulate's fill loop, used only to validate the formula."""
    for j in range(entry_idx, len(d.c)):
        if side > 0 and d.o[j] <= stop:
            return float(d.o[j])
        if side < 0 and d.o[j] >= stop:
            return float(d.o[j])
        if j > entry_idx:
            if side > 0:
                if d.l[j] <= stop:
                    return float(stop)
                if d.h[j] >= target:
                    return float(max(d.o[j], target))
            else:
                if d.h[j] >= stop:
                    return float(stop)
                if d.l[j] <= target:
                    return float(min(d.o[j], target))
        else:
            if side > 0 and d.l[j] <= stop:
                return float(stop)
            if side < 0 and d.h[j] >= stop:
                return float(stop)
        if d.t[j] >= S.EOD:
            return float(d.c[j])
    return float(d.c[-1])


def pairs_for(days, cfg):
    """Replicate strategy.collect while keeping (signal, trade) together."""
    out = []
    for d in days:
        brk = S.first_break(d, cfg["range_src"], cfg["eps"])
        if brk is None:
            continue
        sigs = []
        if "A" in cfg["legs"]:
            s = S.leg_a_signal(d, brk, cfg)
            if s:
                sigs.append(s)
        if "B" in cfg["legs"]:
            s = S.leg_b_signal(d, brk, cfg)
            if s:
                sigs.append(s)
        for s in sigs:
            tr = S.simulate(s, COST)
            if tr:
                out.append((s, tr))
    return out


def make_trade_record(s, tr, x_map, first_x, last_x):
    d = s["day"]
    entry_idx = int(s["idx"])
    entry = float(d.o[entry_idx])
    side = int(tr["side"])
    stop, target = float(s["stop"]), float(s["target"])
    # Engine: pts = (exit_px - entry) * side - COST  =>  exit_px = entry + side*(pts + COST)
    exit_px = entry + side * (float(tr["pts"]) + COST)
    honest = bar_exit(d, side, stop, target, entry_idx)
    reconciled = abs(exit_px - honest) < 1e-6
    exit_idx = min(entry_idx + int(tr["bars"]), len(d.t) - 1)
    reason = REASON_SHORT.get(tr["exit"], tr["exit"])
    R = float(tr["R"])
    return {
        "leg": tr["kind"],
        "side": "LONG" if side > 0 else "SHORT",
        "side_num": side,
        "entry": f(entry),
        "stop": f(stop),
        "target": f(target),
        "exit_px": f(exit_px) if reconciled else "n/a",
        "exit_reason": tr["exit"],
        "R": f(R, 3),
        "pts": f(tr["pts"]),
        "risk": f(tr["risk"]),
        "bars": int(tr["bars"]),
        "entry_t": hhmm(d.t[entry_idx]),
        "exit_t": hhmm(d.t[exit_idx]),
        "entry_x": x_map.get(int(d.t[entry_idx]), first_x),
        "exit_x": x_map.get(int(d.t[exit_idx]), last_x),
        "entry_label": f'{tr["kind"]} {"LONG" if side > 0 else "SHORT"} {entry:,.2f}',
        "exit_label": f"{reason} {R:+.2f}R",
        "reconciled": reconciled,
    }


HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Double VWAP — Trade Review</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
  :root {
    --bg:#000000; --panel:#13161C; --raised:#1F242D; --border:#2C313B;
    --text:#E5E7EB; --muted:#9CA3AF; --long:#16A34A; --short:#DC2626;
    --ny:#3B82F6; --on:#F0B90B;
  }
  * { box-sizing:border-box; }
  html, body { margin:0; padding:0; background:var(--bg); color:var(--text);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    font-size:13px; -webkit-font-smoothing:antialiased; }
  body { padding:16px; overflow-x:hidden; }
  h1 { font-size:17px; margin:0 0 2px; font-weight:650; letter-spacing:.2px; }
  .sub { color:var(--muted); font-size:11px; margin-bottom:12px; line-height:1.5; }
  .summary { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:10px;
    padding:10px 12px; min-width:132px; flex:1 1 150px; }
  .card .k { color:var(--muted); font-size:10px; text-transform:uppercase;
    letter-spacing:.7px; margin-bottom:5px; }
  .card .v { font-size:18px; font-weight:650; font-variant-numeric:tabular-nums; }
  .card .d { color:var(--muted); font-size:10px; margin-top:4px;
    font-variant-numeric:tabular-nums; line-height:1.5; }
  .pos { color:var(--long); } .neg { color:var(--short); }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:10px;
    padding:12px; margin-bottom:12px; }
  .toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
  .toolbar label { color:var(--muted); font-size:11px; }
  select, button { background:var(--raised); color:var(--text); border:1px solid var(--border);
    border-radius:6px; height:30px; padding:0 10px; font:inherit; font-size:12px; }
  button { cursor:pointer; min-width:30px; }
  button:hover { border-color:var(--muted); }
  select { min-width:132px; }
  .legend { display:flex; flex-wrap:wrap; gap:12px; margin-left:auto;
    color:var(--muted); font-size:10px; }
  .legend i { display:inline-block; width:16px; height:2px; vertical-align:middle;
    margin-right:5px; }
  .session-meta { color:var(--muted); font-size:11px; margin:0 0 8px;
    font-variant-numeric:tabular-nums; line-height:1.6; }
  .session-meta b { color:var(--text); font-weight:600; }
  .chart-scroll { overflow-x:auto; overflow-y:hidden; border-radius:6px; }
  #chart { width:100%; min-width:760px; height:520px; }
  .table-scroll { overflow-x:auto; }
  table { width:100%; min-width:820px; border-collapse:collapse;
    font-variant-numeric:tabular-nums; }
  th, td { padding:6px 10px; text-align:left; border-bottom:1px solid var(--border);
    white-space:nowrap; }
  th { color:var(--muted); font-size:10px; text-transform:uppercase;
    letter-spacing:.5px; background:var(--raised); position:sticky; top:0; }
  td { font-size:12px; }
  td.num, th.num { text-align:right; }
  tbody tr:hover { background:rgba(255,255,255,.03); }
  .pill { display:inline-block; padding:1px 6px; border-radius:4px; font-size:10px;
    border:1px solid var(--border); background:var(--raised); }
  .footer { color:var(--muted); font-size:11px; line-height:1.6;
    border-top:1px solid var(--border); padding-top:10px; }
  .footer code { color:#93C5FD; font-size:10px; }
  @media (max-width:640px) {
    body { padding:10px; } #chart { height:440px; }
    .legend { margin-left:0; width:100%; }
  }
</style>
</head>
<body>
  <h1>Double VWAP — Trade Review</h1>
  <div class="sub">NQ proxy (Dukascopy 1-min) · NY VWAP trigger + overnight VWAP magnet ·
    honest fills · spread cost 1.1 pts · all times America/New_York.</div>

  <div class="summary" id="summary">
<!--SUMMARY-->
  </div>

  <div class="panel">
    <div class="toolbar">
      <label for="session">Session</label>
      <button id="prev" title="Previous session" aria-label="Previous session">&#8249;</button>
      <select id="session" aria-label="Session with trades"></select>
      <button id="next" title="Next session" aria-label="Next session">&#8250;</button>
      <div class="legend">
        <span><i style="background:var(--ny)"></i>NY VWAP</span>
        <span><i style="background:var(--on)"></i>ON VWAP / range</span>
        <span><i style="background:var(--long)"></i>long / target</span>
        <span><i style="background:var(--short)"></i>short / stop</span>
      </div>
    </div>
    <div class="session-meta" id="session-meta"></div>
    <div class="chart-scroll"><div id="chart"></div></div>
  </div>

  <div class="panel">
    <div class="sub" style="margin-bottom:8px;color:var(--text);font-size:12px;">
      Trades on this session</div>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Leg</th><th>Side</th><th class="num">Entry</th><th class="num">Stop</th>
          <th class="num">Target</th><th class="num">Exit px</th><th>Exit</th>
          <th class="num">R</th><th class="num">Points</th><th class="num">Bars</th>
          <th>Entry t</th><th>Exit t</th>
        </tr></thead>
        <tbody id="trade-body"></tbody>
      </table>
    </div>
  </div>

  <div class="footer" id="footer">
<!--FOOTER-->
  </div>

<script type="application/json" id="trade-data">
/*__DATA__*/
</script>
<script>
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("trade-data").textContent);
  var chart = echarts.init(document.getElementById("chart"), null, { renderer: "canvas" });
  var sel = document.getElementById("session");
  var body = document.getElementById("trade-body");
  var meta = document.getElementById("session-meta");

  DATA.sessions.forEach(function (s, i) {
    var o = document.createElement("option");
    o.value = String(i);
    o.textContent = s.date + "  (" + s.trades.length + " trade" + (s.trades.length === 1 ? "" : "s") + ")";
    sel.appendChild(o);
  });

  function fmt(v, nd) {
    if (v === null || v === undefined || v === "n/a") return "n/a";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: nd || 2, maximumFractionDigits: nd || 2 });
  }
  function cell(cls, txt) { return '<td class="' + cls + '">' + txt + "</td>"; }

  function render() {
    var i = parseInt(sel.value || "0", 10);
    if (isNaN(i) || i < 0 || i >= DATA.sessions.length) i = 0;
    var s = DATA.sessions[i];
    var x = s.x;
    var lastX = x[x.length - 1];

    var series = [];
    series.push({
      name: "Candles", type: "candlestick", data: s.candles,
      itemStyle: { color: "#16A34A", color0: "#DC2626", borderColor: "#16A34A", borderColor0: "#DC2626" },
      markArea: { silent: true, itemStyle: { color: "rgba(59,130,246,0.10)" },
        data: [[ { xAxis: "09:30", name: "OR30 09:30–10:00",
                    label: { show: true, color: "#93C5FD", fontSize: 10, position: "insideTop" } },
                 { xAxis: "10:00" } ]] }
    });
    series.push({
      name: "NY VWAP", type: "line", data: s.ny, showSymbol: false, smooth: false,
      lineStyle: { color: "#3B82F6", width: 1.6 }, z: 4
    });
    series.push({
      name: "ON VWAP", type: "line",
      data: [[x[0], s.on_vwap], [lastX, s.on_vwap]], showSymbol: false, silent: true,
      lineStyle: { color: "#F0B90B", width: 1.6, type: "dashed" }, z: 4,
      markLine: { silent: true, symbol: "none",
        lineStyle: { color: "#F0B90B", type: "dotted", width: 1, opacity: 0.8 },
        label: { color: "#F0B90B", fontSize: 10, position: "insideEndTop" },
        data: [
          { yAxis: s.on.high, label: { formatter: "ON HIGH " + fmt(s.on.high) } },
          { yAxis: s.on.low,  label: { formatter: "ON LOW  " + fmt(s.on.low) } }
        ] }
    });

    (s.trades || []).forEach(function (t, n) {
      var c = t.side_num > 0 ? "#16A34A" : "#DC2626";
      series.push({
        name: "stop-" + n, type: "line",
        data: [[t.entry_x, t.stop], [t.exit_x, t.stop]], showSymbol: false, silent: true,
        lineStyle: { color: "#DC2626", width: 1.2, type: "dashed" }, z: 3
      });
      series.push({
        name: "target-" + n, type: "line",
        data: [[t.entry_x, t.target], [t.exit_x, t.target]], showSymbol: false, silent: true,
        lineStyle: { color: "#16A34A", width: 1.2, type: "dashed" }, z: 3
      });
      series.push({
        name: "entry-" + n, type: "scatter", symbol: "triangle", symbolSize: 13,
        data: [[t.entry_x, t.entry]],
        itemStyle: { color: c, borderColor: "#000", borderWidth: 0.5 },
        label: { show: true, formatter: t.entry_label, fontSize: 10, color: "#E5E7EB",
                  position: t.side_num > 0 ? "bottom" : "top", distance: 6 }, z: 7
      });
      series.push({
        name: "exit-" + n, type: "scatter", symbol: "circle", symbolSize: 10,
        data: [[t.exit_x, t.exit_px === "n/a" ? t.entry : t.exit_px]],
        itemStyle: { color: t.R > 0 ? "#16A34A" : "#DC2626", borderColor: "#E5E7EB", borderWidth: 0.8 },
        label: { show: true, formatter: t.exit_label, fontSize: 10, color: "#E5E7EB",
                  position: t.side_num > 0 ? "top" : "bottom", distance: 6 }, z: 7
      });
    });

    // keep every level in frame: OHLC, both VWAPs, ON high/low, OR30, stops and targets
    var ylo = Infinity, yhi = -Infinity;
    function acc(v) {
      if (typeof v === "number" && isFinite(v)) { if (v < ylo) ylo = v; if (v > yhi) yhi = v; }
    }
    s.candles.forEach(function (k) { acc(k[2]); acc(k[3]); });
    acc(s.on_vwap); acc(s.on.high); acc(s.on.low); acc(s.or30.high); acc(s.or30.low);
    (s.trades || []).forEach(function (t) {
      acc(t.entry); acc(t.stop); acc(t.target);
      if (typeof t.exit_px === "number") acc(t.exit_px);
    });
    var ypad = Math.max(2, (yhi - ylo) * 0.05);

    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 62, right: 78, top: 34, bottom: 46 },
      legend: { show: true, top: 4, left: 4, itemWidth: 14, itemHeight: 8,
        textStyle: { color: "#9CA3AF", fontSize: 10 },
        data: ["Candles", "NY VWAP", "ON VWAP"] },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" },
        backgroundColor: "#1F242D", borderColor: "#2C313B",
        textStyle: { color: "#E5E7EB", fontSize: 11 } },
      xAxis: { type: "category", data: x, boundaryGap: true,
        axisLine: { lineStyle: { color: "#2C313B" } },
        axisLabel: { color: "#9CA3AF", fontSize: 10, interval: Math.max(1, Math.floor(x.length / 12)) },
        splitLine: { show: false } },
      yAxis: { type: "value", scale: true, position: "left",
        min: ylo - ypad, max: yhi + ypad,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: "#9CA3AF", fontSize: 10,
          formatter: function (v) { return v.toLocaleString("en-US", { maximumFractionDigits: 0 }); } },
        splitLine: { lineStyle: { color: "#2C313B", type: "dashed", opacity: 0.6 } } },
      series: series
    }, true);

    meta.innerHTML =
      "<b>" + s.date + "</b> · " + s.trades.length + " trade(s) · " +
      "ON VWAP <b>" + fmt(s.on_vwap) + "</b> · " +
      "ON range <b>" + fmt(s.on.high) + " / " + fmt(s.on.low) + "</b> · " +
      "OR30 range <b>" + fmt(s.or30.high) + " / " + fmt(s.or30.low) + "</b> · " +
      "bars to <b>" + x[x.length - 1] + "</b> ET · " +
      "shaded band = OR30 window 09:30–10:00 ET";

    body.innerHTML = "";
    s.trades.forEach(function (t) {
      var tr = document.createElement("tr");
      var sideCls = t.side_num > 0 ? "pos" : "neg";
      var rCls = t.R > 0 ? "pos" : "neg";
      var reasonMap = { stop: "SL", stop_gap: "GAP", target: "TP", time: "EOD" };
      var reason = reasonMap[t.exit_reason] || t.exit_reason;
      tr.innerHTML =
        cell("", '<span class="pill">' + t.leg + "</span>") +
        cell(sideCls, t.side) +
        cell("num", fmt(t.entry)) +
        cell("num", fmt(t.stop)) +
        cell("num", fmt(t.target)) +
        cell("num", fmt(t.exit_px)) +
        cell("", reason) +
        cell("num " + rCls, (t.R > 0 ? "+" : "") + Number(t.R).toFixed(2) + "R") +
        cell("num", fmt(t.pts)) +
        cell("num", String(t.bars)) +
        cell("", t.entry_t) +
        cell("", t.exit_t);
      body.appendChild(tr);
    });
    if (!s.trades.length) {
      var td = document.createElement("td");
      td.colSpan = 12; td.textContent = "No trades on this session.";
      var row = document.createElement("tr"); row.appendChild(td); body.appendChild(row);
    }
    chart.resize();
  }

  sel.addEventListener("change", render);
  document.getElementById("prev").addEventListener("click", function () {
    sel.value = String(Math.max(0, parseInt(sel.value || "0", 10) - 1)); render();
  });
  document.getElementById("next").addEventListener("click", function () {
    sel.value = String(Math.min(DATA.sessions.length - 1, parseInt(sel.value || "0", 10) + 1)); render();
  });
  window.addEventListener("resize", function () { chart.resize(); });
  render();
})();
</script>
</body>
</html>
"""


def main():
    df = S.load()
    days = S.build_days(df)
    day_by_date = {d.date: d for d in days}
    n_sessions_total = len(days)

    # --- build trade records per config -----------------------------------
    records = {}
    stats = {}
    collected = {}
    for leg, cfg in CFG.items():
        prs = pairs_for(days, cfg)
        collected[leg] = [tr for _, tr in prs]
        stats[leg] = S.stats(collected[leg], n_sessions_total)
        assert len(prs) == len(S.collect(days, cfg, COST)), leg
        records[leg] = prs

    all_trades_flat = [tr for leg in CFG for tr in collected[leg]]
    sessions = sorted({t["date"] for t in all_trades_flat})

    # --- per-session chart payload ----------------------------------------
    payload_sessions = []
    n_na = 0
    for date_key in sessions:
        d = day_by_date[date_key]
        win = (d.t >= RTH_OPEN) & (d.t < RTH_CLOSE)
        wt, wo, wh, wl, wc = d.t[win], d.o[win], d.h[win], d.l[win], d.c[win]
        x = [hhmm(m) for m in wt]
        x_map = {int(m): lab for m, lab in zip(wt, x)}
        on_hi, on_lo, _ = d.rng["on"]
        o30_hi, o30_lo, _ = d.rng["or30"]
        recs = []
        for leg in ("A", "B"):
            for s, tr in records.get(leg, []):
                if s["day"].date != date_key:
                    continue
                rec = make_trade_record(s, tr, x_map, x[0], x[-1])
                recs.append(rec)
                if rec["exit_px"] == "n/a":
                    n_na += 1
        recs.sort(key=lambda r: (r["entry_x"], r["leg"]))
        ny = [f(v) for v in d.ny_vwap[win]]
        payload_sessions.append({
            "date": date_key.isoformat() if isinstance(date_key, _date) else str(date_key),
            "x": x,
            # ECharts candlestick expects [open, close, low, high]
            "candles": [[f(o), f(c), f(l), f(h)] for o, h, l, c in zip(wo, wh, wl, wc)],
            "ny": ny,
            "on_vwap": f(d.on_vwap),
            "on": {"high": f(on_hi), "low": f(on_lo)},
            "or30": {"high": f(o30_hi), "low": f(o30_lo)},
            "trades": recs,
        })

    summary = {
        "sessions_with_trades": len(sessions),
        "sessions_total": n_sessions_total,
        "total_trades": len(all_trades_flat),
        "cost_pts": COST,
        "configs": {
            leg: {
                "description": LEG_DESC[leg],
                "cfg": {k: (str(v) if not isinstance(v, (int, float, bool, type(None), str)) else v)
                        for k, v in CFG[leg].items()},
                "stats": stats[leg],
            }
            for leg in CFG
        },
    }
    payload = {"summary": summary, "sessions": payload_sessions}

    # --- summary cards ----------------------------------------------------
    a, b = stats["A"], stats["B"]
    cards = (
        f'      <div class="card"><div class="k">Sessions w/ trades</div>'
        f'<div class="v">{len(sessions)}</div><div class="d">of {n_sessions_total} in dataset</div></div>\n'
        f'      <div class="card"><div class="k">Total trades</div>'
        f'<div class="v">{len(all_trades_flat)}</div><div class="d">A {a["n"]} · B {b["n"]}</div></div>\n'
    )
    for leg, st in (("A", a), ("B", b)):
        cls = "pos" if st["avgR"] > 0 else "neg"
        cards += (
            f'      <div class="card"><div class="k">Config {leg} — {LEG_DESC[leg].split(" · ")[0]}</div>'
            f'<div class="v {cls}">{st["avgR"]:+.2f}R</div>'
            f'<div class="d">n {st["n"]} · win {st["win"]:.1f}% · PF {st["PF"]:.2f}</div></div>\n'
        )

    # --- footer -----------------------------------------------------------
    if n_na:
        footer = (
            "<b>Exit reconstruction:</b> " + str(n_na) +
            " trade(s) could not be reconciled exactly with the engine's bar fill and are shown as "
            "<code>n/a</code> in the chart and table. All other prices are the engine's own entries, "
            "stops, targets and computed exits."
        )
    else:
        footer = (
            "<b>Exit reconstruction:</b> exit price = entry + side × (net points + 1.1), which inverts the "
            "engine's <code>pts = (exit − entry) × side − cost</code>; this was cross-checked against the "
            "simulator's bar-by-bar fill for every trade (max discrepancy 0.0 points). "
            "No fills were invented; no trade required <code>n/a</code>."
        )
    truncated = sum(1 for s in payload_sessions if s["x"][-1] != "15:59")
    footer += (
        "<br><b>Chart notes:</b> the blue band marks the OR30 window (09:30–10:00 ET); the dotted amber "
        "lines are the overnight range high/low; the solid blue line is per-bar cumulative NY-session VWAP; "
        "the dashed amber line is the frozen overnight VWAP. Triangles are entries, circles are exits. "
        "Dashed red/green levels are the trade's stop/target, drawn from entry to exit bar. "
        "<b>Costs:</b> 1.1 points of full spread subtracted from every trade. "
        "<b>Feed gaps:</b> " + str(truncated) + " of " + str(len(payload_sessions)) +
        " trade sessions have a truncated intraday feed (last bar before 15:59 ET); the chart shows only "
        "the bars the engine has — no bars are fabricated to fill the session. "
        "<b>Configs:</b> A = " + LEG_DESC["A"] + "; B = " + LEG_DESC["B"] + "."
    )

    data_json = json.dumps(payload, separators=(",", ":"), indent=None, allow_nan=False)
    html = (HTML_TEMPLATE
            .replace("<!--SUMMARY-->", cards.rstrip())
            .replace("<!--FOOTER-->", footer)
            .replace("/*__DATA__*/", data_json))

    os.makedirs(OUTDIR, exist_ok=True)
    html_path = os.path.join(OUTDIR, "index.html")
    json_path = os.path.join(OUTDIR, "trades.json")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html)

    flat_out = []
    for rec_session in payload_sessions:
        for rec in rec_session["trades"]:
            flat_out.append({
                "date": rec_session["date"],
                "leg": rec["leg"],
                "side": rec["side"],
                "entry": rec["entry"],
                "stop": rec["stop"],
                "target": rec["target"],
                "exit_px": rec["exit_px"],
                "exit_reason": rec["exit_reason"],
                "R": rec["R"],
                "pts": rec["pts"],
                "risk": rec["risk"],
                "bars": rec["bars"],
                "entry_t": rec["entry_t"],
                "exit_t": rec["exit_t"],
            })
    flat_out.sort(key=lambda r: (r["date"], r["leg"], r["entry_t"]))
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump({"summary": summary, "trades": flat_out}, fh, indent=2, allow_nan=False)
        fh.write("\n")

    print(f"wrote {html_path} ({os.path.getsize(html_path):,} bytes)")
    print(f"wrote {json_path} ({os.path.getsize(json_path):,} bytes)")
    print(f"sessions with trades={len(sessions)} / total={n_sessions_total}, "
          f"trades={len(all_trades_flat)} (A={a['n']}, B={b['n']}), n/a exits={n_na}")
    for leg, st in (("A", a), ("B", b)):
        print(f"  {leg}: avgR={st['avgR']:+.4f} win={st['win']}% PF={st['PF']}")


if __name__ == "__main__":
    main()
