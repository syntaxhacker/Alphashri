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

  // ET time from an ISO/epoch value (many feeds are UTC; the app reads in ET)
  util.et = function (v, opts) {
    try {
      const d = typeof v === "number" ? new Date(v) : new Date(String(v));
      if (isNaN(d.getTime())) return String(v || "").slice(11, 19);
      return d.toLocaleTimeString(
        "en-US",
        Object.assign({ timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }, opts || {})
      );
    } catch (e) {
      return String(v || "").slice(11, 19);
    }
  };
  // one place for the two "is it a fraction or already a percent?" fields
  util.siPct = (v) => (v == null || isNaN(Number(v)) ? null : Number(v) > 1 ? Number(v) : Number(v) * 100);
  util.ivPct = (v) => (v == null || isNaN(Number(v)) ? null : Math.abs(Number(v)) <= 3 ? Number(v) * 100 : Number(v));

  // Align an underlying-price series (e.g. spot_exposures) to a list of ISO
  // times, forward-filling the last known price. Returns an array of numbers
  // (or nulls). rows: [{price, start_time|time}].
  util.priceSeries = function (times, rows) {
    const pts = (rows || [])
      .map((r) => ({ t: Date.parse(r.start_time || r.time || ""), p: Number(r.price) }))
      .filter((r) => isFinite(r.t) && isFinite(r.p) && r.p > 0)
      .sort((a, b) => a.t - b.t);
    return (times || []).map((iso) => {
      if (!pts.length) return null;
      const t = Date.parse(iso || "");
      if (!isFinite(t)) return null;
      let lo = 0;
      let hi = pts.length - 1;
      let best = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].t <= t) {
          best = pts[mid].p;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return best != null ? best : pts[0].p;
    });
  };

  // OCC option symbol -> parts / readable text, e.g. NVDA260928C00235000 -> "NVDA 235C 09-28"
  util.occParts = function (sym) {
    const s = String(sym == null ? "" : sym).trim();
    const m = s.match(/^([A-Z0-9.]*?)(\d{6})([CP])(\d{8})$/);
    if (!m) return null;
    const strikeNum = parseInt(m[4], 10) / 1000;
    return {
      raw: s,
      root: m[1],
      cp: m[3],
      strike: strikeNum % 1 === 0 ? String(strikeNum) : String(strikeNum),
      expiry: m[2].slice(2, 4) + "-" + m[2].slice(4, 6),
    };
  };
  util.occ = function (sym, opts) {
    const p = util.occParts(sym);
    if (!p) return sym == null ? "" : String(sym);
    const base = p.strike + p.cp + " " + p.expiry;
    return opts && opts.noRoot ? base : p.root + " " + base;
  };

  // Compact matrix heatmap: rows × cols, diverging green/red by |value|.
  //   util.matrix({rows, cols, get, fmt, height, corner, rowFmt, colFmt, max})
  // get(rowKey, colKey) -> number|null. Uses ALL rows/cols (scrolls, never truncates).
  util.matrix = function (opts) {
    opts = opts || {};
    const rows = opts.rows || [];
    const cols = opts.cols || [];
    const fmt = opts.fmt || ((v) => util.num(v, 0));
    const rowFmt = opts.rowFmt || ((v) => String(v));
    const colFmt = opts.colFmt || ((v) => String(v));
    const get = opts.get || (() => null);
    let max = opts.max;
    if (max == null) {
      max = 0;
      for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < cols.length; j++) {
          const v = get(rows[i], cols[j]);
          if (v != null && !isNaN(Number(v)) && Math.abs(Number(v)) > max) max = Math.abs(Number(v));
        }
      }
    }
    const cell = (v, r, c) => {
      if (v == null || v === "" || isNaN(Number(v))) return '<td class="hm-null">·</td>';
      const x = Number(v);
      const t = max ? Math.min(1, Math.abs(x) / max) : 0;
      const bg = x >= 0 ? `rgba(22,163,74,${(0.08 + t * 0.55).toFixed(2)})` : `rgba(220,38,38,${(0.08 + t * 0.55).toFixed(2)})`;
      return `<td style="background:${bg}" title="${esc(r)} · ${esc(c)} · ${esc(String(x))}">${esc(fmt(x))}</td>`;
    };
    const head = `<tr><th class="hm-corner">${esc(opts.corner || "")}</th>${cols.map((c) => `<th>${esc(colFmt(c))}</th>`).join("")}</tr>`;
    const body = rows
      .map((r) => `<tr><th class="hm-rh">${esc(rowFmt(r))}</th>${cols.map((c) => cell(get(r, c), r, c)).join("")}</tr>`)
      .join("");
    const h = opts.height || 420;
    if (!rows.length || !cols.length) return '<div class="muted" style="padding:6px">no data for this matrix — no rows or columns were returned.</div>';
    return `<div class="hm-wrap" style="max-height:${h}px"><table class="hm"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  };

  util.table = (cols, rows, rowFn) => {
    if (!rows || !rows.length) return '<div class="muted" style="padding:6px">no rows — nothing matched this panel or the current filter.</div>';
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
    if (!items || !items.length) return '<div class="muted" style="padding:6px">no values to chart for this section.</div>';
    const max = Math.max(1, ...items.map((i) => Math.abs(nz(i.value))));
    return `<div class="hbars">${items
      .map((i) => {
        const w = Math.min(100, (Math.abs(nz(i.value)) / max) * 100).toFixed(1);
        const col = i.color || (opts.signed ? (nz(i.value) > 0 ? "var(--pos)" : "var(--neg)") : "var(--accent)");
        return `<div class="hbar"><span class="hb-l">${esc(i.label)}</span><span class="hb-t"><i style="width:${w}%;background:${col}"></i></span><span class="hb-v ${opts.signed ? util.signCls(i.value) : ""}">${i.right != null ? i.right : util.money(i.value)}</span></div>`;
      })
      .join("")}</div>`;
  };

  // stacked horizontal bars for part-to-whole at each level.
  //   items=[{label, segs:[{v,color}], right, cls, title}]
  //   seg widths share one scale (|v| / max total), so bar length encodes the
  //   total and the split encodes composition.
  util.stackBars = (items, opts = {}) => {
    if (!items || !items.length) return '<div class="muted" style="padding:6px">no values to chart for this section.</div>';
    const totalOf = (i) => (i.segs || []).reduce((a, s) => a + Math.abs(nz(s.v)), 0);
    const max = Math.max(1, ...items.map(totalOf));
    const right = opts.right || ((i) => (i.right != null ? i.right : util.money(totalOf(i))));
    return `<div class="hbars">${items
      .map((i) => {
        const segs = (i.segs || [])
          .map(
            (s) =>
              `<i style="width:${Math.min(100, (Math.abs(nz(s.v)) / max) * 100).toFixed(2)}%;background:${
                s.color || "var(--accent)"
              }"></i>`
          )
          .join("");
        return `<div class="hbar${opts.wide ? " wide" : ""}${i.cls ? " " + i.cls : ""}"${i.title ? ` title="${esc(i.title)}"` : ""}>
          <span class="hb-l">${esc(i.label)}</span>
          <span class="hb-t stack">${segs}</span>
          <span class="hb-v">${right(i)}</span>
        </div>`;
      })
      .join("")}</div>`;
  };

  // --- interactive charts -------------------------------------------------
  // These keep the original signatures but emit a placeholder that charts.js
  // turns into an ECharts (line/bars) or lightweight-charts (candles) instance.
  const cx = (spec) =>
    window.UW && UW.charts ? UW.charts.register(spec) : '<div class="muted" style="padding:6px">charts unavailable</div>';

  util.line = (values, opts = {}) => {
    if (!values || !values.length) return '<div class="muted" style="padding:6px">no series data to chart here.</div>';
    const series = [{ name: opts.name || "", color: opts.stroke || "#3b82f6", data: values, area: !!opts.fill }];
    // optional second line(s) on a secondary y-axis, e.g. price next to premium
    (opts.secondary || []).forEach((s) => {
      if (!s || !s.data || !s.data.length) return;
      series.push({ name: s.name, color: s.color, area: !!s.area, axis: s.axis == null ? 1 : s.axis, data: s.data });
    });
    return cx({
      kind: "line",
      height: opts.height || 110,
      x: opts.x,
      axis: !!opts.axis,
      levels: opts.levels,
      marks: opts.marks,
      yFmt: opts.yFmt,
      series,
    });
  };

  util.multi = (series, opts = {}) => {
    const clean = (series || []).filter((s) => s && s.data && s.data.length);
    if (!clean.length) return '<div class="muted" style="padding:6px">no series data to chart here.</div>';
    return cx({
      kind: "line",
      height: opts.height || 150,
      x: opts.x,
      axis: !!opts.axis,
      levels: opts.levels,
      marks: opts.marks,
      yFmt: opts.yFmt,
      series: clean.map((s) => {
        const o = {
          name: s.name,
          color: s.color,
          area: !!s.area,
          data: s.data.map((d) => (typeof d === "number" ? d : d && d.y)),
        };
        if (s.axis != null) o.axis = s.axis; // 1 => draw against secondary axis
        return o;
      }),
    });
  };

  util.bars = (items, opts = {}) => {
    if (!items || !items.length) return '<div class="muted" style="padding:6px">no bars to chart for this section.</div>';
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
    if (!rows || !rows.length) return '<div class="muted" style="padding:6px">no candles for this session.</div>';
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
    if (!clean.length) return '<div class="muted" style="padding:6px">no points to plot for this section.</div>';
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
