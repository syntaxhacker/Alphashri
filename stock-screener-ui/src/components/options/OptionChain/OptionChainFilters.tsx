import { Select, NumberInput } from "@/ui";
import Box from "@mui/material/Box";

export function OptionChainFilters({
  filters,
  setFilters,
}: {
  filters: any;
  setFilters: (f: any) => void;
}) {
  return (
    <Box
      id="chain-filters"
      data-testid="options-chain-filters"
      sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, rowGap: 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: "1 1 140px", maxWidth: 220 }}>
        <Box component="span" sx={{ minWidth: 64, fontSize: "0.75rem", color: "text.secondary", flexShrink: 0 }}>
          Type
        </Box>
        <Box sx={{ flex: 1, minWidth: 110, display: "flex", alignItems: "center" }}>
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
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: "1 1 120px", maxWidth: 200 }}>
        <Box component="span" sx={{ minWidth: 64, fontSize: "0.75rem", color: "text.secondary", flexShrink: 0 }}>
          Moneyness
        </Box>
        <Box sx={{ flex: 1, minWidth: 90, display: "flex", alignItems: "center" }}>
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
      <Box
        data-testid="options-strike-range-group"
        sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, rowGap: 1, flex: "1 1 200px", maxWidth: 340 }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: "1 1 100px", maxWidth: 170 }}>
          <Box component="span" sx={{ minWidth: 64, fontSize: "0.75rem", color: "text.secondary", flexShrink: 0 }}>
            Strike Min
          </Box>
          <Box sx={{ flex: 1, minWidth: 80, display: "flex", alignItems: "center" }}>
            <NumberInput
              value={filters.strikeRange?.[0] ?? 0}
              onChange={(val) =>
                setFilters({ strikeRange: [val as number, filters.strikeRange?.[1] ?? 100000] })
              }
              data-testid="strike-min-input"
            />
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: "1 1 100px", maxWidth: 170 }}>
          <Box component="span" sx={{ minWidth: 40, fontSize: "0.75rem", color: "text.secondary", flexShrink: 0 }}>
            Max
          </Box>
          <Box sx={{ flex: 1, minWidth: 80, display: "flex", alignItems: "center" }}>
            <NumberInput
              value={filters.strikeRange?.[1] ?? 100000}
              onChange={(val) =>
                setFilters({ strikeRange: [filters.strikeRange?.[0] ?? 0, val as number] })
              }
              data-testid="strike-max-input"
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
