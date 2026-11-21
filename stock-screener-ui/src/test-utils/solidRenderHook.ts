/**
 * `solidRenderHook` — a Solid replacement for `@testing-library/react`'s
 * `renderHook`.
 *
 * Solid has no re-render: a hook body runs **once** inside an owner, and
 * everything after that is driven by signals. So there are two harnesses:
 *
 * - {@link renderSolidHook} takes plain props. `rerender(nextProps)` tears the
 *   previous owner down and creates a fresh one (an owner change), which is the
 *   only honest meaning of "call the hook again" in Solid.
 * - {@link renderSolidHookReactive} takes an object of plain values and turns
 *   every non-function field into a stable accessor over the latest props.
 *   `rerender(nextProps)` swaps the values in place and bumps a version signal
 *   the accessors read, so exactly the effects that read a changed field re-run
 *   — the Solid equivalent of a React re-render.
 *
 * Both capture the hook's return value in `result.current` and expose
 * `dispose()`/`unmount()` so a test can prove cleanup behaviour.
 */

import { createRoot, createSignal } from "solid-js";

/** Mutable box holding the value the hook returned (mirrors React's `result`). */
export interface HookResult<T> {
  current: T;
}

export interface SolidHookHandle<T, P> {
  /** Latest value returned by the hook. */
  result: HookResult<T>;
  /** Re-create the hook with new plain props (previous owner is disposed). */
  rerender: (props?: P) => void;
  /** Dispose the owner: runs every registered `onCleanup`. */
  unmount: () => void;
  /** Alias of `unmount()`, for suites that model per-case teardown. */
  dispose: () => void;
}

/**
 * Mount a plain-props hook in a `createRoot`.
 *
 * ```ts
 * const { result, unmount } = renderSolidHook(() => usePolling(fn, 1000));
 * ```
 */
export function renderSolidHook<T, P = void>(
  hook: (props: P) => T,
  options: { initialProps?: P } = {},
): SolidHookHandle<T, P> {
  const result: HookResult<T> = { current: undefined as T };
  let disposeRoot: (() => void) | undefined;
  let disposed = false;

  const mount = (props?: P) => {
    disposeRoot?.();
    disposed = false;
    disposeRoot = createRoot((dispose) => {
      result.current = hook(props as P);
      return dispose;
    });
  };

  const unmount = () => {
    if (disposed) return;
    disposed = true;
    disposeRoot?.();
    disposeRoot = undefined;
  };

  mount(options.initialProps);
  return { result, rerender: mount, unmount, dispose: unmount };
}

export interface ReactiveHookHandle<T, P> {
  result: HookResult<T>;
  /** Swap the props; effects that read a changed field re-run. */
  rerender: (props: P) => void;
  unmount: () => void;
  dispose: () => void;
  /** Reactive view of the current props, for assertions. */
  props: () => P;
}

/**
 * Mount an accessor-friendly hook in a `createRoot` with live props.
 *
 * The hook receives an object where every **non-function** field is an
 * accessor (`() => latestValue`) that also subscribes to an internal version
 * signal; function fields (setters, spies) are passed through untouched. A
 * hook that reads its state through `read(source)`/`typeof === "function"`
 * therefore re-runs its effects on `rerender(next)`.
 *
 * ```ts
 * const { rerender } = renderSolidHookReactive(
 *   (props) => usePatternUrlSync(props),
 *   { initialProps: args },
 * );
 * rerender({ ...args, universe: "nifty50" });
 * ```
 */
export function renderSolidHookReactive<T, P extends object>(
  hook: (props: P) => T,
  options: { initialProps: P },
): ReactiveHookHandle<T, P> {
  const [version, setVersion] = createSignal(0);
  const result: HookResult<T> = { current: undefined as T };
  let current = options.initialProps;

  const liveProps = new Proxy({} as P, {
    get(_target, key) {
      const name = String(key);
      const value = (current as Record<string | symbol, unknown>)[key];
      // Setters/spies are callbacks, never accessors — an absent one must stay
      // `undefined` so "no setter provided" keeps working.
      if (typeof value === "function") return value;
      if (/^(set|apply)[A-Z]/.test(name)) return undefined;
      // Everything else is state: a stable-shape accessor that subscribes to
      // `version`, so a props swap invalidates exactly the readers.
      return () => {
        version();
        return (current as Record<string | symbol, unknown>)[key];
      };
    },
    has: (_target, key) => key in (current as object),
    ownKeys: () => Reflect.ownKeys(current as object),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });

  let disposed = false;
  const disposeRoot = createRoot((dispose) => {
    result.current = hook(liveProps);
    return dispose;
  });

  const unmount = () => {
    if (disposed) return;
    disposed = true;
    disposeRoot();
  };

  return {
    result,
    props: () => current,
    rerender: (next: P) => {
      if (disposed) throw new Error("renderSolidHookReactive: hook already disposed");
      current = next;
      setVersion((n) => n + 1);
    },
    unmount,
    dispose: unmount,
  };
}
