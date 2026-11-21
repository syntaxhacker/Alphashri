/* Tape-session renderers, the Plotly 3D OI surface and the volatility extras.
 *
 * Every renderer is registered by the same name the Python builder passes to
 * `panel()`; payloads are `{spec, data}` and `spec` is the only source of
 * currency, price decimals and session clock.  2D charts are hand-drawn D3
 * (crisp at 390px); only the 3D surface uses Plotly, through `RV.plotly`.
 */
(function () {
  "use strict";

  var C = RV.colors;
  var NARROW = 520;
  var MONO = "var(--rv-mono)";
  var FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  function clear(host) {
    if (host.__rvTip) host.__rvTip.hide();
    d3.select(host).selectAll("*").remove();
  }

  function hostTip(host) {
    if (!host.__rvTip) host.__rvTip = RV.tip();
    return host.__rvTip;
  }

  function empty(host, message) {
    clear(host);
    d3.select(host)
      .append("div")
      .style("color", "var(--rv-muted)")
      .style("font-size", "11px")
      .style("padding", "22px 14px")
      .text(message || "No data for this window");
  }

  function compact(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return "—";
    var abs = Math.abs(Number(value));
    if (abs >= 1e9) return RV.fmt(value / 1e9, 2) + "B";
    if (abs >= 1e6) return RV.fmt(value / 1e6, 2) + "M";
    if (abs >= 1e3) return RV.fmt(value / 1e3, 1) + "k";
    return RV.fmt(value, 0);
  }

  function priceFormat(spec, span) {
    var digits = span > 500 ? 0 : span > 50 ? 1 : Number(spec.price_decimals || 2);
    return function (value) { return RV.fmt(value, digits); };
  }

  function extent(arrays) {
    var lo = Infinity, hi = -Infinity;
    (arrays || []).forEach(function (values) {
      (values || []).forEach(function (value) {
        if (value === null || value === undefined || !isFinite(Number(value))) return;
        lo = Math.min(lo, Number(value));
        hi = Math.max(hi, Number(value));
      });
    });
    return lo === Infinity ? null : [lo, hi];
  }

  function tickIndices(count, wanted) {
    if (count <= 1) return [0];
    var step = Math.max(1, Math.ceil((count - 1) / Math.max(1, wanted - 1)));
    var out = [];
    for (var i = 0; i < count; i += step) out.push(i);
    if (out[out.length - 1] !== count - 1) out.push(count - 1);
    return out;
  }

  function clock(open, minutes) {
    var parts = String(open || "00:00").split(":");
    var total = (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0) + Math.round(Number(minutes) || 0);
    total = ((total % 1440) + 1440) % 1440;
    var hh = Math.floor(total / 60), mm = total % 60;
    return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function frame(host, width, height) {
    var W = Math.max(300, Math.round(width || host.clientWidth || 360));
    var H = Math.max(150, Math.round(height || host.clientHeight || 280));
    clear(host);
    var svg = d3.select(host)
      .append("svg")
      .attr("viewBox", "0 0 " + W + " " + H)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("role", "img")
      .style("font-family", MONO)
      .style("font-variant-numeric", "tabular-nums");
    return { svg: svg, W: W, H: H };
  }

  function axisLine(g, x1, x2, y) {
    g.append("line")
      .attr("x1", x1).attr("x2", x2).attr("y1", y).attr("y2", y)
      .attr("stroke", C.border).attr("stroke-width", 1);
  }

  function gridLine(g, x1, x2, y) {
    g.append("line")
      .attr("x1", x1).attr("x2", x2).attr("y1", y).attr("y2", y)
      .attr("stroke", C.border).attr("stroke-opacity", 0.55).attr("stroke-width", 1);
  }

  function tickText(g, x, y, text, anchor, color) {
    return g.append("text")
      .attr("x", x).attr("y", y).attr("text-anchor", anchor || "middle")
      .attr("fill", color || C.muted).attr("font-size", 9)
      .text(text);
  }

  function signedCompact(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return "—";
    return (Number(value) < 0 ? "−" : Number(value) > 0 ? "+" : "") + compact(Math.abs(value));
  }

  /* ---- 2D line chart ------------------------------------------------ */
  function lineChart(host, cfg) {
    RV.onResize(host, function (width) {
      var labels = cfg.labels || [];
      if (!labels.length) { empty(host, cfg.empty); return; }
      var narrow = width < NARROW;
      var t = frame(host, width, cfg.height || host.clientHeight || 280);
      var m = {
        l: narrow ? 40 : 48,
        r: cfg.y2 ? (narrow ? 38 : 46) : 12,
        t: 12,
        b: 26
      };
      var iw = t.W - m.l - m.r;
      var ih = t.H - m.t - m.b;
      if (iw <= 12 || ih <= 12) { empty(host, cfg.empty); return; }

      var main = [];
      (cfg.series || []).forEach(function (s) {
        if (s.axis !== "y2") main.push(s.values);
      });
      (cfg.hlines || []).forEach(function (h) {
        if (h.value !== null && h.value !== undefined) main.push([h.value]);
      });
      var domain = extent(main);
      if (!domain) { empty(host, cfg.empty); return; }
      var pad = (domain[1] - domain[0]) * 0.06 || Math.abs(domain[1] || 1) * 0.01;
      var x = d3.scaleLinear()
        .domain([0, Math.max(1, labels.length - 1)])
        .range([m.l, m.l + iw]);
      var y = d3.scaleLinear()
        .domain([domain[0] - pad, domain[1] + pad])
        .range([m.t + ih, m.t]);

      var y2 = null;
      if (cfg.y2) {
        var second = extent((cfg.series || []).filter(function (s) { return s.axis === "y2"; })
          .map(function (s) { return s.values; }));
        if (second) {
          var p2 = (second[1] - second[0]) * 0.08 || 0.01;
          y2 = d3.scaleLinear()
            .domain([second[0] - p2, second[1] + p2])
            .range([m.t + ih, m.t]);
        }
      }

      var g = t.svg.append("g");
      var yFormat = cfg.yFormat || compact;
      y.ticks(narrow ? 4 : 5).forEach(function (value) {
        gridLine(g, m.l, m.l + iw, y(value));
        tickText(g, m.l - 5, y(value) + 3, yFormat(value), "end");
      });
      if (y2) {
        var y2Format = cfg.y2Format || function (v) { return RV.fmt(v, 2); };
        y2.ticks(narrow ? 3 : 4).forEach(function (value) {
          tickText(g, m.l + iw + 5, y2(value) + 3, y2Format(value), "start");
        });
      }
      if (domain[0] < 0 && domain[1] > 0) {
        g.append("line")
          .attr("x1", m.l).attr("x2", m.l + iw).attr("y1", y(0)).attr("y2", y(0))
          .attr("stroke", C.muted).attr("stroke-dasharray", "3 3").attr("stroke-width", 1);
      }
      axisLine(g, m.l, m.l + iw, m.t + ih);

      tickIndices(labels.length, narrow ? 4 : 7).forEach(function (index) {
        tickText(g, x(index), m.t + ih + 14, labels[index]);
      });
      if (cfg.yTitle && !narrow) {
        tickText(g, m.l, m.t - 2, cfg.yTitle, "start");
      }

      (cfg.hlines || []).forEach(function (line) {
        if (line.value === null || line.value === undefined) return;
        g.append("line")
          .attr("x1", m.l).attr("x2", m.l + iw)
          .attr("y1", y(line.value)).attr("y2", y(line.value))
          .attr("stroke", line.color || C.muted)
          .attr("stroke-dasharray", line.dash || "4 4")
          .attr("stroke-width", 1);
        if (line.label && !narrow) {
          tickText(g, m.l + iw - 3, y(line.value) - 3, line.label, "end");
        }
      });

      (cfg.series || []).forEach(function (series) {
        var scale = series.axis === "y2" && y2 ? y2 : y;
        var points = [];
        series.values.forEach(function (value, index) {
          points.push([index, value === null || value === undefined || !isFinite(value) ? null : Number(value)]);
        });
        if (series.fill) {
          var base = Math.max(scale.domain()[0], Math.min(0, scale.domain()[1]));
          var area = d3.area()
            .defined(function (p) { return p[1] !== null; })
            .x(function (p) { return x(p[0]); })
            .y0(scale(base))
            .y1(function (p) { return scale(p[1]); });
          g.append("path").datum(points)
            .attr("fill", series.fill).attr("fill-opacity", 0.14).attr("stroke", "none")
            .attr("d", area);
        }
        var path = d3.line()
          .defined(function (p) { return p[1] !== null; })
          .x(function (p) { return x(p[0]); })
          .y(function (p) { return scale(p[1]); });
        g.append("path").datum(points)
          .attr("fill", "none")
          .attr("stroke", series.color)
          .attr("stroke-width", series.width || 1.4)
          .attr("stroke-dasharray", series.dash || null)
          .attr("stroke-linejoin", "round")
          .attr("d", path);
      });

      (cfg.markers || []).forEach(function (marker) {
        if (marker.value === null || marker.value === undefined) return;
        g.append("circle")
          .attr("cx", x(marker.index)).attr("cy", y(marker.value)).attr("r", 2.8)
          .attr("fill", marker.color || C.text);
        if (marker.text && !narrow) {
          tickText(g, x(marker.index), y(marker.value) - 6, marker.text);
        }
      });

      var tip = hostTip(host);
      var focus = g.append("g").style("display", "none");
      var cursor = focus.append("line")
        .attr("y1", m.t).attr("y2", m.t + ih)
        .attr("stroke", C.muted).attr("stroke-width", 1)
        .attr("stroke-dasharray", "3 3");
      var dots = (cfg.series || []).map(function (series) {
        return focus.append("circle").attr("r", 2.6).attr("fill", series.color);
      });

      g.append("rect")
        .attr("x", m.l).attr("y", m.t).attr("width", iw).attr("height", ih)
        .attr("fill", "transparent").style("cursor", "crosshair")
        .on("mousemove", function (event) {
          var px = d3.pointer(event, t.svg.node())[0];
          var index = Math.max(0, Math.min(labels.length - 1,
            Math.round(x.invert(px)) || 0));
          focus.style("display", null);
          cursor.attr("x1", x(index)).attr("x2", x(index));
          var rows = [];
          (cfg.series || []).forEach(function (series, order) {
            var scale = series.axis === "y2" && y2 ? y2 : y;
            var value = series.values[index];
            if (value === null || value === undefined || !isFinite(value)) {
              dots[order].style("display", "none");
              rows.push([series.label, "—"]);
              return;
            }
            dots[order].style("display", null)
              .attr("cx", x(index)).attr("cy", scale(value));
            rows.push([series.label, series.tip ? series.tip(value) : compact(value)]);
          });
          (cfg.hlines || []).forEach(function (line) {
            if (line.label) rows.push([line.label, compact(line.value)]);
          });
          tip.show(event, labels[index], rows);
        })
        .on("mouseleave", function () {
          focus.style("display", "none");
          tip.hide();
        });
    });
  }

  /* ---- grouped vertical bars ---------------------------------------- */
  function verticalBars(host, cfg) {
    RV.onResize(host, function (width) {
      var labels = cfg.labels || [];
      if (!labels.length) { empty(host, cfg.empty); return; }
      var narrow = width < NARROW;
      var t = frame(host, width, cfg.height || host.clientHeight || 280);
      var m = { l: narrow ? 36 : 44, r: 10, t: 14, b: narrow ? 34 : 42 };
      var iw = t.W - m.l - m.r, ih = t.H - m.t - m.b;
      if (iw <= 12 || ih <= 12) { empty(host, cfg.empty); return; }

      var all = [];
      (cfg.series || []).forEach(function (s) { all.push(s.values); });
      var domain = extent(all) || [0, 1];
      var lo = Math.min(0, domain[0]), hi = Math.max(0, domain[1]);
      var pad = (hi - lo) * 0.06 || 1;
      var x = d3.scaleBand()
        .domain(labels.map(function (_, i) { return i; }))
        .range([m.l, m.l + iw]).padding(0.22);
      var group = d3.scaleBand()
        .domain((cfg.series || []).map(function (_, i) { return i; }))
        .range([0, x.bandwidth()]).padding(0.12);
      var y = d3.scaleLinear().domain([lo - (lo < 0 ? pad : 0), hi + pad])
        .range([m.t + ih, m.t]);

      var g = t.svg.append("g");
      var yFormat = cfg.yFormat || compact;
      y.ticks(narrow ? 4 : 5).forEach(function (value) {
        gridLine(g, m.l, m.l + iw, y(value));
        tickText(g, m.l - 5, y(value) + 3, yFormat(value), "end");
      });
      axisLine(g, m.l, m.l + iw, y(Math.max(lo, 0)));
      if (lo < 0) {
        g.append("line")
          .attr("x1", m.l).attr("x2", m.l + iw).attr("y1", y(0)).attr("y2", y(0))
          .attr("stroke", C.muted).attr("stroke-width", 1);
      }

      var tip = hostTip(host);
      (cfg.series || []).forEach(function (series, order) {
        series.values.forEach(function (value, index) {
          if (value === null || value === undefined || !isFinite(value)) return;
          var rect = g.append("rect")
            .attr("x", x(index) + group(order))
            .attr("width", group.bandwidth())
            .attr("y", y(Math.max(0, value)))
            .attr("height", Math.max(1, Math.abs(y(value) - y(0))))
            .attr("fill", series.color).attr("fill-opacity", 0.82)
            .style("cursor", "crosshair");
          rect.on("mousemove", function (event) {
            tip.show(event, labels[index], [
              [series.label, series.tip ? series.tip(value) : compact(value)]
            ]);
          }).on("mouseleave", function () { tip.hide(); });
        });
      });

      tickIndices(labels.length, narrow ? 5 : 9).forEach(function (index) {
        var label = String(labels[index]);
        if (narrow) label = label.split(/[–-]/)[0];
        tickText(g, x(index) + x.bandwidth() / 2, m.t + ih + 13, label)
          .attr("transform", "rotate(-32 " + (x(index) + x.bandwidth() / 2) + " " + (m.t + ih + 13) + ")")
          .attr("text-anchor", narrow ? "end" : "middle");
      });
      if (cfg.yTitle && !narrow) tickText(g, m.l, m.t - 2, cfg.yTitle, "start");
    });
  }

  /* ---- grouped horizontal bars -------------------------------------- */
  function horizontalBars(host, cfg) {
    RV.onResize(host, function (width) {
      var labels = cfg.labels || [];
      if (!labels.length) { empty(host, cfg.empty); return; }
      var narrow = width < NARROW;
      var t = frame(host, width, cfg.height || host.clientHeight || 300);
      var m = { l: narrow ? 56 : 68, r: 12, t: 12, b: 24 };
      var iw = t.W - m.l - m.r, ih = t.H - m.t - m.b;
      if (iw <= 12 || ih <= 12) { empty(host, cfg.empty); return; }

      var all = [];
      (cfg.series || []).forEach(function (s) { all.push(s.values); });
      var domain = extent(all) || [0, 1];
      var lo = Math.min(0, domain[0]), hi = Math.max(0, domain[1]);
      var pad = (hi - lo) * 0.06 || 1;
      var order = labels.map(function (_, i) { return i; });
      if (cfg.reverse !== false) order.reverse();
      var y = d3.scaleBand().domain(order).range([m.t, m.t + ih]).padding(0.3);
      var group = d3.scaleBand()
        .domain((cfg.series || []).map(function (_, i) { return i; }))
        .range([0, y.bandwidth()]).padding(0.12);
      var x = d3.scaleLinear().domain([lo - (lo < 0 ? pad : 0), hi + pad])
        .range([m.l, m.l + iw]);

      var g = t.svg.append("g");
      var xFormat = cfg.xFormat || compact;
      x.ticks(narrow ? 4 : 5).forEach(function (value) {
        g.append("line")
          .attr("x1", x(value)).attr("x2", x(value)).attr("y1", m.t).attr("y2", m.t + ih)
          .attr("stroke", C.border).attr("stroke-opacity", 0.55);
        tickText(g, x(value), m.t + ih + 13, xFormat(value));
      });
      if (lo < 0) {
        g.append("line")
          .attr("x1", x(0)).attr("x2", x(0)).attr("y1", m.t).attr("y2", m.t + ih)
          .attr("stroke", C.muted).attr("stroke-dasharray", "3 3");
      }

      var formatLabel = cfg.labelFormat || function (value) { return String(value); };
      var tip = hostTip(host);
      order.forEach(function (index) {
        tickText(g, m.l - 6, y(index) + y.bandwidth() / 2 + 3,
          formatLabel(labels[index], index), "end", C.text);
        (cfg.series || []).forEach(function (series, s) {
          var value = series.values[index];
          if (value === null || value === undefined || !isFinite(value)) return;
          var rect = g.append("rect")
            .attr("x", Math.min(x(0), x(value)))
            .attr("y", y(index) + group(s))
            .attr("width", Math.max(1, Math.abs(x(value) - x(0))))
            .attr("height", group.bandwidth())
            .attr("fill", series.color).attr("fill-opacity", 0.82)
            .style("cursor", "crosshair");
          rect.on("mousemove", function (event) {
            var rows = [];
            (cfg.series || []).forEach(function (other) {
              var v = other.values[index];
              rows.push([other.label, v === null || v === undefined
                ? "—" : (other.tip ? other.tip(v) : compact(v))]);
            });
            tip.show(event, formatLabel(labels[index], index), rows);
          }).on("mouseleave", function () { tip.hide(); });
        });
      });
      if (cfg.xTitle && !narrow) tickText(g, m.l + iw, m.t - 2, cfg.xTitle, "end");
    });
  }

  /* ---- session timeline ribbon -------------------------------------- */
  function timeline(host, cfg) {
    RV.onResize(host, function (width) {
      var labels = cfg.label || [];
      if (!labels.length) { empty(host, cfg.empty); return; }
      var narrow = width < NARROW;
      var t = frame(host, width, cfg.height || host.clientHeight || 300);
      var m = { l: narrow ? 78 : 104, r: narrow ? 52 : 12, t: 10, b: 26 };
      var iw = t.W - m.l - m.r, ih = t.H - m.t - m.b;
      if (iw <= 12 || ih <= 12) { empty(host, cfg.empty); return; }

      var end = 0;
      cfg.start.forEach(function (start, i) {
        end = Math.max(end, (start || 0) + (cfg.duration[i] || 0));
      });
      end = Math.max(end, 1);
      var x = d3.scaleLinear().domain([0, end]).range([m.l, m.l + iw]);
      var y = d3.scaleBand()
        .domain(labels.map(function (_, i) { return i; }))
        .range([m.t, m.t + ih]).padding(0.28);

      var g = t.svg.append("g");
      var step = end > 360 ? 90 : end > 180 ? 60 : 30;
      for (var minute = 0; minute <= end; minute += step) {
        g.append("line")
          .attr("x1", x(minute)).attr("x2", x(minute))
          .attr("y1", m.t).attr("y2", m.t + ih)
          .attr("stroke", C.border).attr("stroke-opacity", 0.45);
        tickText(g, x(minute), m.t + ih + 14,
          clock(cfg.sessionOpen, minute));
      }

      var tip = hostTip(host);
      labels.forEach(function (label, index) {
        var start = cfg.start[index] || 0;
        var duration = cfg.duration[index] || 0;
        var change = cfg.change[index];
        var colour = change === null || change === undefined || change === 0
          ? C.muted : change > 0 ? C.green : C.red;
        var px = Math.max(1, x(start + duration) - x(start));
        var rect = g.append("rect")
          .attr("x", x(start)).attr("width", px)
          .attr("y", y(index)).attr("height", y.bandwidth())
          .attr("rx", 2).attr("fill", colour).attr("fill-opacity", 0.82)
          .style("cursor", "crosshair");
        var text = change === null || change === undefined ? "—" : RV.signed(change, 0) + " pts";
        var inside = px > 54;
        var tx = inside ? x(start) + px / 2 : Math.min(t.W - 4, x(start + duration) + 5);
        g.append("text")
          .attr("x", tx).attr("y", y(index) + y.bandwidth() / 2 + 3)
          .attr("text-anchor", inside ? "middle" : "start")
          .attr("fill", inside ? C.bg : C.muted)
          .attr("font-size", 8.5).attr("font-weight", 600)
          .text(text);
        tickText(g, m.l - 6, y(index) + y.bandwidth() / 2 + 3,
          narrow && label.length > 15 ? label.slice(0, 14) + "…" : label,
          "end", C.text);
        rect.on("mousemove", function (event) {
          tip.show(event, label, [
            ["window", clock(cfg.sessionOpen, start) + "–" + clock(cfg.sessionOpen, start + duration)],
            ["duration", duration + " min"],
            ["change", text]
          ]);
        }).on("mouseleave", function () { tip.hide(); });
      });
      if (!narrow) tickText(g, m.l + iw, m.t - 2, "session clock", "end");
    });
  }

  /* ---- Plotly 3D surface ------------------------------------------- */
  function sceneAxis(title, extra) {
    return Object.assign({
      title: { text: title, font: { size: 9, color: C.muted, family: FONT } },
      gridcolor: C.border,
      zerolinecolor: C.border,
      showbackground: true,
      backgroundcolor: "rgba(31,36,45,0.32)",
      tickfont: { size: 8, color: C.muted, family: FONT }
    }, extra || {});
  }

  function surface(host, payload) {
    if (!window.Plotly) { empty(host, "Plotly is not available in this browser"); return; }
    var data = payload.data || {};
    var spec = payload.spec || {};
    var x = data.x || [];
    var labels = data.xlabels || [];
    var z = data.z || [];
    if (!x.length || !(data.y || []).length) {
      empty(host, "No chain snapshots for this window");
      return;
    }
    var flat = [];
    z.forEach(function (row) {
      (row || []).forEach(function (value) {
        if (value !== null && value !== undefined && isFinite(Number(value))) {
          flat.push(Number(value));
        }
      });
    });
    if (!flat.length) { empty(host, "Every surface cell is blank for this window"); return; }
    var lo = Math.min.apply(null, flat), hi = Math.max.apply(null, flat);
    var narrow = window.innerWidth < NARROW;
    var ticks = tickIndices(x.length, narrow ? 4 : 7);
    var tickvals = ticks.map(function (i) { return x[i]; });
    var ticktext = ticks.map(function (i) { return labels[i]; });
    var custom = z.map(function (row) {
      return (row || []).map(function (_, j) { return labels[j] || ""; });
    });
    var height = Math.max(300, host.clientHeight || 380);

    var traces = [{
      type: "surface",
      name: data.label || "surface",
      x: x, y: data.y, z: z,
      customdata: custom,
      connectgaps: false,
      colorscale: [[0, C.surface], [0.3, C.blue], [0.65, C.amber], [1, C.text]],
      cmin: lo,
      cmax: hi === lo ? lo + 1 : hi,
      showscale: true,
      colorbar: {
        title: { text: data.unit || "", side: "top", font: { size: 9, color: C.muted } },
        thickness: 9, len: 0.62, outlinewidth: 0,
        tickfont: { size: 8, color: C.muted }
      },
      contours: { z: { show: false } },
      lighting: { ambient: 0.86, diffuse: 0.5, specular: 0.08, roughness: 0.85 },
      hovertemplate: "%{customdata} · strike %{y:,.0f}<br>%{z:,.2f}<extra>" +
        (data.label || "") + "</extra>"
    }];

    var layout = RV.plotlyLayout(spec, {
      height: height,
      margin: { l: 0, r: 0, t: 10, b: 0 },
      hovermode: "closest",
      showlegend: false,
      scene: {
        bgcolor: C.surface,
        xaxis: sceneAxis(narrow ? "" : "time", { tickmode: "array", tickvals: tickvals, ticktext: ticktext }),
        yaxis: sceneAxis(narrow ? "" : "strike", { tickformat: ".0f", nticks: 5 }),
        zaxis: sceneAxis(narrow ? "" : (data.unit || data.label || ""), { nticks: 4 }),
        aspectratio: { x: 1.6, y: 1.0, z: 0.75 },
        camera: {
          eye: {
            x: narrow ? 3.0 : 2.2,
            y: narrow ? 2.6 : 2.0,
            z: narrow ? 1.5 : 1.2
          }
        }
      }
    });
    clear(host);
    RV.plotly(host, traces, layout);
  }

  /* ---- registrations ------------------------------------------------ */
  RV.register("tape_spot_futures", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var levels = d.levels || [];
    var values = [d.spot, d.futures];
    levels.forEach(function (level) { values.push([level.value]); });
    var domain = extent(values) || [0, 1];
    var yFormat = priceFormat(spec, domain[1] - domain[0]);
    var labels = d.t || [];
    var markers = [];
    if (d.high !== null && d.high !== undefined && labels.indexOf(d.high_t) >= 0) {
      markers.push({ index: labels.indexOf(d.high_t), value: d.high, text: "HIGH", color: C.red });
    }
    if (d.low !== null && d.low !== undefined && labels.indexOf(d.low_t) >= 0) {
      markers.push({ index: labels.indexOf(d.low_t), value: d.low, text: "LOW", color: C.green });
    }
    lineChart(host, {
      labels: labels,
      height: host.clientHeight,
      yFormat: yFormat,
      yTitle: spec.currency_symbol ? spec.currency_symbol + " price" : "price",
      hlines: levels.map(function (level) {
        return { value: level.value, label: level.label, dash: level.dash, color: C.muted };
      }),
      markers: markers,
      series: [
        {
          values: d.spot, color: C.text, width: 1.5, label: spec.name || "spot",
          tip: function (v) { return RV.money(spec, v); }
        },
        {
          values: d.futures, color: C.blue, width: 1.1, dash: "4 3",
          label: spec.meta && spec.meta.futures_label ? spec.meta.futures_label : "futures",
          tip: function (v) { return RV.money(spec, v); }
        }
      ]
    });
  });

  RV.register("tape_basis", function (host, payload) {
    var d = payload.data || {};
    var domain = extent([d.basis]) || [0, 1];
    var span = domain[1] - domain[0];
    var digits = span > 20 ? 1 : 2;
    lineChart(host, {
      labels: d.t,
      height: host.clientHeight,
      yFormat: function (v) { return RV.signed(v, digits); },
      yTitle: "basis (pts)",
      hlines: [{ value: 0, dash: "3 3" }],
      series: [{
        values: d.basis, color: C.amber, width: 1.3, fill: C.amber, label: "basis",
        tip: function (v) { return RV.signed(v, 2) + " pts"; }
      }]
    });
  });

  RV.register("tape_oi_pcr", function (host, payload) {
    var d = payload.data || {};
    lineChart(host, {
      labels: d.t,
      height: host.clientHeight,
      y2: true,
      yFormat: compact,
      y2Format: function (v) { return RV.fmt(v, 2); },
      yTitle: "OI",
      series: [
        {
          values: d.ce_oi, color: C.red, width: 1.5, label: "CE OI",
          tip: function (v) { return RV.fmt(v, 0); }
        },
        {
          values: d.pe_oi, color: C.green, width: 1.5, label: "PE OI",
          tip: function (v) { return RV.fmt(v, 0); }
        },
        {
          values: d.pcr, color: C.text, width: 1, dash: "3 3", axis: "y2", label: "PCR",
          tip: function (v) { return RV.fmt(v, 2); }
        }
      ]
    });
  });

  RV.register("tape_volume", function (host, payload) {
    var d = payload.data || {};
    verticalBars(host, {
      labels: d.labels,
      height: host.clientHeight,
      yFormat: compact,
      yTitle: d.unit || "",
      series: [
        {
          values: d.ce, color: C.red, label: "CE volume",
          tip: function (v) { return RV.fmt(v, 0); }
        },
        {
          values: d.pe, color: C.green, label: "PE volume",
          tip: function (v) { return RV.fmt(v, 0); }
        }
      ]
    });
  });

  RV.register("tape_walls", function (host, payload) {
    var d = payload.data || {};
    var domain = extent([d.spot, d.max_pain, d.call_wall, d.put_wall]) || [0, 1];
    var yFormat = priceFormat(payload.spec || {}, domain[1] - domain[0]);
    lineChart(host, {
      labels: d.t,
      height: host.clientHeight,
      yFormat: yFormat,
      yTitle: "strike",
      series: [
        {
          values: d.spot, color: C.text, width: 1.2, label: "spot",
          tip: function (v) { return RV.money(payload.spec, v); }
        },
        {
          values: d.max_pain, color: C.amber, width: 1.4, dash: "5 3", label: "max pain",
          tip: function (v) { return RV.fmt(v, 0); }
        },
        {
          values: d.call_wall, color: C.red, width: 1.2, label: "call wall",
          tip: function (v) { return RV.fmt(v, 0); }
        },
        {
          values: d.put_wall, color: C.green, width: 1.2, label: "put wall",
          tip: function (v) { return RV.fmt(v, 0); }
        }
      ]
    });
  });

  RV.register("tape_surface", function (host, payload) {
    surface(host, payload);
  });

  RV.register("tape_strikes", function (host, payload) {
    var d = payload.data || {};
    horizontalBars(host, {
      labels: d.strike,
      height: host.clientHeight,
      yFormat: compact,
      xFormat: compact,
      xTitle: d.unit || "",
      labelFormat: function (value) { return RV.fmt(value, 0); },
      series: [
        {
          values: d.ce_oi, color: C.red, label: "CE OI",
          tip: function (v) { return RV.fmt(v, 0); }
        },
        {
          values: d.pe_oi, color: C.green, label: "PE OI",
          tip: function (v) { return RV.fmt(v, 0); }
        }
      ]
    });
  });

  RV.register("tape_oi_change", function (host, payload) {
    var d = payload.data || {};
    horizontalBars(host, {
      labels: d.strike,
      height: host.clientHeight,
      xFormat: signedCompact,
      xTitle: d.unit || "",
      labelFormat: function (value) { return RV.fmt(value, 0); },
      series: [
        {
          values: d.ce_change, color: C.red, label: "CE ΔOI", tip: signedCompact
        },
        {
          values: d.pe_change, color: C.green, label: "PE ΔOI", tip: signedCompact
        }
      ]
    });
  });

  RV.register("tape_timeline", function (host, payload) {
    var d = payload.data || {};
    timeline(host, {
      label: d.label,
      start: d.start,
      duration: d.duration,
      change: d.change,
      sessionOpen: d.session_open || (payload.spec || {}).session_open,
      height: host.clientHeight
    });
  });

  RV.register("rv_iv", function (host, payload) {
    var d = payload.data || {};
    var domain = extent([d.iv, d.rv]) || [0, 1];
    lineChart(host, {
      labels: d.t,
      height: host.clientHeight,
      yFormat: function (v) { return RV.fmt(v, 1) + "%"; },
      yTitle: "vol points",
      series: [
        {
          values: d.iv, color: C.blue, width: 1.8, fill: C.blue, label: "IV",
          tip: function (v) { return RV.fmt(v, 2) + "%"; }
        },
        {
          values: d.rv, color: C.amber, width: 1.4, dash: "5 4", label: "realised",
          tip: function (v) { return RV.fmt(v, 2) + "%"; }
        }
      ]
    });
  });

  RV.register("straddle_1sigma", function (host, payload) {
    var d = payload.data || {};
    var spec = payload.spec || {};
    var factor = Number(d.sigma_factor) || 0.7979;
    var implied = (d.straddle || []).map(function (value) {
      return value === null || value === undefined ? null : value / factor;
    });
    var domain = extent([implied, d.realised]) || [0, 1];
    var yFormat = priceFormat(spec, domain[1] - domain[0]);
    lineChart(host, {
      labels: d.t,
      height: host.clientHeight,
      yFormat: yFormat,
      yTitle: spec.currency_symbol ? spec.currency_symbol + " points" : "points",
      series: [
        {
          values: implied, color: C.amber, width: 1.7, label: "1σ implied",
          tip: function (v) { return RV.money(spec, v); }
        },
        {
          values: d.realised, color: C.blue, width: 1.4, fill: C.blue, label: "realised move",
          tip: function (v) { return RV.money(spec, v); }
        }
      ]
    });
  });
})();
