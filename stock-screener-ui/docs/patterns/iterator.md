# Iterator Pattern

## 1. History & Origin

The Iterator pattern was first catalogued by the **Gang of Four** (Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides) in **1994** in *Design Patterns: Elements of Reusable Object-Oriented Software*. It is one of the oldest and most fundamental behavioral patterns.

The concept of iteration predates OOP by decades — C's pointer arithmetic on arrays, Pascal's `for` loops, and assembly-level indexed addressing are all primitive forms of iteration. What the GoF formalised was the *separation of traversal logic from collection structure*.

Timeline:

| Year | Milestone |
|------|-----------|
| 1994 | GoF catalogs Iterator as a design pattern |
| 1995 | Java 1.0 ships with `Enumeration` (later replaced by `java.util.Iterator` in 1998) |
| 2000 | C# introduces `IEnumerator` / `IEnumerable` |
| 2005 | Python adds `__iter__` / `__next__` protocol (PEP 234) |
| 2011 | C++11 adds range-`for` loops with `begin()`/`end()` |
| 2015 | **ES6** introduces `Symbol.iterator` and `for...of` — JavaScript objects become iterable |
| 2018 | **ES2018** adds `Symbol.asyncIterator` and `for await...of` for async iteration |
| 2026 | Iterators are built into every major language; the protocol is universal |

The pattern's longevity is remarkable: the same interface that iterates an in-memory array in 1994 also drives a paginated REST API in 2026.

## 2. Problem Statement

**How do you access the elements of an aggregate object sequentially without exposing its internal structure?**

Consider these scenarios:

- A `List` stores items in a contiguous array; traversal means incrementing an index.
- A `Tree` stores items in nodes; traversal requires a stack or recursion (in-order, pre-order, post-order).
- A `HashMap` stores items in buckets; traversal may visit buckets in arbitrary order.
- A **paginated REST API** stores data across N HTTP endpoints; traversal must fetch each page, handle cursors, and join results.

Without the Iterator pattern, the client must know *how* each data structure works internally. The code becomes tightly coupled to the structure's implementation:

```ts
// Bad: client knows about array internals
for (let i = 0; i < trades.length; i++) {
  process(trades[i]);
}

// Bad: client knows about pagination internals
let page = 1;
let hasMore = true;
while (hasMore) {
  const res = await fetch(`/api/trades?page=${page++}`);
  const data = await res.json();
  for (const t of data.items) process(t);
  hasMore = data.page < data.totalPages;
}
```

The Iterator pattern solves this by introducing a **common interface** that hides traversal logic. The client calls `next()` — it doesn't care whether data comes from an array, a tree, or a paginated API.

## 3. Real-World Usage

The Iterator pattern is everywhere in modern programming, often masquerading as language syntax:

### Language-level iteration protocols

- **JavaScript**: `for...of` uses `Symbol.iterator`. The spread operator `[...iterable]`, `Array.from(iterable)`, and destructuring `[a, b] = iterable` all consume the iteration protocol.
- **Python**: `for x in list:` calls `__iter__()` and `__next__()`.
- **Java**: `for (T item : collection)` compiles to `Iterator<T>` under the hood.
- **C#**: `foreach` works with any `IEnumerable` implementation.
- **C++**: Range-`for` calls `begin()` / `end()`.

### Database iteration

- **SQL cursors** iterate over query result sets row by row, just like an external iterator.
- **MongoDB cursors** return results in batches — the driver's `cursor.next()` fetches the next batch automatically (identical in spirit to our `PaginatedIterator`).
- **PostgreSQL `DECLARE CURSOR`** + `FETCH` is a server-side iterator over a query result.

### Lazy sequences

- **Clojure** sequences (`map`, `filter`, `take`) are lazy and implement `ISeq`.
- **F#** sequences (`seq { ... }`) are lazily evaluated iterators.
- **Scala** `Stream` / `LazyList` are immutable, lazy linked lists.
- **RxJS Observables** conceptually invert the pull→push model, but `pipe()` operations closely mirror iterator composition.

### Generator functions

- **Python generators** (`yield`) implement the iterator protocol. Every generator is an iterator.
- **JavaScript generators** (`function*`) implement both `Symbol.iterator` and `Symbol.asyncIterator`.
- **C# `yield return`** compiles into a state machine implementing `IEnumerable`.

### In this codebase

| Use case | What the iterator hides |
|----------|------------------------|
| Trade history table | Page numbers, total pages, "hasNext" flag |
| Position export | Looping over N pages, concatenating arrays |
| Screener results viewer | Back/forward navigation, cache for instant page switching |
| Report generation | Bulk collection of all items regardless of page boundaries |

## 4. When to Use / When to Avoid

### Use the Iterator pattern when:

- You have an aggregate object (collection, tree, API result set) and want to provide multiple traversal strategies.
- You want to hide the internal structure of the aggregate from the client.
- You need a uniform iteration interface across different data structures (array, paginated API, tree, cursor).
- You want to support multiple simultaneous traversals of the same aggregate (each iterator has its own state).
- You need lazy evaluation — items fetched on demand rather than all at once.
- You want to decouple client code from the traversal algorithm (e.g., pagination logic).

### Avoid the Iterator pattern when:

- Your collection is always small and always in-memory — a simple `for` loop is clearer.
- You only ever iterate one way and never change the traversal strategy — the pattern adds indirection without benefit.
- You need random access by index — iterators are sequential by nature. Use array indexing instead.
- Performance of the extra object allocation matters (embedded / real-time systems) — each iterator is a new object.
- The aggregate is never traversed at all (write-only collections, command queues).

**In this codebase**, the pattern is most useful when dealing with paginated API endpoints. For in-memory arrays with a single traversal pattern, the built-in `for...of` is sufficient — the `ArrayIterator` class exists mainly for uniformity when you need to swap data sources without changing consumer code.

## 5. Internal vs External Iterators

There are two flavours of iterators, distinguished by who controls the loop:

### External iterators (aka active iterators)

**The client controls the iteration.** The client calls `next()` explicitly, checks `done`, and decides when to stop.

```ts
const result = await iterator.next();
while (!result.done) {
  process(result.value);
  result = await iterator.next();
}
```

This is what our `PaginatedIterator` implements. It gives maximum flexibility: the client can pause, resume, skip items, go backward, jump to a specific page, or interleave multiple iterators.

**Good for:** UI pagination (Previous/Next buttons), multi-step workflows, scenarios where the caller needs fine-grained control.

### Internal iterators (aka passive iterators)

**The iterator controls the loop.** The client provides a callback that is invoked for each element. The language runtime or iterator framework manages the loop.

```ts
// JavaScript's for...of is sugar over an internal iterator
for (const item of array) {
  process(item);
}

// Equivalent to:
const iter = array[Symbol.iterator]();
let result = iter.next();
while (!result.done) {
  process(result.value);
  result = iter.next();
}
```

`for...of` is syntactic sugar that makes the iterator internal. Under the hood, it's still calling `next()` — but the boilerplate is hidden.

**Good for:** Simple sequential processing, functional pipelines (`map`, `filter`, `reduce`), when you don't need manual control.

| Aspect | External Iterator | Internal Iterator |
|--------|------------------|-------------------|
| Who controls the loop | Client | Iterator / framework |
| Flexibility | High (pause, resume, bidirectional, skip) | Low (callback per element) |
| Lines of code | More (explicit `next()` calls) | Less (sugar like `for...of`) |
| Multiple simultaneous traversals | Easy (separate iterator instances) | Harder (need nested callbacks) |
| Lazy evaluation | Natural (fetch on demand) | Possible but less transparent |
| Use case | Paginated APIs, UI navigation | Array processing, functional pipelines |

Our `PaginatedIterator` is external by design — paginated APIs require manual control over page navigation, and the caller often needs to render the current page before deciding to fetch the next one.

### Dual protocol

`PaginatedIterator` implements `Symbol.asyncIterator` (which makes `for await...of` work), bridging the gap: it's an external iterator internally, but can be consumed internally via the `for await` syntax:

```ts
// Internal-style consumption of an external iterator
for await (const items of iterator) {
  renderPage(items);  // called for each page automatically
}
```

## 6. Intent

**Provide a way to access the elements of an aggregate object sequentially without exposing its underlying representation.**

## 7. Structure

### Classic GoF Iterator structure

```
┌──────────────┐      ┌─────────────────┐
│   Aggregate  │      │    Iterator     │
│──────────────│      │─────────────────│
│+ createIterator│───→│+ first()        │
└──────────────┘      │+ next()         │
        ↑             │+ isDone()       │
        │             │+ currentItem()  │
┌──────────────┐      └─────────────────┘
│ConcreteAgg  │              ↑
│─────────────│      ┌─────────────────┐
│+ createIter.│───→  │ConcreteIterator │
└─────────────┘      │─────────────────│
                      │ - index         │
                      │+ first()        │
                      │+ next()         │
                      │+ isDone()       │
                      │+ currentItem()  │
                      └─────────────────┘
```

### How PaginatedIterator maps onto this structure

```
GoF Concept           →  Our Implementation
─────────────────────────────────────────────────────
Aggregate             →  API endpoint (conceptual source of data)
ConcreteAggregate     →  The fetchPage function (knows how to call the API)
Iterator interface    →  PaginatedIterator<T> class (next, prev, current, goToPage)
ConcreteIterator      →  PaginatedIterator instance (manages currentPage, cache, fetchPage callbacks)
Iteration result      →  IteratorResult<T> { value, done, page }
Aggregate creation    →  createTradeIterator factory function
```

Our structure diagram:

```
                     ┌─────────────────────────┐
                     │   PaginatedIterator<T>   │  ← ConcreteIterator
                     │─────────────────────────│
                     │ - currentPage: number    │  ← traversal state
                     │ - pageSize: number       │
                     │ - totalPages: number     │
                     │ - totalItems: number     │
                     │ - cache: Map<number,T[]> │  ← fetched pages
                     ├─────────────────────────┤
                     │ + next()                 │
                     │ + prev()                 │
                     │ + current()              │
                     │ + goToPage(n)            │
                     │ + reset()                │
                     │ + prefetchNext()         │
                     │ + getAll()               │
                     └──────┬──────────────────┘
                            │ calls
                    ┌───────▼──────────────────┐
                    │   fetchPage: FetchPageFn  │  ← ConcreteAggregate
                    │   (page, size) => Page<T> │
                    └───────────────────────────┘

Iteration protocol:
  [Symbol.asyncIterator]  ──>  for await (const page of iterator)

Sibling:
  ┌─────────────────────┐
  │  ArrayIterator<T>   │  ← synchronous concrete iterator for in-memory data
  │  [Symbol.iterator]  │     works with for...of
  └─────────────────────┘
```

## 8. Async Iterator Pattern

ES2018 introduced `Symbol.asyncIterator` and the `for await...of` statement, extending the iteration protocol to handle asynchronous data sources.

### Why async iteration?

Synchronous iterators fetch items immediately. For paginated APIs, each `next()` call is a network request that returns a `Promise`. Without async iteration, you would need to either:

1. Pre-fetch all pages eagerly (wasteful, slow startup)
2. Manually chain promises in a loop (boilerplate)

Async iteration solves this by making `next()` return a `Promise<IteratorResult>` rather than a synchronous `IteratorResult`.

### Comparison

| | `Symbol.iterator` | `Symbol.asyncIterator` |
|---|---|---|
| Return type of `next()` | `IteratorResult<T>` | `Promise<IteratorResult<T>>` |
| Loop syntax | `for...of` | `for await...of` |
| Common use | In-memory collections | Paginated APIs, file streams, event streams |
| Example | `ArrayIterator` | `PaginatedIterator` |

### How `for await...of` works

```ts
// Desugared form of: for await (const items of iterator)
const asyncIter = iterator[Symbol.asyncIterator]();
let result = await asyncIter.next();
while (!result.done) {
  const items = result.value;
  // process items...
  result = await asyncIter.next();
}
```

Each iteration `await`s the promise from `next()`. This means the loop naturally pauses during network I/O without blocking the event loop.

### PaginatedIterator's async iteration implementation

The class implements `Symbol.asyncIterator` by delegating to `next()`:

```ts
[Symbol.asyncIterator](): AsyncIterator<T[]> {
  return {
    next: () => this.next().then(({ value, done }) => ({ value, done })),
  };
}
```

Or equivalently (if `next()` already returns `Promise<IteratorResult<T>>`):

```ts
async *[Symbol.asyncIterator](): AsyncGenerator<T[]> {
  let result = await this.next();
  while (!result.done) {
    yield result.value;
    result = await this.next();
  }
}
```

This is why `for await (const page of iterator)` works seamlessly with our paginated API wrapper.

## 9. Lazy Evaluation

Iterators are fundamentally **lazy** — they compute or fetch values only when requested. This is one of the pattern's most powerful properties.

### Eager vs Lazy

| Aspect | Eager (`getAll()`) | Lazy (`next()`) |
|--------|---------------------|-----------------|
| When data is fetched | Immediately, all at once | On demand, page by page |
| Memory usage | All pages in memory at once | Only current page (plus cache) |
| Time to first item | Wait for all pages | Wait only for first page |
| Network requests | Burst of N parallel/serial requests | One request per `next()` call |
| Cancellation | Not possible once started | Just stop calling `next()` |
| Use case | Export, CSV download | Interactive UI, search results |

### How PaginatedIterator enables lazy evaluation

```ts
// Lazy: fetches page 1 only
const iter = new PaginatedIterator(fetchTrades, { pageSize: 25 });
const page1 = await iter.next();  // 1 network request

// User clicks "Next" → fetches page 2
const page2 = await iter.next();  // 1 more network request

// User clicks "Previous" → reads from cache (zero network requests)
const page1again = await iter.prev();  // instant, from Map cache
```

Compare with eager:

```ts
// Eager: fetches ALL pages upfront
const allTrades = await iter.getAll();  // N network requests, N pages in memory
```

### When lazy evaluation hurts

- **Iteration with side effects**: If each `next()` call triggers a side effect (like incrementing a counter), lazy evaluation can produce surprising results when iteration is paused or aborted early.
- **Multiple passes**: Re-iterating a lazy sequence may re-fetch all data. Our cache mitigates this, but only for pages already fetched.
- **Resource cleanup**: Lazy iterators over file handles or database cursors must ensure proper cleanup if the client doesn't exhaust the iterator.

### Trade-off memo for this codebase

- Use `for await...of` (lazy) for UI pagination — users rarely view all pages.
- Use `getAll()` (eager) for exports and report generation where you need the complete dataset.
- Use `prefetchNext()` to balance: lazy by default, but eagerly prefetch the next page during UI idle moments.

## 10. Implementation in this codebase

The `PaginatedIterator` in `src/patterns/iterator/DataIterator.ts` wraps a `FetchPageFn<T>` — a function that accepts `(page, pageSize)` and returns `Promise<Page<T>>`. The iterator manages:

| Concern          | How the iterator handles it                              |
|------------------|----------------------------------------------------------|
| Page tracking    | Internal `currentPage` counter, advanced on each `next()`|
| Caching          | `Map<number, T[]>` — previously fetched pages are stored |
| Forward nav      | `next()` fetches `currentPage + 1` via the fetch function|
| Backward nav     | `prev()` reads from cache; throws if page not cached     |
| Arbitrary jump   | `goToPage(n)` — fetches if uncached, else from cache     |
| Eager loading    | `prefetchNext()` starts background fetch of next page    |
| Bulk collect     | `getAll()` walks all pages and concatenates              |
| Reset            | `reset()` clears cache + counters                        |

### Page cache

Each fetched page is stored in the `cache` Map keyed by page number. Navigating backward (`prev()`) reads from this cache without making a new network request. If the page was never fetched, `prev()` throws — the caller must navigate forward first.

### Async iteration protocol

The class implements `Symbol.asyncIterator`, enabling the `for await` syntax:

```ts
for await (const items of iterator) {
  renderPage(items);
}
```

Each iteration calls `next()` which fetches the subsequent page. The loop exits when `done` is true (past the last page or when the API reports `hasNext: false`).

## 11. Code Walkthrough — `DataIterator.ts`

### 11.1 Core types

```ts
export interface Page<T> {
  data: T[];
  page: number;
  totalPages: number;
  totalItems: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface IteratorResult<T> {
  value: T[];
  done: boolean;
  page: number;
}

export type FetchPageFn<T> = (
  page: number,
  pageSize: number,
) => Promise<Page<T>>;
```

`Page<T>` mirrors the standard shape returned by paginated REST endpoints. `FetchPageFn<T>` is the abstraction boundary — the iterator does not know about HTTP, URLs, or auth; it only knows about `(page, size) => Promise<Page<T>>`.

### 11.2 Constructor + state

```ts
export class PaginatedIterator<T> {
  private currentPage: number;
  private totalPages: number;
  private totalItems: number;
  private cache: Map<number, T[]>;

  constructor(
    private fetchPage: FetchPageFn<T>,
    options?: { pageSize?: number; startPage?: number },
  ) {
    this.currentPage = options?.startPage ?? 1;
    this.pageSize = options?.pageSize ?? 50;
    this.cache = new Map();
  }
}
```

All mutable state is private. The constructor accepts the fetch function and optional configuration, defaulting to page 1 with 50 items per page.

### 11.3 `next()` — fetch the next page

```ts
async next(): Promise<IteratorResult<T>> {
  const targetPage = this.currentPage + 1;
  if (this.totalPages > 0 && targetPage > this.totalPages) {
    return { value: [], done: true, page: this.currentPage };
  }
  return this.fetchPageData(targetPage);
}
```

Guard checks prevent fetching beyond the known last page. The actual fetch logic lives in the shared `fetchPageData` private method.

### 11.4 `prev()` — go backward (from cache)

```ts
async prev(): Promise<IteratorResult<T>> {
  const targetPage = this.currentPage - 1;
  if (targetPage < 1) {
    return { value: [], done: true, page: this.currentPage };
  }
  const cached = this.cache.get(targetPage);
  if (!cached) {
    throw new Error(`Page ${targetPage} is not cached.`);
  }
  this.currentPage = targetPage;
  return { value: cached, done: false, page: this.currentPage };
}
```

Backward navigation relies entirely on the cache. This is intentional — you cannot "un-fetch" data, and requiring forward traversal first ensures the cache is populated.

### 11.5 `fetchPageData` — the shared fetch + cache logic

```ts
private async fetchPageData(page: number): Promise<IteratorResult<T>> {
  const cached = this.cache.get(page);
  if (cached) {
    this.currentPage = page;
    return { value: cached, done: false, page };
  }

  const response = await this.fetchPage(page, this.pageSize);
  this.currentPage = response.page;
  this.totalPages = response.totalPages;
  this.totalItems = response.totalItems;
  this.cache.set(response.page, response.data);

  return {
    value: response.data,
    done: !response.hasNext,
    page: response.page,
  };
}
```

Every public navigation method routes through `fetchPageData`. It checks the cache first, then calls the fetch function, updates metadata, stores in cache, and returns the standard `IteratorResult`.

### 11.6 Eager prefetch

```ts
async prefetchNext(): Promise<void> {
  const targetPage = this.currentPage + 1;
  if (this.cache.has(targetPage)) return;
  if (this.totalPages > 0 && targetPage > this.totalPages) return;

  this.prefetchPromise = this.fetchPageData(targetPage).then(() => {});
  await this.prefetchPromise;
}
```

Call `prefetchNext()` after rendering the current page to start fetching the next page in the background. The result lands in cache, so a subsequent `next()` returns instantly.

### 11.7 `getAll()` — collect all pages

```ts
async getAll(): Promise<T[]> {
  const allData: T[] = [];
  for (let p = 1; p <= this.totalPages; p++) {
    const cached = this.cache.get(p);
    if (cached) {
      allData.push(...cached);
    } else {
      const result = await this.fetchPageData(p);
      allData.push(...result.value);
    }
  }
  return allData;
}
```

Walks every page sequentially, respecting the cache to avoid redundant fetches. Useful for export or bulk operations where pagination is irrelevant.

### 11.8 Factory function

```ts
export function createTradeIterator<T>(
  fetchFn: FetchPageFn<T>,
  options?: PaginatedIteratorOptions,
): PaginatedIterator<T> {
  return new PaginatedIterator<T>(fetchFn, options);
}
```

A named factory that documents the intended use case (trade data) while keeping the constructor generic. As the codebase grows, additional factories like `createPositionIterator`, `createHistoryIterator` can follow the same pattern.

### 11.9 Synchronous `ArrayIterator`

```ts
export class ArrayIterator<T> {
  private index = 0;
  constructor(private items: T[]) {}

  next(): { value: T; done: boolean } {
    if (this.index >= this.items.length) {
      return { value: undefined as unknown as T, done: true };
    }
    return { value: this.items[this.index++], done: false };
  }

  [Symbol.iterator](): this {
    this.index = 0;
    return this;
  }
}
```

A minimal synchronous iterator for in-memory data. Implements `Symbol.iterator` for `for...of` support. Useful when you need a uniform iteration interface over both paginated API data and local arrays.

## 12. How to Use

### Basic iteration

```ts
import { PaginatedIterator } from "../patterns/iterator/DataIterator";

const fetchTrades = (page: number, size: number) =>
  fetch(`/api/trades?page=${page}&pageSize=${size}`).then((r) => r.json());

const iterator = new PaginatedIterator(fetchTrades, { pageSize: 25 });

for await (const trades of iterator) {
  trades.forEach((t) => renderTradeRow(t));
}
```

### Forward + backward navigation (UI with Previous/Next buttons)

```ts
// Next button handler
async function onNext() {
  const result = await iterator.next();
  if (!result.done) {
    renderTable(result.value);
    updateProgress(iterator.getProgress());
    // Start fetching the next page eagerly
    iterator.prefetchNext();
  }
}

// Previous button handler
async function onPrev() {
  try {
    const result = await iterator.prev();
    renderTable(result.value);
    updateProgress(iterator.getProgress());
  } catch {
    showToast("No previous page cached");
  }
}
```

### Jump to a specific page (e.g., from a page-number input)

```ts
await iterator.goToPage(5);
const current = await iterator.current();
renderTable(current.value);
```

### Collect everything (export / bulk operation)

```ts
const allTrades = await iterator.getAll();
downloadCSV(allTrades);
```

### Reset and start over

```ts
iterator.reset();
const firstPage = await iterator.next();
```

### Use with factory

```ts
import { createTradeIterator } from "../patterns/iterator/DataIterator";

const tradeIter = createTradeIterator(myFetchFn, { pageSize: 100 });
```

### Synchronous iteration over an array

```ts
import { ArrayIterator } from "../patterns/iterator/DataIterator";

const items = new ArrayIterator(["RELIANCE", "TCS", "HDFCBANK"]);
for (const symbol of items) {
  console.log(symbol);
}
```

## 13. Relations to Other Patterns

- **Composite**: Iterators are often used to traverse composite structures (trees). In-order, pre-order, and post-order iterators can hide the recursive structure of a composite while presenting a flat sequential interface.

- **Factory Method**: The `createTradeIterator` factory function is an application of Factory Method — it encapsulates object creation behind a named function, allowing the codebase to change the concrete iterator class without affecting callers.

- **Memento**: The iterator's internal state (currentPage, cache, totalPages) can be captured as a memento to support save/restore of traversal position. This is useful when a user navigates away from a paginated view and returns — the iterator can be rehydrated from persisted state.

- **Visitor**: The Iterator and Visitor patterns are complementary. Iterator provides the traversal mechanism (how to walk the structure), while Visitor provides the operation (what to do at each element). You can pass a Visitor into an Iterator to apply operations without coupling the operation to the element types.

- **Generator functions** (Python/JS): Generators implement the Iterator protocol natively. In Python, `def gen(): yield x` produces an iterator. In JavaScript, `function* gen() { yield x; }` returns a generator that satisfies both `Symbol.iterator` and `Symbol.asyncIterator`. The `PaginatedIterator` could theoretically be replaced by an async generator:

  ```ts
  async function* paginatedGenerator<T>(fetchPage: FetchPageFn<T>) {
    let currentPage = 1;
    let hasNext = true;
    while (hasNext) {
      const page = await fetchPage(currentPage++, 50);
      yield page.data;
      hasNext = page.hasNext;
    }
  }
  ```

  The class-based approach is preferred in this codebase because it supports bidirectional navigation (`prev()`), random access (`goToPage(n)`), caching, and prefetching — capabilities that a plain generator cannot provide without additional machinery.

## 14. Interview Tips

The Iterator pattern is a favourite in system design and coding interviews. Here are common questions and how to think about them:

### Q: What is the difference between an Iterable and an Iterator?

**Iterable** is an object that has a method (e.g., `Symbol.iterator`) that returns an **Iterator**. The Iterator is the object with the `next()` method. A collection is iterable; the iterator is the cursor that traverses it.

```ts
// Iterable
const array = [1, 2, 3];
const iter = array[Symbol.iterator](); // Iterator
iter.next(); // { value: 1, done: false }
```

### Q: External vs Internal iterators — which is better?

Neither is universally better. External iterators give the client more control (useful for paginated APIs, bidirectional navigation). Internal iterators are more concise and compose better with functional pipelines (`map`, `filter`, `reduce`). Our codebase uses external iteration for the `PaginatedIterator` (client must decide when to fetch the next page) and internal iteration via `for...of` for simple cases.

### Q: How would you implement a tree iterator (in-order, pre-order, post-order)?

The key insight is that each traversal order is a different ConcreteIterator. The tree is the Aggregate. Each iterator maintains its own stack to simulate the recursive traversal without mutation:

```ts
class InOrderIterator<T> {
  private stack: TreeNode<T>[] = [];
  constructor(private root: TreeNode<T> | null) {
    this.pushLeft(root);
  }
  private pushLeft(node: TreeNode<T> | null) {
    while (node) { this.stack.push(node); node = node.left; }
  }
  next() {
    if (this.stack.length === 0) return { value: undefined, done: true };
    const node = this.stack.pop()!;
    this.pushLeft(node.right);
    return { value: node.value, done: false };
  }
}
```

### Q: What makes a collection iterable in JavaScript?

Implementing `[Symbol.iterator](): Iterator<T>` on the object. The method must return an object with a `next(): IteratorResult<T>` method. Arrays, Strings, Maps, Sets, and NodeLists are built-in iterables.

### Q: How do async iterators differ from sync iterators?

`next()` returns `Promise<IteratorResult>` instead of `IteratorResult`. Use `for await...of` instead of `for...of`. Async iterators are essential for paginated APIs, streams, and any data source where each element requires I/O.

### Q: What is the performance trade-off of lazy iteration?

Lazy iteration saves memory (only current page in RAM) and reduces time-to-first-item (no need to fetch everything upfront). The cost is per-iteration overhead (function calls, promise allocations) and potentially more network round-trips (N serial requests instead of 1 batch). Our `getAll()` method is the eager counterpart — use it when you need everything and network latency is more tolerable than per-item overhead.

### Q: How would you build a custom iterator for a paginated API?

This is exactly what `PaginatedIterator` does. The key design decisions:
1. Accept a `FetchPageFn<T>` to decouple from HTTP details.
2. Cache fetched pages by page number for bidirectional navigation.
3. Implement `Symbol.asyncIterator` so consumers can use `for await...of`.
4. Provide `prefetchNext()` for latency hiding.
5. Provide `getAll()` for eager bulk collection.
6. Guard against fetching beyond the known last page.

### Q: How does using an iterator compare with a Cursor pattern?

They are closely related — a database cursor is essentially an iterator over a query result. The main difference is scope: "Iterator" is a general OOP pattern, while "Cursor" typically refers to database-specific iteration with server-side state and lifecycle management (open, fetch, close). Our `PaginatedIterator` is closer to a client-side cursor — it holds no server-side resources beyond the pagination state.
