# TODO — Duplicate Code (jscpd)

## Source Code (High Priority)

### Screener Columns — shared across 6 files
- `src/components/screener/columns/trending.ts` (base)
- `src/components/screener/columns/rsiReversal.ts`
- `src/components/screener/columns/niftyMovers.ts`
- `src/components/screener/columns/marketOpenGap.ts`
- `src/components/screener/columns/highMomentum.ts`
- `src/components/screener/columns/buyerInterest.ts`
- Extract shared column definitions into a common base/factory

### Type Duplicates
- `src/types/index.ts` duplicates `src/components/screener/types.ts` (60+ lines)
- `src/types/strategies.ts` duplicates `src/components/strategies/types.ts` (28 lines)
- `src/types/paperTrading.ts` overlaps with `src/types/strategies.ts` (18 lines)

### State Duplicates
- `src/state/backtest.ts` duplicates `src/state/paperTrading.ts` (14 lines)
- `src/state/auth.ts` self-duplicate (~40 lines between login/register handlers)

### Component Self-Duplicates
- `src/components/backtest/BacktestChart.tsx` — 6 identical series blocks (lines 80-170)
- `src/components/strategies/StrategyForm.tsx` — ~50 lines duplicated (form sections)
- `src/components/paper-trading/PaperChart.tsx` — 74-line self-duplicate
- `src/components/auth/AuthProvider.tsx` — 31-line self-duplicate (login/register)
- `src/components/options/OptionChain/ChainSummary.tsx` — 22-line self-duplicate

## E2E Tests (Lower Priority)

### Heavy Self-Duplication
- `tests/e2e/backtest.spec.ts` — 73-line clone + multiple smaller ones
- `tests/e2e/multi-strategy-signal-types.spec.ts` — extensive repeated patterns
- `tests/e2e/news.spec.ts` — many repeated navigation/assertion blocks
- `tests/e2e/navigation-v2.spec.ts` — same 10-line block repeated 5 times
- `tests/e2e/sector.spec.ts` — repeated setup/teardown patterns

### Cross-File Test Duplicates
- `tests/e2e/bots.spec.ts` duplicates `multi-strategy-signal-types.spec.ts` (26+18 lines)
- `tests/e2e/backtest-mantine.spec.ts` duplicates `backtest.spec.ts` (multiple blocks)
- `tests/e2e/layout.spec.ts` duplicates `market-ticker.spec.ts` (8 lines)

## Python Tests

- `tests/api/test_sector.py` — 6 clones from same base block
- `tests/api/test_market_ticker.py` — repeated test structure (5 clones)
- `tests/test_week52_chaser.py` duplicates `test_week52_target.py` (48 lines total)
- `tests/test_orb_conservative.py` duplicates `test_week52_target.py` (26 lines)
- `tests/integration/testcontainers/test_real_db_bots.py` — 3 self-clones
