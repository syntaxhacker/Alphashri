/* Whale screener — cross-symbol "where is the money" heatmap for the home page.
 *
 * Consumes the snapshot's `screen` section (built in scripts/snapshot_data.py):
 * net premium, biggest unusual ticket, OI change and dark-pool premium per
 * ticker. Rendered as a compact ticker × metric matrix heatmap (green/red by
 * |value|) that scrolls inside the narrow card — every ticker, no truncation.
 * Sorted by the size of net premium, so the heaviest names read first.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { money, int, matrix } = U.util;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));

  const COLS = ["Net prem", "Unusual", "OI Δ", "Dark pool"];
  const FIELD = {
    "Net prem": "net_premium",
    Unusual: "unusual_premium",
    "OI Δ": "oi_change",
    "Dark pool": "darkpool_premium",
  };
  const OI = "OI Δ";

  // matrix() calls fmt(value) with no column argument. It evaluates get(row,col)
  // immediately before fmt for each cell, so capture the column key in get() to
  // format premiums as money and the OI-change column as a plain integer.
  let col = null;
  const fmt = (v) => (col === OI ? int(v) : money(v));

  U.renderScreen = function (rows) {
    const data = arr(rows).slice();
    const score = (r) =>
      Math.max(Math.abs(n(r.net_premium)), n(r.unusual_premium), n(r.darkpool_premium), Math.abs(n(r.oi_change)) * 1e6);
    data.sort((a, b) => score(b) - score(a));

    const byTicker = new Map(data.map((r) => [r.ticker, r]));
    const get = (ticker, c) => {
      col = c;
      const r = byTicker.get(ticker);
      if (!r) return null;
      return n(r[FIELD[c]]) || null; // zero / absent → blank "·" cell
    };

    return matrix({
      rows: data.map((r) => r.ticker),
      cols: COLS,
      get,
      fmt,
      rowFmt: (t) => t,
      corner: "Ticker",
      height: 320,
    });
  };
})();
