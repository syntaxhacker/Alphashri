import { Stack, Text, Badge, Select, NumberInput, Divider, Group, Box, Button } from "@mantine/core";
import type { ScreenerOption, ProfileFilter, SortDirection } from "../../types";
import * as state from "../../state";
import { fetchData } from "../../api";

interface Props {
  activeScreener: string;
  screenerOptions: ScreenerOption[];
  sortColumn: string | null;
  sortDirection: SortDirection;
}

export function ScreenerSidePanel({
  activeScreener,
  screenerOptions,
  sortColumn,
  sortDirection,
}: Props) {
  const activeOption = screenerOptions.find((o) => o.id === activeScreener);
  const profileMeta = state.profileMetaById[activeScreener];
  const filters = profileMeta?.filters || [];

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

  const handleSortChange = (column: string) => {
    if (state.sortColumn === column) {
      state.setSortDirection(state.sortDirection === "asc" ? "desc" : "asc");
    } else {
      state.setSortColumn(column);
      state.setSortDirection("desc");
    }
  };

  const renderFilter = (filter: ProfileFilter) => {
    const value = state.profileFilters[filter.key];

    if (filter.type === "select" && filter.options) {
      return (
        <Select
          key={filter.key}
          label={filter.label}
          data={filter.options}
          value={(value as string) || null}
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
        width: 220,
        padding: 12,
        borderRight: "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
        overflowY: "auto",
      }}
    >
      <Stack gap="xs">
        <Text fw={600} size="sm">
          SCREENER
        </Text>

        {activeOption && (
          <>
            <Text size="sm" fw={500}>
              {activeOption.label}
            </Text>
            {activeOption.description && (
              <Text size="xs" c="dimmed" lineClamp={2}>
                {activeOption.description}
              </Text>
            )}
          </>
        )}

        {activeOption?.indicators && activeOption.indicators.length > 0 && (
          <>
            <Divider my={4} />
            <Text size="xs" fw={600} c="dimmed">
              INDICATORS
            </Text>
            <Group gap={4}>
              {activeOption.indicators.map((ind) => (
                <Badge key={ind} size="sm" variant="light" color="blue">
                  {ind}
                </Badge>
              ))}
            </Group>
          </>
        )}

        {filters.length > 0 && (
          <>
            <Divider my={4} />
            <Text size="xs" fw={600} c="dimmed">
              FILTERS
            </Text>
            <Stack gap="xs">{filters.map(renderFilter)}</Stack>
          </>
        )}

        <Divider my={4} />

        <Text size="xs" fw={600} c="dimmed">
          SORT
        </Text>
        {profileMeta?.default_sort && (
          <Button
            size="xs"
            variant={sortColumn === profileMeta.default_sort.column ? "filled" : "light"}
            color={sortColumn === profileMeta.default_sort.column ? "blue" : "gray"}
            onClick={() => handleSortChange(profileMeta.default_sort!.column)}
            fullWidth
          >
            {profileMeta.default_sort.column}{" "}
            {sortColumn === profileMeta.default_sort.column &&
              (sortDirection === "asc" ? "↑" : "↓")}
          </Button>
        )}

        {filters.length > 0 && (
          <>
            <Divider my={4} />
            <Text
              size="xs"
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={handleApplyFilters}
            >
              Apply Filters
            </Text>
          </>
        )}
      </Stack>
    </Box>
  );
}