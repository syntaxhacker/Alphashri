import { Select } from "@/ui";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";

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
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", p: 1 }}>
      <Grid
        container
        spacing={1}
        id="chain-header-controls"
        data-testid="options-chain-header-controls"
        sx={{ justifyContent: "center", alignItems: "center", width: "100%" }}
      >
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", maxWidth: 360 }}>
            <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
              Underlying
            </Box>
            <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
              <Select
                value={selectedUnderlying}
                onChange={(val) => val && setUnderlying(val)}
                data={availableUnderlyings.map((u) => ({ value: u, label: u }))}
                data-testid="underlying-select"
              />
            </Box>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", maxWidth: 360 }}>
            <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
              Expiry
            </Box>
            <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
              <Select
                value={selectedExpiry}
                onChange={(val) => val && setExpiry(val)}
                data={availableExpiries.map((e) => ({ value: e, label: e }))}
                data-testid="expiry-select"
              />
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
