/* Options tab — contracts, volume profile, OI by strike/expiry, greeks, max pain. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, pct, signCls, shortDate, tk, table, card, bars, multi } = U.util;

  const nz = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  const arr = (v) => {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.data)) return v.data;
    return [];
  };
  const none = () => '<div class="muted" style="padding:6px">no data for this section — nothing was returned for this symbol.</div>';
  const under = (s) => {
    const m = String(s == null ? "" : s).match(/^[A-Z]+/);
    return m ? m[0] : "";
  };
  const byNum = (key) => (a, b) => nz(a[key]) - nz(b[key]);
  const byNumDesc = (key) => (a, b) => nz(b[key]) - nz(a[key]);
  const byDate = (key) => (a, b) => String(a[key] || "").localeCompare(String(b[key] || ""));

  // Two stacked single-series bar charts with a shared legend (call vs put).
  function twoBars(rows, keyA, keyB, nameA, nameB, colA, colB, h) {
    if (!rows.length) return none();
    const lab = (r) =>
      r.strike != null ? r.strike : r.expiry != null ? r.expiry : r.expires != null ? r.expires : r.date != null ? r.date : "";
    const a = rows.map((r) => ({ label: lab(r), value: nz(r[keyA]), color: colA }));
    const b = rows.map((r) => ({ label: lab(r), value: nz(r[keyB]), color: colB }));
    const lg = `<div class="legend"><span><i style="background:${colA}"></i>${esc(nameA)}</span><span><i style="background:${colB}"></i>${esc(nameB)}</span></div>`;
    return lg + bars(a, { height: h, name: nameA, axis: true }) + bars(b, { height: h, name: nameB, axis: true });
  }

  U.PANELS.options = {
    title: "Options",
    render(d) {
      d = d || {};

      // ---- contracts — top 40 by volume, premium green --------------------
      const cons = arr(d.contracts).slice().sort(byNumDesc("volume")).slice(0, 40);
      const conMaxVol = Math.max(1, ...cons.map((r) => nz(r.volume)));
      const conMaxOI = Math.max(1, ...cons.map((r) => nz(r.open_interest)));
      const conMaxGamma = Math.max(1, ...cons.map((r) => nz(r.gamma)));
      const conMaxPrem = Math.max(1, ...cons.map((r) => nz(r.total_premium)));
      const contracts = table(
        [
          { label: "Contract" },
          { label: "Vol", num: true },
          { label: "OI", num: true },
          { label: "Δ", num: true },
          { label: "Γ", num: true },
          { label: "Θ", num: true },
          { label: "IV", num: true },
          { label: "Bid", num: true },
          { label: "Ask", num: true },
          { label: "Prem", num: true },
        ],
        cons,
        (r) =>
          `<tr>
            <td>${tk(under(r.option_symbol))}<span class="muted"> ${esc(U.util.occ(r.option_symbol, { noRoot: true }))}</span></td>
            <td class="num" style="background:${U.heat(nz(r.volume), conMaxVol)}">${int(r.volume)}</td>
            <td class="num muted" style="background:${U.heat(nz(r.open_interest), conMaxOI)}">${int(r.open_interest)}</td>
            <td class="num ${signCls(r.delta)}">${num(r.delta, 2)}</td>
            <td class="num" style="background:${U.heat(nz(r.gamma), conMaxGamma)}">${num(r.gamma, 3)}</td>
            <td class="num ${signCls(r.theta)}">${num(r.theta, 2)}</td>
            <td class="num">${pct(r.implied_volatility, 1)}</td>
            <td class="num muted">${num(r.nbbo_bid, 2)}</td>
            <td class="num muted">${num(r.nbbo_ask, 2)}</td>
            <td class="num pos" style="background:${U.heat(nz(r.total_premium), conMaxPrem)}">${money(r.total_premium)}</td>
          </tr>`
      );

      // ---- price levels — call vs put volume profile ----------------------
      const pl = arr(d.price_levels).slice().sort(byNum("price"));
      const profile = pl.length
        ? `<div class="legend"><span class="muted">${esc(num(pl[0].price, 2))} – ${esc(num(pl[pl.length - 1].price, 2))}</span></div>` +
          multi(
            [
              { name: "Call vol", color: "#16a34a", data: pl.map((r) => nz(r.call_volume)) },
              { name: "Put vol", color: "#dc2626", data: pl.map((r) => nz(r.put_volume)) },
            ],
            { height: 175, x: pl.map((r) => (r.price != null ? Number(r.price).toFixed(2) : "")), axis: true }
          )
        : none();

      // ---- expiry breakdown — volume bars + table -------------------------
      const eb = arr(d.expiry_breakdown).slice().sort(byDate("expires"));
      const ebMaxOI = Math.max(1, ...eb.map((r) => nz(r.open_interest)));
      const ebMaxVol = Math.max(1, ...eb.map((r) => nz(r.volume)));
      const expiryCard = eb.length
        ? bars(eb.map((r) => ({ label: shortDate(r.expires), value: nz(r.volume), color: "#3b82f6" })), { height: 145 }) +
          table(
            [
              { label: "Expiry" },
              { label: "OI", num: true },
              { label: "Vol", num: true },
              { label: "Chains", num: true },
            ],
            eb,
            (r) =>
              `<tr><td>${esc(r.expires)}</td><td class="num" style="background:${U.heat(nz(r.open_interest), ebMaxOI)}">${int(r.open_interest)}</td><td class="num" style="background:${U.heat(nz(r.volume), ebMaxVol)}">${int(r.volume)}</td><td class="num muted">${int(r.chains)}</td></tr>`
          )
        : none();

      // ---- OI by strike (call vs put) -------------------------------------
      const ops = arr(d.oi_per_strike).slice().sort(byNum("strike"));
      const oiStrike = twoBars(ops, "call_oi", "put_oi", "Call OI", "Put OI", "#3b82f6", "#f59e0b", 130);

      // ---- OI by expiry ---------------------------------------------------
      const ope = arr(d.oi_per_expiry).slice().sort(byDate("expiry"));
      const oiExpiry = twoBars(ope, "call_oi", "put_oi", "Call OI", "Put OI", "#3b82f6", "#f59e0b", 130);

      // ---- volume vs OI by expiry -----------------------------------------
      const voe = arr(d.volume_oi_expiry).slice().sort(byDate("expires"));
      const volOi = twoBars(voe, "volume", "oi", "Volume", "OI", "#3b82f6", "#f59e0b", 130);

      // ---- greeks by strike ----------------------------------------------
      const gk = arr(d.greeks).slice().sort(byNum("strike"));
      const gkMaxCG = Math.max(1, ...gk.map((r) => nz(r.call_gamma)));
      const gkMaxPG = Math.max(1, ...gk.map((r) => nz(r.put_gamma)));
      const greeks = table(
        [
          { label: "Strike", num: true },
          { label: "Call Δ", num: true },
          { label: "Call Γ", num: true },
          { label: "Put Δ", num: true },
          { label: "Put Γ", num: true },
          { label: "Contracts" },
        ],
        gk,
        (r) =>
          `<tr>
            <td class="num">${esc(r.strike)}</td>
            <td class="num ${signCls(r.call_delta)}">${num(r.call_delta, 3)}</td>
            <td class="num" style="background:${U.heat(nz(r.call_gamma), gkMaxCG)}">${num(r.call_gamma, 3)}</td>
            <td class="num ${signCls(r.put_delta)}">${num(r.put_delta, 3)}</td>
            <td class="num" style="background:${U.heat(nz(r.put_gamma), gkMaxPG)}">${num(r.put_gamma, 3)}</td>
            <td class="muted" title="${esc(r.call_option_symbol || "")} ${esc(r.put_option_symbol || "")}">${esc(U.util.occ(r.call_option_symbol, { noRoot: true }))} / ${esc(U.util.occ(r.put_option_symbol, { noRoot: true }))}</td>
          </tr>`
      );

      // ---- max pain -------------------------------------------------------
      const mp = arr(d.max_pain);
      const maxPain = table(
        [
          { label: "Expiry" },
          { label: "Max Pain", num: true },
          { label: "Close", num: true },
          { label: "Dist", num: true },
          { label: "Upper", num: true },
          { label: "Lower", num: true },
        ],
        mp,
        (r) => {
          const close = nz(r.close);
          const dist = close ? ((close - nz(r.max_pain)) / close) * 100 : null;
          return `<tr>
            <td>${esc(r.expiry)}</td>
            <td class="num">${esc(r.max_pain)}</td>
            <td class="num muted">${esc(r.close)}</td>
            <td class="num ${dist == null ? "" : signCls(-dist)}">${dist == null ? "–" : dist.toFixed(2) + "%"}</td>
            <td class="num muted">${esc(r.next_upper_strike)}</td>
            <td class="num muted">${esc(r.next_lower_strike)}</td>
          </tr>`;
        }
      );

      // ---- ATM chains -----------------------------------------------------
      const atm = arr(d.atm_chains).slice().sort(byNumDesc("volume")).slice(0, 20);
      const atmMaxVol = Math.max(1, ...atm.map((r) => nz(r.volume)));
      const atmMaxOI = Math.max(1, ...atm.map((r) => nz(r.open_interest)));
      const atmMaxPrem = Math.max(1, ...atm.map((r) => nz(r.premium)));
      const atmChains = table(
        [
          { label: "Contract" },
          { label: "Vol", num: true },
          { label: "OI", num: true },
          { label: "IV", num: true },
          { label: "Open", num: true },
          { label: "High", num: true },
          { label: "Low", num: true },
          { label: "Close", num: true },
          { label: "Trades", num: true },
          { label: "Prem", num: true },
        ],
        atm,
        (r) =>
          `<tr>
            <td>${tk(under(r.option_symbol))}<span class="muted"> ${esc(U.util.occ(r.option_symbol, { noRoot: true }))}</span></td>
            <td class="num" style="background:${U.heat(nz(r.volume), atmMaxVol)}">${int(r.volume)}</td>
            <td class="num muted" style="background:${U.heat(nz(r.open_interest), atmMaxOI)}">${int(r.open_interest)}</td>
            <td class="num">${pct(r.iv, 1)}</td>
            <td class="num muted">${num(r.open, 2)}</td>
            <td class="num">${num(r.high, 2)}</td>
            <td class="num">${num(r.low, 2)}</td>
            <td class="num">${num(r.close, 2)}</td>
            <td class="num muted">${int(r.trades)}</td>
            <td class="num pos" style="background:${U.heat(nz(r.premium), atmMaxPrem)}">${money(r.premium)}</td>
          </tr>`
      );

      return (
        card("Contracts · top 40 by volume", contracts, 2) +
        card("Volume Profile · call vs put by price", profile, 2) +
        card("Expiry Breakdown", expiryCard, 2) +
        card("Open Interest by Expiry", oiExpiry, 2) +
        card("Volume vs OI by Expiry", volOi, 2) +
        card("Greeks by Strike", greeks, 2) +
        card("ATM Chains", atmChains, 1)
      );
    },
    info: {
      title: "Options",
      tagline: "Where volume, open interest and positioning agree — or disagree",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>The positioning snapshot: which contracts traded, where <b>volume and open interest</b> sit by strike and expiry, how <b>greeks</b> concentrate, and where <b>max pain</b> pulls price. A sweep matters more when its strike holds real OI below the call wall.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>Contracts</b> (top 40 by <code>volume</code>): <code>option_symbol</code>, <code>volume</code>, <code>open_interest</code>, <code>delta</code>, <code>gamma</code>, <code>theta</code>, <code>implied_volatility</code>, <code>nbbo_bid</code>, <code>nbbo_ask</code>, <code>total_premium</code>.</li><li><b>Volume Profile</b> (call vs put by price): <code>price</code>, <code>call_volume</code>, <code>put_volume</code>.</li><li><b>Expiry Breakdown</b>: <code>expires</code>, <code>open_interest</code>, <code>volume</code>, <code>chains</code>.</li><li><b>OI by Strike / OI by Expiry</b>: <code>strike</code> / <code>expiry</code>, <code>call_oi</code>, <code>put_oi</code>.</li><li><b>Volume vs OI by Expiry</b>: <code>expires</code>, <code>volume</code>, <code>oi</code>.</li><li><b>Greeks by Strike</b>: <code>strike</code>, <code>call_delta</code>, <code>call_gamma</code>, <code>put_delta</code>, <code>put_gamma</code>, <code>call_option_symbol</code>, <code>put_option_symbol</code>.</li><li><b>Max Pain</b>: <code>expiry</code>, <code>max_pain</code>, <code>close</code>, <code>next_upper_strike</code>, <code>next_lower_strike</code>.</li><li><b>ATM Chains</b>: <code>option_symbol</code>, <code>volume</code>, <code>open_interest</code>, <code>iv</code>, <code>open</code>, <code>high</code>, <code>low</code>, <code>close</code>, <code>trades</code>, <code>premium</code>.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p><b>Volume without OI is a day trade; volume building OI is a position.</b> Favour strikes where <code>volume &gt; open_interest</code> with ask-side fills (check Flow), sitting <b>below the call wall</b> with room to the next level. Fade far-OTM call piles at the wall in positive gamma.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>NVDA spot 224.48 | 2026-09-25 expiry: volume 946,096 / OI 880,960 / 160 chains\nNVDA260925C00225000: volume 260,174 / OI 38,416 (vol >> OI), delta 0.46, IV 33%.\nMax pain 222.5 (spot +0.9% above); 225 = heaviest call OI; call wall 227.5.\nTrade: long 225/227.5 call spread 5-10 min after the sweep; stop below 223;\ntarget the 227.5 wall.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>/option-contracts</code> <code>/option/stock-price-levels</code> <code>/expiry-breakdown</code> <code>/oi-per-strike</code> <code>/oi-per-expiry</code> <code>/option/volume-oi-expiry</code> <code>/greeks</code> <code>/max-pain</code> <code>/atm-chains</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>OI restates overnight — intraday <code>volume &gt; OI</code> is provisional.</li><li>Max pain uses the last close, not live spot.</li><li>Some <code>oi-*</code>/<code>greeks</code> calls need a higher tier.</li></ul>`,
        },
      ],
    },
  };
})();
