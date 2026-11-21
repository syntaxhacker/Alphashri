/* Shared browser runtime for the reusable report charts.
 *
 * A chart asset registers exactly one renderer:
 *     RV.register("spotPin", function (host, payload, panel) { ... });
 *
 * `payload` is `{spec, data}`; `spec` carries the instrument/units and `data`
 * is the chart-specific series.  The core owns the panel -> renderer dispatch,
 * tooltip lifecycle, colour/format helpers and resize guards so chart modules
 * do not fork them.
 */
(function () {
  "use strict";

  var RV = window.RV = window.RV || { charts: {}, version: "1" };

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  RV.colors = {
    bg: cssVar("--rv-bg", "#000000"),
    surface: cssVar("--rv-surface", "#13161C"),
    raised: cssVar("--rv-raised", "#1F242D"),
    border: cssVar("--rv-border", "#2C313B"),
    text: cssVar("--rv-text", "#E8E8E8"),
    muted: cssVar("--rv-muted", "#9B9B9B"),
    amber: cssVar("--rv-amber", "#D9902A"),
    green: cssVar("--rv-green", "#2FA36B"),
    red: cssVar("--rv-red", "#E5606A"),
    blue: cssVar("--rv-blue", "#4A8FD8"),
    violet: cssVar("--rv-violet", "#8E7CC3")
  };

  RV.fmt = function (value, digits) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return Number(value).toLocaleString("en-IN", {
      minimumFractionDigits: digits === undefined ? 2 : digits,
      maximumFractionDigits: digits === undefined ? 2 : digits
    });
  };
  RV.signed = function (value, digits) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    var shown = RV.fmt(Math.abs(value), digits);
    return (Number(value) > 0 ? "+" : Number(value) < 0 ? "−" : "") + shown;
  };
  RV.pct = function (value, digits) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return RV.signed(value, digits === undefined ? 1 : digits) + "%";
  };
  RV.money = function (spec, value, digits) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return (spec.currency_symbol || "") + RV.fmt(value, digits === undefined ? spec.price_decimals : digits);
  };
  RV.oi = function (value, digits) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    var abs = Math.abs(Number(value));
    if (abs >= 1e7) return RV.fmt(value / 1e7, digits === undefined ? 2 : digits) + " Cr";
    if (abs >= 1e5) return RV.fmt(value / 1e5, digits === undefined ? 2 : digits) + " L";
    return RV.fmt(value, 0);
  };

  RV.tip = function () {
    var tip = document.createElement("div");
    tip.className = "rv-tip";
    tip.setAttribute("role", "status");
    document.body.appendChild(tip);
    return {
      show: function (event, title, rows) {
        tip.innerHTML = '<div class="rv-tt">' + String(title) + "</div>" +
          (rows || []).map(function (row) {
            return '<div class="rv-tr"><span>' + String(row[0]) + "</span><b>" + String(row[1]) + "</b></div>";
          }).join("");
        tip.style.display = "block";
        var x = event.clientX + 12, y = event.clientY + 12;
        var box = tip.getBoundingClientRect();
        if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - 12;
        if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - 12;
        tip.style.left = Math.max(8, x) + "px";
        tip.style.top = Math.max(8, y) + "px";
      },
      hide: function () { tip.style.display = "none"; }
    };
  };

  RV.svg = function (host, height) {
    if (!window.d3) throw new Error("D3 is not available");
    d3.select(host).selectAll("*").remove();
    return d3.select(host).append("svg")
      .attr("viewBox", "0 0 " + Math.max(320, host.clientWidth) + " " + height)
      .attr("preserveAspectRatio", "xMidYMid meet");
  };

  RV.onResize = function (host, draw) {
    var last = 0;
    function run() {
      var width = host.clientWidth;
      if (width && Math.abs(width - last) > 2) {
        last = width;
        try { draw(width); } catch (err) { RV.error(host, err); }
      }
    }
    run();
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(run);
      ro.observe(host);
      host.__rvObserver = ro;
    }
  };

  RV.error = function (host, err) {
    host.innerHTML = '<div class="rv-empty">Chart failed: ' + String(err && err.message ? err.message : err) + "</div>";
  };

  RV.timeTicks = function (labels, maxTicks) {
    if (!labels || !labels.length) return [];
    var n = Math.max(2, maxTicks || 8);
    var step = Math.max(1, Math.ceil(labels.length / n));
    var out = [];
    for (var i = 0; i < labels.length; i += step) out.push(labels[i]);
    var lastIndex = labels.length - 1;
    var previousIndex = out.length ? labels.lastIndexOf(out[out.length - 1]) : -1;
    // Only add the final label when it does not collide with the previous
    // tick; otherwise the axis prints two clocks on top of each other.
    if (lastIndex !== previousIndex && lastIndex - previousIndex >= Math.max(1, Math.floor(step / 2))) {
      out.push(labels[lastIndex]);
    }
    return out;
  };

  RV.plotlyLayout = function (spec, extra) {
    var base = {
      paper_bgcolor: RV.colors.surface,
      plot_bgcolor: RV.colors.surface,
      font: { color: RV.colors.text, family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", size: 10 },
      margin: { l: 44, r: 14, t: 8, b: 28 },
      hovermode: "x unified",
      showlegend: false
    };
    return Object.assign(base, extra || {});
  };

  RV.plotly = function (host, traces, layout, config) {
    if (!window.Plotly) throw new Error("Plotly is not available");
    return Plotly.newPlot(host, traces, layout, Object.assign({
      responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: false
    }, config || {}));
  };

  RV.register = function (name, renderer) {
    if (typeof renderer !== "function") throw new Error("renderer for " + name + " is not a function");
    RV.charts[name] = renderer;
  };

  RV.init = function (root) {
    var scope = root || document;
    var panels = scope.querySelectorAll("[data-rv-chart]");
    panels.forEach(function (panel) {
      if (panel.dataset.rvReady === "1") return;
      var name = panel.getAttribute("data-rv-chart");
      var dataEl = panel.querySelector("script.rv-data");
      var host = panel.querySelector(".rv-chart");
      if (!dataEl || !host) return;
      var payload;
      try { payload = JSON.parse(dataEl.textContent); }
      catch (err) { RV.error(host, err); return; }
      panel.dataset.rvReady = "1";
      var renderer = RV.charts[name];
      if (!renderer) { RV.error(host, "No renderer registered for " + name); return; }
      try { renderer(host, payload, panel); }
      catch (err) { RV.error(host, err); }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { RV.init(document); });
  } else {
    RV.init(document);
  }
})();
