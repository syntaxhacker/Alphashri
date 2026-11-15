# Saved user configs — design plan (P1: Market screener filters)

Status: **plan, not implemented.** No source file was modified by this document.
Owner surface: Screener → Market tab (`/screener`).

---

## 0. Verified current state (what exists today)

| Fact | Evidence |
|---|---|
| Market filter shape is 18 fields: `search`, `capTiers: Set<string>`, 10 numeric bounds, 3 SMA toggles, `fnoOnly`, `etfOnly`, `sectors: string[]`, `sort` | `src/components/market/marketFilters.ts:37-60` |
| Defaults are a pure factory, already the single source of "no filters" | `marketFilters.ts:62-84` (`defaultMarketFilters`) |
| Sort keys are a closed union of 9 values, default `mcap_desc` | `marketFilters.ts:3-14` |
| The panel keeps `universe`, `search`, `filters`, `viewMode` (plus rail/drawer/selection) in **signals**, nothing is persisted | `MarketScreenerPanel.tsx:164-169` |
| `search` is a **separate signal** from `filters.search`; every consumer re-merges it (`{ ...filters(), search: search() }`) | `MarketScreenerPanel.tsx:165`, `:219`, `:229` |
| Only `view` is in the URL. `universe`, all filters, sort and search are not | `ScreenerPage.tsx:131` (`TAB_OWNED_PARAMS.market = ["view"]`), `:191`, `:504-505` |
| `view` is read once into the panel signal (`initialView`), and written back with `replace: true` | `MarketScreenerPanel.tsx:169`, `ScreenerPage.tsx:504-505` |
| Switching universe **resets filters and search** | `MarketScreenerPanel.tsx:194-205` |
| Switching to `movers` **clears search** | `MarketScreenerPanel.tsx:495-499` |
| Existing persistence precedent A — named config with JSON columns: `Screener(indicators, columns, filters, default_sort, is_active)`, unique `(user_id, name)` | `db/models/screener.py:6-18`, `db/models/base.py:127-149` (`UserOwnedConfigMixin`) |
| Existing persistence precedent B — named config with one opaque JSON blob: `ReplaySavedConfig(config)`, unique `(user_id, name)` | `db/models/replay_saved_config.py:6-13`, migration `db/migrations/versions/2026_05_23_1200-o1p2q3r4s5t6_create_replay_saved_configs.py` |
| CRUD precedent: `GET/POST/PUT/DELETE /api/screeners[/{id}]`, auth via `Depends(get_current_user)`, 404 on foreign owner, **soft delete** (`is_active = False`) | `api_server_fastapi.py:973-1110` |
| CRUD precedent: `GET/POST/DELETE /api/replay/configs` | `api/replay_api.py:142-215` |
| Auth helper and bearer scheme | `api/auth.py:40`, `api/auth.py:162` |
| Frontend authed fetch + shared `!ok` parser | `src/state/auth.ts:81-97`, `src/api/screeners.ts:8-12` |
| A stored-payload-is-garbage-must-not-render precedent: the market snapshot cache validates every field and **deletes** a bad entry instead of throwing | `src/api/marketScreener.ts:39-75` |
| Test harness: `auth_client` (user `test@example.com`) and `client` (no user) | `tests/api/conftest.py:100-120` |
| E2E harness: `setupApiMocks` + `loginAsTestUser`, market panel fully mocked | `tests/e2e/market-screener.spec.ts:1-20` |
| Alembic has exactly one head: `ev1a2b3c4d5e` (verified by computing revisions minus `down_revision`s across `db/migrations/versions/`) | `db/migrations/versions/2026_10_29_1200-ev1a2b3c4d5e_add_corporate_events.py` |

**Closest existing pattern to reuse:** the *shape* of `ReplaySavedConfig` (one row, one JSON blob, unique per user), promoted from "named preset" to "one default per scope". We do **not** invent a settings table: `Screener` is a preset list (many rows, user-named, soft-deleted) and is the wrong semantic for "the state I had last time".

`UserOwnedConfigMixin` already carries `id, user_id, name, description, created_at, updated_at` — the new model is that mixin plus three columns. Reuse it; do not fork a parallel base.

---

## 1. Goals / non-goals

### Goals
1. Reloading `/screener` restores the user's last Market filter state (universe, sectors, cap tiers, all numeric bounds, SMA/F&O/ETF toggles, sort).
2. State follows the **account across devices** (same login on another machine sees it).
3. Extensible by **registration only**: adding `deep-value.filters` or `report.layout` later is one registry entry + one adapter, no new table and no new endpoint.
4. Corrupt / stale / version-mismatched stored state can never break the tab — worst case it degrades to today's defaults.
5. A shared or bookmarked URL always wins over stored state.

### Non-goals (P1)
- Sharing configs between users (no public links, no read-by-id endpoint). P2.
- Named presets / a preset switcher. P2.
- Cross-device live sync (no WebSocket, no push). Reload or refocus only.
- Persisting `search`, selected symbol, dock state, rail-collapsed / drawer-open.
- Anonymous / logged-out persistence. The app is auth-gated; logged-out means defaults.
- Audit history of config changes.
- Moving existing `Screener` / `ReplaySavedConfig` rows into the new table.

---

## 2. Backend contract

### 2.1 Table

New file `db/models/user_saved_config.py`:

```python
class UserSavedConfig(UserOwnedConfigMixin, Base):
    __tablename__ = "user_saved_configs"
    # 1-line override of the mixin so the row dies with the user
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                     nullable=False, index=True)
    scope = Column(String(64), nullable=False)
    config = Column(JSON, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    # id, name, description, created_at, updated_at from UserOwnedConfigMixin
    __table_args__ = (
        UniqueConstraint("user_id", "scope", "name", name="uq_user_saved_config"),
        Index("ix_user_saved_configs_user_scope", "user_id", "scope"),
    )
```

**Why `name` exists in P1** even though P1 has exactly one row per scope: `''` is the reserved *default slot*. Presets in P2 are the same table with a non-empty `name` — no second table, no destructive migration, and the "restore on refresh" read stays a single-row lookup on `(user_id, scope, name='')`.

**Why `''` and not `NULL`:** `UNIQUE` treats `NULL`s as distinct in both SQLite and Postgres, so a nullable `name` would silently permit two "default" rows per scope and the read would become `ORDER BY updated_at LIMIT 1` — a race, not a constraint. Empty string is the only option that makes the constraint do the work.

**`version` is the payload schema version** (an int in `1..N` matching the registry), not optimistic locking. Locking uses `updated_at`.

### 2.2 DDL (portable form, SQLite + Postgres)

```sql
CREATE TABLE user_saved_configs (
    id          INTEGER      PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope       VARCHAR(64)  NOT NULL,
    name        VARCHAR(100) NOT NULL DEFAULT '',
    description VARCHAR(500),
    config      JSON         NOT NULL,
    version     INTEGER      NOT NULL DEFAULT 1,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_saved_config UNIQUE (user_id, scope, name)
);
CREATE INDEX ix_user_saved_configs_user_scope ON user_saved_configs (user_id, scope);
```

Postgres note: `sa.JSON()` maps to `json`. `JSONB` would be marginally better for indexing, but there is at most a handful of rows per user and nothing queries inside the blob — keep `sa.JSON` for dialect parity with `Screener`/`ReplaySavedConfig`. Recorded as open decision #9.

### 2.3 Alembic migration

- File: `db/migrations/versions/2026_11_15_1200-uc1a2b3c4d5e_add_user_saved_configs.py`
- `revision = 'uc1a2b3c4d5e'`
- `down_revision = 'ev1a2b3c4d5e'` (verified sole head)
- `upgrade()`: `op.create_table(...)` exactly as above + the index; `downgrade()`: `op.drop_table('user_saved_configs')`.
- Register the model in `db/models/__init__.py` (`from .user_saved_config import UserSavedConfig`, add to `__all__`) and in `db/migrations/env.py`'s model import list, or autogenerate drift appears later.
- Guard: `python scripts/validate_migrations.py` and `tests/contract/test_openapi_sync.py` must be green in the same commit. `db/database.py` runs `alembic upgrade head` at startup, so a broken chain takes the API down.

### 2.4 Scope registry + per-scope schema

New package `api/user_configs/`:

```
api/user_configs/__init__.py
api/user_configs/registry.py    # SCOPE_REGISTRY, ScopeSpec
api/user_configs/schemas.py     # MarketFiltersV1 + envelope models
api/user_configs/router.py      # APIRouter(prefix="/api/user-configs", tags=["user-configs"])
```

`registry.py`:

```python
@dataclass(frozen=True)
class ScopeSpec:
    scope: str            # "market.filters"
    version: int          # 1
    schema: type[BaseModel]
    default: Callable[[], dict]   # pure, no DB
    max_bytes: int        # 16384

SCOPE_REGISTRY: dict[str, ScopeSpec] = {
    "market.filters": ScopeSpec("market.filters", 1, MarketFiltersV1,
                                default_market_filters_payload, 16 * 1024),
}
```

`market.filters` v1 payload — mirrors `MarketFilterState` **exactly, minus `search`**, plus `universe` (which lives outside the filter struct today):

```json
{
  "universe": "all_equity",
  "filters": {
    "capTiers": [],
    "priceMin": null,
    "priceMax": null,
    "dayChangeMin": null,
    "dayChangeMax": null,
    "mcapMinCr": null,
    "mcapMaxCr": null,
    "rsiMin": null,
    "rsiMax": null,
    "relVolMin": null,
    "relVolMax": null,
    "aboveSma20": false,
    "aboveSma50": false,
    "aboveSma200": false,
    "fnoOnly": false,
    "etfOnly": false,
    "sectors": [],
    "sort": "mcap_desc"
  }
}
```

Schema rules (`MarketFiltersV1`, Pydantic v2):

| Field | Type | Constraint |
|---|---|---|
| `universe` | `Literal["all_equity","nifty500","nifty50","nse_fo"]` | must match `MARKET_UNIVERSES` (`src/api/marketScreener.ts:103-108`) |
| `capTiers` | `list[Literal["large","mid","small","micro"]]` | max 4, deduped |
| `priceMin/Max` | `float \| None` | `0 ≤ v ≤ 10_000_000`, `min ≤ max` when both set |
| `dayChangeMin/Max` | `float \| None` | `-100 ≤ v ≤ 100` |
| `mcapMinCr/MaxCr` | `float \| None` | `0 ≤ v ≤ 100_000_000` |
| `rsiMin/Max` | `float \| None` | `0 ≤ v ≤ 100` |
| `relVolMin/Max` | `float \| None` | `0 ≤ v ≤ 1000` |
| `aboveSma20/50/200`, `fnoOnly`, `etfOnly` | `bool` | — |
| `sectors` | `list[str]` | max 200 items, each `1..64` chars, deduped, order preserved |
| `sort` | `Literal[9 sort keys]` | must match `MARKET_SORT_OPTIONS` (`marketFilters.ts:16-26`) |

**`Set` serialization is a hard requirement.** `capTiers` is a `Set<string>` in TS (`marketFilters.ts:40`). `JSON.stringify(new Set())` is `{}` — a silent empty payload that looks valid and restores nothing. The adapter must emit `[...set]` and hydrate `new Set(array)` (filtered to known tiers). This gets its own unit test.

**Allowlist + size limit:**
- `MarketFiltersV1.model_config = ConfigDict(extra="ignore")` so *reads* of older payloads drop unknown keys instead of 500-ing.
- On **PUT only**, the handler computes `set(body["config"]["filters"]) - set(MarketFiltersV1.model_fields)` and additionally `set(body["config"]) - {"universe","filters"}` and returns `422 {"detail":"unknown_key","keys":[...]}`. Two different jobs: tolerant read, strict write.
- `len(json.dumps(config, separators=(",",":"))) > spec.max_bytes` → `422 {"detail":"config_too_large","max_bytes":16384}`.

**Unknown scope** is validated against the registry **before any DB access** so a typo can never create a row.

### 2.5 Endpoints

Base: `api/user_configs/router.py`, `router = APIRouter(prefix="/api/user-configs", tags=["user-configs"])`.
Auth: `Depends(get_current_user)` on every route (`api/auth.py:162`). Mounted in `api_server_fastapi.py` with
`_include_api("api.user_configs.router", "router", "user-configs", msg="✅ User configs API loaded at /api/user-configs")`
next to the replay block (~line 1325), plus a `{"name": "user-configs", "description": "Per-user saved screen state (one default per scope)."}` entry in `OPENAPI_TAGS` (~line 811). All handlers need `summary=`.

#### `GET /api/user-configs/{scope}`
- 200, saved row exists:
  ```json
  {"scope":"market.filters","version":1,"saved":true,"updated_at":"2026-11-15T09:41:22.192Z","config":{...}}
  ```
- 200, **no row** — returns defaults, not 404:
  ```json
  {"scope":"market.filters","version":1,"saved":false,"updated_at":null,
   "config":{"universe":"all_equity","filters":{"capTiers":[],"...":"..."}}}
  ```
- 200, row exists but is unusable (bad JSON shape / unreadable version), **row kept**:
  ```json
  {"scope":"market.filters","version":1,"saved":true,"invalid":true,
   "warning":"invalid_saved_config","updated_at":"...","config":{...defaults...}}
  ```
- 404 `{"detail":"unknown_scope"}` — scope not in the registry. Never creates anything.
- 401 — no/expired bearer token.

#### `PUT /api/user-configs/{scope}`
Request:
```json
{"version":1,"config":{"universe":"nifty500","filters":{"capTiers":["mid"],"sectors":["IT"],"rsiMin":50,"sort":"relvol_desc","...":"..."}},
 "force":false}
```
- 200 with the same envelope as GET (`saved:true`, fresh `updated_at`). Upsert on `(user_id, scope, '')`.
- `version` must equal `spec.version` → else `422 {"detail":"version_mismatch","expected":1,"got":2}`.
- Unknown key / out-of-range value / oversized → 422 (see 2.4).
- Concurrency conflict (see 2.6) → `409 {"detail":"conflict","current":{...GET envelope...}}`.
- The **server normalizes before storing**: drop unknown keys, dedupe `capTiers` and `sectors`, clamp nothing (out-of-range is a 422, not a clamp — a silent clamp would store a filter the user never asked for).

#### `DELETE /api/user-configs/{scope}`
- 200 `{"ok":true,"scope":"market.filters","deleted":<bool>}` — **idempotent**. The desired end state is "no saved row"; a 404 for a second delete forces every caller to special-case an acceptable outcome. `deleted` reports whether a row actually went.
- 404 only for unknown scope.
- **Hard delete**, unlike `/api/screeners/{id}` (`api_server_fastapi.py:1092-1110` soft-deletes). There is no history to preserve and a soft-deleted row would still occupy `uq_user_saved_config`, so the next PUT would need an undelete branch. State this deviation in the commit message.

#### Explicitly not in P1
`POST /api/user-configs/{scope}/presets`, `GET /api/user-configs/{scope}/presets/{id}`, share tokens. Row shape already supports them (`name != ''`).

### 2.6 Concurrency and multi-device

**P1 policy: last-write-wins, with an advisory `If-Match` that is only enforced when the client sends it.**

- Writes are per-user, tiny, and driven by one visible user in one tab at a time. A hard 409 on every stale tab would surface as a spurious "not saved" chip during ordinary debounce races.
- The GET/PUT envelope always returns `updated_at`; the client stores it as `baseRevision`.
- On PUT the client sends `If-Match: "2026-11-15T09:41:22.192Z"` **only when it has a `baseRevision`**. The server compares it to the row's `updated_at` and returns `409` with the current envelope on mismatch. A client with no base revision (first ever save) omits the header and the write is unconditional.
- On 409 the client **adopts the server value** and stops the pending debounce. Its own change is discarded — this is deliberate: the alternative is a retry loop between two tabs that never converges. That is the same outcome as LWW but the user learns *why* (the store records the conflict and the chip says "Filters changed in another tab").
- Multi-device: GET on mount + GET on `visibilitychange` (focus/return to tab). No push. A second device sees the first device's state on its next mount or refocus, not instantly. That is the honest P1 promise.

### 2.7 Migration / compatibility

| Situation | Behaviour |
|---|---|
| Stored row `version == registry.version` | Validate; on success serve. |
| Stored row `version < registry.version` | Run `MIGRATIONS[(stored_version, spec.version)]`, a pure dict→dict chain registered beside the spec. Re-validate, then serve. **Do not write** the migrated form back on GET (a GET must not mutate). It is persisted on the next PUT. |
| No migration path from the stored version | 200 + `warning: "invalid_saved_config"` + defaults. Row kept. |
| Stored JSON fails validation (wrong type, e.g. `"rsiMin": "abc"`) | Same as above: 200 + warning + defaults. **Never 500.** A DB row the current code cannot read must not take the tab down. |
| Unknown keys in the stored payload | Silently dropped by `extra="ignore"`. Not echoed back. |
| Missing keys (payload written by an older build) | Field defaults apply (`null` / `false` / `[]` / `"mcap_desc"`). |
| `scope` present in DB but removed from the registry | Unreadable by any route (404 unknown_scope). Row is inert, not deleted. |
| `capTiers` in the payload contains a tier that no longer exists | Dropped by the `Literal` validation path (one invalid item invalidates the list under strict parsing) — so the read must sanitize item-wise, not reject the payload. Implement as: filter to the known tier set, then validate. Losing one bogus tier is better than losing all filters. |

---

## 3. Frontend design

### 3.1 Files

| File | Responsibility |
|---|---|
| `src/api/userConfigs.ts` | `getUserConfig(scope)`, `putUserConfig(scope, config, version, ifMatch?)`, `deleteUserConfig(scope)`. `fetchWithAuth` (`state/auth.ts:81`), `ensureOk` copied from `src/api/screeners.ts:8`. Throws a typed `UserConfigError { status, code }` so the store can distinguish 401 / 409 / 422 / network. |
| `src/state/savedConfigScopes.ts` | **The registry.** `SavedConfigScope<T> { scope, version, defaults(), parse(raw), serialize(value) }` + `SCOPES: Record<string, SavedConfigScope<any>>`. |
| `src/components/market/marketConfigScope.ts` | `marketFiltersScope`: the pure adapter (`defaults`, `parse`, `serialize`) between `{universe, filters: MarketFilterState}` and the wire payload. No JSX, no fetch — this is where the Set↔array and enum-sanitizing logic lives and is unit-tested. |
| `src/state/savedConfig.ts` | Per-scope Solid store: `hydrate`, `scheduleSave`, `flush`, `forget`, `status`, `error`, `baseRevision`, generation counter. Module-level `createSubscriber` + `useStoreSubscription`, matching `src/state/auth.ts` / `src/state/replay.ts`. |
| `src/components/market/MarketScreenerPanel.tsx` | Wire-up only: hydrate on mount, subscribe, push changes, gate the universe-reset effect. |

Adding a screen later: one `SavedConfigScope` file + one row in `SCOPES`. No store, API, or backend change.

### 3.2 Hydration order — the exact rule

```
effective(scope) = urlOverride(scope) ?? saved(scope) ?? defaults(scope)
```

Applied **once per mount**, before controls render, and only while the mount's hydration latch is open:

1. `urlOverride` is computed synchronously from `useSearchParams()`. For `market.filters` it currently covers exactly one field: `view` (`ScreenerPage.tsx:131,191`). Everything else is `undefined`.
2. The panel starts from `urlOverride ?? defaults` — **it never blocks on the GET**. The table's snapshot request (`useMarketSnapshotSolid`) must not wait for a config request; a slow config endpoint would otherwise delay first paint of the table by its full timeout.
3. When the GET settles, saved values are applied **only if** `latchOpen === true`. The latch closes permanently for that mount on: the first user mutation of any field in the scope, or a second mount.
4. A late/out-of-order response is discarded by a generation counter (`const myGen = ++gen`), the same defense the market snapshot hook uses for universe switches (`useMarketSnapshotSolid.ts:52-68`).

**Why URL wins.** A shared link is an explicit, present-tense instruction from the person who sent it; a saved value is implicit history. If saved won, every `?view=map` link would silently open in the recipient's own view, and any future `?symbol=`/`?sector=` deep link would be dead on arrival. URL-always-wins also keeps the existing test contract (`docs/TEST_SCENARIOS.md` §2.8 "URL round-trips") true without a new exception.

**Why it must be a latch, not a merge.** Take `/screener` with no params, a 400 ms GET, and a user who clicks a sector at 200 ms. Without the latch, the response lands and re-applies the *old* saved sectors on top of the click — the click appears to undo itself. That is the "stored value resurrects a cleared filter in the same session" failure, and it is the single most likely bug in this feature. The latch closes on mutation, so it cannot happen.

Edge cases and their handling:

| Edge case | Rule |
|---|---|
| `?view=map` while saved says `table` | URL wins; `view = map`. Other saved fields (universe, sectors) still apply — `urlOverride` is per-field, not all-or-nothing. |
| Saved `view: "movers"`, no URL param | `view = movers`, and `search` is not persisted so nothing is silently hidden. |
| User clears every filter → GET from mount still in flight | Latch closed by the clear → response ignored. Cleared state stays cleared and is saved. |
| Saved `universe: "nifty500"` + saved sectors | Must be applied in **one `batch()`**, and `MarketScreenerPanel.tsx:194-205` (which resets filters on universe change) must not fire for the hydration write. Init `prevUniverse` from the hydrated value, or gate the effect on `hydrated()`. If skipped: restoring `nifty500` wipes the restored sectors. **This is the second most likely bug.** |
| Saved sector no longer present in the new snapshot | Keep the chip (the user's filter is not the app's to drop). It may yield 0 rows; the empty state already offers "Reset filters" (`MarketScreenerPanel.tsx:134-148`). |
| `view` toggled after mount | `onViewChange` writes `?view=` with `replace: true` (`ScreenerPage.tsx:505`), so the URL becomes authoritative and the saved value can never fight it back. |
| Stored payload unparseable in the browser | `parse()` returns `null` → treat as "no saved value" (defaults) and record one warning. Mirrors `readCachedMarketSnapshot`'s malformed-entry policy (`src/api/marketScreener.ts:67-74`) except the row is *not* deleted (it is the server's data, and another build may read it). |

### 3.3 When to write — recommendation: debounced auto-save

**Recommendation: auto-save with an 800 ms trailing debounce. No explicit Save button.**

Reasons, in order of weight:
1. The feature's entire promise is "refresh restores my state". A Save button reintroduces exactly the failure being fixed — the user who forgets to press it loses their screen and concludes the feature is broken.
2. `RangeInput` already has a `commitOnRelease` notion for pointers but numeric fields also accept typing; a debounce collapses a typed range (e.g. `1` → `12` → `120`) into one request instead of three.
3. There is no destructive outcome to guard: writing a filter config cannot lose trading data. The cost of a spurious write is one small upsert.

Mechanics:
- `scheduleSave` starts/restarts an 800 ms timer. Trailing edge only; one in-flight PUT at a time; a change that arrives mid-flight leaves exactly one pending save with the newest value (no queue growth).
- **Never save before hydration settles.** `hydrated === false` ⇒ every write is dropped. Otherwise the first paint (defaults) overwrites the user's saved config before it has been read — the classic clobber.
- Flush on `pagehide` / `visibilitychange → hidden` with `fetch(..., { keepalive: true })` so a quick tab close does not lose the last change. Also flush on panel unmount.
- `Reset` writes the default payload (it is just another change). A distinct "Forget saved filters" calls `DELETE` and is the only path that removes the row.

Optimistic update and rollback:

```
onChange(v):
  store.value = v          # optimistic: the UI already shows v, we are only recording it
  store.pending = v
  scheduleSave()
onSaveOk(updatedAt):
  store.lastPersisted = sentValue; store.baseRevision = updatedAt; store.error = null
onSaveFail(err):
  store.lastPersisted unchanged   # the persisted baseline is the truth
  store.error = code              # 401 → disabled; 409 → adopted server value; else "not saved"
  show chip "Filters not saved · Retry"
```

**Deliberate deviation from "rollback the UI":** on failure the live controls are **not** reverted. Yanking a user's just-clicked sector out from under them is a worse bug than an unsaved filter, and the reload still lands on the last successfully saved state. "Rollback" here means *the saved baseline* does not advance; the UI stays where the user put it, and the chip is the honest signal. If a later change succeeds, the chip clears and the new value is saved.

### 3.4 Which Market fields persist

| Field | Persisted | Why |
|---|---|---|
| `universe` | **yes** | Selects the dataset; restoring filters without the dataset they were chosen against is meaningless. |
| `sectors` | **yes** (array) | Multi-select; `[]` = all sectors. The main reason users build a screen. |
| `capTiers` | **yes** (array of tier ids) | `Set<string>` → `[...set]`; hydrate back through the known-tier filter. |
| `priceMin/Max` | **yes** | `null` = unset; a real screen definition. |
| `dayChangeMin/Max` | **yes** | Same. |
| `mcapMinCr/MaxCr` | **yes** | Same (note `mcapMaxCr` has no chip — a persisted max is invisible in the chip strip but still filters; either add a chip in P1 or record it as a known gap. See open decision #12). |
| `rsiMin/Max` | **yes** | Same. |
| `relVolMin/Max` | **yes** | Same (the chip strip only surfaces `relVolMin`, `marketFilters.ts:248-249`). |
| `aboveSma20/50/200` | **yes** | Toggles that define a trend screen. |
| `fnoOnly`, `etfOnly` | **yes** | Universe-narrowing toggles. |
| `sort` | **yes** | Users expect their sort to stick across a reload. It is also the only thing `MarketGrid` cannot infer. |
| `view` (table/map/movers) | **yes, as a fallback only** | The URL owns it when `?view=` is present. Storing it makes a bare `/screener` reopen on the last layout. |
| `search` | **no** | (1) It is a momentary lookup, not a screen definition — "the state I had last time" with half a ticker typed in the box is noise. (2) It collides with `movers`, which already clears it on switch (`MarketScreenerPanel.tsx:495-499`), so a persisted search would reappear or vanish depending on the last layout. (3) Persisted `search` + saved `sectors` is the fastest way to open the tab on "No rows match the current filters", which reads as data loss. (4) The panel keeps `search` in its own signal (`:165`) while `MarketFilterState.search` also exists (`marketFilters.ts:38`) — persisting a concept with two in-component owners invites a drift bug. Persist nothing until that ownership is unified (open decision #11). |
| `selectedSymbol` / dock | no | Session-local; restoring a chart dock on reload is a surprise, not a restore. |
| `railCollapsed` / `drawerOpen` | no | Layout of the panel, not the screen. Cheap to add later as its own scope (`market.layout`) if asked. |
| `symbolAllowlist` | no | It belongs to a Dashboard "Open scan" action in the current session (`MarketScreenerPanel.tsx:157-160`, `:201-204`). |

---

## 3.5 Table column preferences (P2, opt-in)

`TanStackTable` is shared by ~15 tables. Column visibility and order belong to the
table, not the screen, so each table that opts in registers its own scope:

```
table.market   { order: string[], hidden: string[] }
table.value    { order: string[], hidden: string[] }
table.bots     …
```

Rules:

- **Opt-in** via props on `TanStackTable` (`tableId`, `enableColumnControls`,
  `columnPrefs`, `onColumnPrefsChange`). Tables that don't pass them behave
  exactly as today.
- **Merge, never replace.** Hydration intersects the saved ids with the live
  column definitions: keep saved order for known ids, append new columns at the
  end, drop unknown ids from both `order` and `hidden`. A new column can never
  be hidden by an older saved config.
- **Structural columns** (`symbol` on market tables) may be locked visible by
  the caller; the picker shows them disabled rather than allowing a table with
  no identity column.
- **Order is display order only** — sorting and filtering stay independent.
- The picker is one popover in the table toolbar: checkboxes for visibility,
  drag handle for order, "Reset to default" writes `{order: [], hidden: []}`.
- Persistence goes through the same `savedConfig` store; no new endpoint and no
  new table. A table with no saved row opens on its declared default order.
- E2E: hide a column, reorder two, reload → same layout; reset restores.

---

## 4. Failure modes

| Failure | Detect | Behaviour |
|---|---|---|
| **Offline / network error on GET** | `fetch` rejects or `!ok` with no body | `status: "error"`, `value: null` ⇒ defaults. The table renders normally (it has its own sessionStorage cache, `marketScreener.ts:39`). One retry on the browser `online` event. No toast. |
| **Offline on PUT** | same | Keep the last trailing change, retry once after 2 s, then the "Filters not saved · Retry" chip. Never loops without a user action after the retry. |
| **401 (expired/absent token)** | `status === 401` | `status: "disabled"` for the rest of the session: no GET retry, no PUT retry, no error chrome (the user may be mid-reauth; a red banner on every filter click is noise). Re-enable only on the next mount after `checkAuth()` succeeds. |
| **403** | `status === 403` | Same as 401 (treat as "not available for this account"). |
| **Invalid stored JSON (server)** | validation failure | 200 + `warning`, defaults, row kept. Never 500, never delete. |
| **Invalid stored JSON (client-side, e.g. a proxy rewrote it)** | `parse()` returns `null` | Defaults + one warning. Do not DELETE (that would destroy the server row on a transient read bug). |
| **Schema version bump, no migration path** | `version > registry.version` or missing chain | defaults + warning; next successful PUT overwrites with the current version. |
| **422 (unknown key / out of range / too large)** | `status === 422`, `code` | Mark `error: "invalid"`, do **not** retry the same payload. This is a client bug; log `code` + `keys` to the console once. |
| **409 conflict** | `status === 409` | Adopt the server envelope into the store, cancel the pending debounce, chip "Filters changed in another tab". |
| **Two tabs, no conflict header** (both never read) | — | LWW: the later PUT wins; the other tab adopts on `visibilitychange` refetch. Visible symptom: filters change under the user once, with the chip explaining why. |
| **Request races (mount GET vs user click)** | generation counter + latch | Stale response discarded. |
| **Route missing / API not loaded** | `_include_api` failed at boot (the router is in a try/except block) | GET 404 ⇒ treat as `disabled`, defaults. The tab must remain fully usable — this is why config is never a hard dependency of the panel. |

---

## 5. Tests

### 5.1 Backend — `tests/api/test_user_configs.py` (new)

Fixtures: `auth_client` (`tests/api/conftest.py:115`) for the happy paths, `client` for 401, and `db` to assert row counts directly.

| # | Test | Asserts |
|---|---|---|
| 1 | GET unsaved scope | 200, `saved:false`, `config` equals the server default (the same values as `defaultMarketFilters()` minus `search`, plus `universe: "all_equity"`) |
| 2 | PUT → GET round-trip | 200 both; identical `config`; `saved:true`; `updated_at` non-null |
| 3 | PUT twice = upsert | `db.query(UserSavedConfig).count() == 1` |
| 4 | DELETE → GET | back to `saved:false` + defaults; `deleted:true` |
| 5 | DELETE twice | 200, `deleted:false` (idempotent) |
| 6 | No token on GET/PUT/DELETE | 401 each |
| 7 | Unknown scope on GET/PUT/DELETE | 404 `unknown_scope`; `UserSavedConfig` row count still 0 |
| 8 | Validation 422s | bad `sort`; `capTiers:["huge"]`; `rsiMin: 500`; `universe:"nasdaq"`; unknown top-level key; unknown filter key; `sectors` with 201 items; 17 KiB config |
| 9 | Version mismatch | `{"version": 2}` ⇒ 422 `version_mismatch` |
| 10 | Hostile stored row | insert `config={"universe":"nope","filters":{"rsiMin":"abc"}}` directly ⇒ GET 200, defaults, `warning:"invalid_saved_config"`, **no 500**, row still present |
| 11 | Unknown stored key dropped | insert a row with `filters.foo = 1` ⇒ GET 200 and `"foo" not in response["config"]["filters"]` |
| 12 | User isolation | user B PUT/GET/DELETE never reads or alters user A's row |
| 13 | Dedupe | `capTiers:["large","large"]`, `sectors:["IT","IT"]` ⇒ stored once each |
| 14 | If-Match happy + conflict | matching header ⇒ 200; stale header ⇒ 409 with a `current` envelope equal to the row |
| 15 | Contract | `python scripts/export_openapi.py` regenerated; `tests/contract/test_openapi_sync.py` green (tag present, path count up by 1, `bearerAuth` intact) |

Run: `.venv/bin/python -m pytest tests/api/test_user_configs.py tests/contract/test_openapi_sync.py -q`

### 5.2 Frontend

`src/state/savedConfig.test.ts` (mocked `fetch`):
1. hydrate applies the saved value when there is no URL override
2. **URL > saved**: saved `table` + `?view=map` ⇒ `map`; saved `universe` still applies
3. **no write before hydration**: 3 mutations during a pending GET produce zero PUTs; after the GET settles, exactly one PUT carries the final state
4. **latch**: a mutation at t=200 ms followed by a GET resolving at t=400 ms ⇒ the saved value is ignored and the mutation survives
5. debounce: 3 rapid changes ⇒ 1 PUT with the last value
6. failure keeps `lastPersisted` unchanged, sets `error`, and `retry()` clears it
7. 401 ⇒ `status:"disabled"` and no further requests
8. GET returns an unparseable payload ⇒ defaults + one warning, no DELETE issued
9. generation counter: scope A → B → A, responses out of order ⇒ the A response is the one applied

`src/components/market/marketConfigScope.test.ts` (new):
- `Set` ↔ array round-trip for `capTiers`
- unknown key dropped; unknown tier filtered without losing the valid ones
- `version` mismatch ⇒ `parse` returns `null`
- `search` never appears in `serialize()` output

`src/components/market/MarketScreenerPanel.test.tsx` (extend):
- saved payload (sector IT + `rsiMin: 50` + `sort: relvol_desc`) ⇒ 2 chips, the same symbol list as the equivalent click path, `market-filter-count` = 2
- cleared filters do not resurrect when a delayed GET lands
- hydration with `universe: "nifty500"` keeps the restored sectors (the reset-effect trap)
- PUT 500 ⇒ "Filters not saved" chip; `market-result-count` unchanged (failure does not blank the table)
- 401 ⇒ no chip, table unaffected

Run: `npx vitest run src/state/savedConfig.test.ts src/components/market/marketConfigScope.test.ts src/components/market/MarketScreenerPanel.test.tsx`

### 5.3 E2E — `tests/e2e/market-saved-filters.spec.ts` (new)

Uses `setupApiMocks` + `loginAsTestUser` (`tests/e2e/market-screener.spec.ts:1-20`).
**Integration gap to close first:** `tests/mocks/apiResponses.ts` must answer `/api/user-configs/market.filters` (GET → defaults envelope, PUT → echo, DELETE → ok). Without it the request falls through the catch-all and pollutes the console-error collector.

1. select sector `IT`, set RSI min 50 → wait for the PUT (`page.waitForRequest`) → `page.reload()` → same 2 chips, same `market-row-*` set, same sort
2. `/screener?view=map` with a saved `table` ⇒ map renders, chips still present (URL precedence, end to end)
3. clear all filters → reload ⇒ no chips (write happened; read did not resurrect)
4. `<1024 px` viewport: reopen the filter drawer after a reload ⇒ the drawer shows the applied values (overlay round-trip, `TEST_SCENARIOS.md` §2.11)

Run: `npx playwright test tests/e2e/market-saved-filters.spec.ts --workers=4 --output=/tmp/pw-saved-configs`

### 5.4 Scenario coverage (`docs/TEST_SCENARIOS.md`)

| Row (source) | Result |
|---|---|
| Sector selected (one) — only that sector's rows, SECTOR column hidden (§3) | existing test `MarketScreenerPanel.test.tsx`; **new** reload assertion in §5.3.1 proves the restored state is the same, not just that a chip exists |
| Two sectors selected — two chips (§3) | test added: `MarketScreenerPanel.test.tsx` restore case |
| Remove one chip — the other survives (§3) | test added: `savedConfig.test.ts` (removal persists as an array of one) |
| Clear all filters — column returns, rows reset (§3) | test added: cleared-stays-cleared with a delayed GET (§5.2 panel #2) |
| Switch Table → Map → Table — same filter, same rows (§3) | existing test; **new** saved-`view`-as-fallback case |
| URL round-trips (§2.8) | test added: `?view=map` beats saved `table`, unit + E2E |
| Overlays round-trip — close → reopen shows applied values (§2.11) | test added: narrow-viewport drawer after reload (§5.3.4) |
| One value, one owner (§2.9) | documented: URL owns `view`, signals own the rest; asserted by the `?view=` precedence test |
| Persistence axis — reload / URL / localStorage / overlay (§1) | covered by reload + URL rows above; `localStorage` N/A (state is server-side by design); overlay covered by the drawer row |
| Concurrency axis — rapid switching / request race (§1) | test added: debounce coalescing + generation counter + two-tab LWW (§5.2 #5, #9; backend #14) |
| Data state — loading / error / partial (§1) | test added: config GET in flight ⇒ table renders; PUT error ⇒ chip, rows intact; unreadable stored payload ⇒ defaults |
| Transitions — ok→error, error→ok (§1) | test added: `savedConfig.test.ts` #6 |
| Theme / breakpoints / input modality (§1) | N/A: no new visual surface; the rail controls already have those tests. The only new chrome is a text chip |
| "A filter that guarantees a constant value hides that column" (§2.3) | existing behaviour; **new** risk: restoring `sectors.length > 0` must still hide SECTOR (`MarketScreenerPanel.tsx:241`) — assert it in the restore test |

### 5.5 Acceptance criteria

1. A fresh QA user's `GET /api/user-configs/market.filters` returns 200, `saved:false`, and a `config` whose values equal `defaultMarketFilters()` minus `search`, plus `universe:"all_equity"`.
2. Select sector `IT` + `rsiMin 50` + `sort relvol_desc` on `/screener`, reload, and the rendered row set is **symbol-for-symbol identical** (assert array equality of `market-row-*` testids, not a count), the chip count is 2, and the SECTOR column is hidden.
3. `/screener?view=map` renders the map even when the saved `view` is `table`; the saved universe and sectors still apply.
4. Clearing every filter and reloading shows zero chips (and `market-result-count` equals the full row count), proving both the write and the non-resurrection.
5. A hostile stored row (bad JSON, unknown keys, `version: 99`) produces defaults + a warning, never a 5xx and never a blank panel.
6. `GET`/`PUT`/`DELETE` without a token return 401; unknown scope returns 404 for all three.
7. `npx oxlint` clean on touched files; targeted `vitest` green; `npx vitest run src/test/ui-guard.test.ts src/ui/inputs/inputs.w-h.test.tsx` green; `pytest tests/api/test_user_configs.py -q` green; `pytest tests/contract/test_openapi_sync.py -q` green.
8. `openapi.yaml` regenerated in the same commit as the router.

---

## 6. Phases

### P1 — one default per scope (this document)
- Migration `uc1a2b3c4d5e`, model, registry, router, `market.filters` v1 schema.
- `savedConfig` store + registry + market adapter; wire into `MarketScreenerPanel`.
- Debounced auto-save (no indicator), optimistic record, latch + generation counter, universe-reset gate,
  `view` as URL fallback, `mcapMaxCr`/`relVolMax` chips.
- Tests: §5.1 (15), §5.2 (three files), §5.3 (4 E2E cases) + the shared mock.
- Out of scope: a Save button, a "Forget" menu entry (endpoint exists; no UI yet), presets, sharing.

### P2 — other screens
Each is exactly: one `SavedConfigScope` adapter + one registry row + one test file. No backend change.
- `deep-value.filters` — market, gates, preset, sort (`src/components/value/`).
- `screener.filters` — the legacy screener tab's profile + column/sort choices.
- `report.layout` — Index Report panel arrangement / selected tab (never the playhead, never the symbol).
- `chart.patterns.filters` — universe + timeframe + pattern toggles (the scan itself stays server-cached).
- Explicitly excluded: per-symbol state, replay playback position, bot/strategy configs (they already have their own tables and must not be mixed into a UI-state table).

---

## 7. Decisions (resolved)

1. **Auto-save vs explicit Save.** ✅ Debounced auto-save (800 ms trailing), flush on `pagehide`.
   **No "Saved" indicator** and no success toast: silent success is the point. The only UI is the
   failure chip ("Filters not saved · Retry"). No timestamp.
2. **GET when nothing is saved.** ✅ `200 + defaults + saved:false` (no 404 error path on first visit).
3. **DELETE idempotency.** ✅ `200 + deleted:false` on the second call.
4. **`view` persistence.** ✅ Persist as a **fallback only**. The URL owns `?view=` when present;
   a bare `/screener` reopens on the last layout.
5. **Hydration vs universe reset.** ✅ Restore atomically: the hydration write must not trigger the
   universe-reset effect (`prevUniverse` initialised from the hydrated universe, or a `hydrated` gate).
   Saved `universe` + `sectors` arrive together.
6. **Presets.** ❌ **Not planned.** No named presets, no preset switcher, no sharing, no P2 preset work.
   The table keeps `name=''` only as the default slot; no `POST /presets` endpoint is built.
7. **Max chips.** ✅ Add `mcapMaxCr` and `relVolMax` chips in P1 so a persisted Max is visible.
8. **Two-tab behaviour.** ✅ Adopt the other tab's value on focus (no banner).
9. **Account-scoped only.** ✅ No localStorage fallback; the app is auth-gated.
10. **`sa.JSON` vs `JSONB`.** ✅ `sa.JSON` for parity; nothing queries inside the blob.
11. **Size caps.** ✅ 16 KiB payload, `sectors ≤ 200`; 422 beyond.
12. **`search` ownership.** ✅ Excluded from persistence in P1; unify the two owners before ever adding it.
13. **GET rewrites a migrated payload?** ✅ No — GET never mutates; the row upgrades on the next write.
