import { Show, createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Badge, Button, Paper, Text } from "@/ui";
import { subscribe, profileMetaById } from "../../state";
import { fetchData } from "../../api";
import * as palette from "@/ui/palette";

interface ScreenerInlineFiltersProps {
  activeScreener: string;
  embedded?: boolean;
  /** Context-band status ("265 stocks"); shares the row, never a row of its own. */
  status?: string;
  /** One-line notices (52W source note, warning) shown in the same band. */
  notes?: string[];
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

const ROW_CLASS =
  "flex items-center gap-2 px-2 h-[24px] min-h-[24px] flex-nowrap overflow-hidden flex-shrink-0 bg-fin-surface";

export function ScreenerInlineFilters(props: ScreenerInlineFiltersProps) {
  const store = useStateSnapshot();
  const profileMeta = () => store().profileMetaById?.[props.activeScreener];
  const filters = (): any[] => profileMeta()?.filters || [];
  const notes = () => props.notes ?? [];
  const status = () => props.status ?? "";
  const embedded = () => props.embedded ?? false;
  const hasContent = () => filters().length > 0 || notes().length > 0 || status().length > 0;

  const trailing = (
    <>
      <FilterNotes notes={notes()} />
      <Show when={status()}>
        <Text className="text-[11px]" c="dimmed" truncate data-testid="screener-status" title={status()}>
          {status()}
        </Text>
      </Show>
    </>
  );

  return (
    <Show when={hasContent()}>
      <Show
        when={embedded()}
        fallback={
          <Paper
            elevation={0}
            data-testid="screener-inline-filters"
            className={`${ROW_CLASS} border border-fin-border rounded-fin`}
          >
            <FilterChips
              filters={filters()}
              activeScreener={props.activeScreener}
              trailing={trailing}
            />
          </Paper>
        }
      >
        <Box data-testid="screener-inline-filters" className={ROW_CLASS}>
          <FilterChips
            filters={filters()}
            activeScreener={props.activeScreener}
            trailing={trailing}
          />
        </Box>
      </Show>
    </Show>
  );
}

function FilterNotes(props: { notes: string[] }) {
  return (
    <Show when={props.notes.length > 0}>
      <Text
        c="dimmed"
        truncate
        className="text-[11px] min-w-0 flex-shrink"
        title={props.notes.join(" · ")}
        data-testid="screener-52w-high-banner"
      >
        {props.notes.join(" · ")}
      </Text>
    </Show>
  );
}

function FilterChips(props: { filters: any[]; activeScreener: string; trailing?: JSX.Element }) {
  const hasFilters = () => props.filters.length > 0;
  return (
    <>
      <Show when={hasFilters()}>
        <Text className="text-[11px] flex-shrink-0" c="dimmed" fw={600}>
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
                "font-size": "11px",
                height: "24px",
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
      </Show>
      <Box className="flex-1" />
      {props.trailing}
      <Show when={hasFilters()}>
        <Button
          size="xs"
          variant="outline"
          color="inherit"
          data-testid="apply-filters-btn"
          onClick={() => fetchData("upstox", "intraday", props.activeScreener, "manual")}
          style={{ "font-size": "11px", height: "24px", "text-transform": "none" }}
        >
          Apply
        </Button>
      </Show>
    </>
  );
}