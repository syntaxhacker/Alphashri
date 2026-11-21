/* Positioning renderers: net CE/PE flow, strike divergence, PE heatmap, window
 * bars, volume/OI bubbles, participant classes, focus strike, terrain and the
 * live wall ladder.
 *
 * Payloads are `{spec, data}`.  `spec` owns currency, strike step and session;
 * a null is missing data and is drawn as a gap or a blank cell, never zero.
 */
(function () {
  "use strict";

  var C = RV.colors;
  var heatSeq = 0;

  function widthOf(host) { return Math.max(320, host.clientWidth || 900); }

  function heightOf(host, fallback) {
    return Math.max(160, (host.clientHeight || fallback || 300) - 8);
  }

  function blank(host, msg) {
    host.innerHTML = '<div class="rv-empty">' + msg + "</div>";
  }

  function missing(value) {
    return value === null || value === undefined || (typeof value === "number" && !isFinite(value));
  }

  function pointDecimals(spec) {
    return spec && Math.round(spec.strike_step) === Number(spec.strike_step)
      ? 0
      : Number(spec.price_decimals || 2);
  }

  function labelStyle(sel, size, color) {
    return sel.attr("fill", color || C.muted).style(
      "font",
      (size || 9) + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    );
  }

  function nearestPoint(labels, x, px) {
    var best = 0, dist = Infinity;
    labels.forEach(function (label, i) {
      var d = Math.abs(x(label) - px);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }

  function nearestBand(labels, x, px) {
    var bw = x.bandwidth ? x.bandwidth() : 0;
    var best = 0, dist = Infinity;
    labels.forEach(function (label, i) {
      var d = Math.abs(x(label) + bw / 2 - px);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }

  function bandTimeAxis(g, labels, x, ih, maxTicks) {
    var bw = x.bandwidth ? x.bandwidth() : 0;
    RV.timeTicks(labels, maxTicks || 8).forEach(function (label) {
      labelStyle(g.append("text")
        .attr("x", x(label) + bw / 2)
        .attr("y", ih + 15)
        .attr("text-anchor", "middle"), 9).text(label);
    });
  }

  function pointTimeAxis(g, labels, x, ih, maxTicks) {
    RV.timeTicks(labels, maxTicks || 8).forEach(function (label) {
      labelStyle(g.append("text")
        .attr("x", x(label))
        .attr("y", ih + 15)
        .attr("text-anchor", "middle"), 9).text(label);
    });
  }

  function signedDomain(values) {
    var ext = d3.max(values, function (v) { return missing(v) ? 0 : Math.abs(Number(v)); }) || 0;
    if (!(ext > 0)) ext = 1;
    return [-ext * 1.08, ext * 1.08];
  }

  function signedTick(value) {
    return RV.signed(value, Math.abs(value) < 10 ? 1 : 0);
  }

  function linePath(points, x, y) {
    return d3.line()
      .defined(function (p) { return !missing(p.v); })
      // A band-scale caller has already projected its x to pixels; a point
      // caller passes a label. Accept both, otherwise D3 emits MNaN paths.
      .x(function (p) { return typeof p.x === "number" ? p.x : x(p.x); })
      .y(function (p) { return y(Number(p.v)); })
      .curve(d3.curveMonotoneX)(points);
  }

  // ------------------------------------------------- 1. net CE / PE flow
  RV.register("ce_pe_net_positioning", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 620;
      var height = heightOf(host, 300);
      var t = d.t || [];
      if (!t.length) { blank(host, "No positioning buckets."); return; }

      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Net call and put open-interest change per bucket with spot");
      var m = { t: 16, r: wide ? 56 : 42, b: 26, l: wide ? 36 : 34 };
      var iw = Math.max(10, width - m.l - m.r);
      var ih = Math.max(40, height - m.t - m.b);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var x = d3.scaleBand().domain(t).range([0, iw]).paddingInner(0.28).paddingOuter(0.04);
      var domain = signedDomain((d.ce || []).concat(d.pe || []));
      var y = d3.scaleLinear().domain(domain).range([ih, 0]);

      (d.gaps || []).forEach(function (gap, i) {
        if (!gap) return;
        g.append("rect")
          .attr("x", x(t[i])).attr("y", 0)
          .attr("width", x.bandwidth()).attr("height", ih)
          .attr("fill", C.amber).attr("fill-opacity", 0.06);
      });

      y.ticks(wide ? 4 : 3).forEach(function (v) {
        if (Math.abs(v) > Math.abs(domain[0]) * 1.08) return;
        var yy = y(v);
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", yy).attr("y2", yy)
          .attr("stroke", C.border).attr("stroke-opacity", 0.5);
        labelStyle(g.append("text")
          .attr("x", -6).attr("y", yy).attr("dy", "0.32em")
          .attr("text-anchor", "end"), 9).text(RV.fmt(v, Math.abs(v) < 10 ? 1 : 0));
      });

      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", C.muted).attr("stroke-opacity", 0.75);

      var bw = Math.max(1, x.bandwidth() / 2);
      [{ key: "ce", color: C.green, off: 0 }, { key: "pe", color: C.red, off: bw }]
        .forEach(function (bar) {
          var values = d[bar.key] || [];
          t.forEach(function (label, i) {
            var value = values[i];
            if (missing(value)) return;
            var v = Number(value);
            g.append("rect")
              .attr("x", x(label) + bar.off)
              .attr("width", Math.max(1, bw - 0.5))
              .attr("y", v >= 0 ? y(v) : y(0))
              .attr("height", Math.max(1, Math.abs(y(v) - y(0))))
              .attr("fill", bar.color).attr("fill-opacity", 0.88);
          });
        });

      var spot = d.spot || [];
      var spotValues = [];
      t.forEach(function (_, i) {
        if (!missing(spot[i]) && Number(spot[i]) > 0) spotValues.push(Number(spot[i]));
      });
      var y2 = null;
      if (spotValues.length) {
        var lo = d3.min(spotValues), hi = d3.max(spotValues);
        var pad = (hi - lo) * 0.4;
        if (!(pad > 0)) pad = Math.max(1, Math.abs(hi) * 0.001);
        y2 = d3.scaleLinear().domain([lo - pad, hi + pad]).range([ih, 0]);
        var points = t.map(function (_, i) { return { x: x(t[i]) + x.bandwidth() / 2, v: spot[i] }; });
        var path = linePath(points, function (p) { return p.x; }, function (v) { return y2(v); });
        g.append("path").attr("d", path).attr("fill", "none")
          .attr("stroke", C.bg).attr("stroke-width", 4).attr("stroke-opacity", 0.5);
        g.append("path").attr("d", path).attr("fill", "none")
          .attr("stroke", C.amber).attr("stroke-width", 1.4);

        y2.ticks(wide ? 4 : 3).forEach(function (v) {
          labelStyle(g.append("text")
            .attr("x", iw + 6).attr("y", y2(v)).attr("dy", "0.32em"), 9)
            .text(RV.fmt(v, 0));
        });
        labelStyle(g.append("text").attr("x", iw + 6).attr("y", -6), 8)
          .text(d.spot_label || "spot");
      }

      bandTimeAxis(g, t, x, ih, wide ? 8 : 4);
      if (d.unit) {
        labelStyle(g.append("text").attr("x", 0).attr("y", -5), 8).text(d.unit);
      }

      var focus = g.append("line")
        .attr("stroke", C.text).attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2 3").attr("y1", 0).attr("y2", ih)
        .style("display", "none");
      var dot = g.append("circle").attr("r", 2.6).attr("fill", C.amber).style("display", "none");
      g.append("rect")
        .attr("width", iw).attr("height", ih)
        .attr("fill", "transparent").attr("cursor", "crosshair")
        .on("mousemove", function (event) {
          var i = nearestBand(t, x, d3.pointer(event, this)[0]);
          var cx = x(t[i]) + x.bandwidth() / 2;
          focus.style("display", null).attr("x1", cx).attr("x2", cx);
          if (y2 && !missing(spot[i])) {
            dot.style("display", null).attr("cx", cx).attr("cy", y2(Number(spot[i])));
          } else {
            dot.style("display", "none");
          }
          var rows = [
            ["CE net ΔOI", missing(d.ce[i]) ? "—" : RV.signed(d.ce[i], 2) + " " + (d.unit || "")],
            ["PE net ΔOI", missing(d.pe[i]) ? "—" : RV.signed(d.pe[i], 2) + " " + (d.unit || "")]
          ];
          if (d.spot && !missing(d.spot[i])) rows.push(["spot", RV.money(spec, d.spot[i])]);
          if ((d.gaps || [])[i]) rows.push(["bucket", "no print"]);
          tip.show(event, t[i], rows);
        })
        .on("mouseleave", function () {
          focus.style("display", "none");
          dot.style("display", "none");
          tip.hide();
        });
    });
  });

  // ------------------------------------------------- 2. strike divergence
  RV.register("ce_pe_divergence", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 520;
      var strikes = d.strikes || [];
      if (!strikes.length) { blank(host, "No strike divergence."); return; }

      var height = heightOf(host, strikes.length * 28 + 56);
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Call and put open-interest change at the same strikes");
      var m = { t: 24, r: wide ? 58 : 38, b: 26, l: wide ? 64 : 54 };
      var iw = Math.max(10, width - m.l - m.r);
      var ih = Math.max(40, height - m.t - m.b);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var ext = Number(d.axis_abs) || 1;
      var x = d3.scaleLinear().domain([-ext, ext]).range([0, iw]);
      var y = d3.scaleBand().domain(strikes.map(String)).range([0, ih]).paddingInner(0.24);

      g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", ih)
        .attr("stroke", C.muted).attr("stroke-opacity", 0.8);
      (wide ? [-ext, -ext / 2, ext / 2, ext] : [-ext, ext]).forEach(function (v) {
        g.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.border).attr("stroke-opacity", 0.35);
      });

      var half = Math.max(1, y.bandwidth() / 2 - 1);
      [{ key: "ce", color: C.green, off: 0 }, { key: "pe", color: C.red, off: half + 1 }]
        .forEach(function (bar) {
          var values = d[bar.key] || [];
          strikes.forEach(function (strike, i) {
            var value = values[i];
            if (missing(value)) return;
            var v = Number(value);
            g.append("rect")
              .attr("x", Math.min(x(0), x(v)))
              .attr("width", Math.max(1, Math.abs(x(v) - x(0))))
              .attr("y", y(String(strike)) + bar.off)
              .attr("height", half)
              .attr("fill", bar.color).attr("fill-opacity", 0.88);
            if (wide && Math.abs(x(v) - x(0)) > 30) {
              labelStyle(g.append("text")
                .attr("x", v >= 0 ? x(v) - 4 : x(v) + 4)
                .attr("y", y(String(strike)) + bar.off + half - 2)
                .attr("text-anchor", v >= 0 ? "end" : "start"), 8, C.text)
                .text(RV.signed(v, 1));
            }
          });
        });

      strikes.forEach(function (strike) {
        labelStyle(g.append("text")
          .attr("x", -8)
          .attr("y", y(String(strike)) + y.bandwidth() / 2)
          .attr("dy", "0.34em").attr("text-anchor", "end"), 9)
          .text(RV.fmt(strike, pointDecimals(spec)));
      });

      (wide ? [-ext, -ext / 2, 0, ext / 2, ext] : [-ext, 0, ext]).forEach(function (v) {
        labelStyle(g.append("text")
          .attr("x", x(v)).attr("y", ih + 14).attr("text-anchor", "middle"), 8)
          .text(signedTick(v));
      });
      if (d.unit) {
        labelStyle(g.append("text").attr("x", 0).attr("y", -8), 8)
          .text(d.label + " · " + d.unit);
      }
      if (!missing(d.spot_start) && !missing(d.spot_end) && wide) {
        labelStyle(g.append("text").attr("x", iw).attr("y", -8).attr("text-anchor", "end"), 8)
          .text("spot " + RV.money(spec, d.spot_start) + " → " + RV.money(spec, d.spot_end));
      }

      strikes.forEach(function (strike, i) {
        g.append("rect")
          .attr("x", 0).attr("y", y(String(strike)))
          .attr("width", iw).attr("height", y.bandwidth())
          .attr("fill", "transparent").attr("cursor", "crosshair")
          .on("mousemove", function (event) {
            tip.show(event, RV.fmt(strike, pointDecimals(spec)) + " · " + (d.label || "window"), [
              ["CE ΔOI", missing(d.ce[i]) ? "—" : RV.signed(d.ce[i], 2) + " " + (d.unit || "")],
              ["PE ΔOI", missing(d.pe[i]) ? "—" : RV.signed(d.pe[i], 2) + " " + (d.unit || "")],
              ["CE OI", missing(d.ce_oi[i]) ? "—" : RV.fmt(d.ce_oi[i], 1)],
              ["PE OI", missing(d.pe_oi[i]) ? "—" : RV.fmt(d.pe_oi[i], 1)]
            ]);
          })
          .on("mouseleave", function () { tip.hide(); });
      });
    });
  });

  // ------------------------------------------------- 3. PE OI heatmap
  RV.register("pe_oi_heatmap", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 520;
      var labels = d.labels || [];
      var strikes = (d.strikes || []).slice().reverse();
      if (!labels.length || !strikes.length) { blank(host, "No put OI grid."); return; }

      var height = heightOf(host, strikes.length * 22 + 96);
      var merge = wide ? 1 : 3;
      var cols = [];
      for (var i = 0; i < labels.length; i += merge) cols.push(i);

      var rowByStrike = {}, totalByStrike = {};
      (d.strikes || []).forEach(function (strike, index) {
        rowByStrike[strike] = (d.matrix || [])[index] || [];
        totalByStrike[strike] = (d.row_totals || [])[index];
      });

      var rowH = Math.max(11, Math.min(wide ? 24 : 18, (height - (wide ? 98 : 90)) / strikes.length));
      var ih = strikes.length * rowH;
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Put open-interest change by strike and time");
      var m = { t: 20, r: wide ? 56 : 40, b: 34, l: wide ? 60 : 46 };
      var iw = Math.max(10, width - m.l - m.r);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var xs = d3.scaleBand().domain(cols.map(String)).range([0, iw]).paddingInner(0.12);
      var ys = d3.scaleBand().domain(strikes.map(String)).range([0, ih]).paddingInner(0.12);
      var cellW = xs.bandwidth();
      var maxAbs = Number(d.axis_abs) || 1;
      var mid = d3.color(C.surface).brighter(0.7).formatHex();

      function cell(strike, start) {
        var row = rowByStrike[strike] || [];
        if (merge === 1) return row[start];
        var total = null;
        for (var k = start; k < Math.min(start + merge, labels.length); k++) {
          var v = row[k];
          if (missing(v) || isNaN(Number(v))) continue;
          total = (total === null ? 0 : total) + Number(v);
        }
        return total;
      }

      function rampColor(value) {
        var t = Math.pow(Math.min(1, Math.abs(Number(value)) / maxAbs), 0.55);
        return Number(value) >= 0
          ? d3.interpolateRgb(mid, C.amber)(t)
          : d3.interpolateRgb(mid, C.blue)(t);
      }

      strikes.forEach(function (strike) {
        cols.forEach(function (start) {
          var value = cell(strike, start);
          var isBlank = missing(value);
          g.append("rect")
            .attr("x", xs(String(start))).attr("y", ys(String(strike)))
            .attr("width", cellW).attr("height", ys.bandwidth()).attr("rx", 1)
            .attr("fill", isBlank ? C.surface : rampColor(value))
            .attr("stroke", isBlank ? C.border : "none")
            .attr("stroke-width", isBlank ? 0.6 : 0)
            .attr("stroke-opacity", isBlank ? 0.7 : 0)
            .attr("cursor", "crosshair")
            .on("mousemove", function (event) {
              var span = merge > 1
                ? labels[start] + "–" + labels[Math.min(start + merge - 1, labels.length - 1)]
                : labels[start];
              tip.show(event, span + " · " + RV.fmt(strike, pointDecimals(spec)) + " PE", [
                ["Δ OI", isBlank ? "—" : RV.signed(value, 2) + " " + (d.unit || "")],
                ["strike total", missing(totalByStrike[strike]) ? "—" : RV.signed(totalByStrike[strike], 2)],
                ["cell", isBlank ? "no print" : "printed"]
              ]);
            })
            .on("mouseleave", function () { tip.hide(); });
        });
      });

      strikes.forEach(function (strike) {
        var yy = ys(String(strike)) + ys.bandwidth() / 2;
        var emphasis = !missing(d.emphasis) && Number(d.emphasis) === Number(strike);
        if (emphasis) {
          g.append("rect")
            .attr("x", -4).attr("y", ys(String(strike)) - 1)
            .attr("width", iw + 4).attr("height", ys.bandwidth() + 2)
            .attr("fill", "none").attr("stroke", C.amber).attr("stroke-opacity", 0.8)
            .attr("pointer-events", "none");
        }
        labelStyle(g.append("text")
          .attr("x", -6).attr("y", yy).attr("dy", "0.34em")
          .attr("text-anchor", "end"), 9, emphasis ? C.amber : C.muted)
          .text(RV.fmt(strike, pointDecimals(spec)));
        labelStyle(g.append("text").attr("x", iw + 6).attr("y", yy).attr("dy", "0.34em"), 8)
          .text(missing(totalByStrike[strike]) ? "—" : RV.signed(totalByStrike[strike], 1));
      });

      var tickCols = cols.filter(function (start) {
        var minute = +String(labels[start]).slice(3, 5);
        return wide ? minute % 30 === 0 : minute % 60 === 0;
      });
      if (!tickCols.length) {
        var step = Math.max(1, Math.ceil(cols.length / 5));
        tickCols = cols.filter(function (_, index) { return index % step === 0; });
      }
      labelStyle(g.append("g").selectAll("text").data(tickCols).join("text"), 9)
        .attr("x", function (start) { return xs(String(start)) + cellW / 2; })
        .attr("y", ih + 15)
        .attr("text-anchor", "middle")
        .text(function (start) { return labels[start]; });

      labelStyle(g.append("text").attr("x", iw + 6).attr("y", -6), 8)
        .text((d.unit || "units") + (merge > 1 ? " / " + merge + " buckets" : ""));

      var keyW = Math.min(190, iw * 0.56), keyH = 6;
      var key = svg.append("g").attr("transform", "translate(" + m.l + "," + (m.t + ih + 44) + ")");
      var gid = "rv-pos-heat-" + (++heatSeq);
      var grad = key.append("defs").append("linearGradient").attr("id", gid);
      grad.append("stop").attr("offset", "0%").attr("stop-color", rampColor(-maxAbs));
      grad.append("stop").attr("offset", "50%").attr("stop-color", rampColor(0));
      grad.append("stop").attr("offset", "100%").attr("stop-color", rampColor(maxAbs));
      key.append("rect").attr("width", keyW).attr("height", keyH).attr("rx", 1)
        .attr("fill", "url(#" + gid + ")");
      labelStyle(key.append("text").attr("y", keyH + 10), 8).text(signedTick(-maxAbs));
      labelStyle(key.append("text").attr("x", keyW / 2).attr("y", keyH + 10)
        .attr("text-anchor", "middle"), 8).text("0");
      labelStyle(key.append("text").attr("x", keyW).attr("y", keyH + 10)
        .attr("text-anchor", "end"), 8).text(signedTick(maxAbs));
      labelStyle(key.append("text").attr("x", keyW + 8).attr("y", keyH + 3), 8)
        .text("Δ put OI");
    });
  });

  // ------------------------------------------------- 4. window bars
  RV.register("positioning_window_bars", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 620;
      var rows = d.rows || [];
      if (!rows.length) { blank(host, "No window strikes."); return; }

      var height = heightOf(host, 280);
      var rowH = wide
        ? Math.max(9, Math.min(26, (height - 66) / rows.length))
        : Math.max(7, Math.min(20, (height - 96) / (rows.length * 2)));
      var ih = rows.length * rowH;
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Put and call open-interest change by strike for the window");
      var m = { t: 28, r: wide ? 12 : 8, b: wide ? 30 : 16, l: wide ? 60 : 50 };
      var iw = Math.max(10, width - m.l - m.r);
      var ext = Number(d.axis_abs) || 1;
      var y = d3.scaleBand().domain(rows.map(function (row) { return String(row.strike); }))
        .range([0, ih]).paddingInner(0.3);
      var gap = 28;

      var panels;
      if (wide) {
        var colW = (iw - gap) / 2;
        panels = [
          { x: d3.scaleLinear().domain([-ext, ext]).range([0, colW]), color: C.red, title: "PUTS · Δ OI", offset: 0 },
          { x: d3.scaleLinear().domain([-ext, ext]).range([colW + gap, iw]), color: C.green, title: "CALLS · Δ OI", offset: 0 }
        ];
      } else {
        panels = [
          { x: d3.scaleLinear().domain([-ext, ext]).range([0, iw]), color: C.red, title: "PUTS · Δ OI", offset: 0 },
          { x: d3.scaleLinear().domain([-ext, ext]).range([0, iw]), color: C.green, title: "CALLS · Δ OI", offset: ih + 46 }
        ];
      }

      panels.forEach(function (panel, pi) {
        var gg = svg.append("g").attr("transform", "translate(" + m.l + "," + (m.t + panel.offset) + ")");
        var x = panel.x;
        var x0 = x.range()[0], x1 = x.range()[1];
        labelStyle(gg.append("text").attr("x", x0).attr("y", -9), 9, panel.color).text(panel.title);
        gg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.muted).attr("stroke-opacity", 0.8);
        (wide ? [-ext, -ext / 2, ext / 2, ext] : [-ext, ext]).forEach(function (v) {
          gg.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 0).attr("y2", ih)
            .attr("stroke", C.border).attr("stroke-opacity", 0.32);
        });

        rows.forEach(function (row) {
          var value = pi === 0 ? row.d_pe_oi : row.d_ce_oi;
          if (missing(value)) return;
          var v = Number(value);
          gg.append("rect")
            .attr("x", Math.min(x(0), x(v)))
            .attr("width", Math.max(1, Math.abs(x(v) - x(0))))
            .attr("y", y(String(row.strike)) + 1)
            .attr("height", Math.max(1, y.bandwidth() - 2))
            .attr("fill", panel.color).attr("fill-opacity", 0.9);
        });

        rows.forEach(function (row) {
          gg.append("rect")
            .attr("x", x0).attr("y", y(String(row.strike)))
            .attr("width", x1 - x0).attr("height", y.bandwidth())
            .attr("fill", "transparent").attr("cursor", "crosshair")
            .on("mousemove", function (event) {
              tip.show(event, RV.fmt(row.strike, pointDecimals(spec)) + " · " + (d.label || "window"), [
                ["PE ΔOI", missing(row.d_pe_oi) ? "—" : RV.signed(row.d_pe_oi, 2) + " " + (d.unit || "")],
                ["CE ΔOI", missing(row.d_ce_oi) ? "—" : RV.signed(row.d_ce_oi, 2) + " " + (d.unit || "")],
                ["PE OI", missing(row.pe_oi) ? "—" : RV.fmt(row.pe_oi, 1)],
                ["CE OI", missing(row.ce_oi) ? "—" : RV.fmt(row.ce_oi, 1)]
              ]);
            })
            .on("mouseleave", function () { tip.hide(); });
        });

        if (!wide || pi === 0) {
          rows.forEach(function (row) {
            labelStyle(gg.append("text")
              .attr("x", -6)
              .attr("y", y(String(row.strike)) + y.bandwidth() / 2)
              .attr("dy", "0.34em").attr("text-anchor", "end"), 8)
              .text(RV.fmt(row.strike, pointDecimals(spec)));
          });
        }

        [-ext, 0, ext].forEach(function (v) {
          labelStyle(gg.append("text")
            .attr("x", x(v)).attr("y", ih + 14).attr("text-anchor", "middle"), 8)
            .text(signedTick(v));
        });
      });

      labelStyle(svg.append("text").attr("x", m.l).attr("y", height - 5), 8)
        .text(d.unit || "units");
    });
  });

  // ------------------------------------------------- 5. volume vs net OI
  RV.register("volume_vs_net_oi", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 520;
      var rows = (d.rows || []).filter(function (row) {
        return !missing(row.volume) && !missing(row.d_oi) && Number(row.volume) >= 0;
      });
      if (!rows.length) { blank(host, "No volume/OI points."); return; }

      var height = heightOf(host, 320);
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Incremental put volume against put open-interest change");
      var m = { t: 18, r: wide ? 22 : 14, b: wide ? 46 : 40, l: wide ? 58 : 48 };
      var iw = Math.max(10, width - m.l - m.r);
      var ih = Math.max(50, height - m.t - m.b);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var xMax = d3.max(rows, function (row) { return Number(row.volume); }) || 1;
      var x = d3.scaleLinear().domain([0, xMax * 1.12]).range([0, iw]).nice();
      var ys = rows.map(function (row) { return Number(row.d_oi); });
      var lo = Math.min(0, d3.min(ys)), hi = Math.max(0, d3.max(ys));
      var pad = (hi - lo) * 0.16;
      if (!(pad > 0)) pad = 1;
      var y = d3.scaleLinear().domain([lo - pad, hi + pad]).range([ih, 0]).nice();
      var rMax = d3.max(rows, function (row) { return missing(row.oi) ? 0 : Number(row.oi); }) || 1;
      var radius = d3.scaleSqrt().domain([0, rMax]).range([3, wide ? 24 : 16]);

      y.ticks(wide ? 5 : 4).forEach(function (v) {
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v))
          .attr("stroke", C.border).attr("stroke-opacity", 0.4);
        labelStyle(g.append("text").attr("x", -6).attr("y", y(v)).attr("dy", "0.32em")
          .attr("text-anchor", "end"), 8).text(RV.signed(v, Math.abs(v) < 10 ? 1 : 0));
      });
      x.ticks(wide ? 6 : 4).forEach(function (v) {
        g.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.border).attr("stroke-opacity", 0.35);
        labelStyle(g.append("text").attr("x", x(v)).attr("y", ih + 15)
          .attr("text-anchor", "middle"), 8).text(RV.fmt(v, Math.abs(v) < 10 ? 1 : 0));
      });
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", C.muted).attr("stroke-dasharray", "4 3").attr("stroke-opacity", 0.8);
      if (wide) {
        labelStyle(g.append("text").attr("x", iw).attr("y", y(0) - 6)
          .attr("text-anchor", "end"), 8).text("no net OI change");
      }

      rows.forEach(function (row) {
        var cx = x(Number(row.volume)), cy = y(Number(row.d_oi));
        var rr = missing(row.oi) ? 3.5 : Math.max(2.5, radius(Number(row.oi)));
        g.append("circle")
          .attr("cx", cx).attr("cy", cy).attr("r", rr)
          .attr("fill", C.red).attr("fill-opacity", 0.3)
          .attr("stroke", C.red).attr("stroke-width", 1)
          .attr("cursor", "crosshair")
          .on("mousemove", function (event) {
            tip.show(event, RV.fmt(row.strike, pointDecimals(spec)) + " PE", [
              ["Δ volume", RV.fmt(row.volume, 2) + " " + (d.volume_unit || "")],
              ["Δ OI", RV.signed(row.d_oi, 2) + " " + (d.unit || "")],
              ["PE OI", missing(row.oi) ? "—" : RV.fmt(row.oi, 2)]
            ]);
          })
          .on("mouseleave", function () { tip.hide(); });
      });

      if (wide) {
        rows.slice().sort(function (a, b) {
          return (missing(b.oi) ? 0 : Number(b.oi)) - (missing(a.oi) ? 0 : Number(a.oi));
        }).slice(0, 3).forEach(function (row) {
          labelStyle(g.append("text")
            .attr("x", x(Number(row.volume)))
            .attr("y", y(Number(row.d_oi)) - (missing(row.oi) ? 5 : radius(Number(row.oi)) + 5))
            .attr("text-anchor", "middle"), 8)
            .text(RV.fmt(row.strike, pointDecimals(spec)));
        });
      }

      labelStyle(g.append("text").attr("x", iw).attr("y", ih + 32)
        .attr("text-anchor", "end"), 8).text("incremental volume →");
      labelStyle(g.append("text").attr("transform", "rotate(-90) translate(" + (-ih / 2) + ",-34)")
        .attr("text-anchor", "middle"), 8).text("Δ OI →");
      labelStyle(g.append("text").attr("x", 0).attr("y", ih + 32), 8)
        .text(d.volume_unit || "");
    });
  });

  // ------------------------------------------------- 6. class stream
  RV.register("participant_class_stream", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 620;
      var t = d.t || [], series = d.series || [], classes = d.classes || [];
      if (!t.length || !series.length) { blank(host, "No class buckets."); return; }

      var height = heightOf(host, 300);
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Participant class magnitudes per bucket");
      var m = { t: 16, r: 10, b: 26, l: 34 };
      var iw = Math.max(10, width - m.l - m.r);
      var ih = Math.max(40, height - m.t - m.b);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var x = d3.scalePoint().domain(t).range([0, iw]);

      var rows = t.map(function (_, i) {
        var row = { i: i, gap: !!(d.gaps || [])[i] };
        series.forEach(function (s) {
          row[s.id] = missing(s.values[i]) ? 0 : Number(s.values[i]);
        });
        return row;
      });

      var keys = series.map(function (s) { return s.id; });
      var color = {};
      classes.forEach(function (item) { color[item.id] = item.color; });
      var stack = d3.stack().keys(keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut);
      var stacked = stack(rows);
      var lo = d3.min(stacked, function (s) { return d3.min(s, function (p) { return p[0]; }); }) || 0;
      var hi = d3.max(stacked, function (s) { return d3.max(s, function (p) { return p[1]; }); }) || 1;
      if (!(hi > lo)) { hi = lo + 1; }
      var y = d3.scaleLinear().domain([lo, hi]).range([ih, 0]);

      var area = d3.area()
        .defined(function (p) { return !rows[p.data.i].gap; })
        .x(function (p) { return x(t[p.data.i]); })
        .y0(function (p) { return y(p[0]); })
        .y1(function (p) { return y(p[1]); })
        .curve(d3.curveBasis);

      stacked.forEach(function (s) {
        g.append("path").datum(s).attr("d", area)
          .attr("fill", color[s.key] || C.muted).attr("fill-opacity", 0.78)
          .attr("stroke", C.bg).attr("stroke-width", 0.6);
      });

      (d.gaps || []).forEach(function (gap, i) {
        if (!gap) return;
        g.append("line")
          .attr("x1", x(t[i])).attr("x2", x(t[i]))
          .attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.amber).attr("stroke-opacity", 0.25)
          .attr("stroke-dasharray", "2 3");
      });

      pointTimeAxis(g, t, x, ih, wide ? 8 : 4);
      if (d.unit) {
        labelStyle(g.append("text").attr("x", 0).attr("y", -5), 8).text(d.unit);
      }

      var focus = g.append("line")
        .attr("stroke", C.text).attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2 3").attr("y1", 0).attr("y2", ih)
        .style("display", "none");
      var hit = g.append("rect")
        .attr("width", iw).attr("height", ih)
        .attr("fill", "transparent").attr("cursor", "crosshair");
      hit.on("mousemove", function (event) {
        var i = nearestPoint(t, x, d3.pointer(event, this)[0]);
        focus.style("display", null).attr("x1", x(t[i])).attr("x2", x(t[i]));
        var detail = classes.map(function (item) {
          var source = series.filter(function (s) { return s.id === item.id; })[0];
          var value = source ? source.values[i] : null;
          return [item.label, missing(value) ? "—" : RV.fmt(value, 1) + " " + (d.unit || "")];
        });
        if ((d.gaps || [])[i]) detail.push(["bucket", "no chain data"]);
        tip.show(event, t[i], detail);
      }).on("mouseleave", function () {
        focus.style("display", "none");
        tip.hide();
      });
    });
  });

  // ------------------------------------------------- 7. class heatmap
  RV.register("participant_class_heatmap", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 520;
      var t = d.t || [], classes = d.classes || [];
      if (!t.length || !classes.length) { blank(host, "No class states."); return; }

      var height = heightOf(host, 160);
      var rowH = Math.max(9, Math.min(wide ? 22 : 17, (height - 54) / classes.length));
      var ih = classes.length * rowH;
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Participant class per bucket");
      var m = { t: 14, r: 8, b: 28, l: wide ? 76 : 52 };
      var iw = Math.max(10, width - m.l - m.r);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var xs = d3.scaleBand().domain(t.map(function (_, i) { return String(i); }))
        .range([0, iw]).paddingInner(wide ? 0.08 : 0.04);
      var ys = d3.scaleBand().domain(classes.map(function (item) { return item.id; }))
        .range([0, ih]).paddingInner(0.14);
      var byId = {};
      classes.forEach(function (item) { byId[item.id] = item; });

      (d.gaps || []).forEach(function (gap, i) {
        if (!gap) return;
        g.append("rect")
          .attr("x", xs(String(i))).attr("y", 0)
          .attr("width", xs.bandwidth()).attr("height", ih)
          .attr("fill", C.amber).attr("fill-opacity", 0.06);
        g.append("rect")
          .attr("x", xs(String(i))).attr("y", ih + 2)
          .attr("width", xs.bandwidth()).attr("height", 2)
          .attr("fill", C.amber).attr("fill-opacity", 0.6);
      });

      t.forEach(function (label, i) {
        var state = (d.states || [])[i];
        classes.forEach(function (item) {
          var active = state === item.id;
          g.append("rect")
            .attr("x", xs(String(i))).attr("y", ys(item.id))
            .attr("width", xs.bandwidth()).attr("height", ys.bandwidth()).attr("rx", 1)
            .attr("fill", active ? item.color : C.surface)
            .attr("fill-opacity", active ? 0.92 : 0.55)
            .attr("stroke", active ? "none" : C.border)
            .attr("stroke-width", active ? 0 : 0.5)
            .attr("stroke-opacity", active ? 0 : 0.45)
            .attr("cursor", "crosshair")
            .on("mousemove", function (event) {
              tip.show(event, label, [
                ["state", state ? (byId[state] ? byId[state].label : state) : "—"],
                ["gap", (d.gaps || [])[i] ? "no chain data" : "recorded"]
              ]);
            })
            .on("mouseleave", function () { tip.hide(); });
        });
      });

      classes.forEach(function (item) {
        labelStyle(g.append("text")
          .attr("x", -6).attr("y", ys(item.id) + ys.bandwidth() / 2)
          .attr("dy", "0.34em").attr("text-anchor", "end"), 8)
          .text(item.short || item.label);
      });

      var step = Math.max(1, Math.ceil(t.length / (wide ? 9 : 5)));
      var ticks = [];
      for (var i = 0; i < t.length; i += step) ticks.push(i);
      if (ticks[ticks.length - 1] !== t.length - 1) ticks.push(t.length - 1);
      ticks.forEach(function (i) {
        labelStyle(g.append("text")
          .attr("x", xs(String(i)) + xs.bandwidth() / 2)
          .attr("y", ih + 16).attr("text-anchor", "middle"), 8)
          .text(t[i]);
      });
    });
  });

  // ------------------------------------------------- 8. focus strike
  RV.register("participant_focus", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 520;
      var t = d.t || [];
      if (!t.length) { blank(host, "No focus series."); return; }

      var height = heightOf(host, 300);
      var classIds = d.class_ids || [];
      var stripH = classIds.length ? 8 : 0;
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Premium and open interest for the focus strike");
      var m = { t: 24, r: wide ? 44 : 34, b: wide ? 30 : 26, l: wide ? 38 : 32 };
      var iw = Math.max(10, width - m.l - m.r);
      var ih = Math.max(40, height - m.t - m.b - stripH - 8);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var x = d3.scalePoint().domain(t).range([0, iw]);
      var premium = d.premium || [], oi = d.oi || [], spot = d.spot || [];

      var premiumValues = premium.filter(function (v) { return !missing(v); }).map(Number);
      var oiValues = oi.filter(function (v) { return !missing(v); }).map(Number);
      var pLo = Math.min(0, d3.min(premiumValues) || 0);
      var pHi = d3.max(premiumValues) || 1;
      var pPad = (pHi - pLo) * 0.14;
      if (!(pPad > 0)) pPad = 1;
      var yp = d3.scaleLinear().domain([pLo, pHi + pPad]).range([ih, 0]);
      var oiHi = d3.max(oiValues) || 1;
      var yo = d3.scaleLinear().domain([0, oiHi * 1.15]).range([ih, 0]);

      var oiArea = d3.area()
        .defined(function (p) { return !missing(p.oi); })
        .x(function (p) { return x(t[p.i]); })
        .y0(ih)
        .y1(function (p) { return yo(Number(p.oi)); })
        .curve(d3.curveMonotoneX);
      var premiumLine = d3.line()
        .defined(function (p) { return !missing(p.premium); })
        .x(function (p) { return x(t[p.i]); })
        .y(function (p) { return yp(Number(p.premium)); })
        .curve(d3.curveMonotoneX);
      var points = t.map(function (_, i) {
        return { i: i, premium: premium[i], oi: oi[i], spot: spot[i] };
      });

      g.append("path").datum(points).attr("d", oiArea)
        .attr("fill", C.blue).attr("fill-opacity", 0.14);
      g.append("path").datum(points).attr("d", premiumLine)
        .attr("fill", "none").attr("stroke", C.blue).attr("stroke-width", 1.6);

      yp.ticks(3).forEach(function (v) {
        labelStyle(g.append("text").attr("x", -6).attr("y", yp(v)).attr("dy", "0.32em")
          .attr("text-anchor", "end"), 8).text(RV.fmt(v, 0));
      });
      yo.ticks(3).forEach(function (v) {
        labelStyle(g.append("text").attr("x", iw + 6).attr("y", yo(v)).attr("dy", "0.32em"), 8)
          .text(RV.fmt(v, 0));
      });

      if (stripH) {
        var classMap = {};
        (d.classes || []).forEach(function (item) { classMap[item.id] = item; });
        var step = t.length > 1 ? (x(t[1]) - x(t[0])) : iw;
        var cellW = Math.max(1, step * 0.9);
        classIds.forEach(function (cid, i) {
          var item = classMap[cid];
          g.append("rect")
            .attr("x", Math.max(0, Math.min(iw - cellW, x(t[i]) - cellW / 2)))
            .attr("y", ih + 4).attr("width", cellW).attr("height", stripH)
            .attr("fill", item ? item.color : C.surface);
        });
      }

      pointTimeAxis(g, t, x, ih, wide ? 8 : 4);
      labelStyle(g.append("text").attr("x", 0).attr("y", -10), 9).text(d.label || "");
      if (d.unit) {
        labelStyle(g.append("text").attr("x", iw + 6).attr("y", -10), 8).text(d.unit);
      }

      var focus = g.append("line")
        .attr("stroke", C.text).attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2 3").attr("y1", 0).attr("y2", ih)
        .style("display", "none");
      g.append("rect")
        .attr("width", iw).attr("height", ih + stripH + 6)
        .attr("fill", "transparent").attr("cursor", "crosshair")
        .on("mousemove", function (event) {
          var i = nearestPoint(t, x, d3.pointer(event, this)[0]);
          focus.style("display", null).attr("x1", x(t[i])).attr("x2", x(t[i]));
          var moneyness = (d.moneyness || [])[i];
          var detail = [
            ["premium", missing(premium[i]) ? "—" : RV.money(spec, premium[i])],
            ["OI", missing(oi[i]) ? "—" : RV.oi(oi[i])],
            ["Δ OI", missing((d.d_oi || [])[i]) ? "—" : RV.signed(d.d_oi[i], 1)]
          ];
          if (d.spot && !missing(d.spot[i])) detail.push(["spot", RV.money(spec, d.spot[i])]);
          if (!missing(moneyness)) {
            detail.push([
              "moneyness",
              RV.signed(moneyness, 1) + " " + (Number(moneyness) >= 0 ? "ITM" : "OTM")
            ]);
          }
          var cid = classIds[i];
          if (cid) {
            var item = (d.classes || []).filter(function (c) { return c.id === cid; })[0];
            detail.push(["class", item ? item.label : cid]);
          }
          tip.show(event, t[i], detail);
        })
        .on("mouseleave", function () {
          focus.style("display", "none");
          tip.hide();
        });
    });
  });

  // ------------------------------------------------- 9. strike terrain
  RV.register("strike_terrain", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 520;
      var strikes = d.strikes || [], net = d.net || [];
      if (!strikes.length) { blank(host, "No strike terrain."); return; }

      var height = heightOf(host, 280);
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Put minus call open interest by strike");
      var m = { t: 18, r: wide ? 16 : 10, b: 34, l: wide ? 44 : 38 };
      var iw = Math.max(10, width - m.l - m.r);
      var ih = Math.max(50, height - m.t - m.b);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var x = d3.scaleBand().domain(strikes.map(String)).range([0, iw])
        .paddingInner(0.18).paddingOuter(0.02);
      var domain = signedDomain(net);
      var y = d3.scaleLinear().domain(domain).range([ih, 0]);

      y.ticks(wide ? 4 : 3).forEach(function (v) {
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v))
          .attr("stroke", C.border).attr("stroke-opacity", 0.4);
        labelStyle(g.append("text").attr("x", -6).attr("y", y(v)).attr("dy", "0.32em")
          .attr("text-anchor", "end"), 8).text(signedTick(v));
      });
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", C.muted).attr("stroke-opacity", 0.8);

      strikes.forEach(function (strike, i) {
        var value = net[i];
        if (missing(value)) return;
        var v = Number(value);
        g.append("rect")
          .attr("x", x(String(strike)))
          .attr("width", x.bandwidth())
          .attr("y", v >= 0 ? y(v) : y(0))
          .attr("height", Math.max(1, Math.abs(y(v) - y(0))))
          .attr("fill", v >= 0 ? C.red : C.green)
          .attr("fill-opacity", 0.82)
          .attr("cursor", "crosshair")
          .on("mousemove", function (event) {
            var detail = [
              ["net PE − CE", RV.signed(v, 1) + " " + (d.unit || "")],
              ["PE OI", missing((d.pe_oi || [])[i]) ? "—" : RV.fmt(d.pe_oi[i], 1)],
              ["CE OI", missing((d.ce_oi || [])[i]) ? "—" : RV.fmt(d.ce_oi[i], 1)]
            ];
            if (!missing(d.spot)) {
              detail.push(["spot − strike", RV.signed(Number(d.spot) - strike, 1) + " pts"]);
            }
            tip.show(event, RV.fmt(strike, pointDecimals(spec)), detail);
          })
          .on("mouseleave", function () { tip.hide(); });
      });

      if (!missing(d.spot) && !missing(d.atm)) {
        var cx = x(String(d.atm)) + x.bandwidth() / 2;
        g.append("line").attr("x1", cx).attr("x2", cx).attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.amber).attr("stroke-opacity", 0.55)
          .attr("stroke-dasharray", "3 3");
        labelStyle(g.append("text").attr("x", cx + 3).attr("y", -6), 8, C.amber)
          .text("spot " + RV.money(spec, d.spot));
      }

      var step = Math.max(1, Math.ceil(strikes.length / (wide ? 9 : 4)));
      strikes.forEach(function (strike, i) {
        if (i % step !== 0 && i !== strikes.length - 1) return;
        labelStyle(g.append("text")
          .attr("x", x(String(strike)) + x.bandwidth() / 2)
          .attr("y", ih + 15).attr("text-anchor", "middle"), 8)
          .text(RV.fmt(strike, pointDecimals(spec)));
      });
      if (d.unit) {
        labelStyle(g.append("text").attr("x", 0).attr("y", -5), 8).text(d.unit);
      }
    });
  });

  // ------------------------------------------------- 10. wall ladder
  RV.register("wall_ladder", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 620;
      var t = d.t || [];
      if (!t.length) { blank(host, "No wall ladder."); return; }

      var height = heightOf(host, 260);
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Call, put and max-pain distance from live spot");
      var m = { t: 18, r: wide ? 46 : 36, b: 26, l: wide ? 40 : 34 };
      var iw = Math.max(10, width - m.l - m.r);
      var ih = Math.max(40, height - m.t - m.b);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var x = d3.scalePoint().domain(t).range([0, iw]);
      var all = (d.call || []).concat(d.put || [], d.max_pain || []);
      var domain = signedDomain(all);
      var y = d3.scaleLinear().domain(domain).range([ih, 0]);

      y.ticks(wide ? 4 : 3).forEach(function (v) {
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v))
          .attr("stroke", C.border).attr("stroke-opacity", 0.4);
        labelStyle(g.append("text").attr("x", -6).attr("y", y(v)).attr("dy", "0.32em")
          .attr("text-anchor", "end"), 8).text(signedTick(v));
      });
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", C.muted).attr("stroke-opacity", 0.8);
      labelStyle(g.append("text").attr("x", iw).attr("y", y(0) - 5)
        .attr("text-anchor", "end"), 8).text("spot");

      function draw(values, color, width, dash) {
        var points = t.map(function (_, i) { return { x: x(t[i]), v: values[i] }; });
        var path = linePath(points, function (p) { return p.x; }, function (v) { return y(v); });
        g.append("path").attr("d", path).attr("fill", "none").attr("stroke", color)
          .attr("stroke-width", width || 1.4)
          .attr("stroke-dasharray", dash || null);
      }
      draw(d.call || [], C.red, 1.5, null);
      draw(d.put || [], C.green, 1.5, null);
      draw(d.max_pain || [], C.amber, 1, "3 3");

      pointTimeAxis(g, t, x, ih, wide ? 8 : 4);
      labelStyle(g.append("text").attr("x", 0).attr("y", -5), 8).text(d.unit || "pts");

      var focus = g.append("line")
        .attr("stroke", C.text).attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2 3").attr("y1", 0).attr("y2", ih)
        .style("display", "none");
      g.append("rect")
        .attr("width", iw).attr("height", ih)
        .attr("fill", "transparent").attr("cursor", "crosshair")
        .on("mousemove", function (event) {
          var i = nearestPoint(t, x, d3.pointer(event, this)[0]);
          focus.style("display", null).attr("x1", x(t[i])).attr("x2", x(t[i]));
          var spot = (d.spot || [])[i];
          var call = (d.call || [])[i], put = (d.put || [])[i], mp = (d.max_pain || [])[i];
          var detail = [["spot", missing(spot) ? "—" : RV.money(spec, spot)]];
          if (!missing(call)) {
            detail.push(["call gap", RV.signed(call, 1) + " pts"]);
            if (!missing(spot)) detail.push(["call wall", RV.money(spec, Number(spot) + Number(call))]);
          }
          if (!missing(put)) {
            detail.push(["put gap", RV.signed(put, 1) + " pts"]);
            if (!missing(spot)) detail.push(["put wall", RV.money(spec, Number(spot) + Number(put))]);
          }
          if (!missing(mp)) detail.push(["max pain gap", RV.signed(mp, 1) + " pts"]);
          tip.show(event, t[i], detail);
        })
        .on("mouseleave", function () {
          focus.style("display", "none");
          tip.hide();
        });
    });
  });
})();
