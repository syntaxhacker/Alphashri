/* NSE symbol drill-down: header stats + lazy-loaded tab panels.
 *
 * Backend: GET /api/symbol/{T}[?expiry=YYYY-MM-DD] -> {ticker, spot, chain:
 * {expiry, strikes: [...]}, expiries, call_oi, put_oi, as_of} plus levels:
 * {pcr, max_pain, resistance, support}. One fetch per ticker (+expiry);
 * every tab renders from the same payload. Search-box behaviour lives in
 * app.js — this file only renders #/symbol/{T}.
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, signCls, card } = U.util;

  const TABS = [
    { id: "overview", label: "Overview", panel: "in_overview" },
    { id: "oi", label: "OI Ladder", panel: "oi" },
    { id: "volume", label: "Volume", panel: "in_volume" },
    { id: "oiflow", label: "OI Flow", panel: "oiflow" },
    { id: "oihistory", label: "OI History", panel: "oihistory" },
    { id: "iv", label: "IV & Greeks", panel: "iv" },
    { id: "rollover", label: "Rollover", panel: "rollover" },
    { id: "bulk", label: "Smart Money", panel: "bulk" },
    { id: "futures", label: "Futures", panel: "futures" },
  ];
  const cache = {};

  const nz = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
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

  // ---- watchlist (localStorage) ------------------------------------------
  U.watch = (function () {
    const KEY = "in_watch";
    const get = () => {
      try {
        return JSON.parse(localStorage.getItem(KEY) || "[]");
      } catch (e) {
        return [];
      }
    };
    const set = (a) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(a));
      } catch (e) {
        /* ignore */
      }
    };
    return {
      list: get,
      has: (t) => get().indexOf(t) >= 0,
      toggle(t) {
        const a = get();
        const i = a.indexOf(t);
        if (i >= 0) a.splice(i, 1);
        else a.unshift(t);
        set(a.slice(0, 60));
      },
    };
  })();

  // ---- small India overview / volume panels (local to this view) ---------
  function levelsOf(p) {
    return (p && p.levels) || {};
  }
  function pcrBias(pcr) {
    if (pcr == null || isNaN(Number(pcr))) return { label: "—", cls: "mix" };
    if (Number(pcr) >= 1) return { label: "Bullish lean", cls: "bull" };
    if (Number(pcr) < 0.7) return { label: "Bearish lean", cls: "bear" };
    return { label: "Neutral", cls: "mix" };
  }

  U.PANELS.in_overview = {
    title: "Overview",
    render(data) {
      const p = data || {};
      const L = levelsOf(p);
      const spot = p.spot != null && !isNaN(Number(p.spot)) ? Number(p.spot) : null;
      const d = (lvl) => (lvl != null && spot ? (((Number(lvl) - spot) / spot) * 100).toFixed(2) + "%" : "–");
      const kpi = (label, value, sub, cls) =>
        `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v ${cls || ""}">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ""}</div>`;
      const levels =
        `<div class="kpis">` +
        kpi("Spot", spot != null ? inr(spot) : "–", esc(p.as_of || "")) +
        kpi("PCR", L.pcr != null ? esc(num(L.pcr)) : "–", "PE OI ÷ CE OI", L.pcr != null ? signCls(Number(L.pcr) - 1) : "") +
        kpi("Max pain", L.max_pain != null ? inr(L.max_pain) : "–", d(L.max_pain) + " from spot") +
        kpi("Resistance", L.resistance != null ? inr(L.resistance) : "–", d(L.resistance) + " above", "neg") +
        kpi("Support", L.support != null ? inr(L.support) : "–", d(L.support) + " below", "pos") +
        kpi("Expiry", esc((p.chain && p.chain.expiry) || "–"), esc((p.expiries || []).length + " expiries")) +
        `</div>`;
      const read = [];
      if (spot != null && L.resistance != null) read.push(`Resistance <b>${inr(L.resistance)}</b> sits <b>${d(L.resistance)}</b> above spot — likely ceiling into expiry.`);
      if (spot != null && L.support != null) read.push(`Support <b>${inr(L.support)}</b> sits <b>${d(L.support)}</b> below spot — likely floor while PE writing holds.`);
      if (spot != null && L.max_pain != null) {
        const mp = Math.abs(((spot - Number(L.max_pain)) / spot) * 100);
        if (mp < 1.5) read.push(`Spot is within <b>${mp.toFixed(1)}%</b> of max pain <b>${inr(L.max_pain)}</b> → strong <b>pin risk</b> into expiry.`);
      }
      if (L.pcr != null) read.push(Number(L.pcr) >= 1 ? `PCR <b>${num(L.pcr)}</b> — put writing dominates, <b>bullish lean</b>.` : Number(L.pcr) < 0.7 ? `PCR <b>${num(L.pcr)}</b> — call writing dominates, <b>bearish lean</b>.` : `PCR <b>${num(L.pcr)}</b> — positioning roughly balanced.`);
      const totals =
        `<div class="kv">` +
        `<div><span>Total CE OI</span><b>${esc(qty(p.call_oi))} shares</b></div>` +
        `<div><span>Total PE OI</span><b>${esc(qty(p.put_oi))} shares</b></div>` +
        `<div><span>Strikes</span><b>${p.chain && p.chain.strikes ? p.chain.strikes.length : "–"}</b></div>` +
        `<div><span>OI date</span><b>${esc(p.as_of || "–")}</b></div>` +
        `</div>`;
      return (
        card("Quick read · what stands out", read.length ? `<ul class="qr">${read.map((x) => `<li>${x}</li>`).join("")}</ul>` : '<div class="muted" style="padding:6px">not enough data</div>', 4) +
        card("Levels · PCR / max pain / S-R", levels, 2) +
        card("Totals · this expiry", totals, 2)
      );
    },
    info: {
      title: "Overview",
      tagline: "Spot, PCR, max pain and support/resistance for the selected expiry",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>The one-screen summary: <b>spot</b> (₹), <b>PCR</b> (PE OI ÷ CE OI), <b>max pain</b>, <b>resistance/support</b> with distance from spot, plus total CE/PE OI for the selected expiry. All OI quantities are <b>shares</b>.</p>`,
        },
        {
          h: "How to read it",
          p: `<p>PCR ≥ 1 leans bullish (put writing dominates), below ~0.7 leans bearish. Max pain pulls price into expiry. Resistance/support are the strikes writers defend — fade moves into them while the OI holds, break out only on a sustained cross.</p>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/symbol/{T}</code> — <code>spot</code>, <code>as_of</code>, <code>call_oi</code>, <code>put_oi</code>, <code>levels</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Day % is shown only when the backend provides a reference close; otherwise the header shows the OI date.</li><li>Levels are per-expiry — switching expiry changes them.</li></ul>`,
        },
      ],
    },
  };

  U.PANELS.in_volume = {
    title: "Volume",
    render(data, full) {
      const oi = U.PANELS.oi;
      if (oi && oi.volumeCard) return oi.volumeCard(data, full);
      return card("Volume", '<div class="muted" style="padding:6px">volume panel unavailable</div>', 2);
    },
    info: {
      title: "Volume",
      tagline: "Traded option volume by strike: where today's activity concentrated",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>CE vs PE <b>traded volume</b> by strike with totals and volume PCR (PE ÷ CE). Volume without OI build-up is a day trade; volume that builds OI is a position — cross-check against the OI Ladder tab. Quantities in <b>shares</b>.</p>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/symbol/{T}</code> — <code>chain.strikes.ce_vol</code> / <code>pe_vol</code>.</p>`,
        },
      ],
    },
  };

  // ---- data ---------------------------------------------------------------
  function urlFor(ticker, expiry) {
    let u = `/api/symbol/${encodeURIComponent(ticker)}`;
    if (expiry) u += `?expiry=${encodeURIComponent(expiry)}`;
    return u;
  }
  async function load(ticker, expiry) {
    const key = ticker + ":" + (expiry || "");
    if (cache[key]) return cache[key];
    const res = await fetch(urlFor(ticker, expiry));
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (e) {
        /* keep status */
      }
      throw new Error(msg);
    }
    cache[key] = await res.json();
    return cache[key];
  }
  // panels/oi.js + panels/oi_history.js ship as their own <script>s; if the
  // host page did not include them, fetch lazily so this view never depends
  // on index.html edits.
  let _oiLoading = null;
  function ensureOI() {
    if (U.PANELS.oi) return Promise.resolve();
    if (_oiLoading) return _oiLoading;
    _oiLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/panels/oi.js";
      s.onload = () => resolve();
      s.onerror = () => resolve(); // volume tab falls back gracefully
      document.head.appendChild(s);
    });
    return _oiLoading;
  }
  let _oiHistLoading = null;
  function ensureOIHistory() {
    if (U.PANELS.oihistory) return Promise.resolve();
    if (_oiHistLoading) return _oiHistLoading;
    _oiHistLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/panels/oi_history.js";
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
    return _oiHistLoading;
  }
  let _futLoading = null;
  function ensureFutures() {
    if (U.PANELS.futures) return Promise.resolve();
    if (_futLoading) return _futLoading;
    _futLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/panels/futures.js";
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
    return _futLoading;
  }

  // panels/iv.js ships as its own <script>; if the host page did not include
  // it, fetch it lazily so the IV & Greeks tab never depends on index.html.
  let _ivLoading = null;
  function ensureIv() {
    if (U.PANELS.iv) return Promise.resolve();
    if (_ivLoading) return _ivLoading;
    _ivLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/panels/iv.js";
      s.onload = () => resolve();
      s.onerror = () => resolve(); // tab falls back to "no panel" message
      document.head.appendChild(s);
    });
    return _ivLoading;
  }

  // panels/rollover.js ships as its own <script>; lazy-load on demand too.
  let _rollLoading = null;
  function ensureRollover() {
    if (U.PANELS.rollover) return Promise.resolve();
    if (_rollLoading) return _rollLoading;
    _rollLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/panels/rollover.js";
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
    return _rollLoading;
  }

  // panels/bulk.js ships as its own <script>; lazy-load the Smart Money feed
  // on demand so the tab never depends on an index.html edit.
  let _bulkLoading = null;
  function ensureBulk() {
    if (U.PANELS.bulk) return Promise.resolve();
    if (_bulkLoading) return _bulkLoading;
    _bulkLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/panels/bulk.js";
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
    return _bulkLoading;
  }

  // panels/oi_flow.js ships as its own <script>; if the host page did not
  // include it, fetch it lazily so the OI Flow tab never depends on
  // index.html edits.
  let _flowLoading = null;
  function ensureOiflow() {
    if (U.PANELS.oiflow) return Promise.resolve();
    if (_flowLoading) return _flowLoading;
    _flowLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/panels/oi_flow.js";
      s.onload = () => resolve();
      s.onerror = () => resolve(); // tab falls back to "no panel" message
      document.head.appendChild(s);
    });
    return _flowLoading;
  }

  // Pack cards into 4 columns, keeping panel order. Uses a 4px row unit (see
  // .pane .tabgrid) and backfills holes left by wide cards with later small cards.
  function layoutCards(pane) {
    const grid = pane && pane.querySelector(".tabgrid");
    if (!grid) return;
    const cards = [...grid.children].filter((e) => e.classList && e.classList.contains("card"));
    if (!cards.length) return;
    const spanOf = (c) =>
      c.classList.contains("c4") ? 4 : c.classList.contains("c3") ? 3 : c.classList.contains("c2") ? 2 : 1;
    cards.forEach((c) => {
      c.style.gridColumn = "span " + spanOf(c);
      c.style.gridRow = "";
    });
    void grid.offsetHeight;
    const heights = cards.map((c) => c.getBoundingClientRect().height);
    const ROW = 4, GAP = 5, unit = ROW + GAP;
    const occ = [[], [], [], []];
    const fits = (st, s, r, rows) => {
      for (let k = st; k < st + s; k++) {
        for (const iv of occ[k]) if (r < iv[1] && iv[0] < r + rows) return false;
      }
      return true;
    };
    const endsOf = (k) => {
      let m = 0;
      for (const iv of occ[k]) if (iv[1] > m) m = iv[1];
      return m;
    };
    const place = (s, rows) => {
      const bounds = new Set([0]);
      for (let k = 0; k + s <= 4; k++) for (const iv of occ[k]) { bounds.add(iv[0]); bounds.add(iv[1]); }
      for (const r of [...bounds].sort((a, b) => a - b)) {
        for (let st = 0; st + s <= 4; st++) if (fits(st, s, r, rows)) return { st, r };
      }
      let best = 0, bestRow = Infinity;
      for (let st = 0; st + s <= 4; st++) {
        let row = 0;
        for (let k = st; k < st + s; k++) row = Math.max(row, endsOf(k));
        if (row < bestRow) { bestRow = row; best = st; }
      }
      return { st: best, r: bestRow };
    };
    const placed = [];
    const rebuild = () => {
      const o = [[], [], [], []];
      placed.forEach((p) => {
        for (let k = p.st; k < p.st + p.s; k++) o[k].push([p.r, p.r + p.rows]);
      });
      o.forEach((a) => a.sort((x, y) => x[0] - y[0]));
      return o;
    };
    const overlaps = (o, p, st, r) => {
      for (let k = st; k < st + p.s; k++) for (const iv of o[k]) if (r < iv[1] && iv[0] < r + p.rows) return true;
      return false;
    };
    const endsOf2 = (o, k) => {
      let m = 0;
      for (const iv of o[k]) if (iv[1] > m) m = iv[1];
      return m;
    };
    cards.forEach((c, i) => {
      const rowsOf = () => Math.max(1, Math.ceil((heights[i] + GAP) / unit));
      let s = spanOf(c);
      let rows = rowsOf();
      let { st, r } = place(s, rows);
      if (s > 2) {
        let minF = Infinity;
        for (let k = st; k < st + s; k++) minF = Math.min(minF, endsOf(k));
        if (r - minF > 15) {
          s = 2;
          rows = rowsOf();
          ({ st, r } = place(s, rows));
        }
      }
      placed.push({ c, st, s, r, rows });
      for (let k = st; k < st + s; k++) {
        occ[k].push([r, r + rows]);
        occ[k].sort((a, b) => a[0] - b[0]);
      }
    });
    for (let pass = 0; pass < 3; pass++) {
      const o = rebuild();
      const ends = [0, 1, 2, 3].map((k) => endsOf2(o, k));
      const maxEnd = Math.max(...ends), minEnd = Math.min(...ends);
      if (maxEnd - minEnd < 6) break;
      let moved = false;
      for (let idx = placed.length - 1; idx >= 0 && !moved; idx--) {
        const p = placed[idx];
        if (p.s > 2 || p.r + p.rows !== maxEnd) continue;
        for (let st = 0; st + p.s <= 4; st++) {
          const targetEnd = Math.max(...Array.from({ length: p.s }, (_, k) => ends[st + k]));
          if (targetEnd + p.rows <= maxEnd - 1 && !overlaps(o, p, st, targetEnd)) {
            p.st = st;
            p.r = targetEnd;
            moved = true;
            break;
          }
        }
      }
      if (!moved) break;
    }
    placed.forEach((p) => {
      p.c.style.gridColumn = p.st + 1 + " / span " + p.s;
      p.c.style.gridRow = p.r + 1 + " / span " + p.rows;
    });
  }

  let _rz;
  window.addEventListener("resize", () => {
    clearTimeout(_rz);
    _rz = setTimeout(() => {
      const p = document.querySelector(".pane");
      if (p) layoutCards(p);
    }, 150);
  });

  // Day % only when the backend gives a reference close; else the OI date.
  function dayCell(p) {
    const spot = p.spot != null && !isNaN(Number(p.spot)) ? Number(p.spot) : null;
    const prev = p.prev_close != null && !isNaN(Number(p.prev_close)) ? Number(p.prev_close) : null;
    if (spot != null && prev) {
      const chg = ((spot - prev) / prev) * 100;
      return { label: "Day", html: `<b class="${signCls(chg)}">${chg.toFixed(2)}%</b>` };
    }
    if (p.day_change_pct != null && !isNaN(Number(p.day_change_pct))) {
      const chg = Number(p.day_change_pct);
      return { label: "Day", html: `<b class="${signCls(chg)}">${chg.toFixed(2)}%</b>` };
    }
    const short = p.as_of ? String(p.as_of).slice(0, 10) : "–";
    return { label: "OI date", html: `<b>${esc(short)}</b>` };
  }

  function headerHtml(ticker, payload) {
    const p = payload || {};
    const L = levelsOf(p);
    const spot = p.spot != null && !isNaN(Number(p.spot)) ? inr(p.spot) : "–";
    const day = dayCell(p);
    const b = pcrBias(L.pcr);
    const starred = U.watch.has(ticker);
    const brief = [
      L.pcr != null ? `PCR <b>${esc(num(L.pcr))}</b>` : "",
      L.max_pain != null ? `max pain <b>${inr(L.max_pain)}</b>` : "",
      L.resistance != null ? `R <b>${inr(L.resistance)}</b>` : "",
      L.support != null ? `S <b>${inr(L.support)}</b>` : "",
    ].filter(Boolean).join(" · ");
    return `
      <div class="sym-h">
        <div class="sym-id">
          <button class="star ${starred ? "on" : ""}" id="sym-star" title="Add / remove from watchlist">${starred ? "★" : "☆"}</button>
          <span class="sym-t">${esc(ticker)}</span>
          ${p.chain && p.chain.expiry ? `<span class="muted">· ${esc(p.chain.expiry)}</span>` : ""}
          <span class="chip ${b.cls}">${b.label}</span>
        </div>
        <div class="sym-brief">${brief}</div>
        <div class="sym-stats">
          <div><span>Spot</span><b>${spot}</b></div>
          <div><span>${day.label}</span>${day.html}</div>
          <div><span>PCR</span><b>${L.pcr != null ? esc(num(L.pcr)) : "–"}</b></div>
          <div><span>Max Pain</span><b>${L.max_pain != null ? inr(L.max_pain) : "–"}</b></div>
        </div>
        <button class="ghost" id="sym-reload">Reload</button>
      </div>`;
  }

  function tabsHtml(active) {
    return `<div class="tabs" id="sym-tabs">${TABS.map(
      (t) =>
        `<button data-tab="${t.id}" class="${t.id === active ? "on" : ""}">${t.label}<span class="tab-info" data-info="${t.id}" title="About this tab">i</span></button>`
    ).join("")}</div>`;
  }

  U.renderSymbol = function (root, ticker) {
    if (U.charts) U.charts.disposeAll();
    let active = (location.hash.split("?tab=")[1] || "overview").split("&")[0];
    if (!TABS.some((t) => t.id === active)) active = "overview";
    let expiry = null;
    root.innerHTML = `<div class="sym-wrap" id="sym-wrap"></div>`;
    const wrap = document.getElementById("sym-wrap");

    U.TABINFO = {};
    TABS.forEach((t) => {
      const info = (U.PANELS[t.panel] || {}).info;
      if (info) U.TABINFO[t.id] = info;
    });
    const refreshTabInfo = () => {
      TABS.forEach((t) => {
        const info = (U.PANELS[t.panel] || {}).info;
        if (info) U.TABINFO[t.id] = info;
      });
    };

    function paintHeader(payload) {
      const el = wrap.querySelector(".sym-h");
      const html = headerHtml(ticker, payload);
      if (el) el.outerHTML = html;
      else wrap.insertAdjacentHTML("afterbegin", html);
      wrap.querySelector("#sym-reload").onclick = () => {
        Object.keys(cache).forEach((k) => {
          if (k.startsWith(ticker + ":")) delete cache[k];
        });
        loadTab(active, true);
      };
      const star = wrap.querySelector("#sym-star");
      if (star) star.onclick = () => {
        U.watch.toggle(ticker);
        paintHeader(payload);
      };
    }

    function paintTabs() {
      const el = wrap.querySelector(".tabs");
      const html = tabsHtml(active);
      if (el) el.outerHTML = html;
      else wrap.insertAdjacentHTML("beforeend", html);
      wrap.querySelectorAll("#sym-tabs button").forEach((b) => {
        b.onclick = (e) => {
          active = b.dataset.tab;
          history.replaceState(null, "", `#/symbol/${ticker}?tab=${active}`);
          const wantsInfo = e.target && e.target.classList && e.target.classList.contains("tab-info");
          paintTabs();
          loadTab(active);
          if (wantsInfo) U.showInfo(active);
        };
      });
    }

    function expiryBar(payload) {
      const list = (payload && payload.expiries) || [];
      if (list.length < 2) return "";
      return `<div class="presets" id="sym-exp">` +
        list.map((x) => `<button class="preset${x === (expiry || (payload.chain && payload.chain.expiry)) ? " on" : ""}" data-exp="${esc(x)}">${esc(x)}</button>`).join("") +
        `</div>`;
    }

    async function loadTab(tabId, force) {
      const tab = TABS.find((t) => t.id === tabId) || TABS[0];
      if (force) {
        Object.keys(cache).forEach((k) => {
          if (k.startsWith(ticker + ":")) delete cache[k];
        });
      }
      let pane = wrap.querySelector(".pane");
      if (!pane) {
        wrap.insertAdjacentHTML("beforeend", '<div class="pane"><div class="muted" style="padding:10px">Loading…</div></div>');
        pane = wrap.querySelector(".pane");
      }
      if (U.charts) U.charts.disposeAll();
      pane.innerHTML = '<div class="muted" style="padding:10px">Loading ' + esc(tab.label) + '…</div>';
      try {
        await ensureOI();
        await ensureOiflow();
        await ensureOIHistory();
        await ensureFutures();
        await ensureIv();
        await ensureRollover();
        await ensureBulk();
        refreshTabInfo();
        const payload = await load(ticker, expiry);
        const panel = U.PANELS[tab.panel];
        const html = panel ? panel.render(payload, payload) : "";
        const bar = expiryBar(payload);
        pane.innerHTML = (bar || "") + `<div class="tabgrid">${html || '<div class="muted" style="padding:10px">No panel for ' + esc(tab.label) + "</div>"}</div>`;
        const exp = pane.querySelector("#sym-exp");
        if (exp) {
          exp.querySelectorAll("[data-exp]").forEach((btn) => {
            btn.onclick = () => {
              expiry = btn.dataset.exp;
              loadTab(active, true);
            };
          });
        }
        if (panel && panel.afterRender) {
          try {
            panel.afterRender(pane, ticker, payload);
          } catch (e) {
            /* panel decoration is best-effort */
          }
        }
        layoutCards(pane);
        if (U.charts) U.charts.mount(pane);
        setTimeout(() => {
          layoutCards(pane);
          if (U.charts) U.charts.resizeAll();
        }, 350);
        paintHeader(payload);
      } catch (e) {
        pane.innerHTML = `<div class="muted" style="padding:10px">Failed: ${esc(e.message)}</div>`;
      }
    }

    paintHeader(null);
    paintTabs();
    loadTab(active);
  };
})();
