/* Flow tab — net premium ticks, alerts, tape, per-strike/expiry, OI change, greeks, NOPE. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, pct, signCls, shortDate, pill, tk, table, card, kpiBig, bars, line, multi } = U.util;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) && !v.__error ? v : null);
  const empty = '<div class="muted" style="padding:6px">no data</div>';
  const N = (v) => Number(v) || 0;
  const last = (a) => (a && a.length ? a[a.length - 1] : null);

  // sum call/put volume + premium per strike across intraday rows
  function byStrike(rows) {
    const m = new Map();
    rows.forEach((r) => {
      const k = String(r.strike);
      const o = m.get(k) || { strike: r.strike, call: 0, put: 0, callPrem: 0, putPrem: 0 };
      o.call += N(r.call_volume);
      o.put += N(r.put_volume);
      o.callPrem += N(r.call_premium);
      o.putPrem += N(r.put_premium);
      m.set(k, o);
    });
    return [...m.values()].sort((a, b) => N(b.call) + N(b.put) - (N(a.call) + N(a.put)));
  }

  U.PANELS.flow = {
    title: "Flow",
    render(d) {
      d = d || {};

      // ---- net premium ticks (call vs put premium + underlying) ------------
      const npt = arr(d.net_prem_ticks);
      const ncS = npt.map((r) => N(r.net_call_premium));
      const npS = npt.map((r) => N(r.net_put_premium));
      const pxS = npt.map((r) => N(r.underlying_price));
      const ncLast = ncS.length ? ncS[ncS.length - 1] : 0;
      const npLast = npS.length ? npS[npS.length - 1] : 0;
      const netTot = ncLast + npLast;
      const pxLast = pxS.length ? pxS[pxS.length - 1] : 0;
      const nptBody = npt.length
        ? `<div class="kpis">
             ${kpiBig("Net call prem", money(ncLast), "latest tick", signCls(ncLast))}
             ${kpiBig("Net put prem", money(npLast), "latest tick", signCls(npLast))}
             ${kpiBig("Net total", money(netTot), "latest tick", signCls(netTot))}
             ${kpiBig("Underlying", pxLast ? num(pxLast) : "–", last(npt) ? esc(String(last(npt).tape_time || "").slice(11, 16)) : "")}
           </div>
           ${multi(
             [
               { name: "Net call prem", color: "#16a34a", data: ncS },
               { name: "Net put prem", color: "#dc2626", data: npS },
             ],
             { height: 150 }
           )}
           ${pxS.some((v) => v) ? `<div class="legend" style="padding-top:0;padding-bottom:0"><span class="muted">underlying price</span></div>${line(pxS, { stroke: "#f59e0b", height: 66 })}` : ""}`
        : empty;

      // ---- options pulse (sentiment) + latest session volume ---------------
      const op = obj(d.options_pulse) || {};
      const latest = op.latest || {};
      const intra = arr(op.intraday);
      const ovRows = arr(d.options_volume);
      const ov = ovRows.length ? ovRows[0] : {};
      const sntm = N(latest.sntm_score);
      const intvl = N(latest.intvl_sntm_score);
      const callTxn = N(latest.call_txn);
      const putTxn = N(latest.put_txn);
      const sntmS = intra.map((r) => N(r.sntm_score));
      const intvlS = intra.map((r) => N(r.intvl_sntm_score));
      const pulseDate = latest.trd_dt ? String(latest.trd_dt).slice(5) : "";
      const pulseBody =
        latest.sntm_score != null || ovRows.length
          ? `<div class="kpis">
               ${kpiBig("Sentiment", latest.sntm_score != null ? pct(sntm) : "–", pulseDate ? "prior " + esc(pulseDate) : latest.hr_min ? "t " + esc(latest.hr_min) : "", signCls(sntm))}
               ${kpiBig("Intvl", latest.intvl_sntm_score != null ? pct(intvl) : "–", "", signCls(intvl))}
               ${kpiBig("Call txn", int(callTxn), "")}
               ${kpiBig("Put txn", int(putTxn), "")}
               ${kpiBig("P/C txn", callTxn ? (putTxn / callTxn).toFixed(2) : "–", "")}
               ${kpiBig("Call vol", int(ov.call_volume), "avg30 " + int(ov.avg_30_day_call_volume))}
               ${kpiBig("Put vol", int(ov.put_volume), "avg30 " + int(ov.avg_30_day_put_volume))}
               ${kpiBig("Call prem", money(ov.call_premium), "net " + money(ov.net_call_premium), signCls(ov.net_call_premium))}
               ${kpiBig("Put prem", money(ov.put_premium), "net " + money(ov.net_put_premium), signCls(ov.net_put_premium))}
             </div>
             ${intra.length ? multi([{ name: "sntm", color: "#3b82f6", data: sntmS }, { name: "intvl", color: "#f59e0b", data: intvlS }], { height: 120 }) : ""}`
          : empty;

      // ---- flow per expiry -------------------------------------------------
      const expRows = arr(d.flow_per_expiry)
        .slice()
        .sort((a, b) => N(b.call_volume) + N(b.put_volume) - (N(a.call_volume) + N(a.put_volume)))
        .slice(0, 9);
      const expMaxCall = Math.max(1, ...expRows.map((r) => N(r.call_volume)));
      const expMaxPut = Math.max(1, ...expRows.map((r) => N(r.put_volume)));
      const expMaxNet = Math.max(1, ...expRows.map((r) => Math.abs(N(r.call_premium) - N(r.put_premium))));
      const expBody = table(
        [{ label: "Exp" }, { label: "Call", num: true }, { label: "Put", num: true }, { label: "Net prem", num: true }],
        expRows,
        (r) => `<tr><td>${esc(shortDate(r.expiry))}</td><td class="num pos" style="background:${U.heat(N(r.call_volume), expMaxCall)}">${int(r.call_volume)}</td><td class="num neg" style="background:${U.heat(N(r.put_volume), expMaxPut)}">${int(r.put_volume)}</td><td class="num ${signCls(N(r.call_premium) - N(r.put_premium))}" style="background:${U.heat(N(r.call_premium) - N(r.put_premium), expMaxNet)}">${money(N(r.call_premium) - N(r.put_premium))}</td></tr>`
      );

      // ---- flow alerts (largest premium first) -----------------------------
      const alerts = arr(d.flow_alerts)
        .slice()
        .sort((a, b) => N(b.total_premium) - N(a.total_premium))
        .slice(0, 15);
      const alMaxPrem = Math.max(1, ...alerts.map((r) => N(r.total_premium)));
      const alMaxVol = Math.max(1, ...alerts.map((r) => N(r.volume)));
      const alMaxVOI = Math.max(1, ...alerts.map((r) => N(r.volume_oi_ratio)));
      const flags = (r) =>
        (r.has_sweep ? pill("sweep", "buy") : "") +
        (r.has_multileg ? pill("multi") : "") +
        (r.all_opening_trades ? pill("open") : "");
      // Buy/sell + open/close side inferred from ask-vs-bid premium and
      // whether the trade opened (all_opening_trades or V/OI >= 1.5).
      // BTO = buy to open, STO = sell to open, BTC/STC = closes.
      const sideOf = (r, ask, bid, isCall) => {
        const tot = ask + bid;
        if (!(tot > 0)) return "";
        const opening = r.all_opening_trades || N(r.volume_oi_ratio) >= 1.5 || N(r.volume) >= 1.5 * N(r.open_interest);
        const buySide = ask >= bid;
        const label = buySide ? (opening ? "BTO" : "BTC") : opening ? "STO" : "STC";
        // bullish: call-BTO, put-STO. bearish: put-BTO, call-STO. closes: muted.
        const dir = !opening ? "" : isCall === buySide ? "buy" : "sell";
        const pct = Math.round((Math.max(ask, bid) / tot) * 100);
        return `<span class="pill ${dir}" title="${pct}% ${buySide ? "ask" : "bid"}-side">${label}</span>`;
      };
      const alertsBody = table(
        [
          { label: "Tkr" },
          { label: "Chain" },
          { label: "Exp" },
          { label: "Strike", num: true },
          { label: "Side" },
          { label: "Prem", num: true },
          { label: "Vol", num: true },
          { label: "V/OI", num: true },
          { label: "IV", num: true },
          { label: "Δ", num: true },
          { label: "Flags" },
        ],
        alerts,
        (r) => `<tr>
          <td>${tk(r.ticker)}</td>
          <td class="muted">${esc(r.option_chain || "")}</td>
          <td>${esc(shortDate(r.expiry))}</td>
          <td class="num">${esc(r.strike)}</td>
          <td>${sideOf(r, N(r.total_ask_side_prem), N(r.total_bid_side_prem), String(r.type).toLowerCase() === "call")}</td>
          <td class="num pos" style="background:${U.heat(N(r.total_premium), alMaxPrem)}">${money(r.total_premium)}</td>
          <td class="num" style="background:${U.heat(N(r.volume), alMaxVol)}">${int(r.volume)}</td>
          <td class="num" style="background:${U.heat(N(r.volume_oi_ratio), alMaxVOI)}">${num(r.volume_oi_ratio, 2)}</td>
          <td class="num">${pct(r.iv)}</td>
          <td class="num ${signCls(r.delta)}">${num(r.delta, 2)}</td>
          <td>${flags(r)}</td>
        </tr>`
      );

      // ---- raw tape (top prints by volume) ---------------------------------
      const tape = arr(d.flow_recent)
        .slice()
        .sort((a, b) => N(b.volume) - N(a.volume))
        .slice(0, 15);
      const tapeMaxVol = Math.max(1, ...tape.map((r) => N(r.volume)));
      const tapeMaxPrem = Math.max(1, ...tape.map((r) => N(r.volume) * N(r.price) * 100));
      const tapeBody = table(
        [
          { label: "Tkr" },
          { label: "Exp" },
          { label: "Strike", num: true },
          { label: "Side" },
          { label: "Vol", num: true },
          { label: "Px", num: true },
          { label: "Prem", num: true },
          { label: "Δ", num: true },
          { label: "γ", num: true },
          { label: "IV", num: true },
          { label: "Bid", num: true },
          { label: "Ask", num: true },
        ],
        tape,
        (r) => {
          const vol = N(r.volume);
          const px = N(r.price);
          const put = r.option_type === "put";
          return `<tr>
            <td>${tk(r.underlying_symbol || r.ticker)}</td>
            <td>${esc(shortDate(r.expiry))}</td>
            <td class="num">${esc(r.strike)} <span class="${put ? "neg" : "pos"}">${put ? "P" : "C"}</span></td>
            <td>${sideOf(r, N(r.ask_vol), N(r.bid_vol), !put)}</td>
            <td class="num" style="background:${U.heat(vol, tapeMaxVol)}">${int(vol)}</td>
            <td class="num">${num(px)}</td>
            <td class="num pos" style="background:${U.heat(vol * px * 100, tapeMaxPrem)}">${money(vol * px * 100)}</td>
            <td class="num ${signCls(r.delta)}">${num(r.delta, 2)}</td>
            <td class="num">${num(r.gamma, 3)}</td>
            <td class="num">${pct(r.implied_volatility)}</td>
            <td class="num muted">${num(r.nbbo_bid)}</td>
            <td class="num muted">${num(r.nbbo_ask)}</td>
          </tr>`;
        }
      );

      // ---- call vs put volume by strike ------------------------------------
      const strk = byStrike(arr(d.flow_per_strike));
      const topStrikes = strk.slice(0, 30).sort((a, b) => N(a.strike) - N(b.strike));
      const divItems = [];
      topStrikes.forEach((s) => {
        divItems.push({ label: s.strike, value: s.call });
        divItems.push({ label: s.strike, value: -s.put });
      });
      const strkTop = strk.slice(0, 10);
      const stMaxCall = Math.max(1, ...strkTop.map((s) => N(s.call)));
      const stMaxPut = Math.max(1, ...strkTop.map((s) => N(s.put)));
      const stMaxNet = Math.max(1, ...strkTop.map((s) => Math.abs(N(s.call) - N(s.put))));
      const stMaxPrem = Math.max(1, ...strkTop.map((s) => Math.abs(N(s.callPrem) - N(s.putPrem))));
      const strikeBody = strk.length
        ? `<div class="legend"><span><i style="background:var(--pos)"></i>Calls</span><span><i style="background:var(--neg)"></i>Puts (down)</span><span class="muted">top ${topStrikes.length} strikes by volume</span></div>
           ${bars(divItems, { height: 116 })}
           ${table(
             [{ label: "Strike", num: true }, { label: "Call", num: true }, { label: "Put", num: true }, { label: "Net vol", num: true }, { label: "Net prem", num: true }],
             strkTop,
             (s) => `<tr><td class="num">${esc(s.strike)}</td><td class="num pos" style="background:${U.heat(N(s.call), stMaxCall)}">${int(s.call)}</td><td class="num neg" style="background:${U.heat(N(s.put), stMaxPut)}">${int(s.put)}</td><td class="num ${signCls(s.call - s.put)}" style="background:${U.heat(N(s.call) - N(s.put), stMaxNet)}">${int(s.call - s.put)}</td><td class="num ${signCls(s.callPrem - s.putPrem)}" style="background:${U.heat(N(s.callPrem) - N(s.putPrem), stMaxPrem)}">${money(s.callPrem - s.putPrem)}</td></tr>`
           )}`
        : empty;

      // ---- OI change -------------------------------------------------------
      const oi = arr(d.oi_change)
        .slice()
        .sort((a, b) => Math.abs(N(b.oi_change)) - Math.abs(N(a.oi_change)))
        .slice(0, 15);
      const oiMaxChg = Math.max(1, ...oi.map((r) => Math.abs(N(r.oi_change))));
      const oiMaxCur = Math.max(1, ...oi.map((r) => N(r.curr_oi)));
      const oiMaxVol = Math.max(1, ...oi.map((r) => N(r.volume)));
      const oiBody = table(
        [{ label: "Contract" }, { label: "OI Δ", num: true }, { label: "Curr OI", num: true }, { label: "Vol", num: true }, { label: "Avg", num: true }, { label: "Last", num: true }],
        oi,
        (r) => `<tr><td class="muted">${esc(r.option_symbol)}</td><td class="num ${signCls(r.oi_change)}" style="background:${U.heat(N(r.oi_change), oiMaxChg)}">${int(r.oi_change)}</td><td class="num" style="background:${U.heat(N(r.curr_oi), oiMaxCur)}">${int(r.curr_oi)}</td><td class="num" style="background:${U.heat(N(r.volume), oiMaxVol)}">${int(r.volume)}</td><td class="num">${num(r.avg_price, 3)}</td><td class="num">${num(r.last_fill, 2)}</td></tr>`
      );

      // ---- greek flow ------------------------------------------------------
      const gf = arr(d.greek_flow);
      const gDelta = gf.map((r) => N(r.dir_delta_flow));
      const gVega = gf.map((r) => N(r.dir_vega_flow));
      const gOtm = gf.map((r) => N(r.otm_dir_delta_flow));
      const gfBody = gf.length
        ? `<div class="kpis">
             ${kpiBig("Δ flow", money(last(gDelta)), "", signCls(last(gDelta)))}
             ${kpiBig("Vega flow", money(last(gVega)), "", signCls(last(gVega)))}
             ${kpiBig("OTM Δ flow", money(last(gOtm)), "", signCls(last(gOtm)))}
           </div>
           ${multi(
             [
               { name: "Dir Δ flow", color: "#3b82f6", data: gDelta },
               { name: "Dir vega flow", color: "#a855f7", data: gVega },
               { name: "OTM Δ flow", color: "#f59e0b", data: gOtm },
             ],
             { height: 150 }
           )}`
        : empty;

      // ---- NOPE ------------------------------------------------------------
      const nope = arr(d.nope);
      const nopeS = nope.map((r) => N(r.nope));
      const nopeF = nope.map((r) => N(r.nope_fill));
      const nopeCall = nope.map((r) => N(r.call_vol));
      const nopePut = nope.map((r) => N(r.put_vol));
      const nopeBody = nope.length
        ? `<div class="kpis">
             ${kpiBig("NOPE", num(last(nopeS), 3), "", signCls(last(nopeS)))}
             ${kpiBig("NOPE fill", num(last(nopeF), 3), "", signCls(last(nopeF)))}
             ${kpiBig("Call vol", int(last(nopeCall)), "")}
             ${kpiBig("Put vol", int(last(nopePut)), "")}
           </div>
           ${multi([{ name: "NOPE", color: "#3b82f6", data: nopeS }, { name: "NOPE fill", color: "#f59e0b", data: nopeF }], { height: 132 })}`
        : empty;

      return (
        card("Options Pulse · prior session", pulseBody, 2) +
        card("Per-Expiry Volume", expBody, 1) +
        card("Flow Alerts · largest premium", alertsBody, 3) +
        card("Flow Tape · top prints", tapeBody, 2) +
        card("Call vs Put · by strike", strikeBody, 2) +
        card("OI Change", oiBody, 2) +
        card("Greek Flow", gfBody, 2) +
        card("NOPE", nopeBody, 4)
      );
    },
    info: {
      title: "Flow",
      tagline: "Whose money is moving, where, and how aggressively — in one screen",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Intraday options order flow for the ticker: <b>net premium direction</b> (<code>net_prem_ticks</code>), session <b>sentiment</b> (<code>options_pulse</code>), the biggest institutional prints (<code>flow_alerts</code>, <code>flow_recent</code>), positioning by <b>strike</b> and <b>expiry</b> (<code>flow_per_strike</code>, <code>flow_per_expiry</code>), fresh positioning (<code>oi_change</code>), directional exposure (<code>greek_flow</code>) and hedging pressure (<code>nope</code>). Flow is <em>intent</em>: traders paying up for a position right now.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>Net Premium · intraday</b> — <code>net_call_premium</code> vs <code>net_put_premium</code> per <code>tape_time</code> tick, with <code>underlying_price</code> underneath; which side paid more premium today. The KPIs show the <b>latest tick</b>; the chart is the whole session.</li><li><b>Options Pulse · prior session</b> — <code>sntm_score</code>, <code>intvl_sntm_score</code>, <code>call_txn</code>/<code>put_txn</code> plus session <code>call_volume</code>, <code>put_volume</code> vs <code>avg_30_day</code> averages and net premium. This endpoint only populates for <b>completed</b> sessions, so intraday it shows the most recent prior trading day (labelled <code>prior MM-DD</code>).</li><li><b>Per-Expiry Volume</b> — <code>call_volume</code>, <code>put_volume</code> and net <code>call_premium − put_premium</code> per <code>expiry</code>; where the betting concentrates.</li><li><b>Flow Alerts · largest premium</b> — top prints by <code>total_premium</code> with <code>volume</code>, <code>volume_oi_ratio</code>, <code>iv</code>, <code>delta</code> and <code>has_sweep</code> / <code>has_multileg</code> / <code>all_opening_trades</code> flags. The <b>Side</b> column infers <code>BTO</code> (buy to open), <code>STO</code>, <code>BTC</code>, <code>STC</code> from ask-vs-bid premium and whether the trade opened — green = bullish side, red = bearish.</li><li><b>Flow Tape · top prints</b> — largest <code>flow_recent</code> prints by <code>volume</code>: <code>strike</code>, <code>option_type</code>, <b>Side</b> (<code>BTO/STO/BTC/STC</code> from <code>ask_vol</code>/<code>bid_vol</code>), <code>price</code>, <code>delta</code>, <code>gamma</code>, <code>implied_volatility</code>, <code>nbbo_bid</code>/<code>nbbo_ask</code>.</li><li><b>Call vs Put · by strike</b> — <code>call_volume</code>/<code>put_volume</code> and <code>call_premium</code>/<code>put_premium</code> aggregated per strike; bars plus top-10 table.</li><li><b>OI Change</b> — <code>option_symbol</code>, <code>oi_change</code>, <code>curr_oi</code>, <code>volume</code>, <code>avg_price</code>, <code>last_fill</code>; new positions vs churn.</li><li><b>Greek Flow</b> — <code>dir_delta_flow</code>, <code>dir_vega_flow</code>, <code>otm_dir_delta_flow</code>; directional delta and vol exposure being added.</li><li><b>NOPE</b> — <code>nope</code> and <code>nope_fill</code> with <code>call_vol</code>/<code>put_vol</code>; net options hedging pressure on the stock.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p>Trust <b>confluence, not single prints</b>: an opening ask-side call sweep with <code>volume_oi_ratio</code> well above 1 and <code>total_premium</code> ≥ $500k means more when net call premium is rising, <code>sntm_score</code> is positive, Greek <code>dir_delta_flow</code> agrees and the strike sits below the call wall — the <b>sweep-continuation</b> setup. Repeated far-OTM call sweeps that fail to lift spot into a call wall are <b>exhaustion</b>: fade them. Rising <code>oi_change</code> with volume confirms new positioning; high volume with flat OI is closing or day-trading noise.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>NVDA spot 224.50 | Net call prem +$8.2M, net put prem −$1.1M (rising into close)
Alert: 225 call, 0DTE, $1.4M premium, vol/OI 3.2, sweep + opening flags, delta 0.46
Pulse sntm 0.47, Greek dir-delta flow positive, OI rising on 225C
Decision: long 5–10 min after the sweep settles, stop below the sweep print
level (~223.80), first target the 227.50 call wall.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>/api/stock/{ticker}/net-prem-ticks</code> <code>/options-pulse</code> <code>/flow-per-expiry</code> <code>/flow-alerts</code> <code>/flow-recent</code> <code>/flow-per-strike</code> <code>/oi-change</code> <code>/greek-flow</code> <code>/nope</code> <code>/options-volume</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Flow shows <em>paid premium and volume</em>, not who traded or why — sweeps can hedge as well as speculate.</li><li>Intraday ticks restate; OI updates the next morning, so late-session <code>oi_change</code> is provisional.</li><li>Pre-market and thin names can show empty panels — that is missing data, not bearish flow.</li></ul>`,
        },
      ],
    },
  };
})();
