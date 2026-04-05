import { Group, NumberInput } from "@mantine/core";

interface SlTpRowProps {
  slDefault?: number;
  tpDefault?: number;
  isSwing: boolean;
}

export function SlTpRow({ slDefault, tpDefault, isSwing }: SlTpRowProps) {
  return (
    <Group grow>
      <NumberInput
        label="Stop Loss %"
        name="sl_pct"
        defaultValue={slDefault}
        min={0.1}
        max={isSwing ? 30 : 10}
        step={0.1}
        suffix="%"
        required
        data-testid="strategy-sl-pct-input"
      />
      <NumberInput
        label="Take Profit %"
        name="tp_pct"
        defaultValue={tpDefault}
        min={0.1}
        max={isSwing ? 20 : 10}
        step={isSwing ? 0.5 : 0.1}
        suffix="%"
        required={!isSwing}
        data-testid="strategy-tp-pct-input"
      />
    </Group>
  );
}
