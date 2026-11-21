"""Palette access for the static reports.

``src/ui/palette.ts`` is the product's single colour source.  Reports are
generated Python, so this module reads the anchors/scales from that file at
runtime instead of keeping a second hex list.  If the file is unavailable a
small documented fallback keeps a report buildable.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
PALETTE_TS = ROOT / "src" / "ui" / "palette.ts"

_FALLBACK = {
    "PRIMARY": "#D9902A",
    "POSITIVE_COLOR": "#2FA36B",
    "NEGATIVE_COLOR": "#E5606A",
    "TEXT_COLOR": "#E8E8E8",
    "TEXT_MUTED_COLOR": "#9B9B9B",
    "BG_COLOR": "#000000",
    "SURFACE_COLOR": "#13161C",
    "SURFACE_ALT_COLOR": "#1F242D",
    "BORDER_COLOR": "#2C313B",
    "INFO": "#4A8FD8",
    "WARNING": "#C9912F",
    "NEUTRAL": "#9B9B9B",
}


def _read_anchor(text: str, name: str) -> str:
    match = re.search(rf'export const {name} = "(#[0-9A-Fa-f]{{6}})";', text)
    return match.group(1) if match else _FALLBACK[name]


def _read_scale(text: str, name: str) -> list[str]:
    match = re.search(rf"export const {name} = \[(.*?)\];", text, re.S)
    return re.findall(r'"(#[0-9A-Fa-f]{6})"', match.group(1)) if match else []


@lru_cache(maxsize=1)
def palette() -> dict[str, Any]:
    text = PALETTE_TS.read_text() if PALETTE_TS.exists() else ""
    anchors = {name: _read_anchor(text, name) for name in _FALLBACK}
    scales = {
        name: _read_scale(text, name)
        for name in (
            "SCALE_GREEN",
            "SCALE_RED",
            "SCALE_ORANGE",
            "SCALE_VIOLET",
            "SCALE_BLUE",
            "SCALE_TEAL",
            "SCALE_GRAY",
        )
    }
    return {
        **anchors,
        "scales": {k: v for k, v in scales.items() if v},
        "positive": anchors["POSITIVE_COLOR"],
        "negative": anchors["NEGATIVE_COLOR"],
        "amber": anchors["PRIMARY"],
        "blue": anchors["INFO"],
        "violet": (scales.get("SCALE_VIOLET") or ["#8E7CC3"])[-3],
        "green": anchors["POSITIVE_COLOR"],
        "red": anchors["NEGATIVE_COLOR"],
        "muted": anchors["TEXT_MUTED_COLOR"],
        "text": anchors["TEXT_COLOR"],
        "bg": anchors["BG_COLOR"],
        "surface": anchors["SURFACE_COLOR"],
        "raised": anchors["SURFACE_ALT_COLOR"],
        "border": anchors["BORDER_COLOR"],
    }


def palette_css() -> str:
    """CSS custom properties consumed by ``assets/core.css``."""
    p = palette()
    return "\n".join(
        [
            f"--rv-bg:{p['bg']};",
            f"--rv-surface:{p['surface']};",
            f"--rv-raised:{p['raised']};",
            f"--rv-border:{p['border']};",
            f"--rv-text:{p['text']};",
            f"--rv-muted:{p['muted']};",
            f"--rv-amber:{p['amber']};",
            f"--rv-green:{p['green']};",
            f"--rv-red:{p['red']};",
            f"--rv-blue:{p['blue']};",
            f"--rv-violet:{p['violet']};",
            "--rv-mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;",
        ]
    )
