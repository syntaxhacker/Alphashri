/* Today tab — one-screen daily cockpit: levels strip · 5m chart · exposure
 * heatmap · a "what to look at today" checklist. Built to fit a viewport,
 * every card scrolls internally and never truncates data.
 *
 * Payload = the symbol group "today" (see symbol_data.py), keys:
 *   stock_state    {close, open, high, low, prev_close, volume, market_time}
 *   gex_levels     {call_wall, put_wall, gamma_flip, gamma_magnet, nearby_flips[]}
 *   max_pain       [{expiry, max_pain, close}]
 *   options_volume [{net_call_premium, net_put_premium, call_volume, put_volume, ...}]
 *   iv_rank        [{volatility, iv_rank_1y, ...}]
 *   vol_stats      {iv, iv_rank, ...}
 *   ohlc_5m        [{start_time, open, high, low, close, volume}]  (last session)
 *   net_prem_ticks [{tape_time, net_call_premium, net_put_premium}]
 *   gex_matrix     {spot, expiries[], strikes[], cells:[{e,k,gex,delta,charm,vanna}]}
 *
 * Stable IDs (targeted by the tour): #td-strip #td-chart #td-heat #td-brief
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, signCls, card, kpiBig, candles, matrix } = U.util;

  const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};
  const NO = '<div class="muted" style="padding:6px">no data for this section — nothing was returned for this symbol/session.</div>';

  // ---- live ticks (UW.stream) --------------------------------------------
  // Best-effort: if the stream client isn't present we leave static values.
  const FLASH_STYLE_ID = "uw-tick-flash-style";

  function ensureFlashStyle() {
    if (typeof document === "undefined" || document.getElementById(FLASH_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = FLASH_STYLE_ID;
    s.textContent =
      "@keyframes uwTickUp{from{background:rgba(22,163,74,.38)}to{background:transparent}}" +
      "@keyframes uwTickDown{from{background:rgba(220,38,38,.38)}to{background:transparent}}" +
      ".td-up{animation:uwTickUp .7s ease-out;border-radius:3px}" +
      ".td-down{animation:uwTickDown .7s ease-out;border-radius:3px}";
    (document.head || document.documentElement).appendChild(s);
  }

  function flash(el, dir) {
    if (!el || !dir) return;
    const cls = dir > 0 ? "td-up" : "td-down";
    el.classList.remove("td-up", "td-down");
    void el.offsetWidth; // restart the animation on a rapid tick
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 700);
  }

  function stopStripStream() {
    if (typeof U.tdStripStop === "function") {
      try {
        U.tdStripStop();
      } catch {
        /* ignore */
      }
    }
    U.tdStripStop = null;
  }

  function updateStripQuote(root, q) {
    if (!root || !q) return;
    const lastEl = root.querySelector("#td-last .kpi-v");
    const dayEl = root.querySelector("#td-day .kpi-v");
    const last = n(q.last);
    const prev = n(q.prev_close);
    let chg = n(q.chg_pct);
    if (chg == null && last != null && prev) chg = ((last - prev) / prev) * 100;

    if (last != null && lastEl) {
      const text = last.toFixed(2);
      const shown = n(lastEl.dataset.v) != null ? n(lastEl.dataset.v) : n(lastEl.textContent);
      if (lastEl.textContent !== text) {
        lastEl.textContent = text;
        const dir = shown != null ? Math.sign(last - shown) : chg != null ? Math.sign(chg) : 0;
        flash(lastEl, dir);
      }
      lastEl.dataset.v = String(last);
    }
    if (chg != null && dayEl) {
      const text = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
      if (dayEl.textContent !== text) {
        dayEl.textContent = text;
        flash(dayEl, Math.sign(chg));
      }
      dayEl.classList.remove("pos", "neg", "muted");
      dayEl.classList.add(signCls(chg));
    }
  }

  function startStripStream(root, ticker) {
    if (!(U.stream && typeof U.stream.quote === "function")) return;
    ensureFlashStyle();
    try {
      const stop = U.stream.quote(ticker, (q) => updateStripQuote(root, q));
      if (typeof stop === "function") U.tdStripStop = stop;
    } catch {
      /* stream is best-effort */
    }
  }

  // kpiBig with a stable id on the wrapper so live ticks can find it
  const kpiId = (id, label, value, sub, cls) =>
    kpiBig(label, value, sub, cls).replace('<div class="kpi"', `<div class="kpi" id="${id}"`);

  const NEAR = 0.004; // 0.4% — spot "at" a level
  const CHART_BAND = 0.12; // level lines beyond ±12% of last squish the chart
  const HEAT_H = 360;
  const METRICS = [
    { id: "gex", label: "GEX", sym: "Γ" },
    { id: "vanna", label: "VEX", sym: "V" },
    { id: "delta", label: "Delta", sym: "Δ" },
    { id: "charm", label: "Charm", sym: "C" },
  ];
  const LVL_COLOR = {
    call_wall: "#dc2626",
    put_wall: "#16a34a",
    gamma_flip: "#a855f7",
    gamma_magnet: "#f59e0b",
    max_pain: "#38bdf8",
  };

  let metric = "gex";

  // seconds to add so the candle chart's UTC labels read as ET wall-clock
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

  function fmtGex(v) {
    if (v == null) return "·";
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    if (a >= 1) return v.toFixed(0);
    if (a === 0) return "0";
    return v.toFixed(2);
  }

  // OI-based reads (dealer levels / exposure heatmap) refresh ~once/day, so tag
  // them with their as-of time — they sit right next to the live price and are
  // easy to mistake for it. Falls back to the ~06:45 ET OI snapshot.
  function asOfNote(gx, m) {
    gx = gx || {};
    m = m || {};
    const date = String(gx.date || m.date || "").trim();
    const rawTime = gx.time || m.time;
    const time = rawTime ? U.util.et(rawTime) : "";
    const stamp = [date, time].filter(Boolean).join(" ");
    return `<div class="wl-note">as of ${esc(stamp || "~06:45")} ET · OI-based</div>`;
  }

  // simple bias: options flow sign + gamma regime + day direction.
  // Flow is the DIRECTIONAL net premium (net calls − net puts): put buying is
  // bearish, so the two must be subtracted, never added.
  function bias(st, gx, ov) {
    let s = 0, k = 0;
    const ncp = n(ov.net_call_premium), npp = n(ov.net_put_premium);
    if (ncp != null || npp != null) {
      s += (ncp || 0) - (npp || 0) >= 0 ? 1 : -1;
      k++;
    }
    const close = n(st.close), flip = n(gx.gamma_flip);
    if (close != null && flip != null) {
      s += close >= flip ? 1 : -1;
      k++;
    }
    const pc = n(st.prev_close);
    if (close != null && pc != null) {
      s += close >= pc ? 1 : -1;
      k++;
    }
    if (!k) return { label: "—", cls: "mix" };
    if (s >= 2) return { label: "Bullish", cls: "bull" };
    if (s <= -2) return { label: "Bearish", cls: "bear" };
    return { label: "Mixed", cls: "mix" };
  }

  // ordered dealer levels (call wall, put wall, flip, magnet, max pain)
  function levelsOf(gx, mp) {
    const out = [];
    const add = (key, label, v) => {
      const x = n(v);
      if (x != null) out.push({ key, label, value: x, color: LVL_COLOR[key] || "#64748b" });
    };
    add("call_wall", "Call wall", gx.call_wall);
    add("put_wall", "Put wall", gx.put_wall);
    add("gamma_flip", "Flip", gx.gamma_flip);
    add("gamma_magnet", "Magnet", gx.gamma_magnet);
    add("max_pain", "Max pain", first(mp).max_pain);
    return out;
  }

  function levelChip(l, close) {
    const dp = close ? ((l.value - close) / close) * 100 : null;
    const near = dp != null && Math.abs(dp) <= NEAR * 100;
    return (
      `<span class="td-lv" data-lv="${esc(l.key)}" style="display:inline-flex;align-items:center;gap:5px;padding:1px 7px;border:1px solid ${near ? "var(--accent)" : "var(--border)"};border-radius:3px;background:var(--panel2);font-size:10px;white-space:nowrap">` +
      `<i style="width:6px;height:6px;border-radius:50%;background:${l.color};flex:0 0 auto"></i>` +
      `<span class="muted">${esc(l.label)}</span>` +
      `<b style="font-variant-numeric:tabular-nums">${l.value.toFixed(2)}</b>` +
      `<span class="${signCls(dp)}" style="font-variant-numeric:tabular-nums">${dp == null ? "" : (dp >= 0 ? "+" : "") + dp.toFixed(2) + "%"}</span>` +
      (near ? '<span title="spot within 0.4% of this level">⚡</span>' : "") +
      `</span>`
    );
  }

  function stripHtml(st, gx, ov, mp, vs, ivr) {
    const close = n(st.close);
    const prev = n(st.prev_close);
    const ncp = n(ov.net_call_premium);
    const npp = n(ov.net_put_premium);
    // directional net premium = net calls − net puts (put buying is bearish)
    const netPrem = ncp != null || npp != null ? (ncp || 0) - (npp || 0) : null;
    const ivVal = U.util.ivPct(n(vs.iv) != null ? n(vs.iv) : ivr.length ? n(ivr[ivr.length - 1].volatility) : null);
    const ivRank = n(vs.iv_rank) != null ? n(vs.iv_rank) : ivr.length ? n(ivr[ivr.length - 1].iv_rank_1y) : null;
    const dayPct = close != null && prev ? ((close - prev) / prev) * 100 : null;
    const hi = n(st.high), lo = n(st.low);
    // em needs annualised IV as a fraction (÷100) regardless of the feed's scale
    const em = ivVal != null && prev ? (ivVal / 100 / Math.sqrt(252)) * prev : null;
    const b = bias(st, gx, ov);

    const kpis =
      kpiId("td-last", "Last", close != null ? close.toFixed(2) : "–", prev != null ? "prev " + prev.toFixed(2) : "", signCls(close != null && prev ? close - prev : null)) +
      kpiId("td-day", "Day", dayPct != null ? (dayPct >= 0 ? "+" : "") + dayPct.toFixed(2) + "%" : "–", hi != null && lo != null ? "range " + (hi - lo).toFixed(2) : "", signCls(dayPct)) +
      kpiBig("IV", ivVal != null ? ivVal.toFixed(1) + "%" : "–", ivRank != null ? "rank " + ivRank.toFixed(1) + "%" : "", "") +
      kpiBig("Net premium", netPrem != null ? money(netPrem) : "–", ncp != null && npp != null ? "call " + money(ncp) + " · put " + money(npp) : "call − put", signCls(netPrem)) +
      kpiBig("Exp. move", em != null ? "$" + em.toFixed(2) : "–", em != null && close ? "±" + ((em / close) * 100).toFixed(2) + "% 1d" : "IV-derived", "") +
      kpiBig("Bias", `<span class="chip ${b.cls}">${esc(b.label)}</span>`, gx.gamma_flip != null ? "flip " + n(gx.gamma_flip).toFixed(2) : "", "");

    const levels = levelsOf(gx, mp);
    const chips = close != null ? levels.map((l) => levelChip(l, close)).join("") : "";
    const nf = arr(gx.nearby_flips)
      .map((v) => n(v))
      .filter((v) => v != null && close != null && Math.abs(v - close) / close <= 0.06);
    const nearFlips = nf.length
      ? `<div class="muted" style="padding:0 8px 5px;font-size:9px">nearby flips: ${nf.slice(0, 6).map((v) => v.toFixed(2)).join(" · ")}</div>`
      : "";

    return (
      `<div id="td-strip">` +
      `<div class="kpis">${kpis}</div>` +
      (chips ? `<div style="display:flex;flex-wrap:wrap;gap:5px;padding:0 6px 5px">${chips}</div>` : "") +
      nearFlips +
      asOfNote(gx) +
      `</div>`
    );
  }

  function chartHtml(st, gx, mp, bars, sym) {
    const close = n(st.close);
    const open = n(bars.length ? bars[0].open : st.open);
    const prev = n(st.prev_close);
    const sessionDate = String(bars.length ? bars[bars.length - 1].start_time || "" : "").slice(0, 10);
    const inBand = (v) => v != null && close != null && Math.abs(v - close) / close <= CHART_BAND;

    const lines = [];
    const add = (v, color, label) => {
      if (inBand(v)) lines.push({ value: v, color, label: label + " " + v.toFixed(2) });
    };
    add(open, "#94a3b8", "open");
    add(prev, "#64748b", "prev close");
    levelsOf(gx, mp).forEach((l) => add(l.value, l.color, l.label.toLowerCase()));

    const shift = bars.length ? etShiftSec(bars[0].start_time) : 0;
    const chart = bars.length
      ? candles(bars, { height: 300, x: bars.map((b) => b.start_time), timeVisible: true, tzShift: shift, levels: lines })
      : NO;

    return (
      `<div id="td-chart">` +
      `<div class="tv-cap"><b>${esc(sym)}</b> · 5m · ${esc(sessionDate)} <span class="muted">ET</span>` +
      `<span class="muted" style="float:right">lines: open · prev close · dealer levels</span></div>` +
      chart +
      (lines.length ? `<div class="legend">${lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join("")}</div>` : "") +
      `</div>`
    );
  }

  function heatMatrixHtml(m) {
    const idx = {};
    (m.cells || []).forEach((c) => {
      idx[c.e + "|" + c.k] = c;
    });
    const spot = n(m.spot);
    let near = null;
    if (spot != null) {
      let bd = Infinity;
      (m.strikes || []).forEach((k) => {
        const dd = Math.abs(Number(k) - spot);
        if (dd < bd) {
          bd = dd;
          near = Number(k);
        }
      });
    }
    return matrix({
      rows: m.strikes || [],
      cols: m.expiries || [],
      get: (k, e) => {
        const c = idx[e + "|" + k];
        return c ? n(c[metric]) : null;
      },
      fmt: fmtGex,
      height: HEAT_H,
      corner: "strike",
      colFmt: (e) => String(e).slice(5),
      rowFmt: (k) => Number(k).toFixed(2) + (Number(k) === near ? " ◀" : ""),
    });
  }

  function heatControlsHtml(m) {
    const spot = n(m.spot);
    return (
      `<div class="presets" id="td-hctrl" style="gap:4px;padding:3px 6px;align-items:center">` +
      `<span class="muted" style="font-size:9px;text-transform:uppercase;letter-spacing:.4px">metric</span>` +
      METRICS.map((x) => `<button class="preset ${x.id === metric ? "on" : ""}" data-tdhm="${x.id}">${x.label} <span class="muted">${x.sym}</span></button>`).join("") +
      `<span class="muted" style="margin-left:auto;font-size:9.5px">spot ${spot != null ? spot.toFixed(2) : "–"} · ${(m.strikes || []).length} strikes × ${(m.expiries || []).length} expiries</span>` +
      `</div>`
    );
  }

  function heatHtml(m, gx) {
    return `<div id="td-heat">${heatControlsHtml(m)}<div id="td-hwrap">${heatMatrixHtml(m)}</div></div>` + asOfNote(gx, m);
  }

  // per-expiry sum of |gex| — a proxy for front-expiry vs next concentration
  function expiryGex(m) {
    const sum = {};
    (m.expiries || []).forEach((e) => (sum[e] = 0));
    (m.cells || []).forEach((c) => {
      const g = n(c.gex);
      if (g != null && sum[c.e] != null) sum[c.e] += Math.abs(g);
    });
    return sum;
  }

  function briefHtml(d, st, gx, ov, mp, vs, ivr, bars) {
    const close = n(st.close);
    const prev = n(st.prev_close);
    const flip = n(gx.gamma_flip);
    const items = [];

    if (close != null && flip != null) {
      const above = close >= flip;
      items.push({
        k: "Gamma regime",
        ok: above,
        txt: `Spot ${close.toFixed(2)} is <b>${above ? "above" : "below"}</b> the flip ${flip.toFixed(2)} — dealers ${above ? "dampen moves (calm / mean-reverting)" : "amplify moves (trend can accelerate)"}.`,
      });
    }

    const lv = levelsOf(gx, mp);
    if (close != null && lv.length) {
      let best = null;
      lv.forEach((l) => {
        const dp = Math.abs(l.value - close) / close;
        if (!best || dp < best.dp) best = { l, dp };
      });
      const near = lv.filter((l) => Math.abs(l.value - close) / close <= NEAR);
      items.push({
        k: "At a level",
        ok: near.length > 0,
        txt: near.length
          ? `Spot is within <b>0.4%</b> of ${near.map((l) => `${esc(l.label)} ${l.value.toFixed(2)}`).join(", ")} — watch for a reaction / pin here.`
          : `Nearest level is <b>${esc(best.l.label)} ${best.l.value.toFixed(2)}</b>, ${(best.dp * 100).toFixed(2)}% away — nothing directly overhead.`,
      });
    }

    const ncp = n(ov.net_call_premium);
    const npp = n(ov.net_put_premium);
    const netPrem = ncp != null || npp != null ? (ncp || 0) - (npp || 0) : null;
    if (netPrem != null) {
      const parts = [];
      if (ncp != null) parts.push("call " + money(ncp));
      if (npp != null) parts.push("put " + money(npp));
      items.push({
        k: "Net premium",
        ok: netPrem >= 0,
        txt: `Directional net premium is <b>${netPrem >= 0 ? "positive" : "negative"}</b> (${money(netPrem)}${parts.length ? `, ${parts.join(" · ")}` : ""}) — options flow leans <b>${netPrem >= 0 ? "bullish" : "bearish"}</b>.`,
      });
    }

    const m = d.gex_matrix;
    if (m && arr(m.expiries).length >= 2) {
      const sum = expiryGex(m);
      const e0 = m.expiries[0], e1 = m.expiries[1];
      const g0 = sum[e0] || 0, g1 = sum[e1] || 0;
      const tot = g0 + g1;
      if (tot > 0) {
        const share = (g0 / tot) * 100;
        items.push({
          k: "Front expiry",
          ok: g0 >= g1,
          txt: `Front expiry <b>${esc(String(e0).slice(5))}</b> carries <b>${share.toFixed(0)}%</b> of the near-dated |GEX| (${fmtGex(g0)} vs ${fmtGex(g1)} on ${esc(String(e1).slice(5))}) — ${g0 >= g1 ? "front-loaded, expect pinning near front strikes" : "back-weighted, positioning sits further out"}.`,
        });
      }
    }

    const ivVal = U.util.ivPct(n(vs.iv) != null ? n(vs.iv) : ivr.length ? n(ivr[ivr.length - 1].volatility) : null);
    const hi = n(st.high), lo = n(st.low);
    if (ivVal != null && prev && hi != null && lo != null) {
      const em = (ivVal / 100 / Math.sqrt(252)) * prev;
      const range = hi - lo;
      items.push({
        k: "Range vs implied",
        ok: range <= em,
        txt: `Session range $${range.toFixed(2)} vs IV-implied ~$${em.toFixed(2)} — trading <b>${range <= em ? "inside" : "wider than"}</b> priced (${((range / prev) * 100).toFixed(2)}% vs ${(ivVal / Math.sqrt(252)).toFixed(2)}%).`,
      });
    }

    const mpv = n(first(mp).max_pain);
    if (close != null && mpv != null) {
      const dp = Math.abs(close - mpv) / close;
      items.push({
        k: "Max pain",
        ok: dp <= 0.005,
        txt: `Max pain ${mpv.toFixed(2)} is ${(dp * 100).toFixed(2)}% from spot — ${dp <= 0.005 ? "pinned, expiry magnet in play" : "not pinning yet"}.`,
      });
    }

    if (!items.length) return `<div id="td-brief">${NO}</div>`;

    const tested = items.filter((i) => i.ok !== null);
    const passed = tested.filter((i) => i.ok).length;
    const head = `<div class="qr" style="padding:5px 8px 2px"><b>${passed}/${tested.length} flags.</b> ${passed >= tested.length - 1 ? "Setup is clean — trade the levels." : passed >= tested.length / 2 ? "Mixed tape — size down, confirm with price." : "Levels are being ignored — trust price over the map."}</div>`;
    const list = `<ul class="qr" style="column-count:2;column-gap:18px">${items
      .map((i) => `<li><b class="${i.ok === null ? "muted" : i.ok ? "pos" : "neg"}">${i.ok === null ? "–" : i.ok ? "✓" : "✗"}</b> ${i.txt}</li>`)
      .join("")}</ul>`;
    return `<div id="td-brief">${head}${list}</div>`;
  }

  U.PANELS.today = {
    title: "Today",
    render(d, payload) {
      d = d || {};
      const sym = (payload && payload.ticker) || "";
      const st = first(d.stock_state);
      const gx = first(d.gex_levels);
      const ov = first(d.options_volume);
      const mp = arr(d.max_pain);
      const vs = first(d.vol_stats);
      const ivr = arr(d.iv_rank);
      const bars = arr(d.ohlc_5m).filter((r) => n(r.open) != null && n(r.close) != null);

      return (
        card("Levels strip · last · IV · flow · dealer levels", stripHtml(st, gx, ov, mp, vs, ivr), 4) +
        card("Today · 5m price", chartHtml(st, gx, mp, bars, sym), 2) +
        card("Exposure heatmap · strike × expiry", heatHtml(d.gex_matrix || {}, gx), 2) +
        card("What to look at today", briefHtml(d, st, gx, ov, mp, vs, ivr, bars), 4)
      );
    },
    afterRender(pane, ticker, payload) {
      if (!pane) return;
      stopStripStream();
      const d = (payload && payload.data) || {};
      const m = d.gex_matrix;
      const heat = pane.querySelector("#td-heat");
      if (heat && m && arr(m.strikes).length) {
        const paint = () => {
          heat.innerHTML = heatControlsHtml(m) + `<div id="td-hwrap">${heatMatrixHtml(m)}</div>`;
          heat.querySelectorAll("[data-tdhm]").forEach((b) => {
            b.onclick = () => {
              metric = b.dataset.tdhm;
              paint();
            };
          });
          centerHeat(heat);
        };
        paint();
      }
      // Charts: the host (symbol.js) calls U.charts.mount(pane) right after every
      // panel's afterRender, and mount() is destructive (it disposes live
      // instances first). So mount here only if nothing is built yet — deferred a
      // tick so the host's mount can win — which keeps this panel working
      // standalone without blanking the chart when embedded.
      if (U.charts) {
        setTimeout(() => {
          if (!pane.isConnected) return;
          const unbuilt = [...pane.querySelectorAll(".cx[data-cx]")].some((el) => !el.firstChild);
          if (unbuilt) U.charts.mount(pane);
          U.charts.resizeAll();
        }, 0);
      }
      startStripStream(pane, ticker);
    },
    info: {
      title: "Today",
      tagline: "One-screen daily view: levels · chart · heatmap",
      sections: [
        {
          h: "What this tab shows",
          p: "<p>The <b>daily cockpit</b> — the four things that explain a name today, stacked in one screen:</p><ul>\
<li><b>Levels strip</b> — last, day %, IV / IV rank, net premium, IV-implied expected move, a <b>bias chip</b> (flow sign + gamma regime + day direction), then every dealer level (call wall, put wall, flip, magnet, max pain) with its distance from spot. <b>⚡</b> means spot is within <b>0.4%</b> of that level.</li>\
<li><b>Intraday chart</b> — the last session's <b>5-minute candles</b> with horizontal lines for the open, prior close and the dealer levels (labels on the right axis).</li>\
<li><b>Exposure heatmap</b> — strike × expiry dealer exposure, switchable between <b>GEX / VEX / Delta / Charm</b>. <b>◀</b> marks the strike nearest spot and the view opens centred on it.</li>\
<li><b>What to look at today</b> — an auto-generated checklist (✓/✗) with one line of guidance per check.</li></ul>",
        },
        {
          h: "Check these first (tour script)",
          p: "<ol>\
<li><b>Bias chip</b> (top of the levels strip): Bullish / Bearish / Mixed — the one-glance summary of flow + regime + day direction.</li>\
<li><b>Any ⚡ in the strip</b>: spot is sitting on a dealer level right now — those are the levels most likely to act.</li>\
<li><b>Which side of the flip</b> (purple line on the chart, and the first line of the checklist): above = calm / mean-reverting, below = moves can accelerate.</li>\
<li><b>Net premium sign</b>: does options flow agree with price direction?</li>\
<li><b>Front expiry</b> in the checklist: is gamma front-loaded (pinning) or back-weighted?</li>\
<li><b>Range vs implied move</b>: is the session calmer or wilder than what IV priced?</li>\
<li>Finally, scan the <b>exposure heatmap</b> for a bright <b>vertical wall</b> — a strike loaded across expiries is a strong pin/hedge magnet.</li></ol>",
        },
        {
          h: "How each block reads",
          p: "<p><b>Strip KPIs</b>: <i>Exp. move</i> is one-day IV-implied move (annualised IV ÷ √252 × prev close). <i>Net premium</i> is <b>directional</b> (net call premium − net put premium; put buying is bearish, so the two are subtracted, never added); the sub-line shows the call and put components. Level chips are colour-coded by level and by whether they sit above (green) or below (red) spot.</p><p><b>Chart</b>: level lines are drawn only within ±12% of the last price so a far-away wall can't squish the candles — every level is still listed in the strip and the heatmap. Times are ET.</p><p><b>Heatmap</b>: cells are net dealer exposure; <span class='pos'>green = positive</span>, <span class='neg'>red = negative</span>, intensity ∝ magnitude. The full strike ladder and every expiry are always shown — the card scrolls, it never truncates.</p><p><b>Checklist</b>: each row is a boolean fact with guidance, not a prediction.</p>",
        },
        {
          h: "Caveats",
          p: "<ul><li>Pre-market and just after the open, option volume / net premium can still be zero or null — the strip and checklist degrade gracefully instead of showing zeros as signals.</li><li>The <code>today</code> payload's <code>ohlc_5m</code> and <code>gex_levels</code> are the <b>latest session</b> (yesterday's on weekends / pre-market).</li><li>Dealer-exposure signs are provider-defined — treat them as positioning, not a forecast.</li><li><b>Front expiry</b> concentration is a proxy: the sum of |GEX| per expiry, not traded volume.</li></ul>",
        },
      ],
    },
  };

  function centerHeat(root) {
    const sc = root.querySelector(".hm-wrap") || root.querySelector("#td-hwrap");
    if (!sc) return;
    const tr = [...root.querySelectorAll("tbody tr")].find((r) => r.textContent.indexOf("◀") >= 0);
    if (!tr) return;
    const delta = tr.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    sc.scrollTop = Math.max(0, sc.scrollTop + delta - sc.clientHeight / 2);
  }
})();
