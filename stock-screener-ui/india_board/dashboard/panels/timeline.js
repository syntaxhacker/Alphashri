/* Timeline tab — when did whales buy or sell? Large prints plotted against time.
 *
 *   flow_alerts  -> big option tickets with created_at (call = buy, put = sell/hedge)
 *   darkpool     -> big off-exchange prints with executed_at
 *   net_prem_ticks -> running net premium through the session
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, signCls, shortDate, table, card, kpiBig, line, bars, scatter, tk } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? 0 : Number(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};
  const NO = '<div class="muted" style="padding:6px">no data</div>';

  function et(iso) {
    const t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
    } catch (e) {
      return String(iso).slice(11, 16);
    }
  }

  function etShiftSec(iso) {
    const t = Date.parse(iso || "");
    if (isNaN(t)) return 0;
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(t));
      const g = (k) => Number(parts.find((p) => p.type === k).value);
      return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t) / 1000);
    } catch (e) {
      return 0;
    }
  }

  U.PANELS.timeline = {
    title: "Timeline",
    render(d) {
      d = d || {};
      const st = first(d.stock_state);
      const gx = first(d.gex_levels);
      const fa = arr(d.flow_alerts);
      const dp = arr(d.darkpool);
      const npt = arr(d.net_prem_ticks);

      const sample = (fa[0] && fa[0].created_at) || (dp[0] && dp[0].executed_at) || "";
      const shiftMs = etShiftSec(sample) * 1000;

      // Full-session ticks (flow_per_strike_intraday spans the whole day, unlike
      // flow_alerts which the API caps at the latest ~100). One dot per
      // strike-tick, COLORED BY INTENT: call-dominated = green (bullish),
      // put-dominated = red (bearish), two-sided = gray (noise). Whale-size
      // premium (top decile) gets full brightness + white border; the drip fades.
      const ticks = arr(d.flow_ticks);
      const tickPrems = ticks.map((r) => Math.max(n(r.call_premium), n(r.put_premium))).sort((a, b) => a - b);
      const whaleAt = tickPrems.length ? tickPrems[Math.floor(tickPrems.length * 0.9)] : Infinity;
      const mkTick = (iso, r, cp, pp) => {
        const t = r.timestamp;
        const cv = n(r.call_volume) || 0, pv = n(r.put_volume) || 0;
        const ca = n(r.call_volume_ask_side) || 0, cb = n(r.call_volume_bid_side) || 0;
        const pa = n(r.put_volume_ask_side) || 0, pb = n(r.put_volume_bid_side) || 0;
        const cAsk = ca + cb > 0 ? Math.round((ca / (ca + cb)) * 100) : null;
        const pAsk = pa + pb > 0 ? Math.round((pa / (pa + pb)) * 100) : null;
        const net = n(r.net_premium) || 0;
        const best = Math.max(cp, pp);
        // plain-English verdict: who acted and how — ask-side = buyer-initiated
        // (paying up), bid-side = seller-initiated, so a $44M all-bid-side
        // print reads as the SELL it is
        const dom = cp >= 2 * pp ? "call" : pp >= 2 * cp ? "put" : null;
        const ask = dom === "call" ? cAsk : dom === "put" ? pAsk : null;
        const what = dom === "call" ? "Call" : dom === "put" ? "Put" : null;
        const verdict = !dom
          ? `<b style="color:#94a3b8">→ Two-sided · no clear actor</b>`
          : ask == null
          ? `<b>→ ${what}-dominated</b>`
          : ask >= 60
          ? `<b style="color:#22c55e">→ ${what} BUYING</b> (${ask}% ask-side)`
          : ask <= 40
          ? `<b style="color:#f59e0b">→ ${what} SELLING</b> (${100 - ask}% bid-side)`
          : `<b>→ ${what} flow · mixed side</b> (${ask}% ask)`;
        // full-detail hover: side split tells buys (ask%) from sells,
        // e.g. a $44M all-bid-side print = a SELL, not a buy
        const label =
          `<b>${et(t)} · K ${r.strike}</b><br/>${verdict}<br/>` +
          `<span style="color:#22c55e">Call ${money(cp)}</span> ask ${cAsk == null ? "–" : cAsk + "%"} · vol ${int(cv)}<br/>` +
          `<span style="color:#f87171">Put ${money(pp)}</span> ask ${pAsk == null ? "–" : pAsk + "%"} · vol ${int(pv)}<br/>` +
          `Net ${money(net)} · ${int(n(r.trades) || 0)} trades`;
        return {
          x: Date.parse(iso) + shiftMs, y: best, size: best,
          color: null, whale: best >= whaleAt, op: best >= whaleAt ? 1 : 0.22, label,
          _cp: cp, _pp: pp,
        };
      };
      const tickCalls = [], tickPuts = [], tickMixed = [];
      ticks.forEach((r) => {
        const t = r.timestamp;
        if (!t || isNaN(Date.parse(t))) return;
        const cp = n(r.call_premium), pp = n(r.put_premium);
        const best = Math.max(cp, pp);
        if (best <= 0) return;
        const whale = best >= whaleAt;
        const dot = mkTick(t, r, cp, pp);
        if (cp >= 2 * pp) { dot.color = "#22c55e"; tickCalls.push(dot); }
        else if (pp >= 2 * cp) { dot.color = "#f87171"; tickPuts.push(dot); }
        else { dot.color = "#64748b"; dot.whale = false; dot.op = 0.22; tickMixed.push(dot); }
      });
      const tickMax = Math.max(1, ...[...tickCalls, ...tickPuts, ...tickMixed].map((p) => p.size));
      const hasTicks = tickCalls.length || tickPuts.length;

      const mk = (a) => {
        const isCall = String(a.type).toLowerCase() === "call";
        const ask = n(a.total_ask_side_prem), bid = n(a.total_bid_side_prem);
        const side = ask + bid > 0 ? `${Math.round((Math.max(ask, bid) / (ask + bid)) * 100)}% ${ask >= bid ? "ask" : "bid"}` : "–";
        const verdict =
          ask + bid > 0
            ? ask >= bid
              ? `<b style="color:#22c55e">→ ${isCall ? "Call" : "Put"} BUYING</b>`
              : `<b style="color:#f59e0b">→ ${isCall ? "Call" : "Put"} SELLING</b>`
            : "";
        return {
          x: Date.parse(a.created_at) + shiftMs,
          y: n(a.total_premium),
          size: n(a.total_premium),
          label:
            `<b>${et(a.created_at)} · ${isCall ? "CALL" : "PUT"} ${a.strike} ${shortDate(a.expiry)}</b><br/>${verdict}<br/>` +
            `Prem ${money(a.total_premium)} · ${side}${a.has_sweep ? ' · <span style="color:#f59e0b">⚡ sweep</span>' : ""}<br/>` +
            `Vol ${int(a.volume)} · V/OI ${num(a.volume_oi_ratio, 1)} · Δ ${num(a.delta, 2)}${a.all_opening_trades ? " · opening" : ""}`,
        };
      };
      const calls = fa
        .filter((a) => String(a.type).toLowerCase() === "call")
        .map((a) => mk(a));
      const puts = fa
        .filter((a) => String(a.type).toLowerCase() === "put")
        .map((a) => mk(a));
      const dpp = dp.map((r) => mk(r.executed_at, `${et(r.executed_at)} · dark pool ${r.price} × ${int(r.size)} · ${money(r.premium)}`, n(r.premium)));
      const sizeMax = Math.max(1, ...[...calls, ...puts, ...dpp].map((p) => p.size));

      const timeline = hasTicks
        ? scatter(
            [
              { name: "Calls", color: "#22c55e", data: tickCalls },
              { name: "Puts", color: "#f87171", data: tickPuts },
              { name: "Mixed", color: "#64748b", data: tickMixed },
            ],
            { height: 320, sizeMax: tickMax, sizeCap: 26, yFmt: (v) => "$" + (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : (v / 1e3).toFixed(0) + "K") }
          ) + '<div class="wl-note">every strike-tick of the session (ET) · <span class="pos">green = call-dominated (bullish)</span>, <span class="neg">red = put-dominated (bearish)</span>, gray = two-sided noise · <b>bright + white border = whale-size premium (top 10%)</b>, dim = background drip · hover a dot for strike + premium</div>'
        : calls.length || puts.length
        ? scatter(
            [
              { name: "Calls", color: "#16a34a", data: calls },
              { name: "Puts", color: "#dc2626", data: puts },
            ],
            { height: 320, sizeMax: Math.max(1, ...[...calls, ...puts].map((p) => p.size)), sizeCap: 26, yFmt: (v) => "$" + (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : (v / 1e3).toFixed(0) + "K") }
          ) + '<div class="wl-note">recent large option tickets plotted by time (ET) · dot size = premium · <span class="pos">green = calls</span>, <span class="neg">red = puts</span> · dark pool is on its own chart below</div>'
        : NO;

      // ---- cumulative net premium ----------------------------------------
      let run = 0;
      const cum = npt.map((r) => {
        run += n(r.net_call_premium) + n(r.net_put_premium);
        return run;
      });
      const cumChart = npt.length
        ? line(cum, { height: 170, x: npt.map((r) => et(r.tape_time || r.date)), axis: true, stroke: "#22d3ee", fill: "#22d3ee" }) +
          '<div class="wl-note">running net premium through the session (call + put)</div>'
        : NO;

      // ---- biggest buys vs sells -----------------------------------------
      const topCalls = fa
        .filter((a) => String(a.type).toLowerCase() === "call")
        .sort((a, b) => n(b.total_premium) - n(a.total_premium))
        .slice(0, 8)
        .map((a) => ({ label: `${et(a.created_at)} ${a.strike}${a.has_sweep ? "⚡" : ""}`, value: n(a.total_premium), color: "#16a34a" }));
      const topPuts = fa
        .filter((a) => String(a.type).toLowerCase() === "put")
        .sort((a, b) => n(b.total_premium) - n(a.total_premium))
        .slice(0, 8)
        .map((a) => ({ label: `${et(a.created_at)} ${a.strike}${a.has_sweep ? "⚡" : ""}`, value: n(a.total_premium), color: "#dc2626" }));
      const buysSells =
        (topCalls.length ? bars(topCalls, { horizontal: true, axis: true, height: 200 }) : "") +
        (topPuts.length ? bars(topPuts, { horizontal: true, axis: true, height: 200 }) : "") +
        '<div class="wl-note">biggest call buys (green) vs put buys (red) · ⚡ sweep</div>';

      // ---- dark pool timeline --------------------------------------------
      const dppOnly = dpp.length ? scatter([{ name: "Dark pool", color: "#3b82f6", data: dpp }], { height: 220, sizeMax, sizeCap: 24, yFmt: (v) => "$" + (v >= 1e6 ? (v / 1e6).toFixed(0) + "M" : (v / 1e3).toFixed(0) + "K") }) : NO;

      // ---- print log ------------------------------------------------------
      const log = fa
        .slice()
        .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))
        .slice(0, 25);
      const logBody = log.length
        ? table(
            [{ label: "Time" }, { label: "Type" }, { label: "Strike", num: true }, { label: "Exp" }, { label: "Prem", num: true }, { label: "" }],
            log,
            (a) => {
              const isCall = String(a.type).toLowerCase() === "call";
              return `<tr><td>${esc(et(a.created_at))}</td><td class="${isCall ? "pos" : "neg"}">${isCall ? "CALL" : "PUT"}</td><td class="num">${esc(a.strike)}</td><td>${esc(shortDate(a.expiry))}</td><td class="num ${isCall ? "pos" : "neg"}">${money(a.total_premium)}</td><td>${a.has_sweep ? '<span class="warn">⚡</span>' : ""}</td></tr>`;
            }
          )
        : NO;

      const px = n(st.close);
      const flip = n(gx.gamma_flip);
      const kpis =
        kpiBig("Prints", int(fa.length), "option tickets") +
        kpiBig("Dark pool", int(dp.length), "off-exchange") +
        kpiBig("Call tickets", int(calls.length), "", "pos") +
        kpiBig("Put tickets", int(puts.length), "", "neg") +
        (px ? kpiBig("Last", num(px, 2), flip ? (px >= flip ? "above flip" : "below flip") : "") : "");

      return (
        card("Whale timeline · large prints over time", timeline, 4) +
        card("Today at a glance", `<div class="kpis">${kpis}</div>`, 2) +
        card("Cumulative net premium", cumChart, 2) +
        card("Biggest buys vs sells", buysSells, 2) +
        card("Dark pool timeline", dppOnly, 2) +
        card("Print log · most recent", logBody, 4)
      );
    },
    info: {
      title: "Timeline",
      tagline: "When did the big players buy or sell?",
      sections: [
        {
          h: "What this tab shows",
          p: "<p>The <b>time dimension</b> of whale activity. Instead of totals, it plots every large print against the clock so you can see <b>when</b> institutions leaned in or out during the session.</p>",
        },
        {
          h: "Panels",
          p: "<ul>\
<li><b>Whale timeline</b> — every strike-tick of the session (<code>flow_per_strike_intraday</code>) plotted by time (ET): <span class='pos'>green = call premium</span>, <span class='neg'>red = put premium</span>, dot size = volume. (Individual large tickets in <code>flow_alerts</code> only cover the latest ~100 prints, so the full-session view uses the per-strike tape.)</li>\
<li><b>Today at a glance</b> — print counts and where spot sits vs the gamma flip.</li>\
<li><b>Cumulative net premium</b> — running net premium through the session (rising = money leaning bullish).</li>\
<li><b>Biggest buys vs sells</b> — the largest call buys vs put buys, with ⚡ for sweeps.</li>\
<li><b>Dark pool timeline</b> — off-exchange prints over time (institutional size).</li>\
<li><b>Print log</b> — the most recent large tickets, newest first.</li></ul>",
        },
        {
          h: "How to read it",
          p: "<p>Look for <b>clusters</b>: a burst of large prints at a specific time often marks where a big player acted. A rising cumulative net premium with green dots = accumulation; red dots with a falling line = distribution or hedging.</p>",
        },
        {
          h: "Good to know",
          p: "<ul><li>Times are ET. Only the latest session is shown.</li><li>Premium shows the size of a bet, not its direction — the call/put side and the sweep flag give the intent.</li></ul>",
        },
      ],
    },
  };
})();
