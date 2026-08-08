# State Pattern — Bot State Machine

## History & Origin

The **State pattern** was first catalogued by the **Gang of Four** (Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides) in *Design Patterns: Elements of Reusable Object-Oriented Software* (1994). However, the core idea — an object whose behaviour depends on its internal state — predates OOP by decades.

The concept is rooted in **finite state machines (FSMs)**, a mathematical model of computation where a machine can be in exactly one of a finite set of states at any given time. FSMs were formalised in the 1950s (Mealy 1955, Moore 1956), but their intellectual lineage traces back to **Alan Turing's Turing Machine** (1936), which is itself an FSM coupled with an infinite tape. By the 1980s, FSMs were ubiquitous in compilers (lexers, parsers), telecommunications protocols, and hardware design. The State pattern simply wraps FSM semantics in OO clothing: instead of a centralised switch statement, each state is its own class, and the context delegates to the current state object.

## Problem Statement

Consider an object whose behaviour depends on its internal state. For example, a TCP connection responds differently to `open()`, `close()`, `acknowledge()` depending on whether it is `LISTEN`, `SYN_SENT`, `ESTABLISHED`, or `CLOSE_WAIT`. Without the State pattern, every method needs a large conditional:

```ts
function open() {
  switch (this.state) {
    case LISTEN:  /* connect */ break;
    case ESTABLISHED: /* already open, maybe throw */ break;
    case CLOSE_WAIT: /* reopen */ break;
    // …
  }
}
function close() {
  switch (this.state) { /* … */ }
}
```

**Consequences of this approach:**

- **State-specific behaviour is scattered** across every method, making it hard to see what a given state does.
- **Adding a new state means editing every method** — a violation of the Open/Closed Principle.
- **Transitions are implicit**, buried inside switch branches; there is no single place to audit which transitions are legal.
- **Conditional logic repeats** — the same `if (state === X)` guard appears in method after method.

The State pattern solves all three: state-specific logic lives in one class per state, transitions are declared in one table, and new states can be added by writing one new class and one or two table rows.

## Real-World Usage

The State pattern (and FSM thinking in general) appears in nearly every layer of a modern system:

| Domain | Example |
|---|---|
| **TCP / Networking** | `LISTEN → SYN_SENT → ESTABLISHED → CLOSE_WAIT → LAST_ACK → CLOSED`. The canonical textbook FSM — every RFC is a state machine spec. |
| **UI Components** | A button can be `enabled`, `disabled`, `focused`, `pressed`, `hovered`. Each state draws itself differently and accepts different input events. |
| **Workflow / Document Approval** | A document cycles through `draft → submitted → under_review → approved/rejected → published`. Transitions trigger email notifications, audit logs, and permission changes. |
| **Game Character States** | A player character transitions between `idle → running → jumping → attacking → damaged → dead`. Each state restricts available animations and input handling. |
| **Order Processing** | An e-commerce order moves through `pending → confirmed → processing → shipped → delivered → returned → cancelled`. Each transition may charge a payment, send an email, or update inventory. |
| **React Router** | Route transitions are themselves state machines: `idle → loading → error → loaded → idle`. React Router v6 uses an FSM internally to manage navigation. |
| **Bot Lifecycle (this codebase)** | `STOPPED → STARTING → RUNNING → STOPPING → STOPPED` with an `ERROR` escape hatch. See below for the full implementation. |
| **Network Connectivity** | `online → offline → reconnecting → online`. The browser's `navigator.onLine` maps to a trivial FSM, but real apps often layer retry logic and backoff on top. |
| **Authentication Flow** | `unauthenticated → authenticating → authenticated → expired → unauthenticated`. Token refresh is a sub-state machine. |
| **Parsers / Compilers** | Lexers and parsers are textbook FSMs. Every regular expression compiles to an FSM. |

## When to Use / When to Avoid

**Use the State pattern when:**

- An object's behaviour depends on its state and must change at runtime.
- Operations have large, multi-way conditionals that depend on the object's state.
- You are adding new states frequently and want to follow the Open/Closed Principle.
- State-specific behaviour is complex enough that isolating it in a class pays off (more than ~3 states or more than ~2 methods per state).
- You need a single, auditable place to declare valid transitions.

**Avoid (or use a simpler alternative) when:**

- There are only 2–3 states and each has trivial behaviour. A boolean flag or a small `switch` is clearer.
- State transitions never carry data. A lightweight table-driven FSM (a map of `[state, event] → nextState`) might be enough without full classes.
- The system has dozens of states but almost no per-state behaviour. Consider a **table-driven FSM** instead.
- Performance is critical and the overhead of virtual method dispatch per operation matters (rare — only in hot loops processing millions of events).

## Intent

> **GoF**: Allow an object to alter its behavior when its internal state changes. The object will appear to change its class.

The State pattern encapsulates state-specific logic into discrete objects and delegates behavior to the current state. A central context (the state machine) tracks the current state and routes events through a deterministic transition table.

In this codebase the pattern models the **bot lifecycle** — a bot progresses through `STOPPED → STARTING → RUNNING → STOPPING → STOPPED` (or detours through `ERROR`). Each transition is explicit, invalid ones are rejected, and observers can react to every change.

## Structure

### Classic GoF State Pattern

```
┌──────────┐    owns current     ┌──────────────────┐
│  Context │─────────────────────►│    State         │
│──────────│                      │──────────────────│
│ state    │                      │ + handle(context)│
│ request()│                      └────────┬─────────┘
└─────┬────┘                               │
      │ delegates                           │ implements
      ▼                                     ▼
┌──────────────────────────────────────────────────────┐
│                    ConcreteStates                     │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│
│  │ ConcreteStateA│  │ ConcreteState│  │ ConcreteState││
│  │              │  │      B       │  │      C       ││
│  │──────────────│  │──────────────│  │──────────────││
│  │ handle() {   │  │ handle() {   │  │ handle() {   ││
│  │   transition │  │   transition │  │   transition ││
│  │   to B       │  │   to C       │  │   to A       ││
│  │ }            │  │ }            │  │ }            ││
│  └──────────────┘  └──────────────┘  └──────────────┘│
└──────────────────────────────────────────────────────┘
```

### This codebase's structure

```
┌──────────────────────────────────────────────────────────┐
│                    BotStateMachine                        │
│──────────────────────────────────────────────────────────│
│  - currentState: BotState                                 │
│  - transitions: StateTransition[]                         │
│  - context: Map<string, unknown>                          │
│  - observers: StateChangeCallback[]                       │
│──────────────────────────────────────────────────────────│
│  + getState(): BotState                                   │
│  + canTransition(event): boolean                          │
│  + transition(event): boolean                             │
│  + getValidEvents(): BotEvent[]                           │
│  + onStateChange(cb): () => void                          │
│  + registerHandler(state, handler): void                  │
│  + setState(state): void                                  │
│  + reset(): void                                          │
└────────────────────┬─────────────────────────────────────┘
                     │ holds current state
                     ▼
              BotState enum
     ┌──────────────────────────────┐
     │  STOPPED │ STARTING          │
     │  RUNNING │ STOPPING │ ERROR  │
     └──────────────────────────────┘

  Transition table                  ┌──────────────────┐
  (Stopped)──────START────►(Starting)───STARTED──►(Running)
       ▲                            │                   │
       │                        ERROR                ERROR
       │                            ▼                   ▼
       │                         (Error)◄────────────(Error)
       │ RESET                     │                    │
       └───────────────────────────┘              STOP   │
                                                   ▼     │
                                               (Stopping)│
                                                   │     │
                                              STOPPED     │
                                                   │ ERROR│
                                                   ▼     │
                                                 (Error)──┘
```

## State vs Strategy

This is one of the most common design-pattern interview questions because the two patterns share the **same class structure** (a context that delegates to a polymorphic "handler").

| Dimension | State | Strategy |
|---|---|---|
| **Intent** | Change behaviour when state changes | Select an interchangeable algorithm |
| **States/strategies know about each other?** | Yes — states define transitions to other states | No — strategies are independent |
| **Who decides the active object?** | The state machine (state transitions itself) | The client (caller picks the strategy) |
| **Number of objects** | Typically many (one per state) | Fewer (one per algorithm variant) |
| **Parallels** | FSM — "what state am I in?" | Plug-in — "which algorithm should I use?" |
| **Context changes its own state?** | Yes — states return the next state | No — strategy is set from outside |
| **Methods** | Often many (each event/trigger) | Usually one (e.g., `execute()`, `calculate()`) |

**Key sentence to remember in an interview:**

> "State and Strategy have the same structure but different intent. In State, the **context's own behaviour** changes because its **internal state changes**; the state object decides which state comes next. In Strategy, the **client** picks a strategy object to change the context's behaviour."

In our codebase, you can see the difference: `BotStateMachine` does not let external callers set `RUNNING` directly — they must send the `"STARTED"` event, and only the `STARTING` state accepts it. In a Strategy pattern, the caller would simply `machine.setStrategy(new RunningStrategy())`.

## Table-Driven vs Class-Based State Machines

There are two common ways to implement an FSM:

### Table-Driven (this codebase's approach)

Transitions are declared declaratively in an array of `{ from, to, event }` tuples.

```ts
const transitions: StateTransition[] = [
  { from: [BotState.STOPPED],  to: BotState.STARTING, event: BotEvent.START },
  { from: [BotState.STARTING], to: BotState.RUNNING,  event: BotEvent.STARTED },
  // …
];
```

**Pros:**
- Transition rules are **auditable at a glance** — one table shows every legal path.
- Adding a new transition is a **one-line addition** to the table.
- All invalidity is handled centrally — no state class can accidentally allow an illegal transition.
- Easy to serialize or generate from a spec.

**Cons:**
- Per-state lifecycle logic (`onEnter`, `onExit`) must be registered separately.
- Complex guards (transition only if some condition holds) require extra fields or callbacks.

### Class-Based

Each state is its own class with methods for every event. The state returns the next state (or `this` to stay).

```ts
class StoppedState extends BotStateNode {
  onStart(): BotStateNode { return new StartingState(); }
  onStop(): BotStateNode { return this; /* illegal, stay */ }
}
class StartingState extends BotStateNode {
  onStarted(): BotStateNode { return new RunningState(); }
  onError():  BotStateNode { return new ErrorState(); }
}
```

**Pros:**
- State-specific logic lives **inside the class** — no need to look up a handler.
- Complex guard conditions are easy: just add an `if` before returning next state.
- Each state can have its own fields and sub-machines.

**Cons:**
- The transition graph is **implicit** — you have to read every method to understand which transitions exist.
- More boilerplate (one class per state, one method per event).
- Harder to audit — illegal transitions are just missing methods, which may or may not throw.

### When to use which

| Approach | Best for |
|---|---|
| **Table-driven** | Few per-state behaviours, many states, need for auditability, machine-generated state machines |
| **Class-based** | Rich per-state behaviours, complex guards, each state has its own local data |

This codebase uses a **hybrid**: table-driven transitions for validity (the single source of truth for *which* transitions are legal), plus optional `BotStateHandler` classes for lifecycle hooks. This gives you the auditability of a transition table with the extensibility of class-based handlers.

## Transition table

| From | Event | To |
|---|---|---|
| STOPPED | START | STARTING |
| STARTING | STARTED | RUNNING |
| STARTING | ERROR | ERROR |
| RUNNING | STOP | STOPPING |
| RUNNING | ERROR | ERROR |
| STOPPING | STOPPED | STOPPED |
| STOPPING | ERROR | ERROR |
| ERROR | RESET | STOPPED |

## Implementation explanation

The implementation lives in `src/patterns/state/BotStateMachine.ts` and consists of four layers:

1. **BotState enum** — The finite set of possible states (`STOPPED`, `STARTING`, `RUNNING`, `STOPPING`, `ERROR`). TypeScript enums give us exhaustiveness checking at compile time.

2. **BotEvent type** — A union of string literals representing every trigger (`"START"`, `"STOP"`, `"ERROR"`, `"STARTED"`, `"STOPPED"`, `"RESET"`). Using a union instead of an enum keeps event names concise in logs and network payloads.

3. **StateTransition interface** — A single rule: `{ from: BotState[], to: BotState, event: BotEvent }`. The `from` field is an array so one rule can cover symmetrical transitions (e.g., both STARTING and RUNNING can receive `"ERROR"`). The full transition table is declared once in `defaultTransitions()`.

4. **BotStateMachine class** — The context that owns the current state, the transition table, an observer list, and a free-form `context` map. Public methods are:
   - `getState()` / `getValidEvents()` — query-only, no side effects.
   - `canTransition(event)` — predicate check before attempting a transition.
   - `transition(event)` — validates the rule, calls `onExit` on the old state handler, updates state, calls `onEnter` on the new state handler, then notifies observers.
   - `onStateChange(callback)` — observer subscription; returns an unsubscribe closure.
   - `setState(state)` / `reset()` — imperative overrides (useful for recovery, but generally prefer `transition`).

The optional **BotStateHandler** interface adds lifecycle hooks (`onEnter`, `onExit`, `handle`) so that state-specific logic (e.g., polling a health endpoint while RUNNING) can be slotted in without touching the machine class.

## Code walkthrough

### Creating a machine and observing transitions

```ts
const machine = new BotStateMachine();

const unsub = machine.onStateChange((from, to, event) => {
  console.log(`Bot went from ${from} → ${to} via ${event}`);
});

machine.transition("START");   // STOPPED → STARTING
machine.transition("STARTED"); // STARTING → RUNNING

unsub(); // stop listening
```

### Checking validity before transition

```ts
if (machine.canTransition("STOP")) {
  machine.transition("STOP"); // RUNNING → STOPPING
}
```

### Querying available events

```ts
const events = machine.getValidEvents();
// When RUNNING: ["STOP", "ERROR"]
// When ERROR:   ["RESET"]
```

### Using context for ancillary data

```ts
machine.context.set("botId", "abc-123");
machine.context.set("pid", 4711);
machine.context.set("errorMessage", "Connection timeout");
```

### State handler example (lifecycle hooks)

```ts
class RunningHandler implements BotStateHandler {
  onEnter(machine: BotStateMachine) {
    console.log("Bot is now running — start health polling");
  }
  onExit(machine: BotStateMachine) {
    console.log("Bot leaving RUNNING — stop health polling");
  }
  handle(event: BotEvent, machine: BotStateMachine) {
    return null; // defer to transition table
  }
}

machine.registerHandler(BotState.RUNNING, new RunningHandler());
```

## How to use

1. **Import** `BotStateMachine` and `BotState` from `src/patterns/state/BotStateMachine.ts`.
2. **Instantiate** with `new BotStateMachine()` (defaults to `STOPPED`).
3. **Drive transitions** by calling `machine.transition(event)` in response to UI actions (start/stop buttons), WebSocket messages (`STARTED`, `STOPPED`), or error handlers (`ERROR`).
4. **Subscribe** to state changes with `machine.onStateChange(callback)` to update React state, show notifications, or toggle UI elements.
5. **Query** the machine before acting — e.g., disable the "Start" button when `!machine.canTransition("START")`.

### Mapping to BotStatus

| `BotStateMachine` | `BotStatus.status` (backend) | Meaning |
|---|---|---|
| STOPPED | `"stopped"` | Not running, no PID |
| STARTING | — (transient) | Start requested, waiting for ack |
| RUNNING | `"running"` | Active with PID |
| STOPPING | — (transient) | Stop requested, waiting for ack |
| ERROR | `"unknown"` / `error` field set | Something went wrong |

## Real-world note

The backend `BotStatus` interface in `types/bots.ts` already exposes a `status` field typed as `"running" | "stopped" | "unknown"`. This frontend state machine mirrors that lifecycle with finer granularity: it adds the transient states `STARTING` and `STOPPING` (which exist in reality between the user clicking "Start" and the backend confirming the process is up), and a dedicated `ERROR` state separate from the ambiguous `"unknown"`. When the machine reaches `RUNNING` or `STOPPED`, the machine's state maps directly to the backend `BotStatus.status` value.

## Relations to Other Patterns

| Pattern | Relation |
|---|---|
| **Strategy** | Same structure, different intent. Strategy is for pluggable algorithms; State is for state-dependent behaviour. See the section above for a full comparison. |
| **Singleton** | State handler objects are often stateless (their `onEnter`/`onExit`/`handle` methods take the machine as a parameter). Stateless handlers can be shared, and are often implemented as singletons to avoid allocating a new instance every time. |
| **Flyweight** | Related to the Singleton point above: when state handlers are stateless and shared across many contexts, they follow the Flyweight pattern (intrinsic state = the handler's methods, extrinsic state = the `context` map). |
| **Command** | Events that trigger state transitions can be represented as Command objects. This is useful when transitions need to be queued, logged, or undone. In this codebase, events are simple string literals, but a `Command` wrapper could carry parameters (e.g., `{ type: "ERROR", payload: { message: "timeout", code: 503 } }`). |
| **Observer** | The `onStateChange` callback list is a textbook Observer pattern. Observers decouple the state machine from UI updates, logging, and analytics. |
| **Mediator** | A state machine can act as a mediator between components when state transitions trigger coordinated updates across a system. |

## Interview Tips

### Common questions and how to answer them

**Q: What's the difference between State and Strategy?**

Use the table above. The key insight: same structure, different intent. State = "my internal state changed, so my behaviour changes". Strategy = "the caller picked a different algorithm".

**Q: How would you implement a simple FSM without the State pattern?**

A single `state` variable + a lookup table (or switch) per event. This works for ~3 states but quickly becomes unmaintainable. This is exactly the "problem" the State pattern solves. You can contrast the table-driven approach (clean) vs the scattered-switch approach (messy).

**Q: When does the State pattern become overkill?**

When you have 2-3 states with trivial behaviour (a boolean flag suffices), or when states have almost no per-state logic (a table-driven FSM with a single dispatch function is cleaner).

**Q: How would you handle concurrent state machines?**

Each machine is independent — instantiate two `BotStateMachine` instances. If they need to coordinate, use an Observer pattern (the second machine subscribes to the first's `onStateChange`), or use a parent state machine that contains both as sub-machines (hierarchical / Harel statecharts).

**Q: What's the difference between Mealy and Moore machines?**

- **Moore machine**: outputs depend only on the current state. Our `getValidEvents()` is Moore-like.
- **Mealy machine**: outputs depend on the current state *and* the input event. Our `transition(event)` return value (whether the transition succeeded) is Mealy-like.
- Most real-world FSMs (including ours) are **hybrids** of both.

**Q: How do you handle state machines in React?**

Options:
1. `useReducer` + reducer that implements FSM transitions (good for simple machines).
2. Dedicated FSM library like XState (good for complex, hierarchical machines).
3. A custom Hook that wraps `BotStateMachine` and triggers re-renders via `onStateChange`.
4. This codebase's approach: instantiate the machine externally, subscribe with `onStateChange` to update React state.

**Q: How do you test a state machine?**

- Test every valid transition: `assert.equal(machine.transition("START"), true)`.
- Test every invalid transition: `assert.equal(machine.transition("STOPPED"), false)`.
- Test that observers fire with the correct `(from, to, event)` tuple.
- Test that `getValidEvents()` returns the expected set for each state.
- Test that `canTransition` matches the transition table.
- Property-based testing: generate random event sequences and verify the machine never enters an undefined state.

**Q: How do you visualize or debug state machines?**

- Log every transition with timestamps (our `onStateChange` does this).
- Maintain a transition history array for debugging.
- Generate a Mermaid or Graphviz diagram from the transition table automatically.
- React DevTools can show the current state value from your hook.
