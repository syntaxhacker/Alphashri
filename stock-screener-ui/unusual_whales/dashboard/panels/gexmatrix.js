/* Heatmap tab — dealer exposure by strike (rows) × expiry (cols).
 *
 * Data: gex_matrix from symbol_data._build_gexmatrix (fans out over the next few
 * expiries of /greek-exposure/strike-expiry). Server returns ALL strikes per
 * expiry — the panel scrolls, never truncates. Rendered by symbol.js as
 * UW.PANELS.gexmatrix and drawn with the shared U.util.matrix helper.
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, card } = U.util;

  const METRICS = [
    { id: "gex", label: "GEX", sym: "Γ" },
    { id: "vanna", label: "VEX", sym: "V" },
    { id: "delta", label: "Delta", sym: "Δ" },
    { id: "charm", label: "Charm", sym: "C" },
  ];
  const VIEWS = [
    { id: "all", label: "All" },
    { id: "fit", label: "Fit ±10%" },
  ];
  const H = 400; // max-height of the scroll area
  const FIT_PCT = 0.1; // ±10% around spot (view-only filter)

  let metric = "gex";
  let view = "all";

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const spotOf = (m) => n(m && m.spot);

  // OI-based exposure updates ~once/day; tag it with the payload's as-of stamp
  // (gex_levels date/time when present) so it isn't read as live.
  function asOfNote(gx, m) {
    gx = gx || {};
    m = m || {};
    const date = String(gx.date || m.date || "").trim();
    const rawTime = gx.time || m.time;
    const time = rawTime ? U.util.et(rawTime) : "";
    const stamp = [date, time].filter(Boolean).join(" ");
    return `<div class="wl-note">as of ${esc(stamp || "~06:45")} ET · OI-based</div>`;
  }

  function fmt(v) {
    if (v == null) return "·";
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    if (a >= 1) return v.toFixed(0);
    if (a === 0) return "0";
    return v.toFixed(2);
  }

  // strike nearest spot (used for the ◀ marker)
  function nearestStrike(m) {
    const spot = spotOf(m);
    if (spot == null) return null;
    let best = null;
    let bd = Infinity;
    (m.strikes || []).forEach((k) => {
      const d = Math.abs(Number(k) - spot);
      if (d < bd) {
        bd = d;
        best = Number(k);
      }
    });
    return best;
  }

  // rows to display for the active view (data is untouched; view filters only)
  function rowsFor(m) {
    const strikes = m.strikes || [];
    if (view !== "fit") return strikes;
    const spot = spotOf(m);
    if (spot == null) return strikes;
    return strikes.filter((k) => Math.abs(Number(k) - spot) / spot <= FIT_PCT);
  }

  function matrixHtml(m) {
    const idx = {};
    (m.cells || []).forEach((c) => {
      idx[c.e + "|" + c.k] = c;
    });
    const spot = spotOf(m);
    const near = nearestStrike(m);
    const rows = rowsFor(m);
    return U.util.matrix({
      rows,
      cols: m.expiries || [],
      get: (k, e) => {
        const c = idx[e + "|" + k];
        return c ? n(c[metric]) : null;
      },
      fmt,
      height: H,
      corner: "strike",
      colFmt: (e) => String(e).slice(5),
      rowFmt: (k) => String(k) + (Number(k) === near ? " ◀" : ""),
    });
  }

  function controlsHtml(m) {
    const spot = spotOf(m);
    const total = (m.strikes || []).length;
    const shown = rowsFor(m).length;
    const btn = (id, label, sym, on, attr) =>
      `<button class="preset ${on ? "on" : ""}" data-${attr}="${id}">${label}${sym ? ` <span class="muted">${sym}</span>` : ""}</button>`;
    return (
      `<div class="presets" style="gap:4px;padding:4px 6px;align-items:center">` +
      `<span class="muted" style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">metric</span>` +
      METRICS.map((x) => btn(x.id, x.label, x.sym, x.id === metric, "gm")).join("") +
      `<span class="muted" style="padding:0 2px">·</span>` +
      `<span class="muted" style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">view</span>` +
      VIEWS.map((v) => btn(v.id, v.label, "", v.id === view, "gv")).join("") +
      `<span class="muted" style="margin-left:auto;font-size:9.5px">spot ${spot ? spot.toFixed(2) : "–"} · ${shown}/${total} strikes × ${(m.expiries || []).length} expiries` +
      (view === "fit" ? ` <span class="muted">(view filter — all data retained)</span>` : "") +
      `</span>` +
      `</div>`
    );
  }

  U.PANELS.gexmatrix = {
    title: "Heatmap",
    render(d) {
      const m = d && d.gex_matrix;
      const gx = Array.isArray(d && d.gex_levels) ? (d.gex_levels[0] || {}) : (d && d.gex_levels) || {};
      if (!m || !m.expiries || !m.strikes || !m.strikes.length) {
        return card("Heatmap · strike × expiry", '<div class="muted" style="padding:6px">no matrix data</div>', 4);
      }
      return card(
        "Heatmap · strike × expiry",
        `<div id="gm-ctrl">${controlsHtml(m)}</div><div id="gm-wrap">${matrixHtml(m)}</div>` +
          asOfNote(gx, m) +
          '<div class="wl-note">Net dealer exposure per strike (rows) × expiry (cols): <span class="pos">green = positive</span>, <span class="neg">red = negative</span>, intensity ∝ magnitude. <b>GEX</b>=gamma · <b>VEX</b>=vanna · delta · charm. ◀ = strike nearest spot. Scrolls — full strike ladder, not truncated.</div>',
        4
      );
    },
    afterRender(pane, ticker, payload) {
      const m = payload && payload.data && payload.data.gex_matrix;
      if (!m) return;
      const wrap = pane.querySelector("#gm-wrap");
      const ctrl = pane.querySelector("#gm-ctrl");
      if (!wrap || !ctrl) return;
      const paint = () => {
        wrap.innerHTML = matrixHtml(m);
        ctrl.innerHTML = controlsHtml(m);
        ctrl.querySelectorAll("[data-gm]").forEach((b) => {
          b.onclick = () => {
            metric = b.dataset.gm;
            paint();
          };
        });
        ctrl.querySelectorAll("[data-gv]").forEach((b) => {
          b.onclick = () => {
            view = b.dataset.gv;
            paint();
          };
        });
      };
      const center = () => {
        const sc = wrap.querySelector(".hm-wrap") || wrap;
        const tr = [...wrap.querySelectorAll("tbody tr")].find((r) => r.textContent.indexOf("◀") >= 0);
        if (tr && sc) {
          const delta = tr.getBoundingClientRect().top - sc.getBoundingClientRect().top;
          sc.scrollTop = Math.max(0, sc.scrollTop + delta - sc.clientHeight / 2);
        }
      };
      paint();
      center(); // open on the money strikes, not the top of the ladder
    },
    info: {
      title: "Heatmap",
      tagline: "Dealer exposure by strike × expiry — full strike ladder",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>A <b>strike × expiry heatmap</b> of net dealer exposure. Rows are strikes (descending), columns are the next few expiries, and each cell is the selected metric — <span class="pos">green = positive</span>, <span class="neg">red = negative</span>, intensity ∝ magnitude. Use the <b>metric</b> toggle to switch between <b>GEX</b> (gamma), <b>VEX</b> (vanna), <b>Delta</b> and <b>Charm</b>.</p>`,
        },
        {
          h: "Full data & view filter",
          p: `<p>The server returns <b>every strike for every expiry</b> — the panel scrolls, it never truncates. The <b>view</b> toggle is a display filter only: <b>All</b> (default) shows the full ladder; <b>Fit ±10%</b> narrows the visible rows to strikes within ±10% of spot so the near-the-money action fills the viewport. Switching views does <b>not</b> drop or refetch data — toggling back to All restores every row.</p>`,
        },
        {
          h: "How to read it",
          p: `<p>Look for <b>vertical walls</b> — a strike with a large value across several expiries is a strong pin/hedge level — and <b>horizontal bands</b> — an expiry where dealers are loaded. The <b>◀</b> marks the strike nearest spot. Positive gamma tends to dampen price; negative gamma amplifies moves.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Dealer-exposure signs are provider-defined — treat it as positioning, not a forecast.</li><li>The 0DTE column can be sparse early in the session.</li><li>Colour intensity is scaled to the largest magnitude in the <em>currently displayed</em> rows, so <b>Fit ±10%</b> can look hotter than <b>All</b> for the same value.</li><li>Fit ±10% is a view filter; the underlying matrix is always complete.</li></ul>`,
        },
      ],
    },
  };
})();
