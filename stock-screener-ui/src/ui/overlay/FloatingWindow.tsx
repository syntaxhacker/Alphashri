import { createEffect, For, onCleanup, splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../cn";

export interface FloatingWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingWindowProps {
  title: string;
  icon?: JSX.Element;
  geometry: FloatingWindowGeometry;
  "z-index": number;
  minimized?: boolean;
  minWidth?: number;
  minHeight?: number;
  onFocus?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
  onGeometryChange?: (g: FloatingWindowGeometry) => void;
  children: JSX.Element;
  testid?: string;
  /** Dismissal asks this first; absent means every close path is allowed. */
  canClose?: () => boolean;
  /** Opt-in Tab containment for windows that behave like modal dialogs. */
  modal?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-modal"?: boolean | "true" | "false";
}

const RESIZE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type ResizeDir = (typeof RESIZE_DIRS)[number];

const HANDLE_STYLE: Record<ResizeDir, Record<string, string | number>> = {
  n: { top: "-3px", left: "8px", right: "8px", height: "6px", cursor: "ns-resize" },
  s: { bottom: "-3px", left: "8px", right: "8px", height: "6px", cursor: "ns-resize" },
  e: { right: "-3px", top: "8px", bottom: "8px", width: "6px", cursor: "ew-resize" },
  w: { left: "-3px", top: "8px", bottom: "8px", width: "6px", cursor: "ew-resize" },
  ne: { top: "-4px", right: "-4px", width: "12px", height: "12px", cursor: "nesw-resize" },
  nw: { top: "-4px", left: "-4px", width: "12px", height: "12px", cursor: "nwse-resize" },
  se: { bottom: "-4px", right: "-4px", width: "12px", height: "12px", cursor: "nwse-resize" },
  sw: { bottom: "-4px", left: "-4px", width: "12px", height: "12px", cursor: "nesw-resize" },
};

// Only tabbable descendants belong to the cycle: tabindex="-1", disabled and
// hidden nodes are reachable programmatically, not by Tab.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "audio[controls]",
  "video[controls]",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(root: HTMLElement | undefined): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute("tabindex") === "-1" || el.hasAttribute("disabled")) return false;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest("[inert]")) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

export interface FloatingWindowHandle {
  focus: () => void;
}

export function FloatingWindow(props: FloatingWindowProps) {
  const [known, rest] = splitProps(props, [
    "title",
    "icon",
    "geometry",
    "z-index",
    "minimized",
    "minWidth",
    "minHeight",
    "onFocus",
    "onClose",
    "onMinimize",
    "onGeometryChange",
    "children",
    "testid",
    "canClose",
    "modal",
    "aria-label",
    "aria-labelledby",
    "aria-modal",
  ]);

  let rootEl: HTMLDivElement | undefined;
  // Snapshot of geometry used as the gesture origin; synced from props when idle.
  const geom = { ...known.geometry };
  let gesture = false;
  let raf = 0;
  let pending: FloatingWindowGeometry | null = null;

  // Apply geometry reactively from props, but never while a gesture drives the DOM.
  createEffect(() => {
    if (gesture || !rootEl) return;
    const g = known.geometry;
    rootEl.style.position = "absolute";
    rootEl.style.top = "0";
    rootEl.style.left = "0";
    rootEl.style.width = `${g.width}px`;
    rootEl.style.height = `${g.height}px`;
    rootEl.style.transform = `translate3d(${g.x}px, ${g.y}px, 0)`;
    rootEl.style.setProperty("z-index", String(known["z-index"]));
    rootEl.style.display = known.minimized ? "none" : "flex";
    rootEl.style.setProperty("flex-direction", "column");
  });

  const isModalish = () =>
    known.modal === true || known["aria-modal"] === true || known["aria-modal"] === "true";

  const requestClose = () => {
    if (!known.onClose || (known.canClose && !known.canClose())) return;
    known.onClose();
  };

  // Enter once per shown state. The opener is captured before focus moves so a
  // close (unmount) or minimize can put the user back where they were.
  let returnFocusTo: HTMLElement | null = null;
  let entered = false;
  let entryFrame = 0;

  createEffect(() => {
    if (known.minimized || !rootEl || entered) return;
    entered = true;
    const active = document.activeElement as HTMLElement | null;
    returnFocusTo = active && active !== rootEl && !rootEl.contains(active) ? active : null;
    entryFrame = requestAnimationFrame(() => rootEl?.focus());
  });

  createEffect(() => {
    if (!known.minimized || !entered) return;
    if (entryFrame) cancelAnimationFrame(entryFrame);
    entryFrame = 0;
    entered = false;
    returnFocusTo?.focus?.();
  });

  // Capture on the window so an inner popup's own Escape handler still sees the
  // event first when it is a descendant, and so Tab is handled before children
  // can consume it.
  createEffect(() => {
    if (known.minimized) return;
    const el = rootEl;
    if (!el) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute("role") === "combobox" && active.getAttribute("aria-expanded") === "true") return;
      if (active?.closest('[role="listbox"],[role="menu"]')) return;
      requestClose();
    };
    el.addEventListener("keydown", onEscape, true);
    onCleanup(() => el.removeEventListener("keydown", onEscape, true));
  });

  createEffect(() => {
    if (known.minimized || !isModalish()) return;
    const el = rootEl;
    if (!el) return;
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
      const focusables = getFocusable(el);
      if (focusables.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (active === last && !e.shiftKey) {
        e.preventDefault();
        first.focus();
      } else if (active === first && e.shiftKey) {
        e.preventDefault();
        last.focus();
      } else if (!active || active === el || !focusables.includes(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    el.addEventListener("keydown", onTab, true);
    onCleanup(() => el.removeEventListener("keydown", onTab, true));
  });

  onCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
    if (entryFrame) cancelAnimationFrame(entryFrame);
    if (entered) returnFocusTo?.focus?.();
  });

  const beginGesture = (mode: "move" | "resize", e: PointerEvent, dir?: ResizeDir) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    known.onFocus?.();
    gesture = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...geom };
    const el = rootEl;
    if (el) el.style.willChange = mode === "move" ? "transform" : "transform, width, height";

    const parent = el?.parentElement;
    const pw = parent?.clientWidth || window.innerWidth;
    const ph = parent?.clientHeight || window.innerHeight;
    const minW = known.minWidth ?? 260;
    const minH = known.minHeight ?? 140;
    const clampX = (v: number) => Math.min(Math.max(-orig.width + 60, v), pw - 60);
    const clampY = (v: number) => Math.min(Math.max(0, v), ph - 28);

    const apply = () => {
      raf = 0;
      const g = pending;
      if (!g || !el) return;
      el.style.transform = `translate3d(${g.x}px, ${g.y}px, 0)`;
      el.style.width = `${g.width}px`;
      el.style.height = `${g.height}px`;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let { x, y, width, height } = orig;
      if (mode === "move") {
        x = clampX(orig.x + dx);
        y = clampY(orig.y + dy);
      } else if (dir) {
        if (dir.includes("e")) width = orig.width + dx;
        if (dir.includes("s")) height = orig.height + dy;
        if (dir.includes("w")) {
          width = orig.width - dx;
          x = orig.x + dx;
        }
        if (dir.includes("n")) {
          height = orig.height - dy;
          y = orig.y + dy;
        }
        width = Math.max(minW, width);
        height = Math.max(minH, height);
        if (width <= minW && dir.includes("w")) x = orig.x + (orig.width - minW);
        if (height <= minH && dir.includes("n")) y = orig.y + (orig.height - minH);
      }
      const g = { x, y, width, height };
      pending = g;
      Object.assign(geom, g);
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (el) el.style.willChange = "";
      gesture = false;
      const g = pending;
      pending = null;
      if (g && known.onGeometryChange) known.onGeometryChange(g);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={(el) => (rootEl = el)}
      data-testid={known.testid}
      data-minimized={known.minimized || undefined}
      aria-hidden={known.minimized || undefined}
      role="dialog"
      aria-labelledby={known["aria-labelledby"]}
      aria-label={known["aria-label"] ?? known.title}
      aria-modal={known["aria-modal"] ?? (known.modal ? true : undefined)}
      tabIndex={-1}
      oncapture:pointerdown={() => known.onFocus?.()}
      className={cn("flex flex-col shadow-2xl")}
      {...(rest as Record<string, unknown>)}
    >
      {/* Title bar (drag handle) */}
      <div
        onPointerDown={(e) => beginGesture("move", e)}
        onDblClick={() => known.onMinimize?.()}
        className="flex-none h-7 px-2 flex items-center gap-1.5 cursor-move select-none bg-fin-surface-alt border-b border-fin-border touch-none"
      >
        {known.icon}
        <span className="text-[11px] font-bold tracking-[0.4px] text-fin-text uppercase truncate flex-1">
          {known.title}
        </span>
        <button
          type="button"
          aria-label={`Minimize ${known.title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => known.onMinimize?.()}
          className="grid place-items-center rounded text-fin-text-muted cursor-pointer leading-none hover:bg-fin-border"
          style={{ width: "18px", height: "18px" }}
        >
          –
        </button>
        <button
          type="button"
          aria-label={`Close ${known.title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={requestClose}
          className="grid place-items-center rounded text-fin-text-muted cursor-pointer leading-none hover:bg-fin-negative hover:text-fin-text"
          style={{ width: "18px", height: "18px" }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col">{known.children}</div>

      {/* Resize handles */}
      <For each={RESIZE_DIRS}>
        {(dir) => (
          <div
            onPointerDown={(e) => beginGesture("resize", e, dir)}
            style={{ position: "absolute", "touch-action": "none", ...HANDLE_STYLE[dir] }}
          />
        )}
      </For>
    </div>
  );
}

export default FloatingWindow;
