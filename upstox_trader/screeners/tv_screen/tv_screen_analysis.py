from rich.console import Console
from datetime import datetime, timedelta
import pandas as pd

console = Console()

tv_utils = None
try:
    from ..tv_utils import tv_utils
except Exception:
    pass

utils = None
try:
    from ..tv_screen_utils import utils as _u
    utils = _u
except Exception:
    pass


class AnalysisMixin:

    def _check_historical_trend(self, symbol, timeframe='daily', lookback_days=20):
        """Analyze historical trend using multiple indicators"""
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return 'neutral'

            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')

            if timeframe == 'daily':
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date=to_date,
                    from_date=from_date,
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )
            else:
                hourly_lookback = min(lookback_days, 90)
                hourly_from_date = (datetime.now() - timedelta(days=hourly_lookback)).strftime('%Y-%m-%d')
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='hours',
                    interval=1,
                    to_date=to_date,
                    from_date=hourly_from_date,
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )

            if df is None or df.empty or len(df) < 10:
                return 'neutral'

            df = df.sort_values('timestamp').reset_index(drop=True)

            df['sma_5'] = df['close'].rolling(5).mean()
            df['sma_10'] = df['close'].rolling(10).mean()
            df['sma_20'] = df['close'].rolling(20).mean() if len(df) >= 20 else df['close'].rolling(len(df)//2).mean()

            current_price = df['close'].iloc[-1]
            sma_5 = df['sma_5'].iloc[-1]
            sma_10 = df['sma_10'].iloc[-1]
            sma_20 = df['sma_20'].iloc[-1]

            sma_5_slope = (df['sma_5'].iloc[-1] - df['sma_5'].iloc[-3]) / 3 if len(df) >= 3 else 0
            sma_10_slope = (df['sma_10'].iloc[-1] - df['sma_10'].iloc[-5]) / 5 if len(df) >= 5 else 0

            avg_volume = df['volume'].rolling(10).mean().iloc[-1] if len(df) >= 10 else df['volume'].mean()
            recent_volume = df['volume'].iloc[-3:].mean()
            volume_strength = recent_volume / avg_volume if avg_volume > 0 else 1

            price_change_5d = (current_price - df['close'].iloc[-6]) / df['close'].iloc[-6] * 100 if len(df) >= 6 else 0
            price_change_10d = (current_price - df['close'].iloc[-11]) / df['close'].iloc[-11] * 100 if len(df) >= 11 else 0

            trend_score = 0

            if current_price > sma_5 > sma_10 > sma_20:
                trend_score += 40
            elif current_price > sma_5 > sma_10:
                trend_score += 25
            elif current_price > sma_5:
                trend_score += 10
            elif current_price < sma_5 < sma_10 < sma_20:
                trend_score -= 40
            elif current_price < sma_5 < sma_10:
                trend_score -= 25
            elif current_price < sma_5:
                trend_score -= 10

            if sma_5_slope > 0 and sma_10_slope > 0:
                trend_score += 20
            elif sma_5_slope > 0:
                trend_score += 10
            elif sma_5_slope < 0 and sma_10_slope < 0:
                trend_score -= 20
            elif sma_5_slope < 0:
                trend_score -= 10

            if price_change_5d > 2 and price_change_10d > 1:
                trend_score += 20
            elif price_change_5d > 1:
                trend_score += 10
            elif price_change_5d < -2 and price_change_10d < -1:
                trend_score -= 20
            elif price_change_5d < -1:
                trend_score -= 10

            if volume_strength > 1.2:
                trend_score += 20
            elif volume_strength > 1.0:
                trend_score += 10
            elif volume_strength < 0.8:
                trend_score -= 10

            if trend_score >= 40:
                return 'strong_bullish'
            elif trend_score >= 20:
                return 'bullish'
            elif trend_score >= -20:
                return 'neutral'
            elif trend_score >= -40:
                return 'bearish'
            else:
                return 'strong_bearish'

        except Exception as e:
            try:
                console.print(f"[dim yellow]⚠️ Daily trend analysis failed for {symbol}, trying 15min fallback...[/dim yellow]")
                to_date = datetime.now().strftime('%Y-%m-%d')
                from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')

                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,
                    to_date=to_date,
                    from_date=from_date,
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )

                if df is not None and not df.empty and len(df) >= 10:
                    df = df.sort_values('timestamp').reset_index(drop=True)
                    recent_price = df['close'].iloc[-1]
                    older_price = df['close'].iloc[0]
                    price_change = (recent_price - older_price) / older_price * 100

                    if price_change > 3:
                        return 'bullish'
                    elif price_change < -3:
                        return 'bearish'
                    else:
                        return 'neutral'

            except Exception as fallback_error:
                console.print(f"[dim red]⚠️ All trend analysis failed for {symbol}: {e} | Fallback: {fallback_error}[/dim red]")

            return 'neutral'

    def _detect_volatility_level(self, symbol, current_price):
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return 'normal'

            import numpy as np

            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=15)).strftime('%Y-%m-%d')

            df = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
                exchange='NSE_EQ',
                instrument_type='EQ'
            )

            if df is None or df.empty or len(df) < 5:
                return 'normal'

            df['returns'] = df['close'].pct_change()

            volatility = df['returns'].std()

            df['daily_range_pct'] = ((df['high'] - df['low']) / df['close']) * 100
            avg_daily_range = df['daily_range_pct'].mean()

            high_vol_threshold = 0.03
            high_range_threshold = 4.0

            if volatility > high_vol_threshold or avg_daily_range > high_range_threshold:
                console.print(f"[dim yellow]⚠️ {symbol} classified as HIGH volatility (Vol: {volatility:.3f}, Range: {avg_daily_range:.1f}%)[/dim yellow]")
                return 'high'
            else:
                console.print(f"[dim green]✅ {symbol} classified as NORMAL volatility (Vol: {volatility:.3f}, Range: {avg_daily_range:.1f}%)[/dim green]")
                return 'normal'

        except Exception as e:
            console.print(f"[dim red]⚠️ Volatility detection failed for {symbol}: {e}[/dim red]")
            return 'normal'

    def _calculate_atr_based_stop(self, symbol, current_price, atr_multiplier=2.0):
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return current_price * 0.98

            import numpy as np

            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')

            df = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
                exchange='NSE_EQ',
                instrument_type='EQ'
            )

            if df is None or df.empty or len(df) < 14:
                return current_price * 0.98

            df['high_low'] = df['high'] - df['low']
            df['high_close_prev'] = np.abs(df['high'] - df['close'].shift(1))
            df['low_close_prev'] = np.abs(df['low'] - df['close'].shift(1))

            df['true_range'] = df[['high_low', 'high_close_prev', 'low_close_prev']].max(axis=1)

            atr = df['true_range'].rolling(window=14).mean().iloc[-1]

            if pd.isna(atr) or atr <= 0:
                return current_price * 0.98

            atr_stop = current_price - (atr * atr_multiplier)

            min_stop = current_price * 0.95
            atr_stop = max(atr_stop, min_stop)

            console.print(f"[dim]ATR Stop for {symbol}: ₹{atr_stop:.2f} (ATR: {atr:.2f}, Current: ₹{current_price:.2f})[/dim]")
            return atr_stop

        except Exception as e:
            console.print(f"[dim red]⚠️ ATR calculation failed for {symbol}: {e}[/dim red]")
            return current_price * 0.98

    def _check_confirmed_downtrend_for_short(self, symbol, row):
        try:
            current_price = row['close']

            vwap = row.get('VWAP', current_price)

            price_below_vwap = current_price < vwap

            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            change = row.get('change', 0)

            bearish_volume = volume_ratio > 1.2 and change < 1.0

            ema20 = row.get('EMA20', current_price)
            ema50 = row.get('EMA50', current_price)

            below_ema20 = current_price < ema20
            ema_bearish = ema20 < ema50

            confirmed_downtrend = price_below_vwap or bearish_volume or (below_ema20 and ema_bearish)

            if confirmed_downtrend:
                console.print(f"[dim green]✅ {symbol}: Confirmed downtrend for short - Price<VWAP: {price_below_vwap}, Bearish Vol: {bearish_volume}[/dim green]")
            else:
                console.print(f"[dim yellow]⚠️ {symbol}: No confirmed downtrend - Price<VWAP: {price_below_vwap}, Bearish Vol: {bearish_volume}[/dim yellow]")

            return confirmed_downtrend

        except Exception as e:
            console.print(f"[dim red]⚠️ Error checking downtrend for {symbol}: {e}[/dim red]")
            return False

    def _get_progressive_trailing_buffer(self, profit_pct, volatility_adjustment=0.0):
        try:
            if tv_utils is None:
                if profit_pct >= 3:
                    base = 0.6
                elif profit_pct >= 2:
                    base = 0.8
                elif profit_pct >= 1:
                    base = 1.0
                else:
                    base = 1.2
                return max(0.3, base - volatility_adjustment)
            return tv_utils.get_progressive_trailing_buffer(profit_pct, volatility_adjustment)
        except Exception:
            return 1.0

    def _get_tighter_trailing_buffer(self, profit_pct, is_ultra_quick=False, is_tv_alert=False):
        return utils.get_tighter_trailing_buffer(profit_pct, is_ultra_quick, is_tv_alert)

    def _calculate_trading_charges(self, trade_value, trade_type='intraday'):
        return utils.estimate_trading_charges(trade_value, trade_type)
