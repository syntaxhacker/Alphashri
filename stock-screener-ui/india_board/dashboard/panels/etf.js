/* ETF tab — ETF info, cross-holdings/exposure, in/outflow, weights, ETF tide.
 * For a normal stock most payloads are legitimately empty; every card degrades
 * to a graceful note, while `exposure` and `etf_tide` still render when present. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, rawpct, signCls, tk, table, card, hbars, line, multi } = U.util;

  const POS = "#16a34a";
  const NEG = "#dc2626";
  const ACCENT = "#3b82f6";

  const arr = (v) => (Array.isArray(v) ? v : []);
  const N = (v) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) && !v.__error ? v : null);
  const note = (t) => `<div class="muted" style="padding:6px">${esc(t)}</div>`;
  const has = (v) => v != null && v !== "";
  const pick = (o, keys) => {
    for (const k of keys) if (o && has(o[k])) return o[k];
    return null;
  };
  const labelOf = (o, keys) => {
    const v = pick(o, keys);
    return v == null ? "" : String(v);
  };

  // ---- ETF info: generic key/value grid ----
  function kvHtml(o) {
    const keys = Object.keys(o).filter((k) => {
      const v = o[k];
      return has(v) && typeof v !== "object";
    });
    if (!keys.length) return note("No ETF info fields.");
    return `<div class="kv">${keys
      .slice(0, 20)
      .map((k) => {
        const v = o[k];
        let disp;
        if (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)))) {
          disp = /aum|asset|nav|value|flow|size|shares|price/i.test(k) ? money(v) : num(v, 2);
        } else disp = String(v);
        return `<div><span>${esc(k.replace(/_/g, " "))}</span><b>${esc(disp)}</b></div>`;
      })
      .join("")}</div>`;
  }

  // ---- weights: pick a label + numeric value from arbitrary rows ----
  const rowValue = (r) => N(pick(r, ["value", "weight", "pct", "percentage", "share"]));
  function weightBars(items) {
    if (!items.length) return note("no data");
    return hbars(
      items
        .slice(0, 12)
        .map((r) => ({
          label: String(labelOf(r, ["sector", "country", "name", "label"]) || "?").slice(0, 12),
          value: rowValue(r),
          right: rawpct(rowValue(r)),
        })),
      {}
    );
  }

  U.PANELS.etf = {
    title: "ETF",
    render(d) {
      d = d || {};

      // ---- info ----
      let info = obj(d.info);
      if (info && obj(info.data)) info = info.data;
      const isEtf = !!(info && Object.keys(info).length);
      const infoBody = isEtf ? kvHtml(info) : note("Not an ETF \u2014 no ETF metadata for this symbol.");

      // ---- exposure: ETFs that hold this ticker ----
      const exp = arr(d.exposure)
        .filter((r) => r && typeof r === "object")
        .slice()
        .sort((a, b) => N(b.weight) - N(a.weight));
      const expBars = exp.length
        ? hbars(
            exp.slice(0, 20).map((r) => ({
              label: labelOf(r, ["etf", "ticker", "symbol"]) || "?",
              value: N(r.weight),
              right: rawpct(N(r.weight)),
            })),
            {}
          )
        : note("no exposure data");
      const expRows = exp.slice(0, 80);
      const expMaxW = Math.max(0, ...expRows.map((r) => Math.abs(N(r.weight))));
      const expMaxSh = Math.max(0, ...expRows.map((r) => Math.abs(N(r.shares))));
      const expTable = table(
        [
          { label: "ETF" },
          { label: "Weight", num: true },
          { label: "Last", num: true },
          { label: "Chg", num: true },
          { label: "Shares", num: true },
          { label: "Name" },
        ],
        expRows,
        (r) => {
          const last = N(r.last_price);
          const prev = N(r.prev_price);
          const chg = prev ? ((last - prev) / prev) * 100 : null;
          return `<tr><td>${tk(labelOf(r, ["etf", "ticker", "symbol"]))}</td><td class="num" style="background:${U.heat(N(r.weight), expMaxW)}">${rawpct(
            N(r.weight)
          )}</td><td class="num">${num(r.last_price)}</td><td class="num ${signCls(chg)}">${
            chg == null ? "\u2013" : chg.toFixed(2) + "%"
          }</td><td class="num" style="background:${U.heat(N(r.shares), expMaxSh)}">${int(r.shares)}</td><td class="muted">${esc(r.full_name)}</td></tr>`;
        }
      );

      // ---- etf tide: net call vs put premium ----
      const tide = arr(d.etf_tide).filter((r) => r && typeof r === "object");
      const tc = [];
      const tp = [];
      tide.forEach((r) => {
        if (has(r.net_call_premium) || has(r.net_put_premium)) {
          tc.push(N(r.net_call_premium));
          tp.push(N(r.net_put_premium));
        }
      });
      const tideBody = tc.length
        ? multi(
            [
              { name: "Net call premium", color: POS, data: tc },
              { name: "Net put premium", color: NEG, data: tp },
            ],
            { height: 170 }
          )
        : note("No ETF tide data.");

      // ---- in / outflow ----
      const flow = arr(d.in_outflow).filter((r) => r && typeof r === "object");
      let flowBody;
      if (!flow.length) {
        flowBody = note("No inflow / outflow data.");
      } else {
        const fs = flow.slice().sort((a, b) => {
          const da = String(pick(a, ["date", "timestamp"]) || "");
          const db = String(pick(b, ["date", "timestamp"]) || "");
          return da.localeCompare(db);
        });
        const f0 = fs[0] || {};
        const valKey =
          ["net_flow", "net_inflow", "net", "flow", "value", "net_premium", "creation", "redemption", "inflow", "outflow"].find(
            (k) => has(f0[k]) && !isNaN(Number(f0[k]))
          ) || Object.keys(f0).find((k) => has(f0[k]) && !isNaN(Number(f0[k])));
        if (!valKey) {
          flowBody = note("No numeric flow series.");
        } else {
          const chart = line(
            fs.map((r) => N(r[valKey])),
            { stroke: ACCENT, fill: ACCENT, height: 150 }
          );
          const fRows = fs.slice(-40).reverse();
          const fMax = Math.max(0, ...fRows.map((r) => Math.abs(N(r[valKey]))));
          const t = table(
            [{ label: "Date" }, { label: valKey.replace(/_/g, " "), num: true }],
            fRows,
            (r) =>
              `<tr><td class="muted">${esc(String(pick(r, ["date", "timestamp"]) || "").slice(0, 10))}</td><td class="num ${signCls(
                r[valKey]
              )}" style="background:${U.heat(N(r[valKey]), fMax)}">${money(r[valKey])}</td></tr>`
          );
          flowBody = chart + t;
        }
      }

      // ---- sector & country weights ----
      let weights = obj(d.weights);
      if (weights && obj(weights.data)) weights = weights.data;
      const sector = arr(weights && weights.sector).filter((r) => r && typeof r === "object");
      const country = arr(weights && weights.country).filter((r) => r && typeof r === "object");
      const weightsBody =
        sector.length || country.length
          ? `<div class="muted" style="padding:3px 6px 0">Sector</div>${weightBars(sector)}` +
            `<div class="muted" style="padding:3px 6px 0">Country</div>${weightBars(country)}`
          : note("Not an ETF \u2014 no weight breakdown.");

      // ---- holdings: ETF constituents ----
      const hold = arr(d.holdings).filter((r) => r && typeof r === "object");
      const holdRows = hold.slice(0, 100);
      const holdMaxW = Math.max(0, ...holdRows.map((r) => Math.abs(N(pick(r, ["weight", "pct", "percentage"])))));
      const holdMaxSh = Math.max(0, ...holdRows.map((r) => Math.abs(N(pick(r, ["shares", "units"])))));
      const holdMaxV = Math.max(0, ...holdRows.map((r) => Math.abs(N(pick(r, ["value", "market_value"])))));
      const holdTable = hold.length
        ? table(
            [
              { label: "Weight", num: true },
              { label: "Ticker" },
              { label: "Name" },
              { label: "Shares", num: true },
              { label: "Value", num: true },
            ],
            holdRows,
            (r) =>
              `<tr><td class="num" style="background:${U.heat(N(pick(r, ["weight", "pct", "percentage"])), holdMaxW)}">${rawpct(N(pick(r, ["weight", "pct", "percentage"])))}</td><td>${tk(
                labelOf(r, ["ticker", "symbol", "etf"])
              )}</td><td>${esc(labelOf(r, ["full_name", "name", "company"]))}</td><td class="num" style="background:${U.heat(N(pick(r, ["shares", "units"])), holdMaxSh)}">${int(
                pick(r, ["shares", "units"])
              )}</td><td class="num" style="background:${U.heat(N(pick(r, ["value", "market_value"])), holdMaxV)}">${money(pick(r, ["value", "market_value"]))}</td></tr>`
          )
        : note("No holdings \u2014 not an ETF or data unavailable.");

      return (
        card("ETF Info", infoBody, 2) +
        card("ETFs Holding This Name \u00b7 weight", expBars, 2) +
        card("ETF Exposure", expTable, 2) +
        card("ETF Tide \u00b7 net call vs put premium", tideBody, 2) +
        card("Inflow / Outflow", flowBody, 2) +
        card("Sector & Country Weights", weightsBody, 2) +
        card("Holdings", holdTable, 2)
      );
    },
    info: {
      title: "ETF",
      tagline: "Passive flows around the ticker — who holds it, who is creating, where options lean",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>How the ticker sits inside the ETF ecosystem: which ETFs hold it and at what <b>weight</b>, whether ETF options flow leans call or put, whether money is being <b>created or redeemed</b>, and — only when the symbol itself is an ETF — its sector/country mix and full holdings. For a normal stock, <span class="muted">empty Info / Weights / Holdings cards are expected, not broken</span>; Exposure and Tide still carry the signal.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>ETF Info</b> — <code>info</code> metadata grid (AUM, NAV, expense, issuer…). Shows a "Not an ETF" note for single stocks.</li><li><b>ETFs Holding This Name · weight</b> — <code>exposure</code> weight bars per holder (<code>etf</code>, <code>weight</code>).</li><li><b>ETF Exposure</b> — <code>exposure</code> table: <code>etf</code>, <code>weight</code>, <code>last_price</code>, <code>prev_price</code> change, <code>shares</code>, <code>full_name</code>.</li><li><b>ETF Tide</b> — <code>etf_tide</code> intraday <code>net_call_premium</code> vs <code>net_put_premium</code> by <code>timestamp</code>.</li><li><b>Inflow / Outflow</b> — <code>in_outflow</code> creation-redemption series by <code>date</code> plus recent table.</li><li><b>Sector &amp; Country Weights</b> — <code>weights</code> breakdowns: <code>{country:[{country,weight}], sector:[{sector,weight}]}</code>; ETF-only.</li><li><b>Holdings</b> — <code>holdings</code> constituents: <code>weight</code>, <code>ticker</code>, <code>full_name</code>, <code>shares</code>, <code>value</code>; ETF-only.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p>Heavy <b>exposure weight</b> in big ETFs means passive flows move your stock — rebalances, creations and redemptions add drift on top of fundamentals. Rising <b>inflow</b> plus a call-leaning <b>tide</b> is a risk-on tailwind for breakouts; outflow plus put-leaning tide says fade rallies or sell premium instead. On an actual ETF, check <b>weights</b> first: a "tech ETF" that is 40% one sector is a single-factor bet, and rotation out of that sector will swamp stock-picking.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>NVDA (a stock, not an ETF): Info / Weights / Holdings correctly empty.\nExposure: VTI weight 5.5%, 744.6M shares @ ~$378.08 (flat vs $378.23).\netf_tide latest: net_call_premium +$2.1M vs net_put_premium +$0.4M\n=> ETF options lean bullish; in_outflow for the holding ETFs prints\n+$850M net creations on the week.\nDecision: passive + options winds both tailwind — prefer long exposure\n(call debit spread or stock with stop under the gamma flip) over\nshort-premium structures until creations reverse.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>/api/etfs/{ticker}/info</code> (info) <code>/api/etfs/{ticker}/exposure</code> (exposure) <code>/api/market/{ticker}/etf-tide</code> (etf_tide) <code>/api/etfs/{ticker}/in-outflow</code> (in_outflow) <code>/api/etfs/{ticker}/weights</code> (weights) <code>/api/etfs/{ticker}/holdings</code> (holdings).</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>For single stocks, <code>info</code>, <code>weights</code>, <code>holdings</code> and usually <code>in_outflow</code> are legitimately empty — read Exposure and Tide instead.</li><li><code>etf_tide</code> rows can carry null premiums outside market hours; a flat chart then means no session, not neutrality.</li><li>Exposure weights and share counts snapshot at different times across ETFs — compare ranks, not exact dollars.</li></ul>`,
        },
      ],
    },
  };
})();
