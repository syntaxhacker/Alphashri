/* News — market-wide ticker-tagged headline feed. Reachable at #/news.
 *
 * Live through premarket + session (source /api/news -> /api/news/headlines).
 * Presets + free-text search; every ticker chip jumps to its symbol view.
 */
(function () {
  const U = (window.UW = window.UW || {});
  const { esc, tk } = U.util;

  const PRESETS = [
    { id: "all", label: "All" },
    { id: "major", label: "Major only" },
    { id: "bullish", label: "Bullish" },
    { id: "bearish", label: "Bearish" },
    { id: "tickers", label: "Ticker-tagged" },
  ];

  function ago(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (isNaN(t)) return String(iso).slice(11, 16);
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return Math.max(1, Math.round(s)) + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }

  const sentCls = (s) => (s === "bullish" ? "pos" : s === "bearish" ? "neg" : "muted");

  // kept at module scope so auto-refresh doesn't reset the user's filter
  let preset = "all";
  let query = "";

  U.renderNews = async function (root) {
    const nav = U.navSeq || 0;
    root.innerHTML = '<div class="tabgrid snap"><div class="card c4"><div class="body muted" style="padding:10px">Loading news…</div></div></div>';
    let payload;
    try {
      const res = await fetch("/api/news?limit=100");
      if (!res.ok) throw new Error("HTTP " + res.status);
      payload = await res.json();
    } catch (e) {
      root.innerHTML = `<div class="tabgrid snap"><div class="card c4"><div class="body err">Failed: ${esc(e.message)}</div></div></div>`;
      return;
    }
    if ((U.navSeq || 0) !== nav) return; // route changed while loading
    const items = payload.items || [];

    function match(it) {
      if (preset === "major" && !it.is_major) return false;
      if (preset === "bullish" && String(it.sentiment || "").toLowerCase() !== "bullish") return false;
      if (preset === "bearish" && String(it.sentiment || "").toLowerCase() !== "bearish") return false;
      if (preset === "tickers" && !(it.tickers || []).length) return false;
      if (query) {
        const q = query.toUpperCase();
        const inText = String(it.headline || "").toUpperCase().includes(q) || String(it.source || "").toUpperCase().includes(q);
        const inTk = (it.tickers || []).some((t) => t.includes(q));
        if (!inText && !inTk) return false;
      }
      return true;
    }

    function paint() {
      const rows = items.filter(match).slice(0, 120);
      const max = Math.max(1, items.length);
      const body = rows.length
        ? rows
            .map(
              (r) => `<tr>
                <td class="muted" title="${esc(r.created_at || "")}">${esc(ago(r.created_at))}</td>
                <td>${(r.tickers || []).slice(0, 4).map((t) => tk(t)).join(" ") || '<span class="muted">–</span>'}</td>
                <td>${r.is_major ? '<span class="pos" title="major / price-moving">★</span>' : '<span class="muted">·</span>'}</td>
                <td class="${sentCls(String(r.sentiment || "").toLowerCase())}">${esc(r.sentiment || "–")}</td>
                <td style="white-space:normal">${esc(r.headline || "")}</td>
                <td class="muted">${esc(r.source || "")}</td>
              </tr>`
            )
            .join("")
        : `<tr><td colspan="6" class="muted" style="padding:8px">no headlines for this filter — clear the search or pick the All preset.</td></tr>`;

      root.innerHTML = `<div class="tabgrid snap">
        <div class="card c4">
          <h2>News · ticker-tagged headlines <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">${rows.length}/${items.length} shown · updated ${esc(ago(payload.generated_at))} ago</span> <span class="hint-i" title="Plain-English">i</span></h2>
          <div class="hint">Live headline wire (<b>/api/news/headlines</b>) — updates through the <b>premarket</b> and the session. <b>★</b> = flagged major (price-moving). <b>Ago</b> = how long before now. <span class="pos">bullish</span>/<span class="neg">bearish</span> is the provider's headline sentiment. Click any ticker chip to jump to its symbol view.</div>
          <div class="body">
            <div class="presets">
              ${PRESETS.map((p) => `<button class="preset ${p.id === preset ? "on" : ""}" data-np="${p.id}">${p.label}</button>`).join("")}
              <input id="news-q" placeholder="Filter text or ticker…" autocomplete="off" spellcheck="false" value="${esc(query)}"
                     style="background:var(--panel2);border:1px solid var(--border);border-radius:4px;color:var(--text);font:inherit;font-size:10px;padding:2px 8px;outline:none;min-width:180px" />
            </div>
            <table><thead><tr><th>Ago</th><th>Tickers</th><th>★</th><th>Sent</th><th>Headline</th><th>Source</th></tr></thead><tbody>${body}</tbody></table>
          </div>
        </div>
      </div>`;
      root.querySelectorAll("[data-np]").forEach((b) => {
        b.onclick = () => {
          preset = b.dataset.np;
          paint();
        };
      });
      const qi = root.querySelector("#news-q");
      if (qi) {
        qi.oninput = () => {
          query = qi.value.trim();
          const pos = qi.selectionStart;
          paint();
          const nq = root.querySelector("#news-q");
          if (nq) {
            nq.focus();
            try {
              nq.setSelectionRange(pos, pos);
            } catch (e) {
              /* ignore */
            }
          }
        };
      }
    }

    paint();
    // adaptive auto-refresh (fast while the market is open, cheap when shut)
    if (U._newsTimer) clearInterval(U._newsTimer);
    const tick = () => {
      if (location.hash.startsWith("#/news")) U.renderNews(root);
      else {
        clearInterval(U._newsTimer);
        U._newsTimer = null;
      }
    };
    U._newsTimer = U.every ? U.every("news", tick) : setInterval(tick, 60000);
  };
})();
