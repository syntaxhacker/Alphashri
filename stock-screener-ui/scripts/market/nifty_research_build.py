#!/usr/bin/env python3
"""Assemble the NIFTY 0-DTE research page from its section fragments.

Each research section is built by its own script into a self-contained fragment
(``<section data-research-section=...>`` + inline IIFE). This assembler owns only
the page chrome — head, nav, overview, quant verdict, evidence, footer — and
concatenates the fragments byte-for-byte. It never rewrites section content.

Usage:
    python3 scripts/market/nifty_research_build.py
    python3 scripts/market/nifty_research_build.py --session 2026-10-27
    python3 scripts/market/nifty_research_build.py --session 2026-11-17 --out /tmp/x.html
    python3 scripts/market/nifty_research_build.py --check
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_SESSION = "2026-11-17"
SESSION = DEFAULT_SESSION
SESSION_1027 = "2026-10-27"
ROOT = Path(__file__).resolve().parents[2]


def report_dir(session: str) -> Path:
    return ROOT / "reports" / f"nifty_{session}"


def research_dir(session: str) -> Path:
    return report_dir(session) / "research"


def default_out(session: str) -> Path:
    return report_dir(session) / "07-research.html"


REPORT_DIR = report_dir(SESSION)
RESEARCH_DIR = research_dir(SESSION)
DEFAULT_OUT = default_out(SESSION)
IST = timezone(timedelta(hours=5, minutes=30))


@dataclass(frozen=True)
class Section:
    section_id: str
    stem: str

    @property
    def anchor(self) -> str:
        return f"research-{self.section_id}"


SECTIONS = (
    Section("pin-gamma", "pin_gamma"),
    Section("participant-flow", "participant_flow"),
    Section("vol-decay", "vol_decay"),
    Section("futures-cross", "futures_cross"),
    Section("intraday-anatomy", "intraday_anatomy"),
)

NAV = (
    ("overview", "Overview"),
    ("research-pin-gamma", "Pin &amp; gamma"),
    ("research-participant-flow", "Participant flow"),
    ("research-vol-decay", "Vol &amp; decay"),
    ("research-futures-cross", "Futures &amp; cross-market"),
    ("research-intraday-anatomy", "Pump-dump anatomy"),
    ("quant-verdict", "Quant verdict"),
    ("evidence", "Evidence"),
)

SCRIPTS = (
    "scripts/market/nifty_research_pin_gamma.py",
    "scripts/market/nifty_research_participant_flow.py",
    "scripts/market/nifty_research_vol_decay.py",
    "scripts/market/nifty_research_futures_cross.py",
    "scripts/market/nifty_research_intraday_anatomy.py",
    "scripts/market/nifty_research_quant_review.py",
    "scripts/market/nifty_research_build.py",
)

# 2026-10-27 has no futures archive, so there is no futures section to insert.
SECTIONS_1027 = (
    Section("pin-gamma", "pin_gamma"),
    Section("participant-flow", "participant_flow"),
    Section("vol-decay", "vol_decay"),
    Section("intraday-anatomy", "intraday_anatomy"),
)

NAV_1027 = (
    ("overview", "Overview"),
    ("research-pin-gamma", "Pin &amp; gamma"),
    ("research-participant-flow", "Participant flow"),
    ("research-vol-decay", "Vol &amp; decay"),
    ("research-intraday-anatomy", "Pump-dump anatomy"),
    ("quant-verdict", "Quant verdict"),
    ("evidence", "Evidence"),
)

SCRIPTS_1027 = (
    "scripts/market/nifty_research_pin_gamma.py",
    "scripts/market/nifty_research_participant_flow.py",
    "scripts/market/nifty_research_vol_decay.py",
    "scripts/market/nifty_research_intraday_anatomy.py",
    "scripts/market/nifty_research_quant_review.py",
    "scripts/market/nifty_research_build.py",
)


class BuildError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Inputs
# --------------------------------------------------------------------------


def _read_json(path: Path) -> dict:
    if not path.exists():
        raise BuildError(f"missing input: {path}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise BuildError(f"invalid JSON in {path}: {exc}") from exc


def load_fragments(sections: tuple[Section, ...] = SECTIONS,
                   research: Path = RESEARCH_DIR) -> list[tuple[Section, str]]:
    """Return verified fragments, preserving the declared section order."""
    seen_ids: dict[str, str] = {}
    loaded: list[tuple[Section, str]] = []

    for section in sections:
        path = research / f"{section.stem}.html"
        if not path.exists():
            raise BuildError(f"missing fragment: {path}")
        text = path.read_text()
        if not text.strip():
            raise BuildError(f"empty fragment: {path}")

        if re.search(r"<!doctype|<html[\s>]|<head[\s>]|<body[\s>]", text, re.I):
            raise BuildError(f"{path.name}: fragments must not contain page chrome")
        if re.search(r"https?://", text):
            raise BuildError(f"{path.name}: fragment references a remote URL/CDN")

        roots = re.findall(r"<section\b[^>]*\bdata-research-section=\"([^\"]+)\"", text)
        if roots != [section.section_id]:
            raise BuildError(
                f"{path.name}: expected exactly one data-research-section="
                f"{section.section_id!r}, found {roots!r}"
            )
        if text.count('data-research-section="') != 1:
            raise BuildError(f"{path.name}: more than one data-research-section attribute")

        root_tag = re.search(r"<section\b[^>]*data-research-section=", text)
        assert root_tag is not None
        start = root_tag.start()
        tag_end = text.find(">", start)
        opening = text[start:tag_end]
        if f'id="{section.anchor}"' not in opening:
            raise BuildError(f"{path.name}: root section must carry id={section.anchor!r}")
        if not text.rstrip().endswith("</section>"):
            raise BuildError(f"{path.name}: fragment must end with its closing </section>")
        opens = len(re.findall(r"<section\b", text))
        closes = len(re.findall(r"</section>", text))
        if opens != closes:
            raise BuildError(f"{path.name}: unbalanced <section> tags ({opens} open, {closes} close)")

        for element_id in re.findall(r'\bid="([^"]+)"', text):
            if element_id in seen_ids:
                raise BuildError(
                    f"duplicate id {element_id!r} in {path.name} and {seen_ids[element_id]}"
                )
            seen_ids[element_id] = path.name

        if "<script" not in text or "</script>" not in text:
            raise BuildError(f"{path.name}: fragment has no inline script")

        loaded.append((section, text))

    return loaded


def load_inputs() -> tuple[dict, dict, dict, dict]:
    review = _read_json(RESEARCH_DIR / "quant_review.json")
    lab = _read_json(RESEARCH_DIR / "quant_lab.json")
    context = _read_json(RESEARCH_DIR / "context.json")
    anatomy = _read_json(RESEARCH_DIR / "intraday_anatomy.json")

    for node in (review, lab):
        for key in ("meta", "validation"):
            if key not in node:
                raise BuildError(f"quant JSON missing {key!r}")
    if not review["validation"].get("json_finite"):
        raise BuildError("quant_review.json failed its own finite-value validation")
    if not lab["validation"].get("json_finite"):
        raise BuildError("quant_lab.json failed its own finite-value validation")
    return review, lab, context, anatomy


def load_inputs_1027() -> tuple[dict, dict, dict]:
    """2026-10-27 has no context.json — its coverage facts live in quant_review.meta."""
    base = research_dir(SESSION_1027)
    review = _read_json(base / "quant_review.json")
    lab = _read_json(base / "quant_lab.json")
    anatomy = _read_json(base / "intraday_anatomy.json")

    for node in (review, lab):
        for key in ("meta", "validation"):
            if key not in node:
                raise BuildError(f"quant JSON missing {key!r}")
        if not node["validation"].get("json_finite"):
            raise BuildError(f"{node['meta']['session']} quant JSON failed finite-value validation")
    if review["meta"]["session"] != SESSION_1027:
        raise BuildError(f"quant_review.json is for {review['meta']['session']}, not {SESSION_1027}")
    return review, lab, anatomy


def verify_context(context: dict, anatomy: dict) -> None:
    facts = " ".join(context.get("key_facts", []))
    required = {
        "132.0M": "the corrected 13:05 5-minute bucket",
        "38.7M": "the corrected busiest minute",
        "0.15": "the clock-aligned lead-lag",
        "10 times": "the max-pain migration count",
    }
    missing = [label for token, label in required.items() if token not in facts]
    if missing:
        raise BuildError(f"context.json no longer supports: {', '.join(missing)}")

    windows = context.get("windows", {})
    if not str(windows.get("chain_end", "")).startswith("14:09"):
        raise BuildError("context.json chain window moved; update the truncation banner")
    if anatomy.get("session", {}).get("open") is None:
        raise BuildError("intraday_anatomy.json has no session summary")


def verify_context_1027(review: dict, anatomy: dict) -> None:
    """Guard the handful of facts the 10-27 chrome hard-codes against drifts."""
    dq = review["data_quality"]
    cov = dq["session_coverage"]
    pin = review["pin"]
    close = pin["close_proxy"]
    cd = review["cross_day"]
    ll = review["lead_lag"]
    lab_surface = review["lab"]["surface"]

    checks = {
        "close printed": (cov["close_printed"] is True, "the close is not in the data"),
        "close minute": (close["close_minute"] == "15:29", "close minute moved"),
        "pin distance": (abs(float(close["dist_to_last_max_pain"]) - 0.25) < 1e-9,
                         "close-to-max-pain distance moved"),
        "max pain": (float(pin["max_pain"]["last"]) == 22750.0, "last max pain moved"),
        "open minutes": (int(cov["minutes_missing_at_open"]) == 49, "open coverage moved"),
        "genuine closes": (int(cd["close_only"]["n"]) == 4, "genuine-close count moved"),
        "genuine within 25": (int(cd["close_only"]["within_25"]) == 2, "pin count moved"),
        "no futures": (ll["mode"] == "no_futures_archive", "a futures archive now exists"),
        "pc1": (abs(float(lab_surface["explained"][0]) - 0.4507) < 1e-9, "PC1 moved"),
        "pc1 linear": (lab_surface["loadings"]["pc1"]["shape"] == "linear", "PC1 shape moved"),
    }
    broken = [why for ok, why in checks.values() if not ok]
    if broken:
        raise BuildError("10-27 inputs no longer support the page: " + "; ".join(broken))

    events = anatomy.get("events") or []
    if len(events) != 24:
        raise BuildError(f"intraday_anatomy events changed ({len(events)}, expected 24)")
    if anatomy.get("session", {}).get("last") is None:
        raise BuildError("intraday_anatomy.json has no session summary")
    if not anatomy.get("meta", {}).get("unavailable", {}).get("futures"):
        raise BuildError("intraday_anatomy.json no longer records futures as unavailable")


# --------------------------------------------------------------------------
# Formatting helpers
# --------------------------------------------------------------------------


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def n(value: float, digits: int = 1) -> str:
    return f"{value:,.{digits}f}"


def signed(value: float, digits: int = 1) -> str:
    return f"{value:+,.{digits}f}"


def pct(value: float, digits: int = 1) -> str:
    return f"{value * 100:.{digits}f}%"


def pill(status: str) -> str:
    css = {
        "Observed": "st-ok",
        "Inference": "st-inf",
        "Hypothesis": "st-hyp",
        "Falsified": "st-bad",
    }[status]
    return f'<span class="st {css}">{status}</span>'


def table(headers: list[str], rows: list[list[str]], *, numeric: set[int] | None = None,
          table_class: str = "qt", min_width: int = 720) -> str:
    numeric = numeric or set()
    head = "".join(
        f'<th{" class=\"num\"" if i in numeric else ""}>{h}</th>' for i, h in enumerate(headers)
    )
    body = []
    for row in rows:
        cells = "".join(
            f'<td{" class=\"num\"" if i in numeric else ""}>{cell}</td>'
            for i, cell in enumerate(row)
        )
        body.append(f"<tr>{cells}</tr>")
    return (
        f'<div class="tbl-wrap"><table class="{table_class}" style="min-width:{min_width}px">'
        f"<thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table></div>"
    )


# --------------------------------------------------------------------------
# Page sections
# --------------------------------------------------------------------------


CSS = """
:root{
  --bg:#000;--surface:#13161C;--alt:#1F242D;--border:#2C313B;
  --text:#E8E8E8;--muted:#9B9B9B;--dim:#79828F;
  --primary:#D9902A;--info:#4A8FD8;--green:#2FA36B;--red:#E5606A;--violet:#8E7CC3;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif
}
*{box-sizing:border-box}
html{background:var(--bg);scroll-padding-top:62px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.55 var(--sans);
  -webkit-font-smoothing:antialiased;overflow-x:clip;max-width:100%}
a{color:var(--info);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:var(--mono);font-size:.94em;color:#D5D5D5}

.top{position:sticky;top:0;z-index:60;background:#050608;
  border-bottom:1px solid var(--border)}
.top-in{max-width:1560px;margin:0 auto;padding:0 20px;height:46px;
  display:flex;align-items:center;gap:14px;min-width:0}
.brand{display:flex;align-items:baseline;gap:7px;white-space:nowrap;color:var(--text);
  font:600 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase}
.brand span{color:var(--primary);font-weight:500;letter-spacing:.04em}
.brand:hover{text-decoration:none;color:#fff}
.nav{display:flex;align-items:center;gap:1px;flex:1;min-width:0;overflow-x:auto;
  scrollbar-width:none;overscroll-behavior-x:contain}
.nav::-webkit-scrollbar{display:none}
.nav a{color:var(--muted);font-size:12px;line-height:1;padding:7px 9px;border-radius:4px;
  white-space:nowrap;flex:0 0 auto}
.nav a:hover{color:var(--text);background:var(--alt);text-decoration:none}
.nav a.is-active{color:var(--primary);background:rgba(217,144,42,.08)}
.top-link{color:var(--muted);font:600 10px/1 var(--mono);letter-spacing:.1em;
  text-transform:uppercase;white-space:nowrap;padding:6px 0}
.top-link:hover{color:var(--text);text-decoration:none}

.page{max-width:1560px;margin:0 auto;padding:24px 20px 56px;min-width:0}
.block{margin:0 0 28px;min-width:0}
main > section + section{border-top:1px solid #1B1F26;margin-top:30px;padding-top:26px}
.kicker{font:600 10px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;
  color:var(--primary)}
h1{font-size:30px;line-height:1.18;letter-spacing:-.02em;margin:9px 0 8px;font-weight:650}
h2{font-size:22px;line-height:1.25;letter-spacing:-.01em;margin:8px 0 6px;font-weight:640}
h3{font-size:13px;line-height:1.3;letter-spacing:.02em;margin:22px 0 8px;font-weight:640}
.lede{color:var(--muted);font-size:13px;max-width:112ch;margin:0 0 14px}
.lede b{color:var(--text);font-weight:600}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.badge{font:600 9.5px/1 var(--mono);letter-spacing:.09em;text-transform:uppercase;
  color:#BDBDBD;border:1px solid var(--border);border-radius:4px;padding:5px 7px;
  background:var(--surface)}
.badge.hot{color:var(--primary);border-color:rgba(217,144,42,.45);
  background:rgba(217,144,42,.07)}
.badge.warn{color:#F0A0A6;border-color:rgba(229,96,106,.45);
  background:rgba(229,96,106,.08)}

.stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;
  background:var(--border);border:1px solid var(--border);border-radius:10px;
  overflow:hidden;margin:0 0 14px}
.stat{background:var(--surface);padding:11px 13px 12px;min-width:0}
.stat .k{font:600 9px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted)}
.stat .v{font:600 15px/1.35 var(--mono);margin-top:6px;letter-spacing:-.01em;
  overflow-wrap:anywhere}
.stat .s{color:var(--dim);font-size:11px;margin-top:3px;line-height:1.4}

.caveat{border:1px solid #4A3A22;border-left:3px solid var(--primary);
  background:#171310;border-radius:6px;padding:10px 14px;color:#D9CCB9;
  font-size:12.5px;max-width:150ch}
.caveat b{color:var(--primary);font-weight:600}

.guide{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;
  background:var(--border);border:1px solid var(--border);border-radius:8px;
  overflow:hidden;margin-top:14px}
.guide a{display:block;background:var(--surface);padding:10px 12px;color:inherit}
.guide a:hover{background:#171B22;text-decoration:none}
.guide .t{font:600 11.5px/1.3 var(--sans);color:var(--text)}
.guide .d{color:var(--muted);font-size:11.5px;margin-top:3px;line-height:1.45}

.corr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
  gap:10px;margin:0 0 6px}
.corr{background:var(--surface);border:1px solid var(--border);border-radius:8px;
  padding:12px 14px;min-width:0}
.corr .hd{display:flex;align-items:center;justify-content:space-between;gap:10px;
  margin-bottom:6px}
.corr h4{margin:0;font-size:12.5px;font-weight:640;letter-spacing:.01em}
.corr p{margin:0;color:#C5C5C5;font-size:12px;line-height:1.55}
.corr p b{color:var(--text);font-weight:600}
.corr.bad{border-color:rgba(229,96,106,.42);border-left:3px solid var(--red)}
.corr.good{border-color:rgba(47,163,107,.35);border-left:3px solid var(--green)}
.corr.hyp{border-color:rgba(142,124,195,.42);border-left:3px solid var(--violet)}

.tbl-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--border);
  border-radius:8px;max-width:100%;-webkit-overflow-scrolling:touch}
.qt{width:100%;border-collapse:collapse;font-size:12px}
.qt th{text-align:left;vertical-align:bottom;padding:8px 10px;white-space:nowrap;
  color:var(--muted);font:600 9px/1.25 var(--mono);letter-spacing:.1em;
  text-transform:uppercase;border-bottom:1px solid var(--border);background:#101318}
.qt td{padding:9px 10px;border-bottom:1px solid #1C2027;vertical-align:top;
  color:#D2D2D2;line-height:1.5}
.qt tbody tr:last-child td{border-bottom:0}
.qt tbody tr:hover td{background:#171B22}
.qt .num{text-align:right;font-family:var(--mono);font-size:11.5px;white-space:nowrap}
.qt td strong{color:var(--text);font-weight:600}
.qt .muted{color:var(--muted)}
.caption{color:var(--dim);font-size:11px;margin:6px 0 0}

.st{display:inline-block;font:600 8.5px/1 var(--mono);letter-spacing:.1em;
  text-transform:uppercase;padding:4px 6px;border-radius:4px;border:1px solid;
  white-space:nowrap}
.st-ok{color:#86D6A9;border-color:rgba(47,163,107,.5);background:rgba(47,163,107,.12)}
.st-inf{color:#9AC5F0;border-color:rgba(74,143,216,.5);background:rgba(74,143,216,.12)}
.st-hyp{color:#CBB9F0;border-color:rgba(142,124,195,.55);background:rgba(142,124,195,.14)}
.st-bad{color:#F3A7AC;border-color:rgba(229,96,106,.5);background:rgba(229,96,106,.12)}

.two-col{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:18px;
  align-items:start}
.list{margin:0;padding-left:18px;color:#C9C9C9;font-size:12px}
.list li{margin:0 0 7px}
.list b{color:var(--text);font-weight:600}
.note{color:var(--dim);font-size:11.5px;margin:10px 0 0;max-width:150ch}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1px;
  background:var(--border);border:1px solid var(--border);border-radius:8px;
  overflow:hidden}
.cards .cell{background:var(--surface);padding:10px 12px;min-width:0}
.cards .k{font:600 9px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted)}
.cards .v{font:600 12px/1.45 var(--mono);margin-top:5px;overflow-wrap:anywhere}
.cards .s{color:var(--dim);font-size:11px;margin-top:3px}

pre{background:var(--surface);border:1px solid var(--border);border-radius:8px;
  padding:12px 14px;overflow-x:auto;font:11.5px/1.65 var(--mono);color:#CFCFCF;
  margin:8px 0 0;max-width:100%}

.foot{border-top:1px solid var(--border);margin-top:34px;padding-top:16px;
  color:var(--muted);font-size:11.5px}
.foot p{margin:0 0 8px;max-width:160ch}
.foot .links{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0 0}
.foot .links a{font-size:11.5px}

@media (max-width:1200px){
  .stats{grid-template-columns:repeat(3,minmax(0,1fr))}
  .guide{grid-template-columns:repeat(2,minmax(0,1fr))}
  .corr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .two-col{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:760px){
  .top-in{padding:0 12px;gap:10px;height:44px}
  .brand{font-size:10px;letter-spacing:.08em}
  .brand span{display:none}
  .top-link{display:none}
  .nav a{font-size:11.5px;padding:6px 8px}
  .page{padding:18px 12px 44px}
  h1{font-size:23px}
  h2{font-size:19px}
  main > section + section{margin-top:22px;padding-top:20px}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .guide{grid-template-columns:minmax(0,1fr)}
  .stat .v{font-size:13px}
  .corr-grid{grid-template-columns:minmax(0,1fr)}
  .foot{padding-top:12px}
}
@media print{
  .top{position:static;background:#000}
  .nav{display:none}
  body{overflow:visible}
}
"""

CSS_1027 = """
.coverage{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;
  background:var(--border);border:1px solid var(--border);border-radius:8px;
  overflow:hidden;margin:14px 0 0}
.coverage .cell{background:var(--surface);padding:10px 12px;min-width:0;
  border-left:3px solid var(--red)}
.coverage .k{font:600 9px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted)}
.coverage .v{font:600 11.5px/1.45 var(--mono);margin-top:5px;color:#F0A0A6}
.coverage .s{color:var(--dim);font-size:11px;margin-top:4px;line-height:1.5}
.coverage .s code{font-size:10.5px}
@media (max-width:760px){.coverage{grid-template-columns:minmax(0,1fr)}}
"""

NAV_JS = """
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  var targets = links.map(function (a) {
    return document.getElementById(a.getAttribute('href').slice(1));
  });
  if (targets.some(function (t) { return !t; })) return;

  function topOf(el) { return el.getBoundingClientRect().top + window.scrollY; }

  function update() {
    var probe = window.scrollY + 96;
    var current = targets[0];
    for (var i = 0; i < targets.length; i += 1) {
      if (topOf(targets[i]) <= probe) current = targets[i];
    }
    var atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) current = targets[targets.length - 1];
    links.forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('href') === '#' + current.id);
    });
  }

  var queued = false;
  window.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; update(); });
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
})();
"""


def build_overview(context: dict, review: dict, lab: dict, anatomy: dict) -> str:
    session = anatomy["session"]
    dq = review["data_quality"]
    counts = dq["counts"]
    open_, last = float(session["open"]), float(session["last"])
    net = float(session["net"])
    net_pct = net / open_ * 100
    high, low = session["high"], session["low"]
    legs = len(anatomy["events"])
    bursts = lab["microstructure"]["volume_bursts"]["n"]
    event_windows = len(review["events"]["events"])
    failures = dq["recorder_failures"]["n"]
    ts = context["windows"]

    guide = (
        ("research-pin-gamma", "Pin &amp; gamma",
         "Max pain, walls and net GEX — and why the 14:07 truncation blocks a pin verdict."),
        ("research-participant-flow", "Participant flow",
         "Strike × time classification of buildup, covering and unwinding, with the 3D surface."),
        ("research-vol-decay", "Vol &amp; decay",
         "The IV surface and an exact spot/theta/IV split of the 25,500 put's −110.5 points."),
        ("research-futures-cross", "Futures &amp; cross-market",
         "Basis, the clock-aligned lead–lag test and the SENSEX check."),
        ("research-intraday-anatomy", "Pump-dump anatomy",
         "All 17 legs ≥20 pts, each tested against six drivers and given a falsifier."),
        ("quant-verdict", "Quant verdict",
         "Observed vs inferred vs hypothesised vs falsified, with n_eff and CI caveats."),
    )
    guide_html = "".join(
        f'<a href="#{anchor}"><div class="t">{title}</div><div class="d">{desc}</div></a>'
        for anchor, title, desc in guide
    )

    return f"""
<section class="block" id="overview">
  <div class="kicker">NIFTY · 0-DTE · expiry {SESSION} · research</div>
  <h1>One expiry day, read twice: what happened, and what the data can actually support</h1>
  <p class="lede">Five independent research cuts on the same two recorders, assembled with a statistical
    verdict on top. The day is easy to narrate and hard to prove: a 202-point spot range, a morning
    grind into 25,500, an afternoon selloff and 17 futures legs. <b>Every forward-looking statement
    here is a hypothesis, not a backtest.</b></p>
  <div class="badges">
    <span class="badge hot">0-DTE</span>
    <span class="badge">NIFTY</span>
    <span class="badge">Expiry {SESSION}</span>
    <span class="badge warn">n = 1 session</span>
    <span class="badge warn">chain ends 14:09</span>
  </div>
  <div class="stats">
    <div class="stat"><div class="k">Instrument</div><div class="v">NIFTY 0-DTE</div>
      <div class="s">Last expiry of the week · 2026-11-17</div></div>
    <div class="stat"><div class="k">Spot path (tape)</div>
      <div class="v">{n(open_,2)} → {n(last,2)}</div>
      <div class="s">{signed(net,2)} pts · {signed(net_pct,2)}% by 14:07</div></div>
    <div class="stat"><div class="k">Session range</div>
      <div class="v">{n(float(session['range']),1)} pts</div>
      <div class="s">low {n(low['v'],1)} ({low['t']}) · high {n(high['v'],1)} ({high['t']})</div></div>
    <div class="stat"><div class="k">Events</div><div class="v">{legs} legs ≥20 pts</div>
      <div class="s">{event_windows} event windows · {bursts} volume bursts (&gt;3 MAD)</div></div>
    <div class="stat"><div class="k">Data window</div><div class="v">09:15 → 14:09</div>
      <div class="s">{counts['tape_rows']} tape · {counts['chain_rows']:,} chain · {counts['snap_rows']}
      snapshots · {counts['futures_candles']} futures 1m</div></div>
    <div class="stat"><div class="k">Evidence base</div><div class="v">1 + 5 sessions</div>
      <div class="s">1 full session + 5 partial 0-DTE · no out-of-sample</div></div>
  </div>
  <div class="caveat"><b>Read the sample first.</b> This is one session. The chain recorder stops at
    {ts['chain_end']} — 80 minutes before the 15:30 close — so the expiry pin and the close are
    <b>not in the data</b>. {failures} recorder failures, 10 chain gaps &gt;20s and 24.5% down-ticks in
    the 10-second volume column are documented in <a href="#evidence">Evidence</a>. Treat the
    cross-session counts (5 sessions) as counts, never as probabilities.</div>
  <div class="guide">{guide_html}</div>
  <p class="caption">Reading order: the five research sections below are unmodified fragments; the
    quant verdict after them is the referee. Section numbers belong to the fragments, not to this page.</p>
</section>
"""


def build_quant(review: dict, lab: dict) -> str:
    ll = review["lead_lag"]
    pin = review["pin"]
    cd = review["cross_day"]
    today = review["today_read"]
    bu = today["long_buildup_check"]
    bucket = today["session_max_itm_bucket"]
    dq = review["data_quality"]
    es = review["effective_sample"]
    flows = review["flows"]
    mp = pin["max_pain"]
    cp = pin["close_proxy"]
    ci = ll["sync_bootstrap_ci"]["-1"]
    fwd15 = bu["forward_after_state"]["15m"]
    surface = lab["surface"]
    pc = surface["loadings"]
    oi_p = lab["microstructure"]["oi_persistence"]
    bursts = lab["microstructure"]["volume_bursts"]
    expl = surface["explained"]

    corrections = f"""
<div class="corr-grid">
  <div class="corr good">
    <div class="hd"><h4>12:00 long buildup — real, not predictive</h4>{pill('Observed')}</div>
    <p>Price and OI both rose: <b>{signed(float(bu['dp_close_to_close']),1)} pts</b> close-to-close with
      <b>{int(bu['doi']):,} OI</b>, the 97th percentile of 15-minute moves. But {pct(float(bu['joint_long_buildup_share']))}
      of windows ({int(bu['state_count_today'])}/{int(bu['n_15m_windows'])}, {int(fwd15['n_episodes'])} episodes) carry
      the same label, and the 15-minute forward excess is <b>{signed(float(fwd15['excess_vs_baseline']),1)} pts</b>
      (shift p={fwd15['excess_shift_p']:.3f}). Mechanically confirmed; <b>no predictive content</b>.</p>
  </div>
  <div class="corr bad">
    <div class="hd"><h4>13:05 “135M” — a moving-window artefact</h4>{pill('Falsified')}</div>
    <p>The 5-minute bucket is <b>132.0M</b>, not a single print; the busiest minute is <b>38.7M at 13:09</b>.
      Differencing each strike first gives <b>{n(float(bucket['per_strike_attributed_5m_at_13:05']),1)}M</b> for
      13:00–13:05 and {n(float(bucket['per_strike_attributed_5m_at_13:05_13:10']),1)}M for the next five
      minutes — not {n(float(bucket['raw_sum_5m_at_13:05']),1)}M. Counterparty unknown.</p>
  </div>
  <div class="corr bad">
    <div class="hd"><h4>Futures lead spot by one minute — clock artefact</h4>{pill('Falsified')}</div>
    <p>Naive lag −1 is <b>{n(float(ll['lead_naive']),3)}</b>; after sampling spot at the futures candle
      close it collapses to <b>{n(float(ll['lead_sync']),3)}</b> (bootstrap 95% CI {n(float(ci[0]),3)} to
      {n(float(ci[1]),3)}, includes zero). Lag 0 rises {n(float(ll['naive_peak']['r']),3)} →
      {n(float(ll['sync_peak']['r']),3)}. <b>{pct(float(ll['lead_attributable_to_sampling']))} of the lead
      is the 28-second offset.</b></p>
  </div>
  <div class="corr hyp">
    <div class="hd"><h4>Pin past 14:07 — unverified</h4>{pill('Hypothesis')}</div>
    <p>Max pain moved <b>{int(mp['changes'])} times</b> across {int(mp['unique'])} levels: {n(float(mp['open']),0)}
      at the open, {n(float(mp['last']),0)} at the last print, {n(float(mp['modal']),0)} for only
      {pct(float(mp['modal_share']))} of the session. The chain stops at 14:09; the futures-implied close is
      {n(float(cp['implied_spot_close']),0)} — <b>{n(float(cp['implied_dist_to_last_max_pain']),0)} pts away</b>.</p>
  </div>
  <div class="corr hyp">
    <div class="hd"><h4>Max pain as a magnet into the close</h4>{pill('Hypothesis')}</div>
    <p>{int(cd['counts']['within_25'])} of {int(cd['n'])} recorded 0-DTE sessions closed within 25 pts
      (Wilson {pct(float(cd['wilson_25'][0]))}–{pct(float(cd['wilson_25'][1]))}); median
      {n(float(cd['median_abs_dist']),1)} pts. The 328-session deferred-expiry history
      ({pct(float(cd['history']['shares']['within_25']))} within 25 pts) is a weak-magnet reference,
      <b>not a 0-DTE prior</b>.</p>
  </div>
  <div class="corr">
    <div class="hd"><h4>“ITM PE expansion from 11:10”</h4>{pill('Inference')}</div>
    <p>The 11:10 minute was ordinary — {n(float(today['itm_expansion_check']['session_median']) / 1e6,1)}M vs an
      {n(float(today['itm_expansion_check']['p90_threshold']) / 1e6,1)}M p90. What expanded was put
      <b>OI at fixed strikes</b> (25,500 PE 6.97M → 21.0M, 11:00–12:15), a strike-anchored build, not a
      moneyness-defined flow.</p>
  </div>
</div>
"""

    evidence_rows = [
        [
            "Spot inside the near call/put wall band",
            f"{pct(float(pin['walls']['inside_share']))} of minutes ({round(float(pin['walls']['inside_share']) * int(pin['walls']['n']))}/{int(pin['walls']['n'])})",
            f"{int(pin['walls']['n'])} minutes",
            pill("Observed"),
            "Near-tautological: the walls are re-derived each minute from the same OI snapshot they are scored against.",
        ],
        [
            "Max pain migrated, not held",
            f"{int(mp['changes'])} changes · {int(mp['unique'])} levels · modal {n(float(mp['modal']),0)} for {pct(float(mp['modal_share']))}",
            f"{int(pin['n_minutes'])} minutes",
            pill("Observed"),
            "“Held 25,450” is true only from 12:00 to 14:07; the open was 25,200.",
        ],
        [
            "Close stays within 25 pts of max pain",
            f"{int(cd['counts']['within_25'])}/{int(cd['n'])} sessions · Wilson {pct(float(cd['wilson_25'][0]))}–{pct(float(cd['wilson_25'][1]))}",
            f"{int(cd['n'])} sessions",
            pill("Hypothesis"),
            "Five clusters; 2026-11-17 has no close print at all.",
        ],
        [
            "ITM PE top-decile flow predicts the next 15m",
            f"cross-day excess {signed(float(cd['flow']['summary']['itm_pe_volume_top_decile']['15m']['excess_mean']),1)} pts (3/5 sessions); within-session excess −2.1 pts (p=0.825)",
            "199 trigger minutes · 5 clusters",
            pill("Hypothesis"),
            "Not out-of-sample; the interval is the widest five clusters can produce.",
        ],
        [
            "12:00 long buildup",
            f"{signed(float(bu['dp_close_to_close']),1)} pts · +{int(bu['doi']):,} OI · 97th price pct",
            f"{int(bu['n_15m_windows'])} windows · {int(fwd15['n_episodes'])} episodes",
            pill("Observed"),
            "Mechanically real but the forward edge is inside the baseline (p=0.679).",
        ],
        [
            "Futures lead spot by ~1 minute",
            f"naive r = {n(float(ll['lead_naive']),3)} → aligned r = {n(float(ll['lead_sync']),3)}",
            "288 pairs",
            pill("Falsified"),
            "63.9% of the lead is the 28s sample offset; bootstrap CI includes zero.",
        ],
        [
            "13:05 session-max ITM PE flow was 135M",
            f"raw sum {n(float(bucket['raw_sum_5m_at_13:05']),1)}M vs attributed {n(float(bucket['per_strike_attributed_5m_at_13:05']),1)}M",
            "1 session",
            pill("Falsified"),
            "Recompute per-strike deltas before summing; the 5m bucket is 132.0M and the peak minute 38.7M.",
        ],
        [
            "Dealer gamma sign and the GEX regime",
            "net GEX −252 → +262",
            "284 snapshots",
            pill("Inference"),
            "OI × an assumed dealer sign; the data holds OI, not dealer positions.",
        ],
        [
            "0-DTE volume is churn, not position building",
            f"median ΔOI/Δvol {n(float(oi_p['median_doi_over_dvol']),3)} (p10 {n(float(oi_p['p10']),3)}, p90 {n(float(oi_p['p90']),3)})",
            f"{int(oi_p['n_strike_windows']):,} strike-windows",
            pill("Observed"),
            "Strike-windows are not independent observations; one session.",
        ],
        [
            "The IV surface has one dominant level factor",
            f"PC1 {pct(float(expl[0]))} · PC2 {pct(float(expl[1]))} · PC1 loading {pc['pc1']['shape']}",
            f"{int(surface['n_snapshots'])} smiles",
            pill("Falsified"),
            "The leading loading is linear in moneyness — a rotation, not a parallel shift.",
        ],
        [
            "“Institutions bought puts”",
            "counterparty and aggressor are not observable",
            "—",
            pill("Inference"),
            "Chain data carries price and OI only; no participant identity or aggressor side.",
        ],
    ]

    series_rows = []
    for key, row in es["series"].items():
        ratio = float(row["n"]) / float(row["n_eff_bartlett"])
        series_rows.append([
            f"<code>{esc(key)}</code>",
            f"{int(row['n']):,}",
            f"{n(float(row['n_eff_bartlett']),1)}",
            f"{n(float(row['rho1']),3)}",
            f"{n(float(row['rho5']),3)}",
            f"{n(ratio,2)}×",
        ])

    overlap = es["overlap"]
    flow_rows = []
    for index, flow in enumerate(flows, start=1):
        flow_rows.append([
            str(index),
            f"<strong>{esc(flow['flow'])}</strong>",
            f"{int(flow['snr'])}/5",
            esc(flow["latency"]),
            esc(flow["sample"]),
            esc(flow["failure"]),
        ])

    na_eff = float(es["series"]["itm_pe_minute_volume"]["n_eff_bartlett"])
    n_rows = int(es["series"]["itm_pe_minute_volume"]["n"])

    return f"""
<section class="block" id="quant-verdict">
  <div class="kicker">Quant verdict</div>
  <h2>What survives, what is inferred, what is falsified</h2>
  <p class="lede">Built from <code>quant_review.json</code> and <code>quant_lab.json</code>. The review
    exists because the sections were written first and the claims were tested afterwards. One session,
    five partial 0-DTE sessions, no out-of-sample period, no execution model, no costs — so the
    highest status any forward-looking claim can reach here is <b>Hypothesis</b>.</p>
  {corrections}
  <h3>Evidence table — claim, statistic, effective sample, status</h3>
  {table(
      ["Claim", "Statistic", "n / n_eff", "Status", "Why it stands / what would break it"],
      evidence_rows,
      min_width=900,
  )}
  <p class="caption">Statuses: <b>Observed</b> = measured in this data; <b>Inference</b> = follows only
    under an assumption (dealer sign, moneyness attribution); <b>Hypothesis</b> = suggestive but not
    separable from baseline with this sample; <b>Falsified</b> = does not reproduce under the stated test.</p>

  <div class="two-col">
    <div>
      <h3>Effective sample (Bartlett n_eff)</h3>
      {table(
          ["Series", "Rows", "n_eff", "ρ₁", "ρ₅", "Rows per n_eff"],
          series_rows,
          numeric={1, 2, 3, 4, 5},
          min_width=560,
      )}
      <p class="caption">ITM PE minute volume carries <b>{n(n_rows / na_eff, 1)}× fewer independent
        observations</b> than its {n_rows} rows suggest (n_eff {n(na_eff,1)}). A 15-minute forward return
        leaves {n(float(overlap['15m']['independent_minutes']),1)} independent windows; 30m
        {n(float(overlap['30m']['independent_minutes']),1)}; 60m {n(float(overlap['60m']['independent_minutes']),1)}.
        The cross-day cluster count is five.</p>
    </div>
    <div>
      <h3>CI and multiplicity caveats</h3>
      <ul class="list">
        <li><b>n_eff is not n.</b> Serial correlation is strong (ρ₁ {n(float(es['series']['itm_pe_minute_volume']['rho1']),2)}
          on put volume), so a 289-row series behaves like ~35 independent observations.</li>
        <li><b>Overlapping windows.</b> Forward returns at h minutes overlap h-fold; 290 minutes is not
          290 trials. Report the independent count, not the row count.</li>
        <li><b>Five sessions = five clusters.</b> The Wilson interval on 3/5 is
          {pct(float(cd['wilson_25'][0]))}–{pct(float(cd['wilson_25'][1]))}. Print “3 of 5”, never “60%”.</li>
        <li><b>Multiple testing.</b> 85 correlations across four families and 21 lags: 4.2 false positives
          expected at α=0.05; the Bonferroni-critical |r| is 0.205 for n≈269.</li>
        <li><b>Selected after the fact.</b> Triggers and event windows were chosen after seeing the day;
          without an out-of-sample period the shift-test p-values are descriptive, not confirmatory.</li>
        <li><b>Observations, not causes.</b> “OI rose while spot stalled” is supported; “dealers defended”
          is not. Chain data has no participant identity, aggressor side or order-book depth.</li>
        <li><b>Truncation.</b> The chain ends at {dq['truncation']['chain_ends']}, {int(dq['truncation']['minutes_missing_into_close'])}
          minutes before the close. Any close or expiry-settlement statistic is outside the data.</li>
      </ul>
    </div>
  </div>

  <h3>Best data flows for positioning (ranked by signal-to-noise)</h3>
  {table(
      ["#", "Flow", "SNR", "Latency", "Sample", "Never read it alone because"],
      flow_rows,
      numeric={0, 2},
      min_width=900,
  )}
  <p class="caption">SNR is the review's 1–5 grading, not a measured ratio. The first two flows are the
    only ones backed by five sessions; the rest are single-session or assumption-dependent. The 10-second
    chain is not on this list as a volume source: {pct(float(dq['chain_volume_drop_share']))} of consecutive
    per-strike reads go down and need a running-max repair. Use the 1-minute tape.</p>
  <p class="note">Bottom line: the day's mechanics are well measured — the long buildup, the put-OI build
    at fixed strikes, the premium decay, the negative-gamma stretch. Its forward-looking content is not.
    Build positions off the strike-anchored flows and the baseline, not off the 13:05 headline or a
    one-minute lead that is mostly a clock offset.</p>
</section>
"""


def build_evidence(review: dict) -> str:
    dq = review["data_quality"]
    counts = dq["counts"]
    windows = dq["windows"]
    gaps = dq["gaps"]

    sources = [
        ["<code>experiments/data/nifty_tape/2026-11-17.jsonl</code>",
         f"{windows['tape'][0]} → {windows['tape'][1]}", f"{counts['tape_rows']:,} rows",
         "spot, per-minute chain, walls, max pain, GEX, ATM IV"],
        ["<code>experiments/data/nifty_chain10s/2026-11-17.jsonl</code>",
         f"{windows['chain'][0]} → {windows['chain'][1]}", f"{counts['chain_rows']:,} rows",
         "per-strike CE/PE LTP, OI, cumulative volume every ~10s"],
        ["<code>experiments/data/nifty_snapshots/2026-11-17.jsonl</code>",
         f"{windows['snapshots'][0]} → {windows['snapshots'][1]}", f"{counts['snap_rows']:,} rows",
         "report snapshots: walls, GEX strikes, IV surface"],
        ["<code>reports/nifty_2026-11-17/data/futures_1m.json</code>",
         f"{windows['futures'][0]} → {windows['futures'][1]}", f"{counts['futures_candles']} candles",
         "NIFTY futures 1m close / OI / volume (clip at 14:09)"],
        ["<code>research/quant_review.json</code> + <code>quant_lab.json</code>",
         "derived", "review + lab", "effective sample, tests, pin counts, flows, surface factors"],
    ]
    fragments = [
        ["<a href=\"#research-pin-gamma\">Pin &amp; gamma</a>", "research/pin_gamma.html",
         "scripts/market/nifty_research_pin_gamma.py", "pin_gamma.json"],
        ["<a href=\"#research-participant-flow\">Participant flow</a>", "research/participant_flow.html",
         "scripts/market/nifty_research_participant_flow.py", "participant_flow.json"],
        ["<a href=\"#research-vol-decay\">Vol &amp; decay</a>", "research/vol_decay.html",
         "scripts/market/nifty_research_vol_decay.py", "vol_decay.json"],
        ["<a href=\"#research-futures-cross\">Futures &amp; cross-market</a>", "research/futures_cross.html",
         "scripts/market/nifty_research_futures_cross.py", "futures_cross.json"],
        ["<a href=\"#research-intraday-anatomy\">Pump-dump anatomy</a>", "research/intraday_anatomy.html",
         "scripts/market/nifty_research_intraday_anatomy.py", "intraday_anatomy.json"],
    ]

    commands = "\n".join(
        [
            ".venv/bin/python scripts/market/nifty_research_pin_gamma.py",
            ".venv/bin/python scripts/market/nifty_research_participant_flow.py",
            ".venv/bin/python scripts/market/nifty_research_vol_decay.py",
            ".venv/bin/python scripts/market/nifty_research_futures_cross.py",
            ".venv/bin/python scripts/market/nifty_research_intraday_anatomy.py",
            ".venv/bin/python scripts/market/nifty_research_quant_review.py",
            ".venv/bin/python scripts/market/nifty_research_build.py",
        ]
    )

    return f"""
<section class="block" id="evidence">
  <div class="kicker">Evidence</div>
  <h2>Sources, windows, scripts — and what is not measurable</h2>
  <p class="lede">Every number on this page is reproducible from the four local recorders plus the quant
    review. Nothing is fetched at read time; the page is a static artifact of the
    {SESSION} session.</p>

  <h3>Inputs on disk</h3>
  {table(["File", "Window (IST)", "Rows", "What it carries"], sources, min_width=820)}
  <p class="caption">Chain gaps &gt;20s: {int(gaps['chain_gaps_gt_20s'])} (max {n(float(gaps['chain_max_s']),1)}s).
    Tape gaps &gt;90s: {int(gaps['tape_gaps_gt_90s'])} (max {n(float(gaps['tape_max_s']),1)}s).
    Recorder failures: {int(dq['recorder_failures']['n'])} at
    {esc(', '.join(dq['recorder_failures']['times']))}. Per-strike volume drops: tape
    {int(dq['per_strike_vol_drops'])}, 10s chain {int(dq['chain_volume_drops']):,}
    ({pct(float(dq['chain_volume_drop_share']))} of {int(dq['chain_volume_cells']):,} cells).</p>

  <h3>Section fragments (assembled unmodified)</h3>
  {table(["Section", "Fragment", "Builder", "Data"], fragments, min_width=820)}

  <h3>Rebuild</h3>
  <pre>{esc(commands)}</pre>
  <p class="caption">The assembler verifies each fragment's single <code>data-research-section</code>
    root, rejects page chrome/CDN references and duplicate element ids, then concatenates the fragments
    byte-for-byte. It does not renumber or edit section content.</p>

  <h3>Not in this data</h3>
  <div class="cards">
    <div class="cell"><div class="k">Close / settlement</div><div class="v">Not observed</div>
      <div class="s">Chain ends {dq['truncation']['chain_ends']}, 80 min before the 15:30 cash close.</div></div>
    <div class="cell"><div class="k">Participant identity</div><div class="v">Not observable</div>
      <div class="s">Client / prop / market-maker is not in chain or futures data.</div></div>
    <div class="cell"><div class="k">Aggressor side</div><div class="v">Not observable</div>
      <div class="s">Buy vs sell volume is inferred from premium + OI, never identified.</div></div>
    <div class="cell"><div class="k">Order book</div><div class="v">Not captured</div>
      <div class="s">No depth, queue position, sweeps or block trades.</div></div>
    <div class="cell"><div class="k">Costs / execution</div><div class="v">Not modelled</div>
      <div class="s">No backtest, no slippage, no costs — this is not a strategy result.</div></div>
    <div class="cell"><div class="k">0-DTE closure prior</div><div class="v">Five sessions</div>
      <div class="s">Counts, not probabilities; Wilson intervals span most of [0,1].</div></div>
  </div>
</section>
"""


def build_footer(review: dict, anatomy: dict, generated: datetime) -> str:
    return f"""
<footer class="foot">
  <p><b>Sources</b> · <code>experiments/data/nifty_tape/{SESSION}.jsonl</code> ·
    <code>experiments/data/nifty_chain10s/{SESSION}.jsonl</code> ·
    <code>experiments/data/nifty_snapshots/{SESSION}.jsonl</code> ·
    <code>reports/nifty_{SESSION}/data/futures_1m.json</code> ·
    <code>research/quant_review.json</code> · <code>research/quant_lab.json</code> ·
    <code>research/context.json</code></p>
  <p><b>Scripts</b> · {esc(' · '.join(SCRIPTS))}</p>
  <p><b>Windows</b> · tape {review['data_quality']['windows']['tape'][0]}–{review['data_quality']['windows']['tape'][1]} ·
    10s chain {review['data_quality']['windows']['chain'][0]}–{review['data_quality']['windows']['chain'][1]} ·
    futures 09:15–15:39 (clipped at 14:09) · chain ends 80 min before the 15:30 close ·
    {len(anatomy['events'])} legs ≥20 pts</p>
  <p><b>Generated</b> · sources {esc(review['meta']['generated'][:16].replace('T', ' '))} IST ·
    assembled {generated.strftime('%Y-%m-%d %H:%M')} IST · one session, no out-of-sample period.
    Every forward-looking claim is a hypothesis, not investment advice.</p>
  <div class="links">
    <a href="index.html">← Report index</a>
    <a href="01-flow.html">01 Flow</a>
    <a href="02-positioning.html">02 Positioning</a>
    <a href="03-futures.html">03 Futures</a>
    <a href="04-volatility.html">04 Volatility</a>
    <a href="05-replay.html">05 Session replay</a>
    <a href="06-3d.html">06 3D surface</a>
  </div>
</footer>
"""


# --------------------------------------------------------------------------
# 2026-10-27 chrome (no futures lane: no archive exists for the session)
# --------------------------------------------------------------------------


def build_overview_1027(review: dict, lab: dict, anatomy: dict) -> str:
    session = anatomy["session"]
    dq = review["data_quality"]
    counts = dq["counts"]
    cov = dq["session_coverage"]
    gaps = dq["gaps"]
    pin = review["pin"]
    close = pin["close_proxy"]
    bursts = lab["microstructure"]["volume_bursts"]["n"]
    legs = len(anatomy["events"])
    ts = dq["windows"]

    guide = (
        ("research-pin-gamma", "Pin &amp; gamma",
         "Max pain, walls and net GEX across 308 minutes — and a close that landed 0.25 pts from the pin."),
        ("research-participant-flow", "Participant flow",
         "Strike × time classification of buildup, covering and unwinding on a 5-minute grid."),
        ("research-vol-decay", "Vol &amp; decay",
         "The IV smile, the straddle's 81.2% bleed and an exact spot/theta/IV split per contract."),
        ("research-intraday-anatomy", "Pump-dump anatomy",
         f"All {legs} legs, each tested against the wall/gamma/flow drivers and given a falsifier."),
        ("quant-verdict", "Quant verdict",
         "Observed vs inferred vs hypothesised vs falsified, with n_eff and CI caveats."),
        ("evidence", "Evidence",
         "Sources, windows, rebuild commands — and what this session cannot answer."),
    )
    guide_html = "".join(
        f'<a href="#{anchor}"><div class="t">{title}</div><div class="d">{desc}</div></a>'
        for anchor, title, desc in guide
    )

    return f"""
<section class="block" id="overview">
  <div class="kicker">NIFTY · 0-DTE · expiry {SESSION_1027} · research</div>
  <h1>The one session with a real close: 0.25 points from max pain, and almost no forward signal</h1>
  <p class="lede">Four independent cuts on one expiry day, with a statistical verdict on top. Unlike the
    truncated sessions, this tape reaches the closing print: spot settled at
    <b>{n(float(close['close_value']), 2)}</b> at {close['close_minute']} against a max pain of
    <b>{n(float(pin['max_pain']['last']), 0)}</b> — <b>{n(float(close['dist_to_last_max_pain']), 2)} pts</b>.
    The pin is the one clean outcome. Everything predictive on this page stays at hypothesis level or falls
    over: no trigger survives its baseline, and every surviving flow correlation sits at a <b>negative lag</b>.</p>
  <div class="badges">
    <span class="badge hot">0-DTE</span>
    <span class="badge">NIFTY</span>
    <span class="badge">Expiry {SESSION_1027}</span>
    <span class="badge">Close included · 15:29</span>
    <span class="badge warn">n = 1 session</span>
    <span class="badge warn">starts 10:04</span>
    <span class="badge warn">no futures archive</span>
  </div>
  <div class="stats">
    <div class="stat"><div class="k">Instrument</div><div class="v">NIFTY 0-DTE</div>
      <div class="s">Weekly expiry · {SESSION_1027}</div></div>
    <div class="stat"><div class="k">Spot path (tape)</div>
      <div class="v">{n(float(session['first']), 2)} → {n(float(session['last']), 2)}</div>
      <div class="s">{signed(float(session['net']), 2)} pts ·
        {signed(float(session['net']) / float(session['first']) * 100, 2)}% · close printed</div></div>
    <div class="stat"><div class="k">Session range</div>
      <div class="v">{n(float(session['range']), 1)} pts</div>
      <div class="s">low {n(float(session['low']['v']), 2)} ({session['low']['t']}) ·
        high {n(float(session['high']['v']), 2)} ({session['high']['t']})</div></div>
    <div class="stat"><div class="k">Events</div><div class="v">{legs} legs ≥20 pts</div>
      <div class="s">{bursts} volume bursts (&gt;3 MAD) · 6 detected event windows</div></div>
    <div class="stat"><div class="k">Data window</div><div class="v">10:04 → 15:29</div>
      <div class="s">{counts['tape_rows']} tape · {counts['chain_rows']:,} chain ·
        {counts['snap_rows']} snapshots · {counts['futures_candles']} futures</div></div>
    <div class="stat"><div class="k">Pin result</div>
      <div class="v">{n(float(close['dist_to_last_max_pain']), 2)} pts</div>
      <div class="s">close {n(float(close['close_value']), 2)} vs max pain
        {n(float(pin['max_pain']['last']), 0)} · put wall
        {signed(float(close['dist_to_last_put_wall']), 2)}</div></div>
  </div>
  <div class="caveat"><b>Read the coverage first.</b> The tape starts at 10:04:15 —
    <b>{int(cov['minutes_missing_at_open'])} minutes after the 09:15 open</b> — because 18 chain calls
    returned 401 between 09:46:14 and 10:03:14. A <b>{n(float(gaps['tape_max_s']) / 60, 1)}-minute
    blackout</b> (12:18–12:37) breaks the tape and the chain, and spot is carried flat at
    22,760.75 from 15:15 through 15:27, with the 15:28–15:29 prints repeating 22,749.75. The close itself
    ({close['close_minute']}, <code>cas</code> flag) <b>is</b> in the data, so the pin is a
    settlement-print distance — but it is one observation, not a hit rate.</div>
  <div class="coverage">
    <div class="cell"><div class="k">NIFTY futures · 1-minute</div>
      <div class="v">UNAVAILABLE — no archive</div>
      <div class="s"><code>reports/nifty_{SESSION_1027}/data/futures_1m.json</code> does not exist for this
        session. Basis, futures OI and cross-instrument lead–lag are therefore <b>not measurable</b> and
        are not estimated from another date or a proxy.</div></div>
    <div class="cell"><div class="k">SENSEX · tape / chain</div>
      <div class="v">UNAVAILABLE — no archive</div>
      <div class="s">No SENSEX tape or 10-second chain was recorded on {SESSION_1027}, so there is no
        cross-market lane. The page carries no SENSEX series and no divergence claim.</div></div>
  </div>
  <p class="caption">Both absences are data facts, not omissions: the four sections below have no futures
    or SENSEX panel, and the verdict marks the missing tests as <b>not measurable</b>.</p>
  <div class="guide">{guide_html}</div>
  <p class="caption">Reading order: the four research sections are unmodified fragments; the quant verdict
    after them is the referee. Section numbers belong to the fragments, not to this page.</p>
</section>
"""


def build_quant_1027(review: dict, lab: dict) -> str:
    dq = review["data_quality"]
    pin = review["pin"]
    cd = review["cross_day"]
    sr = review["session_read"]
    ll = review["lead_lag"]
    cond = review["conditional_returns"]
    es = review["effective_sample"]
    flows = review["flows"]
    cp = pin["close_proxy"]
    mp = pin["max_pain"]
    ol = cd["close_only"]
    hist = cd["history"]
    peaks = ll["flow_peaks"]
    mt = ll["multiple_testing"]
    chain = ll["chain10s"]
    surface = lab["surface"]
    oi_p = lab["microstructure"]["oi_persistence"]
    reg = lab["regime"]
    expl = surface["explained"]
    load = surface["loadings"]

    cells = []
    for name, bundle in cond["triggers"].items():
        for horizon, row in bundle.items():
            cells.append((name, horizon, float(row["excess_shift_p"])))
    best = min(cells, key=lambda item: item[2])
    best_n = int(cond["triggers"][best[0]][best[1]]["n"])
    best_episodes = int(cond["triggers"][best[0]][best[1]]["n_episodes"])
    itm15 = cond["triggers"]["itm_pe_volume_top_decile"]["15m"]

    corrections = f"""
<div class="corr-grid">
  <div class="corr good">
    <div class="hd"><h4>The close landed on max pain — 0.25 pts</h4>{pill('Observed')}</div>
    <p>{cp['close_minute']} printed <b>{n(float(cp['close_value']), 2)}</b> against a last max pain of
      <b>{n(float(mp['last']), 0)}</b>; the print carries the <code>cas</code> flag, so this is a
      settlement-print distance and the session's one genuine pin. {int(mp['changes'])} changes across
      {int(mp['unique'])} levels, modal {n(float(mp['modal']), 0)} for
      {pct(float(mp['modal_share']))} of the tape. <b>One observation</b> — a hit, not a hit rate.</p>
  </div>
  <div class="corr">
    <div class="hd"><h4>2 of 4 genuine closes within 25 pts</h4>{pill('Hypothesis')}</div>
    <p>Excluding the one session that stops before 15:25,
      <b>{int(ol['within_25'])} of {int(ol['n'])}</b> closes sit within 25 pts (Wilson
      {pct(float(ol['wilson_25'][0]))}–{pct(float(ol['wilson_25'][1]))}); {int(ol['within_50'])} of
      {int(ol['n'])} within 50. Counting last prints instead gives {int(cd['counts']['within_25'])} of
      {int(cd['n'])} (Wilson {pct(float(cd['wilson_25'][0]))}–{pct(float(cd['wilson_25'][1]))}), but that
      includes a truncated session. Print “2 of 4”, never “50%”.</p>
  </div>
  <div class="corr bad">
    <div class="hd"><h4>Flow leads price</h4>{pill('Falsified')}</div>
    <p>All {len(peaks)} families clear the Bonferroni threshold (|r| &gt; {n(float(mt['r_critical']), 3)},
      {int(mt['tests'])} tests) — and <b>every one sits at a negative lag</b>:
      ITM PE volume r = {n(float(peaks['itm_pe_volume_vs_price']['r']), 3)} at lag
      {int(peaks['itm_pe_volume_vs_price']['lag'])}, ITM PE OI r =
      {n(float(peaks['itm_pe_oi_vs_price']['r']), 3)} at lag {int(peaks['itm_pe_oi_vs_price']['lag'])},
      call-wall OI r = {n(float(peaks['call_wall_oi_vs_price']['r']), 3)} at lag
      {int(peaks['call_wall_oi_vs_price']['lag'])}. That is a reporting lag: the flow is measured
      <b>after</b> the move it would need to predict.</p>
  </div>
  <div class="corr bad">
    <div class="hd"><h4>No conditional trigger survives</h4>{pill('Falsified')}</div>
    <p>{len(cells)} trigger × horizon cells; the smallest shift p is <b>p={best[2]:.3f}</b>
      ({esc(best[0].replace('_', ' '))}, {best[1]}, n={best_n}, {best_episodes} episodes). The headline
      ITM-PE trigger is {signed(float(itm15['excess_vs_baseline']), 1)} pts excess at 15m with
      <b>p={float(itm15['excess_shift_p']):.3f}</b> and {int(itm15['n'])} minutes that collapse into
      {int(itm15['n_episodes'])} episodes. <b>0 of {len(cells)}</b> clear α=0.05.</p>
  </div>
  <div class="corr bad">
    <div class="hd"><h4>One level factor explains the IV surface</h4>{pill('Falsified')}</div>
    <p>PC1 {pct(float(expl[0]))}, PC2 <b>{pct(float(expl[1]))}</b> — the second factor is nearly as large.
      PC1's leading loading is <b>linear</b> in moneyness (basis R² {n(float(load['pc1']['basis_r2']), 2)}),
      PC2 is flat (R² {n(float(load['pc2']['basis_r2']), 2)}), so the move is a <b>rotation, not a parallel
      shift</b>. {int(surface['n_snapshots'])} smiles, one expiry.</p>
  </div>
  <div class="corr hyp">
    <div class="hd"><h4>Regime break at 14:15</h4>{pill('Hypothesis')}</div>
    <p>CUSUM peaks at {reg['cusum_return']['cusum_peak_time']} (stat
      {n(float(reg['cusum_return']['cusum_stat']), 2)}) with block-permutation
      <b>p={float(reg['cusum_return']['permutation_p']):.3f}</b>; on absolute returns p=
      {float(reg['cusum_abs_return']['permutation_p']):.3f}. <b>No break is detected</b>, which is not the
      same as no break: a 15-minute block null at n={int(reg['cusum_return']['n'])} has little power.</p>
  </div>
  <div class="corr">
    <div class="hd"><h4>0-DTE volume builds open interest</h4>{pill('Falsified')}</div>
    <p>Median ΔOI/Δvolume is <b>{n(float(oi_p['median_doi_over_dvol']), 3)}</b> (p10
      {n(float(oi_p['p10']), 3)}, p90 {n(float(oi_p['p90']), 3)}) over
      {int(oi_p['n_strike_windows']):,} strike-windows. Negative: the afternoon retires OI faster than
      volume accumulates. The counts are strike-windows, not independent observations.</p>
  </div>
</div>
"""

    evidence_rows = [
        [
            "Close lands within 25 pts of max pain",
            f"{n(float(cp['dist_to_last_max_pain']), 2)} pts at {cp['close_minute']} "
            f"({n(float(cp['close_value']), 2)} vs {n(float(mp['last']), 0)})",
            "1 close",
            pill("Observed"),
            "A print, not a probability; the same-session distance is a settlement identity.",
        ],
        [
            "0-DTE closes pin within 25 pts",
            f"{int(ol['within_25'])}/{int(ol['n'])} genuine closes · Wilson {pct(float(ol['wilson_25'][0]))}–{pct(float(ol['wilson_25'][1]))}",
            f"{int(ol['n'])} closes · {int(cd['n'])} last prints",
            pill("Hypothesis"),
            "Four clusters; 3/5 counting last prints includes a session that stops before 15:25.",
        ],
        [
            "Flow leads price",
            f"3/3 families clear |r|>{n(float(mt['r_critical']), 3)} at lags −1, −1, −4",
            "306 minutes · n_eff 79.9 (PE volume)",
            pill("Falsified"),
            "Every survivor is a reporting lag; positive-lag families clear nothing.",
        ],
        [
            "A conditional trigger beats its baseline",
            f"best shift p={best[2]:.3f} ({esc(best[0].replace('_', ' '))}, {best[1]})",
            f"{best_n} minutes · {best_episodes} episodes",
            pill("Falsified"),
            "0/12 cells below 0.05; the trigger masks were chosen after seeing the day.",
        ],
        [
            "One level factor explains the IV surface",
            f"PC1 {pct(float(expl[0]))} · PC2 {pct(float(expl[1]))} · PC1 {load['pc1']['shape']}",
            f"{int(surface['n_snapshots'])} smiles",
            pill("Falsified"),
            "PC2 carries a third of the variance; PC1 is a moneyness rotation.",
        ],
        [
            "A regime break at 14:15",
            f"CUSUM {n(float(reg['cusum_return']['cusum_stat']), 2)} · p={float(reg['cusum_return']['permutation_p']):.3f}",
            f"{int(reg['cusum_return']['n'])} returns",
            pill("Hypothesis"),
            "Not detected, not excluded: the block null has low power at this n.",
        ],
        [
            "0-DTE volume builds open interest",
            f"median ΔOI/Δvol {n(float(oi_p['median_doi_over_dvol']), 3)} (p10 {n(float(oi_p['p10']), 3)})",
            f"{int(oi_p['n_strike_windows']):,} strike-windows",
            pill("Observed"),
            "Net retirement; strike-windows are not independent, and one session only.",
        ],
        [
            "Spot inside the near call/put wall band",
            f"{pct(float(pin['walls']['inside_share']))} of minutes",
            f"{int(pin['walls']['n'])} minutes",
            pill("Observed"),
            "Near-tautological: the walls are re-derived each minute from the same OI it scores against.",
        ],
        [
            "The chain's cumulative volume is a clean counter",
            f"{pct(float(dq['chain_volume_drop_share']))} of reads decrease ({int(dq['chain_volume_drops']):,}/{int(dq['chain_volume_cells']):,})",
            f"{int(dq['chain_volume_cells']):,} cells",
            pill("Falsified"),
            "Needs a running-max repair before differencing; minute flow is built from the tape.",
        ],
        [
            "The tape covers the session",
            f"first {dq['session_coverage']['first_sample']}, {int(dq['session_coverage']['minutes_missing_at_open'])} min missing at the open, "
            f"{n(float(dq['gaps']['tape_max_s']) / 60, 1)}-min hole",
            f"{int(dq['counts']['tape_rows'])} rows",
            pill("Falsified"),
            "Reported as a coverage limit, never repaired or interpolated.",
        ],
        [
            "ITM put volume concentrates before the move",
            f"top-decile next-1m mean {signed(float(lab['distributions']['conditional_deciles']['itm_pe_volume'][-1]['mean_pts']), 2)} pts "
            f"vs d1 {signed(float(lab['distributions']['conditional_deciles']['itm_pe_volume'][0]['mean_pts']), 2)}",
            "29 vs 31 minutes",
            pill("Observed"),
            "Sign flips at 15m — the mechanical same-minute co-movement confound.",
        ],
        [
            "“Institutions bought puts”",
            "counterparty and aggressor are not observable",
            "—",
            pill("Inference"),
            "Chain data carries price and OI only; no participant identity or aggressor side.",
        ],
    ]

    series_rows = []
    for key, row in es["series"].items():
        ratio = float(row["n"]) / float(row["n_eff_bartlett"])
        series_rows.append([
            f"<code>{esc(key)}</code>",
            f"{int(row['n']):,}",
            f"{n(float(row['n_eff_bartlett']), 1)}",
            f"{n(float(row['rho1']), 3)}",
            f"{n(float(row['rho5']), 3)}",
            f"{n(ratio, 2)}×",
        ])

    flow_rows = []
    for index, flow in enumerate(flows, start=1):
        flow_rows.append([
            str(index),
            f"<strong>{esc(flow['flow'])}</strong>",
            f"{int(flow['snr'])}/5",
            esc(flow["latency"]),
            esc(flow["sample"]),
            esc(flow["failure"]),
        ])

    na_eff = float(es["series"]["itm_pe_minute_volume"]["n_eff_bartlett"])
    n_rows = int(es["series"]["itm_pe_minute_volume"]["n"])
    overlap = es["overlap"]

    return f"""
<section class="block" id="quant-verdict">
  <div class="kicker">Quant verdict</div>
  <h2>What survives, what is inferred, what is falsified</h2>
  <p class="lede">Built from this session's <code>quant_review.json</code> and <code>quant_lab.json</code>.
    The review exists because the four sections were written first and the claims were tested afterwards.
    One session, four genuine closes in the cross-day pool, no out-of-sample period, no execution model,
    no costs — so the highest status any forward-looking claim can reach here is <b>Hypothesis</b>.
    The missing futures archive also removes the one test that could have separated flow from price
    discovery: cross-instrument lead–lag is marked <b>not measurable</b>, not proxied.</p>
  {corrections}
  <h3>Evidence table — claim, statistic, effective sample, status</h3>
  {table(
      ["Claim", "Statistic", "n / n_eff", "Status", "Why it stands / what would break it"],
      evidence_rows,
      min_width=900,
  )}
  <p class="caption">Statuses: <b>Observed</b> = measured in this data; <b>Inference</b> = follows only
    under an assumption (dealer sign, moneyness attribution); <b>Hypothesis</b> = suggestive but not
    separable from baseline with this sample; <b>Falsified</b> = does not reproduce under the stated test.</p>

  <div class="two-col">
    <div>
      <h3>Effective sample (Bartlett n_eff)</h3>
      {table(
          ["Series", "Rows", "n_eff", "ρ₁", "ρ₅", "Rows per n_eff"],
          series_rows,
          numeric={1, 2, 3, 4, 5},
          min_width=560,
      )}
      <p class="caption">ITM PE minute volume carries <b>{n(n_rows / na_eff, 1)}× fewer independent
        observations</b> than its {n_rows} rows suggest (n_eff {n(na_eff,1)}). A 15-minute forward return
        leaves {n(float(overlap['15m']['independent_minutes']),1)} independent windows; 30m
        {n(float(overlap['30m']['independent_minutes']),1)}; 60m {n(float(overlap['60m']['independent_minutes']),1)}.
        The cross-day pool is {int(cd['n'])} sessions, of which {int(cd['n']) - int(cd['n_truncated'])}
        carry a genuine close.</p>
    </div>
    <div>
      <h3>CI and multiplicity caveats</h3>
      <ul class="list">
        <li><b>n_eff is not n.</b> Serial correlation is strong (ρ₁ {n(float(es['series']['itm_pe_minute_volume']['rho1']),2)}
          on put volume), so a {n_rows}-row series behaves like ~{n(na_eff,0)} independent observations.</li>
        <li><b>Overlapping windows.</b> Forward returns at h minutes overlap h-fold;
          {int(overlap['15m']['raw_minutes'])} raw minutes are {n(float(overlap['15m']['independent_minutes']),1)}
          independent 15m windows.</li>
        <li><b>Four closes = four clusters.</b> The Wilson interval on 2/4 is
          {pct(float(ol['wilson_25'][0]))}–{pct(float(ol['wilson_25'][1]))}. Print “2 of 4”, never “50%”.</li>
        <li><b>Multiple testing.</b> {int(mt['tests'])} correlations across three families and 21 lags:
          {n(float(mt['expected_false_positives_at_5pct']),1)} false positives expected at α=0.05;
          the Bonferroni-critical |r| is {n(float(mt['r_critical']),3)} for n≈{int(mt['n_reference'])}.</li>
        <li><b>Selected after the fact.</b> Triggers and event windows were chosen after seeing the day;
          without an out-of-sample period the shift-test p-values are descriptive, not confirmatory.</li>
        <li><b>Observations, not causes.</b> “OI rose while spot stalled” is supported; “dealers defended”
          is not. Chain data has no participant identity, aggressor side or order-book depth.</li>
        <li><b>Inside the chain feed.</b> The ATM straddle's signed spot correlation is
          {n(float(chain['r_signed_lag0']),3)} (95% CI {n(float(chain['signed_lag0_ci'][0]),3)} to
          {n(float(chain['signed_lag0_ci'][1]),3)}) — the expected delta-neutral null. The IV-lead test is
          {n(float(chain['r_lead_abs_next_minute']),3)} against a 5% critical |r| of
          {n(float(chain['r_critical_5pct']),3)}: <b>no implied-vol-leads-realised-move effect</b>.</li>
        <li><b>Coverage.</b> {int(dq['session_coverage']['minutes_missing_at_open'])} minutes at the open and
          a {n(float(dq['gaps']['tape_max_s']) / 60, 1)}-minute hole (12:18–12:37) are absent; the
          {n(float(dq['session_coverage']['minutes_missing_into_close']),0)}-minute-to-close figure is 0
          because the close print exists.</li>
      </ul>
    </div>
  </div>

  <h3>Best data flows for positioning (ranked by signal-to-noise)</h3>
  {table(
      ["#", "Flow", "SNR", "Latency", "Sample", "Never read it alone because"],
      flow_rows,
      numeric={0, 2},
      min_width=900,
  )}
  <p class="caption">SNR is the review's 1–5 grading, not a measured ratio. Flows 1, 2 and 5 carry five
    sessions; the rest are single-session or assumption-dependent. The stale spot at 15:15–15:28 is one
    more reason not to read the last quarter-hour minute-by-minute: the tape repeats a carried value until
    the closing print.</p>
  <p class="note">Bottom line: the pin is real — {n(float(cp['dist_to_last_max_pain']), 2)} pts from max pain
    on a printed close — and it is the only clean outcome. The flow reads are descriptive; every trigger
    excess sits inside its baseline, every surviving correlation is measured after the move, and the
    surface is two factors rather than one. Size decisions off the strike-anchored OI observations and the
    baseline, not off a negative-lag flow or a 14:15 break that the permutation test does not support.</p>
</section>
"""


def build_evidence_1027(review: dict, anatomy: dict) -> str:
    dq = review["data_quality"]
    counts = dq["counts"]
    windows = dq["windows"]
    gaps = dq["gaps"]
    cov = dq["session_coverage"]
    fails = dq["recorder_failures"]

    sources = [
        [f"<code>experiments/data/nifty_tape/{SESSION_1027}.jsonl</code>",
         f"{windows['tape'][0]} → {windows['tape'][1]}", f"{counts['tape_rows']:,} rows",
         "spot, per-minute chain, walls, max pain, GEX, ATM IV"],
        [f"<code>experiments/data/nifty_chain10s/{SESSION_1027}.jsonl</code>",
         f"{windows['chain'][0]} → {windows['chain'][1]}", f"{counts['chain_rows']:,} rows",
         "per-strike CE/PE LTP, OI, cumulative volume every ~3–5s"],
        [f"<code>experiments/data/nifty_snapshots/{SESSION_1027}.jsonl</code>",
         f"{windows['snapshots'][0]} → {windows['snapshots'][1]}", f"{counts['snap_rows']:,} rows",
         "report snapshots: walls, GEX strikes, IV surface"],
        [f"<code>reports/nifty_{SESSION_1027}/data/futures_1m.json</code>",
         "absent", f"{counts['futures_candles']} candles",
         "<b>no archive for this session</b> — basis and cross-instrument tests are not measurable"],
        ["<code>research/quant_review.json</code> + <code>quant_lab.json</code>",
         "derived", "review + lab", "effective sample, tests, pin counts, flows, surface factors"],
    ]
    fragments = [
        ["<a href=\"#research-pin-gamma\">Pin &amp; gamma</a>", "research/pin_gamma.html",
         "scripts/market/nifty_research_pin_gamma.py", "pin_gamma.json"],
        ["<a href=\"#research-participant-flow\">Participant flow</a>", "research/participant_flow.html",
         "scripts/market/nifty_research_participant_flow.py", "participant_flow.json"],
        ["<a href=\"#research-vol-decay\">Vol &amp; decay</a>", "research/vol_decay.html",
         "scripts/market/nifty_research_vol_decay.py", "vol_decay.json"],
        ["<a href=\"#research-intraday-anatomy\">Pump-dump anatomy</a>", "research/intraday_anatomy.html",
         "scripts/market/nifty_research_intraday_anatomy.py", "intraday_anatomy.json"],
    ]

    commands = "\n".join(
        [
            ".venv/bin/python scripts/market/nifty_research_pin_gamma.py --session 2026-10-27",
            ".venv/bin/python scripts/market/nifty_research_participant_flow.py --session 2026-10-27",
            ".venv/bin/python scripts/market/nifty_research_vol_decay.py --session 2026-10-27",
            ".venv/bin/python scripts/market/nifty_research_intraday_anatomy.py --session 2026-10-27",
            ".venv/bin/python scripts/market/nifty_research_quant_review.py --session 2026-10-27",
            ".venv/bin/python scripts/market/nifty_research_build.py --session 2026-10-27",
        ]
    )

    return f"""
<section class="block" id="evidence">
  <div class="kicker">Evidence</div>
  <h2>Sources, windows, scripts — and what is not measurable</h2>
  <p class="lede">Every number on this page is reproducible from the three local recorders plus the quant
    review. Nothing is fetched at read time; the page is a static artifact of the
    {SESSION_1027} session.</p>

  <h3>Inputs on disk</h3>
  {table(["File", "Window (IST)", "Rows", "What it carries"], sources, min_width=820)}
  <p class="caption">Chain gaps &gt;20s: {int(gaps['chain_gaps_gt_20s'])} (max
    {n(float(gaps['chain_max_s']),1)}s). Tape gaps &gt;90s: {int(gaps['tape_gaps_gt_90s'])} (max
    {n(float(gaps['tape_max_s']),1)}s = {n(float(gaps['tape_max_s']) / 60,1)} min, 12:18→12:37).
    Recorder failures: {int(fails['n'])} between {esc(fails['first'])} and {esc(fails['last'])}
    ({esc(', '.join(f'{k}×{v}' for k, v in fails['reasons'].items()))}). Per-strike cumulative-volume
    drops: tape {int(dq['per_strike_vol_drops'])}, 10s chain {int(dq['chain_volume_drops']):,}
    ({pct(float(dq['chain_volume_drop_share']))} of {int(dq['chain_volume_cells']):,} cells).
    First sample {cov['first_sample']}, last {cov['last_sample']}, close printed
    {'yes' if cov['close_printed'] else 'no'}.</p>

  <h3>Section fragments (assembled unmodified)</h3>
  {table(["Section", "Fragment", "Builder", "Data"], fragments, min_width=820)}

  <h3>Rebuild</h3>
  <pre>{esc(commands)}</pre>
  <p class="caption">The assembler verifies each fragment's single <code>data-research-section</code>
    root, rejects page chrome/CDN references and duplicate element ids, then concatenates the fragments
    byte-for-byte. It does not renumber or edit section content.</p>

  <h3>Not in this data</h3>
  <div class="cards">
    <div class="cell"><div class="k">NIFTY futures</div><div class="v">No archive</div>
      <div class="s">No 1-minute futures file: basis, futures OI and cross-instrument lead–lag are absent,
        not estimated.</div></div>
    <div class="cell"><div class="k">SENSEX</div><div class="v">No archive</div>
      <div class="s">No SENSEX tape or chain for this session, so no cross-market comparison is drawn.</div></div>
    <div class="cell"><div class="k">Opening 49 minutes</div><div class="v">Not recorded</div>
      <div class="s">First sample 10:04:15; the opening range and first-hour OI book are outside the data.</div></div>
    <div class="cell"><div class="k">12:18–12:37</div><div class="v">Gap</div>
      <div class="s">{n(float(gaps['tape_max_s']) / 60,1)} minutes missing from tape and chain; forward
        returns spanning it are dropped, not interpolated.</div></div>
    <div class="cell"><div class="k">Participant identity</div><div class="v">Not observable</div>
      <div class="s">Client / prop / market-maker is not in chain data.</div></div>
    <div class="cell"><div class="k">Aggressor side</div><div class="v">Not observable</div>
      <div class="s">Buy vs sell volume is inferred from premium + OI, never identified.</div></div>
    <div class="cell"><div class="k">Order book</div><div class="v">Not captured</div>
      <div class="s">No depth, queue position, sweeps or block trades.</div></div>
    <div class="cell"><div class="k">Costs / execution</div><div class="v">Not modelled</div>
      <div class="s">No backtest, no slippage, no costs — this is not a strategy result.</div></div>
  </div>
</section>
"""


def build_footer_1027(review: dict, anatomy: dict, generated: datetime) -> str:
    dq = review["data_quality"]
    return f"""
<footer class="foot">
  <p><b>Sources</b> · <code>experiments/data/nifty_tape/{SESSION_1027}.jsonl</code> ·
    <code>experiments/data/nifty_chain10s/{SESSION_1027}.jsonl</code> ·
    <code>experiments/data/nifty_snapshots/{SESSION_1027}.jsonl</code> ·
    <code>research/quant_review.json</code> · <code>research/quant_lab.json</code></p>
  <p><b>Scripts</b> · {esc(' · '.join(SCRIPTS_1027))}</p>
  <p><b>Windows</b> · tape {dq['windows']['tape'][0]}–{dq['windows']['tape'][1]} ·
    10s chain {dq['windows']['chain'][0]}–{dq['windows']['chain'][1]} ·
    snapshots {dq['windows']['snapshots'][0]}–{dq['windows']['snapshots'][1]} ·
    close printed 15:29 · no futures archive · {len(anatomy['events'])} legs</p>
  <p><b>Generated</b> · sources {esc(review['meta']['generated'][:16].replace('T', ' '))} IST ·
    assembled {generated.strftime('%Y-%m-%d %H:%M')} IST · one session, no out-of-sample period.
    Every forward-looking claim is a hypothesis, not investment advice.</p>
  <div class="links">
    <a href="index.html">← Report index</a>
    <a href="research/pin_gamma.html">Pin &amp; gamma fragment</a>
    <a href="research/participant_flow.html">Participant flow fragment</a>
    <a href="research/vol_decay.html">Vol &amp; decay fragment</a>
    <a href="research/intraday_anatomy.html">Anatomy fragment</a>
  </div>
</footer>
"""


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------


def build_page(session: str = DEFAULT_SESSION, generated: datetime | None = None) -> str:
    if session == SESSION_1027:
        return _build_page_1027(generated)
    if session != SESSION:
        raise BuildError(f"no profile for session {session!r}")

    fragments = load_fragments()
    review, lab, context, anatomy = load_inputs()
    verify_context(context, anatomy)
    generated = generated or datetime.now(IST)

    nav = "".join(f'<a href="#{anchor}">{label}</a>' for anchor, label in NAV)
    body = "\n".join(
        f"<!-- section: {section.section_id} — fragment inserted unmodified -->\n{text}"
        for section, text in fragments
    )

    head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="NIFTY 0-DTE research, {SESSION}: pin and gamma, participant flow, volatility decay, futures basis, intraday anatomy, and a quant verdict with effective sample and CI caveats.">
<title>NIFTY 0-DTE research — {SESSION}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://cdn.plot.ly" crossorigin>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>{CSS}</style>
</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="brand" href="index.html">NIFTY 0-DTE <span>{SESSION}</span></a>
    <nav class="nav" aria-label="Research sections">{nav}</nav>
    <a class="top-link" href="index.html">Index</a>
  </div>
</header>
<main class="page">
"""

    page = (
        head
        + build_overview(context, review, lab, anatomy)
        + body
        + build_quant(review, lab)
        + build_evidence(review)
        + build_footer(review, anatomy, generated)
        + "\n</main>\n<script>"
        + NAV_JS
        + "</script>\n</body>\n</html>\n"
    )

    validate_page(page, fragments, review, lab)
    return page


def _build_page_1027(generated: datetime | None = None) -> str:
    fragments = load_fragments(SECTIONS_1027, research_dir(SESSION_1027))
    review, lab, anatomy = load_inputs_1027()
    verify_context_1027(review, anatomy)
    generated = generated or datetime.now(IST)

    nav = "".join(f'<a href="#{anchor}">{label}</a>' for anchor, label in NAV_1027)
    body = "\n".join(
        f"<!-- section: {section.section_id} — fragment inserted unmodified -->\n{text}"
        for section, text in fragments
    )

    head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="NIFTY 0-DTE research, {SESSION_1027}: pin and gamma, participant flow, volatility decay, intraday anatomy, and a quant verdict with effective sample and CI caveats. Close included; no futures archive.">
<title>NIFTY 0-DTE research — {SESSION_1027}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://cdn.plot.ly" crossorigin>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>{CSS}{CSS_1027}</style>
</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="brand" href="index.html">NIFTY 0-DTE <span>{SESSION_1027}</span></a>
    <nav class="nav" aria-label="Research sections">{nav}</nav>
    <a class="top-link" href="index.html">Index</a>
  </div>
</header>
<main class="page">
"""

    page = (
        head
        + build_overview_1027(review, lab, anatomy)
        + body
        + build_quant_1027(review, lab)
        + build_evidence_1027(review, anatomy)
        + build_footer_1027(review, anatomy, generated)
        + "\n</main>\n<script>"
        + NAV_JS
        + "</script>\n</body>\n</html>\n"
    )

    validate_page_1027(page, fragments)
    return page


def _shared_checks(page: str, fragments: list[tuple[Section, str]]) -> None:
    for section, text in fragments:
        if text not in page:
            raise BuildError(f"fragment {section.stem} was mutated during assembly")
        if page.count(f'data-research-section="{section.section_id}"') != 1:
            raise BuildError(f"section {section.section_id} appears {page.count(section.section_id)} times")

    anchors = set(re.findall(r'id="([^"]+)"', page))
    for target in re.findall(r'href="#([^"]+)"', page):
        if target not in anchors:
            raise BuildError(f"unresolved anchor: #{target}")

    if page.count("d3@7.9.0") != 1 or page.count("plotly-2.35.2") != 1:
        raise BuildError("D3 and Plotly must each be loaded exactly once")

    order = [page.index(f'data-research-section="{s.section_id}"') for s, _ in fragments]
    if order != sorted(order):
        raise BuildError("fragment order is not the declared order")
    if not page.startswith("<!doctype html>"):
        raise BuildError("missing doctype")


def validate_page(page: str, fragments: list[tuple[Section, str]], review: dict, lab: dict) -> None:
    """Cheap structural checks; the browser checks live in the validation run."""
    _shared_checks(page, fragments)

    if "135.0M" in page:
        raise BuildError("falsified 135.0M string leaked into the assembled page")
    if "0.15" not in page:
        raise BuildError("clock-aligned lead-lag (0.15) is missing from the verdict")
    if "n_eff" not in page or "95% CI" not in page:
        raise BuildError("effective-sample labels are missing")


def validate_page_1027(page: str, fragments: list[tuple[Section, str]]) -> None:
    _shared_checks(page, fragments)

    if 'data-research-section="futures-cross"' in page:
        raise BuildError("10-27 page must not carry a futures section")
    for ref in ('href="#research-futures-cross"', "research/futures_cross.html"):
        if ref in page:
            raise BuildError(f"futures fragment reference leaked into the 10-27 page: {ref}")

    for token, why in {
        "2026-10-27": "the session stamp",
        "22,749.75": "the closing print",
        "22,750": "the last max pain",
        "0.25 pts": "the close-to-pin distance",
        "2 of 4": "the genuine-close count",
        "15.0%–85.0%": "the Wilson interval on 2/4",
        "45.1%": "PC1 explained variance",
        "34.1%": "PC2 explained variance",
        "p=0.238": "the CUSUM permutation p",
        "-0.059": "the OI persistence median",
        "n_eff": "the effective-sample label",
        "95% CI": "a confidence interval",
        "not measurable": "the futures/SENSEX absence",
    }.items():
        if token not in page:
            raise BuildError(f"10-27 page is missing {why} ({token!r})")

    for token, why in {
        "2026-11-17": "another session's date",
        "25,309": "another session's open",
        "25,476": "another session's close",
        "25,500": "another session's focus strike",
        "135.0M": "the falsified 13:05 bucket",
        "14:09:03": "another session's chain truncation",
        "17 legs": "another session's leg count",
        "futures lead spot": "a fabricated cross-instrument lead-lag claim",
    }.items():
        if token in page:
            raise BuildError(f"10-27 page carries {why}: {token!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", default=DEFAULT_SESSION, choices=(SESSION, SESSION_1027),
                        help="expiry session to assemble (default: %(default)s)")
    parser.add_argument("--out", type=Path, default=None,
                        help="output path (default: reports/nifty_<session>/07-research.html)")
    parser.add_argument("--check", action="store_true", help="verify the on-disk page is current")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    out = args.out or default_out(args.session)
    try:
        page = build_page(args.session)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.check:
        if not out.exists():
            print(f"error: {out} does not exist", file=sys.stderr)
            return 1
        stamp = re.compile(r"assembled \d{4}-\d{2}-\d{2} \d{2}:\d{2} IST")
        current = stamp.sub("assembled <stamp> IST", out.read_text())
        fresh = stamp.sub("assembled <stamp> IST", page)
        if current != fresh:
            print(f"stale: {out} differs from a fresh build", file=sys.stderr)
            return 1
        print(f"ok: {out} is current ({out.stat().st_size:,} bytes)")
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    if not args.quiet:
        sections = SECTIONS if args.session == SESSION else SECTIONS_1027
        print(f"wrote {out} ({len(page.encode()):,} bytes)")
        print(f"sections: {' → '.join(s.section_id for s in sections)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
