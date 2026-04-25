import logging
from datetime import datetime

from screeners.utils.tv_logging_utils import log_colored

paper_trade_logger = logging.getLogger('upstox_paper_trade_logger')


class ExecutionMixin:

    def execute_trade(self, symbol, side, reason, level, confidence):
        current_price = self.real_time_prices.get(symbol, 0) or self.current_prices.get(symbol, 0)

        target_amount = 50000
        quantity = max(1, int(target_amount / current_price))

        trade_log_msg = f"PAPER_TRADE_OPEN: Side={side}, Qty={quantity}, Symbol={symbol}, Price={current_price:.2f}, Reason={reason}, Level={level:.2f}, Confidence={confidence:.2f}"
        paper_trade_logger.info(trade_log_msg)
        log_colored(trade_log_msg, "trade")

        self.positions[symbol] = {
            'side': side,
            'qty': quantity,
            'entry_price': current_price,
            'timestamp': datetime.now(),
            'highest_profit': 0.0,
            'trailing_stop_active': False,
            'trade_id': self.trade_count + 1
        }
        self.trade_count += 1
        return True

    def close_position(self, symbol, reason):
        if not self.positions.get(symbol):
            return

        position = self.positions[symbol]
        current_price = self.real_time_prices.get(symbol, 0) or self.current_prices.get(symbol, 0)

        pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
        if position['side'] == 'SELL':
            pnl *= -1

        trade_log_msg = f"PAPER_TRADE_CLOSE: Symbol={symbol}, Side={position['side']}, PnL={pnl:.2f}%, Reason={reason}, Entry={position['entry_price']:,.2f}, Exit={current_price:,.2f}"
        paper_trade_logger.info(trade_log_msg)
        log_colored(trade_log_msg, "profit" if pnl > 0 else "loss")

        self.total_pnl += pnl

        trade_duration = datetime.now() - position['timestamp']
        self.daily_trades.append({
            'id': position['trade_id'],
            'symbol': symbol,
            'side': position['side'],
            'entry_price': position['entry_price'],
            'exit_price': current_price,
            'qty': position['qty'],
            'pnl_pct': pnl,
            'pnl_amount': pnl * position['entry_price'] * position['qty'] / 100,
            'duration': trade_duration,
            'reason': reason,
            'entry_time': position['timestamp'],
            'exit_time': datetime.now()
        })

        del self.positions[symbol]

    def should_close_position(self, symbol):
        if not self.positions.get(symbol):
            return False, ""

        position = self.positions[symbol]
        current_price = self.real_time_prices.get(symbol, 0) or self.current_prices.get(symbol, 0)

        if position['side'] == 'BUY':
            pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
        else:
            pnl = (position['entry_price'] - current_price) / position['entry_price'] * 100

        if pnl > position['highest_profit']:
            position['highest_profit'] = pnl

        if pnl <= -self.max_risk_pct:
            return True, "Stop loss triggered"

        if pnl >= self.quick_profit_target:
            return True, "Quick profit target reached"

        if pnl >= self.trailing_stop_trigger:
            position['trailing_stop_active'] = True

        if position['trailing_stop_active'] and position['highest_profit'] > 0:
            trailing_stop_level = position['highest_profit'] - 0.15
            if pnl <= trailing_stop_level:
                return True, f"Trailing stop triggered (was {position['highest_profit']:.2f}%, now {pnl:.2f}%)"

        return False, ""
