import { Select, NumberInput, Box } from "@/ui";

export function OptionChainFilters(props: {
  filters: any;
  setFilters: (f: any) => void;
}) {
  return (
    <Box
      id="chain-filters"
      data-testid="options-chain-filters"
      className="flex items-center gap-3 flex-nowrap shrink-0"
    >
      <Box className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-fin-text-muted">
          Type
        </span>
        <Select
          value={props.filters.optionType}
          onChange={(val) => val && props.setFilters({ optionType: val as "CE" | "PE" | "BOTH" })}
          data={[
            { value: "BOTH", label: "Both CE/PE" },
            { value: "CE", label: "Calls Only" },
            { value: "PE", label: "Puts Only" },
          ]}
          size="xs"
          h={22}
          w={118}
          data-testid="option-type-select"
        />
      </Box>
      <Box className="flex items-center gap-1 shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-fin-text-muted">
          Moneyness
        </span>
        <Select
          value={props.filters.moneyness}
          onChange={(val) => val && props.setFilters({ moneyness: val as "ITM" | "OTM" | "ALL" })}
          data={[
            { value: "ALL", label: "All" },
            { value: "ITM", label: "ITM" },
            { value: "OTM", label: "OTM" },
          ]}
          size="xs"
          h={22}
          w={86}
          data-testid="moneyness-select"
        />
      </Box>
      <Box
        data-testid="options-strike-range-group"
        className="flex items-center gap-1 shrink-0"
      >
        <Box className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-fin-text-muted">
            Strike Min
          </span>
          <NumberInput
            value={props.filters.strikeRange?.[0] ?? 0}
            onChange={(val) =>
              props.setFilters({ strikeRange: [val as number, props.filters.strikeRange?.[1] ?? 100000] })}
            size="xs"
            h={22}
            w={92}
            data-testid="strike-min-input"
          />
        </Box>
        <Box className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-fin-text-muted">
            Max
          </span>
          <NumberInput
            value={props.filters.strikeRange?.[1] ?? 100000}
            onChange={(val) =>
              props.setFilters({ strikeRange: [props.filters.strikeRange?.[0] ?? 0, val as number] })}
            size="xs"
            h={22}
            w={92}
            data-testid="strike-max-input"
          />
        </Box>
      </Box>
    </Box>
  );
}
