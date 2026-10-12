/* Freshness / adaptive polling.
 *
 * Loads the server's market phase + poll policy (/api/status, see
 * scripts/market_status.py) so views poll FAST while the US market is open and
 * slowly when it is shut — and never poll while the tab is hidden or the docs
 * drawer is open. Views should use UW.every("<kind>", fn) instead of a raw
 * setInterval.
 */
(function () {
  const U = (window.UW = window.UW || {});
  U.FRESH = { phase: "closed", poll_ms: {}, ttl_s: {}, loaded: 0 };

  U.loadFreshness = async function () {
    try {
      const r = await fetch("/api/status");
      if (!r.ok) return U.FRESH;
      const d = await r.json();
      if (d && d.poll_ms) {
        U.FRESH = d;
        U.FRESH.loaded = Date.now();
        const badge = document.getElementById("phase");
        if (badge) {
          const on = d.phase === "open";
          badge.textContent = d.phase;
          badge.style.borderColor = on ? "rgba(34,197,94,.6)" : "";
          badge.style.color = on ? "#22c55e" : "";
          badge.title = "US market: " + d.phase + " · " + (d.et || "") + (d.policy ? "\n" + d.policy[d.phase] : "");
        }
      }
    } catch (e) {
      /* offline — keep the last policy */
    }
    return U.FRESH;
  };

  U.pollMs = function (kind) {
    const p = (U.FRESH && U.FRESH.poll_ms) || {};
    return p[kind] || p.default || 60000;
  };

  // slower cadence used by the background alert watcher on a hidden tab
  U.pollHidden = function (kind) {
    const p = (U.FRESH && U.FRESH.poll_ms_hidden) || {};
    return p[kind] || p.default || 300000;
  };

  U.isVisible = function () {
    return document.visibilityState === "visible" && !(U.isInfoOpen && U.isInfoOpen());
  };

  // setInterval gated on visibility; returns the timer id (clearInterval to stop)
  U.every = function (kind, fn) {
    const ms = typeof kind === "string" ? U.pollMs(kind) : Number(kind) || 60000;
    return setInterval(function () {
      if (U.isVisible()) fn();
    }, ms);
  };

  // re-entrant-safe helper for older call sites that want the raw interval
  U.everyMs = function (kind) {
    return typeof kind === "string" ? U.pollMs(kind) : Number(kind) || 60000;
  };
})();
