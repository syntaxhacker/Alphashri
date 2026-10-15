"""Curve / cup detector audit tests (curve_bearish, cup_handle).

Focused on the contract invariants that a curve_cup overlay must satisfy:

* direction and target/stop sides (``compute_levels`` geometry),
* the fitted quadratic overlay is actually drawn (non-empty polyline) and lies
  inside the pattern span / on real candle timestamps,
* the dashed breakout guide coincides with a real drawn horizontal level
  (dome neckline for ``curve_bearish``; cup handle rim for ``cup_handle``),
* the added envelope/handle outlines bound price (within ``0.25 * ATR``), and
* the defining swing pivots are attached for on-chart markers.

Synthetic OHLCV only — no production mocks and no shared-test imports.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from chart_patterns import features as F
from chart_patterns.detectors.common import DETECTORS

_INDEX = pd.date_range("2024-01-01", periods=400, freq="D", tz="UTC")


def frame(closes, spread: float = 0.5) -> pd.DataFrame:
    close = np.asarray(closes, dtype=float)
    n = len(close)
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close + spread,
            "low": close - spread,
            "close": close,
            "volume": np.full(n, 1000.0),
        },
        index=_INDEX[:n],
    )


def _detector(pattern_id: str):
    return dict(DETECTORS)[pattern_id]


def dome_geometry() -> pd.DataFrame:
    """Concave-down dome with both shoulders at ~98-100 and a mid peak ~130."""
    return frame([130.0 - 0.02 * (i - 40) ** 2 for i in range(80)])


def cup_handle_geometry() -> pd.DataFrame:
    """Rounded cup (concave up) + a shallow handle drifting sideways/down."""
    cup = [100.0 + 0.012 * (i - 39) ** 2 for i in range(79)]
    handle = np.interp(np.arange(11), [0, 5, 10], [118.25, 112.0, 117.0])
    return frame(cup + list(handle[1:]))


def _hit(pattern_id: str, df: pd.DataFrame):
    data = F.normalize_ohlcv(df)
    hits = _detector(pattern_id)(data, {}) or []
    assert hits, f"{pattern_id} did not fire on its synthetic geometry"
    return hits[0], data


def _line_prices(line: list[dict]) -> list[float]:
    return [float(p["price"]) for p in line]


def _timestamps(line: list[dict]) -> list[str]:
    return [p["t"] for p in line]


def _is_horizontal(line: list[dict]) -> bool:
    prices = _line_prices(line)
    return len(prices) >= 2 and max(prices) - min(prices) <= 1e-6


# ---------------------------------------------------------------------------
# Direction + level sides
# ---------------------------------------------------------------------------


def test_curve_bearish_direction_and_level_sides():
    hit, _ = _hit("curve_bearish", dome_geometry())
    assert hit.direction == "bearish"
    assert hit.target < hit.breakout_level < hit.stop
    assert hit.rr >= 0.0


def test_cup_handle_direction_and_level_sides():
    hit, _ = _hit("cup_handle", cup_handle_geometry())
    assert hit.direction == "bullish"
    assert hit.stop < hit.breakout_level < hit.target
    assert hit.rr >= 0.0


def test_curve_bearish_measured_move_uses_pattern_height():
    hit, _ = _hit("curve_bearish", dome_geometry())
    # bearish target = breakout - height, so depth == breakout - target.
    assert hit.breakout_level - hit.target == pytest.approx(32.0, abs=1.0)
    assert hit.stop > hit.breakout_level


# ---------------------------------------------------------------------------
# Drawn overlay: curve polyline + coincident horizontal breakout level
# ---------------------------------------------------------------------------


def test_curve_bearish_draws_dome_curve_and_neckline():
    hit, _ = _hit("curve_bearish", dome_geometry())
    assert len(hit.trendlines) >= 2, "expected dome curve + neckline overlays"

    curve = hit.trendlines[0]
    assert len(curve) > 2, "dome must be drawn as a polyline, not a 2-point line"
    curve_prices = _line_prices(curve)
    # concave-down dome: the middle of the fitted curve is the peak
    assert max(curve_prices) > curve_prices[0]
    assert max(curve_prices) > curve_prices[-1]
    assert curve_prices.index(max(curve_prices)) not in (0, len(curve_prices) - 1)

    # neckline overlay is horizontal and equals the breakout level exactly, so
    # the dashed breakout guide coincides with a real drawn level.
    neck = hit.trendlines[1]
    assert _is_horizontal(neck)
    assert _line_prices(neck) == pytest.approx([hit.breakout_level, hit.breakout_level])
    # neckline is the lower shoulder of the dome
    assert hit.breakout_level == pytest.approx(min(curve_prices[0], curve_prices[-1]))


def test_cup_handle_draws_cup_curve_and_rim():
    hit, _ = _hit("cup_handle", cup_handle_geometry())
    assert len(hit.trendlines) >= 2, "expected cup curve + handle rim overlays"

    curve = hit.trendlines[0]
    assert len(curve) > 2, "cup must be drawn as a polyline"
    curve_prices = _line_prices(curve)
    # concave-up cup: the middle of the fitted curve is the trough
    assert min(curve_prices) < curve_prices[0]
    assert min(curve_prices) < curve_prices[-1]

    rim = hit.trendlines[1]
    assert _is_horizontal(rim)
    assert _line_prices(rim) == pytest.approx([hit.breakout_level, hit.breakout_level]), (
        "handle rim line must equal breakout_level (the cup rim)"
    )


# ---------------------------------------------------------------------------
# Overlay placement: timestamps land on candles and inside the pattern span
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("pattern_id,builder", [
    ("curve_bearish", dome_geometry),
    ("cup_handle", cup_handle_geometry),
])
def test_curve_overlay_points_are_on_real_candles(pattern_id, builder):
    hit, data = _hit(pattern_id, builder())
    candle_ts = {data.index[i].isoformat() for i in range(len(data))}
    for line in hit.trendlines:
        assert line, f"{pattern_id} produced an empty overlay line"
        for p in line:
            assert p["t"] in candle_ts, "overlay point must map to a candle timestamp"


@pytest.mark.parametrize("pattern_id,builder", [
    ("curve_bearish", dome_geometry),
    ("cup_handle", cup_handle_geometry),
])
def test_curve_overlay_span_is_covered(pattern_id, builder):
    hit, data = _hit(pattern_id, builder())
    pos = {data.index[i].isoformat(): i for i in range(len(data))}
    start = pos.get(hit.start_date) if hit.start_date in pos else None
    end = pos.get(hit.end_date) if hit.end_date in pos else None
    # fmt_date drops the time; build an explicit date->first-position map too.
    by_day: dict[str, int] = {}
    for i in range(len(data)):
        by_day.setdefault(data.index[i].strftime("%Y-%m-%d"), i)
    start = start if start is not None else by_day.get(hit.start_date)
    end = end if end is not None else by_day.get(hit.end_date)
    assert start is not None and end is not None

    covered = []
    for line in hit.trendlines:
        for p in line:
            i = pos.get(p["t"])
            if i is None:
                i = by_day.get(str(p["t"])[:10])
            assert i is not None
            covered.append(i)
    assert covered, "no overlay positions to verify"
    assert start <= min(covered) and max(covered) <= end, (
        f"{pattern_id} span {start}..{end} does not cover overlay {min(covered)}..{max(covered)}"
    )


@pytest.mark.parametrize("pattern_id,builder", [
    ("curve_bearish", dome_geometry),
    ("cup_handle", cup_handle_geometry),
])
def test_curve_hit_status_and_rr_sane(pattern_id, builder):
    hit, _ = _hit(pattern_id, builder())
    assert hit.status in {"forming", "confirmed", "failed", "marginal"}
    assert hit.rr >= 0.0
    assert hit.confidence > 0.0


# ---------------------------------------------------------------------------
# Envelope outlines: the drawn overlay must not cut through the candles
# ---------------------------------------------------------------------------

# A drawn envelope edge may sit at most this fraction of ATR inside a candle
# before it counts as cutting through price (matches ``F.envelope_line``).
ENVELOPE_TOL = 0.25


def _pos_map(data: pd.DataFrame) -> dict[str, int]:
    iso = {data.index[i].isoformat(): i for i in range(len(data))}
    by_day: dict[str, int] = {}
    for i in range(len(data)):
        by_day.setdefault(data.index[i].strftime("%Y-%m-%d"), i)
    iso.update(by_day)
    return iso


def _line_series(data: pd.DataFrame, line: list[dict]):
    """Dense ``(positions, values)`` of a drawn line (linear between points)."""
    pos = _pos_map(data)
    pts = sorted((pos[p["t"]], float(p["price"])) for p in line if p["t"] in pos)
    assert pts, "drawn line has no points on real candles"
    xs = np.array([p[0] for p in pts], dtype=float)
    ys = np.array([p[1] for p in pts], dtype=float)
    grid = np.arange(int(xs.min()), int(xs.max()) + 1)
    return grid, np.interp(grid, xs, ys)


def test_curve_bearish_has_upper_envelope_outside_candles():
    hit, data = _hit("curve_bearish", dome_geometry())
    assert len(hit.trendlines) >= 3, "expected dome curve + neckline + upper envelope"
    curve = hit.trendlines[0]
    envelope = hit.trendlines[2]
    assert len(envelope) > 2, "upper envelope must be drawn as a polyline"

    atr = F.atr_value(data)
    grid, env = _line_series(data, envelope)
    high = data["high"].to_numpy(dtype=float)[grid]
    excess = high - env  # > 0 means the line pokes into a candle
    assert excess.max() <= ENVELOPE_TOL * atr, (
        f"upper envelope pokes {excess.max():.4g} into price (> {ENVELOPE_TOL}*ATR)"
    )
    # It is a genuine outline lifted off the analysis curve, not a copy.
    _, fitted = _line_series(data, curve)
    assert np.all(env >= fitted - 1e-9)
    assert env.max() > fitted.max() + 1e-6


def test_cup_handle_has_lower_envelope_outside_candles():
    hit, data = _hit("cup_handle", cup_handle_geometry())
    assert len(hit.trendlines) >= 3, "expected cup curve + rim + lower envelope"
    curve = hit.trendlines[0]
    envelope = hit.trendlines[2]
    assert len(envelope) > 2, "lower envelope must be drawn as a polyline"

    atr = F.atr_value(data)
    grid, env = _line_series(data, envelope)
    low = data["low"].to_numpy(dtype=float)[grid]
    excess = env - low  # > 0 means the line pokes into a candle
    assert excess.max() <= ENVELOPE_TOL * atr, (
        f"lower envelope pokes {excess.max():.4g} into price (> {ENVELOPE_TOL}*ATR)"
    )
    _, fitted = _line_series(data, curve)
    assert np.all(env <= fitted + 1e-9)
    assert env.min() < fitted.min() - 1e-6


def test_cup_handle_handle_region_is_drawn_and_bounded():
    hit, data = _hit("cup_handle", cup_handle_geometry())
    assert len(hit.trendlines) >= 5, (
        "expected cup curve, rim, cup envelope + handle upper/lower boundaries"
    )
    rim = hit.trendlines[1]
    handle_upper = hit.trendlines[3]
    handle_lower = hit.trendlines[4]
    assert _is_horizontal(rim)
    assert _is_horizontal(handle_upper)
    assert _is_horizontal(handle_lower)
    assert _line_prices(rim) == pytest.approx([hit.breakout_level, hit.breakout_level])

    up = _line_prices(handle_upper)[0]
    lo = _line_prices(handle_lower)[0]
    assert lo < up, "handle lower boundary must sit below its upper boundary"

    atr = F.atr_value(data)
    grid, up_vals = _line_series(data, handle_upper)
    assert (data["high"].to_numpy(dtype=float)[grid] - up_vals).max() <= ENVELOPE_TOL * atr
    grid, lo_vals = _line_series(data, handle_lower)
    assert (lo_vals - data["low"].to_numpy(dtype=float)[grid]).max() <= ENVELOPE_TOL * atr


def test_cup_handle_span_covers_the_handle_region():
    hit, data = _hit("cup_handle", cup_handle_geometry())
    pos = _pos_map(data)
    start = pos[hit.start_date]
    end = pos[hit.end_date]
    n = end - start + 1
    handle_bars = max(5, n // 8)
    cup_end = end - handle_bars
    assert start <= cup_end < end, "cup must be followed by a non-empty handle"

    # Both handle-boundary lines actually reach the final (most recent) bar.
    for line in (hit.trendlines[3], hit.trendlines[4]):
        xs = [pos[p["t"]] for p in line]
        assert min(xs) <= cup_end and max(xs) >= end

    # The overlays stay inside the declared pattern span.
    for line in hit.trendlines:
        for p in line:
            assert start <= pos[p["t"]] <= end


@pytest.mark.parametrize("pattern_id,builder", [
    ("curve_bearish", dome_geometry),
    ("cup_handle", cup_handle_geometry),
])
def test_curve_hits_attach_swing_pivots(pattern_id, builder):
    hit, data = _hit(pattern_id, builder())
    assert hit.pivots, "expected swing pivots attached to the hit"
    pos = _pos_map(data)
    start = pos[hit.start_date]
    end = pos[hit.end_date]
    for p in hit.pivots:
        assert p["kind"] in {"high", "low"}
        assert p["t"] in pos, "pivot marker must map to a real candle timestamp"
        assert start <= pos[p["t"]] <= end, "pivot marker must lie inside the pattern span"
        assert float(p["price"]) > 0

