"""Trade-for-trade parity harness: real nautilus_trader vs the pure-Python shim.

Both legs run in fresh subprocesses so module state (especially the ``nautilus_trader``
modules swapped by ``backtest.sim.install``) cannot leak between them. The only input is
one frozen in-memory 1-minute frame; the Upstox client factory is patched in both legs,
so there is no network, no DB, and no market-data dependency.

Run:
    .venv/bin/python -m pytest tests/test_backtest_shim_parity.py -q
"""

import importlib.machinery
import importlib.util
import json
import math
import os
import subprocess
import sys
from datetime import datetime, time as dtime
from pathlib import Path

import pandas as pd
import pytest

_UI_DIR = Path(__file__).resolve().parents[1]
_NUMERIC_TOL = 1e-9


def _nautilus_installed() -> bool:
    """Detect the real package even if backtest.sim registered a specless shim first.

    Shim modules have ``__spec__ = None``, which makes ``find_spec`` raise
    ValueError. PathFinder searches sys.path directly and bypasses sys.modules.
    """
    if getattr(sys.modules.get("nautilus_trader"), "__spec__", "missing") is None:
        return importlib.machinery.PathFinder.find_spec("nautilus_trader") is not None
    try:
        return importlib.util.find_spec("nautilus_trader") is not None
    except ValueError:
        return importlib.machinery.PathFinder.find_spec("nautilus_trader") is not None

# Child program shared by both legs. Backtest engine logging is intentionally left on
# stdout; the payload is written to a file so log noise cannot corrupt the comparison.
_CHILD_SCRIPT = r'''
import json
import math
import os
import sys
import traceback


def _json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return "inf" if value > 0 else ("-inf" if value < 0 else "nan")
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _write(payload):
    with open(os.environ["PARITY_PAYLOAD_PATH"], "w", encoding="utf-8") as fh:
        json.dump(_json_safe(payload), fh, sort_keys=True, indent=2)


payload = {
    "ok": False,
    "nautilus_available": False,
    "trades": [],
    "totals": {},
    "error": None,
    "traceback": None,
    "leg": os.environ.get("PARITY_LEG", "?"),
}

try:
    # Shim must be installed before any backtest.strategies.* import. This is the
    # first substantive statement of the child on the shim leg, on purpose.
    if os.environ.get("BACKTEST_ENGINE") == "sim":
        from backtest.sim import install, is_installed

        installed = install(force=True)
        if installed is not None:
            assert installed, "install(force=True) returned a falsy value"
        assert is_installed(), "is_installed() is False after install(force=True)"

    import pandas as pd
    from unittest.mock import patch

    frame = pd.read_pickle(os.environ["PARITY_FRAME_PATH"])

    class FakeClient:
        def fetch_historical_data_v3(self, **kwargs):
            return frame.copy()

        def fetch_intraday_data_v3(self, **kwargs):
            return frame.copy()

    import backtest.strategies.orb as orb

    params = {
        "or_minutes": 45,
        "sl_pct": 1.0,
        "tp_pct": 1.2,
        "trade_size": 100,
        "breakout_buffer_pct": 0.3,
        "cooldown_minutes": 0,
        # orb.py consumes cooldown_bars/timeframe (not cooldown_minutes); pass the
        # aliases too so the requested scenario is what actually runs.
        "cooldown_bars": 0,
        "timeframe": "1",
        "enable_shorts": False,
    }

    with patch("backtest.utils.get_upstox_client_from_db", return_value=(FakeClient(), None)), \
         patch("backtest.utils.get_upstox_client_with_token", return_value=(FakeClient(), None)):
        result = orb.run_single_stock_backtest(("SYNTH", params, 5))

    symbol = result.get("symbol", "SYNTH")
    trades = []
    for t in result.get("trade_list") or []:
        trades.append({
            "symbol": symbol,
            "date": t.get("date"),
            "entry_time": t.get("entry_time"),
            "exit_time": t.get("exit_time"),
            "entry_price": t.get("entry_price"),
            "exit_price": t.get("exit_price"),
            "quantity": t.get("quantity"),
            "gross_pnl": t.get("gross_pnl"),
            "trading_costs": t.get("trading_costs"),
            "net_pnl": t.get("net_pnl"),
            "exit_reason": t.get("exit_reason"),
        })

    payload = {
        "ok": bool(result.get("success")),
        "nautilus_available": bool(getattr(orb, "_NAUTILUS_AVAILABLE", False)),
        "trades": trades,
        "totals": result.get("result") or {},
        "error": result.get("error"),
        "traceback": None,
        "leg": os.environ.get("PARITY_LEG", "?"),
    }
except BaseException:
    payload["error"] = repr(sys.exc_info()[1])
    payload["traceback"] = traceback.format_exc()

_write(payload)
'''


def _build_frame() -> pd.DataFrame:
    """Frozen 90-bar 1-minute frame; 03:45Z == 09:15 IST.

    Bars 0-44 (09:15-09:59 IST) are the opening range: high exactly 100.40, low
    exactly 99.60. Bars 45+ are post-OR. The 10:01 IST bar closes at 101.50,
    clearing 100.40 * 1.003 = 100.7012 (buffer 0.3%), so a single long entry fires.
    The 10:05 IST bar closes at 102.80, clearing +1.2% from 101.50, so it exits TP.
    Every later bar closes at 100.60: above the 100.485 stop but below the
    100.7012 re-entry threshold, keeping the expected trade list at exactly one.
    """
    index = pd.date_range("2026-01-05T03:45:00Z", periods=90, freq="1min", tz="UTC")
    rows = []
    for i in range(90):
        if i < 45:
            rows.append((100.00, 100.40, 99.60, 100.00, 1000 + i))
        elif i == 45:  # 10:00 IST - first post-OR bar, OR levels get defined here
            rows.append((100.40, 100.70, 100.35, 100.60, 5000))
        elif i == 46:  # 10:01 IST - long breakout entry at 101.50
            rows.append((100.60, 101.70, 100.55, 101.50, 6000))
        elif i == 47:  # 10:02 IST
            rows.append((101.50, 101.85, 101.45, 101.70, 5000))
        elif i == 48:  # 10:03 IST
            rows.append((101.70, 101.95, 101.65, 101.90, 5000))
        elif i == 49:  # 10:04 IST
            rows.append((101.90, 102.25, 101.85, 102.20, 5000))
        elif i == 50:  # 10:05 IST - TP exit at 102.80
            rows.append((102.20, 102.90, 102.15, 102.80, 5000))
        else:  # 10:06-10:44 IST - no re-entry, no stop-out
            rows.append((100.65, 100.68, 100.55, 100.60, 3000))
    return pd.DataFrame(
        rows,
        columns=["open", "high", "low", "close", "volume"],
        index=index,
    )


def _values_equal(left, right) -> bool:
    """Exact for ints/strings/bools, 1e-9 absolute tolerance for floats."""
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    if isinstance(left, int) and isinstance(right, int):
        return left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return abs(float(left) - float(right)) <= _NUMERIC_TOL
    return left == right


def _diff(left, right, path, diffs):
    if isinstance(left, dict) and isinstance(right, dict):
        for key in sorted(set(left) | set(right)):
            if key not in left:
                diffs.append(f"{path}.{key}: missing in nautilus leg")
            elif key not in right:
                diffs.append(f"{path}.{key}: missing in shim leg")
            else:
                _diff(left[key], right[key], f"{path}.{key}", diffs)
        return
    if isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            diffs.append(f"{path}: length nautilus={len(left)} shim={len(right)}")
            return
        for i, (a, b) in enumerate(zip(left, right)):
            _diff(a, b, f"{path}[{i}]", diffs)
        return
    if not _values_equal(left, right):
        extra = ""
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (left, right)):
            extra = f" (abs diff={abs(float(left) - float(right)):.3g}, tol={_NUMERIC_TOL:.0e})"
        diffs.append(f"{path}: nautilus={left!r} shim={right!r}{extra}")


def _diagnostics(info) -> str:
    proc = info["proc"]
    payload = info["payload"]
    return "\n".join(
        [
            f"leg={payload.get('leg')} returncode={proc.returncode}",
            f"error={payload.get('error')!r}",
            f"child traceback:\n{payload.get('traceback') or '<none>'}",
            f"stderr tail:\n{proc.stderr[-2500:]}",
            f"stdout tail:\n{proc.stdout[-800:]}",
        ]
    )


@pytest.fixture(scope="module")
def frame_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("shim_parity") / "frame.pkl"
    _build_frame().to_pickle(path)
    return str(path)


@pytest.fixture(scope="module")
def legs(frame_path, tmp_path_factory):
    """Run each leg in its own interpreter; return parsed payloads + process info."""
    workdir = tmp_path_factory.mktemp("shim_parity_legs")
    results = {}
    for leg in ("nautilus", "shim"):
        payload_path = workdir / f"{leg}.json"
        env = os.environ.copy()
        env["PARITY_FRAME_PATH"] = frame_path
        env["PARITY_PAYLOAD_PATH"] = str(payload_path)
        env["PARITY_LEG"] = leg
        env["BACKTEST_ENGINE"] = "sim" if leg == "shim" else "nautilus"
        proc = subprocess.run(
            [sys.executable, "-c", _CHILD_SCRIPT],
            env=env,
            cwd=str(_UI_DIR),
            capture_output=True,
            text=True,
            timeout=20,
        )
        if payload_path.exists():
            payload = json.loads(payload_path.read_text(encoding="utf-8"))
        else:
            payload = {
                "ok": False,
                "nautilus_available": False,
                "trades": [],
                "totals": {},
                "error": f"child wrote no payload (returncode={proc.returncode})",
                "traceback": None,
                "leg": leg,
            }
        results[leg] = {"payload": payload, "proc": proc}
    return results


def test_frozen_frame_is_byte_identical():
    first = _build_frame()
    second = _build_frame()
    pd.testing.assert_frame_equal(first, second)
    assert len(first) == 90
    assert first.index[0] == pd.Timestamp("2026-01-05T03:45:00Z")
    assert first.index[-1] == pd.Timestamp("2026-01-05T05:14:00Z")


def test_shim_leg_invariants(legs):
    """Shim must run standalone, report real nautilus compatibility, and trade."""
    info = legs["shim"]
    payload = info["payload"]
    assert payload["ok"], f"shim leg failed:\n{_diagnostics(info)}"
    assert payload["nautilus_available"] is True, (
        f"shim leg reported nautilus_available=False (strategies would no-op):\n{_diagnostics(info)}"
    )
    trades = payload["trades"]
    assert len(trades) >= 1, f"shim leg produced no trades - empty-vs-empty is a FAIL:\n{_diagnostics(info)}"
    assert len(trades) == 1, f"frozen scenario expects exactly one trade, got {len(trades)}: {trades}"

    trade = trades[0]
    assert trade["exit_reason"] == "TP", f"expected TP exit, got {trade}"
    assert trade["symbol"] == "SYNTH"
    assert trade["date"] == "2026-01-05"
    assert _values_equal(trade["entry_price"], 101.50), trade
    assert _values_equal(trade["exit_price"], 102.80), trade
    assert trade["quantity"] == 100, trade
    assert _values_equal(trade["gross_pnl"], 130.0), trade
    assert _values_equal(trade["trading_costs"], 10.85), trade

    # Timezone-semantics guard: a shifted clock is the silent break this catches.
    entry = datetime.fromisoformat(trade["entry_time"])
    exit_ = datetime.fromisoformat(trade["exit_time"])
    assert entry.date().isoformat() == "2026-01-05", trade
    assert dtime(9, 15) <= entry.time() <= dtime(15, 30), (
        f"entry_time {trade['entry_time']} outside 09:15-15:30 IST session"
    )
    assert dtime(10, 0) < entry.time() < dtime(15, 0), (
        f"entry_time {trade['entry_time']} not strictly inside the post-OR window"
    )
    assert exit_ > entry, trade
    assert payload["totals"].get("trades") == 1, payload["totals"]


def _real_nautilus_unavailable(info) -> bool:
    payload = info["payload"]
    if payload.get("nautilus_available"):
        return False
    text = f"{payload.get('error') or ''}\n{payload.get('traceback') or ''}".lower()
    return "nautilus" in text and (
        "not available" in text
        or "not installed" in text
        or "no module named" in text
        or "importerror" in text
    )


def test_parity_against_real_nautilus(legs):
    """Same bars, same params: shim trades must equal nautilus trades field-by-field."""
    if not _nautilus_installed():
        pytest.skip("real nautilus not installed; parity baseline unavailable")
    real_info = legs["nautilus"]
    real = real_info["payload"]
    if _real_nautilus_unavailable(real_info):
        pytest.skip("real nautilus not installed; parity baseline unavailable")

    assert real["ok"], f"nautilus baseline leg failed:\n{_diagnostics(real_info)}"
    assert real["nautilus_available"] is True, (
        f"nautilus baseline did not report nautilus_available=True:\n{_diagnostics(real_info)}"
    )
    assert len(real["trades"]) >= 1, (
        f"nautilus baseline produced no trades - cannot prove parity:\n{_diagnostics(real_info)}"
    )

    shim_info = legs["shim"]
    shim = shim_info["payload"]
    assert shim["ok"], f"shim leg failed:\n{_diagnostics(shim_info)}"
    assert shim["nautilus_available"] is True, f"shim leg nautilus_available=False:\n{_diagnostics(shim_info)}"
    assert len(shim["trades"]) >= 1, f"shim leg produced no trades:\n{_diagnostics(shim_info)}"

    diffs = []
    _diff(real["trades"], shim["trades"], "trades", diffs)
    _diff(real["totals"], shim["totals"], "totals", diffs)
    assert not diffs, "shim != nautilus (field-by-field diff):\n" + "\n".join(diffs)
