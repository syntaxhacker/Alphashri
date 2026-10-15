/* Next week — forward-looking calendar (earnings) + next-expiry index levels.
 * Reachable at #/week. Data from /api/week (scripts/week_data.py).
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, money, num, int, pct, signCls, tk } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const arr = (v) => (Array.isArray(v) ? v : []);

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function dayLabel(iso) {
    const d = new Date(iso + "T12:00:00Z");
    return isNaN(d) ? iso : `${DOW[d.getUTCDay()]} ${iso.slice(5)}`;
  }

  U.renderWeek = async function (root) {
    root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading next week…</div></div></div>';
    let d;
    try {
      const res = await fetch("/api/week");
      if (!res.ok) throw new Error("HTTP " + res.status);
      d = await res.json();
    } catch (e) {
      root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
      return;
    }
    const earn = arr(d.earnings);
    const levels = arr(d.index_levels);
    let optsOnly = false;

    function paint() {
      const rows = earn
        .filter((r) => (optsOnly ? r.has_options : true))
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.session < b.session ? -1 : 1)));
      const maxMove = Math.max(0.01, ...rows.map((r) => n(r.expected_move_perc) || 0));
      const heat = U.heat || (() => "");

      const byDay = {};
      rows.forEach((r) => {
        (byDay[r.date] = byDay[r.date] || []).push(r);
      });
      const days = Object.keys(byDay).sort();

      const calBody = days.length
        ? days
            .map((day) => {
              const list = byDay[day]
                .map((r) => {
                  const mv = n(r.expected_move_perc);
                  return `<tr>
                    <td class="muted">${esc(r.session === "premarket" ? "pre" : "post")}</td>
                    <td>${tk(r.symbol)}</td>
                    <td class="muted">${esc((r.sector || "").slice(0, 18))}</td>
                    <td class="num" style="background:${heat(mv || 0, maxMove)}">${mv == null ? "–" : pct(mv)}</td>
                    <td class="num muted">${r.marketcap ? "$" + (n(r.marketcap) / 1e9).toFixed(1) + "B" : "–"}</td>
                    <td>${r.has_options ? '<span class="pos">yes</span>' : '<span class="muted">–</span>'}</td>
                  </tr>`;
                })
                .join("");
              return `<tr class="dayrow"><td colspan="6"><b>${esc(dayLabel(day))}</b> · ${byDay[day].length} report${byDay[day].length > 1 ? "s" : ""}</td></tr>${list}`;
            })
            .join("")
        : '<tr><td colspan="6" class="muted">no earnings found for next week</td></tr>';

      const big = rows
        .filter((r) => r.has_options && n(r.expected_move_perc) != null)
        .sort((a, b) => n(b.expected_move_perc) - n(a.expected_move_perc))
        .slice(0, 12)
        .map((r) => ({ label: `${r.symbol} ${dayLabel(r.date).slice(0, 6)}`, value: (n(r.expected_move_perc) || 0) * 100, color: "#a855f7" }));
      const bigBody = big.length
        ? U.util.bars(big, { horizontal: true, axis: true, height: 260 }) + '<div class="wl-note">biggest expected moves (options-eligible) · % implied move</div>'
        : '<div class="muted" style="padding:6px">no options-eligible earnings</div>';

      const lvlBody = levels.length
        ? `<div class="wl-levels">${levels
            .map(
              (l) =>
                `<div class="wl-lv"><span class="dot" style="background:#3b82f6"></span><span class="wl-ln">${esc(l.ticker)}</span><b>${esc(l.gamma_magnet || "–")}</b><span class="wl-ld">wall ${esc(l.call_wall || "–")}/${esc(l.put_wall || "–")}</span></div>`
            )
            .join("")}</div><div class="wl-note">next-week expiry (${esc(d.expiry)}) · magnet and call/put walls · max pain ${levels.map((l) => esc(l.max_pain)).join(" · ")}</div>`
        : '<div class="muted" style="padding:6px">no index levels</div>';

      root.innerHTML = `<div class="tabgrid snap">
        <div class="card c4">
          <h2>Next week · earnings calendar · ${esc(d.week_start)} → ${esc(d.week_end)} <span class="hint-i" title="plain-English">i</span></h2>
          <div class="hint">Companies reporting <b>next week</b> (premarket = before the open, post = after the close). <b>Exp move</b> = the % move options are pricing for the report — the heat scale shows the biggest. Click a ticker to drill in.</div>
          <div class="body">
            <div class="presets"><button class="preset ${optsOnly ? "on" : ""}" id="wk-opts">Options-eligible only</button></div>
            <table class="screen"><thead><tr><th>When</th><th>Ticker</th><th>Sector</th><th class="num">Exp move</th><th class="num">Mkt cap</th><th>Options</th></tr></thead><tbody>${calBody}</tbody></table>
          </div>
        </div>
        <div class="card c2">
          <h2>Biggest expected moves next week <span class="hint-i" title="plain-English">i</span></h2>
          <div class="hint">The earnings with the largest <b>implied moves</b> next week — the most likely volatility events. Purple bars = % move options are pricing.</div>
          <div class="body">${bigBody}</div>
        </div>
        <div class="card c2">
          <h2>Next-expiry levels · ${esc(d.expiry)} <span class="hint-i" title="plain-English">i</span></h2>
          <div class="hint">Key gamma levels for the <b>next weekly expiry</b> on the major indices/ETFs — the strikes price is most likely to react to next week.</div>
          <div class="body">${lvlBody}</div>
        </div>
      </div>`;
      const t = root.querySelector("#wk-opts");
      if (t)
        t.onclick = () => {
          optsOnly = !optsOnly;
          paint();
        };
    }

    paint();
  };
})();
