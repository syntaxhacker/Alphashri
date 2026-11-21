import { Select, Box } from "@/ui";
import { CHAIN_CONTROL_H, CHAIN_LABEL_CLASS, CHAIN_SELECT_CLASS } from "./controlClass";

export function OptionChainHeader(props: {
  selectedUnderlying: string;
  selectedExpiry: string;
  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  availableUnderlyings: string[];
  availableExpiries: string[];
}) {
  return (
    <Box
      id="chain-header-controls"
      data-testid="options-chain-header-controls"
      className="flex items-center gap-2 min-w-0 shrink-0"
    >
      {/* `Select` drops `aria-label` (it never forwards unknown props), so the
          accessible name comes from a real label; the visible caption is an
          in-control adornment, which keeps the row on one centre line. */}
      <label class="sr-only" for="chain-underlying-select">Underlying</label>
      <Select
        id="chain-underlying-select"
        size="xs"
        w={140}
        h={CHAIN_CONTROL_H}
        className={CHAIN_SELECT_CLASS}
        value={props.selectedUnderlying}
        onChange={(val) => val && props.setUnderlying(val)}
        data={props.availableUnderlyings.map((u) => ({ value: u, label: u }))}
        leftSection={<span class={CHAIN_LABEL_CLASS}>Underlying</span>}
        data-testid="underlying-select"
      />
      <label class="sr-only" for="chain-expiry-select">Expiry</label>
      <Select
        id="chain-expiry-select"
        size="xs"
        w={118}
        h={CHAIN_CONTROL_H}
        className={CHAIN_SELECT_CLASS}
        value={props.selectedExpiry}
        onChange={(val) => val && props.setExpiry(val)}
        data={props.availableExpiries.map((e) => ({ value: e, label: e }))}
        leftSection={<span class={CHAIN_LABEL_CLASS}>Expiry</span>}
        data-testid="expiry-select"
      />
    </Box>
  );
}