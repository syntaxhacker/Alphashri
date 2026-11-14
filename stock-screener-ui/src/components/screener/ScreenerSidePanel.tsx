import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Text, Select, NumberInput, Divider, Button, Box, Stack, Paper } from "@/ui";
import type { ScreenerOption, ProfileFilter } from "../../types";
import { subscribe, profileMetaById, profileFilters, setProfileFilters } from "../../state";
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
  const filters = profileMetaById[activeScreener]?.filters;
  return Array.isArray(filters) && filters.length > 0;
}

function handleFilterChange(key: string, value: number | string | null) {
  const newFilters = { ...profileFilters };
  if (value === null || value === undefined || value === "") {
    delete newFilters[key];
  } else {
    newFilters[key] = value;
  }
  setProfileFilters(newFilters);
}

// src/hooks/useStoreSubscription.ts's useStoreSnapshot misses its createMemo
// import, so the snapshot is inlined here with the same semantics.
function useStateSnapshot() {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubscribe = subscribe(() => setTick((n) => n + 1));
    onCleanup(unsubscribe);
  });
  return createMemo(() => {
    tick();
    return { profileMetaById, profileFilters };
  });
}

export function ScreenerSidePanel(props: Props) {
  const store = useStateSnapshot();
  const filters = () => store().profileMetaById[props.activeScreener]?.filters || [];

  const handleApplyFilters = () => {
    fetchData("upstox", "intraday", props.activeScreener, "manual");
  };

  const renderFilter = (filter: ProfileFilter) => {
    const value = () => store().profileFilters[filter.key];

    if (filter.type === "select" && filter.options) {
      const selectData = normalizeSelectFilterOptions(filter.options);
      return (
        <div className="p-0 rounded-sm flex items-center w-full" data-filter={filter.key}>
          <Stack spacing={0.5} className="w-full p-2">
            <Text size="xs" c="dimmed">
              {filter.label}
            </Text>
            <Select
              data={selectData}
              value={
                value() !== undefined && value() !== null && value() !== ""
                  ? String(value())
                  : filter.default !== undefined
                    ? String(filter.default)
                    : null
              }
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
      <div className="p-0 rounded-sm flex items-center w-full" data-filter={filter.key}>
        <Stack spacing={0.5} className="w-full p-2">
          <Text size="xs" c="dimmed">
            {filter.label}
          </Text>
          <NumberInput
            value={(value() as number) || filter.default || ""}
            onChange={(val: number | string) => handleFilterChange(filter.key, Number(val) || 0)}
            min={filter.min}
            max={filter.max}
            step={filter.step}
            size="xs"
            aria-label={filter.label}
          />
        </Stack>
      </div>
    );
  };

  return (
    <Show when={filters().length > 0}>
      <Paper
        data-testid="screener-side-panel"
        w={148}
        className="flex-shrink-0 flex flex-col overflow-hidden border border-fin-border"
      >
        <Box p={1} className="flex flex-col gap-2">
          <Box className="flex items-center justify-between gap-2 px-1">
            <Text className="text-[11px]" fw={600} c="dimmed" tt="uppercase">
              Filters
            </Text>
          </Box>
          <Stack gap={1} className="p-0 w-full">
            <For each={filters()}>{renderFilter}</For>
          </Stack>
          <Divider className="my-1" />
          <Box className="flex justify-center w-full pt-1">
            <Button size="xs" variant="light" onClick={handleApplyFilters} fullWidth>
              Apply filters
            </Button>
          </Box>
        </Box>
      </Paper>
    </Show>
  );
}
