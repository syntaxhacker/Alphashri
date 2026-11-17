"""Single owner for option-chain numeric conventions.

Pure constants only — no I/O, no app imports, no side effects. Consumers import
from here instead of restating a literal, so every convention has exactly one
definition. None of these are tunables: they are data-verified guards and desk
conventions pinned by tests.

One difference is deliberate and must NOT be "unified":

* The surface uses a 1% *lower* bound (:data:`SURFACE_IV_MIN`) rather than the
  analytics 0% bound: a sub-1% print there is a dead strike, not a surface.
  Both paths share the same 100-point upper bound (:data:`IV_MAX` /
  :data:`SURFACE_IV_MAX`): a genuine high-vol stock prints 70–90, and the old
  60-point analytics cap silently discarded those legs.
* ``walls_near`` / near-wall panels use a 1% spot band (:data:`NEAR_BAND_PCT`),
  but the wall-erosion pin/break detector uses a deliberately narrower 0.25%
  band (:data:`WALLS_NEAR_PCT`). The audit found 1% and 0.25% literals scattered
  across modules; both are real and intentional, so they are named apart here.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# IV bands
# ---------------------------------------------------------------------------

#: Upper bound of a believable IV print for the chain and analytics paths
#: (smile fit, 25-delta risk reversal, ATM), in vol points. Dead strikes have
#: been observed printing 117 and 281 vol points; 100 rejects those artefacts
#: while keeping genuine high-vol stock prints (KAYNES front expiry prints
#: 79–83). Do not lower this to 60: it empties the analytics for high-vol names.
IV_MAX = 100.0

#: Lower bound of a usable IV print for analytics: a value must be *strictly
#: greater* than this. Upstox emits ``0`` for a dead strike — 0 means
#: "missing", never a 0% vol print, and is never zero-filled or interpolated.
IV_MIN = 0.0

#: The surface shares the 0..100 upper band but keeps a 1% lower bound.
#: Values above 100 on the chain are a bad greek or a stale quote; 60-100 is
#: a usable print for a high-vol stock. The upper bound is intentionally the
#: same as :data:`IV_MAX`; only the lower bound differs.
SURFACE_IV_MAX = 100.0

#: The surface's lower bound, 1% (a sub-1% print is a dead strike). Distinct
#: from the analytics :data:`IV_MIN`; kept here so the surface has one owner.
SURFACE_IV_MIN = 1.0

# ---------------------------------------------------------------------------
# Delta
# ---------------------------------------------------------------------------

#: The desk's 25-delta convention for the skew wings ("25-delta put/call").
#: Not a tunable.
DELTA_TARGET = 0.25

#: A leg only counts as a 25-delta wing when its ``|delta|`` lands in this band.
#: Without it the "nearest leg to 0.25" on a chain with a hole is a 0.005-delta
#: lottery ticket whose IV is noise.
DELTA_BAND = (0.15, 0.35)

# ---------------------------------------------------------------------------
# Spot-relative near bands
# ---------------------------------------------------------------------------

#: ``walls_near`` / near-wall panels: heaviest OI inside this fraction of spot
#: (1%), with a global top-N fallback when nothing lands in the band. Kept as a
#: fraction so it scales from NIFTY to SENSEX to a stock.
NEAR_BAND_PCT = 0.01

#: The wall-erosion pin/break detector uses a deliberately narrower 0.25% band
#: around max pain / the tracked wall. This is not the same band as
#: :data:`NEAR_BAND_PCT` (1%); the audit found the two values scattered as bare
#: literals and they must stay distinct.
WALLS_NEAR_PCT = 0.0025

#: Near-ATM ±5% window for gamma coverage (the ``gex_degraded`` metric). It is a
#: *coverage* window, not a *level-distance* gate: do not reuse
#: :data:`GEX_LEVEL_MAX_DIST_PCT` (same value, different meaning) for it.
NEAR_ATM_BAND_PCT = 0.05

# ---------------------------------------------------------------------------
# GEX gates — shared by options_levels and reports_api/nifty
# ---------------------------------------------------------------------------

#: Minimum ``|net_gex|`` for a strike to be reported as a support/resistance or
#: fuel level, as a share of the profile's largest ``|net_gex|``. Far-OTM wings
#: round to a few paise of Cr and are meaningless as levels.
GEX_LEVEL_MIN_SHARE = 0.10

#: Largest distance (as a share of spot) at which a support/resistance/fuel
#: level is accepted. A wing 5%+ away cannot pin or fuel the current move.
GEX_LEVEL_MAX_DIST_PCT = 0.05

#: Largest distance (as a share of spot) at which a cumulative-gamma zero
#: crossing is accepted as the flip level. The first strike cluster that
#: carries real exposure can "cross" far from spot without being a pivot.
GEX_FLIP_MAX_DIST_PCT = 0.05

# ---------------------------------------------------------------------------
# Thin-chain guard
# ---------------------------------------------------------------------------

#: A chain is thin when it has too few rows, too little total OI, or one leg
#: dominates. These gates keep a failed/empty chain out of the levels panel.
THIN_MIN_TOTAL_OI = 50_000
THIN_MIN_ROWS = 5
THIN_MAX_SINGLE_SHARE = 0.4

# ---------------------------------------------------------------------------
# Expiry / lots
# ---------------------------------------------------------------------------

#: Minimum DTE for the front expiry used by the calibration/probe analytics:
#: 0-DTE is excluded from the ATM-IV series and forward-cone checks.
DTE_FLOOR_DAYS = 1

#: NIFTY's contract lot. Prefer resolving the real lot for the underlying from
#: the instrument registry; this is the documented back-compat fallback used
#: by the shared GEX helpers. Upstox reports OI in units, so the lot is accepted
#: for signature compatibility but not applied to the exposure maths.
DEFAULT_LOT_SIZE = 65

# ---------------------------------------------------------------------------
# Multi-expiry analytics — ladder size + coverage floors
# ---------------------------------------------------------------------------

#: Default number of nearest expiries the analytics endpoint ladders over.
#: Three front months answer "what does the whole ladder say" without an
#: upstream burst; a desk convention pinned by the endpoint's public contract.
ANALYTICS_DEFAULT_EXPIRIES = 3

#: Hard cap on expiries one analytics request may ask for. Each extra expiry
#: reads another cached chain, so the ceiling keeps a poll burst bounded.
ANALYTICS_MAX_EXPIRIES = 6

#: Minimum share of legs carrying a valid IV before the analytics response is
#: trusted. Below 0.60 the smile/skew reads are too sparse, so the endpoint
#: raises the ``iv_coverage_below_60pct`` warning (wire code stays verbatim).
IV_COVERAGE_FLOOR = 0.60

#: Minimum fraction of near-ATM legs with finite, positive gamma before the GEX
#: read is clean. Below this the flip is only as good as its OI proxy, so the
#: endpoint raises ``gex_degraded``. Named for what it measures (gamma coverage),
#: not for the warning it happens to drive.
GAMMA_COVERAGE_FLOOR = 0.5
