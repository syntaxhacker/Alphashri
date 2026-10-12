/* Whales tab — "where are the big players betting?", rendered visually.
 *
 * Everything here is a chart or a colour-coded row (no walls of text):
 *   money map (net premium by strike) · dark-pool shelf · biggest tickets
 *   new positions (OI change) · net premium by expiry · key levels vs spot
 *
 * The "Net Premium · intraday" time-series lives on the Flow tab only.
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { money, num, signCls, shortDate, card, bars } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};
  const NO = '<div class="muted" style="padding:6px">no data for this section — nothing was returned for this symbol.</div>';

  U.PANELS.whales = {
    title: "Whales",
    render(d) {
      d = d || {};
      const st = first(d.stock_state);
      const gx = first(d.gex_levels);
      const ov = first(d.options_volume);
      const mp = arr(d.max_pain);
      const fa = arr(d.flow_alerts);
      const fps = arr(d.flow_per_strike);
      const fpe = arr(d.flow_per_expiry);
      const oic = arr(d.oi_change);
      const dpl = arr(d.darkpool_levels);

      const px = n(st.close);
      const cw = n(gx.call_wall), pw = n(gx.put_wall), flip = n(gx.gamma_flip), magnet = n(gx.gamma_magnet);
      const maxPain = mp[0] ? n(mp[0].max_pain) : 0;

      // ---- money map: net premium by strike (nearest strikes to spot) -----
      const strikes = fps
        .map((r) => ({ s: n(r.strike), net: n(r.call_premium) - n(r.put_premium), cv: n(r.call_volume), pv: n(r.put_volume) }))
        .filter((r) => r.s > 0 && (r.cv > 0 || r.pv > 0))
        .sort((a, b) => (px ? Math.abs(a.s - px) - Math.abs(b.s - px) : a.s - b.s))
        .slice(0, 24)
        .sort((a, b) => b.s - a.s);
      const moneyMap = strikes.length
        ? bars(strikes.map((r) => ({ label: r.s, value: r.net })), { horizontal: true, signed: true, axis: true, height: 320, name: "net premium ($)" }) +
          '<div class="wl-note">net premium ($) per strike (nearest to spot) · <span class="pos">green = calls bought</span> · <span class="neg">red = puts bought</span></div>'
        : NO;

      // ---- dark pool shelf ------------------------------------------------
      const shelf = dpl
        .map((r) => ({ p: n(r.price), v: n(r.dark_pool_volume) }))
        .filter((r) => r.p > 0 && r.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 16)
        .sort((a, b) => b.p - a.p);
      const shelfChart = shelf.length
        ? bars(shelf.map((r) => ({ label: r.p, value: r.v, color: "#3b82f6" })), { horizontal: true, axis: true, height: 300 }) +
          '<div class="wl-note">dark-pool share volume by price — the shelves institutions traded at</div>'
        : NO;

      // ---- biggest tickets ------------------------------------------------
      const tickets = fa
        .slice()
        .sort((a, b) => n(b.total_premium) - n(a.total_premium))
        .slice(0, 14)
        .map((a) => {
          const isCall = String(a.type).toLowerCase() === "call";
          return {
            label: `${isCall ? "C" : "P"} ${a.strike} · ${shortDate(a.expiry)}${a.has_sweep ? " ⚡" : ""}`,
            value: n(a.total_premium),
            color: isCall ? "#16a34a" : "#dc2626",
          };
        });
      const ticketChart = tickets.length
        ? bars(tickets, { horizontal: true, axis: true, height: 320, name: "premium ($)" }) + '<div class="wl-note">largest single option tickets by premium ($) · ⚡ = sweep</div>'
        : NO;

      // ---- new positions (OI change) --------------------------------------
      const oi = oic
        .filter((r) => n(r.oi_change) > 0) // "new positions" = OI *increases* only
        .sort((a, b) => n(b.oi_change) - n(a.oi_change))
        .slice(0, 12)
        .map((r) => {
          const sym = String(r.option_symbol || "");
          const m = sym.match(/([CP])(\d{8})$/);
          const strike = m ? String(parseInt(m[2], 10) / 1000) : sym.slice(-6);
          const isCall = sym.includes("C0") || (m && m[1] === "C");
          return { label: `${isCall ? "C" : "P"} ${strike}`, value: n(r.oi_change), color: isCall ? "#16a34a" : "#dc2626" };
        });
      const oiChart = oi.length ? bars(oi, { horizontal: true, axis: true, height: 280 }) + '<div class="wl-note">biggest open-interest increases — fresh positions opened</div>' : NO;

      // ---- day OI change by strike: where did positions actually open? ----
      // Aggregate oi_change per strike (calls vs puts) → one diverging chart.
      const oiByStrike = {};
      arr(d.oi_change).forEach((r) => {
        const m = String(r.option_symbol || "").match(/([CP])(\d{8})$/);
        if (!m) return;
        const s = parseInt(m[2], 10) / 1000;
        oiByStrike[s] = oiByStrike[s] || { c: 0, p: 0 };
        if (m[1] === "C") oiByStrike[s].c += n(r.oi_change);
        else oiByStrike[s].p += n(r.oi_change);
      });
      const oiStrikes = Object.entries(oiByStrike)
        .map(([s, v]) => ({ s: Number(s), net: v.c - v.p, call: v.c, put: v.p }))
        .filter((r) => r.net !== 0)
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
        .slice(0, 24)
        .sort((a, b) => b.s - a.s);
      const oiStrikeBody = oiStrikes.length
        ? bars(oiStrikes.map((r) => ({ label: r.s, value: Math.round(r.net) })), { horizontal: true, signed: true, axis: true, height: 320 }) +
          '<div class="wl-note">net OI change per strike today (call Δ − put Δ) · <span class="pos">green = net call positions opened</span>, <span class="neg">red = net put positions opened</span> · hover for value</div>'
        : NO;

      // ---- net premium by expiry -----------------------------------------
      const exp = fpe
        .map((r) => ({ e: String(r.expiry || ""), net: n(r.call_premium) - n(r.put_premium) }))
        .filter((r) => r.e)
        .sort((a, b) => (a.e < b.e ? -1 : 1))
        .slice(0, 12);
      const expChart = exp.length
        ? bars(exp.map((r) => ({ label: shortDate(r.e), value: r.net })), { signed: true, axis: true, height: 180, name: "net premium ($)" }) +
          '<div class="wl-note">net premium ($) per expiry · green = calls bought, red = puts bought</div>'
        : NO;

      // NOTE: the "Net Premium · intraday" chart lives on the Flow tab (single
      // canonical copy). Whales already carries net premium by strike (Money
      // map) and by expiry, so the time-series duplicate was removed here.

      // ---- key levels vs spot --------------------------------------------
      const lv = [
        ["spot", px, "#3b82f6"],
        ["call wall", cw, "#dc2626"],
        ["put wall", pw, "#16a34a"],
        ["gamma flip", flip, "#a855f7"],
        ["magnet", magnet, "#f59e0b"],
        ["max pain", maxPain, "#eab308"],
      ].filter((x) => x[1]);
      const levelsCard = lv.length
        ? `<div class="wl-levels">${lv
            .map(([name, v, c]) => {
              const d = px ? ((v - px) / px) * 100 : 0;
              return `<div class="wl-lv"><span class="dot" style="background:${c}"></span><span class="wl-ln">${name}</span><b style="color:${c}">${num(v, 2)}</b><span class="wl-ld ${signCls(d)}">${d >= 0 ? "+" : ""}${d.toFixed(2)}%</span></div>`;
            })
            .join("")}</div><div class="wl-note">distance from spot · the levels price reacts to</div>`
        : NO;

      // ---- auto read ------------------------------------------------------
      const read = [];
      const dTop = shelf.slice().sort((a, b) => b.v - a.v);
      if (dTop.length)
        read.push(`Heaviest <b>dark-pool</b> shelves at <b style="color:#3b82f6">${dTop[0].p}</b>${dTop[1] ? ` and <b style="color:#3b82f6">${dTop[1].p}</b>` : ""} — where institutions traded the most.`);
      const big = fa.slice().sort((a, b) => n(b.total_premium) - n(a.total_premium))[0];
      if (big)
        read.push(
          `Biggest single ticket: <b class="${String(big.type).toLowerCase() === "call" ? "pos" : "neg"}">${String(big.type).toUpperCase()} ${big.strike} ${shortDate(big.expiry)}</b> for <b>${money(big.total_premium)}</b>${big.has_sweep ? ' <span class="warn">⚡ sweep</span>' : ""}.`
        );
      const sTop = strikes.slice().sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
      if (sTop.length)
        read.push(`Most one-sided strike: <b>${sTop[0].s}</b> (net <b class="${sTop[0].net >= 0 ? "pos" : "neg"}">${money(sTop[0].net)}</b>)${sTop[1] ? `, then <b>${sTop[1].s}</b> (<b class="${sTop[1].net >= 0 ? "pos" : "neg"}">${money(sTop[1].net)}</b>)` : ""}.`);
      const ncp = n(ov.net_call_premium), npp = n(ov.net_put_premium);
      const netPrem = ncp - npp; // directional: net call premium − net put premium
      if (ncp || npp)
        read.push(`Session net premium <b class="${netPrem >= 0 ? "pos" : "neg"}">${money(netPrem)}</b> (call − put) — ${netPrem >= 0 ? "money leaned <b class='pos'>bullish</b>" : "money leaned <b class='neg'>bearish</b>"}.`);
      if (flip && px) read.push(`Spot <b class="${signCls(px - flip)}">${num(px, 2)}</b> is <b>${px >= flip ? "above" : "below"}</b> the gamma flip <b style="color:#a855f7">${flip}</b> → ${px >= flip ? "dealers calm moves" : "dealers amplify moves"}.`);
      const readBody = read.length ? `<ul class="qr">${read.map((x) => `<li>${x}</li>`).join("")}</ul>` : NO;

      return (
        card("Whale read · where the money is", readBody, 4) +
        card("Money map · net premium by strike", moneyMap, 2) +
        card("Dark pool shelf · volume by price", shelfChart, 2) +
        card("Biggest tickets · top premium", ticketChart, 2) +
        card("New positions · OI change", oiChart, 2) +
        card("Day OI change · by strike", oiStrikeBody, 2) +
        card("Net premium by expiry", expChart, 2) +
        card("Key levels vs spot", levelsCard, 2)
      );
    },
    info: {
      title: "Whales",
      tagline: "Where the big players are betting — visually",
      sections: [
        {
          h: "What this tab shows",
          p: "<p>A visual answer to \"where is the smart money positioned?\". It blends <b>options flow</b> (who paid for what strike/expiry) with <b>dark-pool shelves</b> (where institutions actually traded) and the <b>gamma levels</b> price reacts to — so you can see the levels and the money at a glance.</p>",
        },
        {
          h: "Panels",
          p: "<ul>\
<li><b>Whale read</b> — auto bullets: heaviest dark-pool shelves, the biggest single ticket, the most one-sided strike, session net premium and the gamma regime.</li>\
<li><b>Money map</b> — net premium per strike as a diverging bar chart (<span class='pos'>green = calls bought</span>, <span class='neg'>red = puts bought</span>). Big bars = where the money concentrated.</li>\
<li><b>Dark pool shelf</b> — dark-pool share volume by price. The tallest bars are the shelves institutions traded at (support/resistance).</li>\
<li><b>Biggest tickets</b> — the largest single option trades by premium, coloured call/put, with ⚡ for sweeps.</li>\
<li><b>New positions</b> — biggest open-interest increases (fresh money opened today).</li>\
<li><b>Day OI change · by strike</b> — net open-interest change per strike (call Δ − put Δ) as one diverging chart: <span class='pos'>green = net call positions opened</span>, <span class='neg'>red = net put positions opened</span>. This is where today's positioning actually went — compare with the Money map (premium) to separate big-money flow from big-contract flow.</li>\
<li><b>Net premium by expiry</b> — which expiry carries the bullish/bearish money.</li>\
<li><b>Key levels vs spot</b> — call wall, put wall, gamma flip, magnet, max pain with distance from spot.</li></ul>",
        },
        {
          h: "How to read it",
          p: "<p>Start with <b>Money map</b> (which strikes carry the money), then <b>Dark pool shelf</b> (which prices institutions used), then <b>Key levels</b> (where price is likely to react). When a dark-pool shelf and a big net-premium strike line up with a gamma wall, that's a high-conviction level.</p>",
        },
        {
          h: "Good to know",
          p: "<ul><li>Net premium = call premium − put premium for that strike/expiry.</li><li>Dark-pool data is the latest session; options flow is the current session.</li><li>Premium shows the size of a bet, not its direction — the bid/ask side matters, so use it with the sweep/opening flags.</li></ul>",
        },
      ],
    },
  };
})();
