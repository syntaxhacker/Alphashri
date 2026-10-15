/* Tape — live 1m/5m/15m/30m movers for the watchlist + liquid defaults.
 * Reachable at #/tape. Auto-refreshes every 30s while visible (server TTL
 * caps cost: 60s market-open, 15 min closed).
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, num, signCls, tk } = U.util;

  const DEFAULTS = ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "MSFT", "AMD", "META", "AMZN", "MU", "SNDK", "BE"];
  const COLS = [
    { k: "ticker", label: "Ticker" },
    { k: "last", label: "Last", num: true, fmt: (v) => num(v, 2) },
    { k: "c1", label: "1m %", num: true, pct: true },
    { k: "c5", label: "5m %", num: true, pct: true },
    { k: "c15", label: "15m %", num: true, pct: true },
    { k: "c30", label: "30m %", num: true, pct: true },
    { k: "surge", label: "Vol×", num: true, fmt: (v) => num(v, 2) + "x" },
    { k: "spark", label: "40m", spark: true },
  ];

  let sortKey = "c5", desc = true, timer = null;

  function sparkSvg(vals, up) {
    const v = (vals || []).filter((x) => x != null);
    if (v.length < 2) return "";
    const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const d = v.map((val, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * 72).toFixed(1)},${(20 - ((val - min) / span) * 20).toFixed(1)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 72 20" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${up ? "#16a34a" : "#dc2626"}" stroke-width="1.4"/></svg>`;
  }

  function cell(c, r) {
    if (c.k === "ticker") return `<td>${tk(r.ticker)}</td>`;
    const v = r[c.k];
    if (c.spark) {
      const up = v && v.length > 1 && v[v.length - 1] >= v[0];
      return `<td>${sparkSvg(v, up)}</td>`;
    }
    if (v == null) return `<td class="num muted">–</td>`;
    const txt = c.pct ? (v >= 0 ? "+" : "") + v.toFixed(2) + "%" : c.fmt(v);
    return `<td class="num ${signCls(v)}">${txt}</td>`;
  }

  async function load() {
    const watched = U.watch ? U.watch.list() : [];
    const tickers = [...new Set([...watched, ...DEFAULTS])].slice(0, 20);
    const res = await fetch("/api/tape?t=" + tickers.map(encodeURIComponent).join(","));
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function paint(root, rows, marketOpen, asof) {
    const data = rows
      .slice()
      .sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (sortKey === "ticker") return desc ? String(b.ticker).localeCompare(a.ticker) : String(a.ticker).localeCompare(b.ticker);
        if (av == null) return 1;
        if (bv == null) return -1;
        return desc ? bv - av : av - bv;
      });
    const head = COLS.map(
      (c) => `<th class="${c.num ? "num" : ""} ${c.k === sortKey ? "on" : ""}" data-k="${c.spark ? "" : c.k}">${c.label}${c.k === sortKey ? (desc ? " ▾" : " ▴") : ""}</th>`
    ).join("");
    root.innerHTML = `<div class="tabgrid snap">
      <div class="card c4">
        <h2>Tape · 1m/5m/15m/30m movers ${marketOpen ? '<span class="pos">● live</span>' : '<span class="muted">market closed</span>'} <span class="muted" style="font-weight:400">${esc(asof || "")}</span> <span class="hint-i" title="plain-English">i</span></h2>
        <div class="hint">Live momentum scan of your <b>watchlist</b> (★ any symbol to add it) plus liquid defaults. <b>1m/5m/15m/30m %</b> = price change over that window; <b>Vol×</b> = last-5-minute volume vs its median (2x+ = something happening). Click a column to sort — sort 5m % to catch the fastest movers. Auto-refreshes every 30s.</div>
        <div class="body"><table class="screen"><thead><tr>${head}</tr></thead><tbody>${data
          .map((r) => (r.error ? `<tr><td>${esc(r.ticker)}</td><td colspan="${COLS.length - 1}" class="muted">no data</td></tr>` : `<tr>${COLS.map((c) => cell(c, r)).join("")}</tr>`))
          .join("")}</tbody></table></div>
      </div>
    </div>`;
    root.querySelectorAll("th[data-k]").forEach((th) => {
      if (!th.dataset.k) return;
      th.onclick = () => {
        const k = th.dataset.k;
        if (k === sortKey) desc = !desc;
        else {
          sortKey = k;
          desc = k !== "ticker";
        }
        paint(root, rows, marketOpen, asof);
      };
    });
  }

  U.renderTape = async function (root) {
    if (U._tapeTimer) {
      clearInterval(U._tapeTimer);
      U._tapeTimer = null;
    }
    root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading tape…</div></div></div>';
    const tick = async () => {
      try {
        const d = await load();
        const stamp = (d.rows || []).map((r) => r.time).filter(Boolean).sort().pop();
        paint(root, d.rows || [], d.market_open, stamp ? "as of " + stamp + " ET" : "");
      } catch (e) {
        root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
      }
    };
    await tick();
    U._tapeTimer = setInterval(() => {
      if (location.hash.startsWith("#/tape")) tick();
    }, 30000);
  };
})();
