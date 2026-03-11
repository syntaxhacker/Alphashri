import { Group, Select, NumberInput } from "@mantine/core";

export function OptionChainFilters({
  filters,
  setFilters,
}: {
  filters: any;
  setFilters: (f: any) => void;
}) {
  return (
    <Group gap="md" wrap="nowrap">
      <Select
        label="Type"
        style={{ flex: 1 }}
        value={filters.optionType}
        onChange={(val) => val && setFilters({ optionType: val as "CE" | "PE" | "BOTH" })}
        data={[
          { value: "BOTH", label: "Both CE/PE" },
          { value: "CE", label: "Calls Only" },
          { value: "PE", label: "Puts Only" },
        ]}
        data-testid="option-type-select"
      />
      <Select
        label="Moneyness"
        style={{ flex: 1 }}
        value={filters.moneyness}
        onChange={(val) => val && setFilters({ moneyness: val as "ITM" | "OTM" | "ALL" })}
        data={[
          { value: "ALL", label: "All" },
          { value: "ITM", label: "ITM" },
          { value: "OTM", label: "OTM" },
        ]}
        data-testid="moneyness-select"
      />
      <Group style={{ flex: 2 }} align="flex-end">
        <NumberInput
          label="Strike Min"
          style={{ flex: 1 }}
          value={filters.strikeRange?.[0] ?? 0}
          onChange={(val) =>
            setFilters({ strikeRange: [val as number, filters.strikeRange?.[1] ?? 100000] })
          }
          data-testid="strike-min-input"
        />
        <NumberInput
          label="Max"
          style={{ flex: 1 }}
          value={filters.strikeRange?.[1] ?? 100000}
          onChange={(val) =>
            setFilters({ strikeRange: [filters.strikeRange?.[0] ?? 0, val as number] })
          }
          data-testid="strike-max-input"
        />
      </Group>
    </Group>
  );
}
