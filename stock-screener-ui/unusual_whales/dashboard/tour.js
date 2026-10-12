/* First-visit guided tour for the symbol "Today" view.
 *
 * Self-contained: injects its own <style>, creates its own DOM (backdrop,
 * spotlight ring, tooltip card) and never requires changes to index.html.
 *
 * API (on window.UW):
 *   UW.tour.auto(ticker)   run once per browser (localStorage "uw_tour_done")
 *   UW.tour.start(ticker)  replay manually
 *   UW.tour.end()          dismiss / clean up
 *
 * Steps point at ids created by the Today panel. Missing targets are skipped.
 * Everything is wrapped so a failure can never break the host page.
 */
(function () {
  const U = (window.UW = window.UW || {});
  if (U.tour) return; // already installed

  const STORAGE_KEY = "uw_tour_done";
  const WAIT_MS = 4500; // how long auto() waits for the Today panel to mount
  const POLL_MS = 120;
  const MARGIN = 8; // viewport clamp breathing room
  const RING_PAD = 6; // spotlight padding around the target rect

  const STEPS = [
    { sel: "#sym-tabs", text: "Today is your one-screen daily view. Start here." },
    {
      sel: "#td-strip",
      text: "Bias + key dealer levels: call wall, put wall, gamma flip, magnet and how far spot is from each.",
    },
    {
      sel: "#td-chart",
      text: "Intraday 5m chart with those levels drawn — watch price reaction at the flip and walls.",
    },
    {
      sel: "#td-heat",
      text: "Dealer exposure by strike × expiry. Vertical walls = pin levels; switch GEX/VEX/Delta/Charm.",
    },
    { sel: "#td-brief", text: "The checklist: what's aligned for today and what to watch." },
  ];

  const CSS = [
    ".uw-tour-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:transparent;cursor:pointer}",
    ".uw-tour-ring{position:fixed;z-index:2147483001;pointer-events:none;border-radius:8px;",
    "  box-shadow:0 0 0 2px var(--accent),0 0 0 9999px rgba(3,6,10,.62),0 0 0 5px rgba(59,130,246,.20);",
    "  transition:top .16s ease,left .16s ease,width .16s ease,height .16s ease;",
    "  animation:uw-tour-pulse 1.8s ease-in-out infinite}",
    "@keyframes uw-tour-pulse{",
    "  0%,100%{box-shadow:0 0 0 2px var(--accent),0 0 0 9999px rgba(3,6,10,.62),0 0 0 5px rgba(59,130,246,.18)}",
    "  50%{box-shadow:0 0 0 2px var(--accent),0 0 0 9999px rgba(3,6,10,.62),0 0 0 10px rgba(59,130,246,.34)}}",
    ".uw-tour-card{position:fixed;z-index:2147483002;width:max-content;max-width:300px;min-width:210px;",
    "  background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;",
    "  box-shadow:0 10px 34px rgba(0,0,0,.6);padding:9px 10px 8px;font-size:11px;line-height:1.45}",
    ".uw-tour-card .uw-t-head{display:flex;align-items:center;gap:6px;margin:0 0 5px;",
    "  color:var(--muted);font-size:9.5px;text-transform:uppercase;letter-spacing:.5px}",
    ".uw-tour-card .uw-t-head b{color:var(--accent);font-weight:700}",
    ".uw-tour-card .uw-t-head .uw-t-tk{margin-left:auto;color:var(--text);font-weight:600}",
    ".uw-tour-card .uw-t-txt{margin:0 0 8px;color:var(--text)}",
    ".uw-tour-card .uw-t-foot{display:flex;align-items:center;gap:6px;justify-content:flex-end}",
    ".uw-tour-card button{font:inherit;font-size:10px;border-radius:4px;padding:3px 9px;cursor:pointer}",
    ".uw-tour-card .uw-t-skip{background:transparent;border:1px solid var(--border);color:var(--muted)}",
    ".uw-tour-card .uw-t-skip:hover{color:var(--text);border-color:var(--accent)}",
    ".uw-tour-card .uw-t-back{background:transparent;border:1px solid var(--border);color:var(--text)}",
    ".uw-tour-card .uw-t-back:disabled{opacity:.4;cursor:default}",
    ".uw-tour-card .uw-t-next{background:var(--accent);border:0;color:#fff;font-weight:600}",
  ].join("\n");

  let state = null; // active tour: { ticker, steps, i, nodes, onKey, onResize, onScroll }
  let waitTimer = null; // pending auto() start
  let autoTicker = "";
  let raf = null;

  const esc = (s) =>
    s == null
      ? ""
      : String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const q = (sel) => {
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  };

  const hasTodayTarget = () => STEPS.some((s) => s.sel !== "#sym-tabs" && q(s.sel));

  // ---- localStorage (never throws in private mode) -------------------------
  function isDone() {
    try {
      return !!localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return false;
    }
  }
  function markDone() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch (e) {
      /* storage unavailable — tour will simply show again */
    }
  }

  // ---- style ---------------------------------------------------------------
  function injectCss() {
    try {
      if (document.getElementById("uw-tour-style")) return;
      const s = document.createElement("style");
      s.id = "uw-tour-style";
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      /* styling is best-effort */
    }
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ---- geometry ------------------------------------------------------------
  function place() {
    if (!state) return;
    const st = state.steps[state.i];
    if (!st) return end();
    const target = q(st.sel);
    if (!target) return next(); // target vanished (re-render) → skip gracefully

    const n = state.nodes;
    const r = target.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

    // spotlight ring (fixed = same coordinate space as getBoundingClientRect)
    const rTop = Math.max(0, r.top - RING_PAD);
    const rLeft = Math.max(0, r.left - RING_PAD);
    const rW = Math.max(8, Math.min(vw - rLeft, r.width + RING_PAD * 2));
    const rH = Math.max(8, Math.min(vh - rTop, r.height + RING_PAD * 2));
    n.ring.style.top = rTop + "px";
    n.ring.style.left = rLeft + "px";
    n.ring.style.width = rW + "px";
    n.ring.style.height = rH + "px";

    // tooltip card: prefer below, fall back above, clamp inside viewport
    const cw = n.card.offsetWidth || 240;
    const ch = n.card.offsetHeight || 110;
    let cTop = r.bottom + 10;
    if (cTop + ch > vh - MARGIN) {
      const above = r.top - 10 - ch;
      cTop = above >= MARGIN ? above : Math.max(MARGIN, vh - ch - MARGIN);
    }
    let cLeft = r.left + (r.width - cw) / 2;
    cLeft = Math.max(MARGIN, Math.min(cLeft, vw - cw - MARGIN));
    cTop = Math.max(MARGIN, Math.min(cTop, vh - ch - MARGIN));
    n.card.style.top = cTop + "px";
    n.card.style.left = cLeft + "px";
  }

  function schedule() {
    try {
      if (typeof requestAnimationFrame !== "function") return place();
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        try {
          place();
        } catch (e) {
          /* ignore */
        }
      });
    } catch (e) {
      /* ignore */
    }
  }

  // ---- card ----------------------------------------------------------------
  function paint() {
    if (!state) return;
    const st = state.steps[state.i];
    if (!st) return end();
    const last = state.i === state.steps.length - 1;
    const n = state.nodes;
    const tk = state.ticker ? `<span class="uw-t-tk">${esc(state.ticker)}</span>` : "";
    n.card.innerHTML =
      `<div class="uw-t-head"><b>Tour</b><span>${state.i + 1} / ${state.steps.length}</span>${tk}</div>` +
      `<p class="uw-t-txt">${esc(st.text)}</p>` +
      `<div class="uw-t-foot">` +
      `<button type="button" class="uw-t-skip">Skip</button>` +
      `<button type="button" class="uw-t-back"${state.i === 0 ? " disabled" : ""}>Back</button>` +
      `<button type="button" class="uw-t-next">${last ? "Done" : "Next"}</button>` +
      `</div>`;

    const skip = n.card.querySelector(".uw-t-skip");
    const back = n.card.querySelector(".uw-t-back");
    const nextB = n.card.querySelector(".uw-t-next");
    if (skip) skip.onclick = () => end();
    if (back) back.onclick = () => prev();
    if (nextB) nextB.onclick = () => (last ? end() : next());

    place();
    try {
      if (nextB && typeof nextB.focus === "function") nextB.focus({ preventScroll: true });
    } catch (e) {
      /* focus is best-effort */
    }
  }

  function next() {
    if (!state) return;
    if (state.i >= state.steps.length - 1) return end();
    state.i += 1;
    paint();
  }

  function prev() {
    if (!state) return;
    if (state.i <= 0) return;
    state.i -= 1;
    paint();
  }

  // ---- lifecycle -----------------------------------------------------------
  function onKey(e) {
    if (!state || !e) return;
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault();
      return end();
    }
    if (k === "ArrowRight") {
      e.preventDefault();
      return next();
    }
    if (k === "ArrowLeft") {
      e.preventDefault();
      return prev();
    }
    if (k === "Enter") {
      // Activate a focused card button directly; otherwise treat Enter as Next.
      // preventDefault stops the browser from also firing the default button
      // activation, so a focused Next is never advanced twice.
      e.preventDefault();
      const ae = document.activeElement;
      if (ae && ae.tagName === "BUTTON" && state.nodes.card.contains(ae) && typeof ae.click === "function") {
        ae.click();
        return;
      }
      next();
    }
  }

  function cleanup() {
    try {
      if (raf != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(raf);
        raf = null;
      }
      if (waitTimer != null) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
      if (state) {
        window.removeEventListener("resize", state.onResize);
        window.removeEventListener("scroll", state.onScroll, true);
        document.removeEventListener("keydown", state.onKey, true);
        const n = state.nodes;
        if (n.backdrop && n.backdrop.parentNode) n.backdrop.parentNode.removeChild(n.backdrop);
        if (n.ring && n.ring.parentNode) n.ring.parentNode.removeChild(n.ring);
        if (n.card && n.card.parentNode) n.card.parentNode.removeChild(n.card);
      }
    } catch (e) {
      /* ignore */
    }
    state = null;
  }

  function end() {
    cleanup();
  }

  function start(ticker) {
    try {
      cleanup();
      const steps = STEPS.filter((s) => !!q(s.sel));
      if (!steps.length) return false;
      injectCss();

      const backdrop = el("div", "uw-tour-backdrop");
      const ring = el("div", "uw-tour-ring");
      const card = el("div", "uw-tour-card");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-live", "polite");
      (document.body || document.documentElement).appendChild(backdrop);
      (document.body || document.documentElement).appendChild(ring);
      (document.body || document.documentElement).appendChild(card);

      backdrop.addEventListener("click", end);

      state = {
        ticker: ticker || "",
        steps,
        i: 0,
        nodes: { backdrop, ring, card },
        onKey,
        onResize: schedule,
        onScroll: schedule,
      };
      window.addEventListener("resize", schedule);
      window.addEventListener("scroll", schedule, true);
      document.addEventListener("keydown", onKey, true);

      paint();
      return true;
    } catch (e) {
      try {
        end();
      } catch (e2) {
        /* ignore */
      }
      return false;
    }
  }

  function auto(ticker) {
    try {
      if (isDone() || state) return;
      autoTicker = ticker || autoTicker;
      if (waitTimer != null) return; // already waiting

      const t0 = Date.now();
      const poll = () => {
        waitTimer = null;
        try {
          if (isDone() || state) return;
          // Prefer the full Today tour: give the async panel a moment to mount.
          if (hasTodayTarget()) {
            if (start(autoTicker)) markDone();
            return;
          }
          if (Date.now() - t0 >= WAIT_MS) {
            // No Today panel found — still honour "once per browser" by starting
            // with whatever is present (at minimum #sym-tabs), else retry later.
            if (q("#sym-tabs") && start(autoTicker)) markDone();
            return;
          }
          waitTimer = setTimeout(poll, POLL_MS);
        } catch (e) {
          waitTimer = null;
        }
      };
      poll();
    } catch (e) {
      waitTimer = null;
    }
  }

  U.tour = {
    auto,
    start(ticker) {
      try {
        return start(ticker);
      } catch (e) {
        return false;
      }
    },
    end() {
      try {
        end();
      } catch (e) {
        /* ignore */
      }
    },
  };
})();
