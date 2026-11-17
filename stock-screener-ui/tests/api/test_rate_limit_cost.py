"""``TokenBucketLimiter`` variable-cost semantics.

The default cost stays one token, so every existing caller (the US chart route
and any plain ``check(key)``) is unaffected. A caller may pass ``cost>1`` to
reserve several tokens in one locked step; a denied call reports the whole
seconds until that many tokens are available again.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.rate_limit import TokenBucketLimiter  # noqa: E402


def test_default_cost_is_one_token():
    limiter = TokenBucketLimiter(3, 60.0)
    assert [limiter.check("ip") for _ in range(3)] == [(True, 0)] * 3
    allowed, retry_after = limiter.check("ip")
    assert allowed is False
    assert retry_after >= 1


def test_cost_one_spends_one_token():
    limiter = TokenBucketLimiter(5, 60.0)
    assert limiter.check("ip", cost=1) == (True, 0)  # 4 left
    assert limiter.check("ip", cost=4) == (True, 0)  # 0 left
    assert limiter.check("ip", cost=1)[0] is False


def test_cost_six_spends_six_tokens():
    limiter = TokenBucketLimiter(6, 60.0)
    assert limiter.check("ip", cost=6) == (True, 0)  # 0 left
    # A flat cost of 1 would still let this through; a real cost of 6 cannot.
    allowed, retry_after = limiter.check("ip", cost=1)
    assert allowed is False
    assert retry_after >= 1


def test_partial_budget_blocks_expensive_but_allows_cheap():
    limiter = TokenBucketLimiter(10, 60.0)
    assert limiter.check("ip", cost=6) == (True, 0)  # 4 left
    assert limiter.check("ip", cost=6)[0] is False
    assert limiter.check("ip", cost=4) == (True, 0)  # the remainder fits
    assert limiter.check("ip", cost=1)[0] is False


def test_retry_after_scales_with_cost():
    limiter = TokenBucketLimiter(30, 60.0)  # 0.5 tokens/s
    assert limiter.check("ip", cost=6, now=100.0) == (True, 0)  # 24 left
    assert limiter.check("ip", cost=30, now=108.0) == (False, 4)  # 28, need 30
    assert limiter.check("ip", cost=30, now=112.0) == (True, 0)  # refilled


def test_cost_is_per_key():
    limiter = TokenBucketLimiter(6, 60.0)
    assert limiter.check("a", cost=6) == (True, 0)
    assert limiter.check("b", cost=6) == (True, 0)
    assert limiter.check("a", cost=1)[0] is False


def test_cost_must_be_positive():
    limiter = TokenBucketLimiter(3, 60.0)
    with pytest.raises(ValueError):
        limiter.check("ip", cost=0)
    with pytest.raises(ValueError):
        limiter.check("ip", cost=-1)


def test_idle_buckets_are_evicted_but_active_retained():
    from api.rate_limit import _BUCKET_IDLE_WINDOWS

    window = 10.0
    limiter = TokenBucketLimiter(5, window)
    now = 1_000.0
    for i in range(50):
        limiter._buckets[f"old-{i}"] = (
            5.0, now - (_BUCKET_IDLE_WINDOWS + 1) * window,
        )
    limiter._buckets["active"] = (3.0, now)

    assert limiter.check("active", now=now) == (True, 0)
    assert "active" in limiter._buckets
    assert not any(k.startswith("old-") for k in limiter._buckets)


def test_bucket_map_is_capped_and_keeps_most_recent():
    from api.rate_limit import _BUCKET_MAX_ENTRIES

    limiter = TokenBucketLimiter(5, 60.0)
    now = 1_000.0
    # All recent (within the idle window) so only the hard cap prunes them.
    for i in range(_BUCKET_MAX_ENTRIES + 20):
        limiter._buckets[f"ip-{i}"] = (5.0, now - 1.0 + i * 1e-6)

    limiter.check("trigger", now=now)

    assert len(limiter._buckets) <= _BUCKET_MAX_ENTRIES
    assert "ip-0" not in limiter._buckets
    assert "trigger" in limiter._buckets


def test_idle_eviction_does_not_change_refill_cost_semantics():
    limiter = TokenBucketLimiter(30, 60.0)  # 0.5 tokens/s
    assert limiter.check("ip", cost=6, now=100.0) == (True, 0)  # 24 left
    # An unrelated long-idle key is swept on the next call; "ip" is untouched.
    limiter._buckets["stranger"] = (30.0, -1_000.0)
    assert limiter.check("ip", cost=30, now=108.0) == (False, 4)  # 28, need 30
    assert "stranger" not in limiter._buckets
    assert limiter.check("ip", cost=30, now=112.0) == (True, 0)  # refilled
