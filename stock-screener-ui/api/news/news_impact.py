"""News impact scoring via an OpenRouter FREE model.

Why a model and not keyword matching: a headline like "FM open to hearing
views on LTCG" is market-moving only in context; keyword rules can't tell it
from "FM attends meeting". One batched call per poll cycle classifies a page of
headlines at once, which is what keeps this inside the free tier.

Free-tier budget (OpenRouter `:free` models): **20 requests/minute and
50/day per account** (1,000/day after a $10 top-up). So this module makes ONE
call per invocation and batches headlines into it. Never loop per headline.

Models rotate and older `:free` IDs stop working, so the model list is tried in
order and `openrouter/free` is the last-resort auto-router.

Everything is best-effort: any failure returns `[]`/`0` and logs, so a scoring
outage can never break the news poller.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

import requests

import config

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

#: Preferred model: 1M context and it actually answers inside the timeout.
#: The bigger 550B `nemotron-3-ultra-550b-a55b:free` is real but regularly
#: exceeds a 45s budget, so it is a fallback rather than the default.
DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning:free"

#: Fallbacks, in order. `openrouter/free` auto-routes to a working free model,
#: which makes the integration resilient to a specific `:free` ID being retired.
FALLBACK_MODELS = (
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "thinkingmachines/inkling:free",
    "openrouter/free",
)

#: Headlines per call. One call per cycle keeps us far inside 20 rpm.
MAX_HEADLINES = 25

#: Free tier is 20 requests/minute AND **50 requests/day per account** (shared
#: across every `:free` model). A 60s poller would exhaust that in under an
#: hour, so scoring is throttled: at most one call per MIN_INTERVAL_SEC and at
#: most MAX_CALLS_PER_DAY per calendar day. Budgeting ~13 calls over a 6.5h
#: session leaves headroom for retries.
MIN_INTERVAL_SEC = 900.0
MAX_CALLS_PER_DAY = 40

_last_call_ts: float = 0.0
_calls_today: int = 0
_calls_day: str = ""


def _throttled() -> bool:
    """True when a scoring call must be skipped to protect the free quota."""
    global _calls_today, _calls_day
    import time

    today = time.strftime("%Y-%m-%d")
    if _calls_day != today:
        _calls_day = today
        _calls_today = 0
    if _calls_today >= MAX_CALLS_PER_DAY:
        return True
    return (time.time() - _last_call_ts) < MIN_INTERVAL_SEC


def _record_call() -> None:
    global _last_call_ts, _calls_today
    import time

    _last_call_ts = time.time()
    _calls_today += 1

SYSTEM_PROMPT = (
    "You are an equity market news filter for Indian index traders. "
    "You receive a numbered list of headlines. For EACH headline decide whether "
    "it is likely to move the NIFTY/SENSEX intraday. Be strict: routine "
    "company news, opinion pieces and price recaps are NOT market-moving; "
    "policy, tax, regulator (RBI/SEBI), macro data, large earnings surprises, "
    "index-level flows and geopolitical shocks ARE. "
    "Reply with ONLY a JSON array, no prose, no code fences. Each element: "
    '{"i": <headline number>, "move": true|false, "symbol": "<NIFTY or ticker or empty>", '
    '"dir": "bullish"|"bearish"|"neutral", "impact": 1-5, "why": "<<=90 chars>"}.'
)

_JSON_ARRAY_RE = re.compile(r"\[.*\]", re.DOTALL)


def _extract_json_array(text: str) -> Optional[list]:
    """Pull the first JSON array out of a model reply (tolerates fences/prose)."""
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else None
    except ValueError:
        pass
    match = _JSON_ARRAY_RE.search(text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, list) else None
    except ValueError:
        return None


def _build_user_prompt(headlines: list[str]) -> str:
    lines = [f"{i + 1}. {h}" for i, h in enumerate(headlines)]
    return "Headlines:\n" + "\n".join(lines)


def _post(model: str, api_key: str, user_prompt: str, timeout: float) -> Optional[list]:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0,
    }
    try:
        resp = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                # OpenRouter attribution headers (optional, but recommended).
                "HTTP-Referer": "https://alphashri.local",
                "X-Title": "Alphashri news impact",
            },
            data=json.dumps(body),
            timeout=timeout,
        )
    except requests.RequestException as exc:
        logger.warning("news impact: request failed (%s): %s", model, exc)
        return None

    if resp.status_code != 200:
        logger.info("news impact: HTTP %s from %s", resp.status_code, model)
        return None

    try:
        payload = resp.json()
        content = payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        logger.info("news impact: unparseable envelope from %s", model)
        return None
    return _extract_json_array(content)


def score_headlines(
    headlines: list[str],
    *,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 60.0,
) -> list[dict[str, Any]]:
    """Classify headlines in ONE call. Returns `[]` on any failure.

    Each item: ``{"index": 0-based, "move": bool, "symbol": str,
    "dir": "bullish"|"bearish"|"neutral", "impact": 1..5, "why": str}``.
    """
    heads = [h for h in (headlines or []) if h and str(h).strip()][:MAX_HEADLINES]
    if not heads:
        return []

    api_key = api_key or getattr(config, "OPENROUTER_API_KEY", None)
    if not api_key:
        logger.info("news impact: OPENROUTER_API_KEY not set")
        return []

    models = [model] if model else [DEFAULT_MODEL, *FALLBACK_MODELS]
    user_prompt = _build_user_prompt(heads)

    for candidate in models:
        raw = _post(candidate, api_key, user_prompt, timeout)
        if raw is None:
            continue
        out: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                idx = int(item.get("i")) - 1
            except (TypeError, ValueError):
                continue
            if idx < 0 or idx >= len(heads):
                continue
            impact = item.get("impact")
            try:
                impact = max(1, min(5, int(impact)))
            except (TypeError, ValueError):
                impact = 3
            direction = str(item.get("dir") or "neutral").lower()
            if direction not in ("bullish", "bearish", "neutral"):
                direction = "neutral"
            out.append({
                "index": idx,
                "move": bool(item.get("move")),
                "symbol": str(item.get("symbol") or "")[:24],
                "dir": direction,
                "impact": impact,
                "why": str(item.get("why") or "")[:200],
                "model": candidate,
            })
        if out:
            return out
    return []


def score_recent_articles(limit: int = MAX_HEADLINES) -> dict[str, int]:
    """Score the oldest unscored rows in `news_articles` (one model call).

    Writes `impact_score`, `sentiment` and `analysis_json`. Non-scoring rows
    (move=false) still get an impact score so they are not re-scored forever.
    Returns ``{"scored": n, "moved": n}``; never raises.
    """
    stats = {"scored": 0, "moved": 0, "throttled": 0}
    if _throttled():
        stats["throttled"] = 1
        return stats
    try:
        from db.database import SessionLocal
        from db.models.news import NewsArticle

        db = SessionLocal()
        try:
            rows = (
                db.query(NewsArticle)
                .filter(NewsArticle.impact_score.is_(None))
                .order_by(NewsArticle.published_at.desc().nullslast())
                .limit(max(1, min(int(limit), MAX_HEADLINES)))
                .all()
            )
            if not rows:
                return stats

            _record_call()
            verdicts = score_headlines([r.headline for r in rows])
            if not verdicts:
                return stats

            for v in verdicts:
                row = rows[v["index"]]
                row.impact_score = v["impact"] if v["move"] else 0
                row.sentiment = v["dir"]
                row.analysis_json = json.dumps({
                    "market_moving": v["move"],
                    "symbol": v["symbol"],
                    "direction": v["dir"],
                    "impact": v["impact"],
                    "why": v["why"],
                    "model": v["model"],
                    "source": "openrouter_news_impact",
                })
                stats["scored"] += 1
                if v["move"]:
                    stats["moved"] += 1
            db.commit()
        finally:
            db.close()
    except Exception as exc:  # pragma: no cover - env dependent
        logger.warning("news impact scoring failed: %s", exc)
    return stats
