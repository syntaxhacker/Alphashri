"""Per-asset-class paper-trading books.

One login, several books
------------------------
We deliberately do **not** create a separate user per asset class. A second user
breaks the UI (`/paper` and `/api/bots` are scoped to the logged-in user, and a
`.local` address cannot even authenticate), so its trades are invisible.

Instead every book is a **tag on the trade** (`source`) plus a bot/strategy
namespace, all owned by the one logged-in user:

    equity      source `live` / NULL            bots 1..20
    options     source `options_paper*`         `Agent - Options Intraday`,
                                                `OPT Paper - *`
    futures     source `futures_paper*`         (planned)
    commodities source `commodities_paper*`     (planned)

The UI's Source filter is driven by these prefixes, so adding a new asset class
is a one-line addition here + a source prefix on its writer — no migration and no
new login.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: Capital per book. ``None`` = use the user's ``initial_capital`` (equity).
EQUITY_CAPITAL: float | None = None
OPTIONS_CAPITAL = 2_500_000.0


@dataclass(frozen=True)
class Book:
    key: str
    label: str
    source_prefixes: tuple[str, ...]
    capital: float | None = None
    bot_prefixes: tuple[str, ...] = field(default_factory=tuple)
    status: str = "active"

    def owns(self, source: str | None) -> bool:
        src = (source or "").strip().lower()
        if not src:
            return "" in self.source_prefixes
        return any(src.startswith(p) for p in self.source_prefixes if p)


BOOKS: tuple[Book, ...] = (
    Book("equity", "Equity", ("", "live", "paper"), EQUITY_CAPITAL,
         ("Multi-Strategy", "ORB", "EMA", "ADX", "52W", "SR Breakout", "RSI",
          "BB Squeeze", "Volume", "Alpha", "Swing")),
    Book("options", "Options", ("options_paper",), OPTIONS_CAPITAL,
         ("Agent - Options Intraday", "OPT Paper -")),
    Book("futures", "Futures", ("futures_paper",), None, (), "planned"),
    Book("commodities", "Commodities", ("commodities_paper",), None, (), "planned"),
)


def book_for_source(source: str | None) -> Book:
    """The book a trade belongs to (defaults to equity for NULL/unknown)."""
    for b in BOOKS:
        if b.owns(source):
            return b
    return BOOKS[0]


def book_keys() -> tuple[str, ...]:
    return tuple(b.key for b in BOOKS)
