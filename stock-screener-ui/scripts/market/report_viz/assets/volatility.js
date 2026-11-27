/* Volatility renderers: IV smile and level distance from spot.
 *
 * A strike with no quote keeps a null in the payload; the smile line breaks
 * there (`d3.line().defined`) instead of sagging to zero.
 */
(function () {
  "use strict";

  var C = RV.colors;

  function widthOf(host) { return Math.max(320, host.clientWidth || 900); }

  function blank(host, msg) {
    host.innerHTML = '<div class="rv-empty">' + msg + "</div>";
  }

  function missing(value) {
    return value === null || value === undefined || (typeof value === "number" && !isFinite(value));
  }

  function strikeDecimals(spec) {
    return spec && Math.round(spec.strike_step) === Number(spec.strike_step) ? 0 : Number(spec.price_decimals || 2);
  }

  function labelStyle(sel, size, color) {
    return sel.attr("fill", color || C.muted).style("font", (size || 9) + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
  }

  function tickStep(span, base) {
    var step = Number(base) > 0 ? Number(base) : 1;
    while (span / step > 6) step *= 2;
    return step;
  }

  // ----------------------------------------------------------------- smile
  RV.register("iv_smile", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 520;
      var height = wide ? 300 : 240;
      var points = (d.strikes || []).map(function (strike, i) {
        return { strike: strike, ce: (d.ce_iv || [])[i], pe: (d.pe_iv || [])[i] };
      });
      var ivs = points.flatMap(function (p) { return [p.ce, p.pe]; })
        .filter(function (v) { return !missing(v); });
      if (points.length < 2 || !ivs.length) { blank(host, "No quoted IV strikes."); return; }

      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Implied volatility smile with spot marked");
      var m = { t: 28, r: 16, b: 38, l: wide ? 42 : 36 };
      var iw = Math.max(10, width - m.l - m.r), ih = height - m.t - m.b;
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var step = tickStep(d3.max(points, function (p) { return p.strike; }) - d3.min(points, function (p) { return p.strike; }), d.strike_step || 1);
      var x = d3.scaleLinear()
        .domain([d3.min(points, function (p) { return p.strike; }) - step / 2,
          d3.max(points, function (p) { return p.strike; }) + step / 2])
        .range([0, iw]);
      var yLo = Math.max(0, Math.floor(d3.min(ivs) / 5) * 5);
      var yHi = Math.ceil(d3.max(ivs) / 5) * 5;
      if (yHi <= yLo) yHi = yLo + 5;
      var y = d3.scaleLinear().domain([yLo, yHi]).range([ih, 0]);

      var yTicks = d3.range(yLo, yHi + 0.001, Math.max(5, Math.ceil((yHi - yLo) / 4 / 5) * 5));
      yTicks.forEach(function (v) {
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v))
          .attr("stroke", C.border).attr("stroke-opacity", 0.55);
        labelStyle(g.append("text").attr("x", -6).attr("y", y(v)).attr("dy", "0.32em")
          .attr("text-anchor", "end"), 9).text(v + "%");
      });

      labelStyle(g.append("text").attr("x", 0).attr("y", -14), 8).text("IV");

      var xTicks = d3.range(Math.ceil(x.domain()[0] / step) * step, x.domain()[1] + 1, step);
      xTicks.forEach(function (v) {
        labelStyle(g.append("text").attr("x", x(v)).attr("y", ih + 16)
          .attr("text-anchor", "middle"), 9).text(RV.fmt(v, strikeDecimals(spec)));
      });

      var ceLine = d3.line()
        .defined(function (p) { return !missing(p.ce); })
        .x(function (p) { return x(p.strike); })
        .y(function (p) { return y(p.ce); });
      var peLine = d3.line()
        .defined(function (p) { return !missing(p.pe); })
        .x(function (p) { return x(p.strike); })
        .y(function (p) { return y(p.pe); });

      g.append("path").datum(points).attr("fill", "none")
        .attr("stroke", C.green).attr("stroke-width", 2).attr("d", ceLine);
      g.append("path").datum(points).attr("fill", "none")
        .attr("stroke", C.red).attr("stroke-width", 2).attr("d", peLine);

      points.filter(function (p) { return !missing(p.ce); }).forEach(function (p) {
        g.append("circle").attr("cx", x(p.strike)).attr("cy", y(p.ce)).attr("r", 2.6)
          .attr("fill", C.green).attr("stroke", C.bg).attr("stroke-width", 1);
      });
      points.filter(function (p) { return !missing(p.pe); }).forEach(function (p) {
        g.append("circle").attr("cx", x(p.strike)).attr("cy", y(p.pe)).attr("r", 2.6)
          .attr("fill", C.red).attr("stroke", C.bg).attr("stroke-width", 1);
      });

      if (!missing(d.atm)) {
        g.append("rect").attr("x", x(d.atm) - 4).attr("width", 8)
          .attr("y", 0).attr("height", ih)
          .attr("fill", C.amber).attr("opacity", 0.08).attr("pointer-events", "none");
        g.append("line").attr("x1", x(d.atm)).attr("x2", x(d.atm))
          .attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.amber).attr("stroke-width", 1.2).attr("stroke-dasharray", "4 3")
          .attr("pointer-events", "none");
        labelStyle(g.append("text").attr("x", x(d.atm)).attr("y", -14)
          .attr("text-anchor", "middle"), 8, C.amber)
          .text("ATM " + RV.fmt(d.atm, strikeDecimals(spec)));
      }

      if (!missing(d.spot)) {
        g.append("line").attr("x1", x(d.spot)).attr("x2", x(d.spot))
          .attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.blue).attr("stroke-width", 1.2).attr("stroke-dasharray", "2 3")
          .attr("pointer-events", "none");
        labelStyle(g.append("text").attr("x", x(d.spot)).attr("y", ih + 30)
          .attr("text-anchor", "middle"), 8, C.blue)
          .text((d.spot_label || "spot") + " " + RV.money(spec, d.spot));
      }

      var bisect = d3.bisector(function (p) { return p.strike; }).center;
      var focus = g.append("line").attr("stroke", C.text).attr("stroke-opacity", 0.5)
        .attr("stroke-dasharray", "2 3").attr("y1", 0).attr("y2", ih).style("display", "none");
      var focusCe = g.append("circle").attr("r", 4).attr("fill", C.green).attr("stroke", C.bg);
      var focusPe = g.append("circle").attr("r", 4).attr("fill", C.red).attr("stroke", C.bg);

      g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent")
        .attr("cursor", "crosshair")
        .on("mousemove", function (event) {
          var px = d3.pointer(event, this)[0];
          var p = points[bisect(points, x.invert(px))];
          if (!p) return;
          focus.style("display", null).attr("x1", x(p.strike)).attr("x2", x(p.strike));
          if (missing(p.ce)) {
            focusCe.style("display", "none");
          } else {
            focusCe.style("display", null).attr("cx", x(p.strike)).attr("cy", y(p.ce));
          }
          if (missing(p.pe)) {
            focusPe.style("display", "none");
          } else {
            focusPe.style("display", null).attr("cx", x(p.strike)).attr("cy", y(p.pe));
          }
          tip.show(event, RV.fmt(p.strike, strikeDecimals(spec)) + " · " +
            RV.signed(p.strike - d.spot, 1) + " pts from spot", [
            ["CE IV", missing(p.ce) ? "— (no quote)" : RV.fmt(p.ce, 2) + "%"],
            ["PE IV", missing(p.pe) ? "— (no quote)" : RV.fmt(p.pe, 2) + "%"],
            ["ATM", RV.fmt(d.atm, strikeDecimals(spec))]
          ]);
        })
        .on("mouseleave", function () {
          focus.style("display", "none");
          focusCe.style("display", "none");
          focusPe.style("display", "none");
          tip.hide();
        });
    });
  });

  // ------------------------------------------------------------- distances
  RV.register("levels_distance", function (host, payload) {
    var d = payload.data || {}, spec = payload.spec || {};
    var tip = RV.tip();

    RV.onResize(host, function () {
      var width = widthOf(host), wide = width >= 620;
      var levels = d.levels || [];
      if (!levels.length) { blank(host, "No levels."); return; }

      var rowH = 34;
      var height = Math.max(wide ? 240 : 220, levels.length * rowH + 56);
      var svg = RV.svg(host, height).attr("role", "img");
      svg.attr("aria-label", "Wall and max pain distance from spot");
      var m = { t: 22, r: wide ? 92 : 64, b: 38, l: wide ? 96 : 74 };
      var iw = Math.max(10, width - m.l - m.r), ih = levels.length * rowH;
      var g = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var values = levels.map(function (row) { return Number(row.distance); }).filter(isFinite).concat([0]);
      var lo = d3.min(values), hi = d3.max(values);
      var pad = Math.max(4, (hi - lo) * 0.12);
      var x = d3.scaleLinear().domain([lo - pad, hi + pad]).range([0, iw]);
      var y = d3.scaleBand().domain(levels.map(function (_, i) { return String(i); }))
        .range([0, ih]).paddingInner(0.3);

      function colorOf(kind) {
        if (kind === "call") return C.red;
        if (kind === "put") return C.green;
        if (kind === "maxpain") return C.amber;
        return C.muted;
      }

      x.ticks(5).forEach(function (v) {
        g.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.border).attr("stroke-opacity", 0.45);
        labelStyle(g.append("text").attr("x", x(v)).attr("y", ih + 15)
          .attr("text-anchor", "middle"), 8).text(RV.signed(v, 0));
      });

      var zero = x(0);
      g.append("line").attr("x1", zero).attr("x2", zero).attr("y1", 0).attr("y2", ih)
        .attr("stroke", C.blue).attr("stroke-width", 1.3).attr("stroke-dasharray", "3 3");
      labelStyle(g.append("text").attr("x", zero).attr("y", -8)
        .attr("text-anchor", "middle"), 8, C.blue).text("spot");

      levels.forEach(function (row, i) {
        var yy = y(String(i)), mid = yy + y.bandwidth() / 2;
        var col = colorOf(row.kind);
        var start = Math.min(x(row.distance), zero);
        var barW = Math.max(1, Math.abs(x(row.distance) - zero));
        g.append("rect").attr("x", start).attr("y", mid - y.bandwidth() * 0.32)
          .attr("width", barW).attr("height", Math.max(4, y.bandwidth() * 0.64))
          .attr("rx", 2).attr("fill", col).attr("opacity", 0.7).attr("pointer-events", "none");

        labelStyle(g.append("text").attr("x", -10).attr("y", mid - 2)
          .attr("text-anchor", "end"), 9, C.text).text(row.label);
        labelStyle(g.append("text").attr("x", -10).attr("y", mid + 11)
          .attr("text-anchor", "end"), 8)
          .text(RV.money(spec, row.strike));

        var end = x(row.distance);
        var anchor = row.distance >= 0 ? "start" : "end";
        if (row.distance >= 0 && end > iw * 0.72) anchor = "end";
        if (row.distance < 0 && end < iw * 0.28) anchor = "start";
        labelStyle(g.append("text").attr("x", end + (anchor === "start" ? 6 : -6))
          .attr("y", mid + 3).attr("text-anchor", anchor), 9, col)
          .text(RV.signed(row.distance, 1) + " " + (d.unit || "pts"));

        g.append("rect").attr("x", 0).attr("y", yy).attr("width", iw)
          .attr("height", y.bandwidth()).attr("fill", "transparent").attr("cursor", "crosshair")
          .on("mousemove", function (event) {
            var detail = [
              ["distance", RV.signed(row.distance, 1) + " " + (d.unit || "pts")],
              ["strike", RV.money(spec, row.strike)],
              ["spot", RV.money(spec, d.spot)]
            ];
            if (!missing(row.oi)) detail.push(["OI", RV.oi(row.oi)]);
            tip.show(event, row.label + " · " + row.kind, detail);
          })
          .on("mouseleave", function () { tip.hide(); });
      });
    });
  });
})();
