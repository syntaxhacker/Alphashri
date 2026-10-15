/* Insiders tab — insider flow, buy/sell filings, registered insiders, institutions. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, signCls, shortDate, pill, tk, table, card, kpiBig, hbars, line, multi } = U.util;

  const POS = "#16a34a";
  const NEG = "#dc2626";
  const ACCENT = "#3b82f6";

  const arr = (v) => (Array.isArray(v) ? v : []);
  const N = (v) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };
  const note = (t) => `<div class="muted" style="padding:6px">${esc(t)}</div>`;
  const side = (r) => {
    const s = String((r && r.buy_sell) || "").toLowerCase();
    return s === "sell" ? "sell" : s === "buy" ? "buy" : "";
  };
  // buys are positive, sells negative (regardless of the raw premium sign)
  const signedPrem = (r) => {
    const p = Math.abs(N(r.premium));
    const s = side(r);
    return s === "sell" ? -p : s === "buy" ? p : N(r.premium);
  };

  U.PANELS.insiders = {
    title: "Insiders",
    render(d) {
      d = d || {};
      const tf = arr(d.ticker_flow).filter((r) => r && typeof r === "object");
      const bs = arr(d.buy_sells).filter((r) => r && typeof r === "object");
      const ins = arr(d.insiders).filter((r) => r && typeof r === "object");
      const ow = arr(d.ownership).filter((r) => r && typeof r === "object");

      // ---- (1) KPIs: total buy vs sell premium, latest net ----
      let buy = 0;
      let sell = 0;
      let tx = 0;
      let vol = 0;
      let uniq = 0;
      let prem10b5 = 0;
      tf.forEach((r) => {
        const p = Math.abs(N(r.premium));
        const s = side(r);
        if (s === "buy") buy += p;
        else if (s === "sell") sell -= p;
        tx += N(r.transactions);
        vol += N(r.volume);
        uniq = Math.max(uniq, N(r.uniq_insiders));
        prem10b5 += N(r.premium_10b5);
      });
      const net = buy + sell;
      const latest = tf.length ? tf[0] : {};
      const buyDays = tf.filter((r) => side(r) === "buy").length;
      const sellDays = tf.filter((r) => side(r) === "sell").length;

      const kpis =
        kpiBig("Buy premium", money(buy), int(buyDays) + " days", "pos") +
        kpiBig("Sell premium", money(sell), int(sellDays) + " days", "neg") +
        kpiBig("Net premium", money(net), "buys + sells", signCls(net)) +
        kpiBig(
          "Latest",
          latest.date ? money(latest.premium) : "\u2013",
          latest.date ? shortDate(latest.date) + " \u00b7 " + (side(latest) || "\u2013") : "",
          latest.date ? signCls(latest.premium) : ""
        ) +
        kpiBig("Transactions", int(tx), int(vol) + " shares") +
        kpiBig("Uniq insiders", int(uniq), "10b5 " + money(prem10b5));

      // ---- (2) daily net premium, signed (buy +, sell -) ----
      const asc = tf.slice().reverse(); // source is latest-first
      const premSeries = asc.slice(-120).map(signedPrem);
      const premCard = premSeries.length ? line(premSeries, { stroke: ACCENT, fill: ACCENT, height: 150 }) : note("no flow data");

      // ---- (3) recent transactions ----
      const txRows = tf.slice(0, 60);
      const txMaxPrem = Math.max(0, ...txRows.map((r) => Math.abs(N(r.premium))));
      const txMaxVol = Math.max(0, ...txRows.map((r) => Math.abs(N(r.volume))));
      const txTable = table(
        [
          { label: "Date" },
          { label: "Side" },
          { label: "Premium", num: true },
          { label: "Volume", num: true },
          { label: "Avg", num: true },
          { label: "Txns", num: true },
          { label: "10b5", num: true },
          { label: "Tkr" },
          { label: "Insiders", num: true },
        ],
        tf.slice(0, 60),
        (r) =>
          `<tr><td class="muted">${esc(shortDate(r.date))}</td><td>${
            side(r) ? pill(side(r).toUpperCase(), side(r)) : ""
          }</td><td class="num ${signCls(r.premium)}" style="background:${U.heat(signedPrem(r), txMaxPrem)}">${money(r.premium)}</td><td class="num" style="background:${U.heat(N(r.volume), txMaxVol)}">${int(
            r.volume
          )}</td><td class="num">${num(r.avg_price)}</td><td class="num">${int(r.transactions)}</td><td class="num muted">${int(
            r.transactions_10b5
          )}</td><td>${tk(r.ticker)}</td><td class="num">${int(r.uniq_insiders)}</td></tr>`
      );

      // ---- (4) filings: purchases vs sells notional over filing_date ----
      const bSorted = bs.slice().sort((a, b) => String(a.filing_date || "").localeCompare(String(b.filing_date || "")));
      const bWin = bSorted.slice(-120);
      const bsMulti = bWin.length
        ? multi(
            [
              { name: "Purchases", color: POS, data: bWin.map((r) => N(r.purchases_notional)) },
              { name: "Sells", color: NEG, data: bWin.map((r) => N(r.sells_notional)) },
            ],
            { height: 150 }
          )
        : note("no filings");

      // ---- (5) filings table (latest first) ----
      const bsRows = bs.slice().reverse().slice(0, 60);
      const bsMaxPurch = Math.max(0, ...bsRows.map((r) => Math.abs(N(r.purchases_notional))));
      const bsMaxSells = Math.max(0, ...bsRows.map((r) => Math.abs(N(r.sells_notional))));
      const bsTable = table(
        [{ label: "Filed" }, { label: "Purch", num: true }, { label: "Purch $", num: true }, { label: "Sells", num: true }, { label: "Sells $", num: true }],
        bsRows,
        (r) =>
          `<tr><td class="muted">${esc(shortDate(r.filing_date))}</td><td class="num">${int(r.purchases)}</td><td class="num pos" style="background:${U.heat(N(r.purchases_notional), bsMaxPurch)}">${money(
            r.purchases_notional
          )}</td><td class="num">${int(r.sells)}</td><td class="num neg" style="background:${U.heat(-Math.abs(N(r.sells_notional)), bsMaxSells)}">${money(r.sells_notional)}</td></tr>`
      );

      // ---- (6) registered insiders ----
      const insTable = table(
        [{ label: "Name" }, { label: "Type" }, { label: "CIK" }],
        ins.slice(0, 60),
        (r) =>
          `<tr><td>${esc(r.display_name || r.name)}</td><td>${pill(r.is_person ? "person" : "entity", r.is_person ? "buy" : "warn")}</td><td class="muted">${esc(
            r.cik
          )}</td></tr>`
      );

      // ---- (7) top institutions by value + hbars ----
      const owSorted = ow.slice().sort((a, b) => N(b.value) - N(a.value));
      const owRows = owSorted.slice(0, 25);
      const owMaxVal = Math.max(0, ...owRows.map((r) => Math.abs(N(r.value))));
      const owMaxUnits = Math.max(0, ...owRows.map((r) => Math.abs(N(r.units))));
      const owTable = table(
        [
          { label: "Institution" },
          { label: "Value", num: true },
          { label: "Units", num: true },
          { label: "\u0394 Units", num: true },
          { label: "Avg", num: true },
          { label: "Filed" },
        ],
        owRows,
        (r) =>
          `<tr><td>${esc(r.short_name || r.name)}</td><td class="num" style="background:${U.heat(N(r.value), owMaxVal)}">${money(r.value)}</td><td class="num" style="background:${U.heat(N(r.units), owMaxUnits)}">${int(
            r.units
          )}</td><td class="num ${signCls(r.units_changed)}" style="background:${U.heat(N(r.units_changed), owMaxUnits)}">${int(r.units_changed)}</td><td class="num">${num(
            r.avg_price
          )}</td><td class="muted">${esc(shortDate(r.filing_date))}</td></tr>`
      );
      const owBars = hbars(
        owSorted
          .slice(0, 12)
          .map((r) => ({ label: String(r.short_name || r.name || "").slice(0, 12), value: N(r.value), right: money(r.value) })),
        {}
      );

      return (
        card("Insider Flow \u00b7 KPIs", `<div class="kpis">${kpis}</div>`, 2) +
        card("Net Insider Premium \u00b7 daily (buy +, sell \u2212)", premCard, 2) +
        card("Recent Insider Transactions", txTable, 2) +
        card("Filings \u00b7 purchases vs sells notional", bsMulti, 2) +
        card("Insider Filings", bsTable, 2) +
        card("Registered Insiders", insTable, 2) +
        card("Top Institutions", owTable + owBars, 2)
      );
    },
    info: {
      title: "Insiders",
      tagline: "Who is buying and selling from the inside — flow, filings, and big holders",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Open-market insider activity for the ticker plus the institutional backdrop: daily insider <b>buy vs sell premium</b>, per-filing purchase/sell notional, the registered insider roster, and the top 13F institutions by position value. Single trades are noise — <em>clusters</em> of buys across insiders and days are the signal.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>Insider Flow · KPIs</b> — aggregates of <code>ticker_flow</code>: Buy premium, Sell premium, Net premium, Latest day, Transactions / shares, Uniq insiders and 10b5-1-plan premium (<code>premium</code>, <code>buy_sell</code>, <code>transactions</code>, <code>volume</code>, <code>uniq_insiders</code>, <code>premium_10b5</code>).</li><li><b>Net Insider Premium · daily</b> — signed <code>premium</code> per <code>date</code> (buys +, sells −), oldest → newest.</li><li><b>Recent Insider Transactions</b> — latest 60 <code>ticker_flow</code> rows: <code>date</code>, <code>buy_sell</code>, <code>premium</code>, <code>volume</code>, <code>avg_price</code>, <code>transactions</code>, <code>transactions_10b5</code>, <code>uniq_insiders</code>.</li><li><b>Filings · purchases vs sells notional</b> — <code>buy_sells</code> time series of <code>purchases_notional</code> vs <code>sells_notional</code> by <code>filing_date</code>.</li><li><b>Insider Filings</b> — per-filing <code>purchases</code>, <code>purchases_notional</code>, <code>sells</code>, <code>sells_notional</code>.</li><li><b>Registered Insiders</b> — <code>insiders</code> roster: <code>display_name</code>, person-vs-entity, <code>cik</code>.</li><li><b>Top Institutions</b> — <code>ownership</code> sorted by <code>value</code>: <code>short_name</code>, <code>units</code>, <code>units_changed</code>, <code>avg_price</code>, <code>filing_date</code>, plus value bars.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p>Look for <b>cluster follows</b>: 2+ distinct insiders buying in the open market within ~30 days, with net premium flipping positive while 10b5 selling stays quiet. Routine executive selling (RSU vesting, 10b5-1 plans) is background noise — discount isolated sells, overweight fresh open-market buys confirmed by call flow or a gamma-flip reclaim. Institutions set the slow context: rising <code>units_changed</code> across holders means accumulation under the price.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>NVDA: last 30d of ticker_flow => Buy premium $4.2M over 6 days,\nSell premium -$18.9M over 14 days, Net -$14.7M.\nLatest row: 2026-09-21 sell -$6.79M, 3 transactions, avg $222.80 (matches\nbuy_sells filing 2026-09-23: 0 purchases, 3 sells -$6.79M).\nReading: net negative but driven by scheduled executive sells near $222-224\nwhile Registered Insiders shows 34 persons/entities and BlackRock holds\n~1.94B units (value ~$389B) with no fresh unit growth.\nDecision: no cluster-buy signal — do NOT chase; wait for 2+ open-market\nbuys or positive net-premium flip, then enter long with stop under the\nrecent insider avg price (~$222).</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>/api/insider/{ticker}</code> (insiders) <code>/api/insider/{ticker}/ticker-flow</code> (ticker_flow) <code>/api/stock/{ticker}/insider-buy-sells</code> (buy_sells) <code>/api/institution/{ticker}/ownership</code> (ownership).</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Most insider sells are compensation-related, not bearish — check <code>transactions_10b5</code> before reacting.</li><li>13F <code>ownership</code> is filed quarterly with a 45-day lag; <code>filing_date</code> is not the trade date.</li><li>Thin insider names can show long empty stretches — empty tables mean no filings, not missing data.</li></ul>`,
        },
      ],
    },
  };
})();
