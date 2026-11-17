"""The checked-in presets.json is the single source of truth for Deep Value presets.

Locks three things: Python gates match the JSON, every gate key is understood by
the filter engine, and the generated TS artifact is byte-for-byte reproducible.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from api.value_scan.filters import KNOWN_KEYS, PRESETS, _PERCENTILE_GATES

REPO_ROOT = Path(__file__).resolve().parents[3]
PRESETS_JSON = REPO_ROOT / "api/value_scan/presets.json"
GENERATOR = REPO_ROOT / "scripts/gen_value_presets.py"
GENERATED_TS = REPO_ROOT / "src/api/valuePresets.generated.ts"

EXPECTED_IDS = ["SERIOUS", "DEEP", "GARP_VALUE", "YIELD", "TURNAROUND", "NO_GATE"]
# The E2E selects the DEEP option by the visible label "Deep" — changing it
# here must be a deliberate copy change, not a side effect of moving the data.
EXPECTED_LABELS = {
    "SERIOUS": "Serious",
    "DEEP": "Deep",
    "GARP_VALUE": "GARP Value",
    "YIELD": "Yield",
    "TURNAROUND": "Turnaround",
    "NO_GATE": "No gate",
}


def _specs() -> dict:
    return json.loads(PRESETS_JSON.read_text(encoding="utf-8"))


def test_preset_ids_and_labels_match_ui_copy():
    specs = _specs()
    assert list(specs) == EXPECTED_IDS
    assert {pid: spec["label"] for pid, spec in specs.items()} == EXPECTED_LABELS
    for spec in specs.values():
        assert spec["description"].strip()


def test_python_gates_match_json():
    """Parity: filters.py loads its gates from the same JSON the UI is generated from."""
    specs = _specs()
    assert set(PRESETS) == set(specs)
    for preset_id, spec in specs.items():
        assert PRESETS[preset_id] == spec["gates"]


def test_every_preset_gate_key_is_known():
    """A typo in the JSON must not silently become a no-op gate."""
    for preset_id, gates in PRESETS.items():
        unknown = set(gates) - KNOWN_KEYS
        assert not unknown, f"{preset_id} has unknown gate keys: {sorted(unknown)}"


def test_percentile_gates_stay_in_unit_range():
    """Percentile gates are 0..1 ranks; an out-of-range bound would pass nothing."""
    for preset_id, gates in PRESETS.items():
        for key in set(gates) & set(_PERCENTILE_GATES):
            assert 0.0 <= gates[key] <= 1.0, f"{preset_id}.{key} = {gates[key]}"


def test_generated_ts_is_current(tmp_path: Path):
    """Regenerate into a temp file and byte-compare with the checked-in artifact."""
    target = tmp_path / "valuePresets.generated.ts"
    result = subprocess.run(
        [sys.executable, str(GENERATOR), "--out", str(target)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert target.read_bytes() == GENERATED_TS.read_bytes()
