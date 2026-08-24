import { Box, Stack, Text, NumberInput } from "@/ui";

interface SlTpRowProps {
  slDefault?: number;
  tpDefault?: number;
  isSwing: boolean;
}

export function SlTpRow({ slDefault, tpDefault, isSwing }: SlTpRowProps) {
  return (
    <Stack spacing={1} sx={{ gap: 1, p: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
        <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Stop Loss %</Text>
        <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
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
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
        <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Take Profit %</Text>
        <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
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
