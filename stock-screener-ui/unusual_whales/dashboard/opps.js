/* Opportunities — market-wide intraday screener (from /api/screener/stocks).
 *
 * Preset filters + sortable columns. Reachable at #/opps.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, money, num, pct, int, signCls, tk } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

  // Small gamma-regime pill: positive dealer gamma calms/pins price ("Pin"),
  // negative dealer gamma amplifies moves ("Trend"). Inline colours so no CSS
  // change is needed outside this file.
  const gammaPill = (g) => {
    const v = n(g);
    if (v == null) return '<span class="muted">–</span>';
    return v > 0
      ? '<span class="pill" style="color:#8b5cf6;border-color:rgba(139,92,246,.5);background:rgba(139,92,246,.12)">Pin</span>'
      : '<span class="pill" style="color:#f59e0b;border-color:rgba(245,158,11,.5);background:rgba(245,158,11,.12)">Trend</span>';
  };

  // "Move Radar" composite: expected move (as %) × unusualness (1+|z|) ×
  // relative volume. Rows missing any input are excluded from radar presets.
  const radarOf = (r) => {
    const mv = n(r.implied_move_perc), z = n(r.z_score), rv = n(r.relative_volume);
    if (mv == null || z == null || rv == null) return null;
    return mv * 100 * (1 + Math.abs(z)) * rv;
  };

  /* Unit notes — verified against the live /api/opps payload (2026-10):
       · one_day_perc / one_week_perc / implied_move_perc -> FRACTIONS
         (0.0069 === 0.69%), so pct() (×100) is correct. The raw Unusual Whales
         screener field is a fraction.
       · relative_volume               -> a ratio (1.85 === 1.85x) -> num + "x".
       · iv_rank                       -> a 0-100 rank (not a percent sign).
       · gex_daily_net_gex             -> signed $; >0 = positive dealer gamma
         ("Pin"), <0 = negative dealer gamma ("Trend").
       · net_premium / z_score / rsi_14 -> signed $ / signed sigma / 0-100.
       · pct_52w                       -> computed below as an already-percent
         value ((close-lo)/(hi-lo)*100), so it is formatted raw + "%".
       · _radar                        -> derived composite, plain number. */
  const COLS = [
    { k: "ticker", label: "Ticker" },
    { k: "close", label: "Last", num: true, fmt: (v) => num(v, 2) },
    { k: "one_day_perc", label: "Day", num: true, fmt: (v) => pct(v), sign: true },
    { k: "implied_move_perc", label: "Exp move", num: true, fmt: (v) => pct(v) },
    { k: "gamma_tag", label: "Gamma", render: (r) => gammaPill(r.gex_daily_net_gex) },
    { k: "relative_volume", label: "Rel vol", num: true, fmt: (v) => num(v, 2) + "x" },
    { k: "iv_rank", label: "IV rank", num: true, fmt: (v) => num(v, 0) },
    { k: "net_premium", label: "Net prem", num: true, fmt: (v) => money(v), sign: true },
    { k: "gex_daily_net_gex", label: "Net GEX", num: true, fmt: (v) => money(v), sign: true },
    { k: "one_week_perc", label: "1w %", num: true, fmt: (v) => pct(v), sign: true },
    { k: "z_score", label: "Z", num: true, fmt: (v) => num(v, 2), sign: true },
    { k: "rsi_14", label: "RSI", num: true, fmt: (v) => num(v, 1) },
    { k: "pct_52w", label: "% of 52w", num: true, fmt: (v) => num(v, 0) + "%" },
  ];

  const PRESETS = [
    // RECOMMENDED default: expected move × unusualness × relative volume.
    { id: "radar", label: "Move Radar", rec: true, sort: "_radar", desc: true, filter: (r) => n(r._radar) != null },
    { id: "bigmove", label: "Biggest expected move", sort: "implied_move_perc", desc: true, filter: (r) => n(r.implied_move_perc) != null },
    { id: "upside", label: "Upside", sort: "_radar", desc: true, filter: (r) => (n(r.pct_52w) || 0) >= 80 && (n(r.rsi_14) || 0) >= 55 && (n(r.net_premium) || 0) > 0 },
    { id: "downside", label: "Downside", sort: "_radar", desc: true, filter: (r) => (n(r.rsi_14) || 0) <= 45 && (n(r.gex_daily_net_gex) || 0) < 0 },
    { id: "neggamma", label: "Negative gamma", sort: "gex_daily_net_gex", desc: false, filter: (r) => (n(r.gex_daily_net_gex) || 0) < 0 },
    { id: "momentum", label: "Momentum", sort: "one_week_perc", desc: true, filter: (r) => (n(r.one_week_perc) || 0) > 0 },
    { id: "rvol", label: "High relative volume", sort: "relative_volume", desc: true, filter: (r) => (n(r.relative_volume) || 0) >= 1 },
    { id: "cheapiv", label: "Cheap IV", sort: "iv_rank", desc: false, filter: (r) => n(r.iv_rank) != null },
    { id: "bullflow", label: "Bullish flow", sort: "net_premium", desc: true, filter: (r) => (n(r.net_premium) || 0) > 0 },
    { id: "gex", label: "Unusual GEX", sort: "gex_daily_net_gex", desc: true, filter: (r) => n(r.gex_daily_net_gex) != null },
    { id: "nearhigh", label: "Near 52w high", sort: "pct_52w", desc: true, filter: (r) => (n(r.pct_52w) || 0) >= 90 },
  ];

  // kept at module scope so auto-refresh doesn't reset the user's preset/sort
  let preset = PRESETS[0];
  let sortKey = preset.sort;
  let desc = preset.desc;

  U.renderOpps = async function (root) {
    root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading opportunities…</div></div></div>';
    let rows = [];
    try {
      const res = await fetch("/api/opps");
      if (!res.ok) throw new Error("HTTP " + res.status);
      rows = (await res.json()).rows || [];
    } catch (e) {
      root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
      return;
    }
    rows.forEach((r) => {
      const hi = n(r.week_52_high), lo = n(r.week_52_low), c = n(r.close);
      r.pct_52w = hi != null && lo != null && hi > lo && c != null ? ((c - lo) / (hi - lo)) * 100 : null;
      r._radar = radarOf(r);
    });

    // `preset` drives both the row filter and the `.on` highlight. A manual
    // column sort clears it (preset = null) so the highlighted button and the
    // filtered row set can never desync from the actual sort. State lives at
    // module scope so auto-refresh preserves the user's choice.

    function paint() {
      let data = preset ? rows.filter(preset.filter) : rows;
      data = data
        .slice()
        .sort((a, b) => {
          const av = n(a[sortKey]), bv = n(b[sortKey]);
          if (av == null) return 1;
          if (bv == null) return -1;
          return desc ? bv - av : av - bv;
        })
        .slice(0, 40);
      const maxPrem = Math.max(1, ...data.map((r) => Math.abs(n(r.net_premium) || 0)));
      const heat = U.heat || (() => "");
      const head = COLS.map(
        (c) => `<th class="${c.num ? "num" : ""} ${c.k === sortKey ? "on" : ""}" data-k="${c.k}">${c.label}${c.k === sortKey ? (desc ? " ▾" : " ▴") : ""}</th>`
      ).join("");
      const body = data
        .map((r) => {
          const cells = COLS.map((c) => {
            if (c.k === "ticker") return `<td>${tk(r.ticker)}</td>`;
            if (c.render) return `<td>${c.render(r)}</td>`;
            const v = n(r[c.k]);
            const cls = c.sign ? signCls(v) : "";
            const bg = c.k === "net_premium" && v != null ? ` style="background:${heat(v, maxPrem)}"` : "";
            return `<td class="num ${cls}"${bg}>${v == null ? '<span class="muted">–</span>' : c.fmt(v)}</td>`;
          }).join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      root.innerHTML = `<div class="tabgrid snap">
        <div class="card c4">
          <h2>Intraday opportunities · top ${data.length} of ${rows.length} <span class="hint-i" title="Plain-English screener">i</span></h2>
          <div class="hint">A market-wide screener built from <b>/api/screener/stocks</b>. Pick a preset, then click any column to sort. Numbers are colour-coded: <span class="pos">green</span> = positive, <span class="neg">red</span> = negative. <b>Rel vol</b> = today's volume vs its 30-day average, <b>IV rank</b> = where implied vol sits in its own range, <b>Net GEX</b> = dealer gamma (negative = dealers amplify moves), <b>% of 52w</b> = position inside the 52-week range.</div>
          <div class="body">
            <div class="presets">${PRESETS.map((p) => `<button class="preset ${preset && p.id === preset.id ? "on" : ""}" data-p="${p.id}"${p.rec ? ' title="recommended"' : ""}>${p.rec ? "★ " : ""}${p.label}</button>`).join("")}</div>
            <div class="hint" style="padding:2px 8px 6px">What you're looking at: <b>Exp move</b> = the options-implied 1-day move (from the ATM straddle). <b>Gamma</b> ${gammaPill(1)} = positive dealer gamma, dealers calm/pin price; ${gammaPill(-1)} = negative dealer gamma, dealers amplify moves. <b>Move Radar</b> = expected move × unusualness (1+|z|) × relative volume — the "what could move big, up or down" ranking.</div>
            <table class="screen"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="' + COLS.length + '" class="muted">no rows match this preset — pick another preset, or widen the filters.</td></tr>'}</tbody></table>
          </div>
        </div>
      </div>`;
      root.querySelectorAll(".preset").forEach((b) => {
        b.onclick = () => {
          preset = PRESETS.find((p) => p.id === b.dataset.p) || PRESETS[0];
          sortKey = preset.sort;
          desc = preset.desc;
          paint();
        };
      });
      root.querySelectorAll("th[data-k]").forEach((th) => {
        th.onclick = () => {
          const k = th.dataset.k;
          if (k === sortKey) desc = !desc;
          else {
            sortKey = k;
            desc = true;
          }
          preset = null; // manual sort overrides the preset filter + highlight
          paint();
        };
      });
    }

    paint();
    // adaptive auto-refresh (fast while the market is open, cheap when shut)
    if (U._oppsTimer) clearInterval(U._oppsTimer);
    const tick = () => {
      if (location.hash.startsWith("#/opps")) U.renderOpps(root);
      else {
        clearInterval(U._oppsTimer);
        U._oppsTimer = null;
      }
    };
    U._oppsTimer = U.every ? U.every("opps", tick) : setInterval(tick, 60000);
  };
})();
