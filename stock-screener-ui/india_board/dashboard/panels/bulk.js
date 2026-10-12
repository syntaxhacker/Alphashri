/* Smart Money tab — NSE bulk/block deal disclosures ("big money" prints).
 *
 * Backend: GET /api/bulk-deals[?date=YYYY-MM-DD] ->
 *   {date, count, qualifying_count, qualifying_value_cr,
 *    by_client_type:{mutual_fund:{count,value_cr}, ...},
 *    unavailable?:true,
 *    deals:[{date, symbol, name, client, side, qty, watp, value_cr,
 *            deal_type:"bulk"|"block", client_type, client_confidence,
 *            matched_pattern, instrument_type, qualifying, threshold_cr,
 *            vol_z20, close, chg_pct}]}
 *
 * NSE publishes these END OF DAY (after ~18:00 IST on trading days), so the
 * feed is never live intraday — the panel states its provenance explicitly.
 * Every field may be null; the endpoint may return {unavailable:true} or 404
 * (nothing captured yet) — both render an honest empty state, never "null".
 *
 * render() returns a loading card; afterRender() fetches once and swaps in the
 * real cards, wiring the all-deals filter controls. The client-type tag is a
 * HEURISTIC name match, so its confidence is shown next to it (never implied
 * to be an exchange label).
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, int, signCls, tk, table, card } = U.util;

  const DASH = "–";
  const PROVENANCE =
    "Source: NSE bulk/block deal disclosures (end-of-day, 0.5% of paid-up equity threshold) · classification is heuristic";
  const CONF_WORD = { high: "high", medium: "med", low: "low" };
  const CLIENT_LABEL = {
    mutual_fund: "Mutual fund",
    insurance: "Insurance",
    pms: "PMS",
    aif: "AIF",
    fpi: "FPI",
    trust: "Trust",
    corporate: "Corporate",
    individual: "Individual",
    unknown: "Unknown",
  };

  const isNum = (v) => v != null && v !== "" && isFinite(Number(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;
  const miss = (what) => `<div class="muted" style="padding:6px">${esc(what)}</div>`;
  const kpi = (label, value, sub, cls) =>
    `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v ${cls || ""}">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ""}</div>`;

  const clientLabel = (t) => CLIENT_LABEL[t] || (t ? String(t).replace(/_/g, " ") : "Unknown");
  const confWord = (c) => CONF_WORD[String(c || "").toLowerCase()] || "";

  // ₹ with Indian grouping; "–" for anything null/NaN (never "null"/"NaN").
  const inr = (v) =>
    isNum(v) ? "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : DASH;
  const crs = (v) => (isNum(v) ? inr(v) + " Cr" : DASH);
  const pctPts = (v) => (isNum(v) ? (Number(v) > 0 ? "+" : "") + Number(v).toFixed(2) + "%" : DASH);

  const sideLabel = (v) => {
    const s = String(v == null ? "" : v).toUpperCase();
    if (s === "B" || s === "BUY") return "BUY";
    if (s === "S" || s === "SELL") return "SELL";
    return v ? String(v).toUpperCase() : DASH;
  };
  const sideCls = (v) => (sideLabel(v) === "BUY" ? "buy" : sideLabel(v) === "SELL" ? "sell" : "");

  // Vol z heat bands: ≥3 hot (red wash), ≥1.5 warm (amber wash).
  const zCls = (v) => {
    if (!isNum(v)) return "muted";
    const z = Number(v);
    if (z >= 3) return "neg";
    if (z >= 1.5) return "warn";
    return "";
  };
  const zStyle = (v) => {
    if (!isNum(v)) return "";
    const z = Number(v);
    if (z >= 3) return "background:rgba(220,38,38,.20)";
    if (z >= 1.5) return "background:rgba(245,158,11,.16)";
    return "";
  };

  // Client type + confidence, e.g. "mutual_fund · med". The confidence suffix
  // is intentionally visible so a low-confidence label is never read as fact.
  const clientTag = (d) => {
    const t = clientLabel(d.client_type);
    const c = confWord(d.client_confidence);
    return `<span class="pill">${esc(t)}${c ? ' <span class="muted">· ' + esc(c) + "</span>" : ""}</span>`;
  };

  const dateOrDefault = (v) => (v ? String(v).slice(0, 10) : DASH);
  const istToday = () => {
    try {
      return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  };
  const notCaptured = (date) =>
    `no bulk deals captured for ${date} — capture runs after 18:00 IST on trading days`;
  const feedUnavailable = "bulk-deal feed unavailable";

  const rowStyle = (d, ticker) =>
    d && ticker && d.symbol && String(d.symbol).toUpperCase() === String(ticker).toUpperCase()
      ? ' style="background:rgba(59,130,246,.10)"'
      : "";

  // ---- data --------------------------------------------------------------
  async function load() {
    const res = await fetch("/api/bulk-deals");
    if (res.status === 404) {
      const e = new Error("404");
      e.status = 404;
      throw e;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }

  const topFundType = (byType) => {
    let best = null;
    Object.keys(byType || {}).forEach((k) => {
      const v = byType[k];
      const val = v && isNum(v.value_cr) ? Number(v.value_cr) : null;
      if (val == null) return;
      if (!best || val > best.value_cr) best = { key: k, value_cr: val, count: v.count };
    });
    return best;
  };

  const maxOf = (rows, field) =>
    rows.reduce((m, x) => Math.max(m, isNum(x[field]) ? Number(x[field]) : 0), 0);

  // ---- render fragments ---------------------------------------------------
  function kpisHtml(d, qualifying, all) {
    const qCount = isNum(d.qualifying_count) ? Number(d.qualifying_count) : qualifying.length;
    const qVal = isNum(d.qualifying_value_cr)
      ? Number(d.qualifying_value_cr)
      : qualifying.reduce((s, x) => s + (isNum(x.value_cr) ? Number(x.value_cr) : 0), 0);
    const largest = maxOf(qualifying.length ? qualifying : all, "value_cr");
    const top = topFundType(d.by_client_type);
    return (
      `<div class="kpis">` +
      kpi("Qualifying", String(qCount), isNum(d.threshold_cr) ? `≥ ${crs(d.threshold_cr)} each` : "≥ value threshold", "pos") +
      kpi("Qualifying value", crs(qVal), "sum of qualifying deals", "pos") +
      kpi("Largest deal", crs(largest), "single qualifying deal") +
      kpi("Top fund type", top ? esc(clientLabel(top.key)) : DASH, top ? crs(top.value_cr) : "by value") +
      `</div>`
    );
  }

  function qualTable(d, qualifying, ticker) {
    const rows = qualifying.slice().sort((a, b) => (isNum(b.value_cr) ? Number(b.value_cr) : 0) - (isNum(a.value_cr) ? Number(a.value_cr) : 0));
    if (!rows.length) return miss("no qualifying deals in this capture");
    return table(
      [
        { label: "Date" },
        { label: "Symbol" },
        { label: "Client" },
        { label: "Type" },
        { label: "Value ₹Cr", num: true },
        { label: "Qty", num: true },
        { label: "WATP", num: true },
        { label: "Vol z", num: true },
        { label: "Δ%", num: true },
      ],
      rows,
      (x) =>
        `<tr${rowStyle(x, ticker)}>` +
        `<td>${esc(dateOrDefault(x.date || d.date))}</td>` +
        `<td>${x.symbol ? tk(x.symbol) : DASH}</td>` +
        `<td class="muted" style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(x.client || DASH)}</td>` +
        `<td><span class="muted">${esc(x.deal_type || DASH)}</span> ${clientTag(x)}</td>` +
        `<td class="num">${inr(x.value_cr)}</td>` +
        `<td class="num">${int(x.qty)}</td>` +
        `<td class="num">${inr(x.watp)}</td>` +
        `<td class="num ${zCls(x.vol_z20)}" style="${zStyle(x.vol_z20)}">${num(x.vol_z20, 2)}</td>` +
        `<td class="num ${signCls(x.chg_pct)}">${pctPts(x.chg_pct)}</td></tr>`
    );
  }

  // Filter the raw deal list for the secondary "all deals" table. Missing
  // instrument_type is treated as equity (unknown ≠ known non-equity); only a
  // known invit/etf/other is hidden until the toggle is on.
  function filterDeals(deals, state) {
    return deals
      .filter((x) => x && typeof x === "object")
      .filter((x) => state.include || !x.instrument_type || x.instrument_type === "equity")
      .filter((x) => state.mode !== "buy" || sideLabel(x.side) === "BUY")
      .filter((x) => state.mode !== "funds" || x.client_type === "mutual_fund" || x.client_type === "insurance")
      .filter((x) => !state.min || (isNum(x.value_cr) && Number(x.value_cr) >= state.min))
      .sort((a, b) => (isNum(b.value_cr) ? Number(b.value_cr) : 0) - (isNum(a.value_cr) ? Number(a.value_cr) : 0));
  }

  function allTable(d, rows, ticker) {
    if (!rows.length) return miss("no deals match these filters");
    return table(
      [
        { label: "Date" },
        { label: "Symbol" },
        { label: "Client" },
        { label: "Side" },
        { label: "Type" },
        { label: "Value ₹Cr", num: true },
        { label: "Qty", num: true },
        { label: "WATP", num: true },
        { label: "Vol z", num: true },
        { label: "Δ%", num: true },
      ],
      rows,
      (x) =>
        `<tr${rowStyle(x, ticker)}>` +
        `<td>${esc(dateOrDefault(x.date || d.date))}</td>` +
        `<td>${x.symbol ? tk(x.symbol) : DASH}</td>` +
        `<td class="muted" style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(x.client || DASH)}</td>` +
        `<td class="${sideCls(x.side)}">${esc(sideLabel(x.side))}</td>` +
        `<td><span class="muted">${esc(x.deal_type || DASH)}</span> ${clientTag(x)}</td>` +
        `<td class="num">${inr(x.value_cr)}</td>` +
        `<td class="num">${int(x.qty)}</td>` +
        `<td class="num">${inr(x.watp)}</td>` +
        `<td class="num ${zCls(x.vol_z20)}" style="${zStyle(x.vol_z20)}">${num(x.vol_z20, 2)}</td>` +
        `<td class="num ${signCls(x.chg_pct)}">${pctPts(x.chg_pct)}</td></tr>`
    );
  }

  function controlsHtml() {
    const btn = (mode, label) => `<button class="preset${mode === "all" ? " on" : ""}" data-bulk-mode="${mode}">${label}</button>`;
    return (
      `<div class="presets" style="align-items:center;gap:6px">` +
      btn("all", "All") +
      btn("buy", "BUY only") +
      btn("funds", "Fund+Insurance only") +
      `<input type="number" data-bulk-min min="0" step="1" placeholder="min ₹ Cr" aria-label="Minimum deal value in ₹ Cr"` +
      ` style="width:78px;background:var(--panel2);border:1px solid var(--border);border-radius:4px;color:var(--text);font:inherit;font-size:10px;padding:1px 5px">` +
      `<label class="muted" style="display:flex;align-items:center;gap:4px;font-size:10px;text-transform:none;letter-spacing:0">` +
      `<input type="checkbox" data-bulk-nonequity> include InvIT/ETF` +
      `</label>` +
      `</div>` +
      `<div class="muted" data-bulk-count style="padding:0 8px 2px;font-size:9.5px"></div>`
    );
  }

  // Full body for a captured day. Returns one wide headline card (KPIs +
  // qualifying table) plus a secondary all-deals card with its controls.
  function bodyHtml(d, ticker) {
    const all = arr(d.deals);
    const qualifying = all.filter((x) => x && x.qualifying);
    return (
      card(
        "Smart money · qualifying deals",
        kpisHtml(d, qualifying, all) +
          cap(
            `captured <b>${esc(dateOrDefault(d.date))}</b> IST · <b>${isNum(d.count) ? Number(d.count) : all.length}</b> deals disclosed · <b>${qualifying.length}</b> qualifying · ticker rows highlighted`
          ) +
          qualTable(d, qualifying, ticker) +
          cap(PROVENANCE),
        4
      ) +
      card(
        "Smart money · all deals",
        controlsHtml() + `<div data-bulk-alltable></div>` + cap(PROVENANCE),
        4
      )
    );
  }

  // Wire the all-deals filter controls and paint the secondary table.
  function wireAll(pane, d, ticker) {
    const host = pane.querySelector("[data-bulk-alltable]");
    if (!host) return;
    const countEl = pane.querySelector("[data-bulk-count]");
    const all = arr(d.deals).filter((x) => x && typeof x === "object");
    const state = { mode: "all", min: 0, include: false };
    const paint = () => {
      const rows = filterDeals(all, state);
      host.innerHTML = allTable(d, rows, ticker);
      if (countEl) countEl.textContent = `${rows.length} of ${all.length} deals shown`;
    };
    pane.querySelectorAll("[data-bulk-mode]").forEach((b) => {
      b.onclick = () => {
        state.mode = b.dataset.bulkMode || "all";
        pane.querySelectorAll("[data-bulk-mode]").forEach((x) => x.classList.toggle("on", x === b));
        paint();
      };
    });
    const min = pane.querySelector("[data-bulk-min]");
    if (min) {
      min.oninput = () => {
        state.min = isNum(min.value) ? Number(min.value) : 0;
        paint();
      };
    }
    const neq = pane.querySelector("[data-bulk-nonequity]");
    if (neq) {
      neq.onchange = () => {
        state.include = !!neq.checked;
        paint();
      };
    }
    paint();
  }

  function swapCard(host, html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const loadingCard = host.closest(".card");
    const cards = [...tmp.children];
    if (loadingCard && cards.length) loadingCard.replaceWith(...cards);
    else host.innerHTML = html;
  }

  U.PANELS.bulk = {
    title: "Smart Money",
    render() {
      return card(
        "Smart money · bulk & block deals",
        '<div class="muted" data-bulk style="padding:10px">Loading bulk deals…</div>',
        4
      );
    },
    async afterRender(pane, ticker) {
      const host = pane && pane.querySelector("[data-bulk]");
      if (!host) return;
      let d;
      try {
        d = await load();
      } catch (e) {
        if (!host.isConnected) return;
        const msg = e && e.status === 404 ? notCaptured(istToday()) : feedUnavailable;
        swapCard(host, card("Smart money · bulk & block deals", miss(msg), 4));
        return;
      }
      if (!pane.isConnected || !host.isConnected) return; // tab switched away
      if (!d || d.unavailable) {
        swapCard(host, card("Smart money · bulk & block deals", miss(feedUnavailable), 4));
        return;
      }
      const deals = arr(d.deals).filter((x) => x && typeof x === "object");
      if (!deals.length) {
        const date = d.date ? dateOrDefault(d.date) : istToday();
        swapCard(host, card("Smart money · bulk & block deals", miss(notCaptured(date)), 4));
        return;
      }
      swapCard(host, bodyHtml(d, ticker));
      try {
        wireAll(pane, d, ticker);
      } catch {
        /* filter wiring is best-effort */
      }
    },
    info: {
      title: "Smart Money",
      tagline: "NSE bulk & block deal disclosures — end-of-day big-money prints, not a live feed",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Every <b>bulk deal</b> (a single client crossing 0.5% of a company's paid-up equity in one session) and <b>block deal</b> (a negotiated trade through the block window) that NSE disclosed for the latest captured day. The headline card lists the <b>qualifying</b> deals — those at or above our value threshold (threshold shown in the KPIs) — ranked by value, with the client, trade type, quantity, weighted-average price, the name's <b>volume z-score</b> (how unusual the day's volume was) and the day's move.</p>`,
        },
        {
          h: "How to read it",
          p: `<p><b>Value ₹Cr</b> is the deal's traded value in crore. <b>Qty</b> is shares and <b>WATP</b> the weighted-average traded price. A <b>Vol z ≥ 3</b> (red) means the day's volume was an extreme outlier — the deal dominated the tape; <b>≥ 1.5</b> (amber) is merely elevated. The <b>client_type</b> tag (mutual fund, insurance, FPI …) and its confidence come from a <b>heuristic name match</b>, not an exchange label — a <em>low</em> suffix means treat the classification as a guess. InvIT/ETF treasury deals are hidden by default because their notional dwarfs normal equity deals.</p>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/bulk-deals[?date=YYYY-MM-DD]</code> — <code>deals[]</code> with <code>symbol</code>, <code>client</code>, <code>side</code>, <code>value_cr</code>, <code>qty</code>, <code>watp</code>, <code>vol_z20</code>, <code>chg_pct</code>, <code>client_type</code>, <code>client_confidence</code>, <code>instrument_type</code>, <code>qualifying</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li><b>End of day only</b> — NSE publishes bulk/block disclosures after ~18:00 IST on trading days, so intraday this shows the previous session, never live prints.</li><li>The <code>client_type</code> / <code>client_confidence</code> label is a <b>heuristic</b> string match; it can be wrong or <code>unknown</code>.</li><li>Any field may be null (rendered as <b>–</b>); the feed may be <code>unavailable</code> or not yet captured — the card says so instead of showing a number.</li><li>Not investment advice — disclosure data is a research input, not a signal.</li></ul>`,
        },
      ],
    },
  };
})();
