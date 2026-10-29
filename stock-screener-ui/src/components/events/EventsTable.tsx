import { useMemo } from "react";
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
export function EventsTable({ events, isLoading, onOpen }: EventsTableProps) {
  const columns = useMemo(() => buildEventColumns(onOpen), [onOpen]);

  if (isLoading && events.length === 0) {
    return (
      <Box
        data-testid="events-loading"
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 1, p: 1 }}
      >
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <Skeleton key={`events-skeleton-${index}`} h={24} data-testid="events-skeleton-row" />
        ))}
      </Box>
    );
  }

  if (!isLoading && events.length === 0) {
    return (
      <Box
        data-testid="events-empty"
        sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <EmptyState
          title="No events in this window."
          description="Widen the window or clear a filter to see the rest of the calendar."
          data-testid="events-empty-state"
        />
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <TanStackTable<EventDTO>
        data={events}
        columns={columns}
        dataTestId="events-table"
        loading={isLoading}
        loadingMessage="Loading events…"
        emptyMessage="No events in this window."
        enableSorting
        stickyHeader
        fillContainer
        onRowClick={onOpen}
        getRowTestId={(event) => `event-row-${event.id}`}
      />
    </Box>
  );
}
