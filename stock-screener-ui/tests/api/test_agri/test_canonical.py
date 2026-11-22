from __future__ import annotations

import math

import pytest

from api.agri import canonical


# ---------------------------------------------------------------------------
# Geography
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,display,key",
    [
        ("Chhattisgarh", "Chhattisgarh", "chhattisgarh"),
        ("Chattisgarh", "Chhattisgarh", "chhattisgarh"),
        ("  chhattisgarh  ", "Chhattisgarh", "chhattisgarh"),
        ("Kerala", "Kerala", "kerala"),
        ("Keralam", "Kerala", "kerala"),
        ("Delhi", "Delhi", "delhi"),
        ("NCT of Delhi", "Delhi", "delhi"),
        ("Delhi (NCT)", "Delhi", "delhi"),
        ("National Capital Territory of Delhi", "Delhi", "delhi"),
        ("Andaman and Nicobar Islands", "Andaman and Nicobar Islands", "andaman_and_nicobar_islands"),
        ("Andaman & Nicobar Islands", "Andaman and Nicobar Islands", "andaman_and_nicobar_islands"),
        ("Andaman-Nicobar", "Andaman and Nicobar Islands", "andaman_and_nicobar_islands"),
        ("A & N Islands", "Andaman and Nicobar Islands", "andaman_and_nicobar_islands"),
        ("A&N", "Andaman and Nicobar Islands", "andaman_and_nicobar_islands"),
        ("Jammu and Kashmir", "Jammu and Kashmir", "jammu_and_kashmir"),
        ("Jammu & Kashmir", "Jammu and Kashmir", "jammu_and_kashmir"),
        ("J&K", "Jammu and Kashmir", "jammu_and_kashmir"),
        ("J.K.", "Jammu and Kashmir", "jammu_and_kashmir"),
        ("Jammu-Kashmir", "Jammu and Kashmir", "jammu_and_kashmir"),
    ],
)
def test_state_variants_share_display_and_key(value: str, display: str, key: str):
    result = canonical.canonical_state(value)
    assert result.display == display
    assert result.key == key
    assert result.raw == value.strip()


def test_unknown_state_keeps_its_display_and_gets_a_stable_key():
    result = canonical.canonical_state("  Some  New-State ")
    assert result.raw == "Some  New-State"
    assert result.display == "Some New-State"
    assert result.key == "some_new_state"


def test_blank_state_has_blank_display_and_key():
    result = canonical.canonical_state(None)
    assert result == canonical.CanonicalName(raw="", display="", key="")


@pytest.mark.parametrize(
    "value,display,key",
    [
        ("Bathinda", "Bathinda", "bathinda"),
        ("Bhatinda", "Bathinda", "bathinda"),
        ("  BHATINDA  ", "Bathinda", "bathinda"),
        ("Ballari", "Ballari", "ballari"),
        ("Bellary", "Ballari", "ballari"),
    ],
)
def test_district_aliases(value: str, display: str, key: str):
    result = canonical.canonical_district(value)
    assert result.display == display
    assert result.key == key
    assert result.raw == value.strip()


def test_unknown_district_preserves_display():
    result = canonical.canonical_district("North 24 Parganas")
    assert result.display == "North 24 Parganas"
    assert result.key == "north_24_parganas"


@pytest.mark.parametrize(
    "value,display,key",
    [
        ("APMC", "APMC", "apmc"),
        ("Apmc", "APMC", "apmc"),
        ("Pune APMC", "Pune APMC", "pune_apmc"),
        ("Pune Apmc", "Pune APMC", "pune_apmc"),
        ("Pune-Apmc", "Pune-APMC", "pune_apmc"),
        ("pune apmc yard", "pune APMC yard", "pune_apmc_yard"),
    ],
)
def test_market_apmc_variants_share_key(value: str, display: str, key: str):
    result = canonical.canonical_market(value)
    assert result.display == display
    assert result.key == key
    assert result.raw == value.strip()


def test_unknown_market_preserves_display():
    result = canonical.canonical_market("  Bengaluru  Market ")
    assert result.display == "Bengaluru Market"
    assert result.key == "bengaluru_market"


@pytest.mark.parametrize(
    "value,display,key",
    [
        ("FAQ", "FAQ", "faq"),
        ("Faq", "FAQ", "faq"),
        ("  faq ", "FAQ", "faq"),
        ("Non-FAQ", "Non-FAQ", "non_faq"),
        ("Non-Faq", "Non-FAQ", "non_faq"),
        ("non faq", "Non-FAQ", "non_faq"),
        ("NonFAQ", "Non-FAQ", "non_faq"),
    ],
)
def test_grade_aliases(value: str, display: str, key: str):
    result = canonical.canonical_grade(value)
    assert result.display == display
    assert result.key == key
    assert result.raw == value.strip()


def test_unknown_grade_preserves_display():
    result = canonical.canonical_grade("Grade A")
    assert result.display == "Grade A"
    assert result.key == "grade_a"


def test_geography_bundle_uses_the_state_district_market_tuple():
    geography = canonical.canonical_geography("Chattisgarh", "Bhatinda", "Pune Apmc")
    assert geography.key == ("chhattisgarh", "bathinda", "pune_apmc")
    assert geography.display == ("Chhattisgarh", "Bathinda", "Pune APMC")
    assert geography.as_dict() == {
        "state": "Chhattisgarh",
        "state_key": "chhattisgarh",
        "district": "Bathinda",
        "district_key": "bathinda",
        "market": "Pune APMC",
        "market_key": "pune_apmc",
    }


def test_same_market_name_in_two_states_keeps_the_name_key_but_not_the_triple():
    first = canonical.canonical_geography("Punjab", "Bathinda", "Apmc")
    second = canonical.canonical_geography("Haryana", "Hisar", "Apmc")
    assert first.market.key == second.market.key == "apmc"
    assert first.key != second.key


def test_key_for_helpers_delegate_to_the_canonical_functions():
    assert canonical.state_key_for("Keralam") == "kerala"
    assert canonical.district_key_for("Bellary") == "ballari"
    assert canonical.market_key_for("Pune Apmc") == "pune_apmc"
    assert canonical.grade_key_for("Non-Faq") == "non_faq"


# ---------------------------------------------------------------------------
# Product form
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,commodity,variety,form,label",
    [
        ("rice", "Rice", "", "rice", "Rice"),
        ("rice", "", "", "rice", "Rice"),
        ("rice", "Broken Rice", "", "broken_rice", "Broken Rice"),
        ("rice", "", "Broken", "broken_rice", "Broken Rice"),
        ("rice", "Beaten Rice", "", "beaten_rice", "Beaten Rice"),
        ("rice", "Poha", "", "beaten_rice", "Beaten Rice"),
        ("paddy", "Paddy(Common)", "", "common", "Common"),
        ("paddy", "Paddy(Basmati)", "", "basmati", "Basmati"),
        ("paddy", "Paddy", "Common", "common", "Common"),
        ("paddy", "Paddy", "Basmati", "basmati", "Basmati"),
        ("chilli", "Green Chilli", "", "green", "Green"),
        ("chilli", "Chilly Capsicum", "", "green", "Green"),
        ("chilli", "Chili Red", "", "red", "Red"),
        ("chilli", "Red Chillies", "", "red", "Red"),
        ("chilli", "Dry Chillies", "", "dry", "Dry"),
        ("chilli", "Dried Red Chilli", "", "dry", "Dry"),
        ("coriander", "Coriander(Leaves)", "", "leaves", "Leaves"),
        ("coriander", "Corriander Seed", "", "seed", "Seed"),
        ("coriander", "Coriander Seed", "", "seed", "Seed"),
        ("groundnut", "Ground Nut Seed", "", "seed", "Seed"),
        ("groundnut", "Groundnut Pods(Raw)", "", "pods", "Pods"),
        ("groundnut", "Groundnut", "Pod", "pods", "Pods"),
        ("mustard", "Mustard", "", "mustard", "Mustard"),
        ("mustard", "Mustard Seed", "", "mustard", "Mustard"),
        ("mustard", "Indian Colza(Sarson)", "", "sarson", "Sarson"),
        ("mustard", "Sarson", "", "sarson", "Sarson"),
        ("mustard", "Toria", "", "toria", "Toria"),
        ("arhar_tur", "Red Gram/Arhar/Tur(Whole)", "", "whole", "Whole"),
        ("arhar_tur", "Red Gram Split/Arhar Dal/Tur Dal", "", "dal", "Dal"),
        ("urad", "Black Gram(Urd Beans)(Whole)", "", "whole", "Whole"),
        ("urad", "Black Gram Dal(Urd Dal)", "", "dal", "Dal"),
        ("moong", "Green Gram(Moong)(Whole)", "", "whole", "Whole"),
        ("moong", "Green Gram Dal(Moong Dal)", "", "dal", "Dal"),
        ("masoor", "Lentil(Masur)(Whole)", "", "whole", "Whole"),
        ("masoor", "Masur Dal", "", "dal", "Dal"),
        ("chana", "Bengal Gram(Gram)(Whole)", "", "whole", "Whole"),
        ("chana", "Bengal Gram Dal(Chana Dal)", "", "dal", "Dal"),
        ("chana", "Chana Dal", "", "dal", "Dal"),
    ],
)
def test_every_known_product_form_mapping(
    key: str, commodity: str, variety: str, form: str, label: str
):
    result = canonical.classify_product_form(
        key, commodity=commodity, variety=variety
    )
    assert result.form == form
    assert result.label == label
    assert result.reason is None
    assert result.known is True


@pytest.mark.parametrize(
    "key,commodity,reason_part",
    [
        ("paddy", "Paddy", "common or basmati"),
        ("chilli", "Chilli", "green, red or dry"),
        ("coriander", "Coriander", "leaves or seed"),
        ("groundnut", "Groundnut", "seed or pods"),
        ("mustard", "Rai", "mustard, sarson or toria"),
        ("chana", "Chana", "whole or dal"),
        ("onion", "Onion", "no product_form taxonomy"),
        ("absinthe", "Absinthe", "no product_form taxonomy"),
    ],
)
def test_ambiguous_and_untracked_forms_are_unknown_with_a_reason(
    key: str, commodity: str, reason_part: str
):
    result = canonical.classify_product_form(key, commodity=commodity)
    assert result.form is None
    assert result.label == "unknown"
    assert result.known is False
    assert result.reason is not None
    assert reason_part in result.reason


def test_missing_commodity_key_is_unknown_not_a_guess():
    result = canonical.classify_product_form(None, commodity="Rice")
    assert result.form is None
    assert result.label == "unknown"
    assert result.reason == "commodity_key is required to classify product_form"


def test_product_form_for_returns_only_the_form():
    assert canonical.product_form_for("rice", commodity="Broken Rice") == "broken_rice"
    assert canonical.product_form_for("chilli", commodity="Chilli") is None


# ---------------------------------------------------------------------------
# Price units
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,key,label",
    [
        ("Rs./Quintal", canonical.UNIT_QUINTAL, "Rs./Quintal"),
        ("Rs./quintal", canonical.UNIT_QUINTAL, "Rs./Quintal"),
        ("INR/quintal", canonical.UNIT_QUINTAL, "Rs./Quintal"),
        ("Rs/Quintal", canonical.UNIT_QUINTAL, "Rs./Quintal"),
        ("Quintal", canonical.UNIT_QUINTAL, "Rs./Quintal"),
        ("qtl", canonical.UNIT_QUINTAL, "Rs./Quintal"),
        ("Rs./Bundle", canonical.UNIT_BUNDLE, "Rs./Bundle"),
        ("Rs./bundle", canonical.UNIT_BUNDLE, "Rs./Bundle"),
        ("INR/Bundle", canonical.UNIT_BUNDLE, "Rs./Bundle"),
        ("Bundle", canonical.UNIT_BUNDLE, "Rs./Bundle"),
        ("Rs./Kg", canonical.UNIT_KG, "Rs./Kg"),
        ("Rs./Metric Tonne", canonical.UNIT_TONNE, "Rs./Metric Tonne"),
        ("Rs./MT", canonical.UNIT_TONNE, "Rs./Metric Tonne"),
        ("Rs./Dozen", canonical.UNIT_DOZEN, "Rs./Dozen"),
        ("Rs./Piece", canonical.UNIT_PIECE, "Rs./Piece"),
        ("Rs./Number", canonical.UNIT_NUMBER, "Rs./Number"),
        ("Rs./Nos", canonical.UNIT_NUMBER, "Rs./Number"),
    ],
)
def test_every_known_price_unit_mapping(value: str, key: str, label: str):
    unit = canonical.canonical_price_unit(value)
    assert unit.key == key
    assert unit.label == label
    assert unit.reason is None
    assert unit.raw == value


def test_unknown_price_unit_is_explicitly_unknown():
    unit = canonical.canonical_price_unit("Rs./Mystery")
    assert unit.key == canonical.UNIT_UNKNOWN
    assert unit.label == "unknown"
    assert unit.reason is not None
    assert "Rs./Mystery" in unit.reason


def test_missing_price_unit_is_explicitly_unknown():
    unit = canonical.canonical_price_unit(None)
    assert unit.key == canonical.UNIT_UNKNOWN
    assert unit.reason == "missing price unit"


def test_is_quintal_unit_accepts_only_quintal_spellings():
    assert canonical.is_quintal_unit("Rs./Quintal") is True
    assert canonical.is_quintal_unit("INR/quintal") is True
    assert canonical.is_quintal_unit("Rs./Bundle") is False
    assert canonical.is_quintal_unit("Rs./Mystery") is False
    assert canonical.price_unit_key_for("Rs./Bundle") == canonical.UNIT_BUNDLE


@pytest.mark.parametrize(
    "row,allowed",
    [
        ({"price_unit": "Rs./Quintal"}, True),
        ({"price_unit": "Rs./quintal"}, True),
        ({"Price_Unit": "INR/quintal"}, True),
        ({"Unit": "Rs./Quintal"}, True),
        ({"unit": "INR/quintal"}, True),
        ("Rs./Quintal", True),
        ({"price_unit": "Rs./Bundle"}, False),
        ({"price_unit": "Rs./Kg"}, False),
        ({"price_unit": "Rs./Mystery"}, False),
        ({"price_unit": ""}, False),
        ({}, False),
        (None, False),
    ],
)
def test_quintal_gate_decides_whether_a_row_can_aggregate(row, allowed: bool):
    gate = canonical.quintal_gate(row)
    assert gate.allowed is allowed
    assert canonical.can_enter_quintal_aggregate(row) is allowed


def test_non_quintal_and_unknown_units_carry_a_reason():
    bundle = canonical.quintal_gate({"price_unit": "Rs./Bundle"})
    assert bundle.allowed is False
    assert bundle.reason is not None
    assert "not a quintal" in bundle.reason

    unknown = canonical.quintal_gate({"price_unit": "Rs./Mystery"})
    assert unknown.allowed is False
    assert unknown.reason is not None
    assert "cannot verify" in unknown.reason

    missing = canonical.quintal_gate({})
    assert missing.allowed is False
    assert missing.reason is not None
    assert "missing price_unit" in missing.reason


# ---------------------------------------------------------------------------
# Price quality
# ---------------------------------------------------------------------------


def test_valid_price_triple_has_no_issues():
    assert canonical.check_price_quality(90, 110, 100) == []
    assert canonical.check_price_quality("90", "110", "100") == []


def test_min_greater_than_max_is_an_error():
    issues = canonical.check_price_quality(200, 100, None)
    assert [issue.code for issue in issues] == ["min_gt_max"]
    issue = issues[0]
    assert issue.severity == canonical.ERROR
    assert issue.fields == ("min_price", "max_price")
    assert issue.values == {"min_price": 200.0, "max_price": 100.0}


def test_modal_below_min_is_an_error():
    issues = canonical.check_price_quality(100, 200, 50)
    assert [issue.code for issue in issues] == ["modal_lt_min"]
    assert issues[0].severity == canonical.ERROR
    assert issues[0].fields == ("modal_price", "min_price")


def test_modal_above_max_is_an_error():
    issues = canonical.check_price_quality(100, 200, 250)
    assert [issue.code for issue in issues] == ["modal_gt_max"]
    assert issues[0].severity == canonical.ERROR
    assert issues[0].fields == ("modal_price", "max_price")


@pytest.mark.parametrize("field", ["min_price", "max_price", "modal_price"])
@pytest.mark.parametrize("value", [0, -1, -100.5])
def test_non_positive_prices_are_reported_for_every_field(field: str, value: float):
    kwargs = {field: value}
    issues = canonical.check_price_quality(**kwargs)
    assert [issue.code for issue in issues] == ["non_positive_price"]
    assert issues[0].severity == canonical.ERROR
    assert issues[0].fields == (field,)
    assert issues[0].values[field] == float(value)


def test_multiple_invalid_conditions_are_all_reported():
    issues = canonical.check_price_quality(200, 100, 250)
    assert {issue.code for issue in issues} == {"min_gt_max", "modal_gt_max"}


def test_all_three_invalid_triple_conditions_can_coexist():
    issues = canonical.check_price_quality(200, 100, 150)
    assert {issue.code for issue in issues} == {
        "min_gt_max", "modal_lt_min", "modal_gt_max",
    }


def test_extreme_high_outlier_is_a_warning():
    issues = canonical.check_price_quality(
        3001, 4000, 3500, reference_median=1000
    )
    assert [issue.code for issue in issues] == ["extreme_outlier"] * 3
    assert {issue.severity for issue in issues} == {canonical.WARNING}
    assert {issue.fields for issue in issues} == {
        ("min_price",), ("max_price",), ("modal_price",),
    }


def test_extreme_low_outlier_is_a_warning():
    issues = canonical.check_price_quality(
        50, 60, 55, reference_median=1000
    )
    assert [issue.code for issue in issues] == ["extreme_outlier"] * 3
    assert all(issue.severity == canonical.WARNING for issue in issues)


def test_prices_within_the_outlier_factor_are_not_flagged():
    assert canonical.check_price_quality(
        900, 1100, 1000, reference_median=1000
    ) == []
    assert canonical.check_price_quality(
        500, 2000, 1500, reference_median=1000, outlier_factor=2
    ) == []


def test_outlier_check_is_skipped_without_a_positive_reference_median():
    assert canonical.check_price_quality(1, 10_000_000, 5_000_000) == []
    assert canonical.check_price_quality(
        1, 10_000_000, 5_000_000, reference_median=0
    ) == []


def test_non_numeric_and_non_finite_prices_are_reported_not_coerced():
    issues = canonical.check_price_quality("abc", math.inf, math.nan)
    assert [issue.code for issue in issues] == ["non_numeric_price"] * 3
    assert all(issue.severity == canonical.ERROR for issue in issues)
    assert {issue.fields for issue in issues} == {
        ("min_price",), ("max_price",), ("modal_price",),
    }


def test_missing_prices_are_not_invented_or_flagged():
    assert canonical.check_price_quality(None, None, None) == []
    assert canonical.check_price_quality("", "  ", None) == []


def test_outlier_factor_must_be_meaningful():
    with pytest.raises(ValueError):
        canonical.check_price_quality(100, 200, 150, outlier_factor=1)


def test_invalid_reference_median_raises_instead_of_guessing():
    with pytest.raises(ValueError):
        canonical.check_price_quality(100, 200, 150, reference_median="median")


# ---------------------------------------------------------------------------
# Row assessment
# ---------------------------------------------------------------------------


def _row(**overrides):
    row = {
        "min_price": 90,
        "max_price": 110,
        "modal_price": 100,
        "price_unit": "Rs./Quintal",
    }
    row.update(overrides)
    return row


def test_assessment_combines_unit_gate_and_quality():
    assessment = canonical.assess_price_row(_row())
    assert assessment.unit.allowed is True
    assert assessment.issues == ()
    assert assessment.can_aggregate is True


def test_assessment_rejects_a_valid_bundle_row_from_quintal_aggregation():
    assessment = canonical.assess_price_row(_row(price_unit="Rs./Bundle"))
    assert assessment.unit.allowed is False
    assert assessment.issues == ()
    assert assessment.can_aggregate is False


def test_assessment_rejects_a_quintal_row_with_an_invalid_triple():
    assessment = canonical.assess_price_row(
        _row(min_price=200, max_price=100, modal_price=150)
    )
    assert assessment.unit.allowed is True
    assert set(assessment.error_codes) == {
        "min_gt_max", "modal_lt_min", "modal_gt_max",
    }
    assert assessment.can_aggregate is False


def test_assessment_allows_a_quintal_row_with_only_an_outlier_warning():
    assessment = canonical.assess_price_row(
        _row(min_price=3001, max_price=4000, modal_price=3500),
        reference_median=1000,
    )
    assert assessment.warning_codes == ("extreme_outlier",) * 3
    assert assessment.error_codes == ()
    assert assessment.can_aggregate is True


def test_assessment_reads_uppercase_source_columns():
    assessment = canonical.assess_price_row({
        "Min_Price": "90",
        "Max_Price": "110",
        "Modal_Price": "100",
        "Unit": "INR/quintal",
    })
    assert assessment.unit.allowed is True
    assert assessment.can_aggregate is True


def test_assessment_does_not_mutate_the_row():
    row = _row(min_price=200, max_price=100, modal_price=150)
    before = dict(row)
    canonical.assess_price_row(row)
    assert row == before


def test_assessment_blocks_non_numeric_prices():
    assessment = canonical.assess_price_row(_row(modal_price="not-a-price"))
    assert "non_numeric_price" in assessment.error_codes
    assert assessment.can_aggregate is False
