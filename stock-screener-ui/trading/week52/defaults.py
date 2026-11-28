"""Canonical 52W Chaser/Target parameter defaults.

Single source of truth for the live signal generators, the backtest strategies
and the UI parity tests. This module deliberately reads no environment
variables and imports no config/DB layer: these values are strategy contracts,
not runtime knobs.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ChaserDefaults:
    sl_pct: float = 2.0
    tp_pct: float = 3.0
    entry_threshold_pct: float = 3.0
    min_breakout_pct: float = 0.5
    enable_trailing_stop: bool = False
    trailing_stop_pct: float = 2.0
    trailing_activation_pct: float = 3.0
    max_holding_days: int = 30
    cooldown_days: int = 30

    # Ablation winners — deliberately not user-tunable.
    # ADX >= 25 is the optimal operating point; do not loosen it. The RSI upper
    # veto was loosened 70 -> 75 because the RSI>70 veto cost ~1.73pp profit per
    # noise trade avoided and is backwards for a momentum chaser. Volume >= 1.8x
    # the 20d average was the only positive single-setting gate. MA200/MA50 and
    # the RSI lower bound passed ~100% of candidates (zero discrimination) and
    # were removed. Filters stay off by default on every path.
    adx_min: float = 25.0
    rsi_hi: float = 75.0
    volume_mult: float = 1.8
    enable_filters: bool = False
    min_avg_volume: float = 50000
    recent_touch_days: int = 3


@dataclass(frozen=True)
class TargetDefaults:
    sl_pct: float = 2.0
    tp_pct: float = 0.0
    entry_threshold_pct: float = 2.0
    trailing_stop_pct: float = 2.0
    near_high_activation_pct: float = 1.0
    near_high_trail_pct: float = 0.5
    max_holding_days: int = 15
    cooldown_days: int = 7
    recent_touch_days: int = 5
    min_avg_volume: float = 50000


# Backward-compatible names for callers that imported the filter constants from
# trading.week52_chaser_signals before the defaults moved here.
CHASER_ADX_MIN = ChaserDefaults.adx_min
CHASER_RSI_HI = ChaserDefaults.rsi_hi
CHASER_VOLUME_MULT = ChaserDefaults.volume_mult
CHASER_ENABLE_FILTERS_DEFAULT = ChaserDefaults.enable_filters
