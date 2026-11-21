/**
 * Generic per-scope saved config store.
 *
 * One scope = one registry entry (`SavedConfigScope`) + one store instance per
 * mount. The invariants that make this safe are all here, not in the callers:
 *
 * - **Precedence** `urlOverride ?? saved ?? defaults`, applied once per mount.
 * - **Latch**: the first user mutation forecloses hydration for that mount, so
 *   a slow GET can never re-apply an old value over a click.
 * - **Generation**: every `hydrate()` bumps a counter; a response from an older
 *   generation is dropped. A remount (tab switch away and back) re-hydrates.
 * - **Autosave**: 800 ms trailing debounce, one in-flight PUT, newest value
 *   wins, never before hydration settles, deduped against the last persisted
 *   payload so applying a saved value cannot echo back as a write.
 * - **Failure is a chip, not a rollback**: the live UI keeps the user's value;
 *   only the persisted baseline stops advancing.
 */

import { createSubscriber } from "./createSubscriber";
import {
  getUserConfig,
  putUserConfig,
  deleteUserConfig,
  type UserConfig,
} from "../api/userConfigs";

export const SAVE_DEBOUNCE_MS = 800;
/** A transport failure (offline) gets exactly one silent retry, then the chip. */
export const NETWORK_RETRY_MS = 2_000;

export type SavedConfigStatus = "idle" | "loading" | "ready" | "error" | "disabled";

/** `conflict` = another tab wrote; `invalid` = 422, do not retry the payload. */
export type SavedConfigErrorCode = "not_saved" | "conflict" | "invalid" | null;

interface SavedConfigState<T> {
  /** Effective value last applied to the UI; null until something was applied. */
  value: T | null;
  status: SavedConfigStatus;
  error: SavedConfigErrorCode;
  /** Server-side note, e.g. `invalid_saved_config` (row kept, defaults served). */
  warning: string | null;
  hydrated: boolean;
}

export interface SavedConfigScope<T> {
  scope: string;
  version: number;
  defaults(): T;
  /**
   * Wire payload -> value. `null` means "this build cannot read it": the store
   * then serves defaults and records one warning. Never throw, never DELETE.
   */
  parse(raw: unknown): T | null;
  serialize(value: T): Record<string, unknown>;
}

/** Filled by the module that owns the scope (`useMarketConfig` registers `market.filters`). */
export const SCOPES: Record<string, SavedConfigScope<any>> = {};

export function registerSavedConfigScope<T>(spec: SavedConfigScope<T>): SavedConfigScope<T> {
  SCOPES[spec.scope] = spec;
  return spec;
}

export interface SavedConfigTransport {
  get(scope: string, options?: { signal?: AbortSignal }): Promise<UserConfig<Record<string, unknown>>>;
  put(
    scope: string,
    config: Record<string, unknown>,
    options?: { version?: number; ifMatch?: string | null; keepalive?: boolean },
  ): Promise<UserConfig<Record<string, unknown>>>;
  del(scope: string): Promise<unknown>;
}

const defaultTransport: SavedConfigTransport = {
  get: getUserConfig,
  put: putUserConfig,
  del: deleteUserConfig,
};

interface HydrateOptions<T> {
  /** Present-tense per-field override (URL / route params). Wins over the saved value. */
  override?: Partial<T> | null;
  /** Called with the effective value when the saved payload settles. */
  apply?: (value: T) => void;
}

export interface SavedConfigStore<T> {
  readonly scope: string;
  readonly version: number;
  subscribe(callback: () => void): () => void;
  getState(): SavedConfigState<T>;
  hydrate(options?: HydrateOptions<T>): void;
  /** Record a change. Buffered (no request) until hydration settles. */
  scheduleSave(value: T): void;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  retry(): Promise<void>;
  forget(): Promise<void>;
  dispose(): void;
}

interface StoreDeps {
  transport?: SavedConfigTransport;
}

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 0;
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

/** Network-class = no HTTP status at all (fetch rejection). 5xx is not retried silently. */
function isNetworkFailure(error: unknown): boolean {
  return errorStatus(error) === 0;
}

function isDisabledStatus(status: number): boolean {
  // 404 = the router never loaded (a try/except mount failed): the config API is
  // simply absent, which is the same "stay quiet, use defaults" case as auth.
  return status === 401 || status === 403 || status === 404;
}

function asEnvelope(value: unknown): UserConfig<Record<string, unknown>> | null {
  const candidate = value as { config?: unknown; updated_at?: unknown } | null;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof candidate.config !== "object" || candidate.config === null) return null;
  return {
    scope: String((candidate as { scope?: unknown }).scope ?? ""),
    version: Number((candidate as { version?: unknown }).version ?? 0),
    saved: (candidate as { saved?: unknown }).saved === true,
    updated_at: typeof candidate.updated_at === "string" ? candidate.updated_at : null,
    config: candidate.config as Record<string, unknown>,
    warning:
      typeof (candidate as { warning?: unknown }).warning === "string"
        ? ((candidate as { warning: string }).warning)
        : undefined,
  };
}

export function createSavedConfigStore<T>(
  spec: SavedConfigScope<T>,
  deps: StoreDeps = {},
): SavedConfigStore<T> {
  const transport = deps.transport ?? defaultTransport;
  const { subscribe, notify } = createSubscriber();

  let state: SavedConfigState<T> = {
    value: null,
    status: "idle",
    error: null,
    warning: null,
    hydrated: false,
  };

  let generation = 0;
  let latchOpen = true;
  let override: Partial<T> | null = null;
  let applyFn: ((value: T) => void) | null = null;

  let latest: T | null = null;
  let pending: T | null = null;
  let pendingKey: string | null = null;
  let lastPersistedKey: string | null = null;
  let baseRevision: string | null = null;
  // Set right after hydration/adoption applies a value: the panel's save effect
  // is about to fire with exactly that value, and echoing it back would turn
  // "open a ?view= link" or "another tab wrote" into a write of our own.
  let appliedEchoKey: string | null = null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let holdRetry = false;
  // One silent retry per transport failure, not one per attempt: the second
  // failure must surface the chip instead of arming another retry.
  let retriedOnce = false;
  // Set when a write must not be repeated on its own (422 / 409 / exhausted
  // network retry). A new user change or an explicit `retry()` clears it —
  // without this the debounce would re-arm forever against a permanent failure.
  let blocked = false;
  let disposed = false;

  const keyFor = (value: T): string => JSON.stringify(spec.serialize(value));

  function setState(patch: Partial<SavedConfigState<T>>): void {
    state = { ...state, ...patch };
    notify();
  }

  function apply(value: T, options: { echo?: boolean } = {}): void {
    state = { ...state, value };
    // Suppressing the panel's immediate save-back is only right when the server
    // already holds this payload. An unreadable row must be repaired by the next
    // write, so that case deliberately allows the echo through.
    appliedEchoKey = options.echo === false ? null : keyFor(value);
    applyFn?.(value);
    notify();
  }

  function clearDebounce(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function clearRetry(): void {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function merge(defaults: T, saved: T | null, overrideValue: Partial<T> | null): T {
    return { ...defaults, ...saved, ...overrideValue } as T;
  }

  function dropPending(): void {
    pending = null;
    pendingKey = null;
    clearDebounce();
    clearRetry();
  }

  /** A buffered pre-hydration change is saved as soon as the GET settles. */
  function drainPending(): void {
    if (!pending || disposed) return;
    if (state.status === "disabled") {
      dropPending();
      return;
    }
    arm();
  }

  function arm(): void {
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }

  function adoptEnvelope(current: UserConfig<Record<string, unknown>>): void {
    baseRevision = current.updated_at;
    const parsed = spec.parse(current.config);
    lastPersistedKey = parsed ? keyFor(parsed) : null;
    dropPending();
    const effective = merge(spec.defaults(), parsed, override);
    apply(effective);
    latest = effective;
  }

  function handleFailure(error: unknown): void {
    const status = errorStatus(error);
    if (isDisabledStatus(status)) {
      dropPending();
      setState({ status: "disabled", error: null, hydrated: true });
      return;
    }
    if (status === 409) {
      const body = (error as { payload?: unknown } | null)?.payload as
        | { current?: unknown }
        | null;
      const envelope = asEnvelope(body?.current ?? body);
      if (envelope) {
        // Adopt the other tab's value rather than looping retries that never
        // converge; the chip explains the change.
        adoptEnvelope(envelope);
        setState({ status: "ready", error: "conflict" });
      } else {
        dropPending();
        blocked = true;
        setState({ status: "ready", error: "conflict" });
      }
      return;
    }
    if (status === 422) {
      // A client bug: the same payload would fail the same way.
      if (typeof console !== "undefined") {
        console.warn("Saved config rejected", errorCode(error));
      }
      dropPending();
      blocked = true;
      setState({ status: "ready", error: "invalid" });
      return;
    }
    if (isNetworkFailure(error) && !holdRetry && !retriedOnce) {
      retriedOnce = true;
      holdRetry = true;
      clearRetry();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        holdRetry = false;
        void flush();
      }, NETWORK_RETRY_MS);
      return;
    }
    // Keep the widget where the user put it: only the baseline stops advancing.
    if (latest) {
      pending = latest;
      pendingKey = keyFor(latest);
    }
    blocked = true;
    holdRetry = true;
    setState({ status: "ready", error: "not_saved" });
  }

  async function flush(options: { keepalive?: boolean } = {}): Promise<void> {
    clearDebounce();
    if (disposed || !state.hydrated || inFlight) return;
    if (!pending || state.status === "disabled") return;

    const value = pending;
    const sentKey = pendingKey ?? keyFor(value);
    inFlight = true;
    holdRetry = false;
    try {
      const envelope = asEnvelope(
        await transport.put(spec.scope, spec.serialize(value), {
          version: spec.version,
          ifMatch: baseRevision,
          keepalive: options.keepalive === true,
        }),
      );
      if (disposed) return;
      if (envelope) {
        baseRevision = envelope.updated_at;
        lastPersistedKey = sentKey;
      }
      if (pendingKey === sentKey) dropPending();
      blocked = false;
      setState({ error: null, status: "ready" });
    } catch (error) {
      if (disposed) return;
      handleFailure(error);
    } finally {
      inFlight = false;
      // A change that arrived mid-flight leaves exactly one pending save. The
      // retry path owns the next attempt when a transport failure armed one —
      // re-arming the debounce here would fire twice.
      if (!disposed && !blocked && !holdRetry && pending && pendingKey !== lastPersistedKey) {
        arm();
      }
    }
  }

  function hydrate(options: HydrateOptions<T> = {}): void {
    if (disposed) return;
    const myGeneration = ++generation;
    // A buffered local change is strictly newer than anything the server can
    // return. Reopening the latch on a remount inside the debounce window would
    // let the GET re-apply an old value over the user's edit.
    latchOpen = pending === null;
    override = options.override ?? null;
    if (options.apply) applyFn = options.apply;
    setState({ status: "loading", error: null, warning: null });

    transport
      .get(spec.scope)
      .then((raw) => {
        if (disposed || myGeneration !== generation) return;
        const envelope = asEnvelope(raw);
        let savedValue: T | null = null;
        let warning: string | null = null;

        if (!envelope) {
          warning = "invalid_saved_config";
        } else if (envelope.version !== spec.version) {
          // Stored by another version with no migration path: read as defaults,
          // keep the row (the next write repairs it).
          warning = "invalid_saved_config";
        } else if (envelope.warning) {
          warning = envelope.warning;
        } else if (envelope.saved) {
          savedValue = spec.parse(envelope.config);
          if (savedValue === null) warning = "invalid_saved_config";
        }

        const effective = merge(spec.defaults(), savedValue, override);
        baseRevision = envelope?.updated_at ?? null;
        // With no usable row the server holds defaults; with an unreadable row we
        // deliberately leave the baseline unknown so the next change repairs it.
        lastPersistedKey =
          savedValue !== null
            ? keyFor(savedValue)
            : warning
              ? null
              : keyFor(spec.defaults());

        if (latchOpen && pending === null) {
          latest = effective;
          // A warning means the row was unreadable: let the panel's mount echo
          // write the defaults back and repair it.
          apply(effective, { echo: warning === null });
        } else {
          // A local change is buffered (or an edit already closed the latch):
          // the server's value is stale. Keep the user's value and leave the
          // latch closed so no later response can overwrite it; drainPending()
          // below still sends the buffered PUT.
          if (pending !== null) latchOpen = false;
          state = { ...state, value: latest ?? effective };
          notify();
        }
        setState({ status: "ready", hydrated: true, warning });
        drainPending();
      })
      .catch((error: unknown) => {
        if (disposed || myGeneration !== generation) return;
        const status = errorStatus(error);
        if (isDisabledStatus(status)) {
          setState({ status: "disabled", hydrated: true });
          dropPending();
          return;
        }
        // Offline: the table has its own cache; config degrades to defaults.
        lastPersistedKey = keyFor(spec.defaults());
        setState({ status: "error", hydrated: true, error: null });
        drainPending();
      });
  }

  function scheduleSave(value: T): void {
    if (disposed) return;
    latest = value;
    const key = keyFor(value);
    if (appliedEchoKey !== null && key === appliedEchoKey) {
      // The panel is echoing back the value hydration just applied. Consume the
      // marker so a later deliberate change to that same value can still save.
      appliedEchoKey = null;
      return;
    }
    appliedEchoKey = null;
    if (pending && pendingKey === key) return;
    // Publish the optimistic value synchronously. A controlled consumer reads
    // `getState()` through its subscription, so without this notify it would
    // keep rendering the previous array until the debounced PUT settles — and
    // forever when the scope is disabled and no PUT ever happens.
    state = { ...state, value, error: null };
    pending = value;
    pendingKey = key;
    latchOpen = false;
    blocked = false;
    holdRetry = false;
    retriedOnce = false;
    notify();
    if (!state.hydrated) return;
    if (state.status === "disabled") {
      dropPending();
      return;
    }
    if (key === lastPersistedKey) {
      // Nothing to write (the value hydration just applied, or a reset back to
      // the persisted state). Dropping here keeps a reload from echoing an
      // identical PUT.
      dropPending();
      return;
    }
    arm();
  }

  async function retry(): Promise<void> {
    if (disposed || state.status === "disabled") return;
    clearRetry();
    holdRetry = false;
    blocked = false;
    retriedOnce = false;
    setState({ error: null });
    if (!pending && latest) {
      pending = latest;
      pendingKey = keyFor(latest);
    }
    await flush();
  }

  async function forget(): Promise<void> {
    if (disposed) return;
    dropPending();
    try {
      await transport.del(spec.scope);
      baseRevision = null;
      lastPersistedKey = keyFor(spec.defaults());
      latest = merge(spec.defaults(), null, override);
      apply(latest);
      setState({ status: "ready", error: null, warning: null });
    } catch (error) {
      if (isDisabledStatus(errorStatus(error))) {
        setState({ status: "disabled", error: null });
        return;
      }
      setState({ error: "not_saved" });
    }
  }

  function onPageHide(): void {
    void flush({ keepalive: true });
  }

  function onVisibilityChange(): void {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      void flush({ keepalive: true });
      return;
    }
    // Decision: a second device/tab only sees the other's write on its next
    // read, and returning to the tab is that read. Skipped while a local change
    // is unsaved — the local state is strictly newer than the server's.
    if (state.hydrated && !pending && !inFlight && state.status !== "disabled") {
      hydrate({ override, apply: applyFn ?? undefined });
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
    document?.addEventListener?.("visibilitychange", onVisibilityChange);
  }

  function dispose(): void {
    // A pending change must not die with the component: send it with
    // `keepalive` so a tab close / route change does not lose the last edit.
    if (pending && state.hydrated && state.status !== "disabled" && !inFlight) {
      const value = pending;
      pending = null;
      void transport
        .put(spec.scope, spec.serialize(value), {
          version: spec.version,
          ifMatch: baseRevision,
          keepalive: true,
        })
        .catch(() => {
          // Unmounting: there is no UI left to report a failure to.
        });
    }
    disposed = true;
    clearDebounce();
    clearRetry();
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
      document?.removeEventListener?.("visibilitychange", onVisibilityChange);
    }
  }

  return {
    scope: spec.scope,
    version: spec.version,
    subscribe,
    getState: () => state,
    hydrate,
    scheduleSave,
    flush,
    retry,
    forget,
    dispose,
  };
}
