"""
In-process request queue with global rate limiting.

When the rate limit window is full, requests are queued and executed
in FIFO order as capacity opens up — no more RateLimitExceeded errors.

Uses a ThreadPoolExecutor so the rate-limited dispatch happens on a
bounded set of workers while the global Redis-backed rate limiter
(UpstoxRateLimiter) governs the actual throughput across processes.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import requests

from upstox_trader.rate_limiter import UpstoxRateLimiter


class QueuedRateLimiter:
    """Rate limiter with a bounded in-process request queue.

    Submits HTTP requests through a thread pool where each worker
    blocks on ``UpstoxRateLimiter.acquire()`` until a rate-limit
    slot is available.  When the pool queue reaches ``max_pending``
    the caller blocks (backpressure) instead of dropping the request.

    Each worker thread gets its own ``UpstoxRateLimiter`` instance
    (via thread-local storage) so that ``cancel_last()`` tracks the
    correct timestamp — no cross-thread race on ``_last_added``.
    The Redis Lua script is still shared atomically across all
    threads via the same ``upstox:rl:hits`` key.

    Parameters
    ----------
    max_workers:
        How many HTTP requests can be in-flight at once.
    max_pending:
        How many requests may sit in the queue before caller-backpressure
        kicks in.  ``0`` means unbounded.
    max_wait_time:
        Maximum seconds a request can wait in the rate-limit queue before
        raising TimeoutError.  Default 300s (5 minutes).  0 = no limit.
    """

    def __init__(
        self,
        max_workers: int = 5,
        max_pending: int = 0,
        max_wait_time: float = 300.0,
    ):
        self._max_pending = max_pending
        self._max_wait_time = max_wait_time
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._tls = threading.local()
        self._pending_count = 0
        self._pending_lock = threading.Lock()

    def _thread_rl(self) -> UpstoxRateLimiter:
        """Return a thread-local UpstoxRateLimiter (one per worker)."""
        rl = getattr(self._tls, "rl", None)
        if rl is None:
            rl = UpstoxRateLimiter()
            self._tls.rl = rl
        return rl

    def _wait_for_circuit(self) -> None:
        """Block while the shared 429 circuit breaker is open (Cloudflare block).

        All processes share the cooldown via Redis, so when Upstox returns
        429 (Error 1015) they pause together instead of hammering the block.
        """
        rl = self._thread_rl()
        deadline = time.time() + max(self._max_wait_time, 1.0)
        while True:
            wait = rl.circuit_seconds_to_wait()
            if wait <= 0:
                return
            remaining = deadline - time.time()
            if remaining <= 0:
                return
            time.sleep(min(wait, remaining, 5.0))

    def execute(self, method: str, url: str, **kwargs) -> requests.Response:
        """Enqueue an HTTP request and wait for the response.

        Blocks the calling thread until:
        1. The shared 429 circuit breaker (if open) is cleared,
        2. A pool worker dequeues the request,
        3. A rate-limit slot is acquired (blocks on Redis Lua),
        4. The HTTP call completes.

        If ``max_pending > 0`` and the internal queue is full the
        caller blocks at the submission point (backpressure).
        """
        if self._max_pending > 0:
            while True:
                with self._pending_lock:
                    if self._pending_count < self._max_pending:
                        break
                time.sleep(0.05)

        with self._pending_lock:
            self._pending_count += 1

        kwargs_copy = dict(kwargs)

        def _run() -> requests.Response:
            rl = self._thread_rl()
            deadline_start = time.time()
            try:
                self._wait_for_circuit()
                while not rl.acquire(timeout=3.0):
                    if time.time() - deadline_start > self._max_wait_time:
                        raise TimeoutError(
                            f"Rate limit queue exceeded max wait time ({self._max_wait_time}s)"
                        )
                    time.sleep(0.5)
                response = requests.request(method, url, **kwargs_copy)
                if response.status_code == 429:
                    rl.cancel_last()
                    rl.record_failure()
                else:
                    rl.record_success()
                return response
            finally:
                with self._pending_lock:
                    self._pending_count -= 1

        return self._executor.submit(_run).result()

    def shutdown(self, wait: bool = True):
        """Shut down the thread pool. Call on process exit."""
        self._executor.shutdown(wait=wait)