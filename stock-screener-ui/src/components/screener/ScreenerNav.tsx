import { SegmentedControl, Tooltip } from "@mantine/core";
import type { ScreenerOption } from "../../types";

interface ScreenerNavProps {
  options: ScreenerOption[];
  activeScreener: string;
  onChange: (id: string) => void;
}

export function ScreenerNav({ options, activeScreener, onChange }: ScreenerNavProps) {
  const optionList = options ?? [];

  // Handle empty options by rendering a minimal container
  if (optionList.length === 0) {
    return (
      <div
        data-testid="screener-nav"
        id="screener-nav"
        className="screener-nav"
        data-options-count={0}
      />
    );
  }

  return (
    <SegmentedControl
      fullWidth
      value={activeScreener}
      onChange={onChange}
      data-testid="screener-nav"
      id="screener-nav"
      className="screener-nav"
      data-options-count={optionList.length}
      data={optionList.map((option) => ({
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
