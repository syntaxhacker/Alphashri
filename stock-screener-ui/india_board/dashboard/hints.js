/* Plain-English explanations shown on every card, toggled by the "Explain"
 * button in the header (persisted in localStorage).
 *
 * Keys are matched against the card title by prefix, so a key like
 * "Highest call OI" also covers "Highest call OI · top 8".
 * HTML tags / entities in titles are stripped before matching.
 */
(function () {
  const U = (window.UW = window.UW || {});

  const HINTS = [
    // ---- Home ------------------------------------------------------------
    ["Indices", "NSE headline indices (<b>NIFTY 50</b>, <b>BANKNIFTY</b>, …) with spot in <b>₹</b> and the day % move. <b>Click any ticker to drill into its symbol view.</b> NSE trades Mon–Fri 09:15–15:30 IST — on Saturdays, Sundays and holidays there is no live session, so this card shows the last session's close (usually Friday's)."],
    ["Highest call OI", "Tickers ranked by <b>highest call open-interest strike</b> — where call writers are stacked up. Heavy call OI above spot tends to act as <b>resistance</b> (writers defend their strikes). <b>PCR</b> is heat-tinted: pale near 1.0 is neutral, strong colour is extreme positioning. <b>Click any ticker to drill in.</b>"],
    ["Highest put OI", "Tickers ranked by <b>highest put open-interest strike</b> — where put writers are stacked up. Heavy put OI below spot tends to act as <b>support</b>. <b>Click any ticker to drill in.</b>"],

    // ---- Symbol view -----------------------------------------------------
    ["Quick read", "Auto-generated plain-English notes on what stands out for this ticker right now — key OI levels, the PCR read, and where today's positioning leans."],
    ["Key Stats", "The one-glance summary: <b>Last</b> price (₹), <b>Day %</b> move, <b>PCR</b>, <b>Max Pain</b> and volume vs history."],
    ["Price", "Candlestick chart of recent sessions in <b>₹</b>. <b>Green = up day, red = down day.</b> NSE session is 09:15–15:30 IST."],
    ["Intraday", "Today's intraday tape with <b>VWAP</b> (the session's volume-weighted average price — above it is bullish, below is bearish) plus the day's <b>support / resistance</b> lines."],
    ["Open Interest by Strike", "How many option contracts are open at each strike. Big <b>call OI above spot = resistance</b>; big <b>put OI below spot = support</b>. Writers defend these strikes into expiry."],
    ["Change in OI", "Fresh contracts added today (<b>change in open interest</b>). Rising OI with rising price = longs building (bullish); rising OI with falling price = shorts building (bearish). A big jump = fresh money entering."],
    ["PCR", "<b>Put-call ratio</b> (put OI ÷ call OI). Below ~0.7 is complacent-bullish, above ~1.3 is fearful — and at extremes it flips <b>contrarian</b> (too many puts can mark a bottom)."],
    ["Max Pain", "The strike where option buyers lose the most — the least pain for option writers. Price often drifts toward it into expiry. <b>Dist</b> = how far spot is from it."],
    ["Support", "Price levels where put writing / buying interest has historically held the fall — expected floors. A break below with volume turns support into resistance."],
    ["Resistance", "Price levels where call writing / selling pressure has historically capped the rise — expected ceilings. A break above with volume turns resistance into support."],
    ["OI Trend", "Daily end-of-day OI per strike for the top 10 strikes by latest OI — rising lines mean positions building there day after day. Toggle <b>Calls / Puts</b> to isolate each side."],
    ["Latest snapshot", "The most recent EOD OI snapshot per strike with <b>day-over-day change</b> — where positions grew or shrank since the previous session."],
    ["Volume", "Shares traded vs history. A <b>spike</b> means unusually heavy trading — usually news, results day, or a big move."],

    // ---- Futures tab -----------------------------------------------------
    ["Futures Curve", "Monthly <b>futures prices</b> vs spot in <b>₹</b>. <b>Basis</b> = future − spot: positive (contango) is normal — longs pay carry; a <b>discount</b> with weak volume warns of bearish carry. <b>Ann. basis</b> annualises that carry so expiries compare fairly. Fyers publishes <b>no futures OI</b>, so OI shows <b>–</b> and volume is the liquidity proxy."],
    ["Gamma Exposure", "Estimated dealer <b>gamma exposure (GEX)</b> per strike in <b>₹Cr per 1-pt move</b>: <b>green = dealers long gamma</b> (they fade moves → chop/pin), <b>red = dealers short gamma</b> (hedging amplifies moves → trend). IV is backed out of each leg's premium — an estimate, not a live dealer book."],
    ["OI by Expiry", "Options <b>open-interest totals</b> per expiry plus <b>futures volume bars</b> across monthly expiries. The Fyers chain covers the <b>near expiry only</b>, so the OI table is one row — the volume bars show where multi-expiry liquidity sits."],
    ["Key Levels", "Dealer levels from OI + GEX: the <b>call wall</b> (top call-OI strike above spot = resistance), <b>put wall</b> (top put-OI below spot = support), <b>gamma flip</b> (where net GEX changes sign = the bull/bear regime line), <b>magnet</b> (peak |GEX| strike = pin target) and <b>max pain</b>."],
    ["OI Flow", "Intraday OI build-up vs unwinding by strike, from <b>2-minute snapshots</b> taken during market hours and persisted to disk — drag the scrubber (or press ▶) to replay how interest moved through the session. Rising <b>CE ΔOI</b> above spot = fresh resistance writing; rising <b>PE ΔOI</b> below spot = fresh support writing. <b>Net Δ</b> (CE Δ − PE Δ) signs the pressure per strike."],
    ["intraday build-up", "Change since the first snapshot of the day: <b>positive</b> = fresh positions building, <b>negative</b> = square-offs unwinding. The <b>top 5 movers</b> by |ΔOI| are highlighted — that is where today's positioning battle is."],
    ["strike deltas", "Per-strike CE/PE OI with intraday deltas vs the day's first snapshot. <b>Net Δ = CE Δ − PE Δ</b>: positive leans call-writing pressure, negative leans put-writing pressure. <b>●</b> marks the top 5 strikes by |ΔOI|."],

    // ---- IV & Greeks tab -------------------------------------------------
    ["IV & Skew", "Implied-vol skew from the Fyers greeks: <b>ATM IV</b>, India VIX, <b>25Δ risk reversal</b> (put IV − call IV: positive = put skew/downside fear, negative = call skew) and <b>butterfly</b> (wings vs ATM). The CE/PE smile is drawn by strike when the endpoint returns per-strike IV; the ATM point is pinned on the curve."],
    ["Gamma Exposure by Strike", "Dealer <b>gamma exposure (GEX)</b> per strike: <b>green = dealers long gamma</b> (they fade moves → pin/chop), <b>red = short gamma</b> (hedging amplifies moves → trend). The levels row gives the <b>gamma flip</b> (regime line), <b>call wall</b> (resistance), <b>put wall</b> (support) and <b>magnet</b> (peak |GEX| pin). Gamma is the true Fyers per-leg gamma when available, else a BS back-solve — see the provenance line."],
    ["Term structure", "ATM IV for each expiry. Later expiries normally carry higher IV (<b>contango</b>); when the <b>front expiry is richer</b> (<b>backwardation</b>) the market is pricing near-term stress or event risk. The spread shown is next − front ATM IV."],
    ["IV rank", "<b>Variance risk premium</b> = IV − HV20: positive means options are rich to realised vol. Bands mirror the premium tracker (ratio ≥1.1 <b>EXPENSIVE</b>, ≤0.9 <b>CHEAP</b>). <b>IV rank / percentile</b> place today's IV inside its own history (100 = highest ever)."],

    // ---- Rollover & Basis tab -------------------------------------------
    ["Rollover %", "Per-strike <b>rollover %</b> = next-expiry OI ÷ (near + next). Bars above 50% mean that strike has mostly <b>rolled into the next series</b> — where the next expiry is being built."],
    ["Per-strike near", "Per-strike near-expiry vs next-expiry OI with the <b>OI shift</b> (next − near) — where positions are moving out. Top 20 strikes by next-expiry OI; all quantities in <b>shares</b>."],
    ["Rollover", "How much open interest has migrated from the <b>near expiry</b> to the <b>next</b>: cumulative rollover %, the CE/PE split, the classification (<b>rolling</b> above 50%, else <b>holding</b>) and the OI shift. Computed from the same near+next Fyers chains as the chart."],
    ["Basis", "<b>Basis</b> = front-futures price − spot. Positive (contango) is normal carry; a shrinking or negative basis alongside weak rollover warns of unwinding longs. <b>Ann. basis</b> annualises that carry so expiries compare fairly."],

    // ---- Home · market context ------------------------------------------
    ["Market context", "Market-wide <b>breadth</b> across the scanned NSE universe: how many names are advancing vs declining and the <b>% advancing</b> (heat-tinted). Top 5 gainers and bottom 5 losers by day % give a quick read on whether the move is broad or narrow. India VIX lives on each symbol's <b>IV &amp; Greeks</b> tab."],

    // ---- Home · smart money (NSE bulk/block deals) ----------------------
    ["Smart money · bulk deals", "The day's biggest <b>NSE bulk &amp; block deal disclosures</b> — the trades large clients are required to report. NSE publishes these at <b>end of day</b> (after ~18:00 IST on trading days), so this card is never live intraday. <b>Qualifying</b> = the deal cleared our value threshold; the client-type tag is a <b>heuristic name match</b>. Open the <b>Smart Money</b> tab on any symbol for the full feed."],
    ["Smart money", "Market-wide <b>NSE bulk &amp; block deal disclosures</b> — the trades big funds must report. The data is <b>end-of-day</b> (published after ~18:00 IST on trading days), so intraday this shows the <em>previous</em> session, never live prints. <b>Qualifying</b> deals clear a value threshold; the <b>client-type</b> tag (mutual fund, insurance, FPI …) and its confidence are <b>heuristic name matches, not exchange labels</b>. InvIT/ETF treasury deals are hidden by default because their notional distorts the value ranking."],

    // ---- Data notes ------------------------------------------------------
    ["Saturday", "NSE is shut on Saturdays, Sundays and exchange holidays. A weekend snapshot reuses <b>Friday's</b> closing OI/price data — nothing is live until Monday 09:15 IST."],
    ["Fyers", "Market data comes from <b>Fyers</b>. Quotes can lag the exchange by a few minutes on the free feed, and OI snapshots refresh a few times a day — not tick-by-tick."],
    ["Weekly expiry", "NSE index options expire <b>weekly</b> (NIFTY Tuesday, BANKNIFTY monthly-last-Thursday cycle) — pinning to <b>Max Pain</b> is strongest on expiry day."],
  ];

  // longest keys first so specific titles win over shorter prefixes
  HINTS.sort((a, b) => b[0].length - a[0].length);

  const clean = (s) =>
    String(s == null ? "" : s)
      .replace(/&amp;/g, "&")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();

  U.hintFor = function (title) {
    const t = clean(title);
    if (!t) return "";
    for (const [k, v] of HINTS) {
      if (t === k || t.startsWith(k)) return v;
    }
    return "";
  };

  U.EXPLAIN_KEY = "ib_explain";
  U.explainOn = () => localStorage.getItem(U.EXPLAIN_KEY) !== "0"; // default ON

  // ---- glossary ----------------------------------------------------------
  U.GLOSSARY = [
    ["Open interest (OI)", "Number of option contracts currently open at a strike/expiry. Big OI = writers are committed there, so the strike tends to act as support/resistance."],
    ["Change in OI", "Fresh contracts added (positive) or squared off (negative) today. Rising OI with rising price = long build-up (bullish); rising OI with falling price = short build-up (bearish)."],
    ["PCR", "<b>Put-call ratio</b> = put OI ÷ call OI. Low = bullish complacency, high = fear/hedging; extremes are often contrarian."],
    ["Max Pain", "The strike where option buyers lose the most money — writers' least pain. Price often drifts toward it into expiry."],
    ["Lot size", "NSE options trade in fixed <b>lots</b> (e.g. NIFTY 75 qty per lot) — you cannot buy a single contract. Premium quoted × lot size = your outlay."],
    ["Weekly expiry", "NSE index options expire weekly — positioning and pinning intensify on expiry day (NIFTY Tuesday). Stock options are monthly."],
    ["STT", "<b>Securities Transaction Tax</b> — charged on every trade (higher on exercised ITM options). It makes far-OTM lottery tickets structurally negative-expectancy."],
    ["Support / Resistance", "Support = floor where put OI / buying holds; Resistance = ceiling where call OI / selling caps. Breaks with volume flip their roles."],
    ["VWAP", "Volume-weighted average price of the session. Above VWAP = buyers in control; below = sellers. Intraday algos benchmark fills against it."],
    ["ATM / ITM / OTM", "At-the-money (strike ≈ spot), in-the-money (has intrinsic value), out-of-the-money (pure time value). Most NSE retail volume is OTM weeklies."],
    ["Strike / Expiry", "The price an option can be exercised at / the date it dies. Weekly index expiries decay brutally on the last day (theta)."],
    ["Circuit limit", "NSE's max daily move band per stock (2/5/10/20%). A stock locked at circuit cannot be traded through — option hedges break down."],
    ["F&O ban", "When a stock's OI crosses 95% of the market-wide limit, NSE bans fresh F&O positions — only square-offs allowed. Expect wild intraday swings."],
    ["Spot vs Futures", "Spot = cash-market price; futures trade at a premium/discount (basis). A wide discount with high roll cost warns of bearish carry."],
    ["Futures basis", "<b>Basis</b> = futures price − spot. Positive (contango) means longs pay carry; negative (backwardation/discount) means shorts pay. Annualised basis compares carry fairly across expiries."],
    ["Gamma exposure (GEX)", "How much dealers must hedge per 1-pt move. <b>Positive GEX</b> = dealers trade against the move (pin/chop between the walls); <b>negative GEX</b> = hedging chases the move (breakouts accelerate)."],
    ["Gamma flip", "The strike where net gamma exposure changes sign — the regime line. Holding above it stays compressed/bullish; losing it opens a fast move toward the put wall."],
    ["Call / Put wall", "Highest-OI strikes: the <b>call wall</b> above spot caps rallies (resistance), the <b>put wall</b> below spot cushions falls (support). Writers defend these into expiry."],
  ];

  U.renderGlossary = () =>
    U.GLOSSARY.map(([t, d]) => `<div class="gloss"><div class="gloss-t">${t}</div><div class="gloss-d">${d}</div></div>`).join("");
})();
