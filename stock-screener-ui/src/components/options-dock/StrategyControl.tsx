import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Badge, Box, Text, Tooltip } from "@/ui";
import { DIALOG_SHADOW } from "@/ui/palette";
import {
  STRATEGY_PRESETS,
  strategiesFor,
  type Outlook,
  type StrategyPreset,
} from "@/utils/optionsStrategies";
import { optionsDockState, presetContext, setStrategy } from "@/state/optionsDock";

const OUTLOOKS: { id: Outlook; label: string }[] = [
  { id: "bullish", label: "Bullish" },
  { id: "bearish", label: "Bearish" },
  { id: "neutral", label: "Neutral" },
];

/** Shown on a preset the live chain cannot hold, and in the inline note. */
const NARROW_CHAIN = "chain too narrow for this spread";
const NO_CHAIN = "waiting for the option chain";

function presetOf(id: string | null): StrategyPreset | null {
  if (!id) return null;
  return STRATEGY_PRESETS.find((preset) => preset.id === id) ?? null;
}

interface PanelPosition {
  top: number;
  left: number;
  maxHeight: number;
}

/**
 * Strategy picker above the leg strip.
 *
 * The list is a popover rather than a native `<select>` because "disabled with a
 * reason" is the point of the unavailable state, and a `<select>` cannot carry a
 * per-option tooltip. It is also a popover rather than the shared `Menu` because
 * the dock clips its content (`overflow: hidden`) and sits against the viewport's
 * bottom edge — `position: fixed` placed from the trigger is the only placement
 * that survives both.
 */
export function StrategyControl() {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal<PanelPosition>({ top: 0, left: 0, maxHeight: 360 });

  let triggerEl: HTMLElement | undefined;
  let panelEl: HTMLElement | undefined;

  const PANEL_GAP = 4;
  const PANEL_MIN_WIDTH = 200;
  const VIEWPORT_MARGIN = 8;

  /** Place the panel above the trigger when the space below cannot hold it. */
  const measure = () => {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - PANEL_GAP - VIEWPORT_MARGIN;
    const above = rect.top - PANEL_GAP - VIEWPORT_MARGIN;
    const useAbove = below < 240 && above > below;
    const maxHeight = Math.max(120, Math.min(420, useAbove ? above : below));
    setPosition({
      top: useAbove ? Math.max(VIEWPORT_MARGIN, rect.top - PANEL_GAP - maxHeight) : rect.bottom + PANEL_GAP,
      left: Math.min(rect.left, Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_MIN_WIDTH - VIEWPORT_MARGIN)),
      maxHeight,
    });
  };

  const close = () => setOpen(false);
  const toggle = () => {
    if (open()) {
      close();
      return;
    }
    measure();
    setOpen(true);
  };

  const context = createMemo(() => presetContext());
  /** preset id → why it cannot be built (null when it builds fine). */
  const availability = createMemo(() => {
    const ctx = context();
    const map = new Map<string, string | null>();
    for (const outlook of OUTLOOKS) {
      for (const preset of strategiesFor(outlook.id)) {
        map.set(preset.id, ctx == null ? NO_CHAIN : preset.legs(ctx) ? null : NARROW_CHAIN);
      }
    }
    return map;
  });

  const active = createMemo(() => presetOf(optionsDockState.activePreset));
  const unavailable = () =>
    optionsDockState.presetUnavailable || (active() != null && optionsDockState.legs.length === 0);

  const choose = (id: string | null) => {
    close();
    setStrategy(id);
  };

  if (typeof document !== "undefined") {
    const onPointerDown = (event: MouseEvent) => {
      if (!open()) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerEl?.contains(target) || panelEl?.contains(target)) return;
      close();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (open() && event.key === "Escape") close();
    };
    // Pointerdown, not click: the press must not both close the panel and land
    // on whatever happens to sit underneath it.
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeydown);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeydown);
    });
  }

  return (
    <Box
      className="flex shrink-0 flex-col gap-1 border-t border-fin-border px-2 py-1"
      data-testid="options-strategy-row"
    >
      <Box className="flex items-center gap-2">
        <Text
          size="xs"
          fw={700}
          className="font-mono tracking-[0.08em] text-fin-text-muted uppercase"
          style={{ "font-size": "9px" }}
        >
          STRATEGY
        </Text>

        <Box
          component="button"
          type="button"
          ref={(el: HTMLElement) => (triggerEl = el)}
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-label="Option strategy"
          data-testid="options-strategy"
          onClick={toggle}
          className="inline-flex min-w-0 cursor-pointer items-center gap-1 border border-fin-border bg-fin-surface px-1 font-mono text-[10px] text-fin-text hover:border-fin-primary"
          style={{ height: "22px", "border-radius": "4px" }}
        >
          <span className="truncate">{active()?.name ?? "No strategy"}</span>
          <span aria-hidden="true" className="text-fin-text-muted">
            {open() ? "▴" : "▾"}
          </span>
        </Box>

        <Show when={active()}>
          {(preset) => (
            <Box className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <Text
                size="xs"
                c="dimmed"
                className="min-w-0 truncate"
                style={{ "font-size": "10px" }}
                data-testid="options-strategy-description"
              >
                {preset().description}
              </Text>
              <Tooltip
                label={
                  preset().risk === "defined"
                    ? "Max loss is capped by the structure"
                    : "A short leg has no strike beyond it — loss is not capped"
                }
              >
                <Badge
                  size="xs"
                  variant="outline"
                  color={preset().risk === "defined" ? "success" : "warning"}
                  data-testid="options-strategy-risk"
                >
                  {preset().risk} risk
                </Badge>
              </Tooltip>
            </Box>
          )}
        </Show>
      </Box>

      <Show when={open()}>
        <Box
          ref={(el: HTMLElement) => (panelEl = el)}
          role="listbox"
          aria-label="Option strategies"
          data-testid="options-strategy-menu"
          className="fixed z-[1300] flex flex-col overflow-y-auto border border-fin-border bg-fin-surface py-1 text-fin-text"
          style={{
            top: `${position().top}px`,
            left: `${position().left}px`,
            "min-width": `${PANEL_MIN_WIDTH}px`,
            "max-height": `${position().maxHeight}px`,
            "border-radius": "6px",
            "box-shadow": DIALOG_SHADOW,
          }}
        >
          <Box
            component="button"
            type="button"
            role="option"
            aria-selected={optionsDockState.activePreset == null}
            data-testid="options-strategy-none"
            onClick={() => choose(null)}
            className="w-full cursor-pointer border-0 bg-transparent px-3 py-[5px] text-left text-[11px] text-fin-text hover:bg-fin-surface-alt"
          >
            No strategy
          </Box>

          <For each={OUTLOOKS}>
            {(outlook) => (
              <>
                <Box
                  component="div"
                  role="presentation"
                  className="px-3 py-[4px] text-[9px] font-semibold tracking-[0.08em] text-fin-text-muted uppercase"
                  data-testid={`options-strategy-group-${outlook.id}`}
                >
                  {outlook.label}
                </Box>
                <For each={strategiesFor(outlook.id)}>
                  {(preset) => {
                    const reason = () => availability().get(preset.id) ?? null;
                    return (
                      <Box
                        component="button"
                        type="button"
                        role="option"
                        aria-selected={optionsDockState.activePreset === preset.id}
                        aria-disabled={reason() != null || undefined}
                        disabled={reason() != null}
                        title={reason() ?? preset.description}
                        data-testid={`options-strategy-${preset.id}`}
                        onClick={() => choose(preset.id)}
                        className={
                          reason() != null
                            ? "w-full cursor-default border-0 bg-transparent px-3 py-[5px] text-left text-[11px] text-fin-text-muted opacity-60"
                            : "w-full cursor-pointer border-0 bg-transparent px-3 py-[5px] text-left text-[11px] text-fin-text hover:bg-fin-surface-alt"
                        }
                      >
                        {preset.name}
                      </Box>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </Box>
      </Show>

      <Show when={active() && unavailable()}>
        <Text
          size="xs"
          c="warning"
          style={{ "font-size": "10px" }}
          data-testid="options-strategy-unavailable"
        >
          {active()!.name} needs a wider chain on this expiry — no legs built.
        </Text>
      </Show>
    </Box>
  );
}
