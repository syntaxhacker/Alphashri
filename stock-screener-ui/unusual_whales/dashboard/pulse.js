/* Market Pulse — market-wide options sentiment (from /api/pulse).
 *
 * Reachable at #/pulse. Shows the options-pulse tape (call/put transactions,
 * sentiment score, market sentiment), total market option volume, the top
 * bullish/bearish names by option sentiment, and a compact sector pulse.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, money, num, int, rawpct, signCls, tk, table, card, kpiBig, line, multi, hbars } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const noData = (why) => `<div class="muted" style="padding:6px">${why}</div>`;

  function sentimentTable(rows, heat) {
    const max = Math.max(0, ...rows.map((r) => Math.abs(n(r.score) || 0)));
    return table(
      [
        { label: "Ticker" },
        { label: "Score", num: true },
        { label: '<span title="Average variance / IV component of the sentiment score">ΔIV (AVAR)</span>', num: true },
        { label: '<span title="Volume-weighted skew component">Vol skew (VWKS)</span>', num: true },
        { label: '<span title="Number of observations behind the score">sample</span>', num: true },
      ],
      rows.slice(0, 25),
      (r) => {
        const s = n(r.score);
        return `<tr><td>${tk(r.ticker)}</td><td class="num ${signCls(s)}" style="background:${heat(s, max)}">${
          s == null ? "–" : num(s, 1)
        }</td><td class="num ${signCls(r.avar)}">${n(r.avar) == null ? "–" : num(r.avar, 3)}</td><td class="num ${signCls(
          r.vwks
        )}">${n(r.vwks) == null ? "–" : num(r.vwks, 3)}</td><td class="num muted">${int(r.sample_size)}</td></tr>`;
      }
    );
  }

  U.renderPulse = async function (root) {
    const nav = U.navSeq || 0;
    if (U.charts) U.charts.disposeAll();
    root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading market pulse…</div></div></div>';
    let d;
    try {
      const res = await fetch("/api/pulse");
      if (!res.ok) throw new Error("HTTP " + res.status);
      d = await res.json();
    } catch (e) {
      root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
      return;
    }
    if ((U.navSeq || 0) !== nav) return; // route changed while loading

    const heat = U.heat || (() => "");
    const pulse = d.pulse || {};
    const latest = pulse.latest || {};
    const intra = Array.isArray(pulse.intraday) ? pulse.intraday : [];
    const vol = d.volume || {};
    const sent = d.sentiment || {};
    const bull = Array.isArray(sent.bullish) ? sent.bullish : [];
    const bear = Array.isArray(sent.bearish) ? sent.bearish : [];
    const sectors = Array.isArray(d.sectors) ? d.sectors : [];

    // ---- (a) Options Pulse -------------------------------------------------
    const hint =
      '<div class="hint" style="display:block">Plain-English: this is the <b>market-wide options mood</b>. <b>Call/Put txn</b> = how many option contracts traded on each side in the latest interval; <b>Put/Call</b> above 1 means more puts than calls (defensive). <b>Sentiment score</b> runs −1 (very bearish) to +1 (very bullish). The blue line is that score through the day, the amber line its interval change, and <b>market sentiment</b> is the broad-market reading. Read the top <b>bullish/bearish names</b> as where the unusual option positioning is concentrated.</div>';

    const hasPulse = latest.call_txn != null || latest.put_txn != null || intra.length > 0;
    let pulseCard;
    if (!hasPulse) {
      pulseCard = card("Options Pulse · market sentiment", noData("no market-pulse data for the latest session — sentiment populates while the US market is open."), 2);
    } else {
      const pc = n(latest.put_call_ratio);
      const kpis =
        kpiBig("Call txn", latest.call_txn == null ? "–" : int(latest.call_txn), "latest interval", "pos") +
        kpiBig("Put txn", latest.put_txn == null ? "–" : int(latest.put_txn), "latest interval", "neg") +
        kpiBig("Put/Call", pc == null ? "–" : num(pc, 2), ">1 = put-heavy", pc == null ? "" : pc > 1 ? "neg" : "pos") +
        kpiBig("Sentiment", latest.sntm_score == null ? "–" : num(latest.sntm_score, 2), "−1 … +1", signCls(latest.sntm_score)) +
        kpiBig("Interval Δ", latest.intvl_sntm_score == null ? "–" : num(latest.intvl_sntm_score, 2), "this interval", signCls(latest.intvl_sntm_score)) +
        kpiBig("Market", latest.mkt_sntm == null ? "–" : num(latest.mkt_sntm, 2), "broad market", signCls(latest.mkt_sntm));

      const sntmSeries = intra.map((r) => n(r.sntm_score));
      const intvlSeries = intra.map((r) => n(r.intvl_sntm_score));
      const xLabels = intra.map((r) => r.hr_min || "");
      const intraChart = intra.length
        ? multi(
            [
              { name: "Sentiment", color: "#3b82f6", data: sntmSeries, area: true },
              { name: "Interval", color: "#f59e0b", data: intvlSeries },
            ],
            { x: xLabels, axis: true, height: 150 }
          )
        : noData("no intraday sentiment ticks yet.");
      const mktSeries = intra.map((r) => n(r.mkt_sntm)).filter((v) => v != null);
      const mktSpark = mktSeries.length ? line(mktSeries, { stroke: "#22c55e", fill: "#22c55e", height: 56 }) : noData("no market-sentiment ticks yet.");

      pulseCard = card(
        "Options Pulse · market sentiment",
        `<div class="kpis">${kpis}</div>${hint}` +
          '<div class="wl-note" style="padding:2px 8px 0">Intraday sentiment (blue) vs interval change (amber)</div>' +
          `<div class="spark-wrap">${intraChart}</div>` +
          '<div class="wl-note" style="padding:4px 8px 0">Market sentiment intraday</div>' +
          `<div class="spark-wrap">${mktSpark}</div>`,
        2
      );
    }

    // ---- (b) Total options volume ------------------------------------------
    const hasVol = vol.call_volume != null || vol.put_volume != null;
    let volCard;
    if (!hasVol) {
      volCard = card("Market option volume · calls vs puts", noData("no market-wide option volume for this date yet — it fills once contracts trade today."), 2);
    } else {
      const callShare = n(vol.call_share);
      const vKpis =
        kpiBig("Call vol", vol.call_volume == null ? "–" : int(vol.call_volume), "contracts", "pos") +
        kpiBig("Put vol", vol.put_volume == null ? "–" : int(vol.put_volume), "contracts", "neg") +
        kpiBig("Call share", callShare == null ? "–" : rawpct(callShare * 100), "% of total", callShare == null ? "" : callShare >= 0.5 ? "pos" : "neg") +
        kpiBig("Call premium", vol.call_premium == null ? "–" : money(vol.call_premium), "notional", "pos") +
        kpiBig("Put premium", vol.put_premium == null ? "–" : money(vol.put_premium), "notional", "neg") +
        kpiBig("P/C vol", vol.put_call_ratio == null ? "–" : num(vol.put_call_ratio, 2), ">1 = put-heavy", "");
      const vBars = hbars(
        [
          { label: "Calls", value: n(vol.call_volume) || 0, right: int(vol.call_volume), color: "var(--pos)" },
          { label: "Puts", value: n(vol.put_volume) || 0, right: int(vol.put_volume), color: "var(--neg)" },
        ],
        {}
      );
      volCard = card(
        "Market option volume · calls vs puts" + (vol.date ? ` <span class="muted">· ${esc(vol.date)}</span>` : ""),
        `<div class="kpis">${vKpis}</div><div class="wl-note" style="padding:2px 8px 0">Share of total contracts</div>${vBars}`,
        2
      );
    }

    // ---- (c) Top bullish / bearish sentiment -------------------------------
    const bullCard = card("Top bullish option sentiment", sentimentTable(bull, heat), 2);
    const bearCard = card("Top bearish option sentiment", sentimentTable(bear, heat), 2);

    // ---- (d) Sector pulse (only when usable rows exist) --------------------
    const sectorCard = sectors.length
      ? card(
          "Sector pulse · options sentiment",
          table(
            [{ label: "Sector" }, { label: "Call", num: true }, { label: "Put", num: true }, { label: "Score", num: true }],
            sectors,
            (r) => {
              const s = n(r.sntm_score);
              return `<tr><td>${esc(r.name)}</td><td class="num pos">${int(r.call_txn)}</td><td class="num neg">${int(
                r.put_txn
              )}</td><td class="num ${signCls(s)}" style="background:${heat(s, 1)}">${s == null ? "–" : num(s, 2)}</td></tr>`;
            }
          ),
          4
        )
      : "";

    root.innerHTML = `<div class="tabgrid snap">${pulseCard}${volCard}${bullCard}${bearCard}${sectorCard}</div>`;
    if (U.charts) U.charts.mount(root);
    // adaptive auto-refresh (fast while the market is open, cheap when shut)
    if (U._pulseTimer) clearInterval(U._pulseTimer);
    const tick = () => {
      if (location.hash.startsWith("#/pulse")) U.renderPulse(root);
      else {
        clearInterval(U._pulseTimer);
        U._pulseTimer = null;
      }
    };
    U._pulseTimer = U.every ? U.every("pulse", tick) : setInterval(tick, 45000);
  };
})();
