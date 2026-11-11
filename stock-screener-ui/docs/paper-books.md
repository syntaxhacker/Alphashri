# Paper-trading books — one login, one book per asset class

## Decision

**No dedicated user per asset class.** We keep **one login** (the account you
actually use) and separate paper trading into **books** by:

1. the trade's **`source`** tag (`live`, `options_paper_agent`, `futures_paper`, …),
2. the **bot/strategy namespace** (`Agent - Options Intraday`, `OPT Paper - *`, …),
3. a per-book **capital** figure in the registry.

Why: the UI is scoped to the logged-in user (`/paper`, `/api/bots`, `/api/paper/trades`).
A second user with an address like `options-paper@alphashri.local` **cannot log
in** — `.local` is a reserved TLD and the API rejects it — so its trades are
invisible. That is exactly what happened in the first options session: the
dedicated account existed but every visible trade was booked under the main user.
The hybrid is the worst of both worlds; one login is simpler and honest.

## The registry

`options_paper/books.py`:

| key | label | source prefixes | capital | bots | status |
|---|---|---|---|---|---|
| `equity` | Equity | `` (null) `live` `paper` | user's `initial_capital` | existing equity bots | active |
| `options` | Options | `options_paper` | **₹25,00,000** | `Agent - Options Intraday`, `OPT Paper - *` | active |
| `futures` | Futures | `futures_paper` | TBD | TBD | **planned** |
| `commodities` | Commodities | `commodities_paper` | TBD | TBD | **planned** |

Helpers: `book_for_source(source)`, `book_keys()`, `Book.owns(source)`.

## How a trade is classified

```
source = "options_paper_agent"   →  options book
source = "live" or NULL          →  equity book
source = "futures_paper_*"       →  futures book   (future)
```

The options writer already stamps `source="options_paper_agent"` in
`options_paper/book.py::record_trades`. Any new book's writer must do the same.

## Adding a new asset class (futures, then commodities)

1. Pick the source prefix (`futures_paper`, `commodities_paper`).
2. Add a `Book(...)` row in `options_paper/books.py` with its capital and bot prefix.
3. The writer stamps that `source` on every trade (same insert-only DB path).
4. Give its bots the same naming convention (`Agent - Futures Intraday`, …).
5. The UI Source filter picks it up from the trade sources — no migration.

Nothing about this needs a new user, a new database, or a new login.

## UI

The history toolbar has a **Source** select (`All / Equity / Options`). It filters
on `trade.source` (`isOptionTrade`, which is source-first). The plan for
futures/commodities is to make the select **data-driven** from the distinct
sources present in the returned trades, so new books appear automatically.

## Capital & P&L

- **Per-book capital** lives in the registry (equity = the user's
  `initial_capital`, options = ₹25 L). It is not a column on `users`.
- **P&L per book** = `sum(net_pnl)` filtered by that book's source prefix. The
  checker (`scripts/agent_options_check.py`) and the ledger already filter to
  `options_paper%`.
- Do **not** mix books in one headline number; report them separately.

## Current state (2026-10-19 →)

- The **options** trades live under your user (source `options_paper_agent`, bot
  `Agent - Options Intraday`) — visible in `/paper?view=history` via the Source
  filter.
- The **legacy dedicated user** (`options-paper@alphashri.local`, user 24) still
  exists with 0 trades and 8 `OPT Paper - *` bots. It is **dormant**: nothing
  books to it except the legacy per-strategy runner, and it cannot log in. Leave
  it alone for now; if we ever want it gone, delete it in a dedicated migration
  (it is referenced by bots/strategies, so it is not a one-line delete).
- The `options_paper.runner account` command still reports user 24; the live book
  is the user-1 options source. Prefer the checker / ledger for the real P&L.

## Why this matters

It keeps the **data model honest**: one owner, many labelled books. When futures
arrive, they get their own capital and their own P&L line without touching the
equity or options books — and without another un-loginnable account.
