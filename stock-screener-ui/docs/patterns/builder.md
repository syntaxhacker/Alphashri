# Builder Pattern — ChartOptionBuilder

## History & Origin

The Builder pattern was first formally described in the **Gang of Four (GoF) book** — *Design Patterns: Elements of Reusable Object-Oriented Software* (1994) by Erich Gamma, Richard Helm, Ralph Johnson, and John Vlissides. It belongs to the **creational** category of patterns.

The pattern addresses the **"telescoping constructor" anti-pattern** — classes with many constructor parameters, many of which are optional. In languages without named/default arguments (Java, C++), adding a new optional parameter forces yet another constructor overload. The result is a stack of constructors that "telescope" outward:

```java
Pizza(int size) { ... }
Pizza(int size, boolean cheese) { ... }
Pizza(int size, boolean cheese, boolean pepperoni) { ... }
Pizza(int size, boolean cheese, boolean pepperoni, boolean bacon) { ... }
```

Builder solves this by replacing the multi-parameter constructor with a step-by-step fluent API.

Builder is commonly used in:
- **GUI builders** — constructing complex widget trees
- **Document converters** — converting a document into different formats (HTML, PDF, Markdown) using the same construction steps
- **Chart configuration** — our use case, where ECharts options have deeply nested structures

## Problem Statement

Creating a complex object with many optional parts leads to:

1. **Telescoping constructors** — a combinatorial explosion of constructor overloads as optional parameters are added.
2. **Hard-to-read code** — calls like `new Pizza(12, true, false, true, false)` are opaque — what does each boolean mean?
3. **Ordering dependencies** — some parts need to be constructed in a specific order (e.g., axes before series), but a constructor doesn't express ordering.
4. **Different representations** — the same construction process should create different representations (e.g., a candle chart vs. a line chart from the same data). A constructor locks you into one representation.

In our codebase, ECharts options are deeply nested objects (`xAxis`, `yAxis`, `series`, `tooltip`, `legend`, `grid`). Manually composing these objects in every consumer leads to duplication, misalignment, and hard-to-maintain code.

## Real-World Usage

The Builder pattern appears across languages and frameworks:

| Language / Framework | Example |
|----------------------|---------|
| **Java** | `StringBuilder`, `StringBuffer`, `Stream.Builder`, Lombok's `@Builder` annotation |
| **JavaScript** | `new URL(url).searchParams` chaining, jQuery chaining (`$("div").addClass("foo").css("color", "red")`) |
| **Kotlin** | `buildString {}`, `buildList {}`, `buildMap {}` — type-safe builders via lambdas |
| **Python** | `attrs` / `dataclasses` with builders, `requests.Session()` chaining |
| **SQL** | Knex.js, QueryBuilder (Laravel), jOOQ — step-by-step query construction |
| **React** | React Hook Form's fluent API, builder patterns for test data |
| **Testing** | factory_bot (Rails), test data builders in Java (TestDataBuilder pattern) |
| **HTML/XML** | DOM builders, JSX itself (`React.createElement` chaining) |
| **ECharts** | Our `ChartOptionBuilder` — constructing chart options via `.withCandles().withPivotLevels().build()` |

### Java's StringBuilder

The most famous example. Instead of:

```java
String result = "Hello" + ", " + name + "! You have " + count + " messages.";
```

Which creates multiple intermediate String objects, you use:

```java
String result = new StringBuilder()
    .append("Hello")
    .append(", ")
    .append(name)
    .append("! You have ")
    .append(count)
    .append(" messages.")
    .toString();
```

Each `.append()` returns `this`, enabling chaining. The final `.toString()` produces the product.

### Lombok's @Builder

Lombok generates a builder class from annotations:

```java
@Builder
class Pizza {
    private int size;
    private boolean cheese;
    private boolean pepperoni;
}

// Usage:
Pizza pizza = Pizza.builder()
    .size(12)
    .cheese(true)
    .pepperoni(true)
    .build();
```

### SQL Query Builders (Knex.js)

```js
knex('users')
  .where('age', '>', 18)
  .orderBy('name')
  .limit(10)
  .then(rows => ...);
```

Each method modifies internal state and returns the builder, enabling fluent query construction.

## When to Use / When to Avoid

### Use Builder when:

- An object requires **many steps** to construct (not just many parameters)
- The same construction process should produce **different representations**
- You need to **validate** the object only after all parts are assembled (in `build()`)
- The object has **optional** parts with sensible defaults
- You want to **enforce ordering** constraints during construction
- Immutability is desired — the builder constructs the object and the resulting product is immutable

### Avoid Builder when:

- The object has **few** (1–3) parameters — a simple constructor or factory function suffices
- The object has **no optional** parts — a constructor is clearer
- The construction logic is **trivial** — Builder adds accidental complexity
- The number of variants is **small and fixed** — a Factory or Factory Method is simpler
- Performance is critical — Builder has overhead from intermediate state + method dispatch

### Rule of thumb

> Ask: "Does this object benefit from step-by-step assembly?" If yes, Builder. If you're just avoiding 5 constructor params, consider named arguments (if your language supports them) or a simple config object before reaching for Builder.

## Intent

> **GoF**: Separate the construction of a complex object from its representation so that the same construction process can create different representations.

*ECharts options are deeply nested objects (xAxis, yAxis, series, tooltip, legend, grid). The builder encapsulates each piece of that structure behind a fluent method, so callers declare **what** they want without manually composing the option shape.*

## Structure

### Classic GoF Builder Pattern

```
┌────────────┐     ┌──────────────────────┐
│  Director   │────>│   Builder (interface) │
│             │     │──────────────────────│
│ construct() │     │ + buildPartA()       │
└─────────────┘     │ + buildPartB()       │
                    │ + getResult()        │
                    └──────────┬───────────┘
                               │ implements
                    ┌──────────┴───────────┐
                    │ ConcreteBuilder      │
                    │──────────────────────│
                    │ - product             │
                    │ + buildPartA()        │
                    │ + buildPartB()        │
                    │ + getResult()         │
                    └──────────────────────┘
                              │ creates
                              ▼
                    ┌──────────────────┐
                    │     Product      │
                    └──────────────────┘
```

The Director orchestrates the construction sequence. The Builder interface defines steps. ConcreteBuilder implements steps and returns the Product. The client chooses which ConcreteBuilder to use and optionally plugs it into the Director.

### Our Mapping

| GoF Role | Our Code |
|----------|----------|
| **Director** | The client code (calls `.withCandles()`, `.withPivotLevels()`, etc. in sequence) |
| **Builder interface** | The public API of `ChartOptionBuilder` (the `with*` methods) |
| **ConcreteBuilder** | `ChartOptionBuilder` class itself |
| **Product** | The ECharts option object (plain `Record<string, any>`) |

In our implementation, the Director is the client — there is no separate Director class. The client drives construction by chaining `with*` calls, then calling `.build()`. This is a common simplification when the construction sequence is simple or varies per call.

```
┌─────────────────────────────────────┐
│          Client Code                │  (Director)
│  new ChartOptionBuilder()           │
│    .withCandles(data)               │
│    .withPivotLevels(pivots)         │
│    .withLegend(true)                │
│    .build()                         │
└──────────┬──────────────────────────┘
           │ fluent calls
           ▼
┌─────────────────────────────────────┐
│         ChartOptionBuilder          │  (ConcreteBuilder)
├─────────────────────────────────────┤
│ - candles: Candle[]                 │
│ - pivotLevels: PivotLevel[]         │
│ - week52Levels: Week52Level[]       │
│ - emaFast / emaSlow: EmaSeriesDef   │
│ - entries / exits: TradeMarker[]    │
│ - tooltipTrigger: string            │
│ - legendEnabled: boolean            │
│ - titleText: string                 │
├─────────────────────────────────────┤
│ + withCandles(): this               │
│ + withPivotLevels(): this           │
│ + withWeek52Line(): this            │
│ + withEmaSeries(): this             │
│ + withTradeMarkers(): this          │
│ + withTooltip(): this               │
│ + withLegend(): this                │
│ + withTitle(): this                 │
│ + build(): Record<string, any>      │
│ + reset(): this                     │
├─────────────────────────────────────┤
│ # buildCandleSeries()   ──┐         │
│ # buildVolumeSeries()    ─┤         │
│ # buildPivotSeries()     ─┤series  │
│ # buildWeek52Series()    ─┤        │
│ # buildEmaSeries()       ─┘        │
│ # buildTradeMarkerSeries()          │
│ # exitColor(), collectLegendNames() │
└─────────────────────────────────────┘
           │ .build()
           ▼
┌─────────────────────────────────────┐
│     ECharts Option (product)        │
│  { xAxis, yAxis, series, tooltip,   │
│    legend, grid, title }            │
└─────────────────────────────────────┘
```

## Builder vs Factory

This is one of the most common design pattern interview questions. Both are creational patterns — they create objects — but they solve different problems.

| Dimension | Builder | Factory (Method / Abstract Factory) |
|-----------|---------|-------------------------------------|
| **Granularity** | Step-by-step construction across multiple methods | Single method call creates the entire object |
| **Focus** | Focuses on **how** to assemble parts | Focuses on **what** type to create |
| **Complexity** | Best for complex objects with many parts | Best for simple or medium complexity |
| **Different representations** | Same steps → different representations via different ConcreteBuilders | Different types → different objects via different Factory methods |
| **Ordering** | Can enforce construction order | Single step, no ordering |
| **Validation** | Can validate after all steps complete | Validation inside the factory |
| **Reuse** | Builder can be reset and reused | Factory creates fresh each time |
| **Product** | Often the product is assembled incrementally | Product is created in one shot |

### When to choose one over the other

- **Builder**: Object needs multiple steps; steps have dependencies on each other; same process should produce different representations.
- **Factory**: You want to abstract which concrete class is instantiated; construction is simple; you want to centralise creation logic.

### They can work together

Builders often use a Factory internally for creating sub-components. For example, our `ChartOptionBuilder` could use a Factory to create different series types (candle series, bar series, line series) while the Builder handles the overall assembly.

## Fluent Interface

The **fluent interface** (or fluent API) is a style that pairs naturally with the Builder pattern. It was popularized by **Martin Fowler** in 2005, building on earlier work by Eric Evans (Domain-Driven Design). The defining characteristic is **method chaining** — each method returns `this` (the current instance), allowing calls to be chained:

```ts
new ChartOptionBuilder()
  .withCandles(data)       // returns this
  .withPivotLevels(pivots) // returns this
  .build()                 // returns the product (not this)
```

The terminal method (`.build()`, `.toString()`, `.get()`) breaks the chain and returns the final product.

### Not all fluent interfaces are Builders

A fluent interface is a *style*; a Builder is a *pattern*. jQuery's `$("div").addClass("foo").css("color", "red")` is fluent but not a Builder — it's not constructing a complex object step-by-step. Conversely, not all Builders are fluent — you could call `builder.setX(x); builder.setY(y); builder.build()` without chaining.

### Method chaining mechanics

```ts
class ChartOptionBuilder {
  private candles: Candle[] = [];

  withCandles(candles: Candle[]): this {
    this.candles = candles;
    return this;  // ← the key to chaining
  }
}
```

Returning `this` is what enables the `.withX().withY().build()` syntax. The return type `this` (rather than the class name) preserves the concrete type for subclasses.

## Implementation

The existing `chartLineBuilders.ts` already uses a builder-like approach informally — standalone functions (`buildPivotSeries`, `buildWeek52Series`, `buildEmaSeries`) return partial series arrays, and callers manually merge them with axis configs, tooltip, and grid. `ChartOptionBuilder` formalizes this into a cohesive class.

### Key design decisions

| Concern | Existing approach | Builder |
|---------|------------------|---------|
| Series construction | Isolated functions returning raw arrays | Private methods called by `build()` |
| Axis/Grid/Tooltip | Duplicated in every consumer | Centralised in `build()` |
| Data alignment | Caller must align candle indices manually | Builder owns the candle array and aligns internally |
| State reuse | Impossible (manual rebuild) | `reset()` clears state for reuse |
| Discoverability | Import each function by name | Single class with IDE autocomplete |

## Code walkthrough

### 1. Construction phase

Each `with*` method stores its data and returns `this`:

```ts
.withCandles(candles)           // stores candle array (source of truth for time axis)
.withPivotLevels(pivots)        // stores pivot data for R1/PP/S1 lines
.withEmaSeries(fast, slow)      // stores two EMA definitions (label, color, data[])
.withTradeMarkers(entries, exits) // stores entry/exit points
.withLegend(true)                // enables legend
.withTitle("NIFTY 50")           // sets chart title
```

### 2. Build phase

`build()` orchestrates all private build helpers:

1. Extracts `timeData` from the stored candle array (single source of truth for the x-axis).
2. Calls each build helper in order — candle series, volume bars, pivots, 52W line, EMAs, trade markers.
3. Assembles the full ECharts option: `xAxis`, `yAxis`, `series`, `tooltip`, `legend`, `grid`, `title`.

### 3. Private helpers

Each mirrors the logic from `chartLineBuilders.ts` but references the builder's own state:

- **`buildCandleSeries()`** — produces the candlestick series with OHLC data and item styles from config colors (`BULLISH`/`BEARISH`).
- **`buildVolumeSeries()`** — produces a bar series colour-coded green/red based on close ≥ open.
- **`buildPivotSeries()`** — builds a date→value map from pivot data and maps it onto candle indices, creating R1/PP/S1 line series.
- **`buildWeek52Series()`** — finds matching 52W high values by date and draws a dashed line.
- **`buildEmaSeries()`** — creates line series for fast and slow EMAs.
- **`buildTradeMarkerSeries()`** — uses ECharts `markPoint` to position entry/exit markers at specific candle indices, colour-coded by exit reason.

## How to use

```ts
import { ChartOptionBuilder } from "../patterns/builder/ChartOptionBuilder";

const option = new ChartOptionBuilder()
  .withCandles(candles)
  .withPivotLevels(pivotLevels)
  .withWeek52Line(week52Levels)
  .withEmaSeries(
    { label: "EMA 9", color: "#42A5F5", data: ema9Data },
    { label: "EMA 21", color: "#1E88E5", data: ema21Data },
  )
  .withTradeMarkers(
    entries.map((e) => ({ date: e.time, price: e.price })),
    exits.map((x) => ({ date: x.time, price: x.price, reason: x.reason })),
  )
  .withTooltip("axis")
  .withLegend(true)
  .withTitle("AAPL — Daily")
  .build();

// Pass directly to ECharts
chart.setOption(option);
```

To reuse the builder for a different symbol:

```ts
builder.reset()
  .withCandles(nextCandles)
  .withPivotLevels(nextPivots)
  .build();
```

> **Note**: The existing `chartLineBuilders.ts` already uses a builder-like approach informally — functions like `buildPivotSeries`, `buildWeek52Series`, and `buildEmaSeries` return partial series arrays that consumers merge manually. `ChartOptionBuilder` formalizes this pattern into a single cohesive class with a fluent API and centralised axis/tooltip/grid configuration.

## Relations to Other Patterns

### Abstract Factory

Both are creational patterns, but:
- **Abstract Factory** focuses on creating *families of related objects* without specifying their concrete classes. The client asks "give me a widget for this OS" and gets one back.
- **Builder** focuses on *step-by-step construction* of a single complex object. The client says "add candles, add pivots, add EMAs, build."

Abstract Factory is often a single method call (`factory.createButton()`). Builder is multiple method calls (`builder.withX().withY().build()`).

They can complement each other: a Builder might use an Abstract Factory to create families of sub-components.

### Composite

Builder can construct Composite structures. A Composite represents part-whole hierarchies (tree structures). A Builder can encapsulate the logic of assembling those hierarchies, ensuring the tree is constructed correctly.

For example, building an ECharts option involves composing a tree of nested configuration objects. The Builder ensures each node is properly structured before adding children.

### Template Method

Template Method defines the skeleton of an algorithm, letting subclasses override specific steps. Builder's `build()` method is like a Template Method — it defines the construction algorithm (build candles → build volume → build pivots → ...) while delegating each step to a separate method that subclasses could override.

### Prototype

Prototype creates objects by copying an existing instance. A Builder can use Prototype internally — instead of constructing a sub-object from scratch, it could clone a prototype and modify it. Our `reset()` method is a crude form of this: it returns the builder to a clean state, ready to produce a new product from fresh configuration.

## Interview Tips

### Common Questions

**1. Builder vs Factory — when to use which?**

Builder is for *step-by-step* construction of a complex object. Factory is for *single-step* creation, often when you want to abstract which concrete class is instantiated. If your object requires 5+ optional parameters or has ordering constraints, use Builder. If you just want to swap implementations (e.g., `PizzaStore.createPizza("cheese")`), use Factory.

**2. When would you use a Builder over a constructor?**

When the number of parameters makes constructors unreadable (telescoping constructor anti-pattern), when many parameters are optional, when parameters have dependencies on each other, or when the same construction process should produce different representations.

**3. What is a telescoping constructor anti-pattern?**

A class with multiple constructor overloads for different combinations of optional parameters:

```java
Pizza(int size) { ... }
Pizza(int size, boolean cheese) { ... }
Pizza(int size, boolean cheese, boolean pepperoni) { ... }
```

This is brittle — adding a new optional parameter requires a new overload, and code like `new Pizza(12, true, false, true)` is hard to read (what do those booleans mean?).

**4. How does a Builder preserve immutability?**

The Builder accumulates state during the construction phase. Only `build()` creates the final product, which can be made immutable (readonly fields, no setters). The builder itself is mutable, but the product is not. The product is never exposed until `build()` returns it.

**5. Can a Builder validate during construction? Should it?**

There are two schools of thought:
- **Eager validation** — validate in each `with*` method (e.g., throw if candles are empty). Catches errors early but makes the builder less flexible.
- **Delayed validation** — validate only in `build()`. Allows partial state to be set without errors, then validates everything at once. More flexible but errors surface later.

In practice, validate **preconditions** (e.g., non-null args) in `with*` methods, and validate **postconditions** (e.g., "must have candles before building") in `build()`.

**6. What's the difference between a Builder and a Fluent Interface?**

All Builders can be fluent, but not all fluent interfaces are Builders. A fluent interface is a style (method chaining via `return this`). A Builder is a pattern with a specific intent: separate construction of a complex object from its representation. jQuery, for example, is fluent but not a Builder.

### Pro tips

- Name methods `with*`, `set*`, or verb phrases (`addCandle`, `configureTooltip`). Stick to the same convention within a project.
- The `build()` method should do the *minimal work* — ideally just assemble and validate. Heavy computation belongs in private helpers called by `build()`.
- Consider a **static factory method** (`ChartOptionBuilder.create()`) to avoid exposing `new` in the API.
- If your Builder has many similar `with*` methods, consider a **DSL approach** — nested builders for sub-objects (e.g., `.configureTooltip(t => t.trigger("axis").format("{b}: {c}"))`).
- In TypeScript, return type `this` (not the class name) so that subclass builders return the correct type from chained methods.
- The **lombok `@Builder`** annotation is a popular Java shortcut — understand how it works conceptually even if you don't use Java.
