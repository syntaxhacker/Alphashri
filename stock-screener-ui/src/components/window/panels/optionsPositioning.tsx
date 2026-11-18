import { createSignal, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { Box, Text, TextInput, ToolbarRow } from "@/ui";
import { PositioningPanel } from "../../options/Positioning/PositioningPanel";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";
import { ExpirySelect, useExpiryPicker } from "./expiryPicker";

/**
 * Window-sized positioning surface. It owns only an underlying and an expiry:
 * the data flight, mode/view state and error states belong to PositioningPanel,
 * so this wrapper never duplicates a fetch or an error presentation.
 *
 * The desk context is a seed, not a dependency. With no expiry the panel shows
 * its own no-data state and nothing is fetched until an expiry is typed here.
 */
function OptionsPositioningWindow(props: { context: Accessor<DockPanelContext> }) {
  const [underlying, setUnderlying] = createSignal(
    (props.context().symbol ?? "NIFTY").trim().toUpperCase() || "NIFTY",
  );
  const picker = useExpiryPicker(underlying, props.context);
  const expiry = picker.expiry;

  const onUnderlyingChange = (value: string) => {
    const next = value.trim().toUpperCase() || "NIFTY";
    if (next !== underlying()) setUnderlying(next);
  };

  return (
    <Box
      className="flex h-full min-h-0 flex-col bg-fin-surface"
      data-testid="options-positioning-window"
    >
      <ToolbarRow
        data-testid="options-positioning-controls"
        className="shrink-0 border-b border-fin-border px-2 py-1"
        wrap={false}
      >
        <Text size="xs" fw={700}>
          POSITIONING
        </Text>
        <TextInput
          aria-label="Underlying"
          data-testid="options-positioning-underlying-input"
          size="xs"
          w={130}
          placeholder="NIFTY"
          value={underlying()}
          onChange={onUnderlyingChange}
        />
        <ExpirySelect
          model={picker}
          ariaLabel="Expiry"
          controlTestId="options-positioning-expiry-input"
          pickerTestId="options-positioning-expiry-picker"
          loadingTestId="options-positioning-expiry-loading"
          errorTestId="options-positioning-expiry-error"
          emptyTestId="options-positioning-expiry-empty"
        />
      </ToolbarRow>

      <Show when={!expiry()}>
        <Box
          data-testid="options-positioning-empty"
          className="px-2 py-1 text-[10px] text-fin-text-muted"
        >
          Choose an expiry in this window to load {underlying()} positioning.
        </Box>
      </Show>

      <Box className="min-h-0 flex-1 overflow-auto">
        <PositioningPanel underlying={underlying()} expiry={expiry()} />
      </Box>
    </Box>
  );
}

export const OPTIONS_POSITIONING_PANEL: DockPanelSpec = {
  id: "options.positioning",
  page: "report",
  title: "OPTIONS POSITIONING",
  size: 1,
  minWidth: 360,
  singleton: false,
  requires: [],
  mount: (ctx: Accessor<DockPanelContext>) => <OptionsPositioningWindow context={ctx} />,
};
