/* Day Trader board — today's tape at a glance: squeeze, long/short bias,
 * gainers/losers, unusual volume, OI movers, dark pool. Data from /api/day
 * (scripts/day_data.py — reshaped from cached snapshot + opps, no new calls).
 * Reachable at #/day.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, money, num, rawpct, signCls, tk, table, card, hbars } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

  function barsSigned(rows, vf, rf, h) {
    if (!rows || !rows.length) return '<div class="muted" style="padding:6px">no names met this board\'s threshold today.</div>';
    const heat = U.heat || (() => "");
    const max = Math.max(1, ...rows.map((r) => Math.abs(n(vf(r)) || 0)));
    return `<div class="hbars">${rows
      .map((r) => {
        const v = n(vf(r)) || 0;
        const w = Math.min(100, (Math.abs(v) / max) * 100).toFixed(1);
        return `<div class="hbar"><span class="hb-l">${tk(r.ticker || r.symbol)}</span><span class="hb-t"><i style="width:${w}%;background:${v >= 0 ? "var(--pos)" : "var(--neg)"};${heat(v, max) ? `box-shadow:inset 0 0 0 99px ${heat(v, max)};` : ""}"></i></span><span class="hb-v ${signCls(v)}">${rf(r)}</span></div>`;
      })
      .join("")}</div>`;
  }

  U.renderDay = async function (root) {
    root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading day board…</div></div></div>';
    let d;
    try {
      const res = await fetch("/api/day");
      if (!res.ok) throw new Error("HTTP " + res.status);
      d = await res.json();
    } catch (e) {
      root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
      return;
    }
    const s = d.sections || {};
    const heat = U.heat || (() => "");

    const sq = s.squeeze || [];
    const sqMax = Math.max(1, ...sq.map((r) => n(r.si_float) || 0));
    const sqBody = sq.length
      ? table(
          [{ label: "Symbol" }, { label: "SI%", num: true }, { label: "Day", num: true }, { label: "Rel vol", num: true }],
          sq,
          (r) => {
            const si = (n(r.si_float) || 0) * 100;
            return `<tr><td>${tk(r.ticker)}</td><td class="num warn" style="background:${heat(si, sqMax * 100)}">${num(si, 1)}%</td><td class="num ${signCls(r.day)}">${r.day == null ? "–" : rawpct(r.day * 100)}</td><td class="num muted">${r.relvol == null ? "–" : num(r.relvol, 2) + "x"}</td></tr>`;
          }
        )
      : '<div class="muted" style="padding:6px">no squeeze candidates in the fresh screener right now.</div>';

    const longs = s.longs || [], shortsB = s.shorts_bias || [];
    const biasMax = Math.max(1, ...[...longs, ...shortsB].map((r) => Math.abs(n(r.net_premium) || 0)));

    const gain = s.gainers || [], lose = s.losers || [];
    const glBody =
      barsSigned(gain, (r) => (n(r.day) || 0) * 100, (r) => rawpct((n(r.day) || 0) * 100), 0) +
      barsSigned(lose, (r) => (n(r.day) || 0) * 100, (r) => rawpct((n(r.day) || 0) * 100), 0);

    const uv = s.uvol || [];
    const uvBody = barsSigned(uv, (r) => n(r.relvol) || 0, (r) => num(n(r.relvol) || 0, 2) + "x", 0);

    const oi = s.oi_change || [];
    const oiMax = Math.max(1, ...oi.map((r) => Math.abs(n(r.oi_change) || 0)));
    const oiBody = oi.length
      ? table(
          [{ label: "Ticker" }, { label: "OI Δ", num: true }, { label: "Vol", num: true }],
          oi.slice(0, 12),
          (r) => `<tr><td>${tk(r.ticker)}</td><td class="num ${signCls(r.oi_change)}" style="background:${heat(n(r.oi_change) || 0, oiMax)}">${num(r.oi_change, 1)}</td><td class="num">${r.volume == null ? "–" : Number(r.volume).toLocaleString()}</td></tr>`
        )
      : '<div class="muted" style="padding:6px">no open-interest movers today.</div>';

    const dp = s.darkpool || [];
    const dpMax = Math.max(1, ...dp.map((r) => Math.abs(n(r.premium) || 0)));
    const dpBody = dp.length
      ? table(
          [{ label: "Ticker" }, { label: "Price", num: true }, { label: "Prem", num: true }],
          dp.slice(0, 12),
          (r) => `<tr><td>${tk(r.ticker)}</td><td class="num">${num(r.price, 2)}</td><td class="num" style="background:${heat(n(r.premium) || 0, dpMax)}">${money(r.premium)}</td></tr>`
        )
      : '<div class="muted" style="padding:6px">no large dark-pool prints today.</div>';

    root.innerHTML = `<div class="tabgrid snap">
      ${card("Squeeze board · highest short interest", sqBody + '<div class="wl-note">short interest % float (fresh screener) · SI% heat · click a ticker to drill in</div>', 1)}
      ${card("Long bias · biggest net call premium", barsSigned(longs, (r) => n(r.net_premium) || 0, (r) => money(r.net_premium)), 1)}
      ${card("Short bias · biggest net put premium", barsSigned(shortsB, (r) => n(r.net_premium) || 0, (r) => money(r.net_premium)), 1)}
      ${card("Gainers vs losers · day %", glBody + '<div class="wl-note">green = up, red = down · click a ticker</div>', 1)}
      ${card("Unusual volume · relative volume", uvBody + '<div class="wl-note">today vs 30-day average · click a ticker</div>', 1)}
      ${card("OI movers · biggest open-interest change", oiBody, 1)}
      ${card("Dark pool · biggest prints", dpBody, 1)}
      ${card("Why this board", '<div class="hint" style="display:block">A day-trader scan: <b>squeeze</b> (crowded shorts + today\'s move), <b>long/short bias</b> (where net option premium went), <b>gainers/losers</b>, <b>unusual volume</b> (attention), <b>OI movers</b> (fresh positions), <b>dark pool</b> (institutional size). Combine: squeeze + long bias + unusual volume = momentum long; short bias + losers + OI up = breakdown short.</div>', 1)}
    </div>`;
    if (U.charts) U.charts.mount(root);
    // adaptive auto-refresh (fast while the market is open, cheap when shut)
    if (U._dayTimer) clearInterval(U._dayTimer);
    const tick = () => {
      if (location.hash.startsWith("#/day")) U.renderDay(root);
      else {
        clearInterval(U._dayTimer);
        U._dayTimer = null;
      }
    };
    U._dayTimer = U.every ? U.every("day", tick) : setInterval(tick, 60000);
  };
})();
