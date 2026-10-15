/* Symbol drill-down view: header stats + lazy-loaded tab panels. */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, num, money, signCls, tk } = U.util;
  // Tabs are grouped by `mode` and kept contiguous (Today · Intraday · EOD) so
  // the "all" view can drop INTRA/EOD section labels between the two groups.
  const TABS = [
    { id: "today", label: "Today", groups: ["today"], mode: "always" },
    { id: "intraday", label: "Intraday", groups: ["intraday"], mode: "intraday" },
    { id: "flow", label: "Flow", groups: ["flow"], mode: "intraday" },
    { id: "timeline", label: "Timeline", groups: ["timeline"], mode: "intraday" },
    { id: "whales", label: "Whales", groups: ["whales"], mode: "intraday" },
    { id: "darkpool", label: "Dark Pool", groups: ["darkpool"], mode: "intraday" },
    { id: "news", label: "News", groups: ["news"], mode: "intraday" },
    { id: "overview", label: "Overview", groups: ["overview"], mode: "eod" },
    { id: "heatmap", label: "Heatmap", groups: ["gexmatrix"], mode: "eod" },
    { id: "gexchart", label: "GEX Chart", groups: ["gexchart"], mode: "intraday" },
    { id: "gex", label: "GEX / Options", groups: ["gex", "options"], mode: "eod" },
    { id: "vol", label: "Volatility", groups: ["vol"], mode: "eod" },
    { id: "positioning", label: "Positioning", groups: ["shorts", "insiders"], mode: "eod" },
    { id: "fundamentals", label: "ETF flow", groups: ["etf"], mode: "eod" },
  ];
  const cache = {};
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};

  // ---- mode grouping (UW.mode) -------------------------------------------
  // Contract: get() -> "all"|"intraday"|"eod"; visible(kind) -> boolean.
  // UW.mode may be absent during dev — treat that as "all / show everything".
  const GROUP_LABEL = { intraday: "INTRA", eod: "EOD" };
  const GROUP_STYLE_ID = "uw-tab-group-style";

  function modeState() {
    const m = U.mode;
    const visible = (kind) => {
      if (!m || typeof m.visible !== "function") return true;
      try {
        return !!m.visible(kind);
      } catch {
        return true;
      }
    };
    let all = true;
    if (m && typeof m.get === "function") {
      try {
        all = (m.get() || "all") === "all";
      } catch {
        all = true;
      }
    }
    return { visible, all };
  }

  function firstVisibleTab() {
    const { visible } = modeState();
    return TABS.find((t) => visible(t.mode)) || TABS[0];
  }

  function ensureGroupStyle() {
    if (typeof document === "undefined" || document.getElementById(GROUP_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = GROUP_STYLE_ID;
    s.textContent =
      ".tabs .tab-group{display:inline-flex;align-items:center;align-self:center;pointer-events:none;" +
      "user-select:none;padding:0 7px 0 9px;margin-left:4px;font-size:9px;font-weight:700;" +
      "text-transform:uppercase;letter-spacing:.09em;color:var(--muted);border-left:1px solid var(--border)}" +
      ".tabs .tab-group:first-child{border-left:0;margin-left:0}";
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- live ticks (UW.stream) --------------------------------------------
  // Best-effort: if the stream client isn't present we leave static values.
  const nn = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const FLASH_STYLE_ID = "uw-tick-flash-style";

  function ensureFlashStyle() {
    if (typeof document === "undefined" || document.getElementById(FLASH_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = FLASH_STYLE_ID;
    s.textContent =
      "@keyframes uwTickUp{from{background:rgba(22,163,74,.38)}to{background:transparent}}" +
      "@keyframes uwTickDown{from{background:rgba(220,38,38,.38)}to{background:transparent}}" +
      ".td-up{animation:uwTickUp .7s ease-out;border-radius:3px}" +
      ".td-down{animation:uwTickDown .7s ease-out;border-radius:3px}";
    (document.head || document.documentElement).appendChild(s);
  }

  function flash(el, dir) {
    if (!el || !dir) return;
    const cls = dir > 0 ? "td-up" : "td-down";
    el.classList.remove("td-up", "td-down");
    void el.offsetWidth; // restart the animation on a rapid tick
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 700);
  }

  function stopHeaderStream() {
    if (typeof U.symStreamStop === "function") {
      try {
        U.symStreamStop();
      } catch {
        /* ignore */
      }
    }
    U.symStreamStop = null;
  }

  function updateHeaderQuote(q) {
    const wrap = document.getElementById("sym-wrap");
    if (!wrap || !q) return;
    const lastEl = wrap.querySelector("#sym-last");
    const dayEl = wrap.querySelector("#sym-day");
    const last = nn(q.last);
    const prev = nn(q.prev_close);
    let chg = nn(q.chg_pct);
    if (chg == null && last != null && prev) chg = ((last - prev) / prev) * 100;

    if (last != null && lastEl) {
      const text = last.toFixed(2);
      const shown = nn(lastEl.dataset.v) != null ? nn(lastEl.dataset.v) : nn(lastEl.textContent);
      if (lastEl.textContent !== text) {
        lastEl.textContent = text;
        const dir = shown != null ? Math.sign(last - shown) : chg != null ? Math.sign(chg) : 0;
        flash(lastEl, dir);
      }
      lastEl.dataset.v = String(last);
    }
    if (chg != null && dayEl) {
      const text = chg.toFixed(2) + "%";
      if (dayEl.textContent !== text) {
        dayEl.textContent = text;
        flash(dayEl, Math.sign(chg));
      }
      dayEl.classList.remove("pos", "neg", "muted");
      dayEl.classList.add(signCls(chg));
    }
  }

  function startHeaderStream(ticker) {
    if (!(U.stream && typeof U.stream.quote === "function")) return;
    ensureFlashStyle();
    try {
      const stop = U.stream.quote(ticker, updateHeaderQuote);
      if (typeof stop === "function") U.symStreamStop = stop;
    } catch {
      /* stream is best-effort */
    }
  }

  // ---- watchlist (localStorage) ------------------------------------------
  U.watch = (function () {
    const KEY = "uw_watch";
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

  // tiny inline sparkline (no chart lib — safe in the header)
  function sparkSvg(vals, w, h) {
    const v = (vals || []).filter((x) => x != null && !isNaN(x));
    if (v.length < 2) return "";
    const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const x = (i) => (i / (v.length - 1)) * w;
    const y = (val) => h - ((val - min) / span) * h;
    const d = v.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(" ");
    const c = v[v.length - 1] >= v[0] ? "#16a34a" : "#dc2626";
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.4"/></svg>`;
  }

  // simple bias: options flow sign + gamma regime + day direction.
  // Flow is the DIRECTIONAL net premium (net calls − net puts): put buying is
  // bearish, so subtract it (mirrors panels/today.js).
  function bias(st, gx, ov) {
    let s = 0, k = 0;
    const ncp = ov.net_call_premium;
    const npp = ov.net_put_premium;
    if (ncp != null || npp != null) {
      s += (Number(ncp) || 0) - (Number(npp) || 0) >= 0 ? 1 : -1;
      k++;
    }
    if (st.close != null && gx.gamma_flip != null) {
      s += Number(st.close) >= Number(gx.gamma_flip) ? 1 : -1;
      k++;
    }
    if (st.close != null && st.prev_close) {
      s += Number(st.close) >= Number(st.prev_close) ? 1 : -1;
      k++;
    }
    if (!k) return { label: "—", cls: "mix" };
    if (s >= 2) return { label: "Bullish", cls: "bull" };
    if (s <= -2) return { label: "Bearish", cls: "bear" };
    return { label: "Mixed", cls: "mix" };
  }

  async function load(ticker, group) {
    const key = ticker + ":" + group;
    if (cache[key]) return cache[key];
    const res = await fetch(`/api/symbol/${encodeURIComponent(ticker)}?group=${group}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    cache[key] = await res.json();
    return cache[key];
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
    // measure natural height at the correct column width
    cards.forEach((c) => {
      c.style.gridColumn = "span " + spanOf(c);
      c.style.gridRow = "";
    });
    void grid.offsetHeight;
    const heights = cards.map((c) => c.getBoundingClientRect().height);
    const ROW = 4, GAP = 5, unit = ROW + GAP;
    const occ = [[], [], [], []]; // per column: sorted [startRow, endRow) intervals

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

    cards.forEach((c, i) => {
      const rowsOf = () => Math.max(1, Math.ceil((heights[i] + GAP) / unit));
      let s = spanOf(c);
      let rows = rowsOf();
      let { st, r } = place(s, rows);
      // a wide card that would leave a big hole drops to half width
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

    // equalizer: nudge the bottom-most small card into a shorter column so the
    // column ends line up (removes the big empty spots at the bottom).
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

  function endsOf2(o, k) {
    let m = 0;
    for (const iv of o[k]) if (iv[1] > m) m = iv[1];
    return m;
  }

  let _rz;
  window.addEventListener("resize", () => {
    clearTimeout(_rz);
    _rz = setTimeout(() => {
      const p = document.querySelector(".pane");
      if (p) layoutCards(p);
    }, 150);
  });

  function headerHtml(ticker, payload) {
    const d = payload ? payload.data : {};
    const info = first(d.info);
    const st = first(d.stock_state);
    const un = first(d.unusualness);
    const vs = first(d.vol_stats);
    const gx = first(d.gex_levels);
    const ov = first(d.options_volume);
    const ohlc = Array.isArray(d.ohlc_daily) ? d.ohlc_daily : [];
    const px = st.close != null ? num(st.close) : "–";
    const prev = num(st.prev_close);
    const chg = prev && st.close ? ((st.close - prev) / prev) * 100 : null;
    const ivVal = U.util.ivPct(vs.iv);
    const iv = ivVal != null ? ivVal.toFixed(1) + "%" : "–";
    const ivr = vs.iv_rank != null ? num(vs.iv_rank, 0) : "–";
    const b = bias(st, gx, ov);
    const closes = ohlc.slice(0, 30).map((r) => Number(r.close)).reverse();
    const spark = sparkSvg(closes, 72, 20);
    const ncp = ov.net_call_premium;
    const brief = [
      ncp != null ? `net prem <b class="${signCls(ncp)}">${money(ncp)}</b>` : "",
      gx.gamma_flip != null && st.close != null ? `${Number(st.close) >= Number(gx.gamma_flip) ? "above" : "below"} flip <b>${esc(gx.gamma_flip)}</b>` : "",
      gx.gamma_magnet != null ? `magnet <b>${esc(gx.gamma_magnet)}</b>` : "",
    ].filter(Boolean).join(" · ");
    const near = [];
    const pxN = Number(st.close);
    [["flip", gx.gamma_flip], ["call wall", gx.call_wall], ["put wall", gx.put_wall]].forEach(([name, lvl]) => {
      const L = Number(lvl);
      if (pxN && L && Math.abs(pxN - L) / pxN < 0.004) near.push(`${name} ${lvl}`);
    });
    const starred = U.watch.has(ticker);
    return `
      <div class="sym-h">
        <div class="sym-id">
          <button class="star ${starred ? "on" : ""}" id="sym-star" title="Add / remove from watchlist">${starred ? "★" : "☆"}</button>
          <span class="sym-t">${esc(ticker)}</span>
          <span class="sym-n">${esc(info.full_name || "")}</span>
          ${info.sector ? `<span class="muted">· ${esc(info.sector)}</span>` : ""}
          <span class="chip ${b.cls}">${b.label}</span>
          ${near.length ? `<span class="alert-chip" title="Spot is within 0.4% of a key level">⚡ near ${esc(near.join(", "))}</span>` : ""}
        </div>
        <div class="sym-brief">${brief}</div>
        <div class="sym-stats">
          ${spark ? `<div class="spark-w" title="last 30 daily closes">${spark}</div>` : ""}
          <div><span>Last</span><b id="sym-last">${px}</b></div>
          <div><span>Day</span><b id="sym-day" class="${signCls(chg)}">${chg == null ? "–" : chg.toFixed(2) + "%"}</b></div>
          <div><span>IV</span><b>${iv}</b></div>
          <div><span>IV Rank</span><b>${ivr}</b></div>
        </div>
        <button class="ghost" id="sym-reload">Reload</button>
      </div>`;
  }

  function tabsHtml(active) {
    ensureGroupStyle();
    const { visible, all } = modeState();
    let html = "";
    let lastGroup = null;
    TABS.forEach((t) => {
      if (!visible(t.mode)) return;
      if (all && GROUP_LABEL[t.mode] && t.mode !== lastGroup) {
        html += `<span class="tab-group">${GROUP_LABEL[t.mode]}</span>`;
        lastGroup = t.mode;
      }
      html += `<button data-tab="${t.id}" class="${t.id === active ? "on" : ""}">${t.label}<span class="tab-info" data-info="${t.id}" title="About this tab">i</span></button>`;
    });
    return `<div class="tabs" id="sym-tabs">${html}</div>`;
  }

  U.renderSymbol = function (root, ticker) {
    if (U.charts) U.charts.disposeAll();
    stopHeaderStream();
    // Drop any mode subscription from the previous symbol so they don't stack.
    if (typeof U.symModeUnsub === "function") {
      try {
        U.symModeUnsub();
      } catch {
        /* ignore */
      }
      U.symModeUnsub = null;
    }
    let active = (location.hash.split("?tab=")[1] || "today").split("&")[0];
    if (!TABS.some((t) => t.id === active)) active = "today";
    // A deep-linked tab may be hidden under the current mode — fall back.
    if (!modeState().visible((TABS.find((t) => t.id === active) || TABS[0]).mode)) active = firstVisibleTab().id;
    root.innerHTML = `<div class="sym-wrap" id="sym-wrap"></div>`;
    const wrap = document.getElementById("sym-wrap");
    let headerPayload = null;
    // combined docs for merged tabs
    U.TABINFO = {};
    TABS.forEach((t) => {
      const parts = t.groups.map((g) => (U.PANELS[g] || {}).info).filter(Boolean);
      if (!parts.length) return;
      U.TABINFO[t.id] =
        t.groups.length === 1
          ? parts[0]
          : { title: t.label, tagline: parts.map((p) => p.tagline).filter(Boolean).join(" · "), sections: parts.flatMap((p) => p.sections || []) };
    });

    function paintHeader() {
      const el = wrap.querySelector(".sym-h");
      const html = headerHtml(ticker, headerPayload);
      if (el) el.outerHTML = html;
      else wrap.insertAdjacentHTML("afterbegin", html);
      wrap.querySelector("#sym-reload").onclick = () => {
        const tab = TABS.find((t) => t.id === active) || TABS[0];
        tab.groups.forEach((g) => delete cache[ticker + ":" + g]);
        loadTab(active, true);
      };
      const star = wrap.querySelector("#sym-star");
      if (star) star.onclick = () => {
        U.watch.toggle(ticker);
        paintHeader();
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

    async function loadTab(tabId, force) {
      const tab = TABS.find((t) => t.id === tabId) || TABS[0];
      if (force) tab.groups.forEach((g) => delete cache[ticker + ":" + g]);
      let pane = wrap.querySelector(".pane");
      if (!pane) {
        wrap.insertAdjacentHTML("beforeend", '<div class="pane"><div class="muted" style="padding:10px">Loading…</div></div>');
        pane = wrap.querySelector(".pane");
      }
      if (U.charts) U.charts.disposeAll();
      if (typeof U.tdStripStop === "function") {
        try {
          U.tdStripStop();
        } catch {
          /* ignore */
        }
        U.tdStripStop = null;
      }
      pane.innerHTML = '<div class="muted" style="padding:10px">Loading ' + esc(tab.label) + '…</div>';
      try {
        const payloads = await Promise.all(tab.groups.map((g) => load(ticker, g)));
        let html = "";
        payloads.forEach((payload, i) => {
          const panel = U.PANELS[tab.groups[i]];
          if (panel) html += panel.render(payload.data, payload);
        });
        pane.innerHTML = `<div class="tabgrid">${html || '<div class="muted" style="padding:10px">No panel for ' + esc(tab.label) + "</div>"}</div>`;
        payloads.forEach((payload, i) => {
          const panel = U.PANELS[tab.groups[i]];
          if (panel && panel.afterRender) {
            try {
              panel.afterRender(pane, ticker, payload);
            } catch (e) {
              /* panel decoration is best-effort */
            }
          }
        });
        layoutCards(pane);
        if (U.charts) U.charts.mount(pane);
        // charts/widgets can settle a beat later
        setTimeout(() => {
          layoutCards(pane);
          if (U.charts) U.charts.resizeAll();
        }, 350);
      } catch (e) {
        pane.innerHTML = `<div class="muted" style="padding:10px">Failed: ${esc(e.message)}</div>`;
      }
    }

    // Live mode toggles: repaint the tab bar, and if the active tab was
    // hidden by the new mode, jump to the first visible tab (Today first).
    function onModeChange() {
      const cur = TABS.find((t) => t.id === active) || TABS[0];
      if (!modeState().visible(cur.mode)) {
        active = firstVisibleTab().id;
        history.replaceState(null, "", `#/symbol/${ticker}?tab=${active}`);
        paintTabs();
        loadTab(active);
      } else {
        paintTabs();
      }
    }

    paintHeader();
    startHeaderStream(ticker);
    paintTabs();
    loadTab(active);

    if (U.mode && typeof U.mode.on === "function") {
      try {
        const unsub = U.mode.on(onModeChange);
        U.symModeUnsub = typeof unsub === "function" ? unsub : null;
      } catch {
        U.symModeUnsub = null;
      }
    }

    // prefetch overview for the header if a non-overview tab was deep-linked
    if (active !== "overview") {
      load(ticker, "overview").then((p) => {
        headerPayload = p;
        paintHeader();
      });
    } else {
      load(ticker, "overview").then((p) => {
        headerPayload = p;
        paintHeader();
      });
    }

    if (U.tour && U.tour.auto) U.tour.auto(ticker);
  };
})();
