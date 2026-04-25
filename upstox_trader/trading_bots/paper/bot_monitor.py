import time
from datetime import datetime

from screeners.utils.tv_logging_utils import log_colored, create_daily_trades_summary, save_daily_summary


class MonitorMixin:

    def check_position_pnl_realtime(self, symbol):
        if not self.positions.get(symbol):
            return

        current_time = time.time()
        if current_time - self.last_profit_check < 5:
            return

        position = self.positions[symbol]
        current_price = self.current_prices[symbol]

        pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
        if position['side'] == 'SELL':
            pnl *= -1

        price_source = "🔴 Historical" if self.real_time_prices.get(symbol, 0) == 0 else "🟢 Real-time"
        log_colored(
            f"💰 {symbol} P&L: {pnl:+.2f}% | Entry: ₹{position['entry_price']:,.2f} | "
            f"Current: ₹{current_price:,.2f} | {price_source}",
            "profit" if pnl > 0 else "loss"
        )

        self.last_profit_check = current_time

    def check_position_pnl_realtime_smart(self, symbol):
        if not self.positions.get(symbol):
            return

        current_time = time.time()
        if current_time - self.last_profit_check < 3:
            return

        position = self.positions[symbol]
        current_price = self.current_prices[symbol]

        pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
        if position['side'] == 'SELL':
            pnl *= -1

        pnl_rounded = round(pnl, 2)
        should_log = False

        last_pnl = self.last_logged_pnl_percents.get(symbol)
        if last_pnl is None:
            should_log = True
        elif abs(pnl_rounded - last_pnl) >= 0.05:
            should_log = True
        elif current_time - self.last_profit_check > 30:
            should_log = True

        if should_log:
            price_source = "🔴 Historical" if self.real_time_prices.get(symbol, 0) == 0 else "🟢 Real-time"
            log_colored(
                f"💰 {symbol} P&L: {pnl:+.2f}% | Entry: ₹{position['entry_price']:,.2f} | "
                f"Current: ₹{current_price:,.2f} | {price_source}",
                "profit" if pnl > 0 else "loss"
            )

            self.last_logged_pnl_percents[symbol] = pnl_rounded
            self.last_profit_check = current_time

    def create_daily_trades_summary_instance(self):
        if not self.daily_trades:
            return "No trades executed today."

        total_trades = len(self.daily_trades)
        winning_trades = [t for t in self.daily_trades if t['pnl_pct'] > 0]
        losing_trades = [t for t in self.daily_trades if t['pnl_pct'] < 0]

        win_rate = len(winning_trades) / total_trades * 100 if total_trades > 0 else 0
        total_pnl_amount = sum(t['pnl_amount'] for t in self.daily_trades)
        avg_trade_duration = sum(t['duration'].total_seconds() for t in self.daily_trades) / total_trades / 60

        today = datetime.now().strftime("%d%B%Y")
        summary = f"""
 {'='*100}
 📊 DAILY TRADES SUMMARY - {today}
 {'='*100}

 📈 PERFORMANCE METRICS:
    Total Trades: {total_trades}
    Winning Trades: {len(winning_trades)} ({win_rate:.1f}%)
    Losing Trades: {len(losing_trades)} ({100-win_rate:.1f}%)
    Total P&L: ₹{total_pnl_amount:,.2f}
    Average Duration: {avg_trade_duration:.1f} minutes

 {'='*100}
 🎯 INDIVIDUAL TRADES:
 {'='*100}
 {'ID':<3} {'Symbol':<12} {'Side':<4} {'Entry':<10} {'Exit':<10} {'Qty':<5} {'P&L%':<8} {'P&L₹':<10} {'Duration':<10} {'Reason':<25}
 {'-'*100}
"""

        for trade in self.daily_trades:
            duration_str = f"{int(trade['duration'].total_seconds()/60)}m{int(trade['duration'].total_seconds()%60)}s"
            pnl_color = "🟢" if trade['pnl_pct'] > 0 else "🔴"

            summary += f"{trade['id']:<3} {trade['symbol']:<12} {trade['side']:<4} "
            summary += f"₹{trade['entry_price']:<9.2f} ₹{trade['exit_price']:<9.2f} "
            summary += f"{trade['qty']:<5} {pnl_color}{trade['pnl_pct']:>+6.2f}% "
            summary += f"₹{trade['pnl_amount']:>+8.2f} {duration_str:<10} "
            summary += f"{trade['reason']:<25}\n"

        summary += f"\n{'-'*100}\n"
        summary += f"💰 NET P&L: ₹{total_pnl_amount:+,.2f} | Win Rate: {win_rate:.1f}%\n"
        summary += f"{'='*100}\n"

        return summary

    def save_daily_summary_instance(self):
        try:
            today = datetime.now().strftime("%d%B%Y")
            filename = f"{today}_trades.log"
            summary = create_daily_trades_summary(self.daily_trades)

            with open(filename, 'w') as f:
                f.write(summary)

            print(f"\n📄 Daily summary saved to: {filename}")
            print(summary)

        except Exception as e:
            print(f"Error saving daily summary: {e}")
