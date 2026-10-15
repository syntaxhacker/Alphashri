/* Shorts tab — short interest/float, borrow fee, FTDs, exchange short volume. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, int, pct, rawpct, table, card, kpiBig, hbars, multi, line } = U.util;

  const err = (v) => (v && v.__error ? v : null);
  const arr = (v) => (!err(v) && Array.isArray(v) ? v : []);
  const obj = (v) => (!err(v) && v && typeof v === "object" && !Array.isArray(v) ? v : null);
  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const byDate = (key, rows) =>
    rows.slice().sort((a, b) => String(a[key] || "").localeCompare(String(b[key] || "")));
  const compact = (v) => {
    const a = Math.abs(n(v) || 0);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return num(v, 2);
  };

  U.PANELS.shorts = {
    title: "Shorts",
    render(d) {
      d = d || {};

      // -- interest float -----------------------------------------------------
      const ifRows = byDate("market_date", arr(d.interest_float).filter(Boolean));
      const latest = ifRows[ifRows.length - 1] || {};
      const ifRange = ifRows.length
        ? ` <span class="muted">${esc(ifRows[0].market_date || "")} → ${esc(latest.market_date || "")}</span>`
        : "";

      const ifKpis = `<div class="kpis">
        ${kpiBig("SI % float", pct(latest.si_float), latest.si_float_with_synth_long_pct_of_total_shares != null ? "synth " + pct(latest.si_float_with_synth_long_pct_of_total_shares) : "")}
        ${kpiBig("Days to cover", num(latest.days_to_cover, 2))}
        ${kpiBig("Fee rate", rawpct(latest.fee_rate, 2))}
        ${kpiBig("Short interest", int(latest.short_interest))}
        ${kpiBig("Shares available", int(latest.short_shares_available))}
        ${kpiBig("Total float", compact(latest.total_float))}
      </div>`;

      const ifCard = ifRows.length
        ? multi(
            [
              { name: "SI % float", color: "#3b82f6", data: ifRows.map((r) => n(r.si_float) || 0) },
              { name: "Days to cover", color: "#f59e0b", data: ifRows.map((r) => n(r.days_to_cover) || 0) },
            ],
            { height: 150 }
          ) + `<div class="muted" style="padding:0 6px 4px">${esc(ifRows[0].market_date || "")} → ${esc(latest.market_date || "")}</div>`
        : '<div class="muted" style="padding:6px">no data</div>';

      // -- short data (borrow) ------------------------------------------------
      const sd = byDate("timestamp", arr(d.short_data).filter(Boolean));
      const sdShares = sd.map((r) => n(r.short_shares_available) || 0);
      const sdFlat = sdShares.length > 1 && Math.max(...sdShares) === Math.min(...sdShares);
      const sdCard = sd.length
        ? multi(
            [
              { name: "Short shares available", color: "#3b82f6", data: sdShares },
              { name: "Fee rate", color: "#f59e0b", data: sd.map((r) => n(r.fee_rate) || 0) },
            ],
            { height: 150 }
          ) +
          `<div class="muted" style="padding:0 6px 4px">${esc(String(sd[0].timestamp || "").slice(0, 16))} → ${esc(String(sd[sd.length - 1].timestamp || "").slice(0, 16))}${sdFlat ? " · borrow supply unchanged — only the fee moves" : ""}</div>`
        : '<div class="muted" style="padding:6px">no data</div>';

      // -- failures to deliver ------------------------------------------------
      const ftd = byDate("date", arr(d.ftds).filter(Boolean)).slice(-260);
      const ftdQty = ftd.map((r) => n(r.quantity) || 0);
      const ftdMax = ftdQty.length ? Math.max.apply(null, ftdQty) : 0;
      const ftdLast = ftdQty.length ? ftdQty[ftdQty.length - 1] : null;
      const ftdCard = ftd.length
        ? `<div class="kpis">
            ${kpiBig("Latest FTD", int(ftdLast), esc(ftd[ftd.length - 1].date || ""))}
            ${kpiBig("Peak FTD", int(ftdMax))}
            ${kpiBig("Samples", int(ftd.length))}
          </div>` + line(ftdQty, { stroke: "#dc2626", fill: "#dc2626", height: 140 })
        : '<div class="muted" style="padding:6px">no data</div>';

      // -- volume ratio: {si:[{total_volume,market_date,short_volume,short_volume_ratio}]}
      const vrRaw = d.volume_ratio;
      const vrObj = obj(vrRaw) ? vrRaw : {};
      const vrList = Array.isArray(vrObj.si) ? vrObj.si.slice().reverse() : arr(vrRaw).slice().reverse();
      const vrLatest = vrList.length ? vrList[vrList.length - 1] : {};
      const vrSeries = vrList.map((r) => n(r.short_volume_ratio) * 100);
      const vrCard = vrList.length
        ? `<div class="kpis">
            ${kpiBig("Short ratio", pct(vrLatest.short_volume_ratio), esc(vrLatest.market_date || ""))}
            ${kpiBig("Short volume", int(vrLatest.short_volume))}
            ${kpiBig("Total volume", int(vrLatest.total_volume))}
          </div>` + line(vrSeries, { stroke: "#f59e0b", height: 110 })
        : '<div class="muted" style="padding:6px">no data</div>';

      // -- volumes by exchange (latest date) ---------------------------------
      const ex = arr(d.by_exchange).filter(Boolean);
      const exDates = ex.map((r) => String(r.date || "")).filter(Boolean).sort();
      const lastExDate = exDates.length ? exDates[exDates.length - 1] : null;
      const exLast = lastExDate ? ex.filter((r) => String(r.date) === lastExDate) : ex;
      const grouped = {};
      exLast.forEach((r) => {
        const k = r.exchange_name || r.market_center || "?";
        const o = grouped[k] || (grouped[k] = { short: 0, total: 0 });
        o.short += n(r.short_volume) || 0;
        o.total += n(r.total_volume) || 0;
      });
      const exItems = Object.keys(grouped)
        .map((k) => ({ label: k, short: grouped[k].short, total: grouped[k].total }))
        .sort((a, b) => b.short - a.short);
      const exBars = exItems.length
        ? hbars(
            exItems.map((x) => ({
              label: x.label,
              value: x.short,
              right: `${x.total ? pct(x.short / x.total) : "–"}<span class="muted"> ${compact(x.short)}</span>`,
            }))
          ) + `<div class="muted" style="padding:0 6px 4px">${lastExDate ? esc(lastExDate) : ""} · short % · short vol</div>`
        : '<div class="muted" style="padding:6px">no data</div>';
      const exMaxShort = Math.max(0, ...exItems.map((x) => Math.abs(x.short)));
      const exMaxTotal = Math.max(0, ...exItems.map((x) => Math.abs(x.total)));
      const exTable = table(
        [
          { label: "Exchange" },
          { label: "Short vol", num: true },
          { label: "Total vol", num: true },
          { label: "Short %", num: true },
        ],
        exItems,
        (r) =>
          `<tr><td>${esc(r.label)}</td><td class="num" style="background:${U.heat(r.short, exMaxShort)}">${int(r.short)}</td><td class="num muted" style="background:${U.heat(r.total, exMaxTotal)}">${int(r.total)}</td><td class="num warn">${
            r.total ? pct(r.short / r.total) : "–"
          }</td></tr>`
      );

      return (
        card("Short Interest &amp; Float" + ifRange, ifKpis, 2) +
        card("SI % float vs Days to cover", ifCard, 2) +
        card("Short Shares Available &amp; Fee Rate", sdCard, 2) +
        card("Failures to Deliver", ftdCard, 2) +
        card("Short Volume Ratio", vrCard, 2) +
        card("Short Volume by Exchange", exBars, 2) +
        card("Exchange Short %", exTable, 4)
      );
    },
    info: {
      title: "Shorts",
      tagline: "Crowdedness gauge — short interest, borrow cost, fails and where the shorting happens",
      sections: [
        { h: "What this tab shows", p: `<p>How crowded the short side is and whether it is getting <b>more crowded or covering</b>: short interest against float, borrow fee pressure, settlement fails (FTDs), the daily share of volume that is short, and which venues the shorting prints on. High, sticky crowding plus a fresh bullish catalyst is squeeze fuel.</p>` },
        { h: "Panels", p: `<ul><li><b>Short Interest &amp; Float</b> — latest <code>short_interest</code>, <code>si_float</code>, synthetic-inclusive <code>si_float_with_synth_long_pct_of_total_shares</code>, <code>days_to_cover</code>, <code>fee_rate</code>, <code>short_shares_available</code>, <code>total_float</code>.</li><li><b>SI% float vs Days to cover</b> — trend of <code>si_float</code> against <code>days_to_cover</code> by <code>market_date</code>.</li><li><b>Short Shares Available &amp; Fee Rate</b> — borrow supply <code>short_shares_available</code> vs cost <code>fee_rate</code> by <code>timestamp</code>; falling supply with rising fee means shorts are trapped.</li><li><b>Failures to Deliver</b> — <code>quantity</code> by <code>date</code>; persistent elevated FTDs hint at hard-to-borrow stress.</li><li><b>Short Volume Ratio</b> — <code>short_volume_ratio</code>, <code>short_volume</code>, <code>total_volume</code> by <code>market_date</code>.</li><li><b>Short Volume by Exchange / Exchange Short %</b> — <code>short_volume</code> vs <code>total_volume</code> grouped by <code>exchange_name</code> / <code>market_center</code> for the latest <code>date</code>.</li></ul>` },
        { h: "How to read it", p: `<p>Squeeze needs three things at once: <b>crowding</b> (high SI% float and days to cover), <b>pressure</b> (fee rate rising, shares available shrinking, FTDs elevated), and a <b>trigger</b> (bullish flow anomaly or reclaim of a dark-pool shelf). Crowding alone can sit for months — never short or buy calls on SI% by itself.</p>` },
        { h: "Worked example", p: `<pre>XYZ: SI% float 28%, days to cover 6.4, fee rate 12.5% (up from 3% in\na week), shares available down to 40K, short volume ratio 52%.\nCall sweeps hit the front-month OTM chain this morning.\nDecision: buy a 2-week 10-delta OTM call spread on the flow day,\nstop on a close back below the breakout level; target +30-50% of\nspread width. No flow trigger, no trade — crowding is fuel, flow is\nthe match.</pre>` },
        { h: "Endpoints used", p: `<p><code>/api/shorts/{ticker}/interest-float/v2</code> <code>/api/shorts/{ticker}/data</code> <code>/api/shorts/{ticker}/ftds</code> <code>/api/shorts/{ticker}/volume-and-ratio</code> <code>/api/shorts/{ticker}/volumes-by-exchange</code>. Market-wide: <code>/api/short_screener</code>.</p>` },
        { h: "Caveats", p: `<ul><li>Short interest restates bi-monthly — the latest row can be weeks old.</li><li>Fee rate and availability are broker-sampled snapshots, not market-wide.</li><li>FTDs settle T+1/T+2 noise included; look for persistence, not one spike.</li><li>Short volume ratio counts both sides of market-maker hedging — high ratio alone is not bearish.</li></ul>` }
      ]
    },
  };
})();
