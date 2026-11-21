/* Replay / 3D renderers.
 *
 * Three Plotly surfaces (positioning terrain, OTM IV, futures path) and four D3
 * replay views (heatmap, focus strike, volume ranking, event ribbon).  The
 * payload is `{spec, data}`: units, clock, currency and strike ladder come from
 * `spec`, never from this file.  A null cell is a gap — it is never turned into
 * zero, and missing chain minutes stay blank.
 */
(function () {
  "use strict";

  var C = RV.colors;
  var FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  var NARROW = 560;

  /* ---- shared helpers ------------------------------------------------ */
  function clear(host) {
    if (host.__rvTip) host.__rvTip.hide();
    if (window.d3) d3.select(host).selectAll("*").remove();
    else host.innerHTML = "";
  }

  function tipFor(host) {
    if (!host.__rvTip) host.__rvTip = RV.tip();
    return host.__rvTip;
  }

  function empty(host, message) {
    clear(host);
    var box = document.createElement("div");
    box.className = "rv-empty";
    box.style.cssText = "color:" + C.red + ";font-size:11px;padding:18px 12px";
    box.textContent = message;
    host.appendChild(box);
  }

  function isNum(value) {
    return value !== null && value !== undefined && isFinite(Number(value));
  }

  function clock(sessionOpen, minutes) {
    var parts = String(sessionOpen || "00:00").split(":");
    var total = (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0) + Math.round(Number(minutes) || 0);
    return clockMinutes(total);
  }

  function clockMinutes(total) {
    var value = ((Math.round(Number(total) || 0) % 1440) + 1440) % 1440;
    var hh = Math.floor(value / 60), mm = value % 60;
    return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function frame(host, width, height) {
    clear(host);
    var W = Math.max(300, Math.round(width || host.clientWidth || 360));
    var H = Math.max(140, Math.round(height || host.clientHeight || 280));
    var svg = d3.select(host)
      .append("svg")
      .attr("viewBox", "0 0 " + W + " " + H)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("role", "img")
      .style("font-family", FONT)
      .style("font-variant-numeric", "tabular-nums");
    return { svg: svg, W: W, H: H };
  }

  function label(g, x, y, value, anchor, color, size, weight) {
    return g.append("text")
      .attr("x", x).attr("y", y)
      .attr("text-anchor", anchor || "middle")
      .attr("fill", color || C.muted)
      .attr("font-size", size || 9)
      .attr("font-weight", weight || 400)
      .text(value);
  }

  function split(host) {
    clear(host);
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.gap = "4px";
    var bar = document.createElement("div");
    bar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-height:0";
    host.appendChild(bar);
    var plot = document.createElement("div");
    plot.style.cssText = "flex:1 1 auto;min-height:0;min-width:0";
    host.appendChild(plot);
    return { bar: bar, plot: plot };
  }

  function findOption(options, id) {
    for (var i = 0; i < options.length; i++) {
      if (options[i].id === id) return options[i];
    }
    return options[0] || { id: id, label: id, unit: "", signed: false, side: "" };
  }

  function optionColor(option) {
    if (!option) return C.amber;
    if (option.side === "ce") return C.blue;
    if (option.side === "pe") return C.amber;
    return C.amber;
  }

  function tabs(bar, options, active, onPick) {
    var buttons = {};
    bar.innerHTML = "";
    function paint(id) {
      options.forEach(function (option) {
        var button = buttons[option.id];
        if (!button) return;
        var on = option.id === id;
        button.setAttribute("aria-pressed", String(on));
        button.style.color = on ? C.text : C.muted;
        button.style.borderColor = on ? optionColor(option) : C.border;
        button.style.background = on ? C.raised : "transparent";
      });
    }
    options.forEach(function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.title = option.unit || "";
      button.style.cssText = "font:inherit;font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid " +
        C.border + ";background:transparent;color:" + C.muted + ";cursor:pointer";
      button.addEventListener("click", function () {
        paint(option.id);
        onPick(option.id);
      });
      buttons[option.id] = button;
      bar.appendChild(button);
    });
    paint(active);
  }

  function note(bar, message) {
    var span = document.createElement("span");
    span.style.cssText = "color:" + C.muted + ";font-size:10px;margin-left:auto;white-space:nowrap";
    span.textContent = message || "";
    bar.appendChild(span);
    return span;
  }

  function tickAxis(x, labels, wanted) {
    var n = Math.min((x || []).length, (labels || []).length);
    if (!n) return { tickmode: "auto" };
    var step = Math.max(1, Math.ceil(n / Math.max(2, wanted || 6)));
    var vals = [], text = [];
    for (var i = 0; i < n; i += step) {
      vals.push(x[i]);
      text.push(labels[i]);
    }
    if (vals[vals.length - 1] !== x[n - 1]) {
      vals.push(x[n - 1]);
      text.push(labels[n - 1]);
    }
    return { tickmode: "array", tickvals: vals, ticktext: text };
  }

  function sceneAxis(title, extra) {
    return Object.assign({
      title: { text: title, font: { size: 9, color: C.muted, family: FONT } },
      gridcolor: C.border,
      zerolinecolor: C.border,
      showbackground: true,
      backgroundcolor: C.raised,
      tickfont: { size: 8, color: C.muted, family: FONT }
    }, extra || {});
  }

  function valueText(value, unit, digits) {
    if (!isNum(value)) return "—";
    var d = digits === undefined ? 2 : digits;
    return RV.fmt(value, d) + (unit ? " " + unit : "");
  }

  function compact(value) {
    if (!isNum(value)) return "—";
    var abs = Math.abs(Number(value));
    if (abs >= 1e9) return RV.fmt(value / 1e9, 2) + "B";
    if (abs >= 1e6) return RV.fmt(value / 1e6, 2) + "M";
    if (abs >= 1e3) return RV.fmt(value / 1e3, 1) + "k";
    return RV.fmt(value, 0);
  }

  function finiteOf(grid) {
    var out = [];
    (grid || []).forEach(function (row) {
      (row || []).forEach(function (value) {
        if (isNum(value)) out.push(Number(value));
      });
    });
    return out;
  }

  function transformGrid(grid, mode) {
    return (grid || []).map(function (row) {
      return (row || []).map(function (value) {
        if (!isNum(value)) return null;
        var n = Number(value);
        if (mode === "signed_sqrt") return n === 0 ? 0 : Math.sign(n) * Math.sqrt(Math.abs(n));
        return n;
      });
    });
  }

  function hoverbox() {
    return { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, family: FONT, size: 11 } };
  }

  /* ---- 1. positioning terrain --------------------------------------- */
  function terrain(host, payload) {
    var d = payload.data || {};
    var spec = payload.spec || {};
    if (!window.Plotly) { empty(host, "Plotly is not available in this browser"); return; }
    var options = d.metric_options || [];
    if (!options.length) { empty(host, "No metric catalogue in this payload"); return; }
    var active = d.metric || options[0].id;
    var stage = split(host);
    var plot = stage.plot;

    function draw() {
      var option = findOption(options, active);
      var grid = d.metrics ? d.metrics[active] : null;
      if (!grid || !grid.length) { empty(plot, "No " + option.label + " grid in this payload"); return; }
      var z = transformGrid(grid, d.z_transform);
      var finite = finiteOf(z);
      if (!finite.length) { empty(plot, "Every " + option.label + " cell is blank for this window"); return; }
      var lo = Math.min.apply(null, finite);
      var hi = Math.max.apply(null, finite);
      if (lo === hi) { lo -= 1; hi += 1; }

      var x = d.x && d.x.length ? d.x : (d.times || []).map(function (_, i) { return i; });
      var custom = grid.map(function (row, i) {
        return (row || []).map(function (value, j) {
          var shown = isNum(value) ? valueText(value, option.unit) : "—";
          return (d.times[j] || "") + " · " + option.label + " " + shown + " · strike " + RV.fmt(d.strikes[i], 0);
        });
      });

      var signed = !!option.signed;
      var trace = {
        type: "surface",
        name: option.label,
        x: x,
        y: d.strikes,
        z: z,
        customdata: custom,
        connectgaps: false,
        colorscale: signed
          ? [[0, C.red], [0.5, C.surface], [1, optionColor(option)]]
          : [[0, C.surface], [0.45, optionColor(option)], [1, C.text]],
        cmin: signed ? lo : Math.max(0, lo),
        cmax: hi,
        showscale: true,
        colorbar: {
          title: { text: option.unit, side: "top", font: { size: 9, color: C.muted, family: FONT } },
          thickness: 9, len: 0.62, outlinewidth: 0,
          tickfont: { size: 8, color: C.muted }
        },
        contours: { z: { show: false } },
        lighting: { ambient: 0.86, diffuse: 0.5, specular: 0.08, roughness: 0.85 },
        hovertemplate: "%{customdata}<extra></extra>",
        hoverlabel: hoverbox()
      };
      if (signed) trace.cmid = 0;

      var narrow = window.innerWidth < NARROW;
      var layout = RV.plotlyLayout(spec, {
        height: Math.max(260, plot.clientHeight || host.clientHeight - 40 || 380),
        margin: { l: 0, r: 0, t: 8, b: 0 },
        hovermode: "closest",
        showlegend: false,
        scene: {
          bgcolor: C.surface,
          xaxis: sceneAxis(narrow ? "" : "time", tickAxis(x, d.times, narrow ? 4 : 6)),
          yaxis: sceneAxis(narrow ? "" : "strike", { tickformat: ".0f", nticks: 6 }),
          zaxis: sceneAxis(narrow ? "" : option.unit, { nticks: 4, zeroline: signed }),
          aspectmode: "manual",
          aspectratio: { x: 1.7, y: 1.0, z: 0.7 },
          dragmode: "orbit",
          camera: { eye: { x: 1.5, y: 1.7, z: 1.15 } }
        }
      });
      RV.plotly(plot, [trace], layout, { scrollZoom: true });
    }

    tabs(stage.bar, options, active, function (id) {
      active = id;
      draw();
    });
    note(stage.bar, (d.times || []).length + " clocks · " + (d.strikes || []).length + " strikes");
    draw();
  }

  RV.register("positioning_terrain_3d", function (host, payload) {
    terrain(host, payload);
  });

  /* ---- 2. OTM IV surface -------------------------------------------- */
  function ivSurface(host, payload) {
    var d = payload.data || {};
    var spec = payload.spec || {};
    if (!window.Plotly) { empty(host, "Plotly is not available in this browser"); return; }
    var stage = split(host);
    var plot = stage.plot;
    var coverage = d.coverage || {};
    note(stage.bar, (coverage.filled || 0) + "/" + (coverage.cells || 0) + " cells · " +
      RV.fmt(coverage.pct || 0, 1) + "%");

    if (!d.sufficient) {
      empty(plot, d.insufficient_note || "Insufficient IV coverage for an honest surface");
      return;
    }
    var z = d.z || [];
    var finite = finiteOf(z);
    if (!finite.length) { empty(plot, "Every IV cell is blank for this window"); return; }
    var lo = Math.min.apply(null, finite);
    var hi = Math.max.apply(null, finite);
    if (lo === hi) { hi = lo + 1; }
    var x = d.x && d.x.length ? d.x : (d.times || []).map(function (_, i) { return i; });
    var labels = d.times || [];
    var unit = d.unit || "%";
    var custom = z.map(function (row) {
      return (row || []).map(function (_, j) { return labels[j] || ""; });
    });

    var trace = {
      type: "surface",
      name: d.label || "IV",
      x: x,
      y: d.strikes,
      z: z,
      customdata: custom,
      connectgaps: false,
      colorscale: [[0, C.surface], [0.3, C.blue], [0.6, C.green], [0.82, C.amber], [1, C.red]],
      cmin: lo,
      cmax: hi,
      showscale: true,
      colorbar: {
        title: { text: unit, side: "top", font: { size: 9, color: C.muted, family: FONT } },
        thickness: 9, len: 0.62, outlinewidth: 0,
        tickfont: { size: 8, color: C.muted }
      },
      contours: { z: { show: false } },
      lighting: { ambient: 0.72, diffuse: 0.62, specular: 0.14, roughness: 0.72, fresnel: 0.1 },
      hovertemplate: "%{fullData.name} · %{customdata}<br>strike %{y:,.0f}<br>%{z:.2f} " + unit + "<extra></extra>",
      hoverlabel: hoverbox()
    };

    var narrow = window.innerWidth < NARROW;
    var layout = RV.plotlyLayout(spec, {
      height: Math.max(260, plot.clientHeight || host.clientHeight - 40 || 380),
      margin: { l: 0, r: 0, t: 8, b: 0 },
      hovermode: "closest",
      showlegend: false,
      scene: {
        bgcolor: C.surface,
        xaxis: sceneAxis(narrow ? "" : "time", tickAxis(x, labels, narrow ? 4 : 6)),
        yaxis: sceneAxis(narrow ? "" : "strike", { tickformat: ".0f", nticks: 6 }),
        zaxis: sceneAxis(narrow ? "" : unit, { nticks: 4 }),
        aspectmode: "manual",
        aspectratio: { x: 1.55, y: 1.0, z: 0.7 },
        dragmode: "orbit",
        camera: { eye: { x: 1.7, y: 1.9, z: 1.1 } }
      }
    });
    RV.plotly(plot, [trace], layout, { scrollZoom: true });
  }

  RV.register("iv_surface_3d", function (host, payload) {
    ivSurface(host, payload);
  });

  /* ---- 3. futures path ---------------------------------------------- */
  function regimeColor(regime) {
    if (regime === "long_buildup") return C.green;
    if (regime === "short_buildup") return C.red;
    if (regime === "long_unwind") return C.amber;
    if (regime === "short_cover") return C.blue;
    return C.muted;
  }

  function futuresPath(host, payload) {
    var d = payload.data || {};
    var spec = payload.spec || {};
    if (!window.Plotly) { empty(host, "Plotly is not available in this browser"); return; }
    var stage = split(host);
    var plot = stage.plot;
    var t = d.t || [];
    var price = d.price || [];
    var oi = d.oi || [];
    if (!t.length) { empty(plot, "No futures points in this payload"); return; }
    note(stage.bar, (d.shape && d.shape.points ? d.shape.points : t.length) + " points");

    var money = function (value) { return isNum(value) ? RV.money(spec, value) : "—"; };
    var texts = t.map(function (label, i) {
      var point = d.points && d.points[i];
      var regime = point && point.regime_label ? " · " + point.regime_label : "";
      return label + " · " + money(price[i]) + " · OI " + valueText(oi[i], d.oi_unit) + regime;
    });
    var colors = (d.regimes || []).map(regimeColor);
    var x = d.x && d.x.length ? d.x : t.map(function (_, i) { return i; });

    var traces = [{
      type: "scatter3d",
      mode: "lines+markers",
      name: "futures path",
      x: x,
      y: price,
      z: oi,
      text: texts,
      hoverinfo: "text",
      line: { color: C.muted, width: 4 },
      marker: { size: 4, color: colors, line: { width: 0 } },
      hoverlabel: hoverbox()
    }];

    var finitePrice = price.filter(isNum).map(Number);
    var priceSpan = finitePrice.length
      ? Math.max.apply(null, finitePrice) - Math.min.apply(null, finitePrice)
      : 0;
    var floor = finitePrice.length
      ? Math.min.apply(null, finitePrice) - Math.max(1, priceSpan * 0.04)
      : 0;
    traces.unshift({
      type: "scatter3d",
      mode: "markers",
      name: "floor projection",
      x: x,
      y: x.map(function () { return floor; }),
      z: oi,
      hoverinfo: "skip",
      showlegend: false,
      marker: { size: 2, color: colors, opacity: 0.3, line: { width: 0 } }
    });

    var narrow = window.innerWidth < NARROW;
    var range = d.range || {};
    var priceRange = range.price
      ? [range.price[0] - Math.max(0.5, (range.price[1] - range.price[0]) * 0.08),
         range.price[1] + Math.max(0.5, (range.price[1] - range.price[0]) * 0.08)]
      : undefined;
    var oiRange = range.oi
      ? [range.oi[0] - Math.max(0.01, (range.oi[1] - range.oi[0]) * 0.08),
         range.oi[1] + Math.max(0.01, (range.oi[1] - range.oi[0]) * 0.08)]
      : undefined;

    var layout = RV.plotlyLayout(spec, {
      height: Math.max(260, plot.clientHeight || host.clientHeight - 40 || 380),
      margin: { l: 0, r: 0, t: 8, b: 0 },
      hovermode: "closest",
      showlegend: false,
      scene: {
        bgcolor: C.surface,
        xaxis: sceneAxis(narrow ? "" : "time", tickAxis(x, t, narrow ? 4 : 6)),
        yaxis: sceneAxis(narrow ? "" : (d.price_unit || "price"), { nticks: 5, range: priceRange }),
        zaxis: sceneAxis(narrow ? "" : "OI (" + (d.oi_unit || "") + ")", { nticks: 4, range: oiRange }),
        aspectmode: "manual",
        aspectratio: { x: 1.5, y: 1.0, z: 0.72 },
        dragmode: "orbit",
        camera: { eye: { x: 1.4, y: 1.6, z: 1.15 } }
      }
    });
    RV.plotly(plot, traces, layout, { scrollZoom: true });
  }

  RV.register("futures_path_3d", function (host, payload) {
    futuresPath(host, payload);
  });

  /* ---- 4. replay heatmap (D3) --------------------------------------- */
  function heatMax(grid, signed) {
    var values = [];
    (grid || []).forEach(function (row) {
      (row || []).forEach(function (value) {
        if (!isNum(value)) return;
        var n = Number(value);
        if (signed) n = Math.abs(n);
        if (n > 0) values.push(n);
      });
    });
    if (!values.length) return 1;
    values.sort(function (a, b) { return a - b; });
    return values[Math.min(values.length - 1, Math.floor(values.length * 0.96))] || 1;
  }

  function drawHeat(host, payload, metricId, width) {
    var d = payload.data || {};
    var spec = payload.spec || {};
    var options = d.metric_options || [];
    var option = findOption(options, metricId);
    var grid = d.metrics ? d.metrics[metricId] : null;

    if (!grid || !grid.length) { empty(host, "No " + option.label + " grid in this payload"); return; }
    var t = frame(host, width, host.clientHeight || 440);
    var W = t.W, H = t.H;
    var narrow = W < NARROW;
    var times = d.times || [];
    var strikes = d.strikes || [];
    if (!times.length || !strikes.length) { empty(host, "No chain clocks in this payload"); return; }

    var spot = d.spot || { x: [], price: [] };
    var hasSpot = (spot.price || []).filter(isNum).length > 1;
    var m = { l: narrow ? 46 : 58, r: 12, t: 16, b: 24 };
    var spotH = hasSpot ? 60 : 0;
    var iw = W - m.l - m.r;
    var ih = H - m.t - m.b - spotH - (hasSpot ? 8 : 0);
    if (iw <= 20 || ih <= 20) { empty(host, "Not enough room to draw the ladder"); return; }
    var rowH = ih / strikes.length;
    var colW = iw / times.length;
    var max = heatMax(grid, !!option.signed);
    var base = optionColor(option);
    var ramp = option.signed
      ? function (value) {
        var n = Number(value);
        if (n < 0) return d3.interpolateRgb(C.surface, C.red)(Math.min(1, -n / max));
        return d3.interpolateRgb(C.surface, base)(Math.min(1, n / max));
      }
      : function (value) {
        var ratio = Math.pow(Math.max(0, Math.min(1, Number(value) / max)), 1.7);
        return d3.interpolateRgbBasis([C.surface, C.raised, base])(ratio);
      };

    var g = t.svg.append("g");
    t.svg.attr("aria-label", option.label + " by strike and time, " + strikes.length + " strikes");

    var cells = [];
    grid.forEach(function (row, si) {
      (row || []).forEach(function (value, ti) {
        if (!isNum(value)) return;
        cells.push({ row: si, col: ti, value: Number(value), strike: strikes[si], time: times[ti] });
      });
    });

    var tip = tipFor(host);
    g.append("g").selectAll("rect").data(cells).join("rect")
      .attr("x", function (cell) { return m.l + cell.col * colW; })
      .attr("y", function (cell) { return m.t + cell.row * rowH; })
      .attr("width", Math.max(1, colW + 0.2))
      .attr("height", Math.max(1, rowH - 0.4))
      .attr("fill", function (cell) { return ramp(cell.value); })
      .attr("stroke", C.border)
      .attr("stroke-opacity", 0.22)
      .attr("shape-rendering", "crispEdges")
      .style("cursor", "crosshair")
      .on("mousemove", function (event, cell) {
        tip.show(event, cell.time + " · " + RV.money(spec, cell.strike, 0), [
          [option.label, valueText(cell.value, option.unit)],
          ["strike", RV.money(spec, cell.strike, 0)]
        ]);
      })
      .on("mouseleave", function () { tip.hide(); });

    var step = strikes.length > 22 ? 2 : 1;
    strikes.forEach(function (strike, row) {
      if (row % step !== 0) return;
      var focus = d.focus_strike !== null && d.focus_strike !== undefined && Number(strike) === Number(d.focus_strike);
      label(g, m.l - 6, m.t + row * rowH + Math.min(rowH * 0.72, 11),
        RV.fmt(strike, 0), "end", focus ? C.amber : C.muted, 8.5, focus ? 700 : 400);
    });

    var wanted = narrow ? 4 : 6;
    var tickStep = Math.max(1, Math.ceil(times.length / wanted));
    var tickIndices = [];
    for (var ti = 0; ti < times.length; ti += tickStep) tickIndices.push(ti);
    if (tickIndices[tickIndices.length - 1] !== times.length - 1) tickIndices.push(times.length - 1);
    tickIndices.forEach(function (index) {
      label(g, m.l + (index + 0.5) * colW, m.t + ih + 14, times[index], "middle", C.muted, 8.5);
    });

    if (hasSpot) {
      var values = (spot.price || []).filter(isNum).map(Number);
      var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
      var pad = Math.max(1, (hi - lo) * 0.14);
      var top = m.t + ih + 12;
      var bottom = H - m.b;
      var sy = d3.scaleLinear().domain([lo - pad, hi + pad]).range([bottom, top]);
      var xOf = function (i) { return m.l + (Number(spot.x[i]) + 0.5) * colW; };
      var line = d3.line()
        .defined(function (_, i) { return isNum(spot.price[i]); })
        .x(function (_, i) { return xOf(i); })
        .y(function (value) { return sy(value); });
      g.append("path").datum(spot.price)
        .attr("fill", "none").attr("stroke", C.text).attr("stroke-width", 1.2)
        .attr("d", line);
      label(g, m.l - 6, sy(hi) + 3, RV.fmt(hi, 0), "end", C.muted, 8);
      label(g, m.l - 6, sy(lo) + 3, RV.fmt(lo, 0), "end", C.muted, 8);
      label(g, m.l, top - 4, "spot (" + (spec.currency_symbol || "") + ")", "start", C.muted, 8, 600);
    }
  }

  function replayHeatmap(host, payload) {
    var d = payload.data || {};
    var options = d.metric_options || [];
    if (!options.length) { empty(host, "No metric catalogue in this payload"); return; }
    var active = d.metric || options[0].id;
    var current = active;
    var stage = split(host);
    tabs(stage.bar, options, active, function (id) {
      current = id;
      drawHeat(stage.plot, payload, current, stage.plot.clientWidth);
    });
    note(stage.bar, (d.times || []).length + " clocks · " + (d.strikes || []).length + " strikes");
    RV.onResize(stage.plot, function (width) {
      drawHeat(stage.plot, payload, current, width);
    });
  }

  RV.register("replay_heatmap", function (host, payload) {
    replayHeatmap(host, payload);
  });

  /* ---- 5. focus strike --------------------------------------------- */
  function drawFocus(host, payload) {
    var d = payload.data || {};
    var spec = payload.spec || {};
    RV.onResize(host, function (width) {
      var t = frame(host, width, host.clientHeight || 360);
      var W = t.W, H = t.H;
      var narrow = W < NARROW;
      var n = (d.t || []).length;
      if (!n) { empty(host, "No focus-strike series in this payload"); return; }
      var m = { l: narrow ? 48 : 58, r: 14, t: 14, b: 24 };
      var iw = W - m.l - m.r;
      var ih = H - m.t - m.b;
      if (iw <= 20 || ih <= 20) { empty(host, "Not enough room to draw the focus path"); return; }

      var gap = 18;
      var premH = Math.max(40, ih * 0.48);
      var oiH = Math.max(30, ih * 0.24);
      var volH = Math.max(24, ih - premH - oiH - gap * 2);
      var premTop = m.t;
      var oiTop = premTop + premH + gap;
      var volTop = oiTop + oiH + gap;
      var volBottom = Math.min(H - m.b, volTop + volH);

      var xs = d3.scaleLinear().domain([d.t[0], d.t[n - 1]]).range([m.l, m.l + iw]);
      var premium = d.premium || [];
      var oi = d.oi || [];
      var volume = d.volume || [];

      var pv = premium.filter(isNum).map(Number);
      var ov = oi.filter(isNum).map(Number);
      var vv = volume.filter(isNum).map(Number);
      var pad = function (values) {
        if (!values.length) return [0, 1];
        var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
        var p = Math.max(0.01, (hi - lo) * 0.12);
        return [lo - p, hi + p];
      };
      var pd = pad(pv), od = pad(ov);
      var syP = d3.scaleLinear().domain(pd).range([premTop + premH, premTop]);
      var syO = d3.scaleLinear().domain(od).range([oiTop + oiH, oiTop]);
      var vmax = vv.length ? Math.max.apply(null, vv) : 0;
      var syV = d3.scaleLinear().domain([0, vmax > 0 ? vmax : 1]).range([volBottom, volTop]);

      var g = t.svg.append("g");
      t.svg.attr("aria-label", (d.side || "") + " " + RV.money(spec, d.strike, 0) + " premium, OI and volume");

      function band(top, title) {
        g.append("line")
          .attr("x1", m.l).attr("x2", m.l + iw)
          .attr("y1", top).attr("y2", top)
          .attr("stroke", C.border).attr("stroke-opacity", 0.55);
        label(g, m.l, top - 4, title, "start", C.muted, 8, 600);
      }
      band(premTop, "premium (" + (spec.currency_symbol || "") + ")");
      band(oiTop, "open interest (" + (d.oi_unit || "") + ")");
      band(volTop, "volume (" + (d.volume_unit || "") + ")");

      syP.ticks(3).forEach(function (value) {
        label(g, m.l - 6, syP(value) + 3, RV.fmt(value, 1), "end", C.muted, 8);
      });
      syO.ticks(3).forEach(function (value) {
        label(g, m.l - 6, syO(value) + 3, compact(value), "end", C.muted, 8);
      });
      if (vv.length) {
        label(g, m.l + iw, volTop + 9, compact(vmax), "end", C.muted, 8, 600);
      }

      var premLine = d3.line()
        .defined(function (_, i) { return isNum(premium[i]); })
        .x(function (_, i) { return xs(d.t[i]); })
        .y(function (value) { return syP(value); });
      var premArea = d3.area()
        .defined(function (_, i) { return isNum(premium[i]); })
        .x(function (_, i) { return xs(d.t[i]); })
        .y0(premTop + premH)
        .y1(function (value) { return syP(value); });
      g.append("path").datum(premium).attr("fill", C.amber).attr("fill-opacity", 0.1).attr("d", premArea);
      g.append("path").datum(premium)
        .attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", 1.4)
        .attr("d", premLine);

      g.append("path").datum(oi)
        .attr("fill", "none").attr("stroke", C.blue).attr("stroke-width", 1.2)
        .attr("d", d3.line()
          .defined(function (_, i) { return isNum(oi[i]); })
          .x(function (_, i) { return xs(d.t[i]); })
          .y(function (value) { return syO(value); }));

      var stepPx = n > 1 ? iw / (n - 1) : iw;
      var barW = Math.max(1, stepPx * 0.66);
      g.append("g").selectAll("rect").data(volume).join("rect")
        .attr("x", function (_, i) { return xs(d.t[i]) - barW / 2; })
        .attr("y", function (value) { return isNum(value) ? syV(value) : volBottom; })
        .attr("width", barW)
        .attr("height", function (value) { return isNum(value) ? Math.max(0, volBottom - syV(value)) : 0; })
        .attr("fill", C.muted).attr("fill-opacity", 0.55);

      var wanted = narrow ? 4 : 7;
      var tickStep = Math.max(1, Math.ceil(n / wanted));
      for (var i = 0; i < n; i += tickStep) {
        label(g, xs(d.t[i]), H - m.b + 13, clock(spec.session_open, d.t[i] / 60), "middle", C.muted, 8.5);
      }

      g.append("line")
        .attr("x1", m.l).attr("x2", m.l + iw)
        .attr("y1", volBottom).attr("y2", volBottom)
        .attr("stroke", C.border);

      var tip = tipFor(host);
      var cross = g.append("line")
        .attr("y1", premTop).attr("y2", volBottom)
        .attr("stroke", C.text).attr("stroke-opacity", 0.35)
        .style("display", "none");
      var dot = g.append("circle")
        .attr("r", 2.6).attr("fill", C.amber).style("display", "none");
      var bisect = d3.bisector(function (value) { return value; }).left;
      g.append("rect")
        .attr("x", m.l).attr("y", premTop)
        .attr("width", iw).attr("height", volBottom - premTop)
        .attr("fill", "transparent")
        .style("cursor", "crosshair")
        .on("mousemove", function (event) {
          var px = d3.pointer(event, g.node())[0];
          var target = xs.invert(px);
          var index = Math.max(0, Math.min(n - 1, bisect(d.t, target)));
          if (index > 0 && Math.abs(d.t[index - 1] - target) < Math.abs(d.t[index] - target)) index -= 1;
          var x = xs(d.t[index]);
          cross.attr("x1", x).attr("x2", x).style("display", null);
          if (isNum(premium[index])) {
            dot.attr("cx", x).attr("cy", syP(premium[index])).style("display", null);
          } else {
            dot.style("display", "none");
          }
          var rows = [
            ["premium", isNum(premium[index]) ? RV.money(spec, premium[index]) : "—"],
            ["open interest", valueText(oi[index], d.oi_unit)],
            ["volume", valueText(volume[index], d.volume_unit)]
          ];
          tip.show(event, clock(spec.session_open, d.t[index] / 60), rows);
        })
        .on("mouseleave", function () {
          cross.style("display", "none");
          dot.style("display", "none");
          tip.hide();
        });
    });
  }

  RV.register("replay_pe_focus", function (host, payload) {
    drawFocus(host, payload);
  });

  /* ---- 6. highest-volume strikes ----------------------------------- */
  function drawTopVolume(host, payload) {
    var d = payload.data || {};
    var spec = payload.spec || {};
    RV.onResize(host, function (width) {
      var rows = d.rows || [];
      if (!rows.length) { empty(host, "No strikes in this payload"); return; }
      var t = frame(host, width, host.clientHeight || 320);
      var W = t.W, H = t.H;
      var narrow = W < NARROW;
      var m = { l: narrow ? 58 : 68, r: narrow ? 48 : 62, t: 18, b: 18 };
      var iw = W - m.l - m.r;
      var ih = H - m.t - m.b;
      if (iw <= 20 || ih <= 20) { empty(host, "Not enough room to rank the strikes"); return; }
      var rowH = Math.min(46, ih / rows.length);
      var values = rows.map(function (row) { return row.volume; }).filter(isNum).map(Number);
      var max = values.length ? Math.max.apply(null, values) : 1;
      if (max <= 0) max = 1;
      var x = d3.scaleLinear().domain([0, max]).range([0, iw]);
      var g = t.svg.append("g");
      t.svg.attr("aria-label", "strikes ranked by recorded volume");
      var tip = tipFor(host);

      label(g, m.l + iw, m.t - 5, d.unit || "", "end", C.muted, 8, 600);

      rows.forEach(function (row, index) {
        var y = m.t + index * rowH;
        var cy = y + rowH / 2;
        label(g, m.l - 6, cy + 3, RV.money(spec, row.strike, 0), "end", C.text, 8.5);
        if (isNum(row.volume)) {
          var barH = Math.max(3, rowH - 4);
          g.append("rect")
            .attr("x", m.l).attr("y", cy - barH / 2)
            .attr("width", Math.max(1, x(row.volume))).attr("height", barH)
            .attr("fill", C.amber).attr("fill-opacity", 0.82).attr("rx", 1)
            .style("cursor", "crosshair")
            .on("mousemove", function (event) {
              tip.show(event, RV.money(spec, row.strike, 0), [
                ["volume", valueText(row.volume, d.unit)]
              ]);
            })
            .on("mouseleave", function () { tip.hide(); });
          label(g, m.l + Math.max(1, x(row.volume)) + 5, cy + 3,
            compact(row.volume), "start", C.muted, 8.5);
        } else {
          label(g, m.l + 3, cy + 3, "no print", "start", C.muted, 8.5);
        }
      });
    });
  }

  RV.register("top_volume_strikes", function (host, payload) {
    drawTopVolume(host, payload);
  });

  /* ---- 7. event ribbon --------------------------------------------- */
  function toneColor(tone) {
    if (tone === "pos") return C.green;
    if (tone === "neg") return C.red;
    if (tone === "info") return C.blue;
    if (tone === "warn") return C.amber;
    return C.muted;
  }

  function wrap(text, size) {
    var value = String(text || "");
    var out = [];
    while (value.length > size) {
      out.push(value.slice(0, size));
      value = value.slice(size);
    }
    if (value) out.push(value);
    return out;
  }

  function drawsEvents(host, payload) {
    var d = payload.data || {};
    var spec = payload.spec || {};
    RV.onResize(host, function (width) {
      var events = d.events || [];
      var win = d.window || {};
      if (!events.length) { empty(host, "No events in this payload"); return; }
      var t = frame(host, width, host.clientHeight || 220);
      var W = t.W, H = t.H;
      var narrow = W < NARROW;
      var m = { l: 10, r: 10, t: 54, b: 24 };
      var iw = W - m.l - m.r;
      var baseY = Math.round(Math.min(H - m.b - 26, Math.max(m.t + 34, H * 0.62)));
      var x = d3.scaleLinear().domain([win.open_min, win.close_min]).range([m.l, m.l + iw]);
      var g = t.svg.append("g");
      t.svg.attr("aria-label", "event ribbon from " + win.open + " to " + win.close);

      g.append("line")
        .attr("x1", m.l).attr("x2", m.l + iw)
        .attr("y1", baseY).attr("y2", baseY)
        .attr("stroke", C.border);

      var firstTick = Math.ceil(win.open_min / 60) * 60;
      for (var minute = firstTick; minute <= win.close_min; minute += 60) {
        g.append("line")
          .attr("x1", x(minute)).attr("x2", x(minute))
          .attr("y1", baseY).attr("y2", baseY + 4)
          .attr("stroke", C.border);
        label(g, x(minute), baseY + 15, clockMinutes(minute), "middle", C.muted, 8);
      }

      var rowLast = [-1e9, -1e9, -1e9];
      var previous = 0;
      var tip = tipFor(host);
      events.forEach(function (event) {
        var px = x(event.start_min);
        var row = previous;
        if (px - rowLast[row] < 64) {
          row = (row + 1) % 3;
          var guard = 0;
          while (px - rowLast[row] < 64 && guard < 3) {
            row = (row + 1) % 3;
            guard += 1;
          }
        }
        rowLast[row] = px;
        previous = row;

        var color = toneColor(event.tone);
        var labelY = baseY - 8 - row * 14;
        g.append("line")
          .attr("x1", px).attr("x2", px)
          .attr("y1", baseY - 4).attr("y2", baseY + 4)
          .attr("stroke", color).attr("stroke-width", 1.6);
        if (event.end_min !== null && event.end_min !== undefined) {
          g.append("rect")
            .attr("x", px)
            .attr("y", baseY - 1.5)
            .attr("width", Math.max(1, x(event.end_min) - px))
            .attr("height", 3)
            .attr("fill", color).attr("fill-opacity", 0.35).attr("rx", 1);
        }
        var text = event.time + " · " + event.label;
        if (narrow && text.length > 20) text = text.slice(0, 19) + "…";
        var rightside = px > m.l + iw * 0.72;
        var node = label(g, rightside ? Math.max(m.l, px - 2) : Math.min(px, m.l + iw - 2),
          labelY, text, rightside ? "end" : "start", C.text, 8.5, 600);
        node.style("cursor", "help");
        node.on("mousemove", function (pointer) {
          var rows = [["time", event.time + (event.end ? "–" + event.end : "")]];
          wrap(event.detail, 52).forEach(function (chunk) { rows.push(["", chunk]); });
          tip.show(pointer, event.label, rows);
        }).on("mouseleave", function () { tip.hide(); });
      });

      label(g, m.l + iw, m.t - 22, win.open + "–" + win.close, "end", C.muted, 8);
    });
  }

  RV.register("event_annotations", function (host, payload) {
    drawsEvents(host, payload);
  });
})();
