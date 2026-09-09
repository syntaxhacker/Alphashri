import { Select, NumberInput } from "@/ui";
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
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", p: 1 }}>
      <Grid
        container
        spacing={1}
        id="chain-filters"
        data-testid="options-chain-filters"
        sx={{ justifyContent: "center", alignItems: "center", width: "100%" }}
      >
        <Grid size={{ xs: 12, md: 3 }} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", maxWidth: 260 }}>
            <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
              Type
            </Box>
            <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
              <Select
                value={filters.optionType}
                onChange={(val) => val && setFilters({ optionType: val as "CE" | "PE" | "BOTH" })}
                data={[
                  { value: "BOTH", label: "Both CE/PE" },
                  { value: "CE", label: "Calls Only" },
                  { value: "PE", label: "Puts Only" },
                ]}
                data-testid="option-type-select"
              />
            </Box>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, md: 3 }} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", maxWidth: 260 }}>
            <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
              Moneyness
            </Box>
            <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
              <Select
                value={filters.moneyness}
                onChange={(val) => val && setFilters({ moneyness: val as "ITM" | "OTM" | "ALL" })}
                data={[
                  { value: "ALL", label: "All" },
                  { value: "ITM", label: "ITM" },
                  { value: "OTM", label: "OTM" },
                ]}
                data-testid="moneyness-select"
              />
            </Box>
          </Box>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Grid container spacing={1} alignItems="center" justifyContent="center" sx={{ width: "100%" }} data-testid="options-strike-range-group">
            <Grid size={6} sx={{ display: "flex", justifyContent: "center" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", maxWidth: 200 }}>
                <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
                  Strike Min
                </Box>
                <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
                  <NumberInput
                    value={filters.strikeRange?.[0] ?? 0}
                    onChange={(val) =>
                      setFilters({ strikeRange: [val as number, filters.strikeRange?.[1] ?? 100000] })
                    }
                    data-testid="strike-min-input"
                  />
                </Box>
              </Box>
            </Grid>
            <Grid size={6} sx={{ display: "flex", justifyContent: "center" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", maxWidth: 200 }}>
                <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
                  Max
                </Box>
                <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
                  <NumberInput
                    value={filters.strikeRange?.[1] ?? 100000}
                    onChange={(val) =>
                      setFilters({ strikeRange: [filters.strikeRange?.[0] ?? 0, val as number] })
                    }
                    data-testid="strike-max-input"
                  />
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
}
