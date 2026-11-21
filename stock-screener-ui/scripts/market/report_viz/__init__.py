"""Shared, instrument-agnostic building blocks for research-report charts.

This package is additive: existing report generators keep their own code and
HTML.  A new report imports :func:`panel` / :func:`render_page`, passes a
normalised payload, and gets the same chart vocabulary used by the NIFTY
reports for any instrument (NIFTY, SENSEX, a stock, a future).

The browser side lives in ``assets/``.  ``core.js`` registers
``window.RV.charts``; each chart module registers one entry.  A panel embeds
its payload in a ``<script type="application/json">`` block, so no report has
to hand-write a data blob or a per-chart initialiser.
"""

from __future__ import annotations

from .contracts import InstrumentSpec
from .page import panel, render_fragment, render_page
from .theme import palette, palette_css

__all__ = [
    "InstrumentSpec",
    "panel",
    "render_fragment",
    "render_page",
    "palette",
    "palette_css",
]
