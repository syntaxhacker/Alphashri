/* Edge / Scoreboard — "who won, is there edge?" verdict for the whole tape.
 * Reachable at #/edge. Data: /api/edge, /api/edge/players, /api/edge/whales.
 *
 * This is a GLOBAL view (not a symbol panel): every signal the system emitted is
 * scored against the forward return that followed, then bucketed so you can see
 * where — if anywhere — the edge is real. Honest by design: small samples are
 * labelled "low n" and the verdict refuses to call an edge until enough signals
 * have resolved.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, money, num, int, pct, rawpct, signCls, tk, shortDate, kpiBig } = U.util;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const numOrNull = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const typeCls = (t) => {
    const s = String(t == null ? "" : t).toLowerCase();
    if (s.startsWith("c")) return "pos";
    if (s.startsWith("p")) return "neg";
    return "muted";
  };

  function ago(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return Math.round(s) + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }
  const dstr = (s) => (s ? String(s).slice(0, 10) : "–");

  // ---- thresholds ---------------------------------------------------------
  const MIN_N = 20; // per-bucket "enough signals" line
  const SAMPLE_MIN = 30; // whole-sample "edge is undefined" line
  const WHALES_CAP = 60; // display caps only — data arrays are never truncated
  const TRADES_CAP = 60;
  const PERSONS_CAP = 25;

  // Return formatting: the contract mixes ratios (win_rate / avg_ret / avg_excess
  // are fractions 0..1) with already-percent fields (*_pct). Keep the mapping in
  // one place so a backend convention change is a one-line fix.
  const fracPct = (v, d = 1) => pct(v, d); // 0.012 -> "1.2%"
  const pctRaw = (v, d = 1) => rawpct(v, d); // 12.0 -> "12.0%"

  // ---- view state (module scope so repaints keep the user's filters) ------
  let fHorizon = "all";
  let fScope = "all";
  let hideLowN = false;
  let tradeType = "all"; // all | congress | insider

  function statusOf(pctVal, fallback) {
    const v = numOrNull(pctVal);
    if (v == null) {
      const s = String(fallback == null ? "" : fallback);
      if (!s) return { cls: "muted", txt: "• flat" };
      const l = s.toLowerCase();
      if (/win|profit|up|gain/.test(l)) return { cls: "pos", txt: "▲ " + esc(s) };
      if (/wreck|loss|down|dead|red/.test(l)) return { cls: "neg", txt: "▼ " + esc(s) };
      return { cls: "muted", txt: "• " + esc(s) };
    }
    if (v > 0.5) return { cls: "pos", txt: "▲ winning" };
    if (v < -0.5) return { cls: "neg", txt: "▼ wrecked" };
    return { cls: "muted", txt: "• flat" };
  }

  U.renderEdge = async function (root) {
    const nav = U.navSeq || 0;
    const mounted = root.querySelector("[data-edge-view]");
    const first = !mounted;
    if (first) root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading edge scoreboard…</div></div></div>';

    // Fetch all three independently — a 500 on one must not blank the others.
    const settled = await Promise.allSettled([
      fetch("/api/edge").then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))),
      fetch("/api/edge/players").then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))),
      fetch("/api/edge/whales").then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))),
    ]);
    if ((U.navSeq || 0) !== nav) return; // route changed while loading

    const edge = settled[0].status === "fulfilled" ? settled[0].value : null;
    const players = settled[1].status === "fulfilled" ? settled[1].value : null;
    const whalesRes = settled[2].status === "fulfilled" ? settled[2].value : null;
    const errs = {
      edge: settled[0].status === "rejected" ? settled[0].reason.message : "",
      players: settled[1].status === "rejected" ? settled[1].reason.message : "",
      whales: settled[2].status === "rejected" ? settled[2].reason.message : "",
    };

    const stats = arr(edge && edge.stats);
    const sample = (edge && edge.sample) || {};
    const status = (edge && edge.status) || {};
    const horizons = arr(edge && edge.horizons).length ? arr(edge.horizons) : ["5m", "15m", "60m", "eod", "1d"];
    const scopes = [...new Set(stats.map((s) => String(s.scope || "")).filter(Boolean))];
    const whales = arr(Array.isArray(whalesRes) ? whalesRes : whalesRes && whalesRes.whales);
    const persons = arr(players && players.persons);
    const trades = arr(players && players.trades);

    const resolved = numOrNull(sample.resolved) || 0;
    const enough = resolved >= SAMPLE_MIN;
    const rankable = stats.filter((s) => !s.low_n).length;
    const goodBuckets = stats.filter((s) => !s.low_n && (numOrNull(s.avg_excess) || 0) > 0).length;

    const hintVerdict =
      "Every signal the system emitted is scored against the <b>forward return</b> that followed " +
      "(5m / 15m / 60m / end-of-day / 1d). <b>Excess</b> subtracts the same-window baseline — the market's " +
      "own move — so it answers <i>did this signal beat just being long the tape?</i>, not <i>did the stock go up?</i>. " +
      "<b>n</b> is the resolved sample: buckets under " + MIN_N + " are labelled <b>low n</b>, and the whole verdict " +
      "stays muted until ≥ " + SAMPLE_MIN + " signals resolve. Anonymous options flow has <b>no identity</b> — it can't " +
      "be attributed, and we can't know open vs close. <b>Entry</b> is a proxy (a later print/mid), not the whale's fill, " +
      "and options P&L is <b>intrinsic-only</b> (no IV crush / spread).";
    const hintRank =
      "Buckets sorted by <b>excess return</b>, best-first. <b>N</b> = <b>independent</b> observations (n_ind) — hundreds of strikes of the same ticker at the same instant collapse to one, so N is the real sample, not the raw print count. <b>t</b> below ~2 is noise. A bucket is only rankable with n_ind ≥ " +
      MIN_N +
      " across ≥5 tickers and ≥2 sessions; otherwise it's dimmed <b>low n</b>. Positive excess = that bucket beat the market over the same horizon. Figures are gross of costs.";
    const hintWhales =
      "Individual whale prints re-checked against price since the alert. <b>Move %</b> = price move since entry; " +
      "<b>▲ winning / ▼ wrecked / • flat</b> is our mark. <b>Entry</b> is a proxy and options P&L counts " +
      "<b>intrinsic value only</b> — it ignores IV crush and spread, so treat it as a direction check, not a P&L.";
    const hintPlayers =
      "Only <b>Congress</b> and <b>insiders</b> have identity — the only attributable flow. The leaderboard ranks named " +
      "people by average P&L on their disclosed trades (<b>n</b> = trades tracked). Disclosures lag the trade by days-weeks, " +
      "and entry is a proxy — treat the record as directional, not a live signal.";

    function paint() {
      const prev = root.querySelector("[data-edge-view]");
      const prevScroll = prev ? prev.scrollTop : 0;

      // ---- edge ranking (filter + sort) ----------------------------------
      let rows = stats.slice();
      if (fHorizon !== "all") rows = rows.filter((s) => String(s.horizon) === fHorizon);
      if (fScope !== "all") rows = rows.filter((s) => String(s.scope) === fScope);
      const matched = rows.length;
      if (hideLowN) rows = rows.filter((s) => !s.low_n);
      rows.sort((a, b) => {
        const x = numOrNull(a.avg_excess);
        const y = numOrNull(b.avg_excess);
        return (y == null ? -Infinity : y) - (x == null ? -Infinity : x);
      });
      const maxExcess = Math.max(0.0001, ...rows.map((r) => Math.abs(numOrNull(r.avg_excess) || 0)));

      const rankHead = `<tr><th>Scope</th><th>Bucket</th><th>Horizon</th><th class="num">N</th><th class="num">Win %</th><th class="num">Avg ret %</th><th class="num">Excess %</th><th class="num" title="t-statistic — below ~2 is noise">t</th></tr>`;
      const rankBody = rows.length
        ? rows
            .map((r) => {
              const nInd = numOrNull(r.n_ind != null ? r.n_ind : r.n);
              const nRaw = numOrNull(r.n_raw != null ? r.n_raw : r.n);
              const low = !!r.low_n || (nInd != null && nInd < MIN_N);
              const tip = `n_ind=${int(nInd)} (raw ${int(nRaw)} · ${int(r.distinct_tickers)} tickers · ${int(r.distinct_sessions)} sessions)${low ? " — low n, treat as noise" : ""}`;
              return `<tr${low ? ' style="opacity:.5"' : ""} title="${esc(tip)}">
                <td class="muted">${esc(r.scope || "–")}</td>
                <td>${esc(r.bucket || "–")}${low ? ' <span class="pill">low n</span>' : ""}</td>
                <td class="muted">${esc(r.horizon || "–")}</td>
                <td class="num">${int(nInd)}</td>
                <td class="num">${fracPct(r.win_rate, 0)}</td>
                <td class="num ${signCls(r.avg_ret)}">${fracPct(r.avg_ret, 2)}</td>
                <td class="num ${signCls(r.avg_excess)}" style="background:${U.heat(r.avg_excess, maxExcess)}">${fracPct(r.avg_excess, 2)}</td>
                <td class="num muted">${num(r.tstat, 2)}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="8" class="muted" style="padding:8px">${
            stats.length ? "no buckets match this filter" : errs.edge ? "edge data unavailable (" + esc(errs.edge) + ")" : "no stats yet — nothing has resolved"
          }</td></tr>`;

      const hzBtn = (h) => `<button class="preset ${fHorizon === h ? "on" : ""}" data-eh="${esc(h)}">${esc(h)}</button>`;
      const scBtn = (s) => `<button class="preset ${fScope === s ? "on" : ""}" data-es="${esc(s)}">${esc(s)}</button>`;

      // ---- whales, marked -------------------------------------------------
      const wShown = whales.slice(0, WHALES_CAP);
      const maxPrem = Math.max(0, ...whales.map((w) => Math.abs(Number(w.premium) || 0)));
      const maxMove = Math.max(0.01, ...whales.map((w) => Math.abs(numOrNull(w.move_pct) || 0)));
      const whaleHead = `<tr><th>Ticker</th><th>Kind</th><th>Type</th><th class="num">Strike</th><th>Exp</th><th class="num">Prem</th><th>Since</th><th class="num">Entry</th><th class="num">Last</th><th class="num">Move %</th><th>Status</th></tr>`;
      const whaleBody = wShown.length
        ? wShown
            .map((w) => {
              const st = statusOf(w.move_pct, w.status);
              return `<tr>
                <td>${tk(w.ticker)}</td>
                <td class="muted">${esc(String(w.kind == null ? "–" : w.kind).toUpperCase())}</td>
                <td class="${typeCls(w.type)}">${esc(String(w.type == null ? "–" : w.type).toUpperCase())}</td>
                <td class="num">${w.strike == null ? "–" : esc(w.strike)}</td>
                <td class="muted">${esc(shortDate(w.expiry))}</td>
                <td class="num" style="background:${U.heat(Number(w.premium) || 0, maxPrem)}">${money(w.premium)}</td>
                <td class="muted" title="${esc(w.created_at || "")}">${esc(ago(w.created_at))}</td>
                <td class="num muted">${num(w.entry_px, 2)}</td>
                <td class="num">${num(w.last_px, 2)}</td>
                <td class="num ${signCls(w.move_pct)}" style="background:${U.heat(Number(w.move_pct) || 0, maxMove)}">${pctRaw(w.move_pct, 1)}</td>
                <td class="${st.cls}">${st.txt}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="11" class="muted" style="padding:8px">${errs.whales ? "whales unavailable (" + esc(errs.whales) + ")" : "no whale prints scored yet"}</td></tr>`;
      const whaleNote = whales.length > wShown.length ? `<div class="wl-note">showing ${wShown.length} of ${whales.length} whale prints</div>` : "";

      // ---- named players --------------------------------------------------
      const personsSorted = persons
        .slice()
        .sort((a, b) => {
          const x = numOrNull(a.avg_pnl_pct);
          const y = numOrNull(b.avg_pnl_pct);
          return (y == null ? -Infinity : y) - (x == null ? -Infinity : x);
        });
      const pShown = personsSorted.slice(0, PERSONS_CAP);
      const pBody = pShown.length
        ? pShown
            .map(
              (p) => `<tr><td>${esc(p.name || "–")}</td><td class="num">${int(p.n)}</td><td class="num">${fracPct(p.win_rate, 0)}</td><td class="num ${signCls(p.avg_pnl_pct)}">${pctRaw(p.avg_pnl_pct, 1)}</td></tr>`
            )
            .join("")
        : `<tr><td colspan="4" class="muted" style="padding:8px">${errs.players ? "players unavailable (" + esc(errs.players) + ")" : "no named players tracked yet"}</td></tr>`;
      const pNote = persons.length > pShown.length ? `<div class="wl-note">showing ${pShown.length} of ${persons.length} people</div>` : "";

      let tRows = trades.slice();
      if (tradeType !== "all") tRows = tRows.filter((t) => String(t.type || "").toLowerCase() === tradeType);
      tRows.sort((a, b) => {
        const x = String(a.date || "");
        const y = String(b.date || "");
        return x < y ? 1 : x > y ? -1 : 0;
      });
      const tShown = tRows.slice(0, TRADES_CAP);
      const tBody = tShown.length
        ? tShown
            .map((t) => {
              const raw = String(t.txn || "").toLowerCase();
              const isBuy = raw.startsWith("b") || raw === "purchase";
              const isSell = raw.startsWith("s") || raw === "sale";
              const txnTxt = isBuy ? "Buy" : isSell ? "Sell" : t.txn || "–";
              const txnCls = isBuy ? "buy" : isSell ? "sell" : "";
              const kind = String(t.type || "").toLowerCase() === "insider" ? "INSIDER" : "CONGRESS";
              const st = statusOf(t.pnl_pct, t.status);
              return `<tr>
                <td>${esc(t.name || "–")}</td>
                <td><span class="pill" title="${esc(t.type || "")}">${esc(kind)}</span></td>
                <td>${tk(t.ticker)}</td>
                <td><span class="pill ${txnCls}">${esc(txnTxt)}</span></td>
                <td class="muted">${esc(dstr(t.date))}</td>
                <td class="num muted">${num(t.price, 2)}</td>
                <td class="num">${num(t.last_px, 2)}</td>
                <td class="num ${signCls(t.pnl_pct)}">${pctRaw(t.pnl_pct, 1)}</td>
                <td class="${st.cls}">${st.txt}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="9" class="muted" style="padding:8px">${
            trades.length ? "no trades match this filter" : errs.players ? "trades unavailable (" + esc(errs.players) + ")" : "no disclosed trades yet"
          }</td></tr>`;
      const tNote = tRows.length > tShown.length ? `<div class="wl-note">showing ${tShown.length} of ${tRows.length} trades</div>` : "";

      const typeBtn = (id, label) => `<button class="preset ${tradeType === id ? "on" : ""}" data-et="${id}">${label}</button>`;

      root.innerHTML = `<div data-edge-view style="height:100%;overflow:auto"><div class="tabgrid">
        <div class="card c4">
          <h2>Verdict · is there edge? <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">${
            edge ? "generated " + esc(ago(edge.generated_at)) + " ago · " + esc(dstr(sample.from)) + " → " + esc(dstr(sample.to)) : errs.edge ? "edge endpoint unavailable" : "no data"
          }</span> <span class="hint-i" title="Plain-English">i</span></h2>
          <div class="hint">${hintVerdict}</div>
          <div class="body">
            <div class="kpis">
              ${kpiBig("Resolved signals", int(sample.resolved), sample.alerts != null ? int(sample.alerts) + " alerts emitted" : "")}
              ${kpiBig("Window", esc(dstr(sample.from)) + " → " + esc(dstr(sample.to)), "forward-return sample")}
              ${kpiBig("Positive-edge buckets", int(goodBuckets), "n ≥ " + MIN_N + " · excess &gt; 0", goodBuckets ? "pos" : "")}
              ${kpiBig("Resolving", status.resolving ? "yes" : "no", status.last_run ? "last run " + esc(ago(status.last_run)) + " ago" : "–")}
            </div>
            ${
              enough && rankable
                ? `<div class="wl-note">${int(resolved)} resolved · ${int(rankable)} rankable bucket${rankable === 1 ? "" : "s"} (n_ind ≥ ${MIN_N} across ≥5 tickers & ≥2 sessions).</div>`
                : `<div style="margin:5px;padding:7px 9px;border:1px solid rgba(245,158,11,.55);background:rgba(245,158,11,.1);border-radius:5px;color:var(--warn);line-height:1.5">
                    <b>No rankable edge yet — every bucket is low-n.</b> This is the honest state, not a bug.
                    <span class="muted">${int(resolved)} resolved · need independent observations: n_ind ≥ ${MIN_N} across ≥5 tickers and ≥2 sessions. Intraday windows only resolve while the market is open.</span>
                  </div>`
            }
          </div>
        </div>

        <div class="card c4">
          <h2>Edge ranking · buckets by excess return <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">${stats.length} bucket${stats.length === 1 ? "" : "s"} scored</span> <span class="hint-i" title="Plain-English">i</span></h2>
          <div class="hint">${hintRank}</div>
          <div class="body">
            <div class="presets">
              <span class="muted" style="padding:0 4px">horizon:</span>
              <button class="preset ${fHorizon === "all" ? "on" : ""}" data-eh="all">All</button>
              ${horizons.map(hzBtn).join("")}
              <span style="width:8px"></span>
              <span class="muted" style="padding:0 4px">scope:</span>
              <button class="preset ${fScope === "all" ? "on" : ""}" data-es="all">All</button>
              ${scopes.map(scBtn).join("")}
              <span class="spacer" style="flex:1"></span>
              <button class="preset ${hideLowN ? "on" : ""}" data-en="1" title="Hide buckets with fewer than ${MIN_N} resolved signals">Hide n&lt;${MIN_N}</button>
            </div>
            <table><thead>${rankHead}</thead><tbody>${rankBody}</tbody></table>
            ${matched !== stats.length ? `<div class="wl-note">showing ${rows.length} of ${matched} filtered buckets (${stats.length} total)</div>` : rows.length < stats.length ? `<div class="wl-note">showing ${rows.length} of ${stats.length} buckets — low-n hidden</div>` : ""}
          </div>
        </div>

        <div class="card c4">
          <h2>Whales, marked · scored since the alert <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">${whales.length} print${whales.length === 1 ? "" : "s"}</span> <span class="hint-i" title="Plain-English">i</span></h2>
          <div class="hint">${hintWhales}</div>
          <div class="body">
            <table><thead>${whaleHead}</thead><tbody>${whaleBody}</tbody></table>
            ${whaleNote}
          </div>
        </div>

        <div class="card c2">
          <h2>Named players · leaderboard <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">Congress + insiders only</span> <span class="hint-i" title="Plain-English">i</span></h2>
          <div class="hint">${hintPlayers}</div>
          <div class="body">
            <table><thead><tr><th>Person</th><th class="num">n</th><th class="num">Win %</th><th class="num">Avg P&amp;L %</th></tr></thead><tbody>${pBody}</tbody></table>
            ${pNote}
          </div>
        </div>

        <div class="card c2">
          <h2>Named players · recent trades <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">attributable flow</span> <span class="hint-i" title="Plain-English">i</span></h2>
          <div class="hint">${hintPlayers}</div>
          <div class="body">
            <div class="presets">
              ${typeBtn("all", "All")}${typeBtn("congress", "Congress")}${typeBtn("insider", "Insiders")}
            </div>
            <table><thead><tr><th>Person</th><th>Source</th><th>Tkr</th><th>Txn</th><th>Date</th><th class="num">Entry</th><th class="num">Last</th><th class="num">P&amp;L %</th><th>Status</th></tr></thead><tbody>${tBody}</tbody></table>
            ${tNote}
          </div>
        </div>
      </div></div>`;

      root.querySelectorAll("[data-eh]").forEach((b) => {
        b.onclick = () => {
          fHorizon = b.dataset.eh;
          paint();
        };
      });
      root.querySelectorAll("[data-es]").forEach((b) => {
        b.onclick = () => {
          fScope = b.dataset.es;
          paint();
        };
      });
      const en = root.querySelector("[data-en]");
      if (en)
        en.onclick = () => {
          hideLowN = !hideLowN;
          paint();
        };
      root.querySelectorAll("[data-et]").forEach((b) => {
        b.onclick = () => {
          tradeType = b.dataset.et;
          paint();
        };
      });

      const v = root.querySelector("[data-edge-view]");
      if (v) v.scrollTop = prevScroll;
    }

    paint();
  };
})();
