/* Flow tab — net premium ticks, alerts, tape, per-strike/expiry, OI change, greeks, NOPE. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, pct, signCls, shortDate, pill, tk, table, card, kpiBig, bars, line, multi } = U.util;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) && !v.__error ? v : null);
  const empty = '<div class="muted" style="padding:6px">no data for this section — nothing was returned for this symbol.</div>';
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

  // ---- strike × time heatmap (5-min ET buckets, full session) ------------
  // Uses flow_per_strike_intraday: one row per (timestamp, strike) with
  // net/call/put_premium + volume. Buckets are 5-min wall-clock ET; ordering
  // uses the absolute ms of the bucket so a session never mis-sorts.
  const ST_BUCKET_MS = 5 * 60 * 1000;
  const ST_METRICS = [
    { id: "net", label: "Net", field: "net_premium", money: true },
    { id: "call", label: "Call", field: "call_premium", money: true },
    { id: "put", label: "Put", field: "put_premium", money: true },
    { id: "vol", label: "Volume", field: "volume", money: false },
  ];
  let stMetric = "net";
  let _stEtFmt = null;
  function stEtLabel(ms) {
    try {
      if (!_stEtFmt) {
        _stEtFmt = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        });
      }
      const p = _stEtFmt.formatToParts(new Date(ms));
      const h = p.find((x) => x.type === "hour");
      const m = p.find((x) => x.type === "minute");
      return (h ? h.value : "00") + ":" + (m ? m.value : "00");
    } catch (e) {
      const d = new Date(ms - 4 * 3600 * 1000);
      return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
    }
  }
  function stModel(rows, field) {
    const cells = new Map(); // strikeKey|bucketMs -> summed value
    const strikeSet = new Map(); // strikeKey -> numeric strike
    const bucketSet = new Map(); // bucketMs -> ET HH:MM label
    arr(rows).forEach((r) => {
      const ts = Date.parse(r.timestamp);
      if (isNaN(ts)) return;
      const b = Math.floor(ts / ST_BUCKET_MS) * ST_BUCKET_MS;
      const sk = String(r.strike);
      if (!strikeSet.has(sk)) strikeSet.set(sk, N(r.strike));
      if (!bucketSet.has(b)) bucketSet.set(b, stEtLabel(b));
      const k = sk + "|" + b;
      cells.set(k, (cells.get(k) || 0) + N(r[field]));
    });
    const strikes = [...strikeSet.keys()].sort((a, b) => strikeSet.get(b) - strikeSet.get(a));
    const buckets = [...bucketSet.keys()].sort((a, b) => a - b);
    return {
      strikes: strikes,
      buckets: buckets,
      bucketLabel: bucketSet,
      get: (sk, b) => (cells.has(sk + "|" + b) ? cells.get(sk + "|" + b) : null),
    };
  }
  function stMatrixHtml(rows) {
    const metric = ST_METRICS.find((x) => x.id === stMetric) || ST_METRICS[0];
    const m = stModel(rows, metric.field);
    if (!m.strikes.length || !m.buckets.length) return empty;
    return U.util.matrix({
      rows: m.strikes,
      cols: m.buckets,
      get: m.get,
      fmt: metric.money ? (v) => money(v) : (v) => int(v),
      height: 372,
      corner: "strike",
      rowFmt: (sk) => sk,
      colFmt: (b) => m.bucketLabel.get(b),
    });
  }
  function stControlsHtml(rows) {
    const n = arr(rows).length;
    return `<div class="presets">${ST_METRICS.map(
      (x) => `<button class="preset ${x.id === stMetric ? "on" : ""}" data-st="${x.id}">${x.label}</button>`
    ).join("")}<span class="muted" style="padding:0 6px">${n} ticks · 5-min ET buckets · full session</span></div>`;
  }

  U.PANELS.flow = {
    title: "Flow",
    render(d) {
      d = d || {};

      // ---- net premium ticks (call vs put premium + underlying) ------------
      // Canonical "Net Premium · intraday" chart. Data convention (openapi.yaml):
      //   net_call_premium = call ask − call bid  => positive = calls BOUGHT  (bullish)
      //   net_put_premium  = put  ask − put  bid  => positive = puts  BOUGHT  (bearish)
      //   directional net premium = net_call_premium − net_put_premium  (NEVER add them)
      // Premium series are plotted in $M so the shared $ axis stays compact; the
      // series name carries the unit into the legend + tooltip.
      const npt = arr(d.net_prem_ticks);
      const ncS = npt.map((r) => N(r.net_call_premium));
      const npS = npt.map((r) => N(r.net_put_premium));
      const pxS = U.util.priceSeries(npt.map((r) => r.tape_time || r.date), d.spot_exposures);
      const toM = (a) => a.map((v) => N(v) / 1e6);
      const ncLast = ncS.length ? ncS[ncS.length - 1] : 0;
      const npLast = npS.length ? npS[npS.length - 1] : 0;
      const netPrem = ncLast - npLast; // directional: call-buying minus put-buying
      const pxLast = pxS.length ? pxS[pxS.length - 1] : 0;
      const nptBody = npt.length
        ? `<div class="kpis">
             ${kpiBig("Net call prem", money(ncLast), "latest tick", signCls(ncLast))}
             ${kpiBig("Net put prem", money(npLast), "latest tick", signCls(npLast))}
             ${kpiBig("Net premium", money(netPrem), "call − put · latest tick", signCls(netPrem))}
             ${kpiBig("Underlying", pxLast ? num(pxLast) : "–", last(npt) ? esc(U.util.et(last(npt).tape_time || last(npt).date)) : "")}
           </div>
           ${multi(
             [
               { name: "Net call prem ($M)", color: "#16a34a", data: toM(ncS) },
               { name: "Net put prem ($M)", color: "#dc2626", data: toM(npS) },
             ],
             { height: 150, axis: true, x: npt.map((r) => U.util.et(r.tape_time || r.date)), levels: [{ value: 0, color: "#64748b", label: "0" }] }
           )}
           ${pxS.some((v) => v) ? `<div class="legend" style="padding-top:0;padding-bottom:0"><span class="muted">underlying price ($) · amber</span></div>${line(pxS, { stroke: "#f59e0b", height: 60 })}` : ""}
           <div class="wl-note">Net premium by tick (ask − bid): <span class="pos">green = calls bought (bullish)</span>, <span class="neg">red = puts bought (bearish)</span>. Above the zero line = net bullish money. Directional net premium = call − put.</div>`
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
          <td class="muted" title="${esc(r.option_chain || "")}">${esc(U.util.occ(r.option_chain))}</td>
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
        // explicit hex (not CSS vars) so ECharts canvas actually paints the legend's
        // green = calls / red = puts instead of a default blue
        divItems.push({ label: s.strike, value: s.call, color: "#16a34a" });
        divItems.push({ label: s.strike, value: -s.put, color: "#dc2626" });
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
        (r) => `<tr><td class="muted" title="${esc(r.option_symbol || "")}">${esc(U.util.occ(r.option_symbol))}</td><td class="num ${signCls(r.oi_change)}" style="background:${U.heat(N(r.oi_change), oiMaxChg)}">${int(r.oi_change)}</td><td class="num" style="background:${U.heat(N(r.curr_oi), oiMaxCur)}">${int(r.curr_oi)}</td><td class="num" style="background:${U.heat(N(r.volume), oiMaxVol)}">${int(r.volume)}</td><td class="num">${num(r.avg_price, 3)}</td><td class="num">${num(r.last_fill, 2)}</td></tr>`
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

      // ---- strike × time heatmap (5-min ET buckets, full session) ----------
      const stRows = arr(d.flow_per_strike_intraday);
      const strikeTimeBody = stRows.length
        ? `<div id="fst-ctrl">${stControlsHtml(stRows)}</div>` +
          `<div id="fst-wrap">${stMatrixHtml(stRows)}</div>` +
          '<div class="wl-note">Sum of the selected metric per <b>strike</b> (rows, descending) × <b>5-minute ET bucket</b> (cols): <span class="pos">green = positive</span>, <span class="neg">red = negative</span>, intensity ∝ magnitude. Every strike and bucket present in <code>flow_per_strike_intraday</code> is shown — scroll both axes, nothing is truncated. Toggle <b>Net</b> / <b>Call</b> / <b>Put</b> / <b>Volume</b>.</div>'
        : empty;

      return (
        card("Net Premium · intraday", nptBody, 4) +
        card("Per-Expiry Volume", expBody, 1) +
        card("Flow Alerts · largest premium", alertsBody, 3) +
        card("Flow Tape · top prints", tapeBody, 2) +
        card("Call vs Put · by strike", strikeBody, 2) +
        card("Strike × Time Flow · 5-min ET", strikeTimeBody, 4) +
        card("OI Change", oiBody, 2) +
        card("Greek Flow", gfBody, 2) +
        card("NOPE", nopeBody, 4)
      );
    },
    afterRender(pane, ticker, payload) {
      const rows = arr(payload && payload.data && payload.data.flow_per_strike_intraday);
      if (!rows.length) return;
      const ctrl = pane.querySelector("#fst-ctrl");
      const wrap = pane.querySelector("#fst-wrap");
      if (!ctrl || !wrap) return;
      const paint = () => {
        wrap.innerHTML = stMatrixHtml(rows);
        ctrl.innerHTML = stControlsHtml(rows);
        ctrl.querySelectorAll("[data-st]").forEach((b) => {
          b.onclick = () => {
            stMetric = b.dataset.st;
            paint();
          };
        });
      };
      paint();
    },
    info: {
      title: "Flow",
      tagline: "Whose money is moving, where, and how aggressively — in one screen",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Intraday options order flow for the ticker: <b>net premium direction</b> (<code>net_prem_ticks</code>), the biggest institutional prints (<code>flow_alerts</code>, <code>flow_recent</code>), positioning by <b>strike</b> and <b>expiry</b> (<code>flow_per_strike</code>, <code>flow_per_expiry</code>), fresh positioning (<code>oi_change</code>), directional exposure (<code>greek_flow</code>) and hedging pressure (<code>nope</code>). Flow is <em>intent</em>: traders paying up for a position right now.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>Net Premium · intraday</b> — <code>net_call_premium</code> vs <code>net_put_premium</code> per <code>tape_time</code> tick, with <code>underlying_price</code> underneath; which side paid more premium today. <code>net_call_premium</code> = call premium ask − bid (<span class='pos'>positive = calls bought</span>); <code>net_put_premium</code> = put premium ask − bid (<span class='neg'>positive = puts bought</span>). The <b>Net premium</b> KPI is directional: <code>net_call_premium − net_put_premium</code> (above the zero line = net bullish money). Premium series are charted in <b>$M</b>. The KPIs show the <b>latest tick</b>; the chart is the whole session.</li><li><b>Per-Expiry Volume</b> — <code>call_volume</code>, <code>put_volume</code> and net <code>call_premium − put_premium</code> per <code>expiry</code>; where the betting concentrates.</li><li><b>Flow Alerts · largest premium</b> — top prints by <code>total_premium</code> with <code>volume</code>, <code>volume_oi_ratio</code>, <code>iv</code>, <code>delta</code> and <code>has_sweep</code> / <code>has_multileg</code> / <code>all_opening_trades</code> flags. The <b>Side</b> column infers <code>BTO</code> (buy to open), <code>STO</code>, <code>BTC</code>, <code>STC</code> from ask-vs-bid premium and whether the trade opened — green = bullish side, red = bearish.</li><li><b>Flow Tape · top prints</b> — largest <code>flow_recent</code> prints by <code>volume</code>: <code>strike</code>, <code>option_type</code>, <b>Side</b> (<code>BTO/STO/BTC/STC</code> from <code>ask_vol</code>/<code>bid_vol</code>), <code>price</code>, <code>delta</code>, <code>gamma</code>, <code>implied_volatility</code>, <code>nbbo_bid</code>/<code>nbbo_ask</code>.</li><li><b>Call vs Put · by strike</b> — <code>call_volume</code>/<code>put_volume</code> and <code>call_premium</code>/<code>put_premium</code> aggregated per strike; bars plus top-10 table.</li><li><b>Strike × Time Flow · 5-min ET</b> — <code>net_premium</code>/<code>call_premium</code>/<code>put_premium</code>/<code>volume</code> summed per <b>strike</b> × <b>5-minute ET bucket</b>; every strike and bucket in <code>flow_per_strike_intraday</code> is shown, toggle <b>Net</b>/<b>Call</b>/<b>Put</b>/<b>Volume</b>.</li><li><b>OI Change</b> — <code>option_symbol</code>, <code>oi_change</code>, <code>curr_oi</code>, <code>volume</code>, <code>avg_price</code>, <code>last_fill</code>; new positions vs churn.</li><li><b>Greek Flow</b> — <code>dir_delta_flow</code>, <code>dir_vega_flow</code>, <code>otm_dir_delta_flow</code>; directional delta and vol exposure being added.</li><li><b>NOPE</b> — <code>nope</code> and <code>nope_fill</code> with <code>call_vol</code>/<code>put_vol</code>; net options hedging pressure on the stock.</li></ul>`,
        },
        {
          h: "Strike × Time Flow",
          p: `<ul><li><b>Rows</b> are strikes in descending order; <b>columns</b> are 5-minute wall-clock <b>ET</b> buckets across the whole session. Timestamps in <code>flow_per_strike_intraday</code> are ISO-UTC; each is floored to its 5-minute bucket, converted to <code>America/New_York</code> for the column label, and buckets are ordered by absolute time so a session can never mis-sort.</li><li><b>Cells</b> are the sum of the selected metric over every row landing in that (strike, bucket): <b>Net</b> = <code>net_premium</code> (green positive / red negative), <b>Call</b> = <code>call_premium</code>, <b>Put</b> = <code>put_premium</code>, <b>Volume</b> = <code>volume</code>. Premium cells are formatted as money, volume as integers; a dot means no trades for that strike in that bucket.</li><li><b>Full data</b> — every strike and every bucket present in the payload is rendered; the card scrolls both axes and a bounded max-height (~372px) keeps it inside the viewport. Nothing is sliced or top-N'd.</li><li>Read it as a <b>time-resolved strike ladder</b>: a row that lights up green across consecutive buckets is sustained call buying at that strike; a single bright cell is a one-off whale print (cross-check <b>Flow Alerts</b>); red put rows below spot are hedging/downside bets.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p>Trust <b>confluence, not single prints</b>: an opening ask-side call sweep with <code>volume_oi_ratio</code> well above 1 and <code>total_premium</code> ≥ $500k means more when net call premium is rising, Greek <code>dir_delta_flow</code> agrees and the strike sits below the call wall — the <b>sweep-continuation</b> setup. Repeated far-OTM call sweeps that fail to lift spot into a call wall are <b>exhaustion</b>: fade them. Rising <code>oi_change</code> with volume confirms new positioning; high volume with flat OI is closing or day-trading noise.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>NVDA spot 224.50 | Net call prem +$8.2M, net put prem −$1.1M (rising into close)
Alert: 225 call, 0DTE, $1.4M premium, vol/OI 3.2, sweep + opening flags, delta 0.46
Greek dir-delta flow positive, OI rising on 225C
Decision: long 5–10 min after the sweep settles, stop below the sweep print
level (~223.80), first target the 227.50 call wall.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>/api/stock/{ticker}/net-prem-ticks</code> <code>/flow-per-expiry</code> <code>/flow-alerts</code> <code>/flow-recent</code> <code>/flow-per-strike</code> <code>/oi-change</code> <code>/greek-flow</code> <code>/nope</code> <code>/options-volume</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Flow shows <em>paid premium and volume</em>, not who traded or why — sweeps can hedge as well as speculate.</li><li>Intraday ticks restate; OI updates the next morning, so late-session <code>oi_change</code> is provisional.</li><li>Pre-market and thin names can show empty panels — that is missing data, not bearish flow.</li></ul>`,
        },
      ],
    },
  };
})();
