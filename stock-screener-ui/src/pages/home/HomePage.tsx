import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Accessor,
} from "solid-js";
import { Box, Menu, MenuDropdown, MenuItem, MenuTarget, Select, Text, ToolbarRow } from "@/ui";
import { HomeMonitorView } from "../../components/home/HomeMonitorView";
import { SessionPulseBar } from "../../components/home/SessionPulseBar";
import type { DockPanelContext } from "../../components/dock/types";
import type { CanvasSize } from "../../components/window/layout";
import { fitAllToScreen } from "../../components/window/layout";
import { WindowManager } from "../../components/window/WindowManager";
import type { WindowLayout, WindowState } from "../../components/window/types";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { useSectionsConfig } from "../../state/sections/config";
import {
  createSavedConfigStore,
  registerSavedConfigScope,
  type SavedConfigScope,
  type SavedConfigStatus,
  type SavedConfigStore,
  type SavedConfigTransport,
} from "../../state/savedConfig";
import {
  applyPreset,
  createWindowFor,
  defaultHomeConfig,
  HOME_PANEL_CONTEXT,
  HOME_PANELS,
  HOME_WINDOW_SCOPE,
  HOME_WINDOW_VERSION,
  isDefaultHomeSeed,
  nextScreenName,
  normalizeHomeConfig,
  PAGE_LABEL,
  PAGE_ORDER,
  PRESETS,
  serializeHomeConfig,
  type HomeWindowConfig,
} from "./homePanels";
import {
  createSectionWindow,
  ensureSectionTombstones,
  isSectionPanelId,
  syncSectionPanels,
  type SectionPanelSync,
} from "./homeSectionPanels";

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

type HomeView = "monitor" | "desk";

/** Last canvas reported by WindowManager; the store reads it when hydration settles. */
let homeCanvas: CanvasSize | undefined;

function homeWindowScope(): SavedConfigScope<HomeWindowConfig> {
  return {
    scope: HOME_WINDOW_SCOPE,
    version: HOME_WINDOW_VERSION,
    defaults: () => defaultHomeConfig(homeCanvas),
    parse: (raw) => normalizeHomeConfig(raw),
    serialize: (value) => serializeHomeConfig(value),
  };
}

interface StoreEntry {
  store: SavedConfigStore<HomeWindowConfig>;
  refs: number;
}

const stores = new Map<string, StoreEntry>();

export interface UseHomeWindowConfigResult {
  config: Accessor<HomeWindowConfig>;
  setConfig: (next: HomeWindowConfig) => void;
  hydrated: Accessor<boolean>;
  status: Accessor<SavedConfigStatus>;
}

/** Ref-counted, scope-per-page clone of the useTablePrefs persistence pattern. */
export function useHomeWindowConfig(
  deps: { transport?: SavedConfigTransport } = {},
): UseHomeWindowConfigResult {
  let entry = stores.get(HOME_WINDOW_SCOPE);
  if (!entry) {
    const scope = registerSavedConfigScope(homeWindowScope());
    entry = { store: createSavedConfigStore(scope, deps), refs: 0 };
    stores.set(HOME_WINDOW_SCOPE, entry);
  }
  const { store } = entry;
  entry.refs += 1;

  const version = useStoreSubscription(store.subscribe);
  const read = () => {
    version();
    return store.getState();
  };

  onMount(() => store.hydrate());
  onCleanup(() => {
    const current = stores.get(HOME_WINDOW_SCOPE);
    if (!current || current.store !== store) return;
    current.refs -= 1;
    if (current.refs <= 0) {
      store.dispose();
      stores.delete(HOME_WINDOW_SCOPE);
    }
  });

  return {
    config: () => read().value ?? defaultHomeConfig(homeCanvas),
    setConfig: (next) =>
      store.scheduleSave({
        layouts: next.layouts.map((layout) => ({
          ...layout,
          windows: layout.windows.map((w) => ({ ...w })),
        })),
        active: next.active,
      }),
    hydrated: () => read().hydrated,
    status: () => read().status,
  };
}

export interface HomePageProps {
  /** Transport seam for tests; the route uses the store's default transport. */
  transport?: SavedConfigTransport;
  /** Overrides the measured canvas in embedded hosts/tests. */
  canvas?: CanvasSize;
}

/**
 * A named-workspace desktop. Each tab owns its own absolute window layout; the
 * picker drops new windows at a cascade offset so they never appear stacked
 * exactly on top of one another. One fixed context reaches every panel; the
 * chrome never asks the user to type data a workspace cannot supply.
 */
export function HomePage(props: HomePageProps) {
  const { config, setConfig, hydrated } = useHomeWindowConfig({ transport: props.transport });
  const { config: sectionsConfig } = useSectionsConfig();
  // Sync before hydration settles: normalizeHomeConfig reads the live registry,
  // so a saved layout pinning a section must survive its first parse.
  const [sectionPanels, setSectionPanels] = createSignal<SectionPanelSync>(
    syncSectionPanels(sectionsConfig().sections),
  );
  createEffect(() => {
    setSectionPanels(syncSectionPanels(sectionsConfig().sections));
  });
  createEffect(() => {
    const pinned = config().layouts
      .flatMap((layout) => layout.windows)
      .filter((window) => isSectionPanelId(window.type))
      .map((window) => ({ type: window.type, title: window.title }));
    const added = ensureSectionTombstones(pinned);
    if (added.length > 0) {
      setSectionPanels((prev) => ({ ...prev, tombstones: [...prev.tombstones, ...added] }));
    }
  });
  const context: Accessor<DockPanelContext> = () => HOME_PANEL_CONTEXT;
  const [pickerValue, setPickerValue] = createSignal("");
  const [view, setView] = createSignal<HomeView>("monitor");
  const [canvasSize, setCanvasSize] = createSignal<CanvasSize | undefined>(props.canvas);
  const [liveMessage, setLiveMessage] = createSignal("");
  const [presetOpen, setPresetOpen] = createSignal(false);
  const [presetTrigger, setPresetTrigger] = createSignal<HTMLButtonElement>();
  const announce = (message: string) => setLiveMessage(message);
  homeCanvas = props.canvas;
  // Read once per view change, not once per JSX expression that needs the mode.
  const isDesk = createMemo(() => view() === "desk");

  // The store normally seeds after the canvas is measured. If hydration beat
  // that measurement, replace the conservative seed once — never a saved desk.
  // Monitor never owns a desk, so it must not write a saved layout either.
  let reseeded = false;
  createEffect(() => {
    if (!isDesk() || reseeded || !hydrated() || !canvasSize()) return;
    if (!isDefaultHomeSeed(config())) return;
    reseeded = true;
    setConfig(defaultHomeConfig(canvasSize()));
  });

  /*
   * Re-fit every tab when the canvas shrinks. Windows are stored in canvas
   * pixels, so a desk arranged at 1600 keeps 583px-wide windows when the
   * viewport drops to 390 — they hang far outside the canvas and cannot be
   * grabbed back with the mouse. Only shrinking re-fits: growing leaves the
   * user's arrangement alone rather than re-flowing a desk they just tuned.
   */
  let lastCanvas = { w: 0, h: 0 };
  createEffect(() => {
    const size = canvasSize();
    if (!size || !hydrated()) return;
    const previous = lastCanvas;
    lastCanvas = { w: size.w, h: size.h };
    // Monitor renders a fixed grid, not a canvas: tracking is read-only here.
    if (!isDesk()) return;
    /*
     * Re-fit only when the canvas actually shrinks under an existing desk. A
     * first measure is deliberately excluded: the saved layout was authored
     * for some canvas and is honoured as written, and the seed is already
     * built from the measured size. Re-fitting on first paint would rewrite
     * every restored rect and break "the layout survives a reload".
     */
    if (previous.w === 0 || size.w >= previous.w) return;
    const current = config();
    /*
     * Below this width a preserved relative arrangement is unusable: a
     * two-column desk scales to overlapping 215px windows stacked on top of
     * each other (see the 390px screenshot), because there is no room left
     * for the original spacing. Tile to a single column instead so every
     * window is visible and reachable.
     */
    const NARROW_TILE_W = 620;
    const tileVertical = (windows: WindowState[]): WindowState[] => {
      if (windows.length === 0) return [];
      const gap = 8;
      const n = windows.length;
      const availH = Math.max(1, size.h - gap * (n + 1));
      const slotH = Math.max(90, Math.floor(availH / n));
      return windows.map((window, index) => ({
        ...window,
        w: Math.max(1, size.w - gap * 2),
        h: Math.min(slotH, Math.max(90, size.h - gap * 2)),
        x: gap,
        y: gap + index * (slotH + gap),
        z: index + 1,
      }));
    };
    const fitLayout = (windows: WindowState[]): WindowState[] =>
      size.w < NARROW_TILE_W
        ? tileVertical(windows)
        : fitAllToScreen(windows, size).map((window) => {
            const w = Math.min(window.w, size.w);
            const h = Math.min(window.h, size.h);
            return {
              ...window,
              w,
              h,
              x: Math.max(0, Math.min(window.x, Math.max(0, size.w - w))),
              y: Math.max(0, Math.min(window.y, Math.max(0, size.h - h))),
            };
          });
    setConfig({
      layouts: current.layouts.map((layout) => ({
        ...layout,
        windows: fitLayout(layout.windows),
      })),
      active: current.active,
    });
  });

  // Panel data ticks replace config(); without a memo every one of the
  // consumers below (props getters and handlers alike) re-runs this find.
  const activeLayout: Accessor<WindowLayout> = createMemo(() => {
    const current = config();
    return (
      current.layouts.find((layout) => layout.name === current.active) ??
      current.layouts[0] ?? { name: "Main", windows: [] }
    );
  });

  // WindowManager reuses frames by index. Switching tabs or hydrating a saved
  // desk can put a different panel at the same index, so rebuild on structural
  // changes; rect edits stay keyed and keep their frames.
  const deskKey = createMemo(() => {
    if (!isDesk()) return false;
    const layout = activeLayout();
    const sectionIds = [...sectionPanels().live, ...sectionPanels().tombstones]
      .map((spec) => spec.id)
      .join(",");
    return `${layout.name}|${layout.windows.map((window) => window.type).join(",")}|${sectionIds}`;
  });

  const setActiveWindows = (windows: WindowState[]) =>
    setConfig({
      ...config(),
      layouts: config().layouts.map((layout) =>
        layout.name === activeLayout().name ? { ...layout, windows } : { ...layout },
      ),
    });

  // Pure derivation over module constants: computed on first read and reused.
  // The Select prop getter is read by several of its own computations, so an
  // unmemoised function sorted and mapped the panel list several times per mount.
  const pickerOptions = createMemo(() =>
    [...HOME_PANELS, ...sectionPanels().live]
      .sort((a, b) => PAGE_ORDER.indexOf(a.page) - PAGE_ORDER.indexOf(b.page))
      .map((spec) => ({
        value: spec.id,
        label: spec.title,
        group: PAGE_LABEL[spec.page],
      })),
  );

  const addWindow = (id: string) => {
    if (!id) return;
    const windows = activeLayout().windows;
    const ordinal = windows.length + 1;
    const maxZ = windows.reduce((max, w) => Math.max(max, w.z), 0);
    let created = createWindowFor(id, ordinal, props.canvas, maxZ);
    if (!created && isSectionPanelId(id)) {
      created = createSectionWindow(
        id,
        ordinal,
        props.canvas ?? canvasSize() ?? { w: 1280, h: 800 },
        maxZ,
      );
    }
    if (!created) return;
    setActiveWindows([...windows.map((w) => ({ ...w })), created]);
    setPickerValue("");
    announce(`${created.title} window added`);
  };

  const switchTab = (name: string) => {
    setConfig({ ...config(), active: name });
    announce(`${name} layout selected`);
  };

  const newScreen = () => {
    const name = nextScreenName(config().layouts);
    setConfig({
      ...config(),
      layouts: [...config().layouts.map((layout) => ({ ...layout })), { name, windows: [] }],
      active: name,
    });
    announce(`${name} screen created`);
  };

  const applyPresetToDesk = (id: string) => {
    const preset = PRESETS.find((candidate) => candidate.id === id);
    if (!preset) return;
    setConfig(applyPreset(config(), preset, canvasSize() ?? props.canvas));
    announce(`${preset.label} preset applied`);
  };

  return (
    <Box data-testid="home-page" className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-4">
      <ToolbarRow data-testid="home-toolbar">
        <Text size="sm" fw={700}>
          HOME
        </Text>
        <div
          data-testid="home-view-toggle"
          role="group"
          aria-label="Home view"
          class="flex items-center gap-1"
        >
          <button
            type="button"
            data-testid="home-view-monitor"
            aria-pressed={!isDesk()}
            class={`rounded-sm border px-2 text-ui-micro ${
              !isDesk()
                ? "border-fin-primary bg-fin-surface-alt text-fin-text"
                : "border-fin-border text-fin-text-muted hover:bg-fin-surface-alt"
            }`}
            onClick={() => setView("monitor")}
          >
            Monitor
          </button>
          <button
            type="button"
            data-testid="home-view-desk"
            aria-pressed={isDesk()}
            class={`rounded-sm border px-2 text-ui-micro ${
              isDesk()
                ? "border-fin-primary bg-fin-surface-alt text-fin-text"
                : "border-fin-border text-fin-text-muted hover:bg-fin-surface-alt"
            }`}
            onClick={() => setView("desk")}
          >
            Desk
          </button>
        </div>
        <Show when={isDesk()}>
          <Select
            aria-label="Add window"
            data-testid="home-panel-picker"
            placeholder="Add a window…"
            size="sm"
            w={220}
            value={pickerValue()}
            data={pickerOptions()}
            onChange={(value) => addWindow(value ?? "")}
          />
        </Show>
      </ToolbarRow>

      <Show when={!isDesk()}>
        <SessionPulseBar />
      </Show>

      <Show when={isDesk()}>
        <ToolbarRow data-testid="home-layout-tabs">
          <div
            role="tablist"
            aria-label="Desk layouts"
            class="inline-flex flex-wrap items-center gap-2"
          >
            <For each={config().layouts}>
              {(layout) => (
                <button
                  type="button"
                  role="tab"
                  data-testid={`home-layout-tab-${slug(layout.name ?? "")}`}
                  aria-selected={config().active === layout.name}
                  class="rounded-sm border border-fin-border px-2 text-ui-micro text-fin-text hover:bg-fin-surface-alt aria-selected:border-fin-primary"
                  onClick={() => switchTab(layout.name ?? "Main")}
                >
                  {layout.name}
                </button>
              )}
            </For>
          </div>
          <Menu
            data-testid="home-presets-menu"
            opened={presetOpen()}
            onChange={(open) => {
              setPresetOpen(open);
              // The dropdown unmounts on close; without this, focus falls to <body>.
              if (!open) presetTrigger()?.focus();
            }}
          >
            <MenuTarget>
              <button
                ref={(el) => setPresetTrigger(el)}
                type="button"
                data-testid="home-preset-menu-trigger"
                aria-label="Layout presets"
                aria-expanded={presetOpen()}
                class="rounded-sm border border-fin-border px-2 text-ui-micro text-fin-text hover:bg-fin-surface-alt"
              >
                Presets
              </button>
            </MenuTarget>
            <MenuDropdown data-testid="home-preset-menu-dropdown">
              <For each={PRESETS}>
                {(preset) => (
                  <MenuItem
                    data-testid={`home-preset-${preset.id}`}
                    onClick={() => applyPresetToDesk(preset.id)}
                  >
                    {preset.label}
                  </MenuItem>
                )}
              </For>
            </MenuDropdown>
          </Menu>
          <button
            type="button"
            data-testid="home-new-screen"
            class="rounded-sm border border-fin-border px-2 text-ui-micro text-fin-text hover:bg-fin-surface-alt"
            onClick={newScreen}
          >
            + New screen
          </button>
        </ToolbarRow>
      </Show>

      <Show when={!isDesk()}>
        <HomeMonitorView />
      </Show>

      <Show when={deskKey()} keyed>
        <Box className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <WindowManager
            layout={activeLayout()}
            context={context}
            specs={[...HOME_PANELS, ...sectionPanels().live, ...sectionPanels().tombstones]}
            onLayoutChange={(next) => setActiveWindows(next.windows)}
            onCanvasChange={(size) => {
              if (canvasSize()?.w === size.w && canvasSize()?.h === size.h) return;
              homeCanvas = size;
              setCanvasSize(size);
            }}
            canvas={props.canvas}
          />
        </Box>
      </Show>

      <div data-testid="home-live" class="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage()}
      </div>
    </Box>
  );
}

export default HomePage;
