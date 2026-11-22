# Fast local changed-test runner (backend)

`scripts/test/run_changed.py` picks the backend tests likely to be affected by
your diff and runs only those. It is a **local-only** speed tool — CI remains
the gate.

## Why local-only

- The full Python suite is ~9,200 cases and takes >15 minutes locally. Running
  it while the API/tape writer is live starves them and is too slow to give
  useful feedback (see `AGENTS.md` → *Running Targeted Tests (Fast)*).
- This script never starts a server, installs packages, reads API keys, or
  touches the network. It only calls `git diff`, reads files under `tests/`,
  and runs the selected pytest node ids.
- It intentionally does **not** change `pytest.ini`, the conftests, or CI. The
  marker expression is copied from `.github/workflows/test.yml`, and heavy
  paths are mirrored from `tests/conftest.py` / `pytest.ini` `norecursedirs`.
- It is a heuristic, not a correctness proof: a green run means the mapped
  tests pass, not that unrelated tests do. CI runs the full matrix.

## Usage

Run from `stock-screener-ui/` (the script resolves the project root from its
own path, so it also works from the repo root):

```bash
.venv/bin/python scripts/test/run_changed.py --dry-run       # show selection + commands, run nothing
.venv/bin/python scripts/test/run_changed.py --list          # node ids only, exit
.venv/bin/python scripts/test/run_changed.py                 # map + run
.venv/bin/python scripts/test/run_changed.py --from HEAD~1   # different diff base
.venv/bin/python scripts/test/run_changed.py --paths api/replay_api.py tests/api/test_replay_api.py
.venv/bin/python scripts/test/run_changed.py --full-if-empty # fall back to whole fast tier
```

| Flag | Meaning |
|---|---|
| `--from REF` | Diff base for `git diff --name-only REF...HEAD` (default `origin/develop`). |
| `--paths PATH [PATH ...]` | Use these paths instead of git. Comma-separated values and directories (expanded to `test_*.py`) are accepted. |
| `--dry-run` | Print changed files, reasons, node ids and the exact pytest commands, then exit. |
| `--list` | Print only the node ids and exit. |
| `--full-if-empty` | If nothing maps to the diff, run the whole fast tier instead. Without it, an empty selection is an **error** (exit 2) — never a silent zero-test run. |
| `--marker EXPR` | Override the `pytest -m` expression. |
| `--jobs N` / `-n N` | Override xdist workers; always capped at the available cores. Default `min(4, os.cpu_count())` (also capped by CPU affinity). |

## Mapping rules

Given the normalized changed paths, the mapper applies these rules; every
selected node id carries the reason it was picked (`--dry-run` shows them):

1. **Changed test files** — any changed `tests/**/test_*.py` is selected as-is.
2. **Exact stem match** — `api/foo.py` selects `tests/test_foo.py` and/or
   `tests/api/test_foo.py` when they exist. Example: `api/replay_api.py` →
   `tests/api/test_replay_api.py`.
3. **Importers / patch targets** — for each changed backend module (e.g.
   `api.value_scan.cache`), scan every test file for import statements
   (`import api.value_scan.cache`, `from api.value_scan import cache as …`) and
   for dotted strings used by `@patch(...)` / `monkeypatch.setattr(...)`. This
   is the "grep-based" rule and is what catches package submodules such as
   `api/value_scan/filters.py` → `tests/api/test_value_scan/test_filters.py`.
4. **Package `__init__` fan-out** — a changed `**/__init__.py` selects the
   tests co-located with that package (`api/value_scan/__init__.py` → all
   `tests/api/test_value_scan/test_*.py`; `api/__init__.py` → `tests/api/`).
5. **API route/model changes** — route modules (`APIRouter(...)`,
   `@router.get(...)`, names containing `router`/`routes`/`_api`), API models
   (`db/models*.py`, pydantic/response models), `api_server_fastapi.py` and
   `openapi.yaml` always force `tests/contract/test_openapi_sync.py`.
   That check runs in a **separate pytest invocation without `-m`**, because
   CI's marker expression excludes the `contract` category — otherwise the
   forced check would be silently deselected.
6. **Heavy categories are dropped** by path before selection
   (`tests/integration/`, `tests/contract/`, `tests/e2e/`,
   `tests/testcontainers/`, `tests/needs_review/`, `tests/backtest/`,
   `tests/strategies/`, root-level `tests/test_*_integration.py`) — with the
   forced OpenAPI check above as the single deliberate exception — and again
   by pytest via the marker expression.

Frontend (`src/`), scripts, docs and other non-backend paths are reported as
skipped; use vitest / `npx vitest run --changed` for those (see `TEST_RULES.md`).

### Marker expression

Default (from `.github/workflows/test.yml`, the tier that excludes the heavy
categories while keeping unmarked unit/API tests):

```text
not (slow or slow_testcontainers or integration or contract or e2e or testcontainers or postgres)
```

CI's PR gate also defines `unit and not slow`, but that is an *include* filter
that only sees marked tests (~660 of ~9,200). Most mapped tests are unmarked,
so using it here would silently drop nearly everything. Pass
`--marker "unit and not slow"` if you explicitly want that narrower view.

## Example (diff on `origin/develop...HEAD`)

`--dry-run` output for a representative diff includes:

```text
Selected node ids (79):
  tests/api/test_replay_api.py  <- exact stem of api/replay_api.py, imports/patches api.replay_api
  tests/api/test_value_scan/test_filters.py  <- imports/patches api.value_scan.filters
  tests/test_chart_patterns_scan.py  <- imports/patches chart_patterns.scan, changed test file
Forced contract check (1):
  tests/contract/test_openapi_sync.py  <- API route/model change api/value_scan/router.py ...
jobs=2  marker='not (slow or ... or postgres)'
```

## Tests for the mapping logic

`tests/test_run_changed_mapping.py` builds a fake tree under `pytest`'s
`tmp_path` and exercises all rules above. It is pure filesystem work — no git,
no pytest subprocess, no network:

```bash
.venv/bin/python -m pytest tests/test_run_changed_mapping.py -q
```
