import { createMemo, createUniqueId, type Accessor, type JSX } from "solid-js";

/** The three shapes the public `error` prop accepts. */
export type FieldMessage = boolean | string | JSX.Element;

export type FieldA11yOptions = {
  /** Caller-supplied control id; a stable unique one is generated when absent. */
  id?: string;
  /** Error flag/message. JSX is rendered as JSX — never stringified. */
  error: Accessor<FieldMessage | undefined>;
  description: Accessor<FieldMessage | undefined>;
  /** An `aria-describedby` the caller forwarded to the native control, if any. */
  externalDescribedBy?: Accessor<string | undefined>;
};

/**
 * One wiring rule for every input family: the helper span owns an id, and the
 * real control (never the wrapper) points at it and advertises invalid state.
 * Keeping it here stops a new input from shipping a visual-only error.
 */
export function createFieldA11y(options: FieldA11yOptions) {
  const controlId = options.id ?? createUniqueId();
  const messageId = `${controlId}-error`;

  const isError = createMemo(() => Boolean(options.error()));

  /**
   * `error={true}` is a flag with no copy, so it has no message node to point
   * at. Every other value (string or JSX) is handed to the DOM as-is.
   */
  const message = createMemo<JSX.Element | undefined>(() => {
    const error = options.error();
    if (isError()) return error === true ? undefined : (error as JSX.Element | undefined);
    const description = options.description();
    if (description == null || description === false) return undefined;
    return description as JSX.Element;
  });

  const hasMessage = createMemo(() => {
    const value = message();
    return value != null && value !== false && value !== "";
  });

  /** Merge with a caller's own describedby instead of overwriting it. */
  const describedBy = createMemo(() => {
    const external = options.externalDescribedBy?.();
    const own = hasMessage() ? messageId : undefined;
    if (!external) return own;
    if (!own) return external;
    return external
      .split(/\s+/)
      .concat(own)
      .filter((part, index, all) => part !== "" && all.indexOf(part) === index)
      .join(" ");
  });

  return { controlId, messageId, isError, message, hasMessage, describedBy };
}
