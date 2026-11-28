"""In-memory AdapterHub double shared by the hub and Fyers WebSocket tests."""

from __future__ import annotations


class FakeAdapter:
    """Records connect/subscribe calls and exposes manual tick/error injectors."""

    name = "fake"
    max_symbols_per_connection = 5

    def __init__(self):
        self.connected_symbols: list[str] = []
        self.added: list[str] = []
        self.disconnected = 0
        self.on_tick = None
        self.on_error = None

    def connect(self, symbols, on_tick, on_error=None):
        self.connected_symbols = list(symbols)
        self.on_tick = on_tick
        self.on_error = on_error

    def subscribe_symbol(self, symbol):
        self.added.append(symbol)
        return True

    def disconnect(self):
        self.disconnected += 1

    def emit(self, broker_symbol, tick):
        self.on_tick(broker_symbol, tick)

    def fail(self, error):
        if self.on_error:
            self.on_error(error)
