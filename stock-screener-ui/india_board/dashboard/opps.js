/* Opportunities — market-wide intraday screener (from /api/screener/stocks).
 *
 * Preset filters + sortable columns. Reachable at #/opps.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, money, num, pct, int, signCls, tk } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

  const COLS = [
    { k: "ticker", label: "Ticker" },
    { k: "close", label: "Last", num: true, fmt: (v) => num(v, 2) },
    { k: "one_day_perc", label: "Day", num: true, fmt: (v) => pct(v), sign: true },
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
    { id: "momentum", label: "Momentum", sort: "one_week_perc", desc: true, filter: (r) => (n(r.one_week_perc) || 0) > 0 },
    { id: "rvol", label: "High relative volume", sort: "relative_volume", desc: true, filter: (r) => (n(r.relative_volume) || 0) >= 1 },
    { id: "cheapiv", label: "Cheap IV", sort: "iv_rank", desc: false, filter: (r) => n(r.iv_rank) != null },
    { id: "bullflow", label: "Bullish flow", sort: "net_premium", desc: true, filter: (r) => (n(r.net_premium) || 0) > 0 },
    { id: "gex", label: "Unusual GEX", sort: "gex_daily_net_gex", desc: true, filter: (r) => n(r.gex_daily_net_gex) != null },
    { id: "nearhigh", label: "Near 52w high", sort: "pct_52w", desc: true, filter: (r) => (n(r.pct_52w) || 0) >= 90 },
  ];

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
    });

    let preset = PRESETS[0];
    let sortKey = preset.sort;
    let desc = preset.desc;

    function paint() {
      let data = rows.filter(preset.filter);
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
            <div class="presets">${PRESETS.map((p) => `<button class="preset ${p.id === preset.id ? "on" : ""}" data-p="${p.id}">${p.label}</button>`).join("")}</div>
            <table class="screen"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="' + COLS.length + '" class="muted">no rows for this preset</td></tr>'}</tbody></table>
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
          paint();
        };
      });
    }

    paint();
  };
})();
