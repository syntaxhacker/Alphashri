"""Deterministic read-path harness for screener_scan.py (52W screener).

Modes:
  capture  - write baseline rows + request counts to the artifact dir
  verify   - compare current rows/counts with the captured baseline
  bench    - one process: 5 warmups + 50 timed reps, emits JSON on stdout
  bench3   - three fresh ``bench`` subprocesses, best-of-run median/p95

The fixture has five candidates: touched today, touched 6 days ago, touched
30 days ago, never touched, and a row whose live price is missing. No network,
no Redis and no database are used; every read is counted at its call site.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
for path in (ROOT, ROOT.parent, ROOT.parent / 'scanners'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import config
from api.screener_api import screener_scan as scan

SCREENER = 'touched_52w_high'
BASE = datetime.now(config.IST).replace(hour=0, minute=0, second=0, microsecond=0)
REF_HIGH = 1000.0
PLATEAU = 970.0

# symbol -> (daily end offset in days, day offset of the 1000 high or None,
#            live/upstox price, TV row close)
SPECS = {
    'TOUCHEDTODAY': (0, 0, 999.5, 999.5),
    'TOUCH6': (1, 6, 980.0, 980.0),
    'TOUCH30': (1, 30, 970.0, 970.0),
    'NEVER': (1, None, 900.0, 900.0),
    'MISSING': (1, None, 0.0, 1.0),
}


def artifact_dir() -> Path:
    raw = os.environ.get('SCREENER_PERF_ARTIFACT_DIR')
    if raw:
        return Path(raw)
    if os.environ.get('CODESPACES') == 'true':
        return Path('/workspaces/test-rag/.agent-artifacts/perf-screener-52w')
    return Path('/tmp/opencode/perf-screener-52w')


def daily_frame(symbol: str) -> pd.DataFrame:
    end, touch_day, _, _ = SPECS[symbol]
    n = 90
    offsets = [end + n - 1 - i for i in range(n)]
    highs = [PLATEAU] * n
    if touch_day is not None:
        highs[offsets.index(touch_day)] = REF_HIGH
    idx = [BASE - timedelta(days=d) for d in offsets]
    return pd.DataFrame(
        {'high': highs, 'low': [h * 0.98 for h in highs], 'close': [h * 0.99 for h in highs]},
        index=pd.DatetimeIndex(idx),
    )


def minute_frame(price: float) -> pd.DataFrame:
    n = 20
    return pd.DataFrame({
        'open': [price] * n,
        'high': [price + 1] * n,
        'low': [price - 1] * n,
        'close': [price] * n,
        'volume': [100000] * n,
    })


DAILY = {sym: daily_frame(sym) for sym in SPECS}
MINUTE = {sym: minute_frame(spec[2]) for sym, spec in SPECS.items()}
TV_ROWS = [
    {
        'name': sym, 'close': spec[3], 'change': 1.0,
        'price_52_week_high': REF_HIGH, 'ADX': 25.0, 'ATR': 10.0,
        'Perf.W': 1.0, 'RSI': 60.0, 'Stoch.K': 60.0, 'gap': 0.0,
        'premarket_change': 0.0, 'impact_score': 5.0,
        'market_cap_basic': 1_000_000_000_000, 'volume': 5_000_000,
        'sector': 'Tech', 'reversal_signal': 'BULLISH',
    }
    for sym, spec in SPECS.items()
]
TV_DF = pd.DataFrame(TV_ROWS)
BULK = {
    sym: {'high': REF_HIGH, 'low': 900.0, 'close': spec[2]}
    for sym, spec in SPECS.items()
}


class FakeAPI:
    def get_instrument_key(self, symbol):
        return f'NSE_EQ|{symbol}'

    def fetch_historical_data_v3(self, symbol, unit='minutes', **kwargs):
        return DAILY[symbol] if unit == 'days' else MINUTE[symbol]

    def fetch_intraday_data_v3(self, symbol, **kwargs):
        return MINUTE[symbol]


def _enrich_db():
    """Fake SessionLocal returning deterministic touch-history rows."""
    db = MagicMock()
    recent = MagicMock()
    max_dates = MagicMock()
    latest = MagicMock()
    rows = [
        ('recent', 'TOUCH6', BASE - timedelta(days=2), 997.0),
        ('latest', 'NEVER', BASE - timedelta(days=40), 910.0),
    ]
    recent.filter.return_value.union_all.return_value.all.return_value = rows
    max_dates.filter.return_value.group_by.return_value.subquery.return_value = MagicMock()
    latest.join.return_value = latest
    db.query.side_effect = [recent, max_dates, latest]
    return db


def run_once(counters: dict | None = None) -> dict:
    """One full API read: screener scan + touch-history enrichment."""
    from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

    def counted(key, fn):
        if counters is None:
            return fn

        def wrapper(*args, **kwargs):
            counters[key] = counters.get(key, 0) + 1
            return fn(*args, **kwargs)

        return wrapper

    real_fetch = scan._fetch_90d_daily
    import trading.week52.ranges as ranges
    import cache.redis_client as redis_client
    import trending_upside

    real_load, real_get, real_cache = (
        ranges.load_all_52w_ranges, ranges.get_52w_range, redis_client.cache_get,
    )

    def bulk_cache_get(key):
        return BULK if key == '52w_range:all' else None

    with patch.object(scan, '_fetch_90d_daily', counted('fetch_90d_daily', real_fetch)), \
         patch.object(ranges, 'load_all_52w_ranges', counted('load_all_52w_ranges', real_load)), \
         patch.object(ranges, 'get_52w_range', counted('get_52w_range', real_get)), \
         patch.object(redis_client, 'cache_get', counted('cache_get_bulk', bulk_cache_get)), \
         patch.object(trending_upside, 'fetch_trending_stocks', return_value=TV_DF), \
         patch.object(TradingAPIFactory, 'create_from_config', return_value=FakeAPI()), \
         patch.object(scan, 'SessionLocal', _enrich_db):
        data = scan.fetch_screener_data(provider='upstox', mode='intraday', screener=SCREENER)
        scan._enrich_with_touch_history(data, SCREENER)
    return data


def row_view(data: dict) -> dict:
    """Drop the wall clock; canonically order rows (as_completed is racy)."""
    by_symbol = lambda rows: sorted(rows, key=lambda row: row['symbol'])
    return {
        'approaching': by_symbol(data['approaching']),
        'touched': by_symbol(data['touched']),
        'summary': data['summary'],
        'profile_meta': data['profile_meta'],
        'warning': data['warning'],
        'provider': data['provider'],
        'mode': data['mode'],
        'screener': data['screener'],
    }


def do_capture() -> None:
    counters = {}
    rows = row_view(run_once(counters))
    payload = {
        'rows': rows,
        'counts': counters,
        'fixture': {'symbols': list(SPECS), 'bulk_symbols': sorted(BULK)},
    }
    out = artifact_dir() / 'baseline.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding='utf-8')
    print(json.dumps({'baseline': str(out), 'counts': counters,
                      'rows': {k: len(v) if isinstance(v, list) else v
                               for k, v in rows.items()}}, indent=2))


def do_verify() -> None:
    baseline = json.loads((artifact_dir() / 'baseline.json').read_text(encoding='utf-8'))
    counters = {}
    current = row_view(run_once(counters))
    ok = current == baseline['rows']
    print(json.dumps({
        'parity': 'PASS' if ok else 'FAIL',
        'counts_before': baseline['counts'],
        'counts_after': counters,
        'row_counts': {k: len(v) for k, v in current.items() if isinstance(v, list)},
    }, indent=2))
    if not ok:
        print('BASELINE ROWS:', json.dumps(baseline['rows'], indent=2, sort_keys=True))
        print('CURRENT ROWS:', json.dumps(current, indent=2, sort_keys=True))
        raise SystemExit(1)


def do_bench() -> None:
    for _ in range(5):
        run_once()
    samples = []
    for _ in range(50):
        t0 = time.perf_counter()
        run_once()
        samples.append((time.perf_counter() - t0) * 1000)
    samples.sort()
    print(json.dumps({
        'median_ms': statistics.median(samples),
        'p95_ms': samples[int(0.95 * (len(samples) - 1))],
        'min_ms': samples[0],
        'max_ms': samples[-1],
    }))


def do_bench3() -> None:
    runs = []
    for _ in range(3):
        out = subprocess.check_output(
            [sys.executable, str(Path(__file__).resolve()), '--mode', 'bench'],
            text=True, env=os.environ.copy(),
        )
        runs.append(json.loads(out.strip().splitlines()[-1]))
    best = min(runs, key=lambda r: r['median_ms'])
    print(json.dumps({
        'runs': runs,
        'best_of_3_median_ms': best['median_ms'],
        'best_of_3_p95_ms': best['p95_ms'],
        'load_avg': Path('/proc/loadavg').read_text().strip(),
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('capture', 'verify', 'bench', 'bench3'), required=True)
    args = parser.parse_args()
    {'capture': do_capture, 'verify': do_verify,
     'bench': do_bench, 'bench3': do_bench3}[args.mode]()


if __name__ == '__main__':
    main()
