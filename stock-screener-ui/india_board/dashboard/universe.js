/* Universe — all-options-stocks "where are big players betting" view.
 *
 * Data from GET /api/universe:
 *   { generated_at, expiry,
 *     status: { state, progress, total, updated_at },
 *     sections: { top_call_buildup: [{ticker, strike, oi, oich}],
 *                 top_put_buildup: [...],
 *                 pcr_extremes: [{ticker, pcr, spot, resistance, support}],
 *                 unusual: [{ticker, strike, oich, oi}] } }
 *
 * While status.state !== "ready" a progress card is shown with a 20s
 * auto-retry (U._uniTimer, cleared on route change). Once ready the view is
 * static — no polling.
 *
 * Reachable at #/universe.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, num, int, signCls, tk, table, card } = U.util;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const dash = '<span class="muted">–</span>';

  function stopTimer() {
    if (U._uniTimer) {
      clearInterval(U._uniTimer);
      U._uniTimer = null;
    }
  }

  async function load() {
    const res = await fetch("/api/universe");
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function progressHtml(status) {
    const s = status || {};
    const done = n(s.progress) != null ? int(s.progress) : "–";
    const total = n(s.total) != null ? int(s.total) : "–";
    const upd = s.updated_at ? ` <span class="muted">updated ${esc(s.updated_at)}</span>` : "";
    return (
      '<div class="tabgrid snap">' +
      card(
        "Universe · scanning NSE F&O",
        `<div class="hint">Checking every traded stock option to see where the big positions are building — this takes a minute.</div>` +
          `<div class="muted" style="padding:10px">Scanning NSE F&amp;O… ${done}/${total} — auto-refreshes${upd}</div>`,
        4
      ) +
      "</div>"
    );
  }

  function buildupRow(r, max) {
    const heat = U.heat || (() => "");
    const st = n(r.strike);
    const ch = n(r.oich);
    const oi = n(r.oi);
    return (
      "<tr>" +
      `<td>${tk(r.ticker)}</td>` +
      `<td class="num">${st == null ? dash : num(st, 0)}</td>` +
      `<td class="num ${signCls(ch)}" style="background:${heat(ch || 0, max)}">${ch == null ? dash : int(ch)}</td>` +
      `<td class="num">${oi == null ? dash : int(oi)}</td>` +
      "</tr>"
    );
  }

  function buildupTable(rows) {
    const max = Math.max(1, ...arr(rows).map((r) => Math.abs(n(r.oich) || 0)));
    const cols = [{ label: "Ticker" }, { label: "Strike", num: true }, { label: "OI Δ", num: true }, { label: "OI", num: true }];
    return table(cols, arr(rows), (r) => buildupRow(r, max));
  }

  function paintReady(root, d) {
    const sec = (d && d.sections) || {};
    const calls = arr(sec.top_call_buildup);
    const puts = arr(sec.top_put_buildup);
    const pcrs = arr(sec.pcr_extremes);
    const unus = arr(sec.unusual);
    const heat = U.heat || (() => "");

    const meta = [d.expiry ? "expiry " + esc(d.expiry) : "", d.generated_at ? "updated " + esc(d.generated_at) : ""]
      .filter(Boolean)
      .join(" · ");
    const metaHtml = meta ? ` <span class="muted" style="font-weight:400">${meta}</span>` : "";

    const maxDev = Math.max(0.05, ...pcrs.map((r) => Math.abs((n(r.pcr) == null ? 1 : n(r.pcr)) - 1)));
    const pcrBody =
      '<div class="hint">Stocks with the most one-sided betting — fear or confidence is stretched, and stretched bets often snap back.</div>' +
      table(
        [{ label: "Ticker" }, { label: "PCR", num: true }, { label: "Spot", num: true }, { label: "R / S", num: true }],
        pcrs,
        (r) => {
          const p = n(r.pcr);
          const sp = n(r.spot);
          const res = n(r.resistance);
          const sup = n(r.support);
          const rs = res == null && sup == null ? dash : `${res == null ? "–" : num(res, 0)} / ${sup == null ? "–" : num(sup, 0)}`;
          return (
            "<tr>" +
            `<td>${tk(r.ticker)}</td>` +
            `<td class="num" style="background:${p == null ? "" : heat(Math.abs(p - 1), maxDev)}">${p == null ? dash : num(p, 2)}</td>` +
            `<td class="num">${sp == null ? dash : num(sp, 2)}</td>` +
            `<td class="num">${rs}</td>` +
            "</tr>"
          );
        }
      );

    root.innerHTML =
      '<div class="tabgrid snap">' +
      card(
        "Call buildup · biggest OI increases" + metaHtml,
        '<div class="hint">Stocks where bullish bets grew the most — big players are positioning for a move up.</div>' +
          buildupTable(calls),
        1
      ) +
      card(
        "Put buildup · biggest OI increases",
        '<div class="hint">Stocks where defensive bets grew the most — big players are bracing for a fall, or protecting gains.</div>' +
          buildupTable(puts),
        1
      ) +
      card("PCR extremes", pcrBody, 1) +
      card(
        "Unusual · OI jump vs base",
        '<div class="hint">Strikes where positions suddenly jumped — unusual activity that can come before a big move.</div>' +
          buildupTable(unus),
        1
      ) +
      "</div>";
  }

  U.renderUniverse = async function (root) {
    stopTimer();
    root.innerHTML =
      '<div class="tabgrid snap">' +
      card("Universe · all options stocks", '<div class="muted" style="padding:10px">Loading universe…</div>', 4) +
      "</div>";

    let ready = false;
    const tick = async () => {
      let d;
      try {
        d = await load();
      } catch (e) {
        root.innerHTML =
          '<div class="tabgrid snap">' +
          card("Universe · all options stocks", `<div class="err">Failed: ${esc(e.message)} — retrying…</div>`, 4) +
          "</div>";
        return;
      }
      const state = d && d.status ? d.status.state : "";
      if (state !== "ready") {
        root.innerHTML = progressHtml(d.status);
        return;
      }
      ready = true;
      stopTimer();
      paintReady(root, d);
    };

    await tick();
    if (!ready) {
      stopTimer();
      U._uniTimer = setInterval(() => {
        if (location.hash.startsWith("#/universe")) tick();
      }, 20000);
    }
  };
})();
