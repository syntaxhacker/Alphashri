# Proxy Pattern — Virtual Proxy (Lazy State Loading)

## History & Origin

The Proxy pattern was first formally catalogued in **Design Patterns: Elements of Reusable Object-Oriented Software** (GoF, 1994) as one of the original 23 patterns. But the concept of a proxy is far older than the book — it has been used since the early days of distributed computing:

- **CORBA** (Common Object Request Broker Architecture, 1991) used proxy objects called "stubs" to let clients call methods on remote objects as if they were local.
- **Java RMI** (Remote Method Invocation, 1997) generates proxy classes that handle serialization, network transport, and exception marshalling transparently.
- **Network proxies** (forward/reverse proxies) have existed since the early internet — the same "intermediary" concept applied at the network layer.

The term "proxy" itself comes from the Latin ***procuratio*** — "to manage on behalf of." Any intermediary that acts on behalf of another entity is a proxy. In software, this manifests whenever you insert an indirection layer between a client and a subject to control, augment, or defer access.

## Problem Statement

You need to control access to an object. The real object is expensive to create, lives on a remote machine, or has access restrictions that you don't want the client code to worry about. You want to add a layer of indirection — but **without the client knowing**. The client should interact with the proxy using exactly the same interface it would use with the real subject.

Concrete problems the Proxy pattern solves:

| Problem | Proxy Type |
|---|---|
| Creating the object is expensive and may not be needed | Virtual Proxy |
| The object is on another machine (network overhead) | Remote Proxy |
| The object should only be accessible to authorized callers | Protection Proxy |
| The object needs logging, locking, or reference counting | Smart Reference |

Without Proxy, the client must manage all of these concerns itself, coupling it to infrastructure details it should not care about.

## Real-World Usage

The Proxy pattern is everywhere in modern software:

- **Lazy loading images in browsers** — a virtual proxy placeholder (blurred low-res or a colored box) is shown until the full-resolution image loads.
- **ORM lazy loading** — Hibernate (Java) and SQLAlchemy (Python) return proxy objects for entity relationships. The DB query is deferred until a property on the proxy is first accessed.
- **Vue 3 reactivity** — Vue's `reactive()` returns a JavaScript `Proxy` around your data object. When you read or write properties, Vue intercepts the operation and triggers reactive updates.
- **MobX** — makes objects observable by wrapping them in JavaScript `Proxy` objects that track property access and mutations.
- **JavaScript's built-in `Proxy` (ES6)** — the language-level meta-programming feature that our implementation is built on.
- **`React.lazy()`** — wraps a dynamic `import()` in a proxy-like component; the module is loaded only when the component renders.
- **Git remotes** — `origin` is effectively a remote proxy to a repository on GitHub/GitLab.
- **Verdaccio / NPM proxies** — a local registry that proxies and caches packages from the public npm registry.
- **CDNs (Varnish, CloudFlare)** — caching reverse proxies that sit in front of origin servers.
- **Nginx `auth_request`** — a protection proxy that delegates authentication to a separate service before forwarding requests.
- **Java `java.lang.reflect.Proxy`** — generates dynamic proxy classes at runtime for interface-based access control (the foundation of Spring AOP).
- **gRPC stubs** — auto-generated proxy classes that serialize/deserialize protobuf messages and manage HTTP/2 streams transparently.

## When to Use / When to Avoid

**Use the Proxy pattern when:**

- You want to defer the creation or loading of an expensive object until it's actually needed (Virtual Proxy).
- You need to control access to an object based on permissions (Protection Proxy).
- You need to hide the fact that the real subject is on a different machine or process (Remote Proxy).
- You need to add logging, caching, or reference counting to an object without changing its interface.
- You want to implement copy-on-write semantics.
- You're already using a language with built-in proxy support (JS `Proxy`, Java `Proxy`, C# `RealProxy`) and want to leverage it cleanly.

**Avoid the Proxy pattern when:**

- The real subject object is already lightweight and cheap to create — adding a proxy adds unnecessary complexity.
- The client needs direct access to the real subject (e.g., for performance-sensitive code where every method call matters).
- You can solve the problem with a simpler approach (e.g., a factory function instead of a full proxy class).
- The interface between proxy and subject is unstable — the proxy must be updated every time the subject's interface changes.
- You need fine-grained control over which operations are intercepted — a Decorator may be more appropriate.

## Intent

> **GoF**: Provide a surrogate or placeholder for another object to control access to it.

The Proxy pattern inserts a wrapper (the proxy) between the client and the real subject. The proxy controls access — it can delay creation, enforce access rights, or hide network complexity. In this codebase we implement a **Virtual Proxy** that defers fetching expensive API data until a component actually reads a property.

## Structure

### Classic GoF Proxy Structure

```
┌────────────┐      ┌──────────────────────────┐
│   Client   │──────│<<interface>>             │
└────────────┘      │    Subject               │
                    │──────────────────────────│
                    │  + request()              │
                    └──────────┬───────────────┘
                               │ implements
                    ┌──────────┴───────────────┐
                    │                          │
            ┌───────▼───────┐        ┌─────────▼─────────┐
            │  RealSubject  │        │      Proxy        │
            │───────────────│        │───────────────────│
            │  + request()  │        │  - realSubject    │
            └───────────────┘        │  + request()      │
                                     └───────────────────┘
                                         │ controls access to
                                         ▼
                                   ┌────────────┐
                                   │ RealSubject │
                                   └────────────┘
```

### Structure in This Codebase

```
┌──────────────────────────────────────────────────────────────┐
│                        Client                                  │
│──────────────────────────────────────────────────────────────│
│  const proxy = createBotStateProxy("bot-1")                   │
│  const tp = proxy.createProxy()                               │
│  await tp.load()                                              │
│  console.log(tp.status)   // transparent read → "running"     │
└──────────────────────────┬───────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
                ▼                       ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  Management API         │   │  State access            │
│─────────────────────────│   │─────────────────────────│
│  .load()     fetch      │   │  .status                 │
│  .loaded     boolean    │   │  .running                │
│  .invalidate()  clear   │   │  .portfolio              │
│                         │   │  .strategies             │
│  → LazyStateProxy       │   │  → Proxy handler.get()   │
└─────────────────────────┘   └─────────────────────────┘
                                        │
                                        ▼
                               ┌─────────────────┐
                               │  Real Subject    │
                               │─────────────────│
                               │  BotStatus /     │
                               │  PaperPosition[] │
                               │  (cached T)      │
                               └─────────────────┘
```

**Mapping GoF → this implementation:**

| GoF Role | This Implementation |
|---|---|
| **Subject** (interface) | The type `T` (e.g., `BotStatus`, `PaperPosition[]`) |
| **RealSubject** | The actual data object held in `LazyStateProxy.state` |
| **Proxy** | The `createProxy()`-returned `Proxy` object + `LazyStateProxy` class |
| **Client** | React components, hooks, or services that consume the state |

## Three Proxy Types (Deep Dive)

### 1. Virtual Proxy (Lazy Loading)

Delays the creation or fetching of an expensive object until it's actually needed. The proxy stands in for an object that doesn't exist yet.

**Examples:**
- Lazy-loaded images on web pages (a small placeholder first, full image via proxy)
- ORM lazy loading (Hibernate's `_persistence_` proxies, SQLAlchemy's `InstrumentedAttribute`)
- `React.lazy()` + `Suspense` (component code split with on-demand loading)
- **Our implementation**: fetches API data only when a property is first accessed

**Key considerations:**
- The proxy must handle the case where the real subject is not yet available — often by throwing a descriptive error (as ours does) or by returning a sensible default.
- Deduplication of load requests is critical when multiple callers may request the same virtual proxy concurrently.

### 2. Protection Proxy (Access Control)

Controls access to the real subject based on caller permissions. The proxy checks authorization before delegating.

**Examples:**
- `java.lang.reflect.Proxy` with `InvocationHandler` that checks `@PreAuthorize` annotations
- Nginx `auth_request` — proxies requests to an auth service before forwarding to the app
- File system access control — a proxy checks read/write permissions before delegating to the OS file API
- Spring AOP method security — proxy objects check roles/authorities before invoking the target method

**Key considerations:**
- Throwing an `AccessDenied` error vs returning `null` vs returning a limited view — choose the right failure mode.
- Performance overhead on every method call (the permission check).
- The proxy may need to inspect the caller's identity (user, role, API key).

### 3. Remote Proxy (Network Surrogate)

Hides the fact that the real subject lives on a different machine, process, or network. The proxy handles serialization, transport, and error marshalling.

**Examples:**
- gRPC stubs — auto-generated clients that make remote calls look like local method invocations
- Java RMI — `java.rmi.server.RemoteObject` stub classes
- REST client SDKs (e.g., `axios` wrappers, `openapi-generator` clients)
- JSON-RPC / XML-RPC clients
- GraphQL clients (Apollo Client cache proxy)

**Key considerations:**
- Network failures must be surfaced clearly (the proxy cannot hide connectivity issues forever).
- Serialization/deserialization overhead.
- Latency is orders of magnitude higher than local calls — the proxy may need to batch or cache.

### Bonus: Smart Reference

Adds housekeeping operations when an object is accessed — logging, reference counting, locking, or copy-on-write.

**Examples:**
- Reference-counted pointers in C++ (`std::shared_ptr` is a smart reference proxy)
- Logging proxies that record every method call (debugging/auditing)
- Locking proxies that acquire a read/write lock before delegating (thread safety)
- Copy-on-write proxies (e.g., `COW` in std::string)

## JavaScript Proxy Object

The ES6 `Proxy` built-in is a **language-level meta-programming feature** — it's not a design pattern, but a tool that makes implementing the Proxy pattern (and others) far cleaner in JavaScript.

```ts
const target = { name: "Alice" };
const handler = {
  get(obj, prop) {
    if (prop === "name") return `Hello, ${obj[prop]}`;
    return Reflect.get(obj, prop);
  },
};
const proxy = new Proxy(target, handler);
console.log(proxy.name); // "Hello, Alice"
```

**Key difference between JS `Proxy` and GoF Proxy:**

| Aspect | JS `Proxy` (language feature) | GoF Proxy (design pattern) |
|---|---|---|
| Nature | Syntax/API for intercepting operations | Architectural pattern |
| Target | Any object, at runtime | A pre-designed surrogate class |
| Traps | `get`, `set`, `has`, `deleteProperty`, `apply`, etc. | Usually just `request()` / interface methods |
| Transparency | Can be fully transparent (no interface needed) | Must implement the Subject interface |
| Use case | Meta-programming, reactivity, validation | Access control, lazy loading, remoting |

In practice, they overlap heavily. Our implementation uses a **GoF Virtual Proxy** pattern, implemented via the **JavaScript `Proxy` language feature**. The `createProxy()` method returns a `Proxy` object whose `get` trap implements the indirection logic — this is where the pattern meets the language.

The `Reflect` API (also ES6) is the companion to `Proxy`. Instead of `obj[prop]`, use `Reflect.get(obj, prop)`. Instead of `delete obj[prop]`, use `Reflect.deleteProperty(obj, prop)`. This is more than convention — `Reflect` methods return proper success/failure values and can interact correctly with the proxy traps.

## Implementation in this codebase

The implementation lives in `src/patterns/proxy/StateProxy.ts` and consists of three layers:

1. **`LazyStateProxy<T>` class** — The core that owns the cached `state` and the `loader` factory. It exposes a management API (`load`, `loaded`, `invalidate`) and a synchronous `get(key)` accessor that throws if state is absent.

2. **`createProxy()` method** — Returns a JavaScript `Proxy` object whose `get` trap differentiates between two kinds of property access:
   - Management methods (`load`, `loaded`, `invalidate`) → forwarded to the `LazyStateProxy` instance itself.
   - Everything else → forwarded to the underlying cached state `T`, or throws `"State not loaded. Call .load() first"` if state is null.

3. **Factory functions** — `createBotStateProxy(botId)` and `createPositionsProxy(botId)` wire up real `fetch()` calls as the loader. The caller gets a `LazyStateProxy` typed to the correct response shape, then calls `.createProxy()` for transparent access.

A private `loadingPromise` field deduplicates concurrent `load()` calls — if two components call `load()` simultaneously they share one request.

## Code walkthrough

### 1. `LazyStateProxy<T>` class

```ts
export class LazyStateProxy<T extends object> {
  private state: T | null = null;
  private loadingPromise: Promise<T> | null = null;

  constructor(private readonly loader: () => Promise<T>) {}

  get loaded(): boolean {
    return this.state !== null;
  }

  async load(): Promise<T> {
    if (this.state) return this.state;
    if (!this.loadingPromise) {
      this.loadingPromise = this.loader().then((data) => {
        this.state = data;
        this.loadingPromise = null;
        return data;
      });
    }
    return this.loadingPromise;
  }

  get<K extends keyof T>(key: K): T[K] {
    if (!this.state) throw new Error("State not loaded. Call .load() first");
    return this.state[key];
  }

  invalidate(): void {
    this.state = null;
    this.loadingPromise = null;
  }
}
```

- `loaded` is a getter, not a stored boolean — always reflects the real state of the cache.
- `load()` uses a dedup promise so multiple concurrent callers share one network round-trip.
- `invalidate()` resets both fields so the next `load()` runs the loader afresh.

### 2. JavaScript Proxy for transparent access

```ts
createProxy(): T & { load: () => Promise<T>; loaded: boolean; invalidate: () => void } {
  const instance = this;
  return new Proxy(instance, {
    get(target, prop: string | symbol) {
      if (prop === "load") return instance.load.bind(instance);
      if (prop === "loaded") return instance.loaded;
      if (prop === "invalidate") return instance.invalidate.bind(instance);
      if (!instance.state) {
        throw new Error("State not loaded. Call .load() first");
      }
      return Reflect.get(instance.state, prop, instance.state);
    },
  }) as unknown as T & { load: () => Promise<T>; loaded: boolean; invalidate: () => void };
}
```

The proxy wraps the `LazyStateProxy` instance, not the state. The `get` trap:
- Routes `load`, `loaded`, `invalidate` straight to the instance.
- Routes everything else to the cached state via `Reflect.get()`.
- All other traps (`set`, `has`, `ownKeys`) are intentionally omitted — this is a read-only proxy.

### 3. Factory functions

```ts
export function createBotStateProxy(botId: string): LazyStateProxy<BotStatus> {
  return new LazyStateProxy<BotStatus>(() =>
    fetch(`/api/bots/${botId}/status`).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch bot status: ${res.statusText}`);
      return res.json();
    }),
  );
}

export function createPositionsProxy(botId: string): LazyStateProxy<PaperPosition[]> {
  return new LazyStateProxy<PaperPosition[]>(() =>
    fetch(`/api/paper/positions?bot_id=${botId}`).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch positions: ${res.statusText}`);
      return res.json();
    }),
  );
}
```

Each factory returns a typed `LazyStateProxy` with a loader that matches the actual API contract. The API base URL is relative (`/api/...`) as the Vite dev server proxies these to the FastAPI backend.

### 4. Type guard

```ts
export function isLoaded<T extends object>(proxy: LazyStateProxy<T>): boolean {
  return proxy.loaded;
}
```

## How to use

### Basic usage — explicit load then transparent access

```ts
import { createBotStateProxy, isLoaded } from "../patterns/proxy/StateProxy";

const proxy = createBotStateProxy("abc-123");
const tp = proxy.createProxy();

// State is NOT loaded yet — reading a property throws:
// tp.running  → Error: "State not loaded. Call .load() first"

await tp.load();

// Now transparent access works:
console.log(tp.status);    // "running"
console.log(tp.running);   // true
console.log(tp.portfolio?.total_pnl);

console.log(isLoaded(proxy));  // true
```

### Invalidate and re-fetch

```ts
const proxy = createBotStateProxy("abc-123");
const tp = proxy.createProxy();

await tp.load();
// ... use data ...

tp.invalidate();            // clear cache
await tp.load();            // re-fetch from API
```

### Using with positions

```ts
const positionsProxy = createPositionsProxy("abc-123");
const pp = positionsProxy.createProxy();

await pp.load();

for (const position of pp) {
  // TypeScript knows each element is PaperPosition
  console.log(position.symbol, position.pnl);
}
```

### With React component

```tsx
function BotStatusCard({ botId }: { botId: string }) {
  const [proxy] = useState(() => createBotStateProxy(botId).createProxy());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    proxy.load().then(() => setReady(true)).catch(setError);
  }, []);

  if (error) return <Text c="red">{error}</Text>;
  if (!ready) return <Text>Loading…</Text>;

  return (
    <div>
      <Text>Status: {proxy.status}</Text>
      <Text>Running: {String(proxy.running)}</Text>
    </div>
  );
}
```

## Real-world note

The Virtual Proxy pattern is a natural fit for this codebase because:

- **Bot status** and **positions** are fetched from separate API endpoints and consumed by different UI panels. The proxy defers each fetch until the panel actually mounts and reads a property.
- **Deduplication** — the `loadingPromise` ensures that if a component re-renders before the fetch completes, it joins the in-flight request instead of firing a second one.
- **Cache control** — `invalidate()` lets the UI force a refresh (e.g., after a user clicks "Refresh" or after a WebSocket event signals stale data) without recreating the proxy.

| Location | What it loads | Proxy type |
|---|---|---|
| `createBotStateProxy(botId)` | `BotStatus` from `/api/bots/{id}/status` | Virtual (lazy) |
| `createPositionsProxy(botId)` | `PaperPosition[]` from `/api/paper/positions` | Virtual (lazy) |

The pattern could be extended to a **Protection Proxy** by adding permission checks in the `get` trap, or a **Remote Proxy** by swapping the loader function for a WebSocket or gRPC call without changing the consumer code.

## Relations to Other Patterns

| Pattern | How it relates | Key difference |
|---|---|---|
| **Decorator** | Both have the same interface as the subject and wrap an object. | Proxy **controls access** (when, who, how); Decorator **adds behavior** (responsibilities). Proxy creates the subject; Decorator receives it. |
| **Adapter** | Both wrap an object to present an interface. | Proxy provides the **same** interface as the subject; Adapter provides a **different** interface. Proxy is transparent; Adapter is transformative. |
| **Facade** | Both provide a simplified interface. | Proxy controls access to a **single** object; Facade provides a unified interface to a **subsystem** of objects. |
| **Lazy Initialization** | Virtual Proxy is a specific form of lazy initialization. | Lazy Init is a general technique; Proxy formalizes it with a subject interface, dedup, and access control. |
| **Caching** | Virtual Proxy often includes caching (like our `loadingPromise` + `state`). | Caching is a concern that Proxy can implement, but caching alone doesn't constitute a full Proxy pattern. |
| **Factory Method** | Our factory functions (`createBotStateProxy`, `createPositionsProxy`) use Factory Method. | The factory creates the proxy; the proxy pattern is what the factory produces. They compose naturally. |

## Interview Tips

Common Proxy pattern interview questions and how to answer them:

**Q: What's the difference between Proxy and Decorator?**
Both have the same interface as the wrapped object. Proxy controls **access** (creation, permissions, location); Decorator adds **behavior** (logging, formatting, transformation). Proxy usually creates the subject itself; Decorator receives the subject from outside.

**Q: What's the difference between Proxy and Adapter?**
Proxy provides the **same** interface as the subject (transparent indirection). Adapter provides a **different** interface (interface translation). A credit card is a proxy for a bank account (same interface: "pay"), but a power plug adapter changes the interface.

**Q: What are the 4 types of proxies?**
Virtual (lazy), Protection (access), Remote (network), Smart Reference (logging/locking/ref counting).

**Q: How would you implement a caching proxy?**
Wrap the expensive operation (DB query, API call, computation). Check the cache first; return cached value if fresh, otherwise execute the operation, cache the result, and return it. Consider TTL, invalidation, and concurrent request deduplication.

**Q: When would you use a Virtual Proxy vs just lazy loading?**
Virtual Proxy is a pattern — it includes the subject interface, formal indirection, and often dedup/caching. "Just lazy loading" with a null check works for simple cases, but as soon as you need multiple consumers, dedup, invalidation, or a clean management API, the Proxy pattern pays off.

**Q: How does Java's `java.lang.reflect.Proxy` work?**
It generates a dynamic proxy class at runtime for a given list of interfaces. Method calls on the proxy are dispatched to an `InvocationHandler.invoke()` method. This is the foundation of Spring AOP, declarative transactions, and `@Cacheable`.

**Q: How do JavaScript's `Proxy` and `Reflect` APIs relate?**
`Reflect` is the companion to `Proxy`. Inside a proxy trap (e.g., `get`, `set`), use `Reflect.get(target, prop, receiver)` instead of `target[prop]`. `Reflect` methods return proper values (e.g., `Reflect.set` returns `true`/`false`) and correctly propagate the `receiver` (the proxy itself) to nested operations, maintaining transparent observability.
