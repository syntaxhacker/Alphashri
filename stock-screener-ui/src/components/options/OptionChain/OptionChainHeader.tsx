import { Select, Box } from "@/ui";

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
      className="flex items-center flex-wrap"
      align-items="center"
      gap={1}
    >
      <Box className="flex items-center" flex="1 1 160px" maw={280} gap={1}>
        <span className="min-w-[64px] text-[0.75rem] text-fin-text-muted shrink-0">
          Underlying
        </span>
        <Box className="flex items-center" flex="1" miw={120}>
          <Select
            value={selectedUnderlying}
            onChange={(val) => val && setUnderlying(val)}
            data={availableUnderlyings.map((u) => ({ value: u, label: u }))}
            data-testid="underlying-select"
          />
        </Box>
      </Box>
      <Box className="flex items-center" flex="1 1 160px" maw={280} gap={1}>
        <span className="min-w-[64px] text-[0.75rem] text-fin-text-muted shrink-0">
          Expiry
        </span>
        <Box className="flex items-center" flex="1" miw={120}>
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
