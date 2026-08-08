# Observer Pattern

## History & Origin

The Observer pattern traces back to the **Model-View-Controller (MVC)** architecture, first described by **Trygve Reenskaug** while visiting Xerox PARC in the 1970s. Reenskaug envisioned a design where the **Model** (data) would notify **Views** (displays) of changes without the Model needing to know the View's details — the essence of Observer.

The **Gang of Four** (Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides) formalized the pattern in their 1994 book *Design Patterns: Elements of Reusable Object-Oriented Software*, giving us the canonical Subject/Observer structure that appears in most languages today.

Also known as **Publisher-Subscriber (Pub/Sub)**, the pattern has become foundational to:
- **UI frameworks** (MVC, MVVM, React's unidirectional data flow)
- **Event-driven architectures** (Node.js `EventEmitter`, DOM events)
- **Reactive programming** (RxJS, signals in Solid/Angular)
- **Distributed messaging** (Kafka, RabbitMQ, Redis Pub/Sub)

The pattern is so pervasive that modern frameworks often bake it in at the language or runtime level — JavaScript's `EventTarget` and DOM events are the most widely deployed Observer implementation in history.

---

## Problem Statement

Imagine you have a price feed object that receives live stock prices. When a price changes, several parts of your UI need to update:

- A price ticker widget
- A position P&L display
- A chart that appends the new price point
- A notification system that checks for threshold alerts

Without Observer, you'd write:

```ts
class PriceFeed {
  private ticker: TickerWidget;
  private pnl: PnLDisplay;
  private chart: PriceChart;
  private alerts: AlertService;

  onPriceUpdate(symbol: string, price: number) {
    this.ticker.update(symbol, price);
    this.pnl.recalculate(symbol, price);
    this.chart.append(symbol, price);
    this.alerts.check(symbol, price);
  }
}
```

This is tightly coupled. Adding a new consumer requires modifying `PriceFeed`. Removing one risks breaking it. You can't add subscribers dynamically at runtime without recompiling. Testing is harder because you must instantiate all dependencies.

Observer solves this by inverting the relationship: instead of the subject pushing to known dependents, dependents **subscribe** to changes, and the subject merely **notifies** its subscriber list. The subject has no knowledge of what subscribers do — it just broadcasts "something changed."

---

## Real-World Usage

Observer is everywhere in modern software, often hidden inside frameworks so you use it without realizing it:

| Domain | Example | How Implements Observer |
|--------|---------|------------------------|
| **DOM/Browser** | `element.addEventListener("click", handler)` | The element is the Subject; the handler is the Observer |
| **React** | `useEffect` / `useState` re-renders | Component re-renders are observers of state changes |
| **Redux** | `store.subscribe(listener)` | Store is Subject; connected components are Observers |
| **RxJS** | `observable.subscribe(observer)` | Observable is Subject; subscribers are Observers |
| **Node.js** | `EventEmitter.prototype.on()` | Emitter is Subject; registered callbacks are Observers |
| **Vue** | `watch()` / computed properties | Reactive system auto-tracks dependencies and notifies |
| **Angular** | `Subject` / `BehaviorSubject` / `EventEmitter` | Explicit Observable pattern throughout the framework |
| **Kafka** | Consumer groups subscribe to topics | Distributed Pub/Sub at scale |
| **WebSocket/SSE** | `useLivePrices` in this codebase | Server pushes events; client listeners are Observers |
| **This codebase** | `createSubscriber()` + `EventBus` | Lightweight pub/sub for cross-cutting concerns |

---

## When to Use / When to Avoid

### Use Observer when:

- A change to one object requires changing others, and you don't know how many objects need to change.
- An abstraction has two aspects — one dependent on the other. Encapsulating them in separate objects lets you vary and reuse them independently.
- A subject should notify dependents without being tightly coupled to their concrete types.
- You need broadcast communication: one sender, many receivers.
- You're building an event-driven system where producers and consumers are independent.

### Avoid Observer when:

- You have a **cyclic dependency** — Observer A updates Subject B, which notifies Observer A again, causing an infinite loop.
- You need **guaranteed delivery** — Observer (in its basic form) offers no persistence, retry, or ACK mechanism. If a subscriber is not registered when the event fires, it misses it.
- Your system has **strict ordering requirements** — Observer makes no guarantees about the order in which observers are notified.
- The notification overhead is too high — notifying hundreds of observers synchronously on every change could cause performance issues.
- A simple callback or direct method call would suffice — don't over-architect a two-line interaction.
- You're worried about **memory leaks** — forgotten subscriptions prevent garbage collection and cause stale callback execution.

---

## Intent

*Define a one-to-many dependency between objects so that when one object changes state, all its dependents are notified and updated automatically.*

— Gang of Four, *Design Patterns*

---

## Structure

### Classic GoF Diagram

```
┌─────────────┐         ┌───────────────────┐
│   Subject   │         │  Observer (iface) │
│─────────────│         │───────────────────│
│ +attach(o)  │◄────────│ +update(data)     │
│ +detach(o)  │    n     └───────────────────┘
│ +notify()   │                  ▲
└──────┬──────┘                  │
       │                  ┌──────┴──────┐
       │ notifies         │ Concrete    │
       │ every attached ─▶│ Observer    │
       │ observer         │             │
                          └─────────────┘
```

The classic pattern has three key roles:

1. **Subject** — maintains a list of observers; provides `attach()`/`detach()`/`notify()`.
2. **Observer interface** — declares the `update()` method that the subject calls.
3. **ConcreteObserver** — implements `update()` to keep its state consistent with the subject's.

### Our EventBus Variant

In our **topic-based EventBus** variant the "Subject" is centralised — publishers call `emit()` and subscribers call `on()` — so subjects and observers never hold direct references to each other.

```
  ┌──────────┐  emit("price:update")   ┌────────────┐
  │ Publisher│ ───────────────────────▶ │            │
  └──────────┘                         │  EventBus  │
                                       │ (mediator) │
  ┌──────────┐  on("price:update")     │            │
  │ Consumer  │ ◀────────────────────  └────────────┘
  └──────────┘
```

The key difference: classic Observer has **direct** subject→observer links; the EventBus is a **mediator** that sits between them.

---

## Push vs Pull Models

Observer patterns fall into two communication models:

### Push Model

The subject sends **detailed data** to observers as part of the notification:

```ts
// Subject pushes everything
notify() {
  for (const obs of this.observers) {
    obs.update({ symbol: "RELIANCE", ltp: 2850.50, change: 1.2, volume: 50000 });
  }
}
```

**Our EventBus uses push** — every `emit()` call carries the full payload.

**Pros:**
- Observers get everything they need in one call — no extra queries
- Simpler observer implementation
- Better for real-time systems where you want to minimize latency

**Cons:**
- May send more data than observers need
- Tightens the contract — changing the payload breaks all observers
- Wasted work if only some observers need the data

### Pull Model

The subject sends a **minimal notification** (often just "I changed"), and observers query the subject for details:

```ts
// Subject sends minimal notification
notify() {
  for (const obs of this.observers) {
    obs.update();
  }
}

// Observer pulls what it needs
update() {
  const newData = this.subject.getState();
  // ... use newData
}
```

**Classic GoF Observer uses pull** — `update()` takes no arguments or just the subject reference.

**Pros:**
- Flexible — each observer pulls only what it needs
- Looser coupling — changing the subject's internal state doesn't change the observer interface
- Naturally avoids over-fetching

**Cons:**
- More round trips (notify then query)
- Observers need a reference to the subject
- Subject must expose its internal state via getters
- Harder to reason about in concurrent systems

### Which to Choose

| Factor | Push | Pull |
|--------|------|------|
| Notification frequency | Low | High |
| Observer diversity | Homogeneous (all need same data) | Heterogeneous (each needs different data) |
| Latency sensitivity | High | Low |
| Subject state size | Small | Large |
| Coupling tolerance | Low | High |

When in doubt, start with Push and refactor to Pull if over-fetching becomes a problem. In practice, most event-driven UIs use Push because observers typically need the new data immediately.

---

## Event Bus vs Classic Observer

### Classic Observer (Direct References)

```
┌─────────┐     ┌──────────────┐
│ Subject ├────▶│ Observer A   │
│         ├────▶│ Observer B   │
│         ├────▶│ Observer C   │
└─────────┘     └──────────────┘
```

- Each observer registers directly with the subject via `attach(observer)`.
- The subject iterates its list and calls `observer.update()`.
- Subjects and observers hold **direct references** to each other.

### Event Bus (Mediated)

```
Publisher     EventBus      Consumer
    │            │              │
    │──emit()───▶│              │
    │            │──on(match)──▶│
    │            │              │
```

- Publishers and consumers **never know about each other**.
- The bus is a central intermediary that routes events from emitters to subscribers.
- Topics/patterns replace direct observer registration.

### When to Use Each

| Scenario | Prefer |
|----------|--------|
| Small number of well-known observers | Classic Observer |
| Cross-cutting concerns (auth, logging, analytics) | Event Bus |
| Performance-critical, low-latency path | Classic Observer (no dispatch overhead) |
| Highly decoupled, independently deployable components | Event Bus |
| You need wildcard/pattern matching on topics | Event Bus |
| Debugging and tracing are important | Event Bus (single dispatch point to log) |
| You want type safety with strong contracts | Either — both support generics |

### Hybrid Approach

Many real-world systems use both. In this codebase:
- **Per-store** `createSubscriber()` uses classic direct-observer form
- **Cross-cutting** communication uses the `EventBus` singleton
- **React** components observe store changes through hooks (`useStoreSubscription`)

---

## Implementation

This codebase already uses the Observer pattern in a lightweight form via `createSubscriber()` in `src/state/createSubscriber.ts`:

```ts
// Simple Set-based pub/sub — no topics, no payloads
export function createSubscriber() {
  const subscribers: Set<() => void> = new Set();
  function notify() { subscribers.forEach((cb) => cb()); }
  function subscribe(cb: () => void) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }
  return { subscribe, notify };
}
```

The `EventBus` class in `src/patterns/observer/EventBus.ts` extends this into a full observer infrastructure:

| Feature             | `createSubscriber`          | `EventBus`                           |
|---------------------|-----------------------------|--------------------------------------|
| Channels            | One implicit channel        | Named topics (strings)               |
| Payload             | None                        | Typed per-topic                      |
| Wildcards           | ✗                           | `"*"` and `"paper:*"`                |
| Once-listeners      | ✗                           | `.once()`                            |
| Singleton           | Per-store instance          | Global `eventBus` singleton          |

### Existing real-world observer: `useLivePrices`

The `src/hooks/useLivePrices.ts` hook is a real-world Observer in this codebase. It maintains a `Set<LivePricesSubscriber>` internally:

```ts
const listenersRef = useRef<Set<LivePricesSubscriber>>(new Set());
```

Each SSE "price" event iterates over all registered listeners and calls them with the updated price:

```ts
listenersRef.current.forEach((fn) => fn(data.symbol, pricesRef.current[data.symbol]));
```

This mirrors the `createSubscriber` pattern — a single channel with typed callbacks. An `EventBus` could replace this internal listener Set to allow decoupled consumers anywhere in the app.

---

## Code Walkthrough — `EventBus.ts`

### 1. Event map

```ts
export interface AppEvents {
  "price:update": { symbol: string; ltp: number };
  "position:open": { symbol: string; side: string };
  "position:close": { symbol: string; pnl: number };
  "bot:status": { botId: string; status: string };
  "auth:login": undefined;
  "auth:logout": undefined;
  "screener:update": { screener: string; count: number };
}
```

Each key is a topic string and its value is the payload type. Topics with `undefined` payload emit no argument.

### 2. Topic matching

```ts
function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return topic === prefix || topic.startsWith(prefix + ":");
  }
  return pattern === topic;
}
```

- `"*"` matches everything.
- `"paper:*"` matches `"paper:open"`, `"paper:close"`, but also `"paper"` itself.

### 3. `on()` / `off()` / `once()` / `emit()` / `clear()`

- `on()` registers a persistent listener; returns an unsubscribe thunk.
- `once()` registers a listener that auto-removes after its first invocation.
- `off()` removes a listener from both persistent and once maps.
- `emit()` walks both listener maps, checks wildcard match via `topicMatches`, and calls each matching callback. Errors are caught per-listener so one bad callback cannot break others.
- `clear()` removes all listeners, or those for a specific topic.

### 4. Singleton

```ts
export const eventBus = new EventBus<AppEvents>();
```

The `EventBus` class is generic, but a single pre-typed instance is exported so the whole app shares one bus without manual wiring.

---

## How to Use

### Subscribe to an event

```ts
import { eventBus } from "../patterns/observer/EventBus";

const unsub = eventBus.on("price:update", (data) => {
  console.log(`${data.symbol}: ₹${data.ltp}`);
});

// later, to clean up:
unsub();
```

### Subscribe to all events

```ts
eventBus.on("*", (payload) => {
  console.log("Some event happened", payload);
});
```

### Subscribe to a namespace

```ts
eventBus.on("position:*", (payload) => {
  // fires for "position:open", "position:close", etc.
});
```

### One-time listener

```ts
eventBus.once("bot:status", (data) => {
  console.log(`Bot ${data.botId} is now ${data.status} (first update only)`);
});
```

### Emit an event

```ts
eventBus.emit("price:update", { symbol: "RELIANCE", ltp: 2850.50 });
eventBus.emit("auth:login"); // no payload
```

### Clean up

```ts
eventBus.clear();          // remove ALL listeners
eventBus.clear("bot:*");   // remove listeners for pattern "bot:*"
```

---

## Real-World Usage in This Codebase

| Location                     | Pattern variant             | What it observes                  |
|------------------------------|-----------------------------|-----------------------------------|
| `src/state/createSubscriber.ts` | Simple Set-based pub/sub    | Generic store change notification |
| `src/hooks/useLivePrices.ts` | Manual `Set<Subscriber>`    | SSE live price ticks              |
| `src/state/store/*.ts`       | Redux slices (`appSlice`)   | Global app state via `useSelector`|
| `src/components/common/ChatPopup.tsx` | Callback props       | User chat interaction             |

The `EventBus` fills the gap between per-store `createSubscriber` and Redux — it provides a global, typed, topic-routed event system for cross-cutting concerns (price ticks, position lifecycle, bot state, auth changes, screener updates) without coupling publishers to consumers.

---

## Relations to Other Patterns

### Mediator

The **EventBus is Observer + Mediator combined**. The Mediator pattern centralizes communication between components so they don't refer to each other explicitly. Our `EventBus` plays the mediator role — publishers and consumers never hold direct references. The difference:

- **Pure Observer**: subject `A` notifies observer `B` directly.
- **Mediator**: `A` tells the mediator, the mediator tells `B` (and `C`, `D`, etc.).
- **EventBus**: `A` calls `emit()`, the bus calls all matching `on()` handlers — this is both Observer (one-to-many notification) and Mediator (central routing).

### Singleton

The `EventBus` is exported as a **Singleton** — `export const eventBus = new EventBus<AppEvents>()`. This ensures all publishers and consumers share one routing table. Without the singleton, you'd need to pass the bus around or use dependency injection, which defeats the goal of decoupled communication.

### Command

Observer and Command pair naturally: when a **Command** executes, it can **emit** an event that triggers side effects. For example, a `ClosePositionCommand` could emit `"position:close"` on the EventBus, and the UI, logger, and Telegram notifier each observe that event independently.

```ts
execute(command: ClosePositionCommand) {
  // ... execute logic
  eventBus.emit("position:close", { symbol, pnl });
}
```

### MVC (Model-View-Controller)

Observer is the **core mechanism of MVC**. The Model is the Subject; Views are Observers. When the Model changes, it notifies all Views, which re-render. Controller mediates user input. This is the granddaddy of all Observer-based architectures.

```
Controller ──mutates──▶ Model ──notifies──▶ View (Observer)
                         ▲                    │
                         └────── reads ───────┘
```

### React State → View Binding

React doesn't explicitly use Observer, but the **mental model is identical**. When `useState` or `useReducer` state changes, React re-renders the component tree that depends on that state. Components "subscribe" to state via hooks. The reconciliation algorithm determines which Observers (components) to notify.

- **Subject**: React state (or Redux store)
- **Observer**: React component (or `useSelector`)
- **Notification trigger**: setState / dispatch
- **Update method**: re-render

This is why `createSubscriber` in this codebase mirrors `React.useState`'s subscription model at a lower level.

---

## Interview Tips

Observer is one of the most frequently asked design pattern questions. Here's what to focus on:

### Common Questions

**Q: What's the difference between Observer and Pub/Sub?**

In classic Observer, the subject holds direct references to observers and calls them directly. In Pub/Sub, a **message channel/broker sits between** publishers and subscribers — they never know about each other. Pub/Sub is more decoupled but adds overhead. Our `EventBus` is Pub/Sub, while `createSubscriber()` is classic Observer.

| Aspect | Observer | Pub/Sub |
|--------|----------|---------|
| Coupling | Direct (subject knows observers) | None (broker mediates) |
| Communication | Synchronous by default | Can be async (message queue) |
| Implementation | Observer interface | Event channels/topics |
| Scalability | Same process | Can span processes/machines |

**Q: What's the difference between Observer and Mediator?**

Mediator centralizes communication between many objects, keeping them from referencing each other. Observer distributes communication — one subject notifies many observers. Our EventBus is Observer+Mediator: it distributes events (Observer) through a central channel (Mediator).

**Q: How would you implement an event bus?**

1. Define an event map (topic → payload type) for type safety.
2. Store listeners in a `Map<string, Set<Listener>>`.
3. Implement `on()` to add a listener by topic, returning an unsubscribe function.
4. Implement `emit()` to look up matching listeners and call each one.
5. Support wildcards (`*`, `topic:*`) for pattern subscriptions.
6. Handle errors per-listener so one failure doesn't break notification.
7. Export as a singleton or provide via DI.

**Q: What are the memory leak risks with Observer?**

The biggest risk: **forgotten subscriptions**. If a component subscribes but never unsubscribes:

- The subject holds a reference to the observer, preventing garbage collection.
- The observer continues receiving updates even after it's no longer needed.
- Stale callbacks can cause "zombie" side effects (e.g., updating unmounted component state).

How to prevent:

1. Always return an unsubscribe function (thunk pattern).
2. React components: unsubscribe in `useEffect` cleanup or `componentWillUnmount`.
3. Use `once()` for one-shot listeners.
4. Consider weak references (e.g., `WeakSet`/`WeakMap`) for long-lived subjects.
5. Add a `clear()` method for bulk cleanup (e.g., on page navigation).

**Q: How does React's reconciliation relate to Observer?**

React's state management follows the Observer pattern at a conceptual level:

- **State** (`useState`, `useReducer`, Redux) is the Subject
- **Components** are Observers — they "subscribe" to state via hooks
- When state changes, React doesn't call `update()` on each component — instead it triggers a **re-render cycle** and uses the **virtual DOM diff** to efficiently update only what changed

The key difference: React batches notifications and uses reconciliation to optimize the update, rather than calling a direct `update()` method on each observer. This is Observer with a **smart notification mechanism**.

**Q: What happens if emit() throws an error? What about async observers?**

A robust EventBus should:

1. **Catch errors per-listener** so a crash in one handler doesn't prevent others from receiving the event.
2. **Support async handlers** — either `await` all handlers (ordered) or fire-and-forget (unordered, but errors might go uncaught).
3. **Consider a dead-letter queue** for persistently failing handlers.

Our EventBus wraps each listener call in a try/catch:

```ts
try {
  listener(payload as any);
} catch (err) {
  console.error(`[EventBus] listener error on "${topic}":`, err);
}
```
