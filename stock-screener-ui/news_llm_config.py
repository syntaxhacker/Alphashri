"""OpenRouter model selection for the news pipeline.

One source for the free-model list used by both the headline impact scorer
(`api/news/news_impact.py`) and the article analyzer (`llm_analyzer.py`).
The model IDs are environment-overridable because `:free` endpoints rotate.
"""

from __future__ import annotations

import os

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

DEFAULT_MODEL = (
    os.getenv("NEWS_OPENROUTER_MODEL", "inclusionai/ling-3.2-flash:free").strip()
    or "inclusionai/ling-3.2-flash:free"
)

FALLBACK_MODELS = tuple(
    model.strip()
    for model in os.getenv(
        "NEWS_OPENROUTER_FALLBACK_MODELS",
        "baidu/ernie-5.5-flash-preview:free,openrouter/free",
    ).split(",")
    if model.strip()
)


def model_candidates(primary: str | None = None) -> tuple[str, ...]:
    """Primary model followed by the configured fallbacks, deduplicated."""
    ordered = (primary or DEFAULT_MODEL, *FALLBACK_MODELS)
    seen: set[str] = set()
    out: list[str] = []
    for model in ordered:
        if model and model not in seen:
            seen.add(model)
            out.append(model)
    return tuple(out)
