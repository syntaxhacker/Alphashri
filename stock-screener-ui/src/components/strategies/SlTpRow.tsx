import { Box, Stack, Text, NumberInput } from "@/ui";

interface SlTpRowProps {
  slDefault?: number;
  tpDefault?: number;
  isSwing: boolean;
}

export function SlTpRow({ slDefault, tpDefault, isSwing }: SlTpRowProps) {
  return (
    <Stack spacing={1} className="gap-2 p-2">
      <Box className="flex items-center gap-2 p-2">
        <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Stop Loss %</Text>
        <Box className="flex-1 flex items-center">
          <NumberInput
            size="sm"
            name="sl_pct"
            defaultValue={slDefault}
            min={0.1}
            max={isSwing ? 30 : 10}
            step={0.1}
            suffix="%"
            required
            data-testid="strategy-sl-pct-input"
          />
        </Box>
      </Box>
      <Box className="flex items-center gap-2 p-2">
        <Text size="sm" c="dimmed" className="min-w-[80px] flex items-center">Take Profit %</Text>
        <Box className="flex-1 flex items-center">
          <NumberInput
            size="sm"
            name="tp_pct"
            defaultValue={tpDefault}
            min={0.1}
            max={isSwing ? 20 : 10}
            step={isSwing ? 0.5 : 0.1}
            suffix="%"
            required={!isSwing}
            data-testid="strategy-tp-pct-input"
          />
        </Box>
      </Box>
    </Stack>
  );
}
