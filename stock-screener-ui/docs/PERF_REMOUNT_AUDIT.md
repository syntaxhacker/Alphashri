# PERF: the `{fn()}` remount audit

Scope: this doc covers the class of bug fixed in `MarketScreenerPanel` — a panel
rendered as `{rail()}`, a function returning JSX — and asks whether that shape is
still present elsewhere. It records what was **measured**, not what was assumed.

Everything below was checked against the Solid compiler output (babel-preset-solid
`generate: "dom"`) and against constructions counted in happy-dom, not by reading
JSX and guessing. Several of the six "patterns" in the original brief turned out
to be false positives; that correction is the main value of this audit.

---

## 0. The mechanism, measured (this is the important part)

`{fn()}` where `fn` returns JSX does **not** remount by itself. Babel compiles the
child expression to `_$insert(parent, fn, null)`, and `insert` wraps it in
`createRenderEffect(() => insertExpression(parent, fn(), ...))`. The `createComponent`
call inside `fn` is therefore **untracked** with respect to `fn`'s own dependencies,
and every prop on the component is emitted as a lazy `getter`.

Measured with the real `MarketFilterRail`, both shapes side by side
(`zz-shape` probe, deleted):

```
ACCESSOR mount=1 after5writes=1     // {rail()} inside <Show>
INLINE  mount=1 after5writes=1     // <MarketFilterRail/> written out
```

So `{rail()}` **did not reproduce a remount** in a construction-counted harness. The
measured cause of that 2,615 ms → 811 ms profile win was item 2 of that same
commit — `RangeInput.applySlider` notifying both sides per pointer move, doubling
parent state writes — plus `commitOnRelease`. `{rail()}` and the inline form
compile to the same insert path. (I could not re-run the original CPU profile, so
I am reporting what the harness measures, not re-adjudicating that commit.)

A remount does happen, but only under a narrower condition that I could reproduce
and you can too:

> **A zero-arg accessor that performs a *tracked read in statement position*
> (before it returns JSX)**, and is invoked as a child expression inside a
> component that reads `props.children`.

That read lands on the *enclosing* insert-memo, so the memo re-runs and calls the
accessor again, constructing a fresh component. Minimal proof:

```tsx
const label = () => (badge() > 0 ? "many" : "none");
const bell = () => { const l = label(); return <Leaf v={l} />; };  // eager
// badge: 1 mount -> 6 mounts after 5 writes          (probe U)
const bell = () => <Leaf v={label()} />;               // lazy
// badge: 1 mount -> 1 mount                          (probe V)
```

The fix is always the same: delete the local, read in the JSX getter. Prerequisites
for the bug are *all* of: a local signal (not a stable prop), read in statement
position, in an accessor rendered as `{fn()}`.

## 1. Findings by severity

Ranked by (writes/sec) x (subtree size rebuilt). Only 1 of the 6 brief patterns
produced a real finding.

### 1.1 `PatternsPage` + `PatternListView` — `key={filters().sort}` is dead code (HIGH)

`src/pages/patterns/PatternsPage.tsx:1012` passes `key={filters().sort}` with a
comment in `PatternListView.tsx:310` claiming *"the parent remounts (key=sort) so
changing the rail re-seeds it"*.

**Solid has no `key` prop for components.** `createComponent(PatternListView, {get key(){…}})`
just hands `props.key` to the function, which ignores it. Measured on the real
components:

```
SORT before: Score ▼ | after: Score ▼
SORT re-seeded? false
```

Consequence: switching the rail from "confidence" to "newest" leaves the table
header showing `Score ▼` and keeps the previous order until the user clicks a
header. The intent in the comment never happened. This is a **behaviour** bug, not
only a perf one.

Fix: seed from a reactive `initialState` that follows `props.sort` — i.e. make
`TanStackTable` re-seed `sorting` when `initialState.sorting` changes identity,
or lift the sort into a signal owned by `PatternListView`.

**FIXED (main agent, same branch):** `PatternListView` now wraps the table in a
keyed `<Show when={props.sort || "default"} keyed>`, which is Solid's actual
remount trigger, and the dead `key=` prop is gone from `PatternsPage`. Regression
test `re-seeds when the rail sort changes after mount` fails without `keyed`
(`expected …BBB to be …AAA`) and passes with it. The same file also had the
camelCase style-key defect on the active-row tint (`boxShadow` silently dropped);
now kebab-case via `alpha(PRIMARY, …)`.

### 1.2 `NavbarLinksGroup.navLink` — eager `const IconC = props.icon` (LOW, benign today)

`src/components/layout/NavbarLinksGroup.tsx:21` reads a prop in statement
position. Compiled output confirms it:

```js
const navLink = () => {
  const IconC = props.icon;          // <- tracked read, statement position
  return _$createComponent(Box, { get children() { return _$createComponent(IconC, …) } });
};
```

Measured: `ICONBOX mount=1 after5=1`, and an `active` toggle keeps the same DOM
node (`NAVLINK same DOM node after active change? true`). It is benign **only
because `props.icon` is a stable module-level function** — the parent re-renders,
the prop re-reads to the same value, and Solid's `createMemo` equality stops it.
It becomes the 1.1-class bug the day an icon is chosen reactively (e.g. a
theme-dependent icon), which is exactly how `SidebarHeader.bell` was written.

The `<Dynamic component={props.icon}>` form compiles to a lazy
`get component()` and removes the statement-position read. Applied, verified
green, then **reverted** — it passed with and without the change, so under
SUBAGENT_RULES §8 it is not a regression test and I will not claim it as a fix.

### 1.3 Correctly-written code that the brief's patterns flag as broken (non-findings)

These cost the most time, so they are listed explicitly so nobody re-litigates them:

| Site | Why it is not the bug |
|---|---|
| `ReplayShell.tsx:269,317` `{paramControls()}`, `{runButton()}` | Reads `plugin()` / `manual()`, both `() => props.x` over **stable** props. Measured `columns renders=1 uniqueArrays=1` across 10 clock ticks. |
| `OptionAlerts.tsx:14` `alerts = createMemo(… props.spotPrice)` | That read **is** the declared dependency. No JSX in the memo either. |
| `OptionChainTable.tsx:219` `tooltipContent = createMemo(… meta())` | Reading `meta()` is the point of the memo. |
| `WatchView.tsx:724,842` `columns = createMemo(… columnsFor(setup()))` | `setup` is a prop-derived stable value. |
| `ReplayTradeTable.tsx:108` `columns = createMemo(… props.clock)` | Measured stable: `renders=1 uniqueArrays=1` over 10 clock ticks; `props.clock` only feeds 4 cell bodies, which are lazy. |
| `WatchlistScan2.tsx:229` `{emptyHeader()}` | Measured `WATCHLIST same card node: true true` across 2 poll ticks. |
| `SidebarHeader.tsx:33` `{bell()}` | Measured `SIDEBAR tooltips: mount=2 after5polls=2`. |
| `AppLayout.tsx:46` `{drawerContent()}` | Compiles to lazy `get activePath()` / `get collapsed()`. |
| All `<Show fallback={fn()}>` in `pages/report/**` | Same untracked-insert path; excluded anyway (other agent). |

## 2. Files intentionally NOT fixed

- `src/components/layout/NavbarLinksGroup.tsx` — fix written, verified, reverted.
  The test passed both ways (stable prop), so shipping it would be an unproven
  claim. Ready to re-apply if an icon ever becomes reactive.
- `src/pages/patterns/PatternsPage.tsx` + `PatternListView.tsx` (the `key=` bug,
  §1.1) — the fix is a real behaviour change to table sort seeding. It needs the
  owner's decision on where sort state lives, and `PatternsPage` is a sibling
  agent's hot file. Documented, not touched.
- Everything under the exclusions (`src/components/market/**`,
  `src/components/common/TanStackTable.tsx`, `src/ui/inputs/**`,
  `src/pages/screener/**`, `src/pages/report/**`).

## 3. How this was verified

Scripts (temp, now deleted from `src/test/`) compiled every `src/**/*.tsx` with
`babel-preset-solid` and reported statement-position reads in zero-arg accessors
that build components. Authoritative result over the whole tree:

```
src/components/common/TanStackTable.tsx:590 cell()      EAGER=[row(), index()]
src/components/layout/NavbarLinksGroup.tsx:19 navLink() EAGER=[props.icon]
src/components/options/OptionChain/OptionAlerts.tsx:18 alerts [createMemo] EAGER=[props.spotPrice]
src/components/patterns/WatchView.tsx:842 columns [createMemo] EAGER=[columnsFor(), setup(), props.onOpenSymbol]
src/pages/report/ReportDecisionStrip.tsx:246 planOneLiner() EAGER=[planSummary(), tapeBadge()]
src/pages/report/ReportWorkspace.tsx:190 deskTabs [createMemo] EAGER=[isDesk()]
```

Six sites tree-wide; one in scope (`NavbarLinksGroup`, benign), one is the
`key=` bug (not an accessor-remount at all). The other four are correct code.

Guards run: `npx vitest run src/components/layout/NavbarLinksGroup.test.tsx` →
8/8. `npx vitest run src/components/layout/NavbarNested.test.tsx` → 24/24.
No production file changed in the final tree.

## 4. Reproduce

The decisive experiment is 20 lines: render the real `MarketFilterRail` through
`{rail()}` and through inline JSX, count constructions, write `filters` five
times, assert both counters equal 1. If someone re-introduces the `{fn()}`
rationale in a commit message, point them at §0.
