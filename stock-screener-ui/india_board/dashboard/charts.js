/* Interactive chart engine for the Unusual Whales terminal.
 *
 * Panels never touch this directly: `_util.js` registers a spec here and emits a
 * placeholder <div class="cx" data-cx="id">. `symbol.js` / `app.js` call
 * UW.charts.mount(root) after their HTML is in the DOM.
 *
 *   kind 'line'    -> ECharts line/area (multi-series)
 *   kind 'bars'    -> ECharts bars (vertical/horizontal, signed, per-item colors)
 *   kind 'candles' -> TradingView Lightweight Charts candlesticks
 */
(function () {
  const U = (window.UW = window.UW || {});
  const POS = "#16a34a", NEG = "#dc2626";
  let seq = 0;
  const specs = {};
  let instances = [];

  function toTime(v) {
    if (v == null) return null;
    if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const t = Date.parse(s);
    return isNaN(t) ? null : Math.floor(t / 1000);
  }

  const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));

  const TOOLTIP = {
    trigger: "axis",
    backgroundColor: "rgba(12,18,26,.96)",
    borderColor: "#1c2734",
    borderWidth: 1,
    padding: [4, 7],
    textStyle: { color: "#e6edf3", fontSize: 10.5 },
    axisPointer: { type: "line", lineStyle: { color: "#3b82f6", width: 1 } },
  };

  function lineOption(spec) {
    const series = (spec.series || []).filter(Boolean);
    const x = spec.x && spec.x.length ? spec.x : series.length ? series[0].data.map((_, i) => i) : [];
    const showAxis = !!spec.axis;
    const levels = spec.levels || [];
    const marks = spec.marks || [];
    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: TOOLTIP,
      legend:
        series.length > 1
          ? {
              show: true,
              top: 0,
              left: 2,
              itemWidth: 8,
              itemHeight: 8,
              itemGap: 10,
              textStyle: { color: "#7f8b9c", fontSize: 9 },
              data: series.map((s) => s.name),
            }
          : { show: false },
      grid: { left: showAxis ? 6 : 2, right: showAxis ? 44 : 4, top: series.length > 1 ? 16 : 4, bottom: showAxis ? 16 : 2, containLabel: false },
      xAxis: {
        type: "category",
        data: x,
        show: showAxis,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#1c2734" } },
        axisLabel: { color: "#7f8b9c", fontSize: 9, interval: Math.max(0, Math.ceil(x.length / 8) - 1) },
      },
      yAxis: {
        type: "value",
        show: showAxis,
        scale: true,
        position: "right",
        splitLine: { show: false },
        axisLabel: { color: "#7f8b9c", fontSize: 9 },
      },
      series: series.map((s, si) => ({
        type: "line",
        name: s.name,
        data: s.data,
        showSymbol: false,
        smooth: false,
        sampling: "lttb",
        lineStyle: { width: 1.3, color: s.color || "#3b82f6" },
        itemStyle: { color: s.color || "#3b82f6" },
        areaStyle: s.area
          ? {
              color:
                window.echarts && window.echarts.graphic
                  ? new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                      { offset: 0, color: s.color || "#3b82f6" },
                      { offset: 1, color: "rgba(10,15,22,0)" },
                    ])
                  : { color: s.color || "#3b82f6" },
              opacity: 0.28,
            }
          : undefined,
        markLine:
          si === 0 && levels.length
            ? {
                silent: true,
                symbol: "none",
                animation: false,
                label: { position: "insideEndTop", color: "#9aa7b6", fontSize: 9, formatter: (p) => p.name },
                data: levels.map((l) => ({
                  yAxis: l.value,
                  name: l.label,
                  lineStyle: { color: l.color || "#64748b", type: "dashed", width: 1 },
                })),
              }
            : undefined,
        markPoint:
          si === 0 && marks.length
            ? {
                symbol: "pin",
                symbolSize: 20,
                animation: false,
                label: { color: "#0c121a", fontSize: 8, formatter: (p) => p.name },
                data: marks.map((m) => ({ coord: [m.x, m.value], name: m.label, itemStyle: { color: m.color || "#a855f7" } })),
              }
            : undefined,
      })),
    };
  }

  function barsOption(spec) {
    const series = spec.series || [];
    const cats = spec.categories || [];
    const horizontal = !!spec.horizontal;
    const showAxis = !!spec.axis;
    const mkColors = (s) => {
      if (s.itemColors && s.itemColors.length) {
        return s.data.map((v, i) => ({ value: v, itemStyle: { color: s.itemColors[i] || s.color || "#3b82f6" } }));
      }
      if (spec.signed) {
        return s.data.map((v) => ({ value: v, itemStyle: { color: Number(v) >= 0 ? POS : NEG } }));
      }
      return s.data;
    };
    const catAxis = {
      type: "category",
      data: cats,
      show: showAxis,
      axisLine: { lineStyle: { color: "#1c2734" } },
      axisTick: { show: false },
      axisLabel: { color: "#7f8b9c", fontSize: 9 },
    };
    const valAxis = {
      type: "value",
      show: showAxis,
      scale: !spec.signed,
      splitLine: { show: false },
      axisLabel: { color: "#7f8b9c", fontSize: 9 },
    };
    const maxCat = cats.reduce((m, c) => Math.max(m, String(c == null ? "" : c).length), 0);
    const leftPad = horizontal && showAxis ? Math.min(140, Math.max(34, maxCat * 5.8 + 10)) : showAxis ? 6 : 2;
    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: { ...TOOLTIP, axisPointer: { type: "shadow" } },
      legend:
        series.length > 1
          ? {
              show: true,
              top: 0,
              itemWidth: 8,
              itemHeight: 8,
              textStyle: { color: "#7f8b9c", fontSize: 9 },
              data: series.map((s) => s.name),
            }
          : { show: false },
      grid: { left: leftPad, right: showAxis ? 44 : 4, top: series.length > 1 ? 16 : 4, bottom: showAxis ? 16 : 2, containLabel: false },
      xAxis: horizontal ? valAxis : catAxis,
      yAxis: horizontal ? { ...catAxis, inverse: true } : valAxis,
      series: series.map((s) => ({
        type: "bar",
        name: s.name,
        data: mkColors(s),
        barMaxWidth: 14,
        itemStyle: { color: s.color || "#3b82f6" },
      })),
    };
  }

  function scatterOption(spec) {
    const series = spec.series || [];
    return {
      backgroundColor: "transparent",
      animation: false,
      useUTC: true,
      tooltip: { ...TOOLTIP, trigger: "item", formatter: (p) => (p.data && p.data.label) || "" },
      legend:
        series.length > 1
          ? { show: true, top: 0, itemWidth: 8, itemHeight: 8, itemGap: 10, textStyle: { color: "#7f8b9c", fontSize: 9 }, data: series.map((s) => s.name) }
          : { show: false },
      grid: { left: 6, right: 48, top: series.length > 1 ? 16 : 6, bottom: 16, containLabel: false },
      xAxis: {
        type: spec.xType || "time",
        show: true,
        axisLine: { lineStyle: { color: "#1c2734" } },
        axisLabel: { color: "#7f8b9c", fontSize: 9, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        show: true,
        position: "right",
        scale: true,
        splitLine: { show: false },
        axisLabel: { color: "#7f8b9c", fontSize: 9, formatter: spec.yFmt },
      },
      series: series.map((s) => ({
        type: "scatter",
        name: s.name,
        data: (s.data || []).map((p) => ({
          value: [p.x, p.y],
          label: p.label || "",
          size: p.size || 0,
          itemStyle: {
            color: p.color || s.color || "#3b82f6",
            opacity: p.op != null ? p.op : s.opacity != null ? s.opacity : 0.75,
            borderColor: p.whale ? "#ffffff" : "transparent",
            borderWidth: p.whale ? 1.5 : 0,
          },
        })),
        symbolSize: (val, params) => {
          const sz = (params && params.data && params.data.size) || 0;
          const max = spec.sizeMax || 1;
          const cap = spec.sizeCap || 24;
          return Math.max(4, Math.min(cap, 4 + (sz / max) * (cap - 4)));
        },
        itemStyle: { color: s.color || "#3b82f6" },
        emphasis: { itemStyle: { opacity: 1 } },
      })),
    };
  }

  function buildECharts(el, spec) {
    const chart = window.echarts.init(el, null, { renderer: "canvas" });
    chart.setOption(spec.kind === "bars" ? barsOption(spec) : spec.kind === "scatter" ? scatterOption(spec) : lineOption(spec));
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return {
      resize: () => chart.resize(),
      dispose: () => {
        ro.disconnect();
        chart.dispose();
      },
    };
  }

  function buildCandles(el, spec) {
    const LWC = window.LightweightCharts;
    const h = (spec.height || 200);
    const shift = spec.tzShift || 0; // seconds; shifts UTC -> local wall-clock display
    const tt = (v) => {
      const t = toTime(v);
      return typeof t === "number" ? t + shift : t;
    };
    const chart = LWC.createChart(el, {
      width: el.clientWidth || 300,
      height: h,
      layout: { background: { type: "solid", color: "transparent" }, textColor: "#7f8b9c", fontSize: 9, attributionLogo: false },
      grid: { vertLines: { color: "#131b25" }, horzLines: { color: "#131b25" } },
      rightPriceScale: { borderColor: "#1c2734" },
      timeScale: { borderColor: "#1c2734", timeVisible: !!spec.timeVisible, secondsVisible: false, rightOffset: 1 },
      crosshair: { mode: 0, vertLine: { color: "#3b82f6", labelBackgroundColor: "#3b82f6" }, horzLine: { color: "#3b82f6", labelBackgroundColor: "#3b82f6" } },
      handleScroll: true,
      handleScale: true,
    });
    const s = chart.addSeries(LWC.CandlestickSeries, {
      upColor: POS, downColor: NEG, borderVisible: false, wickUpColor: POS, wickDownColor: NEG,
    });
    const data = (spec.ohlc || [])
      .map((r, i) => {
        const t = tt((spec.x && spec.x[i]) || r.start_time || r.time || r.date);
        if (t == null) return null;
        return { time: t, open: +r.open, high: +r.high, low: +r.low, close: +r.close };
      })
      .filter(Boolean);
    s.setData(data);

    // horizontal level lines (open, prev close, gamma flip, walls, magnet)
    (spec.levels || []).forEach((l) => {
      if (l.value == null || isNaN(Number(l.value))) return;
      s.createPriceLine({
        price: +l.value,
        color: l.color || "#64748b",
        lineWidth: 1,
        lineStyle: LWC.LineStyle ? LWC.LineStyle.Dashed : 2,
        axisLabelVisible: true,
        title: l.title || l.label || "",
      });
    });

    // overlays (e.g. VWAP) as extra line series
    (spec.overlays || []).forEach((o) => {
      const os = chart.addSeries(LWC.LineSeries, {
        color: o.color || "#f59e0b",
        lineWidth: o.width || 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const od = (o.data || [])
        .map((v, i) => {
          const t = tt(spec.x && spec.x[i]);
          return t == null || v == null || isNaN(Number(v)) ? null : { time: t, value: +v };
        })
        .filter(Boolean);
      os.setData(od);
    });

    // flip markers (▲ below bar / ▼ above bar)
    if (spec.markers && spec.markers.length) {
      const mk = spec.markers
        .map((m) => ({
          time: tt(m.time),
          position: m.up ? "belowBar" : "aboveBar",
          color: m.color || "#a855f7",
          shape: m.up ? "arrowUp" : "arrowDown",
          text: m.text || "",
        }))
        .filter((m) => m.time != null);
      try {
        if (LWC.createSeriesMarkers) LWC.createSeriesMarkers(s, mk);
        else if (s.setMarkers) s.setMarkers(mk);
      } catch (e) {
        /* markers are best-effort */
      }
    }

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth || 300 }));
    ro.observe(el);
    return {
      resize: () => chart.applyOptions({ width: el.clientWidth || 300 }),
      dispose: () => {
        ro.disconnect();
        chart.remove();
      },
    };
  }

  U.charts = {
    register(spec) {
      const id = "cx" + ++seq;
      specs[id] = spec;
      return `<div class="cx" data-cx="${id}" style="height:${spec.height || 150}px"></div>`;
    },
    mount(root) {
      if (!root) return;
      this.disposeIn(root);
      root.querySelectorAll(".cx[data-cx]").forEach((el) => {
        const spec = specs[el.dataset.cx];
        if (!spec) return;
        if (!el.clientWidth || el.offsetParent === null) return; // hidden (e.g. fallback) or not laid out yet
        try {
          let inst;
          if (spec.kind === "candles" && window.LightweightCharts) inst = buildCandles(el, spec);
          else if (window.echarts) inst = buildECharts(el, spec);
          else {
            el.innerHTML = '<div class="muted" style="padding:6px">chart lib not loaded</div>';
            return;
          }
          instances.push({ el, ...inst });
        } catch (e) {
          el.innerHTML = `<div class="muted" style="padding:6px">chart error</div>`;
        }
      });
    },
    disposeIn(root) {
      instances = instances.filter((rec) => {
        if (root.contains(rec.el)) {
          try { rec.dispose(); } catch (e) { /* noop */ }
          return false;
        }
        return true;
      });
    },
    disposeAll() {
      instances.forEach((r) => { try { r.dispose(); } catch (e) { /* noop */ } });
      instances = [];
    },
    resizeAll() {
      instances.forEach((r) => { try { r.resize(); } catch (e) { /* noop */ } });
    },
  };

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => U.charts.resizeAll(), 150);
  });
})();
