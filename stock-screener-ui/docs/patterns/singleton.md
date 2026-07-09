# Singleton Pattern

---

## 1. History & Origin

The Singleton pattern was formalised by the **Gang of Four** (Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides) in their seminal 1994 book *"Design Patterns: Elements of Reusable Object-Oriented Software"*. It was one of the original 23 patterns catalogued in that work.

However, the idea predates the book by years. In **Smalltalk** (1970s) and early **C++** codebases, developers routinely used global variables to achieve the same effect — a single, universally accessible instance. The problem was that raw global variables offer **no access control**; any code can reassign or mutate them in unanticipated ways. The Singleton pattern was the formalisation of "global variables with controlled access": a class that manages its own lifecycle, guarantees exactly one instance, and exposes a disciplined access point.

The pattern gained massive popularity in the late 1990s and early 2000s alongside the rise of Java and C++. Frameworks like **Spring** eventually made singleton the default bean scope. In the JavaScript/TypeScript world, singletons took a different form because of the language's **prototypal inheritance** and **module system** — as we'll see below, ES modules themselves exhibit singleton-like caching behaviour.

---

## 2. Problem Statement

**When do you need exactly one instance of a class, accessible from anywhere?**

Consider these scenarios:

- **Thread pool** — creating multiple thread pools wastes resources and causes race conditions. One pool should manage all concurrent work.
- **Logger** — every module in the app logs to the same file or service. Multiple logger instances would interleave output or duplicate connections.
- **Configuration manager** — app-wide settings loaded once from a config file, accessed everywhere.
- **Window manager** — a GUI toolkit can only have one display server connection.
- **Database connection pool** — you want a single pool of reusable connections, not a new pool per module.
- **Cache** — a central cache that all parts of the application consult.

The common thread: **shared, stateful resources that must be coordinated**. The Singleton pattern provides **controlled, global access** to such a resource without polluting the global namespace with raw global variables.

**Why not just use a global variable?**

| Global variable | Singleton |
|---|---|
| Accessible everywhere, but also *writable* everywhere | Controlled access via a method |
| No lazy initialisation (exists at program start) | Created on first use |
| No encapsulation of creation logic | Class manages its own lifecycle |
| Any code can reassign it | Single point of control |

---

## 3. Real-World Usage

The Singleton pattern (or singleton-like behaviour) appears everywhere in real software:

| Example | How it's a Singleton |
|---|---|
| **Node.js `require()` / ES module caching** | The first `import` evaluates a module; subsequent imports return the **same** exported bindings. Every module is effectively a singleton instance. |
| **Redux store** | `createStore()` returns one store per app. Middleware like `connect()` accesses the single store. |
| **Logger instances (winston, log4j)** | Logger factories return a single root logger. Child loggers derive from it. |
| **Browser `navigator` object** | A singleton representing the browser's user agent, geolocation, etc. |
| **Java `Runtime.getRuntime()`** | Classic singleton — one `Runtime` per JVM. |
| **Spring Boot beans** | Default bean scope is `singleton` — one instance per IoC container. |
| **Vuex / Pinia stores** | Single state tree per application. |
| **Database connection pools** | One pool (e.g. `pg.Pool`) shared across all query modules. |
| **Window managers (X11, Wayland)** | One connection to the display server per process. |
| **Configuration managers** | App config loaded once from env/file, accessible globally. |

---

## 4. When to Use / When to Avoid

| ✅ Use Singleton When | ❌ Avoid Singleton When |
|---|---|
| Exactly one instance of a class is needed | Dependency injection would be cleaner (pass the instance to constructors instead of letting classes fetch it) |
| A global access point is required and acceptable | You need to unit-test in isolation — singletons introduce hidden shared state between tests |
| Lazy initialisation is desirable (don't create until first use) | The singleton's state would cause hidden coupling between seemingly unrelated modules |
| The resource is inherently singular (OS-level handle, DB pool, logger) | You might later need **multiple** instances (e.g. multi-tenant config) |
| Cross-cutting concerns like logging, caching, or metrics | The singleton would make concurrent code harder to reason about |

**The testability concern is the most common criticism.** A class that calls `Singleton.getInstance()` internally cannot be tested with a mock or alternative instance — it's hardwired. This is why we provide a `reset()` method (see [Testability](#12-testability)).

---

## 5. Intent (GoF)

> **Ensure a class has only one instance and provide a global point of access to it.**

That's the entire pattern in one sentence. Every other detail (private constructor, static getInstance, lazy init) is a mechanical consequence of this intent.

---

## 6. Structure

```
                         ┌──────────────────────────────────────────────┐
                         │                 Client Code                   │
                         │  StoreRegistry.getInstance().get("auth")      │
                         └────────────────────┬─────────────────────────┘
                                              │
                                              ▼
                ┌───────────────────────────────────────────────────┐
                │                    StoreRegistry                   │
                │───────────────────────────────────────────────────│
                │  - instance: StoreRegistry      (private static)  │  ◄── Holds the sole instance
                │  - stores: Map<string, unknown>  (private)        │  ◄── The payload data
                │───────────────────────────────────────────────────│
                │  - constructor()                (private)         │  ◄── Prevents `new` from outside
                │  + getInstance(): StoreRegistry (public static)   │  ◄── Global access point (lazy init)
                │  + register<T>(name, store): void                 │
                │  + get<T>(name): T                                │
                │  + has(name): boolean                             │
                │  + getAll(): Record<string, unknown>              │
                │  + reset(): void                  (public static) │  ◄── Test isolation
                └────────────────────┬──────────────────────────────┘
                                     │
                         ┌───────────┼───────────┐
                         ▼           ▼           ▼
                    ┌─────────┐ ┌─────────┐ ┌─────────┐
                    │ screener│ │  auth   │ │ paper.. │  ...
                    │ store   │ │  store  │ │ store   │
                    └─────────┘ └─────────┘ └─────────┘
```

### Key Design Elements

| Element | Role |
|---------|------|
| `instance` (private static) | Holds the single class-level instance |
| `constructor()` (private) | Prevents `new StoreRegistry()` from outside |
| `getInstance()` (public static) | Lazily creates & returns the singleton |
| `stores: Map` | The payload — a registry of named stores |
| `reset()` (public static) | Tears down the singleton for test isolation |

---

## 7. Comparison: Module-level vs Class Singleton

**JavaScript/TypeScript's ES module system already provides singleton-like behaviour.** When you write:

```typescript
// state/index.ts
export let data: ScreenerData = { ... };
export let isLoading = false;
```

...every file that `import { data } from "./state"` receives the **same binding**. The module is evaluated once and cached by the runtime. This is a **module-level singleton**.

### When is a class singleton still needed?

| Module-level export | Class singleton |
|---|---|
| Free — no extra code required | Requires a class with private constructor |
| No lazy init (exports exist after first import) | Lazy init via `getInstance()` |
| No runtime discoverability | Can iterate, inspect, or list all instances |
| No overwrite guards | Can enforce constraints (warn on duplicate register) |
| Hard to reset for testing | `reset()` tears down state cleanly |

In this codebase, the stores themselves are module-level singletons. `StoreRegistry` is a **class singleton** that wraps them in a discoverable registry. This gives you the best of both:

- Stores don't need to import each other directly
- Middleware and devtools can discover all stores by name
- Cross-cutting code can `get("auth")` without knowing its module path

**Interview takeaway:** In JS/TS, the *simplest* singleton is just a module export. Reach for a class singleton only when you need lazy initialisation, runtime discoverability, or lifecycle control (reset).

---

## 8. Implementation in this codebase

### Where it lives

```
src/patterns/singleton/
  StoreRegistry.ts       ← the singleton implementation
docs/patterns/
  singleton.md           ← this file
```

### What we built

`StoreRegistry` is a formal GoF singleton that acts as a central registry for all application state stores. It's deliberately simple — the complexity is in the stores, not in the registry. The registry just gives you a `Map`-like interface with type safety and a single access point.

### Why it's a singleton

The stores themselves are already singletons at the module level:

```typescript
// state/index.ts — module-level singleton
export let data: ScreenerData = { ... };
export let isLoading = false;
```

Each time you `import { data } from "../state"`, you get the same variable — JavaScript modules are evaluated once and cached. `StoreRegistry` formalises this implicit behaviour into an explicit, inspectable registry so that code can reference stores by name without needing a direct import.

### Why this matters in a real app

Imagine middleware that logs every state change. Without a registry, you'd need to import every possible store. With `StoreRegistry`, you iterate `getAll()` and attach listeners generically. New stores can be added without modifying the middleware — that's the **Open/Closed Principle** in action.

---

## 9. Code Walkthrough

### Private constructor + static getInstance (lazy init)

```typescript
export class StoreRegistry {
  private static instance: StoreRegistry;

  private constructor() {}

  public static getInstance(): StoreRegistry {
    if (!StoreRegistry.instance) {
      StoreRegistry.instance = new StoreRegistry();
    }
    return StoreRegistry.instance;
  }
}
```

**Why does this work?** The constructor is `private` — JavaScript enforces this at runtime (TypeScript enforces it at compile time for even earlier feedback). The only way to obtain an instance is through `StoreRegistry.getInstance()`. The instance is created **lazily** on first access, not at module load time. This means:

- If the registry is never used, no memory is allocated.
- Initialisation cost is deferred until needed.
- The singleton is created exactly once — the `if` guard ensures only the first caller creates it; subsequent callers get the existing instance.

### Registering a store (with overwrite guard)

```typescript
public register<T>(name: string, store: T): void {
  if (this.stores.has(name)) {
    console.warn(`[StoreRegistry] Overwriting existing store: "${name}"`);
  }
  this.stores.set(name, store);
}
```

Each store is keyed by a string name. If you accidentally register the same name twice you get a console warning — useful during development and migration. The warning is non-fatal (you might intentionally reload a store), but it alerts you to potential mistakes.

### Retrieving a store (with descriptive error)

```typescript
public get<T>(name: string): T {
  const store = this.stores.get(name);
  if (store === undefined) {
    throw new Error(
      `[StoreRegistry] Store "${name}" not found. Ensure it is registered before calling get().`,
    );
  }
  return store as T;
}
```

The generic return type lets callers write `registry.get<AuthStore>("auth")` so the returned value is typed correctly without casts at the call site. The error message is deliberately descriptive — it tells you **what** is missing and **why** (registration order), saving debugging time.

### Test isolation via static reset

```typescript
public static reset(): void {
  if (StoreRegistry.instance) {
    StoreRegistry.instance.stores.clear();
  }
  StoreRegistry.instance = undefined as unknown as StoreRegistry;
}
```

Without this, state would leak between test cases. Call `StoreRegistry.reset()` in `beforeEach` to give each test a clean registry. This is the escape hatch that addresses the main criticism of singletons (testability).

---

## 10. Thread Safety Note

**In JavaScript/TypeScript (single-threaded), the lazy init pattern has no race condition.** The `if (!StoreRegistry.instance)` check and the assignment `StoreRegistry.instance = new StoreRegistry()` cannot be interleaved — JS runs one event-loop tick at a time. The pattern is naturally thread-safe in this environment.

**In multi-threaded languages** (Java, C++, Python with threads), two threads could both pass the `if` check before either completes the assignment, producing two instances and violating the singleton guarantee. Solutions:

| Approach | How it works |
|---|---|
| **`synchronized` method** | Mark `getInstance()` as synchronized — simple but pays locking cost on every call |
| **Double-Checked Locking** | Check `if (instance == null)` outside a `synchronized` block, then check again inside — avoids locking after the instance is created |
| **Early initialisation** | `private static final instance = new Singleton()` — JVM guarantees single initialisation at class load time |
| **Enum singleton (Java)** | `public enum Singleton { INSTANCE }` — JVM guarantees enum values are singletons |

**Interview tip:** If asked about thread safety, show you know that JS doesn't have this problem but other languages do. Mention Double-Checked Locking by name.

---

## 11. How to Use

### 1. Register stores at app startup

```typescript
// src/main.tsx or src/App.tsx
import { StoreRegistry } from "./patterns/singleton/StoreRegistry";
import * as screenerStore from "./state";
import * as authStore from "./state/auth";

const reg = StoreRegistry.getInstance();
reg.register("screener", screenerStore);
reg.register("auth", authStore);
```

Registration happens early — before any consumer tries to `get()`. This is the **initialisation phase**.

### 2. Access from anywhere

```typescript
import { StoreRegistry } from "../patterns/singleton/StoreRegistry";
import type { ScreenerStore, AuthStore } from "../patterns/singleton/StoreRegistry";

const reg = StoreRegistry.getInstance();

// Typed access
const auth = reg.get<AuthStore>("auth");
console.log(auth.isAuthenticated);

const screener = reg.get<ScreenerStore>("screener");
screener.setActiveScreener("orb_breakout");
console.log(screener.data);
```

Note that we call `getInstance()` again, not a global variable. This is important — it means the registry can enforce its singleton contract even if some code obtains a reference early and the instance hasn't been created yet.

### 3. Debugging — inspect every store

```typescript
console.table(StoreRegistry.getInstance().getAll());
```

One line, all the app's state, visible at runtime. This is invaluable for debugging and devtools.

### 4. Testing — clean slate per test

```typescript
import { StoreRegistry } from "../../patterns/singleton/StoreRegistry";

beforeEach(() => {
  StoreRegistry.reset();
});
```

---

## 12. Testability

**Singletons are often criticised for making testing harder.** Here's why:

```typescript
// Without DI — hard to test
class ReportGenerator {
  generate() {
    const config = ConfigSingleton.getInstance().getConfig();
    // ... uses config
  }
}

// This class is coupled to ConfigSingleton. You cannot test it with
// a different config without first modifying ConfigSingleton's state.
```

The `reset()` method solves this by allowing tests to tear down and rebuild the singleton between cases:

```typescript
describe("StoreRegistry", () => {
  beforeEach(() => {
    StoreRegistry.reset(); // Fresh registry for each test
  });

  it("registers and retrieves a store", () => {
    const reg = StoreRegistry.getInstance();
    reg.register("test", { value: 42 });
    expect(reg.get<{ value: number }>("test").value).toBe(42);
  });

  it("does not leak state from previous test", () => {
    const reg = StoreRegistry.getInstance();
    expect(reg.has("test")).toBe(false); // ← would fail without reset()
  });

  it("throws on missing store", () => {
    const reg = StoreRegistry.getInstance();
    expect(() => reg.get("nonexistent")).toThrow(
      '[StoreRegistry] Store "nonexistent" not found.',
    );
  });
});
```

**Alternative approaches to singleton testability:**

| Approach | Pros | Cons |
|---|---|---|
| `reset()` method | Simple, explicit, works in any language | Forgets state — must re-register |
| Constructor injection (DI) | No global state, full mockability | Requires DI framework or manual wiring |
| Module-level export with setter | `import { api } from "./api"` — swap in tests | Global mutable state |
| Interface + factory | Full abstraction over singleton | More code, indirection |

**Our approach:** The `reset()` method is the pragmatic middle ground. It makes testing possible without introducing a DI framework everywhere. For components that truly need isolation, constructor injection is preferred; for cross-cutting concerns like logging or store access, the singleton + reset pattern keeps things simple.

---

## 13. Relations to Other Patterns

| Pattern | Relationship |
|---|---|
| **Abstract Factory** | Often implemented as a Singleton (e.g., a single factory for the entire app). |
| **Facade** | Often a Singleton — a single point of access to a complex subsystem (e.g., `window.navigator`). |
| **State** | State objects are frequently Singletons — one instance per state (no need for multiple "loading" states). |
| **Prototype** | Prototype creates **copies** of an instance; Singleton ensures **only one** instance exists. They solve opposite problems. |
| **Monostate** | An alternative to Singleton: **all instances share the same state** via static fields. A `Monostate` class can be instantiated normally (`new Monostate()`) but every instance reads/writes the same static data. Singleton controls *identity* (one instance); Monostate controls *state* (many instances, one state). |

### Singleton vs Monostate — detailed comparison

```typescript
// Singleton — controls instance identity
class Singleton {
  private static instance: Singleton;
  private constructor() {}
  static getInstance() { /* ... */ }
}

// Monostate — controls state via static fields
class Monostate {
  private static sharedState: string = "";

  get state(): string {
    return Monostate.sharedState;
  }
  set state(val: string) {
    Monostate.sharedState = val;
  }
}

// Usage:
const a = new Monostate();
const b = new Monostate();
a.state = "hello";
console.log(b.state); // "hello" — same shared state
```

**When to prefer Monostate?** When you want a regular class API (can call `new`, pass instances around, use in DI) but all instances transparently share state. **Downside:** it's less obvious to readers that instances share state.

---

## 14. Interview Tips

Singleton is one of the most frequently discussed patterns in software engineering interviews. Here's how to navigate common questions:

### "Is Singleton an anti-pattern?"

**This is a trap — don't answer yes or no outright.** Say:

> "Singleton is **overused, not inherently bad**. The pattern itself is fine for genuinely singular resources (loggers, connection pools, window managers). It becomes an anti-pattern when used as a lazy substitute for dependency injection, because it introduces hidden global state that makes testing harder and coupling less visible. The key is to ask: 'Does this thing truly need to be a singleton, or does it just need to be shared?'"

### "How would you make a Singleton thread-safe?"

> "In JavaScript, it's naturally thread-safe. In Java/C++, I'd use **Double-Checked Locking** with a `volatile` field, or an **enum singleton** in Java, or **early initialisation** if the cost is acceptable."

### "When would you use a Singleton vs dependency injection?"

> "Singletons are appropriate for truly global, stateless, or cross-cutting concerns — logging, metrics, config. DI is better for domain objects that need to be tested with different implementations — repositories, services, API clients. A good hybrid: register a singleton instance in the DI container, so the container manages lifecycle but classes receive it via injection."

### "What's the difference between Singleton and Monostate?"

> "Singleton ensures **one instance** via a private constructor and static accessor. Monostate lets you create many instances but they all share **static state**. With Singleton, you know there's only one object. With Monostate, you have multiple objects that behave as one — which can confuse readers who don't know the implementation."

### "How does ES module caching relate to Singleton?"

> "Every ES module is effectively a singleton — evaluated once, cached, shared across all importers. This is often sufficient in JS/TS. A class singleton is only needed when you require lazy initialisation, runtime discoverability, lifecycle hooks, or overwrite guards that module exports don't provide."

---

## 15. Interview Checklist

| Concept | Explanation |
|---------|-------------|
| When to use | Exactly one instance needed; global access point required; lazy initialisation acceptable |
| When to avoid | When dependency injection or a module-level export is cleaner; singletons introduce hidden global state that hinders testability |
| Trade-offs | Simple, well-understood — but violates the Single Responsibility Principle and can make unit testing harder if not paired with a `reset()` mechanism |
| ES module alternative | Module-level exports (`export let x`) are effectively singletons without a class — `StoreRegistry` wraps them in a discoverable registry |
| Thread safety | JS/TS: naturally safe (single-threaded). Java/C++: need `synchronized` or Double-Checked Locking |
| Testability | Provide a `reset()` method that tears down the instance so each test starts fresh |
| Key criticism | Hidden global state + coupling + testing difficulty — always ask "does this need to be a singleton or just shared?" |
| Related patterns | Abstract Factory (often singleton), Facade (often singleton), Monostate (alternative), Prototype (opposite goal) |
