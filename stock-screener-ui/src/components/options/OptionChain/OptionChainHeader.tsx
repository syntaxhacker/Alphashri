import { Group, Select } from "@mantine/core";

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
    <Group
      id="chain-header-controls"
      className="chain-header-controls"
      grow
      data-testid="options-chain-header-controls"
    >
      <Select
        label="Underlying"
        value={selectedUnderlying}
        onChange={(val) => val && setUnderlying(val)}
        data={availableUnderlyings.map((u) => ({ value: u, label: u }))}
        className="chain-underlying-select"
        data-testid="underlying-select"
      />
      <Select
        label="Expiry"
        value={selectedExpiry}
        onChange={(val) => val && setExpiry(val)}
        data={availableExpiries.map((e) => ({ value: e, label: e }))}
        className="chain-expiry-select"
        data-testid="expiry-select"
      />
    </Group>
  );
}
