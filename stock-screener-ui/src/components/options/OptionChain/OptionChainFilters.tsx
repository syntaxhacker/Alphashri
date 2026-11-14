import { Select, NumberInput, Box } from "@/ui";
import { CHAIN_CONTROL_H, CHAIN_LABEL_CLASS, CHAIN_SELECT_CLASS } from "./controlClass";

export function OptionChainFilters(props: {
  filters: any;
  setFilters: (f: any) => void;
}) {
  return (
    <Box
      id="chain-filters"
      data-testid="options-chain-filters"
      className="flex items-center gap-2 flex-nowrap shrink-0 min-w-0"
    >
      <label class="sr-only" for="option-type-select">Option type</label>
      <Select
        id="option-type-select"
        value={props.filters.optionType}
        onChange={(val) => val && props.setFilters({ optionType: val as "CE" | "PE" | "BOTH" })}
        data={[
          { value: "BOTH", label: "Both CE/PE" },
          { value: "CE", label: "Calls Only" },
          { value: "PE", label: "Puts Only" },
        ]}
        size="xs"
        h={CHAIN_CONTROL_H}
        w={124}
        className={CHAIN_SELECT_CLASS}
        leftSection={<span class={CHAIN_LABEL_CLASS}>Type</span>}
        data-testid="option-type-select"
      />
      <label class="sr-only" for="moneyness-select">Moneyness</label>
      <Select
        id="moneyness-select"
        value={props.filters.moneyness}
        onChange={(val) => val && props.setFilters({ moneyness: val as "ITM" | "OTM" | "ALL" })}
        data={[
          { value: "ALL", label: "All" },
          { value: "ITM", label: "ITM" },
          { value: "OTM", label: "OTM" },
        ]}
        size="xs"
        h={CHAIN_CONTROL_H}
        w={112}
        className={CHAIN_SELECT_CLASS}
        leftSection={<span class={CHAIN_LABEL_CLASS}>Moneyness</span>}
        data-testid="moneyness-select"
      />
      <Box
        data-testid="options-strike-range-group"
        className="flex items-center gap-2 shrink-0"
      >
        <label class="sr-only" for="strike-min-input">Strike Min</label>
        <NumberInput
          id="strike-min-input"
          value={props.filters.strikeRange?.[0] ?? 0}
          onChange={(val) =>
            props.setFilters({ strikeRange: [val as number, props.filters.strikeRange?.[1] ?? 100000] })}
          size="xs"
          h={CHAIN_CONTROL_H}
          w={132}
          leftSection={<span class={CHAIN_LABEL_CLASS}>Strike Min</span>}
          data-testid="strike-min-input"
        />
        <label class="sr-only" for="strike-max-input">Max</label>
        <NumberInput
          id="strike-max-input"
          value={props.filters.strikeRange?.[1] ?? 100000}
          onChange={(val) =>
            props.setFilters({ strikeRange: [props.filters.strikeRange?.[0] ?? 0, val as number] })}
          size="xs"
          h={CHAIN_CONTROL_H}
          w={108}
          leftSection={<span class={CHAIN_LABEL_CLASS}>Max</span>}
          data-testid="strike-max-input"
        />
      </Box>
    </Box>
  );
}