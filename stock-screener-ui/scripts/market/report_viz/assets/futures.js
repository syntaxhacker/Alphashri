/* Futures chart family: close/OI, basis, regime bands and volume.
 *
 * Every renderer consumes `payload.data` columns plus `payload.spec` for
 * currency, price decimals, OI unit and the session window.  `null` in the
 * data is a gap: lines break, bars are omitted, tooltips say "—".  Nothing is
 * substituted with zero.
 */
(function () {
  "use strict";

  var MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function minuteOf(label) {
    var match = /(\d{2}):(\d{2})/.exec(String(label == null ? "" : label));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function clock(minutes) {
    var value = Math.round(minutes);
    var hour = Math.floor(value / 60);
    var minute = ((value % 60) + 60) % 60;
    return (hour < 10 ? "0" : "") + hour + ":" + (minute < 10 ? "0" : "") + minute;
  }

  function compact(value) {
    var n = Math.abs(Number(value));
    if (!Number.isFinite(n)) return "—";
    if (n >= 1e9) return RV.fmt(value / 1e9, 2) + "B";
    if (n >= 1e6) return RV.fmt(value / 1e6, 2) + "M";
    if (n >= 1e3) return RV.fmt(value / 1e3, 1) + "k";
    return RV.fmt(value, 0);
  }

  function countText(value) {
    return value === null || value === undefined ? "—" : RV.fmt(value, 0);
  }

  function signedCount(value) {
    return value === null || value === undefined ? "—" : RV.signed(value, 0);
  }

  function pointText(value, spec) {
    if (value === null || value === undefined) return "—";
    return RV.signed(value, spec.price_decimals) + " pts";
  }

  function tone(toneName) {
    return RV.colors[toneName] || RV.colors.muted;
  }

  var REGIME_TONES = {
    long_buildup: "green",
    short_buildup: "red",
    long_unwinding: "amber",
    short_covering: "blue",
    neutral: "muted"
  };

  function categoryFor(data, id) {
    var list = data.categories || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return { id: id, label: String(id), tone: REGIME_TONES[id] || "muted" };
  }

  function open(host) {
    var width = host.clientWidth;
    if (!width) return null;
    var height = Math.max(180, (host.clientHeight || 300) - 10);
    var svg = RV.svg(host, height)
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img");
    return { svg: svg, width: width, height: height };
  }

  function empty(host, message) {
    host.innerHTML = '<div class="rv-empty" style="color:var(--rv-muted)">' + message + "</div>";
  }

  function margins(width, top, bottom) {
    return {
      t: top,
      r: width < 520 ? 44 : 62,
      b: bottom,
      l: width < 520 ? 44 : 56,
      narrow: width < 520
    };
  }

  function rowsFrom(data, fields) {
    var times = data.t || [];
    var rows = [];
    for (var i = 0; i < times.length; i++) {
      var minute = minuteOf(times[i]);
      if (minute === null) continue;
      var row = { t: times[i], m: minute };
      for (var f = 0; f < fields.length; f++) {
        var column = data[fields[f]];
        row[fields[f]] = column ? num(column[i]) : null;
      }
      rows.push(row);
    }
    return rows;
  }

  function styleAxis(group, narrow) {
    group.selectAll("text")
      .attr("fill", RV.colors.muted)
      .attr("font-size", narrow ? 9 : 10)
      .attr("font-family", MONO);
    group.selectAll("line").attr("stroke", RV.colors.border);
    group.select(".domain").attr("stroke", RV.colors.border);
  }

  function xScale(rows, width, m) {
    var lo = rows[0].m;
    var hi = rows[rows.length - 1].m;
    if (hi <= lo) hi = lo + 1;
    return d3.scaleLinear().domain([lo, hi]).range([m.l, width - m.r]);
  }

  function timeAxis(svg, x, rows, frame, m) {
    var limits = rows.map(function (row) { return row.t; });
    var ticks = RV.timeTicks(limits, m.narrow ? 4 : 8)
      .map(minuteOf)
      .filter(function (value) { return value !== null; });
    var unique = ticks.filter(function (value, index) {
      return ticks.indexOf(value) === index;
    });
    var group = svg.append("g")
      .attr("transform", "translate(0," + (frame.height - m.b) + ")")
      .call(
        d3.axisBottom(x)
          .tickValues(unique)
          .tickFormat(clock)
          .tickSizeOuter(0)
      );
    styleAxis(group, m.narrow);
  }

  function yAxis(svg, scale, side, frame, m, format, ticks) {
    var axis = side === "left" ? d3.axisLeft(scale) : d3.axisRight(scale);
    var group = svg.append("g")
      .attr("transform", side === "left" ? "translate(" + m.l + ",0)" : "translate(" + (frame.width - m.r) + ",0)")
      .call(axis.ticks(ticks).tickFormat(format).tickSizeOuter(0));
    styleAxis(group, m.narrow);
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
      .attr("stroke", RV.colors.border)
      .attr("stroke-opacity", 0.45);
  }

  function corner(svg, m, text, color, anchor) {
    var width = Number(svg.attr("width")) || 0;
    svg.append("text")
      .attr("x", anchor === "right" ? width - m.r : m.l)
      .attr("y", 10)
      .attr("text-anchor", anchor || "start")
      .attr("fill", color)
      .attr("font-size", 9)
      .attr("font-family", MONO)
      .text(text);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function dot(group, color) {
    return group.append("circle")
      .attr("r", 3.4)
      .attr("fill", color)
      .attr("stroke", RV.colors.bg)
      .attr("stroke-width", 1.4);
  }

  function gutterText(svg, frame, m, y, text, color) {
    svg.append("text")
      .attr("x", frame.width - m.r + 5)
      .attr("y", y + 3)
      .attr("fill", color)
      .attr("font-size", 9)
      .attr("font-family", MONO)
      .text(text);
  }

  /* ------------------------------------------------------------------ */
  /* 1. close + open interest                                           */
  /* ------------------------------------------------------------------ */
  function priceOi(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var rows = rowsFrom(data, ["close", "oi", "volume"]);
    if (!rows.length) return empty(host, "No futures rows in the payload.");

    var lastClose = null;
    var lastOi = null;
    rows.forEach(function (row) {
      row.dClose = row.close !== null && lastClose !== null ? row.close - lastClose : null;
      row.dOi = row.oi !== null && lastOi !== null ? row.oi - lastOi : null;
      if (row.close !== null) lastClose = row.close;
      if (row.oi !== null) lastOi = row.oi;
    });

    var frame = open(host);
    if (!frame) return;
    frame.svg.attr("aria-label", "Futures close and open interest over " + rows.length + " bars");
    var m = margins(frame.width, 18, 24);
    var closeRows = rows.filter(function (row) { return row.close !== null; });
    var oiRows = rows.filter(function (row) { return row.oi !== null; });
    if (!closeRows.length && !oiRows.length) {
      return empty(host, "No close or open-interest prints in the payload.");
    }

    var x = xScale(rows, frame.width, m);
    var pLo = closeRows.length ? d3.min(closeRows, function (row) { return row.close; }) : 0;
    var pHi = closeRows.length ? d3.max(closeRows, function (row) { return row.close; }) : 1;
    var pPad = Math.max((pHi - pLo) * 0.08, 0.5);
    var yPrice = d3.scaleLinear().domain([pLo - pPad, pHi + pPad]).range([frame.height - m.b, m.t]);
    var oLo = oiRows.length ? d3.min(oiRows, function (row) { return row.oi; }) : 0;
    var oHi = oiRows.length ? d3.max(oiRows, function (row) { return row.oi; }) : 1;
    var oPad = Math.max((oHi - oLo) * 0.08, 1);
    var yOi = d3.scaleLinear().domain([oLo - oPad, oHi + oPad]).range([frame.height - m.b, m.t]);

    grid(frame.svg, yPrice, frame, m, m.narrow ? 4 : 5);
    yAxis(frame.svg, yPrice, "left", frame, m, function (value) { return RV.fmt(value, 0); }, m.narrow ? 4 : 5);
    yAxis(frame.svg, yOi, "right", frame, m, compact, m.narrow ? 4 : 5);
    timeAxis(frame.svg, x, rows, frame, m);
    corner(frame.svg, m, "price", RV.colors.amber);
    corner(frame.svg, m, "OI", RV.colors.blue, "right");

    var lineClose = d3.line()
      .defined(function (row) { return row.close !== null; })
      .x(function (row) { return x(row.m); })
      .y(function (row) { return yPrice(row.close); });
    var lineOi = d3.line()
      .defined(function (row) { return row.oi !== null; })
      .x(function (row) { return x(row.m); })
      .y(function (row) { return yOi(row.oi); });

    frame.svg.append("path")
      .datum(rows)
      .attr("fill", "none")
      .attr("stroke", RV.colors.amber)
      .attr("stroke-width", m.narrow ? 1.3 : 1.6)
      .attr("stroke-linejoin", "round")
      .attr("d", lineClose);
    frame.svg.append("path")
      .datum(rows)
      .attr("fill", "none")
      .attr("stroke", RV.colors.blue)
      .attr("stroke-width", m.narrow ? 1.1 : 1.3)
      .attr("stroke-linejoin", "round")
      .attr("d", lineOi);

    var lastPrice = closeRows[closeRows.length - 1];
    var lastOpen = oiRows[oiRows.length - 1];
    if (lastPrice) {
      frame.svg.append("circle").attr("cx", x(lastPrice.m)).attr("cy", yPrice(lastPrice.close))
        .attr("r", 2.6).attr("fill", RV.colors.amber);
      gutterText(frame.svg, frame, m, yPrice(lastPrice.close), RV.fmt(lastPrice.close, 0), RV.colors.amber);
    }
    if (lastOpen) {
      frame.svg.append("circle").attr("cx", x(lastOpen.m)).attr("cy", yOi(lastOpen.oi))
        .attr("r", 2.6).attr("fill", RV.colors.blue);
      gutterText(frame.svg, frame, m, yOi(lastOpen.oi), compact(lastOpen.oi), RV.colors.blue);
    }

    var focus = frame.svg.append("g").style("display", "none");
    var rule = focus.append("line")
      .attr("y1", m.t).attr("y2", frame.height - m.b)
      .attr("stroke", RV.colors.text).attr("stroke-opacity", 0.5)
      .attr("stroke-dasharray", "3 3");
    var priceDot = dot(focus, RV.colors.amber);
    var oiDot = dot(focus, RV.colors.blue);
    var bisect = d3.bisector(function (row) { return row.m; }).center;

    overlay(frame.svg, frame, m, function (px, event) {
      var row = rows[bisect(rows, x.invert(px))];
      if (!row) return;
      focus.style("display", null);
      rule.attr("x1", x(row.m)).attr("x2", x(row.m));
      priceDot.style("display", row.close === null ? "none" : null)
        .attr("cx", x(row.m)).attr("cy", row.close === null ? 0 : yPrice(row.close));
      oiDot.style("display", row.oi === null ? "none" : null)
        .attr("cx", x(row.m)).attr("cy", row.oi === null ? 0 : yOi(row.oi));
      tip.show(event, row.t, [
        ["Futures", RV.money(spec, row.close)],
        ["Open interest", countText(row.oi) + (spec.oi_unit ? " " + spec.oi_unit : "")],
        ["OI change", signedCount(row.dOi)],
        ["Volume", countText(row.volume)],
        ["Price change", pointText(row.dClose, spec)]
      ]);
    }, function () {
      focus.style("display", "none");
      tip.hide();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 2. basis                                                           */
  /* ------------------------------------------------------------------ */
  var gradientSeq = 0;

  function basis(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var rows = rowsFrom(data, ["basis", "close", "spot"]);
    if (!rows.length) return empty(host, "No futures rows in the payload.");
    var valid = rows.filter(function (row) { return row.basis !== null; });
    if (!valid.length) return empty(host, "No basis points: every minute is missing a spot print.");

    var frame = open(host);
    if (!frame) return;
    frame.svg.attr("aria-label", "Futures basis in price points over " + rows.length + " bars");
    var m = margins(frame.width, 18, 24);
    var x = xScale(rows, frame.width, m);
    var low = d3.min(valid, function (row) { return row.basis; });
    var high = d3.max(valid, function (row) { return row.basis; });
    var span = Math.max(high - low, 1);
    var y = d3.scaleLinear()
      .domain([Math.min(0, low) - span * 0.1, Math.max(0, high) + span * 0.1])
      .range([frame.height - m.b, m.t]);
    var zero = y(0);

    grid(frame.svg, y, frame, m, m.narrow ? 4 : 5);
    yAxis(frame.svg, y, "left", frame, m, function (value) { return RV.signed(value, 0); }, m.narrow ? 4 : 5);
    timeAxis(frame.svg, x, rows, frame, m);
    corner(frame.svg, m, "basis · " + (data.unit || "pts"), RV.colors.green);

    var gradientId = "rv-basis-fill-" + gradientSeq++;
    var gradient = frame.svg.append("defs").append("linearGradient")
      .attr("id", gradientId)
      .attr("x1", "0").attr("x2", "0")
      .attr("y1", zero).attr("y2", m.t)
      .attr("gradientUnits", "userSpaceOnUse");
    gradient.append("stop").attr("offset", "0%").attr("stop-color", RV.colors.green).attr("stop-opacity", 0.3);
    gradient.append("stop").attr("offset", "100%").attr("stop-color", RV.colors.green).attr("stop-opacity", 0.03);

    var area = d3.area()
      .defined(function (row) { return row.basis !== null; })
      .x(function (row) { return x(row.m); })
      .y0(zero)
      .y1(function (row) { return y(row.basis); })
      .curve(d3.curveMonotoneX);
    var line = d3.line()
      .defined(function (row) { return row.basis !== null; })
      .x(function (row) { return x(row.m); })
      .y(function (row) { return y(row.basis); })
      .curve(d3.curveMonotoneX);

    frame.svg.append("path").datum(rows).attr("fill", "url(#" + gradientId + ")").attr("d", area);
    frame.svg.append("path").datum(rows).attr("fill", "none").attr("stroke", RV.colors.green)
      .attr("stroke-width", m.narrow ? 1.3 : 1.6).attr("stroke-linejoin", "round").attr("d", line);

    frame.svg.append("line")
      .attr("x1", m.l).attr("x2", frame.width - m.r)
      .attr("y1", zero).attr("y2", zero)
      .attr("stroke", RV.colors.muted).attr("stroke-opacity", 0.65);

    var stats = data.stats || {};
    if (stats.mean !== null && stats.mean !== undefined) {
      frame.svg.append("line")
        .attr("x1", m.l).attr("x2", frame.width - m.r)
        .attr("y1", y(stats.mean)).attr("y2", y(stats.mean))
        .attr("stroke", RV.colors.muted).attr("stroke-opacity", 0.55)
        .attr("stroke-dasharray", "2 4");
      if (!m.narrow) {
        corner(frame.svg, m, "mean " + RV.signed(stats.mean, spec.price_decimals), RV.colors.muted, "right");
      }
    }

    var last = valid[valid.length - 1];
    frame.svg.append("circle").attr("cx", x(last.m)).attr("cy", y(last.basis))
      .attr("r", 3).attr("fill", RV.colors.green).attr("stroke", RV.colors.bg).attr("stroke-width", 1.3);
    gutterText(frame.svg, frame, m, y(last.basis), RV.signed(last.basis, spec.price_decimals), RV.colors.green);

    var focus = frame.svg.append("g").style("display", "none");
    var rule = focus.append("line")
      .attr("y1", m.t).attr("y2", frame.height - m.b)
      .attr("stroke", RV.colors.text).attr("stroke-opacity", 0.55)
      .attr("stroke-dasharray", "3 3");
    var point = dot(focus, RV.colors.green);
    var bisect = d3.bisector(function (row) { return row.m; }).center;

    overlay(frame.svg, frame, m, function (px, event) {
      var row = rows[bisect(rows, x.invert(px))];
      if (!row) return;
      focus.style("display", null);
      rule.attr("x1", x(row.m)).attr("x2", x(row.m));
      point.style("display", row.basis === null ? "none" : null)
        .attr("cx", x(row.m)).attr("cy", row.basis === null ? 0 : y(row.basis));
      tip.show(event, row.t, [
        ["Futures", RV.money(spec, row.close)],
        ["Spot", RV.money(spec, row.spot)],
        ["Basis", pointText(row.basis, spec)],
        ["Spot print", row.spot === null ? "missing — gap" : "matched"]
      ]);
    }, function () {
      focus.style("display", "none");
      tip.hide();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 3. regime bands                                                    */
  /* ------------------------------------------------------------------ */
  function regimes(host, payload, tip) {
    var data = payload.data || {};
    var bands = (data.bands || []).filter(function (band) {
      return band && Number.isFinite(band.start_m) && Number.isFinite(band.end_m);
    });
    if (!bands.length) return empty(host, "No regime bands in the payload.");
    var spec = payload.spec || {};

    var frame = open(host);
    if (!frame) return;
    frame.svg.attr("aria-label", "Price and open interest regime bands over " + bands.length + " buckets");
    var m = margins(frame.width, 16, 24);
    var width = frame.width;
    var lo = d3.min(bands, function (band) { return Number(band.start_m); });
    var hi = d3.max(bands, function (band) { return Number(band.end_m); });
    if (hi <= lo) hi = lo + 1;
    var x = d3.scaleLinear().domain([lo, hi]).range([m.l, width - m.r]);
    var stripH = m.narrow ? 34 : 42;
    var stripY = Math.max(14, (frame.height - m.b - stripH) / 2);
    corner(frame.svg, m, "regime", RV.colors.muted);

    bands.forEach(function (band) {
      var category = categoryFor(data, band.regime);
      var x0 = x(Number(band.start_m));
      var x1 = x(Number(band.end_m));
      band.x0 = x0;
      band.x1 = x1;
      band.width = Math.max(1, x1 - x0 - 1);
      band.category = category;
    });

    var groups = frame.svg.append("g")
      .selectAll("g")
      .data(bands)
      .join("g")
      .attr("class", "rv-regime-band");

    groups.append("rect")
      .attr("x", function (band) { return band.x0 + 0.5; })
      .attr("y", stripY)
      .attr("width", function (band) { return band.width; })
      .attr("height", stripH)
      .attr("fill", function (band) { return tone(band.category.tone); })
      .attr("fill-opacity", function (band) {
        return band.regime === "neutral" ? 0.5 : 0.86;
      })
      .attr("stroke", RV.colors.bg)
      .attr("stroke-width", 1);

    var tickCount = m.narrow ? 4 : 7;
    var ticks = [];
    for (var i = 0; i < tickCount; i++) {
      ticks.push(Math.round(lo + ((hi - lo) * i) / (tickCount - 1)));
    }
    ticks = ticks.filter(function (value, index) {
      return ticks.indexOf(value) === index;
    });
    var axis = frame.svg.append("g")
      .attr("transform", "translate(0," + (frame.height - m.b) + ")")
      .call(d3.axisBottom(x).tickValues(ticks).tickFormat(clock).tickSizeOuter(0));
    styleAxis(axis, m.narrow);

    groups
      .on("mousemove", function (event, band) {
        var lines = [
          ["Regime", '<span style="color:' + tone(band.category.tone) + '">' + escapeHtml(band.category.label) + "</span>"],
          ["Price", RV.money(spec, band.from_price) + " → " + RV.money(spec, band.to_price)],
          ["Change", pointText(band.dp, spec)],
          ["OI change", signedCount(band.doi)],
          ["Volume", countText(band.volume)]
        ];
        tip.show(event, band.start + " → " + band.end, lines);
      })
      .on("mouseleave", function () { tip.hide(); });
  }

  /* ------------------------------------------------------------------ */
  /* 4. volume                                                          */
  /* ------------------------------------------------------------------ */
  function volume(host, payload, tip) {
    var spec = payload.spec || {};
    var data = payload.data || {};
    var rows = rowsFrom(data, ["volume", "close", "oi"]);
    if (!rows.length) return empty(host, "No futures rows in the payload.");
    var valid = rows.filter(function (row) { return row.volume !== null; });
    if (!valid.length) return empty(host, "No volume prints in the payload.");

    var lastClose = null;
    var lastOi = null;
    rows.forEach(function (row) {
      row.dClose = row.close !== null && lastClose !== null ? row.close - lastClose : null;
      row.dOi = row.oi !== null && lastOi !== null ? row.oi - lastOi : null;
      if (row.close !== null) lastClose = row.close;
      if (row.oi !== null) lastOi = row.oi;
    });

    var frame = open(host);
    if (!frame) return;
    frame.svg.attr("aria-label", "Futures volume per bar with the session peak highlighted");
    var m = margins(frame.width, 18, 24);
    var x = xScale(rows, frame.width, m);
    var peak = valid.reduce(function (best, row) {
      return row.volume > best.volume ? row : best;
    }, valid[0]);
    var maxVolume = Math.max(peak.volume, 1);
    var y = d3.scaleLinear().domain([0, maxVolume * 1.15]).range([frame.height - m.b, m.t]);

    grid(frame.svg, y, frame, m, m.narrow ? 4 : 5);
    yAxis(frame.svg, y, "left", frame, m, compact, m.narrow ? 4 : 5);
    timeAxis(frame.svg, x, rows, frame, m);
    corner(frame.svg, m, "volume · " + (spec.oi_unit || ""), RV.colors.amber);

    var lo = rows[0].m;
    var hi = rows[rows.length - 1].m;
    var pxPerMinute = (frame.width - m.l - m.r) / Math.max(1, hi - lo);
    var barWidth = Math.max(1, Math.min(14, pxPerMinute * 0.72));

    frame.svg.append("g")
      .selectAll("rect")
      .data(rows.filter(function (row) { return row.volume !== null; }))
      .join("rect")
      .attr("x", function (row) { return x(row.m) - barWidth / 2; })
      .attr("y", function (row) { return y(row.volume); })
      .attr("width", barWidth)
      .attr("height", function (row) { return Math.max(0, frame.height - m.b - y(row.volume)); })
      .attr("fill", function (row) { return row === peak ? RV.colors.amber : RV.colors.muted; })
      .attr("fill-opacity", function (row) { return row === peak ? 0.95 : 0.38; })
      .attr("stroke", function (row) { return row === peak ? RV.colors.text : "none"; })
      .attr("stroke-width", function (row) { return row === peak ? 0.8 : 0; });

    var peakLabel = countText(peak.volume);
    if (!m.narrow) {
      var labelX = x(peak.m) + 4;
      var anchor = "start";
      if (labelX > frame.width - m.r - 80) {
        labelX = x(peak.m) - 4;
        anchor = "end";
      }
      frame.svg.append("text")
        .attr("x", labelX)
        .attr("y", Math.max(m.t + 8, y(peak.volume) - 6))
        .attr("text-anchor", anchor)
        .attr("fill", RV.colors.amber)
        .attr("font-size", 9)
        .attr("font-family", MONO)
        .text(peak.t + " · " + peakLabel);
    }

    var focus = frame.svg.append("g").style("display", "none");
    var rule = focus.append("line")
      .attr("y1", m.t).attr("y2", frame.height - m.b)
      .attr("stroke", RV.colors.text).attr("stroke-opacity", 0.55)
      .attr("stroke-dasharray", "3 3");
    var point = dot(focus, RV.colors.amber);
    var bisect = d3.bisector(function (row) { return row.m; }).center;

    overlay(frame.svg, frame, m, function (px, event) {
      var row = rows[bisect(rows, x.invert(px))];
      if (!row) return;
      focus.style("display", null);
      rule.attr("x1", x(row.m)).attr("x2", x(row.m));
      point.style("display", row.volume === null ? "none" : null)
        .attr("cx", x(row.m)).attr("cy", row.volume === null ? 0 : y(row.volume));
      tip.show(event, row.t, [
        ["Volume", countText(row.volume)],
        ["Futures", RV.money(spec, row.close)],
        ["Price change", pointText(row.dClose, spec)],
        ["OI change", signedCount(row.dOi)]
      ]);
    }, function () {
      focus.style("display", "none");
      tip.hide();
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

  RV.register("futures_price_oi", chart(priceOi));
  RV.register("futures_basis", chart(basis));
  RV.register("futures_regimes", chart(regimes));
  RV.register("futures_volume", chart(volume));
})();
