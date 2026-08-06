import { Group, NumberInput } from "@/ui";

interface SlTpRowProps {
  slDefault?: number;
  tpDefault?: number;
  isSwing: boolean;
}

export function SlTpRow({ slDefault, tpDefault, isSwing }: SlTpRowProps) {
  return (
    <Group grow>
      <NumberInput
        size="sm"
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
        size="sm"
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
