import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import h from "solid-js/h";
import { Box, Text, ToolbarRow } from "@/ui";
import { fetchSectionScan, type SectionScanMarket } from "../../api/sections";
import { SectionTable, type SectionScanRow } from "../../components/market/SectionTable";
import type { DockPanelContext, DockPanelSpec } from "../../components/dock/types";
import { cascadeRect } from "../../components/window/layout";
import {
  getPanelSpec,
  registerPanelSpecs,
  unregisterPanelSpecs,
} from "../../components/window/panelRegistry";
import type { WindowState } from "../../components/window/types";
import type { SectionDefinition } from "../../state/sections/types";

export const SECTION_PANEL_PREFIX = "section:";

export const sectionPanelId = (id: string): string => `${SECTION_PANEL_PREFIX}${id}`;
export const isSectionPanelId = (id: string): boolean => id.startsWith(SECTION_PANEL_PREFIX);

interface ScanState {
  loading: boolean;
  error: string | null;
  rows: SectionScanRow[];
  note: string | null;
}

const INITIAL_SCAN: ScanState = { loading: true, error: null, rows: [], note: null };

export interface SectionPanelProps {
  section: SectionDefinition;
  market?: string;
}

/** One live section scan; its state stays local instead of birthing a new store. */
export function SectionPanel(props: SectionPanelProps): JSX.Element {
  const [scan, setScan] = createSignal<ScanState>(INITIAL_SCAN);
  const market = (): SectionScanMarket => props.market === "america" ? "america" : "india";
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const load = async () => {
    setScan((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await fetchSectionScan(market(), [props.section], true);
      if (disposed) return;
      setScan({
        loading: false,
        error: null,
        rows: Array.isArray(result?.rows) ? result.rows : [],
        note: result?.note ?? null,
      });
    } catch (cause) {
      if (disposed) return;
      setScan({
        loading: false,
        error: cause instanceof Error ? cause.message : "Section scan failed",
        rows: [],
        note: null,
      });
    }
  };

  onMount(() => { void load(); });

  // Hyperscript keeps this module a .ts file. Getter props stay reactive across
  // scans; SectionTable owns every named loading/empty/error state.
  return h(
    Box,
    { "data-testid": `section-window-${props.section.id}`, className: "flex h-full min-h-0 min-w-0 flex-col overflow-hidden" },
    h(
      ToolbarRow,
      { className: "shrink-0 gap-2 border-b border-fin-border px-2" },
      h(Text, { size: "xs", fw: 700, className: "min-w-0 truncate" }, props.section.name),
      h(Text, { size: "xs", c: "dimmed" }, () => `${scan().rows.length} matches`),
      h(
        Show,
        { get when() { return scan().error; } },
        () => h(
          "button",
          {
            type: "button",
            "data-testid": `section-panel-retry-${props.section.id}`,
            class: "rounded-sm border border-fin-border px-2 text-ui-micro text-fin-text hover:bg-fin-surface-alt",
            onClick: () => void load(),
          },
          "Retry",
        )(),
      ),
    ),
    h(SectionTable, {
      get section() { return props.section; },
      get rows() { return scan().rows; },
      get loading() { return scan().loading; },
      get error() { return scan().error; },
    }),
    h(
      Show,
      { get when() { return scan().note; } },
      (note: () => string) => h(Text, { size: "xs", c: "dimmed", className: "shrink-0 px-2 pb-1" }, note)(),
    ),
  )();
}

/** A pinned section that was deleted keeps its window and names the reason. */
export function DeletedSectionPanel(props: { id: string; title: string }): JSX.Element {
  return h(
    Box,
    {
      "data-testid": `section-panel-deleted-${props.id}`,
      className: "flex h-full min-h-0 flex-col items-center justify-center gap-2 p-3 text-center",
    },
    h(Text, { size: "xs", fw: 700 }, props.title),
    h(Text, { size: "xs", c: "dimmed" }, "This section was deleted. Pick another section or close the window."),
  )();
}

export function createSectionPanelSpec(def: SectionDefinition): DockPanelSpec {
  const id = sectionPanelId(def.id);
  const marketOf = (ctx: DockPanelContext): string => ctx.market ?? "india";
  return {
    id,
    page: "screener",
    title: def.name,
    size: 1,
    minWidth: 320,
    singleton: false,
    requires: [],
    data: (ctx) => ({ sectionId: def.id, market: marketOf(ctx()) }),
    mount: (ctx) => h(SectionPanel, {
      section: def,
      get market() { return marketOf(ctx()); },
    })(),
  };
}

export function createDeletedSectionPanelSpec(id: string, title: string): DockPanelSpec {
  const panelId = sectionPanelId(id);
  return {
    id: panelId,
    page: "screener",
    title,
    size: 1,
    minWidth: 320,
    singleton: false,
    requires: [],
    mount: () => h(DeletedSectionPanel, { id, title })(),
  };
}

const live = new Map<string, DockPanelSpec>();
const registered = new Set<string>();

export interface SectionPanelSync {
  live: DockPanelSpec[];
  tombstones: DockPanelSpec[];
}

/**
 * Reconcile definitions with the desk registry. Removed sections become a
 * tombstone spec rather than being unregistered: a saved layout may still pin
 * them, and that window must degrade to a named empty state, not "Unknown panel".
 */
export function syncSectionPanels(defs: readonly SectionDefinition[]): SectionPanelSync {
  const next = new Map<string, DockPanelSpec>();
  for (const def of defs) {
    const spec = createSectionPanelSpec(def);
    next.set(spec.id, spec);
  }
  const tombstones: DockPanelSpec[] = [];
  for (const [id, previous] of live) {
    if (!next.has(id)) {
      tombstones.push(
        createDeletedSectionPanelSpec(id.slice(SECTION_PANEL_PREFIX.length), previous.title),
      );
    }
  }
  live.clear();
  for (const [id, spec] of next) live.set(id, spec);

  const specs = [...next.values(), ...tombstones];
  registerPanelSpecs(specs);
  for (const spec of specs) registered.add(spec.id);
  return { live: [...next.values()], tombstones };
}

/**
 * A saved layout can name a section that no longer exists (deleted elsewhere or
 * not hydrated yet). Keep its window and give it a spec. Existing specs are
 * never replaced here, so a focus commit cannot rebuild an open panel.
 */
export function ensureSectionTombstones(
  pinned: readonly { type: string; title: string }[],
): DockPanelSpec[] {
  const added: DockPanelSpec[] = [];
  for (const window of pinned) {
    if (!isSectionPanelId(window.type) || live.has(window.type) || getPanelSpec(window.type)) continue;
    const spec = createDeletedSectionPanelSpec(
      window.type.slice(SECTION_PANEL_PREFIX.length),
      window.title || window.type,
    );
    registerPanelSpecs([spec]);
    registered.add(spec.id);
    added.push(spec);
  }
  return added;
}

export function getSectionPanelSpecs(): DockPanelSpec[] {
  return [...live.values()];
}

export function getSectionPanelSpec(id: string): DockPanelSpec | undefined {
  return live.get(id);
}

/** Picker-created section windows use the same cascade geometry as static panels. */
export function createSectionWindow(
  id: string,
  ordinal: number,
  canvas: { w: number; h: number },
  maxZ: number,
): WindowState | null {
  const spec = live.get(id);
  if (!spec) return null;
  return {
    id: `${id}-${ordinal}`,
    type: id,
    title: spec.title,
    ...cascadeRect(ordinal - 1, canvas),
    z: maxZ + 1,
  };
}

/** Isolate module-level registry state between tests. No production caller. */
export function resetSectionPanels(): void {
  unregisterPanelSpecs([...registered]);
  registered.clear();
  live.clear();
}
