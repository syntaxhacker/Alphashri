/* Fundamentals tab — income / balance / cashflow, breakdown, earnings, seasonality, technicals.
 * Contract: window.UW.PANELS.fundamentals = { title, render(d) }.
 * d[key] may be an array, object, or {__error}. All access is guarded. */
(function () {
  const U = (window.UW = window.UW || {});
  U.PANELS = U.PANELS || {};
  const { esc, money, num, int, signCls, shortDate, table, card, kpiBig, hbars, bars, line, multi } = U.util;

  const NO = '<div class="muted" style="padding:6px">no data</div>';
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const err = (v) => (v && v.__error ? v : null);
  const S = (v) => (Array.isArray(v) ? v : []);
  const O = (v) => (v && typeof v === "object" && !Array.isArray(v) && !v.__error ? v : {});
  const first = (v) => (Array.isArray(v) ? v[0] : v) || {};
  const arr = (v) => (err(v) ? [] : S(v));
  const nzf = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const numOr = (v, d = 0) => (nzf(v) == null ? d : nzf(v));
  const pnum = (v) => {
    const n = nzf(v);
    if (n == null) return null;
    return Math.abs(n) <= 1.5 ? n * 100 : n; // fraction vs already-percent heuristic
  };
  const asPct = (v, d = 1) => {
    const n = pnum(v);
    return n == null ? "–" : n.toFixed(d) + "%";
  };
  const big = (v) => (nzf(v) == null ? "–" : money(nzf(v)));
  const mon = (m) => MON[(Number(m) || 1) - 1] || "M" + m;
  const pretty = (k) => String(k).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const kv = (pairs) =>
    pairs.length
      ? `<div class="kv">${pairs.map((p) => `<div><span>${esc(p[0])}</span><b>${p[1]}</b></div>`).join("")}</div>`
      : NO;
  const block = (title, body) => `<div class="gex"><div class="t">${esc(title)}</div>${body}</div>`;

  // Flat array with nested financials fallback.
  function pick(d, flatKey, nestedKey) {
    const a = arr(d[flatKey]);
    if (a.length) return a;
    return arr(O(d.financials)[nestedKey]);
  }

  U.PANELS.fundamentals = {
    title: "Fundamentals",
    render(d) {
      d = d || {};

      const income = pick(d, "income", "income_statements");
      const balance = pick(d, "balance", "balance_sheets");
      const cashflow = pick(d, "cashflow", "cash_flows");
      const eh = pick(d, "earnings_history", "earnings");
      const fb = O(d.fundamental_breakdown);
      const earn = arr(d.earnings);
      const sm = arr(d.seasonality_monthly).slice().sort((a, b) => numOr(a.month) - numOr(b.month));
      const ym = arr(d.seasonality_year_month);

      /* ---- 1. Income: revenue vs net income + margins + table ---- */
      const incChrono = income.slice(0, 12).slice().reverse();
      const incChart = income.length
        ? multi(
            [
              { name: "Revenue", color: "#3b82f6", data: incChrono.map((r) => numOr(r.total_revenue)) },
              { name: "Net income", color: "#16a34a", data: incChrono.map((r) => numOr(r.net_income)) },
            ],
            { height: 150 }
          )
        : NO;
      const li = income[0] || {};
      const rev = nzf(li.total_revenue);
      const margin = (x) => (rev ? ((nzf(x) || 0) / rev) * 100 : null);
      const incKpis =
        `<div class="kpis">` +
        kpiBig("Revenue", big(li.total_revenue), esc(li.report_type || "")) +
        kpiBig("Gross margin", rev ? (margin(li.gross_profit)).toFixed(1) + "%" : "–") +
        kpiBig("Op margin", rev ? (margin(li.operating_income)).toFixed(1) + "%" : "–") +
        kpiBig("Net margin", rev ? (margin(li.net_income)).toFixed(1) + "%" : "–", "", signCls(li.net_income)) +
        `</div>`;
      const incRows = income.slice(0, 10);
      const incMaxRev = Math.max(0, ...incRows.map((r) => Math.abs(numOr(r.total_revenue))));
      const incTbl = table(
        [
          { label: "Period" },
          { label: "Revenue", num: true },
          { label: "Gross", num: true },
          { label: "Op inc", num: true },
          { label: "Net inc", num: true },
        ],
        income.slice(0, 10),
        (r) =>
          `<tr><td>${esc(r.fiscal_date_ending || r.report_date || "")}</td><td class="num" style="background:${U.heat(numOr(r.total_revenue), incMaxRev)}">${big(r.total_revenue)}</td><td class="num ${signCls(r.gross_profit)}">${big(r.gross_profit)}</td><td class="num ${signCls(r.operating_income)}">${big(r.operating_income)}</td><td class="num ${signCls(r.net_income)}">${big(r.net_income)}</td></tr>`
      );

      /* ---- 2. Balance sheet: latest KPIs + key lines ---- */
      const lb = balance[0] || {};
      const balKpis =
        `<div class="kpis">` +
        kpiBig("Assets", big(lb.total_assets)) +
        kpiBig("Liabilities", big(lb.total_liabilities)) +
        kpiBig("Equity", big(lb.total_shareholder_equity)) +
        kpiBig("Cash", big(lb.cash_and_cash_equivalents)) +
        kpiBig("Debt", big(lb.short_long_term_debt_total != null ? lb.short_long_term_debt_total : lb.long_term_debt)) +
        kpiBig("Inventory", big(lb.inventory)) +
        `</div>`;
      const balRows = balance.slice(0, 10);
      const balMaxA = Math.max(0, ...balRows.map((r) => Math.abs(numOr(r.total_assets))));
      const balTbl = table(
        [
          { label: "Period" },
          { label: "Assets", num: true },
          { label: "Liabilities", num: true },
          { label: "Equity", num: true },
          { label: "Cash", num: true },
          { label: "Debt", num: true },
        ],
        balance.slice(0, 10),
        (r) => {
          const debt = r.short_long_term_debt_total != null ? r.short_long_term_debt_total : r.long_term_debt;
          return `<tr><td>${esc(r.fiscal_date_ending || "")}</td><td class="num" style="background:${U.heat(numOr(r.total_assets), balMaxA)}">${big(r.total_assets)}</td><td class="num">${big(r.total_liabilities)}</td><td class="num">${big(r.total_shareholder_equity)}</td><td class="num">${big(r.cash_and_cash_equivalents)}</td><td class="num">${big(debt)}</td></tr>`;
        }
      );

      /* ---- 3. Cash flow: latest KPIs + key lines ---- */
      const lc = cashflow[0] || {};
      const cfKpis =
        `<div class="kpis">` +
        kpiBig("Operating", big(lc.operating_cashflow), "", signCls(lc.operating_cashflow)) +
        kpiBig("Investing", big(lc.cashflow_from_investment), "", signCls(lc.cashflow_from_investment)) +
        kpiBig("Financing", big(lc.cashflow_from_financing), "", signCls(lc.cashflow_from_financing)) +
        kpiBig("Capex", big(lc.capital_expenditures)) +
        kpiBig("SBC", big(lc.stock_based_compensation)) +
        kpiBig("Δ Cash", big(lc.change_in_cash_and_cash_equivalents), "", signCls(lc.change_in_cash_and_cash_equivalents)) +
        `</div>`;
      const cfRows = cashflow.slice(0, 10);
      const cfMaxOp = Math.max(0, ...cfRows.map((r) => Math.abs(numOr(r.operating_cashflow))));
      const cfTbl = table(
        [
          { label: "Period" },
          { label: "Operating", num: true },
          { label: "Investing", num: true },
          { label: "Financing", num: true },
          { label: "Capex", num: true },
          { label: "SBC", num: true },
          { label: "Δ Cash", num: true },
        ],
        cashflow.slice(0, 10),
        (r) =>
          `<tr><td>${esc(r.fiscal_date_ending || "")}</td><td class="num ${signCls(r.operating_cashflow)}" style="background:${U.heat(numOr(r.operating_cashflow), cfMaxOp)}">${big(r.operating_cashflow)}</td><td class="num ${signCls(r.cashflow_from_investment)}">${big(r.cashflow_from_investment)}</td><td class="num ${signCls(r.cashflow_from_financing)}">${big(r.cashflow_from_financing)}</td><td class="num ${signCls(r.capital_expenditures)}">${big(r.capital_expenditures)}</td><td class="num">${big(r.stock_based_compensation)}</td><td class="num ${signCls(r.change_in_cash_and_cash_equivalents)}">${big(r.change_in_cash_and_cash_equivalents)}</td></tr>`
      );

      /* ---- 4. Fundamental breakdown · general ---- */
      const gen = first(fb.general);
      const skip = /unique_identifier|ticker|report|inserted|updated|fiscal|currency|date|id$/i;
      const genPairs = Object.entries(O(gen))
        .filter((p) => !skip.test(p[0]) && nzf(p[1]) != null)
        .slice(0, 18)
        .map((p) => [pretty(p[0]), big(p[1])]);

      /* ---- 5. Revenue breakdown (by product / geography) ---- */
      function flattenRb(rb, depth) {
        const out = [];
        if (depth > 2 || rb == null) return out;
        if (Array.isArray(rb)) {
          rb.forEach((row) => {
            const o = O(row);
            const label =
              o.name || o.label || o.category || o.segment || o.product || o.geography || o.region || o.type || o.breakdown || o.description;
            const val = o.revenue != null ? o.revenue : o.value != null ? o.value : o.amount != null ? o.amount : o.sales != null ? o.sales : o.percentage != null ? o.percentage : o.pct != null ? o.pct : o.rev;
            if (label != null && nzf(val) != null) out.push({ label: String(label), value: nzf(val) });
            else if (label != null && val && typeof val === "object") out.push(...flattenRb(val, depth + 1).map((x) => ({ label: String(label) + " · " + x.label, value: x.value })));
          });
        } else if (typeof rb === "object") {
          Object.entries(rb).forEach(([k, v]) => {
            if (nzf(v) != null) out.push({ label: k, value: nzf(v) });
            else if (v && typeof v === "object") out.push(...flattenRb(v, depth + 1).map((x) => ({ label: k + " · " + x.label, value: x.value })));
          });
        }
        return out;
      }
      const rbItems = flattenRb(fb.rev_breakdown, 0)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 14)
        .map((x) => ({ label: x.label, value: x.value, right: big(x.value) }));

      /* ---- 6. Earnings (estimates / actuals / post move) ---- */
      const earnChrono = earn
        .filter((r) => nzf(r.post_earnings_move_1d) != null)
        .slice(0, 12)
        .reverse();
      const earnBars = earnChrono.length
        ? bars(
            earnChrono.map((r) => ({ label: shortDate(r.report_date), value: pnum(r.post_earnings_move_1d) })),
            { height: 120 }
          )
        : NO;
      const earnRows = earn.slice(0, 12);
      const earnMaxAct = Math.max(0, ...earnRows.map((r) => Math.abs(numOr(r.actual_eps))));
      const earnTbl = table(
        [
          { label: "Report" },
          { label: "Time" },
          { label: "Exp move", num: true },
          { label: "Est EPS", num: true },
          { label: "Actual", num: true },
          { label: "1d", num: true },
          { label: "1w", num: true },
        ],
        earn.slice(0, 12),
        (r) =>
          `<tr><td>${esc(r.report_date || "")}</td><td class="muted">${esc(r.report_time || "")}</td><td class="num">${asPct(r.expected_move_perc)}</td><td class="num">${num(r.street_mean_est)}</td><td class="num ${signCls(r.actual_eps)}" style="background:${U.heat(numOr(r.actual_eps), earnMaxAct)}">${num(r.actual_eps)}</td><td class="num ${signCls(r.post_earnings_move_1d)}">${asPct(r.post_earnings_move_1d)}</td><td class="num ${signCls(r.post_earnings_move_1w)}">${asPct(r.post_earnings_move_1w)}</td></tr>`
      );

      /* ---- 7. EPS surprises ---- */
      const ehRows = eh.filter((r) => nzf(r.surprise_percentage) != null).slice(0, 12);
      const ehMaxRep = Math.max(0, ...ehRows.map((r) => Math.abs(numOr(r.reported_eps))));
      const ehBars = ehRows.length
        ? bars(
            ehRows
              .slice()
              .reverse()
              .map((r) => ({ label: shortDate(r.report_date || r.fiscal_date_ending), value: pnum(r.surprise_percentage) })),
            { height: 120 }
          )
        : NO;
      const ehTbl = table(
        [
          { label: "FQ ended" },
          { label: "Report" },
          { label: "Est", num: true },
          { label: "Actual", num: true },
          { label: "Surprise", num: true },
          { label: "Surp %", num: true },
        ],
        ehRows,
        (r) =>
          `<tr><td>${esc(r.fiscal_date_ending || "")}</td><td>${esc(r.report_date || "")}</td><td class="num muted">${num(r.estimated_eps)}</td><td class="num ${signCls(r.reported_eps)}" style="background:${U.heat(numOr(r.reported_eps), ehMaxRep)}">${num(r.reported_eps)}</td><td class="num ${signCls(r.surprise)}">${num(r.surprise)}</td><td class="num ${signCls(r.surprise_percentage)}">${asPct(r.surprise_percentage)}</td></tr>`
      );

      /* ---- 8. Seasonality monthly + year x month grid ---- */
      const smBars = sm.length
        ? bars(
            sm.map((r) => ({ label: mon(r.month), value: pnum(r.avg_change) })),
            { height: 130, labels: true }
          )
        : NO;
      const smMaxAvg = Math.max(0, ...sm.map((r) => Math.abs(pnum(r.avg_change) || 0)));
      const smTbl = table(
        [
          { label: "M" },
          { label: "Avg", num: true },
          { label: "Med", num: true },
          { label: "+ %", num: true },
          { label: "Yrs", num: true },
          { label: "Max", num: true },
          { label: "Min", num: true },
        ],
        sm,
        (r) =>
          `<tr><td>${esc(mon(r.month))}</td><td class="num ${signCls(r.avg_change)}" style="background:${U.heat(pnum(r.avg_change) || 0, smMaxAvg)}">${asPct(r.avg_change)}</td><td class="num ${signCls(r.median_change)}">${asPct(r.median_change)}</td><td class="num">${asPct(r.positive_months_perc, 0)}</td><td class="num">${int(r.years)}</td><td class="num pos">${asPct(r.max_change)}</td><td class="num neg">${asPct(r.min_change)}</td></tr>`
      );

      function ymGrid(rows) {
        if (!rows.length) return NO;
        const ymMax = Math.max(0, ...rows.map((r) => Math.abs(pnum(r.change) || 0)));
        const years = [...new Set(rows.map((r) => numOr(r.year)))].filter((y) => y > 0).sort((a, b) => b - a).slice(0, 6);
        const map = {};
        rows.forEach((r) => {
          map[numOr(r.year) + "-" + numOr(r.month)] = r;
        });
        const head = ["Yr"].concat(MON).map((h, i) => `<th class="${i ? "num" : ""}">${h}</th>`).join("");
        const body = years
          .map((y) => {
            const cells = MON.map((_, i) => {
              const r = map[y + "-" + (i + 1)];
              if (!r) return `<td class="num muted">·</td>`;
              const v = pnum(r.change);
              return `<td class="num ${signCls(v)}" style="background:${U.heat(v || 0, ymMax)}">${v == null ? "–" : v.toFixed(1)}</td>`;
            }).join("");
            return `<tr><td>${y}</td>${cells}</tr>`;
          })
          .join("");
        return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
      }
      const ymBody = ymGrid(ym);

      /* ---- 9. Technicals: RSI / MACD / Hist / SMA50 ---- */
      const rsiVals = arr(d.rsi)
        .slice(-120)
        .map((r) => nzf(O(r.values).RSI))
        .filter((v) => v != null);
      const rsiChart = rsiVals.length
        ? multi(
            [
              { name: "RSI", color: "#3b82f6", data: rsiVals },
              { name: "70", color: "#dc2626", data: rsiVals.map(() => 70) },
              { name: "30", color: "#16a34a", data: rsiVals.map(() => 30) },
            ],
            { height: 130 }
          )
        : NO;
      const lastRsi = rsiVals.length ? rsiVals[rsiVals.length - 1] : null;

      const macdData = [];
      const sigData = [];
      arr(d.macd)
        .slice(-120)
        .forEach((r) => {
          const m = nzf(O(r.values).MACD);
          const s = nzf(O(r.values).MACD_Signal);
          if (m != null && s != null) {
            macdData.push(m);
            sigData.push(s);
          }
        });
      const macdChart = macdData.length
        ? multi(
            [
              { name: "MACD", color: "#3b82f6", data: macdData },
              { name: "Signal", color: "#f59e0b", data: sigData },
            ],
            { height: 130 }
          )
        : NO;
      const histVals = arr(d.macd)
        .slice(-120)
        .map((r) => nzf(O(r.values).MACD_Hist))
        .filter((v) => v != null);
      const histChart = histVals.length
        ? bars(
            histVals.slice(-60).map((v) => ({ label: "", value: v })),
            { height: 110 }
          )
        : NO;

      const smaVals = arr(d.sma50)
        .slice(-120)
        .map((r) => nzf(O(r.values).SMA))
        .filter((v) => v != null);
      const smaChart = smaVals.length ? line(smaVals, { stroke: "#a855f7", height: 130 }) : NO;
      const lastSma = smaVals.length ? smaVals[smaVals.length - 1] : null;

      const techBody =
        `<div class="kpis">` +
        kpiBig("RSI(14)", lastRsi == null ? "–" : num(lastRsi, 1), lastRsi == null ? "" : lastRsi >= 70 ? "overbought" : lastRsi <= 30 ? "oversold" : "neutral", lastRsi == null ? "" : lastRsi >= 70 ? "neg" : lastRsi <= 30 ? "pos" : "") +
        kpiBig("SMA(50)", lastSma == null ? "–" : num(lastSma, 2), "latest close") +
        kpiBig("MACD hist", histVals.length ? num(histVals[histVals.length - 1], 3) : "–", "", histVals.length ? signCls(histVals[histVals.length - 1]) : "") +
        `</div>` +
        `<div class="gex-grid">` +
        block("RSI(14)", rsiChart) +
        block("MACD", macdChart) +
        block("MACD histogram", histChart) +
        block("SMA(50)", smaChart) +
        `</div>`;

      return (
        card("Income · revenue vs net income", incKpis + incChart + incTbl, 2) +
        card("Balance sheet · key lines", balKpis + balTbl, 2) +
        card("Cash flow · key lines", cfKpis + cfTbl, 2) +
        card("Fundamental breakdown · general", kv(genPairs), 2) +
        card("Revenue breakdown", rbItems.length ? hbars(rbItems) : NO, 2) +
        card("Earnings · expected vs actual", earnBars + earnTbl, 2) +
        card("EPS surprises", ehBars + ehTbl, 2) +
        card("Seasonality · monthly + year × month", smBars + smTbl + ymBody, 2) +
        card("Technicals · RSI / MACD / SMA50", techBody, 4)
      );
    },
    info: {
      title: "Fundamentals",
      tagline: "Statements, earnings history, seasonality and trend — quality check before trading the flow",
      sections: [
        {
          h: "What this tab shows",
          p: "<p>Whether the business behind the options flow is worth owning: <b>trailing statements</b>, where revenue comes from, how reliably it beats estimates, which calendar months pay, and whether trend/momentum confirms. Use it to filter flow ideas — strong flow on a deteriorating name is a rental, not a position.</p>",
        },
        {
          h: "Panels",
          p: "<ul><li><b>Income · revenue vs net income</b> — <code>total_revenue</code> vs <code>net_income</code> chart plus gross / operating / net margins from <code>gross_profit</code>, <code>operating_income</code>, <code>net_income</code> over <code>total_revenue</code>.</li><li><b>Balance sheet · key lines</b> — <code>total_assets</code>, <code>total_liabilities</code>, <code>total_shareholder_equity</code>, <code>cash_and_cash_equivalents</code>, <code>short_long_term_debt_total</code> (fallback <code>long_term_debt</code>), <code>inventory</code>.</li><li><b>Cash flow · key lines</b> — <code>operating_cashflow</code>, <code>cashflow_from_investment</code>, <code>cashflow_from_financing</code>, <code>capital_expenditures</code>, <code>stock_based_compensation</code>, <code>change_in_cash_and_cash_equivalents</code>.</li><li><b>Fundamental breakdown · general</b> — latest <code>general</code> row (R&D, goodwill, gross profit and similar numeric lines).</li><li><b>Revenue breakdown</b> — <code>rev_breakdown</code> by product / geography (<code>name</code>, <code>segment</code>, <code>region</code> × <code>revenue</code> / <code>value</code> / <code>amount</code>).</li><li><b>Earnings · expected vs actual</b> — <code>report_date</code>, <code>report_time</code>, <code>expected_move_perc</code>, <code>street_mean_est</code>, <code>actual_eps</code>, <code>post_earnings_move_1d</code> / <code>1w</code>.</li><li><b>EPS surprises</b> — <code>estimated_eps</code> vs <code>reported_eps</code>, <code>surprise</code>, <code>surprise_percentage</code>.</li><li><b>Seasonality · monthly + year × month</b> — <code>avg_change</code>, <code>median_change</code>, <code>positive_months_perc</code>, <code>years</code>, <code>max_change</code> / <code>min_change</code> per month plus the year × month <code>change</code> grid.</li><li><b>Technicals · RSI / MACD / SMA50</b> — <code>RSI</code> with 70/30 bands, <code>MACD</code> vs <code>MACD_Signal</code> plus <code>MACD_Hist</code>, and <code>SMA</code>(50) trend.</li></ul>",
        },
        {
          h: "How to read it",
          p: "<p><b>Quality first:</b> expanding revenue with stable-or-rising net margin and operating cash flow covering capex is a hold candidate; revenue up but cash flow flat means earnings quality is weak. <b>Earnings:</b> repeated positive <code>surprise_percentage</code> with small <code>post_earnings_move_1d</code> signals drift — buy the quiet beat. <b>Seasonality + trend:</b> only lean into a strong month when RSI is 50–70, MACD histogram is positive and price holds above SMA50.</p>",
        },
        {
          h: "Worked example",
          p: "<pre>NVDA  revenue $68.1B  net margin 55.2%  op cash flow +$22.4B vs capex $4.1B\nEPS: est $2.31 vs actual $2.47 (+6.9%), next-day move +1.2% (muted)\nSeasonality: Nov avg +4.1%, positive 74% over 19 yrs; RSI 62, MACD hist +, price > SMA50\nDecision: quality + quiet beat + tailwind month + uptrend align — sell the $215 Nov put spread\nfor premium and buy stock on a hold above SMA50; skip chasing calls into overbought RSI > 75.</pre>",
        },
        {
          h: "Endpoints used",
          p: "<p><code>/stock/{t}/income-statements</code> <code>/balance-sheets</code> <code>/cash-flows</code> <code>/financials</code> (fallback) <code>/fundamental-breakdown</code> <code>/earnings/{t}</code> <code>/stock/{t}/earnings</code> <code>/seasonality/{t}/monthly</code> <code>/seasonality/{t}/year-month</code> <code>/technical-indicator/rsi</code> <code>/macd</code> <code>/sma50</code>.</p>",
        },
        {
          h: "Caveats",
          p: "<ul><li>All statement, earnings and seasonality rows are <b>newest-first</b>; charts re-chronologise internally — do not assume row 0 is oldest.</li><li>Percent-looking values under 1.5 are treated as fractions (×100); already-percent values pass through, so verify against the raw field on odd prints.</li><li>The Advanced+ <b>profile / dividends / splits / forward estimates</b> endpoints are gated on this token — missing <code>general</code> lines or blank estimates mean gated, not zero.</li><li>Technicals use the last ~120 points only; thin history makes RSI/SMA50 noisy.</li></ul>",
        },
      ],
    },
  };
})();
