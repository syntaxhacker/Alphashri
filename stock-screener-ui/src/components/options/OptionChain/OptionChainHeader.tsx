import { Select, ToolbarRow } from "@/ui";

export function OptionChainHeader({
  selectedUnderlying,
  selectedExpiry,
  setUnderlying,
  setExpiry,
  availableUnderlyings,
  availableExpiries,
}: {
  selectedUnderlying: string;
  selectedExpiry: string;
  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  availableUnderlyings: string[];
  availableExpiries: string[];
}) {
  return (
    <ToolbarRow
      id="chain-header-controls"
      data-testid="options-chain-header-controls"
      justify="center"
      gap={8}
    >
      <Select
        w={220}
        size="sm"
        label="Underlying"
        value={selectedUnderlying}
        onChange={(val) => val && setUnderlying(val)}
        data={availableUnderlyings.map((u) => ({ value: u, label: u }))}
        data-testid="underlying-select"
      />
      <Select
        w={180}
        size="sm"
        label="Expiry"
        value={selectedExpiry}
        onChange={(val) => val && setExpiry(val)}
        data={availableExpiries.map((e) => ({ value: e, label: e }))}
        data-testid="expiry-select"
      />
    </ToolbarRow>
  );
}
