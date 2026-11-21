/* Gamma / GEX renderers for the reusable report charts.
 *
 * Four panels, one rule: a null value is a gap.  `gamma_flip_gex` draws the
 * chain-wide net GEX and the ≤spot cumulative GEX as two separately labelled
 * lines, and a flip that does not exist is text ("no cross"), never zero.
 */
(function () {
  "use strict";

  var C = RV.colors;
  var MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  function isFiniteNumber(value) {
    return value !== null && value !== undefined && !Number.isNaN(Number(value));
  }

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function panelHeight(host, fallback) {
    return Math.max(240, (host.clientHeight || fallback) - 10);
  }

  function sampleIndices(count, maxTicks) {
    if (count <= 0) return [];
    var step = Math.max(1, Math.ceil(count / Math.max(2, maxTicks)));
    var out = [];
    for (var i = 0; i < count; i += step) out.push(i);
    var last = count - 1;
    var previous = out.length ? out[out.length - 1] : -1;
    // Keep the final clock only when its label cannot collide with the
    // previous tick; otherwise the axis prints two times on top of each other.
    if (previous !== last && last - previous >= Math.max(1, Math.floor(step / 2))) {
      out.push(last);
    }
    return out;
  }

  function priceFmt(spec, value, narrow) {
    return RV.money(spec, value, narrow ? 0 : spec.price_decimals);
  }

  // 9px monospace is roughly 0.6em per glyph; keep tick labels inside the SVG.
  function labelWidth(text) {
    return String(text).length * 5.4 + 9;
  }

  function drawYAxis(group, scale, width, ticks, format) {
    var axis = d3.axisLeft(scale).tickValues(ticks).tickSize(-width).tickFormat(format);
    var g = group.append("g").attr("class", "rv-gex-axis").call(axis);
    g.selectAll("text")
      .attr("fill", C.muted)
      .attr("font", "9px " + MONO);
    g.selectAll("line")
      .attr("stroke", C.border)
      .attr("stroke-opacity", 0.45);
    g.select(".domain").attr("stroke", C.border);
    return g;
  }

  function drawTimeAxis(group, width, height, labels, maxTicks) {
    var indices = sampleIndices(labels.length, maxTicks);
    var step = indices.length > 1 ? width / Math.max(1, labels.length - 1) : 0;
    indices.forEach(function (index) {
      group.append("text")
        .attr("x", index * step)
        .attr("y", height + 12)
        .attr("text-anchor", index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle")
        .attr("fill", C.muted)
        .attr("font", "9px " + MONO)
        .text(labels[index]);
    });
  }

  function gexScale(payload, range) {
    var domain = payload.data.domain.gex;
    var scale = payload.data.domain.gex_scale === "symlog"
      ? d3.scaleSymlog()
      : d3.scaleLinear();
    return scale.domain(domain).range(range);
  }

  function tipFor(host) {
    if (!host.__rvGexTip) host.__rvGexTip = RV.tip();
    return host.__rvGexTip;
  }

  function bindHover(host, svg, width, height, margin, handler) {
    var tip = tipFor(host);
    var capture = svg.append("rect")
      .attr("x", margin.l)
      .attr("y", margin.t)
      .attr("width", Math.max(0, width - margin.l - margin.r))
      .attr("height", Math.max(0, height - margin.t - margin.b))
      .attr("fill", "transparent")
      .style("cursor", "crosshair");
    capture.on("mousemove", function (event) {
      var box = this.getBoundingClientRect();
      handler(event.clientX - box.left, event);
    });
    capture.on("mouseleave", function () { tip.hide(); });
    return capture;
  }

  // ------------------------------------------------------------ gamma flip
  RV.register("gamma_flip_gex", function (host, payload) {
    var spec = payload.spec;
    var D = payload.data;

    RV.onResize(host, function (width) {
      var W = Math.max(320, width || host.clientWidth);
      var H = panelHeight(host, 360);
      var narrow = W < 520;
      var priceSample = RV.money(spec, D.domain.price[1], narrow ? 0 : spec.price_decimals);
      var gexSample = RV.signed(D.domain.gex[1], 1);
      var margin = {
        t: 8,
        r: narrow ? 6 : 12,
        b: 18,
        l: Math.max(narrow ? 36 : 46, labelWidth(priceSample), labelWidth(gexSample))
      };
      var iw = W - margin.l - margin.r;
      var ih = H - margin.t - margin.b;
      var topH = Math.round(ih * 0.58);
      var gap = 16;
      var botH = Math.max(40, ih - topH - gap);

      var svg = RV.svg(host, H);
      var root = svg.append("g").attr("transform", "translate(" + margin.l + "," + margin.t + ")");
      var priceGroup = root.append("g");
      var gexGroup = root.append("g").attr("transform", "translate(0," + (topH + gap) + ")");

      var n = D.t.length;
      var x = d3.scaleLinear().domain([0, Math.max(1, n - 1)]).range([0, iw]);
      var y = d3.scaleLinear().domain(D.domain.price).range([topH, 0]).nice();
      var yn = gexScale(payload, [botH, 0]);

      drawYAxis(priceGroup, y, iw, y.ticks(narrow ? 3 : 5), function (v) {
        return priceFmt(spec, v, narrow);
      });
      // Keep the upper time labels inside the price panel so the lower panel's
      // definition summary has the whole inter-panel gap to itself.
      drawTimeAxis(priceGroup, iw, topH - 12, D.t, narrow ? 3 : 7);

      // Signed ribbon between spot and flip, drawn as contiguous runs so the
      // colour belongs to the run rather than to a gradient.
      (function ribbon() {
        var i = 0;
        while (i < n) {
          if (!isFiniteNumber(D.flip[i]) || !isFiniteNumber(D.spot[i])) { i += 1; continue; }
          var sign = Math.sign(D.spot[i] - D.flip[i]);
          if (!sign) { i += 1; continue; }
          var j = i;
          while (
            j + 1 < n &&
            isFiniteNumber(D.flip[j + 1]) &&
            isFiniteNumber(D.spot[j + 1]) &&
            Math.sign(D.spot[j + 1] - D.flip[j + 1]) === sign
          ) j += 1;
          if (j > i) {
            var top = [];
            var bottom = [];
            for (var k = i; k <= j; k += 1) {
              var px = x(k);
              var spotY = y(D.spot[k]);
              var flipY = y(D.flip[k]);
              top.push(px + "," + (sign > 0 ? spotY : flipY));
              bottom.push(px + "," + (sign > 0 ? flipY : spotY));
            }
            priceGroup.append("path")
              .attr("d", "M" + top.join("L") + "L" + bottom.reverse().join("L") + "Z")
              .attr("fill", sign > 0 ? C.green : C.red)
              .attr("fill-opacity", 0.18)
              .attr("stroke", "none");
          }
          i = j + 1;
        }
      })();

      function priceLine(values, color, width, dash) {
        var line = d3.line()
          .defined(function (_, index) { return isFiniteNumber(values[index]); })
          .x(function (_, index) { return x(index); })
          .y(function (value) { return y(value); });
        priceGroup.append("path")
          .attr("d", line(values))
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", width)
          .attr("stroke-dasharray", dash || null);
      }

      priceLine(D.spot, C.text, 1.4);
      priceLine(D.flip, C.violet, 1.9);

      var flipAllNull = D.flip_null.length === n || D.flip.every(function (v) { return !isFiniteNumber(v); });
      if (flipAllNull) {
        priceGroup.append("text")
          .attr("x", iw)
          .attr("y", 9)
          .attr("text-anchor", "end")
          .attr("fill", C.violet)
          .attr("font", "9px " + MONO)
          .text("flip: " + D.flip_null_note);
      }

      drawYAxis(gexGroup, yn, iw, yn.ticks(narrow ? 3 : 4), function (v) {
        return RV.fmt(v, 1);
      });
      drawTimeAxis(gexGroup, iw, botH, D.t, narrow ? 3 : 7);

      gexGroup.append("line")
        .attr("x1", 0).attr("x2", iw)
        .attr("y1", yn(0)).attr("y2", yn(0))
        .attr("stroke", C.muted).attr("stroke-opacity", 0.45);

      var area = d3.area()
        .defined(function (_, index) { return isFiniteNumber(D.net_gex[index]); })
        .x(function (_, index) { return x(index); })
        .y0(yn(0))
        .y1(function (value) { return yn(value); });
      gexGroup.append("path")
        .attr("d", area(D.net_gex))
        .attr("fill", C.blue).attr("fill-opacity", 0.14).attr("stroke", "none");

      function gexLine(values, color) {
        var line = d3.line()
          .defined(function (_, index) { return isFiniteNumber(values[index]); })
          .x(function (_, index) { return x(index); })
          .y(function (value) { return yn(value); });
        gexGroup.append("path")
          .attr("d", line(values))
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1.5);
      }

      gexLine(D.net_gex, C.blue);
      gexLine(D.regime_gex, C.amber);

      var last = n - 1;
      var summary = narrow
        ? "net " + RV.signed(D.net_gex[last], 1) +
          " · cum " + RV.signed(D.regime_gex[last], 1)
        : "net GEX (all strikes) " + RV.signed(D.net_gex[last], 1) +
          " · cum GEX (≤spot) " + RV.signed(D.regime_gex[last], 1) +
          " " + D.unit;
      gexGroup.append("text")
        .attr("x", 0).attr("y", -5)
        .attr("fill", C.muted).attr("font", "9px " + MONO)
        .text(summary);

      bindHover(host, svg, W, H, margin, function (px, event) {
        var index = clamp(Math.round(x.invert(px)), 0, n - 1);
        var flip = isFiniteNumber(D.flip[index]) ? RV.money(spec, D.flip[index]) : D.flip_null_note;
        tipFor(host).show(event, D.t[index], [
          ["spot", RV.money(spec, D.spot[index])],
          ["gamma flip", flip],
          ["net GEX, all strikes", RV.signed(D.net_gex[index], 1) + " " + D.unit],
          ["cumulative GEX, ≤ spot", RV.signed(D.regime_gex[index], 1) + " " + D.unit]
        ]);
      });
    });
  });

  // -------------------------------------------------------------- profiles
  RV.register("gex_profiles", function (host, payload) {
    var spec = payload.spec;
    var D = payload.data;

    RV.onResize(host, function (width) {
      var W = Math.max(320, width || host.clientWidth);
      var narrow = W < 720;
      var cols = narrow ? 1 : D.profiles.length;
      var H = panelHeight(host, 420);
      var rows = narrow ? D.profiles.length : 1;
      var cellH = narrow
        ? Math.max(110, Math.floor(H / rows) - 4)
        : Math.min(H, 340);
      var chartH = Math.max(90, cellH - 16);

      host.innerHTML = "";
      var grid = document.createElement("div");
      grid.style.cssText =
        "display:grid;grid-template-columns:repeat(" + cols + ",minmax(0,1fr));gap:8px;height:100%";
      host.appendChild(grid);

      var all = [];
      D.profiles.forEach(function (profile) {
        all = all.concat(profile.net_gex);
      });
      var maxAbs = d3.max(all.map(Math.abs)) || 1;

      D.profiles.forEach(function (profile) {
        var cell = document.createElement("div");
        cell.style.cssText = "min-width:0;height:" + cellH + "px";
        grid.appendChild(cell);

        var head = document.createElement("div");
        head.style.cssText =
          "color:" + C.text + ";font:600 10px " + MONO + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        head.textContent = profile.label +
          (profile.net_total === null ? "" : " · net " + RV.signed(profile.net_total, 1));
        cell.appendChild(head);

        var box = document.createElement("div");
        box.style.cssText = "height:" + chartH + "px;min-width:0";
        cell.appendChild(box);

        var strikes = profile.strikes;
        var strikeSample = RV.fmt(Math.max(strikes[0], strikes[strikes.length - 1]), 0);
        var margin = { t: 4, r: 6, b: 14, l: Math.max(narrow ? 34 : 38, labelWidth(strikeSample)) };
        var iw = Math.max(40, W / cols - margin.l - margin.r);
        var ih = Math.max(40, chartH - margin.t - margin.b);
        var svg = d3.select(box).append("svg")
          .attr("viewBox", "0 0 " + (iw + margin.l + margin.r) + " " + chartH)
          .attr("preserveAspectRatio", "xMidYMid meet");
        var root = svg.append("g").attr("transform", "translate(" + margin.l + "," + margin.t + ")");

        var x = gexScale(payload, [0, iw]);
        var order = profile.strikes.slice().reverse();
        var y = d3.scaleBand().domain(order).range([0, ih]).padding(0.22);
        var step = strikes.length > 1 ? (strikes[strikes.length - 1] - strikes[0]) / (strikes.length - 1) : 1;

        function yAt(price) {
          if (!isFiniteNumber(price) || !step) return null;
          var position = (price - strikes[0]) / step;
          position = clamp(position, 0, strikes.length - 1);
          return clamp((strikes.length - 1 - position + 0.5) * (ih / strikes.length), 0, ih);
        }

        root.append("line")
          .attr("x1", x(0)).attr("x2", x(0))
          .attr("y1", 0).attr("y2", ih)
          .attr("stroke", C.border);

        var every = Math.max(1, Math.ceil(order.length / (narrow ? 4 : 7)));
        var tip = tipFor(host);
        var bars = root.selectAll("rect")
          .data(profile.net_gex.map(function (value, index) { return { value: value, index: index }; }))
          .enter().append("rect")
          .attr("x", function (d) { return d.value >= 0 ? x(0) : x(d.value); })
          .attr("y", function (d) { return y(strikes[d.index]); })
          .attr("width", function (d) { return isFiniteNumber(d.value) ? Math.max(1, Math.abs(x(d.value) - x(0))) : 0; })
          .attr("height", y.bandwidth())
          .attr("fill", function (d) { return d.value >= 0 ? C.green : C.red; })
          .attr("fill-opacity", function (d) {
            return isFiniteNumber(d.value) ? 0.35 + 0.55 * Math.min(1, Math.abs(d.value) / maxAbs) : 0;
          });

        bars.on("mousemove", function (event, d) {
          var strike = profile.strikes[d.index];
          tip.show(event, profile.label + " · strike " + RV.fmt(strike, 0), [
            ["net GEX", RV.signed(d.value, 1) + " " + D.unit],
            ["cumulative GEX", RV.signed(profile.cum_gex[d.index], 1)],
            ["spot", RV.money(spec, profile.spot)],
            ["max pain", RV.money(spec, profile.max_pain)],
            ["gamma flip", profile.flip === null ? "no cross" : RV.money(spec, profile.flip)]
          ]);
        }).on("mouseleave", function () { tip.hide(); });

        if (isFiniteNumber(profile.spot)) {
          root.append("line")
            .attr("x1", 0).attr("x2", iw)
            .attr("y1", yAt(profile.spot)).attr("y2", yAt(profile.spot))
            .attr("stroke", C.text).attr("stroke-width", 1.1).attr("stroke-dasharray", "3 2");
        }
        if (isFiniteNumber(profile.max_pain)) {
          root.append("line")
            .attr("x1", 0).attr("x2", iw)
            .attr("y1", yAt(profile.max_pain)).attr("y2", yAt(profile.max_pain))
            .attr("stroke", C.amber).attr("stroke-width", 1.1).attr("stroke-dasharray", "1 2");
        }
        if (isFiniteNumber(profile.flip)) {
          root.append("circle")
            .attr("cx", iw - 3).attr("cy", yAt(profile.flip)).attr("r", 2.4)
            .attr("fill", C.violet);
        }

        order.forEach(function (strike, index) {
          if (index % every !== 0) return;
          root.append("text")
            .attr("x", -5)
            .attr("y", y(strike) + y.bandwidth() / 2)
            .attr("dy", "0.32em").attr("text-anchor", "end")
            .attr("fill", C.muted).attr("font", "9px " + MONO)
            .text(RV.fmt(strike, 0));
        });
      });
    });
  });

  // --------------------------------------------------------------- surface
  RV.register("gex_surface", function (host, payload) {
    var spec = payload.spec;
    var D = payload.data;
    var W = Math.max(320, host.clientWidth || 640);
    var narrow = W < 720;
    var H = panelHeight(host, narrow ? 360 : 470);

    function timePairs(maxTicks) {
      var n = D.times.length;
      var indices = sampleIndices(n, maxTicks);
      return {
        vals: indices.map(function (index) {
          return D.minutes.length ? D.minutes[index] : index;
        }),
        text: indices.map(function (index) { return D.times[index]; })
      };
    }

    var pairs = timePairs(narrow ? 4 : 6);
    var x = D.minutes.length ? D.minutes : D.times.map(function (_, index) { return index; });
    var custom = D.strikes.map(function (strike) {
      return D.times.map(function (label) {
        return label + " · strike " + RV.fmt(strike, 0);
      });
    });

    var traces = [{
      type: "surface",
      name: "net GEX",
      x: x,
      y: D.strikes,
      z: D.z,
      customdata: custom,
      connectgaps: false,
      colorscale: [
        [0, C.red],
        [0.32, C.raised],
        [0.5, C.surface],
        [0.68, C.raised],
        [1, C.green]
      ],
      cmin: D.domain.gex[0],
      cmax: D.domain.gex[1],
      cmid: D.domain.cmid,
      showscale: true,
      colorbar: {
        title: { text: D.unit, side: "top", font: { size: 9, color: C.muted, family: MONO } },
        thickness: narrow ? 7 : 9,
        len: narrow ? 0.45 : 0.58,
        outlinewidth: 0,
        tickfont: { size: 8, color: C.muted, family: MONO }
      },
      contours: { z: { show: false } },
      lighting: { ambient: 0.78, diffuse: 0.58, specular: 0.08, roughness: 0.9 },
      hoverlabel: { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, family: MONO, size: 10 } },
      hovertemplate: "%{customdata}<br>net GEX %{z:.1f} " + D.unit + "<extra></extra>"
    }];

    if (D.spot_path.length) {
      traces.push({
        type: "scatter3d",
        mode: "lines",
        name: "spot path",
        x: x,
        y: D.spot_path,
        z: D.times.map(function () { return 0; }),
        line: { color: C.text, width: 4 },
        hoverlabel: { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, family: MONO, size: 10 } },
        hovertemplate: "spot %{y:.0f}<extra></extra>"
      });
    }

    function sceneAxis(title, extra) {
      return Object.assign({
        title: { text: title, font: { size: 9, color: C.muted, family: MONO } },
        gridcolor: C.border,
        zerolinecolor: C.border,
        showbackground: true,
        backgroundcolor: "rgba(31,36,45,0.35)",
        tickfont: { size: 8, color: C.muted, family: MONO },
        showspikes: false
      }, extra || {});
    }

    var layout = RV.plotlyLayout(spec, {
      height: H,
      margin: { l: narrow ? 6 : 44, r: narrow ? 6 : 14, t: 8, b: 4 },
      hovermode: "closest",
      scene: {
        bgcolor: C.surface,
        camera: { eye: { x: 1.35, y: -1.75, z: 1.05 }, center: { x: 0, y: 0, z: -0.06 }, up: { x: 0, y: 0, z: 1 } },
        xaxis: sceneAxis("time", {
          tickmode: "array",
          tickvals: pairs.vals,
          ticktext: pairs.text
        }),
        yaxis: sceneAxis("strike", { tickformat: ".0f", nticks: narrow ? 4 : 6 }),
        zaxis: sceneAxis(D.unit, { nticks: 4, zeroline: true }),
        aspectmode: "manual",
        aspectratio: narrow ? { x: 1.45, y: 1.2, z: 0.55 } : { x: 1.9, y: 1.35, z: 0.6 },
        dragmode: "orbit"
      }
    });

    RV.plotly(host, traces, layout);
  });

  // ------------------------------------------------------------- by strike
  RV.register("gex_by_strike", function (host, payload) {
    var spec = payload.spec;
    var D = payload.data;
    var snapshots = D.snapshots || [];
    var strikes = snapshots.length ? snapshots[0].strikes : D.strikes || [];
    var hues = [C.blue, C.amber, C.violet, C.green];

    RV.onResize(host, function (width) {
      var W = Math.max(320, width || host.clientWidth);
      var H = panelHeight(host, 320);
      var narrow = W < 520;
      var gexLow = RV.signed(D.domain.gex[0], 1);
      var gexHigh = RV.signed(D.domain.gex[1], 1);
      var margin = {
        t: snapshots.length > 1 ? 18 : 10,
        r: 8,
        b: 20,
        l: Math.max(narrow ? 36 : 46, labelWidth(gexLow), labelWidth(gexHigh))
      };
      var iw = W - margin.l - margin.r;
      var ih = H - margin.t - margin.b;

      var svg = RV.svg(host, H);
      var root = svg.append("g").attr("transform", "translate(" + margin.l + "," + margin.t + ")");

      var x = d3.scaleBand().domain(strikes).range([0, iw]).padding(0.24);
      var y = gexScale(payload, [ih, 0]);

      drawYAxis(root, y, iw, y.ticks(narrow ? 3 : 5), function (value) {
        return RV.fmt(value, 1);
      });

      root.append("line")
        .attr("x1", 0).attr("x2", iw)
        .attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", C.muted).attr("stroke-opacity", 0.45);

      var band = snapshots.length > 1 ? x.bandwidth() / snapshots.length : x.bandwidth();
      var maxAbs = d3.max(snapshots.map(function (snapshot) {
        return d3.max(snapshot.net_gex.map(Math.abs)) || 0;
      })) || 1;

      snapshots.forEach(function (snapshot, seriesIndex) {
        snapshot.net_gex.forEach(function (value, index) {
          if (!isFiniteNumber(value)) return;
          var color = snapshots.length > 1 ? hues[seriesIndex % hues.length] : value >= 0 ? C.green : C.red;
          var barWidth = snapshots.length > 1
            ? Math.max(1, band - 0.5)
            : Math.max(1, x.bandwidth() * 0.72);
          var center = x(strikes[index]) + x.bandwidth() / 2 +
            (snapshots.length > 1 ? (seriesIndex - (snapshots.length - 1) / 2) * band : 0);
          var zeroY = y(0);
          var valueY = y(value);
          var tip = tipFor(host);
          var rect = root.append("rect")
            .attr("x", center - barWidth / 2)
            .attr("y", Math.min(zeroY, valueY))
            .attr("width", barWidth)
            .attr("height", Math.max(1, Math.abs(valueY - zeroY)))
            .attr("fill", color)
            .attr("fill-opacity", snapshots.length > 1 ? 0.82 : 0.35 + 0.55 * Math.min(1, Math.abs(value) / maxAbs));

          rect.on("mousemove", function (event) {
            tip.show(event, RV.fmt(strikes[index], 0) + " · " + snapshot.label, [
              ["net GEX", RV.signed(value, 1) + " " + D.unit],
              ["spot", RV.money(spec, snapshot.spot)],
              ["max pain", RV.money(spec, snapshot.max_pain)],
              ["gamma flip", snapshot.flip === null ? "no cross" : RV.money(spec, snapshot.flip)]
            ]);
          }).on("mouseleave", function () { tip.hide(); });
        });
      });

      function xAt(price) {
        if (!isFiniteNumber(price) || strikes.length < 2) return null;
        var index = (price - strikes[0]) / (strikes[strikes.length - 1] - strikes[0]) * (strikes.length - 1);
        index = clamp(index, 0, strikes.length - 1);
        return clamp(x(strikes[0]) + x.bandwidth() / 2 + index * x.step(), 0, iw);
      }

      var only = snapshots.length === 1 ? snapshots[0] : null;
      if (only) {
        var spotX = xAt(only.spot);
        if (spotX !== null) {
          root.append("line")
            .attr("x1", spotX).attr("x2", spotX)
            .attr("y1", 0).attr("y2", ih)
            .attr("stroke", C.text).attr("stroke-width", 1.1).attr("stroke-dasharray", "3 2");
        }
        var painX = xAt(only.max_pain);
        if (painX !== null) {
          root.append("line")
            .attr("x1", painX).attr("x2", painX)
            .attr("y1", 0).attr("y2", ih)
            .attr("stroke", C.amber).attr("stroke-width", 1.1).attr("stroke-dasharray", "1 2");
        }
        var flipX = xAt(only.flip);
        if (flipX !== null) {
          root.append("circle")
            .attr("cx", flipX).attr("cy", 4).attr("r", 2.4)
            .attr("fill", C.violet);
        }
      }

      var every = Math.max(1, Math.ceil(strikes.length / (narrow ? 4 : 7)));
      strikes.forEach(function (strike, index) {
        if (index % every !== 0) return;
        root.append("text")
          .attr("x", x(strike) + x.bandwidth() / 2)
          .attr("y", ih + 13)
          .attr("text-anchor", "middle")
          .attr("fill", C.muted).attr("font", "9px " + MONO)
          .text(RV.fmt(strike, 0));
      });

      if (snapshots.length > 1) {
        var slot = Math.max(56, iw / snapshots.length);
        snapshots.forEach(function (snapshot, index) {
          root.append("rect")
            .attr("x", index * slot).attr("y", -13)
            .attr("width", 6).attr("height", 6)
            .attr("rx", 1).attr("fill", hues[index % hues.length]);
          root.append("text")
            .attr("x", index * slot + 9).attr("y", -7)
            .attr("fill", C.muted).attr("font", "9px " + MONO)
            .text(String(snapshot.label).slice(0, 11));
        });
      }
    });
  });
})();
