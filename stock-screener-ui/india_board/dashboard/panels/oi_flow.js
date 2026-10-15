/* Intraday OI flow tab — where OI is building / unwinding in real time, plus a
 * replay scrubber that walks the session snapshot by snapshot.
 *
 * Backend: GET /api/oi-flow/history?ticker={T} ->
 *   {ticker, count, snapshots: [{ts, ticker,
 *     strikes: [{strike, ce_oi, pe_oi, ce_oich, pe_oich}]}]}
 * Snapshots are taken every 2 min during market hours (Mon–Fri 09:15–15:30
 * IST) and persist for the session; the FIRST snapshot of the day is the
 * baseline and every per-strike intraday delta is (selected snapshot −
 * baseline). All quantities are SHARES.
 *
 * render() returns a placeholder (the fetch is async); afterRender() swaps in
 * the cards, wires the scrubber and paints the as-of view, then mounts the
 * charts registered during the fill. The play interval is module state: it is
 * cleared on render()/afterRender() and dropped as soon as its DOM goes away,
 * so a ticker/tab switch can never leak a running timer.
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, signCls, table, card, multi } = U.util;

  const CE = "#16a34a", PE = "#dc2626";
  const PLAY_MS = 450; // ms per replay frame

  // Replay timer (module-level: one panel at a time, torn down on re-render).
  let playTimer = null;
  let playBtn = null;

  const stopPlay = () => {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    if (playBtn) playBtn.textContent = "▶";
    playBtn = null;
  };

  const nz = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const qty = (v) => {
    const x = nz(v), a = Math.abs(x);
    if (a >= 1e7) return (x / 1e7).toFixed(2) + " Cr";
    if (a >= 1e5) return (x / 1e5).toFixed(2) + " L";
    if (a >= 1e3) return (x / 1e3).toFixed(1) + "K";
    return String(Math.round(x));
  };
  const tshort = (ts) => {
    if (!ts) return "–";
    const m = String(ts).match(/T(\d{2}:\d{2})/);
    return m ? m[1] : String(ts).slice(0, 16);
  };
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;
  const miss = (what) => `<div class="muted" style="padding:6px">${esc(what)}</div>`;
  const legend = (items) =>
    `<div class="legend">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join("")}</div>`;

  const strikeMap = (snap) => new Map(arr(snap && snap.strikes).map((r) => [nz(r.strike), r]));

  // Per-strike intraday deltas as of snapshot `idx` (default: latest), always
  // measured against the day's FIRST snapshot. A strike missing from the
  // selected snapshot is treated as its baseline value (delta 0) so a sparse
  // or empty snapshot never throws.
  function deltas(snaps, idx) {
    if (!snaps.length) return { rows: [], firstTs: "", lastTs: "", idx: 0 };
    const i = Math.max(
      0,
      Math.min(snaps.length - 1, idx == null || !isFinite(idx) ? snaps.length - 1 : Math.round(idx))
    );
    const base = snaps[0];
    const cur = snaps[i] || base;
    const bmap = strikeMap(base);
    const cmap = strikeMap(cur);
    const keys = new Set([...bmap.keys(), ...cmap.keys()]);
    const all = [];
    keys.forEach((k) => {
      const b = bmap.get(k) || {};
      const c = cmap.get(k); // undefined -> use the baseline value
      const ce = c ? nz(c.ce_oi) : nz(b.ce_oi);
      const pe = c ? nz(c.pe_oi) : nz(b.pe_oi);
      const ceD = ce - nz(b.ce_oi);
      const peD = pe - nz(b.pe_oi);
      all.push({
        strike: k,
        ce,
        pe,
        ceD,
        peD,
        net: ceD - peD,
        tot: Math.abs(ceD) + Math.abs(peD),
      });
    });
    const rows = all.filter((r) => r.strike > 0).sort((a, b) => a.strike - b.strike);
    // Only flag movers once something actually moved (at the baseline every
    // delta is 0 and "top 5" would be arbitrary).
    const maxTot = rows.reduce((m, r) => Math.max(m, r.tot), 0);
    const hot = maxTot > 0
      ? new Set(rows.slice().sort((a, b) => b.tot - a.tot).slice(0, 5).map((r) => r.strike))
      : new Set();
    rows.forEach((r) => { r.hot = hot.has(r.strike); });
    return { rows, firstTs: base.ts, lastTs: cur.ts, idx: i };
  }

  // Diverging bars: CE intraday build right (green), PE build left (red).
  function flowChart(rows) {
    if (!U.charts) return miss("charts unavailable");
    const h = Math.max(220, Math.min(520, rows.length * 18 + 40));
    return U.charts.register({
      kind: "bars",
      height: h,
      horizontal: true,
      axis: true,
      categories: rows.map((r) => String(num(r.strike, 0))),
      series: [
        { name: "CE ΔOI", color: CE, data: rows.map((r) => r.ceD) },
        { name: "PE ΔOI", color: PE, data: rows.map((r) => -r.peD) },
      ],
    });
  }

  // Session trend: cumulative ΔOI vs the first snapshot for the top `n`
  // movers (by |ΔOI| over the session) — one CE + one PE line per strike,
  // x-axis = snapshot times. Registered once (static, full-session series).
  function trendChart(snaps, rows, n) {
    if (snaps.length < 2 || !rows.length) return miss("not enough snapshots yet");
    if (typeof multi !== "function") return miss("chart unavailable");
    const baseMap = strikeMap(snaps[0]);
    const maps = snaps.map(strikeMap);
    const top = rows.slice().sort((a, b) => b.tot - a.tot).slice(0, n || 6).map((r) => r.strike);
    const x = snaps.map((s) => tshort(s.ts));
    const series = [];
    top.forEach((k) => {
      const b = baseMap.get(k) || {};
      // strike absent from a snapshot -> treated as baseline (Δ0)
      const pull = (m, field) => {
        const r = m.get(k);
        return (r ? nz(r[field]) : nz(b[field])) - nz(b[field]);
      };
      series.push({ name: num(k, 0) + " CE", color: CE, data: maps.map((m) => pull(m, "ce_oi")) });
      series.push({ name: num(k, 0) + " PE", color: PE, data: maps.map((m) => pull(m, "pe_oi")) });
    });
    return multi(series, { height: 260, x, axis: true });
  }

  function kpiHtml(snaps, idx, rows, firstTs, curTs) {
    const totC = rows.reduce((s, r) => s + r.ceD, 0);
    const totP = rows.reduce((s, r) => s + r.peD, 0);
    const replay = idx < snaps.length - 1;
    return (
      `<div class="kpis">` +
      `<div class="kpi"><div class="kpi-l">Snapshots</div><div class="kpi-v">${idx + 1}<span class="muted" style="font-weight:400">/${snaps.length}</span></div><div class="kpi-s">${esc(tshort(firstTs))} → ${esc(tshort(curTs))}${replay ? " · replay" : ""}</div></div>` +
      `<div class="kpi"><div class="kpi-l">CE ΔOI</div><div class="kpi-v ${signCls(totC)}">${esc(qty(totC))}</div><div class="kpi-s">shares since ${esc(tshort(firstTs))}</div></div>` +
      `<div class="kpi"><div class="kpi-l">PE ΔOI</div><div class="kpi-v ${signCls(totP)}">${esc(qty(totP))}</div><div class="kpi-s">shares since ${esc(tshort(firstTs))}</div></div>` +
      `<div class="kpi"><div class="kpi-l">Net Δ</div><div class="kpi-v ${signCls(totC - totP)}">${esc(qty(totC - totP))}</div><div class="kpi-s">CE−PE</div></div>` +
      `</div>`
    );
  }

  function tableHtml(rows) {
    if (!rows.length) return miss("empty chain");
    const maxNet = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
    return table(
      [
        { label: "Strike", num: true },
        { label: "CE OI", num: true },
        { label: "PE OI", num: true },
        { label: "CE Δ", num: true },
        { label: "PE Δ", num: true },
        { label: "Net Δ", num: true },
      ],
      rows,
      (r) =>
        `<tr${r.hot ? ' style="background:rgba(245,158,11,.10)"' : ""}><td class="num"><b>${esc(num(r.strike, 0))}</b>${r.hot ? ' <span class="warn">●</span>' : ""}</td>` +
        `<td class="num pos">${esc(qty(r.ce))}</td>` +
        `<td class="num neg">${esc(qty(r.pe))}</td>` +
        `<td class="num ${signCls(r.ceD)}">${esc(qty(r.ceD))}</td>` +
        `<td class="num ${signCls(r.peD)}">${esc(qty(r.peD))}</td>` +
        `<td class="num ${signCls(r.net)}" style="background:${U.heat ? U.heat(r.net, maxNet) : ""}">${esc(qty(r.net))}</td></tr>`
    );
  }

  // Scrubber row: ⏮ / ▶ / ⏭, time label, range input. Disabled + note when
  // there is nothing to replay (fewer than 2 snapshots).
  function controlsHtml(n) {
    const ok = n >= 2;
    const dis = ok ? "" : " disabled";
    const off = ok ? "" : ' style="opacity:.45;cursor:not-allowed"';
    const btn = (act, glyph, label, extra) =>
      `<button class="preset" data-oiflow-act="${act}" ${extra || ""} aria-label="${label}" title="${label}"${dis}${off}>${glyph}</button>`;
    return (
      `<div class="presets" style="align-items:center;gap:8px">` +
      btn("first", "⏮", "Jump to first snapshot") +
      btn("play", "▶", "Play / pause the session replay", "data-oiflow-play") +
      btn("last", "⏭", "Jump to last snapshot") +
      `<span class="muted" data-oiflow-time style="min-width:36px;font-size:10px;font-variant-numeric:tabular-nums">–:––</span>` +
      `<input type="range" min="0" max="${Math.max(0, n - 1)}" value="${Math.max(0, n - 1)}" step="1"` +
      ` aria-label="Session time scrubber" data-oiflow-range${dis}` +
      ` style="flex:1 1 140px;min-width:120px;align-self:center;accent-color:#3b82f6">` +
      (ok ? "" : `<span class="muted" style="font-size:10px">not enough snapshots yet</span>`) +
      `</div>`
    );
  }

  // Static card skeleton (registered charts live here); the paintable parts
  // are divs so the scrubber can repaint without rebuilding the controls.
  function bodyHtml(ticker, snaps) {
    if (!snaps.length)
      return card("OI Flow · intraday build-up", miss(`no snapshots for ${ticker} yet — poller runs Mon–Fri 09:15–15:30 IST`), 4);
    const latest = deltas(snaps);
    if (!latest.rows.length) return card("OI Flow · intraday build-up", miss("empty chain"), 4);
    const trend =
      trendChart(snaps, latest.rows, 6) +
      cap(
        `cumulative ΔOI vs the <b>${esc(tshort(latest.firstTs))}</b> baseline · top 6 strikes by |ΔOI| across the session · <b>${snaps.length}</b> snapshots (~2 min apart)`
      );
    return (
      card(
        `OI Flow · ${esc(ticker)} intraday build-up`,
        controlsHtml(snaps.length) +
          `<div data-oiflow-kpi></div>` +
          legend([[CE, "CE ΔOI (shares)"], [PE, "PE ΔOI (shares)"]]) +
          `<div data-oiflow-chart></div>`,
        2
      ) +
      card("OI Flow · session replay", `<div data-oiflow-trend>${trend}</div>`, 2) +
      card(
        "OI Flow · strike deltas",
        `<div data-oiflow-table></div>` +
          cap(`<span class="warn">●</span> top 5 strikes by |ΔOI| as of the selected snapshot · Net Δ = CE Δ − PE Δ · shares`),
        2
      )
    );
  }

  // Repaint the as-of view (KPIs + diverging bars + strike table) for
  // snapshot `idx`. The controls/trend chart are left untouched.
  function paint(pane, snaps, idx) {
    if (!pane || !snaps.length) return;
    const kpiHost = pane.querySelector("[data-oiflow-kpi]");
    const chartHost = pane.querySelector("[data-oiflow-chart]");
    const tableHost = pane.querySelector("[data-oiflow-table]");
    const timeEl = pane.querySelector("[data-oiflow-time]");
    const range = pane.querySelector("[data-oiflow-range]");
    if (!kpiHost || !chartHost || !tableHost) return; // panel torn down
    const { rows, firstTs, lastTs, idx: i } = deltas(snaps, idx);
    if (timeEl) timeEl.textContent = tshort(snaps[i] ? snaps[i].ts : "");
    if (range && Number(range.value) !== i) range.value = String(i);
    kpiHost.innerHTML = kpiHtml(snaps, i, rows, firstTs, lastTs);
    // Dispose BEFORE the old canvas leaves the DOM — charts.disposeIn() only
    // matches elements still inside the root, so wiping first would leak the
    // ECharts instance + its ResizeObserver on every frame.
    if (U.charts) U.charts.disposeIn(chartHost);
    chartHost.innerHTML =
      flowChart(rows) +
      cap(
        `intraday change vs <b>${esc(tshort(firstTs))}</b> baseline · as of <b>${esc(tshort(lastTs))}</b> · ${rows.length} strikes · top 5 movers highlighted in the table`
      );
    if (U.charts) U.charts.mount(chartHost);
    tableHost.innerHTML = tableHtml(rows);
  }

  function togglePlay(pane, snaps, range, btn) {
    if (playTimer) { stopPlay(); return; } // ⏸ — resume later from this position
    if (snaps.length < 2 || !range) return;
    let i = Number(range.value);
    if (!isFinite(i)) i = snaps.length - 1;
    if (i >= snaps.length - 1) i = -1; // already at the end -> rewind and replay
    playBtn = btn || null;
    if (playBtn) playBtn.textContent = "⏸";
    playTimer = setInterval(() => {
      if (!range.isConnected) { stopPlay(); return; } // tab/ticker switched away
      i += 1;
      if (i > snaps.length - 1) i = snaps.length - 1;
      paint(pane, snaps, i);
      if (i >= snaps.length - 1) stopPlay();
    }, PLAY_MS);
  }

  function bind(pane, snaps) {
    if (snaps.length < 2) return; // controls are disabled — nothing to wire
    const range = pane.querySelector("[data-oiflow-range]");
    const play = pane.querySelector("[data-oiflow-play]");
    if (range) {
      range.oninput = () => {
        stopPlay(); // scrubbing by hand pauses playback
        paint(pane, snaps, Number(range.value));
      };
    }
    pane.querySelectorAll("[data-oiflow-act]").forEach((b) => {
      b.onclick = () => {
        const act = b.dataset.oiflowAct;
        if (act === "play") {
          togglePlay(pane, snaps, range, play);
          return;
        }
        stopPlay();
        paint(pane, snaps, act === "first" ? 0 : snaps.length - 1);
      };
    });
  }

  U.PANELS.oiflow = {
    title: "OI Flow",
    render() {
      stopPlay(); // a re-render tears down the previous replay timer
      return card("OI Flow · intraday build-up", '<div class="muted" data-oiflow style="padding:10px">Loading intraday OI flow…</div>', 4);
    },
    async afterRender(pane, ticker) {
      stopPlay(); // never inherit a timer from a previous render
      const host = pane && pane.querySelector("[data-oiflow]");
      if (!host) return;
      let snaps = [];
      try {
        const res = await fetch("/api/oi-flow/history?ticker=" + encodeURIComponent(ticker));
        if (!res.ok) throw new Error("HTTP " + res.status);
        const j = await res.json();
        snaps = arr(j.snapshots);
      } catch (e) {
        host.innerHTML = `Failed: ${esc(e.message)}`;
        return;
      }
      // Replace the loading card body with the flow cards.
      const tmp = document.createElement("div");
      tmp.innerHTML = bodyHtml(ticker, snaps);
      const loadingCard = host.closest(".card");
      const cards = [...tmp.children];
      if (loadingCard && cards.length) loadingCard.replaceWith(...cards);
      else host.innerHTML = bodyHtml(ticker, snaps);
      bind(pane, snaps);
      if (snaps.length) paint(pane, snaps, snaps.length - 1);
      if (U.charts) U.charts.mount(pane);
    },
    info: {
      title: "OI Flow",
      tagline: "Intraday open-interest build-up and unwinding by strike, with a replay scrubber over the session's snapshots",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Where OI is <b>building</b> (fresh positions) vs <b>unwinding</b> (square-offs) <em>today</em>: per-strike CE/PE OI with intraday deltas measured against the first snapshot of the day, plus a diverging CE-vs-PE build-up chart and a <b>session replay trend</b> (cumulative ΔOI for the top 6 movers). The background poller snapshots the chain every <b>2 minutes</b> during market hours (Mon–Fri 09:15–15:30 IST) and the snapshots <b>persist</b> for the session, so the replay keeps working after a refresh. All quantities are <b>shares</b>.</p>`,
        },
        {
          h: "Replaying the session",
          p: `<p>The <b>scrubber</b> under the KPIs walks the day's snapshots: drag it (or use <b>⏮</b> / <b>⏭</b>) to jump to a time, and <b>▶</b> to play the session back at ~0.45s per frame (<b>⏸</b> stops it and resumes from where you paused). Every move repaints the KPIs, the diverging bar chart and the strike table <b>as of that timestamp</b> — the baseline always stays the <b>first snapshot of the day</b>, so bars grow, shrink and flip the way positioning actually built through the session.</p>`,
        },
        {
          h: "How to read it",
          p: `<p>Rising CE ΔOI above spot = fresh call writing (<b>resistance building</b>); rising PE ΔOI below spot = fresh put writing (<b>support building</b>). Negative deltas mean unwinding — a level losing its defenders. Net Δ (CE Δ − PE Δ) signs the pressure per strike. The <b>top 5 movers</b> by |ΔOI| are highlighted — that is where today's positioning battle is.</p>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/oi-flow/history?ticker={T}</code> — <code>snapshots[].strikes</code> (<code>strike</code>, <code>ce_oi</code>, <code>pe_oi</code>), oldest first; <code>GET /api/oi-flow?ticker={T}</code> — latest snapshot.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Snapshots live in memory (capped at 200, ~2 min apart) — a server restart wipes the day's history and the replay starts over.</li><li>Outside market hours the baseline is the last sweep; deltas flatten until the next session.</li><li>OI restates overnight — early-morning deltas are provisional until the exchange publishes the final file.</li></ul>`,
        },
      ],
    },
  };
})();
