/* IV & Greeks tab — IV skew, dealer gamma (GEX) and term structure.
 *
 * Backend: GET /api/greeks/{T}[?expiry=<epoch>] ->
 *   {ticker, as_of, spot, expiry, expiry_flag, indiavix,
 *    iv:{atm_iv, atm_strike, call_25d_iv, put_25d_iv, risk_reversal,
 *        butterfly, skew_slope, max_iv:{strike,iv,side}, min_iv:{...},
 *        n_legs_with_iv, reason},
 *    gex:{rows:[{strike, call_gex, put_gex, net_gex}], net_gex, gamma_flip,
 *         call_wall, put_wall, magnet, iv_source, reason},
 *    vrp:null | {iv, hv20, vrp, vrp_pct, ratio, verdict, reason},
 *    iv_rank:null | {iv_now, iv_rank, iv_percentile, min, max, median, n, reason},
 *    term_structure:null | {expiries[], front, next, front_next_spread,
 *                           structure, reason}}
 *
 * Honesty contract: every block may be null and every number inside may be null
 * with a `reason`. We never render "null"/"NaN" (use "–") and never imply
 * exchange-grade data — greeks are the Fyers broker model, and GEX gamma is
 * either `fyers_greeks` (true gamma) or `bs_backsolved` (BS fallback). The
 * provenance line states which.
 *
 * The documented payload carries aggregate IV metrics; if the endpoint also
 * includes a per-strike smile (any of `iv.strikes`, `iv.smile`, `iv.curve`,
 * `chain.strikes` or a top-level `strikes` array with `ce_iv`/`pe_iv`) it is
 * drawn as a CE/PE skew line. Otherwise the panel shows an honest mute with
 * the available skew anchors — it does not fabricate a curve.
 *
 * render() returns skeletons; afterRender() fetches once per ticker and fills
 * the card bodies in place (same contract as panels/futures.js).
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, num, signCls, pill, table, card, multi } = U.util;

  const cache = {};

  const arr = (v) => (Array.isArray(v) ? v : []);
  const isNum = (v) => v != null && v !== "" && isFinite(Number(v));
  const nz = (v) => (isNum(v) ? Number(v) : 0);
  const DASH = "–";
  const cap = (html) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${html}</div>`;
  const miss = (what) => `<div class="muted" style="padding:6px">${esc(what)}</div>`;
  const note = (what) => `<div class="muted" style="padding:2px 6px;font-size:9.5px">${esc(what)}</div>`;
  const kpi = (label, value, sub, cls) =>
    `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v ${cls || ""}">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ""}</div>`;
  const legend = (items) =>
    `<div class="legend">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join("")}</div>`;
  const inr = (v) =>
    isNum(v) ? "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : DASH;

  // IV units: Fyers greeks are decimals (~0.14) while India VIX is a percent
  // (~12). The reference sets the scale: >3 => already a percent number.
  const scaleOf = (ref) => (isNum(ref) && Math.abs(Number(ref)) > 3 ? 1 : 100);
  const ivPct = (v, ref) => (isNum(v) ? (Number(v) * scaleOf(ref)).toFixed(1) + "%" : DASH);
  const ivPts = (v, ref, d = 2) => {
    if (!isNum(v)) return DASH;
    const x = Number(v) * scaleOf(ref);
    return (x > 0 ? "+" : "") + x.toFixed(d) + " pts";
  };
  // Risk reversal > 0 is put skew (downside fear) — red; < 0 call skew — green.
  const rrCls = (v) => (!isNum(v) ? "" : Number(v) > 0 ? "neg" : Number(v) < 0 ? "pos" : "muted");
  const verdictCls = (v) => (v === "EXPENSIVE" ? "sell" : v === "CHEAP" ? "buy" : "");
  const gexFmt = (v) => (isNum(v) ? (Number(v) > 0 ? "+" : "") + Number(v).toFixed(1) : DASH);

  async function load(ticker) {
    if (cache[ticker]) return cache[ticker];
    const res = await fetch(`/api/greeks/${encodeURIComponent(ticker)}`);
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (e) {
        /* keep the status */
      }
      throw new Error(msg);
    }
    cache[ticker] = await res.json();
    return cache[ticker];
  }

  // ---- provenance ---------------------------------------------------------
  function provenance(gex) {
    const src = (gex && gex.iv_source) || "unavailable";
    if (src === "fyers_greeks") {
      return "IV/greeks: Fyers model · GEX gamma source: fyers_greeks (true gamma)";
    }
    if (src === "bs_backsolved") {
      return "IV/greeks: Fyers model · GEX gamma source: BS back-solve (greeks unavailable)";
    }
    return "IV/greeks: Fyers model · GEX gamma source: " + esc(String(src));
  }

  // ---- per-strike smile (optional in the payload) -------------------------
  function normSmileRow(r) {
    if (!r || typeof r !== "object") return null;
    const k = Number(r.strike);
    if (!isFinite(k) || k <= 0) return null;
    if (isNum(r.ce_iv) || isNum(r.pe_iv)) {
      return {
        strike: k,
        ce_iv: isNum(r.ce_iv) ? Number(r.ce_iv) : null,
        pe_iv: isNum(r.pe_iv) ? Number(r.pe_iv) : null,
      };
    }
    if (isNum(r.iv)) {
      const side = String(r.side == null ? "" : r.side).toLowerCase();
      return {
        strike: k,
        ce_iv: side.startsWith("c") ? Number(r.iv) : null,
        pe_iv: side.startsWith("p") ? Number(r.iv) : null,
      };
    }
    return null;
  }

  function smileRows(p) {
    const candidates = [
      p && p.iv && p.iv.strikes,
      p && p.iv && p.iv.smile,
      p && p.iv && p.iv.curve,
      p && p.smile,
      p && p.chain && p.chain.strikes,
      p && p.strikes,
    ];
    for (const c of candidates) {
      const rows = arr(c).map(normSmileRow).filter(Boolean);
      if (rows.length >= 2 && rows.some((r) => r.ce_iv != null || r.pe_iv != null)) {
        return rows.sort((a, b) => a.strike - b.strike);
      }
    }
    return [];
  }

  function anchorsTable(iv, ref) {
    const rows = [];
    rows.push({ label: "ATM", strike: isNum(iv.atm_strike) ? num(iv.atm_strike, 0) : DASH, iv: ivPct(iv.atm_iv, ref) });
    if (isNum(iv.call_25d_iv)) rows.push({ label: "25Δ call", strike: DASH, iv: ivPct(iv.call_25d_iv, ref) });
    if (isNum(iv.put_25d_iv)) rows.push({ label: "25Δ put", strike: DASH, iv: ivPct(iv.put_25d_iv, ref) });
    if (iv.max_iv) rows.push({ label: "max IV (" + esc(String(iv.max_iv.side || "?")) + ")", strike: num(iv.max_iv.strike, 0), iv: ivPct(iv.max_iv.iv, ref) });
    if (iv.min_iv) rows.push({ label: "min IV (" + esc(String(iv.min_iv.side || "?")) + ")", strike: num(iv.min_iv.strike, 0), iv: ivPct(iv.min_iv.iv, ref) });
    if (!rows.length) return miss("no skew anchors available");
    return table(
      [
        { label: "Anchor" },
        { label: "Strike", num: true },
        { label: "IV", num: true },
      ],
      rows,
      (r) => `<tr><td>${r.label}</td><td class="num">${r.strike}</td><td class="num">${r.iv}</td></tr>`
    );
  }

  function skewBody(p) {
    const iv = p.iv || {};
    const ref = iv.atm_iv;
    const rows = smileRows(p);
    if (!rows.length) {
      const why = iv.reason ? "IV skew: " + iv.reason : "per-strike IV not returned by /api/greeks";
      return miss(why) + anchorsTable(iv, ref) +
        cap("skew anchors only — the endpoint did not include a per-strike smile, so no IV-vs-strike curve is drawn");
    }
    const scale = scaleOf(ref);
    const x = rows.map((r) => String(num(r.strike, 0)));
    const ce = rows.map((r) => (r.ce_iv != null ? r.ce_iv * scale : null));
    const pe = rows.map((r) => (r.pe_iv != null ? r.pe_iv * scale : null));
    const series = [];
    if (ce.some((v) => v != null)) series.push({ name: "CE IV", color: "#16a34a", data: ce });
    if (pe.some((v) => v != null)) series.push({ name: "PE IV", color: "#dc2626", data: pe });
    if (!series.length) return miss("no per-strike IV values");
    const anchor = isNum(iv.atm_strike) ? Number(iv.atm_strike) : isNum(p.spot) ? Number(p.spot) : null;
    let marks = [];
    if (anchor != null) {
      let bi = 0, bd = Infinity;
      rows.forEach((r, i) => {
        const d = Math.abs(r.strike - anchor);
        if (d < bd) { bd = d; bi = i; }
      });
      const y = ce[bi] != null ? ce[bi] : pe[bi];
      if (y != null) marks = [{ x: x[bi], value: y, label: "ATM", color: "#f59e0b" }];
    }
    return multi(series, { height: 210, x, axis: true, marks }) +
      legend([["#16a34a", "CE IV"], ["#dc2626", "PE IV"]]) +
      cap(`IV by strike (annualised %) · ATM pinned at <b>${esc(anchor != null ? inr(anchor) : DASH)}</b> · ${rows.length} strikes with IV`);
  }

  function headerBody(p) {
    const iv = p.iv || {};
    const ref = iv.atm_iv;
    const vrp = p.vrp;
    const kpis = [
      kpi("ATM IV", ivPct(iv.atm_iv, iv.atm_iv), "strike " + (isNum(iv.atm_strike) ? num(iv.atm_strike, 0) : DASH)),
      kpi("India VIX", ivPct(p.indiavix, p.indiavix), "from chain indiavixData"),
      kpi("25Δ RR", ivPts(iv.risk_reversal, ref), "put − call · &gt;0 = put skew", rrCls(iv.risk_reversal)),
      kpi("Butterfly", ivPts(iv.butterfly, ref), "wings − ATM"),
    ];
    if (vrp && vrp.verdict) {
      kpis.push(kpi("VRP", pill(vrp.verdict, verdictCls(vrp.verdict)), "IV − HV20 " + (isNum(vrp.vrp_pct) ? (vrp.vrp_pct > 0 ? "+" : "") + vrp.vrp_pct.toFixed(2) + " pts" : DASH)));
    }
    const reason = iv.reason ? note("skew metric note: " + iv.reason) : "";
    return `<div class="kpis">${kpis.join("")}</div>` + reason + skewBody(p) + cap(provenance(p.gex));
  }

  // Window the GEX bars around spot so a full 50-strike chain stays readable.
  function nearWindow(rows, spot, n) {
    const s = rows.slice().sort((a, b) => a.strike - b.strike);
    if (s.length <= n) return s;
    const anchor = isNum(spot) ? Number(spot) : s[Math.floor(s.length / 2)].strike;
    let bi = 0, bd = Infinity;
    s.forEach((r, i) => {
      const d = Math.abs(r.strike - anchor);
      if (d < bd) { bd = d; bi = i; }
    });
    const half = Math.floor(n / 2);
    let lo = Math.max(0, bi - half);
    const hi = Math.min(s.length, lo + n);
    lo = Math.max(0, hi - n);
    return s.slice(lo, hi);
  }

  function gexBody(p) {
    const gex = p.gex || {};
    if (gex.reason) return miss("gamma exposure: " + gex.reason);
    const rows = arr(gex.rows)
      .map((r) => ({ strike: nz(r.strike), call_gex: r.call_gex, put_gex: r.put_gex, net_gex: r.net_gex }))
      .filter((r) => r.strike > 0 && isNum(r.net_gex));
    if (!rows.length) return miss("gamma exposure");
    const spot = isNum(p.spot) ? Number(p.spot) : null;
    const lvl = (label, v, cls) =>
      `<div><span>${esc(label)}</span><b class="${cls || ""}">${isNum(v) ? num(v, 0) : DASH}</b></div>`;
    const levels =
      `<div class="kv">` +
      lvl("Gamma flip", gex.gamma_flip) +
      lvl("Call wall", gex.call_wall, "neg") +
      lvl("Put wall", gex.put_wall, "pos") +
      lvl("Magnet", gex.magnet) +
      `</div>`;
    const kpis =
      `<div class="kpis">` +
      kpi("Net GEX", gexFmt(gex.net_gex), "₹Cr / 1-pt move", signCls(gex.net_gex)) +
      kpi("Strikes", String(rows.length), spot != null ? "spot " + num(spot, 0) : "") +
      kpi("Flip", isNum(gex.gamma_flip) ? num(gex.gamma_flip, 0) : DASH, "GEX sign change") +
      `</div>`;
    const pick = nearWindow(rows, spot, 31);
    const chart = U.util.bars
      ? U.util.bars(pick.map((r) => ({ label: num(r.strike, 0), value: Number(r.net_gex) })), { signed: true, height: 190, axis: true, name: "Net GEX" })
      : "";
    return (
      kpis +
      levels +
      chart +
      cap(
        `net GEX per strike (₹Cr per 1-pt move) · green = dealer-long pin zone, red = dealer-short trend zone · ` +
          `gamma source: <b>${esc((gex.iv_source) || "unavailable")}</b>` +
          (rows.length > pick.length ? ` · ${rows.length - pick.length} far strikes hidden` : "")
      )
    );
  }

  function termBody(p) {
    const ts = p.term_structure;
    if (!ts) return miss("term structure unavailable") + cap("no data returned (needs two expiries carrying IV)");
    const exps = arr(ts.expiries);
    if (!exps.length) return miss("term structure unavailable") + (ts.reason ? cap(esc(ts.reason)) : "");
    const ref = (ts.front && ts.front.atm_iv) || null;
    const body = table(
      [
        { label: "Expiry" },
        { label: "Flag" },
        { label: "DTE", num: true },
        { label: "ATM IV", num: true },
        { label: "ATM strike", num: true },
      ],
      exps,
      (r) =>
        `<tr><td>${esc(r.expiry || DASH)}</td>` +
        `<td class="muted">${esc(r.expiry_flag || DASH)}</td>` +
        `<td class="num muted">${isNum(r.dte) ? num(r.dte, 0) : DASH}</td>` +
        `<td class="num">${ivPct(r.atm_iv, ref)}</td>` +
        `<td class="num">${isNum(r.atm_strike) ? num(r.atm_strike, 0) : DASH}</td></tr>`
    );
    const front = ts.front || {};
    const nxt = ts.next || {};
    const spread = isNum(ts.front_next_spread) ? ivPts(ts.front_next_spread, ref) : DASH;
    const structCls = ts.structure === "backwardation" ? "neg" : ts.structure === "contango" ? "pos" : "muted";
    return (
      body +
      cap(
        `front <b>${esc(front.expiry || DASH)}</b> ${ivPct(front.atm_iv, ref)} → next <b>${esc(nxt.expiry || DASH)}</b> ${ivPct(nxt.atm_iv, ref)} · ` +
          `spread ${spread} · structure <b class="${structCls}">${esc(ts.structure || DASH)}</b>` +
          (ts.reason ? ` · note: ${esc(ts.reason)}` : "")
      )
    );
  }

  function vrpBody(p) {
    const vrp = p.vrp;
    const rank = p.iv_rank;
    const parts = [];
    if (vrp && (isNum(vrp.ratio) || vrp.reason)) {
      parts.push(
        `<div class="kpis">` +
          kpi("VRP", isNum(vrp.vrp_pct) ? (vrp.vrp_pct > 0 ? "+" : "") + vrp.vrp_pct.toFixed(2) + " pts" : DASH, "IV − HV20") +
          kpi("Ratio", isNum(vrp.ratio) ? vrp.ratio.toFixed(2) : DASH, "IV ÷ HV20") +
          kpi("Verdict", pill(vrp.verdict || "UNKNOWN", verdictCls(vrp.verdict)), "premium richness") +
          kpi("HV20", ivPct(vrp.hv20, vrp.iv), "realised vol") +
          `</div>`
      );
      if (vrp.reason) parts.push(note(vrp.reason));
    } else {
      parts.push(miss("variance risk premium (no HV20 wired yet)"));
    }
    if (rank && (isNum(rank.iv_rank) || rank.reason)) {
      parts.push(
        `<div class="kpis">` +
          kpi("IV now", ivPct(rank.iv_now, rank.iv_now), "ATM") +
          kpi("IV rank", isNum(rank.iv_rank) ? rank.iv_rank.toFixed(0) + "%" : DASH, "0–100 over history") +
          kpi("IV %ile", isNum(rank.iv_percentile) ? rank.iv_percentile.toFixed(0) + "%" : DASH, "share below now") +
          kpi("Range", ivPct(rank.min, rank.iv_now) + " – " + ivPct(rank.max, rank.iv_now), isNum(rank.n) ? rank.n + " pts" : "") +
          `</div>`
      );
      if (rank.reason) parts.push(note(rank.reason));
    } else if (!rank) {
      parts.push(miss("IV rank (needs an IV history series)"));
    }
    parts.push(cap(`VRP = IV − HV20 (positive = options rich to realised) · verdict bands follow the premium tracker (ratio ≥1.1 EXPENSIVE / ≤0.9 CHEAP)`));
    return parts.join("");
  }

  U.PANELS.iv = {
    title: "IV & Greeks",
    render(data, full) {
      const p = (full && full.chain ? full : data && data.chain ? data : data) || {};
      const ticker = p.ticker || data.ticker || "";
      const load0 = '<div class="muted" style="padding:6px">Loading IV &amp; greeks…</div>';
      return (
        card(`IV &amp; Skew · ${esc(ticker)}`, `<div data-iv="header">${load0}</div>`, 2) +
        card("Gamma Exposure by Strike", `<div data-iv="gex">${load0}</div>`, 2) +
        card("Term structure · ATM IV by expiry", `<div data-iv="term">${load0}</div>`, 2) +
        card("IV rank & variance risk premium", `<div data-iv="vrp">${load0}</div>`, 2)
      );
    },
    async afterRender(pane, ticker) {
      const slots = pane.querySelectorAll("[data-iv]");
      if (!slots.length) return;
      let p;
      try {
        p = await load(ticker);
      } catch (e) {
        slots.forEach((el) => {
          el.innerHTML = miss("IV & greeks unavailable: " + e.message);
        });
        return;
      }
      // User may have switched tabs/expiry while we fetched.
      if (!pane.isConnected || !pane.querySelector("[data-iv]")) return;
      const html = { header: headerBody(p), gex: gexBody(p), term: termBody(p), vrp: vrpBody(p) };
      slots.forEach((el) => {
        const k = el.dataset.iv;
        if (html[k] != null) el.innerHTML = html[k];
      });
      try {
        if (U.charts) U.charts.mount(pane);
      } catch (e) {
        /* charts are best-effort */
      }
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => {
        try {
          if (U.charts) U.charts.resizeAll();
        } catch (e) {
          /* ignore */
        }
      }, 350);
    },
    info: {
      title: "IV & Greeks",
      tagline: "Implied-vol skew, dealer gamma map and IV term structure from the Fyers broker greeks",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Four cards from <code>GET /api/greeks/{T}</code>: the <b>IV skew</b> (ATM IV, India VIX, 25Δ risk reversal, butterfly, and the CE/PE smile by strike when the endpoint carries it), the <b>gamma exposure map</b> (net dealer GEX per strike with the call/put walls, gamma flip and magnet), the <b>IV term structure</b> (ATM IV per expiry, front-vs-next spread and contango/backwardation), and <b>IV rank + variance risk premium</b>.</p>`,
        },
        {
          h: "How to read it",
          p: `<p><b>25Δ risk reversal</b> = 25Δ put IV − 25Δ call IV. Positive means puts are bidder than calls — <b>put skew / downside fear</b>; negative means calls are richer — <b>call skew / upside chase</b>. <b>Butterfly</b> = (25ΔC + 25ΔP)/2 − ATM: positive means the wings are bid. <b>Contango</b> (front IV &lt; next IV) is the normal calm term structure; <b>backwardation</b> (front richer) flags near-term stress/event risk. In GEX, positive net = dealers long gamma (pin/chop), negative = short gamma (trend).</p>`,
        },
        {
          h: "Endpoints used",
          p: `<p><code>GET /api/greeks/{T}[?expiry=&lt;epoch&gt;]</code> — <code>iv</code>, <code>gex</code>, <code>vrp</code>, <code>iv_rank</code>, <code>term_structure</code>.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li><b>Greeks are the Fyers broker model, not the exchange.</b> The provenance line states whether GEX used <code>fyers_greeks</code> (true per-leg gamma) or a <b>BS back-solve</b> fallback.</li><li>Any block may be <b>null</b> with a <code>reason</code> (e.g. too few IV legs, no 25Δ deltas, one expiry only) — the panel shows that reason instead of a number.</li><li>The documented payload carries aggregate IV metrics; if no per-strike smile is returned the skew card shows anchors only rather than inventing a curve.</li><li>VRP and IV rank stay muted until an HV20 / IV-history series is wired.</li></ul>`,
        },
      ],
    },
  };
})();
