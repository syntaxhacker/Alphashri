# Options Dashboard Implementation Plan

## Project Structure Analysis

```
stock-screener-ui/
├── src/
│   ├── App.tsx                      # Main router, routes defined here
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx        # Main layout wrapper (Mantine AppShell)
│   │   │   ├── NavbarNested.tsx     # Navigation menu - ADD OPTIONS HERE
│   │   │   └── NavbarLinksGroup.tsx
│   │   ├── screener/
│   │   │   ├── ScreenerPage.tsx     # Reference for page structure
│   │   │   ├── ScreenerContainer.tsx
│   │   │   ├── ScreenerNav.tsx      # Sub-tabs pattern
│   │   │   ├── ScreenerFilters.tsx
│   │   │   ├── ScreenerTable.tsx
│   │   │   └── ...
│   │   ├── strategies/
│   │   │   ├── StrategiesPage.tsx
│   │   │   ├── StrategiesContainer.tsx
│   │   │   ├── StrategiesNav.tsx
│   │   │   └── ...
│   │   ├── backtest/
│   │   ├── paper-trading/
│   │   ├── bots/
│   │   └── common/
│   ├── state/                       # State management (Zustand)
│   ├── store/                       # Redux Toolkit
│   │   └── appSlice.ts             # Current view state
│   ├── hooks/
│   ├── types/
│   └── api/                         # API integrations
└── package.json

Tech Stack:
- React 19 + TypeScript
- Vite
- Mantine UI (v8) + Tabler Icons
- Redux Toolkit (minimal)
- React Router v7
- ECharts for charts
```

---

## Implementation Plan

### Phase 1: Navigation & Routing Setup

**1.1 Add Options to Navigation**
- **File:** `src/components/layout/NavbarNested.tsx`
- **Action:** Add new nav item to `navItems` array with IconChartArea

```typescript
const navItems = [
  { label: "Screener", icon: IconRocket, link: "/" },
  { label: "Backtest", icon: IconChartLine, link: "/backtest" },
  { label: "Paper Trading", icon: IconChartDots, link: "/paper" },
  { label: "Sector Analysis", icon: IconBuildingFactory, link: "/sector" },
  { label: "Strategies", icon: IconChartBar, link: "/strategies" },
  { label: "Bots", icon: IconRobot, link: "/bots" },
  { label: "Options", icon: IconChartArea, link: "/options" }, // ADD THIS
];
```

**1.2 Add Route**
- **File:** `src/App.tsx`
- **Action:** Import and add route

```typescript
import { OptionsPage } from "./components/options/OptionsPage";

<Routes>
  {/* existing routes */}
  <Route path="/options" element={<OptionsPage />} />
</Routes>
```

---

### Phase 2: Options Page Structure

**2.1 Component Architecture**

```
src/components/options/
├── OptionsPage.tsx              # Main page container
├── OptionsContainer.tsx         # State management, API calls
├── OptionsNav.tsx               # Sub-tabs: Chain | Positions | Analysis
├── OptionChain/
│   ├── OptionChainPanel.tsx    # Main option chain display
│   ├── OptionChainHeader.tsx   # Controls: underlying, expiry
│   ├── OptionChainTable.tsx    # Compact table (CE/PE combined)
│   └── OptionChainFilters.tsx  # Strike range, ITM/OTM filters
├── OptionPositions/
│   ├── PositionsPanel.tsx
│   ├── PositionsTable.tsx
│   └── PnLChart.tsx
├── OptionGreeks/
│   ├── GreeksPanel.tsx
│   ├── GreeksChart.tsx         # Delta, Gamma, Vega, Theta visualization
│   └── GreeksGrid.tsx          # Heatmap-style display
├── OptionOrder/
│   ├── OrderPanel.tsx          # Place options orders
│   └── OrderForm.tsx
└── common/
    ├── OptionCard.tsx          # Compact summary card
    ├── ExpirySelector.tsx
    └── UnderlyingSelector.tsx
```

**2.2 State Management (Zustand)**

**File:** `src/state/optionsStore.ts`

```typescript
interface OptionsStore {
  selectedUnderlying: string;
  selectedExpiry: string;
  optionChain: OptionContract[];
  positions: OptionPosition[];
  loading: boolean;
  error: string | null;
  filters: {
    strikeRange: [number, number];
    optionType: 'CE' | 'PE' | 'BOTH';
    moneyness: 'ITM' | 'OTM' | 'ALL';
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };
  // actions
  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  setFilters: (f: Partial<OptionsStore['filters']>) => void;
  fetchChain: () => Promise<void>;
  fetchPositions: () => Promise<void>;
}
```

---

### Phase 3: API Integration

**3.1 Upstox API Client**

**File:** `src/api/upstoxOptions.ts`

```typescript
const UPSTOX_BASE = "https://api.upstox.com/v2";

export interface OptionContract {
  instrument_key: string;
  trading_symbol: string;
  strike_price: number;
  expiry: string;
  instrument_type: "CE" | "PE";
  lot_size: number;
  tick_size: number;
  weekly: boolean;
  market_data: {
    ltp: number;
    volume: number;
    oi: number;
    bid_price: number;
    ask_price: number;
    prev_oi: number;
  };
  option_greeks: {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    iv: number;
    pop: number;
  };
}

export async function getOptionContracts(
  instrumentKey: string,
  expiryDate?: string
): Promise<OptionContract[]> {
  const params = new URLSearchParams({
    instrument_key: instrumentKey,
    ...(expiryDate && { expiry_date: expiryDate }),
  });
  const res = await fetch(`${UPSTOX_BASE}/option/contract?${params}`, {
    headers: {
      "Authorization": `Bearer ${getAccessToken()}`,
      "Accept": "application/json",
    },
  });
  return res.json();
}

export async function getOptionChain(
  instrumentKey: string,
  expiryDate: string
): Promise<{ status: string; data: OptionContract[] }> {
  const params = new URLSearchParams({
    instrument_key: instrumentKey,
    expiry_date: expiryDate,
  });
  const res = await fetch(`${UPSTOX_BASE}/option/chain?${params}`, {
    headers: {
      "Authorization": `Bearer ${getAccessToken()}`,
      "Accept": "application/json",
    },
  });
  return res.json();
}
```

**3.2 Utility Functions**

- `getAvailableUnderlyings()`: NIFTY, BANKNIFTY, etc.
- `getExpiryDates(instrumentKey)`: returns YYYY-MM-DD array
- `formatNumber(num)`: 12345 → "12.3k"
- `getMoneyness(strike, spot)`: ITM/OTM/ATM
- `isWeekly(contract)`: boolean

---

### Phase 4: Compact Dashboard UI Design

**4.1 Desired Layout**

```
┌─────────────────────────────────────────────────────────────┐
│ Header: Market Status │ Underlying Selector │ Expiry Selector │
├─────────────────────────────────────────────────────────────┤
│ [Tab: Chain | Positions | Greeks]                            │
├─────────────────────────────────────────────────────────────┤
│  Strike  │   CE (Call)           │   PE (Put)               │
│  Price   │ LTP  Δ  OI  Volume    │ LTP  Δ  OI  Volume       │
│          │ Bid   Ask   Greeks    │ Bid   Ask   Greeks       │
├──────────┼──────────────────────┼──────────────────────────┤
│ 22500    │ 150  0.7  10k  1.2M  │ 2.3  -0.3  50k  5M      │
│ 22550    │ 110  0.65 8k  980k   │ 4.5  -0.4  45k  4.2M    │
│ 22600    │ 75   0.6  6k  750k   │ 8.2  -0.5  40k  3.5M    │
│ 22650    │ 45   0.55 4.5k 500k  │ 15   -0.6  35k  2.8M    │
│ 22700    │ 25   0.5  3k  300k   │ 28   -0.7  30k  2M      │
└──────────┴──────────────────────┴──────────────────────────┘
Legend: Δ=Delta | OI=Open Interest | All values live
```

**Features:**
- Single-panel view: CE and PE side-by-side
- Color coding:
  - ITM strikes: background slightly brighter
  - High OI change: bold text
  - Negative delta (PE): red tint
  - Positive delta (CE): green tint
- Hover: detailed tooltip (Greeks matrix)
- Click row: opens order panel

---

**4.2 Component Specifications**

**OptionChainTable.tsx**:
```tsx
// Props
interface OptionChainTableProps {
  contracts: OptionContract[];
  onRowClick: (contract: OptionContract) => void;
  columns: {
    strike: number;
    ce: OptionContract | null;
    pe: OptionContract | null;
  }[];
}

// Implementation
- Map contracts to { strike, ce, pe } grouped by strike price
- Render Grid with 2 main columns
- Use VirtualList if >100 rows
- Memoize row rendering
```

**Styles** (OptionChain.module.css or Mantine):
```css
.tableRow {
  height: 28px;
  font-size: 11px;
  border-bottom: 1px solid var(--mantine-color-default-border);
}
.itm {
  background: rgba(0, 150, 255, 0.05);
}
.otm {
  background: transparent;
}
.deltaPositive { color: var(--mantine-color-green-6); }
.deltaNegative { color: var(--mantine-color-red-6); }
.oiUp { color: var(--mantine-color-green-7); font-weight: 700; }
.oiDown { color: var(--mantine-color-red-7); font-weight: 700; }
```

---

### Phase 5: Implementation Steps

**Step 1:** Create folder structure
```bash
mkdir -p src/components/options/{OptionChain,OptionPositions,OptionGreeks,OptionOrder,common}
```

**Step 2:** Add navigation items (NavbarNested.tsx)

**Step 3:** Add route (App.tsx)

**Step 4:** Create placeholder OptionsPage.tsx

**Step 5:** Create OptionsContainer.tsx + optionsStore.ts
- Set up state
- Implement API service functions
- Add error/loading states

**Step 6:** Build OptionChainPanel with basic table
- Fetch data from Upstox
- Display CE/PE columns
- Add sorting

**Step 7:** Implement compact UI
- CSS Grid/Flex layout
- Color coding
- Responsive design

**Step 8:** Add Positions tab
- Fetch from portfolio API
- Display P&L, Greeks

**Step 9:** Add Greeks visualization
- Heatmap or sparkline charts

**Step 10:** Add order placement
- Quick buy/sell on row click
- Order confirmation modal

**Step 11:** Polish
- Loading skeletons
- Error handling
- Empty states

---

### Phase 6: Advanced Features (Later)

1. WebSocket real-time updates
2. Greeks heatmap
3. Strategy builder (Iron Condor, Straddle)
4. OI spikes alerts
5. Export CSV

---

### Phase 7: Testing

**E2E Tests (Playwright):**
1. Navigate to /options, verify tab presence
2. Select underlying NIFTY, verify expiry updates
3. Filter strike range 22500-22700
4. Click row, verify order modal opens
5. Test ITM/OTM/ALL filter

**Unit Tests:**
- API functions with mocked fetch
- Store actions
- Table formatting utilities

---

## File Checklist

### Phase 1-5: Core Implementation
- [x] `src/components/layout/NavbarNested.tsx` - Add nav item
- [x] `src/App.tsx` - Add route
- [x] `src/components/options/OptionsPage.tsx` - Main page with tabs
- [x] `src/components/options/OptionsContainer.tsx` - State management
- [x] `src/components/options/OptionsNav.tsx` - Sub-tabs navigation
- [x] `src/state/optionsStore.ts` - Pub/sub state management
- [x] `src/api/upstoxOptions.ts` - Frontend API client (calls backend)
- [x] `src/utils/options.ts` - Utility functions
- [x] `src/hooks/useOptionsState.ts` - React hook for state
- [x] `src/components/options/OptionChain/OptionChainPanel.tsx` - Chain panel
- [x] `src/components/options/OptionChain/OptionChainTable.tsx` - Compact CE/PE table
- [x] `src/components/options/OptionChain/OptionChainHeader.tsx` - Underlying/expiry selectors
- [x] `src/components/options/OptionChain/OptionChainFilters.tsx` - Strike/moneyness filters
- [x] `src/components/options/OptionPositions/PositionsPanel.tsx` - Positions display
- [x] `src/components/options/OptionGreeks/GreeksPanel.tsx` - Greeks visualization

### Backend API (FastAPI)
- [x] `api/options.py` - Options API router with endpoints:
  - GET /api/options/underlyings - List available underlyings
  - GET /api/options/expiries/{underlying} - Get expiry dates
  - GET /api/options/contracts - Get option contracts
  - GET /api/options/chain - Get full option chain
  - GET /api/options/spot/{underlying} - Get spot price
  - GET /api/options/oi-buildup - Get OI buildup data
  - GET /api/options/positions - Get user positions
  - GET /api/options/health - Health check

### Phase 6: Advanced Features (Pending)
- [ ] WebSocket real-time updates
- [ ] Greeks heatmap visualization
- [ ] Strategy builder (Iron Condor, Straddle)
- [ ] OI spikes alerts
- [ ] Export CSV
- [ ] Options-specific seed data
- [ ] E2E Tests (Playwright)

---

## Timeline

- **Day 1-2**: Setup, routing, container, API
- **Day 3-4**: Option chain table (basic)
- **Day 5-6**: Compact UI, filtering
- **Day 7-8**: Positions, Greeks tabs
- **Day 9-10**: Order placement, testing

Total: **~10 working days**

---

## Key Decisions

✅ Use Upstox V3 API (live, rich data with market_data + greeks)  
❌ Not INDstocks (option APIs still pending)  
✅ Compact side-by-side CE/PE layout  
✅ Mantine UI for consistency  
✅ Zustand store (lighter than Redux)  

---

**Plan Version:** 1.1  
**Status:** Backend API implemented ✅

## Completed Work

### Phase 1-5: ✅ Complete
- [x] Navigation & routing (NavbarNested.tsx, App.tsx)
- [x] UI Components (OptionsPage, OptionsContainer, OptionsNav, OptionChain/*, Positions, Greeks)
- [x] State management (optionsStore.ts)
- [x] Frontend API client (upstoxOptions.ts → calls backend)
- [x] Backend FastAPI endpoints (api/options.py)

### Phase 5.5: Broker OAuth Integration ✅ Complete
- [x] Database model: `BrokerConnection` table for storing tokens
- [x] Backend endpoints (`api/brokers.py`):
  - `GET /api/brokers/status` - Check connection status
  - `GET /api/brokers/upstox/auth` - Redirect to Upstox OAuth
  - `GET /api/brokers/upstox/callback` - Handle OAuth callback
  - `POST /api/brokers/upstox/disconnect` - Clear stored token
- [x] Frontend Settings page (`/settings`) with BrokerConnectionCard
- [x] Token lookup order: DB → File → Env
- [x] Auto-load `.env.local` on server startup
- [x] Tests: 20 backend + 19 frontend tests passing

### Backend API Endpoints (api/options.py)
- `GET /api/options/underlyings` - List available underlyings (NIFTY, BANKNIFTY, etc.)
- `GET /api/options/expiries/{underlying}` - Get expiry dates for an underlying
- `GET /api/options/contracts` - Get option contracts with optional expiry filter
- `GET /api/options/chain` - Get full option chain with market data and greeks
- `GET /api/options/oi/{underlying}/{expiry}` - Get OI analysis data
- `GET /api/options/health` - Health check endpoint

### Architecture
```
Frontend (React) → Backend FastAPI (/api/options/*) → Upstox V2 API
```

The frontend no longer calls Upstox directly. All requests go through our backend which:
1. Securely manages the Upstox access token (server-side env var)
2. Adds caching for underlyings/expiries
3. Provides error handling and rate limiting
4. Can add data transformations and enrichment

---

## Remaining Work (Phase 6: Advanced Features)

1. [ ] WebSocket real-time updates
2. [ ] Greeks heatmap visualization
3. [ ] Strategy builder (Iron Condor, Straddle)
4. [ ] OI spikes alerts
5. [ ] Export CSV
6. [ ] E2E Tests (Playwright)

---

## TODO: Multi-user Broker Connections (Before Public Release)

- [ ] Migrate from shared token (`user_id=NULL`) to per-user tokens
- [ ] Add `user_id` NOT NULL constraint to `broker_connections` table
- [ ] Implement token encryption at rest (AES-256)
- [ ] Add broker connection management in user profile
- [ ] Add per-user Upstox API credentials storage (encrypted)
- [ ] Update `/api/brokers/status` to require authentication and return user-specific status
- [ ] Add rate limiting per broker connection
- [ ] Add audit logging for broker operations
