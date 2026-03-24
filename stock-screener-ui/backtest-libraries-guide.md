# Python Backtesting Libraries: A Comprehensive Guide

> A plain-English guide to understanding backtesting libraries. No code, just pictures and analogies.

---

## Table of Contents

1. [What Is Backtesting?](#1-what-is-backtesting)
2. [What Is "Live Trading Support"?](#2-what-is-live-trading-support)
3. [The 5 Stages of a Trading Strategy](#3-the-5-stages-of-a-trading-strategy)
4. [Library Overview: The Big Picture](#4-library-overview-the-big-picture)
5. [NautilusTrader](#5-nautilustrader)
6. [VectorBT](#6-vectorbt)
7. [backtesting.py](#7-backtestingpy)
8. [QuantConnect LEAN](#8-quantconnect-lean)
9. [Backtrader](#9-backtrader)
10. [freqtrade](#10-freqtrade)
11. [Zipline Reloaded](#11-zipline-reloaded)
12. [bt (Flexible Backtesting)](#12-bt-flexible-backtesting)
13. [No-Framework (pandas + TA-Lib)](#13-no-framework-pandas--ta-lib)
14. [Speed Benchmarks](#14-speed-benchmarks)
15. [Parallelism: How Each Library Handles Many Stocks](#15-parallelism-how-each-library-handles-many-stocks)
16. [Feature Comparison Matrix](#16-feature-comparison-matrix)
17. [Hybrid Architecture (Recommended)](#17-hybrid-architecture-recommended)
18. [Migration Guide](#18-migration-guide)

---

## 1. What Is Backtesting?

Think of backtesting like **watching a replay of a cricket match**.

You have a strategy (e.g., "bat aggressively in the first 10 overs"). You want to know: "if I used this strategy in last year's IPL, would my team have won?"

Backtesting = **feed historical match data into your strategy, simulate what would have happened, count the runs.**

No real money. No real stadium. Just a simulation on past data.

The output tells you:
- How many trades would you have made?
- How profitable would they be?
- What's the worst loss you'd have suffered (drawdown)?
- What's your win rate?

This is **Stage 1**. Every library in this guide can do this.

---

## 2. What Is "Live Trading Support"?

### The Problem

Imagine you're a cricket coach:

```
STAGE 1: BACKTESTING
─────────────────────
You show videos of last year's matches to your batsman.
He tells you what shot he'd play at each ball.
You calculate: "With this strategy, you'd score 450 runs in 10 matches."

STAGE 2: REAL MATCH
───────────────────
Now your batsman walks onto a real pitch.
Real bowlers. Real ball. Real stadium.
The shots he practiced in the video room need to work HERE.
```

**Here's the problem**: If you used **Library A** for Stage 1 (backtesting on videos), but Library A can't talk to the real stadium, you have to **rewrite your entire strategy** in **Library B** for Stage 2.

```
┌─────────────────────────────────────────────────────────────┐
│  WITHOUT live trading support (e.g., VectorBT)               │
│                                                              │
│  Stage 1 (Backtest)          Stage 2 (Live)                  │
│  ┌──────────────┐            ┌──────────────┐                │
│  │ VectorBT     │            │ Custom code  │                │
│  │ "buy when    │   REWRITE  │ that talks   │                │
│  │  price > X"  │ ────────▶  │ to Upstox    │                │
│  │              │   NEEDED!  │ API directly │                │
│  └──────────────┘            └──────────────┘                │
│                                                              │
│  Risk: The live code might behave differently                │
│        than the backtest code. Bugs creep in.                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  WITH live trading support (e.g., NautilusTrader)            │
│                                                              │
│  Stage 1 (Backtest)          Stage 2 (Live)                  │
│  ┌──────────────┐            ┌──────────────┐                │
│  │ NautilusTrader            │ NautilusTrader│                │
│  │ "buy when    │   JUST     │ same code,    │                │
│  │  price > X"  │ ────────▶  │ now connected │                │
│  │              │  FLIP A    │ to real       │                │
│  │              │   SWITCH   │ exchange      │                │
│  └──────────────┘            └──────────────┘                │
│                                                              │
│  No rewrite. Same logic. Much safer.                         │
└─────────────────────────────────────────────────────────────┘
```

### What "Live Trading Support" Actually Includes

| Component | Analogy | What It Does |
|-----------|---------|-------------|
| **Broker adapter** | The phone that calls the exchange | Talks to Upstox/Zerodha/Binance API |
| **Order management** | The actual buy/sell instruction | Creates, modifies, cancels real orders |
| **Position tracking** | Knowing how many shares you own | Keeps count of your real holdings |
| **Live data feed** | Watching the live match on TV | Receives real-time price updates |
| **Risk checks** | The coach saying "don't play that shot" | Prevents accidentally buying too much |
| **Reconnection** | What happens when TV signal drops | Handles network drops gracefully |
| **Paper trading** | Practice match with real opponents, fake scoreboard | Trades real market data with fake money |

### Why This Matters for Alphashri

Right now, Alphashri is at Stage 1 only (backtesting). The plan is:

```
NOW                              LATER (maybe)
────                              ────────────
Stage 1: Backtest on past data    Stage 3: Trade real money
         │                                │
         │         Stage 2: Paper trade    │
         │         (optional safety step)  │
         │              │                  │
         ▼              ▼                  ▼
     NautilusTrader ──────▶ NautilusTrader ──▶ NautilusTrader
     (historical data)     (live data, fake $)  (live data, real $)
     
     Same code. Just flip a switch.
```

If Alphashri used VectorBT instead, going from Stage 1 to Stage 3 would require **rewriting the entire strategy** to talk to Upstox's API. That's risky and time-consuming.

---

## 3. The 5 Stages of a Trading Strategy

Every trading strategy goes through these stages. Different libraries are good at different stages:

```
STAGE 1                  STAGE 2                  STAGE 3
EXPLORE                  SCREEN                   BACKTEST
─────────                ──────                   ────────
"I have a vague idea"    "Which of these          "How does it
                         500 stocks + 20          perform with
                         parameter combos         realistic fills
                         look promising?"         on 5 stocks?"

     │                         │                       │
     │  Quick & dirty          │  Fast, rough           │  Slow, accurate
     │  1 stock, 1 set          │  500 stocks, 100+       │  5 stocks, 1 set
     │  of params              │  param combos          │  of params
     │                         │                        │
     ▼                         ▼                        ▼
 backtesting.py            VectorBT               NautilusTrader
 or no-framework           or no-framework         or LEAN
 (or anything)

                         STAGE 4                  STAGE 5
                         VALIDATE                 LIVE TRADE
                         ────────                  ──────────
                         "Double-check the         "Actually buy/sell
                          top 10 picks with        on the real
                          accurate fills"          exchange"

                              │                       │
                              │  Slow, very accurate   │  Real money
                              │  10 stocks, 1 set      │  Same code as
                              │  of params             │  backtest
                              │                        │
                              ▼                        ▼
                          NautilusTrader           NautilusTrader
                          or LEAN                   or LEAN
```

### Which Library for Which Stage?

```
STAGE     WHAT YOU DO                    BEST LIBRARY          WHY
──────    ──────────                      ──────────            ───
Explore   Test 1 idea on 1 stock         backtesting.py        Simplest, 5 min setup
          in 5 minutes                   or no-framework

Screen    Test 500 stocks x 20           VectorBT              Fastest, ~50ms for
          parameter combos               or no-framework       500 stocks

Backtest  Run accurate simulation        NautilusTrader       Realistic fills,
          on 5 stocks                    or LEAN               handles edge cases

Validate  Double-check top 10            NautilusTrader       Most accurate,
          with precise fills             or LEAN               same as live

Live      Trade real money               NautilusTrader       Same code as
          on exchange                    or LEAN               backtest, just
                                         or freqtrade*        flip a switch
                                                              (*crypto only)
```

---

## 4. Library Overview: The Big Picture

### The Car Analogy

Think of each library as a different type of vehicle:

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  VectorBT        =  Formula 1 car                                    │
│  ─────────           Extremely fast, but only goes on a straight      │
│                      track (signal-based strategies). Can't carry     │
│                      luggage (no live trading).                       │
│                                                                       │
│  backtesting.py  =  Bicycle                                         │
│  ─────────────       Simple, cheap, gets you there. But slow for     │
│                      long distances. Can't carry luggage.              │
│                                                                       │
│  NautilusTrader  =  Pickup truck                                     │
│  ─────────────       Not the fastest, but carries everything          │
│                      (live trading, realistic fills). Can go           │
│                      off-road (order books, custom brokers).           │
│                      Same truck can deliver packages (backtest)        │
│                      or haul freight (live trade).                     │
│                                                                       │
│  LEAN             =  Freight train                                  │
│  ───                 Huge, powerful, carries everything. Has its      │
│                      own rail network (QuantConnect cloud). Slow      │
│                      to start up. Doesn't stop at small stations      │
│                      (no Indian market data).                         │
│                                                                       │
│  Backtrader       =  Old reliable car                                │
│  ──────────          Used to be great. Still works. But the          │
│                      manufacturer stopped making parts (maintenance).  │
│                                                                       │
│  freqtrade        =  Crypto-specialized drone                         │
│  ─────────            Fast, automated, 24/7. But only flies in        │
│                       one city (crypto exchanges).                     │
│                                                                       │
│  No-framework     =  Building a car from scratch                      │
│  ───────────         Maximum control. Takes longer. Only you          │
│                       can drive it (no community).                     │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### At-a-Glance Comparison

| Library | Speed | Live Trading | Difficulty | Maintenance | Stars | One-Liner |
|---------|-------|-------------|------------|-------------|-------|-----------|
| **VectorBT** | Very fast | No | Medium | Active | 7K | "Test 1000 ideas in seconds" |
| **backtesting.py** | Medium | No | Easy | Active | 8K | "Backtest in 5 minutes" |
| **NautilusTrader** | Fast | Yes (full) | Hard | Active | 2K | "Backtest today, trade live tomorrow" |
| **LEAN** | Medium | Yes (full) | Hard | Active | 18K | "Institutional-grade everything" |
| **Backtrader** | Slow | Basic | Easy | Dead | 13K | "What every tutorial uses (but it's old)" |
| **freqtrade** | Medium | Yes (crypto) | Medium | Very active | 32K | "24/7 crypto bot in a box" |
| **Zipline** | Slow | No | Medium | Dead | Low | "Quantopian's old engine, barely alive" |
| **bt** | Slow | No | Easy | Low | 3K | "Combine strategies like LEGO blocks" |
| **No-framework** | Varies | No (DIY) | Hard | N/A | N/A | "Full control, zero help" |

---

## 5. NautilusTrader

### What It Is

A professional-grade trading engine. Think of it as a **trading operating system** -- it handles everything from data feeds to order execution to risk management. Built with a Rust core for speed, Python interface for usability.

### The Analogy

```
NautilusTrader is like a FULL TRADING FIRM in a box:

┌────────────────────────────────────────────────┐
│               NautilusTrader                    │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ DATA     │  │ STRATEGY │  │ EXECUTION│     │
│  │ ENGINE   │──│  (your   │──│ ENGINE   │     │
│  │          │  │  code)   │  │          │     │
│  │ Feeds    │  │          │  │ Simulated│     │
│  │ bars &   │  │ on_bar() │  │ exchange │     │
│  │ ticks to │  │ decides  │  │ matches  │     │
│  │ strategy │  │ buy/sell │  │ orders   │     │
│  └──────────┘  └──────────┘  └──────────┘     │
│        │             │             │            │
│        ▼             ▼             ▼            │
│  ┌──────────────────────────────────────┐     │
│  │         PORTFOLIO & RISK             │     │
│  │  Tracks positions, PnL, margins      │     │
│  └──────────────────────────────────────┘     │
│                                                 │
│  BACKTEST MODE: data = historical file          │
│  LIVE MODE:    data = real-time from exchange   │
│  PAPER MODE:   data = real-time, fake money    │
└────────────────────────────────────────────────┘
```

### When to Use It

```
USE IT WHEN                              DON'T USE IT WHEN
───────────                              ───────────────
✓ You want to go live eventually        ✗ You need to test 1000+
✓ You need accurate order fills         parameter combos fast
✓ You work with Indian markets          ✗ You're just exploring an idea
  (INR, cash/margin accounts)
✓ You need order book data (L2/L3)     ✗ You want a 5-minute prototype
✓ You want realistic slippage/latency
  simulation
```

### How It Handles Multiple Stocks

```
OPTION A: One engine per stock (current approach)
───────────────────────────────────────────────────

  Stock 1:  ┌─────────┐     ┌─────────┐     ┌─────────┐
            │ Engine  │     │ Engine  │     │ Engine  │
  Stock 2:  │ Init    │     │ Init    │     │ Init    │
            │ Run     │     │ Run     │     │ Run     │
  Stock 3:  │ Dispose │     │ Dispose │     │ Dispose │
            └─────────┘     └─────────┘     └─────────┘
            
  Total: 3 x (init + run + dispose) = 3 x ~120ms = ~360ms
  Can run in parallel with multiprocessing (4 stocks at once)


OPTION B: Batch all stocks into one engine (our optimization)
──────────────────────────────────────────────────────────

  Stock 1 ─┐
  Stock 2 ──┼──▶ ┌─────────┐     ┌─────────┐
  Stock 3 ──┤    │ Engine  │     │ Engine  │
  Stock 4 ──┤    │ Init    │     │ Run     │
  Stock 5 ──┘    │ (once)  │     │ (all    │
                 └─────────┘     │ stocks) │
                                 └─────────┘
                                 
  Total: 1 x (init + run + dispose) = ~600ms
  Slightly slower per stock, but simpler code
```

### Speed

```
5 stocks, 30 days, 5-minute bars:

  Baseline (no optimizations):    ~0.9 seconds
  After our optimizations:        ~0.6 seconds
  With multiprocessing (4 cores): ~0.15 seconds
```

### Pros & Cons

```
  ✓ Rust core = fast internals           ✗ Heavy setup (50+ lines of
  ✓ Same code for backtest & live            boilerplate per stock)
  ✓ Most accurate fills of any              ✗ Steep learning curve
    Python library                          ✗ Single-threaded engine
  ✓ Order book support (L2/L3)             ✗ No built-in parameter
  ✓ Active corporate maintenance             optimizer
  ✓ India market support (INR)             ✗ Framework overhead dominates
                                              for simple strategies
```

---

## 6. VectorBT

### What It Is

A **math-first** backtester. Instead of processing one bar at a time (like NautilusTrader), it processes ALL bars at once using NumPy arrays. Think of it as a **spreadsheet on steroids** -- you define buy/sell signals as True/False columns, and it computes everything in one shot.

### The Analogy

```
NautilusTrader processes bars ONE AT A TIME:
─────────────────────────────────────────────

  Bar 1 → "Is price > OR high?" → No → skip
  Bar 2 → "Is price > OR high?" → No → skip
  Bar 3 → "Is price > OR high?" → Yes → BUY!
  Bar 4 → "Is PnL > 1.2%?"     → No → hold
  Bar 5 → "Is PnL > 1.2%?"     → Yes → SELL!
  ... (20,000 more bars to process one by one)

  Slow for large datasets, but very flexible.


VectorBT processes ALL bars AT ONCE:
────────────────────────────────────

  prices = [100, 101, 99, 103, 105, ...]     ← 20,000 numbers
  or_high = [102, 102, 102, 102, 102, ...]    ← 20,000 numbers
  entries = [F, F, F, T, F, F, ...]           ← True/False array
  
  WHERE prices > or_high → entries = True     ← one operation!
  
  pf = Portfolio.from_signals(prices, entries, exits)
  
  Done. 20,000 bars processed in milliseconds.
  
  Fast, but you can only express strategies that fit the
  "entry signal / exit signal" pattern.
```

### When to Use It

```
USE IT WHEN                              DON'T USE IT WHEN
───────────                              ───────────────
✓ Screening 500 stocks x 20 params      ✗ You need live trading
  (10,000 backtests in ~2 seconds)      ✗ Your strategy has complex
✓ Parameter sweeps with heatmaps           state (e.g., "after 3
✓ ML pipelines (signal arrays from         losses today, stop trading")
    a model output)                      ✗ You need realistic fill
✓ Quick "does this idea even work?"         simulation (slippage,
✓ Multi-stock analysis in one call          order book depth)
```

### How It Handles Multiple Stocks

```
VectorBT: ALL stocks in ONE call
──────────────────────────────────

  ┌─────────────────────────────────────────┐
  │              Single DataFrame             │
  │                                          │
  │         RELIANCE  TCS   INFY  HDFC  ICI  │
  │  9:15      2450    3800   1520  1650  1050│
  │  9:20      2455    3805   1518  1652  1052│
  │  9:25      2460    3802   1525  1648  1048│
  │  ...      ...     ...    ...   ...   ... │
  │                                          │
  │  entries = prices > or_high              │
  │  (one True/False per cell)               │
  │                                          │
  │  pf = Portfolio.from_signals(...)        │
  │                                          │
  │  → Results for ALL 5 stocks at once     │
  │  → No engine init, no dispose            │
  │  → ~50 milliseconds total                │
  └─────────────────────────────────────────┘
  
  This is why VectorBT is the undisputed king of screening.
```

### Speed

```
5 stocks, 30 days, 5-minute bars:

  Single backtest:               ~0.05 seconds (50ms)
  100 param combos x 5 stocks:   ~0.2 seconds
  10,000 param combos x 3 stocks: ~2 seconds
  
  For comparison, NautilusTrader takes ~0.6s for just ONE backtest.
```

### Pros & Cons

```
  ✓ 10-100x faster than event-driven       ✗ No live trading (ever)
  ✓ Multi-stock in one call                ✗ Complex strategies hard to
  ✓ Built-in optimization & heatmaps           express as signals
  ✓ 50+ built-in metrics                    ✗ Less realistic fill modeling
  ✓ Interactive Plotly charts               ✗ Numba has ~1s cold start
  ✓ ML-friendly (numpy arrays)              ✗ Can't handle order book data
```

---

## 7. backtesting.py

### What It Is

The **simplest possible** backtesting library. You give it a DataFrame of prices and a Strategy class with `init()` and `next()` methods. That's it. No venues, no instruments, no message buses.

### The Analogy

```
backtesting.py is a NOTEPAD:
────────────────────────────
  
  "Here's my price data. Here's my strategy. Go."
  
  That's the whole API. 3 lines to run a backtest.
  
  vs NautilusTrader which is a FULL OFFICE BUILDING:
  
  "First register your instrument. Then configure the venue.
   Then set up the order book type. Then create a wrangler.
   Then initialize the engine. Then add data. Then add strategy.
   Then run. Then dispose."
```

### When to Use It

```
USE IT WHEN                              DON'T USE IT WHEN
───────────                              ───────────────
✓ You want a result in under 5 minutes   ✗ You need multiple stocks
✓ You're learning backtesting            ✗ You need live trading
✓ You need built-in optimization         ✗ You need complex order types
  with heatmap visualization              ✗ You need production-grade
✓ You want matplotlib charts                accuracy
```

### Speed

```
1 stock, 30 days, 5-minute bars:

  Single backtest:   ~0.3 seconds
  Optimization (10x10 grid): ~3 seconds (with multiprocessing)
```

### Pros & Cons

```
  ✓ Simplest API possible (init/next)     ✗ Single stock only
  ✓ Built-in optimizer with heatmaps      ✗ No live trading
  ✓ Zero extra dependencies               ✗ Limited order types
  ✓ Great for learning                    ✗ Not production-ready
```

---

## 8. QuantConnect LEAN

### What It Is

The **heavy machinery** of backtesting. Used by QuantConnect's cloud platform (5000+ users). Written in C# with Python bindings. Supports everything: equities, forex, futures, options, crypto.

### The Analogy

```
LEAN is like an AIRPORT:

  ┌──────────────────────────────────────────────────┐
  │                    LEAN                           │
  │                                                   │
  │  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
  │  │Runway 1 │  │Runway 2 │  │Runway 3 │          │
  │  │Equities │  │Options  │  │ Crypto  │          │
  │  └─────────┘  └─────────┘  └─────────┘          │
  │                                                   │
  │  Control Tower: Risk management, fill models      │
  │  Hangar: 30TB of historical data                  │
  │  Cloud: Run 1000 backtests in parallel            │
  │                                                   │
  │  LOCAL: Requires Docker (~500MB)                  │
  │  CLOUD: Free tier available                       │
  └──────────────────────────────────────────────────┘
  
  Powerful, but you can't just "pip install" and go.
  Needs Docker. Needs their data format. Heavy setup.
```

### When to Use It

```
USE IT WHEN                              DON'T USE IT WHEN
───────────                              ───────────────
✓ You need options/futures backtesting   ✗ You want something lightweight
✓ You want cloud-based optimization      ✗ You're focused on Indian markets
  (1000s of parallel runs)               ✗ You want fast local iteration
✓ You want free cloud backtesting        ✗ You dislike Docker
✓ You need multi-broker support          ✗ You have custom data formats
  (IBKR, Binance, OANDA)
```

### Pros & Cons

```
  ✓ Institutional-grade (5000+ users)     ✗ Heavy setup (Docker required)
  ✓ Cloud optimization (1000s of nodes)   ✗ No Indian market data
  ✓ Supports ALL asset classes            ✗ C# core = harder to debug Python
  ✓ Free cloud platform                   ✗ Data locked to QuantConnect format
  ✓ Active development (13K+ commits)     ✗ Python is a thin wrapper
```

---

## 9. Backtrader

### What It Is

The **old reliable** of Python backtesting. Most tutorials and courses use it because it was popular 5+ years ago. Pure Python, classic OOP design with `Cerebro` engine.

### The Analogy

```
Backtrader is like a 2015 HONDA CIVIC:

  - It still works fine
  - Millions of people learned to drive on it
  - Parts are getting harder to find
  - The manufacturer isn't making new models
  - You can probably find something better today
```

### When to Use It

```
USE IT WHEN                              DON'T USE IT WHEN
───────────                              ───────────────
✓ Following a tutorial that uses it     ✗ Starting a new project
✓ Maintaining existing strategies       ✗ You need speed
✓ You want 50+ built-in indicators      ✗ You need live trading
                                          (the live support is broken)
```

### Speed

```
1 stock, 30 days, 5-minute bars: ~2-5 seconds (10x slower than NautilusTrader)
```

### Pros & Cons

```
  ✓ Most tutorials use it                  ✗ Extremely slow (pure Python)
  ✓ 50+ built-in indicators               ✗ Development stalled since 2023
  ✓ Detailed trade analysis                ✗ No built-in optimizer
  ✓ Good for learning                      ✗ Live trading doesn't really work
```

---

## 10. freqtrade

### What It Is

A **complete crypto trading bot** in a box. Not just a backtesting library -- it's a full application with web UI, Telegram bot, and exchange integrations. Designed to run 24/7.

### The Analogy

```
freqtrade is like a ROomba for crypto:

  - Turn it on and it runs by itself
  - Cleans (trades) 24/7
  - Sends you notifications (Telegram)
  - You can watch it on a dashboard (web UI)
  - But it only works on carpet (crypto exchanges)
  - Won't clean hardwood floors (Indian equities)
```

### When to Use It

```
USE IT WHEN                              DON'T USE IT WHEN
───────────                              ───────────────
✓ Trading crypto (Binance, Bybit, OKX)  ✗ Trading Indian equities
✓ You want 24/7 automated trading       ✗ You want a lightweight library
✓ You need Telegram alerts              ✗ You need options/futures
✓ You want genetic algorithm            ✗ You want to integrate with
  optimization (hyperopt)                   custom systems
```

### Pros & Cons

```
  ✓ Production-ready crypto bot            ✗ Crypto only (no equities)
  ✓ Telegram + web UI + REST API          ✗ No Indian market support
  ✓ Genetic algorithm optimizer           ✗ Heavy (~200MB with exchanges)
  ✓ Very active community (32K stars)     ✗ Not a general-purpose library
```

---

## 11. Zipline Reloaded

### What It Is

The **ghost of Quantopian past**. Quantopian was a popular backtesting platform that shut down in 2020. Zipline was their engine. This is a community fork keeping it barely alive.

### The Analogy

```
Zipline is like a MUSEUM PIECE:

  - Historically important
  - Many people learned on it
  - Still works if you're careful
  - But nobody's maintaining it
  - And better alternatives exist
```

### Pros & Cons

```
  ✓ Many tutorials reference it            ✗ Effectively unmaintained
  ✓ Clean API design                       ✗ Very slow
  ✓ Good for reproducing old research      ✗ No live trading
```

---

## 12. bt (Flexible Backtesting)

### What It Is

A **LEGO-style** backtesting framework. Instead of writing a class with methods, you snap together building blocks (Algos) like "Run Monthly → Select All → Weigh Equally → Rebalance".

### The Analogy

```
bt is like LEGO:

  "I want a strategy that runs monthly, selects all stocks,
   weights them equally, and rebalances."
   
   bt.algos.RunMonthly() +
   bt.algos.SelectAll() +
   bt.algos.WeighEqually() +
   bt.algos.Rebalance()
   
   Done. Snap the pieces together.
   
   Great for portfolio-level ideas.
   Bad for bar-level trading strategies (like ORB).
```

### Pros & Cons

```
  ✓ Elegant composition pattern           ✗ Very slow
  ✓ Easy to combine strategies            ✗ No optimization
  ✓ Good for asset allocation             ✗ No live trading
```

---

## 13. No-Framework (pandas + TA-Lib)

### What It Is

**No library at all**. Just pandas DataFrames, NumPy arrays, and basic Python loops. Many professional quants work this way because it gives them 100% control.

### The Analogy

```
No-framework is like COOKING FROM SCRATCH:

  Library approach:  "Here's a meal kit with pre-measured ingredients.
                      Follow the instructions. Dinner in 30 minutes."
  
  No-framework:      "Here's a raw chicken, some vegetables, and spices.
                      You decide everything. Takes longer, but it's
                      exactly how you want it."
```

### When to Use It

```
USE IT WHEN                              DON'T USE IT WHEN
───────────                              ───────────────
✓ Strategy is simple (boolean signals)   ✗ Complex order management
✓ You need maximum control               ✗ Multi-asset portfolio simulation
✓ Zero dependencies wanted               ✗ Built-in analytics needed
✓ One-off analysis                       ✗ You'll need live trading later
```

### Speed

```
5 stocks, 30 days, 5-minute bars:

  Vectorized (no loops):  ~25ms (FASTEST of all)
  Loop-based:             ~150ms
```

### Pros & Cons

```
  ✓ Zero dependencies                         ✗ No built-in anything
  ✓ Maximum speed possible                   ✗ Everything is manual
  ✓ 100% control                             ✗ Error-prone for complex logic
  ✓ Easy to debug (just Python)              ✗ No reuse across projects
```

---

## 14. Speed Benchmarks

### The Race

All libraries running the same task: **5 stocks, 30 days, 5-minute bars**

```
Speed comparison (lower = faster):

No-framework (vectorized)  █████░░░░░░░░░░░░░░░░░░░  ~25ms
VectorBT                   ████░░░░░░░░░░░░░░░░░░░░  ~50ms
backtesting.py             ██░░░░░░░░░░░░░░░░░░░░░░  ~300ms  (1 stock only)
NautilusTrader (optimized)  █░░░░░░░░░░░░░░░░░░░░░░░  ~600ms
Backtrader                  ░░░░░░░░░░░░░░░░░░░░░░░░  ~3-15s
LEAN (local Docker)         ░░░░░░░░░░░░░░░░░░░░░░░░  ~5s

With multiprocessing (4 CPU cores):

NautilusTrader (4 stocks at once)  ██░░░░░░░░░░░░░░░░░░░░░░  ~150ms
backtesting.py (4 stocks at once)  ████░░░░░░░░░░░░░░░░░░░░  ~100ms
```

### Parameter Sweep Speed

```
How fast can you test 1000 different parameter combinations?

VectorBT:           ██░░░░░░░░░░░░░░░░░░░░░░  ~2 seconds
No-framework:      ███░░░░░░░░░░░░░░░░░░░░░  ~5 seconds
NautilusTrader:    ████████████████████████  ~10 minutes (1000 sequential runs)
NautilusTrader mp: ██████████████░░░░░░░░░░  ~2.5 minutes (4 cores)
```

---

## 15. Parallelism: How Each Library Handles Many Stocks

```
SCENARIO: Backtest 5 stocks

═══════════════════════════════════════════════════════════

VectorBT:  All in ONE call (no parallelism needed)
──────────────────────────────────────────────────

  ┌─────────────────────────────┐
  │  DataFrame: 5 columns      │
  │  [RELIANCE, TCS, INFY, ...]│
  │                             │
  │  pf = Portfolio.from_signals│
  │  → processes all columns    │
  │  → one result per stock     │
  └─────────────────────────────┘
  Time: ~50ms total

═══════════════════════════════════════════════════════════

NautilusTrader:  Option A - Sequential
────────────────────────────────────────

  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
  │RELIANCE│  │  TCS   │  │  INFY  │  │ HDFCBNK│  │ ICICI  │
  │Engine 1│→ │Engine 2│→ │Engine 3│→ │Engine 4│→ │Engine 5│
  │120ms   │  │120ms   │  │120ms   │  │120ms   │  │120ms   │
  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘
  Time: 5 x 120ms = ~600ms

NautilusTrader:  Option B - Multiprocessing (4 cores)
──────────────────────────────────────────────────────

  CPU Core 1: [RELIANCE 120ms] → [ICICI 120ms]
  CPU Core 2: [TCS 120ms]      → idle
  CPU Core 3: [INFY 120ms]     → idle
  CPU Core 4: [HDFCBANK 120ms] → idle
  
  Time: 2 x 120ms = ~240ms (but +100ms process spawn = ~340ms)

NautilusTrader:  Option C - Batch (one engine, all stocks)
────────────────────────────────────────────────────────

  ┌────────┐
  │Engine  │ ← all 5 strategies added
  │  once  │
  │  init  │
  │        │
  │RELIANCE│──┐
  │  TCS   │──┤ all processed
  │  INFY  │──┤ in one run
  │ HDFCBNK│──┤
  │ ICICI  │──┘
  └────────┘
  Time: ~600ms (saves init overhead, but engine is single-threaded)

═══════════════════════════════════════════════════════════

Summary: How many stocks before you NEED parallelism?

  1-3 stocks:    Sequential is fine (any library)
  4-10 stocks:   Multiprocessing helps (event-driven) OR just use VectorBT
  10-100 stocks: VectorBT (only sane option for speed)
  100-500 stocks: VectorBT with chunking
  500+ stocks:   VectorBT + distributed computing
```

---

## 16. Feature Comparison Matrix

### Core Features

```
Feature                    NT    VBT   btpy  LEAN   BT    FT    ZR    bt    None
────────────────────────── ────  ────  ────  ────  ────  ────  ────  ────  ────
Bar data (OHLCV)           YES   YES   YES   YES   YES   YES   YES   YES   YES
Quote ticks (L1)           YES   NO    NO    YES   NO    NO    NO    NO    NO
Order book (L2/L3)         YES   NO    NO    YES   NO    NO    NO    NO    NO
Multiple timeframes        YES   YES   YES   YES   NO    YES   YES   NO    YES
Custom data formats        YES   YES   YES   LIM   YES   NO    NO    YES   YES
```

### Order Types

```
Feature                    NT    VBT   btpy  LEAN   BT    FT    ZR    bt    None
────────────────────────── ────  ────  ────  ────  ────  ────  ────  ────  ────
Market orders              YES   YES   YES   YES   YES   YES   YES   YES   DIY
Limit orders               YES   YES   YES   YES   YES   YES   YES   YES   DIY
Stop-loss                  YES   YES   NO    YES   NO    YES   YES   NO    DIY
Take-profit                YES   YES   NO    YES   NO    YES   NO    NO    DIY
Trailing stop              YES   NO    NO    YES   NO    YES   NO    NO    DIY
```

### Live Trading

```
Feature                    NT    VBT   btpy  LEAN   BT    FT    ZR    bt    None
────────────────────────── ────  ────  ────  ────  ────  ────  ────  ────  ────
Can place real orders       YES   NO    NO    YES   NO    YES   NO    NO    DIY
Broker adapters             YES   NO    NO    YES   NO    YES   NO    NO    DIY
Paper trading               YES   NO    NO    YES   NO    YES   NO    NO    DIY
Real-time data feed         YES   NO    NO    YES   NO    YES   NO    NO    DIY
Auto-reconnect              YES   NO    NO    YES   NO    YES   NO    NO    DIY
Indian market (NSE/BSE)     YES   NO    NO    NO    NO    NO    NO    NO    DIY
```

### Speed & Scale

```
Feature                    NT    VBT   btpy  LEAN   BT    FT    ZR    bt    None
────────────────────────── ────  ────  ────  ────  ────  ────  ────  ────  ────
Speed (5 stocks)           FAST  V.FAST MED   MED   SLOW  MED   SLOW  SLOW  VARIES
1000 param combos          SLOW  FAST  MED   FAST  MED   FAST  SLOW  SLOW  VARIES
Multi-stock broadcasting    NO    YES   NO    NO    NO    NO    NO    NO    DIY
Cloud optimization         NO    NO    NO    YES   NO    NO    NO    NO    NO
```

### Analytics

```
Feature                    NT    VBT   btpy  LEAN   BT    FT    ZR    bt    None
────────────────────────── ────  ────  ────  ────  ────  ────  ────  ────  ────
Built-in Sharpe/Sortino    YES   50+   30+   YES   LIM   YES   LIM   NO    DIY
Drawdown analysis          YES   YES   YES   YES   NO    YES   YES   NO    DIY
Trade-level stats          YES   YES   YES   YES   NO    YES   LIM   NO    DIY
Parameter optimizer        NO    YES   YES   YES   NO    YES   NO    NO    DIY
Heatmaps                   NO    YES   YES   NO    YES   NO    NO    NO    DIY
```

---

## 17. Hybrid Architecture (Recommended)

### The Two-Layer Approach

This is what professional quants actually do. **Two different tools for two different jobs.**

```
┌──────────────────────────────────────────────────────────────────┐
│                      YOUR TRADING PIPELINE                        │
│                                                                    │
│                                                                    │
│  STAGE 1: IDEAS                                                   │
│  ────────────────                                                  │
│  "I think ORB with 45-min range and 1.2% TP might work"           │
│       │                                                            │
│       ▼                                                            │
│  STAGE 2: SCREEN (VectorBT)                                       │
│  ─────────────────────────                                         │
│  ┌──────────────────────────────────────────────┐                 │
│  │  Test on 500 stocks x 20 parameter combos   │                 │
│  │  = 10,000 backtests                         │                 │
│  │                                               │                 │
│  │  Input: 500 stocks, params grid              │                 │
│  │  Output: Ranked list of (stock, params)       │                 │
│  │  Speed: ~2 seconds                           │                 │
│  │  Accuracy: Good enough for filtering         │                 │
│  └──────────────────┬───────────────────────────┘                 │
│                     │                                               │
│                     │  Top 10 picks                                  │
│                     ▼                                               │
│  STAGE 3: BACKTEST (NautilusTrader)                                │
│  ──────────────────────────────────────                             │
│  ┌──────────────────────────────────────────────┐                 │
│  │  Accurate simulation for 10 stocks          │                 │
│  │                                               │                 │
│  │  Input: Top 10 (stock, params) from screen   │                 │
│  │  Output: Verified trade list with fills      │                 │
│  │  Speed: ~6 seconds                           │                 │
│  │  Accuracy: High (simulated exchange)          │                 │
│  └──────────────────┬───────────────────────────┘                 │
│                     │                                               │
│                     │  Top 3 verified                                │
│                     ▼                                               │
│  STAGE 4: LIVE (NautilusTrader)                                     │
│  ────────────────────────────                                       │
│  ┌──────────────────────────────────────────────┐                 │
│  │  Trade real money on exchange               │                 │
│  │  Same code as backtest, just connected       │                 │
│  │  to live data feed + broker API              │                 │
│  └──────────────────────────────────────────────┘                 │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Why This Works

```
                         SPEED          ACCURACY        LIVE TRADING
                         ─────          ────────        ────────────

VectorBT (screen)        ████████████   ██████          ✗
NautilusTrader (verify)  ████           ████████████    ✓

Use the fast tool to throw away bad ideas quickly.
Use the accurate tool to verify the good ideas thoroughly.
Use the live-capable tool to trade the verified ideas.
```

### What This Means for Alphashri

```
CURRENT STATE:
──────────────
  User clicks "Run Backtest" on 5 stocks
       │
       ▼
  NautilusTrader runs all 5 stocks (~0.6s)
       │
       ▼
  Results shown to user

  This is fine for 5 stocks. But if the user wants to screen
  500 stocks with 20 parameter combos = 10,000 backtests...
  
  10,000 x 0.6s = 100 minutes. Nobody waits 100 minutes.


RECOMMENDED STATE:
──────────────────
  User clicks "Screen Stocks" on 500 stocks
       │
       ▼
  VectorBT runs all 10,000 combos (~2 seconds)
       │
       ▼
  Top 10 results shown to user

  User clicks "Run Backtest" on top 5
       │
       ▼
  NautilusTrader runs 5 stocks accurately (~0.6s)
       │
       ▼
  Verified results shown to user
  
  Total time: ~3 seconds instead of 100 minutes.
```

---

## 18. Migration Guide

### Should You Switch from NautilusTrader?

```
NO, if:
  ✗ You plan to go live eventually
  ✗ You already have strategy code written
  ✗ You need accurate fills for your edge case
  ✗ You're happy with current speed

YES, consider adding VectorBT alongside, if:
  ✓ You want to screen 100+ stocks
  ✓ You want parameter sweeps
  ✓ Your strategies can be expressed as entry/exit signals
  ✓ Speed matters for user experience
```

### The Safe Approach (What We Recommend)

```
DON'T replace NautilusTrader.
DO add VectorBT as a screening layer.

Phase 1: Add VectorBT for screening
  ├── New file: backtest/screening.py
  ├── Uses VectorBT for fast results
  ├── Returns same format as existing backtest
  └── Effort: 2-3 days

Phase 2: Add screening API endpoint
  ├── New route: /api/backtest/screen
  ├── Uses VectorBT for speed
  └── Effort: 1 day

Phase 3: Route based on request type
  ├── "Run Backtest" → NautilusTrader (accurate)
  ├── "Screen Stocks" → VectorBT (fast)
  └── "Optimize" → VectorBT (fast), then NautilusTrader (validate)

  NautilusTrader code stays UNTOUCHED. Zero risk.
```

### Cost-Benefit Summary

```
Approach                         Effort    Speed    Accuracy    Risk
───────────────────────────────  ──────    ─────    ────────    ────
Status quo (NT only)             0 days    0.6s     High        None
Add sort optimization            0.5 day   0.57s    Same        Very low
Add batch engine                 0.5 day   0.57s    Same        Very low
Add VectorBT screening          2-3 days   0.05s    Good*       Low
Replace NT with VectorBT         5-10 days  0.05s    Lower       Medium
Replace NT with LEAN             20+ days  ~0.6s    High        High

*Good for screening. Use NautilusTrader for final validation.
```
