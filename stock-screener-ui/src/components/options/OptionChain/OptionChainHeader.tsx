import { Group, Select } from "@/ui";
import Grid from "@mui/material/Grid";

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
    <Grid container spacing={2} id="chain-header-controls" data-testid="options-chain-header-controls">
      <Grid size={{ xs: 12, md: 6 }}>
        <Select
          label="Underlying"
          value={selectedUnderlying}
          onChange={(val) => val && setUnderlying(val)}
          data={availableUnderlyings.map((u) => ({ value: u, label: u }))}
          data-testid="underlying-select"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Select
          label="Expiry"
          value={selectedExpiry}
          onChange={(val) => val && setExpiry(val)}
          data={availableExpiries.map((e) => ({ value: e, label: e }))}
          data-testid="expiry-select"
        />
      </Grid>
    </Grid>
  );
}
