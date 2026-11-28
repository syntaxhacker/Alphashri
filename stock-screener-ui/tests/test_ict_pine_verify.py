"""Independent Pine-re-derived verification of the ``ict_pine`` port.

Every expected value in this module is recomputed from the rules in the
read-only root ``ict.pine`` -- never from the modules under test. The three
comparisons are exact set/list equality, so a single changed bar, level or
index fails the test with the offending bar shown.

Rules re-derived here:
    * FVG          ict.pine:127-130, 547-566, 597-645, 699-724
    * MSS/BOS      ict.pine:192-195, 244-266, 344-363, 409-419, 465-517
    * Order blocks ict.pine:131-132, 316-334, 861-887

The Pine's ``per`` / ``perB`` flags (ict.pine:122-123) are *drawing* windows in
Present mode; they do not gate the signals themselves and are deliberately out
of scope for these comparisons.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterator

import numpy as np
import pandas as pd
import pytest

from scripts.research.ict_pine.imbalance import fvg as port_fvg
from scripts.research.ict_pine.orderblocks import order_blocks as port_order_blocks
from scripts.research.ict_pine.structure import market_structure as port_market_structure

ROOT = Path(__file__).resolve().parents[1]
REAL_BARS = ROOT / "experiments/data/duka_cache/usatechidxusd_1m.parquet"


# --------------------------------------------------------------------------- #
# Independent re-derivations from ict.pine
# --------------------------------------------------------------------------- #


def _ohlc(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    return (
        df["open"].to_numpy(dtype=float),
        df["high"].to_numpy(dtype=float),
        df["low"].to_numpy(dtype=float),
        df["close"].to_numpy(dtype=float),
    )


def pine_fvg(
    df: pd.DataFrame, body_period: int = 5, wick_ratio: float = 0.36
) -> list[tuple[int, str, float, float, int]]:
    """FVG zones from ict.pine:547-566 and 597-645, independently of the port.

    ``body = abs(close - open)`` (line 129) and ``meanBody = ta.sma(body, len)``
    with ``len = 5`` (lines 25, 130): Pine's SMA is ``na`` before bar 4.
    ``L_body`` (548-550) needs both wicks shorter than ``body * 0.36`` (line 38).
    ``L_bodyUP/DN`` (552-553) add ``body > meanBody`` and candle direction.
    ``imbalanceUP = L_bodyUP[1] and low > high[2]`` (565); the bear mirror is
    ``L_bodyDN[1] and high < low[2]`` (566). A bull box spans ``high[2]..low``
    (line 614-615), a bear box ``low[2]..high`` (634-635), both drawn from
    ``n-2`` to ``n`` -- the zone is created on the third bar.
    """
    open_, high, low, close = _ohlc(df)
    count = len(open_)
    body = np.abs(close - open_)
    mx = np.maximum(close, open_)  # line 127
    mn = np.minimum(close, open_)  # line 128

    up = [False] * count
    down = [False] * count
    for bar in range(body_period - 1, count):
        mean_body = body[bar - body_period + 1 : bar + 1].mean()
        l_body = (
            high[bar] - mx[bar] < body[bar] * wick_ratio
            and mn[bar] - low[bar] < body[bar] * wick_ratio
        )
        if body[bar] > mean_body and l_body:
            if close[bar] > open_[bar]:
                up[bar] = True
            elif close[bar] < open_[bar]:
                down[bar] = True

    zones: list[tuple[int, str, float, float, int]] = []
    for bar in range(2, count):
        if up[bar - 1] and low[bar] > high[bar - 2]:
            zones.append((bar, "bull", float(low[bar]), float(high[bar - 2]), bar - 2))
        if down[bar - 1] and high[bar] < low[bar - 2]:
            zones.append((bar, "bear", float(low[bar - 2]), float(high[bar]), bar - 2))
    return zones


def pine_zigzag_timeline(df: pd.DataFrame, left: int = 5) -> Iterator[list[tuple[int, int, float]]]:
    """Yield ``aZZ`` (newest first) after each bar's ``ph``/``pl`` update.

    ``ta.pivothigh(hi, left, 1)`` (ict.pine:351) returns ``hi[n-1]`` at bar
    ``n`` when it beats the ``left`` highs before it and ``hi[n]``; ``pl`` is
    the mirror (352). ``aZZ`` starts as 50 slots of ``d=0/x=0/y=na``
    (244-249), so the first pivot of either kind is accepted. ``in_out``
    (265-266) unshifts; a same-direction pivot only replaces node 0 when it
    is more extreme (362-363 / 418-419).
    """
    open_, high, low, _ = _ohlc(df)  # hi = high, lo = low (117-118)
    by_bar: dict[int, list[tuple[int, int, float]]] = {}
    for pivot in range(left, len(high)):
        confirmed = pivot + 1
        before_h = high[pivot - left : pivot]
        after_h = high[pivot + 1 : confirmed + 1]
        if np.all(high[pivot] > before_h) and np.all(high[pivot] > after_h):
            by_bar.setdefault(confirmed, []).append((1, pivot, float(high[pivot])))
        before_l = low[pivot - left : pivot]
        after_l = low[pivot + 1 : confirmed + 1]
        if np.all(low[pivot] < before_l) and np.all(low[pivot] < after_l):
            by_bar.setdefault(confirmed, []).append((-1, pivot, float(low[pivot])))

    nodes: list[tuple[int, int, float]] = []
    for bar in range(len(high)):
        for direction, pivot, price in by_bar.get(bar, []):
            first_d = nodes[0][0] if nodes else 0
            if direction == 1:
                if first_d < 1:
                    nodes.insert(0, (1, pivot, price))
                elif price > nodes[0][2]:
                    nodes[0] = (1, pivot, price)
            else:
                if first_d > -1:
                    nodes.insert(0, (-1, pivot, price))
                elif price < nodes[0][2]:
                    nodes[0] = (-1, pivot, price)
        yield list(nodes)


def pine_market_structure(
    df: pd.DataFrame, left: int = 5
) -> tuple[list[tuple[int, int, float]], list[tuple[int, int, float]]]:
    """MSS/BOS events from ict.pine:465-517, independently of the port.

    ``iH/iL`` (468-469) skip the just-added node: index 2 when node 2 has the
    matching direction, else index 1. A close through the opposite side flips
    ``MSS.dir`` (473/487); a later close through a *different* same-side level
    is a BOS (501-517), with repeats of the last MSS/BOS level suppressed.
    """
    _, _, _, close = _ohlc(df)
    mss: list[tuple[int, int, float]] = []
    bos: list[tuple[int, int, float]] = []
    direction = 0
    last_mss: float | None = None
    last_bos: float | None = None

    for bar, nodes in enumerate(pine_zigzag_timeline(df, left=left)):
        d2 = nodes[2][0] if len(nodes) > 2 else 0
        i_h = 2 if d2 == 1 else 1
        i_l = 2 if d2 == -1 else 1
        high_node = nodes[i_h] if len(nodes) > i_h and nodes[i_h][0] == 1 else None
        low_node = nodes[i_l] if len(nodes) > i_l and nodes[i_l][0] == -1 else None
        c = float(close[bar])

        if high_node is not None and c > high_node[2] and direction < 1:
            mss.append((bar, 1, high_node[2]))
            direction, last_mss, last_bos = 1, high_node[2], None
        elif low_node is not None and c < low_node[2] and direction > -1:
            mss.append((bar, -1, low_node[2]))
            direction, last_mss, last_bos = -1, low_node[2], None
        elif (
            direction == 1
            and high_node is not None
            and c > high_node[2]
            and (last_bos is None or high_node[2] != last_bos)
            and high_node[2] != last_mss
        ):
            bos.append((bar, 1, high_node[2]))
            last_bos = high_node[2]
        elif (
            direction == -1
            and low_node is not None
            and c < low_node[2]
            and (last_bos is None or low_node[2] != last_bos)
            and low_node[2] != last_mss
        ):
            bos.append((bar, -1, low_node[2]))
            last_bos = low_node[2]
    return mss, bos


def pine_order_blocks(
    df: pd.DataFrame, length: int = 10
) -> list[tuple[int, float, float]]:
    """Order blocks from ict.pine:316-334 and 861-887, independently of the port.

    ``swings(length)`` records a high on an ``os`` flip to 0 and a low on a
    flip to 1, ``length`` bars after the pivot (324-331). A bull block opens
    when ``close > top.y`` and scans ``i = 1 .. (n - top.x) - 1`` (i.e. bars
    ``n-1`` down to ``top.x+1``): ``minima`` follows the lowest body low and
    ``maxima`` is that candle's body high (865-873). The bear mirror uses the
    highest body high (900-908). ``min``/``max`` are body edges because
    ``useBody`` defaults to true (50, 131-132).
    """
    open_, high, low, close = _ohlc(df)
    count = len(open_)
    mx = np.maximum(close, open_)
    mn = np.minimum(close, open_)

    swings: list[tuple[int, str, float, int]] = []  # (pivot, kind, price, confirmed)
    os_state = 0  # line 317
    for bar in range(length, count):
        pivot = bar - length
        upper = high[pivot + 1 : bar + 1].max()
        lower = low[pivot + 1 : bar + 1].min()
        next_os = os_state
        if high[pivot] > upper:
            next_os = 0
        elif low[pivot] < lower:
            next_os = 1
        if next_os == 0 and os_state != 0:
            swings.append((pivot, "high", float(high[pivot]), bar))
        elif next_os == 1 and os_state != 1:
            swings.append((pivot, "low", float(low[pivot]), bar))
        os_state = next_os

    top: tuple[int, float] | None = None  # (x, y)
    bottom: tuple[int, float] | None = None
    top_crossed = bottom_crossed = False
    swing_ptr = 0
    blocks: list[tuple[int, float, float]] = []  # (loc, top, bottom)

    for bar in range(count):
        while swing_ptr < len(swings) and swings[swing_ptr][3] <= bar:
            pivot, kind, price, _ = swings[swing_ptr]
            if kind == "high":
                top, top_crossed = (pivot, price), False
            else:
                bottom, bottom_crossed = (pivot, price), False
            swing_ptr += 1

        if top is not None and close[bar] > top[1] and not top_crossed:
            top_crossed = True
            minima, maxima, loc = mx[bar - 1], mn[bar - 1], bar - 1
            for j in range(bar - 1, top[0], -1):
                minima = min(mn[j], minima)
                if minima == mn[j]:
                    maxima, loc = mx[j], j
            blocks.append((int(loc), float(maxima), float(minima)))

        if bottom is not None and close[bar] < bottom[1] and not bottom_crossed:
            bottom_crossed = True
            maxima, minima, loc = mn[bar - 1], mx[bar - 1], bar - 1
            for j in range(bar - 1, bottom[0], -1):
                maxima = max(mx[j], maxima)
                if maxima == mx[j]:
                    minima, loc = mn[j], j
            blocks.append((int(loc), float(maxima), float(minima)))
    return blocks


# --------------------------------------------------------------------------- #
# Comparison helpers
# --------------------------------------------------------------------------- #


def _assert_sequences(label: str, expected: list[Any], actual: list[Any]) -> None:
    e, a = sorted(expected), sorted(actual)
    if e == a:
        return
    for pos in range(max(len(e), len(a))):
        ev = e[pos] if pos < len(e) else "<Pine event missing>"
        av = a[pos] if pos < len(a) else "<port event missing>"
        if ev != av:
            pytest.fail(
                f"{label}: first divergence at sorted position {pos} "
                f"(Pine={ev!r}, port={av!r}); counts Pine={len(e)} port={len(a)}"
            )


def _port_fvg_zones(df: pd.DataFrame) -> list[tuple[int, str, float, float, int]]:
    return [
        (z["idx"], z["dir"], z["top"], z["bottom"], z["start_idx"])
        for z in port_fvg(df, strict=True)
    ]


def _port_structure_events(
    df: pd.DataFrame,
) -> list[tuple[int, int, float]]:
    result = port_market_structure(df, 5)
    return [(e["idx"], e["dir"], e["level"]) for e in result["mss"] + result["bos"]]


def _port_ob_blocks(df: pd.DataFrame) -> list[tuple[int, float, float]]:
    result = port_order_blocks(df, length=10)
    return [(b["idx"], b["top"], b["bottom"]) for b in result["bullish"] + result["bearish"]]


def _synthetic_frame(bars: int = 400, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100.0 + np.cumsum(rng.normal(0.0, 1.5, bars))
    open_ = np.concatenate(([100.0], close[:-1]))
    high = np.maximum(open_, close) + rng.uniform(0.02, 0.75, bars)
    low = np.minimum(open_, close) - rng.uniform(0.02, 0.75, bars)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close},
        index=pd.date_range("2026-01-01", periods=bars, freq="min", tz="UTC"),
    )


@pytest.fixture(scope="module")
def real_frame() -> pd.DataFrame:
    raw = pd.read_parquet(REAL_BARS).tail(5000)
    return raw.rename(columns={"o": "open", "h": "high", "l": "low", "c": "close"})[
        ["open", "high", "low", "close"]
    ]


# --------------------------------------------------------------------------- #
# Synthetic: all three features
# --------------------------------------------------------------------------- #


def test_synthetic_fvg_matches_pine() -> None:
    df = _synthetic_frame()
    expected = pine_fvg(df)
    assert expected, "fixture produced no FVG events -- comparison would be vacuous"
    _assert_sequences("synthetic FVG", expected, _port_fvg_zones(df))


def test_synthetic_mss_bos_matches_pine() -> None:
    df = _synthetic_frame()
    expected_mss, expected_bos = pine_market_structure(df)
    assert expected_mss and expected_bos
    _assert_sequences("synthetic MSS", expected_mss + expected_bos, _port_structure_events(df))


def test_synthetic_order_blocks_match_pine() -> None:
    df = _synthetic_frame()
    expected = pine_order_blocks(df)
    assert expected
    _assert_sequences("synthetic order blocks", expected, _port_ob_blocks(df))


# --------------------------------------------------------------------------- #
# Real bars: FVG and MSS
# --------------------------------------------------------------------------- #


def test_real_bars_fvg_matches_pine(real_frame: pd.DataFrame) -> None:
    expected = pine_fvg(real_frame)
    actual = _port_fvg_zones(real_frame)
    assert expected, "real bars produced no FVG events"
    _assert_sequences("real FVG (first 500)", expected[:500], actual[:500])


def test_real_bars_mss_bos_matches_pine(real_frame: pd.DataFrame) -> None:
    expected_mss, expected_bos = pine_market_structure(real_frame)
    expected = sorted(expected_mss + expected_bos)[:500]
    actual = _port_structure_events(real_frame)[:500]
    assert expected, "real bars produced no MSS/BOS events"
    _assert_sequences("real MSS/BOS (first 500)", expected, actual)


# --------------------------------------------------------------------------- #
# No lookahead: truncating the tail cannot rewrite earlier events
# --------------------------------------------------------------------------- #


DROPPED = 40


def _no_lookahead(label: str, full: list[Any], truncated: list[Any], cutoff: int) -> None:
    early_full = [e for e in full if (e[0] if isinstance(e, tuple) else e["idx"]) < cutoff]
    early_short = [
        e for e in truncated if (e[0] if isinstance(e, tuple) else e["idx"]) < cutoff
    ]
    _assert_sequences(f"{label} no-lookahead", early_full, early_short)


def test_no_lookahead_fvg() -> None:
    df = _synthetic_frame()
    cutoff = len(df) - DROPPED
    _no_lookahead(
        "FVG", _port_fvg_zones(df), _port_fvg_zones(df.iloc[:-DROPPED]), cutoff
    )


def test_no_lookahead_mss_bos() -> None:
    df = _synthetic_frame()
    cutoff = len(df) - DROPPED
    _no_lookahead(
        "MSS/BOS",
        _port_structure_events(df),
        _port_structure_events(df.iloc[:-DROPPED]),
        cutoff,
    )


def test_no_lookahead_order_blocks() -> None:
    # A block's `idx` is the candle chosen from its leg, not the bar that
    # created it, so filtering by `idx < cutoff` would wrongly demand blocks
    # that only trigger after the truncation. Each side list is in creation
    # order, so the truncated run must equal a prefix of the full run.
    df = _synthetic_frame()
    full = port_order_blocks(df, length=10)
    short = port_order_blocks(df.iloc[:-DROPPED], length=10)
    for side in ("bullish", "bearish"):
        expected = [(b["idx"], b["top"], b["bottom"]) for b in full[side]]
        actual = [(b["idx"], b["top"], b["bottom"]) for b in short[side]]
        if actual != expected[: len(actual)]:
            pytest.fail(
                f"order blocks no-lookahead ({side}): truncated run diverges "
                f"from the {len(actual)}-block prefix of the full run "
                f"(counts full={len(expected)} truncated={len(actual)})"
            )
