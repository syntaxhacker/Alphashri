"""Options paper-trading sandbox (NIFTY + stock options).

A self-contained, DB-backed paper-trading account for intraday option trading,
kept deliberately separate from the equity bot runner in ``trading/``: the
equity runner has no concept of an option contract, and this package must never
destabilise it.

Everything here writes to the canonical ``users`` / ``bot_configs`` /
``strategy_configs`` / ``trades`` tables **additively** (insert-only). It never
updates or deletes existing rows.

See ``OPTIONS_PAPER.md`` (repo root) for the daily playbook.
"""

__all__ = ["spec", "costs", "tape", "strategies", "book", "runner", "eod",
           "greeks", "panel", "sim", "live", "books"]

VERSION = "1.1.0"
