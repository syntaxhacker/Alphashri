import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import {
  Badge,
  Box,
  Button,
  Divider,
  Modal,
  Text,
  TextInput,
  ToolbarRow,
  useMediaQuery,
} from "@/ui";
import {
  IconChevronDown,
  IconClipboardList,
  IconSparkles,
  IconX,
} from "../../common/Icons";
import {
  activeMoverPreset,
  DEEP_VALUE_PRESET,
  DEEP_VALUE_PRESET_CHIPS,
  deepValuePresetActive,
  clearDeepValuePresetPatch,
  clearMoverPresetPatch,
  MOVER_PRESETS,
  moverFloorLabel,
  moverPresetChips,
  type MarketFilterState,
  type MoverPreset,
} from "../marketFilters";
import { currencyFor, type CurrencyCode } from "@/config/currency";
import type { MarketUniverse } from "../../../types/marketScreener";
import {
  MOVER_VALUE_FIELDS,
  PresetNumberField,
  VALUE_FIELDS,
  VALUE_SCAN_FIELDS,
} from "./presetFields";
import { valueGateChips } from "./gateLabels";

const SHEET_QUERY = "(max-width: 640px)";
const STICKY_SCROLL_MARGIN = "5rem";

export type PresetGalleryMode = "market" | "value";

export interface GalleryValuePreset {
  label: string;
  description: string;
  gates: Record<string, string | number | boolean>;
}

export interface GalleryValuePresetTarget {
  selected?: string;
  presets: Record<string, GalleryValuePreset>;
  onSelect: (id?: string) => void;
}

/**
 * Manual bounds of the value-scan contract. `values` is a getter so a live
 * scan filter signal reaches the fields without rebuilding the gallery (or
 * pinning the first render's bounds).
 */
export interface GalleryValueBoundsTarget {
  values: () => Record<string, number | null | undefined>;
  onChange: (patch: Record<string, number | null>) => void;
}

export interface PresetGalleryProps {
  opened: boolean;
  onClose: () => void;
  /** Market-filter state; required by the market rail, absent in a value host. */
  filters?: MarketFilterState;
  onChange?: (patch: Partial<MarketFilterState>) => void;
  /**
   * Value-first layout: value-scan presets are primary, market movers collapse
   * into a clearly labelled secondary section, and no market-only Deep card or
   * mover manual bounds are rendered.
   */
  mode?: PresetGalleryMode;
  /** Which band the entry came from; controls the initial scroll and arrow scope. */
  focus?: "value" | "movers";
  /** Universe whose market-cap unit labels the mover floor. */
  universe?: MarketUniverse;
  /** Quote currency used by the value gate labels (`$` / `₹`). */
  currency?: CurrencyCode;
  /** Manual value-scan bounds (value mode only). */
  valueBounds?: GalleryValueBoundsTarget;
  /** Value-scan presets are shown only by a host that owns that contract. */
  valuePresets?: GalleryValuePresetTarget;
  /** A value host with no Market table host cannot apply mover presets. */
  showMovers?: boolean;
  /** Applies a mover patch to the Market table when this host is not the market rail. */
  onMarketPreset?: (patch: Partial<MarketFilterState>) => void;
  /** Render the dialog through a body portal (needed inside a transformed drawer). */
  portal?: boolean;
}

function GateChips(props: { chips: readonly { key: string; label: string }[] }) {
  return (
    <Box className="flex flex-wrap gap-1">
      <For each={props.chips}>
        {(chip) => (
          <Badge size="xs" color="primary" variant="light" data-testid={`preset-chip-${chip.key}`}>
            {chip.label}
          </Badge>
        )}
      </For>
    </Box>
  );
}

export function PresetGallery(props: PresetGalleryProps) {
  const isSheet = useMediaQuery(SHEET_QUERY);
  const mode = () => props.mode ?? "market";
  const universe = () => props.universe ?? "all_equity";
  const currencySymbol = () => currencyFor(props.currency).symbol;
  const [query, setQuery] = createSignal("");
  const [moversOpen, setMoversOpen] = createSignal(true);
  const [cursor, setCursor] = createSignal(-1);
  const needle = createMemo(() => query().trim().toLowerCase());
  const matches = (text: string): boolean =>
    needle() === "" || text.toLowerCase().includes(needle());

  const deepActive = () => (props.filters ? deepValuePresetActive(props.filters) : false);
  const moverActive = () => (props.filters ? activeMoverPreset(props.filters) : null);
  const deepText = () =>
    `deep value ${DEEP_VALUE_PRESET_CHIPS.map((chip) => chip.label).join(" ")}`;

  const visibleMovers = () =>
    MOVER_PRESETS.filter((preset) =>
      matches(
        `${preset.label} ${preset.description} ${moverPresetChips(preset, universe())
          .map((chip) => chip.label)
          .join(" ")} ${moverFloorLabel(universe())}`,
      ),
    );
  const valueText = (id: string, preset: GalleryValuePreset): string =>
    `${id} ${preset.label} ${preset.description} ${valueGateChips(
      preset.gates,
      currencySymbol(),
    )
      .map((chip) => chip.label)
      .join(" ")}`;
  const visibleValueEntries = () =>
    Object.entries(props.valuePresets?.presets ?? {}).filter(([id, preset]) =>
      matches(valueText(id, preset)),
    );
  const showDeep = () => matches(deepText());
  const showManual = () => needle() === "";
  const showMovers = () =>
    (props.showMovers ?? true) && (mode() === "market" || props.onMarketPreset != null);
  const showValueSection = () => mode() === "value" && props.valuePresets != null;
  const matchCount = () =>
    (mode() === "market" && showDeep() ? 1 : 0) +
    (showValueSection() ? visibleValueEntries().length : 0) +
    (showMovers() ? visibleMovers().length : 0);

  const focusSearch = (): void => {
    document
      .querySelector<HTMLInputElement>('[data-testid="market-preset-search"]')
      ?.focus();
  };

  /**
   * Focus moves to search as soon as the modal is mounted. Modal itself focuses
   * its dialog on the next frame, so the search focus is queued behind that —
   * otherwise "↑↓ to walk" starts on a dialog with no arrow handler.
   */
  createEffect(() => {
    if (!props.opened) return;
    setCursor(-1);
    setQuery("");
    setMoversOpen(mode() === "market" || props.focus === "movers");
    queueMicrotask(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          (document.querySelector('[data-testid="market-preset-search"]') as HTMLInputElement | null)
            ?.focus();
        }, 0);
      });
      window.setTimeout(() => {
        const id =
          mode() === "value"
            ? "value-preset-gallery-list"
            : props.focus === "movers"
              ? "market-movers-list"
              : "market-value-fields";
        document.getElementById(id)?.scrollIntoView?.({ block: "start" });
      }, 0);
    });
  });

  // A search that matches only market presets must not look like no matches:
  // expanding the secondary section is what makes its hits reachable.
  createEffect(() => {
    if (props.opened && needle() !== "" && mode() === "value") setMoversOpen(true);
  });

  const sectionId = (): string => {
    if (props.focus === "movers") return "market-movers-list";
    return mode() === "value" ? "value-preset-gallery-list" : "market-value-fields";
  };

  /** Arrow walking stays inside the band the user entered from. */
  const applyButtons = (): HTMLButtonElement[] =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        `#${sectionId()} [data-preset-apply="true"]`,
      ),
    );

  const moveCursor = (delta: 1 | -1): void => {
    const buttons = applyButtons();
    if (buttons.length === 0) return;
    const current = cursor();
    const next =
      current < 0
        ? delta > 0
          ? 0
          : buttons.length - 1
        : (current + delta + buttons.length) % buttons.length;
    setCursor(next);
    buttons[next]?.focus();
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.opened) return;
      if (e.key === "/") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      // Search owns its arrows (it starts the walk); a number field uses them
      // to step its value. Everything else — the dialog, a card, the header —
      // walks the presets.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      moveCursor(e.key === "ArrowDown" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const applyMover = (preset: MoverPreset): void => {
    props.onMarketPreset?.({ ...preset.filters, sort: preset.sort });
    props.onClose();
  };

  const gateChipsFor = (preset: GalleryValuePreset) =>
    valueGateChips(preset.gates, currencySymbol());

  const moverFloor = () => moverFloorLabel(universe());

  const gallery = () => (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="Presets & filters"
      size={isSheet() ? undefined : "xl"}
      padding={0}
      className="w-full max-w-full min-w-0 overflow-x-hidden"
      style={
        isSheet()
          ? {
              "align-self": "flex-end",
              height: "min(82dvh, 720px)",
              "max-height": "82dvh",
              "border-radius": "12px 12px 0 0",
              "border-bottom": "0",
            }
          : undefined
      }
      data-testid="market-preset-gallery"
    >
      <div
        data-sheet={isSheet() ? "true" : "false"}
        className="flex flex-col gap-3 p-2 w-full max-w-full min-w-0"
        onKeyDown={(e) => {
          // The market drawer also listens for Escape on document; stopping the
          // event here is what makes Escape dismiss only the gallery.
          if (e.key === "Escape") e.stopPropagation();
        }}
      >
        <Box className="sticky top-0 z-10 flex flex-col gap-1 bg-fin-surface min-w-0">
          <Box className="flex items-center gap-1 min-w-0">
            <Box className="flex-1 min-w-0">
              <TextInput
                size="sm"
                aria-label="Search presets"
                placeholder="Search presets and gates…"
                value={query()}
                onChange={setQuery}
                data-testid="market-preset-search"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    moveCursor(1);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    moveCursor(-1);
                  }
                }}
              />
            </Box>
            <Show when={query() !== ""}>
              <button
                type="button"
                aria-label="Clear preset search"
                data-testid="market-preset-search-clear"
                onClick={() => {
                  setQuery("");
                  setCursor(-1);
                  focusSearch();
                }}
                className="flex min-h-6 min-w-6 items-center justify-center rounded-sm border border-fin-border text-fin-text-muted hover:text-fin-text hover:bg-fin-surface-alt cursor-pointer"
              >
                <IconX size={12} />
              </button>
            </Show>
          </Box>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="preset-match-count"
          >
            <Text size="xs" c="dimmed">
              {`${matchCount()} matching preset${matchCount() === 1 ? "" : "s"} · ↑↓ to walk · Esc to close`}
            </Text>
          </div>
        </Box>

        <Show when={showValueSection()}>
          <section
            id="value-preset-gallery-list"
            data-testid="value-preset-gallery-list"
            className="flex flex-col gap-2 min-w-0"
            style={{ "scroll-margin-top": STICKY_SCROLL_MARGIN }}
          >
            <ToolbarRow justify="space-between">
              <ToolbarRow gap={8}>
                <IconClipboardList size={14} />
                <Text fw={700} size="sm">
                  Value scan presets
                </Text>
              </ToolbarRow>
              <Text size="xs" c="dimmed" data-testid="value-preset-count">
                {`${visibleValueEntries().length} of ${Object.keys(props.valuePresets?.presets ?? {}).length}`}
              </Text>
            </ToolbarRow>
            <Text size="xs" c="dimmed">
              Applied to this Deep Value scan. Each gate is ranked inside the row&apos;s own sector.
            </Text>

            <Show
              when={visibleValueEntries().length === 0 && needle() !== ""}
            >
              <Text size="xs" c="dimmed" data-testid="preset-no-matches-value">
                No value presets match that search.
              </Text>
            </Show>

            <For each={visibleValueEntries()}>
              {([id, preset]) => {
                const active = () => props.valuePresets?.selected === id;
                return (
                  <article
                    data-testid={`value-preset-card-${id}`}
                    className="flex flex-col gap-1 rounded-sm border border-fin-border p-2 min-w-0"
                  >
                    <ToolbarRow justify="space-between">
                      <Text fw={600} size="sm">
                        {preset.label}
                      </Text>
                      <Show when={active()}>
                        <Badge
                          size="xs"
                          color="primary"
                          data-testid={`value-preset-active-${id}`}
                        >
                          Active
                        </Badge>
                      </Show>
                    </ToolbarRow>
                    <Text size="xs" c="dimmed">
                      {preset.description}
                    </Text>
                    <GateChips chips={gateChipsFor(preset)} />
                    <ToolbarRow gap={8}>
                      <Button
                        size="xs"
                        data-preset-apply="true"
                        data-testid={`value-preset-apply-${id}`}
                        onClick={() => {
                          props.valuePresets?.onSelect(id);
                          props.onClose();
                        }}
                      >
                        Apply
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        disabled={!active()}
                        data-testid={`value-preset-clear-${id}`}
                        onClick={() => props.valuePresets?.onSelect(undefined)}
                      >
                        Clear
                      </Button>
                    </ToolbarRow>
                  </article>
                );
              }}
            </For>

            <Show when={showManual() && props.valueBounds}>
              <div
                role="group"
                aria-label="Value scan manual bounds"
                className="flex flex-col gap-2 min-w-0 pt-1"
              >
                <Text fw={600} c="dimmed" className="text-ui-micro uppercase tracking-[0.06em]">
                  Manual value bounds
                </Text>
                <div className="grid grid-cols-2 gap-2 min-w-0 sm:grid-cols-3 lg:grid-cols-4">
                  <For each={VALUE_SCAN_FIELDS}>
                    {(def) => (
                      <PresetNumberField
                        def={def}
                        value={props.valueBounds?.values()[def.key] ?? null}
                        testIdPrefix="value-filter"
                        onChange={(value) =>
                          props.valueBounds?.onChange({ [def.key]: value })
                        }
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </section>
        </Show>

        <Show when={mode() === "market" && showDeep()}>
          <section
            id="market-value-fields"
            data-testid="market-value-fields"
            className="flex flex-col gap-2 min-w-0"
            style={{ "scroll-margin-top": STICKY_SCROLL_MARGIN }}
          >
            <article className="flex flex-col gap-2 rounded-sm border border-fin-border p-2 min-w-0">
              <ToolbarRow justify="space-between">
                <ToolbarRow gap={8}>
                  <IconSparkles size={14} />
                  <Text fw={700} size="sm">
                    Deep value
                  </Text>
                </ToolbarRow>
                <Show when={deepActive()}>
                  <Badge size="xs" color="primary" data-testid="preset-active-deep-value">
                    Active
                  </Badge>
                </Show>
              </ToolbarRow>
              <Text size="xs" c="dimmed">
                Cheapest 35% on P/E · top 55% on ROE · least-leveraged 30% on D/E — each gate is
                ranked inside the row&apos;s own sector, so a utility is not judged against a software
                multiple.
              </Text>
              <GateChips chips={DEEP_VALUE_PRESET_CHIPS} />
              <ToolbarRow gap={8}>
                <Button
                  size="xs"
                  data-preset-apply="true"
                  data-testid="market-value-preset"
                  onClick={() => {
                    props.onChange?.(DEEP_VALUE_PRESET);
                    props.onClose();
                  }}
                >
                  Apply
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  disabled={!deepActive()}
                  data-testid="market-value-preset-clear"
                  onClick={() => props.onChange?.(clearDeepValuePresetPatch())}
                >
                  Clear
                </Button>
              </ToolbarRow>
            </article>

            <Show when={showManual() && props.filters && props.onChange}>
              <div role="group" aria-label="Value filter fields" className="flex flex-col gap-2 min-w-0">
                <Text fw={600} c="dimmed" className="text-ui-micro uppercase tracking-[0.06em]">
                  Manual value bounds
                </Text>
                <div className="grid grid-cols-2 gap-2 min-w-0 sm:grid-cols-3 lg:grid-cols-4">
                  <For each={VALUE_FIELDS}>
                    {(def) => (
                      <PresetNumberField
                        def={def}
                        value={props.filters?.[def.key as keyof MarketFilterState] as number | null}
                        onChange={(value) =>
                          props.onChange?.({ [def.key]: value } as Partial<MarketFilterState>)
                        }
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </section>
        </Show>

        <Show when={mode() === "market" && !showDeep() && needle() !== ""}>
          <Text size="xs" c="dimmed" data-testid="preset-no-matches-deep">
            No deep-value preset matches that search.
          </Text>
        </Show>

        <Show when={mode() === "market" || (mode() === "value" && showMovers())}>
          <Divider />
        </Show>

        <Show when={showMovers()}>
          <section
            id="market-movers-list"
            data-testid="market-movers-list"
            className="flex flex-col gap-2 min-w-0"
            style={{ "scroll-margin-top": STICKY_SCROLL_MARGIN }}
          >
            <Show
              when={mode() === "value"}
              fallback={
                <ToolbarRow justify="space-between">
                  <ToolbarRow gap={8}>
                    <IconSparkles size={14} />
                    <Text fw={700} size="sm">
                      Mover presets
                    </Text>
                  </ToolbarRow>
                  <Text size="xs" c="dimmed">
                    {`${visibleMovers().length} of ${MOVER_PRESETS.length}`}
                  </Text>
                </ToolbarRow>
              }
            >
              <ToolbarRow justify="space-between">
                <button
                  type="button"
                  data-testid="preset-movers-toggle"
                  aria-expanded={moversOpen()}
                  onClick={() => setMoversOpen((open) => !open)}
                  className="flex min-h-6 items-center gap-1 rounded-sm px-1 -mx-1 cursor-pointer text-fin-text hover:bg-fin-surface-alt"
                >
                  <IconSparkles size={14} />
                  <Text fw={700} size="sm">
                    Market table presets
                  </Text>
                  <Text size="xs" c="dimmed">
                    {`${visibleMovers().length} of ${MOVER_PRESETS.length}`}
                  </Text>
                  <span
                    className="inline-flex transition-transform"
                    style={{ transform: moversOpen() ? "rotate(180deg)" : "none" }}
                  >
                    <IconChevronDown size={12} />
                  </span>
                </button>
              </ToolbarRow>
              <Text size="xs" c="dimmed" data-testid="preset-mover-floor">
                {`Secondary: applies to the Market table and closes this gallery. Every preset requires market cap ≥ ${moverFloor()}.`}
              </Text>
            </Show>

            <Show when={moversOpen()}>
              <Show when={mode() === "market"}>
                <Text size="xs" c="dimmed" data-testid="preset-mover-floor">
                  {`Every preset requires market cap ≥ ${moverFloor()}.`}
                </Text>
              </Show>
              <Show when={visibleMovers().length === 0 && needle() !== ""}>
                <Text size="xs" c="dimmed" data-testid="preset-no-matches-movers">
                  No mover presets match that search.
                </Text>
              </Show>

              <For each={visibleMovers()}>
                {(preset: MoverPreset) => {
                  const active = () => moverActive()?.id === preset.id;
                  return (
                    <article
                      data-testid={`preset-card-${preset.id}`}
                      className="flex flex-col gap-1 rounded-sm border border-fin-border p-2 min-w-0"
                    >
                      <ToolbarRow justify="space-between">
                        <Text fw={600} size="sm" data-testid={`preset-label-${preset.id}`}>
                          {preset.label}
                        </Text>
                        <Show when={active()}>
                          <Badge size="xs" color="primary" data-testid={`preset-active-${preset.id}`}>
                            Active
                          </Badge>
                        </Show>
                      </ToolbarRow>
                      <Text size="xs" c="dimmed" data-testid={`preset-thesis-${preset.id}`}>
                        {preset.description}
                      </Text>
                      <GateChips chips={moverPresetChips(preset, universe())} />
                      <ToolbarRow gap={8}>
                        <Button
                          size="xs"
                          data-preset-apply="true"
                          data-testid={`market-mover-${preset.id}`}
                          onClick={() => {
                            if (mode() === "value") applyMover(preset);
                            else {
                              props.onChange?.({ ...preset.filters, sort: preset.sort });
                              props.onClose();
                            }
                          }}
                        >
                          Apply
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          disabled={!active()}
                          data-testid={`market-mover-${preset.id}-clear`}
                          onClick={() => props.onChange?.(clearMoverPresetPatch(preset))}
                        >
                          Clear
                        </Button>
                      </ToolbarRow>
                    </article>
                  );
                }}
              </For>
            </Show>
          </section>
        </Show>

        <Show when={mode() === "market" && showManual() && props.filters && props.onChange}>
          <section
            role="group"
            aria-label="Mover manual bounds"
            className="flex flex-col gap-2 min-w-0"
          >
            <Text fw={600} c="dimmed" className="text-ui-micro uppercase tracking-[0.06em]">
              Manual mover bounds
            </Text>
            <div className="grid grid-cols-2 gap-2 min-w-0 sm:grid-cols-3 lg:grid-cols-4">
              <For each={MOVER_VALUE_FIELDS}>
                {(def) => (
                  <PresetNumberField
                    def={def}
                    value={props.filters?.[def.key as keyof MarketFilterState] as number | null}
                    onChange={(value) =>
                      props.onChange?.({ [def.key]: value } as Partial<MarketFilterState>)
                    }
                  />
                )}
              </For>
            </div>
          </section>
        </Show>
      </div>
    </Modal>
  );

  return props.portal ? <Portal>{gallery()}</Portal> : gallery();
}
