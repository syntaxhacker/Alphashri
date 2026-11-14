# SolidJS migration conventions

The UI **is** SolidJS 1.9 (`solid-js`), with `@solidjs/router`, `solid-js/store`,
`@tanstack/solid-table` and `@solidjs/testing-library`. The React → Solid
migration is complete (see §7); React is no longer a dependency.

This file is the **contract**. Follow it exactly — the whole point of Solid is
fine-grained reactivity, and a React habit smuggled across destroys it.

---

## 1. The five rules that matter

### 1.1 Never destructure props

Solid props are **getters**. Destructuring them reads the value **once** and
loses reactivity forever.

```tsx
// WRONG — reads props.value once, never updates
export function Price(props: { value: number }) {
  const { value } = props;
  return <span>{value}</span>;
}

// RIGHT
export function Price(props: { value: number }) {
  return <span>{props.value}</span>;
}

// RIGHT — when you genuinely need a local binding, use splitProps
export function Price(props: { value: number; label: string }) {
  const [local, rest] = splitProps(props, ["value"]);
  return <span title={rest.label}>{local.value}</span>;
}
```

`splitProps` keeps reactivity **only** for the fields it names. Everything else
must stay on `props.x`.

### 1.2 Signals are called, not read

```tsx
const [count, setCount] = createSignal(0);
count();            // read
setCount((n) => n + 1);  // write
```

A signal read **inside JSX** is what subscribes the component. A signal read
inside a plain function that is *not* called during render is **not** reactive.

### 1.3 `createEffect` replaces `useEffect`, and the deps array disappears

```tsx
// React
useEffect(() => { doThing(id); }, [id]);

// Solid — the effect re-runs when `id()` changes, because it READ id()
createEffect(() => { doThing(id()); });
```

`createEffect` runs **after** the initial render. For logic that must run
**before** paint (e.g. seeding a store on mount) use `onMount` — but prefer
`createEffect` unless there is a reason.

Effects must **not** write to signals they also read — that loops. Derive with
`createMemo` instead.

### 1.4 `createMemo` replaces `useMemo`

```tsx
const [q, setQ] = createSignal("");
const rows = createMemo(() => filter(items, q()));  // memo, not effect
```

`createMemo` is lazy and cached; it recomputes only when its tracked
dependencies change. There is **no** deps array — the compiler determines it.

`useCallback` has **no equivalent and no need**. A plain function is already
cheap in Solid; drop `useCallback` entirely.

### 1.5 `useRef` becomes a plain `let`

A React ref is a mutable box that is **not** reactive. So is a plain variable.

```tsx
// React
const ref = useRef<HTMLDivElement>(null);
ref.current = node;

// Solid
let ref: HTMLDivElement | undefined;
ref = node;              // plain assignment, NOT reactive
```

Use `createSignal` **only** if the value must trigger re-render. Note that a
signal holding a DOM node causes re-renders for no reason — prefer a plain
`let` plus `ref={el => (ref = el)}`.

---

## 2. React → Solid API map

| React | Solid |
|---|---|
| `useState(x)` | `const [x, setX] = createSignal(x)` |
| `useReducer` | `createSignal` + `setX(prev => next(prev))` |
| `useEffect(fn, deps)` | `createEffect(() => fn())` (no deps array) |
| `useLayoutEffect` | `createEffect` (Solid has no layout phase) |
| `useMemo(fn, deps)` | `createMemo(fn)` |
| `useCallback(fn, deps)` | plain `fn` — delete the wrapper |
| `useRef()` | plain `let` (non-reactive) or `createSignal` (reactive) |
| `useContext(ctx)` | `useContext(ctx)` — Solid context **is** reactive |
| `React.createContext` | `createContext` from `solid-js` |
| `memo(C)` | delete — Solid's reactivity is fine-grained already |
| `forwardRef` | delete — pass `ref` straight through |
| `<Suspense>` | `<Suspense>` from `solid-js` |
| `React.Fragment` / `<>` | `<>` (same) |
| `ReactNode` | `JSX.Element` |
| `ComponentType<P>` | `Component<P>` |
| `useSyncExternalStore` | manual subscribe in `createEffect` + `onCleanup` |
| `useId()` | `createUniqueId()` from `solid-js` |

**Do not** import from `"react"` or `"react-dom"` any more.

---

## 3. JSX idioms

### 3.1 Lists → `<For>` (or `<Index>`)

```tsx
// WRONG — the whole list re-renders on any parent re-render
{rows().map((r) => <Row data={r} />)}

// RIGHT — <For> keeps each row's DOM alive and only updates what changed
<For each={rows()}>{(r) => <Row data={r} />}</For>
```

`<For>` is keyed by reference/identity — use it for lists whose items are
objects and may be reordered. `<Index>` is keyed by **index** — use it when the
list is append-only or when you must keep index-based state (e.g. a selected
row index) stable across reorders.

Accessing the item: `each={rows()}` gives you the item directly (already
unwrapped), and the second callback arg is the index accessor.

### 3.2 Conditionals → `<Show>` / `<Switch>`

```tsx
// WRONG
{loading() ? <Spinner /> : <Table />}

// RIGHT
<Show when={!loading()} fallback={<Spinner />}>
  <Table />
</Show>
```

`when` takes a **value**, not a boolean. Use `<Show when={user()}>` for
"render if truthy". For a boolean, `<Show when={isOpen()}>` is fine — Solid
treats `false` as falsy.

Multi-branch:

```tsx
<Switch fallback={<Idle />}>
  <Match when={state() === "loading"}><Spinner /></Match>
  <Match when={state() === "error"}><ErrorBox /></Match>
  <Match when={state() === "ready"}><Table /></Match>
</Switch>
```

### 3.3 Dynamic classes → `classList`

```tsx
<span classList={{ "text-emerald-400": change() > 0, "text-rose-500": change() < 0 }}>
  {fmt(change())}
</span>
```

For a static class plus conditions, use `class` for the static part and
`classList` for the conditional part.

### 3.4 Events

Solid uses **native** DOM events, so `onClick`, `onInput`, `onKeyDown` etc. work
as-is. There is no synthetic event system:

- `onChange` → React's `onChange` fired on blur; Solid's `onChange` fires on
  native change. For inputs use **`onInput`** (fires per keystroke, like React).
- Event objects are the real DOM event: `e.currentTarget` instead of
  `e.target` for the element the handler is on.
- `e.preventDefault()` / `e.stopPropagation()` work normally.

### 3.5 Refs

```tsx
let input: HTMLInputElement | undefined;
<input ref={input} />
// or with a callback:
<input ref={(el) => (input = el)} />
```

### 3.6 Controlled inputs

```tsx
<input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
```

### 3.7 `style`

`style` takes an object of **strings** (camelCase works too):

```tsx
<div style={{ "background-color": bg, width: "120px" }} />
```

For class-driven styling prefer Tailwind utilities over inline styles.

---

## 4. Solid stores for global/nested state

Use `solid-js/store` for shared, frequently-updated state:

```tsx
import { createStore, produce } from "solid-js/store";

const [store, setStore] = createStore<{ ticks: number[]; last: number }>({
  ticks: [],
  last: 0,
});

setStore("ticks", (t) => [...t, next]);       // path update
setStore(produce((s) => { s.last = next; }));  // multi-field update
```

Reading `store.ticks` inside JSX subscribes **only** to that path. This is how
WebSocket tick updates stay cheap: a 1 Hz tick touching `store.last` must not
re-render a table bound to `store.ticks`.

Module-level stores (like `src/state/store/appSlice.ts`) are fine for app-wide
singletons — read them directly in JSX; they are reactive proxies.

---

## 5. Trading-terminal styling rules

This is a **hyper-dense financial terminal**. Density is a feature, not an
accident.

### 5.1 Rows are `h-6`, gaps are `gap-1`, text is `text-[11px]`

```tsx
<div class="flex items-center gap-1 h-6 px-1 border-b border-neutral-800 bg-zinc-950">
```

- Row height: `h-6` (24px). Labels/panels: `h-5` where it still fits.
- Padding: `p-0.5` (tight) or `p-1` (normal). Never `p-2`+ inside a table.
- Gaps: `gap-1` between cells, `gap-2` between groups.
- Font size: `text-[11px]` for table cells, `text-xs` for labels.
- Always `leading-none` in tables so rows are exactly `h-6`.
- Surfaces: `bg-zinc-950` (page), `bg-neutral-900` (panel), `bg-neutral-800`
  (raised), `border-neutral-800` (borders).
- Hover: `hover:bg-neutral-800`.

### 5.2 Every number is `font-mono tabular-nums`

Prices, Greeks, volumes, percentages, timestamps, P&L, OI — **all** of them.
A live number that shifts horizontally as it ticks is a defect.

```tsx
<span class="font-mono tabular-nums text-[11px] text-emerald-400">+12.35</span>
```

Use `font-mono` + `tabular-nums` on the **cell**, not just the number, so the
column right-aligns consistently.

### 5.3 Colour semantics

- Up/positive: `text-emerald-400`
- Down/negative: `text-rose-500`
- Neutral/flat: `text-neutral-400`
- Warning: `text-amber-400`
- Accent/primary: `text-sky-400`

Always drive it off the **signal**, never a hardcoded class:

```tsx
classList={{
  "text-emerald-400": pnl() > 0,
  "text-rose-500": pnl() < 0,
  "text-neutral-400": pnl() === 0,
}}
```

---

## 6. Testing

Use `@solidjs/testing-library`:

```tsx
import { render, screen, fireEvent } from "@solidjs/testing-library";

test("renders the price", () => {
  render(() => <Price value={1234.5} />);
  expect(screen.getByText("1,234.50")).toBeInTheDocument();
});
```

Notes:
- `render` already creates a root. For manual control (rapid ticks, imperative
  access to a signal) use `createRoot` + `render` from `solid-js/web`:

```tsx
import { createRoot } from "solid-js";
import { render } from "solid-js/web";

const [price, setPrice] = createSignal(0);
createRoot(() => {
  render(() => <Ticker price={price} />);
  for (let i = 0; i < 100; i++) setPrice(i);   // 100+ rapid ticks
});
```

- `@testing-library/jest-dom` matchers still work (it is DOM-based).
- There is **no** `user-event` for Solid. Use `fireEvent` from
  `@solidjs/testing-library`.
- `cleanup()` runs automatically after each test (see `src/test-setup.ts`).

**A price-tick test must prove the DOM kept up.** For a 100+ tick burst, assert
the **final** value is rendered and that no stale intermediate value lingers.

---

## 7. Migration status: complete

The React → Solid migration is **finished**. The React runtime is no longer in
`package.json`; everything below is history kept only so it is obvious *why* a
given library is absent and what to use instead.

| Removed | What replaced it |
|---|---|
| `react` / `react-dom` / `@types/react*` | `solid-js` (+ `vite-plugin-solid`, `jsxImportSource: solid-js`) |
| `react-router-dom` | `@solidjs/router` |
| `react-redux` / Redux slices | `solid-js/store` (`createStore`) |
| `@tanstack/react-table` | `@tanstack/solid-table` — the Solid adapter uses `<Table>`/`<TableBody>` sub-components, not `flexRender` |
| `echarts-for-react` | `echarts` directly (`echarts.init` in `onMount`, `setOption` in `createEffect`) |
| `react-markdown` | `marked` + a small renderer |
| `notistack` | `solid-notifications` |
| `@sentry/react` | `@sentry/solid` |
| `@testing-library/react` / `user-event` / `renderHook` | `@solidjs/testing-library` (`render` + `fireEvent`) |
| `@tabler/icons-react` | inline SVGs in `src/components/common/Icons.tsx` |
| Storybook (`storybook`, `@storybook/*`, `@chromatic-com/storybook`, `.storybook/`, all `*.stories.*`, `storybook-static/`) | deleted — no component gallery |

Consequence for any new code: nothing from `react`, `react-dom`,
`react-router-dom`, `react-redux`, `@tanstack/react-table`, `echarts-for-react`
or `@tabler/icons-react` can be imported, because those packages are no longer
installed.

---

## 8. Checklist before you finish a file

- [ ] No import from `"react"` / `"react-dom"` / `"react-router-dom"` / `"react-redux"`.
- [ ] No destructuring of `props` (except via `splitProps`).
- [ ] No `.map()` in JSX — use `<For>` / `<Index>`.
- [ ] No ternary rendering — use `<Show>` / `<Switch>`.
- [ ] No `useCallback` — plain functions.
- [ ] `useEffect` → `createEffect` with **no** deps array.
- [ ] Numbers use `font-mono tabular-nums`; rows use `h-6`, `gap-1`, `text-[11px]`.
- [ ] The co-located `*.test.tsx` passes with `bunx vitest run <file>`.
- [ ] `bunx oxlint <file>` is clean.

---

## 9. Defects we already hit (read this before you convert — it will save you a day)

These are not hypothetical. Every one of them broke a real file in this repo.

### 9.1 `splitProps` gives you VALUES, not accessors

```ts
// WRONG — splitProps returns a Proxy whose `get` returns props[key]
const inputId = known.id();
const w = known.w();

// RIGHT
const inputId = known.id;
const w = known.w;
```

A handler prop is called, not read: `known.onChange?.(e)`, never
`known.onChange?.()(e)`. A hyphenated prop is bracket-read:
`known["data-testid"]`.

### 9.2 Solid applies `style` objects with `style.setProperty()`

`setProperty` requires **kebab-case**. A camelCase key is silently dropped —
no error, no warning, the style just never appears.

```tsx
// WRONG — silently does nothing
<div style={{ fontSize: size, justifyContent: "center", flexBasis: pct }} />

// RIGHT
<div style={{ "font-size": size, "justify-content": "center", "flex-basis": pct }} />
```

This applies to **JS-built style objects too**, not just inline literals:

```ts
const o: Record<string, string> = {};
o["font-size"] = "12px";   // not o.fontSize
```

### 9.3 `render()` needs a thunk

```tsx
render(<Comp />);      // TypeError: code is not a function
render(() => <Comp />); // correct
```

For imperative control use `createRoot` + `render` from `solid-js/web` with a
container you append to `document.body`.

### 9.4 `createSignal` has no lazy initialiser

```ts
createSignal<string[]>(() => compute())  // the VALUE is the function
createSignal<string[]>(compute())        // correct
```

### 9.5 Never hand `undefined` to a DOM value setter

`<textarea value={undefined} />` throws in happy-dom (it dereferences
`.length`). Use a spread that omits the prop:

```tsx
<textarea {...(isControlled ? { value: v } : { defaultValue: d })} />
```

### 9.6 Two renders in one test need distinct testids

`getByTestId` throws on multiple matches. Give each render its own id.

### 9.7 happy-dom normalises `rem` to `px` in `getComputedStyle`

`toHaveStyle("font-size: 0.75rem")` fails even when the inline style is
correct — assert `12px` instead. Likewise `column-gap` resolves to `""` when
only the `gap` shorthand is set; assert `gap`.

### 9.8 The redux store is gone — read the Solid store directly

`src/state/store/{appSlice,notificationsSlice}` export `const [store, setStore] =
createStore(...)`, so `store` is the reactive proxy and `setStore` the setter.
There is no Provider and no `useStore` in Solid 1.9.

`useAppSelector(sel)` now returns an **accessor**; call it in JSX or a memo:

```tsx
const items = useAppSelector((s) => s.notifications.items);
<span>{items().length}</span>   // not items.length — the component body runs once
```

`useAppDispatch()` is a no-op: the slice mutators (`removeNotification(id)`)
already write the store before `dispatch(...)` is reached.

### 9.9 A hook that returns state returns accessors

```ts
// React
const { copyMsg, copyFailed } = useCopyFeedback();
{copyMsg ? <span>{copyMsg}</span> : null}

// Solid — the hook returns the accessor itself, and you call it in JSX
const { copyMsg, copyFailed } = useCopyFeedback();
<Show when={copyMsg()} fallback={null}>{copyMsg()}</Show>
```

Reading the accessor in the component body (outside JSX/memo) pins the first
value, because a Solid component function runs exactly once.
