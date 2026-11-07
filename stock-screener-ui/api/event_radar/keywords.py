"""Keyword classifier for corporate-event headlines and filing excerpts.

WHY a hand-written matcher instead of an LLM or a regex-per-phrase: the
classifier runs over every wire item and every EDGAR hit on each refresh, and
it must be free, deterministic and explainable. ``match()`` returns *which*
phrase fired so the UI/notes can justify a row.

Matching is token based (not naive ``str.find``) so that:

* punctuation and repeated whitespace never hide a hit ("Investor  Day,"),
* "investor days" is recognised as the same event as "investor day",
* "investorday" does NOT match (the phrase must be whole words).

Order in :data:`PHRASE_PRIORITY` is the whole specificity mechanism: the most
qualified phrase is tested first, so "Analyst and Investor Day" resolves to
``analyst_day`` instead of the cheaper ``investor_day`` hit it also contains.
"""

from __future__ import annotations

import re
from typing import Iterable, Sequence

#: event_type -> the phrases that announce it. Keep the phrases lower case and
#: punctuation-faithful: they are normalised at match time, not here.
EVENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "investor_day": ("investor day", "investor conference", "investor meeting"),
    "analyst_day": ("analyst day", "analyst and investor day", "analyst/investor day"),
    "capital_markets_day": ("capital markets day", "capital market day"),
    "strategy_day": ("strategy day", "strategic update"),
    "rnd_day": ("r&d day", "research and development day", "technology day"),
    "business_update": (
        "business update",
        "trading update",
        "operational update",
        "preliminary results",
    ),
    "guidance": (
        "raises guidance",
        "lowers guidance",
        "cuts guidance",
        "reaffirms guidance",
        "updates guidance",
    ),
    "shareholder_meeting": (
        "annual meeting of stockholders",
        "annual general meeting",
        "special meeting of stockholders",
    ),
}

#: Most specific first. ``match`` walks this order and returns the first hit, so
#: a multi-word qualifier must appear above the phrase it contains.
PHRASE_PRIORITY: tuple[str, ...] = (
    # analyst + investor compounds must beat plain "investor day"
    "analyst and investor day",
    "analyst/investor day",
    "capital markets day",
    "capital market day",
    "research and development day",
    "annual meeting of stockholders",
    "special meeting of stockholders",
    "annual general meeting",
    # guidance verbs: the verb is the signal, so the pair outranks anything else
    "raises guidance",
    "lowers guidance",
    "cuts guidance",
    "reaffirms guidance",
    "updates guidance",
    "preliminary results",
    "technology day",
    "investor conference",
    "investor meeting",
    "investor day",
    "analyst day",
    "strategy day",
    "strategic update",
    "r&d day",
    "business update",
    "trading update",
    "operational update",
)

#: Phrases that veto a match *when they overlap it*. Overlap (rather than
#: "appears anywhere in the text") is deliberate: a real investor-day release
#: routinely ends with "record date", and blanket vetoes would throw those away.
#: What we must kill is the ambiguity on the shared trailing token:
#:   "investor day trading"  -> the subject is day trading, not an event.
EXCLUDES: tuple[str, ...] = (
    "day trading",          # shares the trailing "day" of every x-day phrase
    "record date",          # shares "date"-like tail of meeting phrases
    "ex-dividend date",     # dividend mechanics, not a corporate event
    "special meeting of stockholders record date",
)

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _phrases_by_type() -> dict[str, str]:
    """Flatten EVENT_KEYWORDS into phrase -> event_type (order-stable)."""
    return {
        phrase: event_type
        for event_type, phrases in EVENT_KEYWORDS.items()
        for phrase in phrases
    }


_PHRASE_TO_TYPE: dict[str, str] = _phrases_by_type()
_ALL_PHRASES: tuple[str, ...] = tuple(dict.fromkeys(PHRASE_PRIORITY + EXCLUDES))


def _tokens(text: str) -> list[str]:
    """Lower-case alphanumeric tokens; punctuation is a separator, not a token."""
    return _TOKEN_RE.findall(text.lower())


def _token_eq(token: str, wanted: str) -> bool:
    """Whole-word compare with English plural tolerance on the phrase's last word.

    Only the last token gets the tolerance: "investor days" is the same event,
    but "investors day" is not (it means something else entirely).
    """
    return token == wanted or token == f"{wanted}s" or token == f"{wanted}es"


def _starts(tokens: Sequence[str], phrase_tokens: Sequence[str]) -> list[int]:
    """Indexes in ``tokens`` where ``phrase_tokens`` occurs as a whole phrase."""
    width = len(phrase_tokens)
    if width == 0 or width > len(tokens):
        return []
    hits: list[int] = []
    for start in range(len(tokens) - width + 1):
        window = tokens[start : start + width]
        if list(window[:-1]) == list(phrase_tokens[:-1]) and _token_eq(
            window[-1], phrase_tokens[-1]
        ):
            hits.append(start)
    return hits


def _overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _is_vetoed(span: tuple[int, int], tokens: Sequence[str]) -> bool:
    for phrase in EXCLUDES:
        phrase_tokens = _tokens(phrase)
        for start in _starts(tokens, phrase_tokens):
            if _overlaps(span, (start, start + len(phrase_tokens))):
                return True
    return False


def _match_spans(tokens: Sequence[str]) -> list[tuple[str, str, tuple[int, int]]]:
    """All non-vetoed phrase hits as (phrase, event_type, span), most specific first."""
    found: list[tuple[str, str, tuple[int, int]]] = []
    for phrase in PHRASE_PRIORITY:
        event_type = _PHRASE_TO_TYPE.get(phrase)
        if event_type is None:  # phrase list drifted from EVENT_KEYWORDS
            continue
        phrase_tokens = _tokens(phrase)
        for start in _starts(tokens, phrase_tokens):
            span = (start, start + len(phrase_tokens))
            if _is_vetoed(span, tokens):
                continue
            found.append((phrase, event_type, span))
    return found


def matched_phrases(text: str) -> list[str]:
    """Every phrase that fires, most specific first (duplicates collapsed).

    Used by callers that want to explain a verdict (notes, debug endpoints)
    rather than just act on it.
    """
    if not text or not isinstance(text, str):
        return []
    tokens = _tokens(text)
    seen: list[str] = []
    for phrase, _event_type, _span in _match_spans(tokens):
        if phrase not in seen:
            seen.append(phrase)
    return seen


def match(text: str) -> tuple[str | None, str | None]:
    """Best (event_type, matched_phrase) for ``text``, or ``(None, None)``.

    "Best" = the highest-priority phrase present. Returns the canonical phrase
    string (as listed in :data:`EVENT_KEYWORDS`), not the source text, so the
    caller can group hits without re-normalising.
    """
    if not text or not isinstance(text, str):
        return (None, None)
    for phrase, event_type, _span in _match_spans(_tokens(text)):
        return (event_type, phrase)
    return (None, None)


def iter_phrases() -> Iterable[str]:
    """Iterate the canonical phrase list (handy for tests and tooling)."""
    return iter(PHRASE_PRIORITY)


__all__ = [
    "EVENT_KEYWORDS",
    "EXCLUDES",
    "PHRASE_PRIORITY",
    "iter_phrases",
    "match",
    "matched_phrases",
]
