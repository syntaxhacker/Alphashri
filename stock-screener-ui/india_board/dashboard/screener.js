/* Whale screener — cross-symbol "where is the money" table for the home page.
 *
 * Consumes the snapshot's `screen` section (built in scripts/snapshot_data.py):
 * net premium, biggest unusual ticket, OI change and dark-pool premium per
 * ticker. Sorted by the size of net premium, so the heaviest names read first.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { money, int, signCls, table, tk } = U.util;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));

  U.renderScreen = function (rows) {
    const data = arr(rows).slice();
    const score = (r) =>
      Math.max(Math.abs(n(r.net_premium)), n(r.unusual_premium), n(r.darkpool_premium), Math.abs(n(r.oi_change)) * 1e6);
    data.sort((a, b) => score(b) - score(a));
    const maxNet = Math.max(1, ...data.map((r) => Math.abs(n(r.net_premium))));
    const maxDp = Math.max(1, ...data.map((r) => n(r.darkpool_premium)));
    const heat = U.heat || (() => "");
    const cell = (v, max, cls) => {
      const val = n(v);
      if (!val) return '<td class="num muted">–</td>';
      return `<td class="num ${cls || ""}" style="background:${heat(val, max)}">${money(val)}</td>`;
    };
    return `<div class="screen">${table(
      [
        { label: "Ticker" },
        { label: "Net prem", num: true },
        { label: "Unusual prem", num: true },
        { label: "OI Δ", num: true },
        { label: "Dark pool prem", num: true },
      ],
      data,
      (r) => `<tr>
        <td>${tk(r.ticker)}</td>
        ${cell(r.net_premium, maxNet, signCls(n(r.net_premium)))}
        ${cell(r.unusual_premium, maxNet)}
        <td class="num ${signCls(n(r.oi_change))}">${n(r.oi_change) ? int(n(r.oi_change)) : '<span class="muted">–</span>'}</td>
        ${cell(r.darkpool_premium, maxDp)}
      </tr>`
    )}</div>`;
  };
})();
