"""Per-user saved UI state: ``/api/user-configs/{scope}``.

One row per ``(user, scope, name)`` in ``user_saved_configs``; this module only
ever reads and writes the reserved default slot ``name = ''``.

Three properties drive the design:

* **A read can never 5xx.** A stored payload the current code cannot read
  degrades to the registry defaults plus a ``warning``; the row is kept so a
  newer build (or the user's other device) can still use it.
* **Writes are strict, reads are tolerant.** Unknown keys are a 422 on PUT
  (a client typo must not be smuggled into the blob) but are dropped silently on
  GET (an older payload must still render).
* **Unknown scope is rejected before any DB access**, so a typo can never
  create a row.

``market.filters`` v1 is a flat object — ``universe``, the market filter fields,
``sort`` and ``view`` at the same level — because the frontend adapter composes
one payload from two signals (``universe`` + ``filters``) and the wire shape
stays a plain object either side of that join.

Table column preferences use a second, *dynamic* scope family: any scope matching
``table.<id>`` is served from one shared ``TablePrefsV1`` schema. The tables are
registered by the frontend at runtime, so enumerating them in ``SCOPE_REGISTRY``
would only create a drift bug; the regex is the boundary instead.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Any, Callable, Literal, Optional

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.auth import get_current_user
from db.database import get_db

router = APIRouter(prefix="/api/user-configs", tags=["user-configs"])

DEFAULT_SLOT = ""
MAX_CONFIG_BYTES = 16 * 1024

MarketUniverse = Literal["all_equity", "nifty500", "nifty50", "nse_fo"]
CapTier = Literal["large", "mid", "small", "micro"]
MarketSortKey = Literal[
    "day_desc",
    "day_asc",
    "relvol_desc",
    "mcap_desc",
    "rsi_desc",
    "perf_1m_desc",
    "perf_w_desc",
    "pos_52w_desc",
    "symbol_asc",
]
MarketView = Literal["table", "map", "movers"]

CAP_TIERS: frozenset[str] = frozenset(("large", "mid", "small", "micro"))


class MarketFiltersV1(BaseModel):
    """The Market tab's saved state, flat on the wire.

    One level, not ``{universe, filters}``: the frontend adapter serializes
    ``{universe, ...filters, view}`` and reads both shapes back, so the flat
    form is what this schema stores and returns. ``search`` is deliberately
    absent — it is a momentary lookup, not a screen definition.
    """

    model_config = ConfigDict(extra="ignore")

    universe: MarketUniverse = "all_equity"
    sectors: list[str] = Field(default_factory=list, max_length=200)
    capTiers: list[CapTier] = Field(default_factory=list, max_length=4)
    priceMin: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    priceMax: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    dayChangeMin: Optional[float] = Field(default=None, ge=-100, le=100)
    dayChangeMax: Optional[float] = Field(default=None, ge=-100, le=100)
    mcapMinCr: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    mcapMaxCr: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    rsiMin: Optional[float] = Field(default=None, ge=0, le=100)
    rsiMax: Optional[float] = Field(default=None, ge=0, le=100)
    relVolMin: Optional[float] = Field(default=None, ge=0, le=1000)
    relVolMax: Optional[float] = Field(default=None, ge=0, le=1000)
    aboveSma20: bool = False
    aboveSma50: bool = False
    aboveSma200: bool = False
    fnoOnly: bool = False
    etfOnly: bool = False
    sort: MarketSortKey = "mcap_desc"
    view: MarketView = "table"

    @field_validator("sectors", "capTiers")
    @classmethod
    def _dedupe(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(values))

    @field_validator("sectors")
    @classmethod
    def _sector_lengths(cls, values: list[str]) -> list[str]:
        for value in values:
            if not 1 <= len(value) <= 64:
                raise ValueError("each sector must be 1..64 characters")
        return values

    @model_validator(mode="after")
    def _bounds_ordered(self) -> "MarketFiltersV1":
        for low, high in (
            ("priceMin", "priceMax"),
            ("dayChangeMin", "dayChangeMax"),
            ("mcapMinCr", "mcapMaxCr"),
            ("rsiMin", "rsiMax"),
            ("relVolMin", "relVolMax"),
        ):
            lo, hi = getattr(self, low), getattr(self, high)
            if lo is not None and hi is not None and lo > hi:
                raise ValueError(f"{low} must be <= {high}")
        return self


FIELD_NAMES: frozenset[str] = frozenset(MarketFiltersV1.model_fields)
#: The plan sketch nested the filter fields; the shipped v1 is flat. Accept the
#: nested shape on read/write so a payload from either build still restores.
NESTED_FILTERS_KEY = "filters"


def flatten_market_config(raw: dict[str, Any]) -> dict[str, Any]:
    """Merge a nested ``filters`` object onto its parent, flat field winning.

    A top-level ``universe`` stays authoritative, matching the frontend adapter
    (``useMarketConfig.parseMarketConfig``).
    """
    nested = raw.get(NESTED_FILTERS_KEY)
    if not isinstance(nested, dict):
        return {k: v for k, v in raw.items() if k != NESTED_FILTERS_KEY}
    merged = {**nested, **{k: v for k, v in raw.items() if k != NESTED_FILTERS_KEY}}
    if isinstance(raw.get("universe"), str):
        merged["universe"] = raw["universe"]
    return merged


def default_market_filters_payload() -> dict[str, Any]:
    return MarketFiltersV1().model_dump()


def _unknown_market_keys(config: dict[str, Any]) -> list[str]:
    """Keys this scope must never store, at the top level or inside ``filters``."""
    unknown = set(config) - FIELD_NAMES - {NESTED_FILTERS_KEY}
    nested = config.get(NESTED_FILTERS_KEY)
    if isinstance(nested, dict):
        unknown |= set(nested) - FIELD_NAMES
    return sorted(unknown)


class TableSortV1(BaseModel):
    """One TanStack sort entry, with the column id bounded to a sane key."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    desc: bool = False


class TablePrefsV1(BaseModel):
    """Column preferences shared by every ``table.<id>`` scope.

    ``extra="forbid"`` is the second line of defence after ``_unknown_table_keys``:
    a typo in a writer must never be smuggled into the blob.
    """

    model_config = ConfigDict(extra="forbid")

    sorting: list[TableSortV1] = Field(default_factory=list, max_length=10)
    order: list[str] = Field(default_factory=list, max_length=200)
    hidden: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("order", "hidden")
    @classmethod
    def _column_id_lengths(cls, values: list[str]) -> list[str]:
        for value in values:
            if not 1 <= len(value) <= 64:
                raise ValueError("each column id must be 1..64 characters")
        return values


TABLE_FIELD_NAMES: frozenset[str] = frozenset(TablePrefsV1.model_fields)
#: A table id is lowercase/digits with dot, underscore or dash separators; the
#: leading char after ``table.`` cannot be a separator. ``table.`` is 6 chars and
#: the leading id char is 1, so a tail of at most 57 caps the whole scope at 64 —
#: the width of ``user_saved_configs.scope`` (VARCHAR(64)). SQLite ignores the
#: length, but Postgres rejects a longer value, so the bound is enforced here.
TABLE_SCOPE_RE = re.compile(r"^table\.[a-z0-9][a-z0-9._-]{0,57}$")


def default_table_prefs_payload() -> dict[str, Any]:
    return TablePrefsV1().model_dump()


def _unknown_table_keys(config: dict[str, Any]) -> list[str]:
    return sorted(set(config) - TABLE_FIELD_NAMES)


@dataclass(frozen=True)
class ScopeSpec:
    scope: str
    version: int
    schema: type[BaseModel]
    default: Callable[[], dict[str, Any]]
    max_bytes: int
    unknown_keys: Callable[[dict[str, Any]], list[str]]


SCOPE_REGISTRY: dict[str, ScopeSpec] = {
    "market.filters": ScopeSpec(
        scope="market.filters",
        version=1,
        schema=MarketFiltersV1,
        default=default_market_filters_payload,
        max_bytes=MAX_CONFIG_BYTES,
        unknown_keys=_unknown_market_keys,
    ),
}


class ConfigEnvelope(BaseModel):
    scope: str
    version: int
    saved: bool
    updated_at: Optional[str] = None
    config: dict[str, Any]
    # Absent (not null) on a clean read so the envelope has one shape per case.
    warning: Annotated[Optional[str], Field(exclude_if=lambda v: v is None)] = None


class PutConfigRequest(BaseModel):
    config: dict[str, Any]
    version: Optional[int] = None


class DeleteResponse(BaseModel):
    scope: str
    deleted: bool


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _spec_or_none(scope: str) -> Optional[ScopeSpec]:
    spec = SCOPE_REGISTRY.get(scope)
    if spec is not None:
        return spec
    if TABLE_SCOPE_RE.fullmatch(scope):
        return ScopeSpec(
            scope=scope,
            version=1,
            schema=TablePrefsV1,
            default=default_table_prefs_payload,
            max_bytes=MAX_CONFIG_BYTES,
            unknown_keys=_unknown_table_keys,
        )
    return None


def _unknown_scope() -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "unknown_scope"})


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _compact_bytes(payload: dict[str, Any]) -> int:
    return len(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def _normalize_for_read(spec: ScopeSpec, raw: Any) -> Optional[dict[str, Any]]:
    """Best-effort coerce a stored payload; ``None`` means "unreadable"."""
    if not isinstance(raw, dict):
        return None
    cleaned = flatten_market_config(raw)

    # Item-wise sanitising, not whole-payload rejection: one stale cap tier or
    # a non-string sector must not cost the user every other filter.
    tiers = cleaned.get("capTiers")
    if isinstance(tiers, list):
        cleaned["capTiers"] = [t for t in tiers if isinstance(t, str) and t in CAP_TIERS]
    sectors = cleaned.get("sectors")
    if isinstance(sectors, list):
        cleaned["sectors"] = [s for s in sectors if isinstance(s, str)]

    try:
        return spec.schema.model_validate(cleaned).model_dump()
    except ValidationError:
        return None


def _envelope(
    spec: ScopeSpec,
    config: dict[str, Any],
    *,
    saved: bool,
    updated_at: Optional[datetime] = None,
    warning: Optional[str] = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "scope": spec.scope,
        "version": spec.version,
        "saved": saved,
        "updated_at": _iso(updated_at),
        "config": config,
    }
    if warning:
        payload["warning"] = warning
    return payload


def _get_row(db: Session, user_id: int, scope: str):
    from db.models import UserSavedConfig

    return (
        db.query(UserSavedConfig)
        .filter(
            UserSavedConfig.user_id == user_id,
            UserSavedConfig.scope == scope,
            UserSavedConfig.name == DEFAULT_SLOT,
        )
        .first()
    )


def _current_envelope(db: Session, spec: ScopeSpec, user_id: int) -> dict[str, Any]:
    """The GET envelope for a user/scope, without touching the row."""
    row = _get_row(db, user_id, spec.scope)
    if row is None:
        return _envelope(spec, spec.default(), saved=False)
    if row.version != spec.version:
        return _envelope(
            spec,
            spec.default(),
            saved=False,
            updated_at=row.updated_at,
            warning="invalid_saved_config",
        )
    normalized = _normalize_for_read(spec, row.config)
    if normalized is None:
        return _envelope(
            spec,
            spec.default(),
            saved=False,
            updated_at=row.updated_at,
            warning="invalid_saved_config",
        )
    return _envelope(spec, normalized, saved=True, updated_at=row.updated_at)


def _parse_dt(text: str) -> Optional[datetime]:
    candidate = text.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _etag_matches(if_match: str, row) -> bool:
    """Compare a client revision against the row, tolerating ETag quoting."""
    candidate = if_match.strip()
    if candidate.startswith("W/"):
        candidate = candidate[2:].strip()
    if len(candidate) >= 2 and candidate.startswith('"') and candidate.endswith('"'):
        candidate = candidate[1:-1]

    if row is None or row.updated_at is None:
        return False
    stored = row.updated_at
    if candidate == _iso(stored):
        return True
    if stored.tzinfo is None:
        stored = stored.replace(tzinfo=timezone.utc)
    sent = _parse_dt(candidate)
    return sent is not None and sent == stored


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


@router.get("/{scope}", response_model=ConfigEnvelope, summary="Read saved config for a scope")
def get_user_config(
    scope: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> Any:
    """Read the saved payload for a scope, falling back to defaults."""
    spec = _spec_or_none(scope)
    if spec is None:
        return _unknown_scope()
    return _current_envelope(db, spec, user.id)


@router.put("/{scope}", response_model=ConfigEnvelope, summary="Save config for a scope")
def put_user_config(
    scope: str,
    body: PutConfigRequest,
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> Any:
    """Upsert the saved payload for a scope (default slot only)."""
    spec = _spec_or_none(scope)
    if spec is None:
        return _unknown_scope()

    size = _compact_bytes(body.config)
    if size > spec.max_bytes:
        return JSONResponse(
            status_code=422,
            content={"detail": "config_too_large", "max_bytes": spec.max_bytes},
        )

    unknown = spec.unknown_keys(body.config)
    if unknown:
        return JSONResponse(status_code=422, content={"detail": "unknown_key", "keys": unknown})

    if body.version is not None and body.version != spec.version:
        return JSONResponse(
            status_code=422,
            content={
                "detail": "version_mismatch",
                "expected": spec.version,
                "got": body.version,
            },
        )

    try:
        normalized = spec.schema.model_validate(flatten_market_config(body.config)).model_dump()
    except ValidationError as exc:
        return JSONResponse(
            status_code=422,
            content={
                "detail": "invalid_config",
                "errors": [
                    {"loc": list(err.get("loc", ())), "msg": err.get("msg"), "type": err.get("type")}
                    for err in exc.errors()
                ],
            },
        )

    from db.models import UserSavedConfig

    row = _get_row(db, user.id, spec.scope)

    if if_match is not None and if_match.strip() not in ("", "*"):
        if not _etag_matches(if_match, row):
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "conflict",
                    "current": _current_envelope(db, spec, user.id),
                },
            )

    if row is None:
        row = UserSavedConfig(
            user_id=user.id,
            scope=spec.scope,
            name=DEFAULT_SLOT,
            config=normalized,
            version=spec.version,
        )
        # An explicit SAVEPOINT, not a bare flush: two tabs can both read "no
        # row" and both insert, and the loser must unwind only its own INSERT
        # (a session-wide rollback would discard unrelated work in flight).
        savepoint = db.begin_nested()
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            savepoint.rollback()
            row = _get_row(db, user.id, spec.scope)
            if row is None:
                raise
            row.config = normalized
            row.version = spec.version
    else:
        row.config = normalized
        row.version = spec.version

    db.commit()
    db.refresh(row)
    return _envelope(spec, normalized, saved=True, updated_at=row.updated_at)


@router.delete("/{scope}", response_model=DeleteResponse, summary="Delete saved config for a scope")
def delete_user_config(
    scope: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> Any:
    """Remove the saved payload for a scope. Idempotent: the goal is "no row"."""
    spec = _spec_or_none(scope)
    if spec is None:
        return _unknown_scope()

    row = _get_row(db, user.id, spec.scope)
    if row is None:
        return {"scope": spec.scope, "deleted": False}

    db.delete(row)
    db.commit()
    return {"scope": spec.scope, "deleted": True}
