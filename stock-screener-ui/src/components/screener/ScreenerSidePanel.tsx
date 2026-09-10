import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import CardContent from "@mui/material/CardContent";
import { Text, Select, NumberInput, Divider, Button } from "@/ui";
import type { ScreenerOption, ProfileFilter } from "../../types";
import * as state from "../../state";
import { fetchData } from "../../api";

interface Props {
  activeScreener: string;
  screenerOptions: ScreenerOption[];
}

/** MUI Select expects { value, label }[]; API may send string[] or number[]. */
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
      <ListItemButton
        key={filter.key}
        selected={false}
        disableRipple
        sx={{ p: 0, borderRadius: 1, display: "flex", alignItems: "center", width: "100%" }}
      >
        <Stack spacing={0.5} sx={{ width: "100%", p: 0.5 }}>
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
      </ListItemButton>
    );
  }

  return (
    <ListItemButton
      key={filter.key}
      selected={false}
      disableRipple
      sx={{ p: 0, borderRadius: 1, display: "flex", alignItems: "center", width: "100%" }}
    >
      <Stack spacing={0.5} sx={{ width: "100%", p: 0.5 }}>
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
    </ListItemButton>
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
      elevation={1}
      sx={{ width: 148, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
      data-testid="screener-side-panel"
    >
      <CardContent sx={{ p: 1, "&:last-child": { pb: 1 }, display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 0.5 }}>
          <Text size="11px" fw={600} c="dimmed" tt="uppercase">
            Filters
          </Text>
        </Box>
        <List sx={{ display: "flex", flexDirection: "column", gap: 1, p: 0, width: "100%" }}>
          <Stack spacing={1} sx={{ width: "100%", gap: 1 }}>
            {filters.map(renderFilter)}
          </Stack>
        </List>
        <Divider sx={{ my: 0.5 }} />
        <Box sx={{ display: "flex", justifyContent: "center", width: "100%", pt: 0.5 }}>
          <Button size="xs" variant="light" onClick={handleApplyFilters} fullWidth>
            Apply filters
          </Button>
        </Box>
      </CardContent>
    </Paper>
  );
}
