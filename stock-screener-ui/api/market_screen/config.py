"""Universe descriptors for GET /api/market/snapshot.

Every per-universe literal lives here: the TradingView source and field set,
currency/units, cap-tier definition, exchange/type filters and which NSE tag
sets (if any) apply. Snapshot adapters read the spec instead of branching on
the universe name, so a new universe is one registry entry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from api.tv import USA_EXCHANGES

#: Dashboard screener frame (the exact current row contract).
COLUMNS = [
    "name",
    "description",
    "sector",
    "exchange",
    "close",
    "change",
    "relative_volume_10d_calc",
    "market_cap_basic",
    "RSI",
    "ADX",
    "SMA20",
    "SMA50",
    "SMA200",
    "Perf.W",
    "Perf.1M",
    "price_52_week_high",
    "price_52_week_low",
    # Fundamentals ride along in the same scan; the treemap colours by them.
    "price_earnings_ttm",
    "price_book_fq",
    "dividend_yield_recent",
    "return_on_equity",
    "update_mode",
]

#: The US scan adds ``type`` so funds/ETFs can be dropped locally as well.
US_COLUMNS = [*COLUMNS, "type"]

TYPE_STOCK_FILTER = {"left": "type", "operation": "equal", "right": "stock"}
# TV types NSE ETFs as `fund`, not `stock` (GOLDBEES, NIFTYBEES, …). All NSE must
# carry them so the rail's ETF-only view has rows to select. `in_range` with a
# string list is the scanner's multi-value allowlist; `equal` with a list is a
# 400, and dropping the type filter would admit every other NSE instrument type.
NSE_TYPE_FILTER = {"left": "type", "operation": "in_range", "right": ["stock", "fund"]}
NSE_EXCHANGE_FILTER = {"left": "exchange", "operation": "equal", "right": "NSE"}

#: TradingView types preferred/DR lines, coupon notes, bonds and OP LP units as
#: ``stock`` with the *parent's* cap, so they survive the type filter. A slash in
#: the ticker marks a preferred class; the name tokens catch instruments without
#: one. Dots (BRK.B), "Class" and "Series" stay so class/tracking shares survive;
#: "Bond" needs a year suffix so issuers like "Our Bond, Inc." are not dropped.
US_EXCLUDE_SYMBOL_PATTERN = r"/"
US_EXCLUDE_NAME_PATTERN = (
    r"Depositary|Depository|Pfd|Preferred (Shs|Shares|Stock)|"
    r"Repr 1/|Cum Conv|Dep Shs|"
    r"\bNotes?\b|\bDebentures?\b|\bbonds?\s+\d{4}|\bOP,?\s*LP\b"
)


@dataclass(frozen=True)
class CapTierSpec:
    """How market cap maps to a cap tier.

    ``rank`` tiers are relative to the returned universe (India: ranks
    1-100/101-250/251-500). ``absolute`` tiers use native-cap thresholds in
    billions (US: >=200 mega, >=10 large, >=2 mid, >=0.3 small). Missing cap
    always falls back to ``fallback``. Non-equity instruments (NSE ETFs are
    typed ``fund``) carry no market cap by design; ``non_equity_tier`` keeps
    them out of the size ranking so ``micro`` still means a small company
    rather than "not a company".
    """

    mode: str
    ranks: tuple[tuple[int, str], ...] = ()
    absolute: tuple[tuple[float, str], ...] = ()
    fallback: str = "micro"
    non_equity_tier: str | None = None


@dataclass(frozen=True)
class UniverseSpec:
    """One universe's source, units, filters and output contract."""

    tv_market: str
    columns: tuple[str, ...]
    currency: str
    cap_tiers: CapTierSpec
    #: output field -> native-cap scale; ``None`` means emit a JSON null.
    mcap_outputs: tuple[tuple[str, float | None], ...]
    server_filters: tuple[dict[str, Any], ...] = ()
    #: Local exchange hygiene (US drops OTC/foreign listings).
    allowed_exchanges: frozenset[str] | None = None
    require_stock_type: bool = False
    #: Local regex hygiene, applied to the TV ticker (`name`) and description.
    #: Matched case-insensitively; matching rows are dropped, not penalised.
    exclude_symbol_pattern: str | None = None
    exclude_name_pattern: str | None = None
    #: Ticker-based universes resolve their members from chart_patterns.
    tickers: bool = False
    #: NSE F&O/ETF tag sets only apply to the India universes.
    use_nse_tags: bool = False


RANK_TIERS = CapTierSpec(
    mode="rank",
    ranks=((100, "large"), (250, "mid"), (500, "small")),
    non_equity_tier="etf",
)
USD_TIERS = CapTierSpec(
    mode="absolute",
    absolute=(
        (200.0, "mega"),
        (10.0, "large"),
        (2.0, "mid"),
        (0.3, "small"),
    ),
)

_SCAN_UNIVERSES: dict[str, UniverseSpec] = {
    "all_equity": UniverseSpec(
        tv_market="india",
        columns=tuple(COLUMNS),
        currency="INR",
        cap_tiers=RANK_TIERS,
        mcap_outputs=(("market_cap_cr", 1e7),),
        server_filters=(NSE_TYPE_FILTER, NSE_EXCHANGE_FILTER),
        use_nse_tags=True,
    ),
    "us": UniverseSpec(
        tv_market="america",
        columns=tuple(US_COLUMNS),
        currency="USD",
        cap_tiers=USD_TIERS,
        # Never fabricate a rupee figure for a USD-quoted listing.
        mcap_outputs=(("market_cap_cr", None), ("marketCapUsdB", 1e9)),
        server_filters=(TYPE_STOCK_FILTER,),
        allowed_exchanges=frozenset(USA_EXCHANGES),
        require_stock_type=True,
        exclude_symbol_pattern=US_EXCLUDE_SYMBOL_PATTERN,
        exclude_name_pattern=US_EXCLUDE_NAME_PATTERN,
    ),
}

#: Constituent/NSE-FO universes share one spec; members come from get_universe().
_TICKER_SPEC = UniverseSpec(
    tv_market="india",
    columns=tuple(COLUMNS),
    currency="INR",
    cap_tiers=RANK_TIERS,
    mcap_outputs=(("market_cap_cr", 1e7),),
    tickers=True,
    use_nse_tags=True,
)
_TICKER_UNIVERSES = (
    "nifty50", "nifty100", "nifty200", "nifty500", "banknifty", "sensex", "nse_fo",
)

UNIVERSES: dict[str, UniverseSpec] = {
    **_SCAN_UNIVERSES,
    **{name: _TICKER_SPEC for name in _TICKER_UNIVERSES},
}

ALLOWED_UNIVERSES = tuple(UNIVERSES)

#: Universes chart-patterns can resolve but this equity snapshot must not expose.
#: ``indices`` members are index instruments whose real identifiers are Upstox
#: ``NSE_INDEX|…`` / ``BSE_INDEX|…`` keys (chart_patterns.indices.INDEX_KEYS); the
#: snapshot resolves tickers through ``to_tv_ticker``, a cash-equity normaliser
#: that prefixes ``NSE:`` for every id (``SENSEX`` -> ``NSE:SENSEX``, not
#: ``BSE:SENSEX``). The equity COLUMNS contract (market cap, P/E, P/B, ROE,
#: relative volume, sector) is also null for index instruments, so every row
#: would fall to the ``micro`` cap tier and the treemap would have nothing to
#: size or colour. There is no index data path in this endpoint, so exposing the
#: option in the dropdown would ship a dead control. The reason lives here, next
#: to the registry that decides what the snapshot serves, so the parity guard
#: can assert the exclusion instead of trusting a comment in the UI.
UNSERVABLE_UNIVERSES: dict[str, str] = {
    "indices": (
        "index instruments are not served by the equity TradingView snapshot: "
        "to_tv_ticker prefixes NSE for every id (SENSEX needs BSE) and the "
        "equity COLUMNS (market cap, fundamentals, relative volume, sector) "
        "are null for indices, so cap tiers and the treemap break"
    ),
}

#: Every cap-tier id any universe can emit, derived from the specs (rank labels,
#: absolute-threshold labels, each fallback and any class tier) so downstream
#: validators cannot drift from the registry when a universe or tier is added.
#: The union is ordered by first appearance; the US adds ``mega``. A class tier
#: such as ``etf`` is included because the rail offers it as a selectable tier
#: (rendered apart from the size ladder): a saved ``capTiers`` filter must accept
#: exactly the values the rail can emit, or saving an ETF view would 422.
ALL_CAP_TIERS: tuple[str, ...] = tuple(
    dict.fromkeys(
        label
        for spec in UNIVERSES.values()
        for label in (
            *(tier for _, tier in spec.cap_tiers.ranks),
            *(tier for _, tier in spec.cap_tiers.absolute),
            spec.cap_tiers.fallback,
            *((spec.cap_tiers.non_equity_tier,) if spec.cap_tiers.non_equity_tier else ()),
        )
    )
)
