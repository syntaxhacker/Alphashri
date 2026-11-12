import { Show, createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import { Box, Badge, Button, Paper, Text } from "@/ui";
import { subscribe, profileMetaById } from "../../state";
import { fetchData } from "../../api";
import * as palette from "@/ui/palette";

interface ScreenerInlineFiltersProps {
  activeScreener: string;
  embedded?: boolean;
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
    return { profileMetaById };
  });
}

export function ScreenerInlineFilters(props: ScreenerInlineFiltersProps) {
  const store = useStateSnapshot();
  const profileMeta = () => store().profileMetaById?.[props.activeScreener];
  const filters = (): any[] => profileMeta()?.filters || [];
  const embedded = () => props.embedded ?? false;

  const rowClass = "flex items-center gap-2 px-3 py-2 flex-wrap flex-shrink-0 bg-fin-surface";

  return (
    <Show when={filters().length > 0}>
      <Show
        when={embedded()}
        fallback={
          <Paper
            elevation={0}
            data-testid="screener-inline-filters"
            className={`${rowClass} border border-fin-border rounded-fin`}
          >
            <FilterChips
              filters={filters()}
              activeScreener={props.activeScreener}
            />
          </Paper>
        }
      >
        <Box data-testid="screener-inline-filters" className={`${rowClass} border-b border-fin-border`}>
          <FilterChips
            filters={filters()}
            activeScreener={props.activeScreener}
          />
        </Box>
      </Show>
    </Show>
  );
}

function FilterChips(props: { filters: any[]; activeScreener: string }) {
  return (
    <>
      <Text size="11px" c="dimmed" fw={600}>
        Filters:
      </Text>
      <For each={props.filters}>
        {(f: any) => (
          <Badge
            size="xs"
            variant="light"
            color="secondary"
            title={f.label}
            data-testid={`filter-chip-${f.key}`}
            style={{
              "font-size": 11,
              height: 24,
              "background-color": palette.SURFACE_ALT,
              color: palette.TEXT,
              border: `1px solid ${palette.BORDER}`,
              "border-radius": 0,
            }}
          >
            {f.label || f.key}
          </Badge>
        )}
      </For>
      <Box className="flex-1" />
      <Button
        size="xs"
        variant="outline"
        color="inherit"
        data-testid="apply-filters-btn"
        onClick={() => fetchData("upstox", "intraday", props.activeScreener, "manual")}
        style={{ "font-size": 11, height: 24, "text-transform": "none" }}
      >
        Apply
      </Button>
    </>
  );
}
