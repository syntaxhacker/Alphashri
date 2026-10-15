"""Universe-scale symbol fan-out: threads for I/O, processes for CPU-bound work.

``watch.arm`` (computed ``near_52w``) and ``scripts/breakout_watch.py build``
fetch one daily frame per symbol and then run pure-Python detection over
~2,670 symbols. Under a ``ThreadPoolExecutor`` that detection is GIL-bound
(~1 core, ~10 min); the 1D candles themselves are already disk-cached per
session, so the win is running the *detection* on real cores via a
``ProcessPoolExecutor``.

Contract of :func:`run_symbols`:

* ``fn(symbol)`` is applied to every symbol; results come back in input order.
* ``use_processes=None`` (default) auto-picks: processes when the universe is
  large (``>= PROCESS_THRESHOLD``) *and* the platform forks (``os.fork``
  exists); threads otherwise. ``True``/``False`` force the mode.
* The worker ``fn`` must be **top-level (importable) / picklable** whenever
  processes may be used — ``functools.partial`` of a top-level function is
  fine, but lambdas and closures are not (they cannot cross the process
  boundary on spawn platforms).
* Never raises: pool errors fall back (processes → threads → sequential) and
  a per-symbol exception becomes ``None`` for that symbol. The chosen mode is
  logged, and :func:`run_symbols_with_mode` returns it alongside the results.

Fork-safety: forking a web server per request is unacceptable, so the FastAPI
``/watch`` path always uses threads (it passes ``use_processes=False``);
only CLIs pass ``use_processes=True``.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

log = logging.getLogger(__name__)

#: Auto-pick processes at/above this many symbols (when the platform forks).
PROCESS_THRESHOLD = 200

#: Valid ``run_symbols_with_mode`` mode strings.
RUN_MODES = ("sequential", "threads", "processes")

#: Hard ceiling for process pools (each worker re-imports pandas/numpy state).
#: Leave two cores free for the interactive API/UI and the OS so a universe
#: scan never saturates the box.
_MAX_WORKERS_CAP = max(1, (os.cpu_count() or 4) - 2)


def max_workers(cap: int = _MAX_WORKERS_CAP) -> int:
    """Worker count: ``min(os.cpu_count(), cap)`` (floor 1). Never raises."""
    try:
        cpu = os.cpu_count() or 1
    except Exception:
        cpu = 1
    try:
        cap = int(cap)
    except (TypeError, ValueError):
        cap = _MAX_WORKERS_CAP
    return max(1, min(int(cpu), max(1, cap)))


def supports_processes() -> bool:
    """True when the platform forks (auto-mode may pick processes)."""
    try:
        return hasattr(os, "fork")
    except Exception:
        return False


def _resolve_workers(n: int, workers) -> int:
    """Clamp ``workers`` to ``[1, n]``; default :func:`max_workers`."""
    try:
        w = int(workers) if workers is not None else max_workers()
    except (TypeError, ValueError):
        w = max_workers()
    return max(1, min(w, max(1, n)))


def _apply_one(task) -> tuple:
    """Top-level apply so the callable itself stays picklable: ``(ok, value)``.

    ``task`` is ``(fn, symbol)``; ``fn`` must be picklable on spawn platforms
    (top-level function or ``functools.partial`` of one). Never raises — a
    per-symbol exception becomes ``(False, None)``.
    """
    fn, symbol = task
    try:
        return (True, fn(symbol))
    except Exception:
        return (False, None)


def _unwrap(outcomes: list) -> tuple[list, int]:
    """Outcomes back to values (``None`` for failed items) + failure count."""
    values: list = []
    failed = 0
    for outcome in outcomes or []:
        try:
            ok, value = outcome
        except (TypeError, ValueError):
            ok, value = False, None
        if ok:
            values.append(value)
        else:
            values.append(None)
            failed += 1
    return values, failed


def _run_sequential(fn, symbols: list) -> tuple[list, int]:
    values = [_apply_one((fn, s)) for s in symbols]
    return _unwrap(values)


def _run_threads(fn, symbols: list, workers: int) -> tuple[list, int]:
    tasks = [(fn, s) for s in symbols]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        outcomes = list(pool.map(_apply_one, tasks))
    return _unwrap(outcomes)


def _run_processes(fn, symbols: list, workers: int) -> tuple[list, int]:
    tasks = [(fn, s) for s in symbols]
    chunksize = max(1, len(tasks) // (max(1, workers) * 4))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        outcomes = list(pool.map(_apply_one, tasks, chunksize=chunksize))
    return _unwrap(outcomes)


def run_symbols_with_mode(
    fn,
    symbols,
    *,
    workers=None,
    use_processes=None,
) -> tuple[list, str]:
    """Apply ``fn(symbol)`` to every symbol; ``(results, mode)`` in order.

    ``mode`` is one of ``"sequential"`` / ``"threads"`` / ``"processes"``.
    Sequential when there is 0-1 symbol or ``workers <= 1``; otherwise
    ``use_processes=True`` tries processes, ``False`` uses threads, and
    ``None`` auto-picks processes for ``len(symbols) >= PROCESS_THRESHOLD``
    on fork platforms. Any pool error falls back (processes → threads →
    sequential). Never raises.
    """
    syms = [str(s) for s in (symbols or [])]
    n = len(syms)
    if n == 0:
        return [], "sequential"
    w = _resolve_workers(n, workers)
    if w <= 1 or n == 1:
        values, failed = _run_sequential(fn, syms)
        mode = "sequential"
        log.info("run_symbols: mode=%s n=%d failed=%d", mode, n, failed)
        return values, mode
    if use_processes is None:
        want_processes = n >= PROCESS_THRESHOLD and supports_processes()
    else:
        want_processes = bool(use_processes)
    if want_processes:
        try:
            values, failed = _run_processes(fn, syms, w)
            log.info(
                "run_symbols: mode=processes n=%d workers=%d failed=%d",
                n, w, failed,
            )
            return values, "processes"
        except Exception as exc:
            log.warning(
                "run_symbols: process pool failed (%s); falling back to threads",
                exc,
            )
    try:
        values, failed = _run_threads(fn, syms, w)
        mode = "threads"
    except Exception as exc:
        log.warning(
            "run_symbols: thread pool failed (%s); falling back to sequential",
            exc,
        )
        values, failed = _run_sequential(fn, syms)
        mode = "sequential"
    log.info("run_symbols: mode=%s n=%d workers=%d failed=%d", mode, n, w, failed)
    return values, mode


def run_symbols(fn, symbols, *, workers=None, use_processes=None) -> list:
    """Apply ``fn(symbol)`` to every symbol; results in input order.

    See :func:`run_symbols_with_mode` for the mode contract. The chosen mode
    is logged. Never raises — pool errors fall back and per-symbol failures
    become ``None``.
    """
    values, _mode = run_symbols_with_mode(
        fn, symbols, workers=workers, use_processes=use_processes
    )
    return values
