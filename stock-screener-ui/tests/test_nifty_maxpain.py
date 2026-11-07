"""NiftyMaxPain — causal entry behaviour on synthetic ticks."""
from __future__ import annotations

from datetime import datetime, timedelta

from options_paper.strategies import build
from options_paper.tape import Tick

IST = None
try:
    from config import IST  # type: ignore
except Exception:  # pragma: no cover
    from datetime import timezone, timedelta as _td
    IST = timezone(_td(hours=5, minutes=30))


def make_ticks(spots, ce_ois, pe_ois, ce_prems, pe_prems, mp=22_700.0, start=None):
    start = start or datetime(2026, 10, 28, 10, 0, tzinfo=IST)
    out = []
    for i, spot in enumerate(spots):
        out.append(
            Tick(
                t=start + timedelta(minutes=i),
                spot=float(spot),
                atm_strike=22_700.0,
                ce_ltp=float(ce_prems[i]),
                pe_ltp=float(pe_prems[i]),
                ce_iv=15.0,
                pe_iv=16.0,
                expiry="2026-11-03",
                max_pain=float(mp),
                ce_oi=float(ce_ois[i]),
                pe_oi=float(pe_ois[i]),
            )
        )
    return out


def test_failed_hold_with_bear_flow_returns_pe_after_confirmation():
    n = 12
    # Touch at i=5 (spot 22,705, mp 22,700), then fail below mp-5.
    spots = [22_730] * 5 + [22_705, 22_692, 22_686, 22_680, 22_678, 22_675, 22_672]
    pe_oi = [40_000_000 + i * 80_000 for i in range(n)]   # puts bought
    ce_oi = [50_000_000] * n                               # calls flat
    pe_prem = [180 + i * 1.2 for i in range(n)]            # put premium bid
    ce_prem = [150 - i * 0.2 for i in range(n)]
    ticks = make_ticks(spots, ce_oi, pe_oi, ce_prem, pe_prem)
    strat = build("nifty_maxpain", lots=1)

    # Before the 5-minute confirmation: no signal.
    assert strat.entry_signal(5, ticks[5], ticks, {}) is None
    # At +5 min (i=10), the hold failed, price is below the TWAP and flow is bearish.
    sig = strat.entry_signal(10, ticks[10], ticks, {})
    assert sig is not None
    assert sig.opt == "PE"
    assert "lost" in sig.reason


def test_hold_with_bull_flow_is_disabled_by_default_and_opt_in():
    n = 12
    spots = [22_680] * 5 + [22_702, 22_706, 22_710, 22_714, 22_718, 22_722, 22_726]
    ce_oi = [50_000_000 + i * 80_000 for i in range(n)]    # calls bought
    pe_oi = [40_000_000] * n
    ce_prem = [150 + i * 1.2 for i in range(n)]
    pe_prem = [180 - i * 0.2 for i in range(n)]
    ticks = make_ticks(spots, ce_oi, pe_oi, ce_prem, pe_prem)

    default = build("nifty_maxpain", lots=1)
    for i in range(5, 11):
        assert default.entry_signal(i, ticks[i], ticks, {}) is None

    opt_in = build("nifty_maxpain", lots=1, allow_ce=True)
    sig = None
    for i in range(5, 11):
        sig = opt_in.entry_signal(i, ticks[i], ticks, {}) or sig
    assert sig is not None
    assert sig.opt == "CE"


def test_no_entries_after_the_cutoff():
    n = 20
    spots = [22_730] * 5 + [22_705, 22_692, 22_686, 22_680, 22_678, 22_675, 22_672] + [22_670] * 8
    pe_oi = [40_000_000 + i * 80_000 for i in range(n)]
    ce_oi = [50_000_000] * n
    pe_prem = [180 + i * 1.2 for i in range(n)]
    ce_prem = [150 - i * 0.2 for i in range(n)]
    ticks = make_ticks(
        spots, ce_oi, pe_oi, ce_prem, pe_prem,
        start=datetime(2026, 10, 28, 14, 20, tzinfo=IST),
    )
    strat = build("nifty_maxpain", lots=1)
    # Touch at 14:25, confirmation would be 14:30 -> cutoff blocks the entry.
    for i in range(5, n):
        assert strat.entry_signal(i, ticks[i], ticks, {}) is None
