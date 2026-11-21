import { createMemo, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { ActionIcon, Box, Text, useMediaQuery } from "@/ui";
import { IconX } from "@/components/common/Icons";
import { DockSection } from "@/components/options-dock/DockSection";
import { clampSize, MIN_PANE_SIZE } from "./layout";
import type { DockLayout, DockPanelContext, DockPanelSpec } from "./types";

const DEFAULT_BREAKPOINT_PX = 1200;
const KEYBOARD_RESIZE_STEP = 0.1;

export interface DockHostProps<D extends object = Record<string, unknown>> {
  specs: DockPanelSpec<D>[];
  layout: DockLayout;
  context: Accessor<DockPanelContext>;
  onLayoutChange: (next: DockLayout) => void;
  /** Override the media query for embedded hosts/tests. `true` = stacked. */
  stacked?: boolean;
  breakpointPx?: number;
}

const between = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

function DockEmpty<D extends object>(props: {
  spec: DockPanelSpec<D>;
  missing: (keyof DockPanelContext)[];
}) {
  return (
    <Box
      data-testid={`dock-empty-${props.spec.id}`}
      className="flex h-full min-h-0 items-center justify-center p-2"
    >
      <Text size="xs" c="dimmed">
        {props.spec.title} needs {props.missing.join(", ")}
      </Text>
    </Box>
  );
}

/**
 * Generic split-pane host. Space is distributed by `size` (flex-grow, basis 0),
 * never by fixed heights, so a pane fills its flex parent and the host can
 * reproduce a 1 : 0.42 split exactly. The 1200px breakpoint drops the splitters
 * and stacks the panes instead of exposing a drag surface on touch screens.
 */
export function DockHost<D extends object = Record<string, unknown>>(
  props: DockHostProps<D>,
) {
  const wide = useMediaQuery(`(min-width: ${props.breakpointPx ?? DEFAULT_BREAKPOINT_PX}px)`, false);
  const stacked = () => props.stacked ?? !wide();

  const byId = createMemo(() => new Map(props.specs.map((spec) => [spec.id, spec])));
  const visible = createMemo(() =>
    props.layout.panes
      .map((pane) => ({ ...pane, spec: byId().get(pane.id) }))
      .filter(
        (pane): pane is {
        id: string;
        size: number;
        maxWidth?: number;
        spec: DockPanelSpec<D>;
      } =>
          pane.spec != null,
      ),
  );

  let drag: { index: number; startX: number; width: number; total: number; left: number } | null = null;

  const emitSizes = (index: number, leftSize: number, rightSize: number) => {
    const panes = props.layout.panes.map((pane, i) =>
      i === index
        ? { ...pane, size: leftSize }
        : i === index + 1
          ? { ...pane, size: rightSize }
          : { ...pane },
    );
    props.onLayoutChange({ panes, hidden: [...props.layout.hidden] });
  };

  const onPointerDown = (event: PointerEvent, index: number) => {
    if (stacked()) return;
    const left = props.layout.panes[index];
    const right = props.layout.panes[index + 1];
    if (!left || !right) return;
    drag = {
      index,
      startX: event.clientX,
      width: (event.currentTarget as HTMLElement).parentElement?.clientWidth || 1,
      total: left.size + right.size,
      left: left.size,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || stacked()) return;
    const delta = ((event.clientX - drag.startX) / drag.width) * drag.total;
    const nextLeft = between(drag.left + delta, MIN_PANE_SIZE, drag.total - MIN_PANE_SIZE);
    emitSizes(drag.index, round(nextLeft), round(drag.total - nextLeft));
  };

  const endDrag = () => {
    drag = null;
  };

  // Every pointer gesture has a keyboard equivalent: Alt+←/→ on the separator.
  const onHandleKeyDown = (event: KeyboardEvent, index: number) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const left = props.layout.panes[index];
    const right = props.layout.panes[index + 1];
    if (!left || !right) return;
    event.preventDefault();
    const total = left.size + right.size;
    const step = event.key === "ArrowRight" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
    const nextLeft = between(left.size + step, MIN_PANE_SIZE, total - MIN_PANE_SIZE);
    emitSizes(index, round(nextLeft), round(total - nextLeft));
  };

  const detach = (id: string) => {
    props.onLayoutChange({
      panes: props.layout.panes.filter((pane) => pane.id !== id).map((pane) => ({ ...pane })),
      hidden: props.layout.hidden.includes(id)
        ? [...props.layout.hidden]
        : [...props.layout.hidden, id],
    });
  };

  const restore = (id: string) => {
    const spec = byId().get(id);
    if (!spec) return;
    props.onLayoutChange({
      panes: [...props.layout.panes.map((pane) => ({ ...pane })), { id, size: clampSize(spec.size) }],
      hidden: props.layout.hidden.filter((hiddenId) => hiddenId !== id),
    });
  };

  const missingKeys = (spec: DockPanelSpec<D>) => {
    const ctx = props.context();
    return spec.requires.filter((key) => {
      const value = ctx[key];
      return value == null || (typeof value === "string" && value.trim().length === 0);
    });
  };

  const paneStyle = (size: number, minWidth: number, maxWidth?: number): Record<string, string> =>
    stacked()
      ? {
          "flex-grow": "0",
          "flex-shrink": "0",
          "flex-basis": "auto",
          "width": "100%",
          "min-width": "0px",
          "min-height": "0px",
        }
      : {
          "flex-grow": String(size),
          "flex-shrink": "1",
          "flex-basis": "0%",
          "min-width": `${minWidth}px`,
          // Width ceiling only — never a fixed height inside a flex row.
          ...(maxWidth == null ? {} : { "max-width": `${maxWidth}px` }),
          "min-height": "0px",
        };

  return (
    <Box
      data-testid="dock-host"
      className={`flex min-w-0 min-h-0 ${stacked() ? "flex-col" : "flex-row"}`}
    >
      <For each={visible()}>
        {(pane, index) => {
          // Evaluating `data` inside a memo is what keeps a docked panel live:
          // every signal/store read in the adapter becomes a dependency here.
          const data = createMemo(() => pane.spec.data?.(props.context));
          const api = { data, commands: pane.spec.commands ?? {} };
          const ceiling = () => pane.maxWidth ?? pane.spec.maxWidth;
          return (
          <>
            <Show when={index() > 0 && !stacked()}>
              <div
                data-resize-handle=""
                data-testid={`dock-handle-${index() - 1}`}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${pane.spec.title} pane`}
                tabindex="0"
                class="flex w-1 shrink-0 cursor-col-resize items-stretch justify-center border-l border-fin-border"
                onPointerDown={(event) => onPointerDown(event, index() - 1)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(event) => onHandleKeyDown(event, index() - 1)}
              />
            </Show>

            <Box
              data-dock-pane=""
              data-testid={`dock-pane-${pane.id}`}
              data-pane-id={pane.id}
              data-pane-size={pane.size}
              className="flex min-w-0 min-h-0 flex-col"
              style={paneStyle(pane.size, pane.spec.minWidth, ceiling())}
            >
              <DockSection
                title={pane.spec.title}
                headerTestId={`dock-pane-header-${pane.id}`}
                meta={
                  <ActionIcon
                    size="small"
                    aria-label={`Detach ${pane.spec.title}`}
                    data-testid={`dock-detach-${pane.id}`}
                    onClick={() => detach(pane.id)}
                    className="p-[2px] rounded-sm"
                  >
                    <IconX size={12} />
                  </ActionIcon>
                }
                fill
                padded={false}
                separated={false}
              >
                <Show
                  when={missingKeys(pane.spec).length === 0}
                  fallback={<DockEmpty spec={pane.spec} missing={missingKeys(pane.spec)} />}
                >
                  {pane.spec.mount(props.context, api)}
                </Show>
              </DockSection>
            </Box>
          </>
          );
        }}
      </For>

      <Show when={props.layout.hidden.length > 0}>
        <div
          data-testid="dock-hidden-panels"
          class="flex shrink-0 items-center gap-1 border-t border-fin-border px-2 py-1"
        >
          <For each={props.layout.hidden}>
            {(id) => (
              <Show when={byId().get(id)}>
                {(spec) => (
                  <button
                    type="button"
                    data-testid={`dock-restore-${id}`}
                    aria-label={`Restore ${spec().title}`}
                    onClick={() => restore(id)}
                    class="rounded-sm border border-fin-border bg-fin-surface-alt px-1"
                  >
                    <Text size="xs" c="dimmed">
                      {spec().title}
                    </Text>
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
      </Show>
    </Box>
  );
}
