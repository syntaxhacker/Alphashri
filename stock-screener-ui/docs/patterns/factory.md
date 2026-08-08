# Factory Method Pattern — Strategy Parameter Panels

## History & Origin

The Factory Method pattern was formally catalogued by the **Gang of Four** (Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides) in their seminal 1994 book *Design Patterns: Elements of Reusable Object-Oriented Software*. It is one of the original 23 patterns.

Factory Method is a **specialization of the Template Method pattern** — the factory's "create" method defines the skeleton of the creation algorithm while subclasses fill in the concrete product type. The concept of a "factory" for creating objects traces back even earlier, to Smalltalk-80 libraries (1980s) where `new` was itself a factory method on metaclasses.

**Three distinct "factory" patterns are often confused:**

| Pattern | GoF? | Description |
|---------|------|-------------|
| **Simple Factory** | No | A single class with one static method that creates objects. Not a real pattern, more of an idiom. |
| **Factory Method** | Yes | A single method in a base class, overridden by subclasses to decide which concrete product to instantiate. |
| **Abstract Factory** | Yes | An interface for creating **families** of related objects. Often implemented using Factory Methods. |

This codebase uses the **Factory Method** pattern (via a registry-based variation), not Simple Factory. The distinction matters: the registry pattern here achieves the same intent (subclassing the creation decision) while working within JavaScript's class constraints.

---

## Problem Statement

A class cannot anticipate the class of objects it must create. A class wants its subclasses to specify which objects to create, and you want to localize knowledge of which concrete class gets created.

Concretely, in this codebase: `StrategyForm.tsx` had **no business knowing** which panel component to render for each strategy type. Every time a new strategy was added (e.g., `52W_CHASER`, `52W_TARGET`), the form needed edits in multiple locations. This violates the **Open/Closed Principle** — the form should be open for extension but closed for modification.

The factory solves this by encapsulating the "which panel for which type" mapping in one place, so `StrategyForm.tsx` asks "give me the panel for type X" without caring which concrete panel that is.

---

## Real-World Usage

Factory Method appears across virtually every modern framework and library:

| Context | Example |
|---------|---------|
| **React** | `React.createElement(type, props, children)` is a factory — it creates a virtual DOM element based on the `type` argument. JSX compiles to factory calls. |
| **Browser DOM** | `document.createElement('div')` is the textbook Factory Method — the browser decides which concrete `HTMLElement` subclass to instantiate. |
| **JDBC (Java)** | `DriverManager.getConnection(url)` returns a `Connection` without the caller knowing which driver class handles it. |
| **Angular** | `ComponentFactoryResolver` creates component instances dynamically at runtime. |
| **Logging** | `LogFactory.getLogger(MyClass.class)` returns a logger without the caller knowing if it's log4j, slf4j, or java.util.logging. |
| **Collections** | `Collections.synchronizedList(list)` wraps a list in a synchronized decorator via a factory. |
| **UI Libraries** | This codebase's `StrategyParamPanelFactory` is a domain-specific example — panel components are created by type string. |
| **Testing** | Mock/stub factories that produce test doubles without test code knowing the production class. |

---

## When to Use / When to Avoid

### Use Factory Method when:
- A class **cannot know** the exact type of objects it must create ahead of time.
- A class wants its **subclasses to specify** which objects to create.
- You want to **localize** creation logic instead of scattering it across callers.
- The set of product types is expected to **grow over time** (open for extension).
- You want to **decouple** the client from concrete product classes.

### Avoid Factory Method when:
- The set of product types is **fixed and small** — a simple conditional or inline creation is clearer.
- The creation logic is **trivial** (e.g., `new Foo()`) — a factory adds indirection without benefit.
- You need to create **families of related objects** — use Abstract Factory instead.
- The overhead of a separate factory hierarchy outweighs the flexibility gained.
- A simple **config/object mapping** would suffice (JavaScript's dynamic nature often makes the full pattern overkill — but the registry variation used here avoids this issue).

---

## Intent

> "Define an interface for creating an object, but let subclasses decide which class to instantiate. Factory Method lets a class defer instantiation to subclasses."

— Gang of Four, *Design Patterns* (1994)

In this codebase: provide a central `StrategyParamPanelFactory` that decides which React component to render based on a `strategy_type` string, so that `StrategyForm.tsx` does not need to import or know about individual panel components.

---

## Structure

### GoF Canonical Structure

```
┌──────────────────────┐      ┌──────────────────────────┐
│      Creator         │      │       Product            │
│──────────────────────│      │──────────────────────────│
│ + factoryMethod()    │──────│ (interface/abstract)     │
│ + anOperation()      │      └──────────────────────────┘
└──────────┬───────────┘                    ▲
           │                                 │
           │ overrides                       │ implements
     ┌─────┴──────┐               ┌──────────┴──────────┐
     │Concrete    │               │  ConcreteProduct    │
     │Creator     │               │─────────────────────│
     │────────────│               │                     │
     │+ factory   │               └─────────────────────┘
     │ Method()   │
     └────────────┘
```

The client calls `creator.anOperation()`, which internally calls `factoryMethod()`. Subclasses of `Creator` override `factoryMethod()` to return different `ConcreteProduct` instances.

### This Codebase's Structure

This codebase adapts the pattern using a **registry + static factory** variation (idiomatic in JavaScript/TypeScript where subclassing the creator is less common than configuring it):

```
┌──────────────────────────────┐
│  StrategyParamPanelFactory   │  ◄── Factory (creator)
│  ┌────────────────────────┐  │
│  │  registry: Map<string, │  │
│  │    PanelComponent>     │  │
│  └────────────────────────┘  │
│  + initialize()              │
│  + registerPanel(type, comp) │
│  + createPanel(type, ...)    │
└──────┬───────────────────────┘
       │ createPanel(type)
       ▼
┌──────────────────────────────┐
│  StrategyParamPanel          │  ◄── Declarative React wrapper
│  (props: StrategyParamPanel  │
│   Props)                     │
└──────┬───────────────────────┘
       │ delegates to Factory
       ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  ORB     │ │SR_BREAK  │ │EMA_CROSS │ │52W_*    │
│  Panel   │ │OUT Panel │ │Panel     │ │Panel    │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

All panels implement the contract:
  (initialValues: StrategyFormData, isSwing: boolean) => JSX.Element
```

The **Product** is `JSX.Element` (the panel component). The **Creator** is `StrategyParamPanelFactory`. Instead of subclassing, the factory uses a `Map` registry that serves the same role — subclasses "register" the product they want created for each type string.

---

## Simple Factory vs Factory Method vs Abstract Factory

This distinction is one of the **most commonly asked** in design pattern interviews. Here is the complete breakdown:

| Aspect | Simple Factory | Factory Method | Abstract Factory |
|--------|---------------|----------------|------------------|
| **GoF pattern?** | No (idiom) | Yes | Yes |
| **Number of products** | One at a time | One at a time | A **family** of related products |
| **Hierarchy?** | No — just a single class with a static method | Yes — Creator hierarchy, subclasses override | Yes — AbstractFactory + ConcreteFactory hierarchy |
| **How to extend** | Edit the factory class (violates OCP) | Add a new Creator subclass | Add a new ConcreteFactory subclass |
| **Inheritance vs Composition** | Neither | Inheritance (subclass overrides factoryMethod) | Composition (client holds a factory reference) |
| **Product variety** | Single product type | Single product type, many variants | Multiple related product types (e.g., Windows/Mac UI widgets) |
| **Example** | `createParser(fileType)` with a switch | `Document.createPrinter()` overridden by subclasses | `GUIFactory.createButton()`, `createCheckbox()` for Win/Mac/Linux |
| **This codebase** | Not used — would be a single `createPanel()` with a switch | `StrategyParamPanelFactory` with registry (JS-idiomatic Factory Method) | Not used — only one product type (panels) |

**Interview answer template**: "Simple Factory is a programming idiom, not a pattern — it's a switch statement in a static method. Factory Method uses inheritance to let subclasses decide the product. Abstract Factory uses composition to create families of related products."

---

## Implementation

### Why Factory Method Fits Here

`StrategyForm.tsx` (lines 93–100) had a hard-coded if/else chain to select the active tab value whenever the strategy type changed:

```tsx
// OLD — StrategyForm.tsx:93-100
setActiveTab(
  newType === "ORB"
    ? "orb"
    : newType === "SR_BREAKOUT"
      ? "sr"
      : newType === "EMA_CROSS"
        ? "ema"
        : "52w",
);
```

And again at lines 342–353 to render the corresponding panel:

```tsx
// OLD — StrategyForm.tsx:342-353
{isOrb && <OrbParamsPanel initialValues={initialValues} isSwing={isSwing} />}
{isSrBreakout && (
  <SrBreakoutParamsPanel initialValues={initialValues} isSwing={isSwing} />
)}
{isEmaCross && <EmaParamsPanel initialValues={initialValues} isSwing={isSwing} />}
{isSwing && (
  <SwingParamsPanel
    initialValues={initialValues}
    isSwing={isSwing}
    is52wChaser={is52wChaser}
  />
)}
```

Every new strategy type required changes in **both** locations. The factory eliminates this duplication.

### Key Code Walkthrough

**1. The registry** — a static `Map` that holds type → component bindings:

```tsx
private static registry = new Map<string, PanelComponent>();
```

This is the core innovation over the textbook pattern: instead of subclassing the creator, we configure it with a registry. JavaScript/TypeScript's dynamic nature makes this more practical than class hierarchies in many cases.

**2. Built-in registration** — called once at module load:

```tsx
static initialize(): void {
  this.registry.set("ORB", OrbParamsPanel);
  this.registry.set("SR_BREAKOUT", SrBreakoutParamsPanel);
  this.registry.set("EMA_CROSS", EmaParamsPanel);
  this.registry.set("52W_CHASER", SwingParamsPanel);
  this.registry.set("52W_TARGET", SwingParamsPanel);
}
```

Notice that `SwingParamsPanel` is registered for **two** strategy types (`52W_CHASER` and `52W_TARGET`). The `is52wChaser` boolean prop distinguishes them at render time. This is a pragmatic choice — rather than creating two nearly identical panel components, the factory passes context to differentiate behavior.

**3. Extensibility hook** — third-party code can register without touching the factory:

```tsx
static registerPanel(type: string, component: PanelComponent): void {
  this.registry.set(type, component);
}
```

This is the **Open/Closed** payoff. External code (plugins, feature flags, experiments) can inject new panel types without modifying the factory source. In a class-hierarchy version of Factory Method, this would require creating a new `ConcreteCreator` subclass.

**4. Creation** — looks up the component and renders it:

```tsx
static createPanel(type, initialValues, isSwing): JSX.Element | null {
  const Panel = this.registry.get(type);
  if (!Panel) return null;
  return (
    <Panel
      initialValues={initialValues}
      isSwing={isSwing}
      is52wChaser={type === "52W_CHASER"}
    />
  );
}
```

The `null` return handles unknown types gracefully — the UI simply renders nothing instead of crashing. This is a **Null Object** variant for the missing-product case. The `is52wChaser` prop is derived from the type string at the factory level, keeping individual panels simpler.

**5. Declarative wrapper** — a plain React component so consumers can use JSX:

```tsx
export function StrategyParamPanel({ type, initialValues, isSwing }) {
  return StrategyParamPanelFactory.createPanel(type, initialValues, isSwing);
}
```

This wrapper exists because React's JSX syntax expects components, not raw function calls. It makes usage in templates consistent and declarative.

### Mapping to the Existing Panels

This factory replaces the manual if/else chain in `StrategyForm.tsx` that maps `strategy_type` to panel components.

| `strategy_type`    | Panel component        | Extra props                   |
|--------------------|------------------------|-------------------------------|
| `ORB`              | `OrbParamsPanel`       | —                             |
| `SR_BREAKOUT`      | `SrBreakoutParamsPanel`| —                             |
| `EMA_CROSS`        | `EmaParamsPanel`       | —                             |
| `52W_CHASER`       | `SwingParamsPanel`     | `is52wChaser={true}`          |
| `52W_TARGET`       | `SwingParamsPanel`     | `is52wChaser={false}`         |

---

## How to Use

### In StrategyForm.tsx (replace the existing if/else blocks)

```tsx
import { StrategyParamPanel } from "../../patterns/factory/StrategyParamPanelFactory";

// Inside the Tabs block, replace:
//   {isOrb && <OrbParamsPanel ... />}
//   {isSrBreakout && <SrBreakoutParamsPanel ... />}
//   ...
// With:
<StrategyParamPanel
  type={currentStrategyType}
  initialValues={initialValues}
  isSwing={isSwing}
/>
```

### Register a Custom Panel

```tsx
import { StrategyParamPanelFactory } from "../../patterns/factory/StrategyParamPanelFactory";
import { MyCustomPanel } from "./MyCustomPanel";

// Can be called anywhere before rendering (e.g. in a plugin init hook)
StrategyParamPanelFactory.registerPanel("MY_CUSTOM", MyCustomPanel);
```

---

## Benefits

| Concern                | Before (if/else chain)                    | After (factory)                   |
|------------------------|-------------------------------------------|-----------------------------------|
| Adding a new strategy  | Touch `StrategyForm.tsx` in 2+ places     | Call `registerPanel()` once       |
| Panel selection logic  | Scattered across `useEffect`, `onChange`  | Centralised in one `Map`          |
| Testing panel creation | Implicit — only through form integration  | Explicit — unit test the factory  |
| Open/Closed Principle  | Violated (form must change)               | Satisfied (new types are additive)|

Beyond this table, the factory also brings:
- **Decoupling**: `StrategyForm.tsx` no longer imports individual panel components
- **Single Responsibility**: The form handles layout, the factory handles selection
- **Testability**: You can test `createPanel()` in isolation by checking that it returns the right component for each type
- **Discoverability**: The registry in `initialize()` serves as a self-documenting list of all strategy types → panels

---

## Relations to Other Patterns

| Pattern | Relation to Factory Method |
|---------|---------------------------|
| **Template Method** | Factory Method is a **special case** of Template Method. The factory's creator class defines a "skeleton" (the `createPanel` signature), and subclasses/registrations fill in the details (which product to instantiate). Template Method generalizes this to any multi-step algorithm, not just creation. |
| **Abstract Factory** | Abstract Factory is **often implemented using Factory Methods**. Each concrete factory overrides multiple factory methods (one per product in the family). Abstract Factory's job is *families*; Factory Method's job is *single products*. |
| **Singleton** | Factory classes are **often implemented as Singletons** (this codebase uses static methods which is effectively a singleton). There's no need for multiple factory instances when the registry is global. However, Singleton is NOT required — you could have multiple factory instances with different registries for testing. |
| **Strategy** | Factory Method can **create a Strategy** object. The product of a factory could be a Strategy implementation. For example, a `PricingStrategyFactory` could return different pricing algorithms. In this codebase, the panel *is not* a strategy (it's a UI component), but the pattern composition applies. |
| **Composite** | Factory Method can create **Composite structures**. The factory returns a component that may itself contain subcomponents. In this codebase, panels could contain sub-panels, and the factory could recursively build the tree. |
| **Prototype** | Alternative to Factory Method — instead of creating new instances via a factory, you clone a prototype object. Factory Method is better when configuration is needed; Prototype is better when object setup is expensive. |
| **Builder** | Builds complex objects step by step. Factory Method creates an object in one call. If panel construction ever requires multiple configuration steps, extracting a Builder from the Factory Method would be the next refactoring. |

---

## Interview Tips

This is one of the most frequently tested patterns. Here is what interviewers look for:

### Common Questions

**Q: "What's the difference between Factory Method and Abstract Factory?"**
A: Factory Method uses inheritance — subclasses override a single method to create a single product. Abstract Factory uses composition — the client holds a factory reference that creates entire families of related products. Factory Method is product-oriented; Abstract Factory is family-oriented. They often work together: Abstract Factories are typically implemented with Factory Methods.

**Q: "When would you use a factory instead of a constructor?"**
A: When the creation logic is non-trivial (conditional selection, caching, pooling, dependency injection), when the caller shouldn't know the concrete class, or when the class hierarchy might grow. Constructors are fine for simple cases with no abstraction layer needed.

**Q: "How does Factory Method support the Open/Closed Principle?"**
A: The client depends on an abstract creator/product. Adding a new product means creating a new concrete creator subclass (or registering a new entry in a registry) — the client code does not change. The system is open for extension (new products) but closed for modification (existing client code stays untouched).

**Q: "What are the trade-offs?"**
A: Factory Method adds indirection and class count. It's worth it when the product set is volatile or when decoupling is critical. It's overkill when you only ever create one or two types and don't expect growth. The registry variation (used here) mitigates the class-hierarchy overhead but sacrifices compile-time type safety for the registry entries.

**Q: "Can you implement Factory Method without subclassing?"**
A: Yes. This codebase demonstrates the **registry-based** variation where a `Map<string, Component>` replaces subclassing. JavaScript/TypeScript makes this idiomatic. Many languages support function pointers or lambdas that can serve the same role. The pattern intent (decouple client from concrete product) is preserved even without class hierarchies.

**Q: "Is 'Simple Factory' a real pattern?"**
A: No — it's a commonly used idiom but was never part of the GoF catalog. The GoF specifically rejected it because it violates Open/Closed (you must edit the factory's switch statement to add a product). Factory Method fixes this by using polymorphism/subclassing instead of conditionals.

### Key Talking Points

- Factory Method is the **most commonly used** GoF pattern in frameworks
- It is the foundation of **dependency injection** and **inversion of control**
- React's entire component model is built on factory-like patterns (JSX → `createElement`)
- The **registry variation** (this codebase) is often more practical than class hierarchies in dynamic languages

---

## See Also

- `StrategyForm.tsx` — consumer that will benefit most from this refactor
- Each panel component in `src/components/strategies/`
- `docs/patterns/` — other design pattern guides in this codebase
- GoF Chapter 3, "Factory Method" (pages 107–116) — the canonical reference
- *Refactoring to Patterns* by Joshua Kerievsky — discusses replacing conditionals with Factory Method (the exact refactoring this codebase performs)
