/* NSE futures + gamma exposure tab — futures curve with basis, dealer GEX
 *  histogram, OI/volume by expiry and the key levels strip.
 *
 * Backend: GET /api/futures/{T} -> {ticker, spot, as_of,
 *   futures: [{expiry, symbol, price, oi, oich, volume, basis,
 *   annualized_basis, dte}], max_pain, levels: {call_wall, put_wall,
 *   gamma_flip, magnet}, gex: [{strike, call_gex, put_gex, net}],
 *   net_gex, oi_by_expiry: [{expiry, call_oi, put_oi}]}.
 *
 * GEX is a Black-Scholes estimate (IV backed out of each leg's LTP,
 * server-side): call_gex is negative (dealers short calls), put_gex
 * positive (dealers long puts), scaled to ₹Cr per 1-point move. Positive
 * total = dealers long gamma (pin/chop); negative = short gamma (trend).
 * Futures OI is NOT published on the Fyers chain endpoint, so oi/oich
 * arrive null and render as "–" with an explicit note — never guessed.
 *
 * Loading: symbol.js renders this panel from the /api/symbol payload, so
 * render() returns skeletons and afterRender() fetches /api/futures/{T}
 * once per ticker (cached here) and fills the card bodies in place.
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, signCls, table, card } = U.util;

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
    if (v == null || isNaN(Number(v))) return "–";
    const x = Number(v), a = Math.abs(x);
    if (a >= 1e7) return (x / 1e7).toFixed(2) + " Cr";
    if (a >= 1e5) return (x / 1e5).toFixed(2) + " L";
    if (a >= 1e3) return (x / 1e3).toFixed(1) + "K";
    return String(Math.round(x));
  };
  const gexFmt = (v) => {
    if (v == null || isNaN(Number(v))) return "–";
    const x = Number(v);
    return (x >= 0 ? "+" : "") + x.toFixed(1);
  };
  const miss = (what) => `<div class="muted" style="padding:6px">${esc(what)} unavailable</div>`;
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;
  const kpi = (label, value, sub, cls) =>
    `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v ${cls || ""}">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ""}</div>`;
  const dist = (lvl, spot) =>
    lvl != null && spot ? (((Number(lvl) - spot) / spot) * 100).toFixed(2) + "%" : "–";

  async function load(ticker) {
    if (cache[ticker]) return cache[ticker];
    const res = await fetch(`/api/futures/${encodeURIComponent(ticker)}`);
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
    cache[ticker] = await res.json();
    return cache[ticker];
  }

  function futuresTable(p) {
    const rows = Array.isArray(p.futures) ? p.futures : [];
    if (!rows.length) return miss("futures curve");
    const body = table(
      [
        { label: "Expiry" },
        { label: "Price", num: true },
        { label: "Basis", num: true },
        { label: "Ann. basis", num: true },
        { label: "Volume", num: true },
        { label: "OI", num: true },
      ],
      rows,
      (r) =>
        `<tr><td>${esc(r.expiry || "–")}</td>` +
        `<td class="num">${r.price != null ? inr(r.price) : "–"}</td>` +
        `<td class="num ${signCls(r.basis)}">${r.basis != null ? num(r.basis) : "–"}</td>` +
        `<td class="num ${signCls(r.annualized_basis)}">${r.annualized_basis != null ? num(r.annualized_basis) + "%" : "–"}</td>` +
        `<td class="num muted">${r.volume != null ? qty(r.volume) : "–"}</td>` +
        `<td class="num muted">${r.oi != null ? qty(r.oi) : "–"}</td></tr>`
    );
    return (
      body +
      cap(
        `spot <b>${inr(p.spot)}</b> · basis = future − spot · ann. = carry % p.a. · ` +
          `Fyers publishes no futures OI, so OI shows <b>–</b> (volume is the liquidity proxy)`
      )
    );
  }

  function gexBody(p) {
    const rows = (Array.isArray(p.gex) ? p.gex : [])
      .map((r) => ({ strike: nz(r.strike), net: nz(r.net) }))
      .filter((r) => r.strike > 0);
    if (!rows.length) return miss("gamma exposure");
    const spot = p.spot != null && !isNaN(Number(p.spot)) ? Number(p.spot) : null;
    // Histogram window: top 20 strikes by |net|, back in strike order.
    const pick = rows
      .slice()
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 20)
      .sort((a, b) => a.strike - b.strike);
    const kpis =
      `<div class="kpis">` +
      kpi("Net GEX", p.net_gex != null ? gexFmt(p.net_gex) : "–", "₹Cr / pt", signCls(p.net_gex)) +
      kpi("Gamma flip", p.levels && p.levels.gamma_flip != null ? num(p.levels.gamma_flip, 0) : "–", "regime line") +
      kpi("Strikes", String(rows.length), spot != null ? "spot " + num(spot, 0) : "") +
      `</div>`;
    const chart = U.util.bars
      ? U.util.bars(
          pick.map((r) => ({ label: num(r.strike, 0), value: r.net })),
          { signed: true, height: 190, axis: true, name: "Net GEX" }
        )
      : "";
    return kpis + chart + cap(`net GEX per strike (₹Cr per 1-pt move) · green = dealer-long pin zone, red = dealer-short trend zone`);
  }

  function expiryBody(p) {
    const oi = Array.isArray(p.oi_by_expiry) ? p.oi_by_expiry : [];
    const futs = Array.isArray(p.futures) ? p.futures : [];
    const oiTbl =
      oi.length && (oi[0].call_oi != null || oi[0].put_oi != null)
        ? table(
            [
              { label: "Expiry" },
              { label: "Call OI", num: true },
              { label: "Put OI", num: true },
            ],
            oi,
            (r) =>
              `<tr><td>${esc(r.expiry || "–")}</td><td class="num">${qty(r.call_oi)}</td><td class="num">${qty(r.put_oi)}</td></tr>`
          )
        : miss("options OI by expiry");
    const volChart =
      futs.length && U.util.bars
        ? U.util.bars(
            futs.map((f) => ({ label: String(f.expiry || "").slice(5), value: nz(f.volume) })),
            { height: 140, axis: true, name: "Futures volume", color: "#3b82f6" }
          )
        : "";
    return (
      oiTbl +
      cap(`options chain covers the near expiry only — Fyers returns one expiry per chain call`) +
      volChart +
      (futs.length ? cap(`futures volume by expiry (shares) — liquidity proxy; OI not published`) : "")
    );
  }

  function levelsBody(p) {
    const L = p.levels || {};
    const spot = p.spot != null && !isNaN(Number(p.spot)) ? Number(p.spot) : null;
    const lvl = (label, v, cls) =>
      kpi(label, v != null ? inr(v) : "–", dist(v, spot) + " from spot", cls);
    return (
      `<div class="kpis">` +
      lvl("Call wall", L.call_wall, "neg") +
      lvl("Put wall", L.put_wall, "pos") +
      lvl("Gamma flip", L.gamma_flip, "") +
      lvl("Magnet", L.magnet, "") +
      lvl("Max pain", p.max_pain, "") +
      `</div>` +
      cap(`walls = highest-OI strikes (R above / S below spot) · flip = GEX sign-change regime line · magnet = peak |GEX| pin`)
    );
  }

  U.PANELS.futures = {
    title: "Futures",
    render() {
      return (
        card("Futures Curve · basis & volume", '<div data-fut="curve"><div class="muted" style="padding:6px">Loading futures…</div></div>', 2) +
        card("Gamma Exposure by Strike", '<div data-fut="gex"><div class="muted" style="padding:6px">Loading gamma…</div></div>', 2) +
        card("OI by Expiry", '<div data-fut="exp"><div class="muted" style="padding:6px">Loading OI…</div></div>', 2) +
        card("Key Levels · walls / flip / magnet", '<div data-fut="levels"><div class="muted" style="padding:6px">Loading levels…</div></div>', 2)
      );
    },
    async afterRender(pane, ticker) {
      const slots = pane.querySelectorAll("[data-fut]");
      if (!slots.length) return;
      let p;
      try {
        p = await load(ticker);
      } catch (e) {
        slots.forEach((el) => {
          el.innerHTML = `<div class="muted" style="padding:6px">Failed: ${esc(e.message)}</div>`;
        });
        return;
      }
      // User may have switched tabs while we fetched.
      if (!pane.isConnected || !pane.querySelector("[data-fut]")) return;
      const html = {
        curve: futuresTable(p),
        gex: gexBody(p),
        exp: expiryBody(p),
        levels: levelsBody(p),
      };
      slots.forEach((el) => {
        const k = el.dataset.fut;
        if (html[k] != null) el.innerHTML = html[k];
      });
      try {
        if (U.charts) U.charts.mount(pane);
      } catch (e) {
        /* charts are best-effort */
      }
      // Card heights changed after fill — re-run the masonry packer.
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
      title: "Futures",
      tagline: "Futures curve and dealer gamma map: carry cost, pin zones and breakout risk",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Four cards from <code>GET /api/futures/{T}</code>: the <b>futures curve</b> (price, basis vs spot, annualised carry, volume per monthly expiry), a <b>gamma exposure histogram</b> (net dealer GEX per strike), <b>OI by expiry</b> (options OI totals plus futures volume bars), and the <b>key levels strip</b> (call/put walls, gamma flip, magnet, max pain).</p>`,
        },
        {
          h: "How to read it",
          p: `<p><b>Basis &gt; 0</b> (contango) is normal — longs pay carry; a <b>discount</b> (negative basis) with weak volume warns of bearish carry. <b>Positive net GEX</b> (spot above the flip): dealers fade moves, expect chop and pinning toward the magnet — fade wall tests. <b>Negative net GEX</b> (spot below the flip): hedging amplifies moves — trade breakouts, avoid short premium. The <b>magnet</b> (peak |GEX| strike) is the pin target into expiry.</p>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/futures/{T}</code> — <code>futures[]</code> (Fyers <code>futures_chain</code>), <code>gex[]</code> (Black-Scholes estimate from the options chain), <code>levels</code>, <code>max_pain</code>, <code>oi_by_expiry</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Fyers publishes <b>no futures OI</b> — OI columns show <b>–</b> and volume is the liquidity proxy. Never treat volume as OI.</li><li>GEX is estimated (IV backed out of LTPs at a flat 6.5% rate), not a live dealer book — walls and flips shift after big flow or expiry.</li><li>The options chain covers the <b>near expiry only</b>, so OI-by-expiry is a single row; futures volume bars show the multi-expiry picture.</li></ul>`,
        },
      ],
    },
  };
})();
