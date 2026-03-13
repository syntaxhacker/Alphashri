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
      id="screener-nav"
      className="screener-nav"
      data={options.map((option) => ({
        value: option.id,
        label: option.description ? (
          <Tooltip label={option.description} withArrow>
            <span data-testid={`screener-nav-option-${option.id}`}>{option.label}</span>
          </Tooltip>
        ) : (
          <span data-testid={`screener-nav-option-${option.id}`}>{option.label}</span>
        ),
      }))}
    />
  );
}
