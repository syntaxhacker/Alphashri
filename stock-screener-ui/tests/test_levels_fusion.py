"""Fusion rules and service orchestration for the additive LevelBook."""

from __future__ import annotations

import pytest

from market_levels import service
from market_levels.fusion import fuse_levels
from market_levels.models import (
    GEX,
    OI,
    PIVOT,
    PRICE_ACTION,
    RESISTANCE,
    SUPPORT,
    TRENDLINE,
    DetectorSpec,
    Level,
    level_id,
)
from market_levels.registry import (
    clear_registry,
    iter_detectors,
    list_specs,
    register,
)

AS_OF = "2026-01-01"
OPTION_SPOT = 22962.6
_OPTION_ROWS = [
    {"strike": 22500.0, "ce_oi": 100_000, "pe_oi": 1_000_000,
     "ce_gamma": 0.0001, "pe_gamma": 0.002},
    {"strike": 22700.0, "ce_oi": 300_000, "pe_oi": 500_000,
     "ce_gamma": 0.0004, "pe_gamma": 0.0008},
    {"strike": 22900.0, "ce_oi": 900_000, "pe_oi": 200_000,
     "ce_gamma": 0.0009, "pe_gamma": 0.0005},
    {"strike": 22950.0, "ce_oi": 1_500_000, "pe_oi": 700_000,
     "ce_gamma": 0.0006, "pe_gamma": 0.0006},
    {"strike": 23000.0, "ce_oi": 1_100_000, "pe_oi": 1_300_000,
     "ce_gamma": 0.0005, "pe_gamma": 0.0009},
    {"strike": 23200.0, "ce_oi": 800_000, "pe_oi": 400_000,
     "ce_gamma": 0.001, "pe_gamma": 0.0004},
]


@pytest.fixture(autouse=True)
def _clean_registry():
    clear_registry()
    yield
    clear_registry()


def _level(
    *,
    source: str = PRICE_ACTION,
    kind: str = SUPPORT,
    price: float | None = None,
    bottom: float | None = None,
    top: float | None = None,
    start_price: float | None = None,
    end_price: float | None = None,
    start_as_of: str | None = None,
    end_as_of: str | None = None,
    strength: float | None = None,
    touches: int | None = None,
    side: str | None = None,
    ident: str | None = None,
) -> Level:
    if price is None and bottom is None and start_price is None:
        price = 100.0
    if price is not None:
        geometry = "horizontal"
    elif bottom is not None or top is not None:
        geometry = "zone"
    else:
        geometry = "segment"
    if start_price is not None and end_price is not None:
        start_as_of = start_as_of or "2026-01-01"
        end_as_of = end_as_of or "2026-01-10"
    return Level(
        id=ident
        or level_id(
            source,
            kind,
            AS_OF,
            price=price,
            bottom=bottom,
            top=top,
            start_price=start_price,
            end_price=end_price,
        ),
        symbol="NIFTY",
        timeframe="1D",
        as_of=AS_OF,
        kind=kind,
        source=source,
        geometry=geometry,
        price=price,
        bottom=bottom,
        top=top,
        side=side,
        strength=strength,
        touches=touches,
        start_price=start_price,
        end_price=end_price,
        start_as_of=start_as_of,
        end_as_of=end_as_of,
    )


def test_dedupe_keeps_stronger_level_and_is_order_independent():
    weak = _level(price=100.0, strength=0.2, touches=1)
    strong = _level(price=100.0, strength=0.9, touches=5)
    fused = fuse_levels([weak, strong], spot=100.0)
    assert isinstance(fused, tuple)
    assert [(level.id, level.strength, level.touches) for level in fused] == [
        (strong.id, 0.9, 5)
    ]
    assert fuse_levels([strong, weak], spot=100.0) == fused


def test_dedupe_ties_break_on_touches():
    low = _level(price=100.0, strength=0.5, touches=2)
    high = _level(price=100.0, strength=0.5, touches=9)
    assert fuse_levels([low, high]) == (high,)
    assert fuse_levels([high, low]) == (high,)


def test_dedupe_equal_quality_uses_id_tie_break_independent_of_input_order():
    """Equal strength and touches dedupe to the higher id, whichever comes first."""
    low_id = _level(price=100.0, strength=0.5, touches=2, ident="aaa")
    high_id = _level(price=100.0, strength=0.5, touches=2, ident="zzz")
    for order in ((low_id, high_id), (high_id, low_id)):
        assert fuse_levels(order) == (high_id,)
    assert fuse_levels([low_id, high_id]) == fuse_levels([high_id, low_id])


def test_never_merges_across_sources():
    price_action = _level(source=PRICE_ACTION, price=100.0, strength=0.9)
    gex = _level(source=GEX, price=100.0, strength=0.9)
    fused = fuse_levels([price_action, gex], spot=100.0)
    assert [(level.id, level.source) for level in fused] == [
        (price_action.id, PRICE_ACTION),
        (gex.id, GEX),
    ]


def test_side_is_filled_only_when_missing():
    below = _level(price=90.0)
    inside = _level(price=100.0)
    above = _level(price=110.0)
    zone_below = _level(bottom=95.0, top=99.0)
    zone_inside = _level(bottom=95.0, top=105.0)
    segment_above = _level(
        start_price=105.0,
        end_price=110.0,
        start_as_of="2026-01-01",
        end_as_of="2026-01-10",
    )
    explicit = _level(price=95.0, side="inside", ident="explicit")
    result = {
        level.id: level.side
        for level in fuse_levels(
            [below, inside, above, zone_below, zone_inside, segment_above, explicit],
            spot=100.0,
        )
    }
    assert result == {
        below.id: "below",
        inside.id: "inside",
        above.id: "above",
        zone_below.id: "below",
        zone_inside.id: "inside",
        segment_above.id: "above",
        explicit.id: "inside",
    }
    assert fuse_levels([below])[0].side is None


def test_deterministic_order_source_strength_distance_then_id():
    levels = [
        _level(source=TRENDLINE, price=150.0, strength=1.0, ident="zz"),
        _level(source=PRICE_ACTION, price=140.0, strength=0.1, ident="yy"),
        _level(source=GEX, price=120.0, strength=0.5, ident="xx"),
        _level(source=GEX, price=110.0, strength=0.9, ident="ww"),
        _level(source=PRICE_ACTION, price=99.0, strength=0.1, ident="aaa"),
        _level(source=PRICE_ACTION, price=101.0, strength=0.1, ident="bbb"),
    ]
    expected = [
        (PRICE_ACTION, 99.0),
        (PRICE_ACTION, 101.0),
        (PRICE_ACTION, 140.0),
        (GEX, 110.0),
        (GEX, 120.0),
        (TRENDLINE, 150.0),
    ]
    assert [
        (level.source, level.price) for level in fuse_levels(levels, spot=100.0)
    ] == expected
    assert fuse_levels(list(reversed(levels)), spot=100.0) == fuse_levels(
        levels, spot=100.0
    )


def test_same_source_same_distance_stronger_sorts_first():
    """Strength is an independent sort key: equal distance must not decide it.

    Both levels are price_action and both are 10 points from spot 100, but the
    weaker one has the lexically smaller id. Removing the strength key from
    _sort_key would put the weaker level first, so this test fails there.
    """
    weaker = _level(price=90.0, strength=0.2, ident="aaa")
    stronger = _level(price=110.0, strength=0.9, ident="zzz")
    for order in ((weaker, stronger), (stronger, weaker)):
        assert [lv.id for lv in fuse_levels(order, spot=100.0)] == [
            "zzz",
            "aaa",
        ]


def test_same_source_same_strength_nearer_sorts_first():
    """Distance is an independent sort key: equal strength must not decide it.

    Both levels are price_action with the same strength, but the farther one
    has the lexically smaller id. Removing the distance key from _sort_key
    would put the farther level first, so this test fails there.
    """
    nearer = _level(price=99.0, strength=0.5, ident="zzz")
    farther = _level(price=110.0, strength=0.5, ident="aaa")
    for order in ((nearer, farther), (farther, nearer)):
        assert [lv.price for lv in fuse_levels(order, spot=100.0)] == [
            99.0,
            110.0,
        ]


def test_max_per_side_caps_after_sorting():
    levels = [
        _level(price=90.0, strength=0.5),
        _level(price=80.0, strength=0.9),
        _level(price=110.0, strength=0.2),
        _level(price=120.0, strength=0.4),
        _level(price=100.0, strength=0.3),
    ]
    fused = fuse_levels(levels, spot=100.0, max_per_side=1)
    assert [(level.side, level.price) for level in fused] == [
        ("below", 80.0),
        ("above", 120.0),
        ("inside", 100.0),
    ]
    with pytest.raises(ValueError, match="max_per_side"):
        fuse_levels(levels, max_per_side=-1)


def test_max_per_side_without_spot_caps_one_unknown_side_bucket():
    """spot=None leaves unresolved levels side=None, so the per-side cap
    applies to that single unknown-side bucket and becomes a global top-N cap.

    This is defined behaviour, not an omission: callers without a spot can
    still bound the book, but cannot retain one level per real side.
    """
    levels = [
        _level(price=90.0, strength=0.9, ident="aaa"),
        _level(price=110.0, strength=0.8, ident="bbb"),
        _level(price=100.0, strength=0.7, ident="ccc"),
    ]
    capped = fuse_levels(levels, spot=None, max_per_side=2)
    assert all(level.side is None for level in capped)
    assert [level.id for level in capped] == ["aaa", "bbb"]
    assert fuse_levels(levels, spot=None, max_per_side=0) == ()


@pytest.mark.parametrize(
    "bad_spot",
    [float("nan"), float("inf"), float("-inf"), "not-a-number"],
)
def test_nonfinite_spot_never_labels_a_side(bad_spot):
    level = _level(price=100.0)
    assert fuse_levels([level], spot=bad_spot)[0].side is None
    explicit = _level(price=101.0, side="below", ident="explicit")
    assert fuse_levels([explicit], spot=bad_spot)[0].side == "below"
    pair = [_level(price=99.0, ident="left"), _level(price=101.0, ident="right")]
    assert [lv.id for lv in fuse_levels(pair, spot=bad_spot)] == ["left", "right"]


@pytest.mark.parametrize("spot", [0.0, -1.0])
def test_nonpositive_spot_never_labels_a_side(spot):
    level = _level(price=100.0)
    assert fuse_levels([level], spot=spot)[0].side is None
    explicit = _level(price=101.0, side="below", ident="explicit")
    assert fuse_levels([explicit], spot=spot)[0].side == "below"
    pair = [_level(price=99.0, ident="left"), _level(price=101.0, ident="right")]
    assert [lv.id for lv in fuse_levels(pair, spot=spot)] == ["left", "right"]


@pytest.mark.parametrize("spot", [0.0, -1.0])
def test_build_level_book_nonpositive_spot_keeps_option_sides_unlabeled(spot):
    book = service.build_level_book(
        "NIFTY", "1D", AS_OF, option_rows=_OPTION_ROWS, spot=spot
    )
    option_levels = [lv for lv in book.levels if lv.source in {GEX, OI}]
    assert option_levels
    assert all(lv.side is None for lv in option_levels)
    assert book.spot == spot


@pytest.mark.parametrize("bad", [True, False, 1.0, "1"])
def test_max_per_side_requires_a_non_negative_int(bad):
    with pytest.raises(ValueError, match="non-negative integer"):
        fuse_levels([_level(price=100.0)], max_per_side=bad)


def test_fusion_copies_evidence_when_it_fills_a_side():
    level = _level(price=99.0)
    level.evidence["tag"] = "original"
    fused = fuse_levels([level], spot=100.0)[0]
    assert fused.side == "below"
    assert fused.evidence == level.evidence
    assert fused.evidence is not level.evidence
    level.evidence["tag"] = "changed"
    assert fused.evidence["tag"] == "original"


def test_service_uses_effective_spot_from_caller_ctx():
    seen = []

    def detect(ctx):
        seen.append(ctx["spot"])
        return (
            _level(price=90.0, ident="low"),
            _level(price=110.0, ident="high"),
        )

    register(
        DetectorSpec("spot_ctx", "1", SUPPORT, 0, ("spot",), {}), detect
    )
    book = service.build_level_book(
        "NIFTY", "1D", AS_OF, spot=100.0, ctx={"spot": 200.0},
        use_adapters=False,
    )
    assert seen == [200.0]
    assert book.spot == 200.0
    assert all(lv.side == "below" for lv in book.levels)


def test_same_price_segments_with_different_dates_keep_distinct_ids_and_both_survive():
    dates = (("2026-01-01", "2026-01-10"), ("2026-02-01", "2026-02-10"))
    ids = [
        level_id(
            TRENDLINE, TRENDLINE, AS_OF,
            start_price=98.0, end_price=105.0,
            start_as_of=start, end_as_of=end,
        )
        for start, end in dates
    ]
    assert ids[0] != ids[1]
    segments = [
        _level(
            source=TRENDLINE,
            kind=TRENDLINE,
            start_price=98.0,
            end_price=105.0,
            start_as_of=start,
            end_as_of=end,
            ident=ident,
        )
        for (start, end), ident in zip(dates, ids)
    ]
    assert {lv.id for lv in fuse_levels(segments, spot=100.0)} == set(ids)

    def detect(ctx):
        return segments

    register(
        DetectorSpec("trendline", "1", TRENDLINE, 0, ("candles",), {}), detect
    )
    book = service.build_level_book(
        "NIFTY", "1D", AS_OF, candles=[{"c": 100.0}], spot=100.0,
        use_adapters=False,
    )
    assert {lv.id for lv in book.levels} == set(ids)


def test_caller_ctx_none_cannot_bypass_required_inputs():
    seen = []

    def detect(ctx):
        seen.append(ctx)
        return ()

    register(
        DetectorSpec("price_action", "1", PRICE_ACTION, 0, ("candles",), {}),
        detect,
    )
    service.build_level_book(
        "NIFTY", "1D", AS_OF, candles=[{"c": 100.0}],
        ctx={"candles": None}, use_adapters=False,
    )
    assert seen == []
    service.build_level_book(
        "NIFTY", "1D", AS_OF, candles=[{"c": 100.0}], use_adapters=False
    )
    assert len(seen) == 1


def test_cold_registry_rebuilds_all_four_real_adapters():
    from market_levels.registry import list_specs

    assert list_specs() == []
    closes = [110, 110, 100, 105, 120, 110, 100, 105, 120, 110, 110, 110]
    candles = [
        {
            "t": f"2026-01-{index + 1:02d}",
            "o": close,
            "h": close + 0.5,
            "l": close - 0.5,
            "c": close,
            "v": 1000.0,
        }
        for index, close in enumerate(closes)
    ]
    book = service.build_level_book(
        "NIFTY",
        "1D",
        AS_OF,
        candles=candles,
        pivot_hlc={"high": 101.0, "low": 99.0, "close": 100.0},
        option_rows=_OPTION_ROWS,
        spot=OPTION_SPOT,
    )
    assert {spec.id for spec in list_specs()} == {
        "price_action",
        "pivot",
        "gex",
        "walls",
        "trendline",
    }
    assert {level.source for level in book.levels} == {
        PRICE_ACTION,
        PIVOT,
        GEX,
        OI,
    }


def test_register_rejects_bad_spec_and_fn():
    with pytest.raises(TypeError, match="spec must be a DetectorSpec"):
        register("not-a-spec", lambda ctx: None)
    with pytest.raises(TypeError, match="fn must be callable"):
        register(DetectorSpec("bad", "1", SUPPORT), 42)
    assert list_specs() == []


def test_register_replaces_same_id_and_preserves_order():
    first = lambda ctx: None
    second = lambda ctx: None
    replacement = lambda ctx: None
    register(DetectorSpec("a", "1", SUPPORT), first)
    register(DetectorSpec("b", "1", RESISTANCE), second)
    register(DetectorSpec("a", "2", SUPPORT), replacement)
    assert [spec.id for spec in list_specs()] == ["a", "b"]
    assert [spec.version for spec in list_specs()] == ["2", "1"]
    assert [fn for _, fn in iter_detectors()] == [replacement, second]


def test_iter_detectors_returns_snapshot_unaffected_by_late_registration():
    first = lambda ctx: None
    second = lambda ctx: None
    late = lambda ctx: None
    register(DetectorSpec("early_a", "1", SUPPORT), first)
    register(DetectorSpec("early_b", "1", SUPPORT), second)

    snapshot = iter_detectors()
    assert next(snapshot)[0].id == "early_a"
    register(DetectorSpec("late", "1", SUPPORT), late)

    assert [spec.id for spec, _ in snapshot] == ["early_b"]
    assert [spec.id for spec, _ in iter_detectors()] == [
        "early_a",
        "early_b",
        "late",
    ]


def test_build_level_book_runs_only_applicable_detectors():
    seen = []
    candles = [{"c": 100.0}]

    def detector(name, source, required, price, strength):
        def fn(ctx):
            seen.append((name, dict(ctx)))
            return _level(source=source, price=price, strength=strength, ident=name)

        register(DetectorSpec(name, "1", SUPPORT, 0, required, {}), fn)

    detector("candle_lane", PRICE_ACTION, ("candles",), 90.0, 0.4)
    detector("absent_lane", GEX, ("option_rows",), 110.0, 0.9)
    detector("spot_lane", GEX, ("spot",), 120.0, 0.8)

    book = service.build_level_book(
        "NIFTY", "1D", AS_OF, candles=candles, spot=100.0, use_adapters=False
    )
    assert [name for name, _ in seen] == ["candle_lane", "spot_lane"]
    assert seen[0][1]["candles"] is candles
    assert seen[0][1]["symbol"] == "NIFTY"
    assert seen[0][1]["timeframe"] == "1D"
    assert seen[0][1]["as_of"] == AS_OF
    assert seen[0][1]["spot"] == 100.0
    assert "option_rows" not in seen[0][1]
    assert book.symbol == "NIFTY"
    assert book.as_of == AS_OF
    assert book.spot == 100.0
    assert book.schema_version == 1
    assert [(level.id, level.side) for level in book.levels] == [
        ("candle_lane", "below"),
        ("spot_lane", "above"),
    ]


def test_build_level_book_precomputes_options_block_once_for_both_adapters(monkeypatch):
    import api.options_levels as options_levels

    calls = []
    raw = {"gex": {"support": {"strike": 95.0}}, "call_wall": {"strike": 105.0}}

    def fake_build_levels(rows, spot):
        calls.append((rows, spot))
        return raw

    monkeypatch.setattr(options_levels, "build_levels", fake_build_levels)
    seen = []

    def make_detector(name, price):
        def detect(ctx):
            seen.append((name, ctx["options_levels"]))
            return _level(source=GEX, price=price, strength=0.5, ident=name)

        register(
            DetectorSpec(name, "1", GEX, 0, ("option_rows", "spot"), {}), detect
        )

    make_detector("fake_gex", 95.0)
    make_detector("fake_walls", 105.0)
    rows = [{"strike": 100.0, "ce_oi": 5, "pe_oi": 5}]
    book = service.build_level_book(
        "NIFTY", "1D", AS_OF, option_rows=rows, spot=100.0, use_adapters=False
    )
    assert calls == [(rows, 100.0)]
    assert seen == [("fake_gex", raw), ("fake_walls", raw)]
    # Stub levels must survive the build; a detector returning () cannot catch
    # a regression that silently drops every level.
    assert [(lv.id, lv.price, lv.side) for lv in book.levels] == [
        ("fake_gex", 95.0, "below"),
        ("fake_walls", 105.0, "above"),
    ]


def test_build_level_book_leaves_options_block_absent_when_builder_fails(monkeypatch):
    import api.options_levels as options_levels

    def boom(rows, spot):
        raise ValueError("real math failure")

    monkeypatch.setattr(options_levels, "build_levels", boom)
    seen = []

    def detect(ctx):
        seen.append("options_levels" in ctx)
        return ()

    register(
        DetectorSpec("fake_fallback", "1", GEX, 0, ("option_rows", "spot"), {}),
        detect,
    )
    book = service.build_level_book(
        "NIFTY", "1D", AS_OF, option_rows=[{"strike": 100.0}], spot=100.0,
        use_adapters=False,
    )
    assert seen == [False]
    assert book.levels == ()


def test_ensure_adapters_ignores_absent_modules_but_propagates_broken_ones(monkeypatch):
    monkeypatch.setattr(service, "ADAPTER_MODULES", ("missing_adapter_lane",))
    service._ensure_adapters()

    def broken(name):
        raise ModuleNotFoundError("no module named dependency", name="dependency")

    monkeypatch.setattr(service, "ADAPTER_MODULES", ("broken_lane",))
    monkeypatch.setattr(service.importlib, "import_module", broken)
    with pytest.raises(ModuleNotFoundError, match="dependency"):
        service._ensure_adapters()
