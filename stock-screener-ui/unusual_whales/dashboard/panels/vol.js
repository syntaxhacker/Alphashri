/* Volatility tab — vol stats, realized vs implied, term structure, VRP, character. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, int, pct, rawpct, signCls, pill, table, card, kpiBig, line, bars, multi, hbars } = U.util;

  const C = { accent: "#3b82f6", pos: "#16a34a", neg: "#dc2626", warn: "#f59e0b", cyan: "#22d3ee", violet: "#a855f7" };
  const WIN = [C.accent, C.warn, C.cyan, C.violet, C.pos];

  const nz = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  // Percentiles/ranks arrive as a 0-1 fraction from some payloads and 0-100
  // from others. Normalise to 0-100, then format with rawpct() (which does NOT
  // multiply again). Anything >1.5 is already on the 0-100 scale, so it is
  // passed through untouched. Only use for percentile/rank-like fields — never
  // for IV/RV, which are genuine 0-1 fractions.
  const normPct = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Math.abs(Number(v)) <= 1.5 ? Number(v) * 100 : Number(v));
  const arr = (v) => {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.data)) return v.data;
    return [];
  };
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) && !v.__error ? v : null);
  const none = () => '<div class="muted" style="padding:6px">no data for this section — nothing was returned for this symbol.</div>';
  const byDate = (key) => (a, b) => String(a[key] || "").localeCompare(String(b[key] || ""));
  const km = (label, value, sub, cls) => kpiBig(label, value, sub, cls);

  // Group rows by an integer window field into up to 4 aligned series.
  function byDays(rows, valKey) {
    if (!valKey) return [];
    const m = new Map();
    rows.forEach((r) => {
      const dd = Number(r.days);
      if (!isFinite(dd)) return;
      if (!m.has(dd)) m.set(dd, []);
      m.get(dd).push(nz(r[valKey]));
    });
    return [...m.keys()]
      .sort((a, b) => a - b)
      .slice(0, 4)
      .map((k, i) => ({ name: k + "d", color: WIN[i % WIN.length], data: m.get(k) }));
  }

  U.PANELS.vol = {
    title: "Volatility",
    render(d) {
      d = d || {};

      // ---- vol stats KPIs (fall back to iv_rank when stats unavailable) ---
      const vs = obj(d.vol_stats);
      const ivr = arr(d.iv_rank);
      const lastIvr = ivr.length ? ivr[ivr.length - 1] : {};
      const iv = vs && vs.iv != null ? vs.iv : lastIvr.volatility;
      const ivRank = vs && vs.iv_rank != null ? vs.iv_rank : lastIvr.iv_rank_1y;
      const rvLow = vs ? vs.rv_low : null;
      const rvHigh = vs ? vs.rv_high : null;
      const ivLow = vs ? vs.iv_low : null;
      const ivHigh = vs ? vs.iv_high : null;
      const hasStats = iv != null || ivRank != null || (vs && Object.keys(vs).length);
      const stats = hasStats
        ? `<div class="kpis">${km("IV", pct(iv, 1), ivLow != null || ivHigh != null ? `${pct(ivLow, 1)} – ${pct(ivHigh, 1)}` : "")}${km("IV Rank", num(ivRank, 1), "1y")}${km("RV Low", pct(rvLow, 1))}${km("RV High", pct(rvHigh, 1))}</div>`
        : none();

      // ---- realized IV vs RV, plus realized windows ----------------------
      const rz = arr(d.realized);
      const rw = arr(d.realized_windows);
      let realizedBody = "";
      if (rz.length) {
        const l = rz[rz.length - 1];
        realizedBody += multi(
          [
            { name: "IV " + pct(l.implied_volatility, 1), color: C.accent, data: rz.map((r) => nz(r.implied_volatility)) },
            { name: "RV " + pct(l.realized_volatility, 1), color: C.warn, data: rz.map((r) => nz(r.realized_volatility)) },
          ],
          { height: 155 }
        );
      } else {
        realizedBody += none();
      }
      const rwSeries = byDays(rw, "realized_volatility");
      if (rwSeries.length) realizedBody += multi(rwSeries, { height: 135 });

      // ---- IV rank line + interpolated IV tables -------------------------
      let ivBody = ivr.length ? line(ivr.map((r) => nz(r.iv_rank_1y)), { stroke: C.warn, height: 125 }) : none();
      const ivRows = arr(d.interpolated_iv).slice().sort((a, b) => nz(a.days) - nz(b.days));
      const ivMaxVol = Math.max(1, ...ivRows.map((r) => nz(r.volatility)));
      const ivMaxMove = Math.max(1, ...ivRows.map((r) => nz(r.implied_move_perc)));
      ivBody += table(
        [
          { label: "Days", num: true },
          { label: "Vol", num: true },
          { label: "Pctl", num: true },
          { label: "Move %", num: true },
        ],
        ivRows,
        (r) =>
          `<tr><td class="num">${int(r.days)}</td><td class="num" style="background:${U.heat(nz(r.volatility), ivMaxVol)}">${pct(r.volatility, 1)}</td><td class="num muted">${rawpct(normPct(r.percentile), 1)}</td><td class="num" style="background:${U.heat(nz(r.implied_move_perc), ivMaxMove)}">${pct(r.implied_move_perc, 2)}</td></tr>`
      );
      const ivdRows = arr(d.interp_iv_dist).slice().sort((a, b) => nz(a.days) - nz(b.days));
      const ivdMaxVol = Math.max(1, ...ivdRows.map((r) => nz(r.volatility)));
      ivBody += table(
        [
          { label: "Days", num: true },
          { label: "Vol", num: true },
          { label: "Median", num: true },
          { label: "Min", num: true },
          { label: "Max", num: true },
          { label: "Pctl", num: true },
        ],
        ivdRows,
        (r) =>
          `<tr><td class="num">${int(r.days)}</td><td class="num" style="background:${U.heat(nz(r.volatility), ivdMaxVol)}">${pct(r.volatility, 1)}</td><td class="num muted">${pct(r.median, 1)}</td><td class="num">${pct(r.min, 1)}</td><td class="num">${pct(r.max, 1)}</td><td class="num muted">${rawpct(normPct(r.percentile), 1)}</td></tr>`
      );

      // ---- term structure -------------------------------------------------
      const ts = arr(d.term_structure).slice().sort((a, b) => nz(a.dte) - nz(b.dte));
      const tsFront = ts.length ? ts[0] : {};
      const tsBack = ts.length ? ts[ts.length - 1] : {};
      let termBody = ts.length
        ? `<div class="kpis">${km("Front IV", pct(tsFront.volatility, 1), "DTE " + int(tsFront.dte))}${km("Back IV", pct(tsBack.volatility, 1), "DTE " + int(tsBack.dte))}${km("Front Move", pct(tsFront.implied_move_perc, 2), "implied")}</div>` +
          line(ts.map((r) => nz(r.volatility)), { stroke: C.accent, fill: C.accent, height: 145 })
        : none();
      const tsdRows = arr(d.term_structure_dist).slice().sort((a, b) => nz(a.dte) - nz(b.dte));
      const tsdMaxVol = Math.max(1, ...tsdRows.map((r) => nz(r.volatility)));
      termBody += table(
        [
          { label: "Expiry" },
          { label: "DTE", num: true },
          { label: "Vol", num: true },
          { label: "Median", num: true },
          { label: "Pctl", num: true },
          { label: "Samples", num: true },
        ],
        tsdRows,
        (r) =>
          `<tr><td>${esc(r.expiry)}</td><td class="num muted">${int(r.dte)}</td><td class="num" style="background:${U.heat(nz(r.volatility), tsdMaxVol)}">${pct(r.volatility, 1)}</td><td class="num muted">${pct(r.median, 1)}</td><td class="num muted">${rawpct(normPct(r.percentile), 1)}</td><td class="num muted">${int(r.samples)}</td></tr>`
      );

      // ---- variance risk premium -----------------------------------------
      const vrp = arr(d.variance_risk_premium);
      const vl = vrp.length ? vrp[vrp.length - 1] : {};
      let vrpBody = vrp.length
        ? `<div class="kpis">${km("VRP", num(vl.risk_premium, 4), esc(vl.date || ""), signCls(vl.risk_premium))}${km("Rank", rawpct(normPct(vl.rank), 1), "1y")}${km("IV", pct(vl.implied_volatility, 1))}${km("RV", pct(vl.realized_volatility, 1))}</div>` +
          line(vrp.map((r) => nz(r.risk_premium)), { stroke: C.cyan, fill: C.cyan, height: 140 })
        : none();

      // ---- vol anomaly ----------------------------------------------------
      const va = obj(d.vol_anomaly);
      const vaLatest = (va && va.latest) || {};
      const vaHist = va && Array.isArray(va.history) ? va.history : [];
      const comps = vaLatest.components && typeof vaLatest.components === "object" ? Object.entries(vaLatest.components).filter(([, v]) => isFinite(Number(v))) : [];
      let anomaly = `<div class="kpis">${km("Score", num(vaLatest.score, 1), "anomaly", signCls(vaLatest.score))}${km("Direction", pill(vaLatest.direction || "–"), "")}</div>`;
      if (comps.length) {
        anomaly += hbars(
          comps.map(([k, v]) => ({ label: k, value: nz(v), right: num(v, 2) })),
          { signed: true }
        );
      }
      if (vaHist.length) anomaly += line(vaHist.map((r) => nz(r.score)), { stroke: C.warn, height: 120 });

      // ---- risk reversal skew --------------------------------------------
      const rr = arr(d.risk_reversal_skew).slice().sort(byDate("date"));
      const rrLatest = rr.length ? rr[rr.length - 1] : {};
      const rrd = [...new Set(rr.map((r) => r.delta).filter((v) => v != null))];
      let skew = rr.length ? `<div class="kpis">${km("Risk Reversal", num(rrLatest.risk_reversal, 4), "Δ " + esc(rrLatest.delta), signCls(rrLatest.risk_reversal))}${km("Date", esc(rrLatest.date || ""), "")}</div>` : "";
      if (rrd.length > 1) {
        skew += multi(
          rrd.slice(0, 4).map((dl, i) => ({ name: "Δ " + dl, color: WIN[i % WIN.length], data: rr.filter((r) => r.delta === dl).map((r) => nz(r.risk_reversal)) })),
          { height: 140 }
        );
      } else if (rr.length) {
        skew += line(rr.map((r) => nz(r.risk_reversal)), { stroke: C.violet, height: 140 });
      }
      if (!skew) skew = none();

      return (
        card("Vol Stats", stats, 2) +
        card("Realized vs Implied", realizedBody, 2) +
        card("IV Rank · Interpolated IV", ivBody, 2) +
        card("Term Structure", termBody, 2) +
        card("Variance Risk Premium", vrpBody, 2) +
        card("Vol Anomaly", anomaly, 1) +
        card("Risk Reversal Skew", skew, 2)
      );
    },
    info: {
      title: "Volatility",
      tagline: "Is premium cheap or rich — and which side is paying up",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Cheap or rich vs history and vs realised moves: IV, <b>IV rank</b>, realised-vs-implied, <b>term structure</b>, <b>variance risk premium</b> (IV − RV), anomaly and skew. High rank + positive VRP favours selling premium; low rank + rising anomaly favours buying.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>Vol Stats</b>: <code>iv</code>, <code>iv_rank</code>, <code>rv_low</code>, <code>rv_high</code>, <code>iv_low</code>, <code>iv_high</code> (fallback: <code>iv_rank</code> rows <code>volatility</code>, <code>iv_rank_1y</code>).</li><li><b>Realized vs Implied</b>: <code>implied_volatility</code>, <code>realized_volatility</code>; <code>realized_windows</code> grouped by <code>days</code>.</li><li><b>IV Rank / Interpolated IV</b>: <code>iv_rank_1y</code> trend; <code>days</code>, <code>volatility</code>, <code>percentile</code>, <code>implied_move_perc</code>; distribution adds <code>median</code>, <code>min</code>, <code>max</code>.</li><li><b>Term Structure</b>: <code>dte</code>, <code>volatility</code>, <code>implied_move_perc</code>; distribution adds <code>expiry</code>, <code>median</code>, <code>percentile</code>, <code>samples</code>.</li><li><b>Variance Risk Premium</b>: <code>date</code>, <code>risk_premium</code>, <code>rank</code>, <code>implied_volatility</code>, <code>realized_volatility</code>.</li><li><b>Vol Anomaly</b>: <code>latest.score</code>, <code>latest.direction</code>, <code>components</code>, <code>history</code>.</li><li><b>Risk Reversal Skew</b>: <code>date</code>, <code>delta</code>, <code>risk_reversal</code> (positive = puts over calls).</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p><b>Contango + positive VRP = calm:</b> sell defined-risk spreads or calendars. <b>Backwardation, negative VRP or spiking anomaly = stress:</b> own gamma or stand aside. Rising put skew with negative sentiment is hedging demand, not a buy signal.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>NVDA 30d IV 36.2% | 21d RV 31.4% => VRP +4.8 pts, rank 41% (thin)\n7d IV 29.4%, percentile 6.8% (cheap); contango 32.5% front < 34.1% back\nSkew 25d +0.013, risk reversal neutral.\nDecision: no harvest — buy a 7d/30d call calendar into earnings;\nexit on IV crush or anomaly flipping short_vol.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>/volatility/stats</code> <code>/volatility/realized</code> <code>/volatility/realized/windows</code> <code>/iv-rank</code> <code>/interpolated-iv</code> <code>/interpolated-iv/distribution</code> <code>/volatility/term-structure</code> <code>/volatility/term-structure/distribution</code> <code>/volatility/variance-risk-premium</code> <code>/volatility/variance-risk-premium/windows</code> <code>/volatility/anomaly</code> <code>/historical-risk-reversal-skew</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>VRP is backward-looking — calm windows overstate edge into events.</li><li><code>percentile</code> is a 0-1 fraction in some payloads, 0-100 elsewhere.</li><li>Front-DTE IV whipsaws; confirm with distribution <code>median</code> and <code>samples</code>.</li></ul>`,
        },
      ],
    },
  };
})();
