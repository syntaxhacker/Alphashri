"""Deterministic parity / call-count / wall-clock harness for 52W screener metadata.

Three modes:

  --capture FILE   run the deterministic fixture and write a normalized response
  --compare FILE   re-run and assert byte-for-byte equality with a captured file
  --count          print exact _build_rationale / _summary_items_for /
                   _profile_meta call counts (full path + empty path)
  --bench         5 warmups + 50 reps x 3 fresh processes, median / p95

All network/DB access is replaced with deterministic in-process stubs, so the
numbers are contention-sensitive but the *response* is fully reproducible.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import types
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

if 'tradingview_screener' not in sys.modules:
    _stub = types.ModuleType('tradingview_screener')
    _stub.Query = object
    _stub.Column = object
    sys.modules['tradingview_screener'] = _stub

from api.screener_api import screener_52w as m  # noqa: E402

PROFILE_FILTERS = {
    'max_52w_gap': 15,
    'min_volume_m': 1.0,
    'min_turnover_cr': 10.0,
}
COUNTED = ('_build_rationale', '_summary_items_for', '_profile_meta')


def _fixture_ranges() -> dict:
    """Mixed sectors/markets, rows that pass and fail each filter, stale/ETF/price drops."""
    r: dict[str, dict] = {}
    # Candidates that survive every gate (20 approaching + 5 touched).
    for i in range(20):
        high = 1000.0 + i
        r[f'PASS{i:02d}'] = {'high': high, 'low': high * 0.7, 'close': high - (3.0 + i * 0.2)}
    for i in range(5):
        high = 2000.0 + i
        r[f'TOUCH{i:02d}'] = {'high': high, 'low': high * 0.8, 'close': high - 0.15}
    # Dropped by the volume gate (pass candidate build, fail profile min_volume_m).
    for i in range(40):
        high = 500.0 + i
        r[f'LOWVOL{i:02d}'] = {'high': high, 'low': high * 0.6, 'close': high - 4.0}
    # Dropped by the turnover gate (pass volume, fail min_turnover_cr).
    for i in range(20):
        high = 300.0 + i
        r[f'LOWTURN{i:02d}'] = {'high': high, 'low': high * 0.5, 'close': high - 5.0}
    # Dropped at candidate build: ETF, too expensive, stale-high, gap > max_gap.
    r['LIQUIDBEES'] = {'high': 1030.0, 'low': 990.0, 'close': 1000.0}
    r['HIGHPRICE'] = {'high': 9000.0, 'low': 8000.0, 'close': 8990.0}
    r['STALE'] = {'high': 800.0, 'low': 700.0, 'close': 1000.0}
    r['FARGAP'] = {'high': 1200.0, 'low': 900.0, 'close': 1000.0}
    return r


def _tv_enrich(stocks: list[dict]) -> None:
    """Sector/market mix is encoded by symbol prefix; volumes drive the profile gate."""
    sectors = ('Technology', 'Finance', 'Healthcare', 'Energy')
    for idx, s in enumerate(stocks):
        sym = s['symbol']
        s['sector'] = sectors[idx % len(sectors)]
        s['market_cap_b'] = round(10.0 + idx, 2)
        s['rsi'] = float(40 + idx % 40)
        s['adx'] = float(20 + idx % 25)
        s['day_change'] = float((idx % 7) - 3)
        s['volume_surge'] = float(1 + idx % 3)
        if sym.startswith('LOWVOL'):
            s['volume_m'], s['turnover_cr'] = 0.1, 1.0
        elif sym.startswith('LOWTURN'):
            s['volume_m'], s['turnover_cr'] = 5.0, 1.0
        else:
            s['volume_m'], s['turnover_cr'] = 5.0, 50.0


def _run_once(stack: ExitStack, ranges: dict | None, profile_filters: dict | None):
    """Patch external IO and call fetch_52w_high_data once; return (response, counts)."""
    if ranges is None:
        ranges = _fixture_ranges()
    counts = {name: 0 for name in COUNTED}
    originals = {name: getattr(m, name) for name in COUNTED}

    def counter(name):
        def wrapped(*a, **kw):
            counts[name] += 1
            return originals[name](*a, **kw)
        return wrapped

    stack.enter_context(patch.object(m, 'load_all_52w_ranges', lambda: ranges))
    stack.enter_context(patch.object(m, '_create_upstox_api', lambda provider: (None, False)))
    stack.enter_context(patch.object(m, '_load_range_price_as_of', lambda symbols, ranges=None: {}))
    stack.enter_context(patch.object(m, '_enrich_with_tv_scanner_data', _tv_enrich))
    stack.enter_context(patch.object(m, '_enrich_with_touch_history', lambda data, screener: None))
    for name in COUNTED:
        stack.enter_context(patch.object(m, name, counter(name)))

    data = m.fetch_52w_high_data(
        provider='other', mode='historical', profile_filters=profile_filters
    )
    return data, counts


def _normalize(data: dict) -> dict:
    # Preserve insertion order: field order is part of the parity contract.
    out = json.loads(json.dumps(data, default=str))
    out['last_updated'] = '<AS_OF>'
    return out


def _response(ranges=None, profile_filters=None) -> dict:
    with ExitStack() as stack:
        data, _ = _run_once(stack, ranges, profile_filters)
    return _normalize(data)


def _serializable(ranges=None, profile_filters=None) -> str:
    return json.dumps(_response(ranges, profile_filters), indent=2)


def cmd_capture(path: Path) -> None:
    payload = {
        'mixed': _serializable(_fixture_ranges(), PROFILE_FILTERS),
        'empty': _serializable({}, PROFILE_FILTERS),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n')
    print(f'captured baseline -> {path}')


def cmd_compare(path: Path) -> None:
    baseline = json.loads(path.read_text())
    failures = []
    for case, expected in baseline.items():
        kwargs = {} if case == 'mixed' else {'ranges': {}}
        actual = _serializable(**kwargs, profile_filters=PROFILE_FILTERS)
        if actual != expected:
            failures.append(case)
        else:
            exp = json.loads(expected)
            rows = exp['approaching'] + exp['touched']
            print(f'  {case}: EXACT MATCH ({len(rows)} rows, summary={exp["summary"]})')
    if failures:
        print('PARITY FAIL: ' + ', '.join(failures))
        sys.exit(1)
    print('PARITY PASS: all fields, ordering, counts and summary identical')


def cmd_count() -> None:
    for case, ranges in (('mixed', _fixture_ranges()), ('empty', {})):
        with ExitStack() as stack:
            data, counts = _run_once(stack, ranges, PROFILE_FILTERS)
        rows = data['approaching'] + data['touched']
        candidates = len(_fixture_ranges()) if case == 'mixed' else 0
        print(
            f'  full/{case}: candidates={candidates} returned_rows={len(rows)} '
            + ' '.join(f'{k}={counts[k]}' for k in COUNTED)
        )
    # Cold-start skeleton: no profile gate, so every candidate is returned.
    ranges = _fixture_ranges()
    counts = {name: 0 for name in COUNTED}
    originals = {name: getattr(m, name) for name in COUNTED}

    def counter(name):
        def wrapped(*a, **kw):
            counts[name] += 1
            return originals[name](*a, **kw)
        return wrapped

    with ExitStack() as stack:
        stack.enter_context(patch.object(m, 'load_all_52w_ranges', lambda: ranges))
        stack.enter_context(patch.object(m, '_load_range_price_as_of', lambda symbols, ranges=None: {}))
        stack.enter_context(patch.object(m, '_enrich_with_touch_history', lambda data, screener: None))
        for name in COUNTED:
            stack.enter_context(patch.object(m, name, counter(name)))
        data = m.build_52w_skeleton_data(profile_filters=PROFILE_FILTERS)
    rows = data['approaching'] + data['touched']
    print(
        f'  skeleton/mixed: candidates={len(ranges)} returned_rows={len(rows)} '
        + ' '.join(f'{k}={counts[k]}' for k in COUNTED)
    )


def _one_measurement() -> tuple[float, float]:
    reps = []
    for _ in range(5):  # warmups
        _response(_fixture_ranges(), PROFILE_FILTERS)
    for _ in range(50):
        t0 = time.perf_counter()
        _response(_fixture_ranges(), PROFILE_FILTERS)
        reps.append((time.perf_counter() - t0) * 1000.0)
    s = sorted(reps)
    return statistics.median(s), s[int(0.95 * (len(s) - 1))]


def cmd_bench() -> None:
    median, p95 = _one_measurement()
    print(f'  run: 5 warmups + 50 reps -> median={median:.3f} ms  p95={p95:.3f} ms')


def cmd_live_ltp() -> None:
    """Prove deferred rationale still uses the candidate-stage gap after LTP refresh."""
    ranges = _fixture_ranges()
    # What the pre-change code produced: rationale from the candidate-stage row.
    with ExitStack() as stack:
        stack.enter_context(patch.object(m, '_load_range_price_as_of', lambda symbols, ranges=None: {}))
        candidates = m._build_52w_candidates(
            ranges, m.touched_52w_gap_threshold_pct(), 15, '52w_high', None,
            price_as_of={},
        )
    original = {
        s['symbol']: m._build_rationale('52w_high', s) for s in candidates
    }
    candidate_gap = {s['symbol']: s['to_52w_high'] for s in candidates}

    class _Broker:
        _IS_BROKER_BACKED = True

        def get_instrument_key(self, symbol):
            return f'NSE_EQ|{symbol}'

    def _fake_ltp(stocks, api, top_n, touched_gap_pct):
        for s in stocks[:top_n]:  # refresh every candidate: worst case for gap drift
            s['upstox_price'] = round(s['upstox_price'] + 1.0, 2)
            s['ltp_fresh'] = True
            s.pop('price_as_of', None)
            m._sync_stock_metrics(s, touched_gap_pct)

    with ExitStack() as stack:
        stack.enter_context(patch.object(m, 'load_all_52w_ranges', lambda: ranges))
        stack.enter_context(patch.object(m, '_create_upstox_api', lambda provider: (_Broker(), True)))
        stack.enter_context(patch.object(m, '_load_range_price_as_of', lambda symbols, ranges=None: {}))
        stack.enter_context(patch.object(m, '_enrich_with_tv_scanner_data', _tv_enrich))
        stack.enter_context(patch.object(m, '_enrich_with_touch_history', lambda data, screener: None))
        stack.enter_context(patch.object(m, '_enrich_top_with_ltp', _fake_ltp))
        stack.enter_context(patch.object(m, '_fetch_90d_daily', lambda api, symbol: None))
        stack.enter_context(patch.object(m, 'enrich_top_n', lambda: len(ranges)))
        data = m.fetch_52w_high_data(
            provider='upstox', mode='historical', profile_filters=PROFILE_FILTERS
        )
    rows = data['approaching'] + data['touched']
    changed = [s for s in rows if s['symbol'] in original]
    mismatches = [s['symbol'] for s in changed if s['rationale'] != original[s['symbol']]]
    drifted = sum(
        1 for s in changed
        if candidate_gap[s['symbol']] != s['to_52w_high']
    )
    print(
        f'  live-LTP rows returned={len(rows)} checked={len(changed)} '
        f'gaps_drifted={drifted} mismatches={len(mismatches)}'
    )
    if drifted == 0:
        print('  RATIONALE PARITY INCONCLUSIVE: LTP refresh did not move any gap')
        sys.exit(1)
    if mismatches:
        print('  RATIONALE PARITY FAIL: ' + ', '.join(mismatches[:10]))
        sys.exit(1)
    print('  RATIONALE PARITY PASS: rationale matches the pre-change (candidate-stage) string')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--capture', type=Path)
    ap.add_argument('--compare', type=Path)
    ap.add_argument('--count', action='store_true')
    ap.add_argument('--live-ltp', action='store_true')
    ap.add_argument('--bench', action='store_true')
    args = ap.parse_args()
    if args.capture:
        cmd_capture(args.capture)
    if args.compare:
        cmd_compare(args.compare)
    if args.count:
        cmd_count()
    if args.live_ltp:
        cmd_live_ltp()
    if args.bench:
        cmd_bench()


if __name__ == '__main__':
    main()
