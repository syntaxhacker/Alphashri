import { Index, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Button, Checkbox, Tooltip } from "@/ui";

/**
 * One row of the picker. `locked` columns are the table's identity columns
 * (e.g. SYMBOL on the market tables): they can be reordered, but hiding them
 * would leave a row with nothing to identify it, so the control is disabled.
 */
export interface ColumnPickerItem {
  id: string;
  label: string;
  visible: boolean;
  locked?: boolean;
}

export interface ColumnPickerProps {
  items: ColumnPickerItem[];
  /** Saved-config scope key, surfaced on the trigger for store/E2E addressing. */
  tableId?: string;
  /** `from`/`to` are indices in the picker, i.e. display order. */
  onMove: (from: number, to: number) => void;
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
}

const PANEL_W = 232;
const PANEL_MAX_H = 320;
const GAP = 4;
const PAD = 8;
const ROW_H = "24px";

/**
 * The panel is portalled and `fixed`: the table lives in a `overflow:auto`
 * scroll container, and an in-flow absolute child of the toolbar would be
 * clipped by it exactly like the market rail's old sector menu.
 *
 * Reordering has two paths, because drag alone is not a keyboard affordance:
 * the handle is draggable *and* focuses to ArrowUp/ArrowDown.
 */
export function ColumnPicker(props: ColumnPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [dragFrom, setDragFrom] = createSignal<number | null>(null);
  const [pos, setPos] = createSignal<{ top: number; right: number; maxHeight: number } | null>(null);

  let triggerEl: HTMLElement | undefined;
  let panelEl: HTMLElement | undefined;

  const place = () => {
    const el = triggerEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Space actually usable on each side, after the viewport pad and the gap.
    const below = window.innerHeight - r.bottom - PAD - GAP;
    const above = r.top - PAD - GAP;
    const openUp = below < PANEL_MAX_H && above > below;
    // The panel may only be as tall as the side it opens into. Sizing it to
    // PANEL_MAX_H and then clamping `top` would push its own footer off-screen.
    const maxHeight = Math.max(0, Math.min(PANEL_MAX_H, openUp ? above : below));
    setPos({
      top: openUp ? r.top - maxHeight - GAP : r.bottom + GAP,
      // Anchored to the trigger's right edge, matching the toolbar's right slot.
      right: Math.max(PAD, window.innerWidth - r.right),
      maxHeight,
    });
  };

  createEffect(() => {
    if (!open()) {
      setPos(null);
      return;
    }
    queueMicrotask(place);
  });

  createEffect(() => {
    if (!open()) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerEl?.contains(target) || panelEl?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onMove = (event: Event) => {
      // A scroll inside the panel must not reposition it.
      if (panelEl && event.target instanceof Node && panelEl.contains(event.target)) return;
      place();
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    });
  });

  onCleanup(() => panelEl?.remove());

  const hiddenCount = () => props.items.filter((item) => !item.visible).length;

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    if (from >= props.items.length || to >= props.items.length) return;
    props.onMove(from, to);
  };

  return (
    <span class="inline-block" ref={(el) => (triggerEl = el)} data-table-id={props.tableId}>
      <Button
        size="xs"
        variant="subtle"
        aria-haspopup="dialog"
        aria-expanded={open()}
        data-testid="table-column-picker-trigger"
        onClick={() => setOpen((prev) => !prev)}
      >
        Columns
        <span class="font-mono tabular-nums text-fin-text-muted" data-testid="table-column-picker-count">
          {props.items.length - hiddenCount()}/{props.items.length}
        </span>
      </Button>
      <Show when={open()}>
        <Portal>
          <div
            ref={(el) => (panelEl = el)}
            role="dialog"
            aria-label="Column visibility and order"
            data-testid="table-column-picker"
            class="fixed flex flex-col border border-fin-border rounded-[6px] bg-fin-surface text-fin-text shadow-md"
            style={{
              top: `${pos()?.top ?? 0}px`,
              right: `${pos()?.right ?? 0}px`,
              width: `${PANEL_W}px`,
              "max-height": `${pos()?.maxHeight ?? PANEL_MAX_H}px`,
              visibility: pos() ? "visible" : "hidden",
              "z-index": "1300",
            }}
          >
            <div class="flex items-center justify-between gap-2 px-2 shrink-0 border-b border-fin-border" style={{ height: ROW_H }}>
              <span class="text-[10px] font-mono uppercase tracking-wide text-fin-text-muted">Columns</span>
              <button
                type="button"
                onClick={() => props.onReset()}
                data-testid="table-column-picker-reset"
                class="text-[11px] underline decoration-dotted underline-offset-2 text-fin-text-muted hover:text-fin-text"
              >
                Reset to default
              </button>
            </div>
            <ul class="m-0 p-0 list-none overflow-y-auto" style={{ "min-height": "0px" }}>
              {/* `Index` keys by position: toggling a checkbox must not remount
                  every row and drop the focus the user is standing on. */}
              <Index each={props.items}>{(item, index) => {
                const row = () => index;
                return (
                  <li
                    data-testid={`table-column-picker-row-${item().id}`}
                    class="flex items-center gap-1 px-2"
                    style={{ height: ROW_H }}
                    onDragOver={(event) => {
                      // Without preventDefault the drop never fires.
                      if (dragFrom() !== null) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = dragFrom();
                      setDragFrom(null);
                      if (from !== null) move(from, row());
                    }}
                  >
                    <span
                      role="button"
                      tabindex={0}
                      draggable="true"
                      aria-label={`Reorder ${item().label}`}
                      title="Drag to reorder, or use ↑ / ↓"
                      data-testid={`table-column-picker-handle-${item().id}`}
                      class="shrink-0 cursor-grab select-none text-fin-text-muted hover:text-fin-text"
                      style={{ "font-size": "11px", "line-height": "1" }}
                      onDragStart={(event) => {
                        setDragFrom(row());
                        event.dataTransfer?.setData?.("text/plain", item().id);
                      }}
                      onDragEnd={() => setDragFrom(null)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          move(row(), row() - 1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          move(row(), row() + 1);
                        }
                      }}
                    >
                      ⠿
                    </span>
                    <Checkbox
                      size="xs"
                      label={item().label}
                      checked={item().visible}
                      disabled={item().locked}
                      data-testid={`table-column-picker-toggle-${item().id}`}
                      onChange={(event) => {
                        if (item().locked) return;
                        const target = event.currentTarget as HTMLInputElement;
                        props.onToggle(item().id, target.checked);
                      }}
                    />
                    <Show when={item().locked}>
                      <Tooltip label="Always visible — this column identifies the row" position="left">
                        <span aria-hidden="true" class="text-[10px] text-fin-text-muted">locked</span>
                      </Tooltip>
                    </Show>
                  </li>
                );
              }}</Index>
            </ul>
          </div>
        </Portal>
      </Show>
    </span>
  );
}
