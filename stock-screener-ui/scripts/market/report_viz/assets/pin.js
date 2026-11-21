/* Pin / spot / walls renderers.
 *
 * Registers: spot_pin, pin_score, pin_null, wall_migration.
 *
 * The pinned source drew these at fixed index units (25 points, a 50-point
 * ladder, rupee labels).  Here every unit comes from `payload.spec` and every
 * series from `payload.data`; a null in the data stays a gap on the path.
 */
(function () {
  "use strict";

  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  function C() { return RV.colors; }

  function isNum(value) {
    return typeof value === "number" && isFinite(value);
  }

  function numberOr(value, fallback) {
    return isNum(value) ? value : fallback;
  }

  function list(data, key) {
    var value = data[key];
    return Array.isArray(value) ? value : [];
  }

  function at(series, index) {
    return typeof index === "number" && index >= 0 && index < series.length ? series[index] : null;
  }

  function span(seriesList) {
    var n = 0;
    for (var i = 0; i < seriesList.length; i++) n = Math.max(n, seriesList[i].length);
    return n;
  }

  function indices(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(i);
    return out;
  }

  function finite(series) {
    var out = [];
    for (var i = 0; i < series.length; i++) if (isNum(series[i])) out.push(series[i]);
    return out;
  }

  function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function mean(values) {
    return values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : null;
  }

  function priceDigits(spec) {
    return Math.max(0, Math.min(4, Math.round(numberOr(spec.price_decimals, 2))));
  }

  function strikeStep(spec, band) {
    var step = Math.abs(numberOr(spec.strike_step, 0));
    return step > 0 ? step : Math.abs(band) * 2 || 1;
  }

  function fmt(value, digits) {
    if (!isNum(value)) return "—";
    var d = Math.max(0, Math.min(4, Math.round(numberOr(digits, 2))));
    return Number(value).toLocaleString("en-IN", {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  }

  function money(spec, value, digits) {
    if (!isNum(value)) return "—";
    return (spec.currency_symbol || "") + fmt(value, digits);
  }

  function signed(spec, value, digits) {
    if (!isNum(value)) return "—";
    var d = numberOr(digits, 1);
    return (value > 0 ? "+" : value < 0 ? "−" : "") + fmt(Math.abs(value), d);
  }

  function points(spec, value, digits) {
    if (!isNum(value)) return "—";
    return signed(spec, value, numberOr(digits, 1)) + " pts";
  }

  function clampPx(value, max) {
    return Math.max(0, Math.min(max, value));
  }

  function bandFor(data, spec, index) {
    var raw = data.pin_band;
    if (raw === null || raw === undefined) raw = data.band;
    if (Array.isArray(raw)) {
      var value = raw[index];
      if (!isNum(value) && index !== 0) value = raw[0];
      if (isNum(value) && value > 0) return Math.abs(value);
    } else if (isNum(raw) && raw > 0) {
      return Math.abs(raw);
    }
    return strikeStep(spec, 0) / 2;
  }

  function labelAt(labels, index) {
    var label = at(labels, index);
    return label === null || label === undefined || label === "" ? "minute " + (index + 1) : String(label);
  }

  function empty(host, message) {
    host.innerHTML = '<div class="rv-empty">' + message + "</div>";
  }

  function tipFor(host) {
    if (!host.__rvPinTip) host.__rvPinTip = RV.tip();
    return host.__rvPinTip;
  }

  function findExtreme(series, pick) {
    var best = null;
    for (var i = 0; i < series.length; i++) {
      var value = series[i];
      if (!isNum(value)) continue;
      if (best === null || (pick === "min" ? value < series[best] : value > series[best])) best = i;
    }
    return best;
  }

  // --------------------------------------------------------------- axis kit
  function frame(host, width, height) {
    var w = Math.max(320, Math.round(width || host.clientWidth || 320));
    var svg = RV.svg(host, height);
    // The callers use one `c` for both the frame and the palette. Keep that
    // convenience, but never return a bare frame object: `.text`/`.amber`
    // silently become undefined and D3 removes the stroke attribute.
    return Object.assign({ svg: svg, w: w, h: height }, C());
  }

  function xAxis(g, x, ih, t, withLabels) {
    var c = C();
    var axis = g.append("g").attr("class", "rv-pin-axis");
    axis.append("line")
      .attr("x1", 0).attr("x2", x.range()[1]).attr("y1", ih).attr("y2", ih)
      .attr("stroke", c.border);

    var labels = t.map(function (value) {
      return value === null || value === undefined ? "" : String(value);
    });
    var picked = RV.timeTicks(labels, 7) || [];
    var seen = [];
    picked.forEach(function (label) {
      if (!label) return;
      var index = labels.indexOf(label);
      if (index < 0 || seen.indexOf(index) >= 0) return;
      seen.push(index);
      axis.append("line")
        .attr("x1", x(index)).attr("x2", x(index)).attr("y1", ih).attr("y2", ih + 4)
        .attr("stroke", c.border);
      if (withLabels) {
        axis.append("text")
          .attr("x", x(index)).attr("y", ih + 15).attr("text-anchor", "middle")
          .attr("fill", c.muted).attr("font-size", 9.5).attr("font-family", MONO)
          .text(label);
      }
    });
  }

  function yGrid(g, y, iw, spec, ticks) {
    var c = C();
    var digits = strikeStep(spec, 0) >= 10 ? 0 : priceDigits(spec);
    ticks.forEach(function (value) {
      g.append("line")
        .attr("x1", 0).attr("x2", iw).attr("y1", y(value)).attr("y2", y(value))
        .attr("stroke", c.border).attr("stroke-opacity", 0.55);
      g.append("text")
        .attr("x", -7).attr("y", y(value)).attr("dy", "0.32em").attr("text-anchor", "end")
        .attr("fill", c.muted).attr("font-size", 9.5).attr("font-family", MONO)
        .text(money(spec, value, digits));
    });
  }

  function hover(svg, margin, iw, ih, x, n, tip, describe) {
    var c = C();
    var overlay = svg.append("g").attr("transform", "translate(" + margin.l + "," + margin.t + ")");
    var rule = overlay.append("line")
      .attr("y1", 0).attr("y2", ih)
      .attr("stroke", c.muted).attr("stroke-width", 1)
      .attr("stroke-dasharray", "2 3").attr("opacity", 0);
    var dot = overlay.append("circle").attr("r", 3).attr("fill", c.amber).attr("opacity", 0);
    var hot = overlay.append("rect")
      .attr("x", 0).attr("y", 0).attr("width", iw).attr("height", ih)
      .attr("fill", "transparent").style("cursor", "crosshair");

    function clear() {
      rule.attr("opacity", 0);
      dot.attr("opacity", 0);
      tip.hide();
    }

    hot.on("mousemove", function (event) {
      if (!n) return;
      var px = d3.pointer(event)[0];
      var index = Math.max(0, Math.min(n - 1, Math.round(x.invert(px))));
      var hit = describe(index);
      if (!hit) { clear(); return; }
      var dotX = isNum(hit.px) ? hit.px : x(index);
      rule.attr("x1", dotX).attr("x2", dotX).attr("opacity", 0.55);
      if (isNum(hit.py)) {
        dot.attr("cx", dotX).attr("cy", hit.py).attr("opacity", 1);
      } else {
        dot.attr("opacity", 0);
      }
      tip.show(event, hit.title, hit.rows);
    });
    hot.on("mouseleave", clear);
  }

  // ------------------------------------------------------- spot vs the pin
  RV.register("spot_pin", function (host, payload) {
    RV.onResize(host, function (width) {
      var spec = payload.spec || {};
      var data = payload.data || {};
      var t = list(data, "t");
      var spot = list(data, "spot");
      var maxPain = list(data, "max_pain");
      var callWall = list(data, "call_wall");
      var putWall = list(data, "put_wall");
      var n = span([t, spot, maxPain, callWall, putWall]);
      if (!n) { empty(host, "No spot / max-pain series in this panel"); return; }

      var height = 336;
      var margin = { t: 14, r: 14, b: 26, l: 58 };
      var c = frame(host, width, height);
      var iw = c.w - margin.l - margin.r;
      var ih = height - margin.t - margin.b;

      var band0 = bandFor(data, spec, 0);
      var levels = finite(spot).concat(finite(maxPain));
      if (!levels.length) { empty(host, "No spot or max-pain values to plot"); return; }

      var lo = Math.min.apply(null, levels) - band0;
      var hi = Math.max.apply(null, levels) + band0 * 1.4;
      if (!(hi > lo)) hi = lo + strikeStep(spec, band0);

      var x = d3.scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, iw]);
      var y = d3.scaleLinear().domain([lo, hi]).range([ih, 0]).nice();
      var g = c.svg.append("g").attr("transform", "translate(" + margin.l + "," + margin.t + ")");

      yGrid(g, y, iw, spec, y.ticks(6));
      xAxis(g, x, ih, t, true);

      var plot = g.append("g");
      var range = indices(n);

      var band = d3.area()
        .defined(function (i) { return isNum(at(maxPain, i)); })
        .x(function (i) { return x(i); })
        .y0(function (i) { return clampPx(y(at(maxPain, i) - bandFor(data, spec, i)), ih); })
        .y1(function (i) { return clampPx(y(at(maxPain, i) + bandFor(data, spec, i)), ih); })
        .curve(d3.curveStepAfter);
      plot.append("path").attr("d", band(range))
        .attr("fill", c.amber).attr("fill-opacity", 0.12).attr("stroke", "none");

      function stepLine(series, color, width, dash, opacity) {
        var line = d3.line()
          .defined(function (i) {
            var value = at(series, i);
            return isNum(value) && value >= lo && value <= hi;
          })
          .x(function (i) { return x(i); })
          .y(function (i) { return clampPx(y(at(series, i)), ih); })
          .curve(d3.curveStepAfter);
        plot.append("path").attr("d", line(range))
          .attr("fill", "none").attr("stroke", color).attr("stroke-width", width)
          .attr("stroke-dasharray", dash || null).attr("opacity", opacity === undefined ? 1 : opacity);
      }
      stepLine(callWall, c.red, 1.4, "5 3", 0.95);
      stepLine(putWall, c.green, 1.4, "5 3", 0.95);
      stepLine(maxPain, c.amber, 1.7, "1 3", 1);

      var spotLine = d3.line()
        .defined(function (i) { return isNum(at(spot, i)); })
        .x(function (i) { return x(i); })
        .y(function (i) { return y(at(spot, i)); });
      plot.append("path").attr("d", spotLine(range))
        .attr("fill", "none").attr("stroke", c.text).attr("stroke-width", 1.7);

      var hiIndex = findExtreme(spot, "max");
      var loIndex = findExtreme(spot, "min");
      [
        { index: hiIndex, text: "high " + money(spec, at(spot, hiIndex), priceDigits(spec)), offset: -8, anchor: "end" },
        { index: loIndex, text: "low " + money(spec, at(spot, loIndex), priceDigits(spec)), offset: 13, anchor: "start" }
      ].forEach(function (mark) {
        if (mark.index === null) return;
        plot.append("circle")
          .attr("cx", x(mark.index)).attr("cy", y(at(spot, mark.index))).attr("r", 2.6)
          .attr("fill", c.text);
        plot.append("text")
          .attr("x", x(mark.index)).attr("y", y(at(spot, mark.index)) + mark.offset)
          .attr("text-anchor", mark.anchor)
          .attr("fill", c.muted).attr("font-size", 9.5).attr("font-family", MONO)
          .text(mark.text);
      });

      var tip = tipFor(host);
      hover(c.svg, margin, iw, ih, x, n, tip, function (i) {
        var value = at(spot, i);
        var pin = at(maxPain, i);
        var band = bandFor(data, spec, i);
        var gap = isNum(value) && isNum(pin) ? value - pin : null;
        var score = isNum(gap) && band > 0
          ? Math.round(100 * Math.max(0, 1 - Math.abs(gap) / (2 * band)))
          : null;
        return {
          px: x(i),
          py: isNum(value) ? y(value) : null,
          title: labelAt(t, i),
          rows: [
            ["spot", money(spec, value, priceDigits(spec))],
            ["max pain", money(spec, pin, 0)],
            ["dist to pin", points(spec, gap)],
            ["pin score", isNum(score) ? score + " / 100" : "—"],
            ["call wall", money(spec, at(callWall, i), 0)],
            ["put wall", money(spec, at(putWall, i), 0)]
          ]
        };
      });
    });
  });

  // -------------------------------------------------------- pin-score strip
  RV.register("pin_score", function (host, payload) {
    RV.onResize(host, function (width) {
      var spec = payload.spec || {};
      var data = payload.data || {};
      var t = list(data, "t");
      var rawScore = list(data, "pin_score");
      var dist = list(data, "dist_pin");
      var spot = list(data, "spot");
      var n = span([t, rawScore, dist]);

      var scores = [];
      for (var i = 0; i < n; i++) {
        var value = at(rawScore, i);
        if (!isNum(value)) {
          var gap = at(dist, i);
          var band = bandFor(data, spec, i);
          value = isNum(gap) && band > 0
            ? 100 * Math.max(0, 1 - Math.abs(gap) / (2 * band))
            : null;
        }
        scores.push(isNum(value) ? Math.max(0, Math.min(100, value)) : null);
      }
      if (!finite(scores).length) {
        empty(host, "No pin-score or distance series in this panel");
        return;
      }

      var height = 140;
      var margin = { t: 10, r: 14, b: 22, l: 58 };
      var c = frame(host, width, height);
      var iw = c.w - margin.l - margin.r;
      var ih = height - margin.t - margin.b;

      var x = d3.scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, iw]);
      var y = d3.scaleLinear().domain([0, 100]).range([ih, 0]);
      var g = c.svg.append("g").attr("transform", "translate(" + margin.l + "," + margin.t + ")");

      [50, 100].forEach(function (level) {
        g.append("line")
          .attr("x1", 0).attr("x2", iw).attr("y1", y(level)).attr("y2", y(level))
          .attr("stroke", c.border).attr("stroke-opacity", level === 50 ? 0.55 : 0.3);
        g.append("text")
          .attr("x", -7).attr("y", level === 100 ? 4 : y(level)).attr("dy", level === 100 ? 0 : "0.32em")
          .attr("text-anchor", "end")
          .attr("fill", c.muted).attr("font-size", 9.5).attr("font-family", MONO)
          .text(level);
      });

      var range = indices(n);
      var area = d3.area()
        .defined(function (i) { return isNum(at(scores, i)); })
        .x(function (i) { return x(i); })
        .y0(ih)
        .y1(function (i) { return y(at(scores, i)); });
      g.append("path").attr("d", area(range))
        .attr("fill", c.amber).attr("fill-opacity", 0.22).attr("stroke", "none");

      var line = d3.line()
        .defined(function (i) { return isNum(at(scores, i)); })
        .x(function (i) { return x(i); })
        .y(function (i) { return y(at(scores, i)); });
      g.append("path").attr("d", line(range))
        .attr("fill", "none").attr("stroke", c.amber).attr("stroke-width", 1.3);

      xAxis(g, x, ih, t, false);

      var tip = tipFor(host);
      hover(c.svg, margin, iw, ih, x, n, tip, function (i) {
        var score = at(scores, i);
        var gap = at(dist, i);
        return {
          px: x(i),
          py: isNum(score) ? y(score) : null,
          title: labelAt(t, i) + " · pin",
          rows: [
            ["pin score", isNum(score) ? Math.round(score) + " / 100" : "—"],
            ["dist to pin", points(spec, gap)],
            ["spot", money(spec, at(spot, i), priceDigits(spec))]
          ]
        };
      });
    });
  });

  // --------------------------------------------- distance vs the null cone
  RV.register("pin_null", function (host, payload) {
    RV.onResize(host, function (width) {
      var spec = payload.spec || {};
      var data = payload.data || {};
      var t = list(data, "t");
      var obs = list(data, "obs");
      var p05 = list(data, "p05");
      var p50 = list(data, "p50");
      var p95 = list(data, "p95");
      var n = span([t, obs, p05, p50, p95]);
      if (!n) { empty(host, "No observed / null series in this panel"); return; }

      var height = 246;
      var margin = { t: 16, r: 14, b: 24, l: 58 };
      var c = frame(host, width, height);
      var iw = c.w - margin.l - margin.r;
      var ih = height - margin.t - margin.b;

      var topValues = finite(p95).concat(finite(obs));
      var top = topValues.length ? Math.max.apply(null, topValues) : 1;
      var x = d3.scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, iw]);
      var y = d3.scaleLinear().domain([0, top * 1.06 || 1]).range([ih, 0]).nice();
      var g = c.svg.append("g").attr("transform", "translate(" + margin.l + "," + margin.t + ")");

      yGrid(g, y, iw, spec, y.ticks(4));
      xAxis(g, x, ih, t, true);

      var range = indices(n);
      var cone = d3.area()
        .defined(function (i) { return isNum(at(p05, i)) && isNum(at(p95, i)); })
        .x(function (i) { return x(i); })
        .y0(function (i) { return y(at(p05, i)); })
        .y1(function (i) { return y(at(p95, i)); });
      g.append("path").attr("d", cone(range))
        .attr("fill", c.muted).attr("fill-opacity", 0.18).attr("stroke", "none");

      var medianLine = d3.line()
        .defined(function (i) { return isNum(at(p50, i)); })
        .x(function (i) { return x(i); })
        .y(function (i) { return y(at(p50, i)); });
      g.append("path").attr("d", medianLine(range))
        .attr("fill", "none").attr("stroke", c.muted).attr("stroke-width", 1.3)
        .attr("stroke-dasharray", "4 3");

      var observedLine = d3.line()
        .defined(function (i) { return isNum(at(obs, i)); })
        .x(function (i) { return x(i); })
        .y(function (i) { return y(at(obs, i)); });
      g.append("path").attr("d", observedLine(range))
        .attr("fill", "none").attr("stroke", c.amber).attr("stroke-width", 1.7);

      var observedMean = mean(finite(obs));
      var nullMedian = mean(finite(p50));
      if (isNum(observedMean) && isNum(nullMedian)) {
        g.append("text")
          .attr("x", iw).attr("y", 4).attr("text-anchor", "end")
          .attr("fill", c.muted).attr("font-size", 9.5).attr("font-family", MONO)
          .text("observed mean " + fmt(observedMean, 1) + " · null median " + fmt(nullMedian, 1));
      }

      var tip = tipFor(host);
      hover(c.svg, margin, iw, ih, x, n, tip, function (i) {
        return {
          px: x(i),
          py: isNum(at(obs, i)) ? y(at(obs, i)) : null,
          title: labelAt(t, i),
          rows: [
            ["observed |spot − pin|", fmt(at(obs, i), 1)],
            ["null median", fmt(at(p50, i), 1)],
            ["null p05–p95", fmt(at(p05, i), 0) + "–" + fmt(at(p95, i), 0)]
          ]
        };
      });
    });
  });

  // --------------------------------------------------------- wall migration
  RV.register("wall_migration", function (host, payload) {
    RV.onResize(host, function (width) {
      var spec = payload.spec || {};
      var data = payload.data || {};
      var t = list(data, "t");
      var spot = list(data, "spot");
      var maxPain = list(data, "max_pain");
      var callWall = list(data, "call_wall");
      var putWall = list(data, "put_wall");
      var n = span([t, spot, maxPain, callWall, putWall]);
      if (!n) { empty(host, "No walls in this panel"); return; }

      var height = 320;
      var margin = { t: 18, r: 14, b: 26, l: 58 };
      var c = frame(host, width, height);
      var iw = c.w - margin.l - margin.r;
      var ih = height - margin.t - margin.b;

      var band = bandFor(data, spec, 0);
      var step = strikeStep(spec, band);
      var spotValues = finite(spot);
      var wallValues = finite(callWall).concat(finite(putWall), finite(maxPain));
      if (!spotValues.length && !wallValues.length) {
        empty(host, "No wall or spot values to plot");
        return;
      }

      var pad = step * 1.4;
      var spotMin = spotValues.length ? Math.min.apply(null, spotValues) : Math.min.apply(null, wallValues);
      var spotMax = spotValues.length ? Math.max.apply(null, spotValues) : Math.max.apply(null, wallValues);
      var putMedian = median(finite(putWall));
      var callMedian = median(finite(callWall));
      var lo = Math.min(spotMin, isNum(putMedian) ? putMedian : spotMin) - pad;
      var hi = Math.max(spotMax, isNum(callMedian) ? callMedian : spotMax) + pad;
      if (!(hi > lo)) hi = lo + step;

      var x = d3.scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, iw]);
      var y = d3.scaleLinear().domain([lo, hi]).range([ih, 0]).nice();
      var g = c.svg.append("g").attr("transform", "translate(" + margin.l + "," + margin.t + ")");

      yGrid(g, y, iw, spec, y.ticks(5));
      xAxis(g, x, ih, t, true);
      g.append("text")
        .attr("x", iw).attr("y", 4).attr("text-anchor", "end")
        .attr("fill", c.muted).attr("font-size", 9.5).attr("font-family", MONO)
        .text("wall strike");

      var range = indices(n);

      function stepLine(series, color, lineWidth, dash, opacity) {
        var line = d3.line()
          .defined(function (i) {
            var value = at(series, i);
            return isNum(value) && value >= lo && value <= hi;
          })
          .x(function (i) { return x(i); })
          .y(function (i) { return clampPx(y(at(series, i)), ih); })
          .curve(d3.curveStepAfter);
        g.append("path").attr("d", line(range))
          .attr("fill", "none").attr("stroke", color).attr("stroke-width", lineWidth)
          .attr("stroke-dasharray", dash || null)
          .attr("opacity", opacity === undefined ? 1 : opacity);
      }
      stepLine(callWall, c.red, 2);
      stepLine(putWall, c.green, 2);
      stepLine(maxPain, c.amber, 1.4, "1 3");

      var spotLine = d3.line()
        .defined(function (i) { return isNum(at(spot, i)); })
        .x(function (i) { return x(i); })
        .y(function (i) { return clampPx(y(at(spot, i)), ih); });
      g.append("path").attr("d", spotLine(range))
        .attr("fill", "none").attr("stroke", c.text).attr("stroke-width", 1.2).attr("opacity", 0.75);

      var tip = tipFor(host);
      hover(c.svg, margin, iw, ih, x, n, tip, function (i) {
        var value = at(spot, i);
        var pin = at(maxPain, i);
        return {
          px: x(i),
          py: isNum(value) ? y(value) : null,
          title: labelAt(t, i),
          rows: [
            ["spot", money(spec, value, priceDigits(spec))],
            ["max pain", money(spec, pin, 0)],
            ["call wall", money(spec, at(callWall, i), 0)],
            ["put wall", money(spec, at(putWall, i), 0)],
            ["dist to pin", points(spec, isNum(value) && isNum(pin) ? value - pin : null)]
          ]
        };
      });
    });
  });
})();
