"""
Indian Trading Costs Calculator

Realistic costs for intraday equity trading based on:
- Zerodha/Upstox discount broker rates
- STT (Securities Transaction Tax)
- Exchange charges, SEBI fees
- GST on brokerage
"""

# Indian Trading Costs (Intraday Equity)
# Based on Zerodha/Upstox discount broker rates
BROKERAGE_PCT = 0.0003        # 0.03% (lower of ₹20 or 0.03% - using % for large trades)
STT_PCT = 0.00025             # 0.025% (sell side only)
EXCHANGE_CHARGES_PCT = 0.0000297  # 0.00297%
SEBI_FEE_PCT = 0.000001       # 0.0001%
STAMP_DUTY_PCT = 0.00003      # 0.003% (buy side only)
GST_PCT = 0.18                # 18% on brokerage + exchange + SEBI
DP_CHARGES = 0                # ₹13.5 per stock per day (not applicable for intraday)


def calculate_trading_costs(entry_price: float, exit_price: float, quantity: int) -> dict:
    """
    Calculate realistic Indian intraday trading costs.

    Args:
        entry_price: Price at which stock was bought
        exit_price: Price at which stock was sold
        quantity: Number of shares traded

    Returns:
        dict with buy_costs, sell_costs, total_costs, and breakdown
    """
    buy_value = entry_price * quantity
    sell_value = exit_price * quantity

    # Buy side costs
    buy_brokerage = min(20, buy_value * BROKERAGE_PCT)  # Lower of ₹20 or 0.03%
    buy_stamp_duty = buy_value * STAMP_DUTY_PCT
    buy_exchange = buy_value * EXCHANGE_CHARGES_PCT
    buy_sebi = buy_value * SEBI_FEE_PCT
    buy_gst = GST_PCT * (buy_brokerage + buy_exchange + buy_sebi)
    buy_total = buy_brokerage + buy_stamp_duty + buy_exchange + buy_sebi + buy_gst

    # Sell side costs
    sell_brokerage = min(20, sell_value * BROKERAGE_PCT)  # Lower of ₹20 or 0.03%
    sell_stt = sell_value * STT_PCT  # STT only on sell side for intraday
    sell_exchange = sell_value * EXCHANGE_CHARGES_PCT
    sell_sebi = sell_value * SEBI_FEE_PCT
    sell_gst = GST_PCT * (sell_brokerage + sell_exchange + sell_sebi)
    sell_total = sell_brokerage + sell_stt + sell_exchange + sell_sebi + sell_gst

    return {
        'buy_costs': round(buy_total, 2),
        'sell_costs': round(sell_total, 2),
        'total_costs': round(buy_total + sell_total, 2),
        'breakdown': {
            'buy_brokerage': round(buy_brokerage, 2),
            'buy_stamp_duty': round(buy_stamp_duty, 2),
            'buy_exchange': round(buy_exchange, 2),
            'buy_sebi': round(buy_sebi, 2),
            'buy_gst': round(buy_gst, 2),
            'sell_brokerage': round(sell_brokerage, 2),
            'sell_stt': round(sell_stt, 2),
            'sell_exchange': round(sell_exchange, 2),
            'sell_sebi': round(sell_sebi, 2),
            'sell_gst': round(sell_gst, 2),
        }
    }


def get_cost_breakdown() -> dict:
    """
    Get the current cost structure for display purposes.

    Returns:
        dict with all cost rates and their descriptions
    """
    return {
        'brokerage': {
            'rate': '0.03%',
            'description': 'Lower of ₹20 or 0.03% per order',
            'applies_to': 'Both buy and sell'
        },
        'stt': {
            'rate': '0.025%',
            'description': 'Securities Transaction Tax',
            'applies_to': 'Sell side only (intraday)'
        },
        'exchange_charges': {
            'rate': '0.00297%',
            'description': 'NSE transaction charges',
            'applies_to': 'Both buy and sell'
        },
        'sebi_fee': {
            'rate': '0.0001%',
            'description': 'SEBI turnover fee',
            'applies_to': 'Both buy and sell'
        },
        'stamp_duty': {
            'rate': '0.003%',
            'description': 'Stamp duty on transfer',
            'applies_to': 'Buy side only'
        },
        'gst': {
            'rate': '18%',
            'description': 'GST on brokerage + exchange + SEBI',
            'applies_to': 'Both buy and sell'
        },
        'dp_charges': {
            'rate': '₹0',
            'description': 'Not applicable for intraday',
            'applies_to': 'N/A'
        }
    }


def estimate_avg_cost_per_trade(trade_value: float = 50000) -> float:
    """
    Estimate average cost per round-trip trade.

    Args:
        trade_value: Approximate value of single trade (buy or sell)

    Returns:
        Estimated total cost for round-trip trade
    """
    # Assuming price doesn't change much
    quantity = 100  # Example quantity
    price = trade_value / quantity

    costs = calculate_trading_costs(price, price, quantity)
    return costs['total_costs']
