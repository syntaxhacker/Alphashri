/* GEX Chart tab — BullFlow-style split view on ONE ECharts instance.
 *
 *   grid[0] (left)  : intraday 5m candlesticks + dealer-level GEX zones (markArea)
 *   grid[1] (right) : strike × expiry net-exposure heatmap
 *
 * The two grids share their vertical extent (same top/bottom) and the left
 * price axis is pinned to the SAME strike range as the heatmap's category
 * rows, so a strike sits at the same pixel height in both panes. See the note
 * on `PAD` for the half-band correction that makes the alignment exact.
 *
 * Data: symbol group "gexchart" (see symbol_data.py) →
 *   stock_state {close,...} · gex_levels {call_wall,put_wall,gamma_flip,...}
 *   max_pain [{expiry,max_pain,...}] · ohlc_5m [{start_time,open,high,low,close}]
 *   gex_matrix {spot,expiries[],strikes[] desc,cells:[{e,k,gex,delta,charm,vanna}]}
 *
 * Optional agent-B endpoint /api/gex/history?ticker= may supply prev_gex/chg_pct
 * (merged defensively — the endpoint may 404 while it is being built).
 *
 * Left pane source toggle (persisted in localStorage["uw_gexchart_src"]):
 *   "gex" (default) — the split ECharts candles + GEX bands + aligned heatmap above
 *   "tv"            — the free TradingView widget; the heatmap stays on the right
 *                     but CANNOT be price-aligned to the iframe (no scale API).
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc } = U.util;

  const POS = "#16a34a", NEG = "#dc2626";
  const METRICS = [
    { id: "gex", label: "Gamma", sym: "Γ" },
    { id: "vanna", label: "Vanna", sym: "V" },
    { id: "delta", label: "Delta", sym: "Δ" },
    { id: "charm", label: "Charm", sym: "C" },
  ];
  // human label for a metric id (tooltips read "Gamma", not the raw "gex")
  const metricLabel = (id) => ((METRICS.find((x) => x.id === id) || {}).label || String(id || ""));
  // strike window around spot/price: the server matrix can span thousands of
  // strikes (5..2500 for MU). Rendering all of them flattens the candles to a
  // line, so the chart shows the near-the-money ladder (a strike band).
  const WIN_PCT = 0.06; // ±6% of spot (extended to cover the candle range + levels)
  const LEVEL_PCT = 0.12; // include walls/flip only if within ±12% of spot
  const BAND_PCT = 0.0025; // ±0.25% zone half-width for a level
  const MIN_ROWS = 6;

  const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};

  // module-scoped live state (one chart at a time)
  const SRC_KEY = "uw_gexchart_src"; // persisted left-pane source: "gex" | "tv"
  const readSrc = () => { try { return localStorage.getItem(SRC_KEY) === "tv" ? "tv" : "gex"; } catch (e) { return "gex"; } };
  const saveSrc = (v) => { try { localStorage.setItem(SRC_KEY, v); } catch (e) { /* ignore */ } };

  let inst = null;    // GEX mode: the split (candles + heatmap) ECharts instance
  let hmInst = null;  // TradingView mode: the heatmap-only ECharts instance
  let ro = null;
  let tvHost = null;  // TradingView mode: the div the widget injects its iframe into
  let state = { metric: "gex", hidePct: false, src: readSrc() };
  let ctx = null; // {m, gx, mp, candles, win, chgMap, stock_state}

  // Load the free TradingView widget library once, on demand (mirrors overview.js).
  let _tvLoading = false;
  function ensureTV() {
    if (window.TradingView && window.TradingView.widget) return true;
    if (!_tvLoading) {
      _tvLoading = true;
      const s = document.createElement("script");
      s.src = "https://s3.tradingview.com/tv.js";
      s.async = true;
      s.onerror = () => { _tvLoading = false; };
      document.head.appendChild(s);
    }
    return false;
  }

  function disposeChart() { if (inst) { try { inst.dispose(); } catch (e) { /* noop */ } inst = null; } }
  function disposeHeat() { if (hmInst) { try { hmInst.dispose(); } catch (e) { /* noop */ } hmInst = null; } }
  // Tear the widget down by clearing its container — removes the iframe. A fresh
  // container is created the next time TradingView mode is entered.
  function disposeTV() {
    const hosts = tvHost ? [tvHost] : [].slice.call(document.querySelectorAll("#gc-tvchart"));
    hosts.forEach((h) => { try { h.innerHTML = ""; } catch (e) { /* noop */ } });
    tvHost = null;
  }
  function dispose() {
    if (ro) { try { ro.disconnect(); } catch (e) { /* noop */ } ro = null; }
    disposeChart();
    disposeHeat();
    disposeTV();
  }

  function fmtGex(v) {
    if (v == null || isNaN(Number(v))) return "·";
    v = Number(v);
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    if (a >= 1) return v.toFixed(0);
    if (a === 0) return "0";
    return v.toFixed(2);
  }

  // ---- data prep ---------------------------------------------------------

  // 5m bars → {t(ms), o, c, l, h}, sorted; UTC start_time → epoch
  function parseCandles(rows) {
    return arr(rows)
      .map((r) => {
        const t = Date.parse(r.start_time || r.time || r.date || "");
        const o = Number(r.open), h = Number(r.high), l = Number(r.low), c = Number(r.close);
        if (isNaN(t) || [o, h, l, c].some((x) => isNaN(x))) return null;
        return { t: t, o: o, c: c, l: l, h: h };
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
  }

  function levelsOf(gx, mp) {
    const out = [];
    const add = (key, label, v) => {
      const x = num(v);
      if (x != null) out.push({ key: key, label: label, value: x });
    };
    add("call_wall", "call wall", gx.call_wall);
    add("put_wall", "put wall", gx.put_wall);
    add("gamma_flip", "flip", gx.gamma_flip);
    add("gamma_magnet", "magnet", gx.gamma_magnet);
    add("max_pain", "max pain", first(mp).max_pain);
    return out;
  }

  // Choose the displayed strike ladder: near-the-money band that also covers
  // the candle range and any nearby dealer level, then keep only real strikes.
  // ECharts lays a category (heatmap) axis out in EQUAL bands while the price
  // axis is linear, so the ladder is reduced to a uniform step (the modal
  // spacing) — that makes each row's band centre coincide with its price.
  function pickStep(strikes) {
    const cnt = {};
    for (let i = 1; i < strikes.length; i++) {
      const d = +(strikes[i] - strikes[i - 1]).toFixed(4);
      if (d > 0) cnt[d] = (cnt[d] || 0) + 1;
    }
    let best = null, bc = -1;
    Object.keys(cnt).forEach((d) => { if (cnt[d] > bc) { bc = cnt[d]; best = Number(d); } });
    return best || 1;
  }

  // longest run of consecutive multiples of `step` (drops the off-grid strikes)
  function uniformize(strikes, step) {
    const base = strikes[0];
    const m = new Map();
    strikes.forEach((k) => { m.set(Math.round((k - base) / step), k); });
    const keys = [...m.keys()].sort((a, b) => a - b);
    let best = [], cur = [];
    keys.forEach((kk, i) => {
      if (i > 0 && kk === keys[i - 1] + 1) cur.push(kk); else cur = [kk];
      if (cur.length > best.length) best = cur.slice();
    });
    return best.map((kk) => m.get(kk));
  }

  function windowStrikes(m, candles, lvls) {
    const all = arr(m.strikes).map(Number).filter((x) => x > 0);
    if (!all.length) return { strikes: [], yMin: 0, yMax: 1 };
    const spot = num(m.spot);
    let pLo = Infinity, pHi = -Infinity;
    candles.forEach((c) => { pLo = Math.min(pLo, c.l); pHi = Math.max(pHi, c.h); });
    const hasPrice = isFinite(pLo) && isFinite(pHi);
    const center = spot != null ? spot : hasPrice ? (pLo + pHi) / 2 : all[Math.floor(all.length / 2)];
    let lo = center * (1 - WIN_PCT);
    let hi = center * (1 + WIN_PCT);
    if (hasPrice) { lo = Math.min(lo, pLo); hi = Math.max(hi, pHi); }
    const reach = center * (1 + LEVEL_PCT);
    const floor = center * (1 - LEVEL_PCT);
    lvls.forEach((l) => {
      if (l.value >= floor && l.value <= reach) { lo = Math.min(lo, l.value); hi = Math.max(hi, l.value); }
    });
    let strikes = all.filter((k) => k >= lo && k <= hi).sort((a, b) => a - b);
    if (strikes.length < MIN_ROWS) {
      // fall back to the nearest MIN_ROWS strikes to spot
      strikes = all.slice().sort((a, b) => Math.abs(a - center) - Math.abs(b - center)).slice(0, 24).sort((a, b) => a - b);
    }
    // reduce to a uniform ladder so category bands match the linear price axis
    const step = pickStep(strikes);
    const uni = uniformize(strikes, step);
    if (uni.length >= MIN_ROWS) strikes = uni;
    const s = pickStep(strikes); // recompute after reduction (keeps padding exact)
    const pad = (s || 1) / 2;
    return { strikes: strikes, step: s || 1, yMin: strikes[0] - pad, yMax: strikes[strikes.length - 1] + pad };
  }

  // defensive merge of /api/gex/history (shape unknown while agent B builds it)
  function extractChg(json, m) {
    const map = {};
    if (!json) return map;
    try {
      let root = json;
      if (root.data && !Array.isArray(root.data) && typeof root.data === "object") root = Object.assign({}, root, root.data);
      const cur = {};
      arr(m.cells).forEach((c) => { cur[String(c.e).slice(0, 10) + "|" + Number(c.k)] = c; });
      const set = (e, k, p) => {
        if (e == null || k == null || p == null || isNaN(Number(p))) return;
        map[String(e).slice(0, 10) + "|" + Number(k)] = Number(p);
      };
      const cells = Array.isArray(root.cells) ? root.cells
        : Array.isArray(root.history) ? root.history
          : Array.isArray(root.rows) ? root.rows
            : Array.isArray(root.data) ? root.data : [];
      cells.forEach((c) => {
        if (!c) return;
        const e = c.e || c.expiry || c.expires;
        const k = c.k != null ? c.k : c.strike;
        if (e == null || k == null) return;
        if (c.chg_pct != null) set(e, k, c.chg_pct);
        else if (c.change_pct != null) set(e, k, c.change_pct);
        else {
          const prev = c.prev_gex != null ? c.prev_gex : c.prev;
          const kk = String(e).slice(0, 10) + "|" + Number(k);
          const cg = c.gex != null ? c.gex : (cur[kk] || {}).gex;
          if (prev != null && cg != null && Math.abs(Number(prev)) > 0) set(e, k, ((Number(cg) - Number(prev)) / Math.abs(Number(prev))) * 100);
        }
      });
      const dict = root.chg_pct || root.chgPct;
      if (dict && typeof dict === "object" && !Array.isArray(dict)) {
        Object.keys(dict).forEach((key) => { if (key.indexOf("|") >= 0) { const p = key.split("|"); set(p[0], p[1], dict[key]); } });
      }
    } catch (e) { /* endpoint shape is best-effort */ }
    return map;
  }

  // ---- option builder ----------------------------------------------------

  function metricVal(c, metric) { return c ? num(c[metric]) : null; }

  function markerZones(lvls, m, yMin, yMax) {
    const zones = [];
    const inWin = (v) => v >= yMin && v <= yMax;
    const push = (v, color, label, op) => {
      if (v == null || !inWin(v)) return;
      zones.push({
        lo: v * (1 - BAND_PCT), hi: v * (1 + BAND_PCT),
        color: color, op: op == null ? 0.14 : op, label: label,
      });
    };
    lvls.forEach((l) => {
      if (l.key === "gamma_flip") push(l.value, "#f59e0b", "flip " + l.value.toFixed(2), 0.18);
      else if (l.key === "call_wall") push(l.value, "#dc2626", "call wall " + l.value.toFixed(2), 0.14);
      else if (l.key === "put_wall") push(l.value, "#16a34a", "put wall " + l.value.toFixed(2), 0.14);
      else if (l.key === "gamma_magnet") push(l.value, "#38bdf8", "magnet " + l.value.toFixed(2), 0.10);
      else if (l.key === "max_pain") push(l.value, "#64748b", "max pain " + l.value.toFixed(2), 0.10);
    });
    // top-3 |GEX| strikes across the whole matrix (Γ concentration)
    const byStrike = {};
    arr(m.cells).forEach((c) => { byStrike[Number(c.k)] = (byStrike[Number(c.k)] || 0) + Math.abs(num(c.gex) || 0); });
    Object.keys(byStrike)
      .map((k) => ({ k: Number(k), v: byStrike[k] }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .forEach((x) => push(x.k, "#a855f7", "Γ " + x.k.toFixed(2), 0.10));
    return zones;
  }

  // Shared heatmap computation for both the split (GEX) chart and the
  // heatmap-only (TradingView-mode) chart — one source of truth.
  function heatmapData(c) {
    const m = c.m;
    const strikesAsc = c.win.strikes;
    const expiries = arr(m.expiries).map((e) => String(e));
    const expLabels = expiries.map((e) => e.slice(5));
    const metric = state.metric;

    const idx = {};
    arr(m.cells).forEach((e2) => { idx[String(e2.e).slice(0, 10) + "|" + Number(e2.k)] = e2; });

    let maxAbs = 0;
    const hdata = [];
    expiries.forEach((e, j) => {
      strikesAsc.forEach((k, i) => {
        const cell = idx[String(e).slice(0, 10) + "|" + Number(k)];
        if (!cell) return;
        const v = metricVal(cell, metric);
        if (v == null) return;
        if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
        const pct = c.chgMap ? c.chgMap[String(e).slice(0, 10) + "|" + Number(k)] : null;
        hdata.push({ value: [j, i, v], chg: pct == null ? null : pct, e: String(e), k: Number(k) });
      });
    });
    maxAbs = maxAbs || 1;

    const hasPct = !!(c.chgMap && Object.keys(c.chgMap).length);
    const showPct = hasPct && !state.hidePct;
    const rows = strikesAsc.length;
    const fs = rows <= 25 ? 9 : rows <= 40 ? 8 : 7;
    const showLabels = rows <= 48;
    return { metric: metric, expiries: expiries, expLabels: expLabels, strikesAsc: strikesAsc, hdata: hdata, maxAbs: maxAbs, showPct: showPct, fs: fs, showLabels: showLabels };
  }

  function buildOption(c) {
    const m = c.m;
    const yMin = c.win.yMin, yMax = c.win.yMax;
    const H = heatmapData(c);
    const metric = H.metric, expiries = H.expiries, expLabels = H.expLabels;
    const strikesAsc = H.strikesAsc, hdata = H.hdata, maxAbs = H.maxAbs;
    const showPct = H.showPct, fs = H.fs, showLabels = H.showLabels;

    const candles = c.candles.map((x) => [x.t, x.o, x.c, x.l, x.h]);
    const zones = markerZones(levelsOf(c.gx, c.mp), m, yMin, yMax);

    const axisCommon = {
      axisLine: { lineStyle: { color: "#1c2734" } },
      axisTick: { show: false },
      axisLabel: { color: "#7f8b9c", fontSize: 9 },
      splitLine: { show: false },
    };

    return {
      backgroundColor: "transparent",
      animation: false,
      useUTC: false,
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(12,18,26,.96)",
        borderColor: "#1c2734",
        borderWidth: 1,
        padding: [4, 7],
        textStyle: { color: "#e6edf3", fontSize: 10.5 },
        axisPointer: {
          type: "cross",
          snap: true,
          lineStyle: { color: "#3b82f6", width: 1 },
          label: { show: true, backgroundColor: "#334155", color: "#e6edf3", fontSize: 9, precision: 2 },
        },
        formatter: (ps) => {
          const p = Array.isArray(ps) ? ps[0] : ps;
          if (!p) return "";
          const d = p.data;
          if (p.seriesType === "candlestick" && Array.isArray(d)) {
            return (
              `<b>${esc(U.util.et(d[0]))} ET</b><br/>` +
              `O ${(+d[1]).toFixed(2)} · H ${(+d[4]).toFixed(2)}<br/>` +
              `L ${(+d[3]).toFixed(2)} · C ${(+d[2]).toFixed(2)}`
            );
          }
          if (p.seriesType === "heatmap") {
            const v = d.value ? d.value[2] : d[2];
            const e = p.data && p.data.e ? p.data.e : expiries[p.value && p.value[0]];
            const k = p.data && p.data.k != null ? p.data.k : strikesAsc[p.value && p.value[1]];
            const chg = p.data && p.data.chg;
            return (
              `<b>${esc(e)}</b> · strike <b>${esc(String(k))}</b><br/>` +
              `${esc(metricLabel(metric))} ${esc(fmtGex(v))}` +
              (chg != null ? ` <span style="color:${chg >= 0 ? POS : NEG}">${chg >= 0 ? "+" : ""}${Number(chg).toFixed(1)}%</span>` : "")
            );
          }
          return p.seriesName || "";
        },
      },
      visualMap: {
        type: "continuous",
        seriesIndex: 1,
        min: -maxAbs,
        max: maxAbs,
        calculable: false,
        orient: "vertical",
        right: 2,
        top: "middle",
        itemWidth: 7,
        itemHeight: 64,
        text: ["+", "−"],
        textStyle: { color: "#7f8b9c", fontSize: 8 },
        inRange: { color: [NEG, "#5a1d1d", "#0d141d", "#14532d", POS] },
      },
      xAxis: [
        Object.assign({}, axisCommon, {
          type: "time",
          gridIndex: 0,
          boundaryGap: false,
          axisLabel: {
            color: "#7f8b9c", fontSize: 9, hideOverlap: true,
            formatter: (v) => U.util.et(v),
          },
          splitLine: { show: true, lineStyle: { color: "rgba(148,163,184,0.16)" } },
        }),
        Object.assign({}, axisCommon, {
          type: "category",
          gridIndex: 1,
          data: expLabels,
          boundaryGap: true,
          axisLabel: { color: "#7f8b9c", fontSize: 9, interval: 0, rotate: 0 },
          splitLine: { show: true, lineStyle: { color: "rgba(148,163,184,0.12)" } },
        }),
      ],
      yAxis: [
        Object.assign({}, axisCommon, {
          type: "value",
          gridIndex: 0,
          min: yMin,
          max: yMax,
          scale: false,
          position: "left",
          splitLine: { show: true, lineStyle: { color: "rgba(148,163,184,0.16)" } },
          axisLabel: { color: "#7f8b9c", fontSize: 9, formatter: (v) => Number(v).toFixed(0) },
        }),
        Object.assign({}, axisCommon, {
          type: "category",
          gridIndex: 1,
          data: strikesAsc,
          inverse: false, // ascending: smallest strike at the bottom, like price
          boundaryGap: true,
          show: true, // one strike label per row, next to the heatmap cells
          axisLabel: { color: "#8ba3bd", fontSize: 8, interval: 0, hideOverlap: true },
        }),
      ],
      series: [
        {
          type: "candlestick",
          name: "5m",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: candles,
          itemStyle: {
            color: POS, color0: NEG, borderColor: POS, borderColor0: NEG, borderWidth: 1,
          },
          markArea: {
            silent: true,
            itemStyle: { opacity: 1 },
            data: zones.map((z) => [
              {
                yAxis: z.lo,
                itemStyle: { color: z.color, opacity: z.op },
                label: { show: true, position: "insideTopLeft", formatter: z.label, color: z.color, fontSize: 9 },
              },
              { yAxis: z.hi },
            ]),
          },
        },
        {
          type: "heatmap",
          name: metric,
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: hdata,
          progressive: 0,
          label: {
            show: showLabels,
            fontSize: fs,
            color: "#dbe4ee",
            lineHeight: fs + 1,
            rich: {
              pp: { color: "#22c55e", fontSize: fs },
              pn: { color: "#f87171", fontSize: fs },
            },
            formatter: (p) => {
              const v = p.value ? p.value[2] : null;
              if (v == null) return "";
              if (!showPct || p.data.chg == null) return fmtGex(v);
              const ch = Number(p.data.chg);
              return fmtGex(v) + "\n{" + (ch >= 0 ? "pp" : "pn") + "|" + (ch >= 0 ? "+" : "") + ch.toFixed(1) + "%}";
            },
          },
          itemStyle: { borderColor: "#0a0e13", borderWidth: 0.4 },
          emphasis: { itemStyle: { borderColor: "#e6edf3", borderWidth: 1 } },
        },
      ],
    };
  }

  // Heatmap-only option used in TradingView mode: same strike ladder as the GEX
  // heatmap, full-height on the right, without the (now absent) left price axis.
  // Because the TV iframe exposes no price scale, rows are NOT price-aligned.
  function buildHeatOption(c) {
    const H = heatmapData(c);
    const metric = H.metric, expiries = H.expiries, expLabels = H.expLabels;
    const strikesAsc = H.strikesAsc, hdata = H.hdata, maxAbs = H.maxAbs;
    const showPct = H.showPct, fs = H.fs, showLabels = H.showLabels;

    const axisCommon = {
      axisLine: { lineStyle: { color: "#1c2734" } },
      axisTick: { show: false },
      axisLabel: { color: "#7f8b9c", fontSize: 9 },
      splitLine: { show: false },
    };

    return {
      backgroundColor: "transparent",
      animation: false,
      useUTC: false,
      grid: [{ left: 52, right: 34, top: 10, bottom: 26, containLabel: false }],
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: "rgba(12,18,26,.96)",
        borderColor: "#1c2734",
        borderWidth: 1,
        padding: [4, 7],
        textStyle: { color: "#e6edf3", fontSize: 10.5 },
        formatter: (p) => {
          if (!p || p.seriesType !== "heatmap") return "";
          const v = p.value ? p.value[2] : null;
          const e = p.data && p.data.e ? p.data.e : expiries[p.value && p.value[0]];
          const k = p.data && p.data.k != null ? p.data.k : strikesAsc[p.value && p.value[1]];
          const chg = p.data && p.data.chg;
          return (
            `<b>${esc(e)}</b> · strike <b>${esc(String(k))}</b><br/>` +
            `${esc(metricLabel(metric))} ${esc(fmtGex(v))}` +
            (chg != null ? ` <span style="color:${chg >= 0 ? POS : NEG}">${chg >= 0 ? "+" : ""}${Number(chg).toFixed(1)}%</span>` : "")
          );
        },
      },
      visualMap: {
        type: "continuous",
        min: -maxAbs,
        max: maxAbs,
        calculable: false,
        orient: "vertical",
        right: 2,
        top: "middle",
        itemWidth: 7,
        itemHeight: 64,
        text: ["+", "−"],
        textStyle: { color: "#7f8b9c", fontSize: 8 },
        inRange: { color: [NEG, "#5a1d1d", "#0d141d", "#14532d", POS] },
      },
      xAxis: [
        Object.assign({}, axisCommon, {
          type: "category", gridIndex: 0, data: expLabels, boundaryGap: true,
          axisLabel: { color: "#7f8b9c", fontSize: 9, interval: 0, rotate: 0 },
        }),
      ],
      yAxis: [
        Object.assign({}, axisCommon, {
          type: "category", gridIndex: 0, data: strikesAsc, inverse: false, boundaryGap: true,
          axisLabel: { color: "#7f8b9c", fontSize: 9, formatter: (v) => Number(v).toFixed(0) },
        }),
      ],
      series: [
        {
          type: "heatmap", name: metric, xAxisIndex: 0, yAxisIndex: 0, data: hdata, progressive: 0,
          label: {
            show: showLabels, fontSize: fs, color: "#dbe4ee", lineHeight: fs + 1,
            rich: { pp: { color: "#22c55e", fontSize: fs }, pn: { color: "#f87171", fontSize: fs } },
            formatter: (p) => {
              const v = p.value ? p.value[2] : null;
              if (v == null) return "";
              if (!showPct || p.data.chg == null) return fmtGex(v);
              const ch = Number(p.data.chg);
              return fmtGex(v) + "\n{" + (ch >= 0 ? "pp" : "pn") + "|" + (ch >= 0 ? "+" : "") + ch.toFixed(1) + "%}";
            },
          },
          itemStyle: { borderColor: "#0a0e13", borderWidth: 0.4 },
          emphasis: { itemStyle: { borderColor: "#e6edf3", borderWidth: 1 } },
        },
      ],
    };
  }

  // ---- html --------------------------------------------------------------

  const STYLE_ID = "gc-style";
  function ensureStyle() {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".card.gcard{max-height:none}" +
      ".card.gcard>.body{overflow:hidden;padding:0}" +
      "#gc-chart{width:100%}" +
      // TradingView mode: left widget + right (unanchored) heatmap
      ".gc-tvw{display:none;gap:6px;width:100%}" +
      ".gc-tvw.on{display:flex}" +
      ".gc-tv-l{flex:0 0 60%;min-width:0;min-height:0;display:flex;flex-direction:column}" +
      ".gc-tv-bar{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:2px 6px}" +
      ".gc-tv-l .tv-wrap{flex:1 1 auto;min-height:0}" +
      ".gc-tv-l .tv-chart{width:100%;height:100%}" +
      ".gc-tv-l .tv-fallback{overflow:auto}" +
      ".gc-tv-r{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column}" +
      "#gc-tvheat{flex:1 1 auto;min-height:0;width:100%}";
    (document.head || document.documentElement).appendChild(s);
  }

  // inner HTML of #gc-ctrl (kept separate so afterRender can re-render it in place)
  function controlsInner(hasPct) {
    const btn = (id, label, sym, on, attr) => `<button class="preset ${on ? "on" : ""}" data-${attr}="${id}">${label}${sym ? ` <span class="muted">${sym}</span>` : ""}</button>`;
    const srcBtn = (id, label) => `<button class="preset ${state.src === id ? "on" : ""}" data-gsrc="${id}" title="${id === "gex" ? "ECharts candles + GEX bands + strike-aligned heatmap" : "Free TradingView widget (heatmap cannot be price-aligned)"}">${label}</button>`;
    return (
      `<span class="muted" style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">source</span>` +
      srcBtn("gex", "GEX") + srcBtn("tv", "TradingView") +
      `<span class="muted" style="padding:0 2px 0 6px">·</span>` +
      `<span class="muted" style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">metric</span>` +
      METRICS.map((x) => btn(x.id, x.label, x.sym, x.id === state.metric, "gc-metric")).join("") +
      `<span class="muted" style="padding:0 2px">·</span>` +
      `<button class="preset ${state.hidePct ? "on" : ""}" data-gc-pct="1" ${hasPct ? "" : 'disabled title="history not available yet"'}>Hide % change</button>` +
      `<span class="muted" style="margin-left:auto;font-size:9.5px" id="gc-meta"></span>`
    );
  }

  function captionHtml(gx) {
    const t = gx && gx.time ? U.util.et(gx.time) : "";
    const d = (gx && gx.date) || "";
    const stamp = [d, t].filter(Boolean).join(" ") || "~06:45";
    return `<div class="wl-note" id="gc-cap">GEX as of ${esc(stamp)} ET · OI-based (daily); chart is live 5m.</div>`;
  }

  function metaHtml(c) {
    const spot = c.m && c.m.spot != null ? Number(c.m.spot).toFixed(2) : "–";
    return `spot ${spot} · ${c.win.strikes.length} strikes × ${arr(c.m.expiries).length} expiries`;
  }

  U.PANELS.gexchart = {
    title: "GEX Chart",
    render(d) {
      ensureStyle();
      const m = d && d.gex_matrix;
      const gx = first(d && d.gex_levels);
      const mp = arr(d && d.max_pain);
      const candles = parseCandles(d && d.ohlc_5m);
      if (!m || !arr(m.strikes).length || !candles.length) {
        const why = !candles.length ? "no 5m candles" : "no gex matrix";
        return (
          `<div class="card c4 gcard"><h2>GEX Chart</h2><div class="body">` +
          `<div class="muted" style="padding:10px">GEX Chart · ${esc(why)} for this session.</div></div></div>`
        );
      }
      const win = windowStrikes(m, candles, levelsOf(gx, mp));
      const st = first(d && d.stock_state);
      ctx = { m: m, gx: gx, mp: mp, candles: candles, win: win, chgMap: null, spot: num(m.spot), stock_state: st };
      // internal candle fallback, shown only if the free TradingView widget fails
      const fbRows = candles.map((x) => ({ start_time: new Date(x.t).toISOString(), open: x.o, high: x.h, low: x.l, close: x.c }));
      const fallback = U.util.candles ? U.util.candles(fbRows, { height: 420, timeVisible: true }) : "";
      const body =
        `<div class="presets" id="gc-ctrl" style="gap:4px;padding:4px 6px;align-items:center">${controlsInner(false)}</div>` +
        `<div id="gc-chart" style="height:100%;min-height:520px"></div>` +
        `<div id="gc-tv" class="gc-tvw">` +
          `<div class="gc-tv-l">` +
            `<div class="gc-tv-bar"><span class="muted" style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">TradingView</span>` +
              `<span class="tv-badge" title="The free TradingView feed can lag ~15 min; the GEX data elsewhere is real-time.">delayed</span></div>` +
            `<div class="tv-wrap" id="gc-tvwrap">` +
              `<div class="tv-chart" id="gc-tvchart"></div>` +
              `<div class="tv-fallback">${fallback}</div>` +
            `</div>` +
          `</div>` +
          `<div class="gc-tv-r">` +
            `<div class="gc-tv-bar"><span class="muted" style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">exposure heatmap</span>` +
              `<span class="muted" style="font-size:9px;margin-left:auto">heatmap not price-aligned in TradingView mode</span></div>` +
            `<div id="gc-tvheat"></div>` +
          `</div>` +
        `</div>` +
        captionHtml(gx);
      const hint = U.hintFor ? U.hintFor("GEX Chart") : "";
      const cardHtml =
        `<div class="card c4 gcard"><h2>GEX Chart` +
        (hint ? '<span class="hint-i" title="Toggle all explanations with the Explain button (top-right)">i</span>' : "") +
        `</h2>${hint ? `<div class="hint">${hint}</div>` : ""}<div class="body">${body}</div></div>`;
      return cardHtml;
    },
    afterRender(pane, ticker, payload) {
      const el = pane.querySelector("#gc-chart");
      const tvEl = pane.querySelector("#gc-tv");
      if (!el || !ctx) return;
      dispose();
      if (!window.echarts) {
        el.innerHTML = '<div class="muted" style="padding:8px">echarts not loaded</div>';
        return;
      }

      const tvSym = (payload && payload.tv) || ticker;
      const mkt = (ctx.stock_state && ctx.stock_state.market_time) || "";
      const interval = mkt === "regular" ? "5" : "D"; // intraday bars live, daily otherwise
      const metaEl = () => pane.querySelector("#gc-meta");

      // fill the pane vertically (min 520px, matching the markup)
      const size = () => {
        const avail = Math.max(520, (pane.clientHeight || 0) - 74);
        el.style.height = avail + "px";
        if (tvEl) tvEl.style.height = avail + "px";
        try { if (inst) inst.resize(); } catch (e) { /* noop */ }
        try { if (hmInst) hmInst.resize(); } catch (e) { /* noop */ }
      };

      const paintGex = () => {
        const meta = metaEl();
        if (meta) meta.innerHTML = metaHtml(ctx);
        if (inst) inst.setOption(buildOption(ctx), true);
        else {
          inst = window.echarts.init(el, null, { renderer: "canvas" });
          inst.setOption(buildOption(ctx));
        }
      };

      const paintHeat = () => {
        const heatEl = pane.querySelector("#gc-tvheat");
        if (!heatEl) return;
        if (hmInst) hmInst.setOption(buildHeatOption(ctx), true);
        else {
          hmInst = window.echarts.init(heatEl, null, { renderer: "canvas" });
          hmInst.setOption(buildHeatOption(ctx));
        }
      };

      const paintMetaTV = () => {
        const meta = metaEl();
        if (meta) meta.innerHTML = `TradingView · ${esc(tvSym)} · ${interval === "5" ? "5m" : "daily"}`;
      };

      // Create a FRESH host div for the widget each time TV mode is entered, so any
      // late iframe from a previous widget can never re-attach to the live DOM.
      const setupTV = () => {
        const wrap = pane.querySelector("#gc-tvwrap");
        if (!wrap) return;
        const old = pane.querySelector("#gc-tvchart");
        const host = document.createElement("div");
        host.id = "gc-tvchart";
        host.className = "tv-chart";
        if (old) old.replaceWith(host);
        else wrap.insertBefore(host, wrap.firstChild);
        tvHost = host;
        wrap.classList.remove("fallback");
        const showFallback = () => {
          if (!wrap) return;
          // defer so the app's own U.charts.mount(pane) pass (same tick) runs first
          // and doesn't dispose the instance we are about to mount
          setTimeout(() => {
            if (state.src !== "tv") return;
            wrap.classList.add("fallback");
            if (U.charts) { try { U.charts.mount(wrap); } catch (e) { /* noop */ } }
          }, 0);
        };
        let tries = 0;
        const start = () => {
          if (state.src !== "tv") return; // toggled back while the lib loaded
          if (ensureTV()) {
            try {
              new window.TradingView.widget({
                container_id: host.id,
                symbol: tvSym,
                interval: interval,
                timezone: "America/New_York",
                theme: "dark",
                style: "1",
                locale: "en",
                autosize: true,
                allow_symbol_change: false,
                hide_side_toolbar: false,
                withdateranges: true,
                details: false,
                save_image: false,
                enable_publishing: false,
              });
            } catch (e) { showFallback(); }
          } else if (tries++ < 25) {
            setTimeout(start, 200);
          } else {
            showFallback();
          }
        };
        start();
      };

      // paint() is the lightweight in-place repaint (metric / % change / history)
      const paint = () => {
        if (state.src === "tv") { paintMetaTV(); paintHeat(); }
        else paintGex();
      };

      const applyMode = () => {
        if (state.src === "tv") {
          disposeChart(); // drop the split ECharts instance before showing the widget
          el.style.display = "none";
          if (tvEl) tvEl.classList.add("on");
          size();
          setupTV();
          paintHeat();
          paintMetaTV();
        } else {
          disposeHeat();
          const wrap = pane.querySelector("#gc-tvwrap");
          if (wrap && U.charts) { try { U.charts.disposeIn(wrap); } catch (e) { /* noop */ } }
          disposeTV();
          if (tvEl) tvEl.classList.remove("on");
          el.style.display = "";
          size();
          paintGex();
        }
      };

      size();

      if (ro) { try { ro.disconnect(); } catch (e) { /* noop */ } }
      ro = new ResizeObserver(() => { try { size(); } catch (e) { /* noop */ } });
      ro.observe(el);
      if (tvEl) ro.observe(tvEl);

      const ctrl = pane.querySelector("#gc-ctrl");
      const wire = () => {
        if (!ctrl) return;
        ctrl.querySelectorAll("[data-gsrc]").forEach((b) => {
          b.onclick = () => setSrc(b.dataset.gsrc);
        });
        ctrl.querySelectorAll("[data-gc-metric]").forEach((b) => {
          b.onclick = () => { state.metric = b.dataset.gcMetric; paintControls(); paint(); };
        });
        const pct = ctrl.querySelector("[data-gc-pct]");
        if (pct) {
          pct.onclick = () => {
            if (pct.disabled) return;
            state.hidePct = !state.hidePct;
            paintControls();
            paint();
          };
        }
      };
      const paintControls = () => {
        if (!ctrl) return;
        const hasPct = !!(ctx.chgMap && Object.keys(ctx.chgMap).length);
        ctrl.innerHTML = controlsInner(hasPct);
        wire();
      };
      const setSrc = (s) => {
        s = s === "tv" ? "tv" : "gex";
        if (s === state.src) return;
        state.src = s;
        saveSrc(s);
        paintControls();
        applyMode();
        // let the masonry re-measure the card after the pane height may change
        setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch (e) { /* noop */ } }, 60);
      };
      paintControls();
      applyMode();

      // optional history (agent B) — endpoint may 404 while it is being built
      fetch(`/api/gex/history?ticker=${encodeURIComponent(ticker)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (!json) return;
          const map = extractChg(json, ctx.m);
          if (!Object.keys(map).length) return;
          ctx.chgMap = map;
          state.hidePct = false;
          paintControls();
          paint();
        })
        .catch(() => { /* history not available yet */ });
    },
    info: {
      title: "GEX Chart",
      tagline: "Intraday candles with dealer GEX zones, beside a strike × expiry exposure heatmap",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>A single ECharts canvas split into two panes that share a vertical price axis. On the <b>left</b>, 5-minute intraday candlesticks with shaded dealer-exposure zones: the <b>gamma flip</b> (±0.25%, amber), the <b>call wall</b> (red), the <b>put wall</b> (green), plus the <b>top-3 |GEX| strikes</b> across the matrix (violet). On the <b>right</b>, a <b>strike × expiry heatmap</b> of net dealer exposure. A given strike sits at the same pixel height in both panes, so the heatmap rows read directly against the candles.</p>`,
        },
        {
          h: "Controls",
          p: `<p>The <b>metric</b> buttons re-map the heatmap between <b>Gamma</b> (Γ, net GEX), <b>Vanna</b> (V), <b>Delta</b> (Δ) and <b>Charm</b> (C). <b>Hide % change</b> toggles the day-over-day percentage shown under each cell value; it is disabled (with a "history not available yet" note) until the optional <code>/api/gex/history</code> feed is available.</p>`,
        },
        {
          h: "Chart source (GEX vs TradingView)",
          p: `<p>The <b>source</b> toggle switches the left pane between <b>GEX</b> — the ECharts candles + dealer GEX zones with the strike-aligned heatmap — and <b>TradingView</b>, the free TradingView widget (pan/zoom, change interval, add drawings). The embed is the free <b>TradingView widget</b>: it exposes no overlay or price-scale API, so in TradingView mode there are <b>no GEX bands</b> and the heatmap rows <b>cannot be price-aligned</b> to the widget — the muted note under the heatmap flags this. Full TradingView-with-overlays requires the paid <b>TradingView Charting Library</b>. The free feed also lags ~15 min (the <code>delayed</code> badge).</p>`,
        },
        {
          h: "How to read it",
          p: `<p><span class="pos">Green</span> cells are positive dealer exposure, <span class="neg">red</span> negative, intensity ∝ magnitude (same diverging scale across the visible window). Hovering shows a <b>crosshair</b> with the time and price at the cursor. Each heatmap row carries its own <b>strike label</b> on the left edge of the matrix, so a row can be read without tracing back to the price axis. Watch for a <b>vertical wall</b> — one strike hot across several expiries — and for price reacting at the flip or a wall. Positive gamma (typically above the flip) dampens moves and pins toward the walls; negative gamma amplifies them.</p>`,
        },
        {
          h: "Alignment technique",
          p: `<p>The two grids use identical <code>top</code>/<code>bottom</code>, and the left price axis is pinned to the displayed strike range. Because ECharts lays a category (heatmap) axis out in equal-height bands while the price axis is linear, the price extent is padded by <b>half the median strike spacing</b> at each end — that makes each strike's category band centre coincide exactly with its value on the price axis.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Dealer-exposure data is OI-based and refreshes ~once per day (the caption shows the as-of stamp); the candles are live 5m.</li><li>Only the near-the-money strike ladder is drawn (about ±6% of spot, extended to cover the candle range and nearby levels) — the server matrix can span thousands of strikes, which would flatten the candles.</li><li>Dealer-exposure signs are provider-defined; treat it as positioning, not a forecast.</li></ul>`,
        },
      ],
    },
  };
})();
