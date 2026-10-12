/* Dark Pool tab — dark prints, dark price levels, price × time, vs regular volume. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, pct, table, card, kpiBig, hbars, matrix, stackBars } = U.util;

  const err = (v) => (v && v.__error ? v : null);
  const arr = (v) => (!err(v) && Array.isArray(v) ? v : []);
  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const time = (s) => (s ? String(s).slice(11, 19) : "–");
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const nums = (rows, key) => rows.map((r) => n(r[key])).filter((x) => x != null);

  function printStats(rows) {
    const prem = nums(rows, "premium");
    const sizes = nums(rows, "size");
    const maxRow = rows.slice().sort((a, b) => (n(b.premium) || 0) - (n(a.premium) || 0))[0] || {};
    return {
      count: rows.length,
      total: sum(prem),
      max: prem.length ? Math.max.apply(null, prem) : null,
      maxRow: maxRow,
      canceled: rows.filter((r) => r.canceled === true || r.canceled === "true").length,
      avg: prem.length ? sum(prem) / prem.length : null,
      avgSize: sizes.length ? sum(sizes) / sizes.length : null,
    };
  }

  function topPrints(rows) {
    return rows.slice().sort((a, b) => (n(b.premium) || 0) - (n(a.premium) || 0)).slice(0, 30);
  }

  function priceLevels(rows) {
    const m = {};
    rows.forEach((r) => {
      const p = Math.round(Number(r.price));
      const v = n(r.premium);
      if (!isFinite(p) || v == null) return;
      m[p] = (m[p] || 0) + v;
    });
    return Object.keys(m)
      .map((p) => ({ label: "$" + p, value: m[p] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
  }

  // single-letter venue codes (leave unknown codes raw)
  const VENUE = { Q: "Nasdaq", N: "NYSE", P: "NYSE Arca", Z: "Cboe BZX", Y: "Cboe BYX", X: "Nasdaq PSX", V: "IEX" };
  const venueTitle = (c) => (VENUE[c] ? `${VENUE[c]} (${c})` : c ? `venue code ${c}` : "venue not reported");

  function printsTable(rows) {
    const maxPrem = Math.max(0, ...rows.map((r) => Math.abs(n(r.premium) || 0)));
    const maxSize = Math.max(0, ...rows.map((r) => Math.abs(n(r.size) || 0)));
    return table(
      [
        { label: "Price", num: true },
        { label: "Size", num: true },
        { label: "Premium", num: true },
        { label: "Time" },
        { label: "Quote b/a", num: true },
        { label: "Venue" },
      ],
      rows,
      (r) => `<tr>
        <td class="num">${num(r.price, 2)}</td>
        <td class="num" style="background:${U.heat(n(r.size) || 0, maxSize)}">${int(r.size)}</td>
        <td class="num" style="background:${U.heat(n(r.premium) || 0, maxPrem)}">${money(r.premium)}</td>
        <td class="muted">${esc(time(r.executed_at))}</td>
        <td class="num muted" title="National best bid / best ask at the moment of the print — compare with Price: at/inside = calm cross, outside = aggressive">${num(r.nbbo_bid, 2)}/${num(r.nbbo_ask, 2)}</td>
        <td class="muted" title="${esc(venueTitle(r.market_center))}">${esc(r.market_center || "–")}</td>
      </tr>`
    );
  }

  // ---- price × time heatmap (dark prints, full data) ----
  const DP_METRICS = [
    { id: "premium", label: "Premium" },
    { id: "size", label: "Size" },
  ];
  let dpHeatMetric = "premium"; // module-level so the choice sticks across tabs

  const ET_FMT = (function () {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) {
      return null;
    }
  })();

  // ISO UTC timestamp -> minutes since ET midnight (falls back to UTC).
  function etMinutes(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!isFinite(t)) return null;
    const dt = new Date(t);
    let h;
    let m;
    if (ET_FMT) {
      const parts = ET_FMT.formatToParts(dt);
      h = Number((parts.find((p) => p.type === "hour") || {}).value);
      m = Number((parts.find((p) => p.type === "minute") || {}).value);
    } else {
      h = dt.getUTCHours();
      m = dt.getUTCMinutes();
    }
    if (!isFinite(h) || !isFinite(m)) return null;
    if (h === 24) h = 0; // some locales emit 24 for midnight
    return h * 60 + m;
  }

  const hmLabel = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");

  // Aggregate every print into adaptive price buckets (rows, desc) × 10-min ET buckets (cols).
  function heatData(rows) {
    const prints = [];
    const ps = [];
    rows.forEach((r) => {
      const price = Number(r.price);
      const min = etMinutes(r.executed_at);
      if (!isFinite(price) || min == null) return;
      ps.push(price);
      prints.push({ price: price, min: min, premium: n(r.premium) || 0, size: n(r.size) || 0 });
    });
    if (!prints.length) return null;

    ps.sort((a, b) => a - b);
    const spot = ps[Math.floor(ps.length / 2)] || Math.max.apply(null, ps); // median price as spot proxy
    const step = Math.max(0.5, spot * 0.002); // adaptive bucket size

    const bmap = {}; // bucketLow(4dp) -> bucketLow number
    const tset = {};
    const cells = {};
    prints.forEach((p) => {
      const b = Math.floor(p.price / step) * step;
      const t = Math.floor(p.min / 10) * 10;
      bmap[b.toFixed(4)] = b;
      tset[t] = true;
      const c = cells[b.toFixed(4) + "|" + t] || (cells[b.toFixed(4) + "|" + t] = { premium: 0, size: 0 });
      c.premium += p.premium;
      c.size += p.size;
    });

    return {
      rowKeys: Object.keys(bmap).sort((a, b) => bmap[b] - bmap[a]), // descending price
      colKeys: Object.keys(tset).map(Number).sort((a, b) => a - b),
      cells: cells,
      step: step,
      spot: spot,
      prints: prints.length,
    };
  }

  function heatMatrix(h) {
    return matrix({
      rows: h.rowKeys,
      cols: h.colKeys,
      get: (r, c) => {
        const x = h.cells[r + "|" + c];
        return x ? x[dpHeatMetric] : null;
      },
      fmt: dpHeatMetric === "premium" ? (v) => money(v) : (v) => int(v),
      height: 380,
      corner: "price",
      rowFmt: (r) => "$" + Number(r).toFixed(2),
      colFmt: (c) => hmLabel(Number(c)),
    });
  }

  function heatControls(h) {
    return `<div class="presets">${DP_METRICS.map(
      (x) => `<button class="preset ${x.id === dpHeatMetric ? "on" : ""}" data-dphm="${x.id}">${x.label}</button>`
    ).join("")}<span class="muted" style="padding:0 6px">$${h.step.toFixed(2)}-step · ${h.rowKeys.length} prices × ${h.colKeys.length} ×10m · ${int(h.prints)} prints · spot ~$${num(h.spot, 2)}</span></div>`;
  }

  function heatCard(rows) {
    const h = heatData(rows);
    if (!h) return card("Dark Pool · price × time", '<div class="muted" style="padding:6px">no dark-pool data for this section — nothing was returned for this symbol.</div>', 2);
    return card(
      "Dark Pool · price × time",
      `<div id="dp-hm-ctrl">${heatControls(h)}</div>` +
        `<div id="dp-hm-wrap">${heatMatrix(h)}</div>` +
        '<div class="wl-note">Sum of the selected metric per adaptive price bucket (rows, descending) × 10-minute ET bucket (cols). <span class="pos">green</span>/<span class="neg">red</span> intensity ∝ value; <span class="muted">·</span> = no prints. Every print is included.</div>',
      2
    );
  }

  // ---- dark pool vs regular volume, stacked composition by price ----
  const DP_DARK = "#8b5cf6"; // off-exchange (dark / hidden)
  const DP_REG = "#64748b"; // lit / regular tape
  let dpVpSort = "total"; // "total" | "share"

  const compact = (v) => {
    const x = Number(v) || 0;
    const a = Math.abs(x);
    if (a >= 1e9) return (x / 1e9).toFixed(1) + "B";
    if (a >= 1e6) return (x / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (x / 1e3).toFixed(0) + "K";
    return String(Math.round(x));
  };

  function vpRows(lv) {
    return lv
      .map((r) => {
        const price = Number(r.price);
        const dp = n(r.dark_pool_volume) || 0;
        const reg = n(r.regular_volume) || 0;
        const total = dp + reg;
        return { price: price, dp: dp, reg: reg, total: total, share: total > 0 ? dp / total : 0 };
      })
      .filter((r) => isFinite(r.price) && r.total > 0);
  }

  function vpSorted(rows) {
    const s = rows.slice();
    if (dpVpSort === "share") {
      const maxTotal = Math.max(1, ...s.map((r) => r.total));
      let pool = s.filter((r) => r.total >= maxTotal * 0.02); // drop trivial levels so % isn't noise
      if (!pool.length) pool = s;
      pool.sort((a, b) => b.share - a.share || b.total - a.total);
      return pool.slice(0, 16);
    }
    s.sort((a, b) => b.total - a.total);
    return s.slice(0, 16);
  }

  function vpItems(rows) {
    return rows.map((r) => {
      const hot = r.share >= 0.5;
      return {
        label: "$" + num(r.price, 2),
        cls: hot ? "hl" : "",
        title: `$${num(r.price, 2)} — dark ${int(r.dp)} (${pct(r.share)}) · regular ${int(r.reg)} · total ${int(r.total)}`,
        segs: [
          { v: r.dp, color: DP_DARK },
          { v: r.reg, color: DP_REG },
        ],
        right: `<b style="color:${hot ? DP_DARK : "var(--muted)"}">${pct(r.share)}</b> <span class="muted">${compact(r.total)}</span>`,
      };
    });
  }

  function vpCaption() {
    return dpVpSort === "share"
      ? "Sorted by <b>off-exchange share</b> — the levels where hidden (dark) liquidity dominates the tape."
      : "Sorted by <b>total volume</b> traded at each price — the busiest shelves first.";
  }

  function vpControls() {
    return (
      '<div class="presets" style="padding:3px 8px 0"><span class="muted" style="padding:0 4px 0 0">Sort by</span>' +
      [
        { id: "total", label: "Volume", title: "Order price levels by total shares traded (dark + regular)" },
        { id: "share", label: "Dark %", title: "Order price levels by off-exchange share; levels under ~2% of the largest are ignored" },
      ]
        .map((x) => `<button class="preset ${x.id === dpVpSort ? "on" : ""}" data-dpvp="${x.id}" title="${esc(x.title)}">${x.label}</button>`)
        .join("") +
      '<span class="muted" style="padding:0 6px">top 16 levels</span></div>' +
      `<div class="dp-cap">${vpCaption()}</div>`
    );
  }

  const VP_LEGEND =
    '<div class="dp-legend">' +
    `<span><i class="dp-sw" style="background:${DP_DARK}"></i> dark pool</span>` +
    `<span><i class="dp-sw" style="background:${DP_REG}"></i> regular</span>` +
    '<span style="margin-left:auto">bar = total volume · % = dark share · <b>violet %</b> = dark dominates</span>' +
    "</div>";

  function vpBody(lv) {
    const rows = vpSorted(vpRows(lv));
    if (!rows.length) return '<div class="muted" style="padding:6px">no dark/regular volume by price — nothing was returned for this symbol.</div>';
    return (
      `<div id="dp-vp-ctrl">${vpControls()}</div>` +
      `<div id="dp-vp-body">${stackBars(vpItems(rows), { wide: true })}</div>` +
      VP_LEGEND +
      '<div class="wl-note">Each bar is total volume traded at that price, split into <b>off-exchange (dark)</b> and <b>lit (regular)</b>. Rows are shaded where dark pool is the majority — the levels where size crosses without moving the tape.</div>'
    );
  }

  U.PANELS.darkpool = {
    title: "Dark Pool",
    render(d) {
      d = d || {};
      const dk = arr(d.darkpool).filter(Boolean);
      const lv = arr(d.darkpool_levels).filter(Boolean);

      const dks = printStats(dk);

      const dkKpis = `<div class="kpis">
        ${kpiBig("Prints", int(dks.count))}
        ${kpiBig("Total premium", money(dks.total))}
        ${kpiBig("Largest", money(dks.max), esc(dks.maxRow.ticker || "") + " · " + int(dks.maxRow.size) + " sh")}
        ${kpiBig("Avg print", money(dks.avg), int(dks.avgSize) + " sh avg")}
        ${kpiBig("Canceled", int(dks.canceled), dks.count ? pct(dks.canceled / dks.count) : "")}
      </div>`;

      const lvlItems = priceLevels(dk);
      const lvlCard = lvlItems.length
        ? hbars(lvlItems) + `<div class="muted" style="padding:0 6px 4px">premium aggregated by rounded price · top ${lvlItems.length}</div>`
        : '<div class="muted" style="padding:6px">no dark-pool data for this section — nothing was returned for this symbol.</div>';

      return (
        card("Dark Pool · flow", dkKpis, 2) +
        card("Largest Dark Pool Prints · " + int(dks.count) + " prints", printsTable(topPrints(dk)), 2) +
        card("Dark Pool Premium by Price", lvlCard, 2) +
        card("Dark Pool vs Regular Volume by Price", vpBody(lv), 2) +
        heatCard(dk)
      );
    },
    afterRender(pane, ticker, payload) {
      const d = (payload && payload.data) || {};
      const rows = arr(d.darkpool).filter(Boolean);
      const lv = arr(d.darkpool_levels).filter(Boolean);

      const wrap = pane.querySelector("#dp-hm-wrap");
      const ctrl = pane.querySelector("#dp-hm-ctrl");
      if (wrap && ctrl && rows.length) {
        const paint = () => {
          const h = heatData(rows);
          if (!h) return;
          wrap.innerHTML = heatMatrix(h);
          ctrl.innerHTML = heatControls(h);
          ctrl.querySelectorAll("[data-dphm]").forEach((b) => {
            b.onclick = () => {
              dpHeatMetric = b.dataset.dphm;
              paint();
            };
          });
        };
        paint();
      }

      const vpBodyEl = pane.querySelector("#dp-vp-body");
      const vpCtrlEl = pane.querySelector("#dp-vp-ctrl");
      if (vpBodyEl && vpCtrlEl && lv.length) {
        const paintVp = () => {
          vpBodyEl.innerHTML = stackBars(vpItems(vpSorted(vpRows(lv))), { wide: true });
          vpCtrlEl.innerHTML = vpControls();
          vpCtrlEl.querySelectorAll("[data-dpvp]").forEach((b) => {
            b.onclick = () => {
              dpVpSort = b.dataset.dpvp;
              paintVp();
            };
          });
        };
        paintVp();
      }
    },
    info: {
      title: "Dark Pool",
      tagline: "Institutional footprints — off-exchange prints mapped to the price levels they defend",
      sections: [
        { h: "What this tab shows", p: `<p>Where big size actually changed hands <b>off-exchange</b> (ATS venues, reported via TRFs). Dark prints mark accumulation and distribution shelves that frequently act as <b>support and resistance</b>.</p>` },
        { h: "Panels", p: `<ul><li><b>Dark Pool flow KPIs</b> — print count, total <code>premium</code>, largest print, average print and <code>size</code>, canceled share.</li><li><b>Largest Dark Pool Prints</b> — top 30 by <code>premium</code>: <code>price</code>, <code>size</code>, <code>premium</code>, <code>executed_at</code>, <code>nbbo_bid</code>/<code>nbbo_ask</code>, <code>market_center</code>.</li><li><b>Dark Pool Premium by Price</b> — <code>premium</code> aggregated by rounded <code>price</code>; the tallest bar is the defended shelf.</li><li><b>Dark Pool vs Regular Volume by Price</b> — stacked composition bars: each bar's length is <b>total</b> volume at that price, split into <b>dark pool</b> (violet, off-exchange) and <b>regular</b> (slate, lit) from <code>dark_pool_volume</code> / <code>regular_volume</code>. The right column shows <b>dark share %</b> (violet = dark is the majority, i.e. hidden liquidity dominates). <b>Sort by Volume</b> ranks the busiest shelves; <b>Sort by Dark %</b> ranks where hidden liquidity dominates (levels under ~2% of the largest are ignored). Both show the same bars — only the order changes; hover a row for exact counts.</li><li><b>Dark Pool · price × time</b> — every dark print aggregated into adaptive price buckets (rows, descending) × 10-minute ET buckets (cols); toggle <b>Premium</b>/<b>Size</b>.</li></ul>` },
        { h: "Price × time heatmap", p: `<p>The <b>Dark Pool · price × time</b> card uses the <b>full</b> dark-print set — no top-N slicing. Rows are adaptive price buckets (size <code>max(0.5, spot × 0.002)</code>, where <code>spot</code> is the median print price), sorted <b>descending</b>, labelled by the bucket's low edge; columns are fixed <b>10-minute ET</b> buckets from <code>executed_at</code> (UTC → America/New_York), labelled <code>HH:MM</code>. Each cell is the <b>sum</b> of the selected metric over all prints landing in that price × time cell. Toggle <b>Premium</b> (default, money) or <b>Size</b> (shares). Empty cells show <span class="muted">·</span>. Intensity is relative to the largest cell in the current view. The wrapper scrolls (max-height ~380px) with sticky header + first column, so narrow windows stay readable.</p>` },
        { h: "How to read it", p: `<p>Find the tallest premium shelf, then watch how spot behaves there: <b>reclaim plus call sweeps means long</b>; <b>rejection plus put sweeps means short or fade</b>. Prints near the NBBO midpoint are neutral crosses; prints at the ask with size suggest urgency. Use the <b>Dark Pool vs Regular Volume</b> card to see whether institutions were active at that level.</p>` },
        { h: "Worked example", p: `<pre>NVDA spot 224.10. Premium-by-price shelf at $224: $8.2M across 38 prints;\nlargest single print 50,000 sh x $223.84 = $11.2M premium at 15:59.\nDark vs regular at 224 shows dark share ~45% — institutions active there.\nDecision: buy the 15-min reclaim of 224.00 with stop 223.20 (below the\nshelf), first target 226.50 (next shelf / call wall). Skip if call flow\nis absent — shelf alone is a level, not a trigger.</pre>` },
        { h: "Endpoints used", p: `<p><code>/api/darkpool/{ticker}</code> <code>/api/darkpool/{ticker}/price-levels</code>. Screeners: <code>/api/darkpool/recent</code>.</p>` },
        { h: "Caveats", p: `<ul><li>Prints can report late; timestamps are execution time, not arrival time.</li><li>Canceled prints are flagged — check the KPI before trusting a shelf.</li><li>Premium-by-price rounds to whole dollars, so tight levels merge.</li><li>Dark volume is not directional by itself; pair it with options flow.</li></ul>` }
      ]
    },
  };
})();
