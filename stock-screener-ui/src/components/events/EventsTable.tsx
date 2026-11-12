import { For, Show, createMemo } from "solid-js";
import { Box, Skeleton } from "@/ui";
import type { EventDTO } from "../../types/events";
import { TanStackTable } from "../common/TanStackTable";
import { EmptyState } from "../common/states";
import { buildEventColumns } from "./eventsColumns";

interface EventsTableProps {
  events: EventDTO[];
  isLoading: boolean;
  onOpen: (event: EventDTO) => void;
}

const SKELETON_ROWS = 8;

/**
 * Event calendar table.
 *
 * The populated/refreshing path is the shared `TanStackTable` (same props as
 * `ValueTable`). The first load and the empty state deliberately use the
 * design-system primitives the feature spec calls for — skeleton rows and the
 * shared `EmptyState` — instead of the table's generic spinner / "No data".
 */
export function EventsTable(props: EventsTableProps) {
  const columns = createMemo(() => buildEventColumns(props.onOpen));
  const rows = () => props.events;

  return (
    <Show
      when={!(props.isLoading && rows().length === 0)}
      fallback={
        <Box
          data-testid="events-loading"
          className="flex flex-col gap-1 p-1"
          style={{ flex: 1, "min-height": "0px" }}
        >
          <For each={Array.from({ length: SKELETON_ROWS })}>
            {() => <Skeleton h={24} data-testid="events-skeleton-row" visible />}
          </For>
        </Box>
      }
    >
      <Show
        when={props.isLoading || rows().length > 0}
        fallback={
          <Box
            data-testid="events-empty"
            className="flex min-h-0 flex-1 items-center justify-center"
          >
            <EmptyState
              title="No events in this window."
              description="Widen the window or clear a filter to see the rest of the calendar."
              data-testid="events-empty-state"
            />
          </Box>
        }
      >
        <Box className="flex min-h-0 flex-1 flex-col">
          <TanStackTable<EventDTO>
            data={rows()}
            columns={columns()}
            dataTestId="events-table"
            loading={props.isLoading}
            loadingMessage="Loading events…"
            emptyMessage="No events in this window."
            enableSorting
            stickyHeader
            fillContainer
            onRowClick={props.onOpen}
            getRowTestId={(event) => `event-row-${event.id}`}
          />
        </Box>
      </Show>
    </Show>
  );
}
