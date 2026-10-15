/* Rollover & Basis tab — how open interest migrates from the near expiry to
 * the next one, and where the front future trades versus spot.
 *
 * Backend: GET /api/rollover/{TICKER} ->
 *   {ticker,
 *    rollover:{near_expiry, next_expiry, near_dte, next_dte, rollover_pct,
 *              rollover_pct_call, rollover_pct_put, oi_shift,
 *              classification:"rolling"|"holding", near_oi, next_oi,
 *              strikes:[{strike, near_oi, next_oi, rollover_pct, oi_shift}],
 *              unavailable?},
 *    basis:{ticker, spot, near:{expiry, price, basis, annualized_basis, dte},
 *           ts, unavailable?}}
 *
 * rollover_pct = next_oi / (near_oi + next_oi): there is no single expiry in
 * the denominator, so the value sits in [0,1] and >0.5 means more OI already
 * lives in the next series ("rolling"). basis = futures − spot; the annualised
 * value compares carry across expiries.
 *
 * Honesty contract: either block may be `unavailable` with a `reason`; every
 * number may be null. Nothing is guessed — missing values render as "–" and the
 * card states the source (Fyers chain v3 near+next expiry / futures_chain).
 *
 * render() returns skeletons; afterRender() fetches once per ticker and fills
 * the bodies in place (same contract as panels/futures.js).
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, signCls, pill, table, card } = U.util;

  const cache = {};

  const arr = (v) => (Array.isArray(v) ? v : []);
  const isNum = (v) => v != null && v !== "" && isFinite(Number(v));
  const DASH = "–";
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;
  const miss = (what) => `<div class="muted" style="padding:6px">${esc(what)}</div>`;
  const kpi = (label, value, sub, cls) =>
    `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v ${cls || ""}">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ""}</div>`;
  const inr = (v) =>
    isNum(v) ? "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : DASH;
  const pctFrac = (v) => (isNum(v) ? (Number(v) * 100).toFixed(1) + "%" : DASH);
  const pctPts = (v, d = 2) => (isNum(v) ? (Number(v) > 0 ? "+" : "") + Number(v).toFixed(d) + "%" : DASH);
  const qty = (v) => {
    if (!isNum(v)) return DASH;
    const x = Number(v), a = Math.abs(x);
    if (a >= 1e7) return (x / 1e7).toFixed(2) + " Cr";
    if (a >= 1e5) return (x / 1e5).toFixed(2) + " L";
    if (a >= 1e3) return (x / 1e3).toFixed(1) + "K";
    return String(Math.round(x));
  };
  const dteTxt = (v) => (isNum(v) ? "DTE " + num(v, 0) : "DTE " + DASH);

  async function load(ticker) {
    if (cache[ticker]) return cache[ticker];
    const res = await fetch(`/api/rollover/${encodeURIComponent(ticker)}`);
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (e) {
        /* keep the status */
      }
      throw new Error(msg);
    }
    cache[ticker] = await res.json();
    return cache[ticker];
  }

  function rolloverKpis(r) {
    if (!r || r.unavailable) return miss("rollover " + (r && r.reason ? ": " + r.reason : "unavailable"));
    const cls = r.classification === "rolling" ? "rolling" : "holding";
    return (
      `<div class="kpis">` +
      kpi("Near expiry", esc(r.near_expiry || DASH), dteTxt(r.near_dte)) +
      kpi("Next expiry", esc(r.next_expiry || DASH), dteTxt(r.next_dte)) +
      kpi("Rollover", pctFrac(r.rollover_pct), pill(cls, cls === "rolling" ? "buy" : "")) +
      kpi("CE / PE", pctFrac(r.rollover_pct_call) + " / " + pctFrac(r.rollover_pct_put), "call / put split") +
      kpi("OI shift", qty(r.oi_shift), "next − near (shares)", signCls(r.oi_shift)) +
      `</div>` +
      cap(`rollover = next-OI ÷ (near + next), per side · <b>rolling</b> when &gt;50% of OI already sits in the next series`)
    );
  }

  function strikeBars(r) {
    if (!r || r.unavailable) return miss("rollover strikes unavailable");
    const rows = arr(r.strikes).filter((x) => isNum(x.strike) && Number(x.strike) > 0);
    if (!rows.length) return miss("no per-strike rollover");
    const top = rows
      .slice()
      .sort((a, b) => Number(b.next_oi || 0) - Number(a.next_oi || 0))
      .slice(0, 15)
      .sort((a, b) => Number(a.strike) - Number(b.strike));
    if (!U.util.bars) return miss("charts unavailable");
    const chart = U.util.bars(
      top.map((x) => ({ label: num(x.strike, 0), value: isNum(x.rollover_pct) ? Number(x.rollover_pct) * 100 : 0 })),
      { signed: true, height: 220, axis: true, name: "Rollover %" }
    );
    return (
      chart +
      cap(`rollover % by strike (nearest ${top.length} by next-expiry OI) · &gt;50% = that strike has rolled into the next series`)
    );
  }

  function strikeTable(r) {
    if (!r || r.unavailable) return miss("rollover strikes unavailable");
    const rows = arr(r.strikes)
      .filter((x) => isNum(x.strike) && Number(x.strike) > 0)
      .sort((a, b) => Number(b.next_oi || 0) - Number(a.next_oi || 0))
      .slice(0, 20);
    if (!rows.length) return miss("no per-strike rollover");
    return (
      table(
        [
          { label: "Strike", num: true },
          { label: "Near OI", num: true },
          { label: "Next OI", num: true },
          { label: "Rollover %", num: true },
          { label: "OI shift", num: true },
        ],
        rows,
        (x) => {
          const p = isNum(x.rollover_pct) ? Number(x.rollover_pct) : null;
          return (
            `<tr><td class="num"><b>${esc(num(x.strike, 0))}</b></td>` +
            `<td class="num">${esc(qty(x.near_oi))}</td>` +
            `<td class="num">${esc(qty(x.next_oi))}</td>` +
            `<td class="num ${p == null ? "muted" : p >= 0.5 ? "pos" : "neg"}">${esc(pctFrac(x.rollover_pct))}</td>` +
            `<td class="num ${signCls(x.oi_shift)}">${esc(qty(x.oi_shift))}</td></tr>`
          );
        }
      ) + cap(`top 20 strikes by next-expiry OI · near/next OI in shares`)
    );
  }

  function basisBody(b) {
    if (!b || b.unavailable || !b.near) {
      return miss("basis " + (b && b.reason ? ": " + b.reason : "unavailable"));
    }
    const n = b.near;
    return (
      `<div class="kpis">` +
      kpi("Near contract", esc(n.expiry || DASH), dteTxt(n.dte)) +
      kpi("Futures", isNum(n.price) ? inr(n.price) : DASH, "front future") +
      kpi("Spot", isNum(b.spot) ? inr(b.spot) : DASH, "cash") +
      kpi("Basis", isNum(n.basis) ? "₹" + num(n.basis, 2) : DASH, "future − spot", signCls(n.basis)) +
      kpi("Ann. basis", pctPts(n.annualized_basis), "carry % p.a.", signCls(n.annualized_basis)) +
      `</div>` +
      cap(`basis = futures − spot (Fyers futures_chain, near contract) · annualised = carry % p.a. · positive basis is normal contango (longs pay carry)`)
    );
  }

  U.PANELS.rollover = {
    title: "Rollover",
    render(data, full) {
      const p = (full && full.chain ? full : data && data.chain ? data : data) || {};
      const ticker = p.ticker || (data && data.ticker) || "";
      const loading = '<div class="muted" style="padding:6px">Loading rollover…</div>';
      return (
        card(`Rollover · ${esc(ticker)}`, `<div data-roll="kpi">${loading}</div>`, 2) +
        card("Rollover % by strike", `<div data-roll="bars">${loading}</div>`, 2) +
        card("Per-strike near / next OI", `<div data-roll="strikes">${loading}</div>`, 2) +
        card("Basis · near future", `<div data-roll="basis">${loading}</div>`, 2)
      );
    },
    async afterRender(pane, ticker) {
      const slots = pane.querySelectorAll("[data-roll]");
      if (!slots.length) return;
      let p;
      try {
        p = await load(ticker);
      } catch (e) {
        slots.forEach((el) => {
          el.innerHTML = miss("rollover & basis unavailable: " + e.message);
        });
        return;
      }
      // User may have switched tabs while we fetched.
      if (!pane.isConnected || !pane.querySelector("[data-roll]")) return;
      const r = p.rollover || {};
      const html = { kpi: rolloverKpis(r), bars: strikeBars(r), strikes: strikeTable(r), basis: basisBody(p.basis) };
      slots.forEach((el) => {
        const k = el.dataset.roll;
        if (html[k] != null) el.innerHTML = html[k];
      });
      try {
        if (U.charts) U.charts.mount(pane);
      } catch (e) {
        /* charts are best-effort */
      }
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => {
        try {
          if (U.charts) U.charts.resizeAll();
        } catch (e) {
          /* ignore */
        }
      }, 350);
    },
    info: {
      title: "Rollover",
      tagline: "How open interest migrates to the next expiry, and the front-future basis",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Four cards from <code>GET /api/rollover/{T}</code>: <b>rollover KPIs</b> (near/next expiry + DTE, cumulative rollover %, the CE/PE split and the OI shift), a <b>rollover-by-strike</b> bar chart, a <b>per-strike near/next OI table</b> (top 20 by next-expiry OI) and the <b>near-future basis</b> (price, ₹ basis, annualised carry).</p>`,
        },
        {
          h: "How to read it",
          p: `<p><b>Rollover % = next-OI ÷ (near + next)</b>. Above 50% the market has <b>rolled</b> most of its position into the next series; below 50% it is still <b>holding</b> the near expiry. A strike with a high next-OI rollover is where the next series is being built — watch the OI shift sign. <b>Basis &gt; 0</b> (contango) is normal carry; a shrinking or negative basis with a falling rollover warns of unwinding longs.</p>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/rollover/{T}</code> — <code>rollover</code> (near+next chains) and <code>basis</code> (Fyers <code>futures_chain</code>).</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Rollover is computed from the <b>Fyers chain v3</b> near + next expiry, per side and per strike — it is not the exchange's official rollover file.</li><li>Either block may be <code>unavailable</code> with a <code>reason</code> (e.g. fewer than two expiries, futures not published) — the card shows that reason instead of a number.</li><li>Fyers publishes no futures OI, so OI here is <b>options OI</b>; the basis card is price-only.</li></ul>`,
        },
      ],
    },
  };
})();
