from __future__ import annotations

import pytest

from api.agri import registry


def test_ckan_source_names_resolve_case_insensitively():
    assert registry.commodity_key_for("Red Gram/Arhar/Tur(whole)") == "arhar_tur"
    assert registry.commodity_key_for("Black Gram(Urd Beans)(Whole)") == "urad"
    assert registry.commodity_key_for("Green Gram(Moong)(Whole)") == "moong"
    assert registry.commodity_key_for("Bengal Gram(Gram)(Whole)") == "chana"
    assert registry.commodity_key_for("  LENTIL(MASUR)(WHOLE)  ") == "masoor"


def test_data_gov_in_aliases_resolve():
    assert registry.commodity_key_for("Arhar(Tur)") == "arhar_tur"
    assert registry.commodity_key_for("Tur") == "arhar_tur"
    assert registry.commodity_key_for("Urd") == "urad"
    assert registry.commodity_key_for("Moong") == "moong"
    assert registry.commodity_key_for("Masoor") == "masoor"
    assert registry.commodity_key_for("Gram Dal") == "chana"
    assert registry.commodity_key_for("Chana") == "chana"
    assert registry.commodity_key_for("Paddy") == "paddy"


def test_unknown_and_blank_sources_return_none():
    assert registry.commodity_key_for("Absinthe") is None
    assert registry.commodity_key_for("") is None
    assert registry.commodity_key_for(None) is None


@pytest.mark.parametrize(
    "key,group",
    [
        ("rice", "cereals"), ("paddy", "cereals"), ("wheat", "cereals"),
        ("maize", "cereals"), ("bajra", "cereals"), ("jowar", "cereals"),
        ("arhar_tur", "pulses"), ("urad", "pulses"), ("moong", "pulses"),
        ("masoor", "pulses"), ("chana", "pulses"),
        ("onion", "vegetables"), ("potato", "vegetables"), ("tomato", "vegetables"),
        ("soyabean", "oilseeds"), ("groundnut", "oilseeds"),
        ("mustard", "oilseeds"), ("sunflower", "oilseeds"),
        ("chilli", "spices"), ("turmeric", "spices"),
        ("coriander", "spices"), ("jeera", "spices"),
    ],
)
def test_every_required_commodity_is_registered(key: str, group: str):
    assert registry.group_for(key) == group
    assert registry.label_for(key)
    assert registry.commodity(key) is not None


def test_group_keys_cover_every_commodity():
    groups = {g["key"] for g in registry.groups()}
    assert groups == {"cereals", "pulses", "vegetables", "oilseeds", "spices"}
    assigned = {g for key in registry.valid_keys() for g in [registry.group_for(key)]}
    assert assigned == groups


def test_option_shapes_and_units():
    options = registry.commodities()
    assert len(options) == len(registry.valid_keys())
    assert all(set(option) == {"key", "label", "group", "unit"} for option in options)
    assert {option["unit"] for option in options} == {"INR/quintal"}
    assert all(set(group) == {"key", "label"} for group in registry.groups())


def test_msp_is_never_invented():
    assert all(registry.msp_for(key) is None for key in registry.valid_keys())
