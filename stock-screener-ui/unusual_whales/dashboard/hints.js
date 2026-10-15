/* Plain-English explanations shown on every card, toggled by the "Explain"
 * button in the header (persisted in localStorage).
 *
 * Keys are matched against the card title by prefix, so a key like
 * "Largest Dark Pool Prints" also covers "Largest Dark Pool Prints · 42 prints".
 * HTML tags / entities in titles are stripped before matching.
 */
(function () {
  const U = (window.UW = window.UW || {});

  const HINTS = [
    // ---- Timeline ----------------------------------------------------------
    ["Whale timeline", "Every strike-tick of the session plotted by <b>time</b> (ET), colored by <b>intent</b>: <span class='pos'>green = call-dominated (bullish)</span>, <span class='neg'>red = put-dominated (bearish)</span>, gray = two-sided noise. <b>Bright dots with white borders = whale-size premium (top 10%)</b>; dim dots = background drip. Hover any dot: the first line is the <b>verdict</b> (e.g. → Call SELLING on 100% bid-side), then call/put premium with ask%, volume, net and trade count."],
    ["Today at a glance", "Print counts for the session and where spot sits vs the gamma flip."],
    ["Net premium trend", "Running <b>directional</b> net premium through the session: <b>call premium − put premium</b>. Each side is already signed by ask−bid, so call buying adds and <b>put buying subtracts</b> (never add the two). The cyan line rising = <b>net call buying dominates (bullish)</b>; falling = net put buying dominates. The amber line is the underlying price on its own axis — read the two together: <b>price up while the line falls = distribution</b> (sellers into strength), <b>price down while the line rises = accumulation / absorbed selling</b>. The dashed zero line is neutral."],
    ["Biggest buys vs sells", "The largest <span class='pos'>call buys</span> vs <span class='neg'>put buys</span> of the session, with ⚡ marking sweeps."],
    ["Dark pool timeline", "Off-exchange (dark-pool) prints over time — institutional size hitting the tape."],
    ["Print log", "The most recent large option tickets, newest first, with strike, expiry, premium and ⚡ sweep flag."],

    // ---- Whales ------------------------------------------------------------
    ["Whale read", "Auto-generated plain-English read of where the big money is: the heaviest <b>dark-pool shelves</b>, the biggest single option ticket, the most one-sided strike, session net premium and the gamma regime."],
    ["Money map", "Net option premium per strike as a <b>diverging bar chart</b> — <span class='pos'>green bars = calls bought</span>, <span class='neg'>red bars = puts bought</span>. The longest bars are where the money concentrated."],
    ["Dark pool shelf", "Dark-pool <b>share volume by price</b>. The tallest bars are the shelves institutions traded at — these often act as support/resistance."],
    ["Biggest tickets", "The <b>largest single option trades</b> by premium, coloured call/put, with ⚡ marking sweeps (urgent, aggressive orders)."],
    ["New positions", "Contracts with the biggest jump in <b>open interest</b> — brand-new positions opened, i.e. fresh money."],
    ["Day OI change", "Net open-interest change per strike for the whole day (call Δ − put Δ). <span class='pos'>Green = net call positions opened</span> (bullish positioning), <span class='neg'>red = net put positions opened</span> (bearish/hedge positioning). Unlike premium, this counts <b>contracts</b> — where positioning flowed regardless of price."],
    ["Net premium by expiry", "Net premium per expiry date (<span class='pos'>green = calls</span>, <span class='neg'>red = puts</span>) — which expiry carries the bullish/bearish money."],
    ["Net premium · intraday", "Call vs put premium through the session — see when the money leaned bullish or bearish."],
    ["Key levels vs spot", "The levels price reacts to — <b>call wall</b>, <b>put wall</b>, <b>gamma flip</b>, <b>magnet</b>, <b>max pain</b> — each colour-coded with its distance from spot."],

    // ---- Intraday ----------------------------------------------------------
    ["Session read", "An auto-generated scorecard for today's session: <b>how many of our level/flow checks actually matched</b> the price action, with one plain-English line per check (✓/✗). Low score = the options map didn't describe the tape, so trust price over the levels."],
    ["Session map", "Today's 5-minute candles with <b>VWAP</b> (cyan) and the key levels as dashed lines: <b>open</b> (today's 09:30 price), <b>prev close</b> (yesterday's closing price), <b>gamma flip</b>, <b>call wall</b>, <b>put wall</b> and <b>magnet</b>. The ▲/▼ pins mark every time price crossed the gamma flip. Pan/zoom like a normal TradingView chart."],
    ["Open vs levels", "Where the session started and how it relates to the levels: opening price, gap vs yesterday's close, session range, which side of the gamma flip it opened, high/low and where VWAP finished."],
    ["Flip log", "Every time price crossed the <b>gamma flip</b> (dealer regime line) and every time it crossed <b>VWAP</b> (short-term momentum flip), with the time and direction."],
    ["Exit signals", "5-minute candles that <b>broke down</b> through VWAP: close at least <b>0.4% under VWAP on 2x median volume</b>, after trading above it. Opening-flush bars before 9:45 ET are ignored (VWAP is still forming). Marked with an amber ▼ on the session map — the mechanical 'get out of longs' print."],
    ["Intraday dealer gamma", "Dealers (the firms who sold the options everyone holds) must hedge with stock all day. This line is <b>how much stock they'd have to trade per 1% price move</b>, tracked through the session. <b>Positive &amp; rising = their hedging fights every move</b>, so expect a calm, choppy, pinning tape. <b>Negative or falling = their hedging feeds the move</b>, so breakouts/breakdowns can run further than they look. Steep drops into negative near the close often precede late-day swings."],
    ["Money by strike", "Net options premium per strike <b>today</b> — where the money actually went intraday (green = net call premium, red = net put)."],
    ["NOPE · intraday hedging", "Net Options Pricing Effect through the session — how much options hedging pressure is pushing the stock around."],

    // ---- Overview ----------------------------------------------------------
    ["Quick read", "Auto-generated plain-English notes on what stands out for this ticker right now — the key price levels, the volatility regime, and where today's options money is leaning."],
    ["Price · daily", "Candlestick chart of recent sessions. <b>Green = up day, red = down day.</b> The <b>delayed</b> badge means the free feed can lag the live header by ~15 min. Change the timeframe with the buttons on the chart (1D/5m/…)."],
    ["Key Stats", "The one-glance summary: <b>Last</b> price, <b>Day %</b> move, <b>IV</b> (implied volatility — how big a move options expect), <b>IV Rank</b> (where today's IV sits in its own past year: low = options cheap, high = expensive) and <b>volume</b> vs history."],
    ["Dealer Gamma Levels", "Price levels where option dealers' hedging tends to act like support/resistance. <b>Call wall</b> = likely ceiling, <b>put wall</b> = likely floor, <b>gamma flip</b> = the line where dealers stop calming the price and start amplifying moves, <b>magnet</b> = where price tends to get pinned."],
    ["Max Pain", "For each expiry, the strike where the most options would expire worthless — i.e. the least pain for option writers. Price often drifts toward it into expiry. <b>Dist</b> = how far today's price is from it."],
    ["Profile", "Basic facts: company name, sector, market cap, <b>beta</b> (how much it swings vs the market) and whether it has options."],
    ["Volume · daily (last 90d)", "Daily share volume for the last ~90 sessions. A <b>spike</b> means unusually heavy trading — usually news, an earnings day, or a big move."],
    ["IV Rank (1y)", "Where today's implied volatility sits within its own past year. <b>Low</b> = quiet/cheap options, <b>high</b> = nervous/expensive options."],
    ["Last Session", "Yesterday's options activity: how many calls vs puts traded, the <b>put/call ratio</b>, and whether call or put premium dominated (net call premium)."],

    // ---- Flow --------------------------------------------------------------
    ["Net Premium · intraday", "Net <b>call</b> premium (green) vs net <b>put</b> premium (red) by tick, both = ask-side − bid-side. Green above zero = calls bought (bullish); red above zero = puts bought (<b>bearish</b>). The <b>Net premium</b> KPI is <b>call − put</b> (above zero = net bullish money). Premium shown in $M; the chart is the full session."],
    ["Per-Expiry Volume", "Where options activity is concentrated by expiration date. <b>Net prem</b> = call premium − put premium: positive = net bullish bets, negative = net bearish."],
    ["Flow Alerts · largest premium", "The <b>biggest single option trades</b> today by premium paid. Flags matter: <b>sweep</b> = an urgent, aggressive order (often institutional), <b>multileg</b> = a spread, <b>opening</b> = new money."],
    ["Flow Tape · top prints", "The largest individual option prints by contract volume: strike, expiry, price, <b>delta</b> (direction), IV and the bid/ask it traded against."],
    ["Call vs Put · by strike", "How many calls vs puts traded at each strike. Bars lean <b>green where calls dominate</b> (bullish) and <b>red where puts dominate</b> (bearish) — shows where traders are positioned."],
    ["OI Change", "Contracts that gained the most <b>new open interest</b> today — i.e. brand-new positions being opened. A big jump = fresh money entering."],
    ["Greek Flow", "How much dealers must <b>buy or sell to stay hedged</b> as the stock moves (their 'delta flow'). <b>Positive = they buy into strength</b> (calms the move); <b>negative = they sell into strength</b> (adds fuel to the move). Vega flow is the same idea for volatility. Simple read: positive is calming, negative means moves can run further."],
    ["NOPE", "Net Options Pricing Effect — a 0–100 gauge of how much options hedging is <b>driving the stock around</b>. High = options are steering the price; low = ordinary trading is."],

    // ---- GEX / Greeks ------------------------------------------------------
    ["Dealer Gamma · daily (call vs put)", "The combined hedging footprint of option dealers — the firms short everyone else's options — split into calls (green) and puts (red), over time. Think of it as <b>how hard dealers must lean against price each day</b>. When the total is <b>positive, their hedging absorbs moves</b> (calm, range-bound tape); when it goes <b>negative, their hedging reinforces moves</b> (trends extend, reversals snap). Watch for the total crossing zero — that's a regime change."],
    ["Net GEX by Strike · top 20", "Net dealer hedging pressure at each strike — i.e. <b>where dealers would be forced to buy or sell the most stock</b> if price reaches that level. The tallest bars are where their reaction would be biggest, so price often stalls there: these act as <b>magnets or walls</b>."],
    ["GEX by Expiry", "Dealer hedging pressure grouped by expiration date. The <b>nearest expiry</b> dominates because its gamma is largest — that's the hedging that actually moves the stock <i>today</i>; far-dated gamma barely reacts to today's price."],
    ["Open Interest by Strike · call vs put", "How many contracts are open at each strike. Big <b>call OI above the price</b> = resistance; big <b>put OI below</b> = support."],
    ["Spot Gamma · intraday (γ / 1% move)", "How much stock dealers would need to trade <b>per 1% move, minute by minute</b>. <b>Rising</b> = their shock-absorber is getting bigger (calmer ahead); <b>falling toward or below zero</b> = the absorber is draining (volatility risk rising). Best read with price: gamma collapsing <i>while</i> price breaks a level is the classic fuel-for-the-move setup."],
    ["Spot Gamma Volume by Strike · call vs put", "Gamma-weighted volume per strike — which strikes are most 'active' for hedging right now."],
    ["Spot Exposures by Expiry / Strike · top charm OI", "<b>Charm</b> = how fast an option's delta decays with time. Big charm means hedging flows pick up as expiry approaches — often into the last hour."],

    // ---- Options -----------------------------------------------------------
    ["Contracts · top 40 by volume", "The most-traded option contracts today, with volume, open interest, IV and how far they are from the money."],
    ["ATM Chains", "The <b>at-the-money</b> call and put for nearby expiries — the market's cleanest read on the expected move."],
    ["Greeks by Strike", "The option Greeks at each strike: <b>delta</b> (direction), <b>gamma</b> (how fast delta changes), <b>theta</b> (time decay) and <b>vega</b> (volatility sensitivity)."],
    ["Open Interest by Strike", "Open contracts per strike — where the crowd has positioned. Peaks tend to act as support/resistance."],
    ["Open Interest by Expiry", "Open contracts per expiration date — shows where the biggest expiries (and pin risk) sit."],
    ["Expiry Breakdown", "Activity split by expiration: near-term vs longer-dated positioning."],
    ["Volume vs OI by Expiry", "Traded volume compared with existing open interest. <b>Volume > OI</b> means lots of brand-new positions today."],
    ["Volume Profile · call vs put by price", "How much call vs put volume happened at each price level — the option market's view of 'where'."],

    // ---- Volatility --------------------------------------------------------
    ["Vol Stats", "Headline volatility numbers: <b>implied vol</b> (what options price in) vs <b>realized vol</b> (what the stock actually did), plus IV rank."],
    ["IV Rank · Interpolated IV", "IV rank plus the smooth 'interpolated' IV curve across expiries — lets you compare expiries fairly instead of raw quotes."],
    ["Realized vs Implied", "What the stock actually moved (realized) vs what options expected (implied). <b>Implied above realized = options look overpriced</b>; the reverse = cheap."],
    ["Term Structure", "Implied vol by expiry. <b>Upward slope (calm)</b> is normal; a <b>downward slope</b> means near-term fear/stress."],
    ["Variance Risk Premium", "The gap between implied and realized variance — the extra premium option sellers earn. A <b>high VRP</b> favours selling options; low/negative favours buying."],
    ["Risk Reversal Skew", "How much more expensive puts are than calls (skew). <b>Steep skew = fear / heavy downside hedging demand.</b>"],
    ["Vol Anomaly", "Names or contracts whose volatility is unusually high or low vs their own history — potential setups."],

    // ---- Dark Pool ---------------------------------------------------------
    ["Dark Pool · flow", "Off-exchange ('dark pool') trades: how many, total premium, the largest, average size, and how many were canceled. Dark pools are where big institutions trade without moving the lit market."],
    ["Largest Dark Pool Prints", "The biggest single off-exchange trades today. Large prints often signal <b>institutional accumulation or distribution</b>."],
    ["Dark Pool Premium by Price", "Dark-pool dollars grouped by price — the levels where big buyers/sellers were active."],
    ["Dark Pool vs Regular Volume by Price", "Dark-pool volume vs lit (exchange) volume at each price. Heavy dark volume at a level can act as <b>support or resistance</b>."],

    // ---- Shorts ------------------------------------------------------------
    ["Short Interest &", "How many shares are sold short and what % of the float that is. A high short % means a crowded short and potential squeeze fuel."],
    ["SI % float vs Days to cover", "Short interest as % of float vs how many days of normal volume shorts would need to buy back. <b>High days-to-cover = harder to exit = squeeze potential.</b>"],
    ["Short Volume Ratio", "The share of today's volume that was short selling (a daily flow measure, not the same as short interest). High = lots of shorting pressure today."],
    ["Short Shares Available &", "How many shares are available to borrow and the annual fee to borrow them. <b>Low availability + high fee = hard/expensive to short.</b>"],

    // ---- Insiders ----------------------------------------------------------
    ["Insider Flow · KPIs", "A quick summary of insider buying vs selling."],
    ["Recent Insider Transactions", "The latest buys/sells by company insiders (officers and directors)."],
    ["Insider Filings", "Official SEC filings of insider transactions."],
    ["Net Insider Premium · daily", "Net dollars insiders bought (positive) vs sold (negative) over time. Routine selling is common; <b>cluster buying is the strong signal</b>."],
    ["Filings · purchases vs sells notional", "Dollar value of insider purchases vs sales from their filings."],

    // ---- ETF ---------------------------------------------------------------
    ["ETF Exposure", "How much of the fund is exposed to this stock or sector."],
    ["ETFs Holding This Name · weight", "Which ETFs own this stock and how big a slice it is — useful for index-flow and rebalancing effects."],
    ["Inflow / Outflow", "Money moving into (inflow) or out of (outflow) the fund — a demand-pressure gauge."],
    ["ETF Tide ·", "Options premium on ETF calls vs puts — a broad market sentiment gauge."],

    // ---- Home / snapshot ---------------------------------------------------
    ["Squeeze · short interest", "The most heavily-shorted names by <b>fresh</b> short-interest % float, with today's move. High SI% + green day = squeeze in progress. (The old days-to-cover feed is stale, so this card uses the live screener instead.)"],
    ["Whale screener", "Market-wide whale activity across the busiest tickers: <b>net options premium</b>, biggest <b>unusual premium</b>, <b>open-interest change</b> and <b>dark-pool premium</b>. Click any ticker to drill in."],
    ["Latest whale tickets", "The most recent large unusual option tickets across <b>all tickers</b>, sorted by <b>latest fill time</b> — green = calls, red = puts, heat = premium size. <b>Exp</b> = expiry (days-to-expiry changes everything), <b>OI</b> = existing open interest (high vol vs low OI = brand-new positioning), <b>Δ</b> = delta (direction + roughly the ITM odds). Click any ticker to drill into its Flow/Whales tabs and verify."],
    ["Market Tide", "Net options premium across the whole market (calls minus puts). <b>Above zero = bullish bias</b>, below = bearish."],
    ["Top Net Impact", "Tickers with the biggest net options premium today (green = bullish, red = bearish). <b>Click any ticker to drill in.</b>"],
    ["Dealer Gamma", "Key gamma levels for the busiest names: call wall, put wall, gamma flip and magnet."],
    ["Index & ETF Levels", "Key gamma levels for <b>SPX (ES)</b>, <b>NDX (NQ)</b>, SPY and QQQ. ES tracks SPX and NQ tracks NDX, so these are the futures' levels too."],
    ["Unusual Options Flow", "Unusually large option trades across the market right now, with premium and sweep volume."],
    ["Largest OI Changes", "Contracts with the biggest jump in open interest — fresh positioning being opened."],
    ["Squeeze · days to cover", "The most heavily-shorted names, ranked by how many days shorts would need to buy back."],
    ["Vol Anomalies · long vol", "Names with unusually elevated volatility right now."],
    ["Insiders · recent", "Recent insider buys and sells."],
    ["OI-change alerts", "The dedicated alert feed: contracts where <b>open interest jumped</b> vs the prior session — fresh positioning being opened. <b>CRITICAL</b> = a +30k OI build on heavy volume (or a ≥5× jump), <b>HIGH</b> = a big build. The 🔔 bell in the header shows how many new alerts landed since you last opened the section."],
    ["Headline flow", "Recent news for this ticker, counted by direction. The feed is live through the premarket, so it can explain a move before options data updates."],
    ["Latest headlines", "Ticker-tagged headlines, newest first. <b>Ago</b> = how long before now, <b>★</b> = flagged major / price-moving, <b>Also</b> = other tickers the same story mentions."],
    ["News · ticker-tagged headlines", "The market-wide headline wire, newest first, tagged with the tickers each story mentions."],
    ["Market option volume", "Total market-wide option contracts traded (calls vs puts) and the call share. <b>Call share > 50%</b> = call-heavy tape; the premium lines show where the dollars went."],
    ["Top bullish option sentiment", "Names with the strongest <b>bullish</b> option positioning right now (score 0…100). AVAR/VWKS are the underlying components; n = sample size. Where the bullish flow is concentrated."],
    ["Top bearish option sentiment", "Names with the strongest <b>bearish</b> option positioning right now (score −100…0). Where the defensive/put flow is concentrated."],
    ["Sector pulse", "Option sentiment aggregated by industry: call vs put transactions and the net sentiment score per sector — which parts of the market are leaning bullish or bearish."],
    ["⚡ Live flow alerts", "The <b>real-time</b> alert stream while the market is open: <b>FLOW</b> = rule-based tape alerts (sweeps / repeated hits), <b>UNUSUAL</b> = live unusual-options contracts, <b>DARK</b> = off-exchange blocks. ⚡ = sweep, <b>Side</b> is inferred from ask- vs bid-side premium. Notifications ring the bell + desktop for new prints at/above the minimum premium; sweep + size promote severity."],
    ["Live flow alerts", "The <b>real-time</b> alert stream while the market is open. Flow = tape sweeps, Unusual = live unusual contracts, Dark = off-exchange blocks. OI-change is separate (updates once a day ~06:45 ET)."],
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

  U.EXPLAIN_KEY = "uw_explain";
  U.explainOn = () => localStorage.getItem(U.EXPLAIN_KEY) !== "0"; // default ON

  // ---- glossary ----------------------------------------------------------
  U.GLOSSARY = [
    ["Dealers (market makers)", "The firms on the other side of almost every option trade. When you <b>buy</b> a call, a dealer <b>sells</b> it to you — so they start out <b>short</b> your position and must hedge with the underlying stock to stay neutral. Because dealers hold the opposite side of <i>everyone's</i> options, their combined hedging is the single biggest forced buyer/seller in the stock. That's why tracking what <i>they</i> must do tells you where price gets pushed."],
    ["Gamma (GEX)", "How much stock dealers must buy or sell for each <b>1% move</b> in price, just to stay hedged. It's the size of their automatic reaction. <b>Positive GEX = their hedging pushes <i>against</i> the move</b> (stock rises → they sell → rally slows: calmer market). <b>Negative GEX = their hedging pushes <i>with</i> the move</b> (stock falls → they sell more → selloff accelerates: wilder market)."],
    ["Delta", "An option's directional sensitivity: ~0.50 means it moves ~$0.50 per $1 of stock. Also roughly the chance it finishes in-the-money."],
    ["Gamma", "How fast delta changes as the stock moves. High gamma near expiry = twitchy, heavy hedging."],
    ["Theta", "Time decay — how much value an option loses each day, all else equal."],
    ["Vega", "How much an option's price moves when implied volatility changes."],
    ["Charm", "How delta decays as time passes — drives the end-of-day hedging rush."],
    ["Vanna", "How delta changes when volatility changes — flows when IV moves."],
    ["Call wall / Put wall", "Strikes with the most dealer gamma — they tend to act like a <b>ceiling / floor</b>."],
    ["Gamma flip / zero-gamma", "The price where dealer gamma changes sign. <b>Above = calmer, below = wilder moves.</b>"],
    ["Gamma magnet", "The strike price tends to be pulled toward (strongest pin)."],
    ["Max pain", "The strike where most options expire worthless — option writers' least pain."],
    ["IV (implied volatility)", "The size of move options are pricing in. High = expensive / nervous."],
    ["IV rank / percentile", "Where today's IV sits within its own past year (0 = calmest, 100 = most volatile)."],
    ["Realized vol", "The move the stock <b>actually</b> made (vs what options expected)."],
    ["VRP (variance risk premium)", "Implied variance minus realized — the extra edge option sellers earn. High = favours selling options."],
    ["Skew / risk reversal", "How much more puts cost than calls — a <b>fear gauge</b>."],
    ["Term structure", "Implied vol across expiries. Upward slope = calm; downward = near-term stress."],
    ["Dark pool", "Private off-exchange trades, usually institutions trading without moving the public market."],
    ["Lit", "On-exchange (public) trades — the visible side of the tape."],
    ["Sweep", "An urgent order that 'sweeps' several exchanges at once — often institutional."],
    ["Premium", "Dollar value of an options trade (price × contracts × 100)."],
    ["Open interest (OI)", "Number of option contracts currently open at a strike/expiry."],
    ["Volume/OI ratio", "Today's volume vs existing open interest. High = lots of brand-new positions."],
    ["Net premium", "Call premium minus put premium. Positive = net bullish money."],
    ["P/C ratio", "Put volume ÷ call volume. High = bearish / heavy hedging."],
    ["NOPE", "Net Options Pricing Effect — a 0–100 score of how much options hedging moves the stock."],
    ["Greek flow", "Dealer hedging flow. <b>Positive = calming, negative = adds fuel to moves.</b>"],
    ["Short interest", "Shares sold short, shown as a % of the float. High = crowded short / squeeze fuel."],
    ["Days to cover", "Short shares ÷ average daily volume — how many days shorts need to buy back."],
    ["FTD (failure to deliver)", "A trade that failed to settle on time — a sign of settlement stress."],
    ["Borrow fee", "Annual % cost to borrow shares in order to short them."],
    ["Float", "Shares actually available to trade (excludes locked-up insiders)."],
    ["Insider", "Company officers/directors. Routine selling is normal; <b>cluster buying</b> is the strong signal."],
    ["Beta", "How much the stock swings relative to the market."],
    ["Moneyness (ITM/ATM/OTM)", "Whether an option has intrinsic value (in-the-money), is at the money, or is out-of-the-money."],
    ["Strike / Expiry", "The price an option can be exercised at / the date it expires."],
  ];

  U.renderGlossary = () =>
    U.GLOSSARY.map(([t, d]) => `<div class="gloss"><div class="gloss-t">${t}</div><div class="gloss-d">${d}</div></div>`).join("");
})();
