import { createMemo, createUniqueId } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "../cn";
import { Stack } from "../layout/Stack";
import { Text } from "../typography/Text";
import type { UIFormFieldControlProps, UIFormFieldIds, UIFormFieldProps } from "../types";

/**
 * Only `false`, `true` and `""` are "no copy": every other value — strings and
 * JSX alike — is handed to the DOM untouched, never run through `String()`.
 */
function hasCopy(value: unknown): boolean {
  return value != null && value !== false && value !== true && value !== "";
}

/**
 * An unstyled, composable field shell. It owns ids and ARIA semantics; the
 * caller owns the control. The child is never cloned: the render prop receives
 * everything it needs to wire any element (native or custom) to the field.
 */
export function FormField(props: UIFormFieldProps) {
  const controlId = props.id ?? createUniqueId();
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;

  const isError = createMemo(() => Boolean(props.error));

  const describedBy = createMemo(() => {
    const ids: string[] = [];
    const external = props["aria-describedby"];
    if (external) ids.push(...external.split(/\s+/).filter(Boolean));
    if (hasCopy(props.description)) ids.push(descriptionId);
    if (isError() && hasCopy(props.error)) ids.push(errorId);
    return ids.length ? [...new Set(ids)].join(" ") : undefined;
  });

  // Getters, not snapshots: a control spreading these props follows later
  // error/description/required updates without the render prop re-running.
  // Solid's `spread()` re-reads them inside its render effect.
  const controlProps: UIFormFieldControlProps = {
    id: controlId,
    get "aria-describedby"() {
      return describedBy();
    },
    get "aria-invalid"() {
      return isError();
    },
    get "aria-required"() {
      return props.required ? true : undefined;
    },
  };

  const ids: UIFormFieldIds = {
    id: controlId,
    descriptionId,
    errorId,
    get "aria-describedby"() {
      return describedBy();
    },
    get "aria-invalid"() {
      return isError();
    },
    get "aria-required"() {
      return props.required ? true : undefined;
    },
    controlProps,
  };

  return (
    <Stack gap="xs" className={cn("w-full min-w-0", props.className)} style={props.style} data-testid={props["data-testid"]}>
      {hasCopy(props.label) && (
        <label htmlFor={controlId} className="block">
          <Text
            span
            size="sm"
            fw={500}
            className={cn("text-fin-text", isError() && "text-fin-negative")}
          >
            {props.label}
            {props.required && (
              <span data-part="form-field-required" aria-hidden="true" className="ml-1 text-fin-negative">
                *
              </span>
            )}
          </Text>
        </label>
      )}

      {hasCopy(props.description) && (
        <Text id={descriptionId} span size="xs" className="text-fin-text-muted">
          {props.description}
        </Text>
      )}

      {props.children(ids)}

      {isError() && hasCopy(props.error) && (
        <Text id={errorId} span size="xs" className="text-fin-negative">
          {props.error as JSX.Element}
        </Text>
      )}
    </Stack>
  );
}
