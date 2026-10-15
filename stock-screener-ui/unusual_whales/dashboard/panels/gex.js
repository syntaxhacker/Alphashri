/* GEX / Greeks tab — dealer gamma levels, greek exposure by strike/expiry/day,
 * spot exposures (strike + intraday), max pain, and open interest by strike. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, int, signCls, shortDate, pill, table, card, kpiBig, hbars, line, multi } = U.util;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const err = (v) => (v && v.__error ? v : null);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};
  const n = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  const cn = (v) => {
    const x = n(v);
    const a = Math.abs(x);
    if (a >= 1e9) return (x / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (x / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (x / 1e3).toFixed(1) + "K";
    return x.toFixed(1);
  };
  // strike prices are never "compact" — 2250 must read as 2250, not 2.3K
  const strikeStr = (v) => (v == null ? "" : String(Number(v)));
  const miss = (what) => `<div class="muted" style="padding:6px">${esc(what)} unavailable</div>`;
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;

  U.PANELS.gex = {
    title: "GEX / Greeks",
    render(raw) {
      const d = raw || {};

      /* -- 1. dealer gamma levels ------------------------------------------ */
      const glErr = err(d.gex_levels);
      const gl = glErr ? {} : first(d.gex_levels);
      const flips = arr(gl.nearby_flips);
      const gammaBody =
        glErr && gl.call_wall == null
          ? miss("gamma levels")
          : `<div class="kpis">
               ${kpiBig("Call wall", gl.call_wall != null ? esc(gl.call_wall) : "–", "resistance", "neg")}
               ${kpiBig("Put wall", gl.put_wall != null ? esc(gl.put_wall) : "–", "support", "pos")}
               ${kpiBig("Gamma flip", gl.gamma_flip != null ? esc(gl.gamma_flip) : "–", "regime")}
               ${kpiBig("Magnet", gl.gamma_magnet != null ? esc(gl.gamma_magnet) : "–", "pin")}
               ${kpiBig("Nearby flips", flips.length ? String(flips.length) : "–", flips.length ? flips.map((f) => esc(f)).join(" · ") : "–")}
             </div>
             <div class="kv">
               <div><span>Source</span><b>${gl.source ? pill(gl.source) : "–"}</b></div>
               <div><span>As of</span><b>${esc(gl.date || "–")} ${esc(String(gl.time || "").slice(11, 16))}</b></div>
             </div>`;

      /* -- 2. net GEX by strike -------------------------------------------- */
      const gsErr = err(d.greek_exposure_strike);
      const gs = gsErr ? [] : arr(d.greek_exposure_strike);
      const net = gs.map((r) => ({ label: String(r.strike), value: n(r.call_gex) + n(r.put_gex) }));
      const totNet = net.reduce((s, r) => s + r.value, 0);
      const posN = net.filter((r) => r.value > 0).length;
      const negN = net.filter((r) => r.value < 0).length;
      const top20 = net
        .slice()
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 20)
        .sort((a, b) => b.value - a.value);
      const byVal = net.slice().sort((a, b) => b.value - a.value);
      const best = byVal[0] || null;
      const worst = byVal.length ? byVal[byVal.length - 1] : null;
      const netBody =
        gsErr || !net.length
          ? miss("greek exposure by strike")
          : `<div class="kpis">
               ${kpiBig("Net GEX", cn(totNet), "all strikes", signCls(totNet))}
               ${kpiBig("Strikes", String(net.length), "+" + posN + " / −" + negN)}
               ${kpiBig("Top +", best && best.value > 0 ? esc(best.label) : "–", best && best.value > 0 ? cn(best.value) : "", "pos")}
               ${kpiBig("Top −", worst && worst.value < 0 ? esc(worst.label) : "–", worst && worst.value < 0 ? cn(worst.value) : "", "neg")}
             </div>
             ${hbars(
               top20.map((r) => ({ label: r.label, value: r.value, right: cn(r.value) })),
               { signed: true }
             )}`;

      /* -- 3. GEX by expiry (table) --------------------------------------- */
      const geErr = err(d.greek_exposure_expiry);
      const ge = (geErr ? [] : arr(d.greek_exposure_expiry)).slice().sort((a, b) => n(a.dte) - n(b.dte));
      const geMaxCall = Math.max(1, ...ge.map((r) => n(r.call_gex)));
      const geMaxPut = Math.max(1, ...ge.map((r) => Math.abs(n(r.put_gex))));
      const geMaxNet = Math.max(1, ...ge.map((r) => Math.abs(n(r.call_gex) + n(r.put_gex))));
      const expiryBody =
        geErr || !ge.length
          ? miss("greek exposure by expiry")
          : table(
              [
                { label: "Expiry" },
                { label: "DTE", num: true },
                { label: "Call GEX", num: true },
                { label: "Put GEX", num: true },
                { label: "Net", num: true },
                { label: "Call δ", num: true },
              ],
              ge,
              (r) => {
                const nv = n(r.call_gex) + n(r.put_gex);
                return `<tr><td>${esc(r.expiry)}</td><td class="num muted">${int(r.dte)}</td><td class="num pos" style="background:${U.heat(n(r.call_gex), geMaxCall)}">${cn(r.call_gex)}</td><td class="num neg" style="background:${U.heat(n(r.put_gex), geMaxPut)}">${cn(r.put_gex)}</td><td class="num ${signCls(nv)}" style="background:${U.heat(nv, geMaxNet)}">${cn(nv)}</td><td class="num ${signCls(r.call_delta)}">${cn(r.call_delta)}</td></tr>`;
              }
            );

      /* -- 4. dealer gamma · daily --------------------------------------- */
      const gdErr = err(d.greek_exposure_daily);
      const gd = gdErr ? [] : arr(d.greek_exposure_daily);
      const gammaDaily =
        gdErr || !gd.length
          ? miss("greek exposure daily")
          : multi(
              [
                { name: "Call γ", color: "#16a34a", data: gd.map((r) => n(r.call_gamma)) },
                { name: "Put γ", color: "#dc2626", data: gd.map((r) => n(r.put_gamma)) },
              ],
              { height: 170 }
            ) +
            cap(
              `${esc((gd[0] && gd[0].date) || "")} → ${esc((gd[gd.length - 1] && gd[gd.length - 1].date) || "")} · ${gd.length} sessions`
            );

      /* -- 5. spot gamma vol by strike ----------------------------------- */
      const seErr = err(d.spot_exposure_strike);
      const se = (seErr ? [] : arr(d.spot_exposure_strike))
        .map((r) => ({ strike: n(r.strike), c: n(r.call_gamma_vol), p: n(r.put_gamma_vol) }))
        .filter((r) => r.strike > 0);
      const sePick = se
        .slice()
        .sort((a, b) => Math.max(Math.abs(b.c), Math.abs(b.p)) - Math.max(Math.abs(a.c), Math.abs(a.p)))
        .slice(0, 40)
        .sort((a, b) => a.strike - b.strike);
      const spotVolBody =
        seErr || !sePick.length
          ? miss("spot exposure by strike")
          : multi(
              [
                { name: "Call γ vol", color: "#16a34a", data: sePick.map((r) => r.c) },
                { name: "Put γ vol", color: "#dc2626", data: sePick.map((r) => r.p) },
              ],
              { height: 160, x: sePick.map((r) => r.strike), axis: true }
            ) +
            cap(
              `top ${sePick.length} of ${se.length} strikes · ${strikeStr(sePick[0] && sePick[0].strike)} → ${strikeStr(sePick[sePick.length - 1] && sePick[sePick.length - 1].strike)}`
            );

      /* -- 6. spot gamma · intraday -------------------------------------- */
      const sdErr = err(d.spot_exposure_daily);
      const sdAll = sdErr ? [] : arr(d.spot_exposure_daily);
      const day = sdAll.length ? String(sdAll[sdAll.length - 1].time || "").slice(0, 10) : "";
      const sd = day ? sdAll.filter((r) => String(r.time || "").slice(0, 10) === day) : sdAll;
      const sdVals = sd.map((r) => n(r.gamma_per_one_percent_move_dir));
      const sdLast = sdVals.length ? sdVals[sdVals.length - 1] : null;
      const sdMax = sdVals.length ? Math.max(...sdVals) : null;
      const sdMin = sdVals.length ? Math.min(...sdVals) : null;
      const spotBody =
        sdErr || !sdVals.length
          ? miss("spot exposure intraday")
          : `<div class="kpis">
               ${kpiBig("Spot γ / 1%", sdLast == null ? "–" : cn(sdLast), day || "", signCls(sdLast))}
               ${kpiBig("Session max", sdMax == null ? "–" : cn(sdMax), "", "pos")}
               ${kpiBig("Session min", sdMin == null ? "–" : cn(sdMin), "", "neg")}
               ${kpiBig("Points", String(sdVals.length), "intraday")}
             </div>
             ${line(sdVals, { stroke: "#3b82f6", fill: "#3b82f6", height: 150 })}`;

      /* -- 7. max pain ---------------------------------------------------- */
      const mpErr = err(d.max_pain);
      const mp = mpErr ? [] : arr(d.max_pain);
      const mpBody =
        mpErr || !mp.length
          ? miss("max pain")
          : table(
              [
                { label: "Expiry" },
                { label: "Max pain", num: true },
                { label: "Close", num: true },
                { label: "Dist", num: true },
                { label: "Next ↑", num: true },
                { label: "Next ↓", num: true },
              ],
              mp,
              (r) => {
                const close = n(r.close);
                const mpx = n(r.max_pain);
                const dist = close ? ((close - mpx) / close) * 100 : null;
                return `<tr><td>${esc(r.expiry)}</td><td class="num">${esc(r.max_pain)}</td><td class="num muted">${esc(r.close)}</td><td class="num ${dist == null ? "" : signCls(-dist)}">${dist == null ? "–" : dist.toFixed(2) + "%"}</td><td class="num pos">${esc(r.next_upper_strike)}</td><td class="num neg">${esc(r.next_lower_strike)}</td></tr>`;
              }
            );

      /* -- 8. open interest by strike ------------------------------------ */
      const oiErr = err(d.oi_per_strike);
      const oi = (oiErr ? [] : arr(d.oi_per_strike))
        .map((r) => ({ strike: n(r.strike), c: n(r.call_oi), p: n(r.put_oi) }))
        .filter((r) => r.strike > 0);
      const oiPick = oi
        .slice()
        .sort((a, b) => Math.max(b.c, b.p) - Math.max(a.c, a.p))
        .slice(0, 40)
        .sort((a, b) => a.strike - b.strike);
      const oiBody =
        oiErr || !oiPick.length
          ? miss("open interest by strike")
          : multi(
              [
                { name: "Call OI", color: "#3b82f6", data: oiPick.map((r) => r.c) },
                { name: "Put OI", color: "#f59e0b", data: oiPick.map((r) => r.p) },
              ],
              { height: 160, x: oiPick.map((r) => r.strike), axis: true }
            ) +
            cap(`top ${oiPick.length} of ${oi.length} strikes by OI`);

      /* -- 9. spot exposures by expiry / strike -------------------------- */
      const sbErr = err(d.spot_by_expiry_strike);
      const sb = sbErr ? [] : arr(d.spot_by_expiry_strike);
      const sbTop = sb
        .slice()
        .sort((a, b) => Math.abs(n(b.call_charm_oi)) - Math.abs(n(a.call_charm_oi)))
        .slice(0, 25);
      const sbMaxGamma = Math.max(1, ...sbTop.map((r) => n(r.call_gamma_vol)));
      const sbMaxCharm = Math.max(1, ...sbTop.map((r) => Math.abs(n(r.call_charm_oi))));
      const sbMaxVanna = Math.max(1, ...sbTop.map((r) => Math.abs(n(r.call_vanna_oi))));
      const sbMaxDelta = Math.max(1, ...sbTop.map((r) => n(r.call_delta_vol)));
      const spotStrikeBody =
        sbErr || !sbTop.length
          ? miss("spot exposures by expiry/strike")
          : table(
              [
                { label: "Expiry" },
                { label: "Strike", num: true },
                { label: "Price", num: true },
                { label: "Call γ vol", num: true },
                { label: "Call charm OI", num: true },
                { label: "Call vanna OI", num: true },
                { label: "Call δ vol", num: true },
              ],
              sbTop,
              (r) =>
                `<tr><td>${esc(shortDate(r.expiry))}</td><td class="num">${esc(r.strike)}</td><td class="num muted">${num(r.price)}</td><td class="num" style="background:${U.heat(n(r.call_gamma_vol), sbMaxGamma)}">${cn(r.call_gamma_vol)}</td><td class="num ${signCls(r.call_charm_oi)}" style="background:${U.heat(n(r.call_charm_oi), sbMaxCharm)}">${cn(r.call_charm_oi)}</td><td class="num ${signCls(r.call_vanna_oi)}" style="background:${U.heat(n(r.call_vanna_oi), sbMaxVanna)}">${cn(r.call_vanna_oi)}</td><td class="num" style="background:${U.heat(n(r.call_delta_vol), sbMaxDelta)}">${cn(r.call_delta_vol)}</td></tr>`
            );

      return (
        card("Dealer Gamma Levels", gammaBody, 4) +
        card("Net GEX by Strike · top 20", netBody, 2) +
        card("GEX by Expiry", expiryBody, 2) +
        card("Dealer Gamma · daily (call vs put)", gammaDaily, 2) +
        card("Spot Gamma Volume by Strike · call vs put", spotVolBody, 2) +
        card("Spot Gamma · intraday (γ / 1% move)", spotBody, 2) +
        card("Max Pain", mpBody, 2) +
        card("Open Interest by Strike · call vs put", oiBody, 2) +
        card("Spot Exposures by Expiry / Strike · top charm OI", spotStrikeBody, 2)
      );
    },
    info: {
      title: "GEX / Greeks",
      tagline: "Dealer positioning map: where gamma pins price and where it breaks",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>GEX (gamma exposure) estimates how option dealers must hedge. When dealers are long gamma they trade <em>against</em> the move and dampen volatility; when short gamma they chase the move and amplify it. This tab maps that pressure by strike, by expiry and intraday, plus max pain and open interest, so you can see supports, resistances and squeeze risk before expiry.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>Dealer Gamma Levels</b> — key strikes from <code>gex_levels</code>: <code>call_wall</code> (resistance), <code>put_wall</code> (support), <code>gamma_flip</code> (regime line), <code>gamma_magnet</code> (pin), <code>nearby_flips</code>, plus <code>source</code> and <code>date</code>.</li><li><b>Net GEX by Strike (top 20)</b> — from <code>greek_exposure_strike</code>: net per strike is <code>call_gex</code> + <code>put_gex</code>, ranked by absolute size; KPIs show total net, strike count and top +/- strikes.</li><li><b>GEX by Expiry</b> — from <code>greek_exposure_expiry</code>: <code>expiry</code>, <code>dte</code>, <code>call_gex</code>, <code>put_gex</code>, net and <code>call_delta</code>, sorted by DTE.</li><li><b>Dealer Gamma · daily</b> — from <code>greek_exposure_daily</code>: <code>call_gamma</code> vs <code>put_gamma</code> trend over sessions.</li><li><b>Spot Gamma Volume by Strike</b> — from <code>spot_exposure_strike</code>: <code>call_gamma_vol</code> vs <code>put_gamma_vol</code> across the top 40 strikes by size.</li><li><b>Spot Gamma · intraday</b> — from <code>spot_exposure_daily</code>: <code>gamma_per_one_percent_move_dir</code> through the latest session, with last / max / min KPIs.</li><li><b>Max Pain</b> — from <code>max_pain</code>: <code>max_pain</code>, <code>close</code>, distance %, <code>next_upper_strike</code> and <code>next_lower_strike</code> per expiry.</li><li><b>Open Interest by Strike</b> — from <code>oi_per_strike</code>: <code>call_oi</code> vs <code>put_oi</code> for the top 40 strikes by OI.</li><li><b>Spot Exposures by Expiry/Strike</b> — from <code>spot_by_expiry_strike</code>, top 25 by charm: <code>expiry</code>, <code>strike</code>, <code>price</code>, <code>call_gamma_vol</code>, <code>call_charm_oi</code>, <code>call_vanna_oi</code>, <code>call_delta_vol</code>.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p><b>Positive gamma</b> (spot above <code>gamma_flip</code>): dealers fade moves, so expect chop and pinning between the walls toward the <code>gamma_magnet</code> — sell premium or fade wall tests. <b>Negative gamma</b> (spot below the flip): dealer hedging accelerates moves — trade breakouts with wider stops and avoid short premium. Walls are profit-taking zones; the flip is the regime switch: hold above it stays bullish-compressed, loss of it opens a fast move toward the put wall.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>NVDA  spot 226.06  |  flip 224.0  call wall 227.5  put wall 217.5  magnet 225
Net GEX +1.4M (positive)  |  max pain 225 (Sept expiry)  |  intraday spot-gamma +2.1M
Reading: spot > flip with positive net GEX and max pain at 225 = pin regime.
Decision: fade a push to the 227.5 call wall — sell the 227.5/230 call spread,
stop on a 15-min close above 228, target a drift back to the 225 magnet / max pain.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>/api/stock/{ticker}/gex-levels</code> <code>/greek-exposure/strike</code> <code>/greek-exposure/expiry</code> <code>/greek-exposure</code> <code>/spot-exposures/strike</code> <code>/spot-exposures</code> <code>/max-pain</code> <code>/oi-per-strike</code> <code>/spot-exposures/{expiry}/strike</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>GEX is an estimate from positioned OI/volume, not a live dealer book — walls and flips shift after big flow or expiry.</li><li>Max pain uses the last close, so its distance % lags intraday spot.</li><li>Spot-gamma intraday covers the latest session only; compare with the daily gamma trend before sizing breakouts.</li></ul>`,
        },
      ],
    },
  };
})();
