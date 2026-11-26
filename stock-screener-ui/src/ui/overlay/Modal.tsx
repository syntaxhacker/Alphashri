import { createEffect, createUniqueId, onCleanup, Show, splitProps } from "solid-js";
import { cn } from "../cn";
import { containBackground } from "./backgroundContainment";
import type { UIModalProps, UISize } from "../types";

type ModalProps = UIModalProps & {
  /** Override the default single-line title truncation for complex title rows. */
  titleClassName?: string;
};

const SIZE_MAX_WIDTH: Record<string, string> = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

function paddingSize(v: UISize | number | string): string {
  if (typeof v === "number") return `${v * 8}px`;
  const m: Record<string, string> = { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" };
  return m[v as string] ?? String(v);
}

// Only elements in the tab sequence belong to the cycle: `tabindex="-1"`,
// disabled and hidden controls are reachable programmatically, not by Tab.
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
    const computed = window.getComputedStyle(el);
    return computed.display !== "none" && computed.visibility !== "hidden";
  });
}

/**
 * Dialog stack. Background containment is shared with the other overlays
 * (`backgroundContainment.ts`); this stack only decides which dialog owns
 * Escape and the Tab cycle when dialogs are nested.
 */
const openDialogs: HTMLElement[] = [];
const releases = new WeakMap<HTMLElement, () => void>();

function registerDialog(dialog: HTMLElement) {
  if (openDialogs.includes(dialog)) return;
  openDialogs.push(dialog);
  releases.set(dialog, containBackground(dialog));
}

function unregisterDialog(dialog: HTMLElement) {
  const index = openDialogs.indexOf(dialog);
  if (index !== -1) openDialogs.splice(index, 1);
  releases.get(dialog)?.();
  releases.delete(dialog);
}

/** Innermost open dialog: the only one that handles Escape and Tab. */
function topDialog(): HTMLElement | undefined {
  for (let i = openDialogs.length - 1; i >= 0; i--) {
    if (openDialogs[i].isConnected) return openDialogs[i];
  }
  return undefined;
}

/**
 * Dismissal defaults, whenever `onClose` is given: a titled modal always shows
 * a × in its title bar, Escape closes, and a backdrop click closes. Dialogs
 * that would discard something irreversible opt out explicitly with
 * `closeOnEscape={false}` / `closeOnClickOutside={false}`.
 */
export function Modal(props: ModalProps) {
  // splitProps reads are reactive only while they stay inside a tracked scope
  // (JSX or an effect). Destructuring them here would pin the first snapshot.
  const [known, rest] = splitProps(props as typeof props & Record<string, unknown>, [
    "children",
    "opened",
    "onClose",
    "title",
    "titleClassName",
    "size",
    "fullScreen",
    "withCloseButton",
    "closeOnClickOutside",
    "closeOnEscape",
    "overlayProps",
    "padding",
    // Runtime swallow for older callers; no longer public API.
    "transitionProps",
    "className",
    "style",
    "id",
    "data-testid",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
  ]);

  // The testid travels with the dialog, so the close button can derive its own.
  const testId = known["data-testid"];
  // One stable id per instance, used only when there is a visible title to name it.
  const titleId = `modal-title-${createUniqueId()}`;

  // `?? true` rather than a truthiness check: an explicit `false` is a
  // deliberate opt-out (irreversible dialogs) and must survive.
  const canClose = () => known.onClose != null;
  const closeOnEscape = () => known.closeOnEscape ?? true;
  const closeOnClickOutside = () => known.closeOnClickOutside ?? true;
  const showCloseButton = () =>
    canClose() && (Boolean(known.title) || Boolean(known.withCloseButton));

  let dialogRef: HTMLDivElement | undefined;

  // An open combobox/menu owns Escape first: the dialog must not vanish while
  // the user is only closing a dropdown. This listener runs in the capture
  // phase — the dropdown's own handler (bubble) has already flipped
  // `aria-expanded`/unmounted the listbox by the time a bubble listener sees it.
  // Binding a popup is judged by an open signal, never by presence alone: an
  // inline Select's listbox is a dialog descendant whenever it is open.
  const escapeBelongsToPopup = () => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.getAttribute("role") === "combobox" && active.getAttribute("aria-expanded") === "true") {
      return true;
    }
    if (active?.closest('[role="listbox"],[role="menu"]')) return true;
    if (dialogRef?.querySelector('[role="combobox"][aria-expanded="true"]')) return true;
    return Boolean(dialogRef?.querySelector('[role="menu"]'));
  };

  createEffect(() => {
    if (!known.opened) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef;
    const frame = window.requestAnimationFrame(() => dialogRef?.focus());
    const onDocKey = (e: KeyboardEvent) => {
      // A nested dialog owns the keyboard; the outer one must not also close
      // on the same Escape or pull focus back with its own Tab cycle.
      if (topDialog() !== dialogRef) return;
      if (e.key === "Escape" && closeOnEscape() && !escapeBelongsToPopup()) {
        known.onClose?.();
        return;
      }
      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;

      // Cycle Tab/Shift+Tab through the dialog's tabbable descendants. The
      // dialog itself (tabIndex=-1) is the initial focus target and the last
      // resort when there is nothing tabbable inside.
      const focusables = getFocusable(dialogRef);
      if (focusables.length === 0) {
        e.preventDefault();
        dialogRef?.focus();
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
      } else if (active == null || !focusables.includes(active)) {
        // Focus sits on the dialog, on a programmatic-only element, or outside
        // the modal entirely: bring it back to the appropriate edge.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onDocKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialog) registerDialog(dialog);
    onCleanup(() => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onDocKey, true);
      document.body.style.overflow = previousOverflow;
      // Restore the background before focusing the opener: it may have been
      // inert while this dialog was on top.
      if (dialog) unregisterDialog(dialog);
      previous?.focus?.();
    });
  });

  const size = known.size;
  const isPreset = typeof size === "string" && size in SIZE_MAX_WIDTH;
  const maxWidthClass = isPreset ? SIZE_MAX_WIDTH[size as string] : undefined;
  const maxWidthStyle =
    !isPreset && known.size != null
      ? typeof known.size === "number"
        ? `${known.size}px`
        : String(known.size)
      : undefined;

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget && closeOnClickOutside()) known.onClose?.();
  };

  const overlayStyle: Record<string, string | number | undefined> = {
    "background-color": known.overlayProps?.color ?? undefined,
    opacity: known.overlayProps?.opacity != null ? known.overlayProps.opacity : undefined,
    "backdrop-filter":
      known.overlayProps?.blur != null
        ? `blur(${typeof known.overlayProps.blur === "number" ? `${known.overlayProps.blur}px` : known.overlayProps.blur})`
        : undefined,
  };

  const panelStyle: Record<string, string | number | undefined> = {
    ...(maxWidthStyle ? { "max-width": maxWidthStyle } : {}),
    ...(known.fullScreen
      ? { position: "absolute", top: "0px", left: "0px", width: "100%", height: "100%" }
      : { "max-height": "calc(100dvh - 32px)" }),
    ...known.style,
  };

  return (
    <Show when={known.opened}>
      <div
        ref={(el) => (dialogRef = el)}
        id={known.id}
        data-testid={testId}
        className={cn("fixed inset-0 z-50 flex items-center justify-center", known.className)}
        style={overlayStyle}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby={known.title ? titleId : undefined}
        aria-label={known.title ? undefined : "dialog"}
        tabIndex={-1}
        {...(rest as Record<string, unknown>)}
      >
        <div
          className={cn(
            "relative bg-fin-surface border border-fin-border rounded-sm shadow-2xl flex flex-col w-full",
            maxWidthClass,
            known.fullScreen ? "absolute inset-0 w-full h-full max-w-none rounded-none border-0" : undefined,
          )}
          style={panelStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={known.title || showCloseButton()}>
            <div className="relative flex items-center justify-between border-b border-fin-border bg-fin-surface/50 px-3 py-2">
              {known.title && (
                <div
                  id={titleId}
                  className={cn(
                    "flex-1 text-sm font-medium text-fin-text",
                    showCloseButton() ? "pr-8" : undefined,
                    known.titleClassName ?? "truncate",
                  )}
                >
                  {known.title}
                </div>
              )}
              {showCloseButton() && (
                <button
                  type="button"
                  aria-label="close"
                  data-testid={testId ? `${testId}-close` : undefined}
                  onClick={() => known.onClose?.()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded text-fin-text-muted hover:text-fin-text hover:bg-fin-border"
                >
                  ×
                </button>
              )}
            </div>
          </Show>
          <div className="flex-1 min-h-0 overflow-auto" style={{
            "padding": known.padding != null ? paddingSize(known.padding) : undefined,
          }}
        >
          {known.children}
        </div>
        </div>
      </div>
    </Show>
  );
}
