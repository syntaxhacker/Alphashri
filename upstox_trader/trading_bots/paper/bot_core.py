import time
import logging
import os
import argparse
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
from screeners.tv_display_utils import Colors, strip_ansi_codes
from screeners.utils.tv_logging_utils import log_colored, save_daily_summary
from screeners.core.technical_analysis import (
    identify_support_resistance_levels,
    group_levels,
    filter_by_touches,
    calculate_trend_direction,
    find_nearest_levels,
    check_support_resistance_signals,
    display_support_resistance_levels,
)

from .bot_signals import SignalMixin
from .bot_execution import ExecutionMixin
from .bot_monitor import MonitorMixin
from .bot_telegram import TelegramMixin

try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
    import os
    if not os.getenv('UPSTOX_QUIET_MODE', False):
        print("✅ Official Upstox SDK available for real-time data")
except ImportError:
    UPSTOX_SDK_AVAILABLE = False
    import os
    if not os.getenv('UPSTOX_QUIET_MODE', False):
        print("⚠️  Official Upstox SDK not found. Install with: pip install upstox-python-sdk")
        print("📉 Will use historical data only (expect 0% P&L updates)")


console_log_formatter = logging.Formatter('%(message)s')
console_logger = logging.getLogger('upstox_console_logger')
console_logger.setLevel(logging.INFO)

paper_trade_logger = logging.getLogger('upstox_paper_trade_logger')
paper_trade_logger.setLevel(logging.INFO)


class UpstoxPaperTradingBot(SignalMixin, ExecutionMixin, MonitorMixin, TelegramMixin):
    """Paper Trading Support & Resistance Bot for Upstox with REAL-TIME WebSocket data"""

    def __init__(self, api_key, api_secret, symbols=["TATAMOTORS"], timeframe="15min"):
        self.client = UpstoxAPI(api_key=api_key, api_secret=api_secret)
        self.trading_symbols = symbols if isinstance(symbols, list) else [symbols]
        self.timeframe = timeframe

        self.websocket_enabled = UPSTOX_SDK_AVAILABLE
        self.market_streamer = None
        self.instrument_keys = {}
        self.real_time_prices = {}
        self.price_update_counts = {}
        self.last_websocket_update = 0

        self.last_logged_prices = {}
        self.last_logged_pnl_percents = {}
        self.last_logged_update_counts = {}

        for symbol in self.trading_symbols:
            self.real_time_prices[symbol] = 0.0
            self.price_update_counts[symbol] = 0
            self.last_logged_prices[symbol] = 0.0
            self.last_logged_pnl_percents[symbol] = None
            self.last_logged_update_counts[symbol] = 0

        self.lookback_periods = 50
        self.min_touches = 2
        self.level_threshold = 0.5
        self.bounce_threshold = 0.25

        self.positions = {}
        self.current_prices = {}
        self.candle_data = {}

        for symbol in self.trading_symbols:
            self.current_prices[symbol] = 0
            self.candle_data[symbol] = []

        self.support_levels = {}
        self.resistance_levels = {}
        self.ema_period = 20
        self.last_candle_times = {}
        self.last_level_updates = {}
        self.trend_directions = {}
        self.trend_emas = {}

        for symbol in self.trading_symbols:
            self.support_levels[symbol] = []
            self.resistance_levels[symbol] = []
            self.last_candle_times[symbol] = 0
            self.last_level_updates[symbol] = 0
            self.trend_directions[symbol] = "NEUTRAL"
            self.trend_emas[symbol] = 0.0

        self.trade_count = 0
        self.total_pnl = 0.0
        self.last_profit_check = time.time()
        self.daily_trades = []

        self.max_risk_pct = 0.5
        self.quick_profit_target = 0.3
        self.trailing_stop_trigger = 0.2

        self.min_confidence_threshold = 0.7
        self.signal_check_interval = 30
        self.observation_period = 60

        self.last_signal_times = {}
        self.signal_cooldown = 1200

        for symbol in self.trading_symbols:
            self.last_signal_times[symbol] = {}

        self.running = False

    def get_candles(self, symbol=None):
        symbols_to_fetch = [symbol] if symbol else self.trading_symbols
        success_count = 0

        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")

        timeframe_td = pd.to_timedelta(self.timeframe)
        if timeframe_td < pd.to_timedelta('30min'):
            base_interval = '1minute'
        else:
            base_interval = '30minute'

        for sym in symbols_to_fetch:
            try:
                df = self.client.fetch_historical_data(
                    symbol=sym,
                    interval=base_interval,
                    from_date=from_date,
                    to_date=to_date
                )

                if df is None or df.empty:
                    log_colored(f"⚠️  Could not fetch {base_interval} candle data for {sym}", "warning")
                    continue

                ohlc_dict = {
                    'open': 'first',
                    'high': 'max',
                    'low': 'min',
                    'close': 'last',
                    'volume': 'sum'
                }
                df_resampled = df.resample(self.timeframe).apply(ohlc_dict)
                df_resampled.dropna(subset=['open'], inplace=True)

                self.candle_data[sym] = [
                    {
                        'timestamp': int(row.name.timestamp() * 1000),
                        'open': row['open'],
                        'high': row['high'],
                        'low': row['low'],
                        'close': row['close'],
                        'volume': row['volume']
                    } for _, row in df_resampled.iterrows()
                ]

                if self.candle_data[sym]:
                    self.current_prices[sym] = self.candle_data[sym][-1]['close']
                    success_count += 1

            except Exception as e:
                log_colored(f"❌ Error fetching candles for {sym}: {str(e)}", "error")
                continue

        if success_count > 0:
            log_colored(f"✅ Successfully prepared candles for {success_count}/{len(symbols_to_fetch)} symbols", "success")
            return True
        else:
            log_colored("❌ Failed to fetch candles for any symbol", "error")
            return False

    def setup_websocket_streaming(self):
        if not self.websocket_enabled:
            log_colored("❌ WebSocket not available - install upstox-python-sdk", "error")
            return False

        try:
            if not self.client.access_token:
                log_colored("🔑 Authenticating for WebSocket access...", "info")
                if not self.client.authenticate():
                    log_colored("❌ Authentication failed for WebSocket", "error")
                    return False

            configuration = upstox_client.Configuration()
            configuration.access_token = self.client.access_token

            instrument_keys_list = []
            for symbol in self.trading_symbols:
                instrument_key = self.get_instrument_key_for_symbol(symbol)
                if instrument_key:
                    self.instrument_keys[symbol] = instrument_key
                    instrument_keys_list.append(instrument_key)
                    log_colored(f"🔑 {symbol}: {instrument_key}", "info")
                else:
                    log_colored(f"❌ Could not find instrument key for {symbol}", "error")

            if not instrument_keys_list:
                log_colored("❌ No valid instrument keys found", "error")
                return False

            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"
            )

            self.market_streamer.on("message", self.on_market_message)
            self.market_streamer.on("open", self.on_websocket_open)
            self.market_streamer.on("error", self.on_websocket_error)
            self.market_streamer.on("close", self.on_websocket_close)

            log_colored(f"✅ WebSocket streaming setup complete for {len(instrument_keys_list)} symbols", "success")
            return True

        except Exception as e:
            log_colored(f"❌ WebSocket setup failed: {str(e)}", "error")
            return False

    def update_live_prices_from_upstox_v3(self):
        try:
            import requests

            updated_count = 0
            for symbol in self.trading_symbols:
                instrument_key = self.get_instrument_key_for_symbol(symbol)
                if not instrument_key:
                    continue

                from datetime import datetime
                today = datetime.now().strftime('%Y-%m-%d')

                url = f"https://api.upstox.com/v3/historical-candle-data/{instrument_key}/minutes/1/{today}/{today}"

                try:
                    response = requests.get(url, timeout=3)
                    if response.status_code == 200:
                        data = response.json()
                        if data.get('status') == 'success' and data.get('data'):
                            candles = data['data']
                            if candles:
                                latest_candle = candles[-1]
                                new_price = float(latest_candle[4])
                                old_price = self.real_time_prices.get(symbol, 0)

                                if abs(new_price - old_price) >= 0.01:
                                    self.real_time_prices[symbol] = new_price
                                    self.current_prices[symbol] = new_price
                                    updated_count += 1

                except requests.RequestException:
                    continue

            return updated_count > 0

        except Exception as e:
            return False

    def get_instrument_key_for_symbol(self, symbol):
        try:
            if hasattr(self.client, 'get_instrument_key'):
                return self.client.get_instrument_key(symbol)

            if not self.client.instruments:
                try:
                    self.client._download_and_cache_instruments()
                except AttributeError:
                    pass

            if self.client.instruments:
                for instrument in self.client.instruments:
                    if (instrument.get('trading_symbol') == symbol and
                        instrument.get('exchange') in ['NSE', 'NSE_EQ'] and
                        instrument.get('instrument_type') == 'EQ'):
                        return instrument.get('instrument_key')

            fallback_key = symbol
            return fallback_key

        except Exception as e:
            log_colored(f"⚠️  Error getting instrument key for {symbol}: {str(e)}", "warning")
            return symbol

    def get_symbol_from_instrument_key(self, instrument_key):
        for symbol, key in self.instrument_keys.items():
            if key == instrument_key:
                return symbol
        return None

    def on_market_message(self, message):
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']

                for instrument_key, data in feeds.items():
                    symbol = self.get_symbol_from_instrument_key(instrument_key)
                    if not symbol:
                        continue

                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        new_price = float(data['ltpc']['ltp'])

                        if abs(new_price - self.last_logged_prices.get(symbol, 0)) >= 0.01:
                            self.real_time_prices[symbol] = new_price
                            self.current_prices[symbol] = new_price
                            self.price_update_counts[symbol] += 1
                            self.last_websocket_update = time.time()

                            if self.price_update_counts[symbol] > 1:
                                if (self.price_update_counts[symbol] % 100 == 0 or
                                    abs(new_price - self.last_logged_prices[symbol]) >= 5):
                                    log_colored(
                                        f"📡 {symbol}: ₹{new_price:,.2f} (Update #{self.price_update_counts[symbol]})",
                                        "info"
                                    )

                            self.last_logged_prices[symbol] = new_price

                            if (symbol in self.positions and self.positions[symbol] and
                                abs(new_price - self.positions[symbol]['entry_price']) > 0.10):
                                self.check_position_pnl_realtime_smart(symbol)

        except Exception as e:
            log_colored(f"❌ Error processing WebSocket message: {str(e)}", "error")

    def on_websocket_open(self):
        log_colored("🔗 WebSocket connection established!", "success")
        symbols_str = ", ".join(self.trading_symbols)
        log_colored(f"📡 Streaming real-time data for: {symbols_str}", "info")

    def on_websocket_error(self, error):
        log_colored(f"❌ WebSocket error: {str(error)}", "error")

    def on_websocket_close(self, close_status_code, close_msg):
        log_colored(f"🔌 WebSocket connection closed (Code: {close_status_code})", "info")

    def run_strategy(self):
        self.running = True
        symbols_str = ", ".join(self.trading_symbols)
        log_colored(f"🚀 Starting Enhanced Multi-Symbol Upstox Paper Trading Bot for {symbols_str} on {self.timeframe} timeframe!", "success")

        if not self.client.access_token and not self.client.authenticate():
            log_colored("Authentication failed. Exiting.", "error")
            return

        if not self.get_candles():
            log_colored("Failed to get initial candle data. Exiting.", "error")
            return

        websocket_connected = False
        log_colored("🔗 Setting up live price updates via Upstox V3 API...", "info")

        if self.update_live_prices_from_upstox_v3():
            websocket_connected = True
            log_colored("✅ Upstox V3 live data available", "success")

            for symbol in self.trading_symbols:
                price = self.real_time_prices.get(symbol, 0)
                if price > 0:
                    log_colored(f"📡 {symbol} current price: ₹{price:.2f}", "success")
        else:
            log_colored("⚠️ Upstox V3 API connection failed, using historical prices", "warning")

        for symbol in self.trading_symbols:
            if self.candle_data.get(symbol):
                self.identify_support_resistance_levels_instance(symbol)
                self.calculate_trend_direction(symbol)

        log_colored(f"📊 Data Source: {'🟢 Real-time WebSocket + Historical' if websocket_connected else '🔴 Historical only'}", "info")

        log_colored(f"👀 OBSERVATION PERIOD: Monitoring market for {self.observation_period} seconds before trading...", "warning")

        observation_start = time.time()
        price_updates_received = 0

        while time.time() - observation_start < self.observation_period:
            if websocket_connected:
                if self.update_live_prices_from_upstox_v3():
                    price_updates_received += 1

                    if price_updates_received % 5 == 0:
                        remaining = self.observation_period - (time.time() - observation_start)
                        log_colored(f"📡 V3 API updates: {price_updates_received} | Observation ends in {remaining:.0f}s", "info")

            time.sleep(5)

        observation_status = f"📊 Observation complete! Received {price_updates_received} real-time price updates"
        log_colored(observation_status, "success")
        log_colored("🎯 Now actively monitoring for trading signals...", "success")

        try:
            last_signal_check = 0
            last_data_update = 0

            while self.running:
                current_time = time.time()

                if websocket_connected and current_time - last_data_update > 10:
                    if self.update_live_prices_from_upstox_v3():
                        for symbol in self.trading_symbols:
                            if self.positions.get(symbol):
                                self.check_position_pnl_realtime_smart(symbol)
                    last_data_update = current_time

                elif current_time - last_data_update > 300:
                    if self.get_candles():
                        for symbol in self.trading_symbols:
                            if self.candle_data.get(symbol):
                                self.identify_support_resistance_levels_instance(symbol)
                                self.calculate_trend_direction(symbol)
                        last_data_update = current_time

                for symbol in self.trading_symbols:
                    if self.positions.get(symbol):
                        should_close, reason = self.should_close_position(symbol)
                        if should_close:
                            self.close_position(symbol, reason)
                        elif not websocket_connected:
                            if time.time() - self.last_profit_check > 10:
                                position = self.positions[symbol]
                                current_price = self.current_prices.get(symbol, 0)
                                pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
                                if position['side'] == 'SELL':
                                    pnl *= -1
                                log_colored(f"💰 {symbol} P&L: {pnl:.2f}% (Historical)", "profit" if pnl > 0 else "loss")
                                self.last_profit_check = time.time()

                if current_time - last_signal_check > self.signal_check_interval:
                    for symbol in self.trading_symbols:
                        if not self.positions.get(symbol):
                            signals = self.check_support_resistance_signals(symbol)
                            if signals:
                                side, reason, confidence, level = signals[0]
                                if confidence >= self.min_confidence_threshold:
                                    log_colored(f"🚨 {symbol} HIGH CONFIDENCE SIGNAL: {reason} (confidence: {confidence:.1%})", "success")
                                    if self.execute_trade(symbol, side, reason, level, confidence):
                                        current_price = self.current_prices.get(symbol, 0)
                                        log_colored(f"✅ {symbol} Trade executed: {side} @ ₹{current_price:.2f}", "trade")

                    last_signal_check = current_time

                elif int(current_time) % 120 == 0:
                    data_source = "🟢 Real-time" if websocket_connected else "🔴 Historical"

                    for symbol in self.trading_symbols:
                        if not self.positions.get(symbol):
                            nearest_support, nearest_resistance = self.find_nearest_levels(symbol)
                            current_price = self.current_prices.get(symbol, 0)
                            trend_direction = self.trend_directions.get(symbol, "NEUTRAL")

                            status_parts = []
                            if trend_direction:
                                status_parts.append(f"Trend: {trend_direction}")
                            if nearest_support:
                                support_dist = ((current_price - nearest_support) / nearest_support) * 100
                                status_parts.append(f"Support: ₹{nearest_support:,.2f} ({support_dist:+.2f}%)")
                            if nearest_resistance:
                                resistance_dist = ((nearest_resistance - current_price) / current_price) * 100
                                status_parts.append(f"Resistance: ₹{nearest_resistance:,.2f} (+{resistance_dist:.2f}%)")

                            status = " | ".join(status_parts) if status_parts else "No levels detected"
                            log_colored(f"🔍 {symbol} | Price: ₹{current_price:,.2f} ({data_source}) | {status}", "info")

                time.sleep(2)

        except KeyboardInterrupt:
            log_colored("🛑 Bot stopped by user.", "warning")
            for symbol in self.trading_symbols:
                if self.positions.get(symbol):
                    self.close_position(symbol, "Manual stop")

            save_daily_summary(self.daily_trades)
        finally:
            self.running = False
            if hasattr(self, 'market_streamer') and self.market_streamer:
                try:
                    self.market_streamer.disconnect()
                    log_colored("🔌 WebSocket connection closed", "info")
                except:
                    pass


def run_upstox_paper_trading_bot(symbols, timeframe: str):
    if isinstance(symbols, str):
        symbols = [symbols]

    if len(symbols) > 10:
        symbols_str = f"NIFTY50_{len(symbols)}stocks"
    else:
        symbols_str = "_".join(symbols)
    log_filename = f"upstox_paper_trades_{symbols_str}_{timeframe}.log"
    paper_trade_formatter = logging.Formatter('%(asctime)s - %(message)s')
    paper_trade_handler = logging.FileHandler(log_filename, mode='w')
    paper_trade_handler.setFormatter(paper_trade_formatter)

    if paper_trade_logger.hasHandlers():
        paper_trade_logger.handlers.clear()
    paper_trade_logger.addHandler(paper_trade_handler)

    os.system('clear' if os.name == 'posix' else 'cls')

    websocket_status = "🟢 ENABLED" if UPSTOX_SDK_AVAILABLE else "🔴 DISABLED"
    websocket_note = "Real-time streaming active" if UPSTOX_SDK_AVAILABLE else "Install: pip install upstox-python-sdk"
    if len(symbols) > 10:
        symbols_display = f"Nifty 50 ({len(symbols)} stocks)"
    elif len(symbols) > 5:
        symbols_display = f"{', '.join(symbols[:3])}, ... +{len(symbols)-3} more"
    else:
        symbols_display = ", ".join(symbols)

    print(f"""
{Colors.BOLD}{Colors.BLUE}📊 ENHANCED MULTI-SYMBOL UPSTOX PAPER TRADING BOT{Colors.RESET}
{Colors.BLUE}{'=' * 70}{Colors.RESET}
{Colors.CYAN}Symbols: {symbols_display} | Timeframe: {timeframe}{Colors.RESET}
{Colors.YELLOW}📝 Mode: Paper Trading (No real orders){Colors.RESET}
{Colors.WHITE}📄 Logging to: {log_filename}{Colors.RESET}

{Colors.BOLD}📡 REAL-TIME DATA STATUS{Colors.RESET}
{Colors.GREEN if UPSTOX_SDK_AVAILABLE else Colors.RED}WebSocket: {websocket_status}{Colors.RESET}
{Colors.WHITE}{websocket_note}{Colors.RESET}

{Colors.MAGENTA}🎯 Expected P&L Updates:{Colors.RESET}
{Colors.GREEN if UPSTOX_SDK_AVAILABLE else Colors.YELLOW}{'✅ Real-time (live price changes)' if UPSTOX_SDK_AVAILABLE else '⚠️  Historical only (delayed updates)'}{Colors.RESET}

{Colors.CYAN}⏱️ SMART ENTRY LOGIC:{Colors.RESET}
{Colors.GREEN}✅ 60-second observation period{Colors.RESET}
{Colors.GREEN}✅ 70%+ confidence threshold{Colors.RESET}
{Colors.GREEN}✅ Independent positions per symbol{Colors.RESET}
{Colors.GREEN}✅ Single WebSocket for all symbols{Colors.RESET}
    """)

    if not UPSTOX_SDK_AVAILABLE:
        print(f"""
{Colors.YELLOW}📋 TO ENABLE REAL-TIME STREAMING:{Colors.RESET}
{Colors.WHITE}1. Install official SDK: pip install upstox-python-sdk{Colors.RESET}
{Colors.WHITE}2. Restart the bot{Colors.RESET}
{Colors.WHITE}3. You'll see live P&L changes instead of 0.00%{Colors.RESET}
        """)

    bot = UpstoxPaperTradingBot(
        api_key=UPSTOX_CONFIG['api_key'],
        api_secret=UPSTOX_CONFIG['api_secret'],
        symbols=symbols,
        timeframe=timeframe
    )
    try:
        bot.run_strategy()
    except Exception as e:
        print(f"\n{Colors.RED}❌ Error: {e}{Colors.RESET}")
        if "upstox_client" in str(e):
            print(f"{Colors.YELLOW}💡 Hint: Install upstox-python-sdk for real-time data{Colors.RESET}")
