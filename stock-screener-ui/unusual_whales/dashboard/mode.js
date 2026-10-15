/* UW.mode — global "Intraday | EOD | All" view filter.
 *
 * README / CONTRACT (other dashboard files rely on exactly this):
 *   UW.mode.get()          -> "all" | "intraday" | "eod"   (localStorage "uw_mode", default "intraday")
 *   UW.mode.set(m)         -> validate + persist + repaint the header toggle + notify listeners
 *   UW.mode.visible(kind)  -> kind "always" | "intraday" | "eod"; true for "always",
 *                             otherwise true when get() === "all" || get() === kind
 *   UW.mode.on(fn)         -> subscribe; fn(mode) runs after each set(); returns an unsubscribe fn
 *
 * Semantics:
 *   - "all"      : show every panel (both groups, labelled).
 *   - "intraday" : show intraday-only panels (+ everything tagged "always").
 *   - "eod"      : show end-of-day / swing panels (+ everything tagged "always").
 *
 * Tagging convention: HTML elements carry data-mode="always|intraday|eod".
 * Consumers call UW.mode.visible(el.dataset.mode) to decide visibility and
 * UW.mode.on(...) to re-render when the user flips the header toggle.
 *
 * The toggle itself is static markup (#mode-seg with buttons[data-mode]); this
 * file only wires the clicks and paints the active button with class "on".
 * Idempotent (safe to load twice), never throws, no dependencies.
 */
(function () {
  var root = typeof window !== "undefined" ? window
           : (typeof globalThis !== "undefined" ? globalThis : null);
  if (!root) return;
  var U = (root.UW = root.UW || {});
  if (U.mode) return;

  var KEY = "uw_mode";
  var MODES = ["all", "intraday", "eod"];
  var DEFAULT = "intraday"; // primary workflow — EOD/All stay one click away
  var listeners = [];
  var state = read();

  function normalize(m) {
    return MODES.indexOf(m) >= 0 ? m : DEFAULT;
  }

  function read() {
    try {
      var v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
      return normalize(v);
    } catch (e) {
      return DEFAULT;
    }
  }

  function persist(m) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(KEY, m);
    } catch (e) {
      /* private mode / storage disabled — mode still works in-memory */
    }
  }

  function paint() {
    if (typeof document === "undefined") return;
    try {
      var seg = document.getElementById("mode-seg");
      if (!seg) return;
      var btns = seg.querySelectorAll("[data-mode]");
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.getAttribute("data-mode") === state) b.classList.add("on");
        else b.classList.remove("on");
      }
    } catch (e) {
      /* missing / broken DOM — nothing to paint */
    }
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](state);
      } catch (e) {
        /* a listener error must never break the toggle */
      }
    }
  }

  U.mode = {
    get: function () {
      return state;
    },
    set: function (m) {
      state = normalize(m);
      persist(state);
      paint();
      notify();
      return state;
    },
    visible: function (kind) {
      var k = kind == null ? "always" : String(kind);
      if (k === "always" || (k !== "intraday" && k !== "eod")) return true;
      return state === "all" || state === k;
    },
    on: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
  };

  function wire() {
    if (typeof document === "undefined") return;
    try {
      var seg = document.getElementById("mode-seg");
      if (seg && !seg.__uwModeWired) {
        seg.__uwModeWired = true;
        seg.addEventListener("click", function (ev) {
          var t = ev.target;
          var b = t && t.closest ? t.closest("[data-mode]") : null;
          if (!b || !seg.contains(b)) return;
          ev.preventDefault();
          U.mode.set(b.getAttribute("data-mode"));
        });
      }
      paint();
    } catch (e) {
      /* no header toggle on this page — nothing to wire */
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
    else wire();
  }
})();
