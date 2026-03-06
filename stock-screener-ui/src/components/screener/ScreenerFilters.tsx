import { Paper, Group, NumberInput, Select, Button, Text } from '@mantine/core';

interface ProfileFilterDef {
  key: string;
  label: string;
  type: 'number' | 'select';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}

interface ScreenerFiltersProps {
  minScore: number;
  maxPrice: number;
  minReturn: number;
  sector: string;
  sectors: string[];
  profileFilters?: ProfileFilterDef[];
  profileFilterValues: Record<string, any>;
  onFilterChange: (key: string, value: any) => void;
  onReset: () => void;
}

export function ScreenerFilters({
  minScore,
  maxPrice,
  minReturn,
  sector,
  sectors,
  profileFilters = [],
  profileFilterValues,
  onFilterChange,
  onReset,
}: ScreenerFiltersProps) {
  const sectorOptions = sectors.map((s) => ({ value: s, label: s }));

  const renderProfileFilter = (filter: ProfileFilterDef) => {
    if (filter.type === 'number') {
      return (
        <NumberInput
          key={filter.key}
          label={filter.label}
          value={profileFilterValues[filter.key] ?? ''}
          onChange={(value) => onFilterChange(filter.key, value)}
          min={filter.min}
          max={filter.max}
          step={filter.step}
          style={{ minWidth: 120 }}
        />
      );
    }

    if (filter.type === 'select' && filter.options) {
      return (
        <Select
          key={filter.key}
          label={filter.label}
          value={profileFilterValues[filter.key] ?? ''}
          onChange={(value) => onFilterChange(filter.key, value)}
          data={filter.options}
          clearable
          style={{ minWidth: 140 }}
        />
      );
    }

    return null;
  };

  return (
    <Paper withBorder p="md" mb="md" data-testid="screener-filters">
      <Group gap="md" wrap="wrap" align="flex-end">
        <NumberInput
          label="Min Score"
          value={minScore}
          onChange={(value) => onFilterChange('minScore', value)}
          min={0}
          max={100}
          step={1}
          style={{ minWidth: 100 }}
          data-testid="min-score-input"
        />

        <NumberInput
          label="Max Price"
          value={maxPrice}
          onChange={(value) => onFilterChange('maxPrice', value)}
          min={0}
          step={1}
          style={{ minWidth: 100 }}
          data-testid="max-price-input"
        />

        <NumberInput
          label="Min Return %"
          value={minReturn}
          onChange={(value) => onFilterChange('minReturn', value)}
          step={0.5}
          decimalScale={2}
          style={{ minWidth: 120 }}
          data-testid="min-return-input"
        />

        <Select
          label="Sector"
          value={sector}
          onChange={(value) => onFilterChange('sector', value)}
          data={sectorOptions}
          clearable
          placeholder="All sectors"
          style={{ minWidth: 160 }}
          data-testid="sector-select"
        />

        {profileFilters.map(renderProfileFilter)}

        <Button variant="subtle" onClick={onReset} data-testid="reset-filters-btn">
          Reset
        </Button>
      </Group>
    </Paper>
  );
}
