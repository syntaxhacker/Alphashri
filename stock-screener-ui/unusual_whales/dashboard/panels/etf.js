/* ETF flow tab — cross-holdings/exposure, in/outflow, ETF tide.
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

  U.PANELS.etf = {
    title: "ETF",
    render(d) {
      d = d || {};

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

      return (
        card("ETFs Holding This Name \u00b7 weight", expBars, 2) +
        card("ETF Exposure", expTable, 2) +
        card("ETF Tide \u00b7 net call vs put premium", tideBody, 2) +
        card("Inflow / Outflow", flowBody, 2)
      );
    },
    info: {
      title: "ETF flow",
      tagline: "Passive flows around the ticker — who holds it, who is creating, where options lean",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>How the ticker sits inside the ETF ecosystem: which ETFs hold it and at what <b>weight</b>, whether ETF options flow leans call or put, and whether money is being <b>created or redeemed</b>. For a normal stock, <span class="muted">empty Exposure / Tide / Inflow cards are expected, not broken</span> — Exposure and Tide still carry the signal when present.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>ETFs Holding This Name · weight</b> — <code>exposure</code> weight bars per holder (<code>etf</code>, <code>weight</code>).</li><li><b>ETF Exposure</b> — <code>exposure</code> table: <code>etf</code>, <code>weight</code>, <code>last_price</code>, <code>prev_price</code> change, <code>shares</code>, <code>full_name</code>.</li><li><b>ETF Tide</b> — <code>etf_tide</code> intraday <code>net_call_premium</code> vs <code>net_put_premium</code> by <code>timestamp</code>.</li><li><b>Inflow / Outflow</b> — <code>in_outflow</code> creation-redemption series by <code>date</code> plus recent table.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p>Heavy <b>exposure weight</b> in big ETFs means passive flows move your stock — rebalances, creations and redemptions add drift on top of fundamentals. Rising <b>inflow</b> plus a call-leaning <b>tide</b> is a risk-on tailwind for breakouts; outflow plus put-leaning tide says fade rallies or sell premium instead.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>NVDA (a stock, not an ETF): Exposure: VTI weight 5.5%, 744.6M shares @ ~$378.08 (flat vs $378.23).\netf_tide latest: net_call_premium +$2.1M vs net_put_premium +$0.4M\n=> ETF options lean bullish; in_outflow for the holding ETFs prints\n+$850M net creations on the week.\nDecision: passive + options winds both tailwind — prefer long exposure\n(call debit spread or stock with stop under the gamma flip) over\nshort-premium structures until creations reverse.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>/api/etfs/{ticker}/exposure</code> (exposure) <code>/api/market/{ticker}/etf-tide</code> (etf_tide) <code>/api/etfs/{ticker}/in-outflow</code> (in_outflow).</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>For single stocks, <code>exposure</code>, <code>etf_tide</code> and usually <code>in_outflow</code> are legitimately empty — read Exposure and Tide instead.</li><li><code>etf_tide</code> rows can carry null premiums outside market hours; a flat chart then means no session, not neutrality.</li><li>Exposure weights and share counts snapshot at different times across ETFs — compare ranks, not exact dollars.</li></ul>`,
        },
      ],
    },
  };
})();
