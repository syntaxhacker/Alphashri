import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import type { CanvasSize } from "../../components/window/layout";
import { parseLayout, serializeLayout } from "../../components/window/layout";
import type { WindowLayout } from "../../components/window/types";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  createSavedConfigStore,
  registerSavedConfigScope,
  type SavedConfigScope,
  type SavedConfigStatus,
  type SavedConfigStore,
  type SavedConfigTransport,
} from "../../state/savedConfig";
import { isRecord } from "../../utils/isRecord";
import { REPORT_WINDOW_TYPES } from "./reportWindowPanels";
import { reportPresetLayout, REPORT_PRESET_CANVAS } from "./reportWindowPresets";
import {
  DEFAULT_REPORT_CONTEXT,
  REPORT_WINDOW_SCOPE,
  REPORT_WINDOW_VERSION,
  type ReportWindowContext,
} from "./reportWindowTypes";

/** Last canvas reported by WindowManager; defaults are seeded from the real box. */
let reportCanvas: CanvasSize | undefined;

export function defaultReportLayout(canvas?: CanvasSize): WindowLayout {
  return { name: "Main", windows: reportPresetLayout("desk", canvas ?? REPORT_PRESET_CANVAS) };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

const SETTINGS_MAX_BYTES = 2048;
const SETTINGS_MAX_DEPTH = 6;
const SETTINGS_MAX_KEYS = 48;

/** Saved config is untrusted: only JSON scalars, arrays and plain objects survive. */
function jsonSafe(value: unknown, depth: number): unknown {
  if (depth > SETTINGS_MAX_DEPTH) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, SETTINGS_MAX_KEYS)
      .map((item) => jsonSafe(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const key of Object.keys(value)) {
      if (kept >= SETTINGS_MAX_KEYS) break;
      const safe = jsonSafe(value[key], depth + 1);
      if (safe !== undefined) {
        out[key] = safe;
        kept += 1;
      }
    }
    return out;
  }
  return undefined;
}

export function sanitizeReportSettings(raw: unknown): Record<string, unknown> | undefined {
  const safe = jsonSafe(raw, 0);
  if (!isPlainObject(safe)) return undefined;
  try {
    return JSON.stringify(safe).length <= SETTINGS_MAX_BYTES ? safe : undefined;
  } catch {
    return undefined;
  }
}

const cloneLayout = (layout: WindowLayout): WindowLayout => ({
  ...layout,
  windows: layout.windows.map((window) => ({ ...window })),
});

/** `serializeLayout` owns geometry/wire version; re-inject each sanitized bag. */
export function serializeReportLayout(layout: WindowLayout): Record<string, unknown> {
  const wire = JSON.parse(serializeLayout(layout)) as {
    windows: Record<string, unknown>[];
    [key: string]: unknown;
  };
  wire.windows = wire.windows.map((entry, index) => {
    const bag = sanitizeReportSettings(layout.windows[index]?.settings);
    return bag ? { ...entry, settings: bag } : entry;
  });
  return wire;
}

/**
 * Untrusted input never throws: unknown types and duplicate ids are dropped by
 * `parseLayout`, rects are clamped to the canvas, and settings are sanitized.
 * An empty `windows` array stays a valid (empty-desk) layout.
 */
export function normalizeReportLayout(
  raw: unknown,
  canvas?: CanvasSize,
): WindowLayout | null {
  let data: unknown = raw;
  if (typeof data === "string") {
    if (data.trim().length === 0) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!isRecord(data) || !Array.isArray(data.windows)) return null;

  const bags = new Map<string, Record<string, unknown>>();
  for (const entry of data.windows) {
    if (!isRecord(entry) || typeof entry.id !== "string" || bags.has(entry.id)) continue;
    const bag = sanitizeReportSettings(entry.settings);
    if (bag) bags.set(entry.id, bag);
  }

  const name = typeof data.name === "string" && data.name.trim().length > 0
    ? data.name.trim()
    : undefined;
  const parsed = parseLayout(
    { windows: data.windows, name },
    new Set(REPORT_WINDOW_TYPES),
    canvas ?? REPORT_PRESET_CANVAS,
  );
  if (!parsed) return null;
  const windows = parsed.windows.map((win) => {
    const bag = bags.get(win.id);
    return bag ? { ...win, settings: bag } : win;
  });
  return { windows, ...(parsed.name ? { name: parsed.name } : {}) };
}

function reportWindowScope(): SavedConfigScope<WindowLayout> {
  return {
    scope: REPORT_WINDOW_SCOPE,
    version: REPORT_WINDOW_VERSION,
    defaults: () => defaultReportLayout(reportCanvas),
    parse: (raw) => normalizeReportLayout(raw, reportCanvas),
    serialize: (value) => serializeReportLayout(value),
  };
}

interface StoreEntry {
  store: SavedConfigStore<WindowLayout>;
  refs: number;
}

const stores = new Map<string, StoreEntry>();

export interface UseReportWindowConfigResult {
  layout: Accessor<WindowLayout>;
  setLayout: (next: WindowLayout) => void;
  context: Accessor<ReportWindowContext>;
  setContext: (next: ReportWindowContext) => void;
  canvas: Accessor<CanvasSize | undefined>;
  setCanvas: (size: CanvasSize) => void;
  hydrated: Accessor<boolean>;
  status: Accessor<SavedConfigStatus>;
}

/** Ref-counted, scope-per-page clone of the home desk's saved-config pattern. */
export function useReportWindowConfig(
  deps: { transport?: SavedConfigTransport; context?: ReportWindowContext } = {},
): UseReportWindowConfigResult {
  let entry = stores.get(REPORT_WINDOW_SCOPE);
  if (!entry) {
    const scope = registerSavedConfigScope(reportWindowScope());
    entry = { store: createSavedConfigStore(scope, deps), refs: 0 };
    stores.set(REPORT_WINDOW_SCOPE, entry);
  }
  const { store } = entry;
  entry.refs += 1;

  const version = useStoreSubscription(store.subscribe);
  const [context, setContext] = createSignal<ReportWindowContext>(
    deps.context ?? DEFAULT_REPORT_CONTEXT,
  );
  const [canvas, setCanvasSignal] = createSignal<CanvasSize | undefined>(reportCanvas);
  const setCanvas = (size: CanvasSize) => {
    reportCanvas = size;
    setCanvasSignal(size);
  };

  const read = () => {
    version();
    return store.getState();
  };
  const layout = createMemo(() => read().value ?? defaultReportLayout(reportCanvas));

  onMount(() => store.hydrate());
  onCleanup(() => {
    const current = stores.get(REPORT_WINDOW_SCOPE);
    if (!current || current.store !== store) return;
    current.refs -= 1;
    if (current.refs <= 0) {
      store.dispose();
      stores.delete(REPORT_WINDOW_SCOPE);
    }
  });

  return {
    layout,
    setLayout: (next) => store.scheduleSave(cloneLayout(next)),
    context,
    setContext,
    canvas,
    setCanvas,
    hydrated: () => read().hydrated,
    status: () => read().status,
  };
}
