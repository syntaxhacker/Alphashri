"""Deterministic parity + contention-robust counters for theme aggregation.

Modes:
  parity  - JSON of _aggregate_theme_groups for the combined edge-case fixture
  count   - isin passes / sub-DataFrame allocations for 20 themes x 3000 rows
  time    - 5 warmups + 20 reps, median/p95 in ms (version-agnostic)

Run with the task venv python; no DB, no network, no env dependencies.
"""

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api import sector as sector_module  # noqa: E402

PERF_COLS = ['Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.YTD', 'Perf.Y']


def _frame(names, changes, weights):
    n = len(names)
    data = {
        'name': names,
        'sector': ['Ind'] * n,
        'industry': ['Def'] * n,
        'change': changes,
        'market_cap_basic': weights,
    }
    data.update({c: [0.0] * n for c in PERF_COLS})
    return pd.DataFrame(data)


def parity_fixture():
    """Shared member, NaN weight, uncovered symbol, empty theme, ties, dup row."""
    df = _frame(
        ['SHARED', 'A', 'B', 'C', 'D', 'NANW', 'TIE1', 'TIE2', 'UNC', 'SHARED'],
        [4.0, 2.0, -1.0, 1.0, 3.0, 5.0, 2.5, 2.5, 99.0, -50.0],
        [300.0, 100.0, 200.0, 200.0, 200.0, None, 100.0, 100.0, 9999.0, 1.0],
    )
    mapping = {
        't_shared1': {' shared ', 'A'},   # normalised member + shared constituent
        't_shared2': {'SHARED', 'C', 'D'},
        't_nanw': {'NANW'},               # NaN weight, positive change
        't_tie1': {'TIE1'},
        't_tie2': {'TIE2'},               # exact tie with t_tie1
        't_uncovered': {'MISSING'},
        't_empty': set(),
    }
    info = {slug: {'name': f'Name {slug}'} for slug in mapping}
    return df, mapping, info


def count_fixture(n_themes=20, n_rows=3000):
    names = [f'S{i:04d}' for i in range(n_rows)]
    changes = [(i % 101) / 10.0 - 5.0 for i in range(n_rows)]
    weights = [None if i % 97 == 0 else 100.0 + (i % 7) * 10.0 for i in range(n_rows)]
    df = _frame(names, changes, weights)
    mapping = {}
    for k in range(n_themes):
        members = {f'S{i:04d}' for i in range(n_rows) if i % n_themes == k}
        # deliberate overlap: every 5th row belongs to 5 themes
        members |= {f'S{i:04d}' for i in range(n_rows) if i % 5 == 0}
        mapping[f't{k:02d}'] = members
    info = {slug: {'name': f'Theme {slug}'} for slug in mapping}
    return df, mapping, info


def _aggregate(df, mapping, info):
    return sector_module._aggregate_theme_groups(df, 'change', mapping, info)


def _items_to_json(items):
    # Pydantic preserves model field order: name, change, stock_count,
    # advances, declines, slug.
    return [i.model_dump() for i in items]


def run_parity():
    df, mapping, info = parity_fixture()
    print(json.dumps(_items_to_json(_aggregate(df, mapping, info)), indent=2))


def run_count():
    df, mapping, info = count_fixture()
    counters = {'isin': 0, 'sub_frame': 0}

    orig_isin = pd.Series.isin
    orig_getitem = pd.DataFrame.__getitem__

    def counted_isin(self, values):
        counters['isin'] += 1
        return orig_isin(self, values)

    def counted_getitem(self, key):
        if isinstance(key, pd.Series) and key.dtype == bool:
            counters['sub_frame'] += 1
        return orig_getitem(self, key)

    pd.Series.isin = counted_isin
    pd.DataFrame.__getitem__ = counted_getitem
    try:
        items = _aggregate(df, mapping, info)
    finally:
        pd.Series.isin = orig_isin
        pd.DataFrame.__getitem__ = orig_getitem

    print(json.dumps({
        'themes': len(mapping),
        'rows': len(df),
        'isin_passes': counters['isin'],
        'sub_dataframe_allocations': counters['sub_frame'],
        'items': len(items),
    }, indent=2))


def run_time(warmups=5, reps=20):
    df, mapping, info = count_fixture()
    for _ in range(warmups):
        _aggregate(df, mapping, info)
    samples = []
    for _ in range(reps):
        t0 = time.perf_counter()
        _aggregate(df, mapping, info)
        samples.append((time.perf_counter() - t0) * 1000.0)
    samples.sort()
    p95_index = min(len(samples) - 1, int(0.95 * len(samples)))
    print(json.dumps({
        'rows': len(df),
        'themes': len(mapping),
        'warmups': warmups,
        'reps': reps,
        'median_ms': round(statistics.median(samples), 4),
        'p95_ms': round(samples[p95_index], 4),
        'min_ms': round(samples[0], 4),
    }))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('mode', choices=['parity', 'count', 'time'])
    args = p.parse_args()
    {'parity': run_parity, 'count': run_count, 'time': run_time}[args.mode]()
