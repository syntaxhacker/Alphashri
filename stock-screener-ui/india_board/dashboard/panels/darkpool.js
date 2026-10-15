/* Dark Pool tab — dark prints, dark price levels, lit flow, lit/off-lit volume. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, pct, table, card, kpiBig, hbars, multi } = U.util;

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

  function printsTable(rows) {
    const maxPrem = Math.max(0, ...rows.map((r) => Math.abs(n(r.premium) || 0)));
    const maxSize = Math.max(0, ...rows.map((r) => Math.abs(n(r.size) || 0)));
    return table(
      [
        { label: "Price", num: true },
        { label: "Size", num: true },
        { label: "Premium", num: true },
        { label: "Time" },
        { label: "NBBO", num: true },
        { label: "Mkt" },
      ],
      rows,
      (r) => `<tr>
        <td class="num">${num(r.price, 2)}</td>
        <td class="num" style="background:${U.heat(n(r.size) || 0, maxSize)}">${int(r.size)}</td>
        <td class="num" style="background:${U.heat(n(r.premium) || 0, maxPrem)}">${money(r.premium)}</td>
        <td class="muted">${esc(time(r.executed_at))}</td>
        <td class="num muted">${num(r.nbbo_bid, 2)}/${num(r.nbbo_ask, 2)}</td>
        <td class="muted">${esc(r.market_center || "–")}</td>
      </tr>`
    );
  }

  U.PANELS.darkpool = {
    title: "Dark Pool",
    render(d) {
      d = d || {};
      const dk = arr(d.darkpool).filter(Boolean);
      const lv = arr(d.darkpool_levels).filter(Boolean);
      const lit = arr(d.lit_flow).filter(Boolean);
      const vpl = arr(d.volume_price_levels).filter(Boolean);

      const dks = printStats(dk);
      const lits = printStats(lit);

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
        : '<div class="muted" style="padding:6px">no data</div>';

      const levelRows = lv
        .map((r) => ({ price: Number(r.price), dp: n(r.dark_pool_volume) || 0, reg: n(r.regular_volume) || 0 }))
        .filter((r) => isFinite(r.price))
        .sort((a, b) => b.dp - a.dp)
        .slice(0, 18);
      const levelItems = levelRows.map((r) => ({
        label: String(r.price),
        value: r.dp,
        right: `${int(r.dp)}<span class="muted"> / ${int(r.reg)}</span>`,
      }));
      const levelCard = levelItems.length
        ? hbars(levelItems) + '<div class="muted" style="padding:0 6px 4px">dark pool <b>/</b> regular volume by price</div>'
        : '<div class="muted" style="padding:6px">no data</div>';

      const litKpis = `<div class="kpis">
        ${kpiBig("Lit prints", int(lits.count))}
        ${kpiBig("Lit premium", money(lits.total))}
        ${kpiBig("Largest", money(lits.max), int(lits.maxRow.size) + " sh")}
        ${kpiBig("Avg size", int(lits.avgSize))}
      </div>`;

      const vplRows = vpl
        .map((r) => ({ price: Number(r.price), lit: n(r.lit_vol) || 0, off: n(r.off_vol) || 0 }))
        .filter((r) => isFinite(r.price))
        .sort((a, b) => a.price - b.price);
      const vplCard = vplRows.length
        ? multi(
            [
              { name: "lit", color: "#3b82f6", data: vplRows.map((r) => r.lit) },
              { name: "off-lit", color: "#f59e0b", data: vplRows.map((r) => r.off) },
            ],
            { height: 150 }
          ) +
          `<div class="muted" style="padding:0 6px 4px">$${num(vplRows[0].price, 2)} → $${num(vplRows[vplRows.length - 1].price, 2)}</div>`
        : '<div class="muted" style="padding:6px">no data</div>';

      return (
        card("Dark Pool · flow", dkKpis, 2) +
        card("Largest Dark Pool Prints · " + int(dks.count) + " prints", printsTable(topPrints(dk)), 2) +
        card("Dark Pool Premium by Price", lvlCard, 2) +
        card("Dark Pool vs Regular Volume by Price", levelCard, 2) +
        card("Lit Flow · " + int(lits.count) + " prints", litKpis, 1) +
        card("Largest Lit Prints", printsTable(topPrints(lit)), 3) +
        card("Lit vs Off-lit volume by price", vplCard, 2)
      );
    },
    info: {
      title: "Dark Pool",
      tagline: "Institutional footprints — off-exchange prints mapped to the price levels they defend",
      sections: [
        { h: "What this tab shows", p: `<p>Where big size actually changed hands <b>off-exchange</b> (ATS venues, reported via TRFs) versus on lit exchanges. Dark prints mark accumulation and distribution shelves that frequently act as <b>support and resistance</b>. The lit-flow half of the tab is the control group: what retail and displayed liquidity did at the same prices.</p>` },
        { h: "Panels", p: `<ul><li><b>Dark Pool flow KPIs</b> — print count, total <code>premium</code>, largest print, average print and <code>size</code>, canceled share.</li><li><b>Largest Dark Pool Prints</b> — top 30 by <code>premium</code>: <code>price</code>, <code>size</code>, <code>premium</code>, <code>executed_at</code>, <code>nbbo_bid</code>/<code>nbbo_ask</code>, <code>market_center</code>.</li><li><b>Dark Pool Premium by Price</b> — <code>premium</code> aggregated by rounded <code>price</code>; the tallest bar is the defended shelf.</li><li><b>Dark Pool vs Regular Volume by Price</b> — <code>dark_pool_volume</code> against <code>regular_volume</code> per <code>price</code>.</li><li><b>Lit Flow KPIs</b> and <b>Largest Lit Prints</b> — same fields as dark (<code>price</code>, <code>size</code>, <code>premium</code>, <code>executed_at</code>) for displayed trades.</li><li><b>Lit vs Off-lit volume by price</b> — <code>lit_vol</code> vs <code>off_vol</code> across <code>price</code>; shows where hidden liquidity dominates.</li></ul>` },
        { h: "How to read it", p: `<p>Find the tallest premium shelf, then watch how spot behaves there: <b>reclaim plus call sweeps means long</b>; <b>rejection plus put sweeps means short or fade</b>. Prints near the NBBO midpoint are neutral crosses; prints at the ask with size suggest urgency. Confirm with lit flow — a shelf nobody defends on the lit tape breaks more easily.</p>` },
        { h: "Worked example", p: `<pre>NVDA spot 224.10. Premium-by-price shelf at $224: $8.2M across 38 prints;\nlargest single print 50,000 sh x $223.84 = $11.2M premium at 15:59.\nDark vs regular at 224 shows dark share ~45% — institutions active there.\nDecision: buy the 15-min reclaim of 224.00 with stop 223.20 (below the\nshelf), first target 226.50 (next shelf / call wall). Skip if call flow\nis absent — shelf alone is a level, not a trigger.</pre>` },
        { h: "Endpoints used", p: `<p><code>/api/darkpool/{ticker}</code> <code>/api/darkpool/{ticker}/price-levels</code> <code>/api/lit-flow/{ticker}</code> <code>/api/stock/{ticker}/stock-volume-price-levels</code> (lit vs off-lit). Screeners: <code>/api/darkpool/recent</code> <code>/api/lit-flow/recent</code>.</p>` },
        { h: "Caveats", p: `<ul><li>Prints can report late; timestamps are execution time, not arrival time.</li><li>Canceled prints are flagged — check the KPI before trusting a shelf.</li><li>Premium-by-price rounds to whole dollars, so tight levels merge.</li><li>Dark volume is not directional by itself; pair it with options flow.</li></ul>` }
      ]
    },
  };
})();
