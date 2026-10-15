/* Historical OI trend — daily EOD snapshots of option OI per strike.
 *
 * Backend:
 *   GET /api/oi-history/{T} -> {ticker, snapshots: [{date, ticker, spot,
 *     expiry, strikes: [{strike, ce_oi, pe_oi}]}]} (oldest first)
 *   GET /api/oi-history/refresh[?ticker={T}] -> snapshot now (manual trigger)
 *
 * Panel contract (symbol.js): U.PANELS.oihistory = {title, render, afterRender,
 * info}. render() is synchronous so it returns placeholders; afterRender()
 * fetches the history, paints the trend chart (top 10 strikes by latest OI)
 * with a CE/PE toggle, plus a latest-snapshot table with day-over-day change.
 * All quantities are SHARES.
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, signCls, table, card, multi } = U.util;

  const CE = "#16a34a", PE = "#dc2626";
  const PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#22d3ee",
    "#f472b6", "#a3e635", "#fb923c", "#94a3b8", "#e879f9"];

  const nz = (v) => {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  };
  const qty = (v) => {
    const x = nz(v), a = Math.abs(x);
    if (a >= 1e7) return (x / 1e7).toFixed(2) + " Cr";
    if (a >= 1e5) return (x / 1e5).toFixed(2) + " L";
    if (a >= 1e3) return (x / 1e3).toFixed(1) + "K";
    return String(Math.round(x));
  };
  const shortDate = (s) => (s ? String(s).slice(5, 10) : "");
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;
  const miss = (what) => `<div class="muted" style="padding:6px">${esc(what)}</div>`;
  const heat = (v, m) => (U.heat ? U.heat(v, m) : "");

  // Per-symbol UI state (reset on each render, owned by afterRender).
  function trendChart(dates, snaps, strikes, side) {
    if (!dates.length || !strikes.length) return miss("no OI history yet");
    const series = strikes.map((k, i) => ({
      name: num(k, 0),
      color: PALETTE[i % PALETTE.length],
      data: snaps.map((s) => {
        const row = (s.strikes || []).find((r) => nz(r.strike) === k);
        return row ? nz(side === "CE" ? row.ce_oi : row.pe_oi) : 0;
      }),
    }));
    return multi(series, { height: 260, x: dates.map(shortDate), axis: true });
  }

  function latestTable(snaps) {
    const last = snaps[snaps.length - 1];
    const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
    const prevBy = {};
    (prev ? prev.strikes || [] : []).forEach((r) => {
      prevBy[nz(r.strike)] = r;
    });
    const rows = (last.strikes || []).slice().sort(
      (a, b) => nz(b.ce_oi) + nz(b.pe_oi) - (nz(a.ce_oi) + nz(a.pe_oi))
    );
    if (!rows.length) return miss("empty snapshot");
    const maxTot = Math.max(1, ...rows.map((r) => nz(r.ce_oi) + nz(r.pe_oi)));
    const body = table(
      [
        { label: "Strike", num: true },
        { label: "CE OI", num: true },
        { label: "CE ΔDoD", num: true },
        { label: "PE OI", num: true },
        { label: "PE ΔDoD", num: true },
        { label: "Total", num: true },
      ],
      rows,
      (r) => {
        const k = nz(r.strike);
        const p = prevBy[k] || {};
        const dCe = nz(r.ce_oi) - nz(p.ce_oi);
        const dPe = nz(r.pe_oi) - nz(p.pe_oi);
        const tot = nz(r.ce_oi) + nz(r.pe_oi);
        const showD = (d) => (prev ? `<span class="${signCls(d)}">${d === 0 ? "–" : (d > 0 ? "+" : "") + qty(d)}</span>` : '<span class="muted">–</span>');
        return `<tr><td class="num"><b>${esc(num(k, 0))}</b></td>` +
          `<td class="num pos">${esc(qty(r.ce_oi))}</td><td class="num">${showD(dCe)}</td>` +
          `<td class="num neg">${esc(qty(r.pe_oi))}</td><td class="num">${showD(dPe)}</td>` +
          `<td class="num" style="background:${heat(tot, maxTot)}">${esc(qty(tot))}</td></tr>`;
      }
    );
    const prevNote = prev ? ` vs <b>${esc(prev.date || "")}</b>` : " · first snapshot (no prior day)";
    return body + cap(`latest <b>${esc(last.date || "")}</b>${prevNote} · ΔDoD = day-over-day change in <b>shares</b>`);
  }

  function paint(pane, ticker, snaps) {
    const host = pane.querySelector('[data-oih="body"]');
    if (!host) return;
    if (!snaps.length) {
      host.innerHTML = miss(`no OI history for ${ticker} yet — snapshots land after market close (15:35 IST)`);
      const latest = pane.querySelector('[data-oih-latest="1"]');
      if (latest) latest.innerHTML = miss("no snapshots yet");
      return;
    }
    const dates = snaps.map((s) => s.date || "");
    const last = snaps[snaps.length - 1];
    const top = (last.strikes || []).slice()
      .sort((a, b) => nz(b.ce_oi) + nz(b.pe_oi) - (nz(a.ce_oi) + nz(a.pe_oi)))
      .slice(0, 10)
      .map((r) => nz(r.strike));
    let side = host.dataset.side || "CE";
    const draw = () => {
      const chartEl = host.querySelector('[data-oih="chart"]');
      if (chartEl) {
        chartEl.innerHTML = trendChart(dates, snaps, top, side);
        if (U.charts) U.charts.mount(chartEl);
      }
      host.querySelectorAll('[data-oih-side]').forEach((b) =>
        b.classList.toggle("on", b.dataset.oihSide === side));
    };
    const tot = (last.strikes || []).reduce((s, r) => s + nz(r.ce_oi) + nz(r.pe_oi), 0);
    host.innerHTML =
      `<div class="kpis">` +
      `<div class="kpi"><div class="kpi-l">Snapshots</div><div class="kpi-v">${snaps.length}</div><div class="kpi-s">${esc(dates[0] || "")} → ${esc(dates[dates.length - 1] || "")}</div></div>` +
      `<div class="kpi"><div class="kpi-l">Latest total OI</div><div class="kpi-v">${esc(qty(tot))}</div><div class="kpi-s">shares · ${esc(last.date || "")}</div></div>` +
      `<div class="kpi"><div class="kpi-l">Strikes tracked</div><div class="kpi-v">${(last.strikes || []).length}</div><div class="kpi-s">per snapshot</div></div>` +
      `</div>` +
      `<div class="presets">` +
      `<button class="preset" data-oih-side="CE">Calls</button>` +
      `<button class="preset" data-oih-side="PE">Puts</button>` +
      `<button class="preset" data-oih-now style="margin-left:auto">Snapshot now</button>` +
      `</div>` +
      `<div data-oih="chart"></div>` +
      cap(`top 10 strikes by latest OI · daily EOD snapshots · hover a line for values`);
    host.querySelectorAll("[data-oih-side]").forEach((b) => {
      b.onclick = () => {
        side = b.dataset.oihSide;
        host.dataset.side = side;
        draw();
      };
    });
    const nowBtn = host.querySelector("[data-oih-now]");
    if (nowBtn) {
      nowBtn.onclick = async () => {
        nowBtn.disabled = true;
        try {
          await fetch(`/api/oi-history/refresh?ticker=${encodeURIComponent(ticker)}`);
          const res = await fetch(`/api/oi-history/${encodeURIComponent(ticker)}`);
          const j = await res.json();
          paint(pane, ticker, (j && j.snapshots) || []);
        } catch (e) {
          /* keep the old view on failure */
        }
      };
    }
    const tbl = pane.querySelector('[data-oih-latest="1"]');
    if (tbl) tbl.innerHTML = latestTable(snaps);
    draw();
  }

  U.PANELS.oihistory = {
    title: "OI History",
    render(data, full) {
      const p = (full && full.chain ? full : data && data.chain ? data : data) || {};
      const ticker = p.ticker || data.ticker || "";
      return (
        card(`OI Trend · ${esc(ticker)}`,
          `<div data-oih="body"><div class="muted" style="padding:6px">Loading OI history…</div></div>`, 4) +
        card("Latest snapshot · day-over-day",
          `<div data-oih-latest="1"><div class="muted" style="padding:6px">Loading…</div></div>`, 4)
      );
    },
    afterRender(pane, ticker) {
      const host = pane.querySelector('[data-oih="body"]');
      if (!host) return;
      fetch(`/api/oi-history/${encodeURIComponent(ticker)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((j) => {
          paint(pane, ticker, (j && j.snapshots) || []);
        })
        .catch((e) => {
          host.innerHTML = miss(`OI history unavailable: ${e.message}`);
          const latest = pane.querySelector('[data-oih-latest="1"]');
          if (latest) latest.innerHTML = miss("OI history unavailable");
        });
    },
    info: {
      title: "OI History",
      tagline: "Where option positions built over days: daily EOD OI per strike",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Daily end-of-day snapshots of option open interest per strike. The <b>trend chart</b> tracks the top 10 strikes (by latest OI) across days — rising lines mean positions building there. The <b>table</b> shows the latest snapshot with <b>day-over-day change</b> per strike. All quantities are <b>shares</b>.</p>`,
        },
        {
          h: "How to read it",
          p: `<p><b>Steadily rising PE OI</b> at a strike below spot = support being built day after day. <b>Rising CE OI</b> above spot = a growing ceiling. A strike whose OI suddenly jumps after days flat = fresh money — check the OI Ladder tab for the intraday detail. Toggle <b>Calls / Puts</b> to isolate each side.</p>`,
        },
        {
          h: "Worked example",
          p: `<pre>RELIANCE  PE 1400: 8.1L → 10.2L → 12.4L over 3 days
CE 1450: flat at ~10L
Reading: writers keep adding downside protection at 1400
while the 1450 ceiling holds — range 1400–1450 with a
bullish undertone into expiry.</pre>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/oi-history/{T}</code> — <code>snapshots[].{date, strikes[].{strike, ce_oi, pe_oi}}</code>. <code>GET /api/oi-history/refresh?ticker={T}</code> snapshots on demand.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Snapshots land after market close (15:35 IST, Mon–Fri) — intraday nothing new appears here.</li><li>History starts when the poller first runs; older dates are backfilled only via manual refresh.</li><li>Only the nearest-expiry chain is snapshotted, so strikes shift across expiries.</li></ul>`,
        },
      ],
    },
  };
})();
