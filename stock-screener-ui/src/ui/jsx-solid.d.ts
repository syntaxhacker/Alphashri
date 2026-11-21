/**
 * Solid's runtime aliases `className` → `class` and `htmlFor` → `for` (see
 * `Aliases` in solid-js/web), so both work at runtime, but `jsx.d.ts` only
 * declares `class`/`for`. The whole app is written with the aliases, so they
 * are declared here once instead of rewritten file by file.
 */
declare module "solid-js/jsx-runtime" {
  namespace JSX {
    interface HTMLAttributes<T> {
      className?: string;
      htmlFor?: string | undefined;
    }
    interface CoreSVGAttributes<T> {
      className?: string;
    }
    interface InputHTMLAttributes<T> {
      /** Runtime alias for `defaultchecked` (see `PropAliases` in solid-js/web). */
      defaultChecked?: boolean | undefined;
      autoComplete?: string | undefined;
    }
    /**
     * Solid's capture phase lives under `oncapture:<event>` (see
     * `assignProp` in solid-js/web), which is typed only for keys declared
     * here — the shipped map is empty.
     */
    interface CustomCaptureEvents {
      pointerdown: PointerEvent;
    }
  }
}

export {};
