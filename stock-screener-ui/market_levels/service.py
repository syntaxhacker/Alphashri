"""I/O-free orchestration: registered detectors → fused LevelBook."""

from __future__ import annotations

import importlib
from typing import Any, Iterable, Optional

from .detectors import ADAPTER_MODULES
from .fusion import fuse_levels
from .models import Level, LevelBook
from .registry import iter_detectors, list_specs, register


def _ensure_adapters() -> None:
    """Load adapter lanes and restore registrations lost to ``clear_registry``."""
    for name in ADAPTER_MODULES:
        target = f"{__package__}.detectors.{name}"
        try:
            module = importlib.import_module(target)
        except ModuleNotFoundError as exc:
            missing = exc.name or ""
            if missing == target or missing.startswith(target + "."):
                continue
            raise
        spec = getattr(module, "SPEC", None)
        detect = getattr(module, "detect", None)
        if (
            spec is not None
            and detect is not None
            and spec.id not in {registered.id for registered in list_specs()}
        ):
            register(spec, detect)


def _options_block(option_rows: Any, spot: float) -> Optional[dict]:
    # Import stays inside the call so ``import market_levels`` never pulls in
    # the API layer. No logger here: on failure the key stays absent so an
    # adapter's own build_levels call surfaces the original exception.
    try:
        from api.options_levels import build_levels

        return build_levels(option_rows, spot)
    except Exception:
        return None


def _as_levels(result: Any) -> tuple[Level, ...]:
    if result is None:
        return ()
    if isinstance(result, Level):
        return (result,)
    if not isinstance(result, Iterable):
        raise TypeError(f"detector result must be a Level or iterable, got {type(result).__name__}")
    levels = tuple(result)
    for level in levels:
        if not isinstance(level, Level):
            raise TypeError(f"detector must yield Level instances, got {type(level).__name__}")
    return levels


def build_level_book(
    symbol: str,
    timeframe: str,
    as_of: str,
    *,
    candles: Any = None,
    pivot_hlc: Optional[dict] = None,
    option_rows: Any = None,
    spot: Optional[float] = None,
    session: Any = None,
    market: Any = None,
    ctx: Optional[dict] = None,
    use_adapters: bool = True,
) -> LevelBook:
    """Run every applicable detector and fuse its levels into a LevelBook."""
    if use_adapters:
        _ensure_adapters()

    detector_ctx: dict[str, Any] = {
        "symbol": symbol,
        "timeframe": timeframe,
        "as_of": as_of,
    }
    inputs = {
        "candles": candles,
        "pivot_hlc": pivot_hlc,
        "option_rows": option_rows,
        "spot": spot,
        "session": session,
        "market": market,
    }
    detector_ctx.update(inputs)
    if ctx is not None:
        detector_ctx.update(ctx)
    detector_ctx = {
        name: value for name, value in detector_ctx.items() if value is not None
    }

    if (
        detector_ctx.get("option_rows") is not None
        and detector_ctx.get("spot") is not None
        and "options_levels" not in detector_ctx
    ):
        raw = _options_block(detector_ctx["option_rows"], detector_ctx["spot"])
        if raw is not None:
            detector_ctx["options_levels"] = raw

    levels: list[Level] = []
    for spec, fn in iter_detectors():
        if any(name not in detector_ctx for name in spec.required_inputs):
            continue
        levels.extend(_as_levels(fn(detector_ctx)))

    effective_spot = detector_ctx.get("spot", spot)
    fused = fuse_levels(levels, spot=effective_spot)
    return LevelBook(
        symbol=symbol,
        timeframe=timeframe,
        as_of=as_of,
        spot=effective_spot,
        levels=fused,
    )
