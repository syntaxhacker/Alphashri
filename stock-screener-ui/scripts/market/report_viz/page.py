"""HTML panel/page assembly for the reusable report charts.

A chart module only has to provide a browser function registered as
``RV.charts[<name>]``.  :func:`panel` emits the panel chrome and the embedded
payload; :func:`render_page` emits a standalone report with the shared D3 /
Plotly runtime, palette and all chart assets.
"""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any, Iterable, Optional

from .contracts import InstrumentSpec
from .theme import palette_css

ASSET_DIR = Path(__file__).resolve().parent / "assets"
CHART_CDN = (
    '<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>',
    '<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>',
)


def _asset_files(suffix: str) -> list[Path]:
    if not ASSET_DIR.is_dir():
        return []
    files = sorted(ASSET_DIR.glob(f"*{suffix}"))
    core = ASSET_DIR / ("core" + suffix)
    if core in files:
        files.remove(core)
        files.insert(0, core)
    return files


def _asset_text(suffix: str) -> str:
    parts: list[str] = []
    for path in _asset_files(suffix):
        text = path.read_text()
        if suffix == ".js":
            parts.append(f"\n/* {path.name} */\n{text}")
        else:
            parts.append(f"\n/* {path.name} */\n{text}")
    return "\n".join(parts)


def _json_for_script(value: Any) -> str:
    """JSON safe inside an inline ``<script>`` element."""
    return (
        json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        .replace("</", "<\\/")
    )


def _legend_html(legend: Iterable[Any]) -> str:
    items: list[str] = []
    for item in legend or ():
        if isinstance(item, dict):
            color = str(item.get("color") or "")
            label = str(item.get("label") or "")
        else:
            color, label = item
        items.append(
            '<span><i style="background:'
            + html.escape(str(color), quote=True)
            + '"></i>'
            + html.escape(str(label))
            + "</span>"
        )
    return '<div class="rv-legend">' + "".join(items) + "</div>" if items else ""


def panel(
    chart: str,
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str,
    subtitle: str = "",
    legend: Iterable[Any] = (),
    note: str = "",
    span: int = 1,
    height: Optional[int] = None,
    css_class: str = "",
) -> str:
    """One chart panel with its payload.

    ``chart`` is the name registered by the matching asset:
    ``RV.charts[chart](host, payload, root)``.  The payload is always
    ``{"spec": InstrumentSpec.as_dict(), "data": data}`` so a chart never
    needs a module-level constant for units, currency or strike step.
    """
    chart_name = html.escape(str(chart), quote=True)
    title_html = html.escape(str(title))
    subtitle_html = html.escape(str(subtitle))
    note_html = html.escape(str(note))
    classes = f"rv-panel rv-span-{int(span)} {css_class}".strip()
    style = f' style="--rv-chart-height:{int(height)}px"' if height else ""
    payload = _json_for_script({"spec": spec.as_dict(), "data": data})
    return f"""<section class="{classes}" data-rv-chart="{chart_name}"{style}>
  <div class="rv-panel-head">
    <div><h3>{title_html}</h3>{f'<p class="rv-subtitle">{subtitle_html}</p>' if subtitle_html else ''}</div>
  </div>
  <div class="rv-chart"></div>
  {_legend_html(legend)}
  {f'<p class="rv-note">{note_html}</p>' if note_html else ''}
  <script type="application/json" class="rv-data">{payload}</script>
</section>"""


def render_fragment(
    panels: Iterable[str],
    *,
    spec: InstrumentSpec,
    intro: str = "",
    footer: str = "",
) -> str:
    """Panels for embedding in an existing page (D3/Plotly already loaded)."""
    body = "\n".join(panels)
    intro_html = f'<p class="rv-lede">{html.escape(intro)}</p>' if intro else ""
    footer_html = f'<p class="rv-foot">{html.escape(footer)}</p>' if footer else ""
    return f'<div class="rv-report">\n{intro_html}\n{body}\n{footer_html}\n</div>'


def render_page(
    *,
    title: str,
    spec: InstrumentSpec,
    panels: Iterable[str],
    intro: str = "",
    footer: str = "",
    extra_css: str = "",
) -> str:
    """Standalone dark report using the shared chart runtime."""
    body = render_fragment(panels, spec=spec, intro=intro, footer=footer)
    css = palette_css()
    assets_css = _asset_text(".css")
    assets_js = _asset_text(".js")
    safe_title = html.escape(str(title))
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{safe_title}</title>
<style>
:root{{{css}}}
{assets_css}
{extra_css}
</style>
</head>
<body>
<main class="rv-shell">
  <header class="rv-header">
    <div class="rv-kicker">Alphashri · reusable report visualisation</div>
    <h1>{safe_title}</h1>
    <div class="rv-meta"><span>{html.escape(spec.name)}</span><span>{html.escape(spec.venue)}</span><span>{html.escape(spec.timezone)}</span></div>
  </header>
{body}
</main>
{''.join(CHART_CDN)}
<script>
{assets_js}
</script>
</body>
</html>
"""
