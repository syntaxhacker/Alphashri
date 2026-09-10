"""Tradovate-style tick-correct simulation core.

Semantics (conservative, no lookahead):
- Market BUY fills at ask + slippage; SELL at bid - slippage.
- Limit rests until touched (BUY: ask <= price fills at limit; SELL: bid >= price fills
  at limit). Maker fills take no adverse slippage.
- Stop triggers on touch, fills immediately at touch-side price +- slippage
  (conservative proxy for next-tick market fill).
- Bracket = market entry + OCO SL/TP pair; a fill on one leg cancels the other.
- Commission charged per fill (entry + each exit leg).
- Positions net; opposite market orders realize against average price.
- move_stop() revises the resting SL (breakeven/trailing).
"""
from dataclasses import dataclass, field


@dataclass
class MarketOrder:
    side: str          # "BUY" | "SELL"
    qty: int = 1


@dataclass
class LimitOrder:
    side: str
    qty: int
    price: float


@dataclass
class StopOrder:
    side: str
    qty: int
    price: float


@dataclass
class BracketOrder:
    side: str
    qty: int
    sl: float
    tp: float


@dataclass
class _Resting:
    kind: str          # "limit" | "stop" | "sl" | "tp"
    side: str
    qty: int
    price: float
    oco_group: int = 0


class SimAccount:
    def __init__(self, tick_size: float = 0.25, slippage_ticks: int = 1, commission: float = 2.5):
        self.tick_size = tick_size
        self.slip = slippage_ticks * tick_size
        self.commission = commission
        self.position_qty = 0
        self.avg_price = 0.0
        self.realized = 0.0
        self.open_orders: list = []
        self._oco_seq = 0

    # ---------------- order entry ----------------
    def submit(self, order):
        if isinstance(order, MarketOrder):
            self.open_orders.append(_Resting("market", order.side, order.qty, 0.0))
        elif isinstance(order, LimitOrder):
            self.open_orders.append(_Resting("limit", order.side, order.qty, order.price))
        elif isinstance(order, StopOrder):
            self.open_orders.append(_Resting("stop", order.side, order.qty, order.price))
        elif isinstance(order, BracketOrder):
            self._oco_seq += 1
            g = self._oco_seq
            self.open_orders.append(_Resting("market", order.side, order.qty, 0.0, oco_group=-g))
            self.open_orders.append(_Resting("sl", self._flip(order.side), order.qty, order.sl, oco_group=g))
            self.open_orders.append(_Resting("tp", self._flip(order.side), order.qty, order.tp, oco_group=g))
        else:
            raise ValueError(f"unknown order {order!r}")

    @staticmethod
    def _flip(side):
        return "SELL" if side == "BUY" else "BUY"

    def move_stop(self, price: float):
        for o in self.open_orders:
            if o.kind == "sl":
                o.price = price

    # ---------------- tick processing ----------------
    def on_tick(self, ts, bid: float, ask: float):
        for o in list(self.open_orders):
            if o.kind == "market":
                px = ask + self.slip if o.side == "BUY" else bid - self.slip
                self._fill(o, px)
            elif o.kind == "limit":
                if o.side == "BUY" and ask <= o.price:
                    self._fill(o, o.price)
                elif o.side == "SELL" and bid >= o.price:
                    self._fill(o, o.price)
            elif o.kind in ("stop", "sl"):
                if o.side == "SELL" and bid <= o.price:
                    self._fill(o, bid - self.slip)
                elif o.side == "BUY" and ask >= o.price:
                    self._fill(o, ask + self.slip)
            elif o.kind == "tp":
                if o.side == "SELL" and bid >= o.price:
                    self._fill(o, o.price)
                elif o.side == "BUY" and ask <= o.price:
                    self._fill(o, o.price)

    def _fill(self, o: _Resting, px: float):
        self.open_orders.remove(o)
        if o.oco_group > 0:
            self.open_orders = [x for x in self.open_orders if x.oco_group != o.oco_group]
        elif o.oco_group < 0:
            # market leg of a bracket just filled: arm its SL/TP (flip their group positive)
            for x in self.open_orders:
                if x.oco_group == -o.oco_group:
                    x.oco_group = -o.oco_group
        self.realized -= self.commission
        if self.position_qty == 0 or (self.position_qty > 0) == (o.side == "BUY"):
            n = abs(self.position_qty) + o.qty
            self.avg_price = (self.avg_price * abs(self.position_qty) + px * o.qty) / n
            self.position_qty += o.qty if o.side == "BUY" else -o.qty
        else:
            closing = min(abs(self.position_qty), o.qty)
            entry = self.avg_price
            self.realized += (px - entry) * closing if self.position_qty > 0 else (entry - px) * closing
            self.position_qty += closing if o.side == "BUY" else -closing
            if o.qty > closing:  # flip remainder
                self.avg_price = px
                self.position_qty += (o.qty - closing) if o.side == "BUY" else -(o.qty - closing)
            elif self.position_qty == 0:
                self.avg_price = 0.0
