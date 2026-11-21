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
* **Unknown scope is rejected before any DB access *and before the body is
  validated***, so a typo can never create a row and can never surface as a
  client-side 422 (which the frontend treats as a permanent bug, not as
  "this build has no such scope").
* **A revision is a microsecond UTC timestamp written by Python, not by the
  database clock.** ``CURRENT_TIMESTAMP`` is second-resolution on SQLite, so two
  saves in the same second used to produce the same ``updated_at`` — the ETag a
  stale tab sent back then matched and its write silently won.

``market.filters`` v1 is a flat object — ``universe``, the market filter fields,
``sort``, ``view`` and ``colorBy`` at the same level — because the frontend adapter composes
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
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Callable, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.auth import get_current_user
from api.market_screen.config import ALL_CAP_TIERS, ALLOWED_UNIVERSES
from db.database import get_db

router = APIRouter(prefix="/api/user-configs", tags=["user-configs"])

DEFAULT_SLOT = ""
MAX_CONFIG_BYTES = 16 * 1024

# Built from the market-screen registry so a new universe/tier is picked up in
# one place. Runtime validation only — the public request/response models carry
# ``dict[str, Any]``, so these Literals are not exposed as OpenAPI enums.
MarketUniverse = Literal[tuple(ALLOWED_UNIVERSES)]  # type: ignore[valid-type]
CapTier = Literal[tuple(ALL_CAP_TIERS)]  # type: ignore[valid-type]
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
#: Accepts every id in the frontend ``MARKET_VIEW_OPTIONS`` (``MarketViewMode`` in
#: MarketMapView.tsx) plus the legacy ``map`` id. The frontend renamed ``map`` to
#: ``vis`` and now writes only canonical ids, but saved rows and ``?view=map``
#: links still carry the old spelling (normalised to ``vis`` on read), so ``map``
#: stays accepted on write.
#: ``tests/api/test_user_configs.py`` parses the TS registry to prove every
#: frontend id is covered. Runtime-only Literal (not an OpenAPI enum), but the
#: saved-config write path rejects anything outside it with ``invalid_config``.
MarketView = Literal["table", "map", "movers", "value", "vis"]
#: Mirrors ``MARKET_SIZE_METRIC_VALUES`` (marketTreemap.ts), the persisted
#: "Size by" wire set. The first five keep their order for backward compatibility.
#: ``tests/api/test_user_configs.py`` parses the TS declaration to prove parity.
MarketColorBy = Literal[
    "change_pct",
    "relative_volume",
    "rsi",
    "pos_52w",
    "market_cap",
    "adx",
    "perf_w",
    "perf_1m",
    "pe_ratio",
    "pb_ratio",
    "roe",
    "dividend_yield",
]

CAP_TIERS: frozenset[str] = frozenset(ALL_CAP_TIERS)


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
    capTiers: list[CapTier] = Field(default_factory=list, max_length=len(ALL_CAP_TIERS))
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
    colorBy: MarketColorBy = "change_pct"

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


class HomeWindowLayoutV1(BaseModel):
    """One named desk tab: its windows, each with geometry and panel settings.

    Deliberately permissive — this is the desk's own layout document, and a
    panel owns the shape of its `settings` bag (the frontend validates against
    the panel's schema and strips unknown keys before writing). The bounds here
    are about the *blob*: a window cannot claim enormous geometry and a layout
    cannot hold thousands of windows.
    """

    model_config = ConfigDict(extra="ignore")

    name: str = Field(default="Main", max_length=64)
    windows: list[dict[str, Any]] = Field(default_factory=list, max_length=64)


class HomeWindowV1(BaseModel):
    """The ``window.home`` scope: named desk tabs plus which one is active.

    Before this existed the desk posted here and received ``404 unknown_scope``,
    which the client treats as "config API absent — stay quiet". So the desk
    appeared to save and silently persisted nothing, geometry included.
    """

    model_config = ConfigDict(extra="ignore")

    #: Layout-document version marker the client stamps on every write. It is
    #: not used for routing (the envelope carries `version`) but rejecting it
    #: would 422 every desk save, which is how this was caught.
    v: int = Field(default=1, ge=1, le=99)
    active: str = Field(default="Main", max_length=64)
    layouts: list[HomeWindowLayoutV1] = Field(default_factory=list, max_length=32)


WINDOW_FIELD_NAMES: frozenset[str] = frozenset(HomeWindowV1.model_fields)


def default_home_window_payload() -> dict[str, Any]:
    return HomeWindowV1().model_dump()


def _unknown_window_keys(config: dict[str, Any]) -> list[str]:
    """Keys this scope must never store. Panels own their own `settings` bag."""
    return sorted(set(config) - WINDOW_FIELD_NAMES)


def default_table_prefs_payload() -> dict[str, Any]:
    return TablePrefsV1().model_dump()


class TableSortReadV1(TableSortV1):
    """Read-side sort entry: a newer build's extra keys must not lose the prefs."""

    model_config = ConfigDict(extra="ignore")


class TablePrefsReadV1(TablePrefsV1):
    """Read-side view of ``TablePrefsV1``.

    ``extra="forbid"`` belongs on the write path only. A row written by a newer
    build carries fields this build does not know yet; rejecting the whole
    payload would silently reset the user's sorting/order/hidden to defaults.
    """

    model_config = ConfigDict(extra="ignore")

    sorting: list[TableSortReadV1] = Field(default_factory=list, max_length=10)  # type: ignore[assignment]


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
    #: Read-only schema; ``None`` means reads and writes share ``schema``.
    read_schema: Optional[type[BaseModel]] = None


SCOPE_REGISTRY: dict[str, ScopeSpec] = {
    "market.filters": ScopeSpec(
        scope="market.filters",
        version=1,
        schema=MarketFiltersV1,
        default=default_market_filters_payload,
        max_bytes=MAX_CONFIG_BYTES,
        unknown_keys=_unknown_market_keys,
    ),
    # The HOME desk. Geometry plus each window's panel settings; without an
    # entry here every save 404s as `unknown_scope`, which the client treats as
    # "API absent" and swallows — the desk looked like it persisted and did not.
    "window.home": ScopeSpec(
        scope="window.home",
        version=1,
        schema=HomeWindowV1,
        default=default_home_window_payload,
        max_bytes=MAX_CONFIG_BYTES,
        unknown_keys=_unknown_window_keys,
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
            read_schema=TablePrefsReadV1,
        )
    return None


def _resolve_scope(scope: str) -> ScopeSpec:
    """The scope gate as a dependency, so it runs before the body is validated.

    An unknown scope must read as "this build has no such scope" (404) even when
    the request body is absent or malformed. A body-declared handler parameter is
    validated *before* the handler body, which turned the typo into a 422 — a code
    the frontend treats as a permanent client bug rather than a disabled feature.
    """
    spec = _spec_or_none(scope)
    if spec is None:
        raise HTTPException(status_code=404, detail="unknown_scope")
    return spec


def _iso(value: Optional[datetime]) -> Optional[str]:
    # isoformat() keeps the microseconds, which is what makes two saves in the
    # same second two distinct revisions.
    return value.isoformat() if value else None


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands back naive values; the column's contract is UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _next_revision(previous: Optional[datetime]) -> datetime:
    """A revision that advances on every write, independent of clock resolution.

    ``onupdate=func.now()`` is ``CURRENT_TIMESTAMP`` on SQLite, which has
    one-second resolution: two saves inside the same second produced the same
    ``updated_at``, so a stale tab's ``If-Match`` matched and its write won.
    Comparing against the stored value also covers a build that sets the column
    itself, or a clock that steps backwards.
    """
    prior = _as_utc(previous)
    now = _utcnow()
    if prior is not None and now <= prior:
        return prior + timedelta(microseconds=1)
    return now


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
        return (spec.read_schema or spec.schema).model_validate(cleaned).model_dump()
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
    """Compare a client revision against the row, tolerating ETag quoting.

    The stored revision is the whole identity of a version: two writes must never
    compare equal, so the comparison is on the exact microsecond value and never
    on a truncated (second-resolution) form.
    """
    candidate = if_match.strip()
    if candidate.startswith("W/"):
        candidate = candidate[2:].strip()
    if len(candidate) >= 2 and candidate.startswith('"') and candidate.endswith('"'):
        candidate = candidate[1:-1]

    if row is None or row.updated_at is None:
        return False
    stored = _as_utc(row.updated_at)
    if stored is None:
        return False
    if candidate == _iso(row.updated_at):
        return True
    sent = _parse_dt(candidate)
    return sent is not None and sent == stored


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


@router.get("/{scope}", response_model=ConfigEnvelope, summary="Read saved config for a scope")
def get_user_config(
    scope: str,
    user=Depends(get_current_user),
    spec: ScopeSpec = Depends(_resolve_scope),
    db: Session = Depends(get_db),
) -> Any:
    """Read the saved payload for a scope, falling back to defaults."""
    return _current_envelope(db, spec, user.id)


@router.put("/{scope}", response_model=ConfigEnvelope, summary="Save config for a scope")
def put_user_config(
    scope: str,
    body: PutConfigRequest,
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    user=Depends(get_current_user),
    spec: ScopeSpec = Depends(_resolve_scope),
    db: Session = Depends(get_db),
) -> Any:
    """Upsert the saved payload for a scope (default slot only)."""
    # The scope gate is a dependency, not an in-handler check: a dependency
    # resolves before a body-shape error is raised, so an unknown scope answers
    # 404 "unknown_scope" (a disabled feature) instead of 422 (a client bug).
    # Unparseable JSON still 422s — FastAPI rejects it before any dependency runs.
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

    # Explicit, microsecond-precision revision. The column's ``onupdate`` is a
    # database clock with one-second resolution on SQLite, which made two saves
    # in the same second indistinguishable to ``If-Match``. Assigning here wins
    # over ``onupdate``, so the ETag is decided by this write, not by the DB clock.
    revision = _next_revision(row.updated_at if row is not None else None)

    if row is None:
        row = UserSavedConfig(
            user_id=user.id,
            scope=spec.scope,
            name=DEFAULT_SLOT,
            config=normalized,
            version=spec.version,
            updated_at=revision,
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
            # The row we lost the race to may already carry a later revision;
            # recompute instead of reusing the value derived from "no row".
            row.updated_at = _next_revision(row.updated_at)
    else:
        row.config = normalized
        row.version = spec.version
        row.updated_at = revision

    db.commit()
    db.refresh(row)
    return _envelope(spec, normalized, saved=True, updated_at=row.updated_at)


@router.delete("/{scope}", response_model=DeleteResponse, summary="Delete saved config for a scope")
def delete_user_config(
    scope: str,
    user=Depends(get_current_user),
    spec: ScopeSpec = Depends(_resolve_scope),
    db: Session = Depends(get_db),
) -> Any:
    """Remove the saved payload for a scope. Idempotent: the goal is "no row"."""
    row = _get_row(db, user.id, spec.scope)
    if row is None:
        return {"scope": spec.scope, "deleted": False}

    db.delete(row)
    db.commit()
    return {"scope": spec.scope, "deleted": True}
