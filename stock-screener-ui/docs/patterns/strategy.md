# Strategy Pattern — ParamValidationStrategy

---

## 1. History & Origin

The **Strategy** pattern was first formally described by the **Gang of Four** (Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides) in their seminal 1994 book *Design Patterns: Elements of Reusable Object-Oriented Software*. It is one of the most frequently used patterns in the GoF catalog because it directly embodies the core OO principle **"Favor composition over inheritance"** — instead of subclassing to vary behavior, you encapsulate behaviors behind a common interface and delegate to them.

It is also known as the **Policy** pattern.

The Strategy pattern is a direct expression of the **Open/Closed Principle** (the "O" in SOLID): software entities should be **open for extension** (you can add new strategies) but **closed for modification** (you don't need to touch existing code when adding one).

---

## 2. Problem Statement

You face several related classes that differ **only in their behavior**. You need different variants of an algorithm, but you want to:

- **Avoid conditional statements** (`if`/`else`, `switch`) scattered across the codebase — conditionals grow linearly with each new variant and violate the Open/Closed Principle.
- **Make algorithms interchangeable at runtime** — the user (or system state) should be able to swap behavior without restarting or recompiling.
- **Isolate and test each variant independently** — a tangled conditional chain is hard to unit-test.
- **Keep the codebase maintainable** — every new variant should mean adding a new class, not modifying an existing one.

**Concrete example in this codebase**: Every strategy type (`ORB`, `SR_BREAKOUT`, `EMA_CROSS`, `52W_CHASER`, `52W_TARGET`) has different configuration parameters with distinct validation rules. Without the Strategy pattern, validation would be a giant `switch (strategyType)` monster function — hard to read, harder to extend, and impossible to test in isolation.

---

## 3. Intent

> **Define a family of algorithms, encapsulate each one, and make them interchangeable. Strategy lets the algorithm vary independently from the clients that use it.** — GoF

In this codebase, each strategy type (`ORB`, `SR_BREAKOUT`, `EMA_CROSS`, `52W_CHASER`, `52W_TARGET`) has different configuration parameters with distinct validation rules. The Strategy pattern extracts this scattered validation logic into focused strategy classes, making validation:

- **Extensible** — new strategy types just register a new strategy class
- **Testable** — each strategy can be unit-tested in isolation
- **DRY** — shared range-checking helpers live in one place

---

## 4. Real-World Usage

The Strategy pattern appears everywhere in real-world software:

| Domain | Example |
|---|---|
| **Java standard library** | `java.util.Comparator` — the `compare()` strategy is passed to `Collections.sort()` |
| **Python** | `sorted(list, key=len)` — the `key` function is a strategy |
| **JavaScript** | `Array.sort((a, b) => a - b)` — the comparator is a strategy |
| **Node.js** | Express/Koa middleware — each middleware is a strategy for handling HTTP requests |
| **Authentication** | Passport.js — auth strategies (OAuth, JWT, Local, OpenID) are pluggable strategies |
| **Payment processing** | A single `PaymentProcessor` delegates to `CreditCardStrategy`, `PayPalStrategy`, `UPIStrategy` |
| **Compression** | A `Compressor` delegates to `ZipStrategy`, `GzipStrategy`, `BrotliStrategy` |
| **Sorting** | A `Sorter` can delegate to `QuickSortStrategy`, `MergeSortStrategy`, `BubbleSortStrategy` |
| **Backend signal generation** | `BaseSignalGenerator` → `SRBreakoutSignalGenerator`, `EMACrossSignalGenerator`, `Week52ChaserSignalGenerator`, etc. |
| **This codebase's validation** | `ParamValidationStrategy` → `ORBValidationStrategy`, `SRBreakoutValidationStrategy`, `SwingValidationStrategy`, etc. |

---

## 5. When to Use / When to Avoid

### Use Strategy when:

- Many related classes differ **only in their behavior**
- You need different **variants of an algorithm**
- You need to **swap algorithms at runtime**
- You want to **isolate complex conditional logic** into separate testable units
- The algorithm uses data the client shouldn't know about (encapsulation)
- A class has many **conditional branches** that are likely to grow over time

### Avoid Strategy when:

- You only have a **handful of algorithms** that **never change** — a simple conditional is simpler and more readable
- The strategies would need **access to private members** of the context — breaking encapsulation
- You're dealing with **trivially small algorithms** — the overhead of classes/interfaces isn't justified
- The number of strategies is **unbounded** and each is rarely used — consider a functional approach (passing lambdas/functions instead of full objects)
- The client must be **aware of all strategies** and choose between them (this can be mitigated with a registry)

---

## 6. Structure

### Classic GoF Strategy Pattern

```
┌───────────┐       ┌──────────────────────────────┐
│  Context  │───────│      «interface»              │
│           │       │      Strategy                 │
│ +context  │       │  ──────────────────────────── │
│ Interface │       │  +execute(data): Result       │
└───────────┘       └──────────┬───────────────────┘
                               │
                  ┌────────────┼────────────┐
                  │            │            │
          ┌───────▼───┐ ┌─────▼──────┐ ┌───▼────────┐
          │Concrete   │ │Concrete    │ │Concrete    │
          │Strategy A │ │Strategy B  │ │Strategy C  │
          │           │ │            │ │            │
          │+execute() │ │+execute()  │ │+execute()  │
          └───────────┘ └────────────┘ └────────────┘
```

The **Context** holds a reference to a `Strategy` interface. It delegates behavior to whichever concrete strategy is plugged in. The client (or a registry) decides which concrete strategy to use.

### Our Implementation

```
┌─────────────────────────────────────────────────────────┐
│                  ValidationStrategyRegistry              │
│                    (Singleton)                           │
│                                                         │
│  strategies: Map<string, ParamValidationStrategy>        │
│  ───────────────────────────────────────────────────     │
│  +getInstance()                                          │
│  +register(type, strategy)                               │
│  +get(type)                                              │
│  +validate(type, config): ValidationResult               │
└──────────┬───────────────────────────────────────────────┘
           │
           │  ┌──────────────────────────────────────────┐
           │  │        «abstract»                        │
           ├──│─  ParamValidationStrategy                 │
           │  │  ──────────────────────────────────────── │
           │  │  +readonly name: string                   │
           │  │  +validate(config): ValidationResult      │
           │  └──────────────────────────────────────────┘
           │                    │
     ┌─────┼─────┬──────────────┼──────────────┐
     │     │     │              │              │
┌────▼──┐┌─▼────┐┌─▼───────┐┌──▼──────────┐┌──▼──────────┐
│  ORB  ││  SR  ││  EMA    ││  52W_CHASER ││  52W_TARGET │
│Valid. ││Break.││ Cross   ││  (Swing)    ││  (Swing)    │
│Strat. ││Valid.││ Valid.  ││  Validation ││  Validation │
│       ││Strat.││ Strat.  ││  Strategy   ││  Strategy   │
└───────┘└──────┘└────────┘└─────────────┘└─────────────┘
                                      └─────┬─────┘
                                            │
                              Both use the same
                            SwingValidationStrategy
                              (shared class)
```

Note how the Registry acts as a **factory + locator** — it decouples the client (form UI, API) from concrete strategy construction. The client only needs to know the strategy type string.

---

## 7. Strategy vs Template Method

This is one of the most common design pattern interview questions. Both patterns separate an algorithm's structure from its implementation, but they do so in fundamentally different ways:

| Aspect | Strategy | Template Method |
|---|---|---|
| **Relationship** | Composition (has-a) | Inheritance (is-a) |
| **How behavior varies** | Delegated to separate objects | Overridden in subclasses |
| **Runtime swap** | Yes — strategies can be swapped at runtime | No — fixed at compile time |
| **Granularity** | Replaces entire algorithm | Overrides specific steps of an algorithm |
| **Code reuse** | Via shared interfaces + helper objects | Via the base class template method |
| **Complexity** | Higher (more classes, delegation) | Lower (single class hierarchy) |

### Both follow the "Hollywood Principle"

> **"Don't call us, we'll call you."**

In both patterns, the **framework** (or base class) calls into your **extension** code. You don't call the framework — the framework calls you:

- **Template Method**: The base class defines the skeleton algorithm and calls abstract hook methods that you override.
- **Strategy**: The context calls the strategy's method. You provide the strategy; the context doesn't know its details.

### When to choose which?

| Decision | Choose |
|---|---|
| "I need to swap behavior at runtime" | **Strategy** |
| "All variants share most steps, only a few differ" | **Template Method** |
| "I want to avoid creating many subclasses" | **Strategy** |
| "The algorithm structure is fixed, only details change" | **Template Method** |
| "I'm building a framework for others to extend" | **Template Method** (for hooks) + **Strategy** (for pluggable components) |

---

## 8. Implementation in This Codebase

### `ValidationResult`

The return type for every validation run — keeps errors (blocking) and warnings (advisory) separate:

```ts
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

### Abstract strategy

Each concrete strategy must implement `validate()` and expose a `name`:

```ts
export abstract class ParamValidationStrategy {
  abstract readonly name: string;
  abstract validate(config: Record<string, unknown>): ValidationResult;
}
```

### Concrete example — `ORBValidationStrategy`

Validates ORB-specific parameters plus shared SL/TP. Checks both individual ranges and the `min_or_range_pct < max_or_range_pct` invariant:

```ts
export class ORBValidationStrategy extends ParamValidationStrategy {
  readonly name = "ORB";

  validate(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    // ...range checks for or_minutes, min/max_or_range_pct, sl_pct, tp_pct...

    const minPct = numVal(config, "min_or_range_pct");
    const maxPct = numVal(config, "max_or_range_pct");
    if (minPct !== undefined && maxPct !== undefined && minPct >= maxPct) {
      errors.push("Min OR range % must be less than Max OR range %");
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }
}
```

### Registry (Singleton)

Maps `strategy_type` strings to their validators. Registering a new strategy type is a one-liner:

```ts
export class ValidationStrategyRegistry {
  private static instance: ValidationStrategyRegistry;
  private readonly strategies = new Map<string, ParamValidationStrategy>();

  static getInstance(): ValidationStrategyRegistry { /* ... */ }

  register(type: string, strategy: ParamValidationStrategy): void {
    this.strategies.set(type, strategy);
  }

  get(type: string): ParamValidationStrategy {
    const strategy = this.strategies.get(type);
    if (!strategy) throw new Error(`No validation strategy for "${type}"`);
    return strategy;
  }

  validate(type: string, config: Record<string, unknown>): ValidationResult {
    return this.get(type).validate(config);
  }
}
```

Built-in strategies are auto-registered in the private constructor:

```ts
private constructor() {
  this.register("ORB", new ORBValidationStrategy());
  this.register("SR_BREAKOUT", new SRBreakoutValidationStrategy());
  this.register("EMA_CROSS", new EMACrossValidationStrategy());
  this.register("52W_CHASER", new SwingValidationStrategy());
  this.register("52W_TARGET", new SwingValidationStrategy());
}
```

Note that both `52W_CHASER` and `52W_TARGET` share `SwingValidationStrategy` since they validate the same swing parameters (`entry_threshold_pct`, `trailing_stop_pct`, `max_holding_days`, `cooldown_days`).

---

## 9. Code Walkthrough

Here's the flow from form submission to validation result:

1. **User clicks "Save"** on a strategy config form in the UI.
2. **The form component** calls `ValidationStrategyRegistry.getInstance().validate(strategyType, config)`.
3. **The registry** looks up the registered strategy for `strategyType` (e.g., `"ORB"` → `ORBValidationStrategy`).
4. **The concrete strategy** runs its `validate()` method, which checks:
   - Individual parameter ranges (e.g., `or_minutes` must be between 1 and 60)
   - Cross-parameter invariants (e.g., `min_or_range_pct < max_or_range_pct`)
   - Required fields exist
5. **The result** (`ValidationResult`) is returned to the form:
   - If `valid` is `false`, errors are displayed as blocking validation messages.
   - Warnings (e.g., "TP is very tight, consider widening") are displayed as advisory notes.
6. **The user fixes issues** and resubmits, or the config is saved if valid.

This same registry approach is mirrored in the **backend signal generators** — `BaseSignalGenerator` defines the common signal interface, and each concrete generator (`SRBreakoutSignalGenerator`, `EMACrossSignalGenerator`, `Week52ChaserSignalGenerator`, etc.) implements its own trading logic. The strategy runner receives a strategy type and instantiates the correct generator via a similar registry pattern.

---

## 10. How to Use

```ts
import { ValidationStrategyRegistry } from "../../patterns/strategy/ParamValidationStrategy";

const registry = ValidationStrategyRegistry.getInstance();

// Full validation
const result = registry.validate("ORB", {
  or_minutes: 15,
  min_or_range_pct: 0.3,
  max_or_range_pct: 3.0,
  sl_pct: 1.0,
  tp_pct: 1.5,
});

if (!result.valid) {
  console.error(result.errors); // blocking issues
  console.warn(result.warnings); // advisory notes
}
```

Or get a specific strategy to run multiple validations:

```ts
const srStrategy = registry.get("SR_BREAKOUT");
console.log(srStrategy.name); // "S/R Breakout"
srStrategy.validate(config);
```

---

## 11. Adding a New Strategy Type

1. Create a new class extending `ParamValidationStrategy`
2. Implement `validate()` with the type-specific rules
3. Register it in `ValidationStrategyRegistry`'s constructor

```ts
this.register("MY_NEW_TYPE", new MyNewTypeValidationStrategy());
```

No other code changes needed — the Strategy pattern decouples validation from the form UI.

---

## 12. Relations to Other Patterns

| Pattern | Relationship |
|---|---|
| **Template Method** | Both separate algorithm structure from implementation. Template Method uses **inheritance** (override hooks in subclasses, fixed at compile time). Strategy uses **composition** (delegate to separate objects, swappable at runtime). See the detailed comparison in §7 above. |
| **State** | State is essentially Strategy where the "strategy" changes based on the object's **internal state**. The key difference: in State, the context switches strategies automatically as its state changes; in Strategy, the client (or a registry) chooses the strategy explicitly. The UML is nearly identical. |
| **Flyweight** | Strategies are often **stateless** (they only operate on data passed to them), which means they can be **shared** across many contexts as flyweights. Our `SwingValidationStrategy` is shared by both `52W_CHASER` and `52W_TARGET` — that's flyweight reuse. |
| **Decorator** | Strategy changes behavior via **delegation** (swap the entire algorithm). Decorator adds behavior via **wrapping** (layer responsibilities dynamically). Strategy: "I'll use a different engine." Decorator: "I'll wrap your engine with extra features." |
| **Command** | Both encapsulate behavior behind an interface. **Command** encapsulates a **request** (a specific action to perform later, possibly with undo). **Strategy** encapsulates an **algorithm** (a way of doing something). Command is about **when**/**if** to execute; Strategy is about **how** to execute. |

---

## 13. Interview Tips

### Common Questions

**Q: "Strategy vs State — what's the difference?"**
A: Both have nearly identical UML (context delegates to an interface, concrete implementations). The difference is **who decides the strategy**. In State, the context switches its state **automatically** based on internal transitions. In Strategy, the **client** (or registry) picks the strategy explicitly and it stays fixed until changed again. State is reactive to its own history; Strategy is chosen by an external decision.

**Q: "How does Strategy implement the Open/Closed Principle?"**
A: Adding a new strategy requires (1) a new class implementing the strategy interface, and (2) plugging it into the context or registry. Existing strategy classes and the context are **never modified**. The system is **open for extension** (new strategy) and **closed for modification** (no existing code changes).

**Q: "When would you use Strategy instead of a switch statement?"**
A: When the switch is likely to grow, when each branch is complex enough to warrant its own class, when you need to swap behavior at runtime, or when you want to unit-test each branch independently. For a simple 2-option switch that never changes, a switch is fine — don't over-engineer.

**Q: "Can strategies have state? When would they?"**
A: They can, but it's unusual — it reduces shareability (Flyweight reuse). Use-case: a strategy that caches computed results, or tracks its own success rate to adapt behavior. In our codebase, strategies are stateless — they take input and return output. The `Singleton` registry ensures shared instances are reused safely.

**Q: "How does Strategy relate to Dependency Injection?"**
A: Strategy is a natural fit for DI. Instead of a context creating its own strategy (tight coupling), you **inject** the strategy through the constructor, setter, or method parameter. This is exactly how our `ValidationStrategyRegistry.validate(type, config)` works — the strategy is looked up and "injected" into the validation call. DI containers can even auto-wire strategies.

**Q: "What are the downsides of Strategy?"**
A: (1) Class explosion — each strategy is a new class. Mitigate with lambdas/functions for simple cases. (2) Clients must be aware of different strategies (though a registry can abstract this). (3) Overhead if strategies are extremely simple — a function pointer is lighter than a full class hierarchy.

**Q: "How would you implement a default strategy?"**
A: Return a no-op or sensible-default strategy from the registry when an unknown type is requested (instead of throwing). Or use a `NullObject` strategy pattern — a strategy that does nothing, which is itself a valid pattern.

---

## Real-World Note

This mirrors the backend's `BaseSignalGenerator` → subclass hierarchy in `trading/base_signals.py`, where each signal generator (`SRBreakoutSignalGenerator`, `EMACrossSignalGenerator`, `Week52ChaserSignalGenerator`, etc.) encapsulates its own trading logic behind a common interface. The Strategy pattern keeps both frontend validation and backend signal generation aligned to the Open/Closed Principle — open for extension, closed for modification.
