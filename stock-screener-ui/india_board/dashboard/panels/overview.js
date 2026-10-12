/* Overview tab — price, key stats, gamma, max pain, IV rank, volume. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, pct, rawpct, signCls, table, card, kpiBig, candles, line, bars } = U.util;
  const err = (v) => (v && v.__error ? v : null);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};

  // Fraction of the 9:30–16:00 ET regular session elapsed (0..1) from an ISO tape time.
  function sessionFrac(tape) {
    const t = Date.parse(tape || "");
    if (isNaN(t)) return 1;
    let hh = 16, mm = 0;
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t));
      hh = +parts.find((p) => p.type === "hour").value;
      mm = +parts.find((p) => p.type === "minute").value;
    } catch (e) { /* fall back to "session done" */ }
    return Math.max(0, Math.min(1, (hh * 60 + mm - 570) / 390));
  }

  // Load the free TradingView widget library once, on demand.
  let _tvLoading = false;
  function ensureTV() {
    if (window.TradingView && window.TradingView.widget) return true;
    if (!_tvLoading) {
      _tvLoading = true;
      const s = document.createElement("script");
      s.src = "https://s3.tradingview.com/tv.js";
      s.async = true;
      document.head.appendChild(s);
    }
    return false;
  }

  // Auto-generated plain-English observations — the "what stands out" banner.
  function quickRead(st, gx, un, vs, vol, mp, ivr) {
    const out = [];
    const f = (x) => (x == null || x === "" || isNaN(Number(x)) ? null : Number(x));
    const px = f(st.close);
    const cw = f(gx.call_wall), pw = f(gx.put_wall), flip = f(gx.gamma_flip);
    if (px && cw) out.push(`Price <b>${px.toFixed(2)}</b> is <b>${(((cw - px) / px) * 100).toFixed(1)}%</b> below the call wall <b>${cw}</b> (likely resistance).`);
    if (px && pw) out.push(`Put wall <b>${pw}</b> is <b>${(((px - pw) / px) * 100).toFixed(1)}%</b> below price — likely support.`);
    if (px && flip) out.push(px >= flip ? `Above the gamma flip <b>${flip}</b> → dealers <b>dampen</b> moves (calmer tape).` : `Below the gamma flip <b>${flip}</b> → dealers <b>amplify</b> moves (wilder tape).`);
    const rk = f(vs.iv_rank != null ? vs.iv_rank : ivr.iv_rank_1y);
    if (rk != null) out.push(rk < 20 ? `IV rank <b>${rk.toFixed(0)}</b> — options are <b>cheap</b> vs the past year.` : rk > 70 ? `IV rank <b>${rk.toFixed(0)}</b> — options are <b>expensive</b> (favours selling premium).` : `IV rank <b>${rk.toFixed(0)}</b> — options are mid-priced.`);
    const ncp = f(vol.net_call_premium);
    if (ncp != null) out.push(ncp >= 0 ? `Net call premium <b>+$${(ncp / 1e6).toFixed(1)}M</b> — today's money is net <b>bullish</b>.` : `Net call premium <b>−$${(Math.abs(ncp) / 1e6).toFixed(1)}M</b> — today's money is net <b>bearish</b>.`);
    const mpr = mp[0];
    if (mpr && f(mpr.max_pain) && f(mpr.close)) {
      const dist = ((f(mpr.close) - f(mpr.max_pain)) / f(mpr.close)) * 100;
      if (Math.abs(dist) < 1.5) out.push(`Spot is within <b>${Math.abs(dist).toFixed(1)}%</b> of max pain <b>${mpr.max_pain}</b> → strong <b>pin risk</b> into expiry.`);
    }
    return out.length ? `<ul class="qr">${out.map((x) => `<li>${x}</li>`).join("")}</ul>` : '<div class="muted" style="padding:6px">not enough data</div>';
  }

  U.PANELS = U.PANELS || {};
  U.PANELS.overview = {
    title: "Overview",
    render(d, payload) {
      const tvSym = (payload && payload.tv) || first(d.info).symbol || "";
      const tvId = "tv_" + tvSym.replace(/[^A-Za-z0-9]/g, "_");
      const info = first(d.info);
      const st = first(d.stock_state);
      const vol = first(d.options_volume);
      const ivr = Array.isArray(d.iv_rank) ? d.iv_rank : [];
      const vs = first(d.vol_stats);
      const gx = first(d.gex_levels);
      const un = first(d.unusualness);
      const ohlc = err(d.ohlc_daily) ? [] : d.ohlc_daily || [];
      const mp = err(d.max_pain) ? [] : d.max_pain || [];

      const px = num(st.close);
      const prev = num(st.prev_close);
      const chg = prev && st.close ? ((st.close - prev) / prev) * 100 : null;
      const lastIvr = ivr.length ? ivr[ivr.length - 1] : {};

      // Volume percentiles compare *cumulative* volume to full-day history, so
      // early in the session they read 0 even for very active names. Show
      // "early" until ~40% of the session has elapsed instead of a false 0.
      const frac = sessionFrac(st.tape_time);
      const volKpi = (label, p, decile) => {
        if (p == null) return kpiBig(label, "–", "");
        const v = Number(p);
        if (v === 0 && frac < 0.4) return kpiBig(label, "early", "vs 91d full-day", "muted");
        return kpiBig(label, num(v, 0) + " pct", "D" + (decile ?? "–"));
      };

      const kpis =
        kpiBig("Last", px, st.market_time ? String(st.market_time).slice(0, 16).replace("T", " ") : "", chg == null ? "" : signCls(chg)) +
        kpiBig("Day %", chg == null ? "–" : chg.toFixed(2) + "%", "prev " + num(st.prev_close), signCls(chg)) +
        kpiBig("IV", vs.iv != null ? (vs.iv * 100).toFixed(1) + "%" : lastIvr.volatility != null ? (lastIvr.volatility * 100).toFixed(1) + "%" : "–", "rank " + num(vs.iv_rank != null ? vs.iv_rank : lastIvr.iv_rank_1y, 1)) +
        kpiBig("IV Rank", num(vs.iv_rank != null ? vs.iv_rank : lastIvr.iv_rank_1y, 1), "1y") +
        volKpi("Stock Vol", un.stock_vol_pctile, un.stock_vol_decile) +
        volKpi("Opt Vol", un.opt_vol_pctile, un.opt_vol_decile);

      const gamma = gx.call_wall == null && err(d.gex_levels) ? '<div class="muted">gamma unavailable</div>' :
        `<div class="gex-grid"><div class="gex"><div class="t">Call wall</div><div class="row"><span>resistance</span><b class="neg">${esc(gx.call_wall)}</b></div>
         <div class="row"><span>put wall</span><b class="pos">${esc(gx.put_wall)}</b></div>
         <div class="row"><span>gamma flip</span><b>${esc(gx.gamma_flip)}</b></div>
         <div class="row"><span>magnet</span><b>${esc(gx.gamma_magnet)}</b></div>
         <div class="row"><span>near flips</span><b>${esc((gx.nearby_flips || []).join(" · "))}</b></div></div></div>`;

      const mpRows = mp.slice(0, 8);
      const mpDist = (r) => (r.close && r.max_pain ? ((r.close - r.max_pain) / r.close) * 100 : null);
      const mpMax = Math.max(0, ...mpRows.map((r) => Math.abs(mpDist(r) || 0)));
      const mpTable = table(
        [{ label: "Expiry" }, { label: "Max Pain", num: true }, { label: "Close", num: true }, { label: "Dist", num: true }],
        mpRows,
        (r) => {
          const dist = mpDist(r);
          const heat = U.heat(-(dist || 0), mpMax);
          return `<tr><td>${esc(r.expiry)}</td><td class="num" style="background:${heat}">${esc(r.max_pain)}</td><td class="num ${signCls((r.max_pain || 0) - (r.close || 0))}" style="background:${heat}">${esc(r.close)}</td><td class="num ${signCls(-dist)}" style="background:${heat}">${dist == null ? "–" : dist.toFixed(2) + "%"}</td></tr>`;
        }
      );

      const ohlcRows = ohlc.slice(0, 120).reverse(); // API is newest-first
      const svgCandles = err(d.ohlc_daily)
        ? '<div class="muted" style="padding:6px">price unavailable</div>'
        : candles(ohlcRows, { height: 320, labels: [ohlcRows[0] ? ohlcRows[0].date : "", ohlcRows.length ? ohlcRows[ohlcRows.length - 1].date : ""] });
      const priceCard = tvSym
        ? `<div class="tv-wrap"><div class="tv-chart" id="${tvId}" data-tv="${esc(tvSym)}" data-mkt="${esc(st.market_time || "")}"></div><div class="tv-fallback">${svgCandles}</div></div>`
        : svgCandles;
      const tvBadge = tvSym
        ? ' <span class="tv-badge" title="The free TradingView feed can lag the live header by ~15 min; the header is real-time.">delayed</span>'
        : "";

      const ovRows = (err(d.options_volume) ? [] : Array.isArray(d.options_volume) ? d.options_volume : []).slice(-40);
      const volSeries = ohlcRows.map((r) => Number(r.volume) || Number(r.total_volume) || 0).slice(-90);
      const ivSeries = ivr.slice(-120).map((r) => Number(r.iv_rank_1y) || 0);

      const profile = info.full_name
        ? `<div class="kv">
            <div><span>Name</span><b>${esc(info.full_name)}</b></div>
            <div><span>Sector</span><b>${esc(info.sector)}</b></div>
            <div><span>Type</span><b>${esc(info.issue_type)}</b></div>
            <div><span>Mkt cap</span><b>${info.marketcap ? "$" + (info.marketcap / 1e9).toFixed(2) + "B" : "–"}</b></div>
            <div><span>Beta</span><b>${num(info.beta)}</b></div>
            <div><span>Options</span><b>${info.has_options ? "yes" : "no"}</b></div>
           </div>`
        : '<div class="muted">no profile (Advanced+ tier)</div>';

      const lastVol = ovRows.length ? ovRows[ovRows.length - 1] : {};
      const pcRatio = lastVol.call_volume ? (lastVol.put_volume / lastVol.call_volume).toFixed(2) : "–";

      return (
        card("Quick read · what stands out", quickRead(st, gx, un, vs, vol, mp, lastIvr), 4) +
        card("Price · daily" + tvBadge, priceCard, 2) +
        card("Key Stats", `<div class="kpis">${kpis}</div>`, 2) +
        card("Profile", profile, 1) +
        card("Volume · daily (last 90d)", line(volSeries, { stroke: "#3b82f6", fill: "#3b82f6", height: 120 }), 2) +
        card("IV Rank (1y)", line(ivSeries, { stroke: "#f59e0b", height: 120 }), 1) +
        card(
          "Last Session",
          kpiBig("Call vol", int(lastVol.call_volume), "", "pos") + kpiBig("Put vol", int(lastVol.put_volume), "", "neg") + kpiBig("P/C", pcRatio, "", pcRatio === "–" ? "" : signCls(1 - Number(pcRatio))) + kpiBig("Net call prem", money(lastVol.net_call_premium), "", signCls(lastVol.net_call_premium)),
          1
        )
      );
    },
    afterRender(pane) {
      const el = pane.querySelector(".tv-chart");
      if (!el) return;
      const wrap = el.closest(".tv-wrap");
      const sym = el.dataset.tv;
      // Intraday bars during the live session; daily otherwise.
      const interval = el.dataset.mkt === "regular" ? "5" : "D";
      let tries = 0;
      const start = () => {
        if (ensureTV()) {
          try {
            new window.TradingView.widget({
              container_id: el.id,
              symbol: sym,
              interval: interval,
              timezone: "America/New_York",
              theme: "dark",
              style: "1",
              locale: "en",
              autosize: true,
              allow_symbol_change: true,
              hide_side_toolbar: false,
              withdateranges: true,
              details: false,
              save_image: false,
              enable_publishing: false,
            });
          } catch (e) {
            if (wrap) wrap.classList.add("fallback");
          }
        } else if (tries++ < 25) {
          setTimeout(start, 200);
        } else if (wrap) {
          wrap.classList.add("fallback");
        }
      };
      start();
    },
    info: {
      title: "Overview",
      tagline: "Price, key stats, dealer gamma and the single-day options picture",
      sections: [
        {
          h: "What this tab shows",
          p: "<p>The one-screen summary of a ticker: <b>interactive price chart</b> (TradingView), core volatility stats, dealer gamma levels, max pain by expiry, the company profile, daily volume and the latest options session. Use it to orient before drilling into Flow / GEX / Options.</p>",
        },
        {
          h: "Panels",
          p: "<ul>\
<li><b>Price · daily</b> — TradingView candles (switch interval/ticker, add indicators, draw levels). Defaults to <b>5-min bars during the regular session</b> and daily otherwise. The free feed can lag the live header by ~15 min (shown as a <code>delayed</code> badge); the header values are real-time. Falls back to an internal candle chart if the widget cannot load.</li>\
<li><b>Key Stats</b> — Last, day %, IV, IV rank, stock-volume percentile and option-volume percentile. Percentiles compare <b>cumulative</b> volume to 91 full-day samples, so early in the session they read low; until ~40% of the session has elapsed the card shows <code>early</code> rather than a misleading <code>0 pct</code>.</li>\
<li><b>Dealer Gamma Levels</b> — call wall (resistance), put wall (support), gamma flip (regime), magnet (pin), and the nearest flip strikes.</li>\
<li><b>Max Pain</b> — for each expiry, the strike that would maximise option-writer profit, with distance of spot from it.</li>\
<li><b>Profile</b> — name, sector, market cap, beta, options availability.</li>\
<li><b>Volume · daily</b> / <b>IV Rank (1y)</b> / <b>Last Session</b> — stock volume trend, 1-year IV-rank trend, and the latest call/put volume + net call premium.</li></ul>",
        },
        {
          h: "How to trade it",
          p: "<p><b>Regime first:</b> if spot is above the gamma flip and inside the walls, expect mean-reversion/pinning — fade moves toward the walls. Below the flip, dealers amplify moves — trade breakouts. <b>Max pain</b> acts as a magnet into expiry. <b>IV rank</b> decides whether to buy or sell premium: high rank favours selling (VRP harvest), low rank favours buying defined-risk longs into catalysts.</p>",
        },
        {
          h: "Worked example",
          p: "<pre>NVDA  spot 226.06  |  flip 224.0  call wall 227.5  put wall 217.5  magnet 225\nIV rank 1  (low)   |  stock-vol 0 pct  opt-vol 0 pct  (very quiet)\nReading: spot > flip => positive-gamma regime. Range ~217.5-227.5.\nQuiet volume + low IV rank => premium is cheap; prefer long gamma (debit spreads /\nstraddles) into a catalyst rather than selling premium.\nTrade: buy a call debit spread 225/227.5 while spot holds above the 224 flip;\ntarget the 227.5 call wall, stop back below 224 flip.</pre>",
        },
        {
          h: "Endpoints used",
          p: "<p><code>/stock/{t}/info</code> <code>/stock-state</code> <code>/quote</code> <code>/unusualness</code> <code>/gex-levels</code> <code>/max-pain</code> <code>/options-volume</code> <code>/iv-rank</code> <code>/volatility/stats</code> <code>/ohlc/1d</code>. Price chart: TradingView free widget (<code>EXCHANGE:TICKER</code>).</p>",
        },
        {
          h: "Caveats",
          p: "<ul><li><code>vol_stats.iv_rank</code> is 0-100; <code>iv_rank_1y</code> from <code>/iv-rank</code> is also a rank — they can differ slightly.</li><li>Max pain uses the last close, not live spot, so distance is indicative intraday.</li><li>Volume percentiles of 0 are legitimate (quiet name), not missing data.</li></ul>",
        },
      ],
    },
  };
})();
