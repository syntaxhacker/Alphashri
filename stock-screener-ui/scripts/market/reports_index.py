#!/usr/bin/env python3
"""Build a single static index for every HTML artifact under ``reports/``.

The registry below is intentionally explicit: a card carries the human title,
why the artifact exists, its session and source window, and every page that
belongs to it. Anything found on disk but missing from the registry is still
published (in the "Raw / other" group) so the index can never silently omit a
report. ``--check`` re-parses the generated page and proves every href resolves
and every discovered HTML file is linked.

Usage:
    .venv/bin/python scripts/market/reports_index.py
    .venv/bin/python scripts/market/reports_index.py --check
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / "reports"
OUTPUT = REPORTS / "index.html"
IST = ZoneInfo("Asia/Kolkata")

GROUPS = {
    "index": ("Index / expiry research", "Expiry-day books and index-level studies."),
    "stock": ("Single-stock research", "One name at a time — trade reconstructions and per-stock edges."),
    "eda": ("Earnings / EDA / event studies", "Fundamentals, volume, event windows and cross-asset session work."),
    "options": ("Options / flow / scans", "Option research, order-flow scans, wall books and the courses around them."),
    "other": ("Raw / other", "Futures backtests, visual audits and artifacts outside the four buckets."),
}

BADGES = {
    "main": ("MAIN", "Primary assembled report for the artifact"),
    "session": ("SESSION", "Evidence from one recorded session"),
    "research": ("RESEARCH", "Multi-session study, not a single print"),
    "backtest": ("BACKTEST", "Historical simulation — no live fills"),
    "paper": ("PAPER", "Live-simulation / paper-trading replay"),
    "scan": ("SCAN", "Market scan or order-flow measurement"),
    "course": ("COURSE", "Explainer or teaching material"),
    "tool": ("TOOL", "Visual or sizing utility, not a market claim"),
    "partial": ("PARTIAL", "The data window is incomplete — read the limits"),
    "missing": ("MISSING", "A companion artifact or archive named in the plan is absent"),
    "nofut": ("NO FUTURES", "No futures archive exists for this session"),
    "nosensex": ("NO SENSEX", "No SENSEX tape or chain exists for this session"),
    "fragile": ("FRAGILE", "The author flags the result as not robust"),
}


def link(path: str, label: str) -> dict:
    return {"path": path, "label": label}


def card(
    slug: str,
    group: str,
    title: str,
    purpose: str,
    session: str,
    window: str,
    links: list[dict],
    badges: tuple[str, ...] = (),
    note: str = "",
) -> dict:
    return {
        "slug": slug,
        "group": group,
        "title": title,
        "purpose": purpose,
        "session": session,
        "window": window,
        "links": links,
        "badges": badges,
        "note": note,
    }


CARDS = [
    card(
        "nifty-2026-11-17",
        "index",
        "NIFTY 0-DTE — 2026-11-17",
        "Expiry-day flow, positioning, futures, volatility, replay, 3D surface and the assembled research page.",
        "Tue 2026-11-17 · NSE expiry day",
        "10s chain 09:15:31–14:09:03 · tape 09:15–14:07:49 · futures file to 15:39; every page is clipped at 14:09",
        [
            link("nifty_2026-11-17/07-research.html", "07 · Research — main page"),
            link("nifty_2026-11-17/01-flow.html", "01 · Flow"),
            link("nifty_2026-11-17/02-positioning.html", "02 · Positioning"),
            link("nifty_2026-11-17/03-futures.html", "03 · Futures"),
            link("nifty_2026-11-17/04-volatility.html", "04 · Volatility"),
            link("nifty_2026-11-17/05-replay.html", "05 · Replay"),
            link("nifty_2026-11-17/06-3d.html", "06 · 3D surface"),
            link("nifty_2026-11-17/research/pin_gamma.html", "Pin / gamma"),
            link("nifty_2026-11-17/research/participant_flow.html", "Participant flow"),
            link("nifty_2026-11-17/research/vol_decay.html", "Vol / decay"),
            link("nifty_2026-11-17/research/futures_cross.html", "Futures / cross-market"),
            link("nifty_2026-11-17/research/intraday_anatomy.html", "17-leg anatomy"),
            link("nifty_2026-11-17/research/intraday_anatomy_preview.html", "Anatomy wrapper"),
            link("nifty_2026-11-17/index.html", "Folder index (legacy)"),
        ],
        ("main", "session", "partial"),
        "The chain and tape stop at 14:09:03; later futures prints are not used and no value is extrapolated.",
    ),
    card(
        "nifty-tape-2026-11-18",
        "index",
        "NIFTY tape review — 2026-11-18",
        "Two-layer review of one normal-expiry NIFTY tape: a plain-English read, the exact quant evidence, 2D/3D flow and a data-quality ledger.",
        "Wed 2026-11-18 · NSE session · 23 Nov expiry",
        "Tape 09:15:54–15:39:50 · snapshots 380/385 · 10s chain 3,262 frames · spot frozen from 15:15",
        [
            link("nifty_2026-11-18/07-tape-review.html", "07 · Tape review — main page"),
        ],
        ("main", "session", "partial"),
        "Five full snapshots are missing; the 09:15 tape row is a 30-strike backfill. Official 1-minute bars differ from tape LTP by a few points; both are shown.",
    ),
    card(
        "nifty-2026-10-27",
        "index",
        "NIFTY 0-DTE — 2026-10-27",
        "Expiry-day research with a real closing print: pin, participant flow, vol decay, 24-leg anatomy and quant review.",
        "Tue 2026-10-27 · NSE expiry day",
        "Tape / chain 10:04:12–15:29:59 · recording starts 49 minutes after the open · 12:18–12:37 blackout",
        [
            link("nifty_2026-10-27/07-research.html", "07 · Research — main page"),
            link("nifty_2026-10-27/research/pin_gamma.html", "Pin / gamma"),
            link("nifty_2026-10-27/research/participant_flow.html", "Participant flow"),
            link("nifty_2026-10-27/research/vol_decay.html", "Vol / decay"),
            link("nifty_2026-10-27/research/intraday_anatomy.html", "24-leg anatomy"),
            link("nifty_2026-10-27/research/intraday_anatomy_preview.html", "Anatomy wrapper"),
            link("nifty_2026-10-27/index.html", "Folder index (legacy)"),
        ],
        ("main", "session", "partial", "nofut", "nosensex"),
        "No futures archive and no SENSEX archive — basis, futures OI and cross-market divergence are not measurable.",
    ),
    card(
        "expiry-2026-10-06",
        "index",
        "Nifty weekly expiry EDA — 2026-10-06",
        "Zone-by-zone autopsy of one weekly expiry with 5-second candles, OI and 57 chain snapshots.",
        "Tue 2026-10-06 · NSE NIFTY weekly expiry",
        "09:15–15:30 IST · 5s candles + 57 chain snapshots · 51,498 ticks · settlement 22,776.1",
        [link("EXPIRY_2026-10-06_EDA.html", "Open report")],
        ("session",),
    ),
    card(
        "nifty-today-2026-10-13",
        "index",
        "NIFTY expiry-day EDA — 2026-10-13",
        "Flat open, 09:15 washout, opening-range break and a trend day, reconstructed from price and the OI tape.",
        "Tue 2026-10-13 · NSE expiry day",
        "5m / 1m yfinance + own OI tape 12:04–15:20; there are no morning tape rows",
        [link("NIFTY_TODAY/NIFTY_TODAY_report.html", "Open report")],
        ("session", "partial"),
        "AM positioning is inferred from price because the OI tape starts at 12:04.",
    ),
    card(
        "nifty-entry-eda",
        "index",
        "NIFTY + SENSEX option-entry EDA — 14–15 Oct",
        "Where option entries should have been on two sessions, priced on fixed Fyers contracts with per-bar OI.",
        "Wed–Thu 2026-10-14 / 15",
        "5-minute candles + per-bar OI · 19-Oct weekly expiry · PCR / max pain / walls from the tape",
        [link("NIFTY_ENTRY_EDA/NIFTY_ENTRY_EDA_report.html", "Open report")],
        ("session",),
    ),
    card(
        "nifty-learning",
        "index",
        "Nifty options — the 60-session school",
        "What usually happens to Nifty options, with every claim re-tested on 60 sessions and failures kept visible.",
        "60 sessions through 2026-10-15",
        "5-minute bars + India VIX · original 20-session claims re-run on the full 60",
        [link("NIFTY_LEARNING/NIFTY_LEARNING_report.html", "Open report")],
        ("research",),
    ),
    card(
        "nifty-timing",
        "index",
        "NIFTY option-buying timing EDA",
        "Twenty sessions of intraday entry windows; no 30-minute window shows a real long-ATM edge.",
        "2026-09-10 → 2026-10-12 · 20 sessions",
        "5-minute ^NSEI bars + India VIX · master-recomputed from primary bars",
        [link("NIFTY_TIMING/NIFTY_TIMING_report.html", "Open report")],
        ("research",),
    ),
    card(
        "nifty-breadth",
        "index",
        "Nifty breadth edge",
        "Do the 50 Nifty constituents predict the index? A 5-minute breadth test across 31 sessions.",
        "2026-09-04 → 2026-10-15 · 31 sessions",
        "5-minute breadth across all 50 constituents · 10:30 breadth vs Nifty location",
        [link("NIFTY_BREADTH_EDGE/NIFTY_BREADTH_EDGE_report.html", "Open report")],
        ("research",),
    ),
    card(
        "in-strategies",
        "index",
        "NIFTY strategies — honest showcase",
        "Thirty-six strategy concepts pushed through IS/OOS, placebo and cost gates; zero proven winners survive.",
        "Generated 2026-10-17 · NIFTY 50",
        "Real Indian F&O costs · untouched holdout block · lot size 65",
        [link("IN_STRATEGIES/SHOWCASE.html", "Open showcase")],
        ("backtest",),
    ),

    card(
        "irfc-90ce",
        "stock",
        "IRFC 90 CE — 2026-11-09 trade",
        "The 23-minute trade reconstruction plus a chain-level research note on what the tape proves.",
        "Mon 2026-11-09 · IRFC 90 CE · expiry 2026-11-23",
        "1-minute series from 09:15 IST · trade 14:47 → 15:09 · entry ₹0.47 → exit ₹0.72 (+53.2% gross) · note frozen 2026-11-18",
        [
            link("irfc_2026-11-09_90ce/trade.html", "Trade reconstruction (main)"),
            link("irfc_2026-11-09_90ce/research.html", "Research note — chain context"),
        ],
        ("main", "session"),
    ),
    card(
        "prerange",
        "stock",
        "Pre-range fade — 13 US tickers",
        "Identical pre-market fade rules across thirteen US names, with a cross-ticker ranking and three exit variants.",
        "Generated 2026-10-13 · US sessions",
        "Set A 6mo/1h · Set B 60d/5m · Set C 1y/1h · pre-market range → 12:30 exit · no costs or slippage",
        [
            link("PRERANGE_COMPARE/PRERANGE_COMPARE_report.html", "Cross-ticker ranking (main)"),
            link("PRERANGE_AAPL/AAPL_prerange_report.html", "AAPL"),
            link("PRERANGE_AMD/AMD_prerange_report.html", "AMD"),
            link("PRERANGE_AMZN/AMZN_prerange_report.html", "AMZN"),
            link("PRERANGE_AVGO/AVGO_prerange_report.html", "AVGO"),
            link("PRERANGE_GOOGL/GOOGL_prerange_report.html", "GOOGL"),
            link("PRERANGE_META/META_prerange_report.html", "META"),
            link("PRERANGE_MSFT/MSFT_prerange_report.html", "MSFT"),
            link("PRERANGE_MU/MU_prerange_report.html", "MU"),
            link("PRERANGE_NVDA/NVDA_prerange_report.html", "NVDA"),
            link("PRERANGE_RKLB/RKLB_prerange_report.html", "RKLB"),
            link("PRERANGE_STX/STX_prerange_report.html", "STX"),
            link("PRERANGE_TSLA/TSLA_prerange_report.html", "TSLA"),
            link("PRERANGE_WDC/WDC_prerange_report.html", "WDC"),
        ],
        ("backtest",),
    ),
    card(
        "netweb-timeframe",
        "stock",
        "NETWEB timeframe edge",
        "Monte-Carlo random-entry study of which holding period actually pays on NETWEB.",
        "588 sessions (2025 → Aug 2026)",
        "Overnight vs intraday holding periods · 655 random-entry trades · regime split",
        [link("NETWEB_TIMEFRAME_EDGE/NETWEB_timeframe_edge.html", "Open report")],
        ("research",),
    ),
    card(
        "hal-weekly",
        "stock",
        "HAL weekly review — 10–14 Aug 2026",
        "HAL's week in one page: price, volume, levels and the outlook for the following week.",
        "Week 10–14 Aug 2026 · generated 2026-08-16",
        "Daily / weekly Upstox + Yahoo (HAL.NS) · close ₹5,029.9 · 6th straight positive week",
        [link("HAL_EDA/HAL_weekly_review.html", "Open weekly review")],
        ("research",),
    ),
    card(
        "sndk-strategy",
        "stock",
        "SNDK pre-range fade — gallery + exit study",
        "SNDK fade signals charted on 5-minute bars, including a filtered-out live session and the exit study.",
        "2026-10-15 · SNDK (partial session)",
        "5-minute bars, last 60 days · pre-market 1–5% filter · session still open at 10:35 ET",
        [link("SNDK_STRATEGY/SNDK_STRATEGY_report.html", "Open gallery")],
        ("backtest", "partial"),
    ),

    card("ather-eda", "eda", "ATHERENERG EDA", "Volume, big-player and fundamentals EDA for ATHERENERG.",
         "Daily 2025-05-06 → 2026-08-14 · 319 sessions",
         "Upstox V3 candles + yfinance earnings, ownership and analyst data · 1-minute bars from 2025",
         [link("ATHERENERG_EDA/ATHERENERG_EDA_report.html", "Open EDA")], ("research",)),
    card("cie-eda", "eda", "CIEINDIA EDA", "Volume, big-player and fundamentals EDA for CIEINDIA.",
         "Daily 2020-01-01 → 2026-08-14 · 1,645 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("CIEINDIA_EDA/CIEINDIA_EDA_report.html", "Open EDA")], ("research",)),
    card("durlax-eda", "eda", "DURLAX EDA", "Volume, big-player and fundamentals EDA for DURLAX.",
         "Daily 2025-06-03 → 2026-08-14 · 287 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("DURLAX_EDA/DURLAX_EDA_report.html", "Open EDA")], ("research",)),
    card("flysbs-eda", "eda", "FLYSBS EDA", "Volume, big-player and fundamentals EDA for FLYSBS.",
         "Daily 2025-08-08 → 2026-08-14 · 251 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("FLYSBS_EDA/FLYSBS_EDA_report.html", "Open EDA")], ("research",)),
    card("hal-eda", "eda", "HAL EDA", "Volume, big-player and fundamentals EDA for HAL.",
         "Daily 2020-01-01 → 2026-08-14 · 1,645 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("HAL_EDA/HAL_EDA_report.html", "Open EDA")], ("research",)),
    card("hindzinc-eda", "eda", "HINDZINC EDA", "Volume, big-player and fundamentals EDA for HINDZINC.",
         "Daily 2020-01-01 → 2026-08-14 · 1,645 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("HINDZINC_EDA/HINDZINC_EDA_report.html", "Open EDA")], ("research",)),
    card("kennamet-eda", "eda", "KENNAMET EDA", "Volume, big-player and fundamentals EDA for KENNAMET.",
         "Daily 2026-04-20 → 2026-08-14 · 82 sessions",
         "Upstox V3 candles + yfinance · short listing history called out in the report",
         [link("KENNAMET_EDA/KENNAMET_EDA_report.html", "Open EDA")], ("research",)),
    card("netweb-eda", "eda", "NETWEB EDA", "Volume, big-player and fundamentals EDA for NETWEB Technologies.",
         "Daily Jul 2023 → Aug 2026 · 757 sessions",
         "Upstox V3 candles + yfinance · 142,560 one-minute bars / 381 sessions · 11 quarters",
         [link("NETWEB_EDA/NETWEB_EDA_report.html", "Open EDA")], ("research",)),
    card("reltd-eda", "eda", "RELTD EDA", "Volume, big-player and fundamentals EDA for RELTD.",
         "Daily 2024-07-30 → 2026-08-14 · 508 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("RELTD_EDA/RELTD_EDA_report.html", "Open EDA")], ("research",)),
    card("saatvik-eda", "eda", "SAATVIKGL EDA", "Volume, big-player and fundamentals EDA for SAATVIKGL.",
         "Daily 2025-09-26 → 2026-08-14 · 218 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("SAATVIKGL_EDA/SAATVIKGL_EDA_report.html", "Open EDA")], ("research",)),
    card("suzlon-eda", "eda", "SUZLON EDA", "Volume, big-player and fundamentals EDA for SUZLON.",
         "Daily 2020-01-01 → 2026-08-14 · 1,645 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("SUZLON_EDA/SUZLON_EDA_report.html", "Open EDA")], ("research",)),
    card("zaggle-eda", "eda", "ZAGGLE EDA", "Volume, big-player and fundamentals EDA for ZAGGLE.",
         "Daily 2023-09-22 → 2026-08-14 · 718 sessions",
         "Upstox V3 candles + yfinance · 1-minute bars from 2025",
         [link("ZAGGLE_EDA/ZAGGLE_EDA_report.html", "Open EDA")], ("research",)),
    card(
        "preposition-eda",
        "eda",
        "Pre-position EDA — IRFC, POWERGRID",
        "Probabilistic pre-position briefs for two names: trend, cycle legs, option-implied range and target-date buckets.",
        "Data through 2026-11-18 · target close 2026-11-23",
        "Upstox daily + current session · live option chains · yfinance valuation",
        [link("eda_2026-11-23/eda_report.html", "Open EDA")],
        ("research",),
    ),
    card(
        "bulk-deals",
        "eda",
        "NSE bulk deals — forward-move EDA",
        "Forward returns after large institutional bulk and block deals, measured without a tradable-edge claim.",
        "2026-09-17 → 2026-09-30 · 10 sessions",
        "NSE archive API · ₹20 Cr threshold · 866 deduped deals / 46 evaluated events",
        [link("bulk_deals_eda/eda_report.html", "Open EDA")],
        ("research",),
    ),
    card(
        "session-corr",
        "eda",
        "Session correlation — which follows what?",
        "Asia, Europe, NY and overnight session correlations for ES and NQ.",
        "2026-07-01 → 2026-08-29 · 42 trading days",
        "yfinance ES=F / NQ=F 1-hour ET · Pearson and Spearman on session returns",
        [link("SESSION_CORR_EDA/report.html", "Open EDA")],
        ("research",),
    ),
    card(
        "es-nq-eda",
        "eda",
        "ES & NQ futures session EDA",
        "Two-week session EDA for ES and NQ with key levels, weekly performance and a Monday gameplan.",
        "2026-08-17 → 2026-08-29 · CME sessions in ET",
        "yfinance ES=F / NQ=F 1-hour bars · fetched 2026-08-30",
        [
            link("ES_NQ_EDA/es_nq_eda_report.html", "Session EDA (main)"),
            link("ES_NQ_EDA/monday_echarts.html", "Monday levels (ECharts)"),
        ],
        ("session",),
    ),

    card(
        "wall-replay",
        "options",
        "NIFTY wall replay — live book + historical validation",
        "Wall-to-wall NIFTY replay across the live October book, a 162-session archive and a premium-selling test.",
        "Live 13–30 Oct 2026 · archive Apr 2025–Mar 2026",
        "1-minute chain · 162 complete-chain sessions · one lot · v3.14 engine",
        [
            link("WALL_REPLAY/report/WALL_REPLAY_report.html", "Wall replay — v3.14 (main)"),
            link("WALL_REPLAY/hist/HISTORICAL_RUN.html", "Historical validation"),
            link("WALL_REPLAY/hist/IMPROVED.html", "Wall fade — IS / OOS"),
            link("WALL_REPLAY/hist/TRADES.html", "21 wall-fade trades"),
            link("WALL_REPLAY/premium/PREMIUM_SELLING.html", "Premium selling"),
            link("WALL_REPLAY/premium/PREMIUM_TRADES.html", "158 premium trades"),
        ],
        ("backtest",),
    ),
    card(
        "options-101",
        "options",
        "Options 101 — why you sell, not buy",
        "Every core options structure explained from zero with the real maths and real NIFTY prices.",
        "Real NIFTY prices · companion to the W16 options study",
        "Five sections: concepts, single leg, multi-leg, evidence, real two-day replay",
        [
            link("OPTIONS_101/OPTIONS_101_report.html", "Full report (main)"),
            link("OPTIONS_101/sections/01_concepts_math.html", "01 · Concepts & maths"),
            link("OPTIONS_101/sections/02_single_leg.html", "02 · Single leg"),
            link("OPTIONS_101/sections/03_multi_leg.html", "03 · Multi-leg"),
            link("OPTIONS_101/sections/04_evidence.html", "04 · Evidence"),
            link("OPTIONS_101/sections/05_real_2days.html", "05 · Real two days"),
        ],
        ("course",),
    ),
    card(
        "greeks-course",
        "options",
        "Options buying course — zero to first paper trade",
        "A beginner course built on real Nifty expiry tape, with a live greeks and theta playground.",
        "Self-paced · real Nifty expiry tape",
        "Foundations, Greeks, spot engine and timing · 6 Oct 2026 examples",
        [link("options_greeks_course.html", "Open course")],
        ("course",),
    ),
    card(
        "course-chapters",
        "options",
        "Options foundations — four chapters",
        "Short-form course chapters: what an option is, the Greeks, spot as the engine, and when buying is right.",
        "Self-paced · NIFTY examples",
        "Four standalone chapters with the 75-lot example and event timing",
        [
            link("course/01-foundations.html", "01 · Foundations"),
            link("course/02-greeks.html", "02 · The Greeks"),
            link("course/03-spot.html", "03 · Spot is the engine"),
            link("course/04-timing.html", "04 · When buying is right"),
        ],
        ("course",),
    ),
    card(
        "buy-check",
        "options",
        "Does option buying make money? — a data check",
        "Tests the 'premiums rose, so buying made money' claim on real quotes, plus a nine-year intraday buyer search.",
        "15–16 Oct 2026 · front expiry 19 Oct",
        "Real NIFTY quotes + 479 weekly cycles · 269 entry rules × 6 exits · 60 real trades · 925,445 quotes",
        [
            link("OPTIONS_101_BUY_CHECK/OPTIONS_BUY_CHECK.html", "Two-day check (main)"),
            link("OPTIONS_101_BUY_CHECK/intraday/INTRADAY_BUYERS.html", "Intraday buyers"),
            link("OPTIONS_101_BUY_CHECK/intraday/OPTION_BUYING_EDGE.html", "Option-buying edge — no"),
        ],
        ("research",),
    ),
    card(
        "buy-edge-2",
        "options",
        "Where is option buying profitable?",
        "Five years of real NSE option rows on where buying pays and what makes premiums too expensive.",
        "2020-04-13 → 2025-04-30 · plus 2026 intraday tape",
        "2,419,767 option rows · 263 expiries · 96 sessions / 35,855 real trades · half-spread and slippage charged",
        [link("OPTIONS_BUY_EDGE_2/BUY_EDGE_RESEARCH.html", "Open research")],
        ("research",),
    ),
    card(
        "paper-sim-aug",
        "options",
        "Options paper simulation — 17–21 Aug 2026",
        "Live-simulation replay of the options paper book: daily P&L, per-strategy equity and expiry payoff.",
        "2026-08-17 → 2026-08-21 · 5 sessions",
        "Intraday exits · expiry payoff is structural, gross of costs",
        [link("OPTIONS_PAPER_SIM/2026-08-17_2026-08-21/index.html", "Open replay")],
        ("paper",),
    ),
    card(
        "paper-sim-sep",
        "options",
        "Options paper simulation — 21–25 Sep 2026",
        "Live-simulation replay of the options paper book: daily P&L, per-strategy equity and expiry payoff.",
        "2026-09-21 → 2026-09-25 · 5 sessions",
        "Intraday exits · expiry payoff is structural, gross of costs",
        [link("OPTIONS_PAPER_SIM/2026-09-21_2026-09-25/index.html", "Open replay")],
        ("paper",),
    ),
    card(
        "real-5y",
        "options",
        "Real NIFTY option premiums — 2020–2025",
        "What actually pays using recorded NSE premiums and published settlements, plus a 1σ short-strangle hold.",
        "2020 → 2025 · 1,246 trading days · 283 expiries",
        "2,419,767 option rows · no Black-Scholes premium · real settlements · costs included",
        [
            link("OPTIONS_REAL_5Y/OPTIONS_REAL_5Y.html", "Premiums study (main)"),
            link("OPTIONS_REAL_5Y/SELL_STRANGLE_TRADES.html", "Short strangle — 2020–2025"),
        ],
        ("research",),
    ),
    card(
        "rr-playbook",
        "options",
        "Options buying sandbox — capital, R:R, charges",
        "Interactive sizing sandbox for NSE index options with Dhan-modelled charges and a monthly planner.",
        "Rates as of Oct 2026 · NSE index options",
        "Broker charges, lot size and R:R arithmetic · no market edge claimed",
        [link("OPTIONS_RR_PLAYBOOK/OPTIONS_RR_PLAYBOOK.html", "Open sandbox")],
        ("tool",),
    ),
    card(
        "tv-relvol",
        "options",
        "NSE relative-volume edge — fade rule & watchlists",
        "What happens after a rel-vol explosion: the short fade, a regime filter, a long hunt and next-day lists.",
        "1,939 spikes · Oct 2025 → Oct 2026",
        "NSE daily bars + 5-minute Upstox timing · OLHC open→close returns · bootstrap CIs",
        [
            link("TV_SCAN_RELVOL/RELVOL_EDGE_report.html", "Rel-vol edge (main)"),
            link("TV_SCAN_RELVOL/REGIME_RULE.html", "Regime filter — v2"),
            link("TV_SCAN_RELVOL/WATCHLIST_TOMORROW.html", "Next-day watchlist"),
            link("TV_SCAN_RELVOL/muse_long_hunt/LONG_HUNT_report.html", "Long hunt"),
            link("TV_SCAN_RELVOL/muse_symbols/SYMBOLS_report.html", "Ten symbols"),
            link("TV_SCAN_RELVOL/muse_timing/TIMING_report.html", "Entry / exit timing"),
        ],
        ("scan", "research"),
    ),
    card(
        "heatmap-concepts",
        "options",
        "Heatmap concepts — pick one",
        "Six heatmap treatments of the same 12-sector × 14-stock grid, with screen and export trade-offs.",
        "Design study · Nov 2026",
        "1600×900 @150 dpi · dark theme · same palette anchors in every variant",
        [link("heatmap_concepts/index.html", "Open concepts")],
        ("tool",),
    ),
    card(
        "heatmap-colormaps",
        "options",
        "Colormap gallery — pick a ramp",
        "Seventeen colormaps applied to the same signed grid, recommended for screen, CVD and export.",
        "Design study · Nov 2026",
        "12-sector × 14-stock grid · 1600×900 @150 dpi · 162-cell label test",
        [link("heatmap_colormaps/index.html", "Open gallery")],
        ("tool",),
    ),
    card(
        "patterns-visual",
        "options",
        "Chart patterns — visual audit",
        "One real detected hit per pattern, drawn on Upstox V3 candles with detector boundaries.",
        "Sample through 2026-10-01",
        "Upstox V3 candles · one hit per pattern · real detector trendlines",
        [link("patterns_visual/index.html", "Open audit")],
        ("tool",),
    ),

    card(
        "mnq-ict",
        "other",
        "MNQ ICT setups — sweep → iFVG → LRL",
        "Liquidity-sweep research across versions, October setups and winner/loser showcases.",
        "MNQ RTH 1-min Jan–Apr 2026 · October 2026 setups",
        "1-minute MNQ · sweep → displacement FVG → LRL target · v1–v3 variants",
        [
            link("MNQ_ICT_SETUPS/MNQ_ICT_SETUPS_report.html", "Main report (1–9 min)"),
            link("MNQ_ICT_SETUPS/oct2026/OCT2026.html", "Oct 2026 — all 313 setups"),
            link("MNQ_ICT_SETUPS/oct13like/OCT13LIKE.html", "Oct-13-like — 24 W / 24 L"),
            link("MNQ_ICT_SETUPS/oct13trades/OCT13_TRADES.html", "Oct-13 trades"),
            link("MNQ_ICT_SETUPS/best/BEST_CANDIDATE.html", "Best candidate"),
            link("MNQ_ICT_SETUPS/v1/MNQ_ICT_SETUPS_report_v1.html", "v1 report"),
            link("MNQ_ICT_SETUPS/v2/MNQ_ICT_SETUPS_report_v2.html", "v2 report"),
            link("MNQ_ICT_SETUPS/v2/MNQ_ICT_SETUPS_demo.html", "v2 demo"),
            link("MNQ_ICT_SETUPS/v3/V3_STRATEGY.html", "v3 strategy"),
            link("MNQ_ICT_SETUPS/v3/V3_BREAKOUT_report.html", "v3 breakout — Oct 2026"),
            link("MNQ_ICT_SETUPS/v3/LRL_REFINED_report.html", "LRL refined — 60 days"),
            link("MNQ_ICT_SETUPS/v3/LRL_LAST10D_report.html", "LRL last 10 days"),
            link("MNQ_ICT_SETUPS/v3/STRATEGY_SHOWCASE.html", "Strategy showcase"),
        ],
        ("backtest", "fragile"),
    ),
    card(
        "mnqu6-trade-review",
        "other",
        "MNQU6 trade review — Performance.csv",
        "Baseline review of the 66-trade MNQU6 log with P&L, win rate, profit factor and a yfinance overlay.",
        "2026-08-27 13:53 → 2026-09-02 14:03 ET · 66 trades",
        "Performance.csv · MNQU6 tick $0.25 · NQ=F 5m ET overlay",
        [link("MNQU6_TRADE_REVIEW/report.html", "Open review")],
        ("backtest",),
    ),
    card(
        "mnqu6-deep",
        "other",
        "MNQU6 deep review — every trade",
        "All 66 trades reviewed three to four at a time by sixteen agents, with the halt window checked.",
        "2026-08-27 13:53 → 2026-09-02 14:03 ET · 66 trades",
        "16 parallel agents · yfinance NQ=F 5m ET · 17:00–18:00 halt verified",
        [link("MNQU6_DEEP_REVIEW/report.html", "Open deep review")],
        ("backtest",),
    ),
    card(
        "mnqu6-per-trade",
        "other",
        "MNQU6 — what we did vs what should be done",
        "Side-by-side candle charts for all 66 trades: the actual entry and the ideal handling of the same setup.",
        "2026-08-27 → 2026-09-02 ET · 66 trades",
        "NQ=F 1-minute ET · expanded VW side-by-side · 16 agents",
        [link("MNQU6_PER_TRADE_REVIEW/report.html", "Open per-trade review")],
        ("backtest",),
    ),
    card(
        "mnqu6-ideal",
        "other",
        "MNQU6 ideal backtest — 2pm IST",
        "The ideal bearish-bias handling of 2 Sep 2026 from 2pm IST, compared with the four actual afternoon trades.",
        "2026-09-02 12:00–17:00 IST",
        "NQ=F 1-minute · 5 ideal trades · +$1,224 ideal vs −$134 actual",
        [link("MNQU6_BACKTEST_IDEAL/report.html", "Open ideal backtest")],
        ("backtest",),
    ),
    card(
        "mnqu6-ideal-per-trade",
        "other",
        "MNQU6 ideal — per-trade charts",
        "The eight ideal trades charted one per page, with entries, stops, targets and R multiples.",
        "2026-09-02 12:00–17:00 IST",
        "NQ=F 1-minute · 8 ideal trades · 1.5–11R",
        [link("MNQU6_BACKTEST_IDEAL_PER_TRADE/report.html", "Open charts")],
        ("backtest",),
    ),
    card(
        "gold-range",
        "other",
        "Gold 6–7am ET range sweep",
        "The final 6–7am range-sweep rule, the summary that led to it and the repair notes where it leaks.",
        "2023-02-07 → 2026-10-06 · 125 trades",
        "XAUUSD 1-minute Dukascopy · $0.30/oz round-trip spread · P&L in R",
        [
            link("GOLD_6AM_RANGE/GOLD_6AM_RANGE_report.html", "Summary (main)"),
            link("GOLD_6AM_RANGE/FINAL_STRATEGY.html", "Final strategy"),
            link("GOLD_6AM_RANGE/REPAIR.html", "Repair notes"),
        ],
        ("backtest",),
    ),
    card(
        "smc-1min",
        "other",
        "SMC 1-minute — all candles, 5R hold",
        "Five full 24-hour NQ sessions with every one-minute candle and the SMC 5R-hold trades.",
        "2026-08-26 → 2026-09-01 · 5 sessions",
        "NQ=F 1-minute IST · 1,370 candles per session · range > 60 · 5R hold",
        [link("SMC_1MIN_RANDOM5/report.html", "Open report")],
        ("backtest",),
    ),
    card(
        "backtest-levels",
        "other",
        "ONH / ONL breakout backtest",
        "Overnight-high / overnight-low breakout test on ES and NQ with a 1R target and 16:00 flat.",
        "2026-06-01 → 2026-08-29",
        "yfinance 1-hour ES / NQ · 54 / 51 trades · first NY break · one trade per day",
        [
            link("BACKTEST_LEVELS/report.html", "Backtest (main)"),
            link("BACKTEST_LEVELS/trades_showcase.html", "Trade showcase"),
        ],
        ("backtest",),
    ),
    card(
        "orb-es",
        "other",
        "ES / MNQ opening-range breakout showcase",
        "Opening-range breakout backtests across weekly windows, random baselines and MNQ variants.",
        "Aug–Sep 2026 windows · ES / MNQ",
        "Per-window trade showcases · random-entry baselines · 1-minute futures",
        [
            link("ORB_ES_showcase/orb_es_showcase.html", "ES ORB showcase (main)"),
            link("ORB_ES_showcase/orb_this_week.html", "This week"),
            link("ORB_ES_showcase/orb_last_week.html", "Last week"),
            link("ORB_ES_showcase/orb_week_before.html", "Week before"),
            link("ORB_ES_showcase/orb_august_2026.html", "August 2026"),
            link("ORB_ES_showcase/orb_yesterday_2026-08-25.html", "2026-08-25"),
            link("ORB_ES_showcase/orb_random.html", "Random baseline"),
            link("ORB_ES_showcase/orb_netweb.html", "NETWEB"),
            link("ORB_ES_showcase/orb_netweb_random_baseline.html", "NETWEB random baseline"),
            link("ORB_ES_showcase/orb_netweb_80_random.html", "NETWEB 80 random"),
            link("ORB_ES_showcase/ict_mnq_showcase.html", "ICT/MNQ showcase"),
            link("ORB_ES_showcase/double_bottom_mnq.html", "Double bottom — MNQ"),
        ],
        ("backtest",),
    ),
    card(
        "es-nq-course",
        "other",
        "ES & NQ session-and-edge course",
        "Six-chapter course on how the CME day works, overnight edge, Europe's lean, the NY engine and weekly replay.",
        "Self-paced · ES / NQ 1-hour sessions",
        "Chapters 01–06 with GSAP demos · 2026 session examples",
        [
            link("ES_NQ_GSAP_COURSE/index.html", "Course index (main)"),
            link("ES_NQ_GSAP_COURSE/01-foundations.html", "01 · Foundations"),
            link("ES_NQ_GSAP_COURSE/02-overnight-edge.html", "02 · Overnight edge"),
            link("ES_NQ_GSAP_COURSE/03-europe-lean.html", "03 · Europe's lean"),
            link("ES_NQ_GSAP_COURSE/04-ny-rth-engine.html", "04 · NY RTH engine"),
            link("ES_NQ_GSAP_COURSE/05-correlation-beta.html", "05 · Correlation & beta"),
            link("ES_NQ_GSAP_COURSE/06-weekly-replay.html", "06 · Weekly replay"),
        ],
        ("course",),
    ),
]


def discover_html() -> list[Path]:
    return sorted(
        p for p in REPORTS.rglob("*.html") if p.is_file() and p.resolve() != OUTPUT.resolve()
    )


def file_title(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    for pattern in (r"<title[^>]*>(.*?)</title>", r"<h1[^>]*>(.*?)</h1>"):
        match = re.search(pattern, text, re.S | re.I)
        if match:
            value = re.sub(r"<[^>]+>", "", match.group(1))
            value = re.sub(r"\s+", " ", html.unescape(value)).strip()
            if value:
                return value[:120]
    return path.stem.replace("_", " ").replace("-", " ").title()


def auto_cards(registered: set[Path]) -> list[dict]:
    cards = []
    for path in discover_html():
        if path in registered:
            continue
        rel = path.relative_to(REPORTS).as_posix()
        written = datetime.fromtimestamp(path.stat().st_mtime, IST).strftime("%Y-%m-%d")
        cards.append(
            card(
                "auto-" + re.sub(r"[^a-z0-9]+", "-", rel.lower()).strip("-"),
                "other",
                file_title(path),
                "Artifact captured by the tree scan; its own page carries the scope and caveats.",
                f"File written {written}",
                f"File written {written} · no declared data window in the index registry",
                [link(rel, "Open artifact")],
                ("research",),
            )
        )
    return cards


CSS = """
:root{
  --bg:#000000;--surface:#13161C;--raised:#1F242D;--border:#2C313B;
  --text:#E8E8E8;--muted:#9B9B9B;--amber:#D9902A;--blue:#4A8FD8;
  --green:#2FA36B;--red:#E5606A;--violet:#8E80B8;--teal:#3B93AD;
  --yellow:#C9912F;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{background:var(--bg);color-scheme:dark}
body{
  margin:0;background:var(--bg);color:var(--text);
  font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
a{color:var(--blue);text-decoration:none}
a:hover{color:var(--amber);text-decoration:underline;text-underline-offset:2px}
.wrap{width:100%;max-width:1600px;margin:0 auto;padding:clamp(14px,2.4vw,32px)}
.eyebrow{
  margin:0 0 6px;color:var(--amber);font:600 10px/1.4 var(--mono);
  letter-spacing:.16em;text-transform:uppercase;
}
header.masthead{border-top:2px solid var(--amber);padding-top:18px}
h1{margin:0;font-size:clamp(26px,3.2vw,42px);line-height:1.05;letter-spacing:-.02em}
.lede{max-width:78ch;margin:10px 0 0;color:var(--muted);font-size:15px}
.stamp{
  margin-top:14px;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;
  font:11px/1.5 var(--mono);color:var(--muted);
}
.stamp b{color:var(--text);font-weight:600}
.stats{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:1px;margin:22px 0 0;background:var(--border);border:1px solid var(--border);
}
.stat{background:var(--surface);padding:12px 14px;min-width:0}
.stat span{display:block;color:var(--muted);font:600 9px/1.4 var(--mono);letter-spacing:.12em;text-transform:uppercase}
.stat strong{display:block;margin-top:3px;font:600 20px/1.1 var(--mono);color:var(--text)}
.jump{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}
.jump a{
  display:inline-flex;align-items:center;gap:8px;max-width:100%;
  border:1px solid var(--border);background:var(--surface);border-radius:4px;
  padding:6px 10px;color:var(--text);font-size:12px;line-height:1.3;
}
.jump a:hover{border-color:var(--amber);color:var(--amber);text-decoration:none}
.jump span{color:var(--muted);font:10px var(--mono)}
.legend{
  margin:24px 0 0;border:1px solid var(--border);background:var(--surface);
  padding:14px 16px;border-radius:6px;
}
.legend h2{margin:0 0 10px;font-size:13px;letter-spacing:.02em}
.legend-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px 18px}
.legend-item{display:flex;gap:8px;align-items:flex-start;min-width:0;color:var(--muted);font-size:12px}
.legend-item .badge{flex:0 0 auto;margin-top:1px}
.group{margin:34px 0 0;padding-top:18px;border-top:1px solid var(--border)}
.group-head{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end;justify-content:space-between;margin-bottom:14px}
.group-head h2{margin:0;font-size:21px;letter-spacing:-.01em}
.group-head p{margin:4px 0 0;color:var(--muted);font-size:13px;max-width:90ch}
.count{color:var(--muted);font:11px/1.5 var(--mono);white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,350px),1fr));gap:14px}
.card{
  min-width:0;display:flex;flex-direction:column;gap:10px;
  background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:15px 15px 14px;
}
.card-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.badges{display:flex;flex-wrap:wrap;gap:4px}
.badge{
  display:inline-block;border:1px solid var(--border);border-radius:3px;
  padding:1px 5px;font:600 9px/1.6 var(--mono);letter-spacing:.08em;
  color:var(--muted);white-space:nowrap;
}
.b-main{color:var(--amber);border-color:rgba(217,144,42,.45);background:rgba(217,144,42,.12)}
.b-session{color:var(--blue);border-color:rgba(74,143,216,.45);background:rgba(74,143,216,.10)}
.b-research{color:var(--teal);border-color:rgba(59,147,173,.45);background:rgba(59,147,173,.10)}
.b-backtest{color:var(--violet);border-color:rgba(142,128,184,.45);background:rgba(142,128,184,.10)}
.b-paper{color:var(--blue);border-color:rgba(74,143,216,.45);background:rgba(74,143,216,.10)}
.b-scan{color:var(--green);border-color:rgba(47,163,107,.45);background:rgba(47,163,107,.10)}
.b-course{color:var(--yellow);border-color:rgba(201,145,47,.45);background:rgba(201,145,47,.10)}
.b-tool{color:var(--muted);border-color:var(--border);background:var(--raised)}
.b-partial,.b-missing,.b-fragile,.b-nofut,.b-nosensex{color:var(--red);border-color:rgba(229,96,106,.45);background:rgba(229,96,106,.08)}
.b-missing{border-style:dashed}
.session{color:var(--muted);font:10px/1.5 var(--mono);overflow-wrap:anywhere}
.card h3{margin:0;font-size:16px;line-height:1.3}
.card h3 a{color:var(--text)}
.card h3 a:hover{color:var(--amber)}
.purpose{margin:0;color:#C4C4C4;font-size:13px;overflow-wrap:anywhere}
.meta{display:flex;flex-direction:column;gap:7px;margin:0}
.meta-row{display:grid;grid-template-columns:58px minmax(0,1fr);gap:8px;align-items:start}
.meta-row .k{color:var(--muted);font:600 9px/1.7 var(--mono);letter-spacing:.1em;text-transform:uppercase}
.meta-row .v{color:var(--text);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.links{display:flex;flex-wrap:wrap;gap:5px;margin-top:auto;padding-top:2px}
.links a{
  display:inline-block;max-width:100%;border:1px solid var(--border);border-radius:3px;
  background:var(--raised);padding:2px 7px;color:#C6D4E4;
  font:11px/1.6 var(--mono);overflow-wrap:anywhere;
}
.links a:first-child{border-color:rgba(217,144,42,.5);color:var(--amber)}
.links a:hover{border-color:var(--amber);color:var(--amber);text-decoration:none}
.note{
  margin:0;padding:7px 9px;border-left:2px solid var(--red);
  background:rgba(229,96,106,.06);color:var(--muted);font-size:11.5px;line-height:1.5;
}
footer{margin:38px 0 8px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:11.5px}
footer code{color:var(--text);font-family:var(--mono);font-size:11px}
@media (max-width:560px){
  .wrap{padding:12px}
  .card{padding:13px}
  .meta-row{grid-template-columns:1fr;gap:1px}
  .group-head{align-items:flex-start}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media print{
  body{background:#fff;color:#111}
  .card,.legend,.stat{background:#fff;border-color:#bbb}
  a{color:#0645ad}
}
"""


def badge_html(keys: tuple[str, ...]) -> str:
    out = []
    for key in keys:
        label, title = BADGES[key]
        out.append(f'<span class="badge b-{key}" title="{html.escape(title, quote=True)}">{label}</span>')
    return "".join(out)


def card_html(item: dict) -> str:
    links = item["links"]
    primary = links[0]["path"]
    chips = []
    for entry in links:
        href = html.escape(entry["path"], quote=True)
        chips.append(f'<a href="{href}">{html.escape(entry["label"])}</a>')
    note = f'<p class="note">{html.escape(item["note"])}</p>' if item["note"] else ""
    return f"""
<article class="card" id="card-{item['slug']}">
  <div class="card-top">
    <span class="badges">{badge_html(item['badges'])}</span>
    <span class="session" title="Session">{html.escape(item['session'])}</span>
  </div>
  <h3><a href="{html.escape(primary, quote=True)}">{html.escape(item['title'])}</a></h3>
  <p class="purpose">{html.escape(item['purpose'])}</p>
  <div class="meta">
    <div class="meta-row"><span class="k">Window</span><span class="v">{html.escape(item['window'])}</span></div>
  </div>
  <nav class="links" aria-label="Pages in {html.escape(item['title'], quote=True)}">{''.join(chips)}</nav>
  {note}
</article>"""


def render(cards: list[dict], generated: str, page_count: int, linked_count: int) -> str:
    group_stats = []
    for key, (name, desc) in GROUPS.items():
        members = [c for c in cards if c["group"] == key]
        pages = sum(len(c["links"]) for c in members)
        group_stats.append((key, name, desc, members, pages))

    nav = "".join(
        f'<a href="#g-{key}">{html.escape(name)} <span>{len(members)}</span></a>'
        for key, name, _desc, members, _pages in group_stats
    )
    sections = []
    for number, (key, name, desc, members, pages) in enumerate(group_stats, start=1):
        grid = "".join(card_html(c) for c in members)
        sections.append(
            f"""
<section class="group" id="g-{key}" aria-labelledby="h-{key}">
  <div class="group-head">
    <div>
      <p class="eyebrow">Group {number:02d}</p>
      <h2 id="h-{key}">{html.escape(name)}</h2>
      <p>{html.escape(desc)}</p>
    </div>
    <span class="count">{len(members)} cards · {pages} pages</span>
  </div>
  <div class="grid">{grid}</div>
</section>"""
        )

    legend = "".join(
        f'<div class="legend-item"><span class="badge b-{key}">{label}</span><span>{html.escape(title)}</span></div>'
        for key, (label, title) in BADGES.items()
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Reports index — every artifact under reports/</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<header class="masthead">
  <p class="eyebrow">Alphashri · research archive</p>
  <h1>Reports index</h1>
  <p class="lede">Every standalone research artifact under <code>reports/</code>, grouped so a session,
  a stock or a strategy can be found without hunting folders. Only files that actually exist are linked;
  incomplete data windows are labelled rather than smoothed over.</p>
  <div class="stamp">
    <span>Last generated <b>{html.escape(generated)}</b></span>
    <span><b>{len(cards)}</b> cards</span>
    <span><b>{page_count}</b> HTML pages</span>
    <span><b>{linked_count}</b> links verified</span>
  </div>
  <div class="stats">
    <div class="stat"><span>Artifacts</span><strong>{len(cards)}</strong></div>
    <div class="stat"><span>Pages</span><strong>{page_count}</strong></div>
    <div class="stat"><span>Groups</span><strong>{len(GROUPS)}</strong></div>
    <div class="stat"><span>Dead links</span><strong>0</strong></div>
  </div>
  <nav class="jump" aria-label="Report groups">{nav}</nav>
</header>

<section class="legend" aria-labelledby="legend-h">
  <h2 id="legend-h">Badge legend</h2>
  <div class="legend-grid">{legend}</div>
</section>

<main>{''.join(sections)}</main>

<footer>
  Generated by <code>scripts/market/reports_index.py</code>. Every href was resolved against the
  filesystem at build time; the page uses inline CSS only, with no external fonts, scripts or requests.
</footer>
</div>
</body>
</html>
"""


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []
        self.ids: set[str] = set()
        self.text: list[str] = []
        self.scripts = 0

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "a" and values.get("href"):
            self.hrefs.append(values["href"])
        if values.get("id"):
            self.ids.add(values["id"])
        if tag == "script":
            self.scripts += 1

    def handle_data(self, data):
        self.text.append(data)


def validate(page_count: int, expected_hrefs: int) -> tuple[list[str], dict]:
    errors: list[str] = []
    if not OUTPUT.is_file():
        return [f"{OUTPUT} does not exist"], {}
    parser = PageParser()
    parser.feed(OUTPUT.read_text(encoding="utf-8"))
    text = re.sub(r"\s+", " ", " ".join(parser.text)).strip()
    lowered = text.lower()
    for token in ("todo", "tbd", "fixme", "lorem ipsum", "placeholder"):
        if token in lowered:
            errors.append(f"placeholder token found: {token}")

    resolved: set[Path] = set()
    for href in parser.hrefs:
        if href.startswith("#"):
            if href[1:] not in parser.ids:
                errors.append(f"anchor target missing: {href}")
            continue
        if "://" in href or href.startswith("javascript:") or href.startswith("mailto:"):
            errors.append(f"non-local href: {href}")
            continue
        target = (REPORTS / href.split("#", 1)[0]).resolve()
        try:
            target.relative_to(REPORTS.resolve())
        except ValueError:
            errors.append(f"href escapes reports/: {href}")
            continue
        if not target.is_file():
            errors.append(f"dead href: {href}")
            continue
        if target.suffix != ".html":
            errors.append(f"non-HTML target: {href}")
            continue
        resolved.add(target)

    discovered = {p.resolve() for p in discover_html()}
    missing = sorted(p.relative_to(REPORTS).as_posix() for p in discovered - resolved)
    for path in missing:
        errors.append(f"HTML file not linked: {path}")

    if parser.scripts:
        errors.append(f"{parser.scripts} script tag(s) present; the index must stay script-free")
    if "http://" in OUTPUT.read_text(encoding="utf-8") or "https://" in OUTPUT.read_text(encoding="utf-8"):
        errors.append("external URL present; index must be self-contained")
    if len(parser.hrefs) != expected_hrefs:
        errors.append(f"link count changed: rendered {len(parser.hrefs)} vs expected {expected_hrefs}")
    if len(resolved) != page_count:
        errors.append(f"resolved {len(resolved)} pages, expected {page_count}")

    stats = {
        "hrefs": len(parser.hrefs),
        "pages": len(resolved),
        "discovered": len(discovered),
        "scripts": parser.scripts,
    }
    return errors, stats


def skipped_non_html_dirs() -> list[Path]:
    result = []
    for directory in sorted(p for p in REPORTS.iterdir() if p.is_dir()):
        if not any(directory.rglob("*.html")):
            result.append(directory)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate the existing index without writing")
    args = parser.parse_args()

    registered: set[Path] = set()
    for item in CARDS:
        if not item["links"]:
            print(f"error: card {item['slug']} has no links", file=sys.stderr)
            return 1
        for entry in item["links"]:
            path = (REPORTS / entry["path"]).resolve()
            if not path.is_file():
                print(f"error: registered target missing: {entry['path']}", file=sys.stderr)
                return 1
            if path.suffix != ".html":
                print(f"error: registered target is not HTML: {entry['path']}", file=sys.stderr)
                return 1
            registered.add(path)

    extras = auto_cards(registered)
    cards = CARDS + extras
    discovered = discover_html()
    linked = sum(len(c["links"]) for c in cards)
    generated = datetime.now(IST).strftime("%d %b %Y · %H:%M IST")

    if not args.check:
        OUTPUT.write_text(render(cards, generated, len(discovered), linked), encoding="utf-8")

    errors, stats = validate(len(discovered), linked + len(cards) + len(GROUPS))
    if errors:
        print("validation failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    group_counts = {key: sum(1 for c in cards if c["group"] == key) for key in GROUPS}
    print(f"index:        {OUTPUT.relative_to(ROOT)}")
    print(f"generated:    {generated}")
    print(f"cards:        {len(cards)} ({len(extras)} auto-discovered)")
    print(f"groups:       {len(GROUPS)}  " + " · ".join(f"{k}={v}" for k, v in group_counts.items()))
    print(f"html pages:   {stats['pages']} linked / {stats['discovered']} discovered")
    print(f"hrefs:        {stats['hrefs']} verified · scripts={stats['scripts']}")
    non_html = skipped_non_html_dirs()
    print(f"skipped:      {len(non_html)} directories with no HTML (data/CSV/MD only)")
    for directory in non_html:
        print(f"  - {directory.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
