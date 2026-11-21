/* Vol-decay / futures-cross / anatomy chart family.
 *
 * Eleven renderers share three rules from core.js:
 *   - D3 draws every 2D chart; only the time × basis × OI path uses Plotly.
 *   - a `null` value is a gap: `.defined()` breaks lines, bars are omitted.
 *   - units come from `payload.spec`; a strike is never assumed to sit on a
 *     fixed ladder and a currency sign is never written in this file.
 */
(function () {
  "use strict";

  var MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  var C = RV.colors;
  var SERIES = [C.amber, C.blue, C.green, C.violet, C.red, C.muted];
  var TONES = {
    green: C.green,
    red: C.red,
    amber: C.amber,
    blue: C.blue,
    violet: C.violet,
    muted: C.muted,
    text: C.text
  };

  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function clockOf(minutes) {
    var value = Math.round(Number(minutes));
    if (!Number.isFinite(value)) return "—";
    var hour = Math.floor(value / 60);
    var minute = ((value % 60) + 60) % 60;
    return (hour < 10 ? "0" : "") + hour + ":" + (minute < 10 ? "0" : "") + minute;
  }

  function minuteOf(label) {
    var match = /(\d{1,2}):(\d{2})/.exec(String(label == null ? "" : label));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function tone(name) {
    return TONES[name] || C.muted;
  }

  function seriesColor(index) {
    return SERIES[index % SERIES.length];
  }

  function empty(host, message) {
    host.innerHTML = '<div class="rv-empty" style="color:var(--rv-muted)">' + message + "</div>";
  }

  function openFrame(host) {
    var width = Math.max(300, host.clientWidth || 640);
    var height = Math.max(170, (host.clientHeight || 300) - 10);
    var svg = RV.svg(host, height)
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img");
    return { svg: svg, width: width, height: height };
  }

  function cellFrame(cell, width, height) {
    d3.select(cell).selectAll("*").remove();
    return d3.select(cell).append("svg")
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img");
  }

  function margins(width, top, bottom) {
    return {
      t: top,
      r: width < 520 ? 12 : 18,
      b: bottom,
      l: width < 520 ? 38 : 48,
      narrow: width < 520
    };
  }

  function styleAxis(group, narrow) {
    group.selectAll("text")
      .attr("fill", C.muted)
      .attr("font-size", narrow ? 8.5 : 9.5)
      .attr("font-family", MONO);
    group.selectAll("line").attr("stroke", C.border);
    group.select(".domain").attr("stroke", C.border);
  }

  function grid(svg, scale, frame, m, ticks) {
    svg.append("g")
      .selectAll("line")
      .data(scale.ticks(ticks))
      .join("line")
      .attr("x1", m.l)
      .attr("x2", frame.width - m.r)
      .attr("y1", scale)
      .attr("y2", scale)
      .attr("stroke", C.border)
      .attr("stroke-opacity", 0.4);
  }

  function timeAxis(svg, scale, ticks, frame, m) {
    var values = ticks.filter(function (value, index) {
      return ticks.indexOf(value) === index;
    });
    var group = svg.append("g")
      .attr("transform", "translate(0," + (frame.height - m.b) + ")")
      .call(d3.axisBottom(scale).tickValues(values).tickFormat(clockOf).tickSizeOuter(0));
    styleAxis(group, m.narrow);
  }

  function yAxis(svg, scale, frame, m, format, ticks) {
    var group = svg.append("g")
      .attr("transform", "translate(" + m.l + ",0)")
      .call(d3.axisLeft(scale).ticks(ticks).tickFormat(format).tickSizeOuter(0));
    styleAxis(group, m.narrow);
  }

  function timeTicks(rows, maxTicks) {
    if (!rows.length) return [];
    var labels = rows.map(function (row) { return clockOf(row.m); });
    return RV.timeTicks(labels, maxTicks).map(minuteOf).filter(function (value) {
      return value !== null;
    });
  }

  function corner(frame, m, text, color, anchor) {
    frame.svg.append("text")
      .attr("x", anchor === "right" ? frame.width - m.r : m.l)
      .attr("y", 10)
      .attr("text-anchor", anchor || "start")
      .attr("fill", color)
      .attr("font-size", 9)
      .attr("font-family", MONO)
      .text(text);
  }

  function overlay(svg, frame, m, move, leave) {
    return svg.append("rect")
      .attr("x", m.l)
      .attr("y", m.t)
      .attr("width", Math.max(1, frame.width - m.l - m.r))
      .attr("height", Math.max(1, frame.height - m.t - m.b))
      .attr("fill", "transparent")
      .style("cursor", "crosshair")
      .on("mousemove", function (event) {
        move(d3.pointer(event, svg.node())[0], event);
      })
      .on("mouseleave", leave);
  }

  function pointText(value, spec) {
    if (value === null || value === undefined) return "—";
    return RV.signed(value, spec.price_digits === undefined ? 2 : spec.price_digits) + " pts";
  }

  function band(label) {
    return '<span style="color:' + C.text + '">' + escapeHtml(label) + "</span>";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ------------------------------------------------------------------ */
  /* 1. PE premium ribbon                                               */
  /* ------------------------------------------------------------------ */
  function premiumRibbon(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var minutes = data.minutes || [];
    var series = data.series || [];
    var spot = data.spot || [];
    if (!minutes.length || !series.length) return empty(host, "No premium cells in the payload.");
    var finite = [];
    series.forEach(function (item) {
      (item.premium || []).forEach(function (value) {
        if (num(value) !== null) finite.push(num(value));
      });
    });
    if (!finite.length) return empty(host, "Every strike/time premium cell is blank.");

    var frame = openFrame(host);
    frame.svg.attr("aria-label", "Put premium for " + series.length + " strikes over " + minutes.length + " minutes");
    var m = margins(frame.width, 18, 24);
    var x = d3.scaleLinear().domain([minutes[0], minutes[minutes.length - 1] || minutes[0] + 1]).range([m.l, frame.width - m.r]);
    var low = Math.min.apply(null, finite), high = Math.max.apply(null, finite);
    var pad = Math.max(1, (high - low) * 0.08);
    var y = d3.scaleLinear().domain([Math.max(0, low - pad), high + pad]).range([frame.height - m.b, m.t]);

    grid(frame.svg, y, frame, m, m.narrow ? 4 : 5);
    yAxis(frame.svg, y, frame, m, function (value) { return RV.fmt(value, 0); }, m.narrow ? 4 : 5);
    timeAxis(frame.svg, x, timeTicks(minutes.map(function (value, index) { return { m: value, i: index }; }), m.narrow ? 4 : 7), frame, m);
    corner(frame, m, (spec.currency_symbol || "") + " premium", C.amber);

    series.forEach(function (item, index) {
      var points = (item.premium || []).map(function (value, position) {
        return [minutes[position], num(value)];
      });
      var line = d3.line()
        .defined(function (pair) { return pair[1] !== null; })
        .x(function (pair) { return x(pair[0]); })
        .y(function (pair) { return y(pair[1]); });
      frame.svg.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", seriesColor(index))
        .attr("stroke-width", index === 0 ? 1.6 : 1.2)
        .attr("stroke-opacity", 0.9)
        .attr("stroke-linejoin", "round")
        .attr("d", line);
      var last = null;
      for (var position = points.length - 1; position >= 0; position -= 1) {
        if (points[position][1] !== null) { last = points[position]; break; }
      }
      if (last && series.length <= 8) {
        frame.svg.append("circle")
          .attr("cx", x(last[0])).attr("cy", y(last[1])).attr("r", 2.2)
          .attr("fill", seriesColor(index));
        frame.svg.append("text")
          .attr("x", x(last[0]) + 4).attr("y", y(last[1]) + 3)
          .attr("fill", seriesColor(index)).attr("font-size", 8).attr("font-family", MONO)
          .text(item.label);
      }
    });

    var bisect = d3.bisector(function (value) { return value; }).center;
    var focus = frame.svg.append("g").style("display", "none");
    var rule = focus.append("line")
      .attr("y1", m.t).attr("y2", frame.height - m.b)
      .attr("stroke", C.text).attr("stroke-opacity", 0.5)
      .attr("stroke-dasharray", "3 3");
    var dot = focus.append("circle").attr("r", 3).attr("fill", C.text).attr("stroke", C.bg).attr("stroke-width", 1);
    overlay(frame.svg, frame, m, function (px, event) {
      var minute = x.invert(px);
      var index = Math.min(minutes.length - 1, bisect(minutes, minute));
      focus.style("display", null);
      rule.attr("x1", x(minutes[index])).attr("x2", x(minutes[index]));
      var spotValue = num(spot[index]);
      var rows = [];
      var ranked = series.map(function (item, position) {
        return {
          label: item.label,
          value: num((item.premium || [])[index]),
          distance: spotValue === null || num(item.strike) === null ? position : Math.abs(num(item.strike) - spotValue)
        };
      }).sort(function (a, b) { return a.distance - b.distance; }).slice(0, 4);
      dot.attr("cx", x(minutes[index])).attr("cy", m.t + 4);
      ranked.forEach(function (item) {
        rows.push([escapeHtml(item.label), item.value === null ? "—" : RV.money(spec, item.value)]);
      });
      rows.unshift(["Spot", spotValue === null ? "—" : RV.money(spec, spotValue)]);
      tip.show(event, clockOf(minutes[index]), rows);
    }, function () {
      focus.style("display", "none");
      tip.hide();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 2. smile at several clocks                                         */
  /* ------------------------------------------------------------------ */
  function smiles(host, payload) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var panels = data.panels || [];
    if (!panels.length) return empty(host, "No smiles in the payload.");

    var strikes = [];
    var ivs = [];
    panels.forEach(function (panel) {
      (panel.strikes || []).forEach(function (strike) { if (num(strike) !== null) strikes.push(num(strike)); });
      (panel.ce_iv || []).concat(panel.pe_iv || []).forEach(function (value) {
        if (num(value) !== null) ivs.push(num(value));
      });
    });
    if (!strikes.length || !ivs.length) return empty(host, "No IV quotes in the payload.");

    var width = Math.max(300, host.clientWidth || 640);
    var cols = panels.length > 1 ? 2 : 1;
    var gap = 8;
    var cellWidth = Math.max(140, Math.floor((width - (cols - 1) * gap) / cols));
    var cellHeight = width < 520 ? 148 : 190;
    host.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0,1fr))";
    wrap.style.gap = gap + "px";
    host.appendChild(wrap);

    var xLow = Math.min.apply(null, strikes), xHigh = Math.max.apply(null, strikes);
    var yLow = Math.max(0, Math.min.apply(null, ivs) - 2), yHigh = Math.max.apply(null, ivs) + 2;

    panels.forEach(function (panel, index) {
      var cell = document.createElement("div");
      cell.style.minWidth = "0";
      wrap.appendChild(cell);
      var svg = cellFrame(cell, cellWidth, cellHeight);
      var m = { t: 18, r: 10, b: 20, l: 32 };
      var innerW = cellWidth - m.l - m.r;
      var innerH = cellHeight - m.t - m.b;
      var x = d3.scaleLinear().domain([xLow, xHigh]).range([0, innerW]);
      var y = d3.scaleLinear().domain([yLow, yHigh]).range([innerH, 0]);
      var root = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var ticksX = [xLow, (xLow + xHigh) / 2, xHigh];
      root.append("g").attr("transform", "translate(0," + innerH + ")")
        .call(d3.axisBottom(x).tickValues(ticksX).tickFormat(function (value) { return RV.fmt(value, 0); }).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, width < 520); });
      root.append("g").call(d3.axisLeft(y).ticks(4).tickFormat(function (value) { return value + "%"; }).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, width < 520); });

      if (num(panel.spot) !== null) {
        root.append("line")
          .attr("x1", x(panel.spot)).attr("x2", x(panel.spot))
          .attr("y1", 0).attr("y2", innerH)
          .attr("stroke", C.text).attr("stroke-opacity", 0.7).attr("stroke-dasharray", "3 3");
        root.append("text")
          .attr("x", Math.min(innerW - 2, x(panel.spot) + 3)).attr("y", innerH - 3)
          .attr("text-anchor", x(panel.spot) > innerW - 42 ? "end" : "start")
          .attr("fill", C.text).attr("font-size", 8).attr("font-family", MONO)
          .text(RV.fmt(panel.spot, 0));
      }

      [["ce_iv", C.green, "CE"], ["pe_iv", C.red, "PE"]].forEach(function (entry) {
        var values = panel[entry[0]] || [];
        var pairs = values.map(function (value, position) {
          return [num(panel.strikes[position]), num(value)];
        });
        root.append("path")
          .datum(pairs)
          .attr("fill", "none")
          .attr("stroke", entry[1])
          .attr("stroke-width", 1.5)
          .attr("stroke-linejoin", "round")
          .attr("d", d3.line()
            .defined(function (pair) { return pair[0] !== null && pair[1] !== null; })
            .x(function (pair) { return x(pair[0]); })
            .y(function (pair) { return y(pair[1]); }));
        pairs.forEach(function (pair) {
          if (pair[0] === null || pair[1] === null) return;
          root.append("circle")
            .attr("cx", x(pair[0])).attr("cy", y(pair[1])).attr("r", 1.8)
            .attr("fill", entry[1]);
        });
      });

      svg.append("text").attr("x", m.l).attr("y", 11)
        .attr("fill", C.text).attr("font-size", 9).attr("font-weight", 600).attr("font-family", MONO)
        .text(panel.clock + " · ATM " + (num(panel.atm_iv) === null ? "—" : RV.fmt(panel.atm_iv, 2) + "%"));
      if (num(panel.atm_gap) !== null) {
        svg.append("text")
          .attr("x", m.l + innerW + m.r).attr("y", 11).attr("text-anchor", "end")
          .attr("fill", panel.atm_gap >= 0 ? C.green : C.red)
          .attr("font-size", 8.5).attr("font-family", MONO)
          .text("CE−PE " + RV.signed(panel.atm_gap, 1) + " vp");
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 3. premium vs intrinsic vs frozen model                            */
  /* ------------------------------------------------------------------ */
  function premiumVsIntrinsic(host, payload) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var contracts = data.contracts || [];
    if (!contracts.length) return empty(host, "No contracts in the payload.");
    var width = Math.max(300, host.clientWidth || 640);
    var cols = width > 900 ? 3 : 2;
    var gap = 8;
    var cellWidth = Math.max(140, Math.floor((width - (cols - 1) * gap) / cols));
    var cellHeight = width < 520 ? 118 : 180;
    host.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0,1fr))";
    wrap.style.gap = gap + "px";
    host.appendChild(wrap);

    contracts.forEach(function (contract) {
      var cell = document.createElement("div");
      cell.style.minWidth = "0";
      wrap.appendChild(cell);
      var points = contract.points || [];
      var frozen = contract.frozen || [];
      var values = [];
      points.forEach(function (point) {
        [point.premium, point.intrinsic].forEach(function (value) { if (num(value) !== null) values.push(num(value)); });
      });
      frozen.forEach(function (point) { if (num(point.premium) !== null) values.push(num(point.premium)); });
      if (!points.length || !values.length) {
        empty(cell, "No prints for " + contract.label);
        return;
      }
      var minutes = points.map(function (point) { return minuteOf(point.t); }).filter(function (value) { return value !== null; });
      var xLow = Math.min.apply(null, minutes), xHigh = Math.max.apply(null, minutes);
      var low = Math.min.apply(null, values), high = Math.max.apply(null, values);
      var pad = Math.max(2, (high - low) * 0.08);
      var svg = cellFrame(cell, cellWidth, cellHeight);
      var m = { t: 18, r: 10, b: 20, l: 34 };
      var innerW = cellWidth - m.l - m.r;
      var innerH = cellHeight - m.t - m.b;
      var x = d3.scaleLinear().domain([xLow, xHigh || xLow + 1]).range([0, innerW]);
      var y = d3.scaleLinear().domain([Math.max(0, low - pad), high + pad]).range([innerH, 0]);
      var root = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var tickRows = points.map(function (point) { return { m: minuteOf(point.t) }; }).filter(function (row) { return row.m !== null; });
      root.append("g").attr("transform", "translate(0," + innerH + ")")
        .call(d3.axisBottom(x).tickValues(timeTicks(tickRows, width < 520 ? 3 : 4)).tickFormat(clockOf).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, width < 520); });
      root.append("g").call(d3.axisLeft(y).ticks(4).tickFormat(function (value) { return RV.fmt(value, 0); }).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, width < 520); });

      var pairs = points.map(function (point) {
        return [minuteOf(point.t), num(point.premium), num(point.intrinsic)];
      });
      root.append("path")
        .datum(pairs)
        .attr("fill", C.raised).attr("fill-opacity", 0.55)
        .attr("d", d3.area()
          .defined(function (pair) { return pair[1] !== null && pair[2] !== null; })
          .x(function (pair) { return x(pair[0]); })
          .y0(function (pair) { return y(pair[2]); })
          .y1(function (pair) { return y(pair[1]); }));

      root.append("path")
        .datum(pairs)
        .attr("fill", "none").attr("stroke", C.muted).attr("stroke-width", 1.1)
        .attr("stroke-dasharray", "4 2")
        .attr("d", d3.line()
          .defined(function (pair) { return pair[2] !== null; })
          .x(function (pair) { return x(pair[0]); }).y(function (pair) { return y(pair[2]); }));

      if (frozen.length) {
        root.append("path")
          .datum(frozen.map(function (point) { return [minuteOf(point.t), num(point.premium)]; }))
          .attr("fill", "none").attr("stroke", C.violet).attr("stroke-width", 1.2)
          .attr("stroke-dasharray", "1.5 2.5")
          .attr("d", d3.line()
            .defined(function (pair) { return pair[0] !== null && pair[1] !== null; })
            .x(function (pair) { return x(pair[0]); }).y(function (pair) { return y(pair[1]); }));
      }

      var stroke = contract.side === "ce" ? C.blue : C.amber;
      root.append("path")
        .datum(pairs)
        .attr("fill", "none").attr("stroke", stroke).attr("stroke-width", 1.7)
        .attr("d", d3.line()
          .defined(function (pair) { return pair[1] !== null; })
          .x(function (pair) { return x(pair[0]); }).y(function (pair) { return y(pair[1]); }));

      var last = null;
      for (var position = pairs.length - 1; position >= 0; position -= 1) {
        if (pairs[position][1] !== null) { last = pairs[position]; break; }
      }
      if (last) {
        root.append("circle").attr("cx", x(last[0])).attr("cy", y(last[1])).attr("r", 2.4).attr("fill", stroke);
        root.append("text").attr("x", x(last[0]) - 3).attr("y", y(last[1]) + 10).attr("text-anchor", "end")
          .attr("fill", stroke).attr("font-size", 8.5).attr("font-family", MONO)
          .text(RV.money(spec, last[1]));
      }

      var stats = contract.stats || {};
      svg.append("text").attr("x", m.l).attr("y", 11)
        .attr("fill", C.text).attr("font-size", 9).attr("font-weight", 600).attr("font-family", MONO)
        .text(contract.label);
      svg.append("text").attr("x", m.l + innerW + m.r).attr("y", 11).attr("text-anchor", "end")
        .attr("fill", C.muted).attr("font-size", 8).attr("font-family", MONO)
        .text("TV " + (num(stats.time_value_end) === null ? "—" : RV.fmt(stats.time_value_end, 1)));
    });
  }

  /* ------------------------------------------------------------------ */
  /* 4. theta decomposition                                             */
  /* ------------------------------------------------------------------ */
  function thetaBars(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var rows = data.rows || [];
    if (!rows.length) return empty(host, "No attribution rows in the payload.");
    var frame = openFrame(host);
    var width = frame.width, height = frame.height;
    var narrow = width < 760;
    var m1 = { t: 24, r: narrow ? 38 : 54, b: 24, l: narrow ? 64 : 78, narrow: narrow };
    var topHeight = narrow ? 190 : height;
    var innerH = topHeight - m1.t - m1.b;
    var leftWidth = narrow ? width : Math.floor(width * 0.58);
    var innerW = leftWidth - m1.l - m1.r;
    var root = frame.svg.append("g").attr("transform", "translate(" + m1.l + "," + m1.t + ")");
    var buckets = data.buckets || [
      { id: "spot", label: "spot", tone: "blue" },
      { id: "theta", label: "time", tone: "amber" },
      { id: "iv", label: "IV", tone: "violet" },
      { id: "wedge", label: "wedge", tone: "muted" }
    ];
    var values = [];
    rows.forEach(function (row) {
      buckets.forEach(function (bucket) { if (num(row[bucket.id]) !== null) values.push(num(row[bucket.id])); });
      if (num(row.dp) !== null) values.push(num(row.dp));
    });
    if (!values.length) return empty(host, "Every attribution bucket is blank.");
    var low = Math.min(0, Math.min.apply(null, values)), high = Math.max(0, Math.max.apply(null, values));
    var pad = Math.max(1, (high - low) * 0.08);
    var x = d3.scaleLinear().domain([low - pad, high + pad]).range([0, innerW]);
    var y = d3.scaleBand().domain(rows.map(function (row) { return row.label; })).range([0, innerH]).padding(0.28);

    root.append("g").attr("transform", "translate(0," + innerH + ")")
      .call(d3.axisBottom(x).ticks(narrow ? 4 : 6).tickFormat(function (value) { return RV.fmt(value, 0); }).tickSizeOuter(0))
      .call(function (group) { styleAxis(group, narrow); });
    root.append("g").call(d3.axisLeft(y).tickSize(0).tickPadding(6))
      .call(function (group) {
        group.selectAll("text").attr("fill", C.text).attr("font-size", 8.5).attr("font-family", MONO);
        group.select(".domain").remove();
      });
    root.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", innerH)
      .attr("stroke", C.muted).attr("stroke-opacity", 0.55);

    rows.forEach(function (row) {
      var bandY = y(row.label), bandH = y.bandwidth();
      var gap = 1.3;
      var barH = (bandH - gap * (buckets.length - 1)) / buckets.length;
      buckets.forEach(function (bucket, index) {
        var value = num(row[bucket.id]);
        if (value === null) return;
        root.append("rect")
          .attr("x", Math.min(x(0), x(value)))
          .attr("width", Math.max(0.6, Math.abs(x(value) - x(0))))
          .attr("y", bandY + index * (barH + gap))
          .attr("height", barH)
          .attr("fill", tone(bucket.tone)).attr("fill-opacity", 0.85);
      });
      if (num(row.dp) !== null) {
        root.append("line")
          .attr("x1", x(row.dp)).attr("x2", x(row.dp))
          .attr("y1", Math.max(0, bandY - 2)).attr("y2", Math.min(innerH, bandY + bandH + 2))
          .attr("stroke", C.text).attr("stroke-width", 2);
        root.append("text").attr("x", innerW + 5).attr("y", bandY + bandH / 2 + 3)
          .attr("fill", C.text).attr("font-size", 8.5).attr("font-family", MONO)
          .text(RV.signed(row.dp, 1));
      }
    });
    corner(frame, m1, "Δ PREMIUM · REPRICING BUCKETS", C.muted);

    var m2 = { t: narrow ? topHeight + 26 : 22, r: 14, b: 24, l: narrow ? 64 : 62, narrow: narrow };
    var originX = narrow ? 0 : leftWidth + 12;
    var innerW2 = (narrow ? width : width - leftWidth - 12) - m2.l - m2.r;
    var innerH2 = (narrow ? Math.max(90, height - m2.t - m2.b) : height - m2.t - m2.b);
    var naiveValues = rows.map(function (row) { return num(row.naive_theta); }).filter(function (value) { return value !== null; });
    var pricedValues = rows.map(function (row) { return num(row.priced_theta); }).filter(function (value) { return value !== null; });
    var both = naiveValues.concat(pricedValues);
    if (both.length) {
      var low2 = Math.min(0, Math.min.apply(null, both)), high2 = Math.max(0, Math.max.apply(null, both));
      var pad2 = Math.max(1, (high2 - low2) * 0.08);
      var x2 = d3.scaleLinear().domain([low2 - pad2, high2 + pad2]).range([0, innerW2]);
      var y2 = d3.scaleBand().domain(rows.map(function (row) { return row.label; })).range([0, innerH2]).padding(0.38);
      var root2 = frame.svg.append("g").attr("transform", "translate(" + (originX + m2.l) + "," + (m2.t) + ")");
      root2.append("g").attr("transform", "translate(0," + innerH2 + ")")
        .call(d3.axisBottom(x2).ticks(narrow ? 4 : 5).tickFormat(function (value) { return RV.fmt(value, 0); }).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, narrow); });
      if (narrow) {
        root2.append("g").call(d3.axisLeft(y2).tickSize(0).tickPadding(6))
          .call(function (group) {
            group.selectAll("text").attr("fill", C.text).attr("font-size", 8.5).attr("font-family", MONO);
            group.select(".domain").remove();
          });
      }
      root2.append("line").attr("x1", x2(0)).attr("x2", x2(0)).attr("y1", 0).attr("y2", innerH2)
        .attr("stroke", C.muted).attr("stroke-opacity", 0.55);
      rows.forEach(function (row) {
        var bandY = y2(row.label), bandH = y2.bandwidth();
        if (num(row.naive_theta) !== null) {
          root2.append("rect")
            .attr("x", x2(row.naive_theta)).attr("width", Math.max(0.8, x2(0) - x2(row.naive_theta)))
            .attr("y", bandY + bandH * 0.03).attr("height", bandH * 0.44)
            .attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", 1).attr("stroke-dasharray", "3 2");
        }
        if (num(row.priced_theta) !== null) {
          root2.append("rect")
            .attr("x", x2(row.priced_theta)).attr("width", Math.max(0.8, x2(0) - x2(row.priced_theta)))
            .attr("y", bandY + bandH * 0.52).attr("height", bandH * 0.44)
            .attr("fill", C.amber).attr("fill-opacity", 0.82);
        }
      });
      frame.svg.append("text")
        .attr("x", originX + m2.l).attr("y", m2.t - 6)
        .attr("fill", C.muted).attr("font-size", 8.5).attr("font-family", MONO)
        .text("vendor θ (hollow) vs priced θ (solid)");
    }

    var bisect = d3.bisector(function (row) { return y(row.label) + y.bandwidth() / 2; }).center;
    overlay(frame.svg, { width: leftWidth, height: topHeight }, m1, function (px, event) {
      var py = d3.pointer(event, frame.svg.node())[1];
      var row = rows[bisect(rows, py - m1.t)];
      if (!row) return;
      tip.show(event, escapeHtml(row.label), [
        ["Actual Δ", pointText(row.dp, spec)],
        ["Spot", pointText(row.spot, spec)],
        ["Time (priced)", pointText(row.priced_theta, spec)],
        ["IV", pointText(row.iv, spec)],
        ["Print wedge", pointText(row.wedge, spec)],
        ["Vendor θ", pointText(row.naive_theta, spec)]
      ]);
    }, function () { tip.hide(); });
  }

  /* ------------------------------------------------------------------ */
  /* 5. skew rotation                                                   */
  /* ------------------------------------------------------------------ */
  function skew(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var points = data.points || [];
    var fixed = data.fixed || [];
    if (!points.length) return empty(host, "No skew points in the payload.");
    var frame = openFrame(host);
    var width = frame.width, height = frame.height;
    var wide = width > 980;
    var leftWidth = wide ? Math.floor(width * 0.54) : width;
    var m1 = { t: 20, r: 14, b: 24, l: 38, narrow: width < 520 };
    var topHeight = wide ? height : Math.floor(height * 0.54);
    var innerW = leftWidth - m1.l - m1.r;
    var innerH = topHeight - m1.t - m1.b;
    var x = d3.scaleLinear().domain([points[0].m, points[points.length - 1].m || points[0].m + 1]).range([0, innerW]);
    var ivs = [];
    points.forEach(function (point) {
      [point.atm_iv, point.ce25, point.pe25].forEach(function (value) { if (num(value) !== null) ivs.push(num(value)); });
    });
    if (!ivs.length) return empty(host, "No ATM or wing IV quotes in the payload.");
    var low = Math.min.apply(null, ivs) - 2, high = Math.max.apply(null, ivs) + 2;
    var y = d3.scaleLinear().domain([low, high]).range([innerH, 0]);
    var root = frame.svg.append("g").attr("transform", "translate(" + m1.l + "," + m1.t + ")");
    var tickRows = points.map(function (point) { return { m: point.m }; });
    root.append("g").attr("transform", "translate(0," + innerH + ")")
      .call(d3.axisBottom(x).tickValues(timeTicks(tickRows, wide ? 7 : 4)).tickFormat(clockOf).tickSizeOuter(0))
      .call(function (group) { styleAxis(group, m1.narrow); });
    root.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(function (value) { return value + "%"; }).tickSizeOuter(0))
      .call(function (group) { styleAxis(group, m1.narrow); });
    [["atm_iv", C.text, "ATM", 1.7], ["ce25", C.green, "25Δ call", 1.2], ["pe25", C.red, "25Δ put", 1.2]].forEach(function (entry) {
      root.append("path")
        .datum(points)
        .attr("fill", "none").attr("stroke", entry[1]).attr("stroke-width", entry[3])
        .attr("stroke-opacity", entry[0] === "atm_iv" ? 1 : 0.8)
        .attr("d", d3.line()
          .defined(function (point) { return num(point[entry[0]]) !== null; })
          .x(function (point) { return x(point.m); })
          .y(function (point) { return y(num(point[entry[0]])); }));
    });
    corner(frame, m1, "ATM IV AND WING SKEW", C.muted);

    var m2 = { t: wide ? 22 : topHeight + 20, r: 14, b: 24, l: 38, narrow: width < 520 };
    var originX = wide ? leftWidth + 14 : 0;
    var innerW2 = (wide ? width - leftWidth - 14 : width) - m2.l - m2.r;
    var innerH2 = (wide ? height : height - topHeight - 20) - m2.t - m2.b;
    var gaps = [];
    fixed.forEach(function (series) {
      (series.points || []).forEach(function (point) { if (num(point.gap) !== null) gaps.push(num(point.gap)); });
    });
    if (gaps.length) {
      gaps.push(0);
      var gLow = Math.min.apply(null, gaps) - 1, gHigh = Math.max.apply(null, gaps) + 1;
      var x2 = d3.scaleLinear().domain([points[0].m, points[points.length - 1].m || points[0].m + 1]).range([0, innerW2]);
      var y2 = d3.scaleLinear().domain([gLow, gHigh]).range([innerH2, 0]);
      var root2 = frame.svg.append("g").attr("transform", "translate(" + (originX + m2.l) + "," + m2.t + ")");
      root2.append("g").attr("transform", "translate(0," + innerH2 + ")")
        .call(d3.axisBottom(x2).tickValues(timeTicks(tickRows, wide ? 7 : 4)).tickFormat(clockOf).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, m2.narrow); });
      root2.append("g").call(d3.axisLeft(y2).ticks(5).tickFormat(function (value) { return RV.signed(value, 1) + "vp"; }).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, m2.narrow); });
      root2.append("line").attr("x1", 0).attr("x2", innerW2).attr("y1", y2(0)).attr("y2", y2(0))
        .attr("stroke", C.muted).attr("stroke-opacity", 0.6);
      fixed.forEach(function (series, index) {
        var color = seriesColor(index + 1);
        root2.append("path")
          .datum(series.points || [])
          .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.4)
          .attr("d", d3.line()
            .defined(function (point) { return num(point.gap) !== null; })
            .x(function (point) { return x2(point.m); })
            .y(function (point) { return y2(num(point.gap)); }));
        var last = null;
        for (var position = (series.points || []).length - 1; position >= 0; position -= 1) {
          if (num(series.points[position].gap) !== null) { last = series.points[position]; break; }
        }
        if (last) {
          root2.append("text")
            .attr("x", x2(last.m) - 4).attr("y", y2(last.gap) - 4).attr("text-anchor", "end")
            .attr("fill", color).attr("font-size", 8).attr("font-family", MONO)
            .text(series.label);
        }
      });
      corner(frame, { l: originX + m2.l, r: m2.r }, "CE − PE IV AT THE SAME STRIKE", C.muted);
    }

    var bisect = d3.bisector(function (point) { return point.m; }).center;
    overlay(frame.svg, { width: leftWidth, height: topHeight }, m1, function (px, event) {
      var point = points[bisect(points, x.invert(px))];
      if (!point) return;
      tip.show(event, point.t, [
        ["ATM IV", num(point.atm_iv) === null ? "—" : RV.fmt(point.atm_iv, 2) + "%"],
        ["25Δ call", num(point.ce25) === null ? "—" : RV.fmt(point.ce25, 2) + "%"],
        ["25Δ put", num(point.pe25) === null ? "—" : RV.fmt(point.pe25, 2) + "%"]
      ]);
    }, function () { tip.hide(); });
  }

  /* ------------------------------------------------------------------ */
  /* 6. basis 3D (Plotly)                                               */
  /* ------------------------------------------------------------------ */
  RV.register("basis_3d", function (host, payload) {
    if (!window.Plotly) { empty(host, "Plotly is not available in this browser"); return; }
    var spec = payload.spec || {};
    var data = payload.data || {};
    if (!(data.minutes || []).length) { empty(host, "No basis rows in the payload."); return; }
    var valid = [];
    data.minutes.forEach(function (minute, index) {
      if (num(data.basis[index]) !== null && num(data.oi[index]) !== null) valid.push(index);
    });
    if (!valid.length) { empty(host, "Every row is missing basis or open interest."); return; }
    var width = Math.max(320, host.clientWidth || 640);
    var narrow = width < 720;
    var height = Math.max(300, (host.clientHeight || 470) - 8);

    var line = {
      type: "scatter3d", mode: "lines",
      x: data.minutes, y: data.basis, z: data.oi,
      line: { color: C.muted, width: 3 },
      connectgaps: false, hoverinfo: "skip", showlegend: false
    };
    var sizes = valid.map(function (index) {
      var volume = num(data.volume[index]);
      return volume === null ? 3.2 : 3.2 + Math.min(6, Math.sqrt(Math.abs(volume)) / 80);
    });
    var colors = valid.map(function (index) { return num(data.doi[index]); });
    var hasDoi = colors.some(function (value) { return value !== null; });
    if (!hasDoi) {
      colors = valid.map(function (index, position) {
        if (position === 0) return 0;
        var previous = valid[position - 1];
        return num(data.basis[index]) !== null && num(data.basis[previous]) !== null
          ? num(data.basis[index]) - num(data.basis[previous])
          : 0;
      });
    }
    colors = colors.map(function (value) { return value === null ? 0 : value; });
    var colorValues = colors.filter(function (value) { return value !== null; });
    var cap = Math.max.apply(null, [1].concat(colorValues.map(function (value) { return Math.abs(value); })));
    var traces = [line, {
      type: "scatter3d", mode: "markers",
      x: valid.map(function (index) { return data.minutes[index]; }),
      y: valid.map(function (index) { return data.basis[index]; }),
      z: valid.map(function (index) { return data.oi[index]; }),
      marker: {
        size: sizes, opacity: 0.9,
        color: colors,
        colorscale: [[0, C.red], [0.5, C.raised], [1, C.green]],
        cmin: -cap, cmax: cap, cmid: 0,
        colorbar: {
          title: { text: "Δ OI", side: "right", font: { size: 9, color: C.muted, family: MONO } },
          tickfont: { size: 8, color: C.muted, family: MONO },
          thickness: narrow ? 7 : 9, len: 0.52, outlinewidth: 0
        }
      },
      customdata: valid.map(function (index) {
        return [
          data.t[index],
          num(data.price[index]),
          num(data.spot[index]),
          num(data.volume[index]),
          num(data.doi[index])
        ];
      }),
      hovertemplate: "%{customdata[0]}<br>basis %{y:+.2f} · OI %{z:,.0f}<br>" +
        "price %{customdata[1]:,.2f} · spot %{customdata[2]:,.2f}<br>" +
        "volume %{customdata[3]:,.0f} · ΔOI %{customdata[4]:+,.0f}<extra></extra>",
      showlegend: false
    }];

    function sceneAxis(title, extra) {
      return Object.assign({
        title: { text: title, font: { size: 9, color: C.muted, family: MONO } },
        gridcolor: C.border, zerolinecolor: C.border,
        showbackground: true, backgroundcolor: "rgba(31,36,45,0.35)",
        tickfont: { size: 8, color: C.muted, family: MONO }, showspikes: false
      }, extra || {});
    }
    var pairs = (function () {
      var rows = data.minutes.map(function (minute, index) { return { m: minute, i: index }; });
      var picks = timeTicks(rows, narrow ? 4 : 6);
      return {
        vals: picks,
        text: picks.map(function (minute) { return clockOf(minute); })
      };
    })();

    var layout = RV.plotlyLayout(spec, {
      height: height,
      margin: { l: narrow ? 4 : 30, r: narrow ? 4 : 10, t: 8, b: 4 },
      hovermode: "closest",
      scene: {
        bgcolor: C.surface,
        camera: { eye: { x: 1.45, y: -1.65, z: 0.95 } },
        xaxis: sceneAxis("clock", { tickmode: "array", tickvals: pairs.vals, ticktext: pairs.text }),
        yaxis: sceneAxis("basis · pts", { nticks: narrow ? 4 : 5 }),
        zaxis: sceneAxis("OI · " + (spec.oi_unit || ""), { nticks: 4, tickformat: ".2s" }),
        aspectmode: "manual",
        aspectratio: narrow ? { x: 1.45, y: 1.0, z: 0.62 } : { x: 2.0, y: 0.95, z: 0.7 },
        dragmode: "orbit"
      }
    });
    RV.plotly(host, traces, layout);
  });

  /* ------------------------------------------------------------------ */
  /* 7. basis path + regime strip                                       */
  /* ------------------------------------------------------------------ */
  function basisStrip(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var minutes = data.minutes || [];
    if (!minutes.length) return empty(host, "No basis rows in the payload.");
    var frame = openFrame(host);
    var width = frame.width, height = frame.height;
    var m = { t: 18, r: width < 520 ? 12 : 18, b: 24, l: width < 520 ? 38 : 48, narrow: width < 520 };
    var x = d3.scaleLinear().domain([minutes[0], minutes[minutes.length - 1] || minutes[0] + 1]).range([m.l, width - m.r]);
    var values = [];
    (data.basis || []).forEach(function (value) { if (num(value) !== null) values.push(num(value)); });
    var hasLine = values.length > 0;
    if (!hasLine && !(data.bands || []).length) return empty(host, "Every basis print is blank.");
    var low = hasLine ? Math.min.apply(null, values) : -1;
    var high = hasLine ? Math.max.apply(null, values) : 1;
    var pad = Math.max(1, (high - low) * 0.12);
    var stripH = m.narrow ? 26 : 34;
    var plotBottom = height - m.b - stripH - 10;
    var y = d3.scaleLinear().domain([Math.min(0, low) - pad, Math.max(0, high) + pad]).range([plotBottom, m.t]);

    if (hasLine) {
      grid(frame.svg, y, frame, m, m.narrow ? 4 : 5);
      yAxis(frame.svg, y, frame, m, function (value) { return RV.signed(value, 0); }, m.narrow ? 4 : 5);
      corner(frame, m, "basis · " + (data.unit || "pts"), C.amber);
    }
    timeAxis(frame.svg, x, timeTicks(minutes.map(function (value) { return { m: value }; }), m.narrow ? 4 : 7), frame, m);

    var zero = y(0);
    if (hasLine) {
      frame.svg.append("path")
        .datum(data.basis.map(function (value, index) { return [minutes[index], num(value)]; }))
        .attr("fill", C.amber).attr("fill-opacity", 0.12)
        .attr("d", d3.area()
          .defined(function (pair) { return pair[1] !== null; })
          .x(function (pair) { return x(pair[0]); })
          .y0(zero).y1(function (pair) { return y(pair[1]); }));
      frame.svg.append("path")
        .datum(data.basis.map(function (value, index) { return [minutes[index], num(value)]; }))
        .attr("fill", "none").attr("stroke", C.amber).attr("stroke-width", m.narrow ? 1.3 : 1.6)
        .attr("d", d3.line()
          .defined(function (pair) { return pair[1] !== null; })
          .x(function (pair) { return x(pair[0]); }).y(function (pair) { return y(pair[1]); }));
      frame.svg.append("line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", zero).attr("y2", zero)
        .attr("stroke", C.muted).attr("stroke-opacity", 0.6);
    }
    var stats = data.stats || {};
    if (hasLine && num(stats.mean) !== null) {
      frame.svg.append("line").attr("x1", m.l).attr("x2", width - m.r)
        .attr("y1", y(stats.mean)).attr("y2", y(stats.mean))
        .attr("stroke", C.muted).attr("stroke-opacity", 0.5).attr("stroke-dasharray", "2 4");
      if (!m.narrow) corner(frame, m, "mean " + RV.signed(stats.mean, spec.price_digits), C.muted, "right");
    }

    var stripY = plotBottom + 6;
    var categories = {};
    (data.categories || []).forEach(function (item) { categories[item.id] = item; });
    (data.bands || []).forEach(function (item) {
      if (!Number.isFinite(Number(item.start_m)) || !Number.isFinite(Number(item.end_m))) return;
      var x0 = x(Number(item.start_m)), x1 = x(Number(item.end_m));
      if (x1 <= x0) return;
      var category = categories[item.regime] || { label: item.regime, tone: "muted" };
      frame.svg.append("rect")
        .attr("x", x0 + 0.5).attr("y", stripY)
        .attr("width", Math.max(1, x1 - x0 - 1)).attr("height", stripH)
        .attr("fill", tone(category.tone)).attr("fill-opacity", 0.82)
        .attr("stroke", C.bg).attr("stroke-width", 1)
        .on("mousemove", function (event) {
          tip.show(event, item.start + " → " + item.end, [
            ["Regime", band(category.label)],
            ["Basis", pointText(item.dp, spec)],
            ["From", pointText(item.from_basis, spec)],
            ["To", pointText(item.to_basis, spec)]
          ]);
        })
        .on("mouseleave", function () { tip.hide(); });
    });

    var bisect = d3.bisector(function (value) { return value; }).center;
    var focus = frame.svg.append("g").style("display", "none");
    var rule = focus.append("line").attr("y1", m.t).attr("y2", plotBottom)
      .attr("stroke", C.text).attr("stroke-opacity", 0.5).attr("stroke-dasharray", "3 3");
    var dot = focus.append("circle").attr("r", 3).attr("fill", C.amber).attr("stroke", C.bg).attr("stroke-width", 1);
    overlay(frame.svg, { width: width, height: plotBottom + m.b }, m, function (px, event) {
      var index = Math.min(minutes.length - 1, bisect(minutes, x.invert(px)));
      var value = num(data.basis[index]);
      focus.style("display", null);
      rule.attr("x1", x(minutes[index])).attr("x2", x(minutes[index]));
      dot.style("display", value === null ? "none" : null)
        .attr("cx", x(minutes[index])).attr("cy", value === null ? 0 : y(value));
      tip.show(event, clockOf(minutes[index]), [
        ["Basis", pointText(value, spec)],
        ["Spot", num(data.spot[index]) === null ? "—" : RV.money(spec, data.spot[index])]
      ]);
    }, function () {
      focus.style("display", "none");
      tip.hide();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 8. lead/lag                                                        */
  /* ------------------------------------------------------------------ */
  function leadLag(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var rows = data.rows || [];
    if (!rows.length) return empty(host, "No correlation rows in the payload.");
    var frame = openFrame(host);
    var m = margins(frame.width, 22, 26);
    var width = frame.width, height = frame.height;
    var lags = rows.map(function (row) { return row.lag; });
    var x = d3.scaleBand().domain(lags).range([m.l, width - m.r]).padding(0.24);
    var y = d3.scaleLinear().domain([-1.05, 1.05]).range([height - m.b, m.t]);
    var labels = data.labels || {};

    grid(frame.svg, y, frame, m, 5);
    yAxis(frame.svg, y, frame, m, function (value) { return RV.fmt(value, 1); }, 5);
    var tickTexts = lags.map(function (lag) { return lag > 0 ? "+" + lag : lag < 0 ? "−" + Math.abs(lag) : "0"; });
    var axis = frame.svg.append("g").attr("transform", "translate(0," + (height - m.b) + ")")
      .call(d3.axisBottom(x).tickFormat(function (lag) {
        var index = lags.indexOf(lag);
        return index >= 0 ? tickTexts[index] : "";
      }).tickSizeOuter(0));
    styleAxis(axis, m.narrow);
    frame.svg.append("line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", y(0)).attr("y2", y(0))
      .attr("stroke", C.muted).attr("stroke-opacity", 0.6);
    corner(frame, m, "correlation · lag 0 = concurrent", C.muted);

    var bandWidth = x.bandwidth();
    rows.forEach(function (row) {
      var left = x(row.lag);
      [["naive", 0, C.muted, 0.55], ["aligned", 1, C.blue, 0.95]].forEach(function (entry) {
        var value = num(row[entry[0]]);
        if (value === null) return;
        var barWidth = Math.max(2, bandWidth / 2 - 1);
        var barX = left + entry[1] * (bandWidth / 2);
        var barY = value >= 0 ? y(value) : y(0);
        var barH = Math.max(1, Math.abs(y(value) - y(0)));
        frame.svg.append("rect")
          .attr("x", barX).attr("y", barY).attr("width", barWidth).attr("height", barH)
          .attr("fill", entry[2]).attr("fill-opacity", entry[3])
          .style("cursor", "crosshair")
          .on("mousemove", function (event) {
            var ci = row[entry[0] + "_ci"];
            tip.show(event, (row.lag > 0 ? "+" : "") + row.lag + " min", [
              [escapeHtml(labels[entry[0]] || entry[0]), RV.signed(value, 3)],
              ["Pairs", RV.fmt(row[entry[0] + "_n"] || 0, 0)],
              ["95% CI", Array.isArray(ci) ? RV.signed(ci[0], 3) + " … " + RV.signed(ci[1], 3) : "—"]
            ]);
          })
          .on("mouseleave", function () { tip.hide(); });
        if (Array.isArray(row[entry[0] + "_ci"])) {
          var ci = row[entry[0] + "_ci"];
          if (Number.isFinite(Number(ci[0])) && Number.isFinite(Number(ci[1]))) {
            var cx = barX + barWidth / 2;
            frame.svg.append("line")
              .attr("x1", cx).attr("x2", cx)
              .attr("y1", y(ci[0])).attr("y2", y(ci[1]))
              .attr("stroke", entry[2]).attr("stroke-width", 1).attr("stroke-opacity", 0.8);
            [ci[0], ci[1]].forEach(function (valueAt) {
              frame.svg.append("line")
                .attr("x1", cx - 3).attr("x2", cx + 3)
                .attr("y1", y(valueAt)).attr("y2", y(valueAt))
                .attr("stroke", entry[2]).attr("stroke-width", 1).attr("stroke-opacity", 0.8);
            });
          }
        }
      });
    });

    var stats = data.stats || {};
    if (num(stats.concurrent_aligned) !== null) {
      frame.svg.append("text")
        .attr("x", width - m.r).attr("y", m.t - 8).attr("text-anchor", "end")
        .attr("fill", C.blue).attr("font-size", 9).attr("font-family", MONO)
        .text((labels.aligned || "aligned") + " 0 = " + RV.signed(stats.concurrent_aligned, 2));
    }
  }

  /* ------------------------------------------------------------------ */
  /* 9. two normalised paths + spread                                   */
  /* ------------------------------------------------------------------ */
  function crossPaths(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var series = data.series || [];
    var spread = data.spread || [];
    if (!series.length) return empty(host, "No series in the payload.");
    var frame = openFrame(host);
    var width = frame.width, height = frame.height;
    var m = { t: 20, r: width < 520 ? 12 : 18, b: 24, l: width < 520 ? 38 : 48, narrow: width < 520 };
    var topBottom = Math.floor(height * 0.6);
    var xLow = Infinity, xHigh = -Infinity;
    var allPct = [0];
    series.forEach(function (item) {
      (item.minutes || []).forEach(function (minute) {
        xLow = Math.min(xLow, minute); xHigh = Math.max(xHigh, minute);
      });
      (item.pct || []).forEach(function (value) { if (num(value) !== null) allPct.push(num(value)); });
    });
    if (!Number.isFinite(xLow)) return empty(host, "No timestamps in the payload.");
    var x = d3.scaleLinear().domain([xLow, xHigh || xLow + 1]).range([m.l, width - m.r]);
    var pLow = Math.min.apply(null, allPct), pHigh = Math.max.apply(null, allPct);
    var pPad = Math.max(0.05, (pHigh - pLow) * 0.1);
    var y = d3.scaleLinear().domain([pLow - pPad, pHigh + pPad]).range([topBottom, m.t]);

    grid(frame.svg, y, frame, m, m.narrow ? 4 : 5);
    yAxis(frame.svg, y, frame, m, function (value) { return RV.signed(value, 1) + "%"; }, m.narrow ? 4 : 5);
    var tickRows = series[0].minutes.map(function (value) { return { m: value }; });
    timeAxis(frame.svg, x, timeTicks(tickRows, m.narrow ? 4 : 7), { width: width, height: topBottom + m.b }, m);
    corner(frame, m, "% change from first print", C.muted);

    series.forEach(function (item, index) {
      var rows = (item.minutes || []).map(function (minute, position) {
        return [minute, num(item.pct[position])];
      });
      frame.svg.append("path")
        .datum(rows)
        .attr("fill", "none")
        .attr("stroke", seriesColor(index))
        .attr("stroke-width", index === 0 ? 1.7 : 1.3)
        .attr("stroke-dasharray", index > 1 ? "4 2" : null)
        .attr("d", d3.line()
          .defined(function (pair) { return pair[1] !== null; })
          .x(function (pair) { return x(pair[0]); }).y(function (pair) { return y(pair[1]); }));
      var last = null;
      for (var position = rows.length - 1; position >= 0; position -= 1) {
        if (rows[position][1] !== null) { last = rows[position]; break; }
      }
      if (last && index < 4) {
        frame.svg.append("text")
          .attr("x", width - m.r).attr("y", Math.max(m.t + 8, y(last[1]) - 4)).attr("text-anchor", "end")
          .attr("fill", seriesColor(index)).attr("font-size", 8.5).attr("font-family", MONO)
          .text(item.label + " " + RV.signed(last[1], 2) + "%");
      }
    });

    var bottomTop = topBottom + 26;
    var bottomH = height - bottomTop - m.b;
    if (spread.length && bottomH > 30) {
      var spreads = spread.map(function (item) { return num(item.bps); }).filter(function (value) { return value !== null; });
      spreads.push(0);
      var sLow = Math.min.apply(null, spreads), sHigh = Math.max.apply(null, spreads);
      var sPad = Math.max(0.5, (sHigh - sLow) * 0.12);
      var ys = d3.scaleLinear().domain([sLow - sPad, sHigh + sPad]).range([bottomTop + bottomH, bottomTop]);
      var xSpread = d3.scaleLinear().domain([spread[0].m, spread[spread.length - 1].m || spread[0].m + 1]).range([m.l, width - m.r]);
      frame.svg.append("g").attr("transform", "translate(0," + (height - m.b) + ")")
        .call(d3.axisBottom(xSpread).tickValues(timeTicks(spread, m.narrow ? 4 : 7)).tickFormat(clockOf).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, m.narrow); });
      var sAxis = frame.svg.append("g").attr("transform", "translate(" + m.l + ",0)")
        .call(d3.axisLeft(ys).ticks(3).tickFormat(function (value) { return RV.signed(value, 0); }).tickSizeOuter(0));
      styleAxis(sAxis, m.narrow);
      var sZero = ys(0);
      frame.svg.append("path")
        .datum(spread.map(function (item) { return [item.m, num(item.bps)]; }))
        .attr("fill", C.muted).attr("fill-opacity", 0.14)
        .attr("d", d3.area()
          .defined(function (pair) { return pair[1] !== null; })
          .x(function (pair) { return xSpread(pair[0]); })
          .y0(sZero).y1(function (pair) { return ys(pair[1]); }));
      frame.svg.append("path")
        .datum(spread.map(function (item) { return [item.m, num(item.bps)]; }))
        .attr("fill", "none").attr("stroke", C.muted).attr("stroke-width", 1.2)
        .attr("d", d3.line()
          .defined(function (pair) { return pair[1] !== null; })
          .x(function (pair) { return xSpread(pair[0]); }).y(function (pair) { return ys(pair[1]); }));
      frame.svg.append("line").attr("x1", m.l).attr("x2", width - m.r)
        .attr("y1", sZero).attr("y2", sZero)
        .attr("stroke", C.border).attr("stroke-width", 1);
      frame.svg.append("text").attr("x", width - m.r).attr("y", bottomTop + 10).attr("text-anchor", "end")
        .attr("fill", C.muted).attr("font-size", 8.5).attr("font-family", MONO)
        .text("spread · " + (data.spread_unit || "bps"));

      var bisect = d3.bisector(function (item) { return item.m; }).center;
      overlay(frame.svg, { width: width, height: height }, { t: bottomTop, b: m.b, l: m.l, r: m.r }, function (px, event) {
        var item = spread[bisect(spread, xSpread.invert(px))];
        if (!item) return;
        tip.show(event, item.t, [["Spread", RV.signed(item.bps, 1) + " " + (data.spread_unit || "bps")]]);
      }, function () { tip.hide(); });
    }

    var bySeries = series.map(function (item) {
      var map = {};
      (item.minutes || []).forEach(function (minute, position) {
        map[minute] = num(item.pct[position]);
      });
      return { label: item.label, map: map };
    });
    var bisectTop = d3.bisector(function (value) { return value; }).center;
    var focus = frame.svg.append("g").style("display", "none");
    var rule = focus.append("line").attr("y1", m.t).attr("y2", topBottom)
      .attr("stroke", C.text).attr("stroke-opacity", 0.45).attr("stroke-dasharray", "3 3");
    overlay(frame.svg, { width: width, height: topBottom + m.b }, m, function (px, event) {
      var minute = x.invert(px);
      var base = series[0].minutes || [];
      var index = Math.min(base.length - 1, bisectTop(base, minute));
      var at = base[index];
      if (at === undefined) return;
      focus.style("display", null);
      rule.attr("x1", x(at)).attr("x2", x(at));
      var rows = bySeries.map(function (item) {
        var value = item.map.get(at);
        return [escapeHtml(item.label), value === null || value === undefined ? "—" : RV.signed(value, 2) + "%"];
      });
      tip.show(event, clockOf(at), rows);
    }, function () {
      focus.style("display", "none");
      tip.hide();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 10. price / OI quadrants                                           */
  /* ------------------------------------------------------------------ */
  function quadrants(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var points = data.points || [];
    var categories = {};
    (data.categories || []).forEach(function (item) { categories[item.id] = item; });
    var valid = points.filter(function (point) { return num(point.dp) !== null && num(point.doi) !== null; });
    if (!valid.length) return empty(host, "No buckets have both Δprice and ΔOI.");
    var frame = openFrame(host);
    var m = margins(frame.width, 22, 26);
    var width = frame.width, height = frame.height;
    var domain = data.domain || {};
    var x = d3.scaleLinear().domain(domain.doi || [-1, 1]).range([m.l, width - m.r]);
    var y = d3.scaleLinear().domain(domain.dp || [-1, 1]).range([height - m.b, m.t]);

    grid(frame.svg, y, frame, m, m.narrow ? 4 : 5);
    yAxis(frame.svg, y, frame, m, function (value) { return RV.signed(value, 0); }, m.narrow ? 4 : 5);
    var axis = frame.svg.append("g").attr("transform", "translate(0," + (height - m.b) + ")")
      .call(d3.axisBottom(x).ticks(m.narrow ? 4 : 6).tickFormat(function (value) {
        var abs = Math.abs(value);
        if (abs >= 1e6) return RV.signed(value / 1e6, 1) + "M";
        if (abs >= 1e3) return RV.signed(value / 1e3, 0) + "k";
        return RV.signed(value, 0);
      }).tickSizeOuter(0));
    styleAxis(axis, m.narrow);
    corner(frame, m, "Δ open interest · " + (spec.oi_unit || ""), C.muted);
    var xZero = x(0), yZero = y(0);
    frame.svg.append("line").attr("x1", xZero).attr("x2", xZero).attr("y1", m.t).attr("y2", height - m.b)
      .attr("stroke", C.muted).attr("stroke-opacity", 0.5).attr("stroke-dasharray", "3 3");
    frame.svg.append("line").attr("x1", m.l).attr("x2", width - m.r).attr("y1", yZero).attr("y2", yZero)
      .attr("stroke", C.muted).attr("stroke-opacity", 0.5).attr("stroke-dasharray", "3 3");

    var corners = {
      long_buildup: [width - m.r, m.t, "right", "top"],
      short_buildup: [m.l, m.t, "left", "top"],
      long_unwinding: [m.l, height - m.b, "left", "bottom"],
      short_covering: [width - m.r, height - m.b, "right", "bottom"]
    };
    Object.keys(corners).forEach(function (id) {
      var info = corners[id];
      var category = categories[id];
      if (!category) return;
      frame.svg.append("text")
        .attr("x", info[0]).attr("y", info[1] + (info[3] === "top" ? 13 : -6))
        .attr("text-anchor", info[2])
        .attr("fill", tone(category.tone)).attr("font-size", 9).attr("font-family", MONO)
        .attr("fill-opacity", 0.85)
        .text(category.label);
    });

    var volumes = valid.map(function (point) { return num(point.volume); }).filter(function (value) { return value !== null; });
    var maxVolume = volumes.length ? Math.max.apply(null, volumes) : 1;
    valid.forEach(function (point) {
      var category = categories[point.regime] || { tone: "muted" };
      var volume = num(point.volume);
      var radius = volume === null ? 5 : 4 + Math.min(8, 8 * Math.sqrt(volume / Math.max(1, maxVolume)));
      frame.svg.append("circle")
        .attr("cx", x(num(point.doi))).attr("cy", y(num(point.dp))).attr("r", radius)
        .attr("fill", tone(category.tone)).attr("fill-opacity", 0.8)
        .attr("stroke", C.bg).attr("stroke-width", 1)
        .style("cursor", "crosshair")
        .on("mousemove", function (event) {
          tip.show(event, escapeHtml(point.label), [
            ["Δ price", pointText(point.dp, spec)],
            ["Δ OI", RV.signed(point.doi, 0)],
            ["Volume", volume === null ? "—" : RV.fmt(volume, 0)],
            ["Regime", band((category.label || point.regime))]
          ]);
        })
        .on("mouseleave", function () { tip.hide(); });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 11. event study                                                    */
  /* ------------------------------------------------------------------ */
  function events(host, payload) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var items = data.events || [];
    if (!items.length) return empty(host, "No events in the payload.");
    var width = Math.max(300, host.clientWidth || 640);
    var cols = items.length > 1 ? 2 : 1;
    var gap = 8;
    var cellWidth = Math.max(150, Math.floor((width - (cols - 1) * gap) / cols));
    var cellHeight = width < 520 ? 132 : 164;
    host.innerHTML = "";
    if (items.length > 4 && cols > 1) host.style.overflowY = "auto";
    var wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0,1fr))";
    wrap.style.gap = gap + "px";
    host.appendChild(wrap);
    var window = data.window || [-30, 30];

    items.forEach(function (item) {
      var cell = document.createElement("div");
      cell.style.minWidth = "0";
      wrap.appendChild(cell);
      var values = [];
      (item.path || []).forEach(function (point) { if (num(point.value) !== null) values.push(num(point.value)); });
      values.push(0);
      var low = Math.min.apply(null, values), high = Math.max.apply(null, values);
      var pad = Math.max(1, (high - low) * 0.12);
      var svg = cellFrame(cell, cellWidth, cellHeight);
      var m = { t: 16, r: 8, b: 18, l: 30 };
      var innerW = cellWidth - m.l - m.r;
      var innerH = cellHeight - m.t - m.b;
      var x = d3.scaleLinear().domain(window).range([0, innerW]);
      var y = d3.scaleLinear().domain([low - pad, high + pad]).range([innerH, 0]);
      var root = svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

      var tickValues = [window[0], 0, window[1]];
      root.append("g").attr("transform", "translate(0," + innerH + ")")
        .call(d3.axisBottom(x).tickValues(tickValues).tickFormat(function (value) {
          return value > 0 ? "+" + value : String(value);
        }).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, true); });
      root.append("g").call(d3.axisLeft(y).ticks(3).tickFormat(function (value) { return RV.signed(value, 0); }).tickSizeOuter(0))
        .call(function (group) { styleAxis(group, true); });

      var positive = num(item.move) === null ? true : num(item.move) >= 0;
      var shadeStart = x(Math.max(window[0], 0));
      var shadeEnd = x(Math.min(window[1], Math.max(0, item.duration || 0)));
      root.append("rect")
        .attr("x", shadeStart).attr("y", 0)
        .attr("width", Math.max(1, shadeEnd - shadeStart)).attr("height", innerH)
        .attr("fill", C.raised).attr("fill-opacity", 0.55);
      root.append("line").attr("x1", 0).attr("x2", innerW).attr("y1", y(0)).attr("y2", y(0))
        .attr("stroke", C.muted).attr("stroke-opacity", 0.55);

      root.append("path")
        .datum((item.path || []).map(function (point) { return [point.offset, num(point.value)]; }))
        .attr("fill", "none")
        .attr("stroke", positive ? C.green : C.red)
        .attr("stroke-width", 1.4)
        .attr("stroke-linejoin", "round")
        .attr("d", d3.line()
          .defined(function (pair) { return pair[1] !== null; })
          .x(function (pair) { return x(pair[0]); }).y(function (pair) { return y(pair[1]); }));

      svg.append("text").attr("x", m.l).attr("y", 11)
        .attr("fill", C.text).attr("font-size", 8.5).attr("font-weight", 600).attr("font-family", MONO)
        .text(item.id + " · " + (item.start && item.end ? item.start + "–" + item.end : item.label));
      if (num(item.move) !== null) {
        svg.append("text").attr("x", m.l + innerW + m.r).attr("y", 11).attr("text-anchor", "end")
          .attr("fill", positive ? C.green : C.red).attr("font-size", 8.5).attr("font-family", MONO)
          .text(RV.signed(item.move, 1));
      }
    });
  }

  function chart(renderer) {
    return function (host, payload) {
      var tip = RV.tip();
      RV.onResize(host, function () {
        try {
          renderer(host, payload || {}, tip);
        } catch (err) {
          RV.error(host, err);
        }
      });
    };
  }

  RV.register("pe_premium_ribbon", chart(premiumRibbon));
  RV.register("smile_four_clocks", chart(smiles));
  RV.register("premium_vs_intrinsic", chart(premiumVsIntrinsic));
  RV.register("theta_decomposition", chart(thetaBars));
  RV.register("skew_rotation", chart(skew));
  RV.register("basis_regime_strip", chart(basisStrip));
  RV.register("lead_lag", chart(leadLag));
  RV.register("nifty_vs_sensex", chart(crossPaths));
  RV.register("futures_quadrants", chart(quadrants));
  RV.register("event_study", chart(events));
})();
