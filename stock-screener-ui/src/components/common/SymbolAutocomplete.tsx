// SymbolAutocomplete — single-select NSE symbol search with free text entry.
// Typing is debounced; a value is committed only on option select / Enter so
// consumers are not refetched on every keystroke. Static extras (indices such
// as NIFTY/BANKNIFTY) are merged ahead of API results.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { TextInput } from "@/ui";
import * as palette from "@/ui/palette";
import { searchSymbols, type SymbolResult } from "@/api/symbols";
import { withAlpha } from "@/utils/color";

type Option = SymbolResult | string;

/** Gap between the field and the list, and the minimum viewport edge inset. */
const MENU_GAP = 4;
const MENU_PAD = 8;
const MENU_MAX_HEIGHT = 240;
const MENU_MIN_HEIGHT = 80;

const labelOf = (option: Option | null): string =>
  option == null ? "" : typeof option === "string" ? option : option.symbol;

const nameOf = (option: Option): string => (typeof option === "string" ? "" : option.name ?? "");

/**
 * Lists are portalled to `<body>`, so a tree whose owner never disposes would
 * leave one floating over every later screen. A list cannot outlive its field:
 * drop those before opening another.
 */
const liveMenus = new Set<{ trigger: HTMLElement; host: HTMLElement }>();

function pruneDetachedMenus() {
  for (const menu of liveMenus) {
    if (menu.trigger.isConnected) continue;
    menu.host.remove();
    liveMenus.delete(menu);
  }
}

export interface MenuPlacement {
  top: number;
  left: number;
  /** `undefined` when the field has no measurable width (hidden/pre-layout). */
  width: number | undefined;
  maxHeight: number;
}

export interface BoxRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * Fixed-position placement for the portalled list: width follows the field,
 * flip above when there is no room below, and clamp to a viewport gutter so the
 * list can never be pushed off either edge.
 */
export function placeMenuBox(
  field: BoxRect,
  measuredHeight: number,
  viewport: { width: number; height: number },
  fallbackWidth: number,
): MenuPlacement {
  const menuH = measuredHeight > 0 ? Math.min(measuredHeight, MENU_MAX_HEIGHT) : MENU_MAX_HEIGHT;
  // A zero-width field rect (display:none ancestor, pre-layout) must not produce
  // a `width: 0px` list — that would be invisible rather than merely misplaced.
  const available = Math.max(0, viewport.width - MENU_PAD * 2);
  const boxWidth = field.width > 0 ? Math.min(field.width, available) : undefined;
  const spaceBelow = viewport.height - field.bottom - MENU_PAD;
  const spaceAbove = field.top - MENU_PAD;
  const openUp = spaceBelow < menuH + MENU_GAP && spaceAbove > spaceBelow;
  const maxHeight = Math.max(
    MENU_MIN_HEIGHT,
    Math.min(MENU_MAX_HEIGHT, (openUp ? spaceAbove : spaceBelow) - MENU_GAP),
  );
  const left = Math.max(
    MENU_PAD,
    Math.min(field.left, viewport.width - (boxWidth ?? fallbackWidth) - MENU_PAD),
  );
  const top = openUp
    ? Math.max(MENU_PAD, field.top - Math.min(menuH, maxHeight) - MENU_GAP)
    : Math.min(field.bottom + MENU_GAP, Math.max(MENU_PAD, viewport.height - MENU_PAD - maxHeight));
  return { top, left, width: boxWidth, maxHeight };
}

interface SymbolAutocompleteProps {
  value: string;
  onChange: (symbol: string) => void;
  label?: string;
  width?: number;
  testid?: string;
  /** Static choices rendered ahead of API results, e.g. index underlyings. */
  extraOptions?: string[];
  /** Drop the floating label, keep the field short (used inside dense headers). */
  compact?: boolean;
  /** Restrict API results to F&O-enabled symbols. */
  fnoOnly?: boolean;
  /**
   * Render the list in a `fixed` portal (default). Only opt out when the field
   * provably has no clipping/scroll ancestor — an inline `absolute` list is cut
   * off at the first `overflow:hidden` between it and the field.
   */
  withinPortal?: boolean;
}

export default function SymbolAutocomplete(props: SymbolAutocompleteProps) {
  const [local] = splitProps(props, ["label", "width", "testid", "extraOptions", "compact", "fnoOnly", "withinPortal"]);
  const label = () => local.label ?? "Symbol";
  const width = () => local.width ?? 220;
  const extraOptions = () => local.extraOptions ?? [];
  const compact = () => local.compact ?? false;
  const fnoOnly = () => local.fnoOnly ?? false;
  const portalMenu = () => local.withinPortal !== false;

  const [results, setResults] = createSignal<SymbolResult[]>([]);
  const [input, setInput] = createSignal(props.value ?? "");
  const [open, setOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(-1);
  let timer: number | undefined;
  let rootEl: HTMLDivElement | undefined;
  let listEl: HTMLDivElement | undefined;

  onCleanup(() => window.clearTimeout(timer));

  /** The `<input>` itself, not the wrapper: the label sits above it. */
  const fieldEl = (): HTMLElement | undefined => rootEl?.querySelector("input") ?? rootEl;

  // Converge to an external value change (param load / form reset) without
  // clobbering text the user is actively typing (the prop only changes on commit).
  createEffect(() => {
    setInput(props.value ?? "");
  });

  const handleInput = (v: string, reason?: string) => {
    // The local Autocomplete fires reason "reset"/"blur" with "" when async options resolve or the
    // field blurs; those are not user edits and must not wipe the typed text.
    if (reason === "reset" || reason === "blur") return;
    setInput(v);
    setOpen(true);
    window.clearTimeout(timer);
    const q = v.trim();
    if (!q) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer = window.setTimeout(() => {
      const request = fnoOnly()
        ? searchSymbols(q, 10, true)
        : searchSymbols(q, 10);
      request
        .then((r) => {
          setResults(r);
          setOpen(r.length > 0);
        })
        .catch(() => {
          setResults([]);
          setOpen(false);
        });
    }, 250);
  };

  const options = createMemo<Option[]>(() => {
    const q = input().trim().toUpperCase();
    const seen = new Set<string>();
    const merged: Option[] = [];

    for (const extra of extraOptions()) {
      const key = extra.toUpperCase();
      if (q && !key.includes(q)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(extra);
    }

    if (q) {
      for (const result of results()) {
        const key = result.symbol.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(result);
      }
    }

    return merged;
  });

  const handleSelect = (option: Option) => {
    setInput(labelOf(option));
    setOpen(false);
    props.onChange(labelOf(option));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open() && options()[highlightedIndex()] !== undefined) {
        handleSelect(options()[highlightedIndex()]);
      } else {
        props.onChange(input());
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  /**
   * The list is portalled and `fixed`, placed from the input's rect. An
   * `absolute` child is clipped by the first ancestor with `overflow` — both
   * consumers live in one (the simulator header and the replay cards are
   * `overflow:hidden`), so the list was cut off at the field's height.
   */
  const [menuPos, setMenuPos] = createSignal<MenuPlacement | null>(null);

  const placeMenu = () => {
    const el = fieldEl();
    if (!el) return;
    // The list is hidden on its first pass, so its own height is not yet known.
    setMenuPos(
      placeMenuBox(el.getBoundingClientRect(), listEl?.getBoundingClientRect().height ?? 0, {
        width: window.innerWidth,
        height: window.innerHeight,
      }, width()),
    );
  };

  createEffect(() => {
    if (!open() || !portalMenu()) {
      setMenuPos(null);
      return;
    }
    // Render hidden first, then measure (visibility:hidden still lays out).
    queueMicrotask(placeMenu);
  });

  createEffect(() => {
    // Async results grow the list after the first placement, which can turn a
    // "fits below" decision into a "must flip above" one.
    const hasOptions = options().length > 0;
    if (open() && hasOptions && portalMenu()) queueMicrotask(placeMenu);
  });

  createEffect(() => {
    if (!open()) return undefined;
    pruneDetachedMenus();
    const root = rootEl;
    // The list is portalled, so `root.contains` is false for its own children:
    // a mousedown on an option would count as "outside" and unmount the list
    // before the click could commit the value.
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (open() && !root?.contains(target) && !listEl?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  });

  createEffect(() => {
    if (!open() || !portalMenu()) return undefined;
    // A scroll inside the list itself must not reposition it — only an ancestor
    // scroller or the window moving the field does that.
    const onMove = (e: Event) => {
      if (listEl && e.target instanceof Node && listEl.contains(e.target)) return;
      placeMenu();
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  });

  const trackMenu = (host: HTMLElement) => {
    const trigger = rootEl;
    if (!trigger) return;
    const menu = { trigger, host };
    liveMenus.add(menu);
    onCleanup(() => liveMenus.delete(menu));
  };

  const menuStyle = (): JSX.CSSProperties =>
    portalMenu()
      ? {
          position: "fixed",
          top: `${menuPos()?.top ?? 0}px`,
          left: `${menuPos()?.left ?? 0}px`,
          width: menuPos()?.width != null ? `${menuPos()!.width}px` : `${width()}px`,
          "max-height": `${menuPos()?.maxHeight ?? MENU_MAX_HEIGHT}px`,
          visibility: menuPos() ? "visible" : "hidden",
          "z-index": 1300,
          "background-color": palette.SURFACE,
          border: `1px solid ${palette.BORDER}`,
          "border-radius": "4px",
          "box-shadow": `0 4px 12px ${withAlpha(palette.BG, 0.3)}`,
          "overflow-y": "auto",
        }
      : {
          position: "absolute",
          top: "100%",
          left: "0px",
          right: "0px",
          "background-color": palette.SURFACE,
          border: `1px solid ${palette.BORDER}`,
          "border-top": "none",
          "border-radius": "0 0 4px 4px",
          "box-shadow": `0 4px 12px ${withAlpha(palette.BG, 0.3)}`,
          "z-index": 50,
          "max-height": `${MENU_MAX_HEIGHT}px`,
          "overflow-y": "auto",
        };

  return (
    <div
      ref={(el) => (rootEl = el)}
      style={{ position: "relative", width: `${width()}px`, display: "inline-block" }}
      data-testid={local.testid ? `${local.testid}-wrap` : undefined}
    >
      <TextInput
        size="xs"
        value={input()}
        onChange={(v) => handleInput(v)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        label={compact() ? undefined : label()}
        placeholder={compact() ? "Index or F&O stock" : undefined}
        data-testid={local.testid}
        style={{ width: "100%" }}
      />
      <Show when={open() && options().length > 0}>
        <Show when={portalMenu()} fallback={<OptionList />}>
          <Portal ref={trackMenu}><OptionList /></Portal>
        </Show>
      </Show>
    </div>
  );

  function OptionList() {
    return (
      <div
        ref={(el) => (listEl = el)}
        role="listbox"
        data-part="symbol-autocomplete-list"
        style={menuStyle()}
      >
        <For each={options()}>{(option, index) => (
          <div
            role="option"
            aria-selected={highlightedIndex() === index()}
            style={{
              padding: "6px 8px",
              cursor: "pointer",
              "border-bottom": `1px solid ${palette.BORDER}`,
              display: "flex",
              "align-items": "center",
              gap: "8px",
              "background-color": highlightedIndex() === index() ? palette.SCALE_GRAY[6] : "inherit",
              color: palette.TEXT,
            }}
            // Pressing an option must not blur the field: blur schedules a close
            // and the click would land on a removed row. Scoped to the row so the
            // list's own scrollbar stays draggable.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHighlightedIndex(index())}
            onClick={() => handleSelect(option)}
          >
            <span style={{ "font-weight": 600 }}>{labelOf(option)}</span>
            <Show when={nameOf(option)}>
              <span style={{ color: palette.TEXT_MUTED, "margin-left": "8px", "font-size": "12px" }}>{nameOf(option)}</span>
            </Show>
          </div>
        )}</For>
      </div>
    );
  }
}
