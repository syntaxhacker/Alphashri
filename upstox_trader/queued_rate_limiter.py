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

# Max seconds a request waits for the 429 circuit breaker before failing fast.
# Short so a persistently-open circuit (Cloudflare block) fails each request
# quickly and the scan loop logs a skip rather than freezing the bot.
_CIRCUIT_WAIT_MAX = 10.0


class CircuitOpenError(requests.ConnectionError):
    """Raised when the shared 429 circuit breaker is open.

    Subclasses requests.ConnectionError so existing callers that catch
    requests.RequestException still handle it gracefully, but it is
    distinguishable so we do NOT count a circuit-skip as a fresh failure
    (otherwise 5 skips re-arm the circuit and it never recovers).
    """


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
        raising requests.Timeout.  Default 30s — kept short so a saturated
        window fails fast instead of freezing the caller (bots, scans).
        0 = no limit.
    """

    def __init__(
        self,
        max_workers: int = 5,
        max_pending: int = 0,
        max_wait_time: float = 30.0,
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
        """Wait briefly while the shared 429 circuit breaker is open.

        The circuit opens when Upstox/Cloudflare is 429-ing requests. We wait
        a short bounded time so a single blocked request doesn't hold a pool
        worker (or the caller) indefinitely; if it stays open we raise so the
        scan loop can record a skip and move on instead of freezing.
        """
        rl = self._thread_rl()
        deadline = time.time() + _CIRCUIT_WAIT_MAX
        while True:
            wait = rl.circuit_seconds_to_wait()
            if wait <= 0:
                return
            remaining = deadline - time.time()
            if remaining <= 0:
                raise CircuitOpenError(
                    "Upstox 429 circuit breaker open — request skipped to avoid "
                    "hammering a rate-limited endpoint"
                )
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
        # Always enforce a connect/read timeout so a blackholed endpoint
        # (e.g. Cloudflare WAF block) fails fast instead of freezing the
        # bot's scan loop indefinitely. Callers may override via kwargs.
        kwargs_copy.setdefault("timeout", 30)

        def _run() -> requests.Response:
            rl = self._thread_rl()
            deadline_start = time.time()
            try:
                self._wait_for_circuit()
                while not rl.acquire(timeout=3.0):
                    if time.time() - deadline_start > self._max_wait_time:
                        raise requests.Timeout(
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
            except CircuitOpenError:
                # The circuit was already open — this is NOT a new failure, so
                # don't record_failure() (5 skips would re-arm the circuit and
                # it would never recover even after Upstox clears the block).
                raise
            except requests.RequestException:
                # A failed request (incl. timeout) is not necessarily a 429,
                # but a hung connection often accompanies the Cloudflare block.
                # Record it so the circuit opens if the endpoint stays down.
                rl.record_failure()
                raise
            finally:
                with self._pending_lock:
                    self._pending_count -= 1

        try:
            future = self._executor.submit(_run)
        except BaseException:
            # If submit() itself raised (executor shut down), the pending count
            # was incremented but no worker will ever decrement it — the
            # backpressure loop above would then spin forever. _run's finally
            # has NOT executed here, so this is the only decrement.
            with self._pending_lock:
                self._pending_count -= 1
            raise
        return future.result()

    def shutdown(self, wait: bool = True):
        """Shut down the thread pool. Call on process exit."""
        self._executor.shutdown(wait=wait)