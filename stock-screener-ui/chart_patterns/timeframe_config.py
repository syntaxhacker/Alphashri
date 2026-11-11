"""DB-backed pattern timeframe visibility, ordering and custom specs."""
from __future__ import annotations

import re

from sqlalchemy import func

from chart_patterns.timeframes import (
    BUILTIN_TIMEFRAME_IDS,
    TFSpec,
    get_timeframe,
    register_timeframe,
    unregister_timeframe,
)
from db.database import SessionLocal
from db.models.chart_patterns import PatternTimeframeConfig


DEFAULT_DISABLED = {"3m", "2h"}

NATIVE_MINUTES = {1, 5, 10, 15, 30, 60, 240, 1440, 10080, 43200}

_ID_RE = re.compile(r"^[0-9]+[mhDWMY]$")

_session_factory = None

_order_cache: dict[str, int] | None = None
_configs_cache: list[dict] | None = None


class TimeframeExistsError(ValueError):
    """Raised when a timeframe id already exists."""


def set_session_factory(factory) -> None:
    global _session_factory
    _session_factory = factory
    _invalidate_caches()


def reset_session_factory() -> None:
    global _session_factory
    _session_factory = None
    _invalidate_caches()


def _new_session():
    return (_session_factory or SessionLocal)()


def _invalidate_caches() -> None:
    global _order_cache, _configs_cache
    _order_cache = None
    _configs_cache = None


def _order_index() -> dict[str, int]:
    global _order_cache
    if _order_cache is None:
        from chart_patterns.timeframes import TIMEFRAMES

        _order_cache = {spec.id: index for index, spec in enumerate(TIMEFRAMES)}
    return _order_cache


def _defaults_for(minutes: int) -> tuple[int, int]:
    if minutes <= 30:
        return 90, 60
    if minutes <= 240:
        return 365, 60
    if minutes <= 1440:
        return 730, 60
    if minutes <= 10080:
        return 1825, 52
    return 3650, 24


def _default_rows() -> list[dict]:
    return [
        {
            "id": tf_id,
            "enabled": tf_id not in DEFAULT_DISABLED,
            "sort_order": index,
        }
        for index, tf_id in enumerate(BUILTIN_TIMEFRAME_IDS)
    ]


def _merged(spec, enabled: bool, sort_order: int, custom: bool) -> dict:
    row = spec.to_dict()
    row["enabled"] = bool(enabled)
    row["sort_order"] = int(sort_order)
    row["custom"] = bool(custom)
    return row


def _spec_from_row(row: PatternTimeframeConfig) -> TFSpec | None:
    minutes = int(row.minutes or 0)
    if minutes <= 0:
        return None
    lookback, min_bars = _defaults_for(minutes)
    return TFSpec(
        id=row.id,
        label=row.label or row.id,
        minutes=minutes,
        native=bool(row.native),
        source_tf=row.source_tf or None,
        max_lookback_days=int(row.max_lookback_days or lookback),
        min_bars=int(row.min_bars or min_bars),
    )


def _close(session) -> None:
    try:
        session.close()
    except Exception:
        pass


def ensure_configs(session=None) -> None:
    """Insert defaults for missing built-in timeframes; never overwrite."""
    owns_session = session is None
    try:
        if session is None:
            session = _new_session()
        existing = {
            row.id for row in session.query(PatternTimeframeConfig).all()
        }
        for row in _default_rows():
            if row["id"] in existing:
                continue
            session.add(
                PatternTimeframeConfig(
                    id=row["id"],
                    enabled=row["enabled"],
                    sort_order=row["sort_order"],
                )
            )
        session.commit()
    except Exception:
        if session is not None:
            try:
                session.rollback()
            except Exception:
                pass
    finally:
        if owns_session and session is not None:
            _close(session)


def get_configs() -> list[dict]:
    global _configs_cache
    if _configs_cache is not None:
        return [dict(row) for row in _configs_cache]
    rows: dict = {}
    try:
        session = _new_session()
        try:
            ensure_configs(session)
            for row in session.query(PatternTimeframeConfig).all():
                rows[row.id] = row
        finally:
            _close(session)
    except Exception:
        rows = {}

    defaults = _default_rows()
    out: list[dict] = []
    for default in defaults:
        spec = get_timeframe(default["id"])
        row = rows.get(default["id"])
        if row is None:
            enabled = default["enabled"]
            sort_order = default["sort_order"]
        else:
            enabled = default["enabled"] if row.enabled is None else bool(row.enabled)
            sort_order = default["sort_order"] if row.sort_order is None else int(row.sort_order)
        out.append(_merged(spec, enabled, sort_order, False))

    for tf_id, row in rows.items():
        if tf_id in BUILTIN_TIMEFRAME_IDS:
            continue
        spec = _spec_from_row(row)
        if spec is None:
            continue
        register_timeframe(spec)
        enabled = True if row.enabled is None else bool(row.enabled)
        out.append(_merged(spec, enabled, int(row.sort_order or 0), True))

    index = _order_index()
    out.sort(key=lambda item: (item["sort_order"], index.get(item["id"], len(index))))
    _configs_cache = out
    return [dict(row) for row in out]


def enabled_timeframes() -> list[dict]:
    return [row for row in get_configs() if row.get("enabled")]


def enabled_timeframe_ids() -> list[str]:
    return [row["id"] for row in enabled_timeframes()]


def _optional_int(value, default: int) -> int:
    if value is None or value == "":
        return int(default)
    out = int(value)
    if out <= 0:
        raise ValueError("expected a positive integer")
    return out


def _auto_source(minutes: int, configs: list[dict]) -> str | None:
    candidates = [
        row for row in configs
        if row.get("enabled")
        and row.get("native")
        and int(row.get("minutes") or 0) > 0
        and int(row["minutes"]) < minutes
        and minutes % int(row["minutes"]) == 0
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda row: int(row["minutes"]))["id"]


def add_timeframe(payload: dict) -> dict:
    payload = dict(payload or {})
    tf_id = str(payload.get("id") or "").strip()
    if not _ID_RE.match(tf_id) or len(tf_id) > 8:
        raise ValueError(
            f"Invalid timeframe id {tf_id!r}; expected <number><m|h|D|W|M|Y>, e.g. 45m, 6h, 2D"
        )
    try:
        minutes = int(payload.get("minutes"))
    except (TypeError, ValueError):
        raise ValueError("minutes must be a positive integer") from None
    if minutes <= 0:
        raise ValueError("minutes must be a positive integer")

    configs = get_configs()
    if any(row["id"] == tf_id for row in configs):
        raise TimeframeExistsError(f"Timeframe {tf_id!r} already exists")

    label = str(payload.get("label") or tf_id).strip() or tf_id
    if len(label) > 16:
        raise ValueError("label must be 16 characters or fewer")
    default_lookback, default_bars = _defaults_for(minutes)
    max_lookback_days = _optional_int(payload.get("max_lookback_days"), default_lookback)
    min_bars = _optional_int(payload.get("min_bars"), default_bars)

    source_tf = str(payload.get("source_tf") or "").strip() or None
    native = False
    if source_tf is not None:
        source = next((row for row in configs if row["id"] == source_tf), None)
        if source is None:
            raise ValueError(f"Unknown source timeframe {source_tf!r}")
        source_minutes = int(source.get("minutes") or 0)
        if (
            source_minutes <= 0
            or minutes <= source_minutes
            or minutes % source_minutes != 0
        ):
            raise ValueError(
                f"{minutes}m is not a whole multiple of source {source_tf}"
            )
    elif minutes in NATIVE_MINUTES:
        native = True
    else:
        source_tf = _auto_source(minutes, configs)
        if source_tf is None:
            raise ValueError(f"No native source timeframe divides {minutes}m")

    spec = TFSpec(
        tf_id,
        label,
        minutes,
        native,
        source_tf,
        max_lookback_days,
        min_bars,
    )

    session = _new_session()
    try:
        ensure_configs(session)
        current_max = session.query(func.max(PatternTimeframeConfig.sort_order)).scalar()
        sort_order = int(current_max or 0) + 1
        row = PatternTimeframeConfig(
            id=tf_id,
            enabled=True,
            sort_order=sort_order,
            label=label,
            minutes=minutes,
            native=native,
            source_tf=source_tf,
            max_lookback_days=max_lookback_days,
            min_bars=min_bars,
        )
        session.add(row)
        session.commit()
    except Exception:
        try:
            session.rollback()
        except Exception:
            pass
        raise
    finally:
        _close(session)

    register_timeframe(spec)
    _invalidate_caches()
    return _merged(spec, True, sort_order, True)


def delete_timeframe(tf_id: str) -> str:
    tf_id = str(tf_id or "").strip()
    if tf_id in BUILTIN_TIMEFRAME_IDS:
        raise ValueError("Built-in timeframes cannot be deleted")
    if not any(row["id"] == tf_id for row in get_configs()):
        raise ValueError(f"Unknown timeframe {tf_id!r}")

    session = _new_session()
    try:
        ensure_configs(session)
        row = (
            session.query(PatternTimeframeConfig)
            .filter(PatternTimeframeConfig.id == tf_id)
            .first()
        )
        if row is None:
            raise ValueError(f"Unknown timeframe {tf_id!r}")
        session.delete(row)
        session.commit()
    except Exception:
        try:
            session.rollback()
        except Exception:
            pass
        raise
    finally:
        _close(session)

    unregister_timeframe(tf_id)
    _invalidate_caches()
    return tf_id


def set_enabled(tf_id: str, enabled: bool) -> dict:
    configs = get_configs()
    known = [row["id"] for row in configs]
    if tf_id not in known:
        raise ValueError(f"Unknown timeframe {tf_id!r}. Known: {known}")
    config = next(row for row in configs if row["id"] == tf_id)
    custom = tf_id not in BUILTIN_TIMEFRAME_IDS

    session = _new_session()
    try:
        ensure_configs(session)
        row = (
            session.query(PatternTimeframeConfig)
            .filter(PatternTimeframeConfig.id == tf_id)
            .first()
        )
        if row is None:
            row = PatternTimeframeConfig(
                id=tf_id,
                enabled=config["enabled"],
                sort_order=config["sort_order"],
            )
            if custom:
                row.label = config.get("label")
                row.minutes = config.get("minutes")
                row.native = config.get("native")
                row.source_tf = config.get("source_tf")
                row.max_lookback_days = config.get("max_lookback_days")
                row.min_bars = config.get("min_bars")
            session.add(row)
            session.flush()
        if not enabled:
            enabled_ids = {
                other.id
                for other in session.query(PatternTimeframeConfig)
                .filter(PatternTimeframeConfig.enabled.is_(True))
                .all()
            }
            enabled_ids.discard(tf_id)
            if not enabled_ids:
                raise ValueError("At least one timeframe must stay enabled")
        row.enabled = bool(enabled)
        session.commit()
        _invalidate_caches()
        return _merged(
            get_timeframe(tf_id), row.enabled, row.sort_order, custom
        )
    except Exception:
        try:
            session.rollback()
        except Exception:
            pass
        raise
    finally:
        _close(session)


def set_order(ids) -> list[dict]:
    ordered = [str(item) for item in (ids or [])]
    if len(set(ordered)) != len(ordered):
        raise ValueError("Duplicate timeframe ids in order")
    known = [row["id"] for row in get_configs()]
    unknown = [item for item in ordered if item not in known]
    if unknown:
        raise ValueError(f"Unknown timeframe {unknown[0]!r}. Known: {known}")
    position = {tf_id: index for index, tf_id in enumerate(known)}
    session = _new_session()
    try:
        ensure_configs(session)
        rows = {
            row.id: row for row in session.query(PatternTimeframeConfig).all()
            if row.id in position
        }
        remaining = sorted(
            (row for row in rows.values() if row.id not in set(ordered)),
            key=lambda row: ((row.sort_order or 0), position.get(row.id, 0)),
        )
        sequence = [rows[item] for item in ordered if item in rows] + remaining
        for index, row in enumerate(sequence):
            row.sort_order = index
        session.commit()
    except Exception:
        try:
            session.rollback()
        except Exception:
            pass
        raise
    finally:
        _close(session)
    _invalidate_caches()
    return get_configs()
