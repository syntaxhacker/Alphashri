"""Compatibility shims must remain exact aliases of the canonical week52 modules."""
from trading import week52_job_status, week52_range_lookup
from trading.week52 import job, ranges


def test_range_lookup_shim_is_canonical():
    assert week52_range_lookup.get_52w_range is ranges.get_52w_range
    assert week52_range_lookup.load_all_52w_ranges is ranges.load_all_52w_ranges
    assert week52_range_lookup._sanitize_52w_ranges_bulk is ranges.sanitize_bulk
    assert week52_range_lookup.SessionLocal is ranges.SessionLocal


def test_job_status_shim_is_canonical():
    assert week52_job_status.get_job_status is job.get_job_status
    assert week52_job_status.is_job_stale is job.is_job_stale
    assert week52_job_status.get_stale_threshold_sec is job.get_stale_threshold_sec
