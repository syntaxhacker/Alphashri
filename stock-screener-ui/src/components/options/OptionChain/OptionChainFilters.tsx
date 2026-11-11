import { Select, NumberInput, Box } from "@/ui";

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
      className="flex items-center flex-wrap"
      alignItems="center"
      gap={1}
    >
      <Box className="flex items-center" flex="1 1 140px" maw={220} gap={1}>
        <span className="min-w-[64px] text-[0.75rem] text-fin-text-muted shrink-0">
          Type
        </span>
        <Box className="flex items-center min-w-[110px] flex-1">
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
      <Box className="flex items-center" flex="1 1 120px" maw={200} gap={1}>
        <span className="min-w-[64px] text-[0.75rem] text-fin-text-muted shrink-0">
          Moneyness
        </span>
        <Box className="flex items-center min-w-[90px] flex-1">
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
        className="flex items-center flex-wrap"
        flex="1 1 200px"
        maw={340}
        alignItems="center"
        gap={1}
      >
        <Box className="flex items-center" flex="1 1 100px" maw={170} gap={1}>
          <span className="min-w-[64px] text-[0.75rem] text-fin-text-muted shrink-0">
            Strike Min
          </span>
          <Box className="flex items-center min-w-[80px] flex-1">
            <NumberInput
              value={filters.strikeRange?.[0] ?? 0}
              onChange={(val) =>
                setFilters({ strikeRange: [val as number, filters.strikeRange?.[1] ?? 100000] })}
              data-testid="strike-min-input"
            />
          </Box>
        </Box>
        <Box className="flex items-center" flex="1 1 100px" maw={170} gap={1}>
          <span className="min-w-[40px] text-[0.75rem] text-fin-text-muted shrink-0">
            Max
          </span>
          <Box className="flex items-center min-w-[80px] flex-1">
            <NumberInput
              value={filters.strikeRange?.[1] ?? 100000}
              onChange={(val) =>
                setFilters({ strikeRange: [filters.strikeRange?.[0] ?? 0, val as number] })}
              data-testid="strike-max-input"
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
