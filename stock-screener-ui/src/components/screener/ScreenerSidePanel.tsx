import { Text, Select, NumberInput, Divider, Button, Box, Stack, Paper } from "@/ui";
import type { ScreenerOption, ProfileFilter } from "../../types";
import * as state from "../../state";
import { fetchData } from "../../api";

interface Props {
  activeScreener: string;
  screenerOptions: ScreenerOption[];
}

/** @/ui Select expects { value, label }[]; API may send string[] or number[]. */
export function normalizeSelectFilterOptions(
  options: ProfileFilter["options"],
): { value: string; label: string }[] {
  if (!options?.length) return [];
  return options.map((opt) => {
    if (typeof opt === "object" && opt !== null && "value" in opt) {
      const v = String(opt.value);
      return { value: v, label: opt.label ?? v };
    }
    const v = String(opt);
    return { value: v, label: v };
  });
}

/** Side panel only when profile has API-backed filter controls (not indicators/sort — those live in the table). */
export function screenerHasSideFilters(activeScreener: string): boolean {
  const filters = state.profileMetaById[activeScreener]?.filters;
  return Array.isArray(filters) && filters.length > 0;
}

function handleFilterChange(key: string, value: number | string | null) {
  const newFilters = { ...state.profileFilters };
  if (value === null || value === undefined || value === "") {
    delete newFilters[key];
  } else {
    newFilters[key] = value;
  }
  state.setProfileFilters(newFilters);
}

function renderFilter(filter: ProfileFilter) {
  const value = state.profileFilters[filter.key];

  if (filter.type === "select" && filter.options) {
    const selectData = normalizeSelectFilterOptions(filter.options);
    const selected =
      value !== undefined && value !== null && value !== ""
        ? String(value)
        : filter.default !== undefined
          ? String(filter.default)
          : null;
    return (
      <div key={filter.key} className="p-0 rounded-sm flex items-center w-full" data-filter={filter.key}>
        <Stack spacing={0.5} className="w-full p-2">
          <Text size="xs" c="dimmed">
            {filter.label}
          </Text>
          <Select
            data={selectData}
            value={selected}
            onChange={(val) => handleFilterChange(filter.key, val)}
            size="xs"
            clearable
            aria-label={filter.label}
          />
        </Stack>
      </div>
    );
  }

  return (
    <div key={filter.key} className="p-0 rounded-sm flex items-center w-full" data-filter={filter.key}>
      <Stack spacing={0.5} className="w-full p-2">
        <Text size="xs" c="dimmed">
          {filter.label}
        </Text>
        <NumberInput
          value={(value as number) || filter.default || ""}
          onChange={(val) => handleFilterChange(filter.key, val as number)}
          min={filter.min}
          max={filter.max}
          step={filter.step}
          size="xs"
          aria-label={filter.label}
        />
      </Stack>
    </div>
  );
}

export function ScreenerSidePanel({ activeScreener }: Props) {
  const profileMeta = state.profileMetaById[activeScreener];
  const filters = profileMeta?.filters || [];

  if (filters.length === 0) {
    return null;
  }

  const handleApplyFilters = () => {
    fetchData("upstox", "intraday", activeScreener, "manual");
  };

  return (
    <Paper
      data-testid="screener-side-panel"
      w={148}
      className="flex-shrink-0 flex flex-col overflow-hidden border border-fin-border"
    >
      <Box p={1} className="flex flex-col gap-2">
        <Box className="flex items-center justify-between gap-2 px-1">
          <Text size="11px" fw={600} c="dimmed" tt="uppercase">
            Filters
          </Text>
        </Box>
        <Stack gap={1} className="p-0 w-full">
          {filters.map(renderFilter)}
        </Stack>
        <Divider className="my-1" />
        <Box className="flex justify-center w-full pt-1">
          <Button size="xs" variant="light" onClick={handleApplyFilters} fullWidth>
            Apply filters
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}
