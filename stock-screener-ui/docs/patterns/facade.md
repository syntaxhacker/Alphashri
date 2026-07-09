# Facade Pattern

## History & Origin

The Facade pattern was first described by the **Gang of Four (GoF)** in their 1994 book *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides). It belongs to the **structural pattern** category — patterns concerned with how classes and objects are composed to form larger structures.

The name comes from **architecture**: a building's facade is the exterior face that presents a simplified, unified appearance while hiding the complex interior structure (plumbing, wiring, structural beams, HVAC). In software, the Facade pattern does exactly the same — it wraps a complex subsystem behind a simple, unified interface.

Facade is one of the **most frequently used patterns in practice** because most real-world systems naturally evolve to have complex subsystems. Almost every non-trivial codebase has an implicit facade somewhere. Making it explicit (naming it `XxxFacade`, giving it a clear interface) improves maintainability, testability, and team onboarding.

---

## Problem Statement

A complex subsystem has many classes, interfaces, and inter-dependencies. When a client needs to complete even a simple task — like loading a dashboard — it must instantiate multiple objects, call them in the right order, handle errors from each, and combine the results.

```typescript
// Without facade — every component repeats this orchestration
const [positions, portfolio, trades, analytics, bots] = await Promise.all([
  positionsApi.fetchPositions(),
  portfolioApi.fetchPortfolioSummary(),
  tradesApi.fetchTrades({ from: today, to: today }),
  analyticsApi.fetchAnalytics({ period: "1d" }),
  botsApi.listBots(),
]);
// Plus handle errors for each individually, plus combine into a view model
```

Problems this creates:

- **Tight coupling**: components depend on multiple subsystem classes. Changes to any one API's signature ripple across all callers.
- **Repeated orchestration**: every component that needs the same data duplicates the same workflow code, including error handling and result merging.
- **High learning curve**: new team members must understand the entire subsystem's API surface before they can do simple things.
- **Fragile composition**: the order and dependency between calls is implicit and easy to get wrong.

---

## Real-World Usage

The Facade pattern is everywhere in software engineering:

| Facade | Subsystem It Hides |
|--------|-------------------|
| **Operating System kernel** | Hardware (CPU instructions, memory management, device drivers, interrupts) |
| **jQuery (`$()`)** | DOM API, Ajax (`XMLHttpRequest`), event handling, CSS animations |
| **`ReactDOM`** | React reconciler (fiber tree), diffing algorithm, DOM patching |
| **`fetch()`** | `XMLHttpRequest`, request/response headers, CORS, redirect handling |
| **axios / ky** | `fetch()` / `XMLHttpRequest`, request/response interceptors, error normalization |
| **SLF4J** | Logging implementations (log4j, java.util.logging, logback) |
| **`compiler.compile(source)`** | Lexer, parser, semantic analyzer, IR generator, optimizer, code generator |
| **Python `requests`** | Python's `urllib`, connection pooling, auth, cookies, redirects |
| **ORM `session.save(obj)`** | SQL generation, connection management, transaction handling, flush ordering |
| **`Array.sort()`** | Sorting algorithm (Timsort, merge sort, etc.) |
| **`TradingFacade`** (this codebase) | 43 API endpoint functions across multiple files, 50-field state object |

Each of these is a "you don't need to know how the sausage is made" abstraction. The caller says *what* they want, not *how* to assemble it.

---

## When to Use / When to Avoid

### Use Facade when:

- A subsystem has many interdependent classes and you want to provide a simple entry point for common workflows.
- You want to **layer** your system: the facade defines a clear boundary between the subsystem and its clients.
- Different clients need different views of the same subsystem. Each facade method can return just the slice of data that matters.
- You want to reduce compilation/dependency ripple — changes to the subsystem only require recompiling the facade, not all clients.
- You're onboarding new team members and want to give them a "happy path" API that works for 80% of tasks.

### Avoid Facade when:

- Clients need **fine-grained control** over every step. A facade that exposes too many knobs becomes a **god object** — it knows about everything and is coupled to everything.
- The facade becomes a **pass-through** — it simply forwards every method call with no orchestration, no error handling, no result merging. In that case it adds accidental complexity with zero value.
- Performance is critical and the facade's generic implementation always does more work than the specific path. (This is rare — usually the facade's batching is *more* efficient.)
- The subsystem is already simple (1-2 classes). A facade would be indirection for its own sake.

---

## Intent (GoF)

> **Provide a unified interface to a set of interfaces in a subsystem. Facade defines a higher-level interface that makes the subsystem easier to use.**

The Facade pattern is used when a subsystem is complex or tightly coupled and you want to provide a simple default view that is good enough for most clients. Clients that need more customisation can still bypass the facade and interact with the subsystem directly.

---

## Structure

### Classic GoF Facade Diagram

```
┌─────────────┐     ┌─────────────────────────┐
│   Client    │────▶│        Facade            │
└─────────────┘     │─────────────────────────│
                    │  + doSomething()         │
                    │  + doAnotherThing()      │
                    └────┬─────────┬───────────┘
                         │         │
                         ▼         ▼
              ┌──────────────────────────────┐
              │         Subsystem             │
              │  (many classes, interfaces,   │
              │   dependencies, init order)   │
              └──────────────────────────────┘
```

The key insight: **the client only talks to the Facade**. It has no idea that `SubsystemA`, `SubsystemB`, and `SubsystemC` even exist.

### How `TradingFacade` maps to GoF roles

| GoF Role | Our Implementation |
|----------|-------------------|
| **Facade** | `TradingFacade` (singleton) |
| **Subsystem classes** | `DefaultTradingApiClient` → real `fetchWithAuth` calls to 5+ endpoints |
| **Client** | `DashboardView`, `PaperTradingView`, any component that needs trading data |

### Concrete Structure in This Codebase

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Client Component                           │
│  DashboardView, PaperTradingView, etc.                               │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         TradingFacade                                │
│──────────────────────────────────────────────────────────────────────│
│  - instance: TradingFacade (static)                                  │
│  - _api: TradingApiClient                                            │
│──────────────────────────────────────────────────────────────────────│
│  - constructor(api?) (private)                                       │
│  + getInstance(api?): TradingFacade (static)                         │
│  + loadDashboard(): DashboardResult                                  │
│  + loadPortfolioSummary(): { portfolio, positions }                   │
│  + loadTradeHistory(from?, to?): PaperTrade[]                        │
│  + loadAnalytics(): AnalyticsData | null                             │
│  + closeAllPositions(): { success, closed, errors }                  │
│  + refreshBotStatus(): BotInfo[]                                     │
│  + setApiClient(client): void                                        │
│  + reset(): void (static)                                            │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
                delegates to
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     TradingApiClient (interface)                     │
│──────────────────────────────────────────────────────────────────────│
│  fetchPortfolio()        → PortfolioStatus | null                    │
│  fetchPositions()        → PaperPosition[]                           │
│  fetchTrades(...)        → PaperTrade[]                              │
│  fetchAnalytics()        → AnalyticsData | null                      │
│  listBots()              → BotInfo[]                                 │
│  closeAllPositions(...)  → { success, message }                      │
│  closePaperPosition(...) → { success, pnl? }                         │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
┌──────────────────────┐  ┌──────────────────────┐
│ DefaultTradingApi-   │  │ MockTradingApiClient  │
│ Client (production)  │  │ (tests)               │
│──────────────────────│  │──────────────────────│
│ delegates to real    │  │ returns canned data   │
│ fetchWithAuth calls  │  │ no network needed     │
└──────────────────────┘  └──────────────────────┘
```

### Key Design Elements

| Element | Role |
|---------|------|
| `TradingApiClient` (interface) | Defines the API surface the facade needs — injectable for testability |
| `DefaultTradingApiClient` | Production implementation that delegates to real `fetchWithAuth` calls |
| `TradingFacade` (singleton) | Single point of access, orchestrates parallel calls and partial-failure handling |
| `_safeCall()` (private) | Wraps each API call with try/catch, collects succeeded/failed names |
| `DashboardResult` | Wraps `DashboardData` with a `meta` field reporting which APIs succeeded/failed |

---

## Facade vs Adapter

This is one of the most common **interview questions** about structural patterns. The two are frequently confused.

| Dimension | Facade | Adapter |
|-----------|--------|---------|
| **Purpose** | Simplify a complex subsystem | Make two incompatible interfaces work together |
| **Direction** | Client → Facade → Subsystem | Client → Adapter → Adaptee |
| **When created** | Subsystem is too complex; create a simplified view | Interfaces are incompatible; create a translator |
| **Knowledge** | Subsystem does NOT know about the facade | Adaptee does NOT know about the adapter |
| **Interface** | New, simplified interface | Same interface as the client expects |
| **Abstraction level** | Higher-level abstraction | Same-level interface translation |

### Quick rule of thumb

- **Facade**: *"This API is too complicated; let me wrap it in something simpler."*
- **Adapter**: *"This library speaks German, but my code speaks English; let me write a translator."*

### Concrete example

- **Facade**: `TradingFacade.loadDashboard()` simplifies 5 API calls into 1. The API layer doesn't know the facade exists.
- **Adapter**: A `LoggerAdapter` that converts `console.log(message)` calls into `logger.info(message)` so a legacy module works with a modern logging framework.

---

## Facade vs Mediator

| Dimension | Facade | Mediator |
|-----------|--------|----------|
| **Communication** | One-way: Facade → Subsystem | Two-way: Colleague ↔ Mediator ↔ Colleague |
| **Subsystem awareness** | Subsystem does NOT know about facade | Colleagues KNOW about the mediator |
| **Goal** | Simplify a complex interface | Centralize complex communication |
| **Direction of control** | Unidirectional (facade delegates to subsystem) | Bidirectional (mediator coordinates peers) |
| **Substitutability** | Subsystem components are replaceable | Colleagues depend on the mediator's coordination |

### Quick rule of thumb

- **Facade**: *"I'm hiding complexity from the caller."*
- **Mediator**: *"I'm managing communication between objects so they don't have to talk to each other directly."*

### Can they combine?

Yes. A Mediator can use a Facade to simplify interaction with a complex subsystem, and a Facade can use a Mediator internally to coordinate between subsystem components.

---

## Implementation

### Where it lives

```
src/patterns/facade/
  TradingFacade.ts       ← the facade implementation
docs/patterns/
  facade.md              ← this file
```

### What we built

`TradingFacade` is a singleton facade that hides the complexity of the paper trading API layer behind a handful of intent-revealing methods. It does not add new functionality — it orchestrates existing functionality so that callers don't have to.

### Why a facade?

The paper trading API surface is large and flat:

- **~43 exportable functions** in `api/paperTrading.ts` and `api/botControlApi.ts`
- **~50 fields** in `PaperTradingState`
- Components like a dashboard view need data from **5 different API calls** (positions, portfolio, trades, analytics, bots)

Without a facade, every component that needs a dashboard view must:

```typescript
// Without facade — each component repeats this orchestration
const [positions, portfolio, trades, analytics, bots] = await Promise.all([
  fetchPositions(),
  fetchPortfolio(),
  fetchTrades(),
  fetchAnalytics(),
  listBots(),
]);
// Plus handle errors for each individually, plus combine into a view model
```

The facade collapses this into:

```typescript
const { data, meta } = await TradingFacade.getInstance().loadDashboard();
```

---

## Code Walkthrough

### 1. The injectable client interface

```typescript
export interface TradingApiClient {
  fetchPortfolio(): Promise<PortfolioStatus | null>;
  fetchPositions(): Promise<PaperPosition[]>;
  fetchTrades(...): Promise<PaperTrade[]>;
  fetchAnalytics(...): Promise<AnalyticsData | null>;
  listBots(): Promise<BotInfo[]>;
  closeAllPositions(...): Promise<{ success: boolean; message: string }>;
  closePaperPosition(...): Promise<{ success: boolean; pnl?: number }>;
}
```

This interface captures every API call the facade needs. By programming against an interface rather than a concrete implementation, the facade itself becomes testable — a test can inject a `MockTradingApiClient` that returns canned data without making network calls.

### 2. The facade class (private constructor + singleton)

```typescript
export class TradingFacade {
  private static instance: TradingFacade;
  private _api: TradingApiClient;

  private constructor(api?: TradingApiClient) {
    this._api = api ?? new DefaultTradingApiClient();
  }

  public static getInstance(api?: TradingApiClient): TradingFacade {
    if (!TradingFacade.instance) {
      TradingFacade.instance = new TradingFacade(api);
    }
    return TradingFacade.instance;
  }
}
```

The constructor accepts an optional `TradingApiClient` parameter. If omitted, it falls back to `DefaultTradingApiClient` which makes real HTTP calls. This lets tests inject a mock on first instantiation without changing any other code.

### 3. loadDashboard — parallel orchestration with partial failure

```typescript
async loadDashboard(): Promise<DashboardResult> {
  const succeeded: string[] = [];
  const failed: string[] = [];

  const [positions, portfolio, trades, analytics, bots] = await Promise.all([
    this._safeCall("positions", succeeded, failed, () => this._api.fetchPositions()),
    this._safeCall("portfolio", succeeded, failed, () => this._api.fetchPortfolio()),
    this._safeCall("trades", succeeded, failed, () => this._api.fetchTrades()),
    this._safeCall("analytics", succeeded, failed, () => this._api.fetchAnalytics()),
    this._safeCall("bots", succeeded, failed, () => this._api.listBots()),
  ]);

  return {
    data: {
      positions: positions ?? [],
      portfolio: portfolio ?? null,
      trades: trades ?? [],
      analytics: analytics ?? null,
      bots: bots ?? [],
      running: (bots ?? []).some((b) => b.running),
      lastUpdated: new Date().toISOString(),
    },
    meta: { succeeded, failed },
  };
}
```

Key decisions:

- **Always `Promise.all`** — all 5 API calls fire simultaneously, giving the best wall-clock time.
- **`_safeCall` wraps each** — if one API throws (e.g. the analytics endpoint is down), it catches the error, records the name in `failed`, and returns `null`. The other 4 results are still assembled into the dashboard.
- **`meta` field** — the caller can check `result.meta.failed` to see which endpoints had errors and show partial-data warnings.
- **Default values** — every field has a fallback (`?? []`, `?? null`) so the component never gets `undefined` and doesn't need null-guards on the spread.

### 4. closeAllPositions — orchestration with per-bot reporting

```typescript
async closeAllPositions(): Promise<{ success: boolean; closed: number; errors: string[] }> {
  const errors: string[] = [];
  let closed = 0;

  const bots = await this._call("bots", () => this._api.listBots());
  if (!bots || bots.length === 0) {
    return { success: true, closed: 0, errors: [] };
  }

  const results = await Promise.all(
    bots.map(async (bot) => {
      const prices: Record<string, number> = {};
      const result = await this._safeCall(
        `close-bot-${bot.id}`,
        [] as string[],
        errors,
        async () => {
          const positions = await this._api.fetchPositions();
          for (const pos of positions) {
            prices[pos.symbol] = pos.current_price;
          }
          if (Object.keys(prices).length === 0) {
            return { success: true, closed: 0 };
          }
          await this._api.closeAllPositions(bot.id, prices);
          return { success: true, closed: Object.keys(prices).length };
        },
      );
      return result;
    }),
  );
  // ...
}
```

This is more than just delegation — it's orchestration. The facade:

1. Lists all running bots.
2. Fetches current positions with their live prices.
3. Calls the bot-specific `close-all` endpoint for each bot.
4. Aggregates how many positions were closed and which bots failed.

The caller gets a single result object instead of having to run this workflow manually.

---

## How to use

### 1. Load a dashboard in a component

```typescript
import { TradingFacade } from "../patterns/facade/TradingFacade";

function DashboardView() {
  const [result, setResult] = useState<DashboardResult | null>(null);

  useEffect(() => {
    TradingFacade.getInstance()
      .loadDashboard()
      .then(setResult);
  }, []);

  if (!result) return <Loader />;

  const { data, meta } = result;
  return (
    <Stack>
      {meta.failed.length > 0 && (
        <Alert color="yellow">
          Failed to load: {meta.failed.join(", ")}
        </Alert>
      )}
      <PortfolioSummary portfolio={data.portfolio} />
      <PositionsTable positions={data.positions} />
      <TradesTable trades={data.trades} />
      <AnalyticsChart analytics={data.analytics} />
      <BotStatusBar bots={data.bots} running={data.running} />
    </Stack>
  );
}
```

### 2. Load just portfolio + positions

```typescript
const { portfolio, positions } = await TradingFacade.getInstance()
  .loadPortfolioSummary();
```

### 3. Close all positions

```typescript
const { success, closed, errors } = await TradingFacade.getInstance()
  .closeAllPositions();

showNotification({
  title: success ? "All closed" : "Partial close",
  message: `Closed ${closed} position(s)${errors.length ? `, ${errors.length} error(s)` : ""}`,
  color: success ? "green" : "orange",
});
```

### 4. Testing — inject a mock client

```typescript
import { TradingFacade } from "../../patterns/facade/TradingFacade";
import type { TradingApiClient } from "../../patterns/facade/TradingFacade";
import type { PaperPosition, PortfolioStatus } from "../../types/paperTrading";

beforeEach(() => {
  TradingFacade.reset();
});

it("loads dashboard with partial failure", async () => {
  const mockClient: TradingApiClient = {
    fetchPortfolio: async () => ({ total_value: 100000 } as PortfolioStatus),
    fetchPositions: async () => [] as PaperPosition[],
    fetchTrades: async () => [],
    fetchAnalytics: async () => null,          // ← fails by returning null
    listBots: async () => [],
    closeAllPositions: async () => ({ success: true, message: "" }),
    closePaperPosition: async () => ({ success: true }),
  };

  const facade = TradingFacade.getInstance(mockClient);
  const result = await facade.loadDashboard();

  expect(result.data.portfolio?.total_value).toBe(100000);
  expect(result.meta.succeeded).toContain("portfolio");
  expect(result.meta.succeeded).toContain("positions");
  // analytics returned null — not a thrown error, so it succeeds
  // (test can verify this behaviour)
});
```

### 5. Partial-failure handling (API throws)

```typescript
const throwingClient: TradingApiClient = {
  ...mockClient,
  fetchAnalytics: async () => { throw new Error("API down"); },
};

const facade = TradingFacade.getInstance(throwingClient);
const result = await facade.loadDashboard();

expect(result.meta.failed).toContain("analytics");
expect(result.data.analytics).toBeNull();  // graceful null
// All other fields are populated normally
```

---

## Real-world note

> The `PaperTradingState` interface has ~50 fields: loading flags, filter options, chart state, bot info, config, analytics, activity feed, and more. Components that need a dashboard view — showing portfolio summary, open positions, recent trades, and bot status — don't need to know about chart timeframe, config dirty flags, or activity feed pagination. The facade hides all of that. If a component later needs chart data, it can still call the API directly — the facade is a convenience, not a wall.

---

## Relations to Other Patterns

### Adapter (see Facade vs Adapter section above)

Facade **simplifies** an interface; Adapter **converts** an interface. They solve different problems.

### Mediator (see Facade vs Mediator section above)

Facade simplifies a one-way communication; Mediator coordinates two-way communication.

### Singleton

Facade is **often combined with Singleton** — a single, globally accessible point of access to the subsystem. This avoids having to pass the facade through the entire component tree. Our `TradingFacade` uses this combination.

### Abstract Factory

Abstract Factory can be used to **create the subsystem objects** that the facade uses internally. The facade calls the factory to get properly configured subsystem instances without knowing the concrete classes.

### Flyweight

When a facade serves many clients, the subsystem objects it manages may benefit from Flyweight — sharing common, immutable state across requests to reduce memory footprint.

### Facade as a god object — warning

If a facade accumulates methods for every possible use case, it becomes a **god object** — a single class that knows about and does everything. This violates the Single Responsibility Principle. Signs your facade has become a god object:

- It has >15-20 methods.
- Methods are unrelated (e.g. `loadDashboard()` and `exportToPDF()`).
- It's the first place developers add any new capability.

Fight this by splitting into **role-specific facades** (e.g., `TradingFacade`, `BotFacade`, `AnalyticsFacade`) or by keeping methods focused on orchestration only — never add business logic inside the facade.

---

## Interview Tips

The Facade pattern is very common in coding interviews — not as a standalone question, but as part of **system design** and **architecture discussions**. Here are the questions most likely to come up:

### Q: What's the difference between Facade, Adapter, and Mediator?

This is the #1 most asked Facade question. See the comparison tables above. Short version:

- **Facade**: simplified interface to a complex subsystem (one-way hiding)
- **Adapter**: convert one interface to another (translation)
- **Mediator**: coordinate communication between peers (two-way routing)

### Q: Can a facade add new functionality, or should it only delegate?

**Both views exist in practice.** The strict GoF definition says the facade only delegates/reorganizes. In real-world code, facades often add convenience methods, result shaping, caching, retry logic, or fallback behavior. Our `loadDashboard` adds partial-failure tracking (`meta.failed`) and default-value merging — these are "added" behaviors on top of delegation.

The key is: **don't put business logic in the facade.** If you find yourself adding if/else branches that encode trading rules, that logic belongs in a service or domain model, not in the facade.

### Q: Should a facade be a singleton?

**Not necessarily, but often.** A singleton facade ensures consistent configuration (same API client, same caching) across the entire app. Without singleton, you risk multiple facade instances with different configurations producing inconsistent results.

However, singleton makes testing harder — you must `reset()` between tests (which is why `TradingFacade.reset()` exists). In dependency-injected codebases, you might prefer a non-singleton facade that's registered as a scoped service.

### Q: How do you test a facade?

By **injecting a mock** of the subsystem interface. The facade should never instantiate its own subsystem objects — it should receive them (constructor injection or setter). This is why `TradingFacade` accepts an optional `TradingApiClient` and why `TradingApiClient` is an interface (not a concrete class).

Testing strategy:
1. Test with a mock that returns valid data — verify the facade returns combined results.
2. Test with a mock that throws on specific calls — verify partial-failure metadata.
3. Test with an empty mock (no data) — verify default values (`[]`, `null`).
4. Test that `reset()` clears the singleton between tests.

### Q: When does a facade become a god object?

When it has too many unrelated responsibilities. Warning signs: >20 methods, methods from different domains, business logic leaking in. See "Relations to Other Patterns" above for mitigation strategies.

### Q: Is this overengineering? When do I truly need a facade?

A facade is **never overengineering** if you have a subsystem with 3+ classes that are always used together. The cost of a facade is small (one class, one interface). The cost of not having it is duplicated orchestration code across every component that needs the subsystem.

If you're unsure, start without a facade and **extract it when you see the third repetition** of the same multi-step workflow. That's the "rule of three" applied to design patterns.

---

## Interview checklist

| Concept | Explanation |
|---------|-------------|
| When to use | A subsystem has many interfaces and you want to provide a simpler, unified entry point for common tasks |
| When to avoid | When clients need fine-grained control over every API call and the facade would become a "god object" with too many responsibilities |
| Trade-offs | Reduces coupling between clients and the subsystem; can become a bottleneck if it tries to do too much; still allows bypass for specialised needs |
| Relationship to Adapter | Adapter changes an interface to one the client expects; Facade provides a simplified interface to a whole subsystem |
| Singleton + Facade | Combining singleton with facade ensures the entire app shares one simplified access point — no need to pass the facade through props or DI |
