"""In-process registry of market-level detectors.

Detector modules register themselves when imported; this module never imports
them, so the registry stays inert until a caller opts into adapter loading.
"""

from __future__ import annotations

from typing import Callable, Iterator

from .models import DetectorSpec

DETECTORS: list[tuple[DetectorSpec, Callable]] = []


def register(spec: DetectorSpec, fn: Callable) -> None:
    """Add a detector, replacing any earlier registration with the same id."""
    if not isinstance(spec, DetectorSpec):
        raise TypeError(f"spec must be a DetectorSpec, got {type(spec).__name__}")
    if not callable(fn):
        raise TypeError(f"fn must be callable, got {type(fn).__name__}")
    for index, (existing, _) in enumerate(DETECTORS):
        if existing.id == spec.id:
            DETECTORS[index] = (spec, fn)
            return
    DETECTORS.append((spec, fn))


def iter_detectors() -> Iterator[tuple[DetectorSpec, Callable]]:
    """Iterate a snapshot, so registration during iteration cannot disturb it."""
    return iter(tuple(DETECTORS))


def list_specs() -> list[DetectorSpec]:
    return [spec for spec, _ in DETECTORS]


def clear_registry() -> None:
    """Remove all registrations; adapter modules can re-register lazily."""
    DETECTORS.clear()
