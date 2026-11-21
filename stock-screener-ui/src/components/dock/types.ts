import type { Accessor, JSX } from "solid-js";

export type DockPage = "patterns" | "screener" | "sector" | "report";

/** Everything a panel is allowed to know about the outside world. No signals, no stores. */
export interface DockPanelContext {
  symbol?: string;
  market?: string;
  expiry?: string;
  timeframe?: string;
}

/** Write side: actions a page adapter lets a docked panel fire. Always optional. */
export interface DockPanelCommands {
  onTimeframeChange?: (tf: string) => void;
  onSizeChange?: (size: string) => void;
  onExpand?: () => void;
  onFilterChange?: (patch: Record<string, unknown>) => void;
}

/** The surface the host hands to `mount` alongside the context accessor. */
export interface DockPanelApi<D extends object = Record<string, unknown>> {
  /**
   * Reactive view of the panel's data. The host evaluates `spec.data` inside a
   * memo, so a panel that calls `data()` in its JSX re-renders on source change.
   */
  data: Accessor<D | undefined>;
  /** Empty object when the page supplied no commands — never assume one exists. */
  commands: DockPanelCommands;
  /**
   * Read side of the persisted settings channel: this window's own settings
   * bag. The window manager supplies a reactive accessor so a late hydration
   * or a tab switch can re-seed a panel that is already mounted. A host that
   * does not persist settings supplies an empty accessor; never assume keys.
   */
  settings?: Accessor<Record<string, unknown>>;
  /**
   * Write side of the same channel. A panel reports a partial patch; the host
   * merges it into this window's bag and saves through its existing debounced
   * layout path. No second timer lives in the panel.
   */
  onSettingsChange?: (patch: Record<string, unknown>) => void;
}

export interface DockPanelSpec<D extends object = Record<string, unknown>> {
  id: string;                 // "report.chart", "sector.rotation" — dotted, page-scoped
  page: DockPage;
  title: string;
  /** flex-basis weight; the host distributes space proportionally. */
  size: number;
  /** px floor below which the pane stops shrinking. */
  minWidth: number;
  /** Ceiling as well as floor, so a side column can be minmax(0,420px). */
  maxWidth?: number;
  /** only one instance may exist at a time. */
  singleton: boolean;
  /** Context keys this panel cannot render without. */
  requires: (keyof DockPanelContext)[];
  /** Read side: the panel's data, injected by the host/page adapter. */
  data?: (ctx: Accessor<DockPanelContext>) => D;
  /** Write side: actions the panel may fire. Provided by the page adapter. */
  commands?: DockPanelCommands;
  mount: (ctx: Accessor<DockPanelContext>, api: DockPanelApi<D>) => JSX.Element;

  // --- DeskDockTab compatibility -------------------------------------------
  // `title` is the `label`; `summary`/`badge` are carried verbatim so a host
  // that wants a DeskDock-style tab bar can render one from a spec alone.
  // `DeskDockTab.content` is replaced by `mount(ctx)`: a dock panel is
  // context-driven, never a captured page-local JSX node. `DeskDockTab.height`
  // is deliberately NOT carried — LAYOUT_INVARIANTS forbids fixed pixel
  // heights inside a flex column; `size` governs space instead.
  summary?: JSX.Element;
  badge?: number;
}

export interface DockLayout {
  panes: { id: string; size: number; maxWidth?: number }[];
  hidden: string[];
}
