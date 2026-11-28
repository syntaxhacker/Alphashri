"""Index lot and tick aliases must resolve to the canonical contract registry.

The audit found index contract literals restated while
``api.options_underlying.INDEX_CONTRACT_META`` claims to be the sole owner. In
``options_paper.spec`` three lots also carried stale values (BANKNIFTY 30
instead of 15, FINNIFTY 60 instead of 25, MIDCPNIFTY 120 instead of 50); the
tick table has since been aliased too, so both fields are proved field-by-field.
Each public alias now derives from the registry; any restatement fails here.
"""

from __future__ import annotations

import pytest

from api import options_conventions as conv
from api import options_underlying as ou
from api.reports_api import nifty_bursts, nifty_positioning
from options_paper import spec


def test_scalar_lot_aliases_are_the_canonical_nifty_lot():
    canonical = ou.INDEX_CONTRACT_META["NIFTY"]["lot_size"]
    assert canonical == 65
    assert conv.DEFAULT_LOT_SIZE == canonical
    assert nifty_positioning.NIFTY_LOT_SIZE == canonical
    assert nifty_bursts.NIFTY_LOT_SIZE == canonical


@pytest.mark.parametrize("symbol", sorted(ou.INDEX_CONTRACT_META))
def test_index_lots_alias_every_canonical_contract(symbol):
    assert spec.INDEX_LOTS[symbol] == ou.INDEX_CONTRACT_META[symbol]["lot_size"]


@pytest.mark.parametrize("symbol", sorted(ou.INDEX_CONTRACT_META))
def test_index_ticks_alias_every_canonical_contract(symbol):
    assert spec.TICK_SIZES[symbol] == ou.INDEX_CONTRACT_META[symbol]["tick_size"]


def test_spec_only_keeps_one_contract_outside_the_canonical_registry():
    assert set(ou.INDEX_CONTRACT_META) <= set(spec.INDEX_LOTS)
    assert set(spec.INDEX_LOTS) - set(ou.INDEX_CONTRACT_META) == {"NIFTYNXT50"}
