/* News tab — ticker-tagged headlines for a single symbol (/api/news/headlines).
 *
 * The headline feed is live through the premarket and the session (unlike
 * options data, which only exists for completed sessions), so this tab is the
 * "why is it moving?" tab. Rendered by symbol.js as UW.PANELS.news.
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, int, tk, table, card, kpiBig } = U.util;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const note = (t) => `<div class="muted" style="padding:6px">${esc(t)}</div>`;

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
  const sentPill = (s) =>
    s ? `<span class="pill ${s === "bullish" ? "buy" : s === "bearish" ? "sell" : ""}">${esc(s)}</span>` : '<span class="muted">–</span>';

  U.PANELS.news = {
    title: "News",
    render(d, payload) {
      d = d || {};
      const ticker = String((payload && payload.ticker) || "").toUpperCase();
      const raw = d.news;
      if (raw && raw.__error) return card("News", note("news feed unavailable: " + (raw.message || raw.__error)), 2);
      const items = arr(raw).filter((r) => r && typeof r === "object");
      const major = items.filter((r) => r.is_major).length;
      const bull = items.filter((r) => String(r.sentiment || "").toLowerCase() === "bullish").length;
      const bear = items.filter((r) => String(r.sentiment || "").toLowerCase() === "bearish").length;
      const latest = items.length ? items[0].created_at : null;

      const kpis =
        kpiBig("Headlines", int(items.length), "latest " + (latest ? ago(latest) + " ago" : "–")) +
        kpiBig("Major", int(major), "market-moving flag") +
        kpiBig("Bullish", int(bull), "headline sentiment", "pos") +
        kpiBig("Bearish", int(bear), "headline sentiment", "neg");

      const rows = items.slice(0, 60);
      const body = table(
        [
          { label: "Ago" },
          { label: "Source" },
          { label: "Sent" },
          { label: "!" },
          { label: "Headline" },
          { label: "Also" },
        ],
        rows,
        (r) => {
          const others = (r.tickers || []).filter((t) => t && t !== ticker);
          return `<tr>
            <td class="muted" title="${esc(r.created_at || "")}">${esc(ago(r.created_at))}</td>
            <td class="muted">${esc(r.source || "")}</td>
            <td>${sentPill(String(r.sentiment || "").toLowerCase())}</td>
            <td>${r.is_major ? '<span class="pos" title="major">★</span>' : ""}</td>
            <td style="white-space:normal">${esc(r.headline || "")}</td>
            <td>${others.slice(0, 3).map((t) => tk(t)).join(" ")}</td>
          </tr>`;
        }
      );

      return (
        card("Headline flow · ticker-tagged", `<div class="kpis">${kpis}</div>`, 4) +
        card("Latest headlines", body + '<div class="wl-note">live feed · <b>Ago</b> = how long before now · <b>★</b> = flagged major/price-moving · click any ticker to jump</div>', 4)
      );
    },
    info: {
      title: "News",
      tagline: "Ticker-tagged headlines — why is it moving?",
      sections: [
        {
          h: "What this tab shows",
          p: `<p>Recent news for this ticker plus every other ticker each headline is tagged with. The feed updates through the <b>premarket</b> and the session, so it is the fastest way to explain a move when options flow still reflects the previous session.</p>`,
        },
        {
          h: "Panels",
          p: `<ul><li><b>Headline flow · ticker-tagged</b> — counts of headlines, how many are flagged <b>major</b> (price-moving), and the bullish/bearish split from headline sentiment, plus how long ago the latest one landed.</li><li><b>Latest headlines</b> — <code>created_at</code> (relative "Ago"), <code>source</code>, <code>sentiment</code>, the <b>major</b> flag, the <code>headline</code>, and any other <code>tickers</code> mentioned.</li></ul>`,
        },
        {
          h: "How to read it",
          p: `<p>Treat a single headline as noise; a <b>cluster</b> of major headlines in one direction is the signal. Pair it with the Flow/Whales tabs: if headlines are bullish and call premium is building, the move has a story behind it. If price moves against the headlines, the crowd is leaning the other way — often a fade setup.</p>`,
        },
        {
          h: "Caveats",
          p: `<ul><li>Sentiment is the provider's headline classifier, not a price prediction.</li><li>Wire headlines are duplicated across tickers — the same story can appear for several names.</li><li>Not every headline has a ticker tag; untagged items show no chips.</li></ul>`,
        },
      ],
    },
  };
})();
