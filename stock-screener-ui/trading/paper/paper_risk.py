"""Risk validation and order fill simulation for paper trading."""

import random
from typing import Tuple
from .paper_models import OrderSide


def has_duplicate_position(positions: dict, symbol: str) -> bool:
    return symbol in positions


def simulate_fill(quantity: int, fill_probability: float, max_fill_pct: float) -> Tuple[int, bool]:
    fill_pct = random.uniform(0.5, 1.0) if max_fill_pct < 1.0 else 1.0
    fill_quantity = int(quantity * min(fill_pct, max_fill_pct))

    if fill_quantity == 0:
        return 0, True

    if random.random() > fill_probability:
        return 0, True

    return fill_quantity, False


def calculate_fill_price(price: float, side: OrderSide, slippage_pct: float) -> float:
    if side == OrderSide.BUY:
        return price * (1 + slippage_pct)
    return price * (1 - slippage_pct)


def calculate_margin_required(price: float, quantity: int, side: OrderSide, slippage_pct: float) -> float:
    fill_price = calculate_fill_price(price, side, slippage_pct)
    return fill_price * quantity


def has_sufficient_cash(cash: float, margin_required: float) -> bool:
    return cash >= margin_required
