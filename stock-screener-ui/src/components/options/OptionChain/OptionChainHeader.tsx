import { Select } from "@/ui";
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
    <Box
      id="chain-header-controls"
      data-testid="options-chain-header-controls"
      sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, rowGap: 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: "1 1 160px", maxWidth: 280 }}>
        <Box component="span" sx={{ minWidth: 64, fontSize: "0.75rem", color: "text.secondary", flexShrink: 0 }}>
          Underlying
        </Box>
        <Box sx={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center" }}>
          <Select
            value={selectedUnderlying}
            onChange={(val) => val && setUnderlying(val)}
            data={availableUnderlyings.map((u) => ({ value: u, label: u }))}
            data-testid="underlying-select"
          />
        </Box>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: "1 1 160px", maxWidth: 280 }}>
        <Box component="span" sx={{ minWidth: 64, fontSize: "0.75rem", color: "text.secondary", flexShrink: 0 }}>
          Expiry
        </Box>
        <Box sx={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center" }}>
          <Select
            value={selectedExpiry}
            onChange={(val) => val && setExpiry(val)}
            data={availableExpiries.map((e) => ({ value: e, label: e }))}
            data-testid="expiry-select"
          />
        </Box>
      </Box>
    </Box>
  );
}
