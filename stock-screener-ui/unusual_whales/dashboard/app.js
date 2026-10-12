/* Snapshot view, router, and symbol search. */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, money, int, signCls, table, card, tk, line } = U.util;

  async function renderSnapshot(root) {
    const nav = U.navSeq || 0;
    if (U.charts) U.charts.disposeAll();
    root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading snapshot…</div></div></div>';
    let d;
    try {
      const res = await fetch("/api/snapshot");
      if (!res.ok) throw new Error("HTTP " + res.status);
      d = await res.json();
    } catch (e) {
      root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
      return;
    }
    if ((U.navSeq || 0) !== nav) return; // route changed while loading
    const s = d.sections;
    document.getElementById("gen").textContent = new Date(d.generated_at).toLocaleString();
    const u = d.usage || {};
    document.getElementById("usage").innerHTML = `quota <b>${(u.daily_used ?? 0).toLocaleString()}/${(u.daily_limit ?? 0).toLocaleString()}</b>`;

    const tide = s.market_tide || [];
    const lastTide = tide.length ? tide[tide.length - 1].net_call_premium - tide[tide.length - 1].net_put_premium : 0;
    const tideMax = Math.max(1, ...(s.net_impact || []).map((x) => Math.abs(x.net_premium)));
    const unRows = s.unusual || [];
    const unMaxPrem = Math.max(0, ...unRows.map((x) => Math.abs(Number(x.premium) || 0)));
    const unMaxVol = Math.max(1, ...unRows.map((x) => Math.abs(Number(x.volume) || 0)));
    const oiRows = s.oi_change || [];
    const oiMaxOi = Math.max(0, ...oiRows.map((x) => Math.abs(Number(x.oi_change) || 0)));
    const oiMaxVol = Math.max(1, ...oiRows.map((x) => Math.abs(Number(x.volume) || 0)));
    const dpRows = s.darkpool || [];
    const dpMaxSize = Math.max(0, ...dpRows.map((x) => Math.abs(Number(x.size) || 0)));
    const dpMaxPrem = Math.max(0, ...dpRows.map((x) => Math.abs(Number(x.premium) || 0)));
    const sqRows = s.squeezes || [];
    const sqMaxSi = Math.max(0, ...sqRows.map((x) => Math.abs(Number(x.si_float) || 0)));
    const sqFresh = !!(s.squeeze_fresh && s.squeeze_fresh.length);
    const sqUse = sqFresh ? s.squeeze_fresh : s.squeezes;
    const vaRows = s.vol_anomaly || [];
    const vaMax = Math.max(0, ...vaRows.map((x) => Math.abs(Number(x.score) || 0)));
    const inRows = s.insider || [];
    const inMax = Math.max(0, ...inRows.map((x) => Math.abs(Number(x.amount) || 0)));

    root.innerHTML = `<div class="tabgrid snap">
      ${card("MNQ dealer levels · Nasdaq walls in futures points", mnqPanel(s.mnq_levels, s.mnq_signal), 2)}
      ${card(
        tide.length
          ? `Market Tide · net premium (call−put) <span class="${signCls(lastTide)}">${money(lastTide)}</span>`
          : "Market Tide · net premium (call−put)",
        tide.length
          ? `<div class="spark-wrap">${line(tide.map((p) => p.net_call_premium - p.net_put_premium), { stroke: "#3b82f6", fill: "#3b82f6", height: 130 })}</div>`
          : '<div class="muted" style="padding:6px">no tide data</div>',
        2
      )}
      ${card("Top Net Impact — click a ticker", impactBars(s.net_impact), 1)}
      ${card("Dealer Gamma · single names", gex(s.gex) + '<div class="muted" style="font-size:9px;padding:0 6px 4px">as of ~06:45 ET (OI-based)</div>', 1)}
      ${card("OI-change alerts · fresh positioning", '<div id="home-alerts"><div class="muted" style="padding:6px">loading…</div></div>', 1)}
      ${card("⚡ Live flow alerts · real-time", '<div id="home-live"><div class="muted" style="padding:6px">loading…</div></div>', 1)}
      ${card(
        "Index & ETF Levels · SPX/ES · NDX/NQ · SPY · QQQ",
        indexLevels(s.index_levels) +
          '<div class="muted" style="padding:0 6px 4px">ES tracks SPX · NQ tracks NDX — the live futures feed needs the Advanced tier</div>' +
          '<div class="muted" style="font-size:9px;padding:0 6px 4px">as of ~06:45 ET (OI-based)</div>',
        2
      )}
      ${card(
        "Whale screener · market-wide",
        U.renderScreen ? U.renderScreen(s.screen) : '<div class="muted" style="padding:6px">no whale-screener rows yet</div>',
        2
      )}
      ${card(
        "Latest whale tickets · unusual flow, newest first",
        table(
          [{ label: "Time (ET)" }, { label: "Ticker" }, { label: "Type" }, { label: "Strike", num: true }, { label: "Exp" }, { label: "Prem", num: true }, { label: "Vol", num: true }, { label: "OI", num: true }, { label: "Δ", num: true }, { label: "Sweep", num: true }],
          (s.unusual || []).slice().sort((a, b) => { const x = String(a.last_fill || ""), y = String(b.last_fill || ""); return x < y ? 1 : x > y ? -1 : 0; }),
          (r) => {
            const isCall = String(r.option_symbol || "").includes("C0") || String(r.option_type || "").toLowerCase() === "call";
            return `<tr><td class="muted">${esc(U.util.et(r.last_fill))}</td><td>${tk(r.ticker)}</td><td class="${isCall ? "pos" : "neg"}">${isCall ? "CALL" : "PUT"}</td><td class="num">${esc(r.strike)}</td><td>${esc(U.util.shortDate(r.expiry))}</td><td class="num ${isCall ? "pos" : "neg"}" style="background:${U.heat(Number(r.premium) || 0, unMaxPrem)}">${money(r.premium)}</td><td class="num" style="background:${U.heat(Number(r.volume) || 0, unMaxVol)}">${int(r.volume)}</td><td class="num muted">${int(r.open_interest)}</td><td class="num ${signCls(Number(r.delta))}">${U.util.num(r.delta, 2)}</td><td class="num ${r.sweep_volume ? "pos" : "muted"}">${int(r.sweep_volume)}</td></tr>`;
          }
        ),
        2
      )}
      ${card(
        "Largest OI Changes",
        table(
          [{ label: "Ticker" }, { label: "Contract" }, { label: "Type" }, { label: "OI Δ", num: true }, { label: "Vol", num: true }],
          s.oi_change || [],
          (r) => {
            const isCall = String(r.option_symbol || "").includes("C0");
            return `<tr><td>${tk(r.ticker)}</td><td class="muted" title="${esc(r.option_symbol || "")}">${esc(U.util.occ(r.option_symbol))}</td><td class="${isCall ? "pos" : "neg"}">${isCall ? "C" : "P"}</td><td class="num ${signCls(r.oi_change)}" style="background:${U.heat(Number(r.oi_change) || 0, oiMaxOi)}">${U.util.num(r.oi_change, 1)}</td><td class="num" style="background:${U.heat(Number(r.volume) || 0, oiMaxVol)}">${int(r.volume)}</td></tr>`;
          }
        ),
        1
      )}
      ${card(
        "Dark Pool · largest",
        table(
          [{ label: "Ticker" }, { label: "Time (ET)" }, { label: "Price", num: true }, { label: "Size", num: true }, { label: "Prem", num: true }],
          s.darkpool || [],
          (r) => `<tr><td>${tk(r.ticker)}</td><td class="muted">${esc(U.util.et(r.executed_at))}</td><td class="num">${U.util.num(r.price, 2)}</td><td class="num" style="background:${U.heat(Number(r.size) || 0, dpMaxSize)}">${int(r.size)}</td><td class="num" style="background:${U.heat(Number(r.premium) || 0, dpMaxPrem)}">${money(r.premium)}</td></tr>`
        ),
        1
      )}
      ${card(
        "Squeeze · short interest",
        `<div class="muted" style="font-size:9px;padding:0 6px 4px">source: ${sqFresh ? "fresh screener" : "stale feed — verify"}</div>` +
          table(
          [{ label: "Symbol" }, { label: "SI%", num: true }, { label: "Day / DTC", num: true }],
          sqUse,
          (r) => {
            const si = Number(r.si_float) || 0;
            const sip = U.util.siPct(si);
            return `<tr><td>${tk(r.symbol)}</td><td class="num warn" style="background:${U.heat(sip, 100)}">${U.util.num(sip, 1)}%</td><td class="num ${r.day != null ? signCls(r.day) : "muted"}">${r.day != null ? U.util.rawpct(r.day * 100) : U.util.num(r.days_to_cover, 1)}</td></tr>`;
          }
        ),
        1
      )}
      ${card(
        "Vol Anomalies · long vol",
        table(
          [{ label: "Ticker" }, { label: "Score", num: true }],
          s.vol_anomaly || [],
          (r) => `<tr><td>${tk(r.ticker)}</td><td class="num ${r.score > 0 ? "pos" : "neg"}" style="background:${U.heat(Number(r.score) || 0, vaMax)}">${U.util.num(r.score, 1)}</td></tr>`
        ),
        1
      )}
      ${card(
        "Insiders · recent",
        table(
          [{ label: "Date" }, { label: "Tkr" }, { label: "Shares", num: true }, { label: "Price", num: true }, { label: "Owner" }],
          s.insider || [],
          (r) => `<tr><td class="muted">${esc((r.transaction_date || "").slice(5))}</td><td>${tk(r.ticker)}</td><td class="num ${signCls(r.amount)}" style="background:${U.heat(Number(r.amount) || 0, inMax)}">${int(r.amount)}</td><td class="num muted">${U.util.num(r.price, 2)}</td><td>${esc(r.owner_name)}</td></tr>`
        ),
        1
      )}
    </div>`;
    if (U.charts) U.charts.mount(root);
    // OI-change alert strip (secondary fetch so the snapshot paint isn't blocked)
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((d) => U.renderAlertStrip && U.renderAlertStrip(document.getElementById("home-alerts"), d))
      .catch(() => {
        const el = document.getElementById("home-alerts");
        if (el) el.innerHTML = '<div class="muted" style="padding:6px">alerts unavailable</div>';
      });
    fetch("/api/live")
      .then((r) => r.json())
      .then((d) => U.renderLiveStrip && U.renderLiveStrip(document.getElementById("home-live"), d))
      .catch(() => {
        const el = document.getElementById("home-live");
        if (el) el.innerHTML = '<div class="muted" style="padding:6px">live feed unavailable</div>';
      });
  }

  // Net-impact bars with clickable tickers (hbars renders plain escaped text,
  // so its labels cannot carry the data-tk link — build the rows here).
  function impactBars(rows) {
    const list = (rows || []).filter(Boolean);
    if (!list.length) return '<div class="muted" style="padding:6px">no net-impact rows yet — this fills once options trade</div>';
    const max = Math.max(1, ...list.map((r) => Math.abs(Number(r.net_premium) || 0)));
    return `<div class="hbars">${list
      .map((r) => {
        const v = Number(r.net_premium) || 0;
        const w = Math.min(100, (Math.abs(v) / max) * 100).toFixed(1);
        return `<div class="hbar"><span class="hb-l">${tk(r.ticker)}</span><span class="hb-t"><i style="width:${w}%;background:${v >= 0 ? "var(--pos)" : "var(--neg)"}"></i></span><span class="hb-v ${signCls(v)}">${money(v)}</span></div>`;
      })
      .join("")}</div>`;
  }

  function indexLevels(rows) {
    if (!rows || !rows.length) return '<div class="muted" style="padding:6px">no index/ETF levels from the feed right now</div>';
    return `<div class="gex-grid">${rows
      .map(
        (g) => `<div class="gex"><div class="t">${tk(g.ticker)}${g.alias ? `<span class="muted"> · ${esc(g.alias)}</span>` : ""}${g.spot ? ` <span class="muted">${U.util.num(g.spot, 0)}</span>` : ""}</div>
      <div class="row"><span>call wall</span><b class="neg">${esc(g.call_wall)}</b></div>
      <div class="row"><span>put wall</span><b class="pos">${esc(g.put_wall)}</b></div>
      <div class="row"><span>flip</span><b>${esc(g.gamma_flip)}</b></div>
      <div class="row"><span>magnet</span><b>${esc(g.gamma_magnet)}</b></div>
      ${g.max_pain ? `<div class="row"><span>max pain</span><b>${esc(g.max_pain)}${g.max_pain_expiry ? ` <span class="muted">${esc(U.util.shortDate(g.max_pain_expiry))}</span>` : ""}</b></div>` : ""}
      <div class="row"><span>near flips</span><b class="muted">${esc((g.nearby_flips || []).slice(0, 3).join(" · "))}</b></div></div>`
      )
      .join("")}</div>`;
  }

  // ---- MNQ dealer levels: NDX gamma walls translated into futures points ----
  // s.mnq_levels is built by nq_basis.mnq_levels(): NDX walls (UW) + live MNQ
  // price (MotiveWave/Rithmic tick store) + the futures basis between them.
  // Gamma walls are recomputed continuously and DO drift intraday — the
  // "gex as of" footer is the timestamp that matters, not the page load time.
  function mnqPanel(m, sig) {
    if (!m) return '<div class="muted" style="padding:6px">no MNQ dealer levels right now</div>';
    const levels = m.levels || [];
    if (m.price == null && !levels.length) {
      const why = (m.errors || []).join(" · ") || "no MNQ price or levels right now";
      return `<div class="muted" style="padding:6px">${esc(why)}</div>`;
    }
    const px = m.price != null ? U.util.num(m.price, 2) : "–";
    const a = m.price_age_s;
    const age = a == null ? "" : a < 90 ? `${Math.round(a)}s old` : `${Math.round(a / 60)}m old`;
    const reg = m.regime === "long-gamma" ? ["bull", "long gamma"]
      : m.regime === "short-gamma" ? ["bear", "short gamma"]
        : ["mix", "no flip"];
    const rows = levels.map((l) => {
      const d = l.dist;
      const cls = d == null ? "muted" : d >= 0 ? "pos" : "neg";
      const dtxt = d == null ? "" : `${d >= 0 ? "+" : "−"}${U.util.num(Math.abs(d), 0)}`;
      return `<div class="row"><span>${esc(l.label)} <span class="muted">NDX ${U.util.num(l.ndx, 0)}</span></span>` +
        `<span><b>${U.util.num(l.mnq, 1)}</b> <span class="${cls}">${dtxt}</span></span></div>`;
    }).join("");
    const signed = (v) => (v == null ? "–" : (v >= 0 ? "+" : "−") + U.util.num(Math.abs(v), 1));
    // wall-fade signal banner (written by scripts/wall_fade.py)
    let banner = "";
    if (sig && sig.kind === "fade") {
      banner = `<div style="margin-top:3px;border-top:1px solid var(--border);padding-top:3px">
        <div class="row"><span class="neg">▼ FADE signal</span><span><b>${U.util.num(sig.entry_confirm, 2)}</b> <span class="muted">cross ${U.util.num(sig.entry, 2)}</span></span></div>
        <div class="row"><span>stop / target</span><span><b>${U.util.num(sig.stop, 2)}</b> / <b>${U.util.num(sig.target, 2)}</b></span></div>
        <div class="row"><span>risk : reward</span><b>${sig.rr}</b></div>
        <div class="muted" style="font-size:9px">fired ${esc(sig.created_at ? U.util.et(sig.created_at) : "–")} ET · confirm delta ${U.util.num(sig.cvd, 0)}</div>
      </div>`;
    } else if (sig && sig.kind === "accept") {
      banner = `<div style="margin-top:3px;border-top:1px solid var(--border);padding-top:3px">
        <div class="row"><span class="chip mix">wall accepted</span><span class="muted">do NOT fade</span></div>
      </div>`;
    }
    const stale = m.price_stale ? ` <span class="chip bear">stale</span>` : "";
    return `<div class="gex-grid"><div class="gex">
      <div class="t">${esc(m.symbol || "MNQ")} <span class="muted">${px}</span> <span class="chip ${reg[0]}">${reg[1]}</span>${stale}</div>
      <div class="row"><span>live price</span><span><b>${px}</b> <span class="muted">${age}</span></span></div>
      ${rows}
      <div class="row"><span>basis (fut − cash)</span><b>${signed(m.basis)}</b></div>
      <div class="row"><span>NDX cash est</span><b>${m.ndx_cash != null ? U.util.num(m.ndx_cash, 1) : "–"}</b></div>
      <div class="row"><span>QQQ</span><b>${m.qqq != null ? U.util.num(m.qqq, 2) : "–"}</b></div>
      ${banner}
      <div class="muted" style="font-size:9px;margin-top:2px">levels = NDX wall + basis · gex ${esc(m.gex_as_of ? U.util.et(m.gex_as_of) : "–")} ET · walls drift intraday${m.errors && m.errors.length ? ` · ${esc(m.errors.join(" · "))}` : ""}</div>
    </div></div>`;
  }

  function gex(rows) {
    if (!rows || !rows.length) return '<div class="muted" style="padding:6px">no dealer-gamma levels from the feed right now</div>';
    return `<div class="gex-grid">${rows
      .map(
        (g) => `<div class="gex"><div class="t">${tk(g.ticker)}</div>
      <div class="row"><span>call wall</span><b class="neg">${esc(g.call_wall)}</b></div>
      <div class="row"><span>put wall</span><b class="pos">${esc(g.put_wall)}</b></div>
      <div class="row"><span>flip</span><b>${esc(g.gamma_flip)}</b></div>
      <div class="row"><span>magnet</span><b>${esc(g.gamma_magnet)}</b></div></div>`
      )
      .join("")}</div>`;
  }

  // ---- live push indicator + home strip refresh -------------------------
  function ensureLiveChip() {
    let chip = document.getElementById("stream-live");
    if (chip) return chip;
    const phase = document.getElementById("phase");
    if (!phase || !phase.parentNode) return null;
    chip = document.createElement("span");
    chip.id = "stream-live";
    chip.className = "badge";
    chip.textContent = "● live";
    chip.style.marginLeft = "2px";
    phase.insertAdjacentElement("afterend", chip);
    return chip;
  }

  function paintLiveChip() {
    const chip = ensureLiveChip();
    if (!chip) return;
    const st = (U.stream && U.stream.state && U.stream.state()) || {};
    const on = !!st.connected;
    chip.style.color = on ? "#22c55e" : "var(--warn)";
    chip.style.borderColor = on ? "rgba(34,197,94,.6)" : "rgba(245,158,11,.6)";
    chip.title = "Live push: " + (on ? "connected" : "polling fallback") + (st.phase ? " · " + st.phase : "");
  }

  const HOME_PREFIXES = ["#/symbol/", "#/opps", "#/week", "#/day", "#/tape", "#/news", "#/alerts", "#/pulse", "#/edge"];
  function isHome() {
    return !HOME_PREFIXES.some((p) => location.hash.startsWith(p));
  }

  let _homeStreamTimer = null;
  function onHomeStream() {
    if (!isHome() || _homeStreamTimer) return;
    // keep it cheap: refresh only the two alert strips, at most once / ~5s
    _homeStreamTimer = setTimeout(() => {
      _homeStreamTimer = null;
      if (!isHome()) return;
      const root = document.getElementById("view");
      if (!root || !root.querySelector(".tabgrid")) return;
      const a = document.getElementById("home-alerts");
      if (a)
        fetch("/api/alerts")
          .then((r) => r.json())
          .then((d) => U.renderAlertStrip && U.renderAlertStrip(a, d))
          .catch(() => {});
      const l = document.getElementById("home-live");
      if (l)
        fetch("/api/live")
          .then((r) => r.json())
          .then((d) => U.renderLiveStrip && U.renderLiveStrip(l, d))
          .catch(() => {});
    }, 5000);
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
      box.innerHTML = list
        .map((t, i) => `<div class="sg ${i === sel ? "on" : ""}" data-tk="${esc(t)}">${esc(t)}</div>`)
        .join("");
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
    const h = location.hash;
    U.navSeq = (U.navSeq || 0) + 1; // invalidate any in-flight view render
    const m = h.match(/^#\/symbol\/([A-Za-z0-9.\-]+)/);
    const navHome = document.querySelector('#topnav a[data-nav="home"]');
    const navTape = document.querySelector('#topnav a[data-nav="tape"]');
    const navDay = document.querySelector('#topnav a[data-nav="day"]');
    const navOpps = document.querySelector('#topnav a[data-nav="opps"]');
    const navWeek = document.querySelector('#topnav a[data-nav="week"]');
    const navPulse = document.querySelector('#topnav a[data-nav="pulse"]');
    const navNews = document.querySelector('#topnav a[data-nav="news"]');
    const navAlerts = document.querySelector('#topnav a[data-nav="alerts"]');
    const navEdge = document.querySelector('#topnav a[data-nav="edge"]');
    if (U._tapeTimer) {
      clearInterval(U._tapeTimer);
      U._tapeTimer = null;
    }
    if (U._newsTimer) {
      clearInterval(U._newsTimer);
      U._newsTimer = null;
    }
    if (U._alertsTimer) {
      clearInterval(U._alertsTimer);
      U._alertsTimer = null;
    }
    if (U._pulseTimer) {
      clearInterval(U._pulseTimer);
      U._pulseTimer = null;
    }
    // dispose chart instances from the outgoing view so they don't leak
    if (U.charts) U.charts.disposeAll();
    const offHome = !m && !["#/opps", "#/week", "#/day", "#/tape", "#/news", "#/alerts", "#/pulse", "#/edge"].some((p) => h.startsWith(p));
    if (navHome) navHome.classList.toggle("on", offHome);
    if (navTape) navTape.classList.toggle("on", h.startsWith("#/tape"));
    if (navDay) navDay.classList.toggle("on", h.startsWith("#/day"));
    if (navOpps) navOpps.classList.toggle("on", h.startsWith("#/opps"));
    if (navWeek) navWeek.classList.toggle("on", h.startsWith("#/week"));
    if (navPulse) navPulse.classList.toggle("on", h.startsWith("#/pulse"));
    if (navNews) navNews.classList.toggle("on", h.startsWith("#/news"));
    if (navAlerts) navAlerts.classList.toggle("on", h.startsWith("#/alerts"));
    if (navEdge) navEdge.classList.toggle("on", h.startsWith("#/edge"));
    if (m) {
      U.renderSymbol(root, m[1].toUpperCase());
    } else if (h.startsWith("#/tape")) {
      U.renderTape(root);
    } else if (h.startsWith("#/day")) {
      U.renderDay(root);
    } else if (h.startsWith("#/opps")) {
      U.renderOpps(root);
    } else if (h.startsWith("#/pulse")) {
      U.renderPulse(root);
    } else if (h.startsWith("#/week")) {
      U.renderWeek(root);
    } else if (h.startsWith("#/news")) {
      U.renderNews(root);
    } else if (h.startsWith("#/alerts")) {
      U.renderAlerts(root);
    } else if (h.startsWith("#/edge")) {
      if (U.renderEdge) U.renderEdge(root);
    } else {
      renderSnapshot(root);
    }
  }

  // ---- mode-aware navigation (always / intraday / eod) ---------------------
  // UW.mode is supplied by mode.js. Everything here is defensive: if the mode
  // API is absent (e.g. during dev or a partial rollout) the nav is left as
  // authored and nothing is hidden or redirected.
  const ROUTE_MODES = {
    intraday: ["#/tape", "#/day", "#/alerts", "#/news"],
    eod: ["#/pulse", "#/opps", "#/week"],
  };

  function routeModeOf(h) {
    h = h || "";
    if (h === "" || h === "#" || h === "#/") return "always";
    for (const kind of Object.keys(ROUTE_MODES)) {
      if (ROUTE_MODES[kind].some((p) => h.startsWith(p))) return kind;
    }
    return null; // ungrouped route (e.g. #/symbol/…) — never force a redirect
  }

  function ensureNavGroupStyle() {
    if (document.getElementById("nav-group-style")) return;
    const st = document.createElement("style");
    st.id = "nav-group-style";
    st.textContent =
      "#topnav .nav-group{color:var(--muted);text-transform:uppercase;font-size:9px;" +
      "letter-spacing:.5px;padding:0 4px;align-self:center;user-select:none;opacity:.75}";
    document.head.appendChild(st);
  }

  function navGroupLabel(text) {
    const s = document.createElement("span");
    s.className = "nav-group";
    s.textContent = text;
    return s;
  }

  function applyNavMode() {
    const nav = document.getElementById("topnav");
    if (!nav) return;
    ensureNavGroupStyle();
    const links = [...nav.querySelectorAll("a[data-mode]")];
    links.forEach((a) => {
      const kind = a.dataset.mode || "always";
      const show =
        kind === "always" ||
        !U.mode ||
        typeof U.mode.visible !== "function" ||
        U.mode.visible(kind);
      a.style.display = show ? "" : "none";
    });
    // group labels are only meaningful in the combined "all" view; drop any
    // previously injected ones first so re-applying is idempotent
    nav.querySelectorAll(".nav-group").forEach((el) => el.remove());
    if (!U.mode || typeof U.mode.get !== "function" || U.mode.get() !== "all") return;
    const firstIntra = links.find((a) => a.dataset.mode === "intraday" && a.style.display !== "none");
    const firstEod = links.find((a) => a.dataset.mode === "eod" && a.style.display !== "none");
    if (firstIntra) nav.insertBefore(navGroupLabel("INTRA"), firstIntra);
    if (firstEod) nav.insertBefore(navGroupLabel("EOD"), firstEod);
  }

  function ensureRouteVisible() {
    if (!U.mode || typeof U.mode.get !== "function") return false;
    const mode = U.mode.get();
    if (mode !== "intraday" && mode !== "eod") return false;
    const rm = routeModeOf(location.hash);
    if (rm && rm !== "always" && rm !== mode) {
      location.hash = "#/"; // Home is always allowed
      route();
      return true;
    }
    return false;
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
    // Explain toggle — plain-English hints on every card (persisted).
    const exp = document.getElementById("explain-toggle");
    const applyExplain = (on) => {
      document.body.classList.toggle("explain", on);
      if (exp) exp.classList.toggle("on", on);
    };
    applyExplain(
      (() => {
        try {
          const saved = localStorage.getItem(U.EXPLAIN_KEY || "uw_explain");
          return saved === null ? false : saved === "1";
        } catch (e) {
          return false;
        }
      })()
    );
    if (exp) {
      exp.onclick = () => {
        const on = !document.body.classList.contains("explain");
        applyExplain(on);
        try {
          localStorage.setItem(U.EXPLAIN_KEY || "uw_explain", on ? "1" : "0");
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
    if (glBtn) glBtn.onclick = () => { gl.hidden = false; };
    const glClose = document.getElementById("glossary-close");
    if (glClose) glClose.onclick = () => { gl.hidden = true; };
    if (gl) {
      gl.addEventListener("click", (e) => { if (e.target === gl) gl.hidden = true; });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") gl.hidden = true; });
    }
    document.getElementById("refresh").onclick = async () => {
      await fetch("/api/refresh");
      _lastSnap = Date.now();
      route();
    };
    // OI-change alert bell + background watcher
    const bell = document.getElementById("alerts-bell");
    if (bell) bell.onclick = () => { location.hash = "#/alerts"; };
    if (U.startAlerts) U.startAlerts();
    // live push indicator + refresh the home alert strips on new pushes
    paintLiveChip();
    if (U.stream && U.stream.on) {
      U.stream.on("live", onHomeStream);
      U.stream.on("oi", onHomeStream);
      U.stream.on("status", paintLiveChip);
    }
    setInterval(paintLiveChip, 5000);
    // market phase + adaptive poll policy (fast while open, cheap when shut)
    if (U.loadFreshness) {
      U.loadFreshness();
      setInterval(U.loadFreshness, 300000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          if (U.loadFreshness) U.loadFreshness();
          route(); // refresh the active view immediately (and drop stale charts)
        }
      });
    }
    // mode-aware navigation (UW.mode from mode.js; no-op when absent)
    applyNavMode();
    const modeRedirected = ensureRouteVisible();
    if (U.mode && typeof U.mode.on === "function") {
      U.mode.on(() => {
        applyNavMode();
        ensureRouteVisible();
      });
    }
    // header quota badge — live on every view (Home snapshot also sets it).
    // Shows "quota –" only while the first check is in flight, "quota ERR" on failure.
    const paintQuota = async () => {
      const el = document.getElementById("usage");
      if (!el) return;
      try {
        const r = await fetch("/api/usage");
        const u = (r.ok && (await r.json())) || {};
        if (u.daily_used == null || u.daily_limit == null) {
          el.innerHTML = u.error ? "quota <b>ERR</b>" : el.innerHTML;
          el.title = u.error ? String(u.error) : el.title;
        } else {
          el.innerHTML = `quota <b>${Number(u.daily_used).toLocaleString()}/${Number(u.daily_limit).toLocaleString()}</b>`;
          el.title = "Unusual Whales daily API usage (auto-refreshes)";
        }
      } catch (e) {
        /* keep last value */
      }
    };
    paintQuota();
    setInterval(() => {
      if (U.isVisible && !U.isVisible()) return;
      paintQuota();
    }, 60000);
    if (!modeRedirected) route();
  });
  // snapshot auto-refresh — checks every 15s, refreshes per the market-aware
  // policy (UW.pollMs("snapshot")) and never while the tab is hidden
  let _lastSnap = 0;
  setInterval(() => {
    const h = location.hash;
    if (["#/symbol/", "#/opps", "#/week", "#/day", "#/tape", "#/news", "#/alerts", "#/pulse", "#/edge"].some((p) => h.startsWith(p))) return;
    if (U.isVisible && !U.isVisible()) return;
    const due = U.pollMs ? U.pollMs("snapshot") : 60000;
    if (Date.now() - _lastSnap < due) return;
    const root = document.getElementById("view");
    if (root && root.querySelector(".tabgrid")) {
      _lastSnap = Date.now();
      renderSnapshot(root);
    }
  }, 15000);
})();
