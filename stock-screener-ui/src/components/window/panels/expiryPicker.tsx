import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
  type JSX,
} from "solid-js";
import { Box, Button, Select, Text } from "@/ui";
import { fetchNiftyExpiries, fetchOptionsExpiries } from "@/api/reportNifty";
import type { DockPanelContext } from "../../dock/types";

export type ExpiryState = "loading" | "ready" | "error";

interface Flight {
  controller: AbortController;
  state: Accessor<ExpiryState>;
  data: Accessor<string[]>;
  error: Accessor<unknown>;
  settled: boolean;
}

interface Slot {
  symbol: string;
  refs: number;
  flight: Accessor<Flight>;
  setFlight: (flight: Flight) => void;
}

const slots = new Map<string, Slot>();

const normalize = (symbol: string) => symbol.trim().toUpperCase() || "NIFTY";

const normalizedToday = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/** Ascending ISO listing: the first session at/after today, else the last one known. */
export function nearestExpiry(dates: string[], today = normalizedToday()): string {
  const upcoming = dates.filter((date) => date >= today);
  return upcoming[0] ?? dates[dates.length - 1] ?? "";
}

export function expiryLabel(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return date;
  const friendly = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
  return `${date} · ${friendly}`;
}

function startFlight(symbol: string): Flight {
  const controller = new AbortController();
  const [state, setState] = createSignal<ExpiryState>("loading");
  const [data, setData] = createSignal<string[]>([]);
  const [error, setError] = createSignal<unknown>(null);
  const flight: Flight = { controller, state, data, error, settled: false };

  // NIFTY has a dedicated desk-scoped listing; every other underlying uses the
  // per-symbol options endpoint. Both return ISO dates, ascending.
  const request =
    symbol === "NIFTY"
      ? fetchNiftyExpiries(controller.signal).then((list) => list.map((entry) => entry.date))
      : fetchOptionsExpiries(symbol, controller.signal);

  void request.then(
    (list) => {
      if (controller.signal.aborted) return;
      flight.settled = true;
      setData(list.filter((date) => typeof date === "string" && date.length > 0));
      setState("ready");
    },
    (cause: unknown) => {
      if (controller.signal.aborted) return;
      flight.settled = true;
      setError(cause);
      setState("error");
    },
  );

  return flight;
}

function acquireSlot(symbol: string): Slot {
  const key = normalize(symbol);
  let slot = slots.get(key);
  if (!slot) {
    const [flight, setFlight] = createSignal<Flight>(startFlight(key));
    slot = { symbol: key, refs: 0, flight, setFlight };
    slots.set(key, slot);
  }
  slot.refs += 1;
  return slot;
}

function releaseSlot(slot: Slot): void {
  slot.refs -= 1;
  if (slot.refs > 0) return;
  const flight = slot.flight();
  if (!flight.settled) flight.controller.abort();
  if (slots.get(slot.symbol) === slot) slots.delete(slot.symbol);
}

function retrySlot(slot: Slot): void {
  slot.flight().controller.abort();
  slot.setFlight(startFlight(slot.symbol));
}

export interface ExpiryPickerModel {
  expiry: Accessor<string>;
  setExpiry: (value: string) => void;
  expiries: Accessor<string[]>;
  state: Accessor<ExpiryState>;
  error: Accessor<unknown>;
  retry: () => void;
}

/**
 * One listing flight per symbol while any options window is open. The desk
 * expiry is a seed only: it is never replaced by the nearest listing, and a
 * user's in-window choice wins over both.
 */
export function useExpiryPicker(
  symbol: Accessor<string>,
  context: Accessor<DockPanelContext>,
): ExpiryPickerModel {
  const [expiry, setExpiryRaw] = createSignal((context().expiry ?? "").trim());
  const [slot, setSlot] = createSignal<Slot | null>(null);
  let lastSymbol = normalize(symbol());
  let seedActive = Boolean(expiry());
  let userPicked = false;
  let appliedFor = "";

  createEffect(() => {
    const key = normalize(symbol());
    if (key !== lastSymbol) {
      lastSymbol = key;
      seedActive = false;
      userPicked = false;
      appliedFor = "";
      setExpiryRaw("");
    }
    const next = acquireSlot(key);
    setSlot(next);
    onCleanup(() => releaseSlot(next));
  });

  const flight = () => slot()?.flight();
  const expiries = () => flight()?.data() ?? [];
  const state = () => flight()?.state() ?? "loading";
  const error = () => flight()?.error() ?? null;

  createEffect(() => {
    const current = slot();
    if (!current) return;
    const currentFlight = current.flight();
    if (currentFlight.state() !== "ready") return;
    const list = currentFlight.data();
    if (list.length === 0 || appliedFor === current.symbol) return;
    appliedFor = current.symbol;
    if (seedActive || userPicked || expiry()) return;
    setExpiryRaw(nearestExpiry(list));
  });

  return {
    expiry,
    setExpiry: (value: string) => {
      userPicked = true;
      setExpiryRaw(value.trim());
    },
    expiries,
    state,
    error,
    retry: () => {
      const current = slot();
      if (current) retrySlot(current);
    },
  };
}

export interface ExpirySelectProps {
  model: ExpiryPickerModel;
  ariaLabel: string;
  /** Preserved legacy test id: the control itself. */
  controlTestId: string;
  /** New test id for the whole picker incl. its honest states. */
  pickerTestId: string;
  loadingTestId: string;
  errorTestId: string;
  emptyTestId: string;
  width?: number;
}

/** Select + loading/error/empty presentation shared by the three options windows. */
export function ExpirySelect(props: ExpirySelectProps): JSX.Element {
  const message = createMemo(() => {
    const cause = props.model.error();
    return cause instanceof Error ? cause.message : "Could not load expiries";
  });
  const options = createMemo(() => {
    const list = props.model.expiries();
    const current = props.model.expiry();
    const listed = new Set(list);
    const all = current && !listed.has(current) ? [current, ...list] : list;
    return all.map((date) => ({
      value: date,
      label: expiryLabel(date) + (date === current && !listed.has(date) ? " · desk" : ""),
    }));
  });
  const loading = () => props.model.state() === "loading";
  const failed = () => props.model.state() === "error";
  const none = () => props.model.state() === "ready" && props.model.expiries().length === 0;
  // A native <select> resolves `value` against the options present at creation;
  // setting it before the listing arrives leaves it pinned to the first option.
  // Remount once when the option set appears so the controlled value takes.
  const selectKey = () => `${props.model.state()}:${options().length > 0}`;

  return (
    <Box className="flex min-w-0 flex-col gap-1" data-testid={props.pickerTestId}>
      <Show when={selectKey()} keyed>
        {() => (
          <Select
            size="xs"
            w={props.width ?? 168}
            aria-label={props.ariaLabel}
            data-testid={props.controlTestId}
            value={props.model.expiry()}
            onChange={(value) => props.model.setExpiry(value ?? "")}
            data={options()}
            disabled={loading() || failed() || none()}
            placeholder={!props.model.expiry() ? "Choose expiry" : undefined}
          />
        )}
      </Show>
      <Show when={loading()}>
        <Text size="xs" c="dimmed" data-testid={props.loadingTestId}>
          Loading expiries…
        </Text>
      </Show>
      <Show when={failed()}>
        <Box
          data-testid={props.errorTestId}
          role="alert"
          className="flex items-center gap-2 border border-fin-border px-2 py-1 text-[11px] text-fin-text"
        >
          <Text size="xs" c="dimmed">
            Expiries unavailable: {message()}
          </Text>
          <Button size="xs" variant="subtle" onClick={() => props.model.retry()}>
            Retry
          </Button>
        </Box>
      </Show>
      <Show when={none()}>
        <Text size="xs" c="dimmed" data-testid={props.emptyTestId}>
          No expiries listed for this underlying.
        </Text>
      </Show>
    </Box>
  );
}
