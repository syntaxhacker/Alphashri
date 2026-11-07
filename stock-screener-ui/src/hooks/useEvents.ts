/**
 * `useEvents` — thin adapter over the Event Radar store.
 *
 * The store owns data + loading state; this hook only (a) pushes an optional
 * caller-supplied query into the store when it actually changes, and (b)
 * subscribes so React re-renders. It deliberately keeps no local state: two
 * panels using the hook must always render the same query's payload.
 *
 * The external query is keyed by `buildEventsQuery` (not object identity), so
 * an inline object literal passed on every render does not trigger a reload
 * loop.
 */

import { useCallback, useEffect, useRef } from "react";
import { buildEventsQuery } from "../api/events";
import { eventsStore, useEventsStore } from "../state/events";
import type {
  AnomaliesResponse,
  EventDTO,
  EventsMeta,
  EventsQuery,
  EventsResponse,
} from "../types/events";

export interface UseEventsResult {
  data: EventsResponse | null;
  events: EventDTO[];
  anomalies: AnomaliesResponse | null;
  meta: EventsMeta | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  lastUpdated: string | null;
  refresh: () => void;
  setQuery: (patch: Partial<EventsQuery>) => void;
  loadAnomalies: (date: string) => void;
}

/**
 * Subscribe to the Event Radar store and derive the view model.
 *
 * `query` is optional: when provided it becomes the store's query (pushed on
 * change by its serialised key), otherwise the store keeps its default window.
 * Only `events`/`meta` are derived here — everything else is passed through, so
 * there is exactly one copy of the data in the app.
 */
export function useEvents(query?: EventsQuery): UseEventsResult {
  const state = useEventsStore();

  // The serialised key is the effect dependency: it changes only when a value
  // the API actually sends changes, so re-renders with an equal query are free.
  const queryKey = query ? buildEventsQuery(query) : "";
  const queryRef = useRef<EventsQuery | undefined>(query);
  queryRef.current = query;

  /** Last external query we pushed into the store (prevents ping-pong). */
  const syncedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const external = queryRef.current;
    if (!external) return;
    const key = buildEventsQuery(external);
    if (syncedKeyRef.current === key) return;
    syncedKeyRef.current = key;
    eventsStore.setQuery(external);
  }, [queryKey]);

  /** One-shot bootstrap when the caller supplies no query of its own. */
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    // An external query drives the first load through the sync effect above —
    // doing it here too would fire two identical requests.
    if (queryRef.current) return;
    const current = eventsStore.getState();
    // Never clobber data another panel already loaded, and never stack a
    // second request on top of one that is already in flight.
    if (current.data || current.isLoading || current.error) return;
    void eventsStore.loadCalendar();
  }, [queryKey]);

  const refresh = useCallback((): void => {
    void eventsStore.refresh();
  }, []);

  const setQuery = useCallback((patch: Partial<EventsQuery>): void => {
    eventsStore.setQuery(patch);
  }, []);

  const loadAnomalies = useCallback((date: string): void => {
    void eventsStore.loadAnomalies(date);
  }, []);

  return {
    data: state.data,
    events: state.data?.events ?? [],
    anomalies: state.anomalies,
    meta: state.data?.meta ?? null,
    isLoading: state.isLoading,
    isRefreshing: state.isRefreshing,
    error: state.error,
    lastUpdated: state.lastUpdated,
    refresh,
    setQuery,
    loadAnomalies,
  };
}
