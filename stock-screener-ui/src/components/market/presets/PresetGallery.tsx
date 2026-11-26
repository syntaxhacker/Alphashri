import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
import { IconSearch, IconSparkles } from "../../common/Icons";
import {
  activeMoverPreset,
  DEEP_VALUE_PRESET,
  DEEP_VALUE_PRESET_CHIPS,
  deepValuePresetActive,
  clearDeepValuePresetPatch,
  clearMoverPresetPatch,
  MOVER_PRESETS,
  moverPresetChips,
  type MarketFilterState,
  type MoverPreset,
} from "../marketFilters";
import { MOVER_VALUE_FIELDS, PresetNumberField, VALUE_FIELDS } from "./presetFields";

const SHEET_QUERY = "(max-width: 640px)";

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

export interface PresetGalleryProps {
  opened: boolean;
  onClose: () => void;
  filters: MarketFilterState;
  onChange: (patch: Partial<MarketFilterState>) => void;
  /** Which band the rail entry came from; only controls the initial scroll. */
  focus?: "value" | "movers";
  /** Value-scan presets are shown only by a host that owns that contract. */
  valuePresets?: GalleryValuePresetTarget;
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
  const [query, setQuery] = createSignal("");
  const [cursor, setCursor] = createSignal(-1);
  const needle = createMemo(() => query().trim().toLowerCase());
  const matches = (text: string): boolean =>
    needle() === "" || text.toLowerCase().includes(needle());

  const deepActive = () => deepValuePresetActive(props.filters);
  const moverActive = () => activeMoverPreset(props.filters);
  const deepText = () =>
    `deep value ${DEEP_VALUE_PRESET_CHIPS.map((chip) => chip.label).join(" ")}`;

  const visibleMovers = () =>
    MOVER_PRESETS.filter((preset) =>
      matches(
        `${preset.label} ${preset.description} ${moverPresetChips(preset)
          .map((chip) => chip.label)
          .join(" ")}`,
      ),
    );
  const valueEntries = () =>
    Object.entries(props.valuePresets?.presets ?? {}).filter(([id, preset]) =>
      matches(`${id} ${preset.label} ${preset.description}`),
    );
  const showDeep = () => matches(deepText());
  const showManual = () => needle() === "";
  const matchCount = () =>
    (showDeep() ? 1 : 0) + visibleMovers().length + valueEntries().length;

  createEffect(() => {
    if (!props.opened) return;
    const id = props.focus === "movers" ? "market-movers-list" : "market-value-fields";
    // The modal mounts in the same tick; the scroll is cosmetic, never a gate.
    queueMicrotask(() => document.getElementById(id)?.scrollIntoView?.({ block: "start" }));
  });

  const applyButtons = (): HTMLButtonElement[] =>
    Array.from(
      document
        .querySelector('[data-testid="market-preset-gallery"]')
        ?.querySelectorAll<HTMLButtonElement>('[data-preset-apply="true"]') ?? [],
    );

  const moveCursor = (delta: 1 | -1): void => {
    const buttons = applyButtons();
    if (buttons.length === 0) return;
    const next = (cursor() + delta + buttons.length) % buttons.length;
    setCursor(next);
    buttons[next]?.focus();
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.opened || e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      e.preventDefault();
      document
        .querySelector<HTMLInputElement>('[data-testid="market-preset-search"]')
        ?.focus();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const gateLabel = (key: string, value: string | number | boolean): string =>
    `${key.replace(/_/g, " ")} ${typeof value === "boolean" ? (value ? "on" : "off") : value}`;

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="Presets & filters"
      size={isSheet() ? undefined : "xl"}
      fullScreen={isSheet()}
      padding={0}
      className="w-full max-w-full min-w-0 overflow-x-hidden"
      data-testid="market-preset-gallery"
    >
      <div
        data-sheet={isSheet() ? "true" : "false"}
        className="flex flex-col gap-3 p-2 w-full max-w-full min-w-0"
      >
        <Box className="sticky top-0 z-10 flex flex-col gap-1 bg-fin-surface min-w-0">
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
          <Text size="xs" c="dimmed" data-testid="preset-match-count">
            {`${matchCount()} matching preset${matchCount() === 1 ? "" : "s"} · ↑↓ to walk · Esc to close`}
          </Text>
        </Box>

        <Show when={showDeep()}>
          <section
            id="market-value-fields"
            data-testid="market-value-fields"
            className="flex flex-col gap-2 min-w-0"
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
                  onClick={() => props.onChange(DEEP_VALUE_PRESET)}
                >
                  Apply
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  disabled={!deepActive()}
                  data-testid="market-value-preset-clear"
                  onClick={() => props.onChange(clearDeepValuePresetPatch())}
                >
                  Clear
                </Button>
              </ToolbarRow>
            </article>

            <Show when={showManual()}>
              <div role="group" aria-label="Value filter fields" className="flex flex-col gap-2 min-w-0">
                <Text fw={600} c="dimmed" className="text-ui-micro uppercase tracking-[0.06em]">
                  Manual value bounds
                </Text>
                <div className="grid grid-cols-2 gap-2 min-w-0 sm:grid-cols-3 lg:grid-cols-4">
                  <For each={VALUE_FIELDS}>
                    {(def) => (
                      <PresetNumberField def={def} filters={props.filters} onChange={props.onChange} />
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </section>
        </Show>

        <Divider />

        <section
          id="market-movers-list"
          data-testid="market-movers-list"
          className="flex flex-col gap-2 min-w-0"
        >
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

          <Show when={visibleMovers().length === 0}>
            <Text size="xs" c="dimmed" data-testid="preset-no-matches">
              No preset matches that search.
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
                  <GateChips chips={moverPresetChips(preset)} />
                  <ToolbarRow gap={8}>
                    <Button
                      size="xs"
                      data-preset-apply="true"
                      data-testid={`market-mover-${preset.id}`}
                      onClick={() => props.onChange({ ...preset.filters, sort: preset.sort })}
                    >
                      Apply
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!active()}
                      data-testid={`market-mover-${preset.id}-clear`}
                      onClick={() => props.onChange(clearMoverPresetPatch(preset))}
                    >
                      Clear
                    </Button>
                  </ToolbarRow>
                </article>
              );
            }}
          </For>
        </section>

        <Show when={showManual()}>
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
                  <PresetNumberField def={def} filters={props.filters} onChange={props.onChange} />
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={props.valuePresets && valueEntries().length > 0}>
          <Divider />
          <section
            data-testid="value-preset-gallery-list"
            className="flex flex-col gap-2 min-w-0"
          >
            <ToolbarRow justify="space-between">
              <ToolbarRow gap={8}>
                <IconSearch size={14} />
                <Text fw={700} size="sm">
                  Value scan presets
                </Text>
              </ToolbarRow>
              <Show when={props.valuePresets?.selected}>
                <Badge size="xs" color="primary" data-testid="value-preset-active">
                  Active
                </Badge>
              </Show>
            </ToolbarRow>
            <For each={valueEntries()}>
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
                        <Badge size="xs" color="primary">Active</Badge>
                      </Show>
                    </ToolbarRow>
                    <Text size="xs" c="dimmed">
                      {preset.description}
                    </Text>
                    <GateChips
                      chips={Object.entries(preset.gates).map(([key, value]) => ({
                        key,
                        label: gateLabel(key, value),
                      }))}
                    />
                    <ToolbarRow gap={8}>
                      <Button
                        size="xs"
                        data-preset-apply="true"
                        data-testid={`value-preset-apply-${id}`}
                        onClick={() => props.valuePresets?.onSelect(id)}
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
          </section>
        </Show>
      </div>
    </Modal>
  );
}
