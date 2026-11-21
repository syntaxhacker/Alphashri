/* Flow renderers: volume stream, ITM put share, strike heatmap, top ITM bars.
 *
 * Every payload is `{spec, data}`.  `spec` carries the instrument/units and
 * `data` is the normalised series; a null is missing data and is drawn as a
 * gap (or a blank cell), never as zero.
 */
(function () {
  "use strict";

  var C = RV.colors;
  var heatSeq = 0;

  function widthOf(host) { return Math.max(320, host.clientWidth || 900); }

  function blank(host, msg) {
    host.innerHTML = '<div class="rv-empty">' + msg + "</div>";
  }

  function missing(value) {
    return value === null || value === undefined || (typeof value === "number" && !isFinite(value));
  }

  function num(value) {
    return missing(value) || isNaN(Number(value)) ? 0 : Number(value);
  }

  function pointDecimals(spec) {
    return spec && Math.round(spec.strike_step) === Number(spec.strike_step) ? 0 : Number(spec.price_decimals || 2);
  }

  function labelStyle(sel, size, color) {
    return sel.attr("fill", color || C.muted).style("font", (size || 9) + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
  }

  function timeAxis(g, labels, x, ih, maxTicks) {
    var ticks = RV.timeTicks(labels, maxTicks || 8);
    labelStyle(g.append("g").selectAll("text").data(ticks).join("text"), 9)
      .attr("x", function (d) { return x(d); })
      .attr("y", ih + 15)
      .attr("text-anchor", "middle")
      .text(function (d) { return d; });
  }

  function nearest(labels, x, px) {
    var best = 0, dist = Infinity;
    labels.forEach(function (label, i) {
      var d = Math.abs(x(label) - px);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }

  function numericDomain(values) {
    var lo = d3.min(values), hi = d3.max(values);
    if (lo === undefined || hi === undefined) return [0, 1];
    var pad = (hi - lo) * 0.35;
    if (!(pad > 0)) pad = Math.max(1, Math.abs(hi) * 0.001);
    return [lo - pad, hi + pad];
  }

  // ---------------------------------------------------------------- stream
  RV.register("flow_stream", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 620;
      var height = wide ? 300 : 240;
      var t = d.t || [];
      if (!t.length) { blank(host, "No flow buckets."); return; }

      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Call and put volume increments with spot");
      var m = { t: 16, r: wide ? 56 : 40, b: 26, l: wide ? 10 : 6 };
      var iw = Math.max(10, width - m.l - m.r), ih = height - m.t - m.b;
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var x = d3.scalePoint().domain(t).range([0, iw]);

      var hasItm = !!(d.ce_itm || d.pe_itm);
      var rows, keys, stack, color, opac;
      if (hasItm) {
        rows = t.map(function (_, i) {
          var ce = num(d.ce[i]), pe = num(d.pe[i]);
          var ceItm = num((d.ce_itm || [])[i]), peItm = num((d.pe_itm || [])[i]);
          return {
            i: i,
            pe_otm: Math.max(pe - peItm, 0), pe_itm: peItm,
            ce_otm: Math.max(ce - ceItm, 0), ce_itm: ceItm
          };
        });
        keys = ["pe_otm", "pe_itm", "ce_otm", "ce_itm"];
        stack = d3.stack().keys(keys).offset(d3.stackOffsetWiggle);
        color = { pe_otm: C.red, pe_itm: C.red, ce_otm: C.green, ce_itm: C.green };
        opac = { pe_otm: 0.30, pe_itm: 0.92, ce_otm: 0.26, ce_itm: 0.80 };
      } else {
        rows = t.map(function (_, i) { return { i: i, pe: num(d.pe[i]), ce: num(d.ce[i]) }; });
        keys = ["pe", "ce"];
        stack = d3.stack().keys(keys).offset(d3.stackOffsetNone);
        color = { pe: C.red, ce: C.green };
        opac = { pe: 0.55, ce: 0.55 };
      }

      var series = stack(rows);
      var lo = d3.min(series, function (s) { return d3.min(s, function (p) { return p[0]; }); });
      var hi = d3.max(series, function (s) { return d3.max(s, function (p) { return p[1]; }); });
      if (lo === hi) { lo -= 1; hi += 1; }
      var y = d3.scaleLinear().domain([lo, hi]).range([ih, 0]).nice();

      var area = d3.area()
        .x(function (p) { return x(t[p.data.i]); })
        .y0(function (p) { return y(p[0]); })
        .y1(function (p) { return y(p[1]); })
        .curve(d3.curveBasis);
      g.selectAll("path.rv-band").data(series).join("path")
        .attr("class", "rv-band")
        .attr("d", area)
        .attr("fill", function (s) { return color[s.key]; })
        .attr("opacity", function (s) { return opac[s.key]; });

      (d.marks || []).forEach(function (mark) {
        if (t.indexOf(mark.t) < 0) return;
        var cx = x(mark.t);
        g.append("line")
          .attr("x1", cx).attr("x2", cx).attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.amber).attr("stroke-opacity", 0.28)
          .attr("stroke-dasharray", "2 3");
        if (wide) {
          labelStyle(g.append("text").attr("x", cx + 3).attr("y", -6), 9, C.amber)
            .text(mark.label);
        }
      });

      var spot = d.spot || [];
      var y2 = null;
      var spotPoints = t.map(function (_, i) { return { i: i, v: spot[i] }; })
        .filter(function (p) { return !missing(p.v) && Number(p.v) > 0; });
      if (spotPoints.length) {
        y2 = d3.scaleLinear()
          .domain(numericDomain(spotPoints.map(function (p) { return Number(p.v); })))
          .range([ih, 0]);
        var spotLine = d3.line()
          .defined(function (p) { return !missing(p.v); })
          .x(function (p) { return x(t[p.i]); })
          .y(function (p) { return y2(Number(p.v)); })
          .curve(d3.curveBasis);
        g.append("path").datum(spotPoints).attr("fill", "none")
          .attr("stroke", C.bg).attr("stroke-width", 4).attr("stroke-opacity", 0.55)
          .attr("d", spotLine);
        g.append("path").datum(spotPoints).attr("fill", "none")
          .attr("stroke", C.amber).attr("stroke-width", 1.4).attr("d", spotLine);

        var yTicks = y2.ticks(wide ? 4 : 3);
        labelStyle(g.append("g").selectAll("text").data(yTicks).join("text"), 9)
          .attr("x", iw + 6).attr("y", function (v) { return y2(v); })
          .attr("dy", "0.32em")
          .text(function (v) { return RV.fmt(v, 0); });
        labelStyle(g.append("text").attr("x", iw + 6).attr("y", -7), 8)
          .text(d.spot_label || "spot");
      }

      timeAxis(g, t, x, ih, wide ? 8 : 4);
      if (d.unit) {
        labelStyle(g.append("text").attr("x", 0).attr("y", -5), 8).text(d.unit);
      }

      var focus = g.append("line")
        .attr("stroke", C.text).attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2 3").attr("y1", 0).attr("y2", ih)
        .style("display", "none");
      var dot = g.append("circle").attr("r", 2.6).attr("fill", C.amber).style("display", "none");
      g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent")
        .attr("cursor", "crosshair")
        .on("mousemove", function (event) {
          var i = nearest(t, x, d3.pointer(event, this)[0]);
          focus.style("display", null).attr("x1", x(t[i])).attr("x2", x(t[i]));
          var rowsOut = [
            ["CE", RV.fmt(d.ce[i], 1) + " " + (d.unit || "")],
            ["PE", RV.fmt(d.pe[i], 1) + " " + (d.unit || "")]
          ];
          if (d.pe_itm) {
            var pe = num(d.pe[i]), peItm = d.pe_itm[i];
            var share = !missing(peItm) && pe > 0 ? RV.fmt((peItm / pe) * 100, 1) + "%" : "—";
            rowsOut.push(["ITM PE", RV.fmt(peItm, 1) + " · " + share]);
          }
          if (!missing(spot[i]) && y2) {
            rowsOut.push(["spot", RV.money(spec, spot[i])]);
            dot.style("display", null).attr("cx", x(t[i])).attr("cy", y2(Number(spot[i])));
          } else {
            dot.style("display", "none");
          }
          tip.show(event, t[i], rowsOut);
        })
        .on("mouseleave", function () {
          focus.style("display", "none");
          dot.style("display", "none");
          tip.hide();
        });
    });
  });

  // ---------------------------------------------------------------- share
  RV.register("flow_share", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 620;
      var height = wide ? 240 : 210;
      var t = d.t || [];
      var values = (d.share || []).filter(function (v) { return !missing(v); });
      if (!t.length || !values.length) { blank(host, "No share values."); return; }

      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", d.label || "ITM PE share of PE volume");
      var m = { t: 26, r: wide ? 44 : 30, b: 26, l: wide ? 40 : 34 };
      var iw = Math.max(10, width - m.l - m.r), ih = height - m.t - m.b;
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var x = d3.scalePoint().domain(t).range([0, iw]);
      var top = Math.max(20, Math.ceil((d3.max(values) || 0) / 5) * 5);
      var y = d3.scaleLinear().domain([0, top]).range([ih, 0]);

      labelStyle(g.append("text").attr("x", 0).attr("y", -12), 8).text(d.label || "");

      y.ticks(wide ? 4 : 3).forEach(function (v) {
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v))
          .attr("stroke", C.border).attr("stroke-opacity", 0.55);
        labelStyle(g.append("text").attr("x", -6).attr("y", y(v)).attr("dy", "0.32em")
          .attr("text-anchor", "end"), 9).text(v + "%");
      });

      var area = d3.area()
        .defined(function (row) { return !missing(row.share); })
        .x(function (row) { return x(row.t); })
        .y0(ih)
        .y1(function (row) { return y(row.share); })
        .curve(d3.curveMonotoneX);
      var line = d3.line()
        .defined(function (row) { return !missing(row.share); })
        .x(function (row) { return x(row.t); })
        .y(function (row) { return y(row.share); })
        .curve(d3.curveMonotoneX);
      var series = t.map(function (label, i) { return { t: label, share: d.share[i] }; });

      g.append("path").datum(series).attr("d", area).attr("fill", C.red).attr("opacity", 0.14);
      g.append("path").datum(series).attr("d", line).attr("fill", "none")
        .attr("stroke", C.red).attr("stroke-width", 1.6);

      if (!missing(d.median)) {
        g.append("line").attr("x1", 0).attr("x2", iw)
          .attr("y1", y(d.median)).attr("y2", y(d.median))
          .attr("stroke", C.muted).attr("stroke-dasharray", "4 4").attr("stroke-opacity", 0.6);
        labelStyle(g.append("text").attr("x", iw).attr("y", y(d.median) - 5)
          .attr("text-anchor", "end").attr("paint-order", "stroke")
          .attr("stroke", C.surface).attr("stroke-width", 3), 9)
          .text("median " + RV.fmt(d.median, 1) + "%");
      }

      timeAxis(g, t, x, ih, wide ? 8 : 4);

      var focus = g.append("line").attr("stroke", C.text).attr("stroke-opacity", 0.45)
        .attr("stroke-dasharray", "2 3").attr("y1", 0).attr("y2", ih).style("display", "none");
      var dot = g.append("circle").attr("r", 3).attr("fill", C.red)
        .attr("stroke", C.bg).attr("stroke-width", 1.2).style("display", "none");
      g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent")
        .attr("cursor", "crosshair")
        .on("mousemove", function (event) {
          var i = nearest(t, x, d3.pointer(event, this)[0]);
          var share = d.share[i];
          focus.style("display", null).attr("x1", x(t[i])).attr("x2", x(t[i]));
          if (missing(share)) {
            dot.style("display", "none");
          } else {
            dot.style("display", null).attr("cx", x(t[i])).attr("cy", y(share));
          }
          var rows = [["share", missing(share) ? "—" : RV.fmt(share, 1) + "%"]];
          if (d.spot && !missing(d.spot[i])) rows.push(["spot", RV.money(spec, d.spot[i])]);
          rows.push(["bucket", t[i]]);
          tip.show(event, d.label || "ITM PE share", rows);
        })
        .on("mouseleave", function () {
          focus.style("display", "none");
          dot.style("display", "none");
          tip.hide();
        });
    });
  });

  // -------------------------------------------------------------- heatmap
  RV.register("flow_heatmap", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 520;
      var labels = d.labels || [], strikes = d.strikes || [], matrix = d.matrix || [];
      if (!labels.length || !strikes.length) { blank(host, "No strike grid."); return; }

      var merge = wide ? 1 : 3;
      var cols = [];
      for (var i = 0; i < labels.length; i += merge) cols.push(i);
      var rowH = wide ? 22 : 17;
      var height = strikes.length * rowH + (wide ? 100 : 92);
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Put volume by strike and time");
      var m = { t: 20, r: wide ? 54 : 40, b: 34, l: wide ? 58 : 46 };
      var iw = Math.max(10, width - m.l - m.r), ih = strikes.length * rowH;
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var xs = d3.scaleBand().domain(cols.map(String)).range([0, iw]).paddingInner(0.12);
      var ys = d3.scaleBand().domain(strikes.map(String)).range([0, ih]).paddingInner(0.12);
      var cellW = xs.bandwidth();

      function cell(ri, start) {
        if (merge === 1) return matrix[ri][start];
        var total = null;
        for (var k = start; k < Math.min(start + merge, labels.length); k++) {
          var v = matrix[ri][k];
          if (missing(v) || isNaN(Number(v))) continue;
          total = (total === null ? 0 : total) + Number(v);
        }
        return total;
      }

      var flat = [];
      matrix.forEach(function (row) {
        row.forEach(function (v) { if (!missing(v) && isFinite(Number(v))) flat.push(Number(v)); });
      });
      var maxV = flat.length ? d3.max(flat) : 1;
      if (!(maxV > 0)) maxV = 1;
      var low = d3.color(C.surface).brighter(0.85).formatHex();
      function rampColor(t) {
        t = Math.max(0, Math.min(1, Number(t)));
        return d3.interpolateRgb(low, C.amber)(Math.pow(t, 0.62));
      }

      strikes.forEach(function (strike, ri) {
        cols.forEach(function (start) {
          var value = cell(ri, start);
          var isBlank = missing(value);
          g.append("rect")
            .attr("x", xs(String(start))).attr("y", ys(String(strike)))
            .attr("width", cellW).attr("height", ys.bandwidth()).attr("rx", 1)
            .attr("fill", isBlank ? C.surface : rampColor(value / maxV))
            .attr("stroke", isBlank ? C.border : "none")
            .attr("stroke-width", isBlank ? 0.6 : 0)
            .attr("stroke-opacity", isBlank ? 0.7 : 0)
            .attr("cursor", "crosshair")
            .on("mousemove", function (event) {
              var span = merge > 1
                ? labels[start] + "–" + labels[Math.min(start + merge - 1, labels.length - 1)]
                : labels[start];
              tip.show(event, span + " · " + RV.fmt(strike, pointDecimals(spec)) + " PE", [
                ["increment", isBlank ? "—" : RV.fmt(value, 1) + " " + (d.unit || "")],
                ["strike total", missing((d.row_totals || [])[ri]) ? "—" : RV.fmt(d.row_totals[ri], 1)],
                ["cell", isBlank ? "no print" : "printed"]
              ]);
            })
            .on("mouseleave", function () { tip.hide(); });
        });
      });

      strikes.forEach(function (strike, ri) {
        var yy = ys(String(strike)) + ys.bandwidth() / 2;
        var emphasis = !missing(d.emphasis) && Number(d.emphasis) === Number(strike);
        if (emphasis) {
          g.append("rect").attr("x", -4).attr("y", ys(String(strike)) - 1)
            .attr("width", iw + 4).attr("height", ys.bandwidth() + 2)
            .attr("fill", "none").attr("stroke", C.amber).attr("stroke-opacity", 0.8)
            .attr("pointer-events", "none");
          g.append("rect").attr("x", -m.l).attr("y", ys(String(strike)) - 1)
            .attr("width", 2.5).attr("height", ys.bandwidth() + 2)
            .attr("fill", C.amber).attr("pointer-events", "none");
        }
        labelStyle(g.append("text").attr("x", -6).attr("y", yy).attr("dy", "0.34em")
          .attr("text-anchor", "end"), 9, emphasis ? C.amber : C.muted)
          .text(RV.fmt(strike, pointDecimals(spec)));
        labelStyle(g.append("text").attr("x", iw + 6).attr("y", yy).attr("dy", "0.34em"), 8)
          .text(missing((d.row_totals || [])[ri]) ? "—" : RV.fmt(d.row_totals[ri], 1));
      });

      var tickCols = cols.filter(function (start) {
        var mm = +labels[start].slice(3, 5);
        return wide ? mm % 30 === 0 : mm % 60 === 0;
      });
      if (!tickCols.length) {
        var step = Math.max(1, Math.ceil(cols.length / 5));
        tickCols = cols.filter(function (_, i) { return i % step === 0; });
      }
      labelStyle(g.append("g").selectAll("text").data(tickCols).join("text"), 9)
        .attr("x", function (start) { return xs(String(start)) + cellW / 2; })
        .attr("y", ih + 15)
        .attr("text-anchor", "middle")
        .text(function (start) { return labels[start]; });

      labelStyle(g.append("text").attr("x", iw + 6).attr("y", -6), 8)
        .text((d.unit || "units") + (merge > 1 ? " / " + merge + " buckets" : ""));

      var keyW = Math.min(150, iw * 0.42), keyH = 6;
      var key = svg.append("g").attr("transform", "translate(" + m.l + "," + (m.t + ih + 44) + ")");
      var gid = "rv-flow-heat-" + (++heatSeq);
      var grad = key.append("defs").append("linearGradient").attr("id", gid);
      for (var s = 0; s <= 10; s++) {
        grad.append("stop").attr("offset", s * 10 + "%").attr("stop-color", rampColor(s / 10));
      }
      key.append("rect").attr("width", keyW).attr("height", keyH).attr("rx", 1)
        .attr("fill", "url(#" + gid + ")");
      labelStyle(key.append("text").attr("y", keyH + 10), 8).text("0");
      labelStyle(key.append("text").attr("x", keyW).attr("y", keyH + 10)
        .attr("text-anchor", "end"), 8).text(RV.fmt(maxV, 1));
      labelStyle(key.append("text").attr("x", keyW + 8).attr("y", keyH + 3), 8)
        .text("printed volume");
    });
  });

  // --------------------------------------------------------------- top ITM
  RV.register("flow_top_itm", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 420;
      var rows = d.rows || [];
      if (!rows.length) { blank(host, "No ITM strikes."); return; }

      var rowH = wide ? 34 : 30;
      var height = rows.length * rowH + 34;
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Top in-the-money put strikes");
      var m = { t: 8, r: wide ? 84 : 52, b: 22, l: wide ? 58 : 50 };
      var iw = Math.max(10, width - m.l - m.r);
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
      var maxV = d3.max(rows, function (row) { return row.pe_itm; }) || 1;
      var x = d3.scaleLinear().domain([0, maxV]).range([0, iw]);

      rows.forEach(function (row, i) {
        var y = i * rowH;
        labelStyle(g.append("text").attr("x", -8).attr("y", y + rowH / 2).attr("dy", "0.34em")
          .attr("text-anchor", "end"), 9)
          .text(RV.fmt(row.strike, pointDecimals(spec)));
        g.append("rect").attr("x", 0).attr("y", y + 5).attr("height", rowH - 10)
          .attr("width", Math.max(1, x(row.pe_itm))).attr("rx", 2)
          .attr("fill", C.red).attr("opacity", 0.62);
        labelStyle(g.append("text").attr("x", x(row.pe_itm) + 6).attr("y", y + rowH / 2)
          .attr("dy", "0.34em"), 9, C.text)
          .text(RV.fmt(row.pe_itm, 1));
        if (wide && !missing(row.share)) {
          labelStyle(g.append("text").attr("x", iw).attr("y", y + rowH / 2)
            .attr("dy", "0.34em").attr("text-anchor", "end"), 8)
            .text(RV.fmt(row.share, 1) + "%");
        }
        g.append("rect").attr("x", -m.l).attr("y", y).attr("width", iw + m.l + m.r)
          .attr("height", rowH).attr("fill", "transparent").attr("cursor", "crosshair")
          .on("mousemove", function (event) {
            var detail = [["ITM volume", RV.fmt(row.pe_itm, 1) + " " + (d.unit || "")]];
            if (!missing(row.pe)) detail.push(["total volume", RV.fmt(row.pe, 1)]);
            if (!missing(row.share)) detail.push([d.share_label || "share", RV.fmt(row.share, 1) + "%"]);
            if (!missing(row.itm_share)) detail.push(["printed ITM", RV.fmt(row.itm_share, 1) + "%"]);
            tip.show(event, RV.money(spec, row.strike) + " PE", detail);
          })
          .on("mouseleave", function () { tip.hide(); });
      });

      labelStyle(g.append("text").attr("y", rows.length * rowH + 14), 8)
        .text((d.unit || "units") + " · " + (d.share_label || "share"));
    });
  });
})();
