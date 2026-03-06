import { SegmentedControl, Tooltip } from "@mantine/core";

interface ScreenerOption {
  id: string;
  label: string;
  description?: string;
}

interface ScreenerNavProps {
  options: ScreenerOption[];
  activeScreener: string;
  onChange: (id: string) => void;
}

export function ScreenerNav({ options, activeScreener, onChange }: ScreenerNavProps) {
  return (
    <SegmentedControl
      fullWidth
      value={activeScreener}
      onChange={onChange}
      data-testid="screener-nav"
      data={options.map((option) => ({
        value: option.id,
        label: option.description ? (
          <Tooltip label={option.description} withArrow>
            <span>{option.label}</span>
          </Tooltip>
        ) : (
          option.label
        ),
      }))}
    />
  );
}
