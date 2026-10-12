/* NSE option-chain tab — OI ladder, change-in-OI and volume by strike.
 *
 * Backend: GET /api/symbol/{T} -> {ticker, spot, chain: {expiry, strikes:
 * [{strike, ce_oi, pe_oi, ce_oich, pe_oich, ce_vol, pe_vol, ce_ltp, pe_ltp}]},
 * expiries, call_oi, put_oi, as_of} plus levels: {pcr, max_pain, resistance,
 * support}.
 *
 * NOTE on level lines: the vendored bars helper (charts.js barsOption) has no
 * markLine/levels support — only the line helper does, and price levels are
 * not Y-values on an OI chart. So spot / support / resistance / max pain are
 * marked "where the helpers allow": the ATM strike (nearest to spot) is
 * highlighted inside the ladder, and the exact level values + distances sit
 * in the caption strip above it. All quantities are SHARES (lot size differs
 * per stock — never assume it).
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, signCls, table, card } = U.util;

  const CE = "#16a34a", PE = "#dc2626", ATM = "#3b82f6";

  const nz = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const inr = (v) =>
    v == null || isNaN(Number(v))
      ? "–"
      : "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qty = (v) => {
    const x = nz(v), a = Math.abs(x);
    if (a >= 1e7) return (x / 1e7).toFixed(2) + " Cr";
    if (a >= 1e5) return (x / 1e5).toFixed(2) + " L";
    if (a >= 1e3) return (x / 1e3).toFixed(1) + "K";
    return String(Math.round(x));
  };
  const heat = (v, m) => (U.heat ? U.heat(v, m) : "");
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;
  const miss = (what) => `<div class="muted" style="padding:6px">${esc(what)} unavailable</div>`;
  const legend = (items) =>
    `<div class="legend">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join("")}</div>`;
  const dist = (lvl, spot) =>
    lvl && spot ? (((lvl - spot) / spot) * 100).toFixed(2) + "%" : "–";

  // Normalize the /api/symbol/{T} payload no matter which render arg it arrives in.
  function norm(data, full) {
    const p = full && full.chain ? full : data && data.chain ? data : data || {};
    const chain = p.chain || {};
    const rows = arr(chain.strikes)
      .map((r) => ({
        strike: nz(r.strike),
        ce: nz(r.ce_oi),
        pe: nz(r.pe_oi),
        cChg: nz(r.ce_oich),
        pChg: nz(r.pe_oich),
        cVol: nz(r.ce_vol),
        pVol: nz(r.pe_vol),
        cLtp: r.ce_ltp,
        pLtp: r.pe_ltp,
      }))
      .filter((r) => r.strike > 0)
      .sort((a, b) => a.strike - b.strike);
    const spot = p.spot != null && !isNaN(Number(p.spot)) ? Number(p.spot) : null;
    let atm = -1;
    if (spot != null) {
      let best = Infinity;
      rows.forEach((r, i) => {
        const d = Math.abs(r.strike - spot);
        if (d < best) { best = d; atm = i; }
      });
    }
    return {
      ticker: p.ticker,
      spot,
      expiry: chain.expiry || p.expiry || "",
      expiries: arr(p.expiries),
      asOf: p.as_of || chain.as_of || "",
      callOi: nz(p.call_oi),
      putOi: nz(p.put_oi),
      levels: p.levels || {},
      rows,
      atm,
    };
  }

  function levelStrip(n) {
    const L = n.levels || {};
    const bits = [];
    if (n.spot != null) bits.push(`Spot <b>${inr(n.spot)}</b>`);
    if (L.resistance != null) bits.push(`R <b class="neg">${inr(L.resistance)}</b> (${esc(dist(Number(L.resistance), n.spot))})`);
    if (L.support != null) bits.push(`S <b class="pos">${inr(L.support)}</b> (${esc(dist(Number(L.support), n.spot))})`);
    if (L.max_pain != null) bits.push(`Max pain <b>${inr(L.max_pain)}</b> (${esc(dist(Number(L.max_pain), n.spot))})`);
    if (L.pcr != null) bits.push(`PCR <b>${esc(num(L.pcr))}</b>`);
    return bits.length ? `<div class="kv" style="grid-template-columns:1fr"><div><span>Levels</span><b>${bits.join(" · ")}</b></div></div>` : "";
  }

  // Diverging horizontal bars: CE OI right (green), PE OI left (red, negated).
  // Goes through charts.js directly (two series — util.bars only does one).
  function ladderChart(n) {
    if (!U.charts) return miss("charts");
    const h = Math.max(240, Math.min(560, n.rows.length * 18 + 40));
    return U.charts.register({
      kind: "bars",
      height: h,
      horizontal: true,
      axis: true,
      categories: n.rows.map((r) => String(num(r.strike, 0))),
      series: [
        {
          name: "CE OI",
          color: CE,
          data: n.rows.map((r) => r.ce),
          itemColors: n.rows.map((_, i) => (i === n.atm ? ATM : CE)),
        },
        {
          name: "PE OI",
          color: PE,
          data: n.rows.map((r) => -r.pe),
          itemColors: n.rows.map((_, i) => (i === n.atm ? ATM : PE)),
        },
      ],
    });
  }

  // Two stacked single-series bar charts with a shared legend (call vs put).
  function twoBars(rows, keyA, keyB, nameA, nameB, colA, colB, h) {
    if (!rows.length || !U.util.bars) return miss(nameA + " / " + nameB);
    const lab = (r) => String(num(r.strike, 0));
    const a = rows.map((r) => ({ label: lab(r), value: nz(r[keyA]), color: colA }));
    const b = rows.map((r) => ({ label: lab(r), value: nz(r[keyB]), color: colB }));
    return (
      legend([[colA, nameA], [colB, nameB]]) +
      U.util.bars(a, { height: h, name: nameA, axis: true }) +
      U.util.bars(b, { height: h, name: nameB, axis: true })
    );
  }

  function ladderCard(n) {
    if (!n.rows.length) return card("OI Ladder · calls vs puts by strike", miss("option chain"), 4);
    const atmNote = n.atm >= 0 ? `ATM <b>${esc(num(n.rows[n.atm].strike, 0))}</b> highlighted` : "";
    const body =
      levelStrip(n) +
      legend([[CE, "CE OI (shares)"], [PE, "PE OI (shares)"], [ATM, "ATM strike"]]) +
      ladderChart(n) +
      cap(
        `expiry <b>${esc(n.expiry)}</b> · as of <b>${esc(n.asOf || "–")}</b> · ${n.rows.length} strikes · ${atmNote} · all quantities in <b>shares</b>`
      );
    return card(`OI Ladder · ${esc(n.expiry)}`, body, 4);
  }

  function chgCard(n) {
    if (!n.rows.length) return card("Change in OI · fresh positioning", miss("change in OI"), 2);
    const totC = n.rows.reduce((s, r) => s + r.cChg, 0);
    const totP = n.rows.reduce((s, r) => s + r.pChg, 0);
    const top = n.rows.slice().sort((a, b) => Math.abs(b.cChg) + Math.abs(b.pChg) - (Math.abs(a.cChg) + Math.abs(a.pChg)))[0];
    const body =
      `<div class="kpis">` +
      `<div class="kpi"><div class="kpi-l">CE ΔOI</div><div class="kpi-v ${signCls(totC)}">${esc(qty(totC))}</div><div class="kpi-s">shares</div></div>` +
      `<div class="kpi"><div class="kpi-l">PE ΔOI</div><div class="kpi-v ${signCls(totP)}">${esc(qty(totP))}</div><div class="kpi-s">shares</div></div>` +
      `<div class="kpi"><div class="kpi-l">Net Δ</div><div class="kpi-v ${signCls(totC - totP)}">${esc(qty(totC - totP))}</div><div class="kpi-s">CE−PE</div></div>` +
      `<div class="kpi"><div class="kpi-l">Hottest</div><div class="kpi-v">${top ? esc(num(top.strike, 0)) : "–"}</div><div class="kpi-s">strike</div></div>` +
      `</div>` +
      twoBars(n.rows, "cChg", "pChg", "CE ΔOI", "PE ΔOI", CE, PE, 140) +
      cap(`CE build-up = fresh shorts/resistance · PE build-up = fresh support · shares, expiry <b>${esc(n.expiry)}</b>`);
    return card("Change in OI · fresh positioning", body, 2);
  }

  function volumeCard(n) {
    if (!n.rows.length) return card("Volume · CE vs PE by strike", miss("volume"), 2);
    const totC = n.rows.reduce((s, r) => s + r.cVol, 0);
    const totP = n.rows.reduce((s, r) => s + r.pVol, 0);
    const vpcr = totC ? totP / totC : null;
    const body =
      `<div class="kpis">` +
      `<div class="kpi"><div class="kpi-l">CE vol</div><div class="kpi-v pos">${esc(qty(totC))}</div><div class="kpi-s">shares</div></div>` +
      `<div class="kpi"><div class="kpi-l">PE vol</div><div class="kpi-v neg">${esc(qty(totP))}</div><div class="kpi-s">shares</div></div>` +
      `<div class="kpi"><div class="kpi-l">Vol PCR</div><div class="kpi-v ${vpcr == null ? "" : signCls(1 - vpcr)}">${vpcr == null ? "–" : vpcr.toFixed(2)}</div><div class="kpi-s">PE/CE</div></div>` +
      `</div>` +
      twoBars(n.rows, "cVol", "pVol", "CE vol", "PE vol", CE, PE, 140) +
      cap(`traded volume by strike · shares · expiry <b>${esc(n.expiry)}</b> · as of <b>${esc(n.asOf || "–")}</b>`);
    return card("Volume · CE vs PE by strike", body, 2);
  }

  function strikeTable(n) {
    if (!n.rows.length) return card("Strike OI · CE vs PE", miss("strikes"), 4);
    const maxCe = Math.max(1, ...n.rows.map((r) => r.ce));
    const maxPe = Math.max(1, ...n.rows.map((r) => r.pe));
    const body =
      table(
        [
          { label: "Strike", num: true },
          { label: "CE OI", num: true },
          { label: "CE Δ", num: true },
          { label: "CE Vol", num: true },
          { label: "CE LTP", num: true },
          { label: "PE LTP", num: true },
          { label: "PE Vol", num: true },
          { label: "PE Δ", num: true },
          { label: "PE OI", num: true },
        ],
        n.rows,
        (r, i) => {
          const atm = i === n.atm ? ' style="background:rgba(59,130,246,.12)"' : "";
          const side = n.spot != null ? (r.strike < n.spot ? ' <span class="muted">P</span>' : r.strike > n.spot ? ' <span class="muted">C</span>' : "") : "";
          return `<tr${atm}><td class="num"><b>${esc(num(r.strike, 0))}</b>${side}</td>` +
            `<td class="num pos" style="background:${heat(r.ce, maxCe)}">${esc(qty(r.ce))}</td>` +
            `<td class="num ${signCls(r.cChg)}">${esc(qty(r.cChg))}</td>` +
            `<td class="num muted">${esc(qty(r.cVol))}</td>` +
            `<td class="num">${inr(r.cLtp)}</td>` +
            `<td class="num">${inr(r.pLtp)}</td>` +
            `<td class="num muted">${esc(qty(r.pVol))}</td>` +
            `<td class="num ${signCls(r.pChg)}">${esc(qty(r.pChg))}</td>` +
            `<td class="num neg" style="background:${heat(r.pe, maxPe)}">${esc(qty(r.pe))}</td></tr>`;
        }
      ) + cap(`P = below spot (put-heavy) · C = above spot (call-heavy) · OI/vol/Δ in <b>shares</b>`);
    return card("Strike OI · CE vs PE", body, 4);
  }

  U.PANELS.oi = {
    title: "OI Ladder",
    // Shared builder so the Volume tab can reuse the volume card.
    volumeCard(data, full) {
      return volumeCard(norm(data, full));
    },
    render(data, full) {
      const n = norm(data, full);
      if (!n.rows.length) return card("OI Ladder", miss("option chain for " + (n.expiry || "this expiry")), 4);
      return ladderCard(n) + chgCard(n) + volumeCard(n) + strikeTable(n);
    },
    info: {
      title: "OI Ladder",
      tagline: "Where NSE option positions sit: open interest, fresh build-up and volume by strike",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Open interest (OI) is the number of option contracts still open at each strike — the positioning map for this expiry. Big <b>CE OI above spot</b> acts as resistance (call writers defend), big <b>PE OI below spot</b> acts as support (put writers defend). Change-in-OI shows <em>fresh</em> positioning: where new money entered since the last session. All quantities are <b>shares</b> — lot size differs per stock and is never assumed here.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>OI Ladder</b> — diverging bars per strike: CE OI right (green), PE OI left (red). The <b>ATM strike</b> (nearest spot) is highlighted; spot, resistance, support, max pain and PCR sit in the strip above.</li><li><b>Change in OI</b> — CE vs PE change-in-OI bars plus totals; CE build-up = fresh resistance writing, PE build-up = fresh support writing.</li><li><b>Volume</b> — CE vs PE traded volume by strike with totals and volume PCR.</li><li><b>Strike OI table</b> — per-strike CE/PE OI, ΔOI, volume and LTP (₹); the ATM row is highlighted.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p><b>Support:</b> heavy PE OI + rising PE ΔOI below spot — writers defend it. <b>Resistance:</b> heavy CE OI + rising CE ΔOI above spot. <b>Squeeze risk:</b> spot above resistance with PE build-up underneath = shorts trapped. <b>PCR (PE OI ÷ CE OI)</b> above ~1 leans bullish, below ~0.7 leans bearish — but always read it against the ladder, not alone.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>RELIANCE  spot ₹1,420  |  PCR 0.95  |  max pain ₹1,400
PE OI peaks at 1400 (12.4L shares, Δ +2.1L) → strong support.
CE OI peaks at 1450 (10.8L shares, Δ +1.9L) → resistance.
Reading: range 1400–1450 into expiry; max pain 1400 pulls.
Trade: fade a push toward 1450 while 1400 PE writing holds;
a 15-min close above 1450 breaks the thesis.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/symbol/{T}</code> — <code>chain.strikes</code> (<code>strike</code>, <code>ce_oi</code>, <code>pe_oi</code>, <code>ce_oich</code>, <code>pe_oich</code>, <code>ce_vol</code>, <code>pe_vol</code>, <code>ce_ltp</code>, <code>pe_ltp</code>), <code>levels</code> (<code>pcr</code>, <code>max_pain</code>, <code>resistance</code>, <code>support</code>).</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>OI restates overnight — intraday ΔOI is provisional until the exchange publishes the final file.</li><li>Only the selected expiry is shown; positions in other expiries can defend different levels.</li><li>LTPs are indicative and can lag the futures/spot move.</li></ul>`,
        },
      ],
    },
  };
})();
