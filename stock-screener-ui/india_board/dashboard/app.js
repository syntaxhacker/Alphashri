/* India Board home view (snapshot), router, and symbol search.
 *
 * Home is built from GET /api/snapshot ->
 *   { generated_at,
 *     sections: {
 *       indices: [{ ticker, last, chg_pct }],
 *       leaders: [{ ticker, last, pcr, max_pain, resistance, support,
 *                   top_call_oi_strike, top_put_oi_strike }] } }
 * `chg_pct` is a percent number (e.g. 0.5 means +0.5%).
 * `leaders` arrive pre-ranked by the backend; home shows the first 8.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, num, signCls, table, card, tk, money, int } = U.util;

  // ---- Indian formatting (local helpers; shared panels/_util.js untouched) --
  const nz = (v, d) => (v == null || v === "" || isNaN(Number(v)) ? d || 0 : Number(v));
  const rs = (v, d) => {
    if (v == null || isNaN(Number(v))) return "–";
    const n = d == null ? 2 : d;
    return "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: n, maximumFractionDigits: n });
  };
  const rs0 = (v) => rs(v, 0);
  // Compact ₹ form: ₹1.20Cr / ₹45.6L / ₹8.9K
  const inrShort = (v) => {
    const x = nz(v);
    const a = Math.abs(x);
    const s = x < 0 ? "-₹" : "₹";
    if (a >= 1e7) return s + (a / 1e7).toFixed(2) + "Cr";
    if (a >= 1e5) return s + (a / 1e5).toFixed(1) + "L";
    if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "K";
    return s + a.toFixed(2);
  };
  U.inr = { rs, rs0, inrShort };

  // Home render generation + in-flight flag. The 60s auto-refresh, hashchange
  // route re-renders and the async fills must never overlap each other, and a
  // late async write must not touch a node a newer render already detached.
  let homeRenderGen = 0;
  let homeRenderBusy = false;

  // Honest reason shown on the indices/OI cards when the snapshot is empty,
  // chosen from the payload so "market closed" is distinguishable from a dead
  // Fyers feed token. Never returns null/undefined.
  function noSnapshotMsg(d) {
    const status = d && d.data_status;
    const reason = String((d && d.reason) || "").toLowerCase();
    if (status === "feed_auth_failed" || /auth|401/.test(reason)) {
      return "feed token expired — re-authenticate Fyers in Settings (data resumes on the next capture)";
    }
    if (status === "market_closed") {
      return "market closed — no snapshot captured yet (shows the last session once available)";
    }
    return "no snapshot data available";
  }

  function indicesBody(rows, emptyMsg) {
    if (!rows || !rows.length) return `<div class="muted" style="padding:6px">${esc(emptyMsg || "no data")}</div>`;
    return `<div class="kpis">${rows
      .map((r) => {
        const chg = nz(r.chg_pct);
        const cls = chg > 0 ? "pos" : chg < 0 ? "neg" : "muted";
        const arrow = chg > 0 ? "▲" : chg < 0 ? "▼" : "";
        return (
          `<div class="kpi"><div class="kpi-l">${r.ticker ? tk(r.ticker) : "–"}</div>` +
          `<div class="kpi-v">${rs(nz(r.last), 2)}</div>` +
          `<div class="kpi-s ${cls}">${arrow} ${chg >= 0 ? "+" : ""}${num(chg, 2)}%</div></div>`
        );
      })
      .join("")}</div>`;
  }

  function leadersTable(rows, emptyMsg) {
    if (!rows || !rows.length) return `<div class="muted" style="padding:6px">${esc(emptyMsg || "no data")}</div>`;
    const maxDev = Math.max(0.05, ...rows.map((r) => Math.abs(nz(r.pcr, 1) - 1)));
    return table(
      [
        { label: "Ticker" },
        { label: "Spot", num: true },
        { label: "PCR", num: true },
        { label: "Max Pain", num: true },
        { label: "Resistance", num: true },
        { label: "Support", num: true },
      ],
      rows,
      (r) => {
        const dev = nz(r.pcr, 1) - 1;
        return (
          `<tr><td>${r.ticker ? tk(r.ticker) : "–"}</td>` +
          `<td class="num">${rs0(r.last)}</td>` +
          `<td class="num ${Math.abs(dev) >= 0.4 ? "warn" : "muted"}" style="background:${U.heat ? U.heat(dev, maxDev) : ""}">${num(r.pcr, 2)}</td>` +
          `<td class="num">${rs0(r.max_pain)}</td>` +
          `<td class="num neg">${rs0(r.resistance)}</td>` +
          `<td class="num pos">${rs0(r.support)}</td></tr>`
        );
      }
    );
  }

  // ---- market context: breadth (independent async fill) -------------------
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;
  const bKpi = (label, value, sub, cls) =>
    `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v ${cls || ""}">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ""}</div>`;

  function breadthList(items) {
    if (!items.length) return '<div class="muted" style="padding:2px 0">–</div>';
    return items
      .map((r) => {
        const c = nz(r.chp);
        return (
          `<div style="display:flex;justify-content:space-between;gap:8px;padding:1px 0">` +
          `<a class="tk" data-tk="${esc(r.ticker)}">${esc(r.ticker)}</a>` +
          `<span class="${c > 0 ? "pos" : c < 0 ? "neg" : "muted"}">${c > 0 ? "+" : ""}${num(c, 2)}%</span></div>`
        );
      })
      .join("");
  }

  function breadthBody(d) {
    const adv = d.advancers, dec = d.decliners, unch = d.unchanged;
    const rows = Array.isArray(d.rows) ? d.rows.filter((r) => r && r.ticker) : [];
    const tot = nz(adv) + nz(dec);
    const pct = tot > 0 ? (nz(adv) / tot) * 100 : nz(d.pct_advancing);
    const heat = U.heat ? U.heat(pct - 50, 50) : "";
    const sorted = rows.slice().sort((a, b) => nz(b.chp) - nz(a.chp));
    return (
      `<div class="kpis">` +
      bKpi("Advancers", int(adv), tot > 0 ? num((nz(adv) / tot) * 100, 0) + "% of moved" : "", "pos") +
      bKpi("Decliners", int(dec), tot > 0 ? num((nz(dec) / tot) * 100, 0) + "% of moved" : "", "neg") +
      bKpi("Unchanged", int(unch), "flat") +
      bKpi("% advancing", `<span style="background:${heat};padding:0 4px;border-radius:3px">${num(pct, 1)}%</span>`, "adv ÷ (adv + dec)") +
      `</div>` +
      `<div style="display:flex;gap:10px;padding:4px 6px">` +
      `<div style="flex:1;min-width:0"><div class="kpi-l">Top 5 · gainers</div>${breadthList(sorted.slice(0, 5))}</div>` +
      `<div style="flex:1;min-width:0"><div class="kpi-l">Bottom 5 · losers</div>${breadthList(sorted.slice(-5).reverse())}</div>` +
      `</div>` +
      cap(
        `advancers / decliners across the scanned universe${d.as_of ? " · as of " + esc(d.as_of) : ""} · ` +
          `India VIX sits on the symbol <b>IV &amp; Greeks</b> tab`
      )
    );
  }

  async function fillBreadth(root, gen) {
    const host = root && root.querySelector ? root.querySelector("[data-breadth]") : null;
    if (!host) return;
    // A write is only safe while this render is still the latest one AND the
    // captured node is still attached to the document.
    const stale = () => (gen != null && gen !== homeRenderGen) || !host.isConnected;
    try {
      const res = await fetch("/api/breadth");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();
      if (stale()) return; // re-rendered/torn down while fetching
      if (!d || d.unavailable) {
        host.innerHTML = `<div class="muted" style="padding:6px">breadth unavailable${d && d.reason ? ": " + esc(d.reason) : ""}</div>`;
        return;
      }
      host.innerHTML = breadthBody(d);
    } catch (e) {
      if (!stale()) host.innerHTML = `<div class="muted" style="padding:6px">breadth unavailable: ${esc(e.message)}</div>`;
    }
  }

  // ---- home · smart money (NSE bulk/block deals, independent async fill) --
  // End-of-day feed: filled separately so it never delays or breaks the main
  // home render. Mirrors fillBreadth's never-throw contract.
  const BULK_PROVENANCE =
    "Source: NSE bulk/block deal disclosures (end-of-day, 0.5% of paid-up equity threshold) · classification is heuristic";
  const crCell = (v) => (v == null || v === "" || isNaN(Number(v)) ? "–" : rs(v));

  function bulkHomeBody(d) {
    const deals = Array.isArray(d.deals) ? d.deals.filter((x) => x && typeof x === "object") : [];
    const qual = deals.filter((x) => x.qualifying).sort((a, b) => nz(b.value_cr) - nz(a.value_cr));
    const qCount =
      d.qualifying_count != null && !isNaN(Number(d.qualifying_count)) ? Number(d.qualifying_count) : qual.length;
    const qVal =
      d.qualifying_value_cr != null && !isNaN(Number(d.qualifying_value_cr))
        ? Number(d.qualifying_value_cr)
        : qual.reduce((s, x) => s + nz(x.value_cr), 0);
    const top = qual.slice(0, 5);
    const rows = top.length
      ? table(
          [{ label: "Symbol" }, { label: "Client" }, { label: "Value ₹Cr", num: true }],
          top,
          (r) =>
            `<tr><td>${r.symbol ? tk(r.symbol) : "–"}</td>` +
            `<td class="muted" style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${esc(r.client || "–")}</td>` +
            `<td class="num">${crCell(r.value_cr)}</td></tr>`
        )
      : '<div class="muted" style="padding:4px 6px">no qualifying deals in this capture</div>';
    return (
      `<div class="kpis">` +
      bKpi("Qualifying", String(qCount), "≥ value threshold", "pos") +
      bKpi("Qualifying value", rs(qVal) + " Cr", "sum of qualifying", "pos") +
      `</div>` +
      rows +
      cap(`captured <b>${esc(d.date || "–")}</b> IST · top 5 qualifying by value · ` + BULK_PROVENANCE)
    );
  }

  async function fillBulkDeals(root, gen) {
    const host = root && root.querySelector ? root.querySelector("[data-bulk-home]") : null;
    if (!host) return;
    const stale = () => (gen != null && gen !== homeRenderGen) || !host.isConnected;
    try {
      const res = await fetch("/api/bulk-deals");
      // Guard BEFORE the 404/not-captured branch writes: a detached host must
      // never be written to (was the source of the removeChild race).
      if (stale()) return; // re-rendered/torn down while fetching
      if (res.status === 404) {
        host.innerHTML = '<div class="muted" style="padding:6px">no bulk deals captured for today — capture runs after 18:00 IST on trading days</div>';
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = await res.json();
      if (stale()) return;
      if (!d || d.unavailable) {
        host.innerHTML = '<div class="muted" style="padding:6px">bulk-deal feed unavailable</div>';
        return;
      }
      if (!Array.isArray(d.deals) || !d.deals.length) {
        host.innerHTML = `<div class="muted" style="padding:6px">no bulk deals captured for ${esc(d.date || "today")} — capture runs after 18:00 IST on trading days</div>`;
        return;
      }
      host.innerHTML = bulkHomeBody(d);
    } catch (e) {
      if (!stale()) host.innerHTML = '<div class="muted" style="padding:6px">bulk-deal feed unavailable</div>';
    }
  }

  // ---- home tape / opportunities (NSE F&O scan) --------------------------
  // `side` arrives as CE/PE from the scanner; normalise defensively and colour
  // calls green / puts red (same convention as the symbol view).
  const sideLabel = (v) => {
    const t = String(v == null ? "" : v).toUpperCase();
    if (t === "C" || t === "CALL" || t === "CE") return "CE";
    if (t === "P" || t === "PUT" || t === "PE") return "PE";
    return t || "–";
  };
  const sideCls = (v) => (sideLabel(v) === "CE" ? "pos" : sideLabel(v) === "PE" ? "neg" : "muted");

  // Honest empty/loading states. `sec` is the raw section object (may be
  // missing on older payloads). "warming_up" means the scanner has no previous
  // scan to diff against yet — not an error.
  const sectionRows = (sec) => (sec && Array.isArray(sec.rows) ? sec.rows : []);
  const sectionEmptyMsg = (sec, emptyText) => {
    if (!sec) return "unavailable";
    if (sec.status === "warming_up")
      return "warming up — waiting for the next 5-min scan window (previous scan is the baseline)";
    return emptyText;
  };
  const sectionBody = (sec, emptyText, cols, rows, rowFn) =>
    rows.length ? table(cols, rows, rowFn) : `<div class="muted" style="padding:6px">${esc(sectionEmptyMsg(sec, emptyText))}</div>`;

  async function renderSnapshot(root) {
    const gen = ++homeRenderGen;
    homeRenderBusy = true;
    try {
      // Dispose charts bound to the outgoing content BEFORE wiping it — ECharts
      // / ResizeObserver teardown must not run against nodes a later wipe
      // already removed (the removeChild NotFoundError race).
      if (U.charts && U.charts.disposeIn && root) U.charts.disposeIn(root);
      if (!root || !root.isConnected) return;
      root.innerHTML =
        '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading snapshot…</div></div></div>';
      let d;
      try {
        const res = await fetch("/api/snapshot");
        if (!res.ok) throw new Error("HTTP " + res.status);
        d = await res.json();
      } catch (e) {
        if (gen !== homeRenderGen || !root.isConnected) return;
        root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
        return;
      }
      if (gen !== homeRenderGen || !root.isConnected) return; // superseded while fetching
      const s = (d && d.sections) || {};
      const genEl = document.getElementById("gen");
      if (genEl) {
        try {
          genEl.textContent = d.generated_at
            ? new Date(d.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST"
            : "";
        } catch (e) {
          genEl.textContent = "";
        }
        if (d.stale) genEl.textContent += " · cached (feed login expired)";
      }
      const leaders = (s.leaders || []).slice(0, 8);
      const emptyMsg = noSnapshotMsg(d);
      const tapeSec = s.tape || null;
      const oppsSec = s.opportunities || null;
      const tape = sectionRows(tapeSec)
        .slice()
        .sort((a, b) => nz(b.premium) - nz(a.premium))
        .slice(0, 12);
      const opps = sectionRows(oppsSec)
        .slice()
        .sort((a, b) => nz(b.score) - nz(a.score))
        .slice(0, 10);

      if (U.charts && U.charts.disposeIn && root) U.charts.disposeIn(root);
      root.innerHTML =
        `<div class="tabgrid snap">` +
        card("Indices · NSE — click a ticker", indicesBody(s.indices || [], emptyMsg), 1) +
        card(
          "Highest call OI · top 8",
          leadersTable(leaders, emptyMsg) + '<div class="muted" style="padding:0 6px 4px">ranked by highest call-OI strike</div>',
          2
        ) +
        card(
          "Highest put OI · top 8",
          leadersTable(leaders, emptyMsg) + '<div class="muted" style="padding:0 6px 4px">ranked by highest put-OI strike</div>',
          1
        ) +
        card(
          "Tape · largest prints",
          sectionBody(
            tapeSec,
            "no large prints in the last window",
            [
              { label: "Ticker" },
              { label: "Side" },
              { label: "Strike", num: true },
              { label: "Prem", num: true },
              { label: "Vol", num: true },
              { label: "ΔOI", num: true },
            ],
            tape,
            (r) =>
              `<tr><td>${tk(r.ticker)}</td>` +
              `<td class="${sideCls(r.side)}">${esc(sideLabel(r.side))}</td>` +
              `<td class="num">${num(r.strike, 0)}</td>` +
              `<td class="num pos">${inrShort(r.premium)}</td>` +
              `<td class="num">${int(r.volume)}</td>` +
              `<td class="num ${signCls(nz(r.oi_change))}">${int(r.oi_change)}</td></tr>`
          ) + '<div class="muted" style="padding:0 6px 4px">largest premium traded in the last ~5-min window (Δvolume × LTP) · NSE F&O scan</div>',
          2
        ) +
        card(
          "Opportunities · unusual OI bursts",
          sectionBody(
            oppsSec,
            "no unusual OI bursts in the last window",
            [
              { label: "Ticker" },
              { label: "Side" },
              { label: "Strike", num: true },
              { label: "ΔOI", num: true },
              { label: "Vol", num: true },
              { label: "OI", num: true },
              { label: "Score", num: true },
            ],
            opps,
            (r) =>
              `<tr><td>${tk(r.ticker)}</td>` +
              `<td class="${sideCls(r.side)}">${esc(sideLabel(r.side))}</td>` +
              `<td class="num">${num(r.strike, 0)}</td>` +
              `<td class="num ${signCls(nz(r.oi_change))}">${int(r.oi_change)}</td>` +
              `<td class="num">${int(r.volume)}</td>` +
              `<td class="num">${int(r.oi)}</td>` +
              `<td class="num pos">${num(r.score, 2)}</td></tr>`
          ) + '<div class="muted" style="padding:0 6px 4px">strikes where ΔOI and traded volume both spiked vs their own OI</div>',
          2
        ) +
        card(
          "Market context · VIX & breadth",
          '<div data-breadth><div class="muted" style="padding:6px">Loading breadth…</div></div>',
          2
        ) +
        card(
          "Smart money · bulk deals",
          '<div data-bulk-home><div class="muted" style="padding:6px">Loading bulk deals…</div></div>',
          2
        ) +
        `</div>`;
      if (U.charts) U.charts.mount(root);
      // Await the fills so the in-flight flag covers them too — the next tick
      // is skipped until both the render and its fills have settled.
      await Promise.all([fillBreadth(root, gen), fillBulkDeals(root, gen)]);
    } finally {
      if (gen === homeRenderGen) homeRenderBusy = false;
    }
  }

  function renderSymbolPlaceholder(root, t) {
    if (U.charts) U.charts.disposeAll();
    root.innerHTML =
      `<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading ${esc(t)}…</div></div></div>`;
  }

  // ---- search -------------------------------------------------------------
  function initSearch() {
    const input = document.getElementById("search");
    const box = document.getElementById("suggest");
    let timer = null;
    let items = [];
    let sel = -1;

    function close() {
      box.style.display = "none";
      box.innerHTML = "";
      sel = -1;
    }
    function open(list) {
      items = list;
      if (!list.length) return close();
      sel = 0;
      box.innerHTML = list.map((t, i) => `<div class="sg ${i === sel ? "on" : ""}" data-tk="${esc(t)}">${esc(t)}</div>`).join("");
      box.style.display = "block";
      box.querySelectorAll(".sg").forEach((el, idx) => {
        el.onmouseenter = () => {
          sel = idx;
          [...box.children].forEach((c, i) => c.classList.toggle("on", i === sel));
        };
        el.onmousedown = (e) => {
          e.preventDefault();
          goToSymbol(el.dataset.tk);
        };
      });
    }
    function goToSymbol(t) {
      close();
      input.value = "";
      location.hash = "#/symbol/" + t;
    }
    async function query(q) {
      try {
        const res = await fetch("/api/symbols?q=" + encodeURIComponent(q));
        const j = await res.json();
        open(j.symbols || []);
      } catch (e) {
        close();
      }
    }
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) return close();
      timer = setTimeout(() => query(q), 160);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!items.length) return;
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        [...box.children].forEach((c, i) => c.classList.toggle("on", i === sel));
      } else if (e.key === "Enter") {
        if (items.length) goToSymbol(items[Math.max(0, sel)]);
        else if (input.value.trim()) goToSymbol(input.value.trim().toUpperCase());
      } else if (e.key === "Escape") {
        close();
      }
    });
    document.addEventListener("click", (e) => {
      if (!box.contains(e.target) && e.target !== input) close();
    });
  }

  // ---- router -------------------------------------------------------------
  function route() {
    const root = document.getElementById("view");
    const h = location.hash || "#/";
    const m = h.match(/^#\/symbol\/([A-Za-z0-9.\-]+)/);
    const navHome = document.querySelector('#topnav a[data-nav="home"]');
    const navUni = document.querySelector('#topnav a[data-nav="universe"]');
    if (U._uniTimer) {
      clearInterval(U._uniTimer);
      U._uniTimer = null;
    }
    if (navHome) navHome.classList.toggle("on", !m && !h.startsWith("#/universe"));
    if (navUni) navUni.classList.toggle("on", h.startsWith("#/universe"));
    if (m) {
      const t = m[1].toUpperCase();
      if (U.renderSymbol) {
        try {
          U.renderSymbol(root, t);
        } catch (e) {
          root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
        }
      } else {
        renderSymbolPlaceholder(root, t);
      }
    } else if (h.startsWith("#/universe")) {
      U.renderUniverse(root);
    } else {
      renderSnapshot(root);
    }
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-tk]");
    if (a && a.tagName !== "INPUT") {
      e.preventDefault();
      location.hash = "#/symbol/" + a.dataset.tk;
    }
  });

  window.addEventListener("hashchange", route);
  document.addEventListener("DOMContentLoaded", () => {
    initSearch();
    // Prefetch the OI Flow + OI History panels so the
    // #/symbol/{T}?tab=oiflow and ?tab=oihistory routes render without a
    // lazy-load hop (best-effort, never blocks).
    try {
      for (const src of ["/panels/oi_flow.js", "/panels/oi_history.js", "/panels/iv.js", "/panels/rollover.js", "/panels/bulk.js"]) {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        document.head.appendChild(s);
      }
    } catch (e) {
      /* ignore — symbol.js lazy-loads them on demand */
    }
    // Explain toggle — plain-English hints on every card (persisted).
    const exp = document.getElementById("explain-toggle");
    const applyExplain = (on) => {
      document.body.classList.toggle("explain", on);
      if (exp) exp.classList.toggle("on", on);
    };
    applyExplain(U.explainOn ? U.explainOn() : true);
    if (exp) {
      exp.onclick = () => {
        const on = !document.body.classList.contains("explain");
        applyExplain(on);
        try {
          localStorage.setItem(U.EXPLAIN_KEY || "ib_explain", on ? "1" : "0");
        } catch (e) {
          /* ignore */
        }
      };
    }
    // Glossary modal
    const gl = document.getElementById("glossary");
    const glBody = document.getElementById("glossary-body");
    if (glBody && U.renderGlossary) glBody.innerHTML = U.renderGlossary();
    const glBtn = document.getElementById("glossary-btn");
    if (glBtn)
      glBtn.onclick = () => {
        gl.hidden = false;
      };
    const glClose = document.getElementById("glossary-close");
    if (glClose)
      glClose.onclick = () => {
        gl.hidden = true;
      };
    if (gl) {
      gl.addEventListener("click", (e) => {
        if (e.target === gl) gl.hidden = true;
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") gl.hidden = true;
      });
    }
    document.getElementById("refresh").onclick = async () => {
      try {
        await fetch("/api/refresh");
      } catch (e) {
        /* ignore — re-render from cache below */
      }
      route();
    };
    route();
  });
  // Snapshot auto-refresh while on home (universe polls itself). Ticks are
  // skipped while a render/fill is still in flight (homeRenderBusy) so runs can
  // never overlap; the interval is dropped entirely while the tab is hidden and
  // resynced on visibilitychange.
  const HOME_REFRESH_MS = 60000;
  let homeRefreshTimer = null;
  function homeRefreshTick() {
    if (document.hidden) return;
    const h = location.hash || "#/";
    if (h.startsWith("#/symbol/") || h.startsWith("#/universe")) return;
    if (homeRenderBusy) return; // previous render/fill still running
    const root = document.getElementById("view");
    if (root && root.querySelector(".tabgrid")) renderSnapshot(root);
  }
  function startHomeRefresh() {
    if (homeRefreshTimer != null) return;
    homeRefreshTimer = setInterval(homeRefreshTick, HOME_REFRESH_MS);
  }
  function stopHomeRefresh() {
    if (homeRefreshTimer != null) {
      clearInterval(homeRefreshTimer);
      homeRefreshTimer = null;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopHomeRefresh();
    else {
      startHomeRefresh();
      homeRefreshTick();
    }
  });
  startHomeRefresh();
})();
