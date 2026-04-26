"""Unit tests for trading/pivot_utils.py."""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from trading.pivot_utils import calculate_pivot_points, PivotPoints


class TestPivotPointsDataclass:
    """Tests for PivotPoints dataclass."""

    def test_creation(self):
        pp = PivotPoints(pp=100.0, r1=102.0, r2=104.0, r3=106.0, s1=98.0, s2=96.0, s3=94.0)
        assert pp.pp == 100.0
        assert pp.r1 == 102.0
        assert pp.r2 == 104.0
        assert pp.r3 == 106.0
        assert pp.s1 == 98.0
        assert pp.s2 == 96.0
        assert pp.s3 == 94.0
        assert pp.r4 is None
        assert pp.s4 is None

    def test_with_r4_s4(self):
        pp = PivotPoints(
            pp=100.0, r1=102.0, r2=104.0, r3=106.0, r4=110.0,
            s1=98.0, s2=96.0, s3=94.0, s4=90.0
        )
        assert pp.r4 == 110.0
        assert pp.s4 == 90.0


class TestCalculatePivotPoints:
    """Tests for calculate_pivot_points function."""

    def test_classic_pivot_basic(self):
        """Test classic pivot point calculation."""
        prev_high = 100
        prev_low = 80
        prev_close = 90
        points = calculate_pivot_points(prev_high, prev_low, prev_close, pivot_type="classic")
        # PP = (H+L+C)/3
        assert points.pp == 90.0
        # R1 = 2*PP - L
        assert points.r1 == 100.0
        # S1 = 2*PP - H
        assert points.s1 == 80.0
        # R2 = PP + (H-L)
        hl = prev_high - prev_low  # 20
        assert points.r2 == 90.0 + 20 == 110.0
        # S2 = PP - (H-L)
        assert points.s2 == 90.0 - 20 == 70.0
        # R3 = H + 2*(PP - L)
        assert points.r3 == prev_high + 2 * (points.pp - prev_low) == 100 + 2*(90-80) == 120.0
        # S3 = L - 2*(H - PP)
        assert points.s3 == prev_low - 2 * (prev_high - points.pp) == 80 - 2*(100-90) == 60.0
        # R4, S4 not included
        assert points.r4 is None
        assert points.s4 is None

    def test_fibonacci_pivot(self):
        """Test Fibonacci pivot calculation."""
        prev_high = 100
        prev_low = 80
        prev_close = 90
        points = calculate_pivot_points(prev_high, prev_low, prev_close, pivot_type="fibonacci")
        pp = (100+80+90)/3  # 90
        assert points.pp == pytest.approx(pp, rel=1e-9)
        hl = 20
        # R1 = PP + 0.382*hl
        assert points.r1 == pytest.approx(pp + 0.382*hl, rel=1e-9)
        # S1 = PP - 0.382*hl
        assert points.s1 == pytest.approx(pp - 0.382*hl, rel=1e-9)
        # R2 = PP + 0.618*hl
        assert points.r2 == pytest.approx(pp + 0.618*hl, rel=1e-9)
        # S2 = PP - 0.618*hl
        assert points.s2 == pytest.approx(pp - 0.618*hl, rel=1e-9)
        # R3 = PP + 1.000*hl
        assert points.r3 == pytest.approx(pp + hl, rel=1e-9)
        # S3 = PP - 1.000*hl
        assert points.s3 == pytest.approx(pp - hl, rel=1e-9)
        assert points.r4 is None
        assert points.s4 is None

    def test_camarilla_pivot(self):
        """Test Camarilla pivot calculation."""
        prev_high = 100
        prev_low = 80
        prev_close = 90
        points = calculate_pivot_points(prev_high, prev_low, prev_close, pivot_type="camarilla")
        pp = (100+80+90)/3  # 90
        assert points.pp == pytest.approx(pp, rel=1e-9)
        hl = 20
        # Camarilla uses close as base
        # R1 = C + hl * 1.1/12
        r1 = prev_close + hl * 1.1 / 12
        assert points.r1 == pytest.approx(r1, rel=1e-9)
        # R2 = C + hl * 1.1/6
        r2 = prev_close + hl * 1.1 / 6
        assert points.r2 == pytest.approx(r2, rel=1e-9)
        # R3 = C + hl * 1.1/4
        r3 = prev_close + hl * 1.1 / 4
        assert points.r3 == pytest.approx(r3, rel=1e-9)
        # R4 = C + hl * 1.1/2
        r4 = prev_close + hl * 1.1 / 2
        assert points.r4 == pytest.approx(r4, rel=1e-9)
        # S1 = C - hl * 1.1/12
        s1 = prev_close - hl * 1.1 / 12
        assert points.s1 == pytest.approx(s1, rel=1e-9)
        # S2 = C - hl * 1.1/6
        s2 = prev_close - hl * 1.1 / 6
        assert points.s2 == pytest.approx(s2, rel=1e-9)
        # S3 = C - hl * 1.1/4
        s3 = prev_close - hl * 1.1 / 4
        assert points.s3 == pytest.approx(s3, rel=1e-9)
        # S4 = C - hl * 1.1/2
        s4 = prev_close - hl * 1.1 / 2
        assert points.s4 == pytest.approx(s4, rel=1e-9)

    def test_unknown_type_falls_back_to_classic(self):
        """Unknown pivot_type defaults to classic."""
        prev_high = 100
        prev_low = 80
        prev_close = 90
        points = calculate_pivot_points(prev_high, prev_low, prev_close, pivot_type="woodie")
        # Classic values
        assert points.pp == 90.0
        assert points.r1 == 100.0
        assert points.s1 == 80.0
        assert points.r2 == 110.0
        assert points.s2 == 70.0
        assert points.r3 == 120.0
        assert points.s3 == 60.0
        assert points.r4 is None
        assert points.s4 is None

    def test_zero_range(self):
        """Test when high equals low (zero range)."""
        prev_high = 100
        prev_low = 100
        prev_close = 100
        points = calculate_pivot_points(prev_high, prev_low, prev_close)
        assert points.pp == 100.0
        assert points.r1 == 100.0  # 2*100 - 100 = 100
        assert points.s1 == 100.0
        assert points.r2 == 100.0  # PP + (0)
        assert points.s2 == 100.0
        assert points.r3 == 100.0  # H + 2*(PP-L) = 100 + 2*0 =100
        assert points.s3 == 100.0

    def test_negative_values(self):
        """Test with unusual but valid negative prices (unlikely but test robustness)."""
        prev_high = -10
        prev_low = -20
        prev_close = -15
        points = calculate_pivot_points(prev_high, prev_low, prev_close)
        pp = (-10 -20 -15)/3  # -15
        assert points.pp == pytest.approx(pp, rel=1e-9)
        hl = 10
        assert points.r1 == pytest.approx(2*pp - prev_low, rel=1e-9)  # -30 - (-20) = -10? Wait compute: 2*(-15) - (-20) = -30 +20 = -10
        assert points.s1 == pytest.approx(2*pp - prev_high, rel=1e-9)  # -30 - (-10) = -20
        # Should work without errors

    def test_rounding(self):
        """Test that results are not rounded (they are floats)."""
        prev_high = 100.123
        prev_low = 80.456
        prev_close = 90.789
        points = calculate_pivot_points(prev_high, prev_low, prev_close, pivot_type="fibonacci")
        # Check that we get floating point results
        assert isinstance(points.pp, float)
        # The test_signal_generators.py rounds the results when returning as dict, but pivot_utils returns raw floats.
        # So we can verify raw values
        expected_pp = (100.123+80.456+90.789)/3
        assert abs(points.pp - expected_pp) < 1e-9


class TestEdgeCases:
    """Edge case tests."""

    def test_very_large_numbers(self):
        """Test with large price values."""
        prev_high = 1e9
        prev_low = 0.9e9
        prev_close = 0.95e9
        points = calculate_pivot_points(prev_high, prev_low, prev_close)
        assert points.pp == pytest.approx(0.95e9, rel=1e-9)
        # Verify without overflow

    def test_small_numbers(self):
        """Test with very small price values."""
        prev_high = 0.001
        prev_low = 0.0005
        prev_close = 0.0008
        points = calculate_pivot_points(prev_high, prev_low, prev_close)
        assert points.pp == pytest.approx((0.001+0.0005+0.0008)/3, rel=1e-9)
