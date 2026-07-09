# Adapter Pattern — Data Normalization

## History & Origin

The Adapter pattern was first formally described by the **Gang of Four (GoF)** in *Design Patterns: Elements of Reusable Object-Oriented Software* (1994). It is also known as the **Wrapper** pattern.

The software Adapter is the direct analog of a **power plug adapter** — when you travel to a country with different electrical outlets, you don't rewire your device; you insert a small adapter between the plug and the wall socket. Similarly, in code, when two classes have incompatible interfaces, you insert an adapter object between them rather than modifying either one.

The concept behind Adapter predates the GoF catalog by decades. **API wrappers** and **compatibility layers** have existed since the earliest operating systems (e.g., DOS system call emulation, POSIX compatibility layers on non-Unix systems). Any time you've written a function that translates one data format to another, you've used the Adapter pattern whether you knew it or not.

---

## Problem Statement

You have an existing class (or data shape) with an interface that doesn't match what your client code expects. You **cannot** or **do not want to** modify the existing class — perhaps it's from a third-party library, shared across many consumers, or too risky to change. You want to reuse its existing functionality without changing the client code that depends on a specific interface.

**Concrete example in this codebase:** The Python backend emits `snake_case` JSON (`entry_price`, `stop_loss`). The frontend components expect `camelCase` (`entryPrice`, `stopLoss`). Rather than:
- Changing the backend (touches all other consumers)
- Renaming every field in every component (200+ locations)
- Accepting `any` and losing type safety

… we insert adapters that translate between the two conventions.

---

## Real-World Usage

The Adapter pattern is everywhere in modern software, often invisible because it's so fundamental:

- **jQuery's `$(document).ready()`** — jQuery normalized the difference between `DOMContentLoaded` (modern browsers) and `onreadystatechange` (older IE) into a single API.
- **React Native bridge** — JavaScript ↔ Native communication is adapted through a bridge that translates JS calls into platform-specific UI operations (Android Views ↔ iOS UIView).
- **SQL adapters** — PostgreSQL, MySQL, SQLite all speak different SQL dialects. Libraries like `knex`, `prisma`, and ORMs provide a single API that adapts to each engine.
- **`Array.from()`** — Adapts array-like objects (`arguments`, `NodeList`, `Set`) and iterables into true `Array` instances.
- **Axios' adapter system** — A single `axios({ url, method })` call works in browsers (uses `XMLHttpRequest`) and Node.js (uses `http`/`https`). The adapter is pluggable — you can write a custom one for mock testing.
- **CSS vendor prefixes** — `-webkit-`, `-moz-`, `-ms-` are adapters for experimental browser features. PostCSS/Autoprefixer automates adding them.
- **ORMs** — Object-Relational Mapping is a giant Adapter (or set of Adapters) between the OOP world of classes and objects and the relational world of tables and rows.
- **This codebase's data adapters** — Our `PaperCandleAdapter`, `PositionAdapter`, and `TradeAdapter` normalize heterogeneous API response shapes into typed interfaces.
- **The `@/ui` abstraction layer** — This codebase wraps Mantine v8 components behind app-specific interfaces so that swapping out Mantine for another library would only require changing the adapter, not every consumer.

---

## When to Use / When to Avoid

### Use Adapter when:
- You need to integrate a third-party library whose interface doesn't match your application's convention.
- You have multiple data sources with the same *logical* content but different *structural* shapes.
- You want to decouple client code from the specific format of external data (snake_case ↔ camelCase bridging).
- You're wrapping a legacy system behind a modern interface without modifying the legacy code.
- You need to mock external dependencies in tests — an adapter interface is trivially mockable.

### Avoid Adapter when:
- You can refactor the source class directly (if you own it and there are no breaking concerns).
- The interface mismatch is trivial and only occurs in one place — a simple inline `map()` is cheaper than a full adapter class.
- You're adding an adapter for every single external dependency — you may instead need a **Facade** (simplified interface to a subsystem) or a consistent design convention across all boundaries.
- Performance is absolutely critical and the adapter adds overhead (though in 99% of cases this is negligible — a function call and object spread).

---

## Intent

**GoF**: Convert the interface of a class into another interface clients expect. Adapter lets classes work together that could not otherwise because of incompatible interfaces.

**This project**: Normalise heterogeneous API response shapes (snake_case vs camelCase, different field sets for the same logical type) into a single target interface so consumers don't depend on which upstream endpoint produced the data.

---

## Structure

### Object Adapter (composition — the variant used in this codebase)

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Code                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │             depends only on target types            │    │
│  │  NormalizedCandle / NormalizedPosition /            │    │
│  │  NormalizedTrade                                    │    │
│  └──────────┬──────────────────────────────────────────┘    │
└─────────────┼────────────────────────────────────────────────┘
              │
              │ uses
              ▼
┌──────────────────────────────────────────────────────────────┐
│                   DataAdapter<T, R>                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  + adapt(source: T): R                                │  │
│  │  + adaptMany(sources: T[]): R[]                      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────┬────────────────────────────────────────────────┘
               │ implements
     ┌─────────┼──────────┬──────────────────┐
     ▼         ▼          ▼                  ▼
┌──────────┐ ┌────────┐ ┌────────┐  ┌──────────────────┐
│PaperCandle│ │Position│ │Trade   │  │DataAdapterFactory │
│Adapter   │ │Adapter │ │Adapter │  │                  │
├──────────┤ ├────────┤ ├────────┤  ├──────────────────┤
│- source  │ │- source│ │- source│  │- instances: Map │
│adapt()   │ │adapt() │ │adapt() │  │+ getAdapter(type)│
│_resolve- │ │?? snake│ │?? trade│  │+ register(type,a)│
│Time()    │ │/camel  │ │id/trade│  │+ reset()         │
└──────────┘ └────────┘ └────────┘  └──────────────────┘
```

### Class Adapter (multiple inheritance — contrast for understanding)

```
 ┌──────────────┐         ┌──────────────────┐
 │   Target     │         │    Adaptee       │
 │  (interface) │         │  (existing class) │
 └──────┬───────┘         └────────┬─────────┘
        │                          │
        └──────────┬───────────────┘
                   ▼
        ┌──────────────────────┐
        │   ConcreteAdapter    │
        │  extends Adaptee     │
        │  implements Target   │
        ├──────────────────────┤
        │  + method()          │
        │    ← calls super.    │
        │      adapteeMethod() │
        └──────────────────────┘
```

In a **Class Adapter**, the adapter inherits from **both** the target interface and the adaptee class. It overrides target methods to delegate to inherited adaptee methods. This requires multiple inheritance — supported in C++, Python, but **not** in TypeScript, Java, or most single-inheritance languages.

In an **Object Adapter** (what we use), the adapter **holds a reference** to the adaptee via composition. It implements the target interface and forwards calls to the adaptee instance.

| Aspect | Class Adapter | Object Adapter |
|---|---|---|
| Mechanism | Multiple inheritance | Composition |
| Adaptee binding | Compile-time (subclasses a concrete class) | Runtime (any adaptee instance) |
| Flexibility | Lower — adapts one class only | Higher — works with any subclass of adaptee |
| Override behavior | Can override adaptee methods directly | Needs separate subclass if adaptee needs customization |
| TypeScript support | ❌ Not possible (single inheritance) | ✅ All our adapters use this |
| When preferred | When you need to override adaptee behavior | **Almost always** — composition over inheritance |

**Why Object Adapter is preferred:** The GoF principle of "favor composition over inheritance" applies here. Composition is more flexible (the adaptee can be any instance, not just a fixed class), easier to test (we can mock the adaptee), and works in single-inheritance languages like TypeScript and Java.

---

## Implementation in this codebase

### The Problem: Triplicated CandleData

The codebase defines a `CandleData` type in three files, each with a slightly different shape:

| File | Extra Fields |
|---|---|
| `src/types/paperTrading.ts` | `time`, `open`, `high`, `low`, `close`, `volume` |
| `src/types/backtest.ts` | same + `date`, `date_raw`, `time_str` |
| `src/types/replay.ts` (as `ReplayCandle`) | `time`, `open`, `high`, `low`, `close`, `volume` |

A chart component that needs to render candles has to either:
- Accept `any` and lose type safety
- Branch on source type and map manually everywhere

The Adapter solves this by defining a single **target** (`NormalizedCandle`) and pushing the mapping logic into dedicated adapter classes.

### Snake_case / camelCase Bridging

API responses from the Python backend arrive in `snake_case` (`entry_price`, `stop_loss`). Some local transforms or mock data use `camelCase` (`entryPrice`, `stopLoss`). Rather than forcing one convention everywhere or writing ad-hoc `map()` calls, each adapter checks both conventions with `??` fallback:

```ts
entryPrice: source.entry_price ?? source.entryPrice ?? 0,
```

### Null Safety

Every adapter guards against `null`/`undefined` sources with two layers:

1. **Early return** — If the source object is falsy, return a default-valued target object immediately.
2. **Nullish coalescing** — Each field uses `??` to fall back to a sensible default (usually `0`, `""`, or `false`).

This means consumers of `NormalizedCandle` / `NormalizedPosition` / `NormalizedTrade` **never** see `null` or `undefined` on required fields. There is no need for optional chaining or null checks on the consumer side.

### Factory Registry

`DataAdapterFactory` caches singleton adapters so they are instantiated once. `register()` allows overriding an adapter in tests without touching production code. `reset()` clears all cached instances, useful between test suites.

---

## Code Walkthrough

### 1. Target Interfaces

These are the "plugs" that all consumer code depends on. Every adapter maps its source data *into* one of these shapes.

```ts
export interface NormalizedCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NormalizedPosition {
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  stopLoss: number;
  takeProfit: number;
}

export interface NormalizedTrade {
  tradeId: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  costs: number;
}
```

### 2. Adapter Interface (generic)

The generic `DataAdapter<T, R>` is the contract that every concrete adapter must satisfy. `T` is the source type, `R` is the target (normalized) type.

```ts
export interface DataAdapter<T, R> {
  adapt(source: T): R;
  adaptMany(sources: T[]): R[];
}
```

**Why both `adapt` and `adaptMany`?** Many API endpoints return arrays (`GET /api/paper/positions` returns a list). Having `adaptMany` avoids the pattern `raw.map(a => adapter.adapt(a))` everywhere. The base implementation in each concrete adapter is a simple `map` call, but a future cache-aware adapter could batch-process arrays more efficiently.

### 3. PaperCandleAdapter

Handles three source shapes via `_resolveTime()`:

- If the source has `time` (paper / replay format), use it directly.
- If it has `date` + `time_str` (backtest format), join them as `"2024-01-15T09:30"`.
- If it has `timestamp`, use that.
- Falls back to `date` alone, then `""`.

All numeric fields guard against `null`/`undefined` with `?? 0`.

The `any` type on the source parameter is deliberate — candle data arrives from three different TypeScript interfaces (which are structurally incompatible with each other despite having the same semantics). Using `any` here is a conscious tradeoff: we centralize the unsafety in one place so the rest of the codebase can use strict types.

```ts
export class PaperCandleAdapter implements DataAdapter<any, NormalizedCandle> {
  adapt(source: any): NormalizedCandle {
    if (!source) {
      return { time: "", open: 0, high: 0, low: 0, close: 0, volume: 0 };
    }
    const time = this._resolveTime(source);
    return {
      time: time ?? "",
      open: source.open ?? 0,
      high: source.high ?? 0,
      low: source.low ?? 0,
      close: source.close ?? 0,
      volume: source.volume ?? 0,
    };
  }

  adaptMany(sources: any[]): NormalizedCandle[] {
    if (!sources || !Array.isArray(sources)) return [];
    return sources.map((s) => this.adapt(s));
  }

  private _resolveTime(source: Record<string, any>): string {
    if (source.time) return source.time;
    if (source.date && source.time_str) return `${source.date}T${source.time_str}`;
    if (source.timestamp) return source.timestamp;
    if (source.date) return source.date;
    return "";
  }
}
```

### 4. PositionAdapter

Maps `PaperPosition` fields. The dual-convention fallback is clearest on these lines:

```ts
entryPrice: source.entry_price ?? source.entryPrice ?? 0,
stopLoss:   source.stop_loss   ?? source.stopLoss   ?? 0,
```

The `??` (nullish coalescing) operator is critical here — it only falls through on `null`/`undefined`, not on `0` or `""`. If `source.entry_price` is `0` (a valid price), the adapter keeps it rather than falling through to `source.entryPrice`.

### 5. TradeAdapter

Identical pattern for `PaperTrade`:

```ts
tradeId:    source.trade_id  ?? source.tradeId  ?? "",
exitReason: source.exit_reason ?? source.exitReason ?? "",
```

### 6. DataAdapterFactory

```ts
const adapter = DataAdapterFactory.getAdapter("candle");
const normalized = adapter.adapt(rawCandleFromBackend);
```

The factory is a singleton registry implemented with a `Map<AdapterKey, DataAdapter<any, any>>`. It lazy-initializes on the first `getAdapter()` call. Key points:

- **Lazy init** — `init()` is called inside `getAdapter()`, not at module import time. This avoids circular dependency issues and allows `register()` to be called before any `getAdapter()` call.
- **Singleton instances** — Adapters are stateless (they hold no instance state; all logic is in method parameters), so reusing the same instance is safe and memory-efficient.
- **Pluggable** — `register()` allows tests to inject mock adapters without touching production code. `reset()` clears the entire registry.

---

## How to Use

### Basic Usage

```ts
import { DataAdapterFactory, type NormalizedCandle } from "../../patterns/adapter/DataAdapter";

// API returns candles in backtest format (with `date` + `time_str`)
const raw = await fetchCandles("/api/backtest/chart?symbol=RELIANCE");

const adapter = DataAdapterFactory.getAdapter("candle");
const candles: NormalizedCandle[] = adapter.adaptMany(raw.data.candles);

// Pass to chart component (only depends on NormalizedCandle)
<CandleChart data={candles} />
```

### Normalising Positions

```ts
const posAdapter = DataAdapterFactory.getAdapter("position");

// PaperPosition (snake_case) → NormalizedPosition
const normalized = posAdapter.adapt(openPosition);
```

### Normalising Trades

```ts
const tradeAdapter = DataAdapterFactory.getAdapter("trade");

// PaperTrade → NormalizedTrade
const normalized = tradeAdapter.adaptMany(tradeHistory);
```

### Testing with a Mock Adapter

```ts
import { DataAdapterFactory } from "../../patterns/adapter/DataAdapter";

const mockAdapter = { adapt: vi.fn(), adaptMany: vi.fn() };
DataAdapterFactory.register("candle", mockAdapter);

// … test code …
```

The factory's `register()` method is the key enabler for testing — without it, you would need to mock the adapter class's constructor or the module itself. Instead, you simply replace the adapter at the registry level.

### Adding a New Adapter

1. Define the target interface in `DataAdapter.ts` (or import it if already exists).
2. Create a class that implements `DataAdapter<YourSource, Target>`.
3. Register it in `DataAdapterFactory.init()` or call `DataAdapterFactory.register("your-key", new YourAdapter())`.

**Example**: If a new `Order` endpoint appears with its own field conventions:
```ts
// 1. Define NormalizedOrder interface
// 2. Create OrderAdapter implements DataAdapter<any, NormalizedOrder>
// 3. Register: DataAdapterFactory.register("order", new OrderAdapter());
```

---

## Testing with Mock Adapters

The factory design makes adapter testing straightforward at two levels:

### Unit-testing an adapter

Every adapter is a plain class — test it directly:

```ts
describe("PaperCandleAdapter", () => {
  const adapter = new PaperCandleAdapter();

  it("handles paper format", () => {
    const result = adapter.adapt({ time: "2024-01-15T09:30", open: 100, high: 101, low: 99, close: 100.5, volume: 1000 });
    expect(result.time).toBe("2024-01-15T09:30");
  });

  it("handles backtest format", () => {
    const result = adapter.adapt({ date: "2024-01-15", time_str: "09:30", open: 100, high: 101, low: 99, close: 100.5, volume: 1000 });
    expect(result.time).toBe("2024-01-15T09:30");
  });

  it("returns safe defaults for null source", () => {
    const result = adapter.adapt(null);
    expect(result).toEqual({ time: "", open: 0, high: 0, low: 0, close: 0, volume: 0 });
  });
});
```

### Mocking an adapter in integration tests

```ts
import { DataAdapterFactory } from "../../patterns/adapter/DataAdapter";

const mockAdapter = { adapt: vi.fn(() => ({ time: "mock" })), adaptMany: vi.fn(() => []) };
DataAdapterFactory.register("candle", mockAdapter);

// Now any code using DataAdapterFactory.getAdapter("candle") gets our mock
```

---

## Relations to Other Patterns

- **Bridge** — Both decouple interface from implementation, but Bridge is designed *upfront* to separate abstraction from implementation so they can vary independently. Adapter is a *retrofit* — it makes unrelated classes work together after they're already designed. Think of Adapter as "make it work now" and Bridge as "design it to be flexible from day one."

- **Facade** — Provides a *simplified* interface to a complex subsystem. Adapter *changes* one interface to another specific interface. A Facade says "here's an easier way to use this subsystem"; an Adapter says "here's how to make this class speak the interface you already have." They're often confused; the key difference is intent: Adapter preserves the level of abstraction (just changes the shape), Facade reduces the level of abstraction (hides complexity).

- **Proxy** — Provides the *same* interface as its subject (it's a stand-in, like `ImageProxy` that loads an image lazily but looks identical to the real `Image`). Adapter provides a *different* interface. If the interface changes, it's an Adapter; if the interface stays the same, it's a Proxy (or Decorator).

- **Decorator** — Adds behavior *without changing the interface*. Adapter changes the interface *without adding behavior* (well, it adds mapping behavior, but the intent is translation, not augmentation). A Decorator wraps something that already matches the expected interface; an Adapter wraps something that doesn't.

- **Strategy** — Adapter can use a Strategy internally to determine *how* to adapt. For example, if we had multiple JSON serialization conventions, `PaperCandleAdapter._resolveTime` could delegate to a strategy object rather than hardcoding the resolution logic. The Factory (`DataAdapterFactory`) also resembles an Abstract Factory — it decides *which* adapter (strategy) to return based on the type key.

- **Abstract Factory** — `DataAdapterFactory` is structurally similar to a Factory Method or Abstract Factory. It encapsulates creation logic and returns the right adapter for a given type key. The difference: an Abstract Factory creates families of related objects; `DataAdapterFactory` returns a single Adapter object. Think of it as a lightweight form of Factory used to decouple adapter selection from adapter consumption.

---

## Interview Tips

### Common Questions

**Q: What's the difference between Adapter, Facade, and Bridge?**
A: Intent. Adapter makes two *existing* incompatible interfaces work together (retrofit). Facade provides a *simpler* interface to a complex system (simplification). Bridge separates abstraction from implementation *upfront* so both can vary independently (design-time flexibility). In practice: Adapter is "I need to plug this into that," Facade is "this system is complicated, here's a simpler way," Bridge is "I want abstraction and implementation to evolve separately."

**Q: Object Adapter vs Class Adapter — which should I use and why?**
A: Object Adapter (composition) in virtually all cases. It works in single-inheritance languages, is more flexible (adapts any instance, not just one class), easier to test (you can mock the adaptee), and follows the "composition over inheritance" principle. Class Adapter (multiple inheritance) is only useful when you specifically need to override adaptee behavior — and even then, subclassing the adaptee separately and composing with it is usually cleaner.

**Q: When would you use an Adapter instead of refactoring the original class?**
A: When you don't own the original class (third-party library, another team's module), when the original class has many consumers that would break, when the change is risky (legacy code with no tests), or when you need to support multiple incompatible sources simultaneously (like our triplicated candle data — you can't make three TS interfaces agree without breaking their individual type contracts).

**Q: How does the Adapter pattern support the Single Responsibility Principle (SRP)?**
A: By decoupling data translation from business logic. Without adapters, every component that consumes API data would need to know about snake_case/camelCase mapping, backtest vs paper field differences, and null-checking. That's a second responsibility (data transformation) mixed into the component's actual job (rendering, calculating, etc.). Adapters extract the transformation concern into its own class, so components keep only their primary responsibility.

**Q: What are the costs of the Adapter pattern?**
A: Increased complexity (more classes to understand), indirection (tracing bugs through an adapter layer), and a proliferation of interfaces (every adapter needs a target interface, which can become a parallel type system). In small projects or one-off integrations, a simple `map()` call may be cheaper. The pattern pays off when you have multiple sources, multiple consumers, or a need to test translation logic independently.

**Q: How would you handle many-to-many adapters (10 source types → 3 target types)?**
A: Either use a Factory that inspects the source at runtime and returns the appropriate adapter, or use a two-stage pipeline: first detect the source format (a "detector" or "classifier" adapter), then apply the format-specific mapping. The `DataAdapterFactory.getAdapter("candle")` approach works when the source type is known at the call site; for dynamic detection, you'd add a `detect(source)` method that returns the matching adapter key.

---

## Related Patterns

- **Facade** — Provides a simplified interface to a subsystem; Adapter changes one interface to another.
- **Bridge** — Decouples abstraction from implementation; Adapter makes unrelated classes work together.
- **Strategy** — Often used together: the Factory decides which adapter (strategy) to return based on the source type.
- **Abstract Factory** — The `DataAdapterFactory` pattern resembles Abstract Factory for selecting adapter implementations.
