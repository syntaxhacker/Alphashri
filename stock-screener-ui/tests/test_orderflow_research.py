"""Tests for scripts/orderflow_research.py (offline order-flow edge study)."""

import pytest

from scripts.orderflow_research import (
    build_features,
    edge_table,
    event_study,
    forward_returns,
)


def depth_book(bid, ask, bid_qty=100, ask_qty=100, levels=5):
    return {
        "buy": [{"price": round(bid - i * 0.05, 2), "quantity": bid_qty, "orders": 0} for i in range(levels)],
        "sell": [{"price": round(ask + i * 0.05, 2), "quantity": ask_qty, "orders": 0} for i in range(levels)],
    }


def make_tick(ts_sec, ltp, volume, bid, ask, tbq=100_000, tsq=100_000, vwap=None, depth=None):
    return {
        "ltp": ltp,
        "volume": volume,
        "ltt": int(ts_sec * 1000),
        "vwap": ltp if vwap is None else vwap,
        "tbq": tbq,
        "tsq": tsq,
        "depth": depth if depth is not None else depth_book(bid, ask, levels=1),
    }


def feed_buy_pressure(n=80):
    ticks = []
    for i in range(n):
        ts = 1000 + i
        ltp = 100.0 + i * 0.012
        ticks.append(make_tick(ts, ltp, 1000 * i, ltp - 0.05, ltp, 500_000, 100_000, 99.0))
    return ticks


class TestBuildFeatures:
    def test_empty_input(self):
        assert build_features([]) == []

    def test_invalid_ticks_skipped(self):
        assert build_features([None, {}, {"ltp": 0, "ltt": 1000}, {"ltp": 100, "ltt": 0}]) == []

    def test_buy_at_ask_positive_cvd(self):
        ticks = [
            make_tick(1000, 100.0, 1000, 99.95, 100.0),
            make_tick(1001, 100.0, 1500, 99.95, 100.0),
        ]
        features = build_features(ticks)
        assert features[-1]["cvd"] == 500

    def test_sell_at_bid_negative_cvd(self):
        ticks = [
            make_tick(1000, 100.0, 1000, 100.0, 100.05),
            make_tick(1001, 100.0, 1500, 100.0, 100.05),
        ]
        features = build_features(ticks)
        assert features[-1]["cvd"] == -500

    def test_missing_side_carries_previous(self):
        ticks = [
            make_tick(1000, 100.0, 1000, 99.95, 100.0),
            make_tick(1001, 100.0, 1500, 99.95, 100.0),
            make_tick(1002, 100.0, 1800, 99.0, 101.0),
        ]
        features = build_features(ticks)
        assert features[-1]["cvd"] == 800

    def test_imbalance_and_depth_imbalance(self):
        tick = make_tick(
            1000,
            100.0,
            1000,
            99.95,
            100.05,
            tbq=600,
            tsq=400,
            depth=depth_book(99.95, 100.05, bid_qty=100, ask_qty=50),
        )
        row = build_features([tick])[0]
        assert row["imb"] == pytest.approx(0.2)
        assert row["depth_imb"] == pytest.approx(250 / 750)

    def test_vwap_distance_pct(self):
        tick = make_tick(1000, 110.0, 1000, 109.95, 110.05, vwap=100.0)
        row = build_features([tick])[0]
        assert row["vwap_dist_pct"] == pytest.approx(10.0)

    def test_depth_slope_shape(self):
        depth = {
            "buy": [{"price": 99.95, "quantity": 100}, {"price": 99.9, "quantity": 300}],
            "sell": [{"price": 100.05, "quantity": 100}, {"price": 100.1, "quantity": 300}],
        }
        tick = make_tick(1000, 100.0, 1000, 99.95, 100.05, depth=depth)
        row = build_features([tick])[0]
        assert row["depth_slope"] == pytest.approx(0.5)

    def test_trailing_returns(self):
        ticks = [
            make_tick(1000, 100.0, 1000, 99.95, 100.0),
            make_tick(1011, 110.0, 2000, 109.95, 110.0),
        ]
        features = build_features(ticks)
        assert features[0]["ret_10"] is None
        assert features[1]["ret_10"] == pytest.approx(10.0)

    def test_too_short_has_none_trailing(self):
        row = build_features([make_tick(1000, 100.0, 1000, 99.95, 100.0)])[0]
        assert row["ret_10"] is None
        assert row["ret_30"] is None
        assert row["ret_60"] is None
        assert row["cvd_slope_60"] is None

    def test_rows_are_one_per_second_with_last_tick(self):
        ticks = [
            make_tick(1000, 100.0, 1000, 99.95, 100.0),
            make_tick(1000, 101.0, 1200, 100.95, 101.0),
        ]
        features = build_features(ticks)
        assert len(features) == 1
        assert features[0]["ltp"] == 101.0
        assert features[0]["sec"] == 1000


class TestForwardReturns:
    def test_forward_return_and_direction_labels(self):
        features = [
            {"sec": 1000, "ltp": 100.0},
            {"sec": 1010, "ltp": 110.0},
            {"sec": 1020, "ltp": 90.0},
        ]
        out = forward_returns(features, [10])
        assert out[0]["fwd_10"] == pytest.approx(10.0)
        assert out[0]["label_10"] == 1
        assert out[1]["fwd_10"] == pytest.approx((90.0 - 110.0) / 110.0 * 100.0)
        assert out[1]["label_10"] == -1
        assert out[2]["fwd_10"] is None
        assert out[2]["label_10"] == 0

    def test_does_not_mutate_input(self):
        features = [{"sec": 1000, "ltp": 100.0}, {"sec": 1010, "ltp": 110.0}]
        forward_returns(features, [10])
        assert "fwd_10" not in features[0]

    def test_empty_input(self):
        assert forward_returns([], [10]) == []


class TestEdgeTable:
    def test_perfect_positive_ic_and_win_rate(self):
        features = [
            {"imb": v, "fwd_10": v} for v in (1.0, 2.0, 3.0, 4.0)
        ]
        rows = edge_table(features, [10])
        row = next(r for r in rows if r["feature"] == "imb")
        assert row["ic"] == pytest.approx(1.0)
        assert row["win_rate_pct"] == pytest.approx(100.0)
        assert row["n"] == 4

    def test_noise_feature_has_zero_ic(self):
        features = [
            {"imb": x, "fwd_10": y} for x, y in zip((1.0, 2.0, 3.0, 4.0), (1.0, -1.0, -1.0, 1.0))
        ]
        rows = edge_table(features, [10])
        row = next(r for r in rows if r["feature"] == "imb")
        assert abs(row["ic"]) < 1e-9

    def test_constant_feature_ic_is_zero(self):
        features = [{"imb": 1.0, "fwd_10": v} for v in (1.0, -1.0, 2.0, -2.0)]
        rows = edge_table(features, [10])
        assert next(r for r in rows if r["feature"] == "imb")["ic"] == 0.0

    def test_empty_input(self):
        assert edge_table([], [10]) == []

    def test_missing_forward_column_is_skipped(self):
        assert edge_table([{"imb": 1.0}], [10]) == []


class TestEventStudy:
    def test_scores_replayed_signals(self):
        study = event_study(feed_buy_pressure(), [10])
        assert study["signal_count"] > 0
        assert study["evaluated"] > 0
        assert len(study["by_side"]) == 4
        assert len(study["overall"]) == 1
        assert study["overall"][0]["count"] > 0

    def test_direction_adjusted_buy_signals_positive(self):
        study = event_study(feed_buy_pressure(), [10])
        assert study["overall"][0]["avg_return_pct"] > 0
        assert study["overall"][0]["win_rate_pct"] == 100.0

    def test_mfe_greater_than_mae(self):
        study = event_study(feed_buy_pressure(), [10])
        for signal in study["signals"]:
            assert signal["mfe_pct"] >= signal["mae_pct"]

    def test_empty_input(self):
        study = event_study([], [10])
        assert study["signal_count"] == 0
        assert study["evaluated"] == 0
        assert study["signals"] == []
        assert study["overall"][0]["count"] == 0
        assert study["overall"][0]["win_rate_pct"] == 0.0
        assert study["overall"][0]["avg_return_pct"] == 0.0

    def test_short_input_no_signals(self):
        ticks = [make_tick(1000, 100.0, 1000, 99.95, 100.0)]
        study = event_study(ticks, [10])
        assert study["signal_count"] == 0
        assert study["evaluated"] == 0
