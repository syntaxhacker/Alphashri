"""Single source of truth for tracked mandi commodities.

``source_names`` are the exact ``commodity_name`` values in the Agmarknet CKAN
mirror (resource 13f9964a-9398-4d49-a7b8-2f57c2396c48). ``aliases`` are the
data.gov.in spellings (resource 9ef84268-d588-465a-a308-a864a43d0070) plus
common variants, recognised by :func:`commodity_key_for` but not bulk-imported.

MSP is deliberately ``None`` for every key: no price has been verified against
an official MSP notification, so the API reports it as unavailable instead of
inventing a number.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final, Optional

PRICE_UNIT: Final[str] = "INR/quintal"
ARRIVALS_UNIT: Final[str] = "qtl"

CKAN_RESOURCE_ID: Final[str] = "13f9964a-9398-4d49-a7b8-2f57c2396c48"
#: Current-day snapshot (42 rows observed on 2026-11-22).
DATA_GOV_IN_CURRENT_RESOURCE_ID: Final[str] = "9ef84268-d588-465a-a308-a864a43d0070"
#: Variety-wise historical archive: exact rows, day-by-day from 2009-11-11.
DATA_GOV_IN_RESOURCE_ID: Final[str] = "35985678-0d79-46b4-9ed6-6f13308a1d24"
SOURCE_CKAN: Final[str] = "agmarknet_ckan"
SOURCE_DAILY: Final[str] = "agmarknet_daily"
SOURCE_MIXED: Final[str] = "mixed"

_SOURCE_ALIASES: Final[dict[str, str]] = {
    "agmarknet_ckan": SOURCE_CKAN,
    "ckan": SOURCE_CKAN,
    "ckan_seed": SOURCE_CKAN,
    "seed": SOURCE_CKAN,
    "agmarknet_daily": SOURCE_DAILY,
    "daily": SOURCE_DAILY,
    "data.gov.in": SOURCE_DAILY,
    "data_gov_in": SOURCE_DAILY,
    "official": SOURCE_DAILY,
}

# Variety text is the only product signal in the legacy cache; the newer rows
# carry an explicit product_form column that always wins.
_PRODUCT_FORM_RULES: Final[dict[str, tuple[tuple[tuple[str, ...], str], ...]]] = {
    "chilli": ((("green",), "green"), (("dry",), "dry"), (("red",), "red")),
    "coriander": ((("leave", "leaf"), "leaves"), (("seed",), "seed")),
    "paddy": ((("basmati",), "basmati"), (("common",), "common")),
    "rice": ((("broken",), "broken"), (("beaten",), "beaten")),
    "groundnut": ((("pod",), "pods"), (("seed",), "seed")),
    "mustard": ((("sarson",), "sarson"), (("toria",), "toria")),
}


@dataclass(frozen=True)
class Commodity:
    key: str
    label: str
    group: str
    source_names: tuple[str, ...]
    aliases: tuple[str, ...] = ()
    msp: Optional[float] = None


@dataclass(frozen=True)
class Group:
    key: str
    label: str


GROUPS: Final[tuple[Group, ...]] = (
    Group("cereals", "Cereals"),
    Group("pulses", "Pulses"),
    Group("vegetables", "Vegetables"),
    Group("oilseeds", "Oilseeds"),
    Group("spices", "Spices"),
)

COMMODITIES: Final[tuple[Commodity, ...]] = (
    Commodity("rice", "Rice", "cereals", ("Rice",), ("Broken Rice", "Beaten Rice")),
    Commodity("paddy", "Paddy", "cereals", ("Paddy(Common)", "Paddy(Basmati)"), ("Paddy",)),
    Commodity("wheat", "Wheat", "cereals", ("Wheat",)),
    Commodity("maize", "Maize", "cereals", ("Maize",), ("Corn",)),
    Commodity("bajra", "Bajra", "cereals", ("Bajra(Pearl Millet/Cumbu)", "Sajje"), ("Bajra", "Pearl Millet", "Cumbu")),
    Commodity("jowar", "Jowar", "cereals", ("Jowar(Sorghum)",), ("Jowar", "Sorghum")),
    Commodity("arhar_tur", "Arhar (Tur)", "pulses", ("Red Gram/Arhar/Tur(Whole)", "Red Gram Split/Arhar Dal/Tur Dal"), ("Arhar(Tur)", "Arhar", "Tur", "Arhar Dal", "Tur Dal", "Pegeon Pea(Arhar Fali)")),
    Commodity("urad", "Urad", "pulses", ("Black Gram(Urd Beans)(Whole)", "Black Gram Dal(Urd Dal)"), ("Urd", "Urad Dal", "Black Gram")),
    Commodity("moong", "Moong", "pulses", ("Green Gram(Moong)(Whole)", "Green Gram Dal(Moong Dal)"), ("Moong", "Moong Dal", "Green Gram")),
    Commodity("masoor", "Masoor", "pulses", ("Lentil(Masur)(Whole)", "Masur Dal"), ("Masoor", "Masoor Dal", "Lentil", "Masur")),
    Commodity("chana", "Chana / Gram", "pulses", ("Bengal Gram(Gram)(Whole)", "Bengal Gram Dal(Chana Dal)"), ("Chana", "Gram Dal", "Gram dal", "Chana Dal", "Gram", "Kabuli Chana(Chickpeas-White)")),
    Commodity("onion", "Onion", "vegetables", ("Onion",)),
    Commodity("potato", "Potato", "vegetables", ("Potato",)),
    Commodity("tomato", "Tomato", "vegetables", ("Tomato",)),
    Commodity("soyabean", "Soyabean", "oilseeds", ("Soyabean",), ("Soybean",)),
    Commodity("groundnut", "Groundnut", "oilseeds", ("Groundnut", "Groundnut Pods(Raw)"), ("Ground Nut", "Peanut", "Ground Nut Seed", "Groundnut(Split)")),
    Commodity("mustard", "Mustard", "oilseeds", ("Mustard", "Indian Colza(Sarson)"), ("Sarson", "Rai", "Toria", "Mustard Seed")),
    Commodity("sunflower", "Sunflower", "oilseeds", ("Sunflower/Sunflower Seed",), ("Sunflower", "Sunflower Seed")),
    Commodity("chilli", "Chilli", "spices", ("Dry Chillies", "Chili Red", "Green Chilli"), ("Chilli", "Chilly", "Red Chillies", "Chilly Capsicum")),
    Commodity("turmeric", "Turmeric", "spices", ("Turmeric", "Turmeric(Raw)"), ("Haldi",)),
    Commodity("coriander", "Coriander", "spices", ("Corriander Seed", "Coriander(Leaves)"), ("Coriander", "Coriander Seed", "Dhania")),
    Commodity("jeera", "Jeera", "spices", ("Cummin Seed(Jeera)",), ("Jeera", "Cumin Seed", "Cumin")),
)

_BY_KEY: Final[dict[str, Commodity]] = {c.key: c for c in COMMODITIES}
_GROUP_KEYS: Final[frozenset[str]] = frozenset(g.key for g in GROUPS)


def _normalise(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


_LOOKUP: Final[dict[str, str]] = {
    **{
        _normalise(name): c.key
        for c in COMMODITIES
        for name in (*c.source_names, *c.aliases)
    },
    **{_normalise(c.key): c.key for c in COMMODITIES},
}


def commodity_key_for(source_name: Optional[str]) -> Optional[str]:
    """Resolve a CKAN/data.gov.in commodity name (or a key) to a tracked key."""
    if not source_name:
        return None
    return _LOOKUP.get(_normalise(source_name))


def commodities() -> list[dict[str, str]]:
    """Public option list: ``{key, label, group, unit}``."""
    return [
        {"key": c.key, "label": c.label, "group": c.group, "unit": PRICE_UNIT}
        for c in COMMODITIES
    ]


def groups() -> list[dict[str, str]]:
    return [{"key": g.key, "label": g.label} for g in GROUPS]


def commodity(key: str) -> Optional[Commodity]:
    return _BY_KEY.get(key)


def source_names_for(key: str) -> tuple[str, ...]:
    item = _BY_KEY.get(key)
    return item.source_names if item else ()


def label_for(key: str) -> str:
    item = _BY_KEY.get(key)
    return item.label if item else key


def group_for(key: str) -> str:
    item = _BY_KEY.get(key)
    return item.group if item else ""


def msp_for(key: str) -> Optional[float]:
    item = _BY_KEY.get(key)
    return item.msp if item else None


def normalise_price_source(value: Optional[str]) -> Optional[str]:
    """Canonical price source for a row; unknown audit strings pass through."""
    text = str(value or "").strip()
    if not text:
        return None
    return _SOURCE_ALIASES.get(text.casefold(), text)


def product_form_for(
    key: Optional[str],
    variety: Optional[str],
    product_form: Optional[str] = None,
) -> Optional[str]:
    """Product stratum for a quote: explicit column first, else the variety."""
    explicit = str(product_form or "").strip()
    if explicit:
        return explicit.casefold()
    text = str(variety or "").strip().casefold()
    if not text or not key:
        return None
    for tokens, form in _PRODUCT_FORM_RULES.get(key, ()):
        if any(token in text for token in tokens):
            return form
    return None


def keys_for_group(group: str) -> tuple[str, ...]:
    return tuple(c.key for c in COMMODITIES if c.group == group)


def valid_keys() -> tuple[str, ...]:
    return tuple(_BY_KEY)


def is_valid_group(group: str) -> bool:
    return group in _GROUP_KEYS


__all__ = [
    "ARRIVALS_UNIT",
    "CKAN_RESOURCE_ID",
    "COMMODITIES",
    "DATA_GOV_IN_CURRENT_RESOURCE_ID",
    "DATA_GOV_IN_RESOURCE_ID",
    "GROUPS",
    "PRICE_UNIT",
    "SOURCE_CKAN",
    "SOURCE_DAILY",
    "SOURCE_MIXED",
    "Commodity",
    "commodities",
    "commodity",
    "commodity_key_for",
    "group_for",
    "groups",
    "is_valid_group",
    "keys_for_group",
    "label_for",
    "msp_for",
    "normalise_price_source",
    "product_form_for",
    "source_names_for",
    "valid_keys",
]
