# Decorator Pattern — `ApiDecorators.ts`

## History & Origin

The Decorator pattern was first formally described in **Design Patterns: Elements of Reusable Object-Oriented Software** (GoF, 1994), where it was classified as a **structural pattern**. It is also known as the **"Wrapper"** pattern.

The core idea — layering responsibilities — is ancient. The pattern's name comes from the physical act of **decorating** an object by wrapping it in additional layers. A helpful mental model is **Russian nesting dolls (Matryoshka)**: each doll contains another inside it, and the outermost doll presents the combined silhouette of all layers. When you call the outermost function, it passes through each wrapper before reaching the real implementation, and each wrapper adds its own behavior before or after delegating.

The GoF authors were inspired by the earlier **Mixin** concept from Lisp and Flavors (an object-oriented extension of Lisp from the 1980s), where behavior could be mixed into an object at runtime. Decorator formalised this into a reusable structural pattern with a well-defined interface contract.

---

## Problem Statement

Imagine you have a function `apiGet` that fetches data from a server. Over time you need to add several orthogonal concerns:

- **Retry** on network failures
- **Caching** to avoid redundant requests
- **Logging** for observability
- **Deduplication** of concurrent in-flight requests

The naive approach is to hardcode all of these into `apiGet` itself — but that violates the **Single Responsibility Principle** and makes the function impossible to reuse in contexts where only a subset of behaviors is needed.

The classic OO solution — **subclassing** — leads to a **combinatorial explosion**:

```
RetryApiGet        CacheApiGet        LogApiGet         DedupApiGet
RetryCacheApiGet   CacheRetryApiGet   RetryLogApiGet    CacheLogApiGet
RetryCacheLogApiGet  CacheRetryLogApiGet  ...
```

For _n_ behaviors, you need up to _n!_ class combinations. Adding one more behavior forces you to double the class hierarchy. This is clearly unmaintainable.

**What you actually need** is a way to compose behaviors **at runtime**, in any order, without needing to predeclare every combination. The Decorator pattern solves this by treating each behavior as a _wrapper_ that conforms to the same interface as the original, so wrappers nest arbitrarily.

---

## Real-World Usage

The Decorator pattern appears everywhere in software, often disguised under other names:

| Domain | Example | Notes |
|---|---|---|
| **API middleware** | Express/Koa middleware | Each middleware calls `next()` to delegate to the next layer |
| **Stream I/O** | Node.js `.pipe()` chains | `readable.pipe(gzip).pipe(encrypt).pipe(writeStream)` |
| **React HOCs** | `withRouter(connect(mapStateToProps)(Component))` | Each HOC wraps the component, adding props or behavior |
| **React context** | Nested `<Provider>` components | Each provider wraps the tree, adding context value |
| **Java I/O** | `new BufferedInputStream(new FileInputStream(file))` | The canonical GoF example in Java's standard library |
| **Python decorators** | `@staticmethod`, `@property`, `@cache` | Syntactic sugar for `fn = decorator(fn)` |
| **TypeScript decorators** | `@Injectable()`, `@Component({…})` | Class/method decorators in Angular/NestJS |
| **Redux middleware** | `applyMiddleware(thunk, logger)` | Each middleware wraps `dispatch()` like a Matryoshka |
| **Dockerfiles** | `RUN apt-get update && …` | Each RUN command adds a read-only layer over the previous one |
| **Our codebase** | `withRetry(withCache(apiGet))` | Functional decorators wrapping `apiGet`/`apiPost`/etc. |

The pattern is universal because the problem it solves — adding cross-cutting concerns without modifying the core — is itself universal.

---

## When to Use / When to Avoid

**Use the Decorator pattern when:**

- You need to add responsibilities to individual objects/functions, not to entire classes.
- You need to compose multiple behaviors in different combinations at runtime.
- You want to keep each concern (retry, cache, logging) in its own unit for testability and reuse.
- The base component and its decorators share the same interface — consumers should not know whether they are talking to a decorated or undecorated component.
- Adding the behavior should be transparent to callers.

**Avoid the Decorator pattern when:**

- The number of decorators is small and fixed — subclassing or inline code may be simpler.
- The decorators need to expose new methods or change the interface — that signals an **Adapter**, not a Decorator.
- The decorators would need access to the internals of the wrapped component — Decorator relies on the public interface.
- You are concerned about debugging complexity — deeply nested decorators make stack traces harder to read.
- The composition logic is complex and stateful — consider a dedicated **Strategy** or **Chain of Responsibility** instead.
- You need to conditionally skip decorators at runtime — although this is manageable, it can add accidental complexity.

---

## Intent

> **GoF definition:** *Attach additional responsibilities to an object dynamically. Decorators provide a flexible alternative to subclassing for extending functionality.*

In this codebase the pattern is applied **functionally**: instead of wrapping objects in other objects, we wrap async **functions** with **higher-order functions** that add cross-cutting behaviour — retry, caching, logging, and request deduplication — without touching the original `apiGet`, `apiPost`, etc.

---

## Structure

### Classic GoF Decorator (Object-Oriented)

```
┌─────────────────────────────────────────────────────────┐
│                    <<interface>>                         │
│                     Component                            │
│─────────────────────────────────────────────────────────│
│  + operation(): void                                     │
└─────────────────────────────────────────────────────────┘
            ▲                              ▲
            │                              │
┌───────────┴──────────────┐  ┌───────────┴──────────────────────────┐
│     ConcreteComponent    │  │        Decorator (abstract)          │
│──────────────────────────│  │──────────────────────────────────────│
│  + operation(): void     │  │  - component: Component              │
└──────────────────────────┘  │  + operation(): void {               │
                              │      component.operation();          │
                              │  }                                   │
                              └───────────┬──────────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
        ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
        │ ConcreteDecorator│  │ ConcreteDecorator│  │ ConcreteDecorator│
        │       A          │  │       B          │  │       C          │
        │──────────────────│  │──────────────────│  │──────────────────│
        │  + operation() { │  │  + operation() { │  │  + operation() { │
        │    preA();       │  │    preB();       │  │    preC();       │
        │    super.op();   │  │    super.op();   │  │    super.op();   │
        │    postA();      │  │    postB();      │  │    postC();      │
        │  }               │  │  }               │  │  }               │
        └──────────────────┘  └──────────────────┘  └──────────────────┘
```

Each `ConcreteDecorator` holds a reference to a `Component`, adds its own behavior, then delegates to the wrapped component. The client sees only the `Component` interface and is unaware of the decoration chain.

### Our Functional TypeScript Variant

```
                          ┌──────────────────┐
                          │    ApiFn<T>      │
                          │  (...args) ⇒ P<T>│
                          └────────┬─────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               ▼                   ▼                   ▼
       ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
       │  withRetry<T>  │  │  withCache<T> │  │ withLogging<T>│
       │  retries on    │  │  caches by    │  │  logs start/  │
       │  network err   │  │  JSON args    │  │  finish + ms  │
       └───────────────┘  └───────────────┘  └───────────────┘
               │                   │                   │
               └───────────────────┼───────────────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │  wrapped ApiFn<T> │
                          │  (same signature) │
                          └──────────────────┘
```

Each decorator:

1. **Accepts** an `ApiFn<T>` (the "component").
2. **Returns** a new `ApiFn<T>` (the "decorator") that adds behaviour before/after invoking the original.
3. **Preserves** the type signature, so layers compose arbitrarily.

---

## Object-Oriented Decorator vs Functional Decorator (TypeScript/JS)

### Classic OO Decorator

Objects wrap objects. The decorator implements the same interface as the component, holds a reference to a component instance, and delegates calls after performing its own logic.

```ts
interface ApiService {
  fetch<T>(endpoint: string, params?: any): Promise<T>;
}

class RetryDecorator implements ApiService {
  constructor(
    private wrapped: ApiService,
    private maxRetries: number,
  ) {}
  async fetch<T>(endpoint: string, params?: any): Promise<T> {
    // retry logic around this.wrapped.fetch(endpoint, params)
  }
}
```

**Pros**: Familiar to OOP developers; works well when behavior requires instance state; fits naturally with dependency injection.

### Functional Decorator (our approach)

Functions wrap functions. The decorator is a **higher-order function** that accepts a function and returns a new function with the same signature.

```ts
function withRetry<T>(fn: ApiFn<T>, maxRetries: number): ApiFn<T> {
  return async (...args) => {
    // retry logic around fn(...args)
  };
}
```

**Pros**: Lighter syntax; no class boilerplate; composable with standard function composition (`pipe`, `compose`); tree-shakeable; easier to unit test in isolation.

### When to use each

| Scenario | OOP Decorator | Functional Decorator |
|---|---|---|
| Wrapping class instances | ✅ Natural | ❌ Awkward |
| Wrapping standalone functions | ❌ Over-engineered | ✅ Natural |
| Stateful decorators (e.g., connection pool) | ✅ Instance per decoration | ⚠️ Closure-based state works |
| Async/callback-heavy code | ⚠️ Can work | ✅ Excellent fit |
| Framework DI integration | ✅ Works with IoC containers | ❌ Requires manual wiring |
| Tree-shaking / dead-code elimination | ❌ Classes harder to shake | ✅ Functions tree-shake naturally |

Our implementation uses the **functional approach** because the API layer is fundamentally a set of async functions. Wrapping them with higher-order functions is the most natural, type-safe, and composable choice in TypeScript.

---

## Decorator vs Higher-Order Functions

In JavaScript/TypeScript, the Decorator pattern is often **implemented with higher-order functions** rather than object wrapping. The conceptual mapping is direct:

| GoF Decorator concept | Our functional equivalent |
|---|---|
| `Component` interface | `ApiFn<T>` type |
| `ConcreteComponent` | `apiGet` / `apiPost` |
| `Decorator` abstract class | A function `(fn: ApiFn<T>) => ApiFn<T>` |
| `ConcreteDecoratorA` | `withRetry(fn, …)` |
| `ConcreteDecoratorB` | `withCache(fn, …)` |
| Nesting: `new A(new B(concrete))` | Composition: `withRetry(withCache(apiGet))` |

The difference is purely mechanical. Both achieve:

- **Transparent layering**: the caller does not know how many layers are applied.
- **Interface preservation**: the decorated function has the exact same type signature.
- **Runtime composition**: layers can be combined in any order based on runtime conditions.

```ts
// OOP equivalent of: new LoggingDecorator(new CachingDecorator(new ApiGet()))
const get = new LoggingDecorator(
  new CachingDecorator(
    new ApiGetImpl()
  )
);

// Functional equivalent:
const get = withLogging(
  withCache(apiGet, 30_000),
  "fetchPositions"
);
```

Both produce a component that behaves identically to the outside world.

---

## Implementation

File: `src/patterns/decorator/ApiDecorators.ts`

### Core type

```ts
export type ApiFn<T> = (...args: any[]) => Promise<T>;
```

Every decorator is a generic function that takes an `ApiFn<T>` and returns an `ApiFn<T>`.

### `SimpleCache`

A plain `Map<string, CacheEntry>` where each entry stores the value and an `expiresAt` timestamp. `get()` and `has()` check expiry on access and delete stale entries lazily.

```ts
class SimpleCache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  has(key: string): boolean;
  invalidate(key: string): void;
  invalidatePrefix(prefix: string): void;
  clear(): void;
}
```

### `withRetry`

Retries the wrapped function up to `maxRetries` times with **exponential backoff** (delay doubles each attempt). Only retries on network errors (`TypeError`, `DOMException`, `"Failed to fetch"`) or server errors (5xx). Client errors (4xx) are re-thrown immediately.

```ts
withRetry(apiGet, 3, 1000);
// Attempt 1 → fail → wait 1s → Attempt 2 → fail → wait 2s → Attempt 3 → fail → wait 4s → Attempt 4
```

### `withCache`

Generates a cache key via `JSON.stringify(args)`. On cache hit, returns the stored value; on miss, calls `fn`, stores the result, returns it.

**Invalidation**: If the first argument (assumed to be the endpoint URL) matches `/create|update|delete|post|put|patch/i`, the **entire cache is cleared** before forwarding the call — this keeps reads fresh after a write.

An optional shared `SimpleCache` instance lets multiple decorated functions share the same cache pool.

```ts
const shared = new SimpleCache();
const getA = withCache(apiGet, 60_000, shared);
const getB = withCache(apiGet, 60_000, shared);
// getA("trades") and getB("trades") share the same cache entry
```

### `withLogging`

Wraps the call in `console.group(label)` / `console.groupEnd()`, logs elapsed time in milliseconds on completion, and logs errors on failure.

```ts
withLogging(apiGet, "fetchTrades");
// [ApiDecorator] [fetchTrades] Calling…
//   [ApiDecorator] [fetchTrades] Completed in 142.3ms
```

### `withDedup`

Maintains a `Map<string, Promise<T>>` of in-flight requests. If a call with the same `JSON.stringify(args)` is already pending, the existing promise is returned instead of creating a new one. The map entry is cleaned up via `.finally()`.

### `createCompositeDecorator`

Reduces an array of decorator factories over the base function:

```ts
createCompositeDecorator(apiGet, [
  withRetry(3),
  withCache(30_000),
  withLogging("get"),
]);
// Equivalent to: withLogging(withCache(withRetry(apiGet, 3), 30_000), "get")
```

---

## Code Walkthrough

### 1. Building a cached, retry-safe GET

```ts
import { apiGet } from "../../api/utils/request";
import { withRetry, withCache } from "../../patterns/decorator/ApiDecorators";

// Base: apiGet<T>(endpoint, params) → Promise<T>
// After retry: retries on network blips
// After cache: caches results for 30s
const get = withRetry(withCache(apiGet, 30_000), 3, 1000);

// Use it exactly like apiGet
const data = await get("/api/paper/positions");
```

### 2. Adding logging on top

```ts
import { withLogging } from "../../patterns/decorator/ApiDecorators";

const loggedGet = withLogging(get, "positions");
// Console output:
//   [ApiDecorator] [positions] Calling…
//     [ApiDecorator] [positions] Completed in 143.2ms
```

### 3. Deduplicating concurrent calls

```ts
import { withDedup } from "../../patterns/decorator/ApiDecorators";
const dedupedGet = withDedup(apiGet);

// Both calls happen simultaneously:
Promise.all([
  dedupedGet("/api/paper/positions"),
  dedupedGet("/api/paper/positions"), // ← same promise, no extra request
]);
```

### 4. Using the composite helper

```ts
import { createCompositeDecorator } from "../../patterns/decorator/ApiDecorators";

const get = createCompositeDecorator(apiGet, [
  withRetry(3, 2000),
  withCache(15_000),
  withLogging("fastGet"),
]);
// Layers (outer → inner): logging → cache → retry → apiGet
```

---

## Composition Order

The order of decorator application **matters**. Because decorators nest, the outermost decorator runs first and the innermost runs last.

```
withLogging("get")                       ← outer: logs first, logs last
  └── withCache(30_000)                  ← middle: checks cache
        └── withRetry(apiGet, 3, 1000)   ← inner: retries on failure
              └── apiGet(endpoint)       ← base: actual network call
```

### Execution flow (outer → inner → outer):

1. `withLogging` logs `"[ApiDecorator] [get] Calling…"` and starts a timer.
2. `withLogging` delegates to `withCache`.
3. `withCache` checks if `JSON.stringify(args)` is in cache.
   - **Cache hit**: returns immediately, `withLogging` logs the elapsed time. The retry decorator and `apiGet` are **never reached**.
   - **Cache miss**: calls `withRetry(apiGet)`.
4. `withRetry` attempts `apiGet(endpoint)`.
   - On failure, it retries with exponential backoff.
5. Result propagates back up through the layers.

### Why order matters

Consider two arrangements:

```ts
// Arrangement A: retry wraps cache
const getA = withRetry(withCache(apiGet, 30_000), 3);
// On network error during cache fill: retries the cached call
// (cache miss → network error → retry → calls apiGet again)

// Arrangement B: cache wraps retry
const getB = withCache(withRetry(apiGet, 3), 30_000);
// On network error during cache fill: retries API, caches the successful result
// (cache miss → retry → success → cache result)
```

| Arrangement | Behavior on network error | Cache behavior |
|---|---|---|
| `retry(cache(fn))` | Retries the _entire cached call_ (including cache lookup) | Cache miss repeats on every retry — wasteful |
| `cache(retry(fn))` | Retries only the _inner fn_; cache fills on success | Cache hit avoids retry entirely — efficient |

The general rule:

> **Place non-idempotent or expensive decorators inside caching. Place observability (logging) on the outside where it sees the full picture.**

In practice, our typical composition is:

```ts
// logging (outer) → dedup → cache → retry → apiGet (inner)
createCompositeDecorator(apiGet, [
  withRetry(3, 1000),       // innermost: retry network errors
  withCache(30_000),        // cache successful results
  withDedup(),              // deduplicate concurrent in-flight
  withLogging("get"),       // outermost: observe everything
]);
```

---

## How to Use

### Import what you need

```ts
import {
  withRetry,
  withCache,
  withLogging,
  withDedup,
  createCompositeDecorator,
  SimpleCache,
} from "../patterns/decorator/ApiDecorators";
```

### Compose at module scope

Define decorated variants once at the top of a module and export them:

```ts
// api/positions.ts
import { apiGet } from "./utils/request";
import { withRetry, withCache } from "../patterns/decorator/ApiDecorators";

export const getPositions = withRetry(
  withCache(apiGet, 30_000),
  3,
);
```

### Share a cache between services

```ts
// api/sharedCache.ts
import { SimpleCache } from "../patterns/decorator/ApiDecorators";
export const apiCache = new SimpleCache();

// api/positions.ts
import { apiCache } from "./sharedCache";
import { withCache } from "../patterns/decorator/ApiDecorators";
export const getPositions = withCache(apiGet, 30_000, apiCache);
```

### Add logging during development, remove for production

```ts
const get = import.meta.env.DEV
  ? withLogging(withCache(apiGet, 30_000), "dev")
  : withCache(apiGet, 30_000);
```

---

## Relations to Other Patterns

### Decorator vs Adapter

- **Adapter** changes the interface of an object to make it compatible with a different client expectation.
- **Decorator** keeps the exact same interface and adds behavior.
- In our codebase: if `apiGet` returned `Response` but a consumer needed `Promise<T>`, you would use an Adapter, not a Decorator.

### Decorator vs Proxy

- **Proxy** controls access to an object (lazy loading, access control, logging access). The Proxy and the RealSubject share the same interface.
- **Decorator** adds new behavior. The difference is one of **intent**: a Proxy manages the _lifecycle/access_ of the subject; a Decorator _augments_ the behavior.
- In practice, Proxy and Decorator look structurally identical. The distinction is semantic. A lazy-load proxy is a Proxy; a caching decorator is a Decorator.

### Decorator vs Composite

- **Composite** represents part-whole hierarchies where individual objects and compositions are treated uniformly.
- **Decorator** is a degenerate Composite with exactly one child. You can think of Decorator as a Composite of size 1 that adds behavior instead of aggregating.

### Decorator vs Strategy

- **Strategy** lets you swap the entire algorithm at runtime via a different object ("change the guts").
- **Decorator** lets you layer behavior around a fixed core ("change the skin").
- Both use composition, but Strategy replaces the implementation, while Decorator wraps it.

### Decorator vs Chain of Responsibility

- **Chain of Responsibility** passes a request along a chain of handlers until one handles it. Each handler decides whether to process or pass along.
- **Decorator** is a special case of CoR where every handler always processes and always delegates to the next (exactly one successor).
- Our `withRetry → withCache → apiGet` chain is effectively a decorator chain: each layer processes and delegates unconditionally.

---

## Interview Tips

### Common questions and how to answer them

**Q: What's the difference between Decorator and Proxy?**
A: Same structure, different intent. Proxy controls access to the subject (lazy loading, access control). Decorator adds new behavior. A caching layer can be either — if it's controlling access to an expensive computation, it's a Proxy; if it's adding caching behavior transparently, it's a Decorator.

**Q: Decorator vs Adapter?**
A: Adapter changes the interface to make things compatible. Decorator preserves the interface and adds behavior. If the signature changes, it's an Adapter.

**Q: How does Decorator avoid class explosion?**
A: Instead of pre-declaring every combination (e.g., `RetryCacheApiGet`, `CacheRetryApiGet`, `CompressedEncryptedStream`), Decorator composes behaviors at runtime. With _n_ decorator types, you have _n_ classes plus _1_ component, not _n!_ combinations.

**Q: What's the difference between a Decorator and a Mixin?**
A: Mixins add behavior to a class hierarchy at definition time (class creation). Decorators add behavior to individual instances at runtime. Mixins affect all instances of a class; Decorators affect only the wrapped instance.

**Q: How do decorators compose? Does order matter?**
A: Decorators compose by nesting. The outermost runs first. Order absolutely matters — it determines execution sequence and can change semantics (e.g., caching inside retry vs retry inside caching).

**Q: How would you implement a decorator that works on both methods and classes?**
A: In Python: check if the argument is a class (callable with `__bases__`) vs a function, and branch. In TypeScript (legacy): the same decorator factory can return a class decorator, method decorator, or property decorator based on the arguments it receives. Modern TC39 Stage 3 decorators use separate contexts and cannot be polymorhpic — you must write separate decorators for methods vs classes.

### Key talking points

- Decorator is a **structural** pattern — it's about how objects/functions are assembled.
- The **interface is sacred**: every layer must conform to the same API as the original.
- Decorator is **more flexible than subclassing** because composition happens at runtime, not at compile time.
- The pattern has a **cost**: debugging nested decorators is harder (deeper stacks, harder-to-trace data flow).
- Always consider **composition order** — it is part of the design, not an accident.

---

## Design Notes

- **Functional, not OOP.** Classic Decorator wraps objects; this wraps functions. The principle is identical — extend behaviour without modifying the original — but the mechanism is function composition instead of object composition.
- **Type preservation.** Every decorator returns `ApiFn<T>`, so the consumer sees the exact same type signature.
- **Zero dependencies.** `SimpleCache` and all decorators use only built-in JS/TS.
- **This is not middleware.** Unlike Express-style middleware that operates on `(req, res, next)`, these decorators wrap the entire function call. They are closer to **higher-order functions** or **function combinators**.
