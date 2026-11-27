"""Canonical identity, product/unit strata and price-quality checks for agri rows.

Pure module: no I/O, no clock, no database. Raw source strings are preserved on
every result so callers can audit or persist the original spelling, while
``key`` is the stable value used for joins, dedupe and grouping. When a string
cannot be classified the result is an explicit unknown with a ``reason`` — this
module never guesses or coerces a value.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Final, Mapping, Optional

ERROR: Final[str] = "error"
WARNING: Final[str] = "warning"

UNIT_QUINTAL: Final[str] = "inr_per_quintal"
UNIT_BUNDLE: Final[str] = "inr_per_bundle"
UNIT_KG: Final[str] = "inr_per_kg"
UNIT_TONNE: Final[str] = "inr_per_tonne"
UNIT_DOZEN: Final[str] = "inr_per_dozen"
UNIT_PIECE: Final[str] = "inr_per_piece"
UNIT_NUMBER: Final[str] = "inr_per_number"
UNIT_UNKNOWN: Final[str] = "unknown"

QUINTAL_UNIT_KEYS: Final[frozenset[str]] = frozenset({UNIT_QUINTAL})

_WS_RE = re.compile(r"\s+")
_NON_WORD_RE = re.compile(r"[^a-z0-9]+")
_APMC_RE = re.compile(r"\bapmc\b", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Display / key primitives
# ---------------------------------------------------------------------------


def _collapse(value: Any) -> str:
    return _WS_RE.sub(" ", str(value or "").strip())


def _fold(value: Any) -> str:
    """Case/punctuation-insensitive form used only for matching aliases."""
    text = _collapse(value).casefold().replace("&", " and ")
    text = text.replace("'", "").replace("\u2019", "")
    text = _NON_WORD_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def _slug(value: Any) -> str:
    return _NON_WORD_RE.sub("_", _fold(value)).strip("_")


@dataclass(frozen=True)
class CanonicalName:
    """A display string plus its stable key, with the untouched source kept."""

    raw: str
    display: str
    key: str


_STATE_DISPLAYS: Final[dict[str, str]] = {
    "chhattisgarh": "Chhattisgarh",
    "chattisgarh": "Chhattisgarh",
    "kerala": "Kerala",
    "keralam": "Kerala",
    "delhi": "Delhi",
    "delhi nct": "Delhi",
    "nct delhi": "Delhi",
    "nct of delhi": "Delhi",
    "national capital territory of delhi": "Delhi",
    "andaman and nicobar islands": "Andaman and Nicobar Islands",
    "andaman nicobar islands": "Andaman and Nicobar Islands",
    "andaman and nicobar": "Andaman and Nicobar Islands",
    "andaman nicobar": "Andaman and Nicobar Islands",
    "a and n islands": "Andaman and Nicobar Islands",
    "a and n": "Andaman and Nicobar Islands",
    "jammu and kashmir": "Jammu and Kashmir",
    "jammu kashmir": "Jammu and Kashmir",
    "j and k": "Jammu and Kashmir",
    "j k": "Jammu and Kashmir",
    "jk": "Jammu and Kashmir",
}

_DISTRICT_DISPLAYS: Final[dict[str, str]] = {
    "bathinda": "Bathinda",
    "bhatinda": "Bathinda",
    "ballari": "Ballari",
    "bellary": "Ballari",
}

_GRADE_DISPLAYS: Final[dict[str, str]] = {
    "faq": "FAQ",
    "non faq": "Non-FAQ",
    "nonfaq": "Non-FAQ",
}


def _canonical_name(
    value: Any,
    aliases: Optional[Mapping[str, str]] = None,
    *,
    display_transform=None,
) -> CanonicalName:
    raw = str(value or "").strip()
    display = (aliases or {}).get(_fold(raw))
    if display is None:
        display = _collapse(raw)
    if display_transform is not None:
        display = display_transform(display)
    return CanonicalName(raw=raw, display=display, key=_slug(display))


def _canonical_market_display(value: str) -> str:
    return _APMC_RE.sub("APMC", value)


def canonical_state(value: Any) -> CanonicalName:
    return _canonical_name(value, _STATE_DISPLAYS)


def canonical_district(value: Any, *, state_key: Optional[str] = None) -> CanonicalName:
    # ``state_key`` is accepted for callers that disambiguate district names by
    # state later; the current alias table is national and needs no context.
    del state_key
    return _canonical_name(value, _DISTRICT_DISPLAYS)


def canonical_market(
    value: Any,
    *,
    state_key: Optional[str] = None,
    district_key: Optional[str] = None,
) -> CanonicalName:
    del state_key, district_key
    return _canonical_name(value, display_transform=_canonical_market_display)


def canonical_grade(value: Any) -> CanonicalName:
    return _canonical_name(value, _GRADE_DISPLAYS)


def state_key_for(value: Any) -> str:
    return canonical_state(value).key


def district_key_for(value: Any) -> str:
    return canonical_district(value).key


def market_key_for(value: Any) -> str:
    return canonical_market(value).key


def grade_key_for(value: Any) -> str:
    return canonical_grade(value).key


@dataclass(frozen=True)
class Geography:
    """Canonical state/district/market triple.

    ``key`` is the tuple intended for mandi joins; the display tuple keeps the
    canonical labels for rendering.
    """

    state: CanonicalName
    district: CanonicalName
    market: CanonicalName

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.state.key, self.district.key, self.market.key)

    @property
    def display(self) -> tuple[str, str, str]:
        return (self.state.display, self.district.display, self.market.display)

    def as_dict(self) -> dict[str, str]:
        return {
            "state": self.state.display,
            "state_key": self.state.key,
            "district": self.district.display,
            "district_key": self.district.key,
            "market": self.market.display,
            "market_key": self.market.key,
        }


def canonical_geography(state: Any, district: Any, market: Any) -> Geography:
    state_name = canonical_state(state)
    return Geography(
        state=state_name,
        district=canonical_district(district, state_key=state_name.key),
        market=canonical_market(market, state_key=state_name.key),
    )


# ---------------------------------------------------------------------------
# Product form
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProductForm:
    """A classified product line; ``form`` is ``None`` when it is unknown."""

    form: Optional[str]
    label: str
    reason: Optional[str] = None

    @property
    def known(self) -> bool:
        return self.form is not None


def _known_form(form: str, label: str) -> ProductForm:
    return ProductForm(form=form, label=label)


def _unknown_form(reason: str) -> ProductForm:
    return ProductForm(form=None, label="unknown", reason=reason)


def _has(text: str, *needles: str) -> bool:
    return any(re.search(rf"\b{re.escape(needle)}\b", text) for needle in needles)


_PULSE_KEYS: Final[frozenset[str]] = frozenset(
    {"arhar_tur", "urad", "moong", "masoor", "chana"}
)


def classify_product_form(
    commodity_key: Optional[str],
    *,
    commodity: Any = "",
    variety: Any = "",
) -> ProductForm:
    """Classify the product line for a tracked commodity.

    ``commodity``/``variety`` are the raw source strings. The commodity key is
    expected to be resolved first (``registry.commodity_key_for``); this module
    stays pure and does not import the registry.
    """
    key = _slug(commodity_key)
    text = _fold(f"{commodity or ''} {variety or ''}")

    if not key:
        return _unknown_form("commodity_key is required to classify product_form")

    if key == "rice":
        if _has(text, "broken"):
            return _known_form("broken_rice", "Broken Rice")
        if _has(text, "beaten", "flattened", "poha"):
            return _known_form("beaten_rice", "Beaten Rice")
        if not text or _has(text, "rice"):
            return _known_form("rice", "Rice")
        return _unknown_form("unrecognised rice product form")

    if key == "paddy":
        if _has(text, "basmati"):
            return _known_form("basmati", "Basmati")
        if _has(text, "common"):
            return _known_form("common", "Common")
        return _unknown_form("paddy product form must be common or basmati")

    if key == "chilli":
        if _has(text, "dry", "dried"):
            return _known_form("dry", "Dry")
        if _has(text, "green", "capsicum"):
            return _known_form("green", "Green")
        if _has(text, "red"):
            return _known_form("red", "Red")
        return _unknown_form("chilli product form must be green, red or dry")

    if key == "coriander":
        if _has(text, "leaves", "leaf"):
            return _known_form("leaves", "Leaves")
        if _has(text, "seed"):
            return _known_form("seed", "Seed")
        return _unknown_form("coriander product form must be leaves or seed")

    if key == "groundnut":
        if _has(text, "pods", "pod"):
            return _known_form("pods", "Pods")
        if _has(text, "seed"):
            return _known_form("seed", "Seed")
        return _unknown_form("groundnut product form must be seed or pods")

    if key == "mustard":
        if _has(text, "toria"):
            return _known_form("toria", "Toria")
        if _has(text, "sarson", "colza"):
            return _known_form("sarson", "Sarson")
        if _has(text, "mustard"):
            return _known_form("mustard", "Mustard")
        return _unknown_form("mustard product form must be mustard, sarson or toria")

    if key in _PULSE_KEYS:
        if _has(text, "dal", "split"):
            return _known_form("dal", "Dal")
        if _has(text, "whole"):
            return _known_form("whole", "Whole")
        return _unknown_form(f"{key} product form must be whole or dal")

    return _unknown_form(f"no product_form taxonomy for commodity '{key}'")


def product_form_for(
    commodity_key: Optional[str],
    *,
    commodity: Any = "",
    variety: Any = "",
) -> Optional[str]:
    """The classified form, or ``None`` when the source does not identify one."""
    return classify_product_form(
        commodity_key, commodity=commodity, variety=variety
    ).form


# ---------------------------------------------------------------------------
# Price units
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PriceUnit:
    raw: str
    key: str
    label: str
    reason: Optional[str] = None

    @property
    def is_quintal(self) -> bool:
        return self.key in QUINTAL_UNIT_KEYS


_UNIT_LABELS: Final[dict[str, str]] = {
    UNIT_QUINTAL: "Rs./Quintal",
    UNIT_BUNDLE: "Rs./Bundle",
    UNIT_KG: "Rs./Kg",
    UNIT_TONNE: "Rs./Metric Tonne",
    UNIT_DOZEN: "Rs./Dozen",
    UNIT_PIECE: "Rs./Piece",
    UNIT_NUMBER: "Rs./Number",
}


def canonical_price_unit(value: Any) -> PriceUnit:
    raw = str(value or "").strip()
    folded = _fold(
        raw.casefold()
        .replace("\u20b9", "rs")
        .replace("inr", "rs")
        .replace("rupees", "rs")
        .replace("rupee", "rs")
        .replace("per", "/")
    )

    if not folded:
        return PriceUnit(raw=raw, key=UNIT_UNKNOWN, label="unknown",
                         reason="missing price unit")

    if "quintal" in folded or _has(folded, "qtl", "q"):
        key = UNIT_QUINTAL
    elif "bundle" in folded:
        key = UNIT_BUNDLE
    elif _has(folded, "kg", "kgs", "kilogram", "kilograms"):
        key = UNIT_KG
    elif _has(folded, "tonne", "tonnes", "ton", "tons", "mt"):
        key = UNIT_TONNE
    elif _has(folded, "dozen", "doz"):
        key = UNIT_DOZEN
    elif _has(folded, "piece", "pieces", "pc", "pcs"):
        key = UNIT_PIECE
    elif _has(folded, "number", "numbers", "nos"):
        key = UNIT_NUMBER
    else:
        return PriceUnit(raw=raw, key=UNIT_UNKNOWN, label="unknown",
                         reason=f"unrecognised price unit {raw!r}")

    return PriceUnit(raw=raw, key=key, label=_UNIT_LABELS[key])


def price_unit_key_for(value: Any) -> str:
    return canonical_price_unit(value).key


def is_quintal_unit(value: Any) -> bool:
    return canonical_price_unit(value).key == UNIT_QUINTAL


@dataclass(frozen=True)
class UnitGate:
    allowed: bool
    unit: PriceUnit
    reason: Optional[str] = None


def _row_unit_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        for field in ("price_unit", "Price_Unit", "Unit", "unit"):
            if field in value:
                return value[field]
        return None
    return value


def quintal_gate(value: Any) -> UnitGate:
    """Decide whether a unit (or a row carrying one) may enter a quintal mean.

    ``value`` may be a unit string or a mapping with ``price_unit`` /
    ``Price_Unit`` / ``Unit``. Missing units fail closed: an absent unit is not
    evidence that a price is per quintal.
    """
    unit = canonical_price_unit(_row_unit_value(value))
    if not unit.raw:
        return UnitGate(
            allowed=False,
            unit=unit,
            reason="missing price_unit; quintal aggregation requires an explicit unit",
        )
    if unit.is_quintal:
        return UnitGate(allowed=True, unit=unit)
    if unit.key == UNIT_UNKNOWN:
        return UnitGate(
            allowed=False,
            unit=unit,
            reason=f"cannot verify {unit.raw!r} as a quintal price",
        )
    return UnitGate(
        allowed=False,
        unit=unit,
        reason=f"{unit.raw!r} is not a quintal price; keep it in its own series",
    )


def can_enter_quintal_aggregate(value: Any) -> bool:
    return quintal_gate(value).allowed


# ---------------------------------------------------------------------------
# Price quality
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PriceIssue:
    code: str
    severity: str
    message: str
    fields: tuple[str, ...]
    values: dict[str, Optional[float]]


def _fmt(value: Optional[float]) -> str:
    return "None" if value is None else f"{value:g}"


def _as_price(value: Any) -> tuple[Optional[float], bool]:
    """Return ``(finite_float_or_None, invalid)`` without substituting a value."""
    if value is None:
        return None, False
    if isinstance(value, str) and not value.strip():
        return None, False
    if isinstance(value, bool):
        return None, True
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None, True
    return (number, False) if math.isfinite(number) else (None, True)


def check_price_quality(
    min_price: Any = None,
    max_price: Any = None,
    modal_price: Any = None,
    *,
    reference_median: Any = None,
    outlier_factor: float = 3.0,
) -> list[PriceIssue]:
    """Return every detectable price issue; no value is corrected or dropped.

    ``reference_median`` enables the cross-sectional outlier check. Outliers
    are warnings (a real market can dislocate); impossible triples and
    non-positive/non-numeric prices are errors.
    """
    if outlier_factor <= 1:
        raise ValueError("outlier_factor must be greater than 1")

    raw_values = {
        "min_price": min_price,
        "max_price": max_price,
        "modal_price": modal_price,
    }
    parsed: dict[str, Optional[float]] = {}
    issues: list[PriceIssue] = []

    for field, raw in raw_values.items():
        number, invalid = _as_price(raw)
        parsed[field] = number
        if invalid:
            issues.append(PriceIssue(
                code="non_numeric_price",
                severity=ERROR,
                message=f"{field} is not a finite number: {raw!r}",
                fields=(field,),
                values={field: None},
            ))

    low, high, modal = parsed["min_price"], parsed["max_price"], parsed["modal_price"]

    if low is not None and high is not None and low > high:
        issues.append(PriceIssue(
            code="min_gt_max",
            severity=ERROR,
            message=f"min_price ({_fmt(low)}) is greater than max_price ({_fmt(high)})",
            fields=("min_price", "max_price"),
            values={"min_price": low, "max_price": high},
        ))
    if modal is not None and low is not None and modal < low:
        issues.append(PriceIssue(
            code="modal_lt_min",
            severity=ERROR,
            message=f"modal_price ({_fmt(modal)}) is below min_price ({_fmt(low)})",
            fields=("modal_price", "min_price"),
            values={"modal_price": modal, "min_price": low},
        ))
    if modal is not None and high is not None and modal > high:
        issues.append(PriceIssue(
            code="modal_gt_max",
            severity=ERROR,
            message=f"modal_price ({_fmt(modal)}) is above max_price ({_fmt(high)})",
            fields=("modal_price", "max_price"),
            values={"modal_price": modal, "max_price": high},
        ))

    for field in ("min_price", "max_price", "modal_price"):
        number = parsed[field]
        if number is not None and number <= 0:
            issues.append(PriceIssue(
                code="non_positive_price",
                severity=ERROR,
                message=f"{field} must be positive (got {_fmt(number)})",
                fields=(field,),
                values={field: number},
            ))

    median, median_invalid = _as_price(reference_median)
    if median_invalid:
        raise ValueError(f"reference_median is not a finite number: {reference_median!r}")
    if median is not None and median > 0:
        for field in ("min_price", "max_price", "modal_price"):
            number = parsed[field]
            if number is None or number <= 0:
                continue
            if number > median * outlier_factor:
                issues.append(PriceIssue(
                    code="extreme_outlier",
                    severity=WARNING,
                    message=(
                        f"{field} {_fmt(number)} is more than "
                        f"{outlier_factor:g}x the reference median {_fmt(median)}"
                    ),
                    fields=(field,),
                    values={field: number, "reference_median": median},
                ))
            elif number < median / outlier_factor:
                issues.append(PriceIssue(
                    code="extreme_outlier",
                    severity=WARNING,
                    message=(
                        f"{field} {_fmt(number)} is less than 1/{outlier_factor:g} "
                        f"of the reference median {_fmt(median)}"
                    ),
                    fields=(field,),
                    values={field: number, "reference_median": median},
                ))

    return issues


@dataclass(frozen=True)
class RowAssessment:
    unit: UnitGate
    issues: tuple[PriceIssue, ...]

    @property
    def can_aggregate(self) -> bool:
        return self.unit.allowed and not any(
            issue.severity == ERROR for issue in self.issues
        )

    @property
    def error_codes(self) -> tuple[str, ...]:
        return tuple(issue.code for issue in self.issues if issue.severity == ERROR)

    @property
    def warning_codes(self) -> tuple[str, ...]:
        return tuple(issue.code for issue in self.issues if issue.severity == WARNING)


def _row_price(row: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        if name in row:
            return row[name]
    return None


def assess_price_row(
    row: Mapping[str, Any],
    *,
    reference_median: Any = None,
    outlier_factor: float = 3.0,
) -> RowAssessment:
    """Combine the quintal unit gate with the price-quality checks for one row."""
    issues = check_price_quality(
        _row_price(row, "min_price", "Min_Price"),
        _row_price(row, "max_price", "Max_Price"),
        _row_price(row, "modal_price", "Modal_Price"),
        reference_median=reference_median,
        outlier_factor=outlier_factor,
    )
    return RowAssessment(unit=quintal_gate(row), issues=tuple(issues))


__all__ = [
    "ERROR",
    "WARNING",
    "QUINTAL_UNIT_KEYS",
    "UNIT_BUNDLE",
    "UNIT_DOZEN",
    "UNIT_KG",
    "UNIT_NUMBER",
    "UNIT_PIECE",
    "UNIT_QUINTAL",
    "UNIT_TONNE",
    "UNIT_UNKNOWN",
    "CanonicalName",
    "Geography",
    "PriceIssue",
    "PriceUnit",
    "ProductForm",
    "RowAssessment",
    "UnitGate",
    "assess_price_row",
    "can_enter_quintal_aggregate",
    "canonical_district",
    "canonical_geography",
    "canonical_grade",
    "canonical_market",
    "canonical_price_unit",
    "canonical_state",
    "check_price_quality",
    "classify_product_form",
    "district_key_for",
    "grade_key_for",
    "is_quintal_unit",
    "market_key_for",
    "price_unit_key_for",
    "product_form_for",
    "quintal_gate",
    "state_key_for",
]
