import { Group, Select, NumberInput } from "@/ui";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";

export function OptionChainFilters({
  filters,
  setFilters,
}: {
  filters: any;
  setFilters: (f: any) => void;
}) {
  return (
    <Grid container spacing={2} id="chain-filters" data-testid="options-chain-filters">
      <Grid size={{ xs: 12, md: 3 }}>
        <Select
          label="Type"
          value={filters.optionType}
          onChange={(val) => val && setFilters({ optionType: val as "CE" | "PE" | "BOTH" })}
          data={[
            { value: "BOTH", label: "Both CE/PE" },
            { value: "CE", label: "Calls Only" },
            { value: "PE", label: "Puts Only" },
          ]}
          data-testid="option-type-select"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 3 }}>
        <Select
          label="Moneyness"
          value={filters.moneyness}
          onChange={(val) => val && setFilters({ moneyness: val as "ITM" | "OTM" | "ALL" })}
          data={[
            { value: "ALL", label: "All" },
            { value: "ITM", label: "ITM" },
            { value: "OTM", label: "OTM" },
          ]}
          data-testid="moneyness-select"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Grid container spacing={1} alignItems="flex-end" data-testid="options-strike-range-group">
          <Grid size={6}>
            <NumberInput
              label="Strike Min"
              value={filters.strikeRange?.[0] ?? 0}
              onChange={(val) =>
                setFilters({ strikeRange: [val as number, filters.strikeRange?.[1] ?? 100000] })
              }
              data-testid="strike-min-input"
            />
          </Grid>
          <Grid size={6}>
            <NumberInput
              label="Max"
              value={filters.strikeRange?.[1] ?? 100000}
              onChange={(val) =>
                setFilters({ strikeRange: [filters.strikeRange?.[0] ?? 0, val as number] })
              }
              data-testid="strike-max-input"
            />
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  );
}
