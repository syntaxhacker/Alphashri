import { createEffect, createSignal, For, onCleanup, onMount, type Accessor } from "solid-js";
import { Box, Menu, MenuDropdown, MenuItem, MenuTarget, Select, Text, ToolbarRow } from "@/ui";
import type { DockPanelContext } from "../../components/dock/types";
import type { CanvasSize } from "../../components/window/layout";
import { WindowManager } from "../../components/window/WindowManager";
import type { WindowLayout, WindowState } from "../../components/window/types";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
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

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
        layouts: next.layouts.map((layout) => ({ ...layout, windows: layout.windows.map((w) => ({ ...w })) })),
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
  const context: Accessor<DockPanelContext> = () => HOME_PANEL_CONTEXT;
  const [pickerValue, setPickerValue] = createSignal("");
  const [canvasSize, setCanvasSize] = createSignal<CanvasSize | undefined>(props.canvas);
  homeCanvas = props.canvas;

  // The store normally seeds after the canvas is measured. If hydration beat
  // that measurement, replace the conservative seed once — never a saved desk.
  let reseeded = false;
  createEffect(() => {
    if (reseeded || !hydrated() || !canvasSize()) return;
    if (!isDefaultHomeSeed(config())) return;
    reseeded = true;
    setConfig(defaultHomeConfig(canvasSize()));
  });

  const activeLayout = (): WindowLayout =>
    config().layouts.find((layout) => layout.name === config().active)
    ?? config().layouts[0]
    ?? { name: "Main", windows: [] };

  const setActiveWindows = (windows: WindowState[]) =>
    setConfig({
      ...config(),
      layouts: config().layouts.map((layout) =>
        layout.name === activeLayout().name ? { ...layout, windows } : { ...layout },
      ),
    });

  const pickerOptions = () =>
    [...HOME_PANELS]
      .sort((a, b) => PAGE_ORDER.indexOf(a.page) - PAGE_ORDER.indexOf(b.page))
      .map((spec) => ({
        value: spec.id,
        label: spec.title,
        group: PAGE_LABEL[spec.page],
      }));

  const addWindow = (id: string) => {
    if (!id) return;
    const windows = activeLayout().windows;
    const maxZ = windows.reduce((max, w) => Math.max(max, w.z), 0);
    const created = createWindowFor(id, windows.length + 1, props.canvas, maxZ);
    if (!created) return;
    setActiveWindows([...windows.map((w) => ({ ...w })), created]);
    setPickerValue("");
  };

  const switchTab = (name: string) =>
    setConfig({ ...config(), active: name });

  const newScreen = () => {
    const name = nextScreenName(config().layouts);
    setConfig({
      ...config(),
      layouts: [...config().layouts.map((layout) => ({ ...layout })), { name, windows: [] }],
      active: name,
    });
  };

  const applyPresetToDesk = (id: string) => {
    const preset = PRESETS.find((candidate) => candidate.id === id);
    if (!preset) return;
    setConfig(applyPreset(config(), preset, canvasSize() ?? props.canvas));
  };

  return (
    <Box data-testid="home-page" className="flex h-full min-h-0 flex-col gap-2 p-4">
      <ToolbarRow data-testid="home-toolbar">
        <Text size="sm" fw={700}>
          HOME
        </Text>
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
      </ToolbarRow>

      <ToolbarRow data-testid="home-layout-tabs">
        <For each={config().layouts}>
          {(layout) => (
            <button
              type="button"
              data-testid={`home-layout-tab-${slug(layout.name ?? "")}`}
              aria-selected={config().active === layout.name}
              class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt aria-selected:border-fin-primary"
              onClick={() => switchTab(layout.name ?? "Main")}
            >
              {layout.name}
            </button>
          )}
        </For>
        <Menu data-testid="home-presets-menu">
          <MenuTarget>
            <button
              type="button"
              data-testid="home-preset-menu-trigger"
              aria-label="Layout presets"
              class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
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
          class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
          onClick={newScreen}
        >
          + New screen
        </button>
      </ToolbarRow>

      <WindowManager
        layout={activeLayout()}
        context={context}
        onLayoutChange={(next) => setActiveWindows(next.windows)}
        onCanvasChange={(size) => {
          if (canvasSize()?.w === size.w && canvasSize()?.h === size.h) return;
          homeCanvas = size;
          setCanvasSize(size);
        }}
        canvas={props.canvas}
      />
    </Box>
  );
}

export default HomePage;
