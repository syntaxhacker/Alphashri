/* Shared helpers + tiny SVG chart lib for Unusual Whales panels.
 * Every panel file may use window.UW.util.* — keep this API stable.
 *
 *   UW.util.table(cols, rows, rowFn)      -> <table> html
 *   UW.util.card(title, bodyHtml, span)   -> <div class="card c{span}"> html (span 1..4)
 *   UW.util.money(v)  num(v)  int(v)  pct(v)  esc(s)  signCls(v)  shortDate(s)  pill(txt, cls)
 *   UW.util.kpiBig(label, value, sub, cls) -> compact kpi html
 *   UW.util.line(values, opts)            -> sparkline svg (no axes)
 *   UW.util.multi(series, opts)           -> line chart svg; series=[{name,color,data:[num|{x,y}]}]
 *   UW.util.bars(items, opts)             -> vertical bars svg; items=[{label,value,color?}]
 *   UW.util.hbars(items, opts)            -> horizontal bars html; items=[{label,value,color?,right?}]
 *   UW.util.candles(rows, opts)           -> candlestick svg; rows=[{date,open,high,low,close}]
 *   UW.util.axisLine(series, opts)        -> line chart with time labels
 */
(function () {
  const U = (window.UW = window.UW || {});
  const util = (U.util = {});

  const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  const fmtC = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return Number(v).toFixed(2);
  };
  const nz = (v, d = 0) => (v == null || v === "" || isNaN(Number(v)) ? d : Number(v));

  util.esc = esc;
  util.money = (v) => (nz(v) < 0 ? "-$" : "$") + fmtC(Math.abs(nz(v)));
  util.num = (v, d = 2) => (v == null || isNaN(Number(v)) ? "–" : Number(v).toFixed(d));
  util.int = (v) => (v == null || isNaN(Number(v)) ? "–" : Math.round(Number(v)).toLocaleString());
  util.pct = (v, d = 1) => (v == null || isNaN(Number(v)) ? "–" : (Number(v) * 100).toFixed(d) + "%");
  util.rawpct = (v, d = 1) => (v == null || isNaN(Number(v)) ? "–" : Number(v).toFixed(d) + "%");
  util.signCls = (v) => (nz(v) > 0 ? "pos" : nz(v) < 0 ? "neg" : "muted");
  util.shortDate = (s) => (s ? String(s).slice(5, 10) : "");
  util.pill = (t, c) => `<span class="pill ${c || ""}">${esc(t)}</span>`;
  util.tk = (s) => (s ? `<a class="tk" data-tk="${esc(s)}">${esc(s)}</a>` : "");

  util.table = (cols, rows, rowFn) => {
    if (!rows || !rows.length) return '<div class="muted" style="padding:6px">no data</div>';
    return `<table><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${c.label}</th>`).join("")}</tr></thead><tbody>${rows.map(rowFn).join("")}</tbody></table>`;
  };

  util.card = (title, body, span) => {
    const hint = U.hintFor ? U.hintFor(title) : "";
    return `<div class="card${span && span > 1 ? " c" + span : ""}"><h2>${title}${
      hint ? '<span class="hint-i" title="Toggle all explanations with the Explain button (top-right)">i</span>' : ""
    }</h2>${hint ? `<div class="hint">${hint}</div>` : ""}<div class="body">${body}</div></div>`;
  };

  util.kpiBig = (label, value, sub, cls) =>
    `<div class="kpi"><div class="kpi-l">${label}</div><div class="kpi-v ${cls || ""}">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ""}</div>`;

  util.hbars = (items, opts = {}) => {
    if (!items || !items.length) return '<div class="muted" style="padding:6px">no data</div>';
    const max = Math.max(1, ...items.map((i) => Math.abs(nz(i.value))));
    return `<div class="hbars">${items
      .map((i) => {
        const w = Math.min(100, (Math.abs(nz(i.value)) / max) * 100).toFixed(1);
        const col = i.color || (opts.signed ? (nz(i.value) > 0 ? "var(--pos)" : "var(--neg)") : "var(--accent)");
        return `<div class="hbar"><span class="hb-l">${esc(i.label)}</span><span class="hb-t"><i style="width:${w}%;background:${col}"></i></span><span class="hb-v ${opts.signed ? util.signCls(i.value) : ""}">${i.right != null ? i.right : util.money(i.value)}</span></div>`;
      })
      .join("")}</div>`;
  };

  // --- interactive charts -------------------------------------------------
  // These keep the original signatures but emit a placeholder that charts.js
  // turns into an ECharts (line/bars) or lightweight-charts (candles) instance.
  const cx = (spec) =>
    window.UW && UW.charts ? UW.charts.register(spec) : '<div class="muted" style="padding:6px">charts unavailable</div>';

  util.line = (values, opts = {}) => {
    if (!values || !values.length) return "";
    return cx({
      kind: "line",
      height: opts.height || 110,
      x: opts.x,
      axis: !!opts.axis,
      levels: opts.levels,
      marks: opts.marks,
      series: [{ name: opts.name || "", color: opts.stroke || "#3b82f6", data: values, area: !!opts.fill }],
    });
  };

  util.multi = (series, opts = {}) => {
    const clean = (series || []).filter((s) => s && s.data && s.data.length);
    if (!clean.length) return '<div class="muted" style="padding:6px">no data</div>';
    return cx({
      kind: "line",
      height: opts.height || 150,
      x: opts.x,
      axis: !!opts.axis,
      levels: opts.levels,
      marks: opts.marks,
      series: clean.map((s) => ({
        name: s.name,
        color: s.color,
        area: !!s.area,
        data: s.data.map((d) => (typeof d === "number" ? d : d && d.y)),
      })),
    });
  };

  util.bars = (items, opts = {}) => {
    if (!items || !items.length) return '<div class="muted" style="padding:6px">no data</div>';
    const cols = items.map((i) => i.color);
    return cx({
      kind: "bars",
      height: opts.height || 150,
      horizontal: !!opts.horizontal,
      signed: !!opts.signed,
      axis: !!opts.axis,
      name: opts.name || "",
      categories: items.map((i, idx) => (i.label != null ? i.label : idx)),
      series: [
        {
          name: opts.name || "",
          color: opts.color || "#3b82f6",
          data: items.map((i) => nz(i.value)),
          itemColors: !opts.signed && cols.some(Boolean) ? cols : undefined,
        },
      ],
    });
  };

  util.candles = (rows, opts = {}) => {
    if (!rows || !rows.length) return '<div class="muted" style="padding:6px">no data</div>';
    return cx({
      kind: "candles",
      height: opts.height || 220,
      x: opts.x || rows.map((r) => r.start_time || r.time || r.date),
      ohlc: rows,
      levels: opts.levels,
      overlays: opts.overlays,
      markers: opts.markers,
      timeVisible: !!opts.timeVisible,
      tzShift: opts.tzShift || 0,
    });
  };

  util.axisLine = (series, opts = {}) => util.multi(series, opts);

  util.scatter = (series, opts = {}) => {
    const clean = (series || []).filter((s) => s && s.data && s.data.length);
    if (!clean.length) return '<div class="muted" style="padding:6px">no data</div>';
    return cx({
      kind: "scatter",
      height: opts.height || 240,
      xType: opts.xType || "time",
      yFmt: opts.yFmt,
      sizeMax: opts.sizeMax || 1,
      sizeCap: opts.sizeCap || 24,
      series: clean,
    });
  };
})();
