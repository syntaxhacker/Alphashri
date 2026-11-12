import { createEffect } from "solid-js";
import { buildEventsQuery } from "../../api/events";
import { eventsStore, useEventsStore } from "../../state/events";
import type {
  AnomaliesResponse,
  EventDTO,
  EventsMeta,
  EventsQuery,
  EventsResponse,
} from "../../types/events";

export interface EventsViewModel {
  data: () => EventsResponse | null;
  events: () => EventDTO[];
  anomalies: () => AnomaliesResponse | null;
  meta: () => EventsMeta | null;
  isLoading: () => boolean;
  isRefreshing: () => boolean;
  error: () => Error | null;
  lastUpdated: () => string | null;
  refresh: () => void;
  loadAnomalies: (date: string) => void;
}

/**
 * Solid-native port of src/hooks/useEvents. The store is the single source of
 * truth; this adapter only pushes an external query into it on actual change.
 */
export function useEventsSolid(query?: () => EventsQuery | undefined): EventsViewModel {
  const state = useEventsStore();
  let syncedKey: string | null = null;
  let bootstrapped = false;

  createEffect(() => {
    const q = query?.();
    if (!q) return;
    // The serialised key is the dependency: it changes only when a value the
    // API actually sends changes, so re-renders with an equal query are free.
    const key = buildEventsQuery(q);
    if (syncedKey === key) return;
    syncedKey = key;
    eventsStore.setQuery(q);
  });

  createEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    // An external query drives the first load through the sync effect above.
    if (query?.()) return;
    const current = eventsStore.getState();
    // Never clobber data another panel already loaded, and never stack a
    // second request on top of one that is already in flight.
    if (current.data || current.isLoading || current.error) return;
    void eventsStore.loadCalendar();
  });

  return {
    data: () => state().data,
    events: () => state().data?.events ?? [],
    anomalies: () => state().anomalies,
    meta: () => state().data?.meta ?? null,
    isLoading: () => state().isLoading,
    isRefreshing: () => state().isRefreshing,
    error: () => state().error,
    lastUpdated: () => state().lastUpdated,
    refresh: () => void eventsStore.refresh(),
    loadAnomalies: (date: string) => void eventsStore.loadAnomalies(date),
  };
}
