import {
  Stack,
  Text,
  Select,
  NumberInput,
  Divider,
  Box,
  Button,
} from "@mantine/core";
import type { ScreenerOption, ProfileFilter, SortDirection } from "../../types";
import * as state from "../../state";
import { fetchData } from "../../api";

interface Props {
  activeScreener: string;
  screenerOptions: ScreenerOption[];
  sortColumn: string | null;
  sortDirection: SortDirection;
}

/** Mantine Select expects { value, label }[]; API may send string[] or number[]. */
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

export function ScreenerSidePanel({
  activeScreener,
}: Props) {
  const profileMeta = state.profileMetaById[activeScreener];
  const filters = profileMeta?.filters || [];

  if (filters.length === 0) {
    return null;
  }

  const handleFilterChange = (key: string, value: number | string | null) => {
    const newFilters = { ...state.profileFilters };
    if (value === null || value === undefined || value === "") {
      delete newFilters[key];
    } else {
      newFilters[key] = value;
    }
    state.setProfileFilters(newFilters);
  };

  const handleApplyFilters = () => {
    fetchData("upstox", "intraday", activeScreener, "manual");
  };

  const renderFilter = (filter: ProfileFilter) => {
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
        <Select
          key={filter.key}
          label={filter.label}
          data={selectData}
          value={selected}
          onChange={(val) => handleFilterChange(filter.key, val)}
          size="xs"
          clearable
        />
      );
    }

    return (
      <NumberInput
        key={filter.key}
        label={filter.label}
        value={(value as number) || filter.default || ""}
        onChange={(val) => handleFilterChange(filter.key, val as number)}
        min={filter.min}
        max={filter.max}
        step={filter.step}
        size="xs"
      />
    );
  };

  return (
    <Box
      style={{
        width: 148,
        padding: 6,
        borderRight: "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
        overflowY: "auto",
        flexShrink: 0,
      }}
      data-testid="screener-side-panel"
    >
      <Stack gap={4}>
        <Text size="10px" fw={600} c="dimmed" tt="uppercase">
          Filters
        </Text>
        <Stack gap={4}>{filters.map(renderFilter)}</Stack>
        <Divider my={2} />
        <Button size="xs" variant="light" onClick={handleApplyFilters} fullWidth>
          Apply filters
        </Button>
      </Stack>
    </Box>
  );
}