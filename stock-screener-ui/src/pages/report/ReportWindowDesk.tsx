import { createMemo, For, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { Box, Text, useMediaQuery } from "@/ui";
import type { DockPanelApi, DockPanelContext, DockPanelSpec } from "../../components/dock/types";
import type { CanvasSize } from "../../components/window/layout";
import { WindowManager } from "../../components/window/WindowManager";
import type { WindowLayout, WindowState } from "../../components/window/types";
import { REPORT_WINDOW_PANELS } from "./reportWindowPanels";
import {
  DEFAULT_REPORT_CONTEXT,
  REPORT_PANEL_TITLES,
  REPORT_WINDOW_KEYS,
  type ReportWindowContext,
  type ReportWindowKey,
} from "./reportWindowTypes";

/**
 * Four of the six report panels read `useNiftyReport()` from Solid context, so
 * they cannot be mounted by a bare dock spec. Their lazy fallback paints an
 * empty state that names the dependency instead of throwing, and the shell
 * hands the live store through `ReportWindowContext.reportStore`.
 */
function ReportPanelBody(props: {
  panel: ReportWindowKey;
  title: string;
  ctx: Accessor<DockPanelContext>;
}) {
  const connected = () => Boolean((props.ctx() as ReportWindowContext).reportStore);
  return (
    <Box
      data-testid={`report-panel-${props.panel}`}
      data-state={connected() ? "live" : "empty"}
      className="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-3"
    >
      <Text size="xs" fw={700}>
        {props.title}
      </Text>
      <Text size="xs" c="dimmed">
        {connected()
          ? "Report store connected — the report shell owns this panel's full content."
          : "Report store not connected — pass it through the desk context."}
      </Text>
    </Box>
  );
}

/** Resolved by `lazyPanelSpec` on first mount; metadata lives in the registry. */
export const REPORT_PANEL_FALLBACKS: Record<ReportWindowKey, DockPanelSpec> =
  REPORT_WINDOW_KEYS.reduce((acc, key) => {
    acc[key] = {
      id: key,
      page: "report",
      title: REPORT_PANEL_TITLES[key],
      size: 1,
      minWidth: 320,
      singleton: true,
      requires: [],
      mount: (ctx: Accessor<DockPanelContext>) => (
        <ReportPanelBody panel={key} title={REPORT_PANEL_TITLES[key]} ctx={ctx} />
      ),
    };
    return acc;
  }, {} as Record<ReportWindowKey, DockPanelSpec>);

export interface ReportWindowDeskProps {
  layout: WindowLayout;
  onLayoutChange: (next: WindowLayout) => void;
  /** Live report store reaches store-dependent panels through this bag. */
  context?: Accessor<ReportWindowContext>;
  canvas?: CanvasSize;
  onCanvasChange?: (size: CanvasSize) => void;
  /** Defaults to the report-specific six-panel registry. */
  specs?: DockPanelSpec[];
  lockedInitially?: boolean;
  settingsSlot?: (win: WindowState) => JSX.Element;
}

/** Below this the coordinate canvas cannot host a legible 480px-min frame. */
const NARROW_QUERY = "(max-width: 619px)";
/** Bounded tile body. The stack root is the only vertical scroll owner. */
const STACK_BODY_HEIGHT_PX = 280;

/**
 * Same shape as the frame's `api`: a panel may read `commands.onExpand` and a
 * settings bag, but the stack host owns no per-window data or persisted patch.
 * Every member is deliberately inert rather than fabricated from layout state.
 */
const STACK_PANEL_API: DockPanelApi = {
  data: () => undefined,
  commands: {},
  settings: () => ({}),
  onSettingsChange: () => {},
};

/**
 * A phone-width tile: the registered spec is mounted unchanged, so the real
 * panel renders with the live store from context. Only the drag/resize chrome
 * is gone — a header carries the title and the body is bounded so the desk's
 * single scroll owner can move between panels without clipping any of them.
 */
function StackTile(props: {
  win: WindowState;
  ctx: Accessor<DockPanelContext>;
  spec?: DockPanelSpec;
  settingsSlot?: (win: WindowState) => JSX.Element;
}) {
  const spec = createMemo(() => props.spec);
  return (
    <section
      data-testid={`report-stack-tile-${props.win.id}`}
      role="region"
      aria-label={props.win.title}
      class="flex w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-sm border border-fin-border bg-fin-surface"
      style={{ width: "100%", "max-width": "100%" }}
    >
      <header
        data-testid={`report-stack-header-${props.win.id}`}
        class="flex h-7 shrink-0 items-center gap-2 border-b border-fin-border bg-fin-surface-alt px-2"
      >
        <Text size="xs" fw={700} className="min-w-0 truncate uppercase tracking-wide">
          {props.win.title}
        </Text>
        <Show when={props.settingsSlot}>
          <span data-testid={`report-stack-settings-${props.win.id}`}>
            {props.settingsSlot?.(props.win)}
          </span>
        </Show>
      </header>
      <div
        data-testid={`report-stack-body-${props.win.id}`}
        class="flex min-h-0 min-w-0 w-full shrink-0 flex-col overflow-hidden"
        style={{ height: `${STACK_BODY_HEIGHT_PX}px` }}
      >
        <Show
          when={spec()}
          fallback={
            <div class="flex h-full items-center justify-center p-2">
              <Text size="xs" c="dimmed">
                Unknown panel: {props.win.type}
              </Text>
            </div>
          }
        >
          {(active) => active().mount(props.ctx, STACK_PANEL_API)}
        </Show>
      </div>
    </section>
  );
}

/**
 * Thin adapter over the homepage window engine: same canvas, same frame, same
 * keyboard parity. Below 620px the same specs mount into a single-column stack
 * instead — one scroll owner, full-width tiles, no second window engine. The
 * only report-specific addition is the empty state — the shared WindowManager
 * renders no placeholder when `windows` is empty.
 */
export function ReportWindowDesk(props: ReportWindowDeskProps): JSX.Element {
  const context: Accessor<DockPanelContext> = () =>
    (props.context?.() ?? DEFAULT_REPORT_CONTEXT) as DockPanelContext;
  const empty = () => props.layout.windows.length === 0;
  const narrow = useMediaQuery(NARROW_QUERY, false);
  const byType = createMemo(
    () => new Map((props.specs ?? REPORT_WINDOW_PANELS).map((spec) => [spec.id, spec])),
  );

  return (
    <Box
      data-testid="report-window-desk"
      data-mode={narrow() ? "stack" : "window"}
      className={
        narrow()
          ? "relative flex h-full min-h-0 w-full flex-col gap-2 overflow-x-hidden overflow-y-auto p-2"
          : "relative flex h-full min-h-0 w-full flex-col"
      }
    >
      <Show
        when={narrow()}
        fallback={
          <WindowManager
            layout={props.layout}
            context={context}
            onLayoutChange={props.onLayoutChange}
            onCanvasChange={props.onCanvasChange}
            canvas={props.canvas}
            specs={props.specs ?? REPORT_WINDOW_PANELS}
            lockedInitially={props.lockedInitially}
            settingsSlot={props.settingsSlot}
          />
        }
      >
        <For each={props.layout.windows}>
          {(win) => (
            <StackTile
              win={win}
              ctx={context}
              spec={byType().get(win.type)}
              settingsSlot={props.settingsSlot}
            />
          )}
        </For>
      </Show>
      <Show when={empty()}>
        <div
          data-testid="report-window-empty"
          role="status"
          className="pointer-events-none absolute inset-x-2 bottom-2 top-10 flex items-center justify-center"
        >
          <Text size="xs" c="dimmed">
            No report windows open. Add a panel from the report picker.
          </Text>
        </div>
      </Show>
    </Box>
  );
}
