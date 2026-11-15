# UX principles — how we judge a screen

Short, testable rules. Every revamp is checked against them; every new surface should
leave the screen closer to them, not further.

## 1. Primary content takes space; transient content overlays
A chart, table, or editor the user is *working in* is a layout column (flex/grid sibling).
Modals and overlays are only for transient, blocking choices. If closing something makes
the content beside it reflow, it was never a modal.

## 2. One surface per concept
Do not build a second rendering of the same data for a different trigger. One chart, one
preview, one detail panel. Multiple surfaces drift: different sizes, different states, one
of them stale.

## 3. No dead ends
Any truncation must be escapable. A cap without a reveal path is a bug, and the footer must
say what is hidden **and** how to get it:
`showing 80 of 3226 · [load more]`, plus auto-extension on scroll.

## 4. Keyboard parity
If a list drives a detail view, Up/Down move the selection and repoint the detail — with a
guard that ignores events originating in inputs, textareas, selects and contenteditable.
Pointer-only navigation is a junior trade.

## 5. Hover previews, click pins
Hover is a temporary preview into the same surface; click pins it. Leaving reverts to the
pinned item (or the empty state). Never open a second surface for hover.

## 6. Typographic hierarchy, one per band
One large number per band (price), one secondary (delta), quiet labels. Labels 10px
uppercase, body 11–12px, never below 9px. All numerals use tabular figures. Two badges of
equal weight side by side means the hierarchy is missing — pick a primary.

## 7. Alignment is the design
Text left, numbers right, badges/actions centered. One 8pt rhythm. One border per section;
separate sections with a rule, never with nested cards. If two adjacent things look like the
same thing, they must be the same thing.

## 8. Flexible sizing, floors not widths
Use `flex-1` / `basis-[…%]` / `grid-cols-[…]` with `min-w-*` floors and `max-w-*` ceilings.
Fixed pixel columns break at the next viewport; ratios survive.

## 9. Measure, then claim
"Looks better" is not evidence. Record `getBoundingClientRect()` / long-task numbers before
and after, and put them in the commit message. Screenshots at a real viewport are part of
done.

## 10. Remount discipline (Solid)
Never render a component through a function call in JSX (`{panel()}` where `panel = () => <X/>`):
the expression re-runs on state change and constructs a new component every tick. Render the
component and pass reactive props. Same for chart options: rebuild only when the data
identity changes.

## 11. First load is not a refresh
An empty container may show a skeleton or progress block. A container that already has
content keeps it and shows a **delayed, non-blocking** indicator (≥200 ms, corner chip).
Never cover working data with an overlay because a background request started — a scope
switch that fires four short loads must not strobe four times. Two independent loading
flags must be combined into one derived "busy" state before they reach the UI.
