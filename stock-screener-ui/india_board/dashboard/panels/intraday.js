/* Intraday tab — today's session: where it opened, where it flipped, and
 * whether the levels/flow we show elsewhere actually matched the price action.
 *
 * Data (all server-trimmed to the latest session):
 *   ohlc_5m / ohlc_1m      -> candles
 *   stock_state            -> open/high/low/last/prev close
 *   gex_levels             -> call wall, put wall, gamma flip, magnet
 *   max_pain               -> pin target
 *   options_volume         -> session net premium
 *   vol_stats / iv_rank    -> expected move
 *   net_prem_ticks         -> intraday net premium
 *   greek_flow             -> intraday delta/vega flow
 *   nope                   -> intraday hedging pressure
 *   spot_exposures         -> intraday dealer gamma
 *   flow_per_strike_intraday -> where today's money went, by strike
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, int, signCls, table, card, kpiBig, line, multi, candles, bars: barChart } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};
  const NO = '<div class="muted" style="padding:6px">no data</div>';

  // UTC ISO -> "HH:MM" in ET
  function et(iso) {
    const t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
    } catch (e) {
      return String(iso).slice(11, 16);
    }
  }

  // seconds to add to a UTC timestamp so the chart's UTC labels read as ET wall-clock
  function etShiftSec(iso) {
    const t = Date.parse(iso || "");
    if (isNaN(t)) return 0;
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(t));
      const g = (k) => Number(parts.find((p) => p.type === k).value);
      const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
      return Math.round((asUTC - t) / 1000);
    } catch (e) {
      return 0;
    }
  }

  // running VWAP from the session candles
  function vwap(bars) {
    let pv = 0, vv = 0;
    return bars.map((b) => {
      const tp = (n(b.high) + n(b.low) + n(b.close)) / 3;
      const v = n(b.volume) || 0;
      pv += tp * v;
      vv += v;
      return vv ? pv / vv : tp;
    });
  }

  U.PANELS.intraday = {
    title: "Intraday",
    render(d, payload) {
      d = d || {};
      const sym = (payload && payload.ticker) || "";
      const st = first(d.stock_state);
      const gx = first(d.gex_levels);
      const mp = arr(d.max_pain);
      const ov = first(d.options_volume);
      const vs = first(d.vol_stats);
      const ivr = arr(d.iv_rank);
      const bars5 = arr(d.ohlc_5m).filter((r) => n(r.open) != null && n(r.close) != null);
      const bars1 = arr(d.ohlc_1m).filter((r) => n(r.open) != null && n(r.close) != null);
      const bars = bars5.length ? bars5 : bars1;
      const npt = arr(d.net_prem_ticks);
      const nope = arr(d.nope);
      const se = arr(d.spot_exposures);
      const fps = arr(d.flow_per_strike_intraday);

      if (!bars.length && !se.length) return card("Intraday · session", NO, 4);

      const times = bars.map((b) => et(b.start_time || b.end_time));
      const vw = vwap(bars);
      const sessionDate = String(bars.length ? bars[bars.length - 1].start_time || "" : "").slice(0, 10) || String(st.tape_time || "").slice(0, 10);
      const open = n(bars.length ? bars[0].open : st.open);
      const close = n(bars.length ? bars[bars.length - 1].close : st.close);
      const prevClose = n(st.prev_close);
      const hi = bars.length ? Math.max(...bars.map((b) => n(b.high))) : n(st.high);
      const lo = bars.length ? Math.min(...bars.map((b) => n(b.low))) : n(st.low);

      const flip = n(gx.gamma_flip), cw = n(gx.call_wall), pw = n(gx.put_wall);
      const magnet = n(gx.gamma_magnet) || (mp[0] ? n(mp[0].max_pain) : null);

      // ---- flip detection ------------------------------------------------
      const crossings = [];
      if (flip) {
        for (let i = 1; i < bars.length; i++) {
          const a = n(bars[i - 1].close) - flip, b = n(bars[i].close) - flip;
          if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) crossings.push({ i, t: times[i], px: n(bars[i].close), up: b > a });
        }
      }
      const vwapCross = [];
      for (let i = 1; i < bars.length; i++) {
        const a = n(bars[i - 1].close) - vw[i - 1], b = n(bars[i].close) - vw[i];
        if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) vwapCross.push({ i, t: times[i], px: n(bars[i].close), up: b > a });
      }

      // ---- consistency checks -------------------------------------------
      const checks = [];
      if (flip != null && open != null && close != null) {
        const oA = open >= flip, cA = close >= flip, held = oA === cA;
        checks.push({
          k: "Gamma regime",
          ok: held,
          txt: `Opened ${oA ? "above" : "below"} the flip ${flip} and closed ${cA ? "above" : "below"}${held ? ` — regime held (${cA ? "calming" : "amplifying"})` : " — it flipped sides"}.`,
        });
      }
      if (pw != null && lo != null && close != null) {
        const touched = lo <= pw, held = touched && close > pw;
        checks.push({
          k: "Put wall",
          ok: touched ? held : null,
          txt: touched
            ? held
              ? `Tested ${pw} (low ${lo.toFixed(2)}) and held — support worked.`
              : `Broke ${pw} (low ${lo.toFixed(2)}, close ${close.toFixed(2)}).`
            : `Never reached ${pw} (low ${lo.toFixed(2)}) — untested.`,
        });
      }
      if (cw != null && hi != null && close != null) {
        const touched = hi >= cw, rejected = touched && close < cw;
        checks.push({
          k: "Call wall",
          ok: touched ? rejected : null,
          txt: touched
            ? rejected
              ? `Capped at ${cw} (high ${hi.toFixed(2)}) and rejected — resistance worked.`
              : `Broke ${cw} (high ${hi.toFixed(2)}, close ${close.toFixed(2)}).`
            : `Never reached ${cw} (high ${hi.toFixed(2)}) — untested.`,
        });
      }
      if (magnet != null && close != null) {
        const dp = (Math.abs(close - magnet) / close) * 100;
        checks.push({
          k: "Pin / magnet",
          ok: dp < 0.5,
          txt: dp < 0.5 ? `Closed within ${dp.toFixed(2)}% of the magnet ${magnet} — pinned.` : `Closed ${dp.toFixed(2)}% from the magnet ${magnet} — not pinned.`,
        });
      }
      const iv = n(vs.iv) != null ? n(vs.iv) : ivr.length ? n(ivr[ivr.length - 1].volatility) : null;
      if (iv && prevClose && hi != null && lo != null) {
        const expected = (iv / Math.sqrt(252)) * prevClose;
        const range = hi - lo;
        checks.push({
          k: "Expected move",
          ok: range <= expected * 1.5,
          txt: `IV implies a ~$${expected.toFixed(2)} (${((iv / Math.sqrt(252)) * 100).toFixed(2)}%) 1-day move; actual range $${range.toFixed(2)} (${((range / prevClose) * 100).toFixed(2)}%) — ${range <= expected ? "calmer" : "wilder"} than priced.`,
        });
      }
      const ncp = n(ov.net_call_premium);
      if (ncp != null && open != null && close != null) {
        const flowUp = ncp >= 0, priceUp = close >= open, ok = flowUp === priceUp;
        checks.push({
          k: "Flow vs price",
          ok,
          txt: ok
            ? `Net call premium ${flowUp ? "positive" : "negative"} and price ${priceUp ? "rose" : "fell"} — flow and price agree.`
            : `Net call premium ${flowUp ? "positive" : "negative"} but price ${priceUp ? "rose" : "fell"} — divergence (flow didn't lead price).`,
        });
      }

      const tested = checks.filter((c) => c.ok !== null);
      const passed = tested.filter((c) => c.ok).length;
      const verdict = !tested.length
        ? ""
        : passed === tested.length
        ? "Levels and flow described the session well."
        : passed >= tested.length / 2
        ? "Mostly consistent, with some misses."
        : "Weak match — treat these levels with caution.";
      const readBody = checks.length
        ? `<div class="qr" style="padding:5px 8px 2px"><b>${passed}/${tested.length} checks matched.</b> ${verdict}</div>
           <ul class="qr">${checks
             .map((c) => `<li><b class="${c.ok === null ? "muted" : c.ok ? "pos" : "neg"}">${c.ok === null ? "–" : c.ok ? "✓" : "✗"}</b> ${c.txt}</li>`)
             .join("")}</ul>`
        : NO;

      // ---- session map ---------------------------------------------------
      const rng = hi != null && lo != null ? hi - lo || 1 : 1;
      const inRange = (v) => v != null && hi != null && lo != null && v >= lo - rng * 0.08 && v <= hi + rng * 0.08;
      const levelLines = [];
      const addLevel = (v, color, label) => {
        if (inRange(v)) levelLines.push({ value: v, color, label: label + " " + v });
      };
      addLevel(open, "#94a3b8", "open");
      addLevel(prevClose, "#64748b", "prev close");
      addLevel(flip, "#a855f7", "flip");
      addLevel(cw, "#dc2626", "call wall");
      addLevel(pw, "#16a34a", "put wall");
      addLevel(magnet, "#f59e0b", "magnet");
      const etShift = bars.length ? etShiftSec(bars[0].start_time) : 0;
      const candleMarkers = crossings.map((c) => ({ time: bars[c.i].start_time, up: c.up, color: c.up ? "#16a34a" : "#dc2626" }));

      // ---- exit signals: FRESH breakdowns under VWAP on heavy volume -------
      // (the "get out of longs" print — e.g. SNDK 9:45 closed $22 under VWAP
      // on the biggest volume of the morning). Thresholds scale with price.
      // Two guards against false positives like MRNA 9/25 (gap-down open that
      // recovered): skip the opening flush (VWAP is unstable before 9:45 ET),
      // and require a *fresh* breakdown — one of the previous 2 bars must have
      // closed above VWAP.
      const vols = bars.map((b) => n(b.volume) || 0);
      const medVol = vols.length ? vols.slice().sort((a, b) => a - b)[Math.floor(vols.length / 2)] : 0;
      const exits = [];
      for (let i = 1; i < bars.length; i++) {
        const c = n(bars[i].close), v = vw[i];
        if (c == null || v == null) continue;
        const under = v - c;
        if (under < Math.max(0.004 * c, 0.05)) continue;
        if ((vols[i] || 0) < Math.max(2 * medVol, 1)) continue;
        const hm = String(times[i] || "").match(/(\d+):(\d+)/);
        if (hm && +hm[1] * 60 + +hm[2] < 585) continue; // before 9:45 ET
        let fresh = false;
        for (let k = Math.max(0, i - 2); k < i; k++) {
          const pc = n(bars[k].close);
          if (pc != null && vw[k] != null && pc >= vw[k]) {
            fresh = true;
            break;
          }
        }
        if (!fresh) continue;
        exits.push({ i, t: times[i], px: c, vwap: v, under, vol: vols[i], mult: medVol ? vols[i] / medVol : 0 });
      }
      exits.forEach((x) => candleMarkers.push({ time: bars[x.i].start_time, up: false, color: "#f59e0b", text: "exit" }));
      const mapChart =
        `<div class="tv-cap"><b>${esc(sym)}</b> · 5m · ${esc(sessionDate)} <span class="muted">ET</span></div>` +
        candles(bars, {
          height: 330,
          x: bars.map((b) => b.start_time),
          timeVisible: true,
          tzShift: etShift,
          levels: levelLines,
          overlays: [{ name: "VWAP", color: "#22d3ee", data: vw }],
          markers: candleMarkers,
        }) +
        `<div class="legend"><span><i style="background:#22d3ee"></i>VWAP</span>${levelLines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join("")}</div>`;

      // ---- open vs levels ------------------------------------------------
      const vwapLast = vw.length ? vw[vw.length - 1] : null;
      const kpis =
        kpiBig("Open", open != null ? open.toFixed(2) : "–", prevClose != null ? "prev " + prevClose.toFixed(2) : "", signCls(open != null && prevClose != null ? open - prevClose : null)) +
        kpiBig("Gap", open != null && prevClose ? (((open - prevClose) / prevClose) * 100).toFixed(2) + "%" : "–", "", signCls(open - prevClose)) +
        kpiBig("Session", open != null ? open.toFixed(2) + " → " + close.toFixed(2) : "–", "range " + (hi != null ? (hi - lo).toFixed(2) : "–"), signCls(open != null && close != null ? close - open : null)) +
        kpiBig("vs flip", flip != null && open != null ? (open >= flip ? "above" : "below") + " open" : "–", flip != null ? "flip " + flip : "", signCls(flip != null && open != null ? open - flip : null)) +
        kpiBig("High / Low", hi != null ? hi.toFixed(2) + " / " + lo.toFixed(2) : "–", "") +
        kpiBig("VWAP", vw.length ? vw[vw.length - 1].toFixed(2) : "–", close != null && vw.length ? (close >= vw[vw.length - 1] ? "above close" : "below close") : "", signCls(close != null && vwapLast != null ? close - vwapLast : null));

      // ---- flip log ------------------------------------------------------
      const flips = [
        ...crossings.map((c) => ({ t: c.t, ev: "gamma flip", px: c.px, up: c.up })),
        ...vwapCross.map((c) => ({ t: c.t, ev: "VWAP", px: c.px, up: c.up })),
      ].sort((a, b) => (a.t < b.t ? -1 : 1));
      const flipBody = flips.length
        ? table(
            [{ label: "Time" }, { label: "Level" }, { label: "Dir" }, { label: "Price", num: true }],
            flips,
            (r) => `<tr><td>${esc(r.t)}</td><td>${esc(r.ev)}</td><td class="${r.up ? "pos" : "neg"}">${r.up ? "▲ up" : "▼ down"}</td><td class="num">${r.px != null ? r.px.toFixed(2) : "–"}</td></tr>`
          )
        : NO;

      // ---- exit signals --------------------------------------------------
      const exitBody = exits.length
        ? table(
            [{ label: "Time" }, { label: "Close", num: true }, { label: "VWAP", num: true }, { label: "Under", num: true }, { label: "Vol ×", num: true }],
            exits,
            (r) =>
              `<tr><td>${esc(r.t)}</td><td class="num neg">${r.px != null ? r.px.toFixed(2) : "–"}</td><td class="num muted">${r.vwap != null ? r.vwap.toFixed(2) : "–"}</td><td class="num neg">−$${r.under != null ? r.under.toFixed(2) : "–"}</td><td class="num warn">${r.mult ? r.mult.toFixed(1) + "x" : "–"}</td></tr>`
          )
        : '<div class="muted" style="padding:6px">no VWAP-breakdown prints today</div>';

      // ---- level report --------------------------------------------------
      const reportBody = checks.length
        ? table(
            [{ label: "Check" }, { label: "" }, { label: "What happened" }],
            checks,
            (c) => `<tr><td>${esc(c.k)}</td><td class="${c.ok === null ? "muted" : c.ok ? "pos" : "neg"}">${c.ok === null ? "–" : c.ok ? "✓" : "✗"}</td><td class="muted">${c.txt}</td></tr>`
          )
        : NO;

      // ---- flow vs price -------------------------------------------------
      const nptTimes = npt.map((r) => et(r.tape_time || r.date));
      const flowChart = npt.length
        ? multi(
            [
              { name: "Net call prem", color: "#16a34a", data: npt.map((r) => n(r.net_call_premium) || 0) },
              { name: "Net put prem", color: "#dc2626", data: npt.map((r) => n(r.net_put_premium) || 0) },
            ],
            { height: 150, x: nptTimes, axis: true }
          )
        : NO;

      // ---- intraday dealer gamma ----------------------------------------
      const seTimes = se.map((r) => et(r.time || r.start_time));
      const gammaChart = se.length
        ? line(se.map((r) => n(r.gamma_per_one_percent_move_dir) || 0), { height: 160, x: seTimes, axis: true, stroke: "#a855f7", fill: "#a855f7" })
        : NO;

      // ---- money by strike ----------------------------------------------
      const byStrike = {};
      fps.forEach((r) => {
        const s = r.strike;
        if (s == null) return;
        byStrike[s] = (byStrike[s] || 0) + (n(r.net_premium) || 0);
      });
      const strikeRows = Object.entries(byStrike)
        .map(([k, v]) => ({ strike: k, net: v }))
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
        .slice(0, 12);
      const strikeBody = strikeRows.length
        ? barChart(strikeRows.map((r) => ({ label: r.strike, value: r.net })), { height: 150, signed: true }) +
          `<div class="muted" style="padding:0 6px 4px">net premium by strike today · top ${strikeRows.length}</div>`
        : NO;

      // ---- NOPE ----------------------------------------------------------
      const nopeChart = nope.length
        ? line(nope.map((r) => n(r.nope_fill) || n(r.nope) || 0), { height: 140, x: nope.map((r) => et(r.timestamp)), axis: true, stroke: "#a855f7", fill: "#a855f7" })
        : NO;

      return (
        card("Session read · does it make sense", readBody, 4) +
        card("Session map · " + esc(sessionDate) + " (5m)", mapChart, 4) +
        card("Open vs levels", `<div class="kpis">${kpis}</div>`, 2) +
        card("Flip log · gamma & VWAP crosses", flipBody, 2) +
        card("Exit signals · VWAP breakdown", exitBody, 2) +
        card("Level report", reportBody, 2) +
        card("Flow vs price · net premium", flowChart, 2) +
        card("Intraday dealer gamma", gammaChart, 2) +
        card("Money by strike · intraday", strikeBody, 2) +
        card("NOPE · intraday hedging", nopeChart, 2)
      );
    },
    info: {
      title: "Intraday",
      tagline: "Today's session — where it opened, where it flipped, and whether our levels matched",
      sections: [
        {
          h: "What this tab shows",
          p: "<p>A validation view for the <b>current session</b>. It plots the intraday price against the levels we quote elsewhere (call wall, put wall, gamma flip, magnet, max pain, VWAP) and then checks, in plain English, whether those levels and the options flow actually described what price did.</p>",
        },
        {
          h: "Panels",
          p: "<ul>\
<li><b>Session read</b> — auto-generated verdict: <b>N/M checks matched</b> plus one sentence per check (✓/✗).</li>\
<li><b>Session map</b> — 5-minute price with VWAP and horizontal level lines; ▲/▼ mark every time price crossed the gamma flip.</li>\
<li><b>Open vs levels</b> — open, gap vs prior close, session range, which side of the flip it opened, high/low and where VWAP closed.</li>\
<li><b>Flip log</b> — every crossing of the gamma-flip level and of VWAP (momentum flips), with time and direction.</li>\
<li><b>Exit signals</b> — 5-minute candles that <b>broke down</b> through VWAP (close ≥0.4% under, 2x median volume, after trading above it; pre-9:45 ET opening flush ignored), with the amber ▼ marker on the session map.</li>\
<li><b>Level report</b> — did the put wall hold, the call wall reject, price pin to the magnet, the range stay inside the IV-implied move, and did flow agree with price?</li>\
<li><b>Flow vs price</b> — intraday net call/put premium (<code>net_prem_ticks</code>).</li>\
<li><b>Intraday dealer gamma</b> — <code>gamma_per_one_percent_move_dir</code> through the session (<code>spot_exposures</code>).</li>\
<li><b>Money by strike</b> — net premium per strike today (<code>flow_per_strike_intraday</code>): where the money actually went.</li>\
<li><b>NOPE</b> — intraday net options pricing effect / hedging pressure.</li></ul>",
        },
        {
          h: "How to read it",
          p: "<p>Use it as a <b>scorecard</b>: if the levels matched (walls held, regime held, flow agreed), the levels are trustworthy on this name today. If the score is low, the tape is ignoring the options map — trust price over the levels.</p>",
        },
        {
          h: "Good to know",
          p: "<ul><li>Shows the <b>latest session</b> — on weekends/holidays it displays the most recent trading day.</li><li>Times are ET. Default candle size is 5 minutes.</li><li>One-day expected move = annualised IV ÷ √252.</li></ul>",
        },
      ],
    },
  };
})();
