import sys, os, time, logging, pandas as pd, numpy as np
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

sys.path.insert(0, os.getcwd())
logging.disable(logging.CRITICAL)
np.random.seed(42)

def generate_breakout_data(symbol, days=30, timeframe_minutes=5):
    ist_open = datetime(2024, 1, 2, 9, 15)
    utc_open = ist_open - timedelta(hours=5, minutes=30)
    bars_per_day = int((15 * 60 + 30) / timeframe_minutes)
    dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
    for day in range(days):
        current_ist = ist_open + timedelta(days=day)
        if current_ist.weekday() >= 5: continue
        current_utc = utc_open + timedelta(days=day)
        or_high = np.random.uniform(100, 200)
        or_low = or_high - np.random.uniform(2, 5)
        mid = (or_high + or_low) / 2
        price = mid
        for bar_idx in range(bars_per_day):
            bar_time = current_utc + timedelta(minutes=bar_idx * timeframe_minutes)
            ist_total = 9 * 60 + 15 + bar_idx * timeframe_minutes
            or_end = 9 * 60 + 15 + 45
            if ist_total < or_end:
                o = mid + np.random.normal(0, 0.2)
                c = mid + np.random.normal(0, 0.2)
                h = max(o, or_high) if bar_idx == bars_per_day // 2 else o + abs(np.random.normal(0, 0.3))
                l = min(o, or_low) if bar_idx == bars_per_day // 2 else o - abs(np.random.normal(0, 0.3))
            elif ist_total < 14 * 60 + 45:
                if np.random.random() < 0.15: price = or_high + np.random.uniform(0.1, 1.5)
                else: price += np.random.normal(0, 0.3)
                o = price
                spread = abs(np.random.normal(0, 0.3))
                h = o + spread; l = o - spread; c = o + np.random.normal(0, 0.2)
            else:
                o = price; c = o + np.random.normal(0, 0.1)
                spread = abs(np.random.normal(0, 0.1))
                h = max(o, c) + spread; l = min(o, c) - spread
            h = max(h, o, c); l = min(l, o, c)
            dates.append(bar_time); opens.append(round(float(o), 2)); highs.append(round(float(h), 2))
            lows.append(round(float(l), 2)); closes.append(round(float(c), 2)); volumes.append(float(np.random.randint(1000, 50000)))
    return pd.DataFrame({'open': np.array(opens, dtype=np.float64), 'high': np.array(highs, dtype=np.float64),
        'low': np.array(lows, dtype=np.float64), 'close': np.array(closes, dtype=np.float64),
        'volume': np.array(volumes, dtype=np.float64)}, index=pd.DatetimeIndex(dates, name='datetime'))

SYMBOLS = [f'STOCK_{chr(65+i)}' for i in range(5)]
mock_api = MagicMock()
mock_data_cache = {sym: generate_breakout_data(sym, 30, 5) for sym in SYMBOLS}
mock_api.fetch_historical_data_v3 = lambda symbol, **kw: mock_data_cache[symbol]
mock_api.fetch_intraday_data_v3 = lambda symbol, **kw: pd.DataFrame()
import backtest.utils, db.models
backtest.utils.get_upstox_client_from_db = lambda quiet=True: (mock_api, None)
backtest.utils.get_upstox_client_with_token = lambda token, quiet=True: (mock_api, None)
db.models.get_shared_broker_token = lambda broker: None

from nautilus_trader.backtest.config import BacktestEngineConfig
from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.model import BarType, InstrumentId, Money, Symbol, TraderId, Venue
from nautilus_trader.model.currencies import INR
from nautilus_trader.model.enums import AccountType, OmsType
from nautilus_trader.model.instruments import Equity
from nautilus_trader.model.objects import Price, Quantity
from nautilus_trader.persistence.wranglers import BarDataWrangler

from backtest.strategies.orb import ORBNautilusStrategy, ORBConfig

phase_times = {'instrument': [], 'wrangle': [], 'engine_init': [], 'engine_run': [], 'engine_dispose': []}

for sym in SYMBOLS:
    venue = Venue("SIMULATED")
    instrument_id = InstrumentId.from_str(f"{sym}.{venue}")

    t0 = time.perf_counter()
    instrument = Equity(
        instrument_id=instrument_id, raw_symbol=Symbol(sym), currency=INR,
        price_precision=2, price_increment=Price.from_str("0.01"),
        lot_size=Quantity.from_str("1"), ts_event=0, ts_init=0, isin=None,
    )
    t1 = time.perf_counter()
    phase_times['instrument'].append(t1 - t0)

    df = mock_api.fetch_historical_data_v3(symbol=sym, unit="minutes", interval=5, to_date="2024-03-01", from_date="2023-11-01")
    df_copy = df[['open', 'high', 'low', 'close', 'volume']].copy()
    if df_copy.index.tz is None: df_copy.index = df_copy.index.tz_localize('UTC')

    t2 = time.perf_counter()
    bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
    bars = wrangler.process(df_copy)
    t3 = time.perf_counter()
    phase_times['wrangle'].append(t3 - t2)

    config = ORBConfig(instrument_id=instrument_id, bar_type=bar_type, or_minutes=45,
        sl_pct=0.4, tp_pct=1.2, trade_size=100, enable_shorts=False, cooldown_bars=3)

    t4 = time.perf_counter()
    engine = BacktestEngine(config=BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001")))
    engine.add_venue(venue=venue, oms_type=OmsType.NETTING, account_type=AccountType.CASH, base_currency=INR, starting_balances=[Money(1_000_000, INR)])
    engine.add_instrument(instrument)
    engine.add_data(bars)
    strategy = ORBNautilusStrategy(config=config)
    engine.add_strategy(strategy=strategy)
    t5 = time.perf_counter()
    phase_times['engine_init'].append(t5 - t4)

    engine.run()
    t6 = time.perf_counter()
    phase_times['engine_run'].append(t6 - t5)

    trades = strategy.trades
    engine.dispose()
    t7 = time.perf_counter()
    phase_times['engine_dispose'].append(t7 - t6)

print("PHASE BREAKDOWN (per stock, avg of 5)")
total_all = 0
for phase, times in phase_times.items():
    avg = np.mean(times)
    total_all += avg
    print(f"  {phase:20s}: {avg*1000:8.2f}ms")
print(f"  {'TOTAL':20s}: {total_all*1000:8.2f}ms")
print(f"  5 stocks total = {total_all*5*1000:.2f}ms = {total_all*5:.3f}s")
